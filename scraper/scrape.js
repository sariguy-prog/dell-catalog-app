// סקריפט סקרייפינג לקטלוג Dell באתר cms.co.il
// מריצים ידנית עם: npm run scrape
// הפלט נכתב ל- site/data/products.json כדי שהאתר הסטטי יוכל לקרוא אותו ישירות.

import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, "..", "site", "data", "products.json");
const BACKUP_PATH = path.join(__dirname, "..", "site", "data", "products.rejected.json");

const BASE_URL = "https://cms.co.il/product-category/laptop-pc/brand-dell/";
const CONTACT_EMAIL = "sariguy@gmail.com";
const USER_AGENT = `SmartDeal-CatalogBot/1.0 (+contact: ${CONTACT_EMAIL})`;

const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 2000;
const MIN_ACCEPTABLE_RATIO = 0.9; // אם נאספו פחות מ-90% מהריצה הקודמת - לעצור ולהתריע

// סדר חשוב - מהספציפי לכללי, כדי לתפוס למשל "Dell Pro Max" לפני "Dell Pro"
const FAMILY_PREFIXES = [
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

function detectFamily(name) {
  for (const prefix of FAMILY_PREFIXES) {
    if (name.toLowerCase().startsWith(prefix.toLowerCase())) {
      return prefix;
    }
  }
  return "Dell";
}

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

function parseSizeToGb(token) {
  const m = token.match(/^(\d+(?:\.\d+)?)\s*(GB|TB)$/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  return unit === "TB" ? Math.round(value * 1024) : Math.round(value);
}

// שורת המפרט הקצרה מגיעה כרשימת ערכים מופרדים ב-" | " בסדר לא קבוע לגמרי
// (למשל "Touch" יכול להופיע לפני או אחרי האחריות, ולפעמים גודל המסך חסר).
// לכן מסווגים כל ערך לפי התבנית שלו ולא לפי מיקומו הקבוע.
function parseAttributes(rawText) {
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

    if (/^\d+(\.\d+)?\s*(GB|TB)$/i.test(token)) {
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

function parseProductCard($, el) {
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
  const attributes = parseAttributes(attributesText);

  const inStock = classList.includes("instock");

  const family = detectFamily(name);

  if (!name || !url || !sku) {
    return null;
  }

  return {
    sku,
    name,
    family,
    url,
    image,
    inStock,
    rawSpec: attributesText,
    ...attributes,
  };
}

// מטבלת "מפרט יצרן" בעמוד המוצר עצמו - הרבה יותר מפורטת מהתגית הקצרה ברשימה.
// נשמר כרשימת {label, value} כדי לשמור על סדר וניסוח מקוריים מהספק.
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

async function scrapePage(pageNumber) {
  const url =
    pageNumber === 1 ? BASE_URL : `${BASE_URL}page/${pageNumber}/`;
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
    const product = parseProductCard($, el);
    if (product) products.push(product);
  });

  return { products, maxPage };
}

async function scrapeAll() {
  console.log(`מתחיל סקרייפינג מ-${BASE_URL} ...`);

  const { products: firstPageProducts, maxPage } = await scrapePage(1);
  const allProducts = [...firstPageProducts];
  const totalPages = maxPage || 1;

  console.log(`עמוד 1/${totalPages}: נאספו ${firstPageProducts.length} מוצרים`);

  for (let page = 2; page <= totalPages; page++) {
    await sleep(randomDelay());
    const { products } = await scrapePage(page);
    console.log(`עמוד ${page}/${totalPages}: נאספו ${products.length} מוצרים`);
    allProducts.push(...products);
  }

  // הסרת כפילויות לפי מק"ט, ליתר ביטחון
  const bySku = new Map();
  for (const p of allProducts) {
    bySku.set(p.sku, p);
  }
  const uniqueProducts = Array.from(bySku.values());

  console.log(`\nאוסף מפרט מלא מעמוד המוצר עבור ${uniqueProducts.length} מוצרים...`);
  let failedSpecs = 0;
  for (let i = 0; i < uniqueProducts.length; i++) {
    const product = uniqueProducts[i];
    await sleep(randomDelay());
    try {
      product.fullSpecs = await scrapeFullSpecs(product.url);
    } catch (err) {
      failedSpecs++;
      product.fullSpecs = [];
      console.error(`  נכשל מפרט מלא עבור ${product.name} (${product.sku}): ${err.message}`);
    }
    if ((i + 1) % 10 === 0 || i === uniqueProducts.length - 1) {
      console.log(`  ${i + 1}/${uniqueProducts.length} מוצרים`);
    }
  }
  if (failedSpecs > 0) {
    console.warn(`\n⚠️  לא ניתן היה לאסוף מפרט מלא עבור ${failedSpecs} מוצרים (נשארו עם מפרט קצר בלבד).`);
  }

  return uniqueProducts;
}

async function loadExisting() {
  try {
    const raw = await fs.readFile(OUTPUT_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const scraped = await scrapeAll();
  const existing = await loadExisting();

  console.log(`\nסה"כ נאספו ${scraped.length} מוצרים ייחודיים.`);

  if (existing && Array.isArray(existing) && existing.length > 0) {
    const ratio = scraped.length / existing.length;
    if (ratio < MIN_ACCEPTABLE_RATIO) {
      await fs.writeFile(BACKUP_PATH, JSON.stringify(scraped, null, 2), "utf-8");
      console.error(
        `\n⚠️  אזהרה: נאספו רק ${scraped.length} מוצרים לעומת ${existing.length} בריצה הקודמת ` +
          `(${Math.round(ratio * 100)}%). ייתכן שמבנה ה-HTML של האתר השתנה.\n` +
          `products.json הקיים לא נדרס. התוצאה החדשה נשמרה לבדיקה ידנית בקובץ:\n${BACKUP_PATH}`
      );
      process.exitCode = 1;
      return;
    }
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(scraped, null, 2), "utf-8");
  console.log(`\n✅ נשמר בהצלחה: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("שגיאה בריצת הסקרייפר:", err);
  process.exitCode = 1;
});
