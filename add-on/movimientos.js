// ================================================================
// Movimientos.js — Lógica contable: cálculo y presentación de movimientos
// ================================================================

// Clientes que van como "Venta" en vez de "Compra"
const CLIENTES_VENTA = ["NICO", "MARCOS", "REFINERIA"];

// Filas que no son clientes reales en las hojas GRASA/HUESOS
const FILAS_EXCLUIDAS = [
  "total kg comprados",
  "sobras",
  "precio promedio venta",
  "total kg semanal",
  "total sobras semanal"
];

const FILAS_EXCLUIDAS_POR_HOJA = {
  GRASA: FILAS_EXCLUIDAS,
  HUESOS: ["total kg comprados", "sobras"]
};

function calcularMovimientos(ss) {
  const hojaPrecios = ss.getSheetByName("PRECIOS");
  const preciosData = hojaPrecios ? hojaPrecios.getDataRange().getValues().slice(1) : [];

  const hojasOrigen = [
    { nombre: 'GRASA',  producto: 'Grasa',  tipo: 'Compra', colInicio: 2 },
    { nombre: 'HUESOS', producto: 'Huesos', tipo: 'Compra', colInicio: 2 }
  ];

  const movimientos = [];

  hojasOrigen.forEach(cfg => {
    const hoja = ss.getSheetByName(cfg.nombre);
    if (!hoja) return;

    const datos = hoja.getRange(1, 1, hoja.getLastRow(), hoja.getLastColumn()).getValues();
    const fechas = datos[0];
    const filas = datos.slice(1);
    let aserrinCordiez = 0;

    filas.forEach(fila => {
      const cliente = String(fila[0] === null || fila[0] === undefined ? "" : fila[0]).trim();
      const clienteUpper = String(cliente || "").toUpperCase();
      if (!cliente || esFilaExcluidaPorHoja(cliente, cfg.nombre)) {
        if (cliente) Logger.log("Fila ignorada: " + cliente);
        return;
      }

      const tipo = CLIENTES_VENTA.includes(clienteUpper) ? "Venta" : cfg.tipo;

      // La primera fila de CORDIEZ en HUESOS es aserrín, el resto huesos
      let producto = cfg.producto;
      if (cfg.nombre === "HUESOS" && clienteUpper === "CORDIEZ" && aserrinCordiez === 0) {
        aserrinCordiez = 1;
        producto = "Aserrin de hueso";
      }
      producto = String(producto === null || producto === undefined ? "" : producto).trim();

      for (let col = cfg.colInicio; col < fechas.length - 2; col++) {
        const fecha = fechas[col];
        const cantidad = fila[col];
        if (!fecha || !cantidad || cantidad === 0) continue;

        const precio = obtenerPrecio(preciosData, cliente, producto, fecha);
        if (!Number.isFinite(precio) || precio <= 0) {
          throw new Error(`Missing price for client ${cliente}, product ${producto}`);
        }
        const debe  = tipo === "Compra" ? precio * cantidad : 0;
        const haber = tipo === "Venta"  ? precio * cantidad : 0;

        movimientos.push([fecha, cliente, "-", producto, tipo, precio, cantidad, debe, haber, 0]);
      }
    });
  });

  // Agregar movimientos manuales de la hoja CUENTAS
  const hojaCuentas = ss.getSheetByName('CUENTAS');
  if (hojaCuentas) {
    hojaCuentas.getDataRange().getValues().slice(1).forEach(fila => {
      const debe  = parseNumber(fila[7]) || 0;
      const haber = parseNumber(fila[8]) || 0;
      if (!fila[1] || (!debe && !haber)) return;

      movimientos.push([
        fila[0], fila[1], fila[2] || "-", fila[3] || "-", fila[4] || "-",
        fila[5] || 0, fila[6] || 0, debe, haber, 0
      ]);
    });
  }

  return movimientos;
}

function normalizeExcludedName(value) {
  return String(value === null || value === undefined ? "" : value).trim().toLowerCase();
}

function esFilaExcluida(nombre) {
  return FILAS_EXCLUIDAS.indexOf(normalizeExcludedName(nombre)) !== -1;
}

function esFilaExcluidaPorHoja(nombre, hojaNombre) {
  const key = normalizeExcludedName(nombre);
  const hojaKey = String(hojaNombre || "").toUpperCase();
  const lista = FILAS_EXCLUIDAS_POR_HOJA[hojaKey] || FILAS_EXCLUIDAS;
  return lista.indexOf(key) !== -1;
}

// Devuelve el precio vigente para (cliente, producto, fecha), tomando el más reciente <= fecha
function obtenerPrecio(preciosData, cliente, producto, fecha) {
  cliente  = String(cliente).trim().toUpperCase();
  producto = String(producto).trim();

  let precioValido = null;

  for (const fila of preciosData) {
    const cli        = String(fila[0]).trim().toUpperCase();
    const prod       = String(fila[1]).trim();
    const fechaDesde = new Date(fila[2]);
    const precio     = parseNumber(fila[3]) || 0;

    if (cli === cliente && prod === producto && fechaDesde <= fecha) {
      if (!precioValido || fechaDesde > precioValido.fecha) {
        precioValido = { precio, fecha: fechaDesde };
      }
    }
  }

  return precioValido ? precioValido.precio : 0;
}

function esSaldoInicial(mov) {
  return mov[4] && String(mov[4]).toLowerCase().includes("saldo");
}

function crearHojaDetalle(ss, nombreHoja, movimientos) {
  let hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) hoja = ss.insertSheet(nombreHoja);
  else hoja.clear();

  hoja.appendRow(['Fecha', 'Cliente', 'Concepto', 'Producto', 'Movimiento',
                  'Precio', 'Cantidad', 'Debe $', 'Haber $', 'Saldo $']);

  if (movimientos.length === 0) {
    aplicarFormatoEncabezado(hoja);
    return;
  }

  // Ordenar por cliente y luego por fecha
  movimientos.sort((a, b) => {
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return new Date(a[0]) - new Date(b[0]);
  });

  // Calcular saldo acumulado por cliente y totales de kg por producto
  const saldos  = {};
  const totales = {};

  movimientos.forEach(m => {
    const cliente  = m[1];
    const producto = m[3];
    const kg       = m[6];

    if (!saldos[cliente]) saldos[cliente] = 0;
    saldos[cliente] += m[8] - m[7];
    m[9] = saldos[cliente];

    if (producto && producto !== "-") {
      if (!totales[cliente]) totales[cliente] = {};
      if (!totales[cliente][producto]) totales[cliente][producto] = 0;
      totales[cliente][producto] += kg;
    }
  });

  // Intercalar filas de "TOTAL KG" entre clientes
  const resultado = [];
  let clienteActual = null;

  movimientos.forEach(m => {
    if (clienteActual && clienteActual !== m[1]) {
      agregarFilasTotalKg(resultado, clienteActual, totales[clienteActual]);
    }
    resultado.push(m);
    clienteActual = m[1];
  });

  if (clienteActual) {
    agregarFilasTotalKg(resultado, clienteActual, totales[clienteActual]);
  }

  hoja.getRange(2, 1, resultado.length, resultado[0].length).setValues(resultado);
  aplicarFormatoTabla(hoja);
}

function agregarFilasTotalKg(resultado, cliente, productos) {
  if (!productos) return;
  Object.keys(productos).forEach(p => {
    resultado.push(["-", cliente, "TOTAL KG", p, "-", "", productos[p], "", "", ""]);
  });
}
