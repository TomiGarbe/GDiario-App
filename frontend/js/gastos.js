var TIPOS_GASTO = ['Comida', 'Gasoil', 'Ayudantes', 'Otro'];
var EMPLEADOS_AYUDANTES = ['TOMAS', 'KEVIN'];
var AYUDANTE_SELECT_SEQ = 0;
var ICONO_CERRAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';

function inicializarSelectorTipoGasto() {
  var mount = document.getElementById('tipoGastoMount');
  if (!mount || typeof htmlSelectCustom !== 'function') return;

  mount.innerHTML = htmlSelectCustom('gasto-tipo', TIPOS_GASTO, 'Comida', {
    inputId: 'tipo',
    valueClass: 'tipo-gasto-sel',
    placeholder: 'Selecciona tipo de gasto...',
    searchable: false,
    onChange: function(valor) {
      toggleCamposGasto(valor);
    }
  });

  if (typeof csSetValue === 'function') {
    csSetValue('gasto-tipo', 'Comida', true);
  }

  toggleCamposGasto('Comida');
}

function resolverTipoGasto(sel) {
  var valor = '';

  if (typeof sel === 'string') {
    valor = sel;
  } else if (sel && typeof sel.value !== 'undefined') {
    valor = sel.value;
  } else if (typeof csGetValue === 'function') {
    valor = csGetValue('gasto-tipo');
  }

  return valor;
}

function toggleCamposGasto(sel, opts) {
  var valor = resolverTipoGasto(sel);
  var otroField = document.getElementById('otroField');
  var montoField = document.getElementById('montoField');
  var ayudantesField = document.getElementById('ayudantesField');
  var skipAutoEmpleado = !!(opts && opts.skipAutoEmpleado);

  if (otroField) {
    otroField.style.display = valor === 'Otro' ? 'block' : 'none';
  }

  if (montoField) {
    montoField.style.display = valor === 'Ayudantes' ? 'none' : 'block';
  }

  if (ayudantesField) {
    var esAyudantes = valor === 'Ayudantes';
    ayudantesField.style.display = esAyudantes ? 'block' : 'none';

    if (esAyudantes && !skipAutoEmpleado && obtenerBloquesAyudantes().length === 0) {
      agregarEmpleado();
    }
  }
}

function normalizarNombreAyudante(nombre) {
  var txt = String(nombre || '').trim().toUpperCase();
  if (!txt) return '';

  for (var i = 0; i < EMPLEADOS_AYUDANTES.length; i++) {
    if (String(EMPLEADOS_AYUDANTES[i] || '').trim().toUpperCase() === txt) {
      return EMPLEADOS_AYUDANTES[i];
    }
  }

  return txt;
}

function crearBloqueEmpleado(data) {
  var fila = document.createElement('div');
  fila.className = 'ayudante-item bloque-empleado';
  AYUDANTE_SELECT_SEQ += 1;

  var selectId = 'gasto-ayudante-' + AYUDANTE_SELECT_SEQ;
  var nombreInicial = normalizarNombreAyudante(data && data.nombre);
  var montoInicial = toNumber(data && data.monto);
  var opciones = EMPLEADOS_AYUDANTES.slice();
  if (nombreInicial && opciones.indexOf(nombreInicial) === -1) {
    opciones.unshift(nombreInicial);
  }

  var seleccionado = nombreInicial || (opciones[0] || '');

  fila.innerHTML = `
    <div class="ayudante-item-row">
      <div class="ayudante-selector">
        ${htmlSelectCustom(selectId, opciones, seleccionado, {
          placeholder: 'Selecciona empleado...',
          searchable: false,
          valueClass: 'ayudante-nombre'
        })}
      </div>
      <button type="button" class="ayudante-del btn-eliminar" title="Quitar empleado" aria-label="Quitar empleado">${ICONO_CERRAR_SVG}</button>
    </div>
    <div class="field" style="margin:0">
      <label style="font-size:12px;margin-bottom:4px;color:var(--ink3)">Monto ($)</label>
      <input type="text" class="ayudante-monto" placeholder="0.00" inputmode="decimal" data-decimal="true">
    </div>
  `;

  var nombreInput = fila.querySelector('.ayudante-nombre');
  if (nombreInput) nombreInput.value = seleccionado;

  var montoInput = fila.querySelector('.ayudante-monto');
  if (montoInput && montoInicial > 0) {
    montoInput.value = String(montoInicial);
  }

  var btnQuitar = fila.querySelector('.ayudante-del');
  if (btnQuitar) {
    btnQuitar.addEventListener('click', function() {
      fila.remove();
    });
  }

  return fila;
}

function obtenerBloquesAyudantes() {
  var list = document.getElementById('ayudantesList');
  if (!list) return [];
  return Array.prototype.slice.call(list.querySelectorAll('.ayudante-item'));
}

function agregarEmpleado(data) {
  var list = document.getElementById('ayudantesList');
  if (!list) return;
  list.appendChild(crearBloqueEmpleado(data));
}

function obtenerEmpleados() {
  var bloques = obtenerBloquesAyudantes();
  if (bloques.length === 0) {
    throw new Error('Agrega al menos un empleado');
  }

  return bloques.map(function(bloque, index) {
    var nombreEl = bloque.querySelector('.ayudante-nombre');
    var montoEl = bloque.querySelector('.ayudante-monto');

    var nombre = nombreEl ? String(nombreEl.value || '').trim() : '';
    var monto = toNumber(montoEl ? montoEl.value : 0);

    if (!nombre) {
      throw new Error('Empleado invalido en la fila ' + (index + 1));
    }

    if (!monto || monto <= 0) {
      throw new Error('Monto invalido en la fila ' + (index + 1));
    }

    return { nombre: nombre, monto: monto };
  });
}

function calcularTotalEmpleados(empleados) {
  return empleados.reduce(function(acc, item) {
    return acc + toNumber(item.monto || 0);
  }, 0);
}

function construirPayloadGastoDesdeFormulario() {
  var tipo = typeof csGetValue === 'function' ? csGetValue('gasto-tipo') : '';
  if (!tipo) {
    var hidden = document.getElementById('tipo');
    tipo = hidden ? hidden.value : '';
  }

  var fecha = document.getElementById('fechaGasto').value;

  if (tipo === 'Otro') {
    tipo = String(document.getElementById('otroGasto').value || '').trim();
  }

  if (!tipo) {
    throw new Error('Debes indicar un tipo de gasto');
  }

  if (!fecha) {
    throw new Error('Debes indicar una fecha');
  }

  var payload = { tipo: tipo, fecha: fecha };

  if (resolverTipoGasto(tipo) === 'Ayudantes') {
    try {
      var empleados = obtenerEmpleados();
      var montoTotal = calcularTotalEmpleados(empleados);

      if (!montoTotal || montoTotal <= 0) {
        throw new Error('El total de adelantos debe ser mayor a 0');
      }

      payload.empleados = empleados;
      payload.monto = montoTotal;
    } catch (err) {
      throw new Error(err && err.message ? err.message : 'Error en empleados');
    }
  } else {
    var monto = toNumber(document.getElementById('monto').value);
    if (!monto || monto <= 0) {
      throw new Error('El monto debe ser mayor a 0');
    }

    payload.monto = monto;
  }

  return payload;
}

function guardarGasto() {
  var payload;
  try {
    payload = construirPayloadGastoDesdeFormulario();
  } catch (err) {
    toast(err && err.message ? err.message : 'Datos invalidos', 'err');
    return;
  }

  var btnGuardar = document.getElementById('btnGasto');

  ejecutarConLoading(function() {
    return api('guardarGasto', payload);
  }, {
    boton: btnGuardar,
    textoBoton: 'Guardando...',
    textoGlobal: 'Guardando gasto...'
  })
    .then(function(res) {
      if (res && res.error) {
        toast(res.error, 'err');
        return;
      }
      toast('Gasto guardado');
    })
    .catch(function(err) {
      toast(err && err.message ? err.message : 'Error al guardar gasto', 'err');
    });
}

window.inicializarSelectorTipoGasto = inicializarSelectorTipoGasto;
window.toggleOtro = toggleCamposGasto;
window.toggleCamposGasto = toggleCamposGasto;
window.agregarEmpleado = agregarEmpleado;
window.obtenerEmpleados = obtenerEmpleados;
window.calcularTotalEmpleados = calcularTotalEmpleados;
window.construirPayloadGastoDesdeFormulario = construirPayloadGastoDesdeFormulario;
window.guardarGasto = guardarGasto;
