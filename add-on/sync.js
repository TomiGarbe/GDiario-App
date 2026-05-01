const API_URL = "https://gdiario-app.onrender.com/api";

// Mapeo de tipos en español (hojas) → tipos que espera el backend
const TIPO_MOVEMENT_MAP = {
  "Compra":   "compra",
  "Venta":    "venta",
  "Gasto":    "gasto",
  "Adelanto": "pago",
  "Sueldo":   "sueldo"
};

// ========================= FETCH (DB → hojas) =========================

function fetchFromBackend() {
  const res  = UrlFetchApp.fetch(`${API_URL}/sync/export`);
  const data = JSON.parse(res.getContentText());

  writeMovements(data.movements);
  writeMovementDetails(data.movement_details);
}

// ========================= SYNC (hojas → DB) =========================

// Sync completo en 4 pasos siguiendo el contrato del backend:
// 1. Crear/obtener period → devuelve period_id
// 2. Sincronizar clientes
// 3. Sincronizar precios
// 4. Sincronizar movimientos (usa period_id del paso 1)
function syncToBackend() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const precios = _leerPrecios(ss);

  const { period_id } = _syncPeriod(ss);
  Logger.log("period_id recibido: " + period_id);

  _syncClientes(precios);
  _syncPrecios(precios);
  _syncMovimientos(ss, period_id);
}

// --- Paso 1: crear o obtener el period desde el nombre del archivo ---

function _syncPeriod(ss) {
  const period = _parsearPeriodDesdeNombre(ss);
  Logger.log("=== SYNC PERIOD ===");
  Logger.log(JSON.stringify(period));
  return _post("/sync/period", { sheet_id: ss.getId(), period });
}

// --- Paso 2: clientes únicos desde PRECIOS ---

function _syncClientes(precios) {
  const names = [...new Set(precios.map(p => p.client).filter(Boolean))];
  Logger.log("=== SYNC CLIENTES ===");
  Logger.log("Nombres a sincronizar: " + JSON.stringify(names));
  if (!names.length) return;
  const res = _post("/sync/clients", { names });
  Logger.log("Respuesta clientes: " + JSON.stringify(res));
}

// --- Paso 3: precios desde hoja PRECIOS ---

function _syncPrecios(precios) {
  Logger.log("=== SYNC PRECIOS ===");
  Logger.log("Cantidad: " + precios.length);
  if (precios.length) Logger.log("Primero: " + JSON.stringify(precios[0]));
  if (!precios.length) return;
  const res = _post("/sync/prices", { prices: precios });
  Logger.log("Respuesta precios: " + JSON.stringify(res));
}

// --- Paso 4: movimientos con el period_id ya resuelto ---

function _syncMovimientos(ss, period_id) {
  const movements = _leerMovementsParaSync(ss);
  if (!movements.length) return;

  // Log para inspeccionar qué se manda — revisá Apps Script → Ejecuciones
  Logger.log("=== SYNC MOVEMENTS ===");
  Logger.log("period_id: " + period_id);
  Logger.log("Total movements: " + movements.length);
  Logger.log("Primer movement: " + JSON.stringify(movements[0], null, 2));
  if (movements[0]?.details?.length) {
    Logger.log("Detalles del primero: " + JSON.stringify(movements[0].details, null, 2));
  }

  // Mostrar todos los nombres únicos de client/employee/product que se mandan
  const clientes  = [...new Set(movements.map(m => m.client).filter(Boolean))];
  const empleados = [...new Set(movements.map(m => m.employee).filter(Boolean))];
  const productos = [...new Set(movements.flatMap(m => m.details.map(d => d.product)).filter(Boolean))];
  Logger.log("Clientes únicos en movements: " + JSON.stringify(clientes));
  Logger.log("Empleados únicos en movements: " + JSON.stringify(empleados));
  Logger.log("Productos únicos en details: " + JSON.stringify(productos));

  const res = _post("/sync/movements", { period_id, is_first_batch: true, movements });
  Logger.log("Respuesta movements: " + JSON.stringify(res));
}

// ========================= LECTURA DE HOJAS =========================

// Lee PRECIOS → [{ client, product, price, start_date }]
// Columnas: Cliente | Producto | Fecha Desde | Precio
function _leerPrecios(ss) {
  const sheet = ss.getSheetByName("PRECIOS");
  if (!sheet) return [];

  return sheet.getDataRange().getValues().slice(1)
    .filter(r => r[0] && r[1] && r[2] && r[3])
    .map(r => ({
      client:     String(r[0]).trim(),
      product:    String(r[1]).trim(),
      start_date: _formatearFecha(r[2]),
      price:      Number(r[3]) || 0
    }));
}

// Deriva el period del nombre del archivo (formato: "NN MES AAAA")
// y arma el objeto SyncPeriodPayload que espera el backend
function _parsearPeriodDesdeNombre(ss) {
  const MESES_NUM = {
    "ENERO":1,"FEBRERO":2,"MARZO":3,"ABRIL":4,"MAYO":5,"JUNIO":6,
    "JULIO":7,"AGOSTO":8,"SEPTIEMBRE":9,"OCTUBRE":10,"NOVIEMBRE":11,"DICIEMBRE":12
  };

  const partes = ss.getName().split(" ");
  const mesStr = partes[1];
  const year   = parseInt(partes[2]);
  const month  = MESES_NUM[mesStr];

  if (!year || !month) throw new Error(`No se pudo parsear el período del nombre: "${ss.getName()}"`);

  const startDate = new Date(year, month - 1, 1);
  const endDate   = new Date(year, month, 0); // último día del mes

  return {
    year,
    month,
    name:       `${mesStr} ${year}`,
    start_date: _formatearFecha(startDate),
    end_date:   _formatearFecha(endDate)
  };
}

// Lee MOVEMENTS + MOVEMENT_DETAILS y arma el payload para /sync/movements
function _leerMovementsParaSync(ss) {
  const sheetMov = ss.getSheetByName("MOVEMENTS");
  const sheetDet = ss.getSheetByName("MOVEMENT_DETAILS");
  if (!sheetMov) return [];

  const movRows = sheetMov.getDataRange().getValues().slice(1);
  const detRows = sheetDet ? sheetDet.getDataRange().getValues().slice(1) : [];

  // Agrupar details por movement_id (col 1)
  const detailsByMovId = {};
  detRows.forEach(r => {
    const movId = String(r[1]);
    if (!detailsByMovId[movId]) detailsByMovId[movId] = [];
    detailsByMovId[movId].push(r);
  });

  return movRows
    .filter(r => r[1]) // date requerido
    .map(r => {
      const id   = _strOrNull(r[0]);  // null si celda vacía → movement nuevo
      const tipo = TIPO_MOVEMENT_MAP[String(r[2])] || String(r[2]).toLowerCase();

      const mov = {
        date:        _formatearFecha(r[1]),
        type:        tipo,
        client:      _strOrNull(r[3]),
        employee:    _strOrNull(r[4]),
        amount:      _round2(r[5]),
        description: _strOrNull(r[6]),
        details:     (detailsByMovId[id ?? ""] || []).map(d => _mapearDetail(d, tipo))
      };

      // Solo incluir id si existe — el backend decide si hace insert o update
      if (id) mov.id = id;

      return mov;
    });
}

// Columnas MOVEMENT_DETAILS: id | movement_id | type | product | employee | quantity | unit_price | subtotal
function _mapearDetail(r, tipoMovimiento) {
  let detailType;
  if (tipoMovimiento === "gasto")                                      detailType = "gasto";
  else if (tipoMovimiento === "pago" || tipoMovimiento === "sueldo")   detailType = "empleado";
  else                                                                 detailType = "producto";

  return {
    type:       detailType,
    product:    _strOrNull(r[3]),
    employee:   _strOrNull(r[4]),
    quantity:   _numOrNull(r[5]),
    unit_price: _numOrNull(r[6]),
    subtotal:   _numOrNull(r[7])
  };
}

// ========================= HELPERS =========================

// Devuelve string limpio o null. Evita "", "0", celdas con solo espacios.
function _strOrNull(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

// Redondea a 2 decimales. Evita floats sucios como 25742.500000000728.
function _round2(val) {
  const n = Number(val);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

// Número o null para campos opcionales (quantity, unit_price, subtotal).
function _numOrNull(val) {
  if (val === "" || val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

function _post(path, payload) {
  const res = UrlFetchApp.fetch(`${API_URL}${path}`, {
    method:      "post",
    contentType: "application/json",
    payload:     JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Error en ${path}: HTTP ${code} — ${res.getContentText()}`);
  }

  return JSON.parse(res.getContentText());
}

// Formatea un valor Date o string a "YYYY-MM-DD" que espera el backend
function _formatearFecha(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  return d.toISOString().slice(0, 10);
}