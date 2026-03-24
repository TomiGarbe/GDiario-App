var AUTH_STORAGE_KEY = 'usuario';
var AUTH_STORAGE_LEGACY_KEY = 'grasa_usuario';
var GOOGLE_CLIENT_ID = String(window.GOOGLE_CLIENT_ID || '651060073039-qa2irmld1gd678j041dmf5919q7q1328.apps.googleusercontent.com').trim();
var ES_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
var USUARIO_FAKE_LOCAL = Object.freeze({
  name: 'Dev User',
  nombre: 'Dev User',
  email: 'dev@local',
  token: 'dev-token'
});

var _authOnReady = null;
var _appInitLanzado = false;

function parseJwt(token) {
  if (!token || typeof token !== 'string') return null;

  var parts = token.split('.');
  if (parts.length < 2) return null;

  var base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';

  try {
    var json = atob(base64);
    var utf8 = decodeURIComponent(json.split('').map(function(ch) {
      return '%' + ('00' + ch.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(utf8);
  } catch (e) {
    try {
      return JSON.parse(atob(base64));
    } catch (_) {
      return null;
    }
  }
}

function guardarUsuario(usuario) {
  if (!usuario || typeof usuario !== 'object') return;

  var email = String(usuario.email || '').trim().toLowerCase();
  if (!email) return;

  var nombre = String(usuario.nombre || usuario.name || email).trim();
  var token = String(usuario.token || '').trim();
  if (!token) return;

  var limpio = {
    email: email,
    nombre: nombre,
    name: nombre,
    token: token
  };

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(limpio));
  localStorage.setItem(AUTH_STORAGE_LEGACY_KEY, JSON.stringify(limpio));
  actualizarUsuarioUI();
}

function obtenerUsuario() {
  try {
    var raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) raw = localStorage.getItem(AUTH_STORAGE_LEGACY_KEY);
    if (!raw) return null;

    var usuario = JSON.parse(raw);
    if (!usuario || typeof usuario !== 'object') return null;

    var email = String(usuario.email || '').trim().toLowerCase();
    if (!email) return null;

    var nombre = String(usuario.nombre || usuario.name || email).trim();
    var token = String(usuario.token || '').trim();
    if (!token) return null;

    var normalizado = {
      email: email,
      nombre: nombre,
      name: nombre,
      token: token
    };

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalizado));
    localStorage.setItem(AUTH_STORAGE_LEGACY_KEY, JSON.stringify(normalizado));
    return normalizado;
  } catch (e) {
    return null;
  }
}

function estaLogueado() {
  var usuario = obtenerUsuario();
  return !!(usuario && usuario.email && usuario.token);
}

function setAuthMessage(msg, tipo) {
  var el = document.getElementById('authMsg');
  if (!el) return;

  var text = String(msg || '').trim();
  if (!text) {
    el.style.display = 'none';
    el.textContent = '';
    el.className = 'auth-msg';
    return;
  }

  el.style.display = 'block';
  el.textContent = text;
  el.className = 'auth-msg ' + (tipo === 'err' ? 'err' : 'info');
}

function actualizarUsuarioUI() {
  var el = document.getElementById('nombreUsuario') || document.getElementById('usuarioNombre');
  if (!el) return;

  var usuario = obtenerUsuario();
  el.textContent = usuario ? (usuario.name || usuario.nombre || usuario.email) : '';
}

function mostrarPantallaLogin() {
  var login = document.getElementById('authGate');
  var app = document.getElementById('appRoot');

  if (app) app.style.display = 'none';
  if (login) login.style.display = 'flex';
}

function mostrarPantallaApp() {
  var login = document.getElementById('authGate');
  var app = document.getElementById('appRoot');

  if (login) login.style.display = 'none';
  if (app) app.style.display = 'block';

  actualizarUsuarioUI();
}

function lanzarInitAppSiCorresponde() {
  if (_appInitLanzado) return;
  if (typeof _authOnReady !== 'function') return;

  _appInitLanzado = true;
  _authOnReady();
}

function iniciarSesionLocalDev() {
  guardarUsuario(USUARIO_FAKE_LOCAL);
  setAuthMessage('');
  mostrarPantallaApp();
  lanzarInitAppSiCorresponde();
}

function handleCredentialResponse(response) {
  var credential = response && response.credential ? response.credential : '';
  if (!credential) {
    setAuthMessage('No se pudo validar el usuario de Google.', 'err');
    return;
  }

  if (typeof apiLoginWithGoogle !== 'function') {
    setAuthMessage('No se pudo iniciar sesion (API no disponible).', 'err');
    return;
  }

  var payload = parseJwt(credential) || {};
  var nombre = payload.name || payload.given_name || payload.email || '';

  setAuthMessage('Validando acceso...', 'info');

  apiLoginWithGoogle(credential)
    .then(function(login) {
      guardarUsuario({
        email: login.email,
        nombre: nombre || login.email,
        token: login.token
      });

      setAuthMessage('');
      mostrarPantallaApp();
      lanzarInitAppSiCorresponde();
    })
    .catch(function(err) {
      setAuthMessage(err && err.message ? err.message : 'No se pudo iniciar sesion.', 'err');
    });
}

function renderGoogleLoginButton() {
  var mount = document.getElementById('googleLoginBtn');
  if (!mount) return;

  mount.innerHTML = '';

  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.indexOf('TU_CLIENT_ID') !== -1) {
    setAuthMessage('Configura GOOGLE_CLIENT_ID en frontend/js/auth.js para habilitar el login.', 'err');
    return;
  }

  if (!(window.google && google.accounts && google.accounts.id)) {
    setAuthMessage('Cargando Google Login...', 'info');
    return;
  }

  setAuthMessage('');

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse,
    auto_select: false,
    cancel_on_tap_outside: true
  });

  google.accounts.id.renderButton(mount, {
    theme: 'outline',
    size: 'large',
    text: 'signin_with',
    shape: 'pill',
    width: 280
  });
}

function esperarGoogleIdentity(tries) {
  if (window.google && google.accounts && google.accounts.id) {
    renderGoogleLoginButton();
    return;
  }

  if (tries <= 0) {
    setAuthMessage('No se pudo cargar Google Identity Services.', 'err');
    return;
  }

  setTimeout(function() {
    esperarGoogleIdentity(tries - 1);
  }, 250);
}

function cerrarSesion() {
  if (ES_LOCAL) {
    iniciarSesionLocalDev();
    return;
  }

  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(AUTH_STORAGE_LEGACY_KEY);
  actualizarUsuarioUI();

  if (window.google && google.accounts && google.accounts.id && typeof google.accounts.id.disableAutoSelect === 'function') {
    google.accounts.id.disableAutoSelect();
  }

  mostrarPantallaLogin();
  renderGoogleLoginButton();
}

function inicializarAutenticacion(onReady) {
  _authOnReady = typeof onReady === 'function' ? onReady : null;

  actualizarUsuarioUI();

  if (ES_LOCAL) {
    iniciarSesionLocalDev();
    return;
  }

  if (estaLogueado()) {
    mostrarPantallaApp();
    lanzarInitAppSiCorresponde();
  } else {
    mostrarPantallaLogin();
  }

  esperarGoogleIdentity(40);
}

window.parseJwt = parseJwt;
window.guardarUsuario = guardarUsuario;
window.obtenerUsuario = obtenerUsuario;
window.estaLogueado = estaLogueado;
window.cerrarSesion = cerrarSesion;
window.handleCredentialResponse = handleCredentialResponse;
window.inicializarAutenticacion = inicializarAutenticacion;
window.mostrarPantallaLogin = mostrarPantallaLogin;
window.mostrarPantallaApp = mostrarPantallaApp;
