var MOVIMIENTOS_DIA_CACHE = [];
var MOVIMIENTOS_SELECCIONADOS = Object.create(null);
var MODAL_ACTIVO = null;
var MODAL_ESC_HOOK_LISTO = false;
var ACCIONES_MOV_LISTO = false;
var MODO_SELECCION_MOVS = false;
var MODAL_ON_CLOSE = null;
var SALDO_FETCH_SEQ = 0;
var MOVIMIENTOS_FETCH_SEQ = 0;
var RECARGA_VISTA_SALDO_PROMESA = null;

var CLIENTES_ESPECIALES_FALLBACK = [
  'BUENOS DIAS',
  'CORDIEZ',
  'MARIANO',
  'SCURTI',
  'AMANECER',
  'OVIEDO',
  'ALMACOR 35'
];

function setSaldoLoading(activo) {
  var saldoEl = document.getElementById('saldo');
  if (!saldoEl) return;

  if (activo) {
    saldoEl.classList.add('saldo-loading');
    saldoEl.innerHTML = '<span class="spinner spinner-sm spinner-light" aria-hidden="true"></span><span>Cargando...</span>';
    return;
  }

  saldoEl.classList.remove('saldo-loading');
}

function renderLoadingMovimientos() {
  var list = document.getElementById('movList');
  if (!list) return;

  list.innerHTML = [
    '<div class="mov-loading">',
    '  <div class="spinner spinner-sm" aria-hidden="true"></div>',
    '  <span>Cargando movimientos...</span>',
    '</div>'
  ].join('');
}

function registrarLoadersSeccionesSaldo() {
  if (typeof registerSectionLoader !== 'function') return;

  registerSectionLoader('saldo', {
    show: function() { setSaldoLoading(true); },
    hide: function() { setSaldoLoading(false); }
  });

  registerSectionLoader('movimientos', {
    show: function() { renderLoadingMovimientos(); },
    hide: function() {}
  });
}

registrarLoadersSeccionesSaldo();

function limpiarCacheMovimientosDia() {
  MOVIMIENTOS_DIA_CACHE = [];
  MOVIMIENTOS_SELECCIONADOS = Object.create(null);
}

function cargarSaldo(opts) {
  var options = opts || {};
  var reqId = ++SALDO_FETCH_SEQ;
  if (typeof showSectionLoader === 'function') showSectionLoader('saldo');
  else setSaldoLoading(true);
  var payload = {};
  if (options.forzar) payload._ts = Date.now();

  return api("obtenerSaldo", payload).then(function(respuesta) {
    if (reqId !== SALDO_FETCH_SEQ) return;

    if (respuesta && typeof respuesta === 'object' && respuesta.error) {
      throw new Error(String(respuesta.error || "Error al obtener saldo"));
    }

    var saldo = pickNumber(respuesta, ['saldo', 'monto', 'total']);
    document.getElementById('saldo').textContent = saldo || 0;
  }).catch(function(err) {
    if (reqId !== SALDO_FETCH_SEQ) return;

    console.error("Error cargarSaldo:", err);
    document.getElementById('saldo').textContent = '0';
    showToast('No se pudo actualizar el saldo', 'error');
  }).finally(function() {
    if (reqId !== SALDO_FETCH_SEQ) return;
    if (typeof hideSectionLoader === 'function') hideSectionLoader('saldo');
    else setSaldoLoading(false);
  });
}

function normalizarTipoMovimiento(tipo) {
  return String(tipo || '').trim().toLowerCase();
}

function formatearNumeroMov(valor) {
  var n = Math.round(toNumber(valor) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function fechaIsoMov(valor) {
  if (!valor) return '';

  if (typeof valor === 'string') {
    var raw = valor.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
      var p = raw.split('/');
      return p[2] + '-' + p[1] + '-' + p[0];
    }
  }

  var d = new Date(valor);
  if (isNaN(d.getTime())) return '';

  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Buenos_Aires'
    }).format(d);
  } catch (e) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
}

function normalizarMovimiento(item) {
  var mov = item && typeof item === 'object' ? item : {};
  var id = String(mov.id || mov.ID || '').trim();
  var tipo = String(mov.tipo || mov.movimiento || mov.concepto || '').trim();
  var cliente = String(mov.cliente || '').trim();
  var detalle = String(mov.detalle || '').trim();
  var producto = String(mov.producto || '').trim();
  var kg = toNumber(mov.kg);
  var monto = pickNumber(mov, ['monto', 'subtotal', 'total', 'importe', 'valor']);
  var fecha = fechaIsoMov(mov.fecha || mov.Fecha || mov.dia);
  var clase = String(mov.clase || '').trim().toLowerCase();
  var datos = mov.datos;
  if (typeof datos === 'string') {
    try {
      datos = JSON.parse(datos);
    } catch (e) {
      datos = null;
    }
  }

  return {
    id: id,
    fecha: fecha,
    tipo: tipo || 'Movimiento',
    cliente: cliente,
    detalle: detalle,
    producto: producto,
    kg: kg,
    monto: monto,
    clase: clase,
    datos: (datos && typeof datos === 'object') ? datos : null,
    editable: mov.editable !== false
  };
}

function esTipoIngreso(tipoRaw) {
  var tipo = normalizarTipoMovimiento(tipoRaw);
  return tipo === 'entrega de dinero' || tipo === 'venta';
}

function esIngresoMovimiento(mov, monto) {
  var clase = String(mov && mov.clase || '').toLowerCase();
  if (clase === 'ingreso') return true;
  if (clase === 'egreso') return false;

  if (esTipoIngreso(mov && mov.tipo)) return true;
  return toNumber(monto) < 0;
}

function esMovimientoGasto(mov) {
  return normalizarTipoMovimiento(mov && mov.tipo) === 'gasto';
}

function esTipoEntregaDineroMov(tipoRaw) {
  var tipo = normalizarTipoMovimiento(tipoRaw);
  return tipo === 'entrega de dinero' || tipo === 'entrega';
}

function puedeEditarMovimiento(mov) {
  var tipo = normalizarTipoMovimiento(mov && mov.tipo);
  var soportado = tipo === 'compra'
    || tipo === 'descarga'
    || tipo === 'pago a cliente'
    || esTipoEntregaDineroMov(tipo)
    || tipo === 'gasto';
  return !!(mov && mov.id) && mov.editable !== false && soportado;
}

function detalleMovimiento(mov) {
  var partes = [];

  if (mov) {
    if (mov.cliente) partes.push('Cliente: ' + mov.cliente);
    if (mov.producto && toNumber(mov.kg) > 0) partes.push('Producto: ' + mov.producto + ' ' + formatearNumeroMov(mov.kg) + ' kg');
    else if (mov.datos) {
      if (Array.isArray(mov.datos.productos) && mov.datos.productos.length > 1) {
        var productosTxt = mov.datos.productos.map(function(item) {
          var prod = String(item && item.producto || '').trim();
          var kg = toNumber(item && item.kg);
          if (!prod || !(kg > 0)) return '';
          return prod + ' ' + formatearNumeroMov(kg) + ' kg';
        }).filter(Boolean).join(' | ');

        if (productosTxt) partes.push('Productos: ' + productosTxt);
      }
      else if (Array.isArray(mov.datos.empleados) && mov.datos.empleados.length) {
        var empleadosTxt = mov.datos.empleados.map(function(item) {
          var nombre = String(item && item.nombre || '').trim();
          var monto = toNumber(item && item.monto);
          if (!nombre || !(monto > 0)) return '';
          return nombre + ' $ ' + formatearNumeroMov(monto);
        }).filter(Boolean).join(' | ');

        if (empleadosTxt) partes.push('Ayudantes: ' + empleadosTxt);
      }
      else if (mov.detalle && mov.tipo && !esTipoIngreso(mov.tipo)) {
        partes.push(mov.detalle);
      }
    }
  }

  return partes.join(' | ');
}

function normalizarListaMovimientos(payload) {
  if (Array.isArray(payload)) {
    return payload.map(normalizarMovimiento);
  }

  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.movimientos)) return payload.movimientos.map(normalizarMovimiento);
  if (Array.isArray(payload.lista)) return payload.lista.map(normalizarMovimiento);
  if (Array.isArray(payload.data)) return payload.data.map(normalizarMovimiento);
  if (Array.isArray(payload.items)) return payload.items.map(normalizarMovimiento);

  return [];
}

function normalizarRespuestaMovimientos(payload) {
  var lista = normalizarListaMovimientos(payload);
  var data = {
    movimientos: lista,
    totIngresos: 0,
    totEgresos: 0,
    traeTotIngresos: false,
    traeTotEgresos: false
  };

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    if (Object.prototype.hasOwnProperty.call(payload, 'totIngresos')) {
      data.traeTotIngresos = true;
      data.totIngresos = toNumber(payload.totIngresos);
    } else if (Object.prototype.hasOwnProperty.call(payload, 'ingresos')) {
      data.traeTotIngresos = true;
      data.totIngresos = toNumber(payload.ingresos);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'totEgresos')) {
      data.traeTotEgresos = true;
      data.totEgresos = toNumber(payload.totEgresos);
    } else if (Object.prototype.hasOwnProperty.call(payload, 'egresos')) {
      data.traeTotEgresos = true;
      data.totEgresos = toNumber(payload.egresos);
    }
  }

  if (!data.traeTotIngresos || !data.traeTotEgresos) {
    var ingresos = 0;
    var egresos = 0;

    data.movimientos.forEach(function(mov) {
      var montoRaw = toNumber(mov.monto);
      var monto = Math.abs(montoRaw);
      if (monto <= 0.000001) return;

      if (esIngresoMovimiento(mov, montoRaw)) ingresos += monto;
      else egresos += monto;
    });

    if (!data.traeTotIngresos) data.totIngresos = ingresos;
    if (!data.traeTotEgresos) data.totEgresos = egresos;
  }

  return data;
}

function escapeHtml(txt) {
  return String(txt)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function limpiarSeleccionInexistente() {
  var idsDisponibles = Object.create(null);
  MOVIMIENTOS_DIA_CACHE.forEach(function(mov) {
    if (mov && mov.id) idsDisponibles[mov.id] = true;
  });

  Object.keys(MOVIMIENTOS_SELECCIONADOS).forEach(function(id) {
    if (!idsDisponibles[id]) delete MOVIMIENTOS_SELECCIONADOS[id];
  });
}

function obtenerIdsSeleccionados() {
  return Object.keys(MOVIMIENTOS_SELECCIONADOS).filter(function(id) {
    return !!MOVIMIENTOS_SELECCIONADOS[id];
  });
}

function limpiarSeleccionMovimientos() {
  MOVIMIENTOS_SELECCIONADOS = Object.create(null);
}

function refrescarListaMovimientosActual() {
  if (MOVIMIENTOS_DIA_CACHE.length) {
    renderMovimientosDia(MOVIMIENTOS_DIA_CACHE);
    return;
  }
  renderVacioMovimientos();
}

function setModoSeleccionMovimientos(activo) {
  MODO_SELECCION_MOVS = !!activo;
  if (!MODO_SELECCION_MOVS) {
    limpiarSeleccionMovimientos();
  }
  refrescarListaMovimientosActual();
}

function toggleModoSeleccionMovimientos() {
  setModoSeleccionMovimientos(!MODO_SELECCION_MOVS);
}

function actualizarAccionesSeleccion() {
  var wrap = document.getElementById('movBulkActions');
  var btnModo = document.getElementById('btnModoSeleccion');
  var btnEditarFecha = document.getElementById('btnEditarFechaSeleccionados');
  var btn = document.getElementById('btnEliminarSeleccionados');
  if (!wrap || !btn || !btnModo || !btnEditarFecha) return;

  wrap.style.display = 'flex';

  btnModo.textContent = MODO_SELECCION_MOVS ? 'Cancelar' : 'Seleccionar';
  btnModo.classList.toggle('btn-danger-outline', MODO_SELECCION_MOVS);

  var ids = obtenerIdsSeleccionados();
  if (!MODO_SELECCION_MOVS || !ids.length) {
    btnEditarFecha.style.display = 'none';
    btn.style.display = 'none';
    return;
  }

  btnEditarFecha.style.display = 'inline-flex';
  btnEditarFecha.textContent = ids.length === 1
    ? 'Editar fecha'
    : ('Editar fecha (' + ids.length + ')');
  btn.style.display = 'inline-flex';
  btn.textContent = ids.length === 1
    ? 'Eliminar seleccionado'
    : ('Eliminar ' + ids.length + ' seleccionados');
}

function renderVacioMovimientos() {
  var list = document.getElementById('movList');
  if (!list) return;

  list.innerHTML = `
    <div class="mov-empty">
      <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
      Sin movimientos para esta fecha
    </div>
  `;

  actualizarAccionesSeleccion();
}

function htmlAccionesMovimiento(mov) {
  if (!mov.id) return '';

  var iconEdit = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>';
  var iconDelete = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12h10l1-12"/><path d="M9 7V4h6v3"/></svg>';

  var btnEditar = puedeEditarMovimiento(mov)
    ? `<button type="button" class="mov-act mov-act-edit" data-mov-action="edit" data-id="${escapeHtml(mov.id)}" title="Editar movimiento" aria-label="Editar movimiento">${iconEdit}</button>`
    : '';

  return `
    <div class="mov-item-actions">
      ${btnEditar}
      <button type="button" class="mov-act mov-act-del" data-mov-action="delete" data-id="${escapeHtml(mov.id)}" title="Eliminar movimiento" aria-label="Eliminar movimiento">${iconDelete}</button>
    </div>
  `;
}

function renderMovimientosDia(payload) {
  var normalizada = normalizarRespuestaMovimientos(payload);
  MOVIMIENTOS_DIA_CACHE = normalizada.movimientos.slice();
  limpiarSeleccionInexistente();

  var listEl = document.getElementById('movList');
  if (!listEl) return;

  if (!MOVIMIENTOS_DIA_CACHE.length) {
    document.getElementById('totIngresos').textContent = formatearNumeroMov(normalizada.totIngresos);
    document.getElementById('totEgresos').textContent = formatearNumeroMov(normalizada.totEgresos);

    var netoVacio = normalizada.totIngresos - normalizada.totEgresos;
    var netoElVacio = document.getElementById('netodia');
    netoElVacio.textContent = '$ ' + formatearNumeroMov(netoVacio);
    netoElVacio.className = 'dia-neto-val ' + (netoVacio >= 0 ? 'pos' : 'neg');

    renderVacioMovimientos();
    return;
  }

  var html = '';
  var ingresosCalc = 0;
  var egresosCalc = 0;

  MOVIMIENTOS_DIA_CACHE.forEach(function(mov) {
    var montoRaw = toNumber(mov.monto);
    var monto = Math.abs(montoRaw);
    var neutro = monto <= 0.000001;
    var ingreso = !neutro && esIngresoMovimiento(mov, montoRaw);
    var tono = neutro ? 'neutro' : (ingreso ? 'ingreso' : 'egreso');
    var hasId = !!mov.id;
    var isSelected = hasId && !!MOVIMIENTOS_SELECCIONADOS[mov.id];

    if (!neutro) {
      if (ingreso) ingresosCalc += monto;
      else egresosCalc += monto;
    }

    var title = escapeHtml(mov.tipo || 'Movimiento');
    var detail = escapeHtml(detalleMovimiento(mov));
    var detailHTML = detail ? ('<div class="mov-detail">' + detail + '</div>') : '';
    var labelTipo = neutro ? 'Neutro' : (ingreso ? 'Ingreso' : 'Egreso');
    var iconoTipo = neutro ? '&#8722;' : (ingreso ? '&#8599;' : '&#8595;');
    var montoTxt = neutro ? '$ 0' : ((ingreso ? '+' : '-') + ' $ ' + formatearNumeroMov(monto));
    var selectionClass = isSelected ? ' is-selected' : '';
    var modeClass = MODO_SELECCION_MOVS ? ' selection-mode' : '';
    var clickableClass = hasId ? '' : ' no-id';

    html += `
      <div class="mov-item es-${tono}${selectionClass}${modeClass}${clickableClass}" data-id="${escapeHtml(mov.id)}">
        <div class="mov-top">
          <div class="mov-monto ${tono}">${montoTxt}</div>
          ${htmlAccionesMovimiento(mov)}
        </div>

        <div class="mov-main">
          <div class="mov-dot dot-${tono}">${iconoTipo}</div>
          <div class="mov-body">
            <div class="mov-title">${title}</div>
            ${detailHTML}
            <span class="mov-badge ${tono}">${labelTipo}</span>
          </div>
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;

  var ingresos = normalizada.traeTotIngresos ? normalizada.totIngresos : ingresosCalc;
  var egresos = normalizada.traeTotEgresos ? normalizada.totEgresos : egresosCalc;
  var neto = ingresos - egresos;

  document.getElementById('totIngresos').textContent = formatearNumeroMov(ingresos);
  document.getElementById('totEgresos').textContent = formatearNumeroMov(egresos);

  var netoEl = document.getElementById('netodia');
  netoEl.textContent = '$ ' + formatearNumeroMov(neto);
  netoEl.className = 'dia-neto-val ' + (neto >= 0 ? 'pos' : 'neg');

  bindEventosListaMovimientos();
  actualizarAccionesSeleccion();
}

function bindEventosListaMovimientos() {
  var listEl = document.getElementById('movList');
  if (!listEl) return;

  listEl.querySelectorAll('.mov-item').forEach(function(item) {
    item.addEventListener('click', function() {
      var id = String(item.dataset.id || '').trim();
      if (!id) return;

      if (MODO_SELECCION_MOVS) {
        if (MOVIMIENTOS_SELECCIONADOS[id]) delete MOVIMIENTOS_SELECCIONADOS[id];
        else MOVIMIENTOS_SELECCIONADOS[id] = true;

        refrescarListaMovimientosActual();
        return;
      }

      abrirModalEditarMovimiento(id);
    });
  });

  listEl.querySelectorAll('[data-mov-action]').forEach(function(btn) {
    btn.addEventListener('click', function(evt) {
      evt.stopPropagation();

      var id = String(btn.dataset.id || '').trim();
      var action = String(btn.dataset.movAction || '').trim();
      if (!id || !action) return;

      if (action === 'delete') {
        confirmarEliminarMovimientos([id]);
        return;
      }

      if (action === 'edit') {
        abrirModalEditarMovimiento(id);
      }
    });
  });
}

function esRespuestaMovimientosValida(respuesta) {
  if (Array.isArray(respuesta)) return true;
  if (!respuesta || typeof respuesta !== 'object') return false;
  if (respuesta.error) return false;

  return Array.isArray(respuesta.movimientos)
    || Array.isArray(respuesta.lista)
    || Array.isArray(respuesta.data)
    || Array.isArray(respuesta.items)
    || Object.prototype.hasOwnProperty.call(respuesta, 'totIngresos')
    || Object.prototype.hasOwnProperty.call(respuesta, 'totEgresos')
    || Object.prototype.hasOwnProperty.call(respuesta, 'ingresos')
    || Object.prototype.hasOwnProperty.call(respuesta, 'egresos');
}

function pedirMovimientos(action, fecha, logLabel, opts) {
  var payload = { fecha: fecha };
  if (opts && opts.forzar) payload._ts = Date.now();

  return api(action, payload).then(function(respuesta) {
    return respuesta;
  });
}

function obtenerMovimientosDia(fecha, opts) {
  return pedirMovimientos("obtenerMovimientos", fecha, "MOVIMIENTOS:", opts)
    .catch(function() {
      return pedirMovimientos("obtenerMovimientosDia", fecha, "MOVIMIENTOS (fallback):", opts);
    });
}

function inicializarAccionesMovimientos() {
  if (ACCIONES_MOV_LISTO) return;
  ACCIONES_MOV_LISTO = true;

  var btnModoSel = document.getElementById('btnModoSeleccion');
  if (btnModoSel) {
    btnModoSel.addEventListener('click', function() {
      toggleModoSeleccionMovimientos();
    });
  }

  var btnEliminarSel = document.getElementById('btnEliminarSeleccionados');
  if (btnEliminarSel) {
    btnEliminarSel.addEventListener('click', function() {
      var ids = obtenerIdsSeleccionados();
      if (!ids.length) return;
      confirmarEliminarMovimientos(ids);
    });
  }

  var btnEditarFechaSel = document.getElementById('btnEditarFechaSeleccionados');
  if (btnEditarFechaSel) {
    btnEditarFechaSel.addEventListener('click', function() {
      var ids = obtenerIdsSeleccionados();
      if (!ids.length) return;
      abrirModalEditarFechaSeleccionados(ids);
    });
  }

  actualizarAccionesSeleccion();
}

function cargarMovimientosDia(opts) {
  var options = opts || {};
  var reqId = ++MOVIMIENTOS_FETCH_SEQ;

  inicializarAccionesMovimientos();

  if (options.resetCache) {
    limpiarCacheMovimientosDia();
  }

  var fecha = document.getElementById('fechaSaldo').value || hoyArgentinaISO();
  if (typeof showSectionLoader === 'function') showSectionLoader('movimientos');
  else renderLoadingMovimientos();

  return obtenerMovimientosDia(fecha, options)
    .then(function(respuesta) {
      if (reqId !== MOVIMIENTOS_FETCH_SEQ) return;

      if (!esRespuestaMovimientosValida(respuesta)) {
        renderMovimientosDia([]);
        return;
      }

      renderMovimientosDia(respuesta);
    })
    .catch(function(err) {
      if (reqId !== MOVIMIENTOS_FETCH_SEQ) return;

      document.getElementById('totIngresos').textContent = '0';
      document.getElementById('totEgresos').textContent = '0';
      document.getElementById('netodia').textContent = '$ 0';
      document.getElementById('netodia').className = 'dia-neto-val pos';
      renderMovimientosDia([]);
    });
}

function cargarVistaSaldo() {
  if (RECARGA_VISTA_SALDO_PROMESA) {
    return RECARGA_VISTA_SALDO_PROMESA;
  }

  RECARGA_VISTA_SALDO_PROMESA = Promise.all([
    cargarSaldo({ forzar: true }),
    cargarMovimientosDia({ forzar: true, resetCache: true })
  ]).finally(function() {
    RECARGA_VISTA_SALDO_PROMESA = null;
  });

  return RECARGA_VISTA_SALDO_PROMESA;
}

function obtenerModalRoot() {
  return document.getElementById('modalRoot') || document.body;
}

function cerrarModalActual() {
  if (!MODAL_ACTIVO) return;

  var onClose = MODAL_ON_CLOSE;
  MODAL_ON_CLOSE = null;

  MODAL_ACTIVO.classList.remove('open');
  var ref = MODAL_ACTIVO;
  MODAL_ACTIVO = null;

  setTimeout(function() {
    if (ref && ref.parentNode) ref.parentNode.removeChild(ref);
    if (typeof onClose === 'function') {
      try {
        onClose();
      } catch (e) {
        console.error('Error al cerrar modal:', e);
        showToast('No se pudo cerrar el modal', 'error');
      }
    }
  }, 160);
}

function asegurarHookModalEsc() {
  if (MODAL_ESC_HOOK_LISTO) return;
  MODAL_ESC_HOOK_LISTO = true;

  document.addEventListener('keydown', function(evt) {
    if (evt.key !== 'Escape') return;
    if (!MODAL_ACTIVO) return;
    cerrarModalActual();
  });
}

function abrirModal(config) {
  cerrarModalActual();
  asegurarHookModalEsc();
  MODAL_ON_CLOSE = config && typeof config.onClose === 'function' ? config.onClose : null;

  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  var card = document.createElement('div');
  card.className = 'modal-card' + (config && config.cardClass ? (' ' + config.cardClass) : '');

  var header = document.createElement('div');
  header.className = 'modal-header';

  var title = document.createElement('h2');
  title.className = 'modal-title';
  title.textContent = String(config && config.title || '');
  header.appendChild(title);

  var btnCerrar = document.createElement('button');
  btnCerrar.type = 'button';
  btnCerrar.className = 'btn-cerrar close-btn';
  btnCerrar.setAttribute('aria-label', 'Cerrar');
  btnCerrar.textContent = '×';
  btnCerrar.addEventListener('click', function() {
    cerrarModalActual();
  });
  header.appendChild(btnCerrar);

  card.appendChild(header);

  var body = document.createElement('div');
  body.className = 'modal-body';
  if (config && typeof config.buildBody === 'function') {
    config.buildBody(body, card);
  } else if (config && config.html) {
    body.innerHTML = String(config.html);
  }
  card.appendChild(body);

  overlay.appendChild(card);

  overlay.addEventListener('click', function(evt) {
    if (evt.target !== overlay) return;
    if (config && config.closeOnBackdrop === false) return;
    cerrarModalActual();
  });

  var root = obtenerModalRoot();
  root.appendChild(overlay);
  MODAL_ACTIVO = overlay;

  setTimeout(function() {
    overlay.classList.add('open');
  }, 0);

  return {
    overlay: overlay,
    card: card,
    body: body
  };
}

function abrirConfirmacion(opts) {
  var mensaje = String(opts && opts.message || 'Â¿Confirmar acciÃ³n?');

  var modal = abrirModal({
    title: String(opts && opts.title || 'Confirmar'),
    buildBody: function(body) {
      var msg = document.createElement('p');
      msg.className = 'modal-text';
      msg.textContent = mensaje;
      body.appendChild(msg);

      var actions = document.createElement('div');
      actions.className = 'modal-actions';

      var btnCancelar = document.createElement('button');
      btnCancelar.type = 'button';
      btnCancelar.className = 'btn btn-outline';
      btnCancelar.textContent = 'Cancelar';
      btnCancelar.addEventListener('click', function() {
        cerrarModalActual();
      });

      var btnConfirmar = document.createElement('button');
      btnConfirmar.type = 'button';
      btnConfirmar.className = 'btn btn-danger-solid';
      var textoConfirmar = String(opts && opts.confirmLabel || 'Eliminar');
      var spinConfirmar = document.createElement('div');
      spinConfirmar.className = 'spin';
      var lblConfirmar = document.createElement('span');
      lblConfirmar.className = 'lbl';
      lblConfirmar.textContent = textoConfirmar;
      btnConfirmar.appendChild(spinConfirmar);
      btnConfirmar.appendChild(lblConfirmar);
      btnConfirmar.addEventListener('click', function() {
        if (opts && typeof opts.onConfirm === 'function') {
          opts.onConfirm(btnConfirmar, btnCancelar);
        }
      });

      actions.appendChild(btnCancelar);
      actions.appendChild(btnConfirmar);
      body.appendChild(actions);
    }
  });

  return modal;
}

function confirmarEliminarMovimientos(ids) {
  var unicos = Array.from(new Set(
    (ids || []).map(function(id) { return String(id || '').trim(); }).filter(Boolean)
  ));

  if (!unicos.length) return;

  var mensaje = unicos.length === 1
    ? '¿Seguro que quieres eliminar este movimiento?'
    : ('¿Seguro que quieres eliminar ' + unicos.length + ' movimientos?');

  abrirConfirmacion({
    title: 'Eliminar movimientos',
    message: mensaje,
    confirmLabel: 'Eliminar',
    onConfirm: function(btnConfirmar, btnCancelar) {
      btnCancelar.disabled = true;

      ejecutarConLoading(function() {
        return ejecutarEliminarMovimientos(unicos);
      }, {
        boton: btnConfirmar,
        textoBoton: 'Eliminando...',
        textoGlobal: unicos.length === 1
          ? 'Eliminando movimiento...'
          : 'Eliminando movimientos...'
      })
        .then(function() {
          cerrarModalActual();
          showToast(unicos.length === 1 ? 'Movimiento eliminado' : 'Movimientos eliminados', 'success');
        })
        .catch(function(err) {
          btnCancelar.disabled = false;
          showToast(err && err.message ? err.message : 'No se pudo eliminar', 'error');
        });
    }
  });
}

function ejecutarEliminarMovimientos(ids) {
  var unicos = Array.from(new Set(
    (ids || []).map(function(id) { return String(id || '').trim(); }).filter(Boolean)
  ));
  if (!unicos.length) return Promise.resolve();

  var fecha = document.getElementById('fechaSaldo').value || hoyArgentinaISO();

  return fetchConAuth({
    accion: "eliminarMovimiento",
    ids: unicos,
    fecha: fecha
  }).then(function() {
    unicos.forEach(function(id) { delete MOVIMIENTOS_SELECCIONADOS[id]; });
    return Promise.all([
      cargarMovimientosDia(),
      cargarSaldo()
    ]);
  });
}

function normalizarIdsMovimientos(ids) {
  return Array.from(new Set(
    (ids || []).map(function(id) { return String(id || '').trim(); }).filter(Boolean)
  ));
}

function parseFechaIsoLocalSaldo(fechaISO) {
  var raw = String(fechaISO || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;

  var partes = raw.split('-');
  var y = Number(partes[0]);
  var m = Number(partes[1]);
  var d = Number(partes[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;

  var date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y
    || date.getMonth() !== (m - 1)
    || date.getDate() !== d
  ) {
    return null;
  }

  return date;
}

function esFinDeSemanaFechaIsoSaldo(fechaISO) {
  if (typeof esFinDeSemanaFechaISO === 'function') {
    return !!esFinDeSemanaFechaISO(fechaISO);
  }

  var date = parseFechaIsoLocalSaldo(fechaISO);
  if (!date) return false;

  var dia = date.getDay();
  return dia === 0 || dia === 6;
}

function obtenerMovimientosPorIds(ids) {
  var unicos = normalizarIdsMovimientos(ids);
  var encontrados = [];
  var faltantes = [];

  unicos.forEach(function(id) {
    var mov = obtenerMovimientoPorId(id);
    if (!mov) {
      faltantes.push(id);
      return;
    }
    encontrados.push(mov);
  });

  if (faltantes.length) {
    throw new Error('No se encontraron algunos movimientos seleccionados');
  }

  return encontrados;
}

function construirDataEdicionFechaCompra(mov, nuevaFecha) {
  var cliente = String(mov && mov.cliente || '').trim();
  if (!cliente) {
    throw new Error('Una compra no tiene cliente');
  }

  var productos = obtenerProductosCompraDesdeMovimiento(mov).map(function(item) {
    return {
      producto: String(item && item.producto || '').trim(),
      kg: toNumber(item && item.kg)
    };
  }).filter(function(item) {
    return !!item.producto && item.kg > 0;
  });

  if (!productos.length) {
    throw new Error('Una compra no tiene productos validos');
  }

  var monto = Math.abs(toNumber(mov && mov.monto));

  return {
    fecha: nuevaFecha,
    productos: [{
      tipo: 'Compra',
      cliente: cliente,
      detalle: String(mov && mov.detalle || '').trim(),
      monto: monto,
      montoTotal: monto,
      productos: productos,
      datos: { productos: productos }
    }]
  };
}

function construirDataEdicionFechaDescarga(mov, nuevaFecha) {
  var cliente = String(mov && mov.cliente || '').trim();
  if (!cliente) {
    throw new Error('Una descarga no tiene cliente');
  }

  var datos = mov && mov.datos && typeof mov.datos === 'object' ? mov.datos : null;
  var producto = String(
    (mov && mov.producto) || (datos && datos.producto) || ''
  ).trim();
  var kg = toNumber(
    (mov && mov.kg) || (datos && datos.kg)
  );

  if (!producto || !(kg > 0)) {
    throw new Error('Una descarga no tiene producto o kg validos');
  }

  return {
    fecha: nuevaFecha,
    productos: [{
      tipo: 'Descarga',
      cliente: cliente,
      detalle: String(mov && mov.detalle || '').trim(),
      producto: producto,
      kg: kg,
      datos: {
        producto: producto,
        kg: kg
      }
    }]
  };
}

function construirDataEdicionFechaPagoCliente(mov, nuevaFecha) {
  var cliente = String(mov && mov.cliente || '').trim();
  var monto = Math.abs(toNumber(mov && mov.monto));

  if (!cliente) throw new Error('Un pago a cliente no tiene cliente');
  if (!(monto > 0)) throw new Error('Un pago a cliente no tiene monto valido');

  return {
    fecha: nuevaFecha,
    productos: [{
      tipo: 'Pago a cliente',
      cliente: cliente,
      detalle: String(mov && mov.detalle || '').trim(),
      monto: monto
    }]
  };
}

function construirDataEdicionFechaEntrega(mov, nuevaFecha) {
  var monto = Math.abs(toNumber(mov && mov.monto));
  if (!(monto > 0)) throw new Error('Una entrega no tiene monto valido');

  return {
    fecha: nuevaFecha,
    tipo: 'Entrega de dinero',
    cliente: String(mov && mov.cliente || '').trim(),
    detalle: String(mov && mov.detalle || 'Entrega de dinero').trim(),
    monto: monto
  };
}

function construirDataEdicionFechaGasto(mov, nuevaFecha) {
  var empleados = obtenerEmpleadosGastoDesdeMovimiento(mov);
  var monto = Math.abs(toNumber(mov && mov.monto));
  if (!(monto > 0) && empleados.length) {
    monto = empleados.reduce(function(acc, item) {
      return acc + Math.abs(toNumber(item && item.monto));
    }, 0);
  }
  if (!(monto > 0)) throw new Error('Un gasto no tiene monto valido');

  var detalle = String(mov && mov.detalle || '').trim();
  if (!detalle) detalle = 'Gasto';

  return {
    fecha: nuevaFecha,
    tipo: 'Gasto',
    detalle: detalle,
    monto: monto,
    empleados: empleados,
    datos: empleados.length ? { empleados: empleados } : {}
  };
}

function construirDataEdicionFechaMovimiento(mov, nuevaFecha) {
  var tipo = normalizarTipoMovimiento(mov && mov.tipo);

  if (tipo === 'compra') {
    return construirDataEdicionFechaCompra(mov, nuevaFecha);
  }
  if (tipo === 'descarga') {
    return construirDataEdicionFechaDescarga(mov, nuevaFecha);
  }
  if (tipo === 'pago a cliente') {
    return construirDataEdicionFechaPagoCliente(mov, nuevaFecha);
  }
  if (tipo === 'gasto') {
    return construirDataEdicionFechaGasto(mov, nuevaFecha);
  }
  if (esTipoEntregaDineroMov(tipo)) {
    return construirDataEdicionFechaEntrega(mov, nuevaFecha);
  }

  throw new Error('Hay movimientos seleccionados que no se pueden editar');
}

function prepararTrabajosEdicionFecha(ids, nuevaFecha) {
  var fecha = String(nuevaFecha || '').trim();
  if (!parseFechaIsoLocalSaldo(fecha)) {
    throw new Error('Debes indicar una fecha valida');
  }

  var movimientos = obtenerMovimientosPorIds(ids);
  if (!movimientos.length) {
    throw new Error('No hay movimientos seleccionados');
  }

  var hayCompra = movimientos.some(function(mov) {
    return normalizarTipoMovimiento(mov && mov.tipo) === 'compra';
  });
  if (hayCompra && esFinDeSemanaFechaIsoSaldo(fecha)) {
    throw new Error('No se pueden registrar compras en fin de semana');
  }

  return movimientos.map(function(mov) {
    return {
      id: mov.id,
      data: construirDataEdicionFechaMovimiento(mov, fecha)
    };
  });
}

function ejecutarTrabajosEdicionFecha(trabajos) {
  var lista = Array.isArray(trabajos) ? trabajos.slice() : [];
  if (!lista.length) return Promise.resolve(0);

  var procesados = 0;
  var chain = Promise.resolve();

  lista.forEach(function(job) {
    chain = chain.then(function() {
      return fetchConAuth({
        accion: 'editarMovimiento',
        id: job.id,
        data: job.data
      }).then(function() {
        procesados += 1;
      });
    });
  });

  return chain.then(function() { return procesados; });
}

function abrirModalEditarFechaSeleccionados(ids) {
  var idsSeleccionados = normalizarIdsMovimientos(ids);
  if (!idsSeleccionados.length) return;

  abrirModal({
    title: idsSeleccionados.length === 1
      ? 'Editar fecha del movimiento'
      : 'Editar fecha de seleccionados',
    cardClass: 'modal-card-mini',
    buildBody: function(body) {
      var txt = document.createElement('p');
      txt.className = 'modal-text';
      txt.textContent = idsSeleccionados.length === 1
        ? 'Selecciona la nueva fecha para el movimiento.'
        : ('Selecciona la nueva fecha para ' + idsSeleccionados.length + ' movimientos.');
      body.appendChild(txt);

      var form = document.createElement('div');
      form.className = 'modal-form';

      var field = document.createElement('div');
      field.className = 'field';

      var label = document.createElement('label');
      label.textContent = 'Nueva fecha';

      var fechaInput = document.createElement('input');
      fechaInput.type = 'date';
      fechaInput.value = document.getElementById('fechaSaldo').value || hoyArgentinaISO();
      fechaInput.required = true;

      field.appendChild(label);
      field.appendChild(fechaInput);
      form.appendChild(field);
      body.appendChild(form);

      var actions = document.createElement('div');
      actions.className = 'modal-actions';

      var btnCancelar = document.createElement('button');
      btnCancelar.type = 'button';
      btnCancelar.className = 'btn btn-outline';
      btnCancelar.textContent = 'Cancelar';
      btnCancelar.addEventListener('click', function() {
        cerrarModalActual();
      });

      var btnGuardar = document.createElement('button');
      btnGuardar.type = 'button';
      btnGuardar.className = 'btn btn-green';
      btnGuardar.innerHTML = '<div class="spin"></div><span class="lbl">Guardar</span>';
      btnGuardar.addEventListener('click', function(evt) {
        evt.preventDefault();

        var trabajos;
        try {
          trabajos = prepararTrabajosEdicionFecha(idsSeleccionados, fechaInput.value);
        } catch (err) {
          showToast(err && err.message ? err.message : 'Datos invalidos', 'error');
          return;
        }

        btnCancelar.disabled = true;

        ejecutarConLoading(function() {
          return ejecutarTrabajosEdicionFecha(trabajos)
            .then(function(total) {
              MODO_SELECCION_MOVS = false;
              limpiarSeleccionMovimientos();

              return Promise.all([
                cargarMovimientosDia({ forzar: true, resetCache: true }),
                cargarSaldo({ forzar: true })
              ]).then(function() {
                return total;
              });
            });
        }, {
          boton: btnGuardar,
          textoBoton: 'Guardando...',
          sectionId: 'movimientos',
          textoGlobal: 'Actualizando fecha de movimientos...'
        })
          .then(function(total) {
            cerrarModalActual();
            showToast('Fecha actualizada en ' + total + ' movimientos', 'success');
          })
          .catch(function(err) {
            btnCancelar.disabled = false;
            showToast(err && err.message ? err.message : 'Error al guardar datos', 'error');
          });
      });

      actions.appendChild(btnCancelar);
      actions.appendChild(btnGuardar);
      body.appendChild(actions);

      setTimeout(function() {
        if (fechaInput && typeof fechaInput.focus === 'function') fechaInput.focus();
      }, 40);
    }
  });
}

function obtenerMovimientoPorId(id) {
  var idBuscado = String(id || '').trim();
  if (!idBuscado) return null;

  for (var i = 0; i < MOVIMIENTOS_DIA_CACHE.length; i++) {
    if (String(MOVIMIENTOS_DIA_CACHE[i].id || '') === idBuscado) {
      return MOVIMIENTOS_DIA_CACHE[i];
    }
  }

  return null;
}

function normalizarOpcionesLista(lista) {
  if (!Array.isArray(lista)) return [];

  var out = [];
  var seen = Object.create(null);

  lista.forEach(function(item) {
    var v = String(item == null ? '' : item).trim();
    if (!v) return;
    var k = v.toUpperCase();
    if (seen[k]) return;
    seen[k] = true;
    out.push(v);
  });

  return out;
}

function setOpcionesSelect(selectEl, opciones, selected) {
  if (!selectEl) return;

  var data = normalizarOpcionesLista(opciones);
  var sel = String(selected == null ? '' : selected).trim();

  if (sel && data.indexOf(sel) === -1) data.unshift(sel);

  selectEl.innerHTML = '';

  if (!data.length) {
    var empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Sin opciones';
    selectEl.appendChild(empty);
    selectEl.value = '';
    return;
  }

  data.forEach(function(op) {
    var opt = document.createElement('option');
    opt.value = op;
    opt.textContent = op;
    selectEl.appendChild(opt);
  });

  if (sel && data.indexOf(sel) !== -1) selectEl.value = sel;
  else selectEl.value = data[0];
}

function desacoplarNodoParaEditor(nodo) {
  if (!nodo || !nodo.parentNode) return null;
  var placeholder = document.createComment('editor-placeholder');
  nodo.parentNode.replaceChild(placeholder, nodo);
  return {
    node: nodo,
    placeholder: placeholder
  };
}

function restaurarNodoEditor(ctx) {
  if (!ctx || !ctx.placeholder || !ctx.placeholder.parentNode || !ctx.node) return;
  ctx.placeholder.parentNode.replaceChild(ctx.node, ctx.placeholder);
}

function abrirModalConSeccionClonada(config) {
  var section = document.querySelector(config.sectionSelector);
  var sourceWrap = section ? section.querySelector('.page-wrap') : null;
  if (!sourceWrap) throw new Error('No se encontro formulario para editar');

  var clone = sourceWrap.cloneNode(true);
  var ctxOriginal = desacoplarNodoParaEditor(sourceWrap);
  var modal = null;

  try {
    modal = abrirModal({
      title: String(config.title || 'Editar'),
      closeOnBackdrop: config.closeOnBackdrop !== false,
      cardClass: 'modal-card-editor',
      onClose: function() {
        restaurarNodoEditor(ctxOriginal);
        if (typeof config.onAfterClose === 'function') {
          config.onAfterClose();
        }
      },
      buildBody: function(body) {
        body.appendChild(clone);
      }
    });
  } catch (err) {
    restaurarNodoEditor(ctxOriginal);
    throw err;
  }

  if (typeof config.onBuild === 'function') {
    setTimeout(function() {
      if (!modal || !modal.overlay || !modal.overlay.parentNode) return;

      try {
        config.onBuild(clone, modal.body);
      } catch (err) {
        showToast(err && err.message ? err.message : 'No se pudo abrir el editor', 'error');
        cerrarModalActual();
      }
    }, 0);
  }

  return modal;
}

function obtenerProductosCompraDesdeMovimiento(mov) {
  var datos = mov && mov.datos && typeof mov.datos === 'object' ? mov.datos : null;
  var lista = [];

  if (datos && Array.isArray(datos.productos)) {
    datos.productos.forEach(function(item) {
      var producto = String(item && item.producto || '').trim();
      var kg = toNumber(item && item.kg);
      if (!producto || !(kg > 0)) return;
      lista.push({ producto: producto, kg: kg });
    });
  }

  if (!lista.length) {
    var productoSimple = String(mov && mov.producto || '').trim();
    var kgSimple = toNumber(mov && mov.kg);
    if (productoSimple && kgSimple > 0) {
      lista.push({ producto: productoSimple, kg: kgSimple });
    }
  }

  return lista;
}

function configurarClienteCardCompra(card, cliente) {
  var n = String(card && card.dataset && card.dataset.id || '').trim();
  if (!n) return;

  var opciones = Array.isArray(window.clientes) ? window.clientes.slice() : [];
  if (cliente && opciones.indexOf(cliente) === -1) opciones.unshift(cliente);

  if (typeof csSetOptions === 'function') {
    csSetOptions(n, opciones, cliente || '', true);
  }

  var hidden = document.getElementById('cs-val-' + n);
  if (hidden) hidden.value = cliente || '';
}

function configurarProductosCardCompra(card, productos) {
  var n = String(card && card.dataset && card.dataset.id || '').trim();
  if (!n) return;

  var container = card.querySelector('.compra-productos');
  if (container) container.innerHTML = '';

  var lista = Array.isArray(productos) ? productos : [];
  if (!lista.length) {
    agregarProductoCompra(n, '', '');
    return;
  }

  lista.forEach(function(item) {
    agregarProductoCompra(n, item.producto, item.kg);
  });
}

function prellenarFormularioMovimientoEdicion(root, mov) {
  var fecha = String(mov && mov.fecha || document.getElementById('fechaSaldo').value || hoyArgentinaISO()).trim();
  var tipo = normalizarTipoMovimiento(mov && mov.tipo);
  var detalle = String(mov && mov.detalle || '').trim();
  var monto = toNumber(mov && mov.monto);
  var kg = toNumber(mov && mov.kg);
  var producto = String(mov && mov.producto || '').trim();
  var cliente = String(mov && mov.cliente || '').trim();

  var fechaInp = root.querySelector('#fecha');
  if (fechaInp) fechaInp.value = fecha;

  var total = root.querySelector('#totalGeneral');
  if (total) total.textContent = '0';

  var productosWrap = root.querySelector('#productos');
  if (productosWrap) productosWrap.innerHTML = '';

  var btnAgregarMov = root.querySelector('button[onclick="agregarProducto()"]');
  if (btnAgregarMov) btnAgregarMov.style.display = 'none';

  if (typeof contador === 'number') contador = Math.max(contador, 100000);
  if (typeof compraItemSeq === 'number') compraItemSeq = Math.max(compraItemSeq, 100000);

  var card = agregarProducto();
  if (!card) {
    throw new Error('No se encontro el contenedor #productos para editar');
  }

  card = root.querySelector('.prod-card') || card;
  if (!card) throw new Error('No se pudo inicializar el formulario de movimientos');

  var n = String(card.dataset.id || '');

  if (tipo === 'compra') {
    setTipo(n, 'Compra');
    configurarClienteCardCompra(card, cliente);
    configurarProductosCardCompra(card, obtenerProductosCompraDesdeMovimiento(mov));

    var montoInpCompra = card.querySelector('.monto-inp');
    if (montoInpCompra) montoInpCompra.value = monto > 0 ? String(monto) : '';

    card.dataset.detalleEdicion = detalle;
    programarCalculo(card);
    return;
  }

  if (tipo === 'descarga') {
    setTipo(n, 'Descarga');
    if (typeof csSetValue === 'function') csSetValue('mov-prod-' + n, producto || '', true);

    var kgDescInp = card.querySelector('.kg-inp');
    if (kgDescInp) kgDescInp.value = kg > 0 ? String(kg) : '';

    card.dataset.detalleEdicion = detalle;
    programarCalculo(card);
    return;
  }

  if (tipo === 'pago a cliente') {
    setTipo(n, 'Pago a cliente');

    var opcionesPago = Array.isArray(window.clientesEspeciales) && window.clientesEspeciales.length
      ? window.clientesEspeciales.slice()
      : CLIENTES_ESPECIALES_FALLBACK.slice();
    if (cliente && opcionesPago.indexOf(cliente) === -1) opcionesPago.unshift(cliente);

    if (typeof csSetOptions === 'function') {
      csSetOptions('mov-pago-cli-' + n, opcionesPago, cliente || '', true);
    }

    var montoInpPago = card.querySelector('.monto-inp');
    if (montoInpPago) montoInpPago.value = monto > 0 ? String(monto) : '';

    card.dataset.detalleEdicion = detalle;
    programarCalculo(card);
    return;
  }

  throw new Error('Este tipo de movimiento no se edita con este formulario');
}

function construirPayloadMovimientoDesdeFormularioEdicion(root) {
  if (typeof window.construirPayloadMovimientosDesdeFormulario !== 'function') {
    throw new Error('No se encontro el constructor de payload de movimientos');
  }

  var payload = window.construirPayloadMovimientosDesdeFormulario();
  var lista = payload && Array.isArray(payload.productos) ? payload.productos : [];

  if (lista.length !== 1) {
    throw new Error('La edicion debe contener un solo movimiento');
  }

  var card = root.querySelector('.prod-card');
  if (card) {
    var detalleEdit = String(card.dataset.detalleEdicion || '').trim();
    if (detalleEdit && !lista[0].detalle) {
      lista[0].detalle = detalleEdit;
    }
  }

  return payload;
}

function abrirModalEditarConFormularioMovimientos(mov) {
  return abrirModalConSeccionClonada({
    sectionSelector: '#sec-mov',
    title: 'Editar movimiento',
    onBuild: function(root) {
      prellenarFormularioMovimientoEdicion(root, mov);

      var btnGuardar = root.querySelector('#btnGuardar');
      if (!btnGuardar) throw new Error('No se encontro el boton de guardar');

      btnGuardar.removeAttribute('onclick');
      btnGuardar.innerHTML = '<div class="spin"></div><span class="lbl">Guardar cambios</span>';

      btnGuardar.addEventListener('click', function(evt) {
        evt.preventDefault();

        var payload;
        try {
          payload = construirPayloadMovimientoDesdeFormularioEdicion(root);
        } catch (err) {
          showToast(err && err.message ? err.message : 'Datos invalidos', 'error');
          return;
        }

        ejecutarConLoading(function() {
          return fetchConAuth({
            accion: 'editarMovimiento',
            id: mov.id,
            data: payload
          }).then(function() {
            cerrarModalActual();
            MOVIMIENTOS_SELECCIONADOS[mov.id] = false;
            return Promise.all([
              cargarMovimientosDia(),
              cargarSaldo()
            ]);
          });
        }, {
          boton: btnGuardar,
          textoBoton: 'Guardando...',
          textoGlobal: 'Guardando cambios del movimiento...'
        })
          .then(function() {
            showToast('Movimiento actualizado', 'success');
          })
          .catch(function() {
            showToast('Error al guardar datos', 'error');
          });
      });
    }
  });
}

function prepararFormularioEntregaEdicion(root, mov) {
  var fecha = String(mov && mov.fecha || document.getElementById('fechaSaldo').value || hoyArgentinaISO()).trim();
  var monto = toNumber(mov && mov.monto);

  var saldoHero = root.querySelector('.saldo-hero');
  if (saldoHero) saldoHero.style.display = 'none';

  var fechaMovCard = root.querySelector('.fecha-movimientos-card');
  if (fechaMovCard) fechaMovCard.style.display = 'none';

  var diaTotales = root.querySelector('.dia-totales');
  if (diaTotales) diaTotales.style.display = 'none';

  var diaNeto = root.querySelector('.dia-neto');
  if (diaNeto) diaNeto.style.display = 'none';

  var movimientosCard = root.querySelector('.card:not(.entrega-card)');
  if (movimientosCard) movimientosCard.style.display = 'none';

  var cardEntrega = root.querySelector('#cardEntrega');
  if (cardEntrega) {
    cardEntrega.style.display = 'block';

    var label = cardEntrega.querySelector('.card-label');
    if (label) label.textContent = 'Editar entrega de dinero';
  }

  var fechaInp = root.querySelector('#fechaEntrega');
  if (fechaInp) fechaInp.value = fecha;

  var montoInp = root.querySelector('#montoEntrega');
  if (montoInp) montoInp.value = monto > 0 ? String(monto) : '';
}

function construirDataEdicionEntregaDesdeFormulario(root, mov) {
  var fechaInp = root.querySelector('#fechaEntrega');
  var montoInp = root.querySelector('#montoEntrega');

  var fecha = String(fechaInp && fechaInp.value || '').trim();
  if (!fecha) {
    throw new Error('Debes indicar una fecha');
  }

  var monto = toNumber(montoInp ? montoInp.value : 0);
  if (!monto || monto <= 0) {
    throw new Error('El monto debe ser mayor a 0');
  }

  return {
    fecha: fecha,
    tipo: 'Entrega de dinero',
    cliente: String(mov && mov.cliente || '').trim(),
    detalle: String(mov && mov.detalle || 'Entrega de dinero').trim(),
    monto: monto
  };
}

function abrirModalEditarConFormularioEntrega(mov) {
  return abrirModalConSeccionClonada({
    sectionSelector: '#sec-sal',
    title: 'Editar entrega de dinero',
    onBuild: function(root) {
      prepararFormularioEntregaEdicion(root, mov);

      var btnGuardar = root.querySelector('#btnEntrega');
      if (!btnGuardar) throw new Error('No se encontro el boton de guardar entrega');

      btnGuardar.removeAttribute('onclick');
      btnGuardar.innerHTML = '<div class="spin"></div><span class="lbl">Guardar cambios</span>';

      btnGuardar.addEventListener('click', function(evt) {
        evt.preventDefault();

        var dataEdicion;
        try {
          dataEdicion = construirDataEdicionEntregaDesdeFormulario(root, mov);
        } catch (err) {
          showToast(err && err.message ? err.message : 'Datos invalidos', 'error');
          return;
        }

        ejecutarConLoading(function() {
          return fetchConAuth({
            accion: 'editarMovimiento',
            id: mov.id,
            data: dataEdicion
          }).then(function() {
            cerrarModalActual();
            MOVIMIENTOS_SELECCIONADOS[mov.id] = false;
            return Promise.all([
              cargarMovimientosDia(),
              cargarSaldo()
            ]);
          });
        }, {
          boton: btnGuardar,
          textoBoton: 'Guardando...',
          textoGlobal: 'Guardando cambios de la entrega...'
        })
          .then(function() {
            showToast('Entrega actualizada', 'success');
          })
          .catch(function() {
            showToast('Error al guardar datos', 'error');
          });
      });
    }
  });
}

function obtenerEmpleadosGastoDesdeMovimiento(mov) {
  var datos = mov && mov.datos && typeof mov.datos === 'object' ? mov.datos : null;
  if (!datos || !Array.isArray(datos.empleados)) return [];

  return datos.empleados.map(function(item) {
    return {
      nombre: String(item && item.nombre || '').trim(),
      monto: toNumber(item && item.monto)
    };
  }).filter(function(item) {
    return !!item.nombre && item.monto > 0;
  });
}

function prellenarFormularioGastoEdicion(root, mov) {
  if (typeof inicializarSelectorTipoGasto === 'function') {
    inicializarSelectorTipoGasto();
  }

  var fecha = String(mov && mov.fecha || document.getElementById('fechaSaldo').value || hoyArgentinaISO()).trim();
  var detalle = String(mov && mov.detalle || '').trim();
  var monto = toNumber(mov && mov.monto);
  var empleados = obtenerEmpleadosGastoDesdeMovimiento(mov);
  var esAyudantes = empleados.length > 0 || normalizarTipoMovimiento(detalle) === 'ayudantes';

  var fechaInp = root.querySelector('#fechaGasto');
  if (fechaInp) fechaInp.value = fecha;

  var montoInp = root.querySelector('#monto');
  if (montoInp) montoInp.value = monto > 0 ? String(monto) : '';

  var otroInp = root.querySelector('#otroGasto');
  if (otroInp) otroInp.value = '';

  var list = root.querySelector('#ayudantesList');
  if (list) list.innerHTML = '';

  if (esAyudantes) {
    if (typeof csSetValue === 'function') csSetValue('gasto-tipo', 'Ayudantes', true);
    if (typeof toggleCamposGasto === 'function') {
      toggleCamposGasto('Ayudantes', { skipAutoEmpleado: true });
    }

    if (list) list.innerHTML = '';

    empleados.forEach(function(item) {
      agregarEmpleado({
        nombre: String(item && item.nombre || '').trim().toUpperCase(),
        monto: toNumber(item && item.monto)
      });
    });

    return;
  }

  var tipoBase = normalizarOpcionesLista(TIPOS_GASTO).find(function(item) {
    return normalizarTipoMovimiento(item) === normalizarTipoMovimiento(detalle);
  }) || '';

  if (tipoBase) {
    if (typeof csSetValue === 'function') csSetValue('gasto-tipo', tipoBase, false);
    if (typeof toggleCamposGasto === 'function') toggleCamposGasto(tipoBase);
  } else {
    if (typeof csSetValue === 'function') csSetValue('gasto-tipo', 'Otro', false);
    if (typeof toggleCamposGasto === 'function') toggleCamposGasto('Otro');
    if (otroInp) otroInp.value = detalle;
  }
}

function construirDataEdicionGastoDesdeFormulario() {
  if (typeof window.construirPayloadGastoDesdeFormulario !== 'function') {
    throw new Error('No se encontro el constructor de payload de gastos');
  }

  var payload = window.construirPayloadGastoDesdeFormulario();
  var empleados = Array.isArray(payload.empleados) ? payload.empleados : [];

  return {
    fecha: payload.fecha,
    tipo: 'Gasto',
    detalle: payload.tipo,
    monto: payload.monto,
    empleados: empleados,
    datos: empleados.length ? { empleados: empleados } : {}
  };
}

function abrirModalEditarConFormularioGastos(mov) {
  var valorGastoTipoPrevio = typeof csGetValue === 'function' ? csGetValue('gasto-tipo') : '';

  return abrirModalConSeccionClonada({
    sectionSelector: '#sec-gas',
    title: 'Editar gasto',
    onAfterClose: function() {
      if (typeof csSetValue === 'function') csSetValue('gasto-tipo', valorGastoTipoPrevio, true);
    },
    onBuild: function(root) {
      prellenarFormularioGastoEdicion(root, mov);

      var btnGuardar = root.querySelector('#btnGasto');
      if (!btnGuardar) throw new Error('No se encontro el boton de guardar gasto');

      btnGuardar.removeAttribute('onclick');
      btnGuardar.innerHTML = '<div class="spin"></div><span class="lbl">Guardar cambios</span>';

      btnGuardar.addEventListener('click', function(evt) {
        evt.preventDefault();

        var dataEdicion;
        try {
          dataEdicion = construirDataEdicionGastoDesdeFormulario();
        } catch (err) {
          showToast(err && err.message ? err.message : 'Datos invalidos', 'error');
          return;
        }

        ejecutarConLoading(function() {
          return fetchConAuth({
            accion: 'editarMovimiento',
            id: mov.id,
            data: dataEdicion
          }).then(function() {
            cerrarModalActual();
            MOVIMIENTOS_SELECCIONADOS[mov.id] = false;
            return Promise.all([
              cargarMovimientosDia(),
              cargarSaldo()
            ]);
          });
        }, {
          boton: btnGuardar,
          textoBoton: 'Guardando...',
          textoGlobal: 'Guardando cambios del gasto...'
        })
          .then(function() {
            showToast('Gasto actualizado', 'success');
          })
          .catch(function() {
            showToast('Error al guardar datos', 'error');
          });
      });
    }
  });
}

function abrirModalEditarMovimiento(id) {
  var mov = obtenerMovimientoPorId(id);
  if (!mov) {
    showToast('Movimiento no encontrado', 'error');
    return;
  }

  if (!puedeEditarMovimiento(mov)) {
    showToast('Este movimiento no se puede editar', 'error');
    return;
  }

  var tipo = normalizarTipoMovimiento(mov.tipo);

  try {
    if (tipo === 'gasto') {
      abrirModalEditarConFormularioGastos(mov);
      return;
    }

    if (esTipoEntregaDineroMov(tipo)) {
      abrirModalEditarConFormularioEntrega(mov);
      return;
    }

    abrirModalEditarConFormularioMovimientos(mov);
  } catch (err) {
    showToast(err && err.message ? err.message : 'No se pudo abrir el editor', 'error');
  }
}
function registrarEntrega() {
  var monto = toNumber(document.getElementById('montoEntrega').value);
  var fecha = document.getElementById('fechaEntrega').value;
  var btnEntrega = document.getElementById('btnEntrega');

  ejecutarConLoading(function() {
    return api("registrarEntrega", { monto: monto, fecha: fecha });
  }, {
    boton: btnEntrega,
    textoBoton: 'Guardando...',
    textoGlobal: 'Registrando entrega...'
  })
    .then(function() {
      if (typeof recargarAppManteniendoTab === 'function') {
        recargarAppManteniendoTab();
        return;
      }

      showToast('Guardado correctamente', 'success');
      setTimeout(function() {
        location.reload();
      }, 500);
    })
    .catch(function() {
      showToast('Error al guardar datos', 'error');
    });
}

window.cargarSaldo = cargarSaldo;
window.cargarMovimientosDia = cargarMovimientosDia;
window.cargarVistaSaldo = cargarVistaSaldo;
window.registrarEntrega = registrarEntrega;
