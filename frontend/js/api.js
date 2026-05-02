const API_BASE_URL = String(
  window.API_URL || window.NEXT_PUBLIC_API_URL || "https://gdiario-app.onrender.com/api"
).trim().replace(/\/$/, "");

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

function detailToLegacy(d) {
  return {
    producto: d && d.product ? String(d.product).trim() : '',
    kg: d && d.quantity != null ? toNum(d.quantity) : 0,
    precio: d && d.unit_price != null ? toNum(d.unit_price) : 0,
    subtotal: d && d.subtotal != null ? toNum(d.subtotal) : 0,
    empleado: d && d.employee ? String(d.employee).trim() : ''
  };
}

function mapMovementTypeToLegacy(mov) {
  var type = String(mov && mov.type || '').toLowerCase();
  var details = Array.isArray(mov && mov.details) ? mov.details : [];

  if (type === 'compra') return 'Compra';
  if (type === 'venta') return 'Descarga';
  if (type === 'pago') {
    var desc = String(mov && mov.description || '').toLowerCase();
    if (desc.indexOf('entrega') !== -1) return 'Entrega de dinero';
    return 'Pago a cliente';
  }
  if (type === 'sueldo') return 'Gasto';
  if (type === 'gasto') {
    var hasEmployee = details.some(function(d) { return !!(d && d.employee); });
    return hasEmployee ? 'Gasto' : 'Gasto';
  }
  return 'Movimiento';
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
      if (!product || !(qty > 0)) return null;

      return {
        type: 'producto',
        product: product,
        quantity: qty,
        unit_price: pricePerKg > 0 ? pricePerKg : 0
      };
    })
    .filter(Boolean);
}

function buildLegacyMovementCreate(item, fecha) {
  var tipo = String(item && item.tipo || '').trim().toLowerCase();

  if (tipo === 'compra') {
    return {
      date: fecha,
      type: 'compra',
      client: item && item.cliente ? String(item.cliente).trim() : null,
      employee: null,
      description: 'Compra',
      details: buildCompraDetails(item)
    };
  }

  if (tipo === 'descarga') {
    var kgDesc = Math.max(0, toNum(item && item.kg));
    return {
      date: fecha,
      type: 'venta',
      client: item && item.cliente ? String(item.cliente).trim() : null,
      employee: null,
      description: 'Descarga',
      details: [{
        type: 'producto',
        product: item && item.producto ? String(item.producto).trim() : 'Producto',
        quantity: kgDesc,
        unit_price: 0
      }]
    };
  }

  if (tipo === 'pago a cliente') {
    var montoPago = Math.max(0, toNum(item && item.monto));
    return {
      date: fecha,
      type: 'pago',
      client: item && item.cliente ? String(item.cliente).trim() : null,
      employee: null,
      description: 'Pago a cliente',
      details: [{ type: 'gasto', quantity: 1, unit_price: montoPago }]
    };
  }

  throw new Error('Tipo de movimiento no soportado: ' + String(item && item.tipo || ''));
}

function buildLegacySingleMovementUpdate(payload) {
  var fecha = String(payload && payload.fecha || '').trim();

  if (Array.isArray(payload && payload.productos) && payload.productos.length === 1) {
    return buildLegacyMovementCreate(payload.productos[0], fecha);
  }

  var tipo = String(payload && payload.tipo || '').trim().toLowerCase();

  if (tipo === 'entrega de dinero' || tipo === 'entrega') {
    var montoEntrega = Math.max(0, toNum(payload && payload.monto));
    return {
      date: fecha,
      type: 'pago',
      client: payload && payload.cliente ? String(payload.cliente).trim() : null,
      employee: null,
      description: payload && payload.detalle ? String(payload.detalle).trim() : 'Entrega de dinero',
      details: [{ type: 'gasto', quantity: 1, unit_price: montoEntrega }]
    };
  }

  if (tipo === 'gasto') {
    var empleados = Array.isArray(payload && payload.empleados) ? payload.empleados : [];
    var details = [];

    if (empleados.length) {
      details = empleados.map(function(emp) {
        return {
          type: 'empleado',
          employee: String(emp && emp.nombre || '').trim(),
          quantity: 1,
          unit_price: Math.max(0, toNum(emp && emp.monto))
        };
      }).filter(function(d) { return !!d.employee && d.unit_price > 0; });
    } else {
      details = [{
        type: 'gasto',
        quantity: 1,
        unit_price: Math.max(0, toNum(payload && payload.monto))
      }];
    }

    return {
      date: fecha,
      type: empleados.length ? 'sueldo' : 'gasto',
      client: null,
      employee: null,
      description: payload && payload.detalle ? String(payload.detalle).trim() : 'Gasto',
      details: details
    };
  }

  throw new Error('Payload de edición no soportado');
}

function extractErrorMessage(response, payload) {
  if (payload && typeof payload.detail === 'string') return payload.detail;
  if (payload && Array.isArray(payload.detail) && payload.detail[0] && payload.detail[0].msg) {
    return String(payload.detail[0].msg);
  }
  if (payload && typeof payload.message === 'string') return payload.message;
  return 'HTTP ' + response.status;
}

function request(path, opts) {
  var options = opts || {};
  var url = API_BASE_URL + (path.startsWith('/') ? path : ('/' + path));

  return fetch(url, {
    method: options.method || 'GET',
    headers: Object.assign({
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }, options.headers || {}),
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  }).then(function(response) {
    if (response.status === 204) return null;

    return response.text().then(function(raw) {
      var txt = String(raw == null ? '' : raw).trim();
      var payload = txt ? JSON.parse(txt) : null;

      if (!response.ok) {
        throw new Error(extractErrorMessage(response, payload));
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
  return request('/movements/entities').then(function(entities) {
    var payload = entities || {};
    return {
      clientes: Array.isArray(payload.clients) ? payload.clients : [],
      productos: Array.isArray(payload.products) ? payload.products : [],
      precios: {},
      clientesEspeciales: []
    };
  });
}

function apiLoginWithGoogle(credential) {
  var cred = String(credential || '').trim();
  if (!cred) return Promise.reject(new Error('Token requerido'));

  var payload = (typeof parseJwt === 'function' ? parseJwt(cred) : null) || {};
  var email = String(payload.email || '').trim().toLowerCase();

  return Promise.resolve({
    ok: true,
    token: cred,
    email: email || 'usuario@local'
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
    var fecha = String(payload.fecha || payload.date || getTodayIso()).trim();
    return request('/movements/balance?date_from=' + encodeURIComponent(fecha) + '&date_to=' + encodeURIComponent(fecha))
      .then(function(r) {
        return { saldo: toNum(r && r.balance) };
      });
  }

  if (action === 'obtenerMovimientos' || action === 'obtenerMovimientosDia') {
    var fechaMov = String(payload.fecha || '').trim();
    return request('/movements').then(function(lista) {
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
        return request('/movements/' + encodeURIComponent(String(id).trim()), {
          method: 'DELETE'
        });
      });
    });

    return delChain.then(function() { return { ok: true }; });
  }

  if (action === 'editarMovimiento') {
    var id = String(payload.id || '').trim();
    if (!id) return Promise.reject(new Error('ID requerido'));

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

