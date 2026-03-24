function toast(msg, tipo = 'ok') {
  var z = document.getElementById('toastZone');
  if (!z) return;

  var t = document.createElement('div');
  t.className = 'toast ' + tipo;
  t.innerHTML = (tipo === 'ok' ? '&#10003;' : '&#10005;') + '&nbsp;' + msg;
  z.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

function hoyArgentinaISO() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires'
    }).format(new Date());
  } catch (e) {
    var ahora = new Date();
    var utcMs = ahora.getTime() + (ahora.getTimezoneOffset() * 60000);
    var ar = new Date(utcMs - (3 * 60 * 60000));
    var y = ar.getFullYear();
    var m = String(ar.getMonth() + 1).padStart(2, '0');
    var d = String(ar.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
}

function hoyISO() {
  return hoyArgentinaISO();
}

function sanitizeDecimalText(value) {
  var raw = String(value == null ? '' : value);
  var clean = '';
  var tieneSeparador = false;

  for (var i = 0; i < raw.length; i++) {
    var ch = raw.charAt(i);

    if (ch >= '0' && ch <= '9') {
      clean += ch;
      continue;
    }

    if ((ch === '.' || ch === ',') && !tieneSeparador) {
      clean += '.';
      tieneSeparador = true;
    }
  }

  return clean;
}

function normalizarInputDecimal(input) {
  if (!input) return;

  var normalizado = sanitizeDecimalText(input.value);
  if (input.value !== normalizado) {
    input.value = normalizado;
  }
}

function setupDecimalInputValidation(root) {
  var scope = root || document;
  if (!scope || typeof scope.addEventListener !== 'function') return;

  scope.addEventListener('input', function(event) {
    var target = event && event.target;
    if (!target || target.tagName !== 'INPUT') return;
    if (!target.matches('input[data-decimal="true"]')) return;

    normalizarInputDecimal(target);
  });
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (typeof value === 'string') {
    var clean = sanitizeDecimalText(value);
    if (clean === '' || clean === '.') return 0;
    var n = Number(clean);
    return Number.isFinite(n) ? n : 0;
  }

  return 0;
}

function pickNumber(value, keys) {
  if (typeof value === 'number' || typeof value === 'string') return toNumber(value);

  if (!value || typeof value !== 'object') return 0;

  if (Array.isArray(keys)) {
    var keyed = pickNumberByKeys(value, keys);
    return keyed === null ? 0 : keyed;
  }

  var values = Object.values(value);
  for (var j = 0; j < values.length; j++) {
    var n = pickNumber(values[j]);
    if (Number.isFinite(n) && n !== 0) return n;
  }

  return 0;
}

function pickNumberByKeys(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      var val = obj[key];
      if (typeof val === 'number' || typeof val === 'string') {
        return toNumber(val);
      }
    }
  }

  for (var j = 0; j < keys.length; j++) {
    var nestedKey = keys[j];
    if (Object.prototype.hasOwnProperty.call(obj, nestedKey)) {
      var nested = pickNumberByKeys(obj[nestedKey], keys);
      if (nested !== null) return nested;
    }
  }

  var values = Object.values(obj);
  for (var k = 0; k < values.length; k++) {
    var deep = pickNumberByKeys(values[k], keys);
    if (deep !== null) return deep;
  }

  return null;
}

var LOADING_GLOBAL_COUNT = 0;
var LOADING_TEXT_DEFAULT = 'Procesando...';

function asegurarOverlayLoading() {
  var overlay = document.getElementById('loadingOverlay');
  if (overlay) return overlay;

  if (!document.body) return null;

  overlay = document.createElement('div');
  overlay.id = 'loadingOverlay';
  overlay.className = 'loading-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = [
    '<div class="loading-overlay-card" role="status" aria-live="polite">',
    '  <div class="spinner" aria-hidden="true"></div>',
    '  <span id="loadingOverlayText">' + LOADING_TEXT_DEFAULT + '</span>',
    '</div>'
  ].join('');

  document.body.appendChild(overlay);
  return overlay;
}

function setTextoLoadingGlobal(texto) {
  var label = document.getElementById('loadingOverlayText');
  if (!label) return;

  var txt = String(texto == null ? '' : texto).trim();
  label.textContent = txt || LOADING_TEXT_DEFAULT;
}

function mostrarLoading(texto) {
  var overlay = asegurarOverlayLoading();

  LOADING_GLOBAL_COUNT += 1;
  if (texto) setTextoLoadingGlobal(texto);

  document.body.classList.add('loading-activo');
  if (overlay) overlay.setAttribute('aria-hidden', 'false');
}

function ocultarLoading() {
  LOADING_GLOBAL_COUNT = Math.max(0, LOADING_GLOBAL_COUNT - 1);
  if (LOADING_GLOBAL_COUNT > 0) return;

  document.body.classList.remove('loading-activo');

  var overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.setAttribute('aria-hidden', 'true');
  setTextoLoadingGlobal(LOADING_TEXT_DEFAULT);
}

function setBotonLoading(btn, activo, textoLoading) {
  if (!btn) return;

  var label = btn.querySelector('.lbl');

  if (activo) {
    if (label && btn.dataset.loadingLabelOriginal === undefined) {
      btn.dataset.loadingLabelOriginal = label.textContent;
    }
    if (label && textoLoading) {
      label.textContent = String(textoLoading);
    }
    btn.disabled = true;
    btn.classList.add('loading');
    btn.setAttribute('aria-busy', 'true');
    return;
  }

  btn.disabled = false;
  btn.classList.remove('loading');
  btn.removeAttribute('aria-busy');

  if (label && btn.dataset.loadingLabelOriginal !== undefined) {
    label.textContent = btn.dataset.loadingLabelOriginal;
  }
  delete btn.dataset.loadingLabelOriginal;
}

function ejecutarConLoading(task, opts) {
  var options = opts || {};
  var boton = options.boton || null;
  var usarGlobal = options.global !== false;

  if (boton) {
    setBotonLoading(boton, true, options.textoBoton);
  }
  if (usarGlobal) {
    mostrarLoading(options.textoGlobal);
  }

  var promesa;
  try {
    promesa = typeof task === 'function'
      ? Promise.resolve().then(task)
      : Promise.resolve(task);
  } catch (err) {
    if (usarGlobal) ocultarLoading();
    if (boton) setBotonLoading(boton, false);
    return Promise.reject(err);
  }

  return promesa.finally(function() {
    if (usarGlobal) ocultarLoading();
    if (boton) setBotonLoading(boton, false);
  });
}

window.toast = toast;
window.hoyArgentinaISO = hoyArgentinaISO;
window.hoyISO = hoyISO;
window.sanitizeDecimalText = sanitizeDecimalText;
window.normalizarInputDecimal = normalizarInputDecimal;
window.setupDecimalInputValidation = setupDecimalInputValidation;
window.toNumber = toNumber;
window.pickNumber = pickNumber;
window.mostrarLoading = mostrarLoading;
window.ocultarLoading = ocultarLoading;
window.setBotonLoading = setBotonLoading;
window.ejecutarConLoading = ejecutarConLoading;

setupDecimalInputValidation(document);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', asegurarOverlayLoading);
} else {
  asegurarOverlayLoading();
}
