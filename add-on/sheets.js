function writeMovements(movements) {
  const sheet = _getOrCreateSheet("MOVEMENTS");
  sheet.clear();

  const headers = ["id", "type", "date", "amount", "description"];
  sheet.appendRow(headers);

  const rows = (movements || []).map(m => [
    m.id,
    m.type,
    m.date,
    m.amount,
    m.description || ""
  ]);

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  aplicarFormatoTablaGenerica(sheet, 2, [4]);
}

function ensureMovementItemsSheet() {
  return _ensureSheetWithHeaders("MOVEMENT_ITEMS", ["movement_id", "client", "product", "quantity", "unit_price", "subtotal"]);
}

function ensureMovementSalariesSheet() {
  return _ensureSheetWithHeaders("MOVEMENT_SALARIES", ["movement_id", "employee", "subtotal"]);
}

function writeMovementItems(items) {
  const headers = ["movement_id", "client", "product", "quantity", "unit_price", "subtotal"];
  const sheet = _writeSheetRows("MOVEMENT_ITEMS", headers, items, (item) => [
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
  const sheet = _writeSheetRows("MOVEMENT_SALARIES", headers, salaries, (salary) => [
    salary.movement_id ?? "",
    salary.employee ?? "",
    salary.subtotal ?? ""
  ]);

  aplicarFormatoTablaGenerica(sheet, 0, [3]);
}

function readMovementsSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("MOVEMENTS");
  if (!sheet) throw new Error("No existe la hoja MOVEMENTS. Hace un fetch primero.");

  return sheet.getDataRange().getValues().slice(1).map(r => ({
    id:          r[0],
    date:        r[1],
    type:        r[2],
    client:      r[3],
    employee:    r[4],
    amount:      r[5],
    description: r[6],
    source:      r[7]
  }));
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
