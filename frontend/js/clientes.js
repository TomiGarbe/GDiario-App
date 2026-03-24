var clientes = [];
var clientesEspeciales = [];

function normalizarClientes(payload) {
  if (!payload) return [];

  if (Array.isArray(payload)) {
    return payload
      .map(function(item) {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          var nombre = item.nombre || item.cliente || item.value || item.label;
          return nombre ? String(nombre).trim() : '';
        }
        return '';
      })
      .filter(Boolean);
  }

  if (typeof payload === 'object') {
    var nested = payload.clientes || payload.lista || payload.data || payload.items;
    if (nested) return normalizarClientes(nested);
  }

  return [];
}

function cargarClientes() {
  api("obtenerClientes").then(lista => {
    clientes = normalizarClientes(lista);
    window.clientes = clientes;
    if (typeof window.actualizarSelectoresClientesEspeciales === 'function') {
      window.actualizarSelectoresClientesEspeciales();
    }
  }).catch(() => {
    clientes = [];
    window.clientes = clientes;
    if (typeof window.actualizarSelectoresClientesEspeciales === 'function') {
      window.actualizarSelectoresClientesEspeciales();
    }
  });
}

function cargarClientesEspeciales() {
  api("obtenerClientesEspeciales").then(lista => {
    clientesEspeciales = normalizarClientes(lista);
    window.clientesEspeciales = clientesEspeciales;
    if (typeof window.actualizarSelectoresClientesEspeciales === 'function') {
      window.actualizarSelectoresClientesEspeciales();
    }
  }).catch(() => {
    clientesEspeciales = [];
    window.clientesEspeciales = clientesEspeciales;
    if (typeof window.actualizarSelectoresClientesEspeciales === 'function') {
      window.actualizarSelectoresClientesEspeciales();
    }
  });
}

window.clientes = clientes;
window.clientesEspeciales = clientesEspeciales;
window.cargarClientes = cargarClientes;
window.cargarClientesEspeciales = cargarClientesEspeciales;
