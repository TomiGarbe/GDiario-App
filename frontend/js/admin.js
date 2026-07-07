var ADMIN_EMAILS = {
  "tomigarbe2003@gmail.com": true,
  "cristiangarbe@gmail.com": true
};

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
  if (!list.length) {
    el.innerHTML = '<div class="mov-empty">No hay errores ni pendientes de Sheets</div>';
    return;
  }

  el.innerHTML = list.map(function(job) {
    var status = String(job && job.status || '').toUpperCase();
    var title = [
      job && job.movement_date || '-',
      job && job.movement_type || '-',
      '$ ' + (job && job.movement_amount || '0')
    ].join(' | ');
    var err = String(job && job.last_error || 'Pendiente sin error registrado');
    var id = String(job && job.id || '');
    return [
      '<div class="mov-item">',
      '  <div class="mov-main">',
      '    <div class="mov-title">' + escapeHtmlAdmin_(title) + '</div>',
      '    <div class="mov-sub">' + escapeHtmlAdmin_(status + ' | intentos ' + (job.attempts || 0) + '/' + (job.max_attempts || 0)) + '</div>',
      '    <div class="mov-sub">' + escapeHtmlAdmin_(err) + '</div>',
      '  </div>',
      "  <button type=\"button\" class=\"btn btn-outline\" onclick=\"reintentarSheetJobAdmin('" + id + "')\">Reintentar</button>",
      '</div>'
    ].join('');
  }).join('');
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
    });
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
