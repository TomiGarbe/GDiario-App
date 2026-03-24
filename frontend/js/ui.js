var _appInicializada = false;

function inicializarApp() {
  if (_appInicializada) return;
  _appInicializada = true;

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

  cargarClientes();
  if (typeof inicializarSelectorTipoGasto === 'function') {
    inicializarSelectorTipoGasto();
  }
  cargarSaldo();
  cargarMovimientosDia();
  agregarProducto();
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

window.mostrar = mostrar;
window.inicializarApp = inicializarApp;
