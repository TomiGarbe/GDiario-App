var _appInicializada = false;
var _appInicializando = false;
var _actualizandoDatosManual = false;

function sincronizarUIConDatosIniciales() {
  var cards = Array.prototype.slice.call(document.querySelectorAll('.prod-card'));
  var opcionesClientes = Array.isArray(window.clientes) ? window.clientes.slice() : [];

  cards.forEach(function(card) {
    var n = card && card.dataset ? String(card.dataset.id || '') : '';
    if (!n) return;

    if (typeof csSetOptions === 'function' && typeof csGetValue === 'function') {
      var actual = csGetValue(n);
      var next = opcionesClientes.indexOf(actual) !== -1 ? actual : '';
      csSetOptions(n, opcionesClientes, next, true);
    }

    if (typeof actualizarOpcionesProducto === 'function') {
      actualizarOpcionesProducto(card);
    }

    if (typeof programarCalculo === 'function') {
      programarCalculo(card);
    }
  });

  if (typeof actualizarSelectoresClientesEspeciales === 'function') {
    actualizarSelectoresClientesEspeciales();
  }

  if (typeof actualizarTotal === 'function') {
    actualizarTotal();
  }
}

function actualizarDatosManual() {
  if (_actualizandoDatosManual) return Promise.resolve();
  if (typeof cargarDatosIniciales !== 'function') {
    showToast('No se pudo actualizar los datos', 'error');
    return Promise.resolve();
  }

  _actualizandoDatosManual = true;
  var btnActualizar = document.getElementById('btnActualizarDatos');
  if (typeof setBotonLoading === 'function') {
    setBotonLoading(btnActualizar, true, 'Actualizando...');
  }

  return cargarDatosIniciales()
    .then(function() {
      sincronizarUIConDatosIniciales();
      showToast('Datos actualizados correctamente', 'success');
    })
    .catch(function(err) {
      console.error('Error actualizando datos:', err);
      showToast('No se pudieron actualizar los datos', 'error');
    })
    .finally(function() {
      if (typeof setBotonLoading === 'function') {
        setBotonLoading(btnActualizar, false);
      }
      _actualizandoDatosManual = false;
    });
}

function enlazarBotonActualizarDatos() {
  var btn = document.getElementById('btnActualizarDatos');
  if (!btn || btn.dataset.listenerReady === '1') return;

  btn.dataset.listenerReady = '1';
  btn.addEventListener('click', function() {
    actualizarDatosManual();
  });
}

function inicializarApp() {
  if (_appInicializada || _appInicializando) return;
  _appInicializando = true;
  enlazarBotonActualizarDatos();

  const hoy = hoyArgentinaISO();

  document.getElementById('fecha').value = hoy;
  document.getElementById('fechaGasto').value = hoy;
  document.getElementById('fechaSaldo').value = hoy;
  document.getElementById('fechaEntrega').value = hoy;
  document.getElementById('fechaHoy').textContent = hoy;

  /* Inicializar date pickers custom en todos los inputs de fecha */
  if (typeof DP !== 'undefined' && typeof DP.initAll === 'function') {
    DP.initAll();
  }

  Promise.resolve()
    .then(function() {
      if (typeof inicializarSelectorTipoGasto === 'function') {
        inicializarSelectorTipoGasto();
      }

      return Promise.all([
        Promise.resolve(typeof cargarSaldo === 'function' ? cargarSaldo() : null),
        Promise.resolve(typeof cargarMovimientosDia === 'function' ? cargarMovimientosDia() : null)
      ]);
    })
    .then(function() {
      if (typeof agregarProducto === 'function') {
        agregarProducto();
      }
      _appInicializada = true;
    })
    .finally(function() {
      _appInicializando = false;
    });
}

window.onload = function() {
  if (typeof inicializarAutenticacion === 'function') {
    inicializarAutenticacion(inicializarApp);
    return;
  }
  inicializarApp();
};

function mostrar(v) {
  if (typeof estaLogueado === 'function' && !estaLogueado()) {
    if (typeof mostrarPantallaLogin === 'function') mostrarPantallaLogin();
    return;
  }

  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('sec-' + v).classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  var nav = document.getElementById('nav-' + v);
  if (nav) nav.classList.add('active');

  if (v === 'sal' && typeof cargarVistaSaldo === 'function') {
    cargarVistaSaldo().catch(function(err) {
      console.error('Error al actualizar vista de saldo:', err);
      showToast('No se pudo actualizar la vista de saldo', 'error');
    });
  }
}

/* Cuando se abre un modal con formulario de edicion,
   inicializar date pickers en los inputs que aparezcan */
(function() {
  function tryInitModal(node) {
    if (typeof DP !== 'undefined' && typeof DP.initIn === 'function') {
      setTimeout(function() { DP.initIn(node); }, 30);
    }
  }

  document.addEventListener('DOMContentLoaded', function() {
    var modalRoot = document.getElementById('modalRoot') || document.body;
    if (!modalRoot) return;
    new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          if (node.nodeType === 1) tryInitModal(node);
        });
      });
    }).observe(modalRoot, { childList: true, subtree: false });
  });
})();

/* Scroll suave en foco de campos (mobile + teclado virtual) */
(function() {
  var focusScrollTimer = 0;

  function esCampoEditable(el) {
    if (!el || el.disabled || el.readOnly) return false;

    var tag = String(el.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag !== 'input') return false;

    var tipo = String(el.type || 'text').toLowerCase();
    if (
      tipo === 'hidden' ||
      tipo === 'checkbox' ||
      tipo === 'radio' ||
      tipo === 'button' ||
      tipo === 'submit' ||
      tipo === 'reset' ||
      tipo === 'file' ||
      tipo === 'range' ||
      tipo === 'color'
    ) {
      return false;
    }

    return true;
  }

  function getHeaderOffset() {
    var bar = document.querySelector('.app-bar');
    if (bar) {
      var h = Math.round(bar.getBoundingClientRect().height);
      if (h > 0) return h + 12;
    }

    var raw = getComputedStyle(document.documentElement).getPropertyValue('--header-h');
    var px = parseInt(String(raw || '').trim(), 10);
    return (Number.isFinite(px) ? px : 75) + 12;
  }

  function getBottomOffset() {
    var nav = document.querySelector('.bottom-nav');
    if (nav) {
      var h = Math.round(nav.getBoundingClientRect().height);
      if (h > 0) return h + 12;
    }

    var raw = getComputedStyle(document.documentElement).getPropertyValue('--nav-h');
    var px = parseInt(String(raw || '').trim(), 10);
    return (Number.isFinite(px) ? px : 75) + 12;
  }

  function getScrollBehavior() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 'auto';
    }
    return 'smooth';
  }

  function scrollCampoEnModal(campo, modalBody, behavior) {
    if (!campo || !modalBody) return;

    var bodyRect = modalBody.getBoundingClientRect();
    var fieldRect = campo.getBoundingClientRect();
    var topPad = 10;
    var bottomPad = 14;
    var visibleTop = bodyRect.top + topPad;
    var visibleBottom = bodyRect.bottom - bottomPad;

    if (fieldRect.top >= visibleTop && fieldRect.bottom <= visibleBottom) return;

    var nextTop = modalBody.scrollTop + (fieldRect.top - bodyRect.top) - topPad;
    modalBody.scrollTo({
      top: Math.max(0, Math.round(nextTop)),
      behavior: behavior
    });
  }

  function scrollCampoEnPagina(campo, behavior) {
    var rect = campo.getBoundingClientRect();
    var vv = window.visualViewport;
    var viewportTop = vv ? vv.offsetTop : 0;
    var viewportHeight = vv ? vv.height : window.innerHeight;
    var safeTop = viewportTop + getHeaderOffset();
    var safeBottom = viewportTop + viewportHeight - getBottomOffset();

    if (rect.top >= safeTop && rect.bottom <= safeBottom) return;

    var nextY = window.scrollY + rect.top - getHeaderOffset();
    window.scrollTo({
      top: Math.max(0, Math.round(nextY)),
      behavior: behavior
    });
  }

  document.addEventListener('focusin', function(evt) {
    var campo = evt && evt.target;
    if (!esCampoEditable(campo)) return;
    if (campo.closest('.cs-panel')) return;

    if (focusScrollTimer) clearTimeout(focusScrollTimer);

    focusScrollTimer = setTimeout(function() {
      if (!campo || campo !== document.activeElement) return;

      var behavior = getScrollBehavior();
      var modalOverlay = campo.closest('.modal-overlay');
      var modalBody = campo.closest('.modal-body');

      if (modalOverlay) {
        if (modalBody && modalBody.scrollHeight > (modalBody.clientHeight + 2)) {
          scrollCampoEnModal(campo, modalBody, behavior);
        }
        return;
      }

      scrollCampoEnPagina(campo, behavior);
    }, 300);
  }, true);
})();

window.mostrar = mostrar;
window.inicializarApp = inicializarApp;
window.actualizarDatosManual = actualizarDatosManual;
