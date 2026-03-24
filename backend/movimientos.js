const CABECERA_MOVIMIENTOS = Object.freeze([
  "ID",
  "Fecha",
  "Tipo",
  "Cliente",
  "Detalle",
  "Monto",
  "Datos"
]);

function toNumberMov(value) {
  if (typeof value === "number") return isFinite(value) ? value : 0;

  const raw = String(value === undefined || value === null ? "" : value).trim();
  if (!raw) return 0;

  const n = Number(raw.replace(",", "."));
  return isFinite(n) ? n : 0;
}

function toPositiveMov(value) {
  const n = toNumberMov(value);
  return n > 0 ? n : 0;
}

function sonMontosIgualesMov(a, b, tolerancia) {
  const tol = typeof tolerancia === "number" ? Math.abs(tolerancia) : 0.000001;
  return Math.abs(toNumberMov(a) - toNumberMov(b)) <= tol;
}

function generarIdMovimiento() {
  return Utilities.getUuid();
}

function normalizarNombreColumnaMov(nombre) {
  return normalizarCliente(nombre).replace(/\s+/g, " ");
}

function obtenerContextoColumnasMovimientos(hoja) {
  const lastCol = Math.max(hoja.getLastColumn(), CABECERA_MOVIMIENTOS.length);
  const cabecera = hoja.getRange(1, 1, 1, lastCol).getValues()[0];

  const indices = {
    id: 0,
    fecha: 0,
    tipo: 0,
    cliente: 0,
    detalle: 0,
    monto: 0,
    datos: 0,
    productoLegacy: 0,
    kgLegacy: 0
  };

  for (let i = 0; i < cabecera.length; i++) {
    const nombre = normalizarNombreColumnaMov(cabecera[i]);
    if (!nombre) continue;

    if (nombre === "ID" && !indices.id) {
      indices.id = i + 1;
      continue;
    }

    if (nombre === "FECHA" && !indices.fecha) {
      indices.fecha = i + 1;
      continue;
    }

    if (nombre === "TIPO" && !indices.tipo) {
      indices.tipo = i + 1;
      continue;
    }

    if (nombre === "CLIENTE" && !indices.cliente) {
      indices.cliente = i + 1;
      continue;
    }

    if (nombre === "DETALLE" && !indices.detalle) {
      indices.detalle = i + 1;
      continue;
    }

    if (nombre === "MONTO" && !indices.monto) {
      indices.monto = i + 1;
      continue;
    }

    if (nombre === "DATOS" && !indices.datos) {
      indices.datos = i + 1;
      continue;
    }

    if (nombre === "PRODUCTO" && !indices.productoLegacy) {
      indices.productoLegacy = i + 1;
      continue;
    }

    if (nombre === "KG" && !indices.kgLegacy) {
      indices.kgLegacy = i + 1;
    }
  }

  if (!indices.id) indices.id = 1;
  if (!indices.fecha) indices.fecha = 2;
  if (!indices.tipo) indices.tipo = 3;
  if (!indices.cliente) indices.cliente = 4;
  if (!indices.detalle) indices.detalle = 5;
  if (!indices.monto) indices.monto = indices.productoLegacy && indices.kgLegacy ? 8 : 6;

  const width = Math.max(
    lastCol,
    indices.id,
    indices.fecha,
    indices.tipo,
    indices.cliente,
    indices.detalle,
    indices.monto,
    indices.datos,
    indices.productoLegacy,
    indices.kgLegacy
  );

  return {
    cabecera: cabecera,
    indices: indices,
    width: width
  };
}

function asegurarCabeceraMovimientos(hoja) {
  const ctx = obtenerContextoColumnasMovimientos(hoja);
  const cabecera = ctx.cabecera.slice();
  let huboCambios = false;

  CABECERA_MOVIMIENTOS.forEach(function(titulo, idx) {
    const valorActual = String(cabecera[idx] || "").trim();
    if (valorActual) return;
    cabecera[idx] = titulo;
    huboCambios = true;
  });

  if (huboCambios) {
    hoja.getRange(1, 1, 1, cabecera.length).setValues([cabecera]);
  }

  if (!ctx.indices.datos) {
    const nuevaColumna = hoja.getLastColumn() + 1;
    hoja.getRange(1, nuevaColumna).setValue("Datos");
  }

  return obtenerContextoColumnasMovimientos(hoja);
}

function obtenerHojaMovimientos(ss, crearSiNoExiste) {
  const crear = crearSiNoExiste !== false;
  let hoja = ss.getSheetByName("MOVIMIENTOS");

  if (!hoja) {
    if (!crear) return null;
    hoja = ss.insertSheet("MOVIMIENTOS");
    hoja.appendRow(CABECERA_MOVIMIENTOS.slice());
    return hoja;
  }

  if (hoja.getLastRow() === 0) {
    hoja.appendRow(CABECERA_MOVIMIENTOS.slice());
    return hoja;
  }

  const ctx = obtenerContextoColumnasMovimientos(hoja);
  const cabeceraVacia = ctx.cabecera.every(function(valor) {
    return String(valor || "").trim() === "";
  });

  if (cabeceraVacia) {
    hoja.getRange(1, 1, 1, CABECERA_MOVIMIENTOS.length).setValues([CABECERA_MOVIMIENTOS.slice()]);
    return hoja;
  }

  asegurarCabeceraMovimientos(hoja);
  return hoja;
}

function serializarDatosMovimiento(datos) {
  if (datos === "" || datos === null || datos === undefined) return "";

  if (typeof datos === "string") {
    const raw = datos.trim();
    if (!raw) return "";

    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed);
    } catch (e) {
      return raw;
    }
  }

  return JSON.stringify(datos);
}

function parsearDatosMovimiento(raw) {
  if (raw === "" || raw === null || raw === undefined) return null;
  if (typeof raw === "object") return raw;

  const txt = String(raw).trim();
  if (!txt) return null;

  try {
    const parsed = JSON.parse(txt);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

function leerValorFilaMov(fila, indice) {
  if (!indice || indice < 1) return "";
  return fila[indice - 1];
}

function extraerProductosDesdeDatosMovimiento(datos, productoLegacy, kgLegacy) {
  const salida = [];

  if (datos && typeof datos === "object") {
    if (Array.isArray(datos.productos)) {
      datos.productos.forEach(function(item) {
        const producto = String(item && item.producto || "").trim();
        const productoNormalizado = String(item && item.productoNormalizado || "").trim();
        const kg = toPositiveMov(item && item.kg);
        if (!producto || !kg) return;

        salida.push({
          producto: producto,
          productoNormalizado: productoNormalizado || normalizarCliente(producto),
          kg: kg
        });
      });
    } else {
      const productoUnico = String(datos.producto || "").trim();
      const productoNormalizadoUnico = String(datos.productoNormalizado || "").trim();
      const kgUnico = toPositiveMov(datos.kg);
      if (productoUnico && kgUnico) {
        salida.push({
          producto: productoUnico,
          productoNormalizado: productoNormalizadoUnico || normalizarCliente(productoUnico),
          kg: kgUnico
        });
      }
    }
  }

  if (!salida.length) {
    const producto = String(productoLegacy || "").trim();
    const kg = toPositiveMov(kgLegacy);
    if (producto && kg) {
      salida.push({
        producto: producto,
        productoNormalizado: normalizarCliente(producto),
        kg: kg
      });
    }
  }

  return salida;
}

function construirDatosLegacyMovimiento(tipo, detalle, productoLegacy, kgLegacy, monto) {
  const tipoNorm = normalizarCliente(tipo);
  const producto = String(productoLegacy || "").trim();
  const detalleNorm = normalizarCliente(detalle);
  const kg = toPositiveMov(kgLegacy);
  const montoFinal = toPositiveMov(monto);

  if (tipoNorm === "COMPRA" && producto && kg) {
    return {
      productos: [{
        producto: producto,
        kg: kg,
        productoNormalizado: detalleNorm || normalizarCliente(producto)
      }]
    };
  }

  if (tipoNorm === "DESCARGA" && producto && kg) {
    return {
      producto: producto,
      kg: kg,
      productoNormalizado: detalleNorm || normalizarCliente(producto)
    };
  }

  if (tipoNorm === "GASTO" && esDetalleAyudantes(detalle) && montoFinal) {
    const nombre = extraerNombreAyudanteDesdeDetalle(detalle);
    return {
      empleados: [{ nombre: nombre || "", monto: montoFinal }]
    };
  }

  return null;
}

function mapearFilaMovimiento(fila, rowIndex, contexto) {
  const idx = contexto && contexto.indices ? contexto.indices : {};
  const id = String(leerValorFilaMov(fila, idx.id) || "").trim();
  const fecha = leerValorFilaMov(fila, idx.fecha);
  const tipo = String(leerValorFilaMov(fila, idx.tipo) || "").trim();
  const cliente = String(leerValorFilaMov(fila, idx.cliente) || "").trim();
  const detalle = String(leerValorFilaMov(fila, idx.detalle) || "").trim();
  const monto = toNumberMov(leerValorFilaMov(fila, idx.monto));

  const productoLegacy = String(leerValorFilaMov(fila, idx.productoLegacy) || "").trim();
  const kgLegacy = toNumberMov(leerValorFilaMov(fila, idx.kgLegacy));
  const datosRaw = leerValorFilaMov(fila, idx.datos);

  let datos = parsearDatosMovimiento(datosRaw);
  if (!datos) {
    datos = construirDatosLegacyMovimiento(tipo, detalle, productoLegacy, kgLegacy, monto);
  }

  const productos = extraerProductosDesdeDatosMovimiento(datos, productoLegacy, kgLegacy);

  let producto = productoLegacy;
  let kg = kgLegacy;

  if (!producto && !kg && productos.length === 1) {
    producto = productos[0].producto;
    kg = toPositiveMov(productos[0].kg);
  } else if (!producto && !kg && productos.length > 1) {
    kg = productos.reduce(function(acc, item) {
      return acc + toPositiveMov(item.kg);
    }, 0);
  }

  return {
    rowIndex: rowIndex,
    id: id,
    fecha: fecha,
    tipo: tipo,
    cliente: cliente,
    detalle: detalle,
    producto: producto,
    kg: kg,
    monto: monto,
    datos: datos || null
  };
}

function registrarMovimientoEnHoja(ss, registro) {
  const hoja = obtenerHojaMovimientos(ss);
  const ctx = asegurarCabeceraMovimientos(hoja);
  const idx = ctx.indices;

  const fecha = parseFecha(registro.fecha);
  const monto = registro.monto === "" || registro.monto === null || registro.monto === undefined
    ? ""
    : toNumberMov(registro.monto);

  const datosSerializados = serializarDatosMovimiento(registro.datos);
  const productosDatos = extraerProductosDesdeDatosMovimiento(registro.datos, "", "");
  const productoLegacy = String(
    registro.producto || (productosDatos.length === 1 ? productosDatos[0].producto : "")
  ).trim();
  const kgLegacyRaw = registro.kg !== undefined && registro.kg !== null && registro.kg !== ""
    ? registro.kg
    : (productosDatos.length === 1 ? productosDatos[0].kg : "");
  const kgLegacy = kgLegacyRaw === "" ? "" : toPositiveMov(kgLegacyRaw);

  const width = Math.max(
    ctx.width,
    idx.id,
    idx.fecha,
    idx.tipo,
    idx.cliente,
    idx.detalle,
    idx.monto,
    idx.datos,
    idx.productoLegacy,
    idx.kgLegacy
  );

  const fila = new Array(width).fill("");
  fila[idx.id - 1] = String(registro.id || "").trim();
  fila[idx.fecha - 1] = fecha;
  fila[idx.tipo - 1] = String(registro.tipo || "").trim();
  fila[idx.cliente - 1] = String(registro.cliente || "").trim();
  fila[idx.detalle - 1] = String(registro.detalle || "").trim();
  fila[idx.monto - 1] = monto;

  if (idx.datos) fila[idx.datos - 1] = datosSerializados;
  if (idx.productoLegacy) fila[idx.productoLegacy - 1] = productoLegacy;
  if (idx.kgLegacy) fila[idx.kgLegacy - 1] = kgLegacy;

  hoja.appendRow(fila);
  hoja.getRange(hoja.getLastRow(), idx.fecha).setNumberFormat("dd/MM/yyyy");
}

function obtenerRegistrosMovimientos(ss) {
  const hoja = obtenerHojaMovimientos(ss, false);
  if (!hoja) return [];
  const lastRow = hoja.getLastRow();
  if (lastRow < 2) return [];

  const ctx = obtenerContextoColumnasMovimientos(hoja);
  const filas = hoja.getRange(2, 1, lastRow - 1, ctx.width).getValues();

  return filas.map(function(fila, idx) {
    return mapearFilaMovimiento(fila, idx + 2, ctx);
  });
}

function agregarMesesIso(fechaIso, offset) {
  const f = parseFecha(fechaIso);
  const d = new Date(f.getTime());
  d.setMonth(d.getMonth() + offset);
  return Utilities.formatDate(d, TZ_AR, "yyyy-MM-dd");
}

function buscarMovimientosPorId(id, fechaReferencia) {
  const idBuscado = String(id || "").trim();
  if (!idBuscado) {
    throw new Error("ID de movimiento invalido");
  }

  const fechasProbar = [];
  if (fechaReferencia) {
    fechasProbar.push(Utilities.formatDate(parseFecha(fechaReferencia), TZ_AR, "yyyy-MM-dd"));
  } else {
    const base = hoyArgentinaISO();
    fechasProbar.push(base);
    fechasProbar.push(agregarMesesIso(base, -1));
    fechasProbar.push(agregarMesesIso(base, 1));
    fechasProbar.push(agregarMesesIso(base, -2));
    fechasProbar.push(agregarMesesIso(base, 2));
  }

  for (let i = 0; i < fechasProbar.length; i++) {
    try {
      const ss = obtenerSpreadsheetPorFecha(fechasProbar[i]);
      const hojaMov = obtenerHojaMovimientos(ss, false);
      if (!hojaMov) continue;
      const registros = obtenerRegistrosMovimientos(ss).filter(reg => reg.id === idBuscado);

      if (registros.length) {
        return { ss: ss, hojaMov: hojaMov, registros: registros };
      }
    } catch (e) {
      // Ignorar meses sin planilla.
    }
  }

  throw new Error("Movimiento no encontrado: " + idBuscado);
}

function registrarPagoEnCuentas(ss, fechaStr, cliente, monto) {
  const hoja = ss.getSheetByName("CUENTAS");
  if (!hoja) throw new Error("No existe la hoja CUENTAS");

  const montoFinal = toPositiveMov(monto);
  if (!montoFinal) return;

  const fecha = parseFecha(fechaStr);
  hoja.appendRow([fecha, cliente, "Pago de Fabian", "", "Pago", "", "", "", montoFinal]);
  hoja.getRange(hoja.getLastRow(), 1).setNumberFormat("dd/MM/yyyy");
}

function resolverProductoCompra(productoRaw) {
  const productoOriginal = String(productoRaw || "").trim();
  if (!productoOriginal) return null;

  const productoNormalizado = productoOriginal.toUpperCase();
  const producto = (productoNormalizado === "HUESOS" || productoNormalizado === "ASERRIN DE HUESO")
    ? "Huesos"
    : "Grasa";

  return {
    producto: producto,
    productoNormalizado: productoNormalizado
  };
}

function resolverFilaClienteKg(datos, clienteFinal, producto, productoNormalizado) {
  const clienteNormalizado = normalizarCliente(clienteFinal);

  if (clienteNormalizado === "CORDIEZ" && producto === "Huesos") {
    const filasCordiez = [];

    for (let i = 1; i < datos.length; i++) {
      if (normalizarCliente(datos[i][0]) === "CORDIEZ") filasCordiez.push(i + 1);
    }

    if (!filasCordiez.length) throw new Error("Cliente no encontrado: " + clienteFinal);

    if (productoNormalizado === "ASERRIN DE HUESO") {
      return filasCordiez[0];
    }

    if (productoNormalizado === "HUESOS") {
      if (filasCordiez.length < 2) {
        throw new Error("No se encontro segunda fila de CORDIEZ para Huesos");
      }
      return filasCordiez[1];
    }

    return filasCordiez[0];
  }

  for (let i = 1; i < datos.length; i++) {
    if (normalizarCliente(datos[i][0]) === clienteNormalizado) {
      return i + 1;
    }
  }

  throw new Error("Cliente no encontrado: " + clienteFinal);
}

function resolverColumnaFechaKg(datos, fecha) {
  for (let j = 0; j < datos[0].length; j++) {
    if (mismaFecha(datos[0][j], fecha)) {
      return j + 1;
    }
  }

  throw new Error("Fecha no encontrada");
}

function actualizarKgEnHoja(ss, producto, productoNormalizado, clienteFinal, fecha, deltaKg) {
  const delta = toNumberMov(deltaKg);
  if (!delta) return;

  const nombreHoja = producto === "Grasa" ? "GRASA" : "HUESOS";
  const hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) throw new Error("No existe la hoja " + nombreHoja);

  const datos = hoja.getDataRange().getValues();
  if (!datos.length) throw new Error("La hoja " + nombreHoja + " no tiene datos");

  const filaCliente = resolverFilaClienteKg(datos, clienteFinal, producto, productoNormalizado);
  const colFecha = resolverColumnaFechaKg(datos, fecha);

  const celda = hoja.getRange(filaCliente, colFecha);
  const valorActual = toNumberMov(celda.getValue());
  const nuevoValor = valorActual + delta;
  const toleranciaCero = 0.000001;

  if (nuevoValor < -toleranciaCero) {
    throw new Error(
      "No se puede descontar " + Math.abs(delta) + " kg de " + clienteFinal + " (" + producto + ") en " + formatFecha(fecha)
    );
  }

  if (Math.abs(nuevoValor) <= toleranciaCero) {
    celda.setValue("");
    return;
  }

  celda.setValue(nuevoValor);
}

function registrarKgEnHoja(ss, producto, productoNormalizado, clienteFinal, fecha, kg) {
  const kgFinal = toPositiveMov(kg);
  if (!kgFinal) return;
  actualizarKgEnHoja(ss, producto, productoNormalizado, clienteFinal, fecha, kgFinal);
}

function restarKgEnHoja(ss, producto, productoNormalizado, clienteFinal, fecha, kg) {
  const kgFinal = toPositiveMov(kg);
  if (!kgFinal) return;
  actualizarKgEnHoja(ss, producto, productoNormalizado, clienteFinal, fecha, -kgFinal);
}

function registrarCompra(ss, fecha, fechaStr, mov, clienteFallback) {
  const cliente = normalizarCliente(mov.cliente || clienteFallback || "");
  const esEspecial = !!mov.esEspecial || CLIENTES_EXCLUIDOS_PRECIO_CERO.includes(cliente);
  const montoTotal = esEspecial ? 0 : toPositiveMov(mov.montoTotal || mov.monto);
  const datosMov = parsearDatosMovimiento(mov && mov.datos);

  if (!cliente) throw new Error("Compra sin cliente");

  if (!esEspecial) {
    if (!montoTotal) throw new Error("Compra sin monto total");

    registrarCaja({
      fecha: fechaStr,
      cliente: cliente,
      tipo: "Compra",
      monto: montoTotal
    });
  }

  const itemsDesdeDatos = datosMov && Array.isArray(datosMov.productos) ? datosMov.productos : [];
  const itemsRaw = Array.isArray(mov.productos) && mov.productos.length
    ? mov.productos
    : (itemsDesdeDatos.length ? itemsDesdeDatos : [mov]);
  const itemsAplicados = [];

  itemsRaw.forEach(item => {
    const meta = resolverProductoCompra(item.producto);
    const kg = toPositiveMov(item.kg);
    if (!meta || !kg) return;

    registrarKgEnHoja(ss, meta.producto, meta.productoNormalizado, cliente, fecha, kg);
    itemsAplicados.push({
      producto: meta.producto,
      productoNormalizado: meta.productoNormalizado,
      kg: kg
    });
  });

  return {
    cliente: cliente,
    montoTotal: montoTotal,
    esEspecial: esEspecial,
    items: itemsAplicados
  };
}

function registrarDescarga(ss, fecha, mov) {
  const datosMov = parsearDatosMovimiento(mov && mov.datos);
  const producto = String(
    mov && mov.producto
      || (datosMov && datosMov.producto)
      || ""
  ).trim();
  const kg = toPositiveMov(
    mov && mov.kg !== undefined && mov.kg !== null && mov.kg !== ""
      ? mov.kg
      : (datosMov && datosMov.kg)
  );
  const meta = resolverProductoCompra(producto);

  if (!meta || !kg) return null;

  const clienteDestino = normalizarCliente(mov.cliente || "");
  if (!clienteDestino) return null;

  registrarKgEnHoja(ss, meta.producto, meta.productoNormalizado, clienteDestino, fecha, kg);

  return {
    clienteDestino: clienteDestino,
    producto: meta.producto,
    productoNormalizado: meta.productoNormalizado,
    kg: kg
  };
}

function registrarPagoClienteDesdeMovimiento(ss, fechaStr, mov, clienteFallback) {
  const cliente = normalizarCliente(mov.cliente || clienteFallback || "");
  const monto = toPositiveMov(mov.monto);

  if (!cliente) throw new Error("Pago a cliente sin cliente");
  if (!monto) throw new Error("Pago a cliente sin monto");

  registrarCaja({
    fecha: fechaStr,
    cliente: cliente,
    tipo: "Pago a cliente",
    monto: monto
  });

  registrarPagoEnCuentas(ss, fechaStr, cliente, monto);

  return {
    cliente: cliente,
    monto: monto
  };
}

function resumirDetalleCompra(items) {
  const lista = Array.isArray(items) ? items : [];
  if (!lista.length) return "";
  if (lista.length === 1) {
    return String(lista[0].productoNormalizado || lista[0].producto || "").trim();
  }
  return lista.length + " productos";
}

function construirDatosCompraMovimiento(items) {
  return {
    productos: (Array.isArray(items) ? items : []).map(function(item) {
      return {
        producto: String(item && item.producto || "").trim(),
        kg: toPositiveMov(item && item.kg),
        productoNormalizado: String(item && item.productoNormalizado || "").trim()
      };
    }).filter(function(item) {
      return !!item.producto && !!item.kg;
    })
  };
}

function registrarCompraEnMovimientos(ss, idMovimiento, fechaStr, dataCompra) {
  const cliente = normalizarCliente(dataCompra.cliente || "");
  const items = Array.isArray(dataCompra.items) ? dataCompra.items : [];
  const montoTotal = toPositiveMov(dataCompra.montoTotal || 0);
  const datos = construirDatosCompraMovimiento(items);

  registrarMovimientoEnHoja(ss, {
    id: idMovimiento,
    fecha: fechaStr,
    tipo: "Compra",
    cliente: cliente,
    detalle: resumirDetalleCompra(items),
    monto: montoTotal,
    datos: datos
  });
}

function registrarDescargaEnMovimientos(ss, idMovimiento, fechaStr, dataDescarga) {
  if (!dataDescarga) return;

  registrarMovimientoEnHoja(ss, {
    id: idMovimiento,
    fecha: fechaStr,
    tipo: "Descarga",
    cliente: dataDescarga.clienteDestino || "",
    detalle: dataDescarga.productoNormalizado || dataDescarga.producto || "",
    monto: "",
    datos: {
      producto: String(dataDescarga.producto || "").trim(),
      kg: toPositiveMov(dataDescarga.kg),
      productoNormalizado: String(dataDescarga.productoNormalizado || "").trim()
    }
  });
}

function registrarPagoClienteEnMovimientos(ss, idMovimiento, fechaStr, dataPago) {
  if (!dataPago) return;

  registrarMovimientoEnHoja(ss, {
    id: idMovimiento,
    fecha: fechaStr,
    tipo: "Pago a cliente",
    cliente: dataPago.cliente || "",
    detalle: "Pago a cliente",
    monto: dataPago.monto,
    datos: {}
  });
}

function extraerAdelantosAyudantesRegistro(registro) {
  const salida = [];
  const datos = registro && registro.datos;

  if (datos && typeof datos === "object" && Array.isArray(datos.empleados)) {
    datos.empleados.forEach(function(item) {
      const nombre = normalizarCliente(item && item.nombre);
      const monto = toPositiveMov(item && item.monto);
      if (!monto) return;
      salida.push({
        nombre: nombre,
        monto: monto
      });
    });
  }

  if (salida.length) return salida;

  if (registro && esDetalleAyudantes(registro.detalle)) {
    salida.push({
      nombre: extraerNombreAyudanteDesdeDetalle(registro.detalle),
      monto: toPositiveMov(registro.monto)
    });
  }

  return salida.filter(function(item) {
    return item.monto > 0;
  });
}

function buscarFilaCoincidenteDesdeAbajo(hoja, matcher) {
  const datos = hoja.getDataRange().getValues();
  for (let i = datos.length - 1; i >= 1; i--) {
    if (matcher(datos[i])) return i + 1;
  }
  return -1;
}

function eliminarPagoEnCuentas(ss, fecha, cliente, monto) {
  const hoja = ss.getSheetByName("CUENTAS");
  if (!hoja) throw new Error("No existe la hoja CUENTAS");

  const fechaBuscada = parseFecha(fecha);
  const clienteBuscado = normalizarCliente(cliente);
  const montoBuscado = toPositiveMov(monto);

  const fila = buscarFilaCoincidenteDesdeAbajo(hoja, function(row) {
    return mismaFecha(row[0], fechaBuscada)
      && normalizarCliente(row[1]) === clienteBuscado
      && normalizarCliente(row[4]) === "PAGO"
      && sonMontosIgualesMov(row[8], montoBuscado);
  });

  if (fila === -1) {
    throw new Error("No se encontro el pago en CUENTAS para eliminar");
  }

  hoja.deleteRow(fila);
}

function esDetalleAyudantes(detalle) {
  return normalizarCliente(detalle).indexOf("AYUDANTES") === 0;
}

function extraerNombreAyudanteDesdeDetalle(detalle) {
  const raw = String(detalle || "").trim();
  if (!raw) return "";

  const partesPipe = raw.split("|");
  if (partesPipe.length > 1) return normalizarCliente(partesPipe[1]);

  const partesDosPuntos = raw.split(":");
  if (partesDosPuntos.length > 1) return normalizarCliente(partesDosPuntos[1]);

  return "";
}

function eliminarAdelantoEnSueldos(ss, fecha, monto, detalle) {
  const hoja = ss.getSheetByName("SUELDOS");
  if (!hoja) throw new Error("No existe la hoja SUELDOS");

  const fechaBuscada = parseFecha(fecha);
  const montoBuscado = toPositiveMov(monto);
  const ayudanteBuscado = extraerNombreAyudanteDesdeDetalle(detalle);

  const fila = buscarFilaCoincidenteDesdeAbajo(hoja, function(row) {
    const conceptoA = normalizarCliente(row[2]);
    const conceptoB = normalizarCliente(row[3]);
    if (!mismaFecha(row[0], fechaBuscada)) return false;
    if (conceptoA !== "ADELANTO" && conceptoB !== "ADELANTO") return false;
    if (!sonMontosIgualesMov(row[4], montoBuscado)) return false;

    if (!ayudanteBuscado) return true;
    return normalizarCliente(row[1]) === ayudanteBuscado;
  });

  if (fila === -1) {
    throw new Error("No se encontro el adelanto de ayudantes en SUELDOS");
  }

  hoja.deleteRow(fila);
}

function eliminarGastoEnHojaGastos(ss, fecha, detalle, monto) {
  const hoja = ss.getSheetByName("GASTOS");
  if (!hoja) throw new Error("No existe la hoja GASTOS");

  const fechaBuscada = parseFecha(fecha);
  const tipoBuscado = normalizarCliente(detalle);
  const montoBuscado = toPositiveMov(monto);

  const fila = buscarFilaCoincidenteDesdeAbajo(hoja, function(row) {
    return mismaFecha(row[0], fechaBuscada)
      && normalizarCliente(row[1]) === tipoBuscado
      && sonMontosIgualesMov(row[2], montoBuscado);
  });

  if (fila === -1) {
    throw new Error("No se encontro el gasto para eliminar");
  }

  hoja.deleteRow(fila);
}

function revertirRegistroMovimiento(ss, registro) {
  const tipoNorm = normalizarCliente(registro.tipo);
  const fecha = parseFecha(registro.fecha);

  if (tipoNorm === "COMPRA" || tipoNorm === "DESCARGA") {
    const cliente = normalizarCliente(registro.cliente || "");
    const productos = extraerProductosDesdeDatosMovimiento(registro.datos, registro.producto, registro.kg);

    if (!cliente || !productos.length) return;

    productos.forEach(function(item) {
      const productoRaw = item.producto || item.productoNormalizado;
      const meta = resolverProductoCompra(productoRaw);
      const kg = toPositiveMov(item.kg);
      if (!meta || !kg) return;

      const productoNormalizado = normalizarCliente(
        item.productoNormalizado || item.producto || meta.productoNormalizado
      );
      restarKgEnHoja(ss, meta.producto, productoNormalizado, cliente, fecha, kg);
    });
    return;
  }

  if (tipoNorm === "PAGO A CLIENTE") {
    const monto = toPositiveMov(registro.monto);
    if (!monto) return;
    eliminarPagoEnCuentas(ss, fecha, registro.cliente, monto);
    return;
  }

  if (tipoNorm === "GASTO") {
    const monto = toPositiveMov(registro.monto);
    if (!monto) return;

    const adelantos = extraerAdelantosAyudantesRegistro(registro);
    if (adelantos.length) {
      adelantos.forEach(function(item) {
        const detalleAyudante = item.nombre ? ("AYUDANTES|" + item.nombre) : "AYUDANTES";
        eliminarAdelantoEnSueldos(ss, fecha, item.monto, detalleAyudante);
      });
      return;
    }

    eliminarGastoEnHojaGastos(ss, fecha, registro.detalle, monto);
    return;
  }

  if (tipoNorm === "ENTREGA DE DINERO") {
    return;
  }
}

function eliminarFilasPorIndice(hoja, indices) {
  const filas = indices
    .map(x => Number(x))
    .filter(x => Number.isInteger(x) && x >= 2)
    .sort(function(a, b) { return b - a; });

  filas.forEach(function(row) {
    hoja.deleteRow(row);
  });
}

function eliminarMovimiento(id, fechaReferencia) {
  const ctx = buscarMovimientosPorId(id, fechaReferencia);

  ctx.registros.forEach(function(registro) {
    revertirRegistroMovimiento(ctx.ss, registro);
  });

  eliminarFilasPorIndice(ctx.hojaMov, ctx.registros.map(reg => reg.rowIndex));
  reconstruirSaldoFabianPorSpreadsheet(ctx.ss, { forzarVacio: true });

  return {
    ok: true,
    id: String(id || "").trim(),
    eliminados: ctx.registros.length
  };
}

function eliminarMovimientos(ids, fechaReferencia) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("Lista de IDs invalida");
  }

  const unicos = Array.from(new Set(
    ids.map(id => String(id || "").trim()).filter(Boolean)
  ));

  if (!unicos.length) {
    throw new Error("No hay IDs validos para eliminar");
  }

  let totalEliminados = 0;

  unicos.forEach(id => {
    const res = eliminarMovimiento(id, fechaReferencia);
    totalEliminados += toNumberMov(res && res.eliminados);
  });

  return {
    ok: true,
    ids: unicos,
    eliminados: totalEliminados
  };
}

function normalizarListaMovimientosParaGuardar(data) {
  if (!data || typeof data !== "object") return [];

  if (Array.isArray(data.productos)) return data.productos.slice();
  if (Array.isArray(data.movimientos)) return data.movimientos.slice();
  if (Array.isArray(data.items)) return data.items.slice();
  if (data.movimiento && typeof data.movimiento === "object") return [data.movimiento];
  if (data.tipo) return [data];

  return [];
}

function resolverFechaGuardarMovimiento(data, movimientos) {
  const fechaData = String(data && data.fecha || "").trim();
  if (fechaData) return fechaData;

  const lista = Array.isArray(movimientos) ? movimientos : [];
  for (let i = 0; i < lista.length; i++) {
    const fechaMov = String(lista[i] && lista[i].fecha || "").trim();
    if (fechaMov) return fechaMov;
  }

  return "";
}

function construirPayloadGastoDesdeMovimiento(mov, fechaStr) {
  const datosMov = parsearDatosMovimiento(mov && mov.datos);
  const empleadosRaw = Array.isArray(mov && mov.empleados)
    ? mov.empleados
    : (datosMov && Array.isArray(datosMov.empleados) ? datosMov.empleados : []);
  const detalleRaw = String(
    mov && (mov.detalle || mov.tipoGasto || mov.concepto || mov.nombreTipo) || ""
  ).trim();
  const esAyudantes = empleadosRaw.length > 0 || normalizarCliente(detalleRaw) === "AYUDANTES";

  const empleados = empleadosRaw.map(function(item) {
    return {
      nombre: String(item && item.nombre || "").trim(),
      monto: toPositiveMov(item && item.monto)
    };
  }).filter(function(item) {
    return !!item.nombre && item.monto > 0;
  });

  let monto = toPositiveMov(mov && mov.monto);
  if (!monto && empleados.length) {
    monto = empleados.reduce(function(acc, item) {
      return acc + toPositiveMov(item.monto);
    }, 0);
  }

  const tipo = esAyudantes ? "AYUDANTES" : detalleRaw;
  if (!tipo) throw new Error("Gasto sin tipo");
  if (!monto) throw new Error("Gasto sin monto");

  return {
    fecha: fechaStr,
    tipo: tipo,
    monto: monto,
    empleados: empleados
  };
}

function esTipoEntregaDineroMov(tipoRaw) {
  const tipo = normalizarCliente(tipoRaw);
  return tipo === "ENTREGA DE DINERO" || tipo === "ENTREGA";
}

function completarTipoEnPayloadEdicion(payload, tipoFallback) {
  if (!payload || typeof payload !== "object") return payload;

  const tipo = String(tipoFallback || "").trim();
  if (!tipo) return payload;

  if (Array.isArray(payload.productos)) {
    payload.productos.forEach(function(item) {
      if (item && typeof item === "object" && !String(item.tipo || "").trim()) {
        item.tipo = tipo;
      }
    });
    return payload;
  }

  if (Array.isArray(payload.movimientos)) {
    payload.movimientos.forEach(function(item) {
      if (item && typeof item === "object" && !String(item.tipo || "").trim()) {
        item.tipo = tipo;
      }
    });
    return payload;
  }

  if (Array.isArray(payload.items)) {
    payload.items.forEach(function(item) {
      if (item && typeof item === "object" && !String(item.tipo || "").trim()) {
        item.tipo = tipo;
      }
    });
    return payload;
  }

  if (payload.movimiento && typeof payload.movimiento === "object") {
    if (!String(payload.movimiento.tipo || "").trim()) {
      payload.movimiento.tipo = tipo;
    }
    return payload;
  }

  if (!String(payload.tipo || "").trim()) {
    payload.tipo = tipo;
  }

  return payload;
}

function editarMovimiento(id, nuevosDatos) {
  const idMovimiento = String(id || "").trim();
  if (!idMovimiento) {
    throw new Error("ID de movimiento invalido");
  }

  if (!nuevosDatos || typeof nuevosDatos !== "object") {
    throw new Error("Datos de edicion invalidos");
  }

  const ctxOriginal = buscarMovimientosPorId(idMovimiento, nuevosDatos.fecha || null);
  const registroOriginal = (ctxOriginal.registros && ctxOriginal.registros[0]) || null;
  if (!registroOriginal) {
    throw new Error("Movimiento no encontrado: " + idMovimiento);
  }

  const tipoOriginal = String(registroOriginal.tipo || "").trim();
  if (esTipoEntregaDineroMov(tipoOriginal)) {
    completarTipoEnPayloadEdicion(nuevosDatos, "Entrega de dinero");
  }

  const fechaOriginalIso = Utilities.formatDate(parseFecha(registroOriginal.fecha), TZ_AR, "yyyy-MM-dd");

  eliminarMovimiento(idMovimiento, fechaOriginalIso);
  guardarMovimiento(nuevosDatos);

  const fechaReconstruccion = resolverFechaGuardarMovimiento(
    nuevosDatos,
    normalizarListaMovimientosParaGuardar(nuevosDatos)
  ) || fechaOriginalIso;

  reconstruirSaldoFabian(fechaReconstruccion);

  return {
    ok: true
  };
}

function guardarMovimiento(data) {
  const movimientos = normalizarListaMovimientosParaGuardar(data);
  const fechaStr = resolverFechaGuardarMovimiento(data, movimientos);
  if (!fechaStr) throw new Error("Fecha requerida");
  if (!movimientos.length) throw new Error("No hay movimientos para guardar");

  const ss = obtenerSpreadsheetPorFecha(fechaStr);
  const fecha = parseFecha(fechaStr);
  const ids = [];

  movimientos.forEach(mov => {
    const tipo = normalizarCliente(mov && mov.tipo);
    const idMovimiento = generarIdMovimiento();

    if (tipo === "COMPRA") {
      const dataCompra = registrarCompra(ss, fecha, fechaStr, mov, data.cliente || "");
      registrarCompraEnMovimientos(ss, idMovimiento, fechaStr, dataCompra);
      ids.push(idMovimiento);
      return;
    }

    if (tipo === "DESCARGA") {
      const dataDesc = registrarDescarga(ss, fecha, mov);
      registrarDescargaEnMovimientos(ss, idMovimiento, fechaStr, dataDesc);
      if (dataDesc) ids.push(idMovimiento);
      return;
    }

    if (tipo === "PAGO A CLIENTE") {
      const dataPago = registrarPagoClienteDesdeMovimiento(ss, fechaStr, mov, data.cliente || "");
      registrarPagoClienteEnMovimientos(ss, idMovimiento, fechaStr, dataPago);
      ids.push(idMovimiento);
      return;
    }

    if (tipo === "GASTO") {
      const payloadGasto = construirPayloadGastoDesdeMovimiento(mov, fechaStr);
      registrarGastoInterno(payloadGasto, {
        ss: ss,
        idMovimiento: idMovimiento
      });

      ids.push(idMovimiento);
      return;
    }

    if (tipo === "ENTREGA DE DINERO" || tipo === "ENTREGA") {
      const montoEntrega = toPositiveMov(mov.monto);
      if (!montoEntrega) throw new Error("Entrega sin monto");

      registrarCaja({
        fecha: fechaStr,
        tipo: "Entrega de dinero",
        monto: montoEntrega
      });

      registrarMovimientoEnHoja(ss, {
        id: idMovimiento,
        fecha: fechaStr,
        tipo: "Entrega de dinero",
        cliente: "",
        detalle: String(mov.detalle || "Entrega de dinero"),
        monto: montoEntrega,
        datos: {}
      });

      ids.push(idMovimiento);
      return;
    }

    throw new Error("Tipo no soportado: " + String(mov && mov.tipo || ""));
  });

  return {
    ok: true,
    ids: ids
  };
}
