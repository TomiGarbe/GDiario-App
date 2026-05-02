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
  "pago_cliente": "Pago",
  "entrega_dinero": "Entrega"
};

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fetchFromBackend() {
  const startedAt = new Date().getTime();
  Logger.log("Fetch desde backend iniciado (sync/full v2)");

  const periodId = _getSyncPeriodId();
  const response = UrlFetchApp.fetch(`${API_URL}/sync/full?period_id=${encodeURIComponent(periodId)}`, { muteHttpExceptions: true });
  const code = response.getResponseCode();
  const raw = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error(`Error en fetch sync/full: HTTP ${code} - ${raw}`);
  }

  const data = JSON.parse(raw) || {};
  const payload = validatePayload(data);
  rebuildSheets(payload);

  const elapsedMs = new Date().getTime() - startedAt;
  Logger.log(
    `Rebuild completado | movements=${payload.movements.length} items=${payload.movement_items.length} salaries=${payload.movement_salaries.length} client_payments=${payload.movement_client_payments.length} duration_ms=${elapsedMs}`
  );
}

function syncToBackend() {
  Logger.log("Sync iniciado");

  const extracted = extractFromSheets();
  const normalized = normalizeData(extracted);
  const deduplicated = deduplicatePayload(normalized);
  const payload = buildSyncPayload(deduplicated);
  enforceNoIdCollisions(payload);
  validateBatch(payload);
  sendToBackend(payload);

  Logger.log("Sync completado");
}

function extractFromSheets() {
  const result = reconstruirMovimientos() || {};
  return {
    movements: Array.isArray(result.movements) ? result.movements : [],
    movement_items: Array.isArray(result.movement_items) ? result.movement_items : [],
    movement_salaries: Array.isArray(result.movement_salaries) ? result.movement_salaries : [],
    movement_client_payments: Array.isArray(result.movement_client_payments) ? result.movement_client_payments : []
  };
}

function normalizeData(raw) {
  const movementIdMap = _getOrCreateStableIdMap("movement");
  const itemIdMap = _getOrCreateStableIdMap("movement_item");
  const salaryIdMap = _getOrCreateStableIdMap("movement_salary");
  const clientPaymentIdMap = _getOrCreateStableIdMap("movement_client_payment");

  const existingIds = _loadExistingIdsFromSheets(raw);

  const clientsMap = {};
  const productsMap = {};
  const employeesMap = {};

  const movements = (raw.movements || []).map((m) => ({
    id: _ensureUuidImmutable(m && m.id, _movementFingerprint(m), movementIdMap, existingIds.movements),
    type: _normalizeMovementType(m && m.type),
    date: _formatearFecha(m && m.date),
    amount: _numOrNull(m && m.amount),
    description: _normalizeText(m && m.description),
    client: _mapNormalizedEntity(clientsMap, normalizeName(m && m.client))
  })).filter((m) => m.type && m.date && m.amount !== null);

  const movementIds = {};
  movements.forEach((m) => { movementIds[m.id] = true; });

  const movementItems = (raw.movement_items || []).map((it) => ({
    id: _ensureUuidImmutable(
      it && it.id,
      _movementItemFingerprint(it),
      itemIdMap,
      existingIds.movement_items
    ),
    movement_id: _ensureUuidImmutable(it && it.movement_id, _movementRefFingerprint(it && it.movement_id), movementIdMap, existingIds.movements),
    client_name: _mapNormalizedEntity(clientsMap, normalizeName(it && (it.client_name || it.client))),
    product_name: _mapNormalizedEntity(productsMap, normalizeName(it && (it.product_name || it.product))),
    quantity: _numOrNull(it && it.quantity),
    unit_price: _numOrNull(it && it.unit_price),
    subtotal: _numOrNull(it && it.subtotal)
  })).filter((it) => (
    movementIds[it.movement_id] &&
    it.client_name &&
    it.product_name &&
    it.quantity !== null &&
    it.unit_price !== null &&
    it.subtotal !== null
  ));

  const movementSalaries = (raw.movement_salaries || []).map((s) => ({
    id: _ensureUuidImmutable(
      s && s.id,
      _movementSalaryFingerprint(s),
      salaryIdMap,
      existingIds.movement_salaries
    ),
    movement_id: _ensureUuidImmutable(s && s.movement_id, _movementRefFingerprint(s && s.movement_id), movementIdMap, existingIds.movements),
    employee_name: _mapNormalizedEntity(employeesMap, normalizeName(s && (s.employee_name || s.employee))),
    subtotal: _numOrNull(s && (s.subtotal ?? s.amount)),
    description: _normalizeText(s && s.description)
  })).filter((s) => (
    movementIds[s.movement_id] &&
    s.employee_name &&
    s.subtotal !== null
  ));

  const movementClientPayments = (raw.movement_client_payments || []).map((cp) => ({
    id: _ensureUuidImmutable(
      cp && cp.id,
      _movementClientPaymentFingerprint(cp),
      clientPaymentIdMap,
      existingIds.movement_client_payments
    ),
    movement_id: _ensureUuidImmutable(cp && cp.movement_id, _movementRefFingerprint(cp && cp.movement_id), movementIdMap, existingIds.movements),
    client_name: _mapNormalizedEntity(clientsMap, normalizeName(cp && (cp.client_name || cp.client))),
    subtotal: _numOrNull(cp && (cp.subtotal ?? cp.amount)),
    description: _normalizeText(cp && cp.description)
  })).filter((cp) => (
    movementIds[cp.movement_id] &&
    cp.client_name &&
    cp.subtotal !== null
  ));

  return {
    movements,
    movement_items: movementItems,
    movement_salaries: movementSalaries,
    movement_client_payments: movementClientPayments
  };
}

function buildSyncPayload(data) {
  const syncBatchId = generateSyncBatchId();
  Logger.log(`sync_batch_id generado: ${syncBatchId}`);
  return {
    schema_version: "v2",
    sync_batch_id: syncBatchId,
    movements: data.movements || [],
    movement_items: data.movement_items || [],
    movement_salaries: (data.movement_salaries || []).map((s) => ({
      id: s.id,
      movement_id: s.movement_id,
      employee_name: s.employee_name,
      subtotal: s.subtotal
    })),
    movement_client_payments: (data.movement_client_payments || []).map((cp) => ({
      id: cp.id,
      movement_id: cp.movement_id,
      client_name: cp.client_name,
      subtotal: cp.subtotal
    }))
  };
}

function validateBatch(payload) {
  const sumsByMovement = {};

  payload.movements.forEach((m) => {
    sumsByMovement[m.id] = { movement_amount: _toCents(m.amount), details_sum: 0 };
  });

  payload.movement_items.forEach((it) => {
    const expectedSubtotal = _toCents((_numOrNull(it.quantity) || 0) * (_numOrNull(it.unit_price) || 0));
    const gotSubtotal = _toCents(it.subtotal);
    if (expectedSubtotal !== gotSubtotal) {
      errors.push({
        movement_id: it.movement_id,
        type: "ITEM_SUBTOTAL_MISMATCH",
        detail: `client=${it.client_name} product=${it.product_name} expected_subtotal=${(expectedSubtotal / 100).toFixed(2)} got_subtotal=${(gotSubtotal / 100).toFixed(2)}`
      });
    }
    if (!sumsByMovement[it.movement_id]) return;
    sumsByMovement[it.movement_id].details_sum += _toCents(it.subtotal);
  });

  payload.movement_salaries.forEach((s) => {
    if (!sumsByMovement[s.movement_id]) return;
    sumsByMovement[s.movement_id].details_sum += _toCents(s.subtotal);
  });

  payload.movement_client_payments.forEach((cp) => {
    if (!sumsByMovement[cp.movement_id]) return;
    sumsByMovement[cp.movement_id].details_sum += _toCents(cp.subtotal);
  });

  const errors = [];
  Object.keys(sumsByMovement).forEach((movementId) => {
    const movementAmount = sumsByMovement[movementId].movement_amount;
    const detailsSum = sumsByMovement[movementId].details_sum;
    if (movementAmount !== detailsSum) {
      errors.push({
        movement_id: movementId,
        type: "AMOUNT_MISMATCH",
        detail: `amount=${(movementAmount / 100).toFixed(2)} details_sum=${(detailsSum / 100).toFixed(2)}`
      });
    }
  });

  if (errors.length) {
    const lines = errors.map((e) => `movement_id=${e.movement_id} | ${e.type} | ${e.detail}`);
    throw new Error(`Validación fallida:\n${lines.join("\n")}`);
  }
}

function sendToBackend(payload) {
  const requestBody = payload;

  const response = UrlFetchApp.fetch(`${API_URL}/sync/full`, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const bodyText = response.getContentText();

  if (code < 200 || code >= 300) {
    _logBackendError(bodyText, payload);
    throw new Error(`Error en sync/full: HTTP ${code} - ${bodyText}`);
  }

  Logger.log("Sync completado: " + bodyText);
}

function _logBackendError(bodyText, payload) {
  let parsed = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch (e) {
    Logger.log("Backend error sin JSON parseable: " + bodyText);
    return;
  }

  const movementIds = {};
  payload.movements.forEach((m) => { movementIds[m.id] = true; });

  const detail = parsed && parsed.detail;
  if (Array.isArray(detail)) {
    detail.forEach((item) => {
      Logger.log(`Backend error | movement_id=unknown | type=validation | detail=${JSON.stringify(item)}`);
    });
    return;
  }

  let movementId = "unknown";
  if (typeof detail === "string") {
    const found = Object.keys(movementIds).find((id) => detail.indexOf(id) !== -1);
    if (found) movementId = found;
    Logger.log(`Backend error | movement_id=${movementId} | type=business | detail=${detail}`);
    return;
  }

  Logger.log(`Backend error | movement_id=unknown | type=unknown | detail=${bodyText}`);
}

function _normalizeMovementType(type) {
  const t = _strOrNull(type);
  if (!t) return null;
  const mapped = TIPO_MOVEMENT_TO_BACKEND[t] || t.toLowerCase();
  return mapped;
}

function _normalizeText(value) {
  const s = _strOrNull(value);
  if (!s) return null;
  return s.replace(/\s+/g, " ").trim();
}

function normalizeName(value) {
  const s = _normalizeText(value);
  if (!s) return null;
  return s
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function _normalizeName(value) {
  return normalizeName(value);
}

function _mapNormalizedEntity(entityMap, normalizedName) {
  if (!normalizedName) return null;
  if (!entityMap[normalizedName]) {
    entityMap[normalizedName] = normalizedName;
  }
  return entityMap[normalizedName];
}

function _ensureUuid(value) {
  const s = _strOrNull(value);
  if (!s) return Utilities.getUuid();
  if (UUID_V4_REGEX.test(s)) return s.toLowerCase();
  return Utilities.getUuid();
}

function generateUUID() {
  return Utilities.getUuid().toLowerCase();
}

function generateSyncBatchId() {
  return generateUUID();
}

function _ensureUuidImmutable(value, fingerprint, stableMap, existingIdSet) {
  const s = _strOrNull(value);
  if (s && UUID_V4_REGEX.test(s)) {
    if (fingerprint) stableMap[fingerprint] = s.toLowerCase();
    return s.toLowerCase();
  }
  if (fingerprint && stableMap[fingerprint] && UUID_V4_REGEX.test(stableMap[fingerprint])) {
    return stableMap[fingerprint].toLowerCase();
  }

  let generated = generateUUID();
  while (existingIdSet[generated]) {
    generated = generateUUID();
  }
  if (fingerprint) stableMap[fingerprint] = generated;
  existingIdSet[generated] = true;
  _saveStableIdMaps();
  return generated;
}

function _stableMapKey(namespace) {
  return `UUID_MAP_${namespace}`;
}

const _STABLE_ID_MAP_CACHE = {};

function _getOrCreateStableIdMap(namespace) {
  if (_STABLE_ID_MAP_CACHE[namespace]) return _STABLE_ID_MAP_CACHE[namespace];
  const raw = PropertiesService.getDocumentProperties().getProperty(_stableMapKey(namespace));
  let parsed = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) || {};
    } catch (e) {
      parsed = {};
    }
  }
  _STABLE_ID_MAP_CACHE[namespace] = parsed;
  return parsed;
}

function _saveStableIdMaps() {
  const props = PropertiesService.getDocumentProperties();
  Object.keys(_STABLE_ID_MAP_CACHE).forEach((namespace) => {
    props.setProperty(_stableMapKey(namespace), JSON.stringify(_STABLE_ID_MAP_CACHE[namespace]));
  });
}

function _fingerprint(parts) {
  return JSON.stringify(parts.map((p) => p === undefined || p === null ? "" : p));
}

function _movementFingerprint(m) {
  return _fingerprint([
    _normalizeMovementType(m && m.type),
    _formatearFecha(m && m.date),
    _numOrNull(m && m.amount),
    _normalizeText(m && m.description)
  ]);
}

function _movementRefFingerprint(movementId) {
  return _fingerprint([_strOrNull(movementId) || ""]);
}

function _movementItemFingerprint(it) {
  return _fingerprint([
    _strOrNull(it && it.movement_id),
    _normalizeName(it && (it.client_name || it.client)),
    _normalizeName(it && (it.product_name || it.product)),
    _numOrNull(it && it.quantity),
    _numOrNull(it && it.unit_price),
    _numOrNull(it && it.subtotal)
  ]);
}

function _movementSalaryFingerprint(s) {
  return _fingerprint([
    _strOrNull(s && s.movement_id),
    _normalizeName(s && (s.employee_name || s.employee)),
    _numOrNull(s && (s.subtotal ?? s.amount))
  ]);
}

function _movementClientPaymentFingerprint(cp) {
  return _fingerprint([
    _strOrNull(cp && cp.movement_id),
    _normalizeName(cp && (cp.client_name || cp.client)),
    _numOrNull(cp && (cp.subtotal ?? cp.amount))
  ]);
}

function _loadExistingIdsFromSheets(raw) {
  const ids = {
    movements: {},
    movement_items: {},
    movement_salaries: {},
    movement_client_payments: {}
  };

  (raw.movements || []).forEach((m) => {
    const id = _strOrNull(m && m.id);
    if (id && UUID_V4_REGEX.test(id)) ids.movements[id.toLowerCase()] = true;
  });
  (raw.movement_items || []).forEach((it) => {
    const id = _strOrNull(it && it.id);
    if (id && UUID_V4_REGEX.test(id)) ids.movement_items[id.toLowerCase()] = true;
    const movementId = _strOrNull(it && it.movement_id);
    if (movementId && UUID_V4_REGEX.test(movementId)) ids.movements[movementId.toLowerCase()] = true;
  });
  (raw.movement_salaries || []).forEach((s) => {
    const id = _strOrNull(s && s.id);
    if (id && UUID_V4_REGEX.test(id)) ids.movement_salaries[id.toLowerCase()] = true;
    const movementId = _strOrNull(s && s.movement_id);
    if (movementId && UUID_V4_REGEX.test(movementId)) ids.movements[movementId.toLowerCase()] = true;
  });
  (raw.movement_client_payments || []).forEach((cp) => {
    const id = _strOrNull(cp && cp.id);
    if (id && UUID_V4_REGEX.test(id)) ids.movement_client_payments[id.toLowerCase()] = true;
    const movementId = _strOrNull(cp && cp.movement_id);
    if (movementId && UUID_V4_REGEX.test(movementId)) ids.movements[movementId.toLowerCase()] = true;
  });
  return ids;
}

function deduplicatePayload(payload) {
  const original = {
    movements: (payload.movements || []).length,
    movement_items: (payload.movement_items || []).length,
    movement_salaries: (payload.movement_salaries || []).length,
    movement_client_payments: (payload.movement_client_payments || []).length
  };
  const duplicateLogs = [];

  const movementsSeen = {};
  const movements = (payload.movements || []).filter((m) => {
    if (movementsSeen[m.id]) {
      duplicateLogs.push(`movements duplicate id=${m.id}`);
      return false;
    }
    movementsSeen[m.id] = true;
    return true;
  });

  const itemsSeen = {};
  const movementItems = (payload.movement_items || []).filter((it) => {
    const key = _fingerprint([it.movement_id, it.client_name, it.product_name, it.quantity, it.unit_price, it.subtotal]);
    if (itemsSeen[key]) {
      duplicateLogs.push(`movement_items duplicate key=${key}`);
      return false;
    }
    itemsSeen[key] = true;
    return true;
  });

  const salariesSeen = {};
  const movementSalaries = (payload.movement_salaries || []).filter((s) => {
    const key = _fingerprint([s.movement_id, s.employee_name, s.subtotal]);
    if (salariesSeen[key]) {
      duplicateLogs.push(`movement_salaries duplicate key=${key}`);
      return false;
    }
    salariesSeen[key] = true;
    return true;
  });

  const clientPaymentsSeen = {};
  const movementClientPayments = (payload.movement_client_payments || []).filter((cp) => {
    const key = _fingerprint([cp.movement_id, cp.client_name, cp.subtotal]);
    if (clientPaymentsSeen[key]) {
      duplicateLogs.push(`movement_client_payments duplicate key=${key}`);
      return false;
    }
    clientPaymentsSeen[key] = true;
    return true;
  });

  duplicateLogs.forEach((line) => Logger.log(`DEDUP_WARNING ${line}`));
  Logger.log(
    `DEDUP_SUMMARY movements=${original.movements}->${movements.length} items=${original.movement_items}->${movementItems.length} salaries=${original.movement_salaries}->${movementSalaries.length} client_payments=${original.movement_client_payments}->${movementClientPayments.length}`
  );

  return {
    movements,
    movement_items: movementItems,
    movement_salaries: movementSalaries,
    movement_client_payments: movementClientPayments
  };
}

function enforceNoIdCollisions(payload) {
  _assertNoIdCollisions(
    payload.movements || [],
    "movements",
    (m) => _fingerprint([m.type, m.date, m.amount, m.description])
  );
  _assertNoIdCollisions(
    payload.movement_items || [],
    "movement_items",
    (it) => _fingerprint([it.movement_id, it.client_name, it.product_name, it.quantity, it.unit_price, it.subtotal])
  );
  _assertNoIdCollisions(
    payload.movement_salaries || [],
    "movement_salaries",
    (s) => _fingerprint([s.movement_id, s.employee_name, s.subtotal])
  );
  _assertNoIdCollisions(
    payload.movement_client_payments || [],
    "movement_client_payments",
    (cp) => _fingerprint([cp.movement_id, cp.client_name, cp.subtotal])
  );
}

function _assertNoIdCollisions(rows, entityName, hashFn) {
  const byId = {};
  rows.forEach((row) => {
    const id = _strOrNull(row && row.id);
    if (!id) return;
    const hash = hashFn(row);
    if (byId[id] && byId[id] !== hash) {
      throw new Error(`COLLISION_CRITICA ${entityName} id=${id} tiene contenido distinto en el mismo sync`);
    }
    byId[id] = hash;
  });
}

function _toCents(value) {
  const n = _numOrNull(value);
  if (n === null) return 0;
  return Math.round(n * 100);
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

function _formatearFecha(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function _getSyncPeriodId() {
  const scriptProp = PropertiesService.getScriptProperties().getProperty("SYNC_PERIOD_ID");
  const docProp = PropertiesService.getDocumentProperties().getProperty("SYNC_PERIOD_ID");
  const raw = _strOrNull(scriptProp) || _strOrNull(docProp);
  if (!raw) {
    throw new Error("Falta SYNC_PERIOD_ID. Configuralo en ScriptProperties o DocumentProperties.");
  }

  const periodId = Number(raw);
  if (!Number.isInteger(periodId) || periodId <= 0) {
    throw new Error(`SYNC_PERIOD_ID inválido: ${raw}`);
  }
  return periodId;
}

function validatePayload(data) {
  if (!data || data.schema_version !== "v2") {
    throw new Error(`Payload inválido: schema_version esperado "v2", recibido "${data && data.schema_version}"`);
  }

  const required = ["movements", "movement_items", "movement_salaries", "movement_client_payments"];
  required.forEach((key) => {
    if (!Array.isArray(data[key])) {
      throw new Error(`Payload inválido: falta array obligatorio "${key}"`);
    }
  });

  return {
    movements: data.movements,
    movement_items: data.movement_items,
    movement_salaries: data.movement_salaries,
    movement_client_payments: data.movement_client_payments
  };
}

function rebuildSheets(payload) {
  clearMovements();
  writeMovementItems([]);
  writeMovementSalaries([]);
  writeMovementClientPayments([]);

  writeMovements((payload.movements || []).map((m) => ({
    id: m.id,
    type: TIPO_MOVEMENT_FROM_BACKEND[m.type] || m.type,
    date: m.date,
    amount: m.amount,
    description: m.description || "",
    source: "sync"
  })));

  writeMovementItems((payload.movement_items || []).map((it) => ({
    movement_id: it.movement_id,
    client: it.client_name,
    product: it.product_name,
    quantity: it.quantity,
    unit_price: it.unit_price,
    subtotal: it.subtotal
  })));

  writeMovementSalaries((payload.movement_salaries || []).map((s) => ({
    movement_id: s.movement_id,
    employee: s.employee_name,
    subtotal: s.subtotal
  })));

  writeMovementClientPayments((payload.movement_client_payments || []).map((cp) => ({
    movement_id: cp.movement_id,
    client_name: cp.client_name,
    subtotal: cp.subtotal
  })));

  _logRebuildConsistency(payload);
}

function _logRebuildConsistency(payload) {
  const movementAmountCents = {};
  (payload.movements || []).forEach((m) => {
    movementAmountCents[m.id] = _toCents(m.amount);
  });

  const detailsCents = {};
  const addDetail = function (movementId, subtotal) {
    if (movementAmountCents[movementId] === undefined) return;
    if (detailsCents[movementId] === undefined) detailsCents[movementId] = 0;
    detailsCents[movementId] += _toCents(subtotal);
  };

  (payload.movement_items || []).forEach((it) => addDetail(it.movement_id, it.subtotal));
  (payload.movement_salaries || []).forEach((s) => addDetail(s.movement_id, s.subtotal));
  (payload.movement_client_payments || []).forEach((cp) => addDetail(cp.movement_id, cp.subtotal));

  Object.keys(movementAmountCents).forEach((movementId) => {
    const expected = movementAmountCents[movementId];
    const got = detailsCents[movementId] || 0;
    if (expected !== got) {
      Logger.log(
        `REBUILD_CONSISTENCY_ERROR movement_id=${movementId} amount=${(expected / 100).toFixed(2)} details_sum=${(got / 100).toFixed(2)}`
      );
    }
  });
}



