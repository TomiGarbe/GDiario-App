const API_BASE_URL = String(
  window.API_URL || window.NEXT_PUBLIC_API_URL || "https://gdiario.azurewebsites.net/api"
).trim().replace(/\/$/, "");

var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getTodayIso() {
  if (typeof hoyArgentinaISO === 'function') return hoyArgentinaISO();

  var now = new Date();
  var y = now.getFullYear();
  var m = String(now.getMonth() + 1).padStart(2, '0');
  var d = String(now.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function toNum(value) {
  var n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parsePrecio(value) {
  if (value == null) return 0;

  var v = String(value).trim();
  if (v === '') return 0;

  v = v.replace(/\$/g, '').replace(/\./g, '').replace(',', '.');

  var num = Number(v);
  if (!Number.isFinite(num) || isNaN(num)) return 0;

  return num < 0 ? 0 : num;
}

function isValidUUID(value) {
  return UUID_RE.test(String(value || '').trim());
}

function toIsoDate(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  var d = new Date(raw);
  if (isNaN(d.getTime())) return '';

  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function getPeriodIdFromDate(fecha) {
  var iso = toIsoDate(fecha) || getTodayIso();
  var y = Number(iso.slice(0, 4));
  var m = Number(iso.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 0;
  return y * 100 + m;
}

function sanitizeQueryParams(params) {
  var src = params && typeof params === 'object' ? params : {};
  var out = Object.create(null);

  Object.keys(src).forEach(function(k) {
    var v = src[k];
    if (v == null) return;

    if (typeof v === 'string') {
      var t = v.trim();
      if (!t || t.toLowerCase() === 'null' || t.toLowerCase() === 'undefined') return;
      out[k] = t;
      return;
    }

    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return;
      out[k] = String(v);
      return;
    }

    if (typeof v === 'boolean') {
      out[k] = v ? 'true' : 'false';
    }
  });

  ['id', 'movement_id', 'client_id', 'product_id', 'price_id'].forEach(function(idKey) {
    if (Object.prototype.hasOwnProperty.call(out, idKey) && !isValidUUID(out[idKey])) {
      delete out[idKey];
    }
  });

  return out;
}

function buildQueryString(params) {
  var clean = sanitizeQueryParams(params);
  var pairs = [];

  Object.keys(clean).forEach(function(k) {
    pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(clean[k]));
  });

  return pairs.length ? ('?' + pairs.join('&')) : '';
}

function mapBackendMovementToLegacy(mov) {
  var m = mov || {};
  var num = function(v) { return Number(v == null ? 0 : v); };
  var type = String(m.type || '').toLowerCase();
  var items = Array.isArray(m.items) ? m.items : [];
  var salaries = Array.isArray(m.salaries) ? m.salaries : [];
  var clientPayments = Array.isArray(m.client_payments) ? m.client_payments : [];

  switch (type) {
    case 'compra':
    case 'venta':
      return {
        id: m.id,
        fecha: m.date,
        tipo: type === 'compra' ? 'Compra' : 'Descarga',
        cliente: items[0] && items[0].client ? items[0].client : '',
        producto: items[0] && items[0].product ? items[0].product : '',
        kg: num(items[0] && items[0].quantity),
        monto: num(m.amount),
        datos: {
          productos: items.map(function(i) {
            return {
              producto: i && i.product ? i.product : '',
              kg: num(i && i.quantity),
              precio: num(i && i.unit_price)
            };
          })
        },
        detalle: m.description || '',
        editable: true
      };
    case 'sueldo':
      return {
        id: m.id,
        fecha: m.date,
        tipo: 'Gasto',
        cliente: '',
        monto: num(m.amount),
        datos: {
          empleados: salaries.map(function(s) {
            return {
              nombre: s && s.employee ? s.employee : '',
              monto: num(s && s.subtotal)
            };
          })
        },
        detalle: m.description || 'Ayudantes',
        editable: true
      };
    case 'gasto':
      return {
        id: m.id,
        fecha: m.date,
        tipo: 'Gasto',
        cliente: '',
        monto: num(m.amount),
        detalle: m.description || 'Gasto',
        datos: null,
        editable: true
      };
    case 'pago_cliente':
      return {
        id: m.id,
        fecha: m.date,
        tipo: 'Pago a cliente',
        cliente: clientPayments[0] && clientPayments[0].client ? clientPayments[0].client : '',
        monto: num(m.amount),
        detalle: m.description || '',
        editable: true
      };
    case 'entrega_dinero':
      return {
        id: m.id,
        fecha: m.date,
        tipo: 'Entrega de dinero',
        cliente: '',
        monto: num(m.amount),
        detalle: m.description || 'Entrega de dinero',
        editable: false
      };
    default:
      return {
        id: m.id,
        fecha: m.date,
        tipo: 'Movimiento',
        cliente: '',
        monto: num(m.amount),
        detalle: m.description || '',
        datos: null,
        editable: true
      };
  }
}

function buildCompraDetails(item) {
  var productos = Array.isArray(item && item.productos) ? item.productos : [];
  var montoTotal = toNum(item && item.montoTotal);
  var totalKg = productos.reduce(function(acc, p) { return acc + Math.max(0, toNum(p && p.kg)); }, 0);
  var pricePerKg = totalKg > 0 && montoTotal > 0 ? (montoTotal / totalKg) : 0;

  return productos
    .map(function(p) {
      var product = String(p && p.producto || '').trim();
      var qty = Math.max(0, toNum(p && p.kg));
      var explicitRaw = p && p.unit_price;
      if (explicitRaw == null || explicitRaw === '') explicitRaw = p && p.precio;
      var explicit = Math.max(0, parsePrecio(explicitRaw));
      var unit = explicit > 0 ? explicit : Math.max(0, pricePerKg);
      if (!product || !(qty > 0) || !(unit >= 0)) return null;

      return {
        product: product,
        quantity: qty,
        unit_price: unit
      };
    })
    .filter(Boolean);
}

function buildLegacyMovementCreate(item, fecha) {
  var tipo = String(item && item.tipo || '').trim().toLowerCase();
  var fechaIso = toIsoDate(fecha) || getTodayIso();
  var periodId = getPeriodIdFromDate(fechaIso);

  if (tipo === 'compra') {
    var clientCompra = item && item.cliente ? String(item.cliente).trim() : '';
    var compraItems = buildCompraDetails(item).map(function(d) {
      var qty = Math.max(0, toNum(d && d.quantity));
      var rawPrice = d && d.unit_price;
      var price = (rawPrice == null || rawPrice === '')
        ? 0
        : Math.max(0, toNum(rawPrice));
      return {
        client: clientCompra,
        product: d && d.product ? String(d.product).trim() : '',
        quantity: qty,
        unit_price: price,
        subtotal: qty * price
      };
    }).filter(function(it) {
      return !!it.client && !!it.product && it.quantity > 0 && it.unit_price >= 0 && it.subtotal >= 0;
    });

    var amountCompra = compraItems.reduce(function(acc, it) { return acc + toNum(it.subtotal); }, 0);
    if (!compraItems.length) {
      throw new Error('Compra invalida: faltan cliente/producto o cantidades');
    }

    return {
      period_id: periodId,
      date: fechaIso,
      type: 'compra',
      amount: amountCompra,
      description: 'Compra',
      items: compraItems
    };
  }

  if (tipo === 'descarga') {
    var kgDesc = Math.max(0, toNum(item && item.kg));
    var montoDesc = Math.max(0, toNum(item && item.montoTotal != null ? item.montoTotal : item && item.monto));
    var precioDesc = Math.max(0, toNum(item && item.precio));
    if (!(precioDesc > 0) && kgDesc > 0 && montoDesc > 0) {
      precioDesc = montoDesc / kgDesc;
    }
    var subtotalDesc = kgDesc * precioDesc;
    if (!(kgDesc > 0) || !(precioDesc >= 0) || !(subtotalDesc >= 0)) {
      throw new Error('Descarga invalida: se requiere kg');
    }

    var clientVenta = item && item.cliente ? String(item.cliente).trim() : '';
    var productVenta = item && item.producto ? String(item.producto).trim() : 'Producto';
    if (!clientVenta || !productVenta) {
      throw new Error('Descarga invalida: faltan cliente o producto');
    }

    return {
      period_id: periodId,
      date: fechaIso,
      type: 'venta',
      amount: subtotalDesc,
      description: 'Descarga',
      items: [{
        client: clientVenta,
        product: productVenta,
        quantity: kgDesc,
        unit_price: precioDesc,
        subtotal: subtotalDesc
      }]
    };
  }

  if (tipo === 'pago a cliente') {
    var montoPago = Math.max(0, toNum(item && item.monto));
    var clientePago = item && item.cliente ? String(item.cliente).trim() : '';
    if (!(montoPago >= 0) || !clientePago) {
      throw new Error('Pago a cliente invalido: se requiere cliente y monto mayor o igual a 0');
    }

    return {
      period_id: periodId,
      date: fechaIso,
      type: 'pago_cliente',
      amount: montoPago,
      description: 'Pago a cliente',
      client_payments: [{ client: clientePago, subtotal: montoPago }]
    };
  }

  throw new Error('Tipo de movimiento no soportado: ' + String(item && item.tipo || ''));
}

function buildLegacySingleMovementUpdate(payload) {
  var fecha = String(payload && payload.fecha || '').trim();
  var fechaIso = toIsoDate(fecha) || getTodayIso();
  var periodId = getPeriodIdFromDate(fechaIso);

  if (Array.isArray(payload && payload.productos) && payload.productos.length === 1) {
    return buildLegacyMovementCreate(payload.productos[0], fechaIso);
  }

  var tipo = String(payload && payload.tipo || '').trim().toLowerCase();

  if (tipo === 'entrega de dinero' || tipo === 'entrega') {
    var montoEntrega = Math.max(0, toNum(payload && payload.monto));
    if (!(montoEntrega > 0)) throw new Error('La entrega debe tener un monto mayor a 0');

    return {
      period_id: periodId,
      date: fechaIso,
      type: 'entrega_dinero',
      amount: montoEntrega,
      description: payload && payload.detalle ? String(payload.detalle).trim() : 'Entrega de dinero',
      items: [],
      salaries: [],
      client_payments: []
    };
  }

  if (tipo === 'gasto') {
    var empleados = Array.isArray(payload && payload.empleados) ? payload.empleados : [];

    if (empleados.length) {
      var salaries = empleados.map(function(emp) {
        return {
          employee: String(emp && emp.nombre || '').trim(),
          subtotal: Math.max(0, toNum(emp && emp.monto))
        };
      }).filter(function(d) { return !!d.employee && d.subtotal > 0; });

      var amountSueldo = salaries.reduce(function(acc, s) { return acc + toNum(s.subtotal); }, 0);
      if (!salaries.length || !(amountSueldo > 0)) throw new Error('Gasto de ayudantes invalido');

      return {
        period_id: periodId,
        date: fechaIso,
        type: 'sueldo',
        amount: amountSueldo,
        description: payload && payload.detalle ? String(payload.detalle).trim() : 'Gasto',
        salaries: salaries
      };
    }

    var amountGasto = Math.max(0, toNum(payload && payload.monto));
    if (!(amountGasto > 0)) throw new Error('El gasto debe tener un monto mayor a 0');

    return {
      period_id: periodId,
      date: fechaIso,
      type: 'gasto',
      amount: amountGasto,
      description: payload && payload.detalle ? String(payload.detalle).trim() : 'Gasto',
      items: [],
      salaries: [],
      client_payments: []
    };
  }

  throw new Error('Payload de edicion no soportado');
}

function extractErrorMessage(response, payload) {
  if (payload && typeof payload.detail === 'string') return payload.detail;
  if (payload && Array.isArray(payload.detail) && payload.detail[0] && payload.detail[0].msg) {
    return String(payload.detail[0].msg);
  }
  if (payload && typeof payload.message === 'string') return payload.message;
  return 'HTTP ' + response.status;
}


function buildHttpError(response, payload, rawText) {
  var detail = payload && typeof payload === 'object' && payload.detail !== undefined
    ? payload.detail
    : payload;
  var message = extractErrorMessage(response, payload);
  var err = new Error(String(message || rawText || ('HTTP ' + response.status)));

  err.status = response.status;
  err.response = {
    status: response.status,
    data: detail
  };
  err.payload = payload;
  err.raw = rawText;
  return err;
}
function isAuthExemptPath(path) {
  var p = String(path || '').trim();
  return p === '/auth/google';
}

function handleUnauthorized() {
  console.error('Token invalido o expirado');
  if (typeof forceLogoutAndRedirect === 'function') {
    forceLogoutAndRedirect();
    return;
  }
  try {
    localStorage.removeItem('token');
  } catch (_) {
    // Ignore storage errors.
  }
  window.location.href = '/login.html';
}
function request(path, opts) {
  var options = opts || {};
  var url = API_BASE_URL + (path.startsWith('/') ? path : ('/' + path));
  var method = options.method || 'GET';
  var bodyPayload = options.body !== undefined ? options.body : undefined;


  var token = '';
  try {
    token = String(localStorage.getItem('token') || '').trim();
    if (!token && typeof obtenerUsuario === 'function') {
      var usuario = obtenerUsuario();
      token = String(usuario && usuario.token || '').trim();
    }
  } catch (_) {
    token = '';
  }

  var authHeaders = {};
  var authExempt = isAuthExemptPath(path);

  if (!authExempt) {
    if (!token) {
      handleUnauthorized();
      return Promise.reject(new Error('No auth token'));
    }
    authHeaders.Authorization = 'Bearer ' + token;
  }

  var headers = Object.assign({
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }, authHeaders, options.headers || {});

  return fetch(url, {
    method: method,
    headers: headers,
    body: bodyPayload !== undefined ? JSON.stringify(bodyPayload) : undefined
  }).then(function(response) {
    if (response.status === 401) {
      handleUnauthorized();
      return null;
    }

    if (response.status === 204) return null;

    return response.text().then(function(raw) {
      var txt = String(raw == null ? '' : raw).trim();

      var payload = null;
      try {
        payload = txt ? JSON.parse(txt) : null;
      } catch (_) {
        payload = null;
      }

      if (!response.ok) {
        throw buildHttpError(response, payload, txt);
      }

      return payload;
    });
  }).catch(function(err) {
    var msg = String(err && err.message ? err.message : err || '').toLowerCase();
    if (msg.indexOf('failed to fetch') !== -1 || msg.indexOf('networkerror') !== -1) {
      throw new Error('No se pudo conectar con el backend');
    }
    throw err;
  });
}

function getInitialData() {
  return request('/movements/entities').then(function(payload) {
    var clientsRaw = Array.isArray(payload && payload.clients) ? payload.clients : [];
    var clientes = [];
    var productosMap = Object.create(null);
    var precios = Object.create(null);

    clientsRaw.forEach(function(client) {
      var clientName = String(client && client.name || '').trim();
      if (!clientName) return;

      clientes.push(clientName);

      var products = Array.isArray(client && client.products) ? client.products : [];
      var preciosCliente = Object.create(null);

      products.forEach(function(product) {
        var productName = String(product && product.product_name || '').trim();
        var rawPrice = product ? product.price : null;
        var productPrice = Number(rawPrice);
        if (!productName || rawPrice === null || rawPrice === undefined || !Number.isFinite(productPrice)) return;

        productosMap[productName] = true;
        preciosCliente[productName] = [{ fecha: getTodayIso(), precio: productPrice }];
      });

      precios[clientName] = preciosCliente;
    });

    return {
      clientes: clientes,
      productos: Object.keys(productosMap),
      precios: precios,
      clientesEspeciales: []
    };
  });
}

function apiLoginWithGoogle(idToken) {
  var googleToken = String(idToken || '').trim();
  if (!googleToken) return Promise.reject(new Error('Token de Google requerido'));

  return request('/auth/google', {
    method: 'POST',
    body: {
      id_token: googleToken
    }
  }).then(function(resp) {
    var token = String(resp && resp.access_token || '').trim();
    if (!token) throw new Error('Respuesta de login inv�lida');
    return { access_token: token };
  });
}

function fetchConAuth(data) {
  var payload = data || {};
  var action = String(payload.action || payload.accion || '').trim();

  if (!action) {
    return Promise.reject(new Error('Accion requerida'));
  }

  if (action === 'getInitialData') {
    return getInitialData();
  }

  if (action === 'obtenerSaldo') {
    return request('/movements/balance').then(function(resp) {
      return { saldo: toNum(resp && resp.balance) };
    });
  }

  if (action === 'obtenerMovimientos' || action === 'obtenerMovimientosDia') {
    var fechaMov = String(payload.fecha || '').trim();
    var qsMov = buildQueryString({
      date_from: fechaMov || undefined,
      date_to: fechaMov || undefined,
      period_id: getPeriodIdFromDate(fechaMov || getTodayIso()),
      limit: 1000
    });

    return request('/movements' + qsMov).then(function(lista) {
      var arr = Array.isArray(lista) ? lista : [];
      if (fechaMov) {
        arr = arr.filter(function(m) {
          return String(m && m.date || '').trim() === fechaMov;
        });
      }
      return { movimientos: arr.map(mapBackendMovementToLegacy) };
    });
  }

  if (action === 'guardarMovimiento') {
    var fechaBase = String(payload.fecha || '').trim();
    var items = Array.isArray(payload.productos) ? payload.productos : [];
    var chain = Promise.resolve();

    items.forEach(function(item) {
      chain = chain.then(function() {
        return request('/movements', {
          method: 'POST',
          body: buildLegacyMovementCreate(item, fechaBase)
        });
      });
    });

    return chain.then(function() { return { ok: true }; });
  }

  if (action === 'guardarGasto') {
    var gastoPayload = buildLegacySingleMovementUpdate({
      fecha: payload.fecha,
      tipo: 'Gasto',
      detalle: payload.tipo,
      monto: payload.monto,
      empleados: payload.empleados || []
    });

    return request('/movements', {
      method: 'POST',
      body: gastoPayload
    }).then(function() { return { ok: true }; });
  }

  if (action === 'registrarEntrega') {
    var entregaPayload = buildLegacySingleMovementUpdate({
      fecha: payload.fecha,
      tipo: 'Entrega de dinero',
      detalle: 'Entrega de dinero',
      monto: payload.monto,
      cliente: ''
    });

    return request('/movements', {
      method: 'POST',
      body: entregaPayload
    }).then(function() { return { ok: true }; });
  }

  if (action === 'eliminarMovimiento') {
    var ids = [];
    if (Array.isArray(payload.ids)) ids = payload.ids;
    else if (payload.id) ids = [payload.id];

    var delChain = Promise.resolve();
    ids.forEach(function(id) {
      delChain = delChain.then(function() {
        var movementId = String(id || '').trim();
        if (!isValidUUID(movementId)) {
          console.warn('eliminarMovimiento: ID invalido omitido', movementId);
          return null;
        }

        return request('/movements/' + encodeURIComponent(movementId), {
          method: 'DELETE'
        });
      });
    });

    return delChain.then(function() { return { ok: true }; });
  }

  if (action === 'editarMovimiento') {
    var id = String(payload.id || '').trim();
    if (!isValidUUID(id)) return Promise.reject(new Error('ID invalido'));

    var updateBody = buildLegacySingleMovementUpdate(payload.data || {});

    return request('/movements/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: updateBody
    }).then(function() { return { ok: true }; });
  }

  return Promise.reject(new Error('Accion no soportada: ' + action));
}

function api(action, data) {
  var payload = Object.assign({}, data || {}, { action: action });
  return fetchConAuth(payload);
}

window.apiLoginWithGoogle = apiLoginWithGoogle;
window.fetchConAuth = fetchConAuth;
window.api = api;
window.API_BASE_URL = API_BASE_URL;
window.isValidUUID = isValidUUID;



