const API_URL = "https://script.google.com/macros/s/AKfycbyainKdZWfIytdQzZGn3nGpnKa3Dt7LkzEyxsTIbR2x8FDMfOPXL2RqEolgd7PoGjOJ/exec";

function parseApiResponse(payload) {
  if (payload && payload.error) {
    throw new Error(String(payload.error));
  }

  return payload;
}

function apiLoginWithGoogle(credential) {
  var cred = String(credential || '').trim();
  if (!cred) {
    return Promise.reject(new Error('Token requerido'));
  }

  return fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ action: "login", credential: cred })
  })
    .then(r => r.json())
    .then(parseApiResponse)
    .then(function(payload) {
      if (!payload || payload.ok !== true || !payload.token || !payload.email) {
        throw new Error('Respuesta de login invalida');
      }

      return payload;
    });
}

function fetchConAuth(data = {}) {
  var usuario = typeof obtenerUsuario === 'function' ? obtenerUsuario() : null;
  var token = usuario && usuario.token ? String(usuario.token).trim() : '';

  if (!token) {
    if (typeof mostrarPantallaLogin === 'function') mostrarPantallaLogin();
    return Promise.reject(new Error('Usuario no autenticado'));
  }

  return fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ ...data, token })
  })
    .then(r => r.json())
    .then(parseApiResponse)
    .catch(function(err) {
      var msg = String(err && err.message ? err.message : err || '');
      if (msg.toLowerCase().indexOf('no autorizado') !== -1) {
        if (typeof mostrarPantallaLogin === 'function') mostrarPantallaLogin();
      }
      throw err;
    });
}

function api(action, data = {}) {
  return fetchConAuth({ action, ...data });
}

window.apiLoginWithGoogle = apiLoginWithGoogle;
window.fetchConAuth = fetchConAuth;
window.api = api;
