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

function normalize(value) {
  return String(value || "").trim().toLowerCase();
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

  const rebuiltMovements = _deduplicateById(allMovements).filter((movement) => {
    const rawType = String((movement && movement.type) || "").trim().toLowerCase();
    const backendType = MOVEMENT_TYPE_TO_BACKEND[rawType] || rawType;
    return backendType !== "entrega_dinero";
  });

  const stable = _stabilizeRebuiltMovementIds(
    rebuiltMovements,
    allItems,
    allSalaries,
    allClientPayments
  );

  return {
    movements: stable.movements,
    movement_items: stable.movement_items,
    movement_salaries: stable.movement_salaries,
    movement_client_payments: stable.movement_client_payments
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
        const fechaDate = _parseOperationalDate(fecha, `procesarProductos:${cfg.nombre}:col=${col}`);
        const cantidad = _toNumber(fila[col]);
        if (!fechaDate || !_isValidNumber(cantidad) || cantidad === 0) continue;

        const clienteSinMonto = _esClienteSinMontoReconstruct(cliente);
        let unitPrice = getPrice({
          pricesMap,
          client_name: cliente,
          product_name: producto,
          date: fechaDate
        });

        if (clienteSinMonto) {
          unitPrice = 0;
        }

        if (!_isValidNumber(unitPrice) || unitPrice < 0) {
          errors.push(`Missing price for client ${cliente}, product ${producto}, date ${_toDateKey(fechaDate)}`);
          continue;
        }
        if (unitPrice === null && !clienteSinMonto) {
          errors.push(`Missing price for client ${cliente}, product ${producto}, date ${_toDateKey(fechaDate)}`);
          continue;
        }

        Logger.log(`Precio usado: ${cliente} - ${producto} - ${unitPrice}`);

        const subtotal = unitPrice * cantidad;
        if (!_isValidNumber(subtotal)) continue;
        if (!clienteSinMonto && subtotal <= 0) continue;
        const roundedSubtotal = Math.round(subtotal * 100) / 100;
        const expectedSubtotal = Math.round((cantidad * unitPrice) * 100) / 100;
        if (!clienteSinMonto && roundedSubtotal !== expectedSubtotal) {
          errors.push(`Subtotal mismatch for client ${cliente}, product ${producto}, date ${_toDateKey(fechaDate)}: subtotal=${roundedSubtotal} expected=${expectedSubtotal}`);
          continue;
        }

        const dateKey = _toDateKey(fechaDate);
        const isVenta = normalize(tipo) === "venta";
        const productKey = normalize(producto);
        const groupKey = isVenta
          ? `${dateKey}|${cliente}|${tipo}|${productKey}`
          : `${dateKey}|${cliente}|${tipo}`;
        if (!productosMovementMap[groupKey] || !_isUuidV4(productosMovementMap[groupKey])) {
          productosMovementMap[groupKey] = Utilities.getUuid();
        }
        const movementId = productosMovementMap[groupKey];

        if (!grupos[groupKey]) {
          grupos[groupKey] = {
            movement: {
              id: movementId,
              type: tipo,
              client: cliente,
              date: fechaDate,
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
    const tipoNorm = normalize(tipo);
    const concepto = row[3];
    const conceptoNorm = normalize(concepto);
    const amount = parseNumber(row[4]);
    const parsedDate = _parseOperationalDate(date, `procesarSueldos:row=${i + 1}`);
    const esAdelanto = tipoNorm === "adelanto" || conceptoNorm.indexOf("adelanto") !== -1;
    const esSaldoInicial = tipoNorm === "saldo inicial" || tipoNorm === "saldo_inicial" || conceptoNorm === "saldo inicial";

    if (!esAdelanto && !esSaldoInicial) {
      continue;
    }
    if (!employee) continue;
    if (!parsedDate || amount === null || amount === undefined || amount === "" || !Number.isFinite(amount) || amount === 0) continue;

    let id = _asCleanString(row[5]);
    if (!_isUuidV4(id)) {
      id = Utilities.getUuid();
      sheet.getRange(i + 1, 6).setValue(id);
    }

    movements.push({
      id,
      type: esSaldoInicial ? "Saldo Inicial" : "Sueldo",
      date: parsedDate,
      amount,
      description: concepto || (esSaldoInicial ? "Saldo Inicial" : "Sueldo")
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
  const headers = data[0] || [];
  const isFromAppIndex = headers.findIndex((h) =>
    _asCleanString(h).toLowerCase() === "is_from_app"
  );

  if (isFromAppIndex === -1) {
    Logger.log("GASTOS: columna is_from_app no encontrada. No se procesan gastos.");
    return { movements: [], movement_items: [], movement_salaries: [], movement_client_payments: [] };
  }

  const gastosValidos = data
    .slice(1)
    .map((row, idx) => ({ row, rowNumber: idx + 2 }))
    .filter(({ row }) => _isTrue(row[isFromAppIndex]));

  const movements = [];
  let processed = 0;

  gastosValidos.forEach(({ row, rowNumber }) => {
    if (isEmptyRow(row)) return;
    if (isSummaryRow(row)) return;

    const date = row[0];
    const tipo = _asCleanString(row[1]);
    const amount = parseNumber(row[2]);
    const parsedDate = _parseOperationalDate(date, `procesarGastos:row=${rowNumber}`);

    if (!isValidMovementRow({ date: parsedDate, amount })) return;

    let id = _asCleanString(row[3]);
    if (!_isUuidV4(id)) {
      id = Utilities.getUuid();
      sheet.getRange(rowNumber, 4).setValue(id);
    }

    movements.push({
      id,
      type: "Gasto",
      date: parsedDate,
      amount,
      description: tipo
    });

    processed++;
  });

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
    const parsedDate = _parseOperationalDate(date, `procesarPagosClientes:row=${i + 1}`);

    if (concepto !== "Pago de Fabian") continue;
    if (!client) continue;
    if (!isValidMovementRow({ date: parsedDate, amount: haber })) continue;

    let id = _asCleanString(row[9]);
    if (!_isUuidV4(id)) {
      id = Utilities.getUuid();
      sheet.getRange(i + 1, 10).setValue(id);
    }

    movements.push({
      id,
      type: "Pago",
      client,
      date: parsedDate,
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

function buildKey(mov, itemSignature) {
  const type = normalize(mov && mov.type);
  const base = [
    _safeDateKey(mov && mov.date),
    type,
    normalize(mov && mov.client)
  ];

  if (type === "compra") {
    return base.join("|");
  }
  if (type === "venta") {
    base.push(normalize(itemSignature));
    return base.join("|");
  }

  base.push(normalize(mov && mov.description));
  base.push(_asCleanString(itemSignature));
  return base.join("|");
}

function _safeDateKey(value) {
  return _toDateKey(value);
}

function _stabilizeRebuiltMovementIds(movements, items, salaries, clientPayments) {
  const existingMovements = readMovements();
  const existingItems = _readMovementItemsSheet();
  const existingClientPayments = _readMovementClientPaymentsSheet();
  const existingByKey = _indexExistingMovementsByKey(existingMovements, existingItems, existingClientPayments);
  const existingItemsByMovement = _groupMovementItemsByMovement(existingItems);
  const existingItemSignaturesByMovement = _groupItemsByMovement(existingItems);

  const newItemsByMovement = _groupItemsByMovement(items);
  const newClientByMovement = _groupClientByMovement(items, clientPayments);
  const idRemap = {};
  const usedIds = {};
  const outMovements = [];
  const preservedPurchaseItemsByPrevId = {};
  const emittedPreservedPurchaseItems = {};

  (movements || []).forEach((movement) => {
    const prevId = _asCleanString(movement && movement.id);
    const enriched = {
      id: prevId,
      type: movement && movement.type,
      date: movement && movement.date,
      amount: movement && movement.amount,
      description: movement && movement.description,
      client: _asCleanString((movement && movement.client) || newClientByMovement[prevId])
    };
    const key = buildKey(enriched, newItemsByMovement[prevId]);
    const bucket = existingByKey[key] || [];
    let reusedId = "";

    while (bucket.length) {
      const candidateId = bucket.shift();
      if (!usedIds[candidateId]) {
        reusedId = candidateId;
        usedIds[candidateId] = true;
        break;
      }
    }

    const finalId = reusedId || (_isUuidV4(prevId) ? prevId : Utilities.getUuid());
    idRemap[prevId] = finalId;
    let amount = movement && movement.amount;

    if (
      _isCompraMovement(movement) &&
      reusedId &&
      existingItemSignaturesByMovement[reusedId] === newItemsByMovement[prevId]
    ) {
      const preservedItems = _clonePreservedPurchaseItems(existingItemsByMovement[reusedId], finalId);
      if (preservedItems.length) {
        preservedPurchaseItemsByPrevId[prevId] = preservedItems;
        amount = _sumItemSubtotals(preservedItems);
      }
    }

    outMovements.push({
      id: finalId,
      type: movement && movement.type,
      date: movement && movement.date,
      amount,
      description: movement && movement.description
    });
  });

  const outItems = [];
  (items || []).forEach((it) => {
    const prevId = _asCleanString(it && it.movement_id);
    const preservedItems = preservedPurchaseItemsByPrevId[prevId];
    if (preservedItems) {
      if (emittedPreservedPurchaseItems[prevId]) return;
      preservedItems.forEach((preservedItem) => outItems.push(preservedItem));
      emittedPreservedPurchaseItems[prevId] = true;
      return;
    }

    outItems.push({
      ...it,
      movement_id: idRemap[prevId] || prevId
    });
  });

  const outSalaries = (salaries || []).map((s) => ({
    ...s,
    movement_id: idRemap[_asCleanString(s && s.movement_id)] || _asCleanString(s && s.movement_id)
  }));
  const outClientPayments = (clientPayments || []).map((cp) => ({
    ...cp,
    movement_id: idRemap[_asCleanString(cp && cp.movement_id)] || _asCleanString(cp && cp.movement_id)
  }));

  return {
    movements: outMovements,
    movement_items: outItems,
    movement_salaries: outSalaries,
    movement_client_payments: outClientPayments
  };
}

function _indexExistingMovementsByKey(existingMovements, existingItems, existingClientPayments) {
  const byKey = {};
  const itemsByMovement = _groupItemsByMovement(existingItems);
  const clientByMovement = _groupClientByMovement(existingItems, existingClientPayments);

  (existingMovements || []).forEach((movement) => {
    const id = _asCleanString(movement && movement.id);
    if (!id) return;
    const enriched = {
      id,
      type: movement && movement.type,
      date: movement && movement.date,
      amount: movement && movement.amount,
      description: movement && movement.description,
      client: _asCleanString((movement && movement.client) || clientByMovement[id])
    };
    const key = buildKey(enriched, itemsByMovement[id]);
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(id);
  });

  return byKey;
}

function _groupItemsByMovement(items) {
  const grouped = {};
  (items || []).forEach((it) => {
    const movementId = _asCleanString(it && it.movement_id);
    if (!movementId) return;
    if (!grouped[movementId]) grouped[movementId] = [];
    grouped[movementId].push({
      product: normalize(it && it.product),
      quantity: _toNumber(it && it.quantity)
    });
  });

  const signatureByMovement = {};
  Object.keys(grouped).forEach((movementId) => {
    const parts = grouped[movementId]
      .map((p) => `${p.product}:${_isValidNumber(p.quantity) ? p.quantity : ""}`)
      .sort();
    signatureByMovement[movementId] = parts.join(",");
  });
  return signatureByMovement;
}

function _groupClientByMovement(items, clientPayments) {
  const clientByMovement = {};
  (items || []).forEach((it) => {
    const movementId = _asCleanString(it && it.movement_id);
    if (!movementId || clientByMovement[movementId]) return;
    const client = _asCleanString(it && it.client);
    if (client) clientByMovement[movementId] = client;
  });
  (clientPayments || []).forEach((cp) => {
    const movementId = _asCleanString(cp && cp.movement_id);
    if (!movementId || clientByMovement[movementId]) return;
    const client = _asCleanString((cp && cp.client_name) || (cp && cp.client));
    if (client) clientByMovement[movementId] = client;
  });
  return clientByMovement;
}

function _groupMovementItemsByMovement(items) {
  const grouped = {};
  (items || []).forEach((it) => {
    const movementId = _asCleanString(it && it.movement_id);
    if (!movementId) return;
    if (!grouped[movementId]) grouped[movementId] = [];
    grouped[movementId].push(it);
  });
  return grouped;
}

function _clonePreservedPurchaseItems(items, movementId) {
  const out = [];
  (items || []).forEach((it) => {
    const client = _asCleanString(it && it.client);
    const product = _asCleanString(it && it.product);
    const quantity = _toNumber(it && it.quantity);
    const unitPrice = _toNumber(it && it.unit_price);
    const subtotal = _toNumber(it && it.subtotal);

    if (!client || !product) return;
    if (!_isValidNumber(quantity) || !_isValidNumber(unitPrice) || !_isValidNumber(subtotal)) return;

    out.push({
      movement_id: movementId,
      client,
      product,
      quantity,
      unit_price: unitPrice,
      subtotal
    });
  });
  return out;
}

function _sumItemSubtotals(items) {
  return (items || []).reduce((acc, item) => {
    const subtotal = _toNumber(item && item.subtotal);
    return acc + (_isValidNumber(subtotal) ? subtotal : 0);
  }, 0);
}

function _isCompraMovement(movement) {
  const type = normalize(movement && movement.type);
  const backendType = MOVEMENT_TYPE_TO_BACKEND[type] || type;
  return backendType === "compra";
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
  if (!_parseOperationalDate(date, "isValidMovementRow")) return false;
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
  return !!_parseOperationalDate(value, "_isValidDate");
}

function _toDateKey(value) {
  const parsed = _parseOperationalDate(value, "_toDateKey");
  if (!parsed) return "";
  return Utilities.formatDate(parsed, Session.getScriptTimeZone(), "yyyy-MM-dd");
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
    const startDate = _parseOperationalDate(fila[2], "_buildPricesMap:PRECIOS.FechaDesde");
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
  const date = _parseOperationalDate(args && args.date, "getPrice:movementDate");

  if (!clientName || !productName || !date || isNaN(date.getTime())) return null;
  const key = _buildPriceKey(clientName, productName);
  const prices = pricesMap[key];
  if (!prices || prices.length === 0) return null;

  const priceRow = _getPriceForDate(prices, date);
  if (!priceRow) return null;

  Logger.log("MOV DATE: " + _toDateKey(date));
  Logger.log("PRICE USED: " + _toDateKey(priceRow.start_date) + " " + priceRow.price);

  return priceRow.price;
}

function _getPriceForDate(prices, movementDate) {
  if (!Array.isArray(prices) || prices.length === 0 || !_isValidDate(movementDate)) return null;

  const movementDateKey = _toDateKey(movementDate);
  let validPrice = null;

  for (let i = 0; i < prices.length; i++) {
    const row = prices[i];
    if (!row || !_isValidDate(row.start_date)) continue;
    const startDateKey = _toDateKey(row.start_date);

    if (startDateKey <= movementDateKey) {
      validPrice = row;
    } else {
      break;
    }
  }

  return validPrice;
}

function _buildPriceKey(clientName, productName) {
  return `${normalize(clientName)}|${normalize(productName)}`;
}

function _parseOperationalDate(value, context) {
  const ctx = context || "reconstruct";

  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      Logger.log(`[RECONSTRUCT DATE] Invalid Date object. context=${ctx}`);
      return null;
    }
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (value === null || value === undefined || value === "") {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const ddmmyy = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/;
  let match = raw.match(ddmmyyyy);

  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const parsed = _buildDateStrict(day, month, year);
    if (!parsed) {
      Logger.log(`[RECONSTRUCT DATE] Invalid dd/mm/yyyy date. context=${ctx} raw=${raw}`);
    }
    return parsed;
  }

  match = raw.match(ddmmyy);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = 2000 + Number(match[3]);
    const parsed = _buildDateStrict(day, month, year);
    if (!parsed) {
      Logger.log(`[RECONSTRUCT DATE] Invalid dd/mm/yy date. context=${ctx} raw=${raw} interpretedYear=${year}`);
    }
    return parsed;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parts = raw.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    const parsed = _buildDateStrict(day, month, year);
    if (!parsed) {
      Logger.log(`[RECONSTRUCT DATE] Invalid yyyy-mm-dd date. context=${ctx} raw=${raw}`);
    }
    return parsed;
  }

  const fallback = new Date(raw);
  if (isNaN(fallback.getTime())) {
    Logger.log(`[RECONSTRUCT DATE] Unsupported date format. context=${ctx} raw=${raw}`);
    return null;
  }
  return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
}

function _buildDateStrict(day, month, year) {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  const monthIndex = month - 1;
  const candidate = new Date(year, monthIndex, day);
  if (isNaN(candidate.getTime())) return null;
  if (candidate.getFullYear() !== year || candidate.getMonth() !== monthIndex || candidate.getDate() !== day) return null;
  return candidate;
}

function _isTrue(value) {
  if (value === true) return true;
  if (typeof value === "string") return normalize(value) === "true";
  return false;
}

function _esClienteSinMontoReconstruct(nombre) {
  const key = normalize(nombre);
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

function distribuirMovimientosAOperativas() {
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

function _distribuirMovimientosLegacyNoUsar() {
  distribuirMovimientosAOperativas();
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
