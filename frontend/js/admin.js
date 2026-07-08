var ADMIN_EMAILS = {
  "tomigarbe2003@gmail.com": true,
  "cristiangarbe@gmail.com": true
};
var ADMIN_SHEET_JOBS_CACHE = Object.create(null);

function esUsuarioAdmin() {
  var usuario = typeof obtenerUsuario === 'function' ? obtenerUsuario() : null;
  var email = String(usuario && usuario.email || '').trim().toLowerCase();
  return !!ADMIN_EMAILS[email];
}

function actualizarAdminVisible() {
  var nav = document.getElementById('nav-adm');
  if (!nav) return;
  nav.style.display = esUsuarioAdmin() ? '' : 'none';
}

function renderAdminSheetErrors(rows) {
  var el = document.getElementById('adminSheetErrors');
  if (!el) return;

  var list = Array.isArray(rows) ? rows : [];
  ADMIN_SHEET_JOBS_CACHE = Object.create(null);
  if (!list.length) {
    el.innerHTML = '<div class="mov-empty">No hay errores ni pendientes de Sheets</div>';
    return;
  }

  el.innerHTML = list.map(function(job) {
    var id = String(job && job.id || '');
    if (id) ADMIN_SHEET_JOBS_CACHE[id] = job;
    var tone = tonoSheetJobAdmin_(job);
    var status = textoEstadoSheetJobAdmin_(job);
    var title = tituloSheetJobAdmin_(job);
    var detail = detalleSheetJobAdmin_(job);
    var badge = etiquetaAccionSheetJobAdmin_(job);
    var amount = '$ ' + formatearNumeroAdmin_(job && job.movement_amount);
    var icon = tone === 'egreso' ? '!' : (tone === 'ingreso' ? '&#10003;' : '&#8722;');
    return [
      '<div class="mov-item es-' + tone + ' admin-sheet-job" data-admin-job-id="' + escapeHtmlAdmin_(id) + '">',
      '  <div class="mov-top">',
      '    <div class="mov-monto ' + tone + '">' + escapeHtmlAdmin_(amount) + '</div>',
      '    <div class="mov-item-actions">',
      '      <button type="button" class="mov-act mov-act-edit" data-admin-action="retry" data-id="' + escapeHtmlAdmin_(id) + '" title="Reintentar" aria-label="Reintentar">' + iconRetryAdmin_() + '</button>',
      '      <button type="button" class="mov-act mov-act-del" data-admin-action="delete" data-id="' + escapeHtmlAdmin_(id) + '" title="Eliminar error" aria-label="Eliminar error">' + iconDeleteAdmin_() + '</button>',
      '    </div>',
      '  </div>',
      '  <div class="mov-main">',
      '    <div class="mov-dot dot-' + tone + '">' + icon + '</div>',
      '    <div class="mov-body">',
      '      <div class="mov-title">' + escapeHtmlAdmin_(title) + '</div>',
      '      <div class="mov-detail">' + escapeHtmlAdmin_(detail) + '</div>',
      '      <span class="mov-badge ' + tone + '">' + escapeHtmlAdmin_(status + ' | ' + badge) + '</span>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
  }).join('');

  bindAdminSheetErrors_();
}

function cargarErroresSheetsAdmin() {
  if (!esUsuarioAdmin()) {
    showToast('No autorizado', 'error');
    return Promise.resolve();
  }

  var btn = document.getElementById('btnAdminRefresh');
  if (typeof setBotonLoading === 'function') setBotonLoading(btn, true, 'Actualizando...');

  return request('/admin/sheet-sync/jobs?limit=100')
    .then(function(rows) {
      var filtered = (Array.isArray(rows) ? rows : []).filter(function(job) {
        var status = String(job && job.status || '').toLowerCase();
        return status === 'failed' || status === 'pending';
      });
      renderAdminSheetErrors(filtered);
    })
    .catch(function(err) {
      console.error('Error cargando errores Sheets:', err);
      showToast('No se pudieron cargar errores de Sheets', 'error');
    })
    .finally(function() {
      if (typeof setBotonLoading === 'function') setBotonLoading(btn, false);
    });
}

function procesarPendientesSheetsAdmin() {
  if (!esUsuarioAdmin()) {
    showToast('No autorizado', 'error');
    return Promise.resolve();
  }

  var btn = document.getElementById('btnAdminProcess');
  if (typeof setBotonLoading === 'function') setBotonLoading(btn, true, 'Procesando...');

  return request('/admin/sheet-sync/process-due', { method: 'POST' })
    .then(function(result) {
      showToast('Procesados: ' + (result && result.processed || 0), 'success');
      return cargarErroresSheetsAdmin();
    })
    .catch(function(err) {
      console.error('Error procesando pendientes Sheets:', err);
      showToast('No se pudieron procesar pendientes', 'error');
    })
    .finally(function() {
      if (typeof setBotonLoading === 'function') setBotonLoading(btn, false);
    });
}

function reintentarSheetJobAdmin(jobId) {
  var id = String(jobId || '').trim();
  if (!id) return;

  return request('/admin/sheet-sync/jobs/' + encodeURIComponent(id) + '/retry', { method: 'POST' })
    .then(function() {
      showToast('Reintento ejecutado', 'success');
      return cargarErroresSheetsAdmin();
    })
    .catch(function(err) {
      console.error('Error reintentando Sheets:', err);
      showToast('No se pudo reintentar', 'error');
      throw err;
    });
}

function eliminarSheetJobAdmin(jobId) {
  var id = String(jobId || '').trim();
  if (!id) return Promise.resolve();

  return request('/admin/sheet-sync/jobs/' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function() {
      showToast('Error eliminado de la lista', 'success');
      return cargarErroresSheetsAdmin();
    })
    .catch(function(err) {
      console.error('Error eliminando Sheets job:', err);
      showToast('No se pudo eliminar el error', 'error');
      throw err;
    });
}

function confirmarEliminarSheetJobAdmin(jobId) {
  var id = String(jobId || '').trim();
  if (!id) return;

  if (typeof abrirConfirmacion === 'function') {
    abrirConfirmacion({
      title: 'Eliminar error',
      message: 'Seguro que quieres eliminar este error de la lista?',
      confirmLabel: 'Eliminar',
      onConfirm: function(btnConfirmar, btnCancelar) {
        btnCancelar.disabled = true;
        ejecutarConLoading(function() {
          return eliminarSheetJobAdmin(id);
        }, {
          boton: btnConfirmar,
          textoBoton: 'Eliminando...',
          textoGlobal: 'Eliminando error...'
        }).then(function() {
          cerrarModalActual();
        }).catch(function() {
          btnCancelar.disabled = false;
        });
      }
    });
    return;
  }

  if (window.confirm('Seguro que quieres eliminar este error de la lista?')) {
    eliminarSheetJobAdmin(id).catch(function() {});
  }
}

function abrirDetalleSheetJobAdmin(jobId) {
  var id = String(jobId || '').trim();
  var job = ADMIN_SHEET_JOBS_CACHE[id];
  if (!job) {
    showToast('Error no encontrado', 'error');
    return;
  }

  if (typeof abrirModal !== 'function') {
    window.alert(String(job.last_error || 'Pendiente sin error registrado'));
    return;
  }

  abrirModal({
    title: 'Detalle del error',
    buildBody: function(body) {
      var tone = tonoSheetJobAdmin_(job);
      var summary = document.createElement('div');
      summary.className = 'mov-item es-' + tone + ' no-id';
      summary.innerHTML = [
        '<div class="mov-top">',
        '  <div class="mov-monto ' + tone + '">' + escapeHtmlAdmin_('$ ' + formatearNumeroAdmin_(job.movement_amount)) + '</div>',
        '</div>',
        '<div class="mov-main">',
        '  <div class="mov-dot dot-' + tone + '">' + (tone === 'egreso' ? '!' : '&#8722;') + '</div>',
        '  <div class="mov-body">',
        '    <div class="mov-title">' + escapeHtmlAdmin_(tituloSheetJobAdmin_(job)) + '</div>',
        '    <div class="mov-detail">' + escapeHtmlAdmin_(detalleSheetJobAdmin_(job)) + '</div>',
        '    <span class="mov-badge ' + tone + '">' + escapeHtmlAdmin_(textoEstadoSheetJobAdmin_(job)) + '</span>',
        '  </div>',
        '</div>'
      ].join('');
      body.appendChild(summary);

      var details = document.createElement('div');
      details.className = 'admin-error-detail';
      details.innerHTML = [
        filaDetalleAdmin_('Accion', etiquetaAccionSheetJobAdmin_(job)),
        filaDetalleAdmin_('Intentos', String(job.attempts || 0) + '/' + String(job.max_attempts || 0)),
        filaDetalleAdmin_('Proximo reintento', formatAdminValue_(job.next_retry_at)),
        filaDetalleAdmin_('Movimiento', formatAdminValue_(job.movement_id)),
        filaDetalleAdmin_('Periodo', formatAdminValue_(job.period_id)),
        filaDetalleAdmin_('Sheet', formatAdminValue_(job.sheet_id)),
        filaDetalleAdmin_('Descripcion', formatAdminValue_(job.movement_description)),
        filaDetalleAdmin_('Error', formatAdminValue_(job.last_error || 'Pendiente sin error registrado'), true)
      ].join('');
      body.appendChild(details);

      var actions = document.createElement('div');
      actions.className = 'modal-actions';
      actions.innerHTML = [
        '<button type="button" class="btn btn-outline" id="adminRetryJobModal"><div class="spin"></div><span class="lbl">Reintentar</span></button>',
        '<button type="button" class="btn btn-danger-solid" id="adminDeleteJobModal"><div class="spin"></div><span class="lbl">Eliminar</span></button>'
      ].join('');
      body.appendChild(actions);

      var btnRetry = actions.querySelector('#adminRetryJobModal');
      var btnDelete = actions.querySelector('#adminDeleteJobModal');
      btnRetry.addEventListener('click', function() {
        ejecutarConLoading(function() {
          return reintentarSheetJobAdmin(id);
        }, {
          boton: btnRetry,
          textoBoton: 'Reintentando...',
          textoGlobal: 'Reintentando sincronizacion...'
        }).then(function() {
          cerrarModalActual();
        }).catch(function() {});
      });
      btnDelete.addEventListener('click', function() {
        ejecutarConLoading(function() {
          return eliminarSheetJobAdmin(id);
        }, {
          boton: btnDelete,
          textoBoton: 'Eliminando...',
          textoGlobal: 'Eliminando error...'
        }).then(function() {
          cerrarModalActual();
        }).catch(function() {});
      });
    }
  });
}

function bindAdminSheetErrors_() {
  var el = document.getElementById('adminSheetErrors');
  if (!el) return;

  el.querySelectorAll('.admin-sheet-job').forEach(function(item) {
    item.addEventListener('click', function() {
      abrirDetalleSheetJobAdmin(item.dataset.adminJobId);
    });
  });

  el.querySelectorAll('[data-admin-action]').forEach(function(btn) {
    btn.addEventListener('click', function(evt) {
      evt.stopPropagation();
      var id = String(btn.dataset.id || '').trim();
      var action = String(btn.dataset.adminAction || '').trim();
      if (action === 'retry') {
        reintentarSheetJobAdmin(id).catch(function() {});
        return;
      }
      if (action === 'delete') {
        confirmarEliminarSheetJobAdmin(id);
      }
    });
  });
}

function tonoSheetJobAdmin_(job) {
  var status = String(job && job.status || '').toLowerCase();
  if (status === 'failed') return 'egreso';
  if (status === 'succeeded') return 'ingreso';
  return 'neutro';
}

function textoEstadoSheetJobAdmin_(job) {
  var status = String(job && job.status || '').toLowerCase();
  if (status === 'failed') return 'Fallido';
  if (status === 'pending') return 'Pendiente';
  if (status === 'succeeded') return 'Completado';
  return status || 'Sin estado';
}

function etiquetaAccionSheetJobAdmin_(job) {
  var action = String(job && job.action || '').toLowerCase();
  if (action === 'create') return 'Crear';
  if (action === 'update') return 'Actualizar';
  if (action === 'delete') return 'Eliminar';
  return action || 'Sin accion';
}

function tituloSheetJobAdmin_(job) {
  return [
    job && job.movement_date || '-',
    job && job.movement_type || 'Movimiento'
  ].join(' | ');
}

function detalleSheetJobAdmin_(job) {
  var parts = [];
  parts.push('Intentos: ' + String(job && job.attempts || 0) + '/' + String(job && job.max_attempts || 0));
  parts.push('Accion: ' + etiquetaAccionSheetJobAdmin_(job));
  var desc = String(job && job.movement_description || '').trim();
  if (desc) parts.push('Detalle: ' + desc);
  parts.push('Error: ' + String(job && job.last_error || 'Pendiente sin error registrado'));
  return parts.join(' | ');
}

function filaDetalleAdmin_(label, value, multiline) {
  var cls = multiline ? ' admin-error-detail-value multiline' : ' admin-error-detail-value';
  return [
    '<div class="admin-error-detail-row">',
    '  <div class="admin-error-detail-label">' + escapeHtmlAdmin_(label) + '</div>',
    '  <div class="' + cls.trim() + '">' + escapeHtmlAdmin_(value) + '</div>',
    '</div>'
  ].join('');
}

function formatAdminValue_(value) {
  var txt = String(value == null ? '' : value).trim();
  return txt || '-';
}

function formatearNumeroAdmin_(value) {
  var n = Number(value == null || value === '' ? 0 : value);
  if (!Number.isFinite(n)) n = 0;
  return n.toFixed(2);
}

function iconRetryAdmin_() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>';
}

function iconDeleteAdmin_() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12h10l1-12"/><path d="M9 7V4h6v3"/></svg>';
}

function escapeHtmlAdmin_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.esUsuarioAdmin = esUsuarioAdmin;
window.actualizarAdminVisible = actualizarAdminVisible;
window.cargarErroresSheetsAdmin = cargarErroresSheetsAdmin;
window.procesarPendientesSheetsAdmin = procesarPendientesSheetsAdmin;
window.reintentarSheetJobAdmin = reintentarSheetJobAdmin;
window.eliminarSheetJobAdmin = eliminarSheetJobAdmin;
window.abrirDetalleSheetJobAdmin = abrirDetalleSheetJobAdmin;
