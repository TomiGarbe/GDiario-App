const API_URL = "https://gdiario-app.onrender.com/api";

const TIPO_MOVEMENT_TO_BACKEND = {
  "Compra": "compra",
  "Venta": "venta",
  "Gasto": "gasto",
  "Sueldo": "sueldo",
  "Pago": "pago_cliente",
  "Pago cliente": "pago_cliente",
  "Entrega": "entrega_dinero",
  "Entrega dinero": "entrega_dinero"
};

const TIPO_MOVEMENT_FROM_BACKEND = {
  "compra": "Compra",
  "venta": "Venta",
  "gasto": "Gasto",
  "sueldo": "Sueldo",
  "pago": "Pago",
  "pago_cliente": "Pago",
  "entrega_dinero": "Entrega"
};

function fetchFromBackend() {
  Logger.log("Fetch desde backend iniciado");

  const response = UrlFetchApp.fetch(`${API_URL}/movements`, { muteHttpExceptions: true });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Error en fetch: HTTP ${code} - ${response.getContentText()}`);
  }

  const data = JSON.parse(response.getContentText()) || {};
  const movementsRaw = Array.isArray(data.movements) ? data.movements : (Array.isArray(data) ? data : []);
  const itemsRaw = Array.isArray(data.items) ? data.items : [];
  const salariesRaw = Array.isArray(data.salaries) ? data.salaries : [];

  const movements = movementsRaw.filter((m) => {
    const id = _strOrNull(m && m.id);
    const amount = _numOrNull(m && m.amount);
    return !!id && id.indexOf("-") === -1 && amount !== null;
  });
  const items = itemsRaw.filter((it) => {
    const movementId = _strOrNull(it && it.movement_id);
    const subtotal = _numOrNull(it && it.subtotal);
    return !!movementId && movementId.indexOf("-") === -1 && subtotal !== null;
  });
  const salaries = salariesRaw.filter((s) => {
    const movementId = _strOrNull(s && s.movement_id);
    const subtotal = _numOrNull(s && s.subtotal);
    return !!movementId && movementId.indexOf("-") === -1 && subtotal !== null;
  });

  writeMovements(movements);
  writeMovementItems(items);
  writeMovementSalaries(salaries);

  Logger.log("Fetch completado");
}

function syncToBackend() {
  Logger.log("Sync iniciado");

  const result = reconstruirMovimientos() || {};
  const movementsRaw = Array.isArray(result.movements) ? result.movements : [];
  const itemsRaw = Array.isArray(result.items) ? result.items : [];
  const salariesRaw = Array.isArray(result.salaries) ? result.salaries : [];

  const movements = movementsRaw.filter((m) => {
    const id = _strOrNull(m && m.id);
    const amount = _numOrNull(m && m.amount);
    return !!id && id.indexOf("-") === -1 && amount !== null;
  });
  const items = itemsRaw.filter((it) => {
    const movementId = _strOrNull(it && it.movement_id);
    const subtotal = _numOrNull(it && it.subtotal);
    return !!movementId && movementId.indexOf("-") === -1 && subtotal !== null;
  });
  const salaries = salariesRaw.filter((s) => {
    const movementId = _strOrNull(s && s.movement_id);
    const subtotal = _numOrNull(s && s.subtotal);
    return !!movementId && movementId.indexOf("-") === -1 && subtotal !== null;
  });

  const payload = { movements, items, salaries };

  const response = UrlFetchApp.fetch(`${API_URL}/sync/full`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Error en sync: HTTP ${code} - ${response.getContentText()}`);
  }

  Logger.log("Sync completado: " + response.getContentText());
}

function _syncPeriod(ss) {
  const period = _parsearPeriodDesdeNombre(ss);
  return _post("/sync/period", { sheet_id: ss.getId(), period });
}

function _syncClientes(precios) {
  const names = [...new Set(precios.map((p) => p.client).filter(Boolean))];
  if (!names.length) return;
  _post("/sync/clients", { names });
}

function _syncPrecios(precios) {
  if (!precios.length) return;
  _post("/sync/prices", { prices: precios });
}

function _syncMovements(period_id) {
  Logger.log("Sync iniciado");

  const reconstructed = reconstruirMovimientos();
  const movementsRaw = reconstructed.movements || [];
  const itemsRaw = reconstructed.items || [];
  const salariesRaw = reconstructed.salaries || [];

  const movementMap = {};
  const movements = movementsRaw
    .map((m) => {
      const id = _strOrNull(m.id);
      const typeRaw = _strOrNull(m.type);
      const type = TIPO_MOVEMENT_TO_BACKEND[typeRaw] || typeRaw.toLowerCase();
      const amount = _numOrNull(m.amount);

      if (!id || id.indexOf("-") !== -1) return null;
      if (!m.date || !type || amount === null) return null;

      const out = {
        id,
        period_id,
        date: _formatearFecha(m.date),
        type,
        amount,
        description: _strOrNull(m.description)
      };

      movementMap[id] = type;
      return out;
    })
    .filter(Boolean);

  const items = itemsRaw
    .map((it) => {
      const movementId = _strOrNull(it.movement_id);
      const client = _strOrNull(it.client);
      const product = _strOrNull(it.product);
      const quantity = _numOrNull(it.quantity);
      const unitPrice = _numOrNull(it.unit_price);
      const subtotal = _numOrNull(it.subtotal);

      if (!movementId || movementId.indexOf("-") !== -1) return null;
      if (!movementMap[movementId]) return null;
      if (!client || !product) return null;
      if (quantity === null || unitPrice === null || subtotal === null) return null;

      return {
        id: _uuidFromParts("item", movementId, client, product, quantity, unitPrice, subtotal),
        movement_id: movementId,
        client_name: client,
        product_name: product,
        quantity,
        unit_price: unitPrice,
        subtotal
      };
    })
    .filter(Boolean);

  const clientPayments = itemsRaw
    .map((it) => {
      const movementId = _strOrNull(it.movement_id);
      const client = _strOrNull(it.client);
      const subtotal = _numOrNull(it.subtotal);

      if (!movementId || movementId.indexOf("-") !== -1) return null;
      if (movementMap[movementId] !== "pago_cliente") return null;
      if (!client || subtotal === null) return null;

      return {
        id: _uuidFromParts("cp", movementId, client, subtotal),
        movement_id: movementId,
        client_name: client,
        subtotal
      };
    })
    .filter(Boolean);

  const salaries = salariesRaw
    .map((s) => {
      const movementId = _strOrNull(s.movement_id);
      const employee = _strOrNull(s.employee);
      const subtotal = _numOrNull(s.subtotal);

      if (!movementId || movementId.indexOf("-") !== -1) return null;
      if (!movementMap[movementId] || movementMap[movementId] === "entrega_dinero") return null;
      if (!employee || subtotal === null) return null;

      return {
        id: _uuidFromParts("sal", movementId, employee, subtotal),
        movement_id: movementId,
        employee_name: employee,
        subtotal
      };
    })
    .filter(Boolean);

  Logger.log("Movements: " + movements.length);

  const payload = {
    movements,
    movement_items: items,
    movement_salaries: salaries,
    movement_client_payments: clientPayments
  };

  _post("/sync/full", payload);
}

function _syncMovimientos(ss, period_id) {
  _syncMovements(period_id);
}

function _syncMovementItems() {}
function _syncMovementSalaries() {}

function _leerPrecios(ss) {
  const sheet = ss.getSheetByName("PRECIOS");
  if (!sheet) return [];

  return sheet.getDataRange().getValues().slice(1)
    .filter((r) => r[0] && r[1] && r[2] && r[3])
    .map((r) => ({
      client: String(r[0]).trim(),
      product: String(r[1]).trim(),
      start_date: _formatearFecha(r[2]),
      price: Number(r[3]) || 0
    }));
}

function _parsearPeriodDesdeNombre(ss) {
  const MESES_NUM = {
    "ENERO":1,"FEBRERO":2,"MARZO":3,"ABRIL":4,"MAYO":5,"JUNIO":6,
    "JULIO":7,"AGOSTO":8,"SEPTIEMBRE":9,"OCTUBRE":10,"NOVIEMBRE":11,"DICIEMBRE":12
  };

  const partes = ss.getName().split(" ");
  const mesStr = partes[1];
  const year = parseInt(partes[2], 10);
  const month = MESES_NUM[mesStr];

  if (!year || !month) throw new Error(`No se pudo parsear el periodo del nombre: "${ss.getName()}"`);

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  return {
    year,
    month,
    name: `${mesStr} ${year}`,
    start_date: _formatearFecha(startDate),
    end_date: _formatearFecha(endDate)
  };
}

function _strOrNull(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length > 0 ? s : null;
}

function _numOrNull(val) {
  if (val === "" || val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function _post(path, payload) {
  const res = UrlFetchApp.fetch(`${API_URL}${path}`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Error en ${path}: HTTP ${code} - ${res.getContentText()}`);
  }

  return JSON.parse(res.getContentText());
}

function _get(path) {
  const res = UrlFetchApp.fetch(`${API_URL}${path}`, { muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Error en ${path}: HTTP ${code} - ${res.getContentText()}`);
  }
  return JSON.parse(res.getContentText());
}

function _formatearFecha(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  return d.toISOString().slice(0, 10);
}

function _uuidFromParts(prefix) {
  const args = Array.prototype.slice.call(arguments, 1).map((v) => String(v ?? "")).join("|");
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, `${prefix}|${args}`);
  const hex = bytes.map((b) => {
    const n = b < 0 ? b + 256 : b;
    return (n < 16 ? "0" : "") + n.toString(16);
  }).join("");
  const v = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return v;
}
