var contador = 0;
var compraItemSeq = 0;

var CLIENTES_PAGO_FIJOS = [
  "Buenos dias",
  "Cordiez",
  "Mariano",
  "Scurti",
  "Amanecer",
  "Oviedo",
  "Almacor 35"
];

var CLIENTES_SIN_PRECIO = CLIENTES_PAGO_FIJOS.slice();
var PRODUCTOS_DESCARGA = ['Grasa', 'Huesos'];
var CLIENTES_DESCARGA = ['Nico', 'Marcos', 'Refineria'];
var ICONO_CERRAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>';

function normalizarTexto(valor) {
  return String(valor || "").trim().toUpperCase();
}

function esClienteSinPrecio(cliente) {
  var cli = normalizarTexto(cliente);
  if (!cli) return false;

  var lista = CLIENTES_SIN_PRECIO;
  if (Array.isArray(window.clientesEspeciales) && window.clientesEspeciales.length) {
    lista = window.clientesEspeciales;
  }

  return lista.some(function(item) {
    return normalizarTexto(item) === cli;
  });
}

function esClienteEspecial(cliente) {
  return esClienteSinPrecio(cliente);
}

function calcularMontoProductos(productos) {
  var total = 0;

  (productos || []).forEach(function(item) {
    var precio = toNumber(item && item.precio);
    var kg = toNumber(item && item.kg);
    if (precio > 0 && kg > 0) total += (precio * kg);
  });

  return total;
}

function calcularMonto(productos) {
  return calcularMontoProductos(productos);
}

function prepararCompra(data) {
  return {
    tipo: 'Compra',
    cliente: data.cliente,
    productos: data.productos,
    montoTotal: data.montoTotal,
    esEspecial: !!data.esEspecial
  };
}

function formatDecimal(valor) {
  var n = Math.round(toNumber(valor) * 100) / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function limpiarSugerenciaKgItems(items) {
  items.forEach(function(item) {
    if (!item || !item.row) return;

    item.row.dataset.kgSugerido = '';
    var kgInp = item.row.querySelector('.compra-kg-inp');
    if (kgInp && String(kgInp.value || '').trim() === '') {
      kgInp.placeholder = 'Kg';
    }
  });
}

function setSugerenciaKgItem(row, kgSugerido) {
  if (!row) return;

  var kg = toNumber(kgSugerido);
  if (!Number.isFinite(kg) || kg <= 0) return;

  row.dataset.kgSugerido = String(kg);

  var kgInp = row.querySelector('.compra-kg-inp');
  if (kgInp && String(kgInp.value || '').trim() === '') {
    kgInp.placeholder = 'Sug: ' + formatDecimal(kg);
  }
}

function elegirIndicePrioridadMonto(partes, filtroFn) {
  var candidatos = [];
  for (var i = 0; i < partes.length; i++) {
    if (!filtroFn || filtroFn(partes[i], i)) candidatos.push(i);
  }

  if (candidatos.length === 0) return -1;

  var idxGrasa = candidatos.find(function(idx) {
    return normalizarTexto(partes[idx].producto) === 'GRASA';
  });
  if (idxGrasa !== undefined) return idxGrasa;

  var idxHuesos = candidatos.find(function(idx) {
    return normalizarTexto(partes[idx].producto) === 'HUESOS';
  });
  if (idxHuesos !== undefined) return idxHuesos;

  return candidatos[0];
}

function pintarTotales(card, precio, subtotal, usarGuion) {
  var subtotalEl = card.querySelector('.subtotal-val');

  var precioNum = toNumber(precio);
  var subtotalNum = toNumber(subtotal);

  card.dataset.precio = String(precioNum);
  card.dataset.subtotal = String(subtotalNum);

  if (!subtotalEl) return;

  if (usarGuion) {
    subtotalEl.textContent = '$ -';
    return;
  }

  subtotalEl.textContent = '$ ' + formatDecimal(subtotalNum);
}

function normalizarProductosRespuesta(payload) {
  if (!payload) return [];

  if (Array.isArray(payload)) {
    var unicos = [];
    var vistos = Object.create(null);

    payload.forEach(function(item) {
      var nombre = String(item == null ? '' : item).trim();
      if (!nombre) return;

      var key = normalizarTexto(nombre);
      if (vistos[key]) return;

      vistos[key] = true;
      unicos.push(nombre);
    });

    return unicos;
  }

  if (typeof payload === 'object') {
    var nested = payload.productos || payload.lista || payload.data || payload.items;
    if (nested) return normalizarProductosRespuesta(nested);
  }

  return [];
}

function obtenerProductosPorClienteApi(cliente) {
  var cli = normalizarTexto(cliente);
  if (!cli) return Promise.resolve([]);

  if (typeof window.obtenerProductosPorClienteLocal === 'function') {
    return Promise.resolve(
      normalizarProductosRespuesta(window.obtenerProductosPorClienteLocal(cli))
    );
  }

  return Promise.resolve([]);
}

function obtenerOpcionesProductoPorCard(card) {
  if (!card) return Promise.resolve([]);

  var tipo = card.dataset.tipo;
  if (tipo !== 'Compra') {
    return Promise.resolve(PRODUCTOS_DESCARGA.slice());
  }

  var n = card.dataset.id;
  var clienteEl = document.getElementById('cs-val-' + n);
  var cliente = clienteEl ? clienteEl.value : '';

  return obtenerProductosPorClienteApi(cliente);
}

function obtenerItemsCompra(card) {
  var rows = Array.prototype.slice.call(card.querySelectorAll('.compra-item'));

  return rows.map(function(row) {
    var key = row.dataset.selKey || '';
    var producto = key && typeof csGetValue === 'function'
      ? csGetValue(key)
      : (row.querySelector('.compra-prod-sel') ? row.querySelector('.compra-prod-sel').value : '');

    var kgInp = row.querySelector('.compra-kg-inp');

    return {
      row: row,
      key: key,
      producto: String(producto || '').trim(),
      kgRaw: kgInp ? kgInp.value : ''
    };
  });
}

function actualizarBotonesQuitarCompra(card) {
  var rows = card.querySelectorAll('.compra-item');
  var deshabilitar = rows.length <= 1;

  rows.forEach(function(row) {
    var btn = row.querySelector('.btn-del-compra');
    if (!btn) return;

    btn.disabled = deshabilitar;
    btn.style.opacity = deshabilitar ? '0.45' : '1';
    btn.style.cursor = deshabilitar ? 'not-allowed' : 'pointer';
  });
}

function crearFilaCompra(card, productoInicial, kgInicial) {
  var n = card.dataset.id;
  compraItemSeq++;

  var key = 'mov-compra-prod-' + n + '-' + compraItemSeq;
  var productoInicialTxt = String(productoInicial == null ? '' : productoInicial).trim();
  var opcionesIniciales = productoInicialTxt ? [productoInicialTxt] : [];
  var row = document.createElement('div');
  row.className = 'prod-row compra-item no-price';
  row.dataset.selKey = key;
  row.dataset.kgSugerido = '';

  row.innerHTML = `
    <div class="compra-item-top">
      <div class="compra-item-selector">
        ${htmlSelectCustom(key, opcionesIniciales, productoInicialTxt, {
          placeholder: 'Selecciona producto...',
          searchable: false,
          valueClass: 'compra-prod-sel'
        })}
      </div>
    </div>

    <div class="compra-item-bottom">
      <div class="prod-stat compra-item-precio-wrap">
        <div class="prod-stat-val compra-item-precio-val">$ -</div>
      </div>

      <input type="text" class="compra-kg-inp compra-item-kg" placeholder="Kg" inputmode="decimal" data-decimal="true">

      <button type="button" class="btn-del btn-del-compra compra-item-del" title="Eliminar producto" aria-label="Eliminar producto">${ICONO_CERRAR_SVG}</button>
    </div>
  `;

  var kgInp = row.querySelector('.compra-kg-inp');
  if (kgInp && kgInicial !== undefined && kgInicial !== null && String(kgInicial).trim() !== '') {
    kgInp.value = String(kgInicial);
  }

  if (kgInp) {
    kgInp.addEventListener('input', function() {
      programarCalculo(card);
    });
  }

  var hiddenSel = row.querySelector('.compra-prod-sel');
  if (hiddenSel) {
    hiddenSel.addEventListener('change', function() {
      calcular(card);
    });
  }

  var btnDel = row.querySelector('.btn-del-compra');
  if (btnDel) {
    btnDel.addEventListener('click', function() {
      var filas = card.querySelectorAll('.compra-item');
      if (filas.length <= 1) return;

      row.remove();
      actualizarBotonesQuitarCompra(card);
      actualizarOpcionesProducto(card);
      programarCalculo(card);
    });
  }

  return row;
}

function agregarProductoCompra(n, productoInicial, kgInicial) {
  var card = document.querySelector('.prod-card[data-id="' + n + '"]');
  if (!card) return;

  var container = card.querySelector('.compra-productos');
  if (!container) {
    console.error('Contenedor .compra-productos no encontrado en la tarjeta', n);
    showToast('No se pudo agregar el producto', 'error');
    return;
  }

  var row = crearFilaCompra(card, productoInicial, kgInicial);
  container.appendChild(row);
  if (productoInicial && typeof csSetOptions === 'function') {
    var key = row.dataset.selKey;
    if (key) {
      csSetOptions(key, [String(productoInicial).trim()], String(productoInicial).trim(), true);
    }
  }

  actualizarBotonesQuitarCompra(card);
  actualizarOpcionesProducto(card);
  programarCalculo(card);
}

function actualizarVisibilidadCalculo(card) {
  var tipo = card.dataset.tipo;
  var precioEspecial = card.dataset.precioEspecial === '1';

  var totals = card.querySelector('.prod-totals');
  var montoWrap = card.querySelector('.monto-wrap');
  var montoLabel = card.querySelector('.monto-label');
  var sugerencia = card.querySelector('.prod-sugerencia');
  var compraWrap = card.querySelector('.compra-productos-wrap');
  var descargaRow = card.querySelector('.descarga-row');
  var descargaClienteWrap = card.querySelector('.descarga-cliente-wrap');
  var clienteNormalWrap = card.querySelector('.cliente-normal-wrap');
  var clientePagoWrap = card.querySelector('.pago-cliente-wrap');

  var mostrarTotales = tipo === 'Compra' && !precioEspecial;
  var mostrarMonto = tipo === 'Pago a cliente' || (tipo === 'Compra' && !precioEspecial);
  var mostrarCompra = tipo === 'Compra';
  var mostrarDescarga = tipo === 'Descarga';
  var mostrarClienteNormal = tipo === 'Compra';
  var mostrarClientePago = tipo === 'Pago a cliente';

  if (totals) totals.style.display = mostrarTotales ? 'grid' : 'none';
  if (montoWrap) montoWrap.style.display = mostrarMonto ? 'block' : 'none';
  if (compraWrap) compraWrap.style.display = mostrarCompra ? 'block' : 'none';
  if (descargaRow) descargaRow.style.display = mostrarDescarga ? 'grid' : 'none';
  if (descargaClienteWrap && !mostrarDescarga) descargaClienteWrap.style.display = 'none';
  if (clienteNormalWrap) clienteNormalWrap.style.display = mostrarClienteNormal ? 'block' : 'none';
  if (clientePagoWrap) clientePagoWrap.style.display = mostrarClientePago ? 'block' : 'none';

  if (montoLabel) {
    montoLabel.textContent = tipo === 'Pago a cliente' ? 'Monto ($)' : 'Monto total ($)';
  }

  if (!mostrarTotales && sugerencia) sugerencia.textContent = '';
}

function setTipoUI(card, tipo) {
  var badge = card.querySelector('.prod-badge');
  var pills = card.querySelectorAll('.tipo-pill');

  card.className = 'prod-card ' + (tipo === 'Compra' ? 'es-compra' : (tipo === 'Descarga' ? 'es-descarga' : 'es-pago'));

  if (badge) {
    badge.textContent = tipo;

    if (tipo === 'Compra') badge.className = 'prod-badge badge-compra';
    else if (tipo === 'Descarga') badge.className = 'prod-badge badge-descarga';
    else badge.className = 'prod-badge badge-pago';
  }

  if (pills.length >= 3) {
    pills[0].classList.toggle('sel-compra', tipo === 'Compra');
    pills[0].classList.toggle('sel-descarga', false);
    pills[0].classList.toggle('sel-pago', false);

    pills[1].classList.toggle('sel-compra', false);
    pills[1].classList.toggle('sel-descarga', tipo === 'Descarga');
    pills[1].classList.toggle('sel-pago', false);

    pills[2].classList.toggle('sel-compra', false);
    pills[2].classList.toggle('sel-descarga', false);
    pills[2].classList.toggle('sel-pago', tipo === 'Pago a cliente');
  }

  actualizarVisibilidadCalculo(card);
}

function actualizarSelectoresClientesEspeciales(scope) {
  var base = scope || document;
  var cards = [];

  if (base.classList && base.classList.contains('prod-card')) {
    cards = [base];
  } else if (typeof base.querySelectorAll === 'function') {
    cards = Array.prototype.slice.call(base.querySelectorAll('.prod-card'));
  }

  cards.forEach(function(card) {
    var n = card.dataset.id;
    if (!n) return;

    var key = 'mov-pago-cli-' + n;
    var actual = typeof csGetValue === 'function' ? csGetValue(key) : '';

    if (typeof csSetOptions === 'function') {
      csSetOptions(key, CLIENTES_PAGO_FIJOS, actual, true);
    }
  });
}

function actualizarSelectorPagoClientes() {
  actualizarSelectoresClientesEspeciales();
}

function actualizarOpcionesProducto(card) {
  if (!card) return;

  var n = card.dataset.id;
  var keyDesc = 'mov-prod-' + n;
  if (typeof csSetOptions === 'function') {
    var opcionesDescarga = PRODUCTOS_DESCARGA.slice();
    var actualDesc = typeof csGetValue === 'function' ? csGetValue(keyDesc) : '';
    if (actualDesc && opcionesDescarga.indexOf(actualDesc) === -1) {
      opcionesDescarga.unshift(actualDesc);
    }
    var fallbackDesc = opcionesDescarga[0] || '';
    var nextDesc = actualDesc || fallbackDesc;
    csSetOptions(keyDesc, opcionesDescarga, nextDesc, true);
  }

  var reqId = Number(card.dataset.optReqId || '0') + 1;
  card.dataset.optReqId = String(reqId);

  obtenerOpcionesProductoPorCard(card).then(function(opciones) {
    if (!document.body.contains(card)) return;
    if (Number(card.dataset.optReqId || '0') !== reqId) return;

    var lista = Array.isArray(opciones) ? opciones.slice() : [];
    var fallback = lista[0] || '';
    var huboCambio = false;

    var items = obtenerItemsCompra(card);
    items.forEach(function(item) {
      if (!item.key || typeof csSetOptions !== 'function') return;

      var actual = typeof csGetValue === 'function' ? csGetValue(item.key) : item.producto;
      var opciones = lista.slice();
      if (actual && opciones.indexOf(actual) === -1) {
        opciones.unshift(actual);
      }
      var next = actual || fallback;

      if (String(actual || '') !== String(next || '')) huboCambio = true;
      csSetOptions(item.key, opciones, next, true);
    });

    if (huboCambio) {
      programarCalculo(card);
    }
  }).catch(function() {
    if (!document.body.contains(card)) return;
    if (Number(card.dataset.optReqId || '0') !== reqId) return;

    var huboCambio = false;
    var items = obtenerItemsCompra(card);
    items.forEach(function(item) {
      if (!item.key || typeof csSetOptions !== 'function') return;

      var actual = typeof csGetValue === 'function' ? csGetValue(item.key) : item.producto;
      if (actual) huboCambio = true;
      csSetOptions(item.key, [], '', true);
    });

    if (huboCambio) {
      programarCalculo(card);
    }
  });
}

function programarCalculo(card) {
  if (!card) return;

  clearTimeout(card._calcTimer);

  var calcId = (Number(card.dataset.calcId || '0') + 1);
  card.dataset.calcId = String(calcId);

  card._calcTimer = setTimeout(function() {
    calcular(card, calcId);
  }, 300);
}

function getClienteDefault(fechaStr) {
  if (!fechaStr) return '';
  var parts = fechaStr.split('-');
  if (parts.length !== 3) return '';
  var fecha = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  var dia = fecha.getDay();
  if (dia === 1 || dia === 2 || dia === 4) return 'Nico';
  if (dia === 3) return 'Marcos';
  if (dia === 5) return 'Refineria';
  return '';
}

function actualizarClienteDescarga(card) {
  var n = card.dataset.id;
  var producto = typeof csGetValue === 'function' ? csGetValue('mov-prod-' + n) : '';
  var clienteWrap = card.querySelector('.descarga-cliente-wrap');
  if (!clienteWrap) return;

  if (producto === 'Huesos') {
    clienteWrap.style.display = 'none';
    return;
  }

  clienteWrap.style.display = 'block';

  if (card.dataset.clienteManual === '1') return;

  var fechaStr = document.getElementById('fecha') ? document.getElementById('fecha').value : '';
  var sugerido = getClienteDefault(fechaStr);
  if (sugerido && typeof csSetValue === 'function') {
    csSetValue('mov-desc-cli-' + n, sugerido, true);
  }
}

function agregarProducto() {
  contador++;
  var n = contador;

  var card = document.createElement('div');
  card.className = 'prod-card es-compra';
  card.dataset.id = n;
  card.dataset.tipo = 'Compra';
  card.dataset.precioEspecial = '0';
  card.dataset.precio = '0';
  card.dataset.subtotal = '0';
  card.dataset.calcId = '0';

  card.innerHTML = `
    <div class="prod-head">
      <div class="prod-head-left">
        <span class="prod-badge badge-compra" id="badge-${n}">Compra</span>
        <span class="prod-num">#${n}</span>
      </div>
      <button type="button" class="btn-del" onclick="eliminarProducto(${n})" aria-label="Eliminar movimiento">${ICONO_CERRAR_SVG}</button>
    </div>

    <div class="tipo-toggle" style="grid-template-columns:1fr 1fr 1fr">
      <button type="button" class="tipo-pill sel-compra" onclick="setTipo(${n},'Compra')">Compra</button>
      <button type="button" class="tipo-pill" onclick="setTipo(${n},'Descarga')">Descarga</button>
      <button type="button" class="tipo-pill" onclick="setTipo(${n},'Pago a cliente')">Pago a cliente</button>
    </div>

    <div class="cliente-normal-wrap">${htmlCS(n)}</div>

    <div class="field pago-cliente-wrap" style="display:none;margin-bottom:10px">
      <label>Cliente</label>
      ${htmlSelectCustom('mov-pago-cli-' + n, CLIENTES_PAGO_FIJOS, '', {
        placeholder: 'Selecciona cliente...',
        searchPlaceholder: 'Buscar cliente...',
        searchable: true,
        valueClass: 'pago-cliente-sel',
        onChange: function() {
          var current = document.querySelector('.prod-card[data-id="' + n + '"]');
          if (current) programarCalculo(current);
        }
      })}
    </div>

    <div class="compra-productos-wrap" style="margin-top:10px">
      <div class="compra-productos"></div>
      <button type="button" class="btn-add-compra">+ Agregar producto</button>
    </div>

    <div class="descarga-row" style="display:none">
      <div style="width:100%">
        ${htmlSelectCustom('mov-prod-' + n, PRODUCTOS_DESCARGA, (PRODUCTOS_DESCARGA[1] || PRODUCTOS_DESCARGA[0] || ''), {
          placeholder: 'Selecciona producto...',
          searchable: false,
          valueClass: 'prod-sel',
          onChange: function() {
            var current = document.querySelector('.prod-card[data-id="' + n + '"]');
            if (current) {
              actualizarClienteDescarga(current);
              programarCalculo(current);
            }
          }
        })}
      </div>
      <input type="text" class="kg-inp" placeholder="Kg" inputmode="decimal" data-decimal="true" style="width:100%">
    </div>

    <div class="descarga-cliente-wrap" style="display:none;margin-top:10px">
      <div class="field" style="margin-bottom:0">
        <label>Cliente</label>
        ${htmlSelectCustom('mov-desc-cli-' + n, CLIENTES_DESCARGA, '', {
          placeholder: 'Selecciona cliente...',
          searchable: false,
          valueClass: 'desc-cliente-sel',
          onChange: function() {
            var current = document.querySelector('.prod-card[data-id="' + n + '"]');
            if (current) current.dataset.clienteManual = '1';
          }
        })}
      </div>
    </div>

    <div class="field monto-wrap" style="margin-top:12px">
      <label class="monto-label">Monto total ($)</label>
      <input type="text" class="monto-inp" placeholder="Monto total" inputmode="decimal" data-decimal="true">
    </div>

    <p class="prod-sugerencia" style="min-height:16px;margin-top:10px;font-size:12px;color:var(--ink3)"></p>

    <div class="prod-totals" style="grid-template-columns:1fr">
      <div class="prod-stat">
        <div class="prod-stat-lbl">Subtotal compra</div>
        <div class="prod-stat-val azul subtotal-val">$ -</div>
      </div>
    </div>
  `;

  var contenedor = document.getElementById('productos');
  if (!contenedor) {
    console.error("Contenedor #productos no encontrado al agregar movimiento");
    showToast('No se pudo inicializar la lista de movimientos', 'error');
    return null;
  }

  contenedor.appendChild(card);

  var btnAddCompra = card.querySelector('.btn-add-compra');
  if (btnAddCompra) {
    btnAddCompra.addEventListener('click', function() {
      agregarProductoCompra(n);
    });
  }

  var kgDescInp = card.querySelector('.kg-inp');
  if (kgDescInp) {
    kgDescInp.addEventListener('input', function() {
      programarCalculo(card);
    });
  }

  var montoInp = card.querySelector('.monto-inp');
  if (montoInp) {
    montoInp.addEventListener('input', function() {
      programarCalculo(card);
    });
  }

  actualizarSelectoresClientesEspeciales(card);
  agregarProductoCompra(n, '', '');
  setTipoUI(card, 'Compra');
  actualizarOpcionesProducto(card);
  programarCalculo(card);

  return card;
}

function calcular(card, calcId) {
  if (!card) return;

  if (!calcId) {
    calcId = Number(card.dataset.calcId || '0') + 1;
    card.dataset.calcId = String(calcId);
  }

  var tipo = card.dataset.tipo;
  var montoInp = card.querySelector('.monto-inp');
  var kgInp = card.querySelector('.kg-inp');
  var sug = card.querySelector('.prod-sugerencia');

  if (tipo === 'Descarga') {
    card.dataset.subtotal = '0';
    card.dataset.precioEspecial = '0';
    pintarTotales(card, 0, 0, true);
    if (sug) sug.textContent = '';
    actualizarVisibilidadCalculo(card);
    actualizarTotal();
    return;
  }

  if (tipo === 'Pago a cliente') {
    card.dataset.precioEspecial = '0';
    card.dataset.precio = '0';
    card.dataset.subtotal = String(toNumber(montoInp ? montoInp.value : 0));
    pintarTotales(card, 0, toNumber(card.dataset.subtotal), true);
    if (kgInp) kgInp.placeholder = 'Kg';
    if (montoInp) montoInp.placeholder = 'Monto';
    if (sug) sug.textContent = '';
    actualizarVisibilidadCalculo(card);
    actualizarTotal();
    return;
  }

  var n = card.dataset.id;
  var cliente = document.getElementById('cs-val-' + n).value;
  var clienteEspecial = esClienteEspecial(cliente);
  var fecha = document.getElementById('fecha').value;

  actualizarOpcionesProducto(card);

  var items = obtenerItemsCompra(card);
  if (items.length === 0) {
    card.dataset.subtotal = '0';
    pintarTotales(card, 0, 0, true);
    if (sug) sug.textContent = '';
    actualizarTotal();
    return;
  }

  limpiarSugerenciaKgItems(items);

  var pedidosPrecio = items.map(function(item) {
    if (clienteEspecial || !cliente || !item.producto) return Promise.resolve({ precio: 0 });
    var precio = 0;
    if (typeof window.obtenerPrecioLocal === 'function') {
      precio = window.obtenerPrecioLocal(cliente, item.producto, fecha);
    }

    return Promise.resolve({ precio: precio });
  });

  Promise.all(pedidosPrecio)
    .then(function(respuestas) {
      if (!document.body.contains(card)) return;
      if (Number(card.dataset.calcId || '0') !== calcId) return;

      var precios = respuestas.map(function(respuesta) {
        return pickNumber(respuesta, ['precio', 'valor', 'monto', 'total']);
      });

      var clienteSinPrecio = clienteEspecial;
      card.dataset.precioEspecial = clienteSinPrecio ? '1' : '0';
      actualizarVisibilidadCalculo(card);

      var montoRaw = montoInp ? montoInp.value : '';
      var montoInformado = String(montoRaw).trim() !== '';
      var montoManual = toNumber(montoRaw);
      var usaMontoManual = montoInformado && montoManual > 0;

      if (clienteSinPrecio && montoInp) {
        montoInp.value = '';
      }

      var totalKg = 0;
      var partes = [];

      items.forEach(function(item, idx) {
        var precioBase = toNumber(precios[idx]);
        var precio = clienteSinPrecio ? 0 : precioBase;
        var kgInfo = leerPositivo(item.kgRaw);
        var kg = kgInfo.estado === 'ok' ? kgInfo.valor : 0;
        var subtotalItem = precio * kg;

        var precioEl = item.row ? item.row.querySelector('.compra-item-precio-val') : null;
        if (item.row) {
          item.row.classList.toggle('no-price', !(precio > 0));
        }

        if (precioEl) {
          if (precio > 0) precioEl.textContent = '$ ' + formatDecimal(precio);
          else precioEl.textContent = '';
        }

        if (kg > 0) totalKg += kg;

        partes.push({
          row: item.row,
          producto: item.producto,
          precio: precio,
          kg: kg,
          subtotal: subtotalItem
        });
      });

      var totalSugerido = calcularMonto(partes);
      var subtotal = 0;

      if (clienteSinPrecio) {
        subtotal = montoInformado ? montoManual : 0;
      } else {
        subtotal = usaMontoManual ? montoManual : totalSugerido;
      }

      pintarTotales(card, 0, subtotal, false);

      if (montoInp) {
        if (clienteSinPrecio) {
          montoInp.placeholder = 'Monto (puede ser 0)';
        } else {
          montoInp.placeholder = totalSugerido > 0
            ? ('Sugerido: ' + formatDecimal(totalSugerido))
            : 'Monto total';
        }
      }

      if (sug) {
        if (clienteSinPrecio) {
          sug.textContent = '';
        } else if (!usaMontoManual && totalSugerido > 0) {
          sug.textContent = 'Monto total sugerido por kg: $ ' + formatDecimal(totalSugerido);
        } else if (!usaMontoManual) {
          sug.textContent = '';
        } else if (totalKg <= 0) {
          var idxSoloMonto = elegirIndicePrioridadMonto(partes);
          if (idxSoloMonto !== -1 && partes[idxSoloMonto].precio > 0) {
            var kgSoloMonto = montoManual / partes[idxSoloMonto].precio;
            setSugerenciaKgItem(partes[idxSoloMonto].row, kgSoloMonto);
            var productoUiSolo = typeof capitalizeFirst === 'function'
              ? capitalizeFirst(partes[idxSoloMonto].producto)
              : partes[idxSoloMonto].producto;
            sug.textContent = 'Sugerencia de kg para ' + productoUiSolo + ': ' + formatDecimal(kgSoloMonto);
          } else {
            sug.textContent = 'No hay precio valido para sugerir kg';
          }
        } else {
          var faltante = montoManual - totalSugerido;
          if (faltante > 0) {
            var idxVacio = elegirIndicePrioridadMonto(partes, function(parte) {
              return parte.kg <= 0;
            });

            if (idxVacio !== -1 && partes[idxVacio].precio > 0) {
              var kgFaltante = faltante / partes[idxVacio].precio;
              setSugerenciaKgItem(partes[idxVacio].row, kgFaltante);
              var productoUiFaltante = typeof capitalizeFirst === 'function'
                ? capitalizeFirst(partes[idxVacio].producto)
                : partes[idxVacio].producto;
              sug.textContent = 'Falta cubrir $ ' + formatDecimal(faltante) + '. Sugerencia: ' + formatDecimal(kgFaltante) + ' kg en ' + productoUiFaltante;
            } else {
              sug.textContent = 'Falta cubrir $ ' + formatDecimal(faltante);
            }
          } else if (Math.abs(faltante) <= 0.000001) {
            sug.textContent = 'Los kg cargados cubren el monto total';
          } else {
            sug.textContent = 'Los kg cargados superan el monto por $ ' + formatDecimal(Math.abs(faltante));
          }
        }
      } else if (!clienteSinPrecio && usaMontoManual) {
        if (totalKg <= 0) {
          var idxSinSug = elegirIndicePrioridadMonto(partes);
          if (idxSinSug !== -1 && partes[idxSinSug].precio > 0) {
            var kgSinSug = montoManual / partes[idxSinSug].precio;
            setSugerenciaKgItem(partes[idxSinSug].row, kgSinSug);
          }
        }
      }

      actualizarTotal();
    })
    .catch(function() {
      if (!document.body.contains(card)) return;
      if (Number(card.dataset.calcId || '0') !== calcId) return;

      card.dataset.subtotal = '0';
      pintarTotales(card, 0, 0, true);
      if (sug) sug.textContent = '';
      actualizarTotal();
    });
}

function actualizarTotal() {
  var total = 0;

  document.querySelectorAll('.prod-card').forEach(function(card) {
    if (card.dataset.tipo !== 'Compra' && card.dataset.tipo !== 'Pago a cliente') return;
    total += toNumber(card.dataset.subtotal);
  });

  document.getElementById('totalGeneral').textContent = formatDecimal(total);
}

function leerPositivo(raw) {
  var txt = String(raw == null ? '' : raw).trim();
  if (txt === '') return { estado: 'vacio', valor: 0 };

  var n = toNumber(txt);
  if (!Number.isFinite(n) || n <= 0) return { estado: 'invalido', valor: 0 };

  return { estado: 'ok', valor: n };
}

function redondearNumero(n) {
  return Math.round(Number(n) * 1000000) / 1000000;
}

function parsePrecio(value) {
  if (value == null) return 0;

  var v = String(value).trim();
  if (v === '') return 0;

  v = v.replace(/\$/g, '').replace(/\./g, '').replace(',', '.');

  var num = Number(v);
  if (!Number.isFinite(num) || isNaN(num)) return 0;

  return num < 0 ? 0 : num;
}

function construirPayloadMovimientosDesdeFormulario() {
  var fecha = document.getElementById('fecha').value;
  if (!fecha) {
    throw new Error('Selecciona una fecha');
  }

  var cards = document.querySelectorAll('.prod-card');
  if (cards.length === 0) {
    throw new Error('Agrega al menos un movimiento');
  }

  var lista = [];
  var error = '';

  cards.forEach(function(card, idx) {
    if (error) return;

    var numero = idx + 1;
    var n = card.dataset.id;
    var tipo = card.dataset.tipo;
    var montoInput = card.querySelector('.monto-inp');
    var montoRaw = montoInput ? montoInput.value : '';

    if (tipo === 'Pago a cliente') {
      var clientePago = card.querySelector('.pago-cliente-sel').value;
      if (!clientePago) {
        error = 'Movimiento #' + numero + ': selecciona un cliente para Pago a cliente';
        return;
      }

      var pagoMontoInfo = leerPositivo(montoRaw);
      if (pagoMontoInfo.estado !== 'ok') {
        error = 'Movimiento #' + numero + ': ingresa un monto mayor a 0 para Pago a cliente';
        return;
      }

      lista.push({
        tipo: 'Pago a cliente',
        producto: '',
        kg: '',
        monto: redondearNumero(pagoMontoInfo.valor),
        cliente: clientePago
      });

      return;
    }

    if (tipo === 'Descarga') {
      var prodDesc = card.querySelector('.prod-sel');
      var kgDescInp = card.querySelector('.kg-inp');

      var productoDesc = prodDesc ? String(prodDesc.value || '').trim() : '';
      if (!productoDesc) {
        error = 'Movimiento #' + numero + ': selecciona un producto para Descarga';
        return;
      }

      var kgDescInfo = leerPositivo(kgDescInp ? kgDescInp.value : '');
      if (kgDescInfo.estado !== 'ok') {
        error = 'Movimiento #' + numero + ': la Descarga requiere kg mayor a 0';
        return;
      }

      var clienteDesc;
      if (productoDesc === 'Huesos') {
        clienteDesc = 'REFINERIA';
      } else {
        clienteDesc = typeof csGetValue === 'function' ? csGetValue('mov-desc-cli-' + n) : '';
        if (!clienteDesc) {
          error = 'Movimiento #' + numero + ': selecciona un cliente para la Descarga';
          return;
        }
      }

      lista.push({
        tipo: 'Descarga',
        producto: productoDesc,
        kg: redondearNumero(kgDescInfo.valor),
        monto: '',
        cliente: clienteDesc
      });

      return;
    }

    var clienteCompra = document.getElementById('cs-val-' + n).value;
    if (!clienteCompra) {
      error = 'Movimiento #' + numero + ': selecciona un cliente en Compra';
      return;
    }
    var clienteCompraSinPrecio = esClienteEspecial(clienteCompra);
    var montoIngresado = toNumber(montoRaw);
    if (montoIngresado < 0) {
      error = 'Movimiento #' + numero + ': monto total invalido en Compra';
      return;
    }

    var items = obtenerItemsCompra(card);
    if (items.length === 0) {
      error = 'Movimiento #' + numero + ': agrega al menos un producto en Compra';
      return;
    }

    var productosCompra = [];

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var producto = String(item.producto || '').trim();

      if (!producto) {
        if (String(item.kgRaw || '').trim() !== '') {
          error = 'Movimiento #' + numero + ': completa el producto #' + (i + 1) + ' de la Compra';
          return;
        }
        continue;
      }

      var kgInfo = leerPositivo(item.kgRaw);
      if (kgInfo.estado === 'invalido') {
        error = 'Movimiento #' + numero + ': kg invalido en producto #' + (i + 1) + ' de la Compra';
        return;
      }

      var kgFinal = '';
      if (kgInfo.estado === 'ok') {
        kgFinal = redondearNumero(kgInfo.valor);
      } else if (!clienteCompraSinPrecio && montoIngresado > 0) {
        var kgSugeridoRaw = item.row && item.row.dataset ? item.row.dataset.kgSugerido : '';
        var kgSugeridoInfo = leerPositivo(kgSugeridoRaw);
        if (kgSugeridoInfo.estado === 'ok') {
          kgFinal = redondearNumero(kgSugeridoInfo.valor);
        }
      }

      if (kgFinal === '') {
        continue;
      }

      productosCompra.push({
        producto: producto,
        kg: kgFinal,
        unit_price: 0
      });
    }

    if (productosCompra.length === 0) {
      error = 'Movimiento #' + numero + ': agrega al menos un producto con kg en Compra';
      return;
    }

    var montoTotal = 0;
    if (clienteCompraSinPrecio) {
      montoTotal = 0;
    } else if (montoIngresado > 0) {
      montoTotal = redondearNumero(montoIngresado);
    } else {
      montoTotal = redondearNumero(toNumber(card.dataset.subtotal));
    }

    if (!clienteCompraSinPrecio && montoTotal < 0) {
      error = 'Movimiento #' + numero + ': no se pudo calcular el monto total';
      return;
    }

    lista.push(prepararCompra({
      cliente: clienteCompra,
      productos: productosCompra,
      montoTotal: montoTotal,
      esEspecial: clienteCompraSinPrecio
    }));
  });

  if (error) {
    throw new Error(error);
  }

  return {
    fecha: fecha,
    productos: lista
  };
}

function parseFechaLocalISO(fechaISO) {
  var raw = String(fechaISO || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;

  var partes = raw.split('-');
  var y = Number(partes[0]);
  var m = Number(partes[1]);
  var d = Number(partes[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;

  return new Date(y, m - 1, d);
}

function esCompraTipo(tipo) {
  return String(tipo || '').trim().toLowerCase() === 'compra';
}

function payloadTieneCompra(payload) {
  var lista = payload && Array.isArray(payload.productos) ? payload.productos : [];
  return lista.some(function(item) {
    return esCompraTipo(item && item.tipo);
  });
}

function esFinDeSemanaFechaISO(fechaISO) {
  var date = parseFechaLocalISO(fechaISO);
  if (!date) return false;

  var dia = date.getDay();
  return dia === 0 || dia === 6;
}

function validarCompraFueraDeFinDeSemana(payload) {
  if (!payloadTieneCompra(payload)) return true;
  if (!esFinDeSemanaFechaISO(payload && payload.fecha)) return true;

  showToast('No se pueden registrar compras en fin de semana', 'error');
  return false;
}

function guardar() {
  var payload;
  try {
    payload = construirPayloadMovimientosDesdeFormulario();
  } catch (err) {
    console.error('ERROR GUARDAR MOVIMIENTO:', err);
    showToast(err && err.message ? err.message : 'Datos invalidos', 'error');
    return;
  }

  if (!validarCompraFueraDeFinDeSemana(payload)) {
    console.error('ERROR GUARDAR MOVIMIENTO: compra en fin de semana');
    return;
  }

  var btnGuardar = document.getElementById('btnGuardar');

  ejecutarConLoading(function() {
    return api('guardarMovimiento', payload);
  }, {
    boton: btnGuardar,
    textoBoton: 'Guardando...',
    textoGlobal: 'Guardando movimiento...'
  })
    .then(function(respuesta) {
      if (respuesta && respuesta.error) {
        showToast('Error al guardar datos', 'error');
        return;
      }

      if (typeof recargarAppManteniendoTab === 'function') {
        recargarAppManteniendoTab();
        return;
      }

      showToast('Guardado correctamente', 'success');
      setTimeout(function() {
        location.reload();
      }, 500);
    })
    .catch(function(err) {
      console.error('ERROR GUARDAR MOVIMIENTO:', err);

      if (err && err.response && err.response.data && err.response.data.error === 'MOVEMENT_ALREADY_EXISTS') {
        var data = err.response.data;
        var cliente = String(data.client || 'este cliente');
        var mensaje = 'Ya existe un movimiento para ' + cliente + ' en esa fecha';

        if (typeof window.mostrarAlerta === 'function') {
          window.mostrarAlerta({
            tipo: 'error',
            titulo: 'Movimiento duplicado',
            mensaje: mensaje
          });
        } else {
          showToast('Movimiento duplicado. ' + mensaje, 'error');
        }

        return;
      }

      showToast('Error al guardar datos', 'error');
    });
}

function guardarMovimiento() {
  return guardar();
}

function setTipo(n, tipo) {
  var card = document.querySelector('.prod-card[data-id="' + n + '"]');
  if (!card) return;

  card.dataset.tipo = tipo;
  setTipoUI(card, tipo);
  actualizarOpcionesProducto(card);

  if (tipo === 'Compra') {
    if (obtenerItemsCompra(card).length === 0) {
      agregarProductoCompra(n, '', '');
    }

    programarCalculo(card);
    return;
  }

  if (tipo === 'Pago a cliente') {
    var monto = toNumber(card.querySelector('.monto-inp').value);
    card.dataset.precioEspecial = '0';
    card.dataset.subtotal = String(monto);
    pintarTotales(card, 0, monto, true);
    actualizarTotal();
    return;
  }

  card.dataset.precioEspecial = '0';
  card.dataset.subtotal = '0';
  card.dataset.clienteManual = '';
  pintarTotales(card, 0, 0, true);
  actualizarClienteDescarga(card);
  actualizarTotal();
}

function eliminarProducto(n) {
  var card = document.querySelector('.prod-card[data-id="' + n + '"]');
  if (!card) return;

  card.remove();
  actualizarTotal();
}

function registrarPagoCliente() {
  showToast("Usa el tipo 'Pago a cliente' dentro de cada movimiento", 'error');
}

window.agregarProducto = agregarProducto;
window.agregarProductoCompra = agregarProductoCompra;
window.programarCalculo = programarCalculo;
window.calcular = calcular;
window.actualizarTotal = actualizarTotal;
window.guardar = guardar;
window.setTipo = setTipo;
window.eliminarProducto = eliminarProducto;
window.actualizarSelectoresClientesEspeciales = actualizarSelectoresClientesEspeciales;
window.actualizarSelectorPagoClientes = actualizarSelectorPagoClientes;
window.actualizarOpcionesProducto = actualizarOpcionesProducto;
window.actualizarClienteDescarga = actualizarClienteDescarga;
window.registrarPagoCliente = registrarPagoCliente;
window.construirPayloadMovimientosDesdeFormulario = construirPayloadMovimientosDesdeFormulario;
window.guardarMovimiento = guardarMovimiento;

(function() {
  var fechaInput = document.getElementById('fecha');
  if (fechaInput) {
    fechaInput.addEventListener('change', function() {
      document.querySelectorAll('.prod-card').forEach(function(card) {
        if (card.dataset.tipo === 'Descarga') {
          actualizarClienteDescarga(card);
        }
      });
    });
  }
})();
