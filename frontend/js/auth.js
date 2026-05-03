var AUTH_STORAGE_KEY = 'usuario';
var AUTH_STORAGE_LEGACY_KEY = 'grasa_usuario';
var AUTH_TOKEN_KEY = 'token';
var GOOGLE_CLIENT_ID = String(window.GOOGLE_CLIENT_ID || '').trim();

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
  } catch (_) {
    return null;
  }
}

function guardarUsuario(usuario) {
  if (!usuario || typeof usuario !== 'object') return;
  var email = String(usuario.email || '').trim().toLowerCase();
  var token = String(usuario.token || '').trim();
  if (!email || !token) return;

  var nombre = String(usuario.nombre || usuario.name || email).trim();
  var limpio = { email: email, nombre: nombre, name: nombre, token: token };

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(limpio));
  localStorage.setItem(AUTH_STORAGE_LEGACY_KEY, JSON.stringify(limpio));
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  actualizarUsuarioUI();
}

function obtenerUsuario() {
  try {
    var raw = localStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_LEGACY_KEY);
    if (!raw) return null;

    var usuario = JSON.parse(raw);
    var email = String(usuario && usuario.email || '').trim().toLowerCase();
    var token = String((usuario && usuario.token) || localStorage.getItem(AUTH_TOKEN_KEY) || '').trim();
    if (!email || !token) return null;

    var nombre = String(usuario.nombre || usuario.name || email).trim();
    var normalizado = { email: email, nombre: nombre, name: nombre, token: token };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalizado));
    localStorage.setItem(AUTH_STORAGE_LEGACY_KEY, JSON.stringify(normalizado));
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    return normalizado;
  } catch (_) {
    return null;
  }
}

function estaLogueado() {
  var token = String(localStorage.getItem(AUTH_TOKEN_KEY) || '').trim();
  return !!token;
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
  el.textContent = usuario ? (usuario.name || usuario.email) : '';
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

function handleCredentialResponse(response) {
  var googleToken = String(response && response.credential || '').trim();
  if (!googleToken) {
    setAuthMessage('No se pudo validar el token de Google.', 'err');
    return;
  }
  if (typeof apiLoginWithGoogle !== 'function') {
    setAuthMessage('No se pudo iniciar sesión (API no disponible).', 'err');
    return;
  }

  setAuthMessage('Validando acceso...', 'info');

  apiLoginWithGoogle(googleToken)
    .then(function(res) {
      var payload = parseJwt(googleToken) || {};
      var email = String(payload.email || '').trim().toLowerCase();
      var nombre = String(payload.name || payload.given_name || email || 'Usuario').trim();
      guardarUsuario({ email: email, nombre: nombre, token: String(res.access_token || '').trim() });
      setAuthMessage('');
      mostrarPantallaApp();
      lanzarInitAppSiCorresponde();
    })
    .catch(function(err) {
      setAuthMessage(err && err.message ? err.message : 'No se pudo iniciar sesión.', 'err');
    });
}

function renderGoogleLoginButton() {
  var mount = document.getElementById('googleLoginBtn');
  if (!mount) return;
  mount.innerHTML = '';

  if (!GOOGLE_CLIENT_ID) {
    setAuthMessage('Falta GOOGLE_CLIENT_ID en frontend.', 'err');
    return;
  }

  if (!(window.google && google.accounts && google.accounts.id)) {
    setAuthMessage('Cargando Google Login...', 'info');
    return;
  }

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

  setAuthMessage('');
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
  setTimeout(function() { esperarGoogleIdentity(tries - 1); }, 250);
}

function cerrarSesion() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(AUTH_STORAGE_LEGACY_KEY);
  localStorage.removeItem(AUTH_TOKEN_KEY);
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

  if (estaLogueado()) {
    mostrarPantallaApp();
    lanzarInitAppSiCorresponde();
    return;
  }

  mostrarPantallaLogin();
  esperarGoogleIdentity(40);
}

window.guardarUsuario = guardarUsuario;
window.obtenerUsuario = obtenerUsuario;
window.estaLogueado = estaLogueado;
window.cerrarSesion = cerrarSesion;
window.handleCredentialResponse = handleCredentialResponse;
window.inicializarAutenticacion = inicializarAutenticacion;
window.mostrarPantallaLogin = mostrarPantallaLogin;
window.mostrarPantallaApp = mostrarPantallaApp;
