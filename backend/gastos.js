function guardarGasto(data) {
  registrarGastoInterno(data);
  return "OK";
}

function registrarGastoInterno(data, opciones) {
  const opts = opciones || {};
  const fechaOriginal = String(data && data.fecha || opts.fecha || "").trim();
  if (!fechaOriginal) {
    throw new Error("Fecha de gasto invalida");
  }

  const ss = opts.ss || obtenerSpreadsheetPorFecha(fechaOriginal);
  const fecha = parseFecha(fechaOriginal);
  const tipo = String(data.tipo || "").trim();
  const monto = numeroSeguroGasto(data.monto);
  const idMovimiento = String(opts.idMovimiento || data.idMovimiento || "").trim() || generarIdMovimiento();

  if (!tipo) {
    throw new Error("Tipo de gasto invalido");
  }

  if (normalizarCliente(tipo) === "AYUDANTES") {
    const montoBaseAyudantes = monto > 0
      ? monto
      : (Array.isArray(data.empleados)
        ? data.empleados.reduce(function(acc, item) {
          return acc + numeroSeguroGasto(item && item.monto);
        }, 0)
        : 0);

    if (!montoBaseAyudantes || montoBaseAyudantes <= 0) {
      throw new Error("Monto invalido");
    }

    const hojaSueldos = ss.getSheetByName("SUELDOS");
    if (!hojaSueldos) throw new Error("No existe la hoja SUELDOS");

    const adelantos = normalizarAdelantosAyudantes(data.empleados, montoBaseAyudantes);
    if (adelantos.length === 0) {
      throw new Error("No hay adelantos validos para ayudantes");
    }

    registrarAdelantosAyudantes(hojaSueldos, fechaOriginal, adelantos);

    const montoTotalAyudantes = adelantos.reduce((acc, item) => acc + numeroSeguroGasto(item.monto), 0);

    registrarCaja({
      fecha: fechaOriginal,
      detalle: "Ayudantes",
      tipo: "Gasto",
      monto: montoTotalAyudantes
    });

    registrarMovimientoEnHoja(ss, {
      id: idMovimiento,
      fecha: fechaOriginal,
      tipo: "Gasto",
      cliente: "",
      detalle: "AYUDANTES",
      monto: montoTotalAyudantes,
      datos: {
        empleados: adelantos.map(function(item) {
          return {
            nombre: normalizarCliente(item.nombre),
            monto: numeroSeguroGasto(item.monto)
          };
        })
      }
    });

    return {
      ok: true,
      id: idMovimiento
    };
  }

  if (!monto || monto <= 0) {
    throw new Error("Monto invalido");
  }

  const hoja = ss.getSheetByName("GASTOS");
  if (!hoja) throw new Error("No existe la hoja GASTOS");

  hoja.appendRow([
    fecha,
    tipo,
    monto
  ]);

  hoja.getRange(hoja.getLastRow(), 1).setNumberFormat("dd/MM/yyyy");

  registrarCaja({
    fecha: fechaOriginal,
    detalle: tipo,
    tipo: "Gasto",
    monto: monto
  });

  registrarMovimientoEnHoja(ss, {
    id: idMovimiento,
    fecha: fechaOriginal,
    tipo: "Gasto",
    cliente: "",
    detalle: tipo,
    monto: monto,
    datos: {}
  });

  return {
    ok: true,
    id: idMovimiento
  };
}

function numeroSeguroGasto(valor) {
  if (typeof valor === "number") {
    return isFinite(valor) ? valor : 0;
  }

  const raw = String(valor === undefined || valor === null ? "" : valor).trim();
  if (!raw) return 0;

  const n = Number(raw.replace(",", "."));
  return isFinite(n) ? n : 0;
}

function normalizarAdelantosAyudantes(empleadosRaw, montoTotal) {
  if (!Array.isArray(empleadosRaw) || empleadosRaw.length === 0) {
    const mitad = numeroSeguroGasto(montoTotal) / 2;
    return [
      { nombre: "TOMAS", monto: mitad },
      { nombre: "KEVIN", monto: mitad }
    ];
  }

  return empleadosRaw
    .map(item => ({
      nombre: normalizarCliente(item && item.nombre),
      monto: numeroSeguroGasto(item && item.monto)
    }))
    .filter(item => item.nombre && item.monto > 0);
}

function registrarAdelantosAyudantes(hojaSueldos, fecha, adelantos) {
  const fecahSueldos = parseFecha(fecha);
  
  adelantos.forEach(item => {
    hojaSueldos.appendRow([
      fecahSueldos,
      item.nombre,
      "Adelanto",
      "Adelanto",
      item.monto
    ]);

    hojaSueldos.getRange(hojaSueldos.getLastRow(), 1).setNumberFormat("dd/MM/yyyy");
  });
}
