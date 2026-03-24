var customSelectRegistry = Object.create(null);
var customSelectGlobalHooksReady = false;
var customSelectRepositionRaf = 0;

function csEscapeHtml(texto) {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function csNormalizarOpciones(opciones) {
  if (!Array.isArray(opciones)) return [];

  return opciones
    .map(function(op) {
      if (op == null) return '';
      if (typeof op === 'string' || typeof op === 'number') return String(op).trim();
      if (typeof op === 'object') {
        var val = op.value != null ? op.value : (op.label != null ? op.label : '');
        return String(val).trim();
      }
      return '';
    })
    .filter(function(op) { return op !== ''; });
}

function csGetConfig(id) {
  return customSelectRegistry[String(id)] || null;
}

function csResolveOptions(cfg) {
  if (!cfg) return [];

  if (typeof cfg.getOptions === 'function') {
    var dyn = csNormalizarOpciones(cfg.getOptions());
    cfg.options = dyn;
    return dyn;
  }

  cfg.options = csNormalizarOpciones(cfg.options);
  return cfg.options;
}

function csGetWrap(cfg) {
  if (!cfg) return null;
  return document.getElementById(cfg.wrapId);
}

function csGetPanel(cfg) {
  if (!cfg) return null;
  return document.getElementById(cfg.panelId);
}

function csGetTrigger(cfg) {
  var wrap = csGetWrap(cfg);
  if (!wrap) return null;
  return wrap.querySelector('.cs-trigger');
}

function csNeedsPortal(cfg) {
  var wrap = csGetWrap(cfg);
  if (!wrap) return false;

  var node = wrap.parentElement;
  while (node && node !== document.body) {
    var styles = window.getComputedStyle(node);
    var overflow = (styles.overflow + styles.overflowY + styles.overflowX).toLowerCase();
    var hasStackingContext = styles.transform !== 'none'
      || styles.filter !== 'none'
      || styles.perspective !== 'none';

    if (/(auto|scroll|hidden|clip)/.test(overflow) || hasStackingContext) {
      return true;
    }

    node = node.parentElement;
  }

  return false;
}

function csSendPanelHome(cfg) {
  var wrap = csGetWrap(cfg);
  var panel = csGetPanel(cfg);
  if (!panel) return;

  panel.classList.remove('cs-floating');
  if (wrap && panel.parentElement !== wrap) {
    wrap.appendChild(panel);
  }
}

function csSendPanelToBody(cfg) {
  var panel = csGetPanel(cfg);
  if (!panel) return;

  if (panel.parentElement !== document.body) {
    document.body.appendChild(panel);
  }
  panel.classList.add('cs-floating');
}

function csPositionPanel(cfg) {
  if (!cfg || !cfg.isOpen) return;

  var wrap = csGetWrap(cfg);
  var trigger = csGetTrigger(cfg);
  var panel = csGetPanel(cfg);
  if (!panel) return;

  if (!wrap || !document.body.contains(wrap) || !trigger) {
    csCloseCustom(cfg.id);
    return;
  }

  if (!cfg.usePortal) {
    csSendPanelHome(cfg);
    panel.style.top = '';
    panel.style.left = '';
    panel.style.width = '';
    return;
  }

  csSendPanelToBody(cfg);

  var rect = trigger.getBoundingClientRect();
  panel.style.top = Math.round(rect.bottom + 6) + 'px';
  panel.style.left = Math.round(rect.left) + 'px';
  panel.style.width = Math.round(rect.width) + 'px';
}

function csRepositionOpenCustoms() {
  Object.keys(customSelectRegistry).forEach(function(id) {
    var cfg = csGetConfig(id);
    if (!cfg || !cfg.isOpen) return;
    csPositionPanel(cfg);
  });
}

function csScheduleReposition() {
  if (typeof window.requestAnimationFrame !== 'function') {
    csRepositionOpenCustoms();
    return;
  }

  if (customSelectRepositionRaf) return;

  customSelectRepositionRaf = window.requestAnimationFrame(function() {
    customSelectRepositionRaf = 0;
    csRepositionOpenCustoms();
  });
}

function csCloseAllCustom(exceptId) {
  var keep = exceptId == null ? null : String(exceptId);
  Object.keys(customSelectRegistry).forEach(function(id) {
    if (keep !== null && id === keep) return;
    csCloseCustom(id);
  });
}

function csSyncVisual(cfg) {
  if (!cfg) return;

  var hidden = document.getElementById(cfg.inputId);
  var disp = document.getElementById(cfg.dispId);

  if (hidden) hidden.value = cfg.value || '';
  if (!disp) return;

  var opciones = csResolveOptions(cfg);
  var selected = String(cfg.value || '');
  var existe = opciones.indexOf(selected) !== -1;

  if (existe && selected !== '') {
    disp.textContent = selected;
    disp.className = 'cs-val';
  } else {
    disp.textContent = cfg.placeholder;
    disp.className = 'cs-ph';
  }
}

function csBindGlobalHooks() {
  if (customSelectGlobalHooksReady) return;
  customSelectGlobalHooksReady = true;

  document.addEventListener('click', function(evt) {
    if (evt.target.closest('.cs-wrap') || evt.target.closest('.cs-panel')) return;
    csCloseAllCustom();
  });

  document.addEventListener('keydown', function(evt) {
    if (evt.key !== 'Escape') return;
    csCloseAllCustom();
  });

  window.addEventListener('resize', csScheduleReposition);
  window.addEventListener('scroll', csScheduleReposition, true);
}

function csInitCustom(id, config) {
  var key = String(id);
  var cfg = config || {};

  customSelectRegistry[key] = {
    id: key,
    wrapId: 'cs-wrap-' + key,
    panelId: 'cs-panel-' + key,
    listId: 'cs-list-' + key,
    searchId: 'cs-inp-' + key,
    dispId: 'cs-disp-' + key,
    inputId: cfg.inputId || ('cs-val-' + key),
    placeholder: String(cfg.placeholder || 'Selecciona una opcion...'),
    searchPlaceholder: String(cfg.searchPlaceholder || 'Buscar...'),
    searchable: cfg.searchable !== false,
    options: csNormalizarOpciones(cfg.options || []),
    getOptions: typeof cfg.getOptions === 'function' ? cfg.getOptions : null,
    onChange: cfg.onChange || null,
    valueClass: String(cfg.valueClass || ''),
    value: cfg.selected == null ? '' : String(cfg.selected),
    isOpen: false,
    usePortal: false
  };

  csBindGlobalHooks();

  setTimeout(function() {
    csSyncVisualById(key);
  }, 0);

  return customSelectRegistry[key];
}

function htmlSelectCustom(id, opciones, selected, config) {
  var cfg = csInitCustom(id, {
    options: opciones,
    selected: selected,
    placeholder: config && config.placeholder,
    searchPlaceholder: config && config.searchPlaceholder,
    searchable: config ? config.searchable : true,
    onChange: config && config.onChange,
    valueClass: config && config.valueClass,
    inputId: config && config.inputId,
    getOptions: config && config.getOptions
  });

  var searchHtml = cfg.searchable
    ? `
      <div class="cs-search">
        <svg viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
        <input id="${cfg.searchId}" placeholder="${csEscapeHtml(cfg.searchPlaceholder)}" autocomplete="off"
          oninput="csRenderCustom('${cfg.id}', this.value)"
          onblur="csBlurCustom('${cfg.id}')">
      </div>
    `
    : '';

  return `
    <div class="cs-wrap" id="${cfg.wrapId}">
      <button type="button" class="cs-trigger" onclick="csToggleCustom('${cfg.id}')">
        <span class="cs-ph" id="${cfg.dispId}">${csEscapeHtml(cfg.placeholder)}</span>
        <svg class="cs-arrow" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      <div class="cs-panel" id="${cfg.panelId}">
        ${searchHtml}
        <ul class="cs-list" id="${cfg.listId}"></ul>
      </div>
    </div>

    <input type="hidden" id="${cfg.inputId}" class="${csEscapeHtml(cfg.valueClass)}">
  `;
}

function csRenderCustom(id, filtro) {
  var cfg = csGetConfig(id);
  if (!cfg) return;

  var ul = document.getElementById(cfg.listId);
  if (!ul) return;

  var texto = String(filtro || '').toLowerCase().trim();
  var opciones = csResolveOptions(cfg);

  var data = texto
    ? opciones.filter(function(op) { return op.toLowerCase().indexOf(texto) !== -1; })
    : opciones.slice();

  ul.innerHTML = '';

  if (data.length === 0) {
    ul.innerHTML = '<li class="cs-empty">Sin resultados</li>';
    if (cfg.isOpen) csScheduleReposition();
    return;
  }

  data.forEach(function(nombre) {
    var li = document.createElement('li');
    li.textContent = nombre;

    if (String(cfg.value || '') === nombre) li.classList.add('cs-selected');

    li.addEventListener('mousedown', function(evt) {
      evt.preventDefault();
      csChooseCustom(cfg.id, nombre);
    });

    li.addEventListener('click', function(evt) {
      evt.stopPropagation();
      csChooseCustom(cfg.id, nombre);
    });

    ul.appendChild(li);
  });

  if (cfg.isOpen) csScheduleReposition();
}

function csToggleCustom(id) {
  var cfg = csGetConfig(id);
  if (!cfg) return;

  var wrap = csGetWrap(cfg);
  if (!wrap) return;

  if (cfg.isOpen) {
    csCloseCustom(id);
    return;
  }

  csCloseAllCustom(cfg.id);

  cfg.isOpen = true;
  cfg.usePortal = csNeedsPortal(cfg);
  wrap.classList.add('open');

  var inp = document.getElementById(cfg.searchId);
  if (inp) inp.value = '';

  csRenderCustom(id, '');
  var panel = csGetPanel(cfg);
  if (panel) panel.classList.add('cs-open');
  csPositionPanel(cfg);
  csScheduleReposition();

  if (inp) {
    setTimeout(function() { inp.focus(); }, 30);
  }
}

function csCloseCustom(id) {
  var cfg = csGetConfig(id);
  if (!cfg) return;

  cfg.isOpen = false;

  var wrap = csGetWrap(cfg);
  if (wrap) wrap.classList.remove('open');

  var panel = csGetPanel(cfg);
  if (panel) {
    panel.classList.remove('cs-open', 'cs-floating');
    panel.style.top = '';
    panel.style.left = '';
    panel.style.width = '';

    if (wrap) {
      if (panel.parentElement !== wrap) wrap.appendChild(panel);
    } else if (panel.parentElement === document.body) {
      panel.remove();
    }
  }

  cfg.usePortal = false;
}

function csBlurCustom(id) {
  setTimeout(function() {
    csCloseCustom(id);
  }, 200);
}

function csEmitChange(cfg) {
  if (!cfg) return;

  var hidden = document.getElementById(cfg.inputId);
  if (hidden && typeof Event === 'function') {
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (typeof cfg.onChange === 'function') {
    cfg.onChange(cfg.value, cfg);
    return;
  }

  if (typeof cfg.onChange === 'string' && typeof window[cfg.onChange] === 'function') {
    window[cfg.onChange](cfg.value, cfg);
  }
}

function csChooseCustom(id, valor, silent) {
  var cfg = csGetConfig(id);
  if (!cfg) return;

  cfg.value = String(valor == null ? '' : valor);
  csSyncVisual(cfg);
  csCloseCustom(id);

  if (!silent) csEmitChange(cfg);
}

function csSetOptions(id, opciones, selected, silent) {
  var cfg = csGetConfig(id);
  if (!cfg) return;

  cfg.options = csNormalizarOpciones(opciones);

  var next = selected;
  if (next == null) {
    next = cfg.value;
  }

  next = String(next == null ? '' : next);
  if (next !== '' && cfg.options.indexOf(next) === -1) {
    next = '';
  }

  cfg.value = next;
  csSyncVisual(cfg);

  var wrap = document.getElementById(cfg.wrapId);
  if (wrap && wrap.classList.contains('open')) {
    var inp = document.getElementById(cfg.searchId);
    csRenderCustom(id, inp ? inp.value : '');
  }

  if (!silent) csEmitChange(cfg);
}

function csSetValue(id, valor, silent) {
  var cfg = csGetConfig(id);
  if (!cfg) return;

  var next = String(valor == null ? '' : valor);
  if (next !== '' && csResolveOptions(cfg).indexOf(next) === -1) {
    next = '';
  }

  cfg.value = next;
  csSyncVisual(cfg);

  if (!silent) csEmitChange(cfg);
}

function csGetValue(id) {
  var cfg = csGetConfig(id);
  if (!cfg) return '';

  var hidden = document.getElementById(cfg.inputId);
  if (hidden) return String(hidden.value || '');

  return String(cfg.value || '');
}

function csSyncVisualById(id) {
  var cfg = csGetConfig(id);
  if (!cfg) return;
  csSyncVisual(cfg);
}

function csRender(n, lista) {
  var id = String(n);
  if (Array.isArray(lista)) {
    csSetOptions(id, lista, csGetValue(id), true);
  }

  var inp = document.getElementById('cs-inp-' + id);
  csRenderCustom(id, inp ? inp.value : '');
}

function csToggle(n) {
  csToggleCustom(String(n));
}

function csCerrar(n) {
  csCloseCustom(String(n));
}

function csElegir(n, nombre) {
  csChooseCustom(String(n), nombre);
}

function htmlCS(n) {
  var id = String(n);

  return `
    <div class="field" style="margin-bottom:10px">
      <label>Cliente</label>
      ${htmlSelectCustom(id, [], '', {
        placeholder: 'Selecciona un cliente...',
        searchPlaceholder: 'Buscar cliente...',
        searchable: true,
        getOptions: function() { return window.clientes || []; },
        onChange: function() {
          var card = document.querySelector('.prod-card[data-id="' + id + '"]');
          if (!card) return;

          if (typeof window.actualizarOpcionesProducto === 'function') {
            window.actualizarOpcionesProducto(card);
          }

          if (typeof programarCalculo === 'function') programarCalculo(card);
          else if (typeof calcular === 'function') calcular(card);
        }
      })}
    </div>
  `;
}

window.htmlSelectCustom = htmlSelectCustom;
window.csRenderCustom = csRenderCustom;
window.csToggleCustom = csToggleCustom;
window.csCloseCustom = csCloseCustom;
window.csBlurCustom = csBlurCustom;
window.csChooseCustom = csChooseCustom;
window.csSetOptions = csSetOptions;
window.csSetValue = csSetValue;
window.csGetValue = csGetValue;
window.csSyncVisualById = csSyncVisualById;

window.csRender = csRender;
window.csToggle = csToggle;
window.csCerrar = csCerrar;
window.csElegir = csElegir;
window.htmlCS = htmlCS;
