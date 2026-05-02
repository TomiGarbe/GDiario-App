// ================================================================
// Reconstruct.js — Conversión entre hojas operativas y MOVEMENTS
// ================================================================

// ========================= RECONSTRUIR =========================

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
  const allItems = [
    ...productos.items,
    ...pagos.items
  ];
  const allSalaries = [
    ...sueldos.salaries
  ];

  Logger.log("Productos: " + productos.movements.length);
  Logger.log("Sueldos: " + sueldos.movements.length);
  Logger.log("Gastos: " + gastos.movements.length);
  Logger.log("Pagos: " + pagos.movements.length);

  return {
    movements: _deduplicateById(allMovements),
    items: allItems,
    salaries: allSalaries
  };
}

// ========================= PARSERS =========================

function procesarProductos(ss) {
  const hojaPrecios = ss.getSheetByName("PRECIOS");
  const preciosData = hojaPrecios ? hojaPrecios.getDataRange().getValues().slice(1) : [];

  const COL_INICIO = 2;
  const grupos = {};

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
      const cliente = _asCleanString(fila[0]);
      if (!cliente || FILAS_IGNORAR.includes(cliente)) return;

      const tipo = CLIENTES_VENTA.includes(cliente) ? "Venta" : "Compra";

      let producto = cfg.productoDefault;
      if (cfg.nombre === "HUESOS" && cliente === "CORDIEZ" && aserrinCordiez === 0) {
        aserrinCordiez = 1;
        producto = "Aserrin de hueso";
      }

      for (let col = COL_INICIO; col < fechas.length - 2; col++) {
        const fecha = fechas[col];
        const cantidad = _toNumber(fila[col]);
        if (!_isValidDate(fecha) || !_isValidNumber(cantidad) || cantidad === 0) continue;

        const unitPrice = _toNumber(obtenerPrecio(preciosData, cliente, producto, fecha));
        if (!_isValidNumber(unitPrice)) continue;

        const subtotal = unitPrice * cantidad;
        if (!_isValidNumber(subtotal)) continue;

        const dateKey = _toDateKey(fecha);
        const id = `${dateKey}|${cliente}|${tipo}`;

        if (!grupos[id]) {
          grupos[id] = {
            movement: {
              id,
              type: tipo,
              client: cliente,
              date: new Date(fecha),
              amount: 0,
              description: `${tipo} productos`
            },
            items: []
          };
        }

        grupos[id].movement.amount += subtotal;
        grupos[id].items.push({
          movement_id: id,
          client: cliente,
          product: _asCleanString(producto),
          quantity: cantidad,
          unit_price: unitPrice,
          subtotal
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

  return { movements, items, salaries: [] };
}

function procesarSueldos(ss) {
  const sheet = ss.getSheetByName("SUELDOS");
  if (!sheet) return { movements: [], items: [], salaries: [] };

  const data = sheet.getDataRange().getValues();
  const movements = [];
  const salaries = [];
  let processed = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isEmptyRow(row)) continue;
    if (isSummaryRow(row)) continue;

    const date = row[0];
    const employee = _asCleanString(row[1]);
    const tipo = _asCleanString(row[2]);
    const concepto = _asCleanString(row[3]);
    const amount = Number(row[4]);

    if (tipo !== "Adelanto") continue;
    if (!employee) continue;
    if (!isValidMovementRow({ date, amount })) continue;

    let id = _asCleanString(row[5]);
    if (!id) {
      id = "S-" + new Date(date).getTime() + "-" + employee;
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
  return { movements, items: [], salaries };
}

function procesarGastos(ss) {
  const sheet = ss.getSheetByName("GASTOS");
  if (!sheet) return { movements: [], items: [], salaries: [] };

  const data = sheet.getDataRange().getValues();
  const movements = [];
  let processed = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isEmptyRow(row)) continue;
    if (isSummaryRow(row)) continue;

    const date = row[0];
    const tipo = _asCleanString(row[1]);
    const amount = Number(row[2]);

    if (!isValidMovementRow({ date, amount })) continue;

    let id = _asCleanString(row[3]);
    if (!id) {
      id = "G-" + new Date(date).getTime() + "-" + i;
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
  return { movements, items: [], salaries: [] };
}

function procesarPagosClientes(ss) {
  const sheet = ss.getSheetByName("CUENTAS");
  if (!sheet) return { movements: [], items: [], salaries: [] };

  const data = sheet.getDataRange().getValues();
  const movements = [];
  const items = [];
  let processed = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isEmptyRow(row)) continue;
    if (isSummaryRow(row)) continue;

    const date = row[0];
    const client = _asCleanString(row[1]);
    const concepto = _asCleanString(row[2]);
    const haber = Number(row[8]);

    if (concepto !== "Pago de Fabian") continue;
    if (!client) continue;
    if (!isValidMovementRow({ date, amount: haber })) continue;

    let id = _asCleanString(row[9]);
    if (!id) {
      id = "P-" + new Date(date).getTime() + "-" + client;
    }

    movements.push({
      id,
      type: "Pago",
      client,
      date,
      amount: haber,
      description: concepto
    });

    items.push({
      movement_id: id,
      client,
      subtotal: haber
    });

    processed++;
  }

  Logger.log("Pagos procesados: " + processed);
  return { movements, items, salaries: [] };
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

function _mergeFinal(allMovements, allItems, allSalaries) {
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

  allItems.forEach(it => {
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

  allSalaries.forEach(s => {
    const movementId = _asCleanString(s.movement_id);
    const employee = _asCleanString(s.employee);
    const subtotal = _toNumber(s.subtotal);

    if (!movementId || !movementIds[movementId] || !employee || !_isValidNumber(subtotal)) return;

    const key = `${movementId}|${employee}|${subtotal}`;
    if (salaryKeys[key]) return;
    salaryKeys[key] = true;

    salaries.push({ movement_id: movementId, employee, subtotal });
  });

  return { movements, items, salaries };
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
  const n = Number(amount);
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
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function _isValidNumber(value) {
  return Number.isFinite(value);
}

function _asCleanString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

// ========================= DISTRIBUIR =========================

function distribuirMovimientos() {
  const movements = readMovementsSheet();
  const items = _readMovementItemsSheet();
  const salaries = _readMovementSalariesSheet();

  const bucketCompraVenta = { GRASA: [], HUESOS: [] };
  const bucketGastos = [];
  const bucketSueldos = [];
  const bucketCuentas = [];

  const itemsByMovement = {};
  items.forEach((it) => {
    const movementId = _asCleanString(it.movement_id);
    if (!movementId || movementId.indexOf("-") !== -1) return;
    if (!itemsByMovement[movementId]) itemsByMovement[movementId] = [];
    itemsByMovement[movementId].push(it);
  });

  const salariesByMovement = {};
  salaries.forEach((s) => {
    const movementId = _asCleanString(s.movement_id);
    if (!movementId || movementId.indexOf("-") !== -1) return;
    if (!salariesByMovement[movementId]) salariesByMovement[movementId] = [];
    salariesByMovement[movementId].push(s);
  });

  movements.forEach((m) => {
    const id = _asCleanString(m.id);
    const type = _asCleanString(m.type);
    if (!id || id.indexOf("-") !== -1) return;
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
      (itemsByMovement[id] || []).forEach((it) => {
        const client = _asCleanString(it.client);
        const subtotal = _toNumber(it.subtotal);
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
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("MOVEMENT_ITEMS");
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
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("MOVEMENT_SALARIES");
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1).map((r) => ({
    movement_id: r[0],
    employee: r[1],
    subtotal: r[2]
  }));
}
