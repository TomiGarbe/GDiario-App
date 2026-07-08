const MOVEMENTS_SHEET_NAME = "MOVEMENTS";
const MOVEMENTS_HEADERS = ["id", "type", "date", "amount", "description", "updated_at", "source"];
const MOVEMENTS_HEADER_INDEX = _indexHeaders(MOVEMENTS_HEADERS);

function readMovements() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MOVEMENTS_SHEET_NAME);
  if (!sheet) {
    throw new Error("No existe la hoja MOVEMENTS. Hace un fetch primero.");
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow === 0 || lastCol === 0) {
    sheet.clear();
    sheet.getRange(1, 1, 1, MOVEMENTS_HEADERS.length).setValues([MOVEMENTS_HEADERS]);
    aplicarFormatoHojaPorNombre(sheet);
    return [];
  }

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = _normalizeHeaders(values[0] || []);

  if (_headersMatchExact(headers, MOVEMENTS_HEADERS)) {
    return _rowsToMovementObjects(values.slice(1), MOVEMENTS_HEADER_INDEX);
  }

  if (_isMigratableLegacyMovementsSchema(headers)) {
    const migrated = _migrateLegacyMovements(values.slice(1), headers);
    writeMovements(migrated);
    return migrated;
  }

  throw new Error("Invalid MOVEMENTS schema. Expected: [id,type,date,amount,description,updated_at,source]");
}

function writeMovements(rows) {
  const sheet = _getOrCreateSheet(MOVEMENTS_SHEET_NAME);
  const normalized = _normalizeMovementRows(rows, "manual");
  const dataRows = normalized.map(_movementToSheetRow);

  sheet.clear();
  sheet.getRange(1, 1, 1, MOVEMENTS_HEADERS.length).setValues([MOVEMENTS_HEADERS]);

  if (dataRows.length > 0) {
    sheet.getRange(2, 1, dataRows.length, MOVEMENTS_HEADERS.length).setValues(dataRows);
  }

  aplicarFormatoHojaPorNombre(sheet);
}

function upsertMovements(rows) {
  const sheet = _getOrCreateSheet(MOVEMENTS_SHEET_NAME);
  _ensureMovementsSchema(sheet);
  const current = sheet.getDataRange().getValues();
  const existingData = current.length > 1 ? current.slice(1) : [];
  const byId = {};
  existingData.forEach((row, idx) => {
    const id = String(row[MOVEMENTS_HEADER_INDEX.id] || "").trim();
    if (id) byId[id] = idx + 2;
  });

  const normalized = _normalizeMovementRows(rows, "app-entrega");
  normalized.forEach((movement) => {
    const movementId = String(movement.id || "").trim();
    if (!movementId) return;
    const rowValues = _movementToSheetRow(movement);
    const rowNumber = byId[movementId];
    if (rowNumber) {
      sheet.getRange(rowNumber, 1, 1, MOVEMENTS_HEADERS.length).setValues([rowValues]);
    } else {
      const appendRow = sheet.getLastRow() + 1;
      sheet.getRange(appendRow, 1, 1, MOVEMENTS_HEADERS.length).setValues([rowValues]);
      byId[movementId] = appendRow;
    }
  });
  aplicarFormatoHojaPorNombre(sheet);
}

function reconcileMovements(rows) {
  const sheet = _getOrCreateSheet(MOVEMENTS_SHEET_NAME);
  _ensureMovementsSchema(sheet);
  const normalized = _normalizeMovementRows(rows, "manual");
  const dataRows = normalized.map(_movementToSheetRow);
  const allRows = [MOVEMENTS_HEADERS].concat(dataRows);

  sheet.clearContents();
  sheet.getRange(1, 1, allRows.length, MOVEMENTS_HEADERS.length).setValues(allRows);

  aplicarFormatoHojaPorNombre(sheet);
}

function deleteMovementsByIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const sheet = _getOrCreateSheet(MOVEMENTS_SHEET_NAME);
  _ensureMovementsSchema(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;

  const idSet = {};
  ids.forEach((id) => {
    const key = String(id || "").trim();
    if (key) idSet[key] = true;
  });

  const keepRows = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    const rowId = String(values[i][MOVEMENTS_HEADER_INDEX.id] || "").trim();
    if (!idSet[rowId]) keepRows.push(values[i]);
  }

  sheet.clear();
  sheet.getRange(1, 1, keepRows.length, MOVEMENTS_HEADERS.length).setValues(keepRows);
  aplicarFormatoHojaPorNombre(sheet);
}

function appendMovements(rows) {
  const sheet = _getOrCreateSheet(MOVEMENTS_SHEET_NAME);
  _ensureMovementsSchema(sheet);

  const normalized = _normalizeMovementRows(rows, "manual");
  if (!normalized.length) return;

  const dataRows = normalized.map(_movementToSheetRow);
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, dataRows.length, MOVEMENTS_HEADERS.length).setValues(dataRows);
  aplicarFormatoHojaPorNombre(sheet);
}

function clearMovements() {
  const sheet = _getOrCreateSheet(MOVEMENTS_SHEET_NAME);
  sheet.clear();
  sheet.getRange(1, 1, 1, MOVEMENTS_HEADERS.length).setValues([MOVEMENTS_HEADERS]);
  aplicarFormatoHojaPorNombre(sheet);
}

function _normalizeMovementRows(rows, defaultSource) {
  return (rows || []).map((row) => ({
    id: row && row.id !== undefined ? row.id : "",
    type: row && row.type !== undefined ? row.type : "",
    date: row && row.date !== undefined ? row.date : "",
    amount: row && row.amount !== undefined ? row.amount : "",
    description: row && row.description !== undefined ? row.description : "",
    updated_at: row && row.updated_at !== undefined ? row.updated_at : "",
    source: row && row.source !== undefined ? row.source : defaultSource
  }));
}

function _movementToSheetRow(row) {
  return MOVEMENTS_HEADERS.map((header) => row[header] ?? "");
}

function _rowsToMovementObjects(rows, headerIndex) {
  return (rows || [])
    .map((row) => mapHeaders(row, headerIndex))
    .filter((mapped) => _hasAnyMovementValue(mapped));
}

function _isMigratableLegacyMovementsSchema(headers) {
  if (!Array.isArray(headers) || headers.length === 0) return false;

  const legacySet = {
    id: true,
    type: true,
    date: true,
    amount: true,
    description: true,
    source: true,
    updated_at: true,
    client: true,
    employee: true
  };

  const hasRequired = ["id", "type", "date", "amount", "description"].every((h) => headers.indexOf(h) !== -1);
  if (!hasRequired) return false;

  return headers.every((h) => legacySet[h] === true);
}

function _migrateLegacyMovements(rows, headers) {
  const headerIndex = _indexHeaders(headers);

  return (rows || [])
    .map((row) => ({
      id: row[headerIndex.id] ?? "",
      type: row[headerIndex.type] ?? "",
      date: row[headerIndex.date] ?? "",
      amount: row[headerIndex.amount] ?? "",
      description: row[headerIndex.description] ?? "",
      updated_at: headerIndex.updated_at !== undefined ? (row[headerIndex.updated_at] ?? "") : "",
      source: headerIndex.source !== undefined ? (row[headerIndex.source] ?? "legacy") : "legacy"
    }))
    .filter((mapped) => _hasAnyMovementValue(mapped));
}

function mapHeaders(row, headerIndex) {
  return {
    id: row[headerIndex.id] ?? "",
    type: row[headerIndex.type] ?? "",
    date: row[headerIndex.date] ?? "",
    amount: row[headerIndex.amount] ?? "",
    description: row[headerIndex.description] ?? "",
    updated_at: row[headerIndex.updated_at] ?? "",
    source: row[headerIndex.source] ?? "legacy"
  };
}

function _hasAnyMovementValue(row) {
  return MOVEMENTS_HEADERS.some((key) => {
    const value = row[key];
    return value !== "" && value !== null && value !== undefined;
  });
}

function _headersMatchExact(headers, expected) {
  if (headers.length !== expected.length) return false;
  return expected.every((header, idx) => headers[idx] === header);
}

function _normalizeHeaders(headers) {
  return (headers || []).map((h) => String(h || "").trim().toLowerCase());
}

function _indexHeaders(headers) {
  const out = {};
  headers.forEach((h, idx) => {
    out[h] = idx;
  });
  return out;
}

function _ensureMovementsSchema(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow === 0 || lastCol === 0) {
    sheet.getRange(1, 1, 1, MOVEMENTS_HEADERS.length).setValues([MOVEMENTS_HEADERS]);
    aplicarFormatoHojaPorNombre(sheet);
    return;
  }
  const headers = _normalizeHeaders(sheet.getRange(1, 1, 1, lastCol).getValues()[0] || []);
  if (_headersMatchExact(headers, MOVEMENTS_HEADERS)) return;
  if (_isMigratableLegacyMovementsSchema(headers)) {
    const migrated = readMovements();
    writeMovements(migrated);
    return;
  }
  throw new Error("Invalid MOVEMENTS schema. Expected: [id,type,date,amount,description,updated_at,source]");
}
