const TABLE_COUNT = 15;
const ENDPOINT_KEY = "avlu-pos-sheets-endpoint";
const OUTBOX_KEY = "avlu-pos-outbox-v1";
const config = window.AVLU_SUPABASE_CONFIG;

const state = {
  activeTable: null,
  tables: {},
  menu: [],
  category: "Tümü",
  search: "",
  user: null,
  menuLoaded: false,
  refreshTimer: null,
  noteTimer: null,
  channel: null,
};

const el = Object.fromEntries([
  "authGate", "loginForm", "loginEmail", "loginPassword", "loginError", "loginButton",
  "staffEmail", "logoutButton", "syncStatus", "settingsButton", "tableGrid", "openTableCount",
  "emptyState", "orderWorkspace", "activeTableTitle", "headerTotal", "menuSearch", "showCartButton",
  "cartItemCount", "categoryFilters", "menuLoading", "menuGrid", "cartPanel", "cartTitle",
  "closeCartButton", "cartEmpty", "cartItems", "tableNote", "grandTotal", "checkoutButton",
  "overlay", "checkoutDialog", "checkoutForm", "checkoutTitle", "checkoutAmount",
  "confirmCheckout", "settingsDialog", "settingsForm", "sheetEndpoint", "queueCount",
  "retrySyncButton", "saveSettingsButton", "cancelCheckoutButton", "closeSettingsButton", "toast"
].map((id) => [id, document.getElementById(id)]));

const money = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });
const db = window.supabase.createClient(config.url, config.publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

function freshTable(id) {
  return { id, items: {}, note: "", openedAt: null, updatedAt: null };
}

function resetTables() {
  state.tables = {};
  for (let i = 1; i <= TABLE_COUNT; i += 1) state.tables[i] = freshTable(i);
}

function normalizeText(value) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function loadMenu() {
  if (state.menuLoaded) return;
  try {
    const response = await fetch("../m-7k9p3/index.html", { cache: "no-store" });
    if (!response.ok) throw new Error("Menü okunamadı");
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const products = [];
    doc.querySelectorAll(".section").forEach((section) => {
      const category = section.querySelector(".section-title h2")?.textContent.trim();
      if (!category) return;
      section.querySelectorAll(".menu-item").forEach((item, index) => {
        const priceText = item.querySelector(".menu-price")?.textContent || "";
        const nameNode = [...item.children].find((child) => !child.classList.contains("menu-price"));
        const name = nameNode?.textContent.replace(/\s+/g, " ").trim();
        const price = Number(priceText.replace(/[^\d,.-]/g, "").replace(",", "."));
        if (name && Number.isFinite(price)) products.push({ id: `${section.id || category}-${index}`, name, price, category });
      });
    });
    if (!products.length) throw new Error("Menü ürünü bulunamadı");
    state.menu = products;
    state.menuLoaded = true;
    el.menuLoading.hidden = true;
    renderCategories();
    renderMenu();
  } catch (error) {
    el.menuLoading.textContent = "Menü yüklenemedi. Sayfayı yenileyip tekrar deneyin.";
    console.error(error);
  }
}

async function loadRestaurantData({ silent = false } = {}) {
  if (!state.user) return;
  const [tablesResult, itemsResult] = await Promise.all([
    db.from("restaurant_tables").select("id,note,opened_at,updated_at").order("id"),
    db.from("table_items").select("table_number,product_id,name,category,unit_price,quantity,updated_at")
  ]);
  const error = tablesResult.error || itemsResult.error;
  if (error) {
    console.error(error);
    if (!silent) toast("Veritabanı hazırlanıyor veya bağlantı kurulamadı");
    return;
  }

  resetTables();
  tablesResult.data.forEach((row) => {
    state.tables[row.id] = { id: row.id, items: {}, note: row.note || "", openedAt: row.opened_at, updatedAt: row.updated_at };
  });
  itemsResult.data.forEach((row) => {
    if (!state.tables[row.table_number]) state.tables[row.table_number] = freshTable(row.table_number);
    state.tables[row.table_number].items[row.product_id] = {
      id: row.product_id,
      name: row.name,
      category: row.category,
      price: Number(row.unit_price),
      quantity: row.quantity
    };
  });
  renderTables();
  if (state.activeTable) renderOrder();
}

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => loadRestaurantData({ silent: true }), 120);
}

function subscribeToChanges() {
  if (state.channel) db.removeChannel(state.channel);
  state.channel = db.channel("avlu-pos-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_tables" }, scheduleRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "table_items" }, scheduleRefresh)
    .subscribe();
}

function tableTotal(tableNumber) {
  return Object.values(state.tables[tableNumber]?.items || {}).reduce((sum, row) => sum + row.price * row.quantity, 0);
}

function tableQuantity(tableNumber) {
  return Object.values(state.tables[tableNumber]?.items || {}).reduce((sum, row) => sum + row.quantity, 0);
}

function renderTables() {
  el.tableGrid.replaceChildren();
  let openCount = 0;
  for (let i = 1; i <= TABLE_COUNT; i += 1) {
    const open = tableQuantity(i) > 0;
    if (open) openCount += 1;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `table-button${open ? " open" : ""}${state.activeTable === i ? " active" : ""}`;
    const title = document.createElement("strong");
    title.textContent = `Masa ${i}`;
    const detail = document.createElement("span");
    detail.textContent = open ? `${tableQuantity(i)} ürün · ${money.format(tableTotal(i))}` : "Boş";
    button.append(title, detail);
    button.addEventListener("click", () => selectTable(i));
    el.tableGrid.append(button);
  }
  el.openTableCount.textContent = `${openCount} açık`;
}

function selectTable(tableNumber) {
  state.activeTable = tableNumber;
  el.emptyState.hidden = true;
  el.orderWorkspace.hidden = false;
  renderTables();
  renderOrder();
}

function renderCategories() {
  const categories = ["Tümü", ...new Set(state.menu.map((item) => item.category))];
  el.categoryFilters.replaceChildren();
  categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-button${state.category === category ? " active" : ""}`;
    button.textContent = category;
    button.addEventListener("click", () => {
      state.category = category;
      renderCategories();
      renderMenu();
    });
    el.categoryFilters.append(button);
  });
}

function renderMenu() {
  const query = normalizeText(state.search.trim());
  const filtered = state.menu.filter((item) => {
    const inCategory = state.category === "Tümü" || item.category === state.category;
    return inCategory && (!query || normalizeText(item.name).includes(query));
  });
  el.menuGrid.replaceChildren();
  filtered.forEach((product) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-card";
    const name = document.createElement("span");
    name.textContent = product.name;
    const price = document.createElement("strong");
    price.textContent = money.format(product.price);
    button.append(name, price);
    button.addEventListener("click", () => addProduct(product, button));
    el.menuGrid.append(button);
  });
  if (!filtered.length && state.menu.length) {
    const message = document.createElement("div");
    message.className = "menu-loading";
    message.textContent = "Aramanıza uygun ürün bulunamadı.";
    el.menuGrid.append(message);
  }
}

async function addProduct(product, button) {
  if (!state.activeTable) return;
  button.disabled = true;
  const { error } = await db.rpc("change_table_item", {
    p_table_number: state.activeTable,
    p_product_id: product.id,
    p_name: product.name,
    p_category: product.category,
    p_unit_price: product.price,
    p_delta: 1
  });
  button.disabled = false;
  if (error) return handleDataError(error);
  await loadRestaurantData({ silent: true });
  toast(`${product.name} eklendi`);
}

async function changeQuantity(productId, delta, button) {
  const row = state.tables[state.activeTable]?.items[productId];
  if (!row) return;
  button.disabled = true;
  const { error } = await db.rpc("change_table_item", {
    p_table_number: state.activeTable,
    p_product_id: row.id,
    p_name: row.name,
    p_category: row.category,
    p_unit_price: row.price,
    p_delta: delta
  });
  if (error) handleDataError(error);
  await loadRestaurantData({ silent: true });
}

function renderOrder() {
  if (!state.activeTable) return;
  const table = state.tables[state.activeTable] || freshTable(state.activeTable);
  const total = tableTotal(state.activeTable);
  const quantity = tableQuantity(state.activeTable);
  el.activeTableTitle.textContent = `Masa ${state.activeTable}`;
  el.cartTitle.textContent = `Masa ${state.activeTable}`;
  el.headerTotal.textContent = money.format(total);
  el.grandTotal.textContent = money.format(total);
  el.cartItemCount.textContent = quantity;
  el.checkoutButton.disabled = quantity === 0;
  if (document.activeElement !== el.tableNote) el.tableNote.value = table.note || "";
  el.cartItems.replaceChildren();
  const rows = Object.values(table.items);
  el.cartEmpty.hidden = rows.length > 0;
  rows.forEach((row) => {
    const wrapper = document.createElement("div");
    wrapper.className = "cart-item";
    const top = document.createElement("div");
    top.className = "cart-item-top";
    const name = document.createElement("span");
    name.className = "cart-item-name";
    name.textContent = row.name;
    const lineTotal = document.createElement("strong");
    lineTotal.className = "cart-item-price";
    lineTotal.textContent = money.format(row.price * row.quantity);
    top.append(name, lineTotal);
    const controls = document.createElement("div");
    controls.className = "quantity-control";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.setAttribute("aria-label", `${row.name} azalt`);
    minus.addEventListener("click", () => changeQuantity(row.id, -1, minus));
    const count = document.createElement("span");
    count.textContent = row.quantity;
    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.setAttribute("aria-label", `${row.name} artır`);
    plus.addEventListener("click", () => changeQuantity(row.id, 1, plus));
    controls.append(minus, count, plus);
    wrapper.append(top, controls);
    el.cartItems.append(wrapper);
  });
}

function openCheckout() {
  const total = tableTotal(state.activeTable);
  if (!total) return;
  el.checkoutTitle.textContent = `Masa ${state.activeTable}`;
  el.checkoutAmount.textContent = money.format(total);
  el.checkoutDialog.showModal();
}

async function completeCheckout(event) {
  event.preventDefault();
  const tableNumber = state.activeTable;
  if (!tableNumber || !tableQuantity(tableNumber)) return;
  clearTimeout(state.noteTimer);
  const payment = new FormData(el.checkoutForm).get("payment");
  el.confirmCheckout.disabled = true;
  el.confirmCheckout.textContent = "Kapatılıyor…";
  const { data: sale, error } = await db.rpc("close_table", {
    p_table_number: tableNumber,
    p_payment_method: payment,
    p_note: state.tables[tableNumber].note || ""
  });
  el.confirmCheckout.disabled = false;
  el.confirmCheckout.textContent = "Ödemeyi al ve kapat";
  if (error) return handleDataError(error);
  queueSale({ ...sale, total: Number(sale.total), items: sale.items.map((item) => ({ ...item, price: Number(item.price), lineTotal: Number(item.lineTotal) })) });
  el.checkoutDialog.close();
  await loadRestaurantData({ silent: true });
  toast(`Masa ${tableNumber} kapatıldı`);
  await syncOutbox();
}

function getOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; } catch (_) { return []; }
}

function setOutbox(rows) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(rows));
  updateSyncStatus();
}

function queueSale(sale) {
  const rows = getOutbox();
  if (!rows.some((row) => row.saleId === sale.saleId)) rows.push(sale);
  setOutbox(rows);
}

async function syncOutbox() {
  const endpoint = localStorage.getItem(ENDPOINT_KEY)?.trim();
  const rows = getOutbox();
  if (!endpoint || !rows.length || !navigator.onLine) return updateSyncStatus();
  for (const sale of [...rows]) {
    try {
      await fetch(endpoint, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(sale) });
      setOutbox(getOutbox().filter((row) => row.saleId !== sale.saleId));
    } catch (error) {
      console.error("Sheets senkronizasyonu başarısız", error);
      break;
    }
  }
  updateSyncStatus();
}

function updateSyncStatus() {
  const endpoint = localStorage.getItem(ENDPOINT_KEY)?.trim();
  const count = getOutbox().length;
  el.queueCount.textContent = count;
  el.syncStatus.className = "sync-status";
  if (!endpoint) {
    el.syncStatus.textContent = count ? `${count} rapor cihazda` : "Sheets ayarlanmadı";
    if (count) el.syncStatus.classList.add("warning");
  } else if (count) {
    el.syncStatus.textContent = `${count} rapor bekliyor`;
    el.syncStatus.classList.add("warning");
  } else {
    el.syncStatus.textContent = "Sheets bağlı";
    el.syncStatus.classList.add("online");
  }
}

function openSettings() {
  el.sheetEndpoint.value = localStorage.getItem(ENDPOINT_KEY) || "";
  updateSyncStatus();
  el.settingsDialog.showModal();
}

function saveSettings(event) {
  event.preventDefault();
  const endpoint = el.sheetEndpoint.value.trim();
  if (endpoint && !endpoint.startsWith("https://script.google.com/")) return toast("Geçerli bir Apps Script adresi girin");
  localStorage.setItem(ENDPOINT_KEY, endpoint);
  el.settingsDialog.close();
  updateSyncStatus();
  syncOutbox();
  toast(endpoint ? "Sheets bağlantısı kaydedildi" : "Sheets bağlantısı kaldırıldı");
}

async function login(event) {
  event.preventDefault();
  el.loginError.textContent = "";
  el.loginButton.disabled = true;
  el.loginButton.textContent = "Giriş yapılıyor…";
  const { error } = await db.auth.signInWithPassword({ email: el.loginEmail.value.trim(), password: el.loginPassword.value });
  el.loginButton.disabled = false;
  el.loginButton.textContent = "Giriş yap";
  if (error) el.loginError.textContent = "E-posta veya şifre hatalı.";
}

async function applySession(session) {
  state.user = session?.user || null;
  if (!state.user) {
    el.authGate.hidden = false;
    el.staffEmail.textContent = "";
    if (state.channel) await db.removeChannel(state.channel);
    return;
  }
  const { data: membership, error: membershipError } = await db
    .from("staff_members")
    .select("user_id")
    .eq("user_id", state.user.id)
    .maybeSingle();
  if (membershipError || !membership) {
    el.authGate.hidden = false;
    el.loginError.textContent = membershipError
      ? "Veritabanı kurulumu henüz tamamlanmadı."
      : "Bu hesap personel olarak yetkilendirilmemiş.";
    await db.auth.signOut();
    return;
  }
  el.authGate.hidden = true;
  el.staffEmail.textContent = state.user.email || "Personel";
  await Promise.all([loadMenu(), loadRestaurantData()]);
  subscribeToChanges();
  syncOutbox();
}

function handleDataError(error) {
  console.error(error);
  const message = error?.message?.includes("JWT") ? "Oturum süresi doldu, tekrar giriş yapın" : "İşlem tamamlanamadı, tekrar deneyin";
  toast(message);
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.toast.classList.remove("show"), 1900);
}

el.menuSearch.addEventListener("input", (event) => { state.search = event.target.value; renderMenu(); });
el.tableNote.addEventListener("input", (event) => {
  if (!state.activeTable) return;
  const tableNumber = state.activeTable;
  state.tables[tableNumber].note = event.target.value;
  clearTimeout(state.noteTimer);
  state.noteTimer = setTimeout(async () => {
    const { error } = await db.rpc("set_table_note", { p_table_number: tableNumber, p_note: state.tables[tableNumber].note });
    if (error) handleDataError(error);
  }, 450);
});
el.showCartButton.addEventListener("click", () => { el.cartPanel.classList.add("open"); el.overlay.hidden = false; });
el.closeCartButton.addEventListener("click", () => { el.cartPanel.classList.remove("open"); el.overlay.hidden = true; });
el.overlay.addEventListener("click", () => el.closeCartButton.click());
el.checkoutButton.addEventListener("click", openCheckout);
el.checkoutForm.addEventListener("submit", completeCheckout);
el.cancelCheckoutButton.addEventListener("click", () => el.checkoutDialog.close());
el.settingsButton.addEventListener("click", openSettings);
el.settingsForm.addEventListener("submit", saveSettings);
el.closeSettingsButton.addEventListener("click", () => el.settingsDialog.close());
el.retrySyncButton.addEventListener("click", (event) => { event.preventDefault(); syncOutbox(); toast("Gönderim yeniden denendi"); });
el.loginForm.addEventListener("submit", login);
el.logoutButton.addEventListener("click", () => db.auth.signOut());
window.addEventListener("online", syncOutbox);

resetTables();
renderTables();
updateSyncStatus();
db.auth.onAuthStateChange((_event, session) => setTimeout(() => applySession(session), 0));
db.auth.getSession().then(({ data }) => applySession(data.session));
