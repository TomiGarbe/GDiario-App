function writeMovements(movements) {
  const sheet = _getOrCreateSheet("MOVEMENTS");
  sheet.clear();
  sheet.appendRow(["id", "date", "type", "client", "employee", "amount", "description", "source"]);

  if (movements?.length) {
    const rows = movements.map(m => [
      m.id ?? "",   // vacío si es nuevo, UUID si vino de la DB
      m.date, m.type, m.client, m.employee, m.amount, m.description, m.source ?? ""
    ]);
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }

  aplicarFormatoTablaGenerica(sheet, 2, [6]);
}

function writeMovementDetails(details) {
  const sheet = _getOrCreateSheet("MOVEMENT_DETAILS");
  sheet.clear();
  sheet.appendRow(["id", "movement_id", "type", "product", "employee", "quantity", "unit_price", "subtotal"]);

  if (details?.length) {
    const rows = details.map(d => [
      d.id ?? "",
      d.movement_id ?? "",  // vacío si el movement es nuevo
      d.type, d.product, d.employee, d.quantity, d.unit_price, d.subtotal
    ]);
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }

  aplicarFormatoTablaGenerica(sheet, 0, [7, 8]);
}

function readMovementsSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("MOVEMENTS");
  if (!sheet) throw new Error("No existe la hoja MOVEMENTS. Hacé un fetch primero.");

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