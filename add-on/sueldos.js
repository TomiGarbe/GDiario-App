// ================================================================
// Sueldos.js — Generación del resumen de sueldos por empleado
// ================================================================

function generarResumenSueldos(ss) {
  const hojaSueldos = ss.getSheetByName("SUELDOS");
  if (!hojaSueldos) throw new Error("No existe la hoja SUELDOS");

  let hojaResumen = ss.getSheetByName("RESUMEN SUELDOS");
  if (!hojaResumen) hojaResumen = ss.insertSheet("RESUMEN SUELDOS");
  else hojaResumen.clear();

  hojaResumen.appendRow(["Fecha", "Empleado", "Concepto", "Monto"]);

  const datos = hojaSueldos.getDataRange().getValues().slice(1);
  if (datos.length === 0) return;

  const normalizarTipoSueldo = (value) => String(value == null ? "" : value).trim().toLowerCase();

  const registros = datos.map(r => ({
    fecha:    new Date(r[0]),
    empleado: String(r[1]).toUpperCase(),
    tipo:     normalizarTipoSueldo(r[2]),
    concepto: r[3],
    monto:    parseNumber(r[4]) || 0
  }));

  // Agrupar por empleado
  const empleados = {};
  registros.forEach(r => {
    if (!empleados[r.empleado]) empleados[r.empleado] = [];
    empleados[r.empleado].push(r);
  });

  const resultado = [];

  Object.keys(empleados).sort().forEach(emp => {
    const lista = empleados[emp];

    const saldosIniciales = lista
      .filter(r => ["saldo inicial", "saldo_inicial"].includes(r.tipo))
      .sort((a, b) => a.fecha - b.fecha);

    const basePremioFalta = lista
      .filter(r => ["sueldo base", "premio", "falta"].includes(r.tipo))
      .sort((a, b) => a.fecha - b.fecha);

    const adelantos = lista
      .filter(r => ["adelanto", "otro"].includes(r.tipo))
      .sort((a, b) => a.fecha - b.fecha);

    let totalBase    = 0;
    let totalPremios = 0;
    let totalFaltas  = 0;
    let saldoInicial = 0;
    let totalAdelantos = 0;
    let efectoAdelantosEnSaldo = 0;

    saldosIniciales.forEach(r => {
      saldoInicial += r.monto;
      resultado.push([r.fecha, emp, r.concepto || "Saldo Inicial", r.monto]);
    });

    if (saldosIniciales.length > 0) {
      resultado.push(["", emp, "SALDO INICIAL", saldoInicial]);
    }

    // Sueldo base, premios y faltas
    basePremioFalta.forEach(r => {
      let monto = r.monto;

      if (r.tipo === "falta") {
        monto = -Math.abs(monto);
        totalFaltas += Math.abs(r.monto);
      } else if (r.tipo === "premio") {
        totalPremios += r.monto;
      } else if (r.tipo === "sueldo base") {
        totalBase += r.monto;
      }

      resultado.push([r.fecha, emp, r.concepto, monto]);
    });

    const sueldoTotal = totalBase + totalPremios - totalFaltas;
    resultado.push(["", emp, "TOTAL SUELDO", sueldoTotal]);

    // Adelantos: positivo descuenta saldo; negativo suma saldo.
    adelantos.forEach(r => {
      totalAdelantos += r.monto;
      efectoAdelantosEnSaldo += -r.monto;
      resultado.push([r.fecha, emp, r.concepto || "Adelanto", -r.monto]);
    });

    resultado.push(["", emp, "TOTAL ADELANTOS", totalAdelantos]);
    resultado.push(["", emp, "SALDO FINAL",  saldoInicial + sueldoTotal + efectoAdelantosEnSaldo]);
  });

  hojaResumen.getRange(2, 1, resultado.length, 4).setValues(resultado);
  aplicarFormatoTablaSueldos(hojaResumen);
}
