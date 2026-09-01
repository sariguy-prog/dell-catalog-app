const WHATSAPP_NUMBER = "972506476817";

const FILTER_FIELDS = [
  { key: "family", label: "משפחת מוצר" },
  { key: "cpu_type", label: "סוג מעבד" },
  { key: "cpu_model", label: "דגם מעבד" },
  { key: "ram_gb", label: "זיכרון (RAM)", format: (v) => `${v}GB` },
  { key: "disk_gb", label: "אחסון (דיסק)", format: (v) => (v >= 1024 ? `${v / 1024}TB` : `${v}GB`) },
  { key: "screen_size", label: "גודל מסך", format: (v) => `${v}"` },
  { key: "gpu_type", label: "כרטיס מסך" },
  { key: "os", label: "מערכת הפעלה" },
  { key: "color", label: "צבע" },
];

const state = {
  products: [],
  recommendedSkus: new Set(),
  activeFilters: {}, // key -> Set of selected values
  touchOnly: false,
  searchText: "",
  selectedSkus: new Set(),
};

function specLine(p) {
  const parts = [];
  if (p.cpu_model) parts.push(`מעבד: ${p.cpu_model}`);
  if (p.ram_gb) parts.push(`זיכרון: ${p.ram_gb}GB`);
  if (p.disk_gb) {
    const diskLabel = p.disk_gb >= 1024 ? `${p.disk_gb / 1024}TB` : `${p.disk_gb}GB`;
    parts.push(`אחסון: ${diskLabel}`);
  }
  if (p.gpu_type) parts.push(`כ. מסך: ${p.gpu_type}`);
  if (p.screen_size) parts.push(`מסך: ${p.screen_size}"`);
  if (p.touch) parts.push("מסך מגע");
  if (p.os) parts.push(`מערכת הפעלה: ${p.os}`);
  if (p.warranty_years) parts.push(`אחריות: ${p.warranty_years} שנים`);
  return parts.join(" | ");
}

function specListForMessage(p) {
  const parts = [];
  if (p.cpu_model) parts.push(`מעבד ${p.cpu_model}`);
  if (p.ram_gb) parts.push(`זיכרון ${p.ram_gb}GB`);
  if (p.disk_gb) {
    const diskLabel = p.disk_gb >= 1024 ? `${p.disk_gb / 1024}TB` : `${p.disk_gb}GB`;
    parts.push(`דיסק ${diskLabel}`);
  }
  if (p.gpu_type) parts.push(`כרטיס מסך ${p.gpu_type}`);
  if (p.screen_size) parts.push(`מסך ${p.screen_size}"`);
  if (p.touch) parts.push("מסך מגע");
  if (p.os) parts.push(p.os);
  return parts.join(", ");
}

function buildWhatsappUrl(text) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

function singleProductMessage(p) {
  return `שלום, אני מעוניין בהצעת מחיר עבור: ${p.name} (מק"ט ${p.sku}), עם המפרט: ${specListForMessage(p)}`;
}

function multiProductMessage(products) {
  const lines = products.map(
    (p, i) => `${i + 1}. ${p.name} (מק"ט ${p.sku}) - ${specListForMessage(p)}`
  );
  return `שלום, אני מעוניין בהצעת מחיר עבור המוצרים הבאים:\n${lines.join("\n")}`;
}

async function loadData() {
  const [productsRes, recommendedRes] = await Promise.all([
    fetch("data/products.json"),
    fetch("data/recommended-skus.json"),
  ]);
  const products = await productsRes.json();
  let recommended = [];
  try {
    recommended = await recommendedRes.json();
  } catch {
    recommended = [];
  }
  state.products = products;
  state.recommendedSkus = new Set(recommended);
}

function uniqueSortedValues(key) {
  const values = new Set();
  for (const p of state.products) {
    if (p[key] !== null && p[key] !== undefined && p[key] !== "") {
      values.add(p[key]);
    }
  }
  const arr = [...values];
  if (typeof arr[0] === "number") {
    return arr.sort((a, b) => a - b);
  }
  return arr.sort((a, b) => a.localeCompare(b, "he"));
}

function renderFilterFields() {
  const container = document.getElementById("filterFields");
  container.innerHTML = "";

  for (const field of FILTER_FIELDS) {
    const values = uniqueSortedValues(field.key);
    if (values.length === 0) continue;

    const group = document.createElement("div");
    group.className = "filter-group";

    const label = document.createElement("label");
    label.textContent = field.label;
    group.appendChild(label);

    const list = document.createElement("div");
    list.className = "checkbox-list";

    for (const value of values) {
      const id = `f-${field.key}-${String(value).replace(/\W+/g, "_")}`;
      const wrapper = document.createElement("label");
      wrapper.setAttribute("for", id);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = id;
      checkbox.value = String(value);
      checkbox.addEventListener("change", () => {
        toggleFilterValue(field.key, value, checkbox.checked);
      });

      const text = document.createElement("span");
      text.textContent = field.format ? field.format(value) : value;

      wrapper.appendChild(checkbox);
      wrapper.appendChild(text);
      list.appendChild(wrapper);
    }

    group.appendChild(list);
    container.appendChild(group);
  }

  // סינון מסך מגע - כן/לא
  const touchGroup = document.createElement("div");
  touchGroup.className = "filter-group";
  const touchLabel = document.createElement("label");
  touchLabel.textContent = "מסך מגע";
  const touchList = document.createElement("div");
  touchList.className = "checkbox-list";
  const touchCheckbox = document.createElement("input");
  touchCheckbox.type = "checkbox";
  touchCheckbox.id = "f-touch-only";
  const touchWrapper = document.createElement("label");
  touchWrapper.setAttribute("for", "f-touch-only");
  touchCheckbox.addEventListener("change", () => {
    state.touchOnly = touchCheckbox.checked;
    renderProducts();
  });
  const touchText = document.createElement("span");
  touchText.textContent = "רק מסכי מגע";
  touchWrapper.appendChild(touchCheckbox);
  touchWrapper.appendChild(touchText);
  touchList.appendChild(touchWrapper);
  touchGroup.appendChild(touchLabel);
  touchGroup.appendChild(touchList);
  container.appendChild(touchGroup);
}

function toggleFilterValue(key, value, checked) {
  if (!state.activeFilters[key]) state.activeFilters[key] = new Set();
  if (checked) {
    state.activeFilters[key].add(value);
  } else {
    state.activeFilters[key].delete(value);
  }
  renderProducts();
}

function matchesFilters(p) {
  for (const [key, valueSet] of Object.entries(state.activeFilters)) {
    if (valueSet.size === 0) continue;
    if (!valueSet.has(p[key])) return false;
  }
  if (state.touchOnly && !p.touch) return false;

  if (state.searchText) {
    const haystack = [
      p.name,
      p.family,
      p.cpu_type,
      p.cpu_model,
      p.gpu_type,
      p.os,
      p.sku,
      p.screen_size,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(state.searchText.toLowerCase())) return false;
  }

  return true;
}

function createProductCard(p) {
  const card = document.createElement("div");
  card.className = "product-card";
  if (state.selectedSkus.has(p.sku)) card.classList.add("selected");

  const top = document.createElement("div");
  top.className = "card-top";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "select-checkbox";
  checkbox.checked = state.selectedSkus.has(p.sku);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      state.selectedSkus.add(p.sku);
    } else {
      state.selectedSkus.delete(p.sku);
    }
    card.classList.toggle("selected", checkbox.checked);
    renderSelectionBar();
  });
  top.appendChild(checkbox);

  if (state.recommendedSkus.has(p.sku)) {
    const badge = document.createElement("span");
    badge.className = "recommended-badge";
    badge.textContent = "מומלץ";
    top.appendChild(badge);
  }

  card.appendChild(top);

  const imgWrap = document.createElement("div");
  imgWrap.className = "product-image-wrap clickable";
  imgWrap.setAttribute("role", "button");
  imgWrap.setAttribute("tabindex", "0");
  imgWrap.setAttribute("aria-label", `פרטים נוספים על ${p.name}`);
  const img = document.createElement("img");
  img.src = p.image;
  img.alt = p.name;
  img.loading = "lazy";
  imgWrap.appendChild(img);
  imgWrap.addEventListener("click", () => openProductModal(p));
  imgWrap.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openProductModal(p);
    }
  });
  card.appendChild(imgWrap);

  const name = document.createElement("h3");
  name.className = "product-name";
  const nameBtn = document.createElement("button");
  nameBtn.type = "button";
  nameBtn.textContent = p.name;
  nameBtn.addEventListener("click", () => openProductModal(p));
  name.appendChild(nameBtn);
  card.appendChild(name);

  const sku = document.createElement("p");
  sku.className = "product-sku";
  sku.textContent = `מק"ט: ${p.sku}`;
  card.appendChild(sku);

  const spec = document.createElement("p");
  spec.className = "product-spec";
  spec.textContent = p.rawSpec || specLine(p);
  card.appendChild(spec);

  const stockBadge = document.createElement("span");
  stockBadge.className = `stock-badge ${p.inStock ? "in" : "out"}`;
  stockBadge.textContent = p.inStock ? "במלאי" : "אינו במלאי";
  card.appendChild(stockBadge);

  const priceNote = document.createElement("p");
  priceNote.className = "price-note";
  priceNote.textContent = "מחיר בהתאמה אישית - בקשו הצעה";
  card.appendChild(priceNote);

  const footer = document.createElement("div");
  footer.className = "card-footer";
  const waBtn = document.createElement("a");
  waBtn.className = "whatsapp-btn";
  waBtn.href = buildWhatsappUrl(singleProductMessage(p));
  waBtn.target = "_blank";
  waBtn.rel = "noopener";
  waBtn.textContent = "בקשו הצעת מחיר בוואטסאפ";
  footer.appendChild(waBtn);
  card.appendChild(footer);

  return card;
}

function openProductModal(p) {
  document.getElementById("modalImage").src = p.image;
  document.getElementById("modalImage").alt = p.name;
  document.getElementById("modalProductName").textContent = p.name;
  document.getElementById("modalSku").textContent = `מק"ט: ${p.sku}`;
  document.getElementById("modalSpec").textContent = specLine(p);

  const stockBadge = document.getElementById("modalStockBadge");
  stockBadge.className = `stock-badge ${p.inStock ? "in" : "out"}`;
  stockBadge.textContent = p.inStock ? "במלאי" : "אינו במלאי";

  document.getElementById("modalRecommendedBadge").hidden = !state.recommendedSkus.has(p.sku);

  const waBtn = document.getElementById("modalWhatsappBtn");
  waBtn.href = buildWhatsappUrl(singleProductMessage(p));

  const specsTable = document.getElementById("modalSpecsTable");
  specsTable.innerHTML = "";
  const specsTitle = document.querySelector(".modal-specs-title");
  const fullSpecs = Array.isArray(p.fullSpecs) ? p.fullSpecs : [];
  const showFullSpecs = fullSpecs.length > 0;
  specsTitle.hidden = !showFullSpecs;
  specsTable.hidden = !showFullSpecs;
  for (const { label, value } of fullSpecs) {
    const row = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = label;
    const td = document.createElement("td");
    td.textContent = value;
    row.appendChild(th);
    row.appendChild(td);
    specsTable.appendChild(row);
  }

  document.getElementById("productModal").hidden = false;
}

function closeProductModal() {
  document.getElementById("productModal").hidden = true;
}

function setupModal() {
  document.getElementById("modalCloseBtn").addEventListener("click", closeProductModal);
  document.getElementById("productModal").addEventListener("click", (e) => {
    if (e.target.id === "productModal") closeProductModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeProductModal();
  });
}

function renderProducts() {
  const grid = document.getElementById("productsGrid");
  const emptyState = document.getElementById("emptyState");
  const resultsCount = document.getElementById("resultsCount");

  const filtered = state.products.filter(matchesFilters);

  grid.innerHTML = "";
  filtered.forEach((p) => grid.appendChild(createProductCard(p)));

  resultsCount.textContent = `${filtered.length} מוצרים מתוך ${state.products.length}`;
  emptyState.hidden = filtered.length !== 0;
  grid.hidden = filtered.length === 0;
}

function renderSelectionBar() {
  const bar = document.getElementById("selectionBar");
  const count = document.getElementById("selectionCount");
  const sendBtn = document.getElementById("sendSelectionBtn");

  if (state.selectedSkus.size === 0) {
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  count.textContent = `${state.selectedSkus.size} מוצרים נבחרו`;
  sendBtn.textContent = `בקשו הצעה על ${state.selectedSkus.size} מוצרים נבחרים`;

  sendBtn.onclick = () => {
    const selectedProducts = state.products.filter((p) => state.selectedSkus.has(p.sku));
    window.open(buildWhatsappUrl(multiProductMessage(selectedProducts)), "_blank", "noopener");
  };
}

function setupSearch() {
  const input = document.getElementById("searchInput");
  input.addEventListener("input", () => {
    state.searchText = input.value.trim();
    renderProducts();
  });
}

function setupClearFilters() {
  document.getElementById("clearFiltersBtn").addEventListener("click", () => {
    state.activeFilters = {};
    state.touchOnly = false;
    state.searchText = "";
    document.getElementById("searchInput").value = "";
    document.querySelectorAll('#filterFields input[type="checkbox"]').forEach((cb) => {
      cb.checked = false;
    });
    renderProducts();
  });
}

function setupSelectionBar() {
  document.getElementById("clearSelectionBtn").addEventListener("click", () => {
    state.selectedSkus.clear();
    renderProducts();
    renderSelectionBar();
  });
}

function setupMobileFilters() {
  const panel = document.getElementById("filtersPanel");
  const overlay = document.getElementById("filtersOverlay");
  const toggleBtn = document.getElementById("toggleFiltersBtn");

  const open = () => {
    panel.classList.add("open");
    overlay.style.display = "block";
  };
  const close = () => {
    panel.classList.remove("open");
    overlay.style.display = "none";
  };

  toggleBtn.addEventListener("click", open);
  overlay.addEventListener("click", close);
}

async function init() {
  await loadData();
  renderFilterFields();
  renderProducts();
  renderSelectionBar();
  setupSearch();
  setupClearFilters();
  setupSelectionBar();
  setupMobileFilters();
  setupModal();
}

init();
