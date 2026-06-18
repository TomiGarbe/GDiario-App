const API_URL = "https://gdiario.azurewebsites.net/api";
const SYNC_API_KEY = "uLqPsLNQkdVJ3RlpJRMGJq6ePfSTFalLk-wH5j_tEUY";

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

function syncFromBackendToSheet() {
  const period = getPeriodPayload();
  const periodId = Number(period.year) * 100 + Number(period.month);
  Logger.log("SYNC FROM BACKEND iniciado. period_id=" + periodId);

  const exported = getFromBackend("/sync/full?period_id=" + encodeURIComponent(periodId));
  const movements = Array.isArray(exported && exported.movements) ? exported.movements : [];
  const movementItems = Array.isArray(exported && exported.movement_items) ? exported.movement_items : [];
  const movementSalaries = Array.isArray(exported && exported.movement_salaries) ? exported.movement_salaries : [];
  const movementClientPayments = Array.isArray(exported && exported.movement_client_payments)
    ? exported.movement_client_payments
    : [];

  reconcileMovements(movements.map((movement) => ({
    id: movement && movement.id,
    type: movement && movement.type,
    date: movement && movement.date,
    amount: syncNumber_(movement && movement.amount),
    description: movement && movement.description,
    updated_at: movement && movement.updated_at,
    source: movement && movement.source
  })));

  writeMovementItems(movementItems.map((item) => ({
    movement_id: item && item.movement_id,
    client: syncSheetText_(item && item.client_name),
    product: syncSheetText_(item && item.product_name),
    quantity: syncNumber_(item && item.quantity),
    unit_price: syncNumber_(item && item.unit_price),
    subtotal: syncNumber_(item && item.subtotal)
  })));

  writeMovementSalaries(movementSalaries.map((salary) => ({
    movement_id: salary && salary.movement_id,
    employee: syncSheetText_(salary && salary.employee_name),
    subtotal: syncNumber_(salary && salary.subtotal)
  })));

  writeMovementClientPayments(movementClientPayments.map((payment) => ({
    movement_id: payment && payment.movement_id,
    client_name: syncSheetText_(payment && payment.client_name),
    subtotal: syncNumber_(payment && payment.subtotal)
  })));

  syncOperationalSheetsFromExport({
    period: period,
    movements: movements,
    movementItems: movementItems,
    movementSalaries: movementSalaries,
    movementClientPayments: movementClientPayments
  });

  Logger.log(
    "SYNC FROM BACKEND finalizado. movements=%s items=%s salaries=%s client_payments=%s",
    movements.length,
    movementItems.length,
    movementSalaries.length,
    movementClientPayments.length
  );

  return {
    movements: movements.length,
    movement_items: movementItems.length,
    movement_salaries: movementSalaries.length,
    movement_client_payments: movementClientPayments.length
  };
}

function syncOperationalSheetsFromExport(data) {
  syncProductSheetFromExport("GRASA", data);
  syncProductSheetFromExport("HUESOS", data);
  syncCuentasFromExport(data);
  syncSueldosFromExport(data);
  syncGastosFromExport(data);
}

function syncProductSheetFromExport(sheetName, data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("No existe la hoja " + sheetName);
  }

  const values = sheet.getDataRange().getValues();
  if (!values.length) {
    throw new Error("La hoja " + sheetName + " no tiene encabezados");
  }

  const header = values[0] || [];
  const firstDateColumn = 3;
  const dateColumnCount = Math.max(0, header.length - 4);
  const dateColumnIndexByKey = {};

  for (let offset = 0; offset < dateColumnCount; offset += 1) {
    const absoluteColumn = firstDateColumn + offset;
    const key = syncDateKey_(header[absoluteColumn - 1]);
    if (!key) continue;
    dateColumnIndexByKey[key] = offset;
  }

  const rowMeta = [];
  const rowMetaByKey = {};
  let cordiezRows = 0;

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const client = String(values[rowIndex][0] == null ? "" : values[rowIndex][0]).trim();
    if (!client || esFilaExcluidaPorHoja(client, sheetName)) continue;

    const clientKey = syncUpperNoAccents_(client);
    let rowKey = clientKey;
    if (sheetName === "HUESOS" && clientKey === "CORDIEZ") {
      rowKey = "CORDIEZ|" + (cordiezRows === 0 ? "aserrin" : "huesos");
      cordiezRows += 1;
    }

    const meta = { rowNumber: rowIndex + 1, rowKey: rowKey };
    rowMeta.push(meta);
    rowMetaByKey[rowKey] = meta;
  }

  const movementById = {};
  (data.movements || []).forEach((movement) => {
    const id = String(movement && movement.id || "").trim();
    if (id) movementById[id] = movement;
  });

  const quantitiesByRowKey = {};
  const missingRows = {};
  const missingDates = {};

  (data.movementItems || []).forEach((item) => {
    const movementId = String(item && item.movement_id || "").trim();
    const movement = movementById[movementId];
    if (!movement) return;

    const movementType = String(movement && movement.type || "").trim().toLowerCase();
    if (movementType !== "compra" && movementType !== "venta") return;

    const clientName = syncSheetText_(item && item.client_name);
    const productName = String(item && item.product_name || "").trim();
    const dateKey = syncDateKey_(movement && movement.date);
    const quantity = syncNumber_(item && item.quantity);
    const variant = syncProductVariant_(productName);
    const targetSheet = variant === "grasa" ? "GRASA" : "HUESOS";
    if (targetSheet !== sheetName || !clientName || !dateKey || quantity === null) return;

    let rowKey = syncUpperNoAccents_(clientName);
    if (sheetName === "HUESOS" && rowKey === "CORDIEZ") {
      rowKey = "CORDIEZ|" + variant;
    }

    if (!rowMetaByKey[rowKey]) {
      missingRows[rowKey] = true;
      return;
    }
    if (dateColumnIndexByKey[dateKey] === undefined) {
      missingDates[dateKey] = true;
      return;
    }

    if (!quantitiesByRowKey[rowKey]) quantitiesByRowKey[rowKey] = {};
    quantitiesByRowKey[rowKey][dateKey] = (quantitiesByRowKey[rowKey][dateKey] || 0) + quantity;
  });

  if (Object.keys(missingRows).length) {
    throw new Error(
      "Faltan filas en " + sheetName + " para: " + Object.keys(missingRows).slice(0, 5).join(", ")
    );
  }
  if (Object.keys(missingDates).length) {
    throw new Error(
      "Faltan columnas de fecha en " + sheetName + " para: " + Object.keys(missingDates).slice(0, 5).join(", ")
    );
  }

  rowMeta.forEach((meta) => {
    const rowValues = new Array(dateColumnCount).fill("");
    const quantities = quantitiesByRowKey[meta.rowKey] || {};
    Object.keys(quantities).forEach((dateKey) => {
      const offset = dateColumnIndexByKey[dateKey];
      if (offset === undefined) return;
      rowValues[offset] = quantities[dateKey];
    });
    sheet.getRange(meta.rowNumber, firstDateColumn, 1, dateColumnCount).setValues([rowValues]);
  });
}

function syncCuentasFromExport(data) {
  const sheet = _getOrCreateSheet("CUENTAS");
  const values = sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : [];
  const headers = values.length ? values[0] : ["Fecha", "Cliente", "Concepto", "", "", "", "", "Debe", "Haber", "movement_id"];
  const keptRows = values.length > 1
    ? values.slice(1).filter((row) => syncLowerTrim_(row[2]) !== "pago de fabian")
    : [];

  const movementById = {};
  (data.movements || []).forEach((movement) => {
    const id = String(movement && movement.id || "").trim();
    if (id) movementById[id] = movement;
  });

  const appRows = (data.movementClientPayments || [])
    .map((payment) => {
      const movement = movementById[String(payment && payment.movement_id || "").trim()];
      if (!movement) return null;
      return [
        movement.date || "",
        syncSheetText_(payment && payment.client_name),
        "Pago de Fabian",
        "",
        "",
        "",
        "",
        "",
        syncNumber_(payment && payment.subtotal),
        payment && payment.movement_id || ""
      ];
    })
    .filter(Boolean)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));

  const finalRows = [padRow_(headers, 10)].concat(keptRows.map((row) => padRow_(row, 10)), appRows.map((row) => padRow_(row, 10)));
  sheet.clearContents();
  sheet.getRange(1, 1, finalRows.length, 10).setValues(finalRows);
}

function syncSueldosFromExport(data) {
  const sheet = _getOrCreateSheet("SUELDOS");
  const values = sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : [];
  const headers = values.length ? values[0] : ["Fecha", "Empleado", "Tipo", "Descripción", "Monto", "movement_id"];
  const keptRows = values.length > 1
    ? values.slice(1).filter((row) => {
      const tipo = syncLowerTrim_(row[2]);
      const concepto = syncLowerTrim_(row[3]);
      return tipo !== "adelanto" && concepto.indexOf("adelanto") === -1;
    })
    : [];

  const movementById = {};
  (data.movements || []).forEach((movement) => {
    const id = String(movement && movement.id || "").trim();
    if (id) movementById[id] = movement;
  });

  const appRows = (data.movementSalaries || [])
    .map((salary) => {
      const movement = movementById[String(salary && salary.movement_id || "").trim()];
      if (!movement) return null;
      return [
        movement.date || "",
        syncSheetText_(salary && salary.employee_name),
        "Adelanto",
        movement.description || "Adelanto",
        syncNumber_(salary && salary.subtotal),
        salary && salary.movement_id || ""
      ];
    })
    .filter(Boolean)
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));

  const finalRows = [padRow_(headers, 6)].concat(keptRows.map((row) => padRow_(row, 6)), appRows.map((row) => padRow_(row, 6)));
  sheet.clearContents();
  sheet.getRange(1, 1, finalRows.length, 6).setValues(finalRows);
}

function syncGastosFromExport(data) {
  const sheet = _getOrCreateSheet("GASTOS");
  const values = sheet.getLastRow() > 0 ? sheet.getDataRange().getValues() : [];
  const headers = values.length ? values[0] : ["Fecha", "Tipo", "Monto", "movement_id", "is_from_app"];

  let isFromAppIndex = headers.findIndex((header) => syncLowerTrim_(header) === "is_from_app");
  if (isFromAppIndex === -1) {
    isFromAppIndex = 4;
    headers[0] = headers[0] || "Fecha";
    headers[1] = headers[1] || "Tipo";
    headers[2] = headers[2] || "Monto";
    headers[3] = headers[3] || "movement_id";
    headers[4] = "is_from_app";
  }

  const normalizedHeaders = padRow_(headers, Math.max(headers.length, 5));
  const keptRows = values.length > 1
    ? values.slice(1).filter((row) => !syncIsTrue_(row[isFromAppIndex]))
    : [];

  const appRows = (data.movements || [])
    .filter((movement) => String(movement && movement.type || "").trim().toLowerCase() === "gasto")
    .map((movement) => {
      const row = new Array(normalizedHeaders.length).fill("");
      row[0] = movement.date || "";
      row[1] = movement.description || "Gasto";
      row[2] = syncNumber_(movement && movement.amount);
      row[3] = movement.id || "";
      row[isFromAppIndex] = true;
      return row;
    })
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));

  const finalRows = [normalizedHeaders]
    .concat(keptRows.map((row) => padRow_(row, normalizedHeaders.length)))
    .concat(appRows.map((row) => padRow_(row, normalizedHeaders.length)));
  sheet.clearContents();
  sheet.getRange(1, 1, finalRows.length, normalizedHeaders.length).setValues(finalRows);
}

function syncProductVariant_(productName) {
  const normalized = syncLowerNoAccents_(productName);
  if (normalized.indexOf("aserrin") !== -1) return "aserrin";
  if (normalized.indexOf("hueso") !== -1) return "huesos";
  return "grasa";
}

function syncSheetText_(value) {
  return String(value == null ? "" : value).trim().toUpperCase();
}

function syncDateKey_(value) {
  if (value == null || value === "") return "";
  if (typeof formatDate === "function") {
    const formatted = formatDate(value);
    if (formatted) return formatted;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function syncNumber_(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function syncLowerTrim_(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function syncLowerNoAccents_(value) {
  return syncUpperNoAccents_(value).toLowerCase();
}

function syncUpperNoAccents_(value) {
  return String(value == null ? "" : value)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function syncIsTrue_(value) {
  const text = syncLowerTrim_(value);
  return text === "true" || text === "1" || text === "si" || text === "sí";
}

function padRow_(row, width) {
  const out = Array.isArray(row) ? row.slice(0, width) : [];
  while (out.length < width) out.push("");
  return out;
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const period = getPeriodPayload();
  const periodId = Number(period.year) * 100 + Number(period.month);
  const sheetId = ss.getId();
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

  const payload = {
    period: period,
    movements: movements
  };

  payload.sheet_id = sheetId;
  payload.period_id = periodId;
  return payload;
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
  return requestBackend("post", path, payload);
}

function getFromBackend(path) {
  return requestBackend("get", path);
}

function requestBackend(method, path, payload) {
  const options = {
    method: method,
    contentType: "application/json",
    headers: {
      "x-api-key": SYNC_API_KEY
    },
    muteHttpExceptions: true
  };
  if (payload !== undefined) {
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(API_URL + path, options);

  const code = response.getResponseCode();
  const body = response.getContentText();
  Logger.log("STATUS: " + code);
  Logger.log("BODY: " + body);

  if (code < 200 || code >= 300) {
    Logger.log("Error HTTP " + code + " en " + path + ": " + body);
    throw new Error("Error en " + path + ": HTTP " + code + " - " + body);
  }

  if (!body) return null;

  try {
    return JSON.parse(body);
  } catch (error) {
    return body;
  }
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

  if (!cleanText(payload.sheet_id)) {
    throw new Error("Payload principal inválido: sheet_id faltante");
  }

  if (!Number.isInteger(Number(payload.period_id))) {
    throw new Error("Payload principal inválido: period_id faltante o inválido");
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
  const date = parseDateAsLocal_(value);
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

  const isoLocal = parseIsoLocalDate_(text);
  if (isoLocal) return isoLocal;

  const parts = text.split("/");
  if (parts.length !== 3) {
    const fallback = parseDateAsLocal_(text);
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

function parseDateAsLocal_(value) {
  if (value instanceof Date) return value;
  const text = String(value == null ? "" : value).trim();
  const isoLocal = parseIsoLocalDate_(text);
  if (isoLocal) return isoLocal;
  return new Date(text);
}

function parseIsoLocalDate_(text) {
  const match = String(text || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
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
