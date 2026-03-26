var APP_DATA_CACHE_KEY = 'gd_app_data_v1';
var _cargaDatosInicialesPendiente = null;

var appData = window.appData && typeof window.appData === 'object'
  ? window.appData
  : {
    clientes: [],
    productos: [],
    precios: {},
    clientesEspeciales: []
  };

var clientes = Array.isArray(appData.clientes) ? appData.clientes.slice() : [];
var clientesEspeciales = Array.isArray(appData.clientesEspeciales) ? appData.clientesEspeciales.slice() : [];

function normalizarTextoClave(valor) {
  return String(valor || '').trim().toUpperCase();
}

function normalizarFechaIso(fechaRaw) {
  var raw = String(fechaRaw || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  var d = new Date(raw);
  if (isNaN(d.getTime())) return '';

  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function normalizarClientes(payload) {
  if (!payload) return [];

  var origen = payload;
  if (!Array.isArray(origen) && typeof origen === 'object') {
    var nested = origen.clientes || origen.lista || origen.data || origen.items;
    if (nested) origen = nested;
  }

  if (!Array.isArray(origen)) return [];

  var vistos = Object.create(null);
  var salida = [];

  origen.forEach(function(item) {
    var nombre = '';

    if (typeof item === 'string' || typeof item === 'number') {
      nombre = String(item).trim();
    } else if (item && typeof item === 'object') {
      nombre = String(item.nombre || item.cliente || item.value || item.label || '').trim();
    }

    if (!nombre) return;

    var key = normalizarTextoClave(nombre);
    if (vistos[key]) return;

    vistos[key] = true;
    salida.push(nombre);
  });

  return salida;
}

function normalizarProductos(payload) {
  if (!payload) return [];

  var origen = payload;
  if (!Array.isArray(origen) && typeof origen === 'object') {
    var nested = origen.productos || origen.lista || origen.data || origen.items;
    if (nested) origen = nested;
  }

  if (!Array.isArray(origen)) return [];

  var vistos = Object.create(null);
  var salida = [];

  origen.forEach(function(item) {
    var nombre = '';

    if (typeof item === 'string' || typeof item === 'number') {
      nombre = String(item).trim();
    } else if (item && typeof item === 'object') {
      nombre = String(item.producto || item.nombre || item.value || item.label || '').trim();
    }

    if (!nombre) return;

    var key = normalizarTextoClave(nombre);
    if (vistos[key]) return;

    vistos[key] = true;
    salida.push(nombre);
  });

  return salida;
}

function normalizarPrecios(payload) {
  var salida = Object.create(null);
  if (!payload || typeof payload !== 'object') return salida;

  Object.keys(payload).forEach(function(clienteRaw) {
    var cliente = String(clienteRaw || '').trim();
    if (!cliente) return;

    var productosRaw = payload[clienteRaw];
    if (!productosRaw || typeof productosRaw !== 'object') return;

    var productos = Object.create(null);

    Object.keys(productosRaw).forEach(function(productoRaw) {
      var producto = String(productoRaw || '').trim();
      if (!producto) return;

      var historialRaw = Array.isArray(productosRaw[productoRaw]) ? productosRaw[productoRaw] : [];
      var historial = historialRaw.map(function(item) {
        var precio = toNumber(item && item.precio);
        var fecha = normalizarFechaIso(item && item.fecha);
        if (!fecha) return null;

        return {
          fecha: fecha,
          precio: precio
        };
      }).filter(Boolean).sort(function(a, b) {
        if (a.fecha < b.fecha) return -1;
        if (a.fecha > b.fecha) return 1;
        return 0;
      });

      if (historial.length) {
        productos[producto] = historial;
      }
    });

    if (Object.keys(productos).length) {
      salida[cliente] = productos;
    }
  });

  return salida;
}

function derivarProductosDesdePrecios(precios) {
  var set = Object.create(null);
  var salida = [];
  var data = precios && typeof precios === 'object' ? precios : {};

  Object.keys(data).forEach(function(cliente) {
    var productos = data[cliente];
    if (!productos || typeof productos !== 'object') return;

    Object.keys(productos).forEach(function(producto) {
      var historial = Array.isArray(productos[producto]) ? productos[producto] : [];
      var tienePrecio = historial.some(function(item) {
        return toNumber(item && item.precio) > 0;
      });

      if (!tienePrecio) return;

      var key = normalizarTextoClave(producto);
      if (set[key]) return;
      set[key] = true;
      salida.push(producto);
    });
  });

  return salida;
}

function normalizarDatosIniciales(payload) {
  var src = payload && typeof payload === 'object' ? payload : {};
  var precios = normalizarPrecios(src.precios);
  var clientesLista = normalizarClientes(src.clientes);
  var productosLista = normalizarProductos(src.productos);
  var especialesLista = normalizarClientes(src.clientesEspeciales);

  if (!clientesLista.length) {
    clientesLista = Object.keys(precios);
  }

  if (!productosLista.length) {
    productosLista = derivarProductosDesdePrecios(precios);
  }

  return {
    clientes: clientesLista,
    productos: productosLista,
    precios: precios,
    clientesEspeciales: especialesLista
  };
}

function actualizarVariablesClientes() {
  clientes = Array.isArray(appData.clientes) ? appData.clientes.slice() : [];
  clientesEspeciales = Array.isArray(appData.clientesEspeciales) ? appData.clientesEspeciales.slice() : [];

  window.appData = appData;
  window.clientes = clientes;
  window.clientesEspeciales = clientesEspeciales;

  if (typeof window.actualizarSelectoresClientesEspeciales === 'function') {
    window.actualizarSelectoresClientesEspeciales();
  }
}

function aplicarDatosIniciales(payload) {
  var normalizados = normalizarDatosIniciales(payload);

  appData = {
    clientes: normalizados.clientes.slice(),
    productos: normalizados.productos.slice(),
    precios: normalizados.precios,
    clientesEspeciales: normalizados.clientesEspeciales.slice()
  };

  actualizarVariablesClientes();
  return appData;
}

function limpiarCacheDatosIniciales() {
  try {
    localStorage.removeItem(APP_DATA_CACHE_KEY);
  } catch (e) {
    // Ignore storage errors.
  }
}

function guardarCacheDatosIniciales(data) {
  try {
    localStorage.setItem(APP_DATA_CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      data: data
    }));
  } catch (e) {
    // Ignore storage errors.
  }
}

function cargarDatosIniciales(opts) {
  var options = opts || {};
  var forzar = options.forzar !== false;
  var limpiarCache = options.limpiarCache !== false;
  var sobrescribirCache = options.sobrescribirCache !== false;

  if (_cargaDatosInicialesPendiente) {
    return _cargaDatosInicialesPendiente;
  }

  if (typeof api !== 'function') {
    return Promise.reject(new Error('API no disponible'));
  }

  if (limpiarCache) {
    limpiarCacheDatosIniciales();
  }

  _cargaDatosInicialesPendiente = api('getInitialData', { forzar: forzar })
    .then(function(payload) {
      var data = aplicarDatosIniciales(payload);
      if (sobrescribirCache) guardarCacheDatosIniciales(data);
      return data;
    })
    .finally(function() {
      _cargaDatosInicialesPendiente = null;
    });

  return _cargaDatosInicialesPendiente;
}

function cargarClientes() {
  actualizarVariablesClientes();
  return Promise.resolve(clientes);
}

function cargarClientesEspeciales() {
  actualizarVariablesClientes();
  return Promise.resolve(clientesEspeciales);
}

function buscarClaveClientePrecios(cliente) {
  var mapa = appData && appData.precios && typeof appData.precios === 'object'
    ? appData.precios
    : null;
  if (!mapa) return '';

  var raw = String(cliente || '').trim();
  if (!raw) return '';

  if (Object.prototype.hasOwnProperty.call(mapa, raw)) return raw;

  var objetivo = normalizarTextoClave(raw);
  var keys = Object.keys(mapa);
  for (var i = 0; i < keys.length; i++) {
    if (normalizarTextoClave(keys[i]) === objetivo) return keys[i];
  }

  return '';
}

function buscarClaveProductoPrecios(productos, producto) {
  if (!productos || typeof productos !== 'object') return '';

  var raw = String(producto || '').trim();
  if (!raw) return '';

  if (Object.prototype.hasOwnProperty.call(productos, raw)) return raw;

  var objetivo = normalizarTextoClave(raw);
  var keys = Object.keys(productos);
  for (var i = 0; i < keys.length; i++) {
    if (normalizarTextoClave(keys[i]) === objetivo) return keys[i];
  }

  return '';
}

function esClienteEspecialLocal(cliente) {
  var cli = normalizarTextoClave(cliente);
  if (!cli) return false;

  var lista = Array.isArray(appData.clientesEspeciales) ? appData.clientesEspeciales : [];
  return lista.some(function(item) {
    return normalizarTextoClave(item) === cli;
  });
}

function obtenerProductosPorClienteLocal(cliente) {
  var clienteKey = buscarClaveClientePrecios(cliente);
  if (!clienteKey) return [];

  var productosMap = appData.precios[clienteKey];
  if (!productosMap || typeof productosMap !== 'object') return [];

  return Object.keys(productosMap).filter(function(producto) {
    var historial = Array.isArray(productosMap[producto]) ? productosMap[producto] : [];
    return historial.some(function(item) {
      return toNumber(item && item.precio) > 0;
    });
  });
}

function obtenerPrecioLocal(cliente, producto, fecha) {
  if (esClienteEspecialLocal(cliente)) return 0;

  var clienteKey = buscarClaveClientePrecios(cliente);
  if (!clienteKey) return 0;

  var productosMap = appData.precios[clienteKey];
  var productoKey = buscarClaveProductoPrecios(productosMap, producto);
  if (!productoKey) return 0;

  var historial = Array.isArray(productosMap[productoKey]) ? productosMap[productoKey] : [];
  if (!historial.length) return 0;

  var fechaRef = normalizarFechaIso(fecha) || hoyArgentinaISO();

  for (var i = historial.length - 1; i >= 0; i--) {
    var item = historial[i];
    var fechaItem = normalizarFechaIso(item && item.fecha);
    if (!fechaItem) continue;
    if (fechaItem <= fechaRef) return toNumber(item && item.precio);
  }

  return 0;
}

actualizarVariablesClientes();

window.appData = appData;
window.clientes = clientes;
window.clientesEspeciales = clientesEspeciales;
window.cargarDatosIniciales = cargarDatosIniciales;
window.cargarClientes = cargarClientes;
window.cargarClientesEspeciales = cargarClientesEspeciales;
window.obtenerProductosPorClienteLocal = obtenerProductosPorClienteLocal;
window.obtenerPrecioLocal = obtenerPrecioLocal;
