var TOAST_AUTO_HIDE_MS = 3000;

function normalizarToastTipo(tipo) {
  var t = String(tipo == null ? '' : tipo).trim().toLowerCase();

  if (t === 'ok' || t === 'success' || t === 'exito') return 'success';
  if (t === 'err' || t === 'error') return 'error';
  return 'info';
}

function showToast(message, type) {
  var z = document.getElementById('toastZone');
  if (!z) return;

  var msg = String(message == null ? '' : message).trim();
  if (!msg) return;

  var toastType = normalizarToastTipo(type);
  var t = document.createElement('div');
  t.className = 'toast ' + toastType;
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  t.textContent = msg;

  z.appendChild(t);

  setTimeout(function() {
    if (t && t.parentNode) t.parentNode.removeChild(t);
  }, TOAST_AUTO_HIDE_MS);
}

function toast(msg, tipo) {
  showToast(msg, tipo);
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

function capitalizeFirst(text) {
  if (!text) return '';
  var value = String(text).trim();
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
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

var SECTION_LOADING_HANDLERS = Object.create(null);

function registerSectionLoader(sectionId, handlers) {
  var id = String(sectionId == null ? '' : sectionId).trim();
  if (!id) return;

  var cfg = handlers && typeof handlers === 'object' ? handlers : {};
  SECTION_LOADING_HANDLERS[id] = {
    show: typeof cfg.show === 'function' ? cfg.show : null,
    hide: typeof cfg.hide === 'function' ? cfg.hide : null
  };
}

function showSectionLoader(sectionId, context) {
  var id = String(sectionId == null ? '' : sectionId).trim();
  if (!id) return;

  var handlers = SECTION_LOADING_HANDLERS[id];
  if (!handlers || typeof handlers.show !== 'function') return;
  handlers.show(context || {});
}

function hideSectionLoader(sectionId, context) {
  var id = String(sectionId == null ? '' : sectionId).trim();
  if (!id) return;

  var handlers = SECTION_LOADING_HANDLERS[id];
  if (!handlers || typeof handlers.hide !== 'function') return;
  handlers.hide(context || {});
}

function mostrarLoading() {
  /* Compatibilidad: loader global deshabilitado */
}

function ocultarLoading() {
  /* Compatibilidad: loader global deshabilitado */
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
  var usarGlobal = options.global === true;
  var sectionId = String(options.sectionId || '').trim();

  if (boton) {
    setBotonLoading(boton, true, options.textoBoton);
  }
  if (sectionId) {
    showSectionLoader(sectionId, options);
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
    if (sectionId) hideSectionLoader(sectionId, options);
    if (boton) setBotonLoading(boton, false);
    return Promise.reject(err);
  }

  return promesa.finally(function() {
    if (usarGlobal) ocultarLoading();
    if (sectionId) hideSectionLoader(sectionId, options);
    if (boton) setBotonLoading(boton, false);
  });
}

window.toast = toast;
window.hoyArgentinaISO = hoyArgentinaISO;
window.hoyISO = hoyISO;
window.capitalizeFirst = capitalizeFirst;
window.sanitizeDecimalText = sanitizeDecimalText;
window.normalizarInputDecimal = normalizarInputDecimal;
window.setupDecimalInputValidation = setupDecimalInputValidation;
window.toNumber = toNumber;
window.pickNumber = pickNumber;
window.showToast = showToast;
window.registerSectionLoader = registerSectionLoader;
window.showSectionLoader = showSectionLoader;
window.hideSectionLoader = hideSectionLoader;
window.mostrarLoading = mostrarLoading;
window.ocultarLoading = ocultarLoading;
window.setBotonLoading = setBotonLoading;
window.ejecutarConLoading = ejecutarConLoading;

setupDecimalInputValidation(document);
