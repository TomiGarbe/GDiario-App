const API_URL = String(
  window.API_URL
  || "https://script.google.com/macros/s/AKfycbxkz4z3-DHtKqc7pqCUHpbl_ZHu-78qa6hi6xSlc4AWIRW-n4L3GyZDJQgitu9jQOFu/exec"
).trim();

function parseApiResponse(payload) {
  if (payload && payload.error) {
    throw new Error(String(payload.error));
  }

  return payload;
}

function parseHttpJson(response) {
  if (!response) {
    return Promise.reject(new Error('Sin respuesta del servidor'));
  }

  return response.text().then(function(raw) {
    var body = String(raw == null ? '' : raw).trim();
    var payload;

    if (!body) {
      throw new Error('Respuesta vacia del backend');
    }

    try {
      payload = JSON.parse(body);
    } catch (e) {
      payload = null;
    }

    if (payload === null) {
      throw new Error('Respuesta invalida del backend');
    }

    if (!response.ok) {
      var msg = (payload && typeof payload === 'object' && payload.error)
        ? String(payload.error)
        : '';

      if (response.status === 401) {
        throw new Error(msg || 'No autorizado o Web App no accesible');
      }

      throw new Error(msg || ('HTTP ' + response.status));
    }

    return payload;
  });
}

function normalizarErrorConexion(err) {
  var msg = String(err && err.message ? err.message : err || '');
  var msgLower = msg.toLowerCase();

  if (
    msgLower.indexOf('failed to fetch') !== -1
    || msgLower.indexOf('load failed') !== -1
    || msgLower.indexOf('networkerror') !== -1
    || msgLower.indexOf('cors') !== -1
  ) {
    return new Error('No se pudo conectar con Apps Script (revisa URL, despliegue Web App y permisos)');
  }

  if (
    msgLower.indexOf('web app no accesible') !== -1
    || msgLower.indexOf('no autorizado') !== -1
  ) {
    return new Error('Web App no accesible: revisa que el despliegue sea Web App publico (Anyone)');
  }

  return err instanceof Error ? err : new Error(msg || 'Error de red');
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
    .then(parseHttpJson)
    .then(parseApiResponse)
    .then(function(payload) {
      if (!payload || payload.ok !== true || !payload.token || !payload.email) {
        throw new Error('Respuesta de login invalida');
      }

      return payload;
    })
    .catch(function(err) {
      throw normalizarErrorConexion(err);
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
    .then(parseHttpJson)
    .then(parseApiResponse)
    .catch(function(err) {
      err = normalizarErrorConexion(err);
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
