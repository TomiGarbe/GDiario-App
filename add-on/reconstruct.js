// ================================================================
// Reconstruct.js — Conversión entre hojas operativas y MOVEMENTS
//
// Flujo normal:  GRASA/HUESOS/SUELDOS/GASTOS → reconstruir → MOVEMENTS → sync
// Flujo inverso: fetch → MOVEMENTS → distribuir → GRASA/HUESOS/SUELDOS/GASTOS
// ================================================================

// ========================= RECONSTRUIR =========================

function reconstruirMovimientos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const comprasVentas = _parsearProductos(ss);
  const sueldos       = parseSueldos(ss);
  const gastos        = parseGastos(ss);

  const allMovements = [
    ...comprasVentas.movements,
    ...sueldos.movements,
    ...gastos.movements
  ];
  const allDetails = [
    ...comprasVentas.details,
    ...sueldos.details,
    ...gastos.details
  ];

  // Preservar IDs existentes, asignar UUID nuevo a los que no tienen
  _preservarIdsExistentes(ss, allMovements);
  allMovements.forEach(m => { if (!m.id) m.id = Utilities.getUuid(); });
  allDetails.forEach(d => { if (!d.id) d.id = Utilities.getUuid(); });

  // Vincula movement_id en details usando el id del movement (si existe)
  _resolverMovementIds(allMovements, allDetails);

  writeMovements(allMovements);
  writeMovementDetails(allDetails);
}

// Lee la hoja MOVEMENTS actual y asigna el id a cada movement reconstruido
// que matchee por fecha + cliente + tipo (clave natural de negocio)
function _preservarIdsExistentes(ss, movements) {
  const sheet = ss.getSheetByName("MOVEMENTS");
  if (!sheet) return;

  const existentes = sheet.getDataRange().getValues().slice(1);

  // mapa: "fechaISO|cliente|tipo" → id
  const idMap = {};
  existentes.forEach(r => {
    const id     = r[0];
    const fecha  = r[1] instanceof Date ? r[1].toISOString().slice(0, 10) : String(r[1]).slice(0, 10);
    const tipo   = String(r[2]);
    const client = String(r[3]);
    if (!id) return;
    idMap[`${fecha}|${client}|${tipo}`] = id;
  });

  movements.forEach(m => {
    const fecha = m.date instanceof Date ? m.date.toISOString().slice(0, 10) : String(m.date).slice(0, 10);
    const clave = `${fecha}|${m.client}|${m.type}`;
    if (idMap[clave]) m.id = idMap[clave];
  });
}

// ========================= PARSERS =========================

// Procesa GRASA y HUESOS juntos compartiendo el mismo mapa de grupos.
// Clave: fecha|cliente|tipo — sin producto, para que todos los productos
// del mismo día y cliente queden en un solo movement con un detail por producto.
function _parsearProductos(ss) {
  const hojaPrecios = ss.getSheetByName("PRECIOS");
  const preciosData = hojaPrecios ? hojaPrecios.getDataRange().getValues().slice(1) : [];

  const COL_INICIO = 2;
  const grupos     = {};

  const hojasOrigen = [
    { nombre: "GRASA",  productoDefault: "Grasa"  },
    { nombre: "HUESOS", productoDefault: "Huesos" }
  ];

  hojasOrigen.forEach(cfg => {
    const sheet = ss.getSheetByName(cfg.nombre);
    if (!sheet) return;

    const datos  = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    const fechas = datos[0];
    const filas  = datos.slice(1);
    let aserrinCordiez = 0;

    filas.forEach(fila => {
      const cliente = fila[0];
      if (!cliente || FILAS_IGNORAR.includes(cliente)) return;

      const tipo = CLIENTES_VENTA.includes(cliente) ? "Venta" : "Compra";

      let producto = cfg.productoDefault;
      if (cfg.nombre === "HUESOS" && cliente === "CORDIEZ" && aserrinCordiez === 0) {
        aserrinCordiez = 1;
        producto = "Aserrin de hueso";
      }

      for (let col = COL_INICIO; col < fechas.length - 2; col++) {
        const fecha    = fechas[col];
        const cantidad = fila[col];
        if (!fecha || !cantidad || cantidad === 0) continue;

        const unit_price = obtenerPrecio(preciosData, cliente, producto, fecha);
        const subtotal   = unit_price * cantidad;

        const fechaStr = fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha);
        const clave    = `${fechaStr}|${cliente}|${tipo}`;

        if (!grupos[clave]) {
          grupos[clave] = {
            movement: {
              date: fecha, type: tipo, client: cliente,
              employee: null, description: `${tipo} productos`,
              amount: 0, source: "PRODUCTOS"
            },
            details: []
          };
        }

        grupos[clave].movement.amount += subtotal;
        grupos[clave].details.push({
          _grupoRef:  grupos[clave].movement,
          product:    producto,
          quantity:   cantidad,
          unit_price,
          subtotal
        });
      }
    });
  });

  const movements = [];
  const details   = [];
  Object.values(grupos).forEach(g => {
    movements.push(g.movement);
    details.push(...g.details);
  });

  return { movements, details };
}

// Solo adelantos, agrupados por fecha → 1 movement por día, 1 detail por empleado
function parseSueldos(ss) {
  const sheet = ss.getSheetByName("SUELDOS");
  if (!sheet) return { movements: [], details: [] };

  // Columnas SUELDOS: fecha | empleado | tipo | concepto | monto
  const adelantos = sheet.getDataRange().getValues().slice(1).filter(r =>
    r[0] && r[1] && String(r[2]).toLowerCase() === "adelanto"
  );

  const grupos = {};

  adelantos.forEach(r => {
    const fecha    = new Date(r[0]);
    const clave    = fecha.toISOString().slice(0, 10);
    const empleado = String(r[1]).toUpperCase();
    const monto    = Number(r[4]) || 0;

    if (!grupos[clave]) {
      grupos[clave] = {
        movement: {
          date: fecha, type: "Adelanto", client: null,
          employee: null, description: "Adelantos", amount: 0, source: "SUELDOS"
        },
        details: []
      };
    }

    grupos[clave].movement.amount += monto;
    grupos[clave].details.push({
      _grupoRef:  grupos[clave].movement,
      product:    empleado,
      quantity:   1,
      unit_price: monto,
      subtotal:   monto
    });
  });

  const movements = [];
  const details   = [];
  Object.values(grupos).forEach(g => {
    movements.push(g.movement);
    details.push(...g.details);
  });

  return { movements, details };
}

// Gastos: 1 movement + 1 detail por fila, sin agrupamiento
function parseGastos(ss) {
  const sheet = ss.getSheetByName("GASTOS");
  if (!sheet) return { movements: [], details: [] };

  // Columnas GASTOS: fecha | descripción | monto
  const movements = [];
  const details   = [];

  sheet.getDataRange().getValues().slice(1)
    .filter(r => r[0] && r[2])
    .forEach(r => {
      const desc  = String(r[1]) || "Gasto";
      const monto = Number(r[2]) || 0;
      const mov   = {
        date: new Date(r[0]), type: "Gasto", client: null,
        employee: null, description: desc, amount: monto, source: "GASTOS"
      };
      movements.push(mov);
      details.push({
        _grupoRef:  mov,
        product:    desc,
        quantity:   1,
        unit_price: monto,
        subtotal:   monto
      });
    });

  return { movements, details };
}

// ========================= VINCULAR IDs =========================

// Usa la referencia al objeto movement para asignar movement_id en cada detail.
// Si el movement no tiene id (es nuevo), movement_id queda undefined → se escribe vacío.
function _resolverMovementIds(allMovements, allDetails) {
  const idMap = new Map(allMovements.map(m => [m, m.id]));
  allDetails.forEach(d => {
    d.movement_id = idMap.get(d._grupoRef);
    delete d._grupoRef;
  });
}

// ========================= DISTRIBUIR =========================

function distribuirMovimientos() {
  const movimientos = readMovementsSheet();

  const buckets = { GRASA: [], HUESOS: [], SUELDOS: [], GASTOS: [] };

  movimientos.forEach(m => {
    if ((m.type === "Compra" || m.type === "Venta") && m.source === "GRASA")  buckets.GRASA.push(m);
    if ((m.type === "Compra" || m.type === "Venta") && m.source === "HUESOS") buckets.HUESOS.push(m);
    if (m.type === "Adelanto") buckets.SUELDOS.push(m);
    if (m.type === "Gasto")    buckets.GASTOS.push(m);
  });

  _writeSheetProducto(buckets.GRASA,  "GRASA");
  _writeSheetProducto(buckets.HUESOS, "HUESOS");
  _writeSheetGastos(buckets.GASTOS);
  _writeSheetSueldos(buckets.SUELDOS);
}

function _writeSheetProducto(data, nombre) {
  const sheet = _getOrCreateSheet(nombre);
  sheet.clear();
  if (!data.length) return;

  sheet.appendRow(["Fecha", "Cliente", "Tipo", "Descripción", "Monto"]);

  const rows = data.map(m => [m.date, m.client, m.type, m.description, m.amount]);
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

  sheet.appendRow(["Fecha", "Descripción", "Monto"]);

  const rows = data.map(m => [m.date, m.description, m.amount]);
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  aplicarFormatoTablaGenerica(sheet, 1, [3]);
}