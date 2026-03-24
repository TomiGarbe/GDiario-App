/* ================================================================
   DATE PICKER CUSTOM — Registro Diario
   Reemplaza los input[type="date"] con un picker visual
   que sigue el diseño de la app.

   COMPATIBILIDAD TOTAL:
   - El input[type="date"] original queda oculto y mantiene
     su value en formato YYYY-MM-DD. Todo el código JS
     existente sigue leyendo/escribiendo ese input sin cambios.
   - Soporta:
       el.value = 'YYYY-MM-DD'   (asignación programática)
       el.dispatchEvent(new Event('change'))  (escucha eventos)
       document.getElementById('fecha').value  (lectura)
================================================================ */

(function() {
  'use strict';

  var MESES = [
    'Enero','Febrero','Marzo','Abril','Mayo','Junio',
    'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'
  ];
  var DIAS_CORTO = ['Do','Lu','Ma','Mi','Ju','Vi','Sa'];

  var _activeDP = null;
  var _globalHooks = false;

  /* ---------- helpers ---------- */

  function pad(n) { return String(n).padStart(2, '0'); }

  function isoFromParts(y, m, d) {
    return y + '-' + pad(m) + '-' + pad(d);
  }

  function parseIso(str) {
    if (!str || typeof str !== 'string') return null;
    var m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3] };
  }

  function today() {
    try {
      var s = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires'
      }).format(new Date());
      return parseIso(s) || todayLocal();
    } catch(e) { return todayLocal(); }
  }

  function todayLocal() {
    var d = new Date();
    return { y: d.getFullYear(), m: d.getMonth()+1, d: d.getDate() };
  }

  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }

  function firstDayOfWeek(y, m) {
    return new Date(y, m-1, 1).getDay();
  }

  function formatDisplay(parts) {
    if (!parts) return '';
    return pad(parts.d) + ' / ' + pad(parts.m) + ' / ' + parts.y;
  }

  /* ---------- registry ---------- */

  var _pickers = [];

  function getPickerByInput(input) {
    for (var i = 0; i < _pickers.length; i++) {
      if (_pickers[i].input === input) return _pickers[i];
    }
    return null;
  }

  /* ---------- close all ---------- */

  function closeAll(except) {
    _pickers.forEach(function(dp) {
      if (dp !== except) dp.close();
    });
  }

  function bindGlobalHooks() {
    if (_globalHooks) return;
    _globalHooks = true;

    document.addEventListener('click', function(e) {
      if (e.target.closest('.dp-wrap')) return;
      closeAll(null);
    });

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeAll(null);
    });
  }

  /* ---------- DatePicker class ---------- */

  function DatePicker(input) {
    this.input   = input;
    this.current = null;   // {y,m,d} mostrado en el calendario
    this.value   = null;   // {y,m,d} seleccionado
    this.open    = false;
    this.wrap    = null;
    this.trigger = null;
    this.panel   = null;
    this._build();
    _pickers.push(this);
  }

  DatePicker.prototype._build = function() {
    var self = this;

    /* Ocultar el input original pero mantenerlo funcional */
    this.input.style.display  = 'none';
    this.input.style.position = 'absolute';
    this.input.style.pointerEvents = 'none';
    this.input.setAttribute('aria-hidden', 'true');
    this.input.tabIndex = -1;

    /* Parsear valor inicial */
    var initial = parseIso(this.input.value);
    this.value   = initial;
    this.current = initial ? { y: initial.y, m: initial.m, d: initial.d }
                           : (function(){ var t = today(); return { y:t.y, m:t.m, d:t.d }; })();

    /* Wrapper (ocupa el lugar del input) */
    var wrap = document.createElement('div');
    wrap.className = 'dp-wrap';
    wrap.style.cssText = 'position:relative;width:100%';
    this.wrap = wrap;

    /* Trigger button */
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dp-trigger';
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = this._triggerHTML(this.value);
    trigger.addEventListener('click', function(e) {
      e.stopPropagation();
      self.toggle();
    });
    this.trigger = trigger;
    wrap.appendChild(trigger);

    /* Panel */
    var panel = document.createElement('div');
    panel.className = 'dp-panel';
    panel.style.display = 'none';
    this.panel = panel;
    wrap.appendChild(panel);

    /* Insertar en el DOM al lado del input original */
    this.input.parentNode.insertBefore(wrap, this.input.nextSibling);

    /* Observar cambios programáticos en el input original */
    this._watchInputChanges();

    bindGlobalHooks();
  };

  DatePicker.prototype._triggerHTML = function(val) {
    var calIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
    var arrowIcon = '<svg class="dp-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';

    var displayText = val
      ? '<span class="dp-val">' + formatDisplay(val) + '</span>'
      : '<span class="dp-ph">Seleccioná una fecha...</span>';

    return calIcon + displayText + arrowIcon;
  };

  DatePicker.prototype.toggle = function() {
    if (this.open) { this.close(); return; }
    closeAll(this);
    this.show();
  };

  DatePicker.prototype.show = function() {
    if (!this.current) {
      var t = today();
      this.current = { y: t.y, m: t.m, d: t.d };
    }
    this.open = true;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.trigger.classList.add('open');
    this._renderPanel();
    this.panel.style.display = 'block';
    // Animate in
    this.panel.style.opacity = '0';
    this.panel.style.transform = 'translateY(-6px) scale(.98)';
    requestAnimationFrame(function() {
      this.panel.style.transition = 'opacity .18s ease, transform .18s ease';
      this.panel.style.opacity = '1';
      this.panel.style.transform = 'none';
    }.bind(this));
  };

  DatePicker.prototype.close = function() {
    if (!this.open) return;
    this.open = false;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.classList.remove('open');
    var panel = this.panel;
    panel.style.transition = 'opacity .15s ease, transform .15s ease';
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(-4px) scale(.98)';
    setTimeout(function() {
      panel.style.display = 'none';
      panel.style.transition = '';
    }, 160);
  };

  DatePicker.prototype._renderPanel = function() {
    var self = this;
    var y = this.current.y;
    var m = this.current.m;
    var t = today();
    var sel = this.value;

    var days = daysInMonth(y, m);
    var firstDay = firstDayOfWeek(y, m);

    /* --- header navigation --- */
    var html = '<div class="dp-header">';
    html += '<button type="button" class="dp-nav dp-prev" aria-label="Mes anterior">'
          + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg>'
          + '</button>';
    html += '<div class="dp-month-year">'
          + '<button type="button" class="dp-month-btn">' + MESES[m-1] + '</button>'
          + '<button type="button" class="dp-year-btn">' + y + '</button>'
          + '</div>';
    html += '<button type="button" class="dp-nav dp-next" aria-label="Mes siguiente">'
          + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>'
          + '</button>';
    html += '</div>';

    /* --- day-of-week headers --- */
    html += '<div class="dp-grid">';
    DIAS_CORTO.forEach(function(d) {
      html += '<div class="dp-dow">' + d + '</div>';
    });

    /* --- blank cells before first day --- */
    for (var b = 0; b < firstDay; b++) {
      html += '<div class="dp-cell dp-blank"></div>';
    }

    /* --- day cells --- */
    for (var d = 1; d <= days; d++) {
      var isToday = (y === t.y && m === t.m && d === t.d);
      var isSel   = sel && (y === sel.y && m === sel.m && d === sel.d);
      var cls = 'dp-cell dp-day';
      if (isToday) cls += ' dp-today';
      if (isSel)   cls += ' dp-selected';
      html += '<div class="' + cls + '" data-day="' + d + '">' + d + '</div>';
    }

    html += '</div>';

    /* --- quick today button --- */
    html += '<div class="dp-footer">'
          + '<button type="button" class="dp-today-btn">Hoy</button>'
          + '</div>';

    this.panel.innerHTML = html;

    /* --- bind events --- */

    this.panel.querySelector('.dp-prev').addEventListener('click', function(e) {
      e.stopPropagation();
      self._navMonth(-1);
    });
    this.panel.querySelector('.dp-next').addEventListener('click', function(e) {
      e.stopPropagation();
      self._navMonth(+1);
    });
    this.panel.querySelector('.dp-today-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      var t2 = today();
      self.current = { y: t2.y, m: t2.m, d: t2.d };
      self.select(t2.y, t2.m, t2.d);
    });

    this.panel.querySelectorAll('.dp-day').forEach(function(cell) {
      cell.addEventListener('click', function(e) {
        e.stopPropagation();
        var day = +cell.dataset.day;
        self.select(self.current.y, self.current.m, day);
      });
    });

    /* month/year selectors — simple inline pickers */
    this.panel.querySelector('.dp-month-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      self._showMonthPicker();
    });
    this.panel.querySelector('.dp-year-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      self._showYearPicker();
    });
  };

  DatePicker.prototype._navMonth = function(delta) {
    var m = this.current.m + delta;
    var y = this.current.y;
    if (m > 12) { m = 1;  y++; }
    if (m < 1)  { m = 12; y--; }
    this.current.m = m;
    this.current.y = y;
    this._renderPanel();
  };

  DatePicker.prototype.select = function(y, m, d) {
    this.value = { y:y, m:m, d:d };
    this.current = { y:y, m:m, d:d };
    var iso = isoFromParts(y, m, d);

    /* Actualizar el input oculto */
    this.input.value = iso;
    this.input.dispatchEvent(new Event('change', { bubbles: true }));
    this.input.dispatchEvent(new Event('input',  { bubbles: true }));

    /* Actualizar trigger */
    this.trigger.innerHTML = this._triggerHTML(this.value);

    this.close();
  };

  DatePicker.prototype._showMonthPicker = function() {
    var self = this;
    var grid = '<div class="dp-picker-grid">';
    MESES.forEach(function(mes, i) {
      var cls = 'dp-picker-cell' + (i+1 === self.current.m ? ' dp-selected' : '');
      grid += '<div class="' + cls + '" data-val="' + (i+1) + '">' + mes.slice(0,3) + '</div>';
    });
    grid += '</div>';
    this.panel.innerHTML = '<div class="dp-picker-header"><button type="button" class="dp-picker-back">&#8592; Volver</button></div>' + grid;
    this.panel.querySelector('.dp-picker-back').addEventListener('click', function(e) {
      e.stopPropagation(); self._renderPanel();
    });
    this.panel.querySelectorAll('.dp-picker-cell').forEach(function(c) {
      c.addEventListener('click', function(e) {
        e.stopPropagation();
        self.current.m = +c.dataset.val;
        self._renderPanel();
      });
    });
  };

  DatePicker.prototype._showYearPicker = function() {
    var self = this;
    var base = self.current.y;
    var start = base - 5;
    var grid = '<div class="dp-picker-grid">';
    for (var i = 0; i < 12; i++) {
      var yr = start + i;
      var cls = 'dp-picker-cell' + (yr === self.current.y ? ' dp-selected' : '');
      grid += '<div class="' + cls + '" data-val="' + yr + '">' + yr + '</div>';
    }
    grid += '</div>';
    this.panel.innerHTML = '<div class="dp-picker-header"><button type="button" class="dp-picker-back">&#8592; Volver</button></div>' + grid;
    this.panel.querySelector('.dp-picker-back').addEventListener('click', function(e) {
      e.stopPropagation(); self._renderPanel();
    });
    this.panel.querySelectorAll('.dp-picker-cell').forEach(function(c) {
      c.addEventListener('click', function(e) {
        e.stopPropagation();
        self.current.y = +c.dataset.val;
        self._renderPanel();
      });
    });
  };

  /* Observar asignaciones programáticas al input oculto */
  DatePicker.prototype._watchInputChanges = function() {
    var self = this;
    var input = this.input;

    /* Interceptar .value = 'YYYY-MM-DD' con un setter en la propiedad */
    var descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor && descriptor.set) {
      var originalSet = descriptor.set;
      Object.defineProperty(input, 'value', {
        get: function() { return descriptor.get.call(input); },
        set: function(val) {
          originalSet.call(input, val);
          var parsed = parseIso(val);
          if (parsed) {
            self.value   = parsed;
            self.current = { y: parsed.y, m: parsed.m, d: parsed.d };
            if (self.trigger) {
              self.trigger.innerHTML = self._triggerHTML(parsed);
            }
          }
        },
        configurable: true
      });
    }
  };

  /* ---------- init pública ---------- */

  function initAll() {
    document.querySelectorAll('input[type="date"]').forEach(function(input) {
      if (input.dataset.dpInit) return;
      input.dataset.dpInit = '1';
      new DatePicker(input);
    });
  }

  /* También init sobre nuevos elementos (para modales dinámicos) */
  function initIn(root) {
    if (!root) return;
    root.querySelectorAll('input[type="date"]').forEach(function(input) {
      if (input.dataset.dpInit) return;
      input.dataset.dpInit = '1';
      new DatePicker(input);
    });
  }

  window.DP = {
    initAll: initAll,
    initIn:  initIn
  };

})();
