/**
 * Avlu Sipariş -> Google Sheets alıcısı
 *
 * 1. Boş bir Google Sheet açın.
 * 2. Uzantılar > Apps Script bölümünde bu dosyanın içeriğini yapıştırın.
 * 3. setup() fonksiyonunu bir kez çalıştırıp izin verin.
 * 4. Dağıt > Yeni dağıtım > Web uygulaması; erişimi "Herkes" yapın.
 * 5. /exec ile biten adresi sipariş ekranındaki Ayarlar bölümüne girin.
 */

const SALES_SHEET = "Satışlar";
const ITEMS_SHEET = "Satış Detayı";
const DASHBOARD_SHEET = "Özet";

function setup() {
  const spreadsheet = SpreadsheetApp.getActive();
  const sales = getOrCreateSheet_(spreadsheet, SALES_SHEET);
  const items = getOrCreateSheet_(spreadsheet, ITEMS_SHEET);
  getOrCreateSheet_(spreadsheet, DASHBOARD_SHEET);

  ensureHeaders_(sales, ["Satış ID", "Masa", "Açılış", "Kapanış", "Ödeme", "Not", "Toplam"]);
  ensureHeaders_(items, ["Satış ID", "Kapanış", "Masa", "Kategori", "Ürün", "Birim Fiyat", "Adet", "Satır Toplamı"]);
  [sales, items].forEach(function(sheet) {
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight("bold").setBackground("#2f4737").setFontColor("#ffffff");
    sheet.autoResizeColumns(1, sheet.getLastColumn());
  });
  refreshDashboard_();
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: "Avlu Sipariş" })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sale = JSON.parse(event.postData.contents);
    validateSale_(sale);
    const spreadsheet = SpreadsheetApp.getActive();
    const sales = getOrCreateSheet_(spreadsheet, SALES_SHEET);
    const items = getOrCreateSheet_(spreadsheet, ITEMS_SHEET);
    ensureHeaders_(sales, ["Satış ID", "Masa", "Açılış", "Kapanış", "Ödeme", "Not", "Toplam"]);
    ensureHeaders_(items, ["Satış ID", "Kapanış", "Masa", "Kategori", "Ürün", "Birim Fiyat", "Adet", "Satır Toplamı"]);

    if (saleExists_(sales, sale.saleId)) return json_({ ok: true, duplicate: true });

    const openedAt = sale.openedAt ? new Date(sale.openedAt) : "";
    const closedAt = new Date(sale.closedAt);
    sales.appendRow([sale.saleId, sale.tableNumber, openedAt, closedAt, sale.paymentMethod, safeCell_(sale.note), Number(sale.total)]);
    const itemRows = sale.items.map(function(item) {
      return [sale.saleId, closedAt, sale.tableNumber, safeCell_(item.category), safeCell_(item.name), Number(item.price), Number(item.quantity), Number(item.lineTotal)];
    });
    if (itemRows.length) items.getRange(items.getLastRow() + 1, 1, itemRows.length, itemRows[0].length).setValues(itemRows);
    refreshDashboard_();
    return json_({ ok: true, saleId: sale.saleId });
  } catch (error) {
    return json_({ ok: false, error: String(error.message || error) });
  } finally {
    lock.releaseLock();
  }
}

function refreshDashboard_() {
  const spreadsheet = SpreadsheetApp.getActive();
  const sales = getOrCreateSheet_(spreadsheet, SALES_SHEET);
  const items = getOrCreateSheet_(spreadsheet, ITEMS_SHEET);
  const dashboard = getOrCreateSheet_(spreadsheet, DASHBOARD_SHEET);
  const timeZone = spreadsheet.getSpreadsheetTimeZone() || "Europe/Istanbul";
  const saleRows = sales.getLastRow() > 1 ? sales.getRange(2, 1, sales.getLastRow() - 1, 7).getValues() : [];
  const itemRows = items.getLastRow() > 1 ? items.getRange(2, 1, items.getLastRow() - 1, 8).getValues() : [];

  const daily = {};
  const weekly = {};
  const monthly = {};
  saleRows.forEach(function(row) {
    const date = new Date(row[3]);
    const total = Number(row[6]) || 0;
    addMetric_(daily, Utilities.formatDate(date, timeZone, "yyyy-MM-dd"), total);
    addMetric_(weekly, weekKey_(date, timeZone), total);
    addMetric_(monthly, Utilities.formatDate(date, timeZone, "yyyy-MM"), total);
  });

  const products = {};
  itemRows.forEach(function(row) {
    const name = String(row[4]);
    if (!products[name]) products[name] = { quantity: 0, revenue: 0 };
    products[name].quantity += Number(row[6]) || 0;
    products[name].revenue += Number(row[7]) || 0;
  });

  dashboard.clear();
  dashboard.getRange("A1").setValue("AVLU SATIŞ ÖZETİ").setFontSize(18).setFontWeight("bold").setFontColor("#2f4737");
  dashboard.getRange("A3:C3").setValues([["Gün", "Hesap", "Ciro"]]);
  writeMetric_(dashboard, 4, daily);
  dashboard.getRange("E3:G3").setValues([["Hafta", "Hesap", "Ciro"]]);
  writeMetric_(dashboard, 4, weekly, 5);
  dashboard.getRange("I3:K3").setValues([["Ay", "Hesap", "Ciro"]]);
  writeMetric_(dashboard, 4, monthly, 9);

  dashboard.getRange("A38:C38").setValues([["Ürün", "Satılan Adet", "Ciro"]]);
  const productValues = Object.keys(products).map(function(name) { return [name, products[name].quantity, products[name].revenue]; });
  productValues.sort(function(a, b) { return b[2] - a[2]; });
  if (productValues.length) dashboard.getRange(39, 1, productValues.length, 3).setValues(productValues);

  ["A3:C3", "E3:G3", "I3:K3", "A38:C38"].forEach(function(a1) {
    dashboard.getRange(a1).setFontWeight("bold").setBackground("#2f4737").setFontColor("#ffffff");
  });
  dashboard.getRange("C4:C1000").setNumberFormat("₺#,##0.00");
  dashboard.getRange("G4:G1000").setNumberFormat("₺#,##0.00");
  dashboard.getRange("K4:K1000").setNumberFormat("₺#,##0.00");
  dashboard.autoResizeColumns(1, 11);
  dashboard.setFrozenRows(3);
}

function addMetric_(target, key, revenue) {
  if (!target[key]) target[key] = { count: 0, revenue: 0 };
  target[key].count += 1;
  target[key].revenue += revenue;
}

function writeMetric_(sheet, startRow, metrics, startColumn) {
  startColumn = startColumn || 1;
  const values = Object.keys(metrics).sort().reverse().slice(0, 31).map(function(key) {
    return [key, metrics[key].count, metrics[key].revenue];
  });
  if (values.length) sheet.getRange(startRow, startColumn, values.length, 3).setValues(values);
}

function weekKey_(date, timeZone) {
  const local = new Date(Utilities.formatDate(date, timeZone, "yyyy/MM/dd HH:mm:ss"));
  const day = (local.getDay() + 6) % 7;
  local.setDate(local.getDate() - day);
  return Utilities.formatDate(local, timeZone, "yyyy-MM-dd") + " haftası";
}

function validateSale_(sale) {
  if (!sale || !sale.saleId || !sale.closedAt || !Array.isArray(sale.items)) throw new Error("Eksik satış kaydı");
  if (!Number.isFinite(Number(sale.total)) || Number(sale.total) < 0) throw new Error("Geçersiz toplam");
}

function saleExists_(sheet, saleId) {
  if (sheet.getLastRow() < 2) return false;
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(String(saleId)).matchEntireCell(true).findNext() !== null;
}

function safeCell_(value) {
  const text = String(value || "");
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function getOrCreateSheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
