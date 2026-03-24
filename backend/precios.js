const CACHE_DATOS_PRECIOS = Object.create(null);

function normalizarClaveFechaPrecios(fecha) {
  const f = parseFecha(fecha || hoyArgentinaISO());
  return Utilities.formatDate(f, TZ_AR, "yyyy-MM-dd");
}

function parsePrecio(precioRaw) {
  if (typeof precioRaw === "number") {
    return Number.isFinite(precioRaw) ? precioRaw : null;
  }

  const raw = String(precioRaw == null ? "" : precioRaw).trim();
  if (!raw) return null;

  const precio = Number(raw.replace(",", "."));
  return Number.isFinite(precio) ? precio : null;
}

function buscarHistorialProducto(productosCliente, productoBuscado) {
  if (!productosCliente) return null;

  const producto = String(productoBuscado || "").trim();
  if (!producto) return null;

  if (Object.prototype.hasOwnProperty.call(productosCliente, producto)) {
    return productosCliente[producto];
  }

  const productoNorm = producto.toUpperCase();
  const nombres = Object.keys(productosCliente);

  for (let i = 0; i < nombres.length; i++) {
    const nombre = nombres[i];
    if (String(nombre || "").trim().toUpperCase() === productoNorm) {
      return productosCliente[nombre];
    }
  }

  return null;
}

function obtenerDatosPrecios(fecha) {
  const claveFecha = normalizarClaveFechaPrecios(fecha);

  if (CACHE_DATOS_PRECIOS[claveFecha]) {
    return CACHE_DATOS_PRECIOS[claveFecha];
  }

  const ss = obtenerSpreadsheetPorFecha(claveFecha);
  const hoja = ss.getSheetByName("PRECIOS");

  const datosPrecios = Object.create(null);

  if (!hoja) {
    CACHE_DATOS_PRECIOS[claveFecha] = datosPrecios;
    return datosPrecios;
  }

  const lastRow = hoja.getLastRow();
  if (lastRow < 2) {
    CACHE_DATOS_PRECIOS[claveFecha] = datosPrecios;
    return datosPrecios;
  }

  const filas = hoja.getRange(2, 1, lastRow - 1, 4).getValues();

  for (let i = 0; i < filas.length; i++) {
    const cliente = normalizarCliente(filas[i][0]);
    if (!cliente) continue;

    const producto = String(filas[i][1] || "").trim();
    if (!producto) continue;

    let fechaDesde;
    try {
      fechaDesde = parseFecha(filas[i][2]);
    } catch (e) {
      continue;
    }

    const precio = parsePrecio(filas[i][3]);
    if (precio === null) continue;

    if (!datosPrecios[cliente]) {
      datosPrecios[cliente] = Object.create(null);
    }

    if (!datosPrecios[cliente][producto]) {
      datosPrecios[cliente][producto] = [];
    }

    datosPrecios[cliente][producto].push({
      fecha: fechaDesde,
      precio: precio
    });
  }

  const clientes = Object.keys(datosPrecios);
  for (let i = 0; i < clientes.length; i++) {
    const cliente = clientes[i];
    const productos = Object.keys(datosPrecios[cliente]);

    for (let j = 0; j < productos.length; j++) {
      const producto = productos[j];
      datosPrecios[cliente][producto].sort(function(a, b) {
        return a.fecha.getTime() - b.fecha.getTime();
      });
    }
  }

  CACHE_DATOS_PRECIOS[claveFecha] = datosPrecios;
  return datosPrecios;
}

function obtenerProductosPorCliente(cliente) {
  const clienteBuscado = normalizarCliente(cliente);
  if (!clienteBuscado) return [];

  const datosPrecios = obtenerDatosPrecios(hoyArgentinaISO());
  const productosCliente = datosPrecios[clienteBuscado];
  if (!productosCliente) return [];

  return Object.keys(productosCliente).filter(function(producto) {
    const historial = productosCliente[producto];
    return historial.some(function(item) {
      return Number(item.precio) > 0;
    });
  });
}

function obtenerPrecio(cliente, producto, fecha) {
  const clienteBuscado = normalizarCliente(cliente);
  if (!clienteBuscado) return 0;

  if (CLIENTES_EXCLUIDOS_PRECIO_CERO.includes(clienteBuscado)) {
    return 0;
  }

  let fechaBuscada;
  try {
    fechaBuscada = parseFecha(fecha);
  } catch (e) {
    return 0;
  }

  const datosPrecios = obtenerDatosPrecios(fechaBuscada);
  const productosCliente = datosPrecios[clienteBuscado];
  if (!productosCliente) return 0;

  const historial = buscarHistorialProducto(productosCliente, producto);
  if (!historial || !historial.length) return 0;

  for (let i = historial.length - 1; i >= 0; i--) {
    if (historial[i].fecha <= fechaBuscada) {
      return Number(historial[i].precio) || 0;
    }
  }

  return 0;
}

function serializarHistorialPrecios(historial) {
  const lista = Array.isArray(historial) ? historial : [];

  return lista.map(function(item) {
    const precio = parsePrecio(item && item.precio);
    if (precio === null) return null;

    let fechaIso = "";
    try {
      fechaIso = Utilities.formatDate(parseFecha(item && item.fecha), TZ_AR, "yyyy-MM-dd");
    } catch (e) {
      return null;
    }

    return {
      fecha: fechaIso,
      precio: precio
    };
  }).filter(function(item) {
    return !!item;
  }).sort(function(a, b) {
    if (a.fecha < b.fecha) return -1;
    if (a.fecha > b.fecha) return 1;
    return 0;
  });
}

function getInitialData(fecha) {
  const fechaBase = normalizarClaveFechaPrecios(fecha || hoyArgentinaISO());
  const datosPrecios = obtenerDatosPrecios(fechaBase);
  const clientes = Object.keys(datosPrecios).filter(function(cliente) {
    return !CLIENTES_NO_MOSTRAR_SELECTOR.includes(cliente);
  });

  const productosSet = Object.create(null);
  const precios = Object.create(null);

  Object.keys(datosPrecios).forEach(function(cliente) {
    const productosCliente = datosPrecios[cliente];
    if (!productosCliente || typeof productosCliente !== "object") return;

    const productos = Object.keys(productosCliente);
    if (!productos.length) return;

    const salidaProductos = Object.create(null);

    productos.forEach(function(producto) {
      const historial = serializarHistorialPrecios(productosCliente[producto]);
      if (!historial.length) return;

      salidaProductos[producto] = historial;

      const tienePrecio = historial.some(function(item) {
        return Number(item && item.precio) > 0;
      });
      if (tienePrecio) productosSet[producto] = true;
    });

    if (Object.keys(salidaProductos).length) {
      precios[cliente] = salidaProductos;
    }
  });

  return {
    clientes: clientes,
    productos: Object.keys(productosSet),
    precios: precios,
    clientesEspeciales: obtenerClientesEspeciales(),
    fecha: fechaBase
  };
}
