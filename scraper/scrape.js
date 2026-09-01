// סקריפט סקרייפינג לקטלוג Dell באתר cms.co.il
// מריצים ידנית עם: npm run scrape
// הפלט נכתב ל- site/data/products.json כדי שהאתר הסטטי יוכל לקרוא אותו ישירות.
//
// תומך בכמה קטגוריות מוצרים (ר' מערך CATEGORIES למטה). כל קטגוריה נסרקת
// ומאומתת בנפרד - אם קטגוריה אחת נכשלת בבדיקת התקינות, שאר הקטגוריות עדיין
// מתעדכנות כרגיל והישנה של הקטגוריה שנכשלה נשארת כמו שהיא.

import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "site", "data", "products.json");
const BACKUP_PATH = path.join(__dirname, "..", "site", "data", "products.rejected.json");

const CONTACT_EMAIL = "sariguy@gmail.com";
const USER_AGENT = `SmartDeal-CatalogBot/1.0 (+contact: ${CONTACT_EMAIL})`;

const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 2000;
const MIN_ACCEPTABLE_RATIO = 0.9; // אם נאספו פחות מ-90% מהריצה הקודמת - לעצור ולהתריע (לכל קטגוריה בנפרד)

// ============================================================
// קטגוריות
// ============================================================

const LAPTOP_FAMILY_PREFIXES = [
  // סדר חשוב - מהספציפי לכללי, כדי לתפוס למשל "Dell Pro Max" לפני "Dell Pro"
  "Dell Pro Max Premium",
  "Dell Pro Max Plus",
  "Dell Pro Max",
  "Dell Pro Premium",
  "Dell Pro Plus",
  "Dell Premium",
  "Dell Plus",
  "Dell Pro",
  "XPS",
  "Alienware",
  "Precision",
  "Latitude",
  "Vostro",
  "Inspiron",
  "Dell",
];

const MONITOR_FAMILY_PREFIXES = ["Dell UltraSharp", "Dell Pro", "Alienware", "Dell"];

const DESKTOP_FAMILY_PREFIXES = [
  // סדר חשוב - מהספציפי לכללי
  "Dell Pro Max",
  "Dell Pro Precision",
  "Dell Pro Tower Plus",
  "Dell Pro Tower Essential",
  "Dell Pro Tower",
  "Dell Pro Micro Plus",
  "Dell Pro Micro",
  "Dell Tower Plus",
  "Alienware",
  "Dell Pro",
  "Dell",
];

const KNOWN_COLORS = {
  "כסוף": "כסוף",
  "שחור": "שחור",
  "אפור": "אפור",
  "לבן": "לבן",
  silver: "כסוף",
  black: "שחור",
  grey: "אפור",
  gray: "אפור",
  white: "לבן",
};

function splitCpu(cpuToken) {
  if (!cpuToken) return { cpu_type: null, cpu_model: null };
  const lastDash = cpuToken.lastIndexOf("-");
  if (lastDash === -1) {
    return { cpu_type: cpuToken, cpu_model: cpuToken };
  }
  return {
    cpu_type: cpuToken.slice(0, lastDash).trim(),
    cpu_model: cpuToken,
  };
}

// בדיסקים של מחשבים נייחים לפעמים מגיע יותר מכונן אחד ("1TB SSD + 2TB SSD") -
// לכן לא דורשים שהטוקן כולו יהיה בדיוק גודל+יחידה, רק שהוא *מכיל* כזה, ולוקחים
// את הערך הראשון (הדיסק הראשי).
function containsSizeToken(token) {
  return /\d+(\.\d+)?\s*(GB|TB)\b/i.test(token);
}

function parseSizeToGb(token) {
  const m = token.match(/(\d+(?:\.\d+)?)\s*(GB|TB)\b/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  return unit === "TB" ? Math.round(value * 1024) : Math.round(value);
}

// שורת המפרט הקצרה של מחשבים ניידים ונייחים (CPU | דיסק | זיכרון | GPU |
// אחריות | מערכת הפעלה, לפעמים עם גודל מסך/Touch למחשבים ניידים) מגיעה כרשימת
// ערכים מופרדים ב-" | " בסדר לא קבוע לגמרי. לכן מסווגים כל ערך לפי התבנית שלו
// ולא לפי מיקומו הקבוע - כך גם מחשבים נייחים (שאין להם מסך/touch) מסתדרים עם
// אותה הפונקציה.
function parsePcAttributes(rawText) {
  const tokens = rawText
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);

  const result = {
    cpu_type: null,
    cpu_model: null,
    ram_gb: null,
    disk_gb: null,
    screen_size: null,
    gpu_type: null,
    os: null,
    touch: false,
    color: null,
    warranty_years: null,
  };

  if (tokens.length === 0) return result;

  const cpuToken = tokens[0];
  Object.assign(result, splitCpu(cpuToken));

  const sizeTokensInOrder = [];

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (/^touch$/i.test(token)) {
      result.touch = true;
      continue;
    }

    const warrantyMatch = token.match(/^(\d+)\s*year/i);
    if (warrantyMatch) {
      result.warranty_years = parseInt(warrantyMatch[1], 10);
      continue;
    }

    if (/^\d+(\.\d+)?'$/.test(token)) {
      result.screen_size = token.replace("'", "");
      continue;
    }

    if (containsSizeToken(token)) {
      sizeTokensInOrder.push(token);
      continue;
    }

    if (/windows|ubuntu|linux|freedos|dos|chrome ?os|no ?os/i.test(token)) {
      result.os = token;
      continue;
    }

    if (KNOWN_COLORS[token.trim()] || KNOWN_COLORS[token.trim().toLowerCase()]) {
      result.color = KNOWN_COLORS[token.trim()] || KNOWN_COLORS[token.trim().toLowerCase()];
      continue;
    }

    // מה שנשאר הוא כרטיס המסך (NVIDIA / Intel Graphics / Intel Arc / RTX PRO וכו')
    if (!result.gpu_type) {
      result.gpu_type = token;
    }
  }

  // הטוקן הראשון בגודל GB/TB הוא הדיסק, השני (אם קיים) הוא הזיכרון
  if (sizeTokensInOrder[0]) result.disk_gb = parseSizeToGb(sizeTokensInOrder[0]);
  if (sizeTokensInOrder[1]) result.ram_gb = parseSizeToGb(sizeTokensInOrder[1]);

  return result;
}

const RESOLUTION_LABEL_RE = /(4K|UHD\+?|QHD\+?|WQHD\+?|WUXGA|Full ?HD|FHD|Dual)/i;

// שורת המפרט הקצרה של מסכים הרבה יותר לא אחידה מזו של מחשבים ניידים - מספר
// הערכים משתנה (לפעמים אין קצב רענון, לפעמים אין אחריות בכלל), וגם השדה של
// הרזולוציה עצמו הוא טקסט חופשי (יכול לכלול "QHD", תיאור כפול לפי כניסה
// וכו'). לכן מזהים כל ערך לפי דפוס במקום לפי מיקום קבוע, בדיוק כמו במחשבים
// ניידים.
function parseMonitorAttributes(rawText) {
  const tokens = rawText
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);

  const result = {
    screen_size: null,
    resolution_raw: null,
    resolution: null,
    resolution_label: null,
    refresh_hz: null,
    ports: [],
    touch: false,
    warranty_years: null,
  };

  if (tokens.length === 0) return result;

  if (/^\d+(\.\d+)?'$/.test(tokens[0])) {
    result.screen_size = tokens[0].replace("'", "");
  }

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (/^touch$/i.test(token)) {
      result.touch = true;
      continue;
    }

    const warrantyMatch = token.match(/^(\d+)\s*year/i);
    if (warrantyMatch) {
      result.warranty_years = parseInt(warrantyMatch[1], 10);
      continue;
    }

    // מקטע הרזולוציה - היחיד שמכיל תבנית "מספר x מספר"
    if (/\d{3,4}\s*[x×]\s*\d{3,4}/.test(token)) {
      result.resolution_raw = token;
      const resMatch = token.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/);
      if (resMatch) result.resolution = `${resMatch[1]}x${resMatch[2]}`;
      const hzMatch = token.match(/(\d+)\s*Hz/i);
      if (hzMatch) result.refresh_hz = parseInt(hzMatch[1], 10);
      const labelMatch = token.match(RESOLUTION_LABEL_RE);
      if (labelMatch) result.resolution_label = labelMatch[1];
      continue;
    }

    // מה שנשאר הוא רשימת חיבורים (Display Port, HDMI, USB-C וכו')
    result.ports.push(
      ...token
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
    );
  }

  return result;
}

const CATEGORIES = [
  {
    id: "laptops",
    label: "מחשבים ניידים",
    url: "https://cms.co.il/product-category/laptop-pc/brand-dell/",
    familyPrefixes: LAPTOP_FAMILY_PREFIXES,
    parseAttributes: parsePcAttributes,
  },
  {
    id: "monitors",
    label: "מסכי מחשב",
    url: "https://cms.co.il/product-category/screens/brand-dell/",
    familyPrefixes: MONITOR_FAMILY_PREFIXES,
    parseAttributes: parseMonitorAttributes,
  },
  {
    id: "desktops",
    label: "מחשבים נייחים",
    url: "https://cms.co.il/product-category/pc-nuc/brand-dell/",
    familyPrefixes: DESKTOP_FAMILY_PREFIXES,
    parseAttributes: parsePcAttributes,
  },
  {
    id: "aio",
    label: "מחשבי All In One",
    url: "https://cms.co.il/product-category/all-in-one/brand-dell/",
    familyPrefixes: LAPTOP_FAMILY_PREFIXES,
    parseAttributes: parsePcAttributes,
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay() {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`בקשה נכשלה עבור ${url}: HTTP ${res.status}`);
  }
  return res.text();
}

function detectFamily(name, familyPrefixes) {
  for (const prefix of familyPrefixes) {
    if (name.toLowerCase().startsWith(prefix.toLowerCase())) {
      return prefix;
    }
  }
  return "Dell";
}

function parseProductCard($, el, category) {
  const $el = $(el);
  const classList = ($el.attr("class") || "").split(/\s+/);

  const nameLink = $el.find("h6.product-name a").first();
  const name = nameLink.text().trim();
  const url = nameLink.attr("href") || "";

  const img = $el.find(".thumb-wrapper img").first();
  const image = img.attr("data-lazy-src") || img.attr("src") || "";

  const skuText = $el.find(".electron-sku").first().text().trim();
  const sku = skuText || null;

  const attributesText = $el.find(".product-attributes").first().text().trim();
  const attributes = category.parseAttributes(attributesText);

  const inStock = classList.includes("instock");

  const family = detectFamily(name, category.familyPrefixes);

  if (!name || !url || !sku) {
    return null;
  }

  return {
    sku,
    name,
    category: category.id,
    family,
    url,
    image,
    inStock,
    rawSpec: attributesText,
    ...attributes,
  };
}

// מטבלת "מפרט יצרן" בעמוד המוצר עצמו - הרבה יותר מפורטת מהתגית הקצרה ברשימה.
// נשמר כרשימת {label, value} כדי לשמור על סדר וניסוח מקוריים מהספק. משותף
// לכל הקטגוריות - מבנה עמוד המוצר זהה.
async function scrapeFullSpecs(productUrl) {
  const html = await fetchHtml(productUrl);
  const $ = cheerio.load(html);

  const specs = [];
  $(".woocommerce-product-attributes tr").each((_, row) => {
    const label = $(row).find(".woocommerce-product-attributes-item__label").text().trim();
    const value = $(row).find(".woocommerce-product-attributes-item__value").text().trim();
    if (label && value) specs.push({ label, value });
  });

  return specs;
}

async function scrapeListingPage(category, pageNumber) {
  const url = pageNumber === 1 ? category.url : `${category.url}page/${pageNumber}/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  let maxPage = null;
  const filtersAttr = $(".shop-data-filters").attr("data-shop-filters");
  if (filtersAttr) {
    try {
      const parsed = JSON.parse(filtersAttr);
      if (parsed.max_page) maxPage = parseInt(parsed.max_page, 10);
    } catch {
      // מתעלמים - ניפול חזרה על זיהוי לפי מספר תוצאות ריק
    }
  }

  const products = [];
  $(".electron-loop-product").each((_, el) => {
    const product = parseProductCard($, el, category);
    if (product) products.push(product);
  });

  return { products, maxPage };
}

async function scrapeCategoryListing(category) {
  console.log(`\nמתחיל סקרייפינג "${category.label}" מ-${category.url} ...`);

  const { products: firstPageProducts, maxPage } = await scrapeListingPage(category, 1);
  const allProducts = [...firstPageProducts];
  const totalPages = maxPage || 1;

  console.log(`  עמוד 1/${totalPages}: נאספו ${firstPageProducts.length} מוצרים`);

  for (let page = 2; page <= totalPages; page++) {
    await sleep(randomDelay());
    const { products } = await scrapeListingPage(category, page);
    console.log(`  עמוד ${page}/${totalPages}: נאספו ${products.length} מוצרים`);
    allProducts.push(...products);
  }

  // הסרת כפילויות לפי מק"ט, ליתר ביטחון
  const bySku = new Map();
  for (const p of allProducts) {
    bySku.set(p.sku, p);
  }
  return Array.from(bySku.values());
}

async function scrapeFullSpecsForAll(products) {
  console.log(`\nאוסף מפרט מלא מעמוד המוצר עבור ${products.length} מוצרים...`);
  let failedSpecs = 0;
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    await sleep(randomDelay());
    try {
      product.fullSpecs = await scrapeFullSpecs(product.url);
    } catch (err) {
      failedSpecs++;
      product.fullSpecs = [];
      console.error(`  נכשל מפרט מלא עבור ${product.name} (${product.sku}): ${err.message}`);
    }
    if ((i + 1) % 10 === 0 || i === products.length - 1) {
      console.log(`  ${i + 1}/${products.length} מוצרים`);
    }
  }
  if (failedSpecs > 0) {
    console.warn(`\n⚠️  לא ניתן היה לאסוף מפרט מלא עבור ${failedSpecs} מוצרים (נשארו עם מפרט קצר בלבד).`);
  }
}

async function loadExisting() {
  try {
    const raw = await fs.readFile(OUTPUT_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function main() {
  const existing = (await loadExisting()) || [];
  const existingByCategory = new Map();
  for (const p of existing) {
    const catId = p.category || "laptops"; // תאימות אחורה לקבצים ישנים בלי שדה category
    if (!existingByCategory.has(catId)) existingByCategory.set(catId, []);
    existingByCategory.get(catId).push(p);
  }

  const finalProducts = [];
  const rejected = [];
  let anyRejected = false;

  for (const category of CATEGORIES) {
    const scraped = await scrapeCategoryListing(category);
    const existingForCategory = existingByCategory.get(category.id) || [];

    console.log(`  סה"כ "${category.label}": נאספו ${scraped.length} מוצרים ייחודיים.`);

    if (existingForCategory.length > 0) {
      const ratio = scraped.length / existingForCategory.length;
      if (ratio < MIN_ACCEPTABLE_RATIO) {
        anyRejected = true;
        rejected.push({ category: category.id, label: category.label, products: scraped });
        console.error(
          `  ⚠️  אזהרה: נאספו רק ${scraped.length} מוצרים ב"${category.label}" לעומת ` +
            `${existingForCategory.length} בריצה הקודמת (${Math.round(ratio * 100)}%). ` +
            `ייתכן שמבנה ה-HTML של האתר השתנה - הקטגוריה הזו לא תעודכן הפעם.`
        );
        finalProducts.push(...existingForCategory);
        continue;
      }
    }

    finalProducts.push(...scraped);
  }

  await scrapeFullSpecsForAll(finalProducts.filter((p) => !p.fullSpecs));

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(finalProducts, null, 2), "utf-8");
  console.log(`\n✅ נשמר בהצלחה: ${OUTPUT_PATH} (${finalProducts.length} מוצרים סה"כ)`);

  if (anyRejected) {
    await fs.writeFile(BACKUP_PATH, JSON.stringify(rejected, null, 2), "utf-8");
    console.error(
      `\n⚠️  קטגוריה אחת או יותר לא עודכנה (ר' אזהרות למעלה). התוצאה שנאספה בכל זאת ` +
        `נשמרה לבדיקה ידנית בקובץ:\n${BACKUP_PATH}`
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("שגיאה בריצת הסקרייפר:", err);
  process.exitCode = 1;
});
