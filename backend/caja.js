function registrarEntrega(data) {
  registrarCaja({
    fecha: data.fecha,
    tipo: "Entrega de dinero",
    monto: data.monto
  });

  const ss = obtenerSpreadsheetPorFecha(data.fecha);
  registrarMovimientoEnHoja(ss, {
    id: generarIdMovimiento(),
    fecha: data.fecha,
    tipo: "Entrega de dinero",
    cliente: "",
    detalle: "Entrega de dinero",
    monto: data.monto,
    datos: {}
  });

  return "OK";
}

function numeroSeguroCaja(valor) {
  if (typeof valor === "number") {
    return isFinite(valor) ? valor : 0;
  }

  const raw = String(valor === undefined || valor === null ? "" : valor).trim();
  if (!raw) return 0;

  const n = Number(raw.replace(",", "."));
  return isFinite(n) ? n : 0;
}

function numeroPositivoCaja(valor) {
  const n = numeroSeguroCaja(valor);
  return n > 0 ? n : 0;
}

function textoSeguroCaja(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor);
}

function registrarPagoCliente(data) {
  const cliente = normalizarCliente(data.cliente || "");
  const monto = numeroPositivoCaja(data.monto);

  if (!CLIENTES_ESPECIALES.includes(cliente)) {
    throw new Error("Cliente especial inválido para pago");
  }

  if (monto <= 0) {
    throw new Error("Monto inválido para pago a cliente");
  }

  registrarCaja({
    fecha: data.fecha,
    tipo: "Pago a cliente",
    cliente: cliente,
    monto: monto
  });

  const ss = obtenerSpreadsheetPorFecha(data.fecha);
  registrarPagoEnCuentas(ss, data.fecha, cliente, monto);
  registrarMovimientoEnHoja(ss, {
    id: generarIdMovimiento(),
    fecha: data.fecha,
    tipo: "Pago a cliente",
    cliente: cliente,
    detalle: "Pago a cliente",
    monto: monto,
    datos: {}
  });

  return "OK";
}

function registrarCaja(data) {
  const ss = obtenerSpreadsheetPorFecha(data.fecha);
  const hoja = ss.getSheetByName("SALDO FABIAN");
  if (!hoja) throw new Error("No existe la hoja SALDO FABIAN");

  const lastRow = hoja.getLastRow();

  let saldoAnterior = 0;
  for (let row = lastRow; row >= 2; row--) {
    const saldoCelda = hoja.getRange(row, 7).getValue();
    if (saldoCelda === "" || saldoCelda === null) continue;

    saldoAnterior = numeroSeguroCaja(saldoCelda);
    break;
  }

  const tipo = textoSeguroCaja(data.tipo);
  const cliente = textoSeguroCaja(data.cliente).trim();
  const detalle = textoSeguroCaja(data.detalle).trim();

  let ingreso = 0;
  let egreso = 0;

  const monto = numeroPositivoCaja(data.monto);
  if (tipo === "Entrega de dinero" || tipo === "Venta") ingreso = monto;
  else egreso = monto;

  const nuevoSaldo = saldoAnterior + ingreso - egreso;
  const fecha = parseFecha(data.fecha);

  hoja.appendRow([
    fecha,
    cliente,
    detalle,
    tipo,
    ingreso,
    egreso,
    nuevoSaldo
  ]);

  hoja.getRange(hoja.getLastRow(), 1).setNumberFormat("dd/MM/yyyy");
}

function esTipoIngresoSaldo(tipoRaw) {
  const tipo = normalizarCliente(tipoRaw);
  return tipo === "ENTREGA DE DINERO" || tipo === "VENTA";
}

function reconstruirSaldoFabian(fechaReferencia) {
  const fecha = fechaReferencia || hoyArgentinaISO();
  const ss = obtenerSpreadsheetPorFecha(fecha);
  return reconstruirSaldoFabianPorSpreadsheet(ss);
}

function reconstruirSaldoFabianPorSpreadsheet(ss, opciones) {
  const hojaSaldo = ss.getSheetByName("SALDO FABIAN");
  if (!hojaSaldo) throw new Error("No existe la hoja SALDO FABIAN");

  const forzarVacio = !!(opciones && opciones.forzarVacio === true);
  const registros = obtenerRegistrosMovimientos(ss);

  if (!registros.length) {
    if (forzarVacio) {
      const rows = hojaSaldo.getLastRow();
      if (rows > 1) {
        hojaSaldo.getRange(2, 1, rows - 1, 7).clearContent();
      }
    }
    return "OK";
  }

  const lastRowSaldo = hojaSaldo.getLastRow();
  if (lastRowSaldo > 1) {
    hojaSaldo.getRange(2, 1, lastRowSaldo - 1, 7).clearContent();
  }

  let saldo = 0;
  const salida = [];

  registros.forEach(registro => {
    const monto = numeroPositivoCaja(registro.monto);
    if (!monto) return;

    const tipo = textoSeguroCaja(registro.tipo).trim();
    const cliente = textoSeguroCaja(registro.cliente).trim();
    const detalle = textoSeguroCaja(registro.detalle).trim();
    const fecha = parseFecha(registro.fecha);

    const ingreso = esTipoIngresoSaldo(tipo) ? monto : 0;
    const egreso = ingreso > 0 ? 0 : monto;

    saldo += ingreso - egreso;

    salida.push([
      fecha,
      cliente,
      detalle,
      tipo,
      ingreso,
      egreso,
      saldo
    ]);
  });

  if (!salida.length) return "OK";

  hojaSaldo.getRange(2, 1, salida.length, 7).setValues(salida);
  hojaSaldo.getRange(2, 1, salida.length, 1).setNumberFormat("dd/MM/yyyy");

  return "OK";
}

function obtenerSaldo() {
  const ss = obtenerSpreadsheetPorFecha(hoyArgentinaISO());
  const hoja = ss.getSheetByName("SALDO FABIAN");
  if (!hoja) throw new Error("No existe la hoja SALDO FABIAN");

  const lastRow = hoja.getLastRow();
  if (lastRow <= 1) {
    Logger.log("obtenerSaldo -> 0");
    return 0;
  }

  let saldo = 0;
  for (let row = lastRow; row >= 2; row--) {
    const valor = hoja.getRange(row, 7).getValue();
    if (valor === "" || valor === null) continue;

    saldo = Number(valor) || 0;
    break;
  }

  const res = saldo || 0;
  Logger.log("obtenerSaldo -> " + res);
  return res;
}

function obtenerMovimientosDelDia(fechaStr) {
  const fecha = fechaStr || hoyArgentinaISO();
  const fechaObjetivo = parseFecha(fecha);
  const ss = obtenerSpreadsheetPorFecha(fecha);
  const registros = obtenerRegistrosMovimientos(ss);

  const movimientos = [];
  let totIngresos = 0;
  let totEgresos = 0;

  registros.forEach(registro => {
    if (!mismaFecha(registro.fecha, fechaObjetivo)) return;

    const monto = numeroPositivoCaja(registro.monto);
    const tipo = textoSeguroCaja(registro.tipo).trim();
    const ingreso = esTipoIngresoSaldo(tipo);

    if (ingreso) totIngresos += monto;
    else totEgresos += monto;

    const movimiento = {
      id: textoSeguroCaja(registro.id).trim(),
      fecha: Utilities.formatDate(parseFecha(registro.fecha), TZ_AR, "yyyy-MM-dd"),
      tipo: tipo,
      cliente: textoSeguroCaja(registro.cliente).trim(),
      detalle: textoSeguroCaja(registro.detalle).trim(),
      producto: textoSeguroCaja(registro.producto).trim(),
      kg: Number(registro.kg || 0),
      monto: monto,
      clase: ingreso ? "ingreso" : "egreso",
      datos: registro.datos || null
    };

    movimientos.push(movimiento);
  });

  const res = {
    movimientos: movimientos,
    totIngresos: totIngresos,
    totEgresos: totEgresos
  };
  Logger.log("obtenerMovimientosDelDia(" + fecha + ") -> " + JSON.stringify(res));
  return res;
}
