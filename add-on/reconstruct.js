// ================================================================
// Reconstruct.js — Conversión entre hojas operativas y MOVEMENTS
// ================================================================

// ========================= RECONSTRUIR =========================

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENTES_SIN_MONTO_RECONSTRUCT = {
  "buenos dias": true,
  "cordiez": true,
  "mariano": true,
  "scurti": true,
  "oviedo": true,
  "almacor 35": true,
  "amanecer": true,
  "marcos": true,
  "nico": true,
  "refineria": true
};

function isValidUUID(value) {
  return UUID_V4_REGEX.test(value); 
}

function reconstruirMovimientos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const productos = procesarProductos(ss);
  const sueldos = procesarSueldos(ss);
  const gastos = procesarGastos(ss);
  const pagos = procesarPagosClientes(ss);

  const allMovements = [
    ...productos.movements,
    ...sueldos.movements,
    ...gastos.movements,
    ...pagos.movements
  ];
  const allItems = [...productos.movement_items];
  const allSalaries = [
    ...sueldos.movement_salaries
  ];
  const allClientPayments = [
    ...pagos.movement_client_payments
  ];

  Logger.log("Productos: " + productos.movements.length);
  Logger.log("Sueldos: " + sueldos.movements.length);
  Logger.log("Gastos: " + gastos.movements.length);
  Logger.log("Pagos: " + pagos.movements.length);

  return {
    movements: _deduplicateById(allMovements),
    movement_items: allItems,
    movement_salaries: allSalaries,
    movement_client_payments: allClientPayments
  };
}

// ========================= PARSERS =========================

function procesarProductos(ss) {
  const hojaPrecios = ss.getSheetByName("PRECIOS");
  const preciosData = hojaPrecios ? hojaPrecios.getDataRange().getValues().slice(1) : [];
  const pricesMap = _buildPricesMap(preciosData);

  const COL_INICIO = 2;
  const grupos = {};
  const productosMovementMap = _getOrCreateReconstructMap("productos_movements");
  const errors = [];

  const hojasOrigen = [
    { nombre: "GRASA", productoDefault: "Grasa" },
    { nombre: "HUESOS", productoDefault: "Huesos" }
  ];

  hojasOrigen.forEach(cfg => {
    const sheet = ss.getSheetByName(cfg.nombre);
    if (!sheet) return;

    const datos = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    const fechas = datos[0] || [];
    const filas = datos.slice(1);
    let aserrinCordiez = 0;

    filas.forEach(fila => {
      const cliente = normalizeName(fila[0]);
      const clienteUpper = String(cliente || "").toUpperCase();
      if (!cliente || esFilaExcluidaPorHoja(cliente, cfg.nombre)) {
        if (cliente) Logger.log("Fila ignorada: " + cliente);
        return;
      }

      const tipo = CLIENTES_VENTA.includes(clienteUpper) ? "Venta" : "Compra";

      let producto = cfg.productoDefault;
      if (cfg.nombre === "HUESOS" && clienteUpper === "CORDIEZ" && aserrinCordiez === 0) {
        aserrinCordiez = 1;
        producto = "Aserrin de hueso";
      }
      producto = normalizeName(producto);

      for (let col = COL_INICIO; col < fechas.length - 2; col++) {
        const fecha = fechas[col];
        const cantidad = _toNumber(fila[col]);
        if (!_isValidDate(fecha) || !_isValidNumber(cantidad) || cantidad === 0) continue;

        const clienteSinMonto = _esClienteSinMontoReconstruct(cliente);
        let unitPrice = getPrice({
          pricesMap,
          client_name: cliente,
          product_name: producto,
          date: fecha
        });

        if (clienteSinMonto) {
          unitPrice = 0;
        }

        if (unitPrice === null && !clienteSinMonto) {
          errors.push(`Missing price for client ${cliente}, product ${producto}, date ${_toDateKey(fecha)}`);
          continue;
        }
        if (!_isValidNumber(unitPrice) || unitPrice < 0) {
          errors.push(`Invalid price for client ${cliente}, product ${producto}, date ${_toDateKey(fecha)}: ${unitPrice}`);
          continue;
        }

        Logger.log(`Precio usado: ${cliente} - ${producto} - ${unitPrice}`);

        const subtotal = unitPrice * cantidad;
        if (!_isValidNumber(subtotal)) continue;
        if (!clienteSinMonto && subtotal <= 0) continue;
        const roundedSubtotal = Math.round(subtotal * 100) / 100;
        const expectedSubtotal = Math.round((cantidad * unitPrice) * 100) / 100;
        if (!clienteSinMonto && roundedSubtotal !== expectedSubtotal) {
          errors.push(`Subtotal mismatch for client ${cliente}, product ${producto}, date ${_toDateKey(fecha)}: subtotal=${roundedSubtotal} expected=${expectedSubtotal}`);
          continue;
        }

        const dateKey = _toDateKey(fecha);
        const groupKey = `${dateKey}|${cliente}|${tipo}`;
        if (!productosMovementMap[groupKey] || !_isUuidV4(productosMovementMap[groupKey])) {
          productosMovementMap[groupKey] = generateUUID();
        }
        const movementId = productosMovementMap[groupKey];

        if (!grupos[groupKey]) {
          grupos[groupKey] = {
            movement: {
              id: movementId,
              type: tipo,
              client: cliente,
              date: new Date(fecha),
              amount: 0,
              description: `${tipo} productos`
            },
            items: []
          };
        }

        grupos[groupKey].movement.amount += subtotal;
        grupos[groupKey].items.push({
          movement_id: movementId,
          client: cliente,
          product: producto,
          quantity: cantidad,
          unit_price: unitPrice,
          subtotal: roundedSubtotal
        });
      }
    });
  });

  const movements = [];
  const items = [];

  Object.values(grupos).forEach(g => {
    if (!_isValidNumber(g.movement.amount)) return;
    movements.push(g.movement);

    g.items.forEach(item => {
      if (!item.client || !item.product) return;
      if (!_isValidNumber(item.quantity) || !_isValidNumber(item.unit_price) || !_isValidNumber(item.subtotal)) return;
      items.push(item);
    });
  });

  if (errors.length) {
    throw new Error(`Validación de precios fallida:\n${errors.join("\n")}`);
  }
  _saveReconstructMaps();

  return { movements, movement_items: items, movement_salaries: [], movement_client_payments: [] };
}

function procesarSueldos(ss) {
  const sheet = ss.getSheetByName("SUELDOS");
  if (!sheet) return { movements: [], movement_items: [], movement_salaries: [], movement_client_payments: [] };

  const data = sheet.getDataRange().getValues();
  const movements = [];
  const salaries = [];
  let processed = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isEmptyRow(row)) continue;
    if (isSummaryRow(row)) continue;

    const date = row[0];
    const employee = normalizeName(row[1]);
    const tipo = _asCleanString(row[2]);
    const concepto = row[3];
    const amount = parseNumber(row[4]);

    if (!concepto || !concepto.toString().toLowerCase().includes("adelanto")) {
      continue;
    }
    if (!employee) continue;
    if (!isValidMovementRow({ date, amount })) continue;

    let id = _asCleanString(row[5]);
    if (!_isUuidV4(id)) {
      id = generateUUID();
      sheet.getRange(i + 1, 6).setValue(id);
    }

    movements.push({
      id,
      type: "Sueldo",
      date,
      amount,
      description: concepto || "Sueldo"
    });

    salaries.push({
      movement_id: id,
      employee,
      subtotal: amount
    });

    processed++;
  }

  Logger.log("Sueldos procesados: " + processed);
  return { movements, movement_items: [], movement_salaries: salaries, movement_client_payments: [] };
}

function procesarGastos(ss) {
  const sheet = ss.getSheetByName("GASTOS");
  if (!sheet) return { movements: [], movement_items: [], movement_salaries: [], movement_client_payments: [] };

  const data = sheet.getDataRange().getValues();
  const movements = [];
  let processed = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isEmptyRow(row)) continue;
    if (isSummaryRow(row)) continue;

    const date = row[0];
    const tipo = _asCleanString(row[1]);
    const amount = parseNumber(row[2]);

    if (!isValidMovementRow({ date, amount })) continue;

    let id = _asCleanString(row[3]);
    if (!_isUuidV4(id)) {
      id = generateUUID();
      sheet.getRange(i + 1, 4).setValue(id);
    }

    movements.push({
      id,
      type: "Gasto",
      date,
      amount,
      description: tipo
    });

    processed++;
  }

  Logger.log("Gastos procesados: " + processed);
  return { movements, movement_items: [], movement_salaries: [], movement_client_payments: [] };
}

function procesarPagosClientes(ss) {
  const sheet = ss.getSheetByName("CUENTAS");
  if (!sheet) return { movements: [], movement_items: [], movement_salaries: [], movement_client_payments: [] };

  const data = sheet.getDataRange().getValues();
  const movements = [];
  const clientPayments = [];
  let processed = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isEmptyRow(row)) continue;
    if (isSummaryRow(row)) continue;

    const date = row[0];
    const client = normalizeName(row[1]);
    const concepto = _asCleanString(row[2]);
    const haber = parseNumber(row[8]);

    if (concepto !== "Pago de Fabian") continue;
    if (!client) continue;
    if (!isValidMovementRow({ date, amount: haber })) continue;

    let id = _asCleanString(row[9]);
    if (!_isUuidV4(id)) {
      id = generateUUID();
      sheet.getRange(i + 1, 10).setValue(id);
    }

    movements.push({
      id,
      type: "Pago",
      client,
      date,
      amount: haber,
      description: concepto
    });

    clientPayments.push({
      movement_id: id,
      client_name: client,
      subtotal: haber
    });

    processed++;
  }

  Logger.log("Pagos procesados: " + processed);
  return { movements, movement_items: [], movement_salaries: [], movement_client_payments: clientPayments };
}

function _deduplicateById(movements) {
  const seen = {};
  const out = [];

  (movements || []).forEach(m => {
    const id = _asCleanString(m && m.id);
    if (!id || seen[id]) return;
    seen[id] = true;
    out.push(m);
  });

  return out;
}

// ========================= MERGE FINAL =========================

function _mergeFinal(allMovements, allMovementItems, allMovementSalaries) {
  const movementIds = {};
  const movements = [];

  allMovements.forEach(m => {
    const id = _asCleanString(m.id);
    if (!id || movementIds[id]) return;
    movementIds[id] = true;
    movements.push(m);
  });

  const itemKeys = {};
  const items = [];

  allMovementItems.forEach(it => {
    const movementId = _asCleanString(it.movement_id);
    if (!movementId || !movementIds[movementId]) return;

    const key = JSON.stringify([
      movementId,
      _asCleanString(it.client),
      _asCleanString(it.product),
      _toNumber(it.quantity),
      _toNumber(it.unit_price),
      _toNumber(it.subtotal)
    ]);

    if (itemKeys[key]) return;
    itemKeys[key] = true;

    const out = {
      movement_id: movementId,
      client: _asCleanString(it.client),
      subtotal: _toNumber(it.subtotal)
    };

    if (_asCleanString(it.product)) out.product = _asCleanString(it.product);
    if (_isValidNumber(_toNumber(it.quantity))) out.quantity = _toNumber(it.quantity);
    if (_isValidNumber(_toNumber(it.unit_price))) out.unit_price = _toNumber(it.unit_price);

    if (!out.client || !_isValidNumber(out.subtotal)) return;
    if (out.product && (!_isValidNumber(out.quantity) || !_isValidNumber(out.unit_price))) return;

    items.push(out);
  });

  const salaryKeys = {};
  const salaries = [];

  allMovementSalaries.forEach(s => {
    const movementId = _asCleanString(s.movement_id);
    const employee = _asCleanString(s.employee);
    const subtotal = _toNumber(s.subtotal);

    if (!movementId || !movementIds[movementId] || !employee || !_isValidNumber(subtotal)) return;

    const key = `${movementId}|${employee}|${subtotal}`;
    if (salaryKeys[key]) return;
    salaryKeys[key] = true;

    salaries.push({ movement_id: movementId, employee, subtotal });
  });

  return { movements, movement_items: items, movement_salaries: salaries, movement_client_payments: [] };
}

// ========================= HELPERS =========================

function isEmptyRow(row) {
  if (!Array.isArray(row) || row.length === 0) return true;
  return row.every(cell => cell === "" || cell === null || cell === undefined);
}

function isSummaryRow(row) {
  if (!Array.isArray(row)) return false;
  return row.some(cell =>
    typeof cell === "string" &&
    cell.toUpperCase().includes("TOTAL")
  );
}

function isValidMovementRow({ date, amount }) {
  if (!date) return false;
  if (amount === null || amount === undefined || amount === "") return false;
  const n = parseNumber(amount);
  if (!Number.isFinite(n)) return false;
  if (n <= 0) return false;
  return true;
}

function _parseRowWithOptionalId(row, dateIndexWithoutId) {
  const first = row[0];
  const hasId = !_isValidDate(first) && _asCleanString(first) !== "";
  const id = hasId ? first : "";
  const cells = hasId ? row.slice(1) : row.slice(0);
  const date = cells[dateIndexWithoutId];
  return { id, date, cells };
}

function _isValidDate(value) {
  return value instanceof Date && !isNaN(value.getTime());
}

function _toDateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function _toNumber(value) {
  const n = parseNumber(value);
  return Number.isFinite(n) ? n : NaN;
}

function _isValidNumber(value) {
  return Number.isFinite(value);
}

function _asCleanString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function _buildPricesMap(preciosData) {
  const out = {};
  (preciosData || []).forEach((fila) => {
    // PRECIOS: Cliente | Producto | Fecha Desde | Precio
    const clientName = normalizeName(fila[0]);
    const productName = normalizeName(fila[1]);
    const startDate = fila[2] instanceof Date ? fila[2] : new Date(fila[2]);
    const price = parseNumber(fila[3]);

    if (!clientName || !productName || !_isValidDate(startDate) || !_isValidNumber(price) || price < 0) return;

    const key = _buildPriceKey(clientName, productName);
    if (!out[key]) out[key] = [];
    out[key].push({
      start_date: new Date(startDate),
      price: price
    });
  });

  Object.keys(out).forEach((key) => {
    out[key].sort((a, b) => a.start_date.getTime() - b.start_date.getTime());
  });

  return out;
}

function getPrice(args) {
  const pricesMap = (args && args.pricesMap) || {};
  const clientName = normalizeName(args && args.client_name);
  const productName = normalizeName(args && args.product_name);
  const date = args && args.date instanceof Date ? args.date : new Date(args && args.date);

  if (!clientName || !productName || isNaN(date.getTime())) return null;
  const key = _buildPriceKey(clientName, productName);
  const prices = pricesMap[key];
  if (!prices || prices.length === 0) return null;

  let winner = null;
  prices.forEach((row) => {
    if (row.start_date > date) return;
    if (!winner || row.start_date > winner.start_date) {
      winner = row;
    }
  });

  return winner ? winner.price : null;
}

function _buildPriceKey(clientName, productName) {
  return `${String(clientName || "").trim().toLowerCase()}|${String(productName || "").trim().toLowerCase()}`;
}

function _esClienteSinMontoReconstruct(nombre) {
  const key = String(nombre || "").trim().toLowerCase();
  return !!(key && CLIENTES_SIN_MONTO_RECONSTRUCT[key]);
}

function _isUuidV4(value) {
  const s = _asCleanString(value);
  return UUID_V4_REGEX.test(s);
}

const _RECONSTRUCT_MAPS_CACHE = {};

function _reconstructMapKey(namespace) {
  return `RECONSTRUCT_UUID_MAP_${namespace}`;
}

function _getOrCreateReconstructMap(namespace) {
  if (_RECONSTRUCT_MAPS_CACHE[namespace]) return _RECONSTRUCT_MAPS_CACHE[namespace];
  const raw = PropertiesService.getDocumentProperties().getProperty(_reconstructMapKey(namespace));
  let parsed = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) || {};
    } catch (e) {
      parsed = {};
    }
  }
  _RECONSTRUCT_MAPS_CACHE[namespace] = parsed;
  return parsed;
}

function _saveReconstructMaps() {
  const props = PropertiesService.getDocumentProperties();
  Object.keys(_RECONSTRUCT_MAPS_CACHE).forEach((namespace) => {
    props.setProperty(_reconstructMapKey(namespace), JSON.stringify(_RECONSTRUCT_MAPS_CACHE[namespace]));
  });
}

// ========================= DISTRIBUIR =========================

function _distribuirMovimientosLegacyNoUsar() {
  const movements = readMovements();
  const items = _readMovementItemsSheet();
  const salaries = _readMovementSalariesSheet();
  const clientPayments = _readMovementClientPaymentsSheet();

  const bucketCompraVenta = { GRASA: [], HUESOS: [] };
  const bucketGastos = [];
  const bucketSueldos = [];
  const bucketCuentas = [];

  const itemsByMovement = {};
  items.forEach((it) => {
    const movementId = _asCleanString(it.movement_id);
    if (!movementId) return;
    if (!itemsByMovement[movementId]) itemsByMovement[movementId] = [];
    itemsByMovement[movementId].push(it);
  });

  const salariesByMovement = {};
  salaries.forEach((s) => {
    const movementId = _asCleanString(s.movement_id);
    if (!movementId) return;
    if (!salariesByMovement[movementId]) salariesByMovement[movementId] = [];
    salariesByMovement[movementId].push(s);
  });

  const clientPaymentsByMovement = {};
  clientPayments.forEach((cp) => {
    const movementId = _asCleanString(cp.movement_id);
    if (!movementId) return;
    if (!clientPaymentsByMovement[movementId]) clientPaymentsByMovement[movementId] = [];
    clientPaymentsByMovement[movementId].push(cp);
  });

  movements.forEach((m) => {
    const id = _asCleanString(m.id);
    const type = _asCleanString(m.type);
    if (!id) return;
    if (!type) return;

    switch (type) {
      case "Entrega":
      case "entrega":
      case "entrega_dinero":
        return;
      case "Compra":
      case "Venta":
      case "compra":
      case "venta": {
      const movementItems = itemsByMovement[id] || [];
      movementItems.forEach((it) => {
        const client = _asCleanString(it.client);
        const product = _asCleanString(it.product);
        const quantity = _toNumber(it.quantity);
        if (!client || !product || !_isValidNumber(quantity)) return;

        const sheetName = String(product).toUpperCase().indexOf("HUES") !== -1 || String(product).toUpperCase().indexOf("ASERRIN") !== -1
          ? "HUESOS"
          : "GRASA";

        bucketCompraVenta[sheetName].push({
          date: m.date,
            client,
            type: String(type).toLowerCase() === "compra" ? "Compra" : "Venta",
          product,
          quantity
        });
      });
      return;
      }
      case "Gasto":
      case "gasto": {
      const amount = _toNumber(m.amount);
      if (!_isValidNumber(amount)) return;
      bucketGastos.push({ date: m.date, description: _asCleanString(m.description) || "Gasto", amount });
      return;
      }
      case "Sueldo":
      case "sueldo": {
      (salariesByMovement[id] || []).forEach((s) => {
        const employee = _asCleanString(s.employee);
        const subtotal = _toNumber(s.subtotal);
        if (!employee || !_isValidNumber(subtotal)) return;
        bucketSueldos.push({ date: m.date, employee, description: _asCleanString(m.description) || "Sueldo", amount: subtotal });
      });
      return;
      }
      case "Pago":
      case "pago":
      case "pago_cliente": {
      (clientPaymentsByMovement[id] || []).forEach((cp) => {
        const client = _asCleanString(cp.client_name);
        const subtotal = _toNumber(cp.subtotal);
        if (!client || !_isValidNumber(subtotal)) return;
        bucketCuentas.push({
          date: m.date,
          client,
          concepto: "Pago de Fabian",
          subtotal
        });
      });
        return;
      }
      default:
        return;
    }
  });

  _writeSheetProducto(bucketCompraVenta.GRASA, "GRASA");
  _writeSheetProducto(bucketCompraVenta.HUESOS, "HUESOS");
  _writeSheetGastos(bucketGastos);
  _writeSheetSueldos(bucketSueldos);
  _writeSheetCuentas(bucketCuentas);
}

function _writeSheetProducto(data, nombre) {
  const sheet = _getOrCreateSheet(nombre);
  sheet.clear();
  if (!data.length) return;

  sheet.appendRow(["Fecha", "Cliente", "Tipo", "Producto", "Cantidad"]);

  const rows = data.map((m) => [m.date, m.client, m.type, m.product, m.quantity]);
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  aplicarFormatoTablaGenerica(sheet, 1, [5]);
}

function _writeSheetGastos(data) {
  const sheet = _getOrCreateSheet("GASTOS");
  sheet.clear();
  if (!data.length) return;

  sheet.appendRow(["Fecha", "Descripción", "Monto"]);

  const rows = data.map(m => [m.date, m.description, m.amount]);
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  aplicarFormatoTablaGenerica(sheet, 1, [3]);
}

function _writeSheetSueldos(data) {
  const sheet = _getOrCreateSheet("SUELDOS");
  sheet.clear();
  if (!data.length) return;

  sheet.appendRow(["Fecha", "Empleado", "Tipo", "Descripción", "Monto"]);

  const rows = data.map((m) => [m.date, m.employee, "Adelanto", m.description, m.amount]);
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  aplicarFormatoTablaGenerica(sheet, 1, [5]);
}

function _writeSheetCuentas(data) {
  const sheet = _getOrCreateSheet("CUENTAS");
  sheet.clear();
  if (!data.length) return;

  sheet.appendRow(["Fecha", "Cliente", "Concepto", "", "", "", "", "Debe", "Haber"]);
  const rows = data.map((m) => [m.date, m.client, m.concepto, "", "", "", "", "", m.subtotal]);
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  aplicarFormatoTablaGenerica(sheet, 1, [8, 9]);
}

function _readMovementItemsSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("ITEMS");
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1).map((r) => ({
    movement_id: r[0],
    client: r[1],
    product: r[2],
    quantity: r[3],
    unit_price: r[4],
    subtotal: r[5]
  }));
}

function _readMovementSalariesSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("SALARIES");
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1).map((r) => ({
    movement_id: r[0],
    employee: r[1],
    subtotal: r[2]
  }));
}

function _readMovementClientPaymentsSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CLIENT_PAYMENTS");
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1).map((r) => ({
    movement_id: r[0],
    client_name: r[1],
    subtotal: r[2]
  }));
}

