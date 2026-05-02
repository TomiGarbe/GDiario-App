const MOVEMENTS_SHEET_NAME = "MOVEMENTS";
const MOVEMENTS_HEADERS = ["id", "type", "date", "amount", "description", "source"];
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

  throw new Error("Invalid MOVEMENTS schema. Expected: [id,type,date,amount,description,source]");
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

  aplicarFormatoTablaGenerica(sheet, 2, [4]);
}

function appendMovements(rows) {
  const sheet = _getOrCreateSheet(MOVEMENTS_SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow === 0 || lastCol === 0) {
    sheet.getRange(1, 1, 1, MOVEMENTS_HEADERS.length).setValues([MOVEMENTS_HEADERS]);
  } else {
    const headers = _normalizeHeaders(sheet.getRange(1, 1, 1, lastCol).getValues()[0] || []);
    if (!_headersMatchExact(headers, MOVEMENTS_HEADERS)) {
      if (_isMigratableLegacyMovementsSchema(headers)) {
        const migrated = readMovements();
        writeMovements(migrated);
      } else {
        throw new Error("Invalid MOVEMENTS schema. Expected: [id,type,date,amount,description,source]");
      }
    }
  }

  const normalized = _normalizeMovementRows(rows, "manual");
  if (!normalized.length) return;

  const dataRows = normalized.map(_movementToSheetRow);
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, dataRows.length, MOVEMENTS_HEADERS.length).setValues(dataRows);
}

function clearMovements() {
  const sheet = _getOrCreateSheet(MOVEMENTS_SHEET_NAME);
  sheet.clear();
  sheet.getRange(1, 1, 1, MOVEMENTS_HEADERS.length).setValues([MOVEMENTS_HEADERS]);
}

function _normalizeMovementRows(rows, defaultSource) {
  return (rows || []).map((row) => ({
    id: row && row.id !== undefined ? row.id : "",
    type: row && row.type !== undefined ? row.type : "",
    date: row && row.date !== undefined ? row.date : "",
    amount: row && row.amount !== undefined ? row.amount : "",
    description: row && row.description !== undefined ? row.description : "",
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
