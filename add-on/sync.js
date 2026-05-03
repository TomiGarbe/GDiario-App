const API_URL = "https://gdiario-app.onrender.com/api";

const MOVEMENT_TYPE_TO_BACKEND = {
  "compra": "compra",
  "venta": "venta",
  "gasto": "gasto",
  "sueldo": "sueldo",
  "pago": "pago_cliente",
  "pago cliente": "pago_cliente",
  "pago_cliente": "pago_cliente",
  "entrega": "entrega_dinero",
  "entrega dinero": "entrega_dinero",
  "entrega_dinero": "entrega_dinero"
};

function syncToBackend() {
  try {
    Logger.log("SYNC iniciado");

    const movementsRows = getSheetData("MOVEMENTS");
    const itemsRows = getSheetData("ITEMS");
    const salariesRows = getSheetData("SALARIES");
    const clientPaymentsRows = getSheetData("CLIENT_PAYMENTS");
    const pricesRows = getSheetData("PRECIOS");

    const movementsById = buildMovements(movementsRows);
    attachItems(movementsById, itemsRows);
    attachSalaries(movementsById, salariesRows);
    attachClientPayments(movementsById, clientPaymentsRows);

    const payloadFull = buildMainPayload(movementsById);
    const payloadPrices = buildPrices(pricesRows);
    const payloadClients = buildClients(pricesRows, itemsRows, clientPaymentsRows);

    validateMainPayload(payloadFull);
    validatePricesPayload(payloadPrices);
    validateClientsPayload(payloadClients);

    const clientsResponse = sendClients(payloadClients);
    Logger.log("Sync clients OK");

    const pricesResponse = sendToBackend("/sync/prices", payloadPrices);
    Logger.log("Sync prices OK");

    const fullResponse = sendToBackend("/sync/full", payloadFull);
    Logger.log("Sync movements OK");

    Logger.log("SYNC finalizado");
    Logger.log("/sync/clients response: " + clientsResponse);
    Logger.log("/sync/full response: " + fullResponse);
    Logger.log("/sync/prices response: " + pricesResponse);
  } catch (error) {
    Logger.log("SYNC error: " + error.message);
    throw error;
  }
}

function getSheetData(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("No existe la hoja " + sheetName);
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = normalizeHeaders(values[0] || []);

  return values
    .slice(1)
    .map((row, index) => rowToObject(headers, row, index + 2))
    .filter((row) => !isEmptyDataRow(row));
}

function buildMovements(rows) {
  const movementsById = {};

  (rows || []).forEach((row) => {
    const externalId = cleanText(row.id);
    if (!externalId) return;

    const movementType = normalizeMovementType(row.type);
    const movementDate = formatDate(row.date);
    const movementAmount = parseNumber(row.amount);
    const movementDescription = cleanText(row.description) || "";

    if (!movementType || !movementDate || movementAmount === null) {
      throw new Error("MOVEMENTS fila invalida: id=" + externalId + ", row=" + (row._row_number || "?"));
    }

    if (!movementsById[externalId]) {
      movementsById[externalId] = {
        external_id: externalId,
        type: movementType,
        date: movementDate,
        amount: movementAmount,
        description: movementDescription,
        items: [],
        salaries: [],
        client_payments: [],
        _keys: {
          items: {},
          salaries: {},
          client_payments: {}
        }
      };
    }
  });

  return movementsById;
}

function attachItems(movementsById, rows) {
  (rows || []).forEach((row) => {
    const movementId = cleanText(row.movement_id);
    const movement = movementId ? movementsById[movementId] : null;
    if (!movement) return;

    const clientName = normalizeName(row.client);
    const productName = normalizeName(row.product);
    const quantity = parseNumber(row.quantity);
    const unitPrice = parseNumber(row.unit_price);
    const subtotal = parseNumber(row.subtotal);

    if (!clientName || !productName || quantity === null || unitPrice === null || subtotal === null) {
      throw new Error("ITEMS fila invalida: movement_id=" + movementId + ", row=" + (row._row_number || "?"));
    }

    const dedupeKey = [clientName, productName, quantity, unitPrice, subtotal].join("|");
    if (movement._keys.items[dedupeKey]) return;

    movement._keys.items[dedupeKey] = true;
    movement.items.push({
      client_name: clientName,
      product_name: productName,
      quantity: quantity,
      unit_price: unitPrice,
      subtotal: subtotal
    });
  });
}

function attachSalaries(movementsById, rows) {
  (rows || []).forEach((row) => {
    const movementId = cleanText(row.movement_id);
    const movement = movementId ? movementsById[movementId] : null;
    if (!movement) return;

    const employeeName = normalizeName(row.employee);
    const subtotal = parseNumber(row.subtotal);

    if (!employeeName || subtotal === null) {
      throw new Error("SALARIES fila invalida: movement_id=" + movementId + ", row=" + (row._row_number || "?"));
    }

    const dedupeKey = [employeeName, subtotal].join("|");
    if (movement._keys.salaries[dedupeKey]) return;

    movement._keys.salaries[dedupeKey] = true;
    movement.salaries.push({
      employee_name: employeeName,
      subtotal: subtotal
    });
  });
}

function attachClientPayments(movementsById, rows) {
  (rows || []).forEach((row) => {
    const movementId = cleanText(row.movement_id);
    const movement = movementId ? movementsById[movementId] : null;
    if (!movement) return;

    const clientName = normalizeName(row.client_name || row.client);
    const subtotal = parseNumber(row.subtotal);

    if (!clientName || subtotal === null) {
      throw new Error("CLIENT_PAYMENTS fila invalida: movement_id=" + movementId + ", row=" + (row._row_number || "?"));
    }

    const dedupeKey = [clientName, subtotal].join("|");
    if (movement._keys.client_payments[dedupeKey]) return;

    movement._keys.client_payments[dedupeKey] = true;
    movement.client_payments.push({
      client_name: clientName,
      subtotal: subtotal
    });
  });
}

function buildMainPayload(movementsById) {
  const period = getPeriodPayload();
  const movements = Object.keys(movementsById)
    .map((key) => movementsById[key])
    .map((movement) => {
      let movementAmount = round4(movement.amount);
      if (movement.type === "pago_cliente") {
        movementAmount = round4(
          (movement.client_payments || []).reduce((acc, payment) => {
            return acc + Number(payment && payment.subtotal ? payment.subtotal : 0);
          }, 0)
        );
      }

      Logger.log(
        "[SYNC PAYLOAD] movement_id=%s type=%s amount=%s client_payments=%s",
        movement.external_id,
        movement.type,
        movementAmount,
        (movement.client_payments || []).length
      );

      return {
        external_id: movement.external_id,
        type: movement.type,
        date: movement.date,
        amount: movementAmount,
        description: movement.description,
        items: (movement.items || []).map((item) => ({
          client_name: item.client_name,
          product_name: item.product_name,
          quantity: round4(item.quantity),
          unit_price: round4(item.unit_price),
          subtotal: round4(item.subtotal)
        })),
        salaries: (movement.salaries || []).map((salary) => ({
          employee_name: salary.employee_name,
          subtotal: round4(salary.subtotal)
        })),
        client_payments: (movement.client_payments || []).map((payment) => ({
          client_name: payment.client_name,
          subtotal: round4(payment.subtotal)
        }))
      };
    });

  Logger.log("Payload principal armado. movements=" + movements.length);

  return {
    period: period,
    movements: movements
  };
}

function buildPrices(rows) {
  const seen = {};
  const prices = [];

  (rows || []).forEach((row, i) => {
    Logger.log({
      row: i + 1,
      keys: Object.keys(row || {}),
      raw: row
    });

    const clienteRaw = firstDefinedValue(
      getField(row, "cliente"),
      getField(row, "client"),
      getField(row, "client_name")
    );
    const productoRaw = firstDefinedValue(
      getField(row, "producto"),
      getField(row, "product"),
      getField(row, "product_name")
    );
    const fechaRaw = firstDefinedValue(
      getField(row, "fecha desde"),
      getField(row, "start_date"),
      getField(row, "fecha_inicio"),
      getField(row, "date"),
      getField(row, "fecha")
    );
    const precioRaw = firstDefinedValue(
      getField(row, "precio"),
      getField(row, "price"),
      getField(row, "unit_price")
    );

    const clientName = normalizeName(clienteRaw);
    const productName = normalizeName(productoRaw);
    const rawPrice = precioRaw;
    const price = parseNumber(rawPrice);
    const date = parseFecha(fechaRaw);
    const startDate = formatDate(date);

    if (!clientName || !productName) {
      Logger.log("⚠️ PRECIOS cliente/producto inválido: row=" + (row._row_number || "?"));
      throw new Error("PRECIOS fila invalida: row=" + (row._row_number || "?"));
    }

    if (!date) {
      Logger.log("⚠️ PRECIOS fecha inválida: row=" + (row._row_number || "?") + ", valor=" + fechaRaw);
      throw new Error("PRECIOS fila invalida: row=" + (row._row_number || "?"));
    }

    if (price === null || price < 0) {
      Logger.log("⚠️ PRECIOS precio inválido: row=" + (row._row_number || "?") + ", valor=" + rawPrice);
      throw new Error("PRECIOS fila invalida: row=" + (row._row_number || "?"));
    }

    const key = [clientName, productName, price, startDate].join("|");
    if (seen[key]) return;
    seen[key] = true;

    prices.push({
      client_name: clientName,
      product_name: productName,
      price: round4(price),
      start_date: startDate
    });
  });

  Logger.log("Payload precios armado. prices=" + prices.length);

  return { prices: prices };
}

function buildClients(pricesRows, itemsRows, clientPaymentsRows) {
  const names = extractUniqueClients(pricesRows, itemsRows, clientPaymentsRows);
  return {
    clients: names.map((name) => ({ name: name }))
  };
}

function extractUniqueClients(pricesRows, itemsRows, clientPaymentsRows) {
  const byNormalized = {};
  const out = [];

  const addName = function (rawValue) {
    const normalized = normalizeName(rawValue);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (byNormalized[key]) return;
    byNormalized[key] = true;
    out.push(normalized);
  };

  (pricesRows || []).forEach((row) => addName(row.client || row.cliente || row.client_name));
  (itemsRows || []).forEach((row) => addName(row.client || row.cliente || row.client_name));
  (clientPaymentsRows || []).forEach((row) => addName(row.client_name || row.client || row.cliente));

  return out;
}

function sendClients(payloadClients) {
  return sendToBackend("/sync/clients", payloadClients);
}

function sendToBackend(path, payload) {
  const response = UrlFetchApp.fetch(API_URL + path, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code < 200 || code >= 300) {
    Logger.log("Error HTTP " + code + " en " + path + ": " + body);
    throw new Error("Error en " + path + ": HTTP " + code + " - " + body);
  }

  return body;
}

function getPeriodPayload() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const parsed = parsearNombreArchivo(ss);

  const year = Number(parsed && parsed.anio);
  const month = Number(parsed && parsed.mesIndex) + 1;
  const rawName = [parsed && parsed.mes, parsed && parsed.anio].filter(Boolean).join(" ");
  const name = cleanText(rawName) || ss.getName();

  if (!Number.isInteger(year) || year < 1900 || year > 3000) {
    throw new Error("No se pudo inferir period.year desde el nombre del archivo");
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("No se pudo inferir period.month desde el nombre del archivo");
  }

  return {
    year: year,
    month: month,
    name: name
  };
}

function validateMainPayload(payload) {
  if (!payload || !payload.period || !Array.isArray(payload.movements)) {
    throw new Error("Payload principal inválido");
  }

  payload.movements.forEach((movement, idx) => {
    if (!cleanText(movement.external_id)) throw new Error("movements[" + idx + "].external_id faltante");
    if (!cleanText(movement.type)) throw new Error("movements[" + idx + "].type faltante");
    if (!formatDate(movement.date)) throw new Error("movements[" + idx + "].date inválida");
    if (parseNumber(movement.amount) === null) throw new Error("movements[" + idx + "].amount inválido");
  });
}

function validatePricesPayload(payload) {
  if (!payload || !Array.isArray(payload.prices)) {
    throw new Error("Payload de precios inválido");
  }

  payload.prices.forEach((priceRow, idx) => {
    if (!cleanText(priceRow.client_name)) throw new Error("prices[" + idx + "].client_name faltante");
    if (!cleanText(priceRow.product_name)) throw new Error("prices[" + idx + "].product_name faltante");
    if (parseNumber(priceRow.price) === null) throw new Error("prices[" + idx + "].price inválido");
    if (!formatDate(priceRow.start_date)) throw new Error("prices[" + idx + "].start_date inválida");
  });
}

function validateClientsPayload(payload) {
  if (!payload || !Array.isArray(payload.clients)) {
    throw new Error("Payload de clientes inválido");
  }

  payload.clients.forEach((row, idx) => {
    if (!cleanText(row && row.name)) throw new Error("clients[" + idx + "].name faltante");
  });
}

function normalizeHeaders(headers) {
  return (headers || []).map((header) => cleanText(header || "").toLowerCase());
}

function rowToObject(headers, row, rowNumber) {
  const obj = { _row_number: rowNumber };
  headers.forEach((header, index) => {
    if (!header) return;
    obj[header] = row[index];
  });
  return obj;
}

function isEmptyDataRow(row) {
  const keys = Object.keys(row || {}).filter((key) => key !== "_row_number");
  return keys.every((key) => {
    const value = row[key];
    return value === null || value === undefined || String(value).trim() === "";
  });
}

function formatDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return null;
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function firstDefinedValue() {
  for (let i = 0; i < arguments.length; i += 1) {
    const value = arguments[i];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text ? text : null;
}

function normalizeFieldName(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, " ");
}

function getField(row, fieldName) {
  if (!row || !fieldName) return null;
  const target = normalizeFieldName(fieldName);
  const key = Object.keys(row).find((k) => normalizeFieldName(k) === target);
  return key ? row[key] : null;
}

function normalizeName(value) {
  if (value === null || value === undefined) return "";
  return value.toString().trim().toLowerCase();
}

function parseFecha(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  const text = String(value).trim();
  if (!text) return null;

  const parts = text.split("/");
  if (parts.length !== 3) {
    const fallback = new Date(text);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);

  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) return null;

  // Evita overflow de fechas inválidas (ej: 32/01/2026).
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

function round4(value) {
  if (value === null || value === undefined) return 0;
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 10000) / 10000;
}

function normalizeMovementType(value) {
  const clean = cleanText(value);
  if (!clean) return null;
  const key = clean.toLowerCase();
  return MOVEMENT_TYPE_TO_BACKEND[key] || key;
}
