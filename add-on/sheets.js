function ensureMovementItemsSheet() {
  return _ensureSheetWithHeaders("ITEMS", ["movement_id", "client", "product", "quantity", "unit_price", "subtotal"]);
}

function ensureMovementSalariesSheet() {
  return _ensureSheetWithHeaders("SALARIES", ["movement_id", "employee", "subtotal"]);
}

function ensureMovementClientPaymentsSheet() {
  return _ensureSheetWithHeaders("CLIENT_PAYMENTS", ["movement_id", "client_name", "subtotal"]);
}

function writeMovementItems(items) {
  const headers = ["movement_id", "client", "product", "quantity", "unit_price", "subtotal"];
  const sheet = _writeSheetRows("ITEMS", headers, items, (item) => [
    item.movement_id ?? "",
    item.client ?? "",
    item.product ?? "",
    item.quantity ?? "",
    item.unit_price ?? "",
    item.subtotal ?? ""
  ]);

  aplicarFormatoTablaGenerica(sheet, 0, [4, 5, 6]);
}

function writeMovementSalaries(salaries) {
  const headers = ["movement_id", "employee", "subtotal"];
  const sheet = _writeSheetRows("SALARIES", headers, salaries, (salary) => [
    salary.movement_id ?? "",
    salary.employee ?? "",
    salary.subtotal ?? ""
  ]);

  aplicarFormatoTablaGenerica(sheet, 0, [3]);
}

function writeMovementClientPayments(clientPayments) {
  const headers = ["movement_id", "client_name", "subtotal"];
  const sheet = _writeSheetRows("CLIENT_PAYMENTS", headers, clientPayments, (payment) => [
    payment.movement_id ?? "",
    payment.client_name ?? "",
    payment.subtotal ?? ""
  ]);

  aplicarFormatoTablaGenerica(sheet, 0, [3]);
}

function _getOrCreateSheet(nombre) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(nombre) ?? ss.insertSheet(nombre);
}

function _ensureSheetWithHeaders(nombre, headers) {
  const sheet = _getOrCreateSheet(nombre);
  const firstRow = sheet.getLastRow() > 0 ? sheet.getRange(1, 1, 1, headers.length).getValues()[0] : [];
  const hasHeaders = headers.every((h, idx) => String(firstRow[idx] ?? "") === h);
  if (!hasHeaders) {
    sheet.clear();
    sheet.appendRow(headers);
  }
  return sheet;
}

function _writeSheetRows(nombre, headers, data, rowMapper) {
  const sheet = _getOrCreateSheet(nombre);
  sheet.clear();
  sheet.appendRow(headers);

  if (data?.length) {
    const rows = data.map(rowMapper);
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return sheet;
}
