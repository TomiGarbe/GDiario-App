function procesoImportarSaldoInicial() {
  try {
    const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_OBJETIVO");
    const ssActual = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    if (!ssActual) throw new Error("No se pudo abrir el spreadsheet actual");

    const clientesObjetivo = ["SCURTI", "NICO", "OVIEDO", "AMANECER", "ALMACOR 35"];
    const hojaCuentas = ssActual.getSheetByName("CUENTAS");
    if (!hojaCuentas) throw new Error("No existe la hoja CUENTAS en el archivo actual");

    Logger.log("[Importar Saldos] Inicio en archivo actual: %s (%s)", ssActual.getName(), ssActual.getId());

    const ssAnterior = obtenerArchivoMesAnterior();
    const hojaDetalle = ssAnterior.getSheetByName("DETALLE_CLIENTES");
    if (!hojaDetalle) {
      throw new Error("No existe la hoja DETALLE_CLIENTES en el archivo anterior: " + ssAnterior.getName());
    }

    const saldos = obtenerUltimosSaldosClientes_(hojaDetalle, clientesObjetivo);
    limpiarSaldosInicialesExistentes_(hojaCuentas, clientesObjetivo);
    const filasInsertadas = insertarSaldosIniciales_(hojaCuentas, ssActual, saldos);

    Logger.log("[Importar Saldos] Filas insertadas: %s", filasInsertadas);
  } catch (e) {
    Logger.log("[Importar Saldos] Error: %s", e && e.message ? e.message : e);
    throw e;
  } finally {
    eliminarTriggersProceso();
  }
}

function obtenerUltimosSaldosClientes_(hojaDetalle, clientesObjetivo) {
  const data = hojaDetalle.getDataRange().getValues();
  if (!data || data.length < 2) {
    throw new Error("DETALLE_CLIENTES no tiene filas de datos");
  }

  const headers = data[0].map((h) => String(h || "").trim().toLowerCase());
  const idxCliente = headers.indexOf("cliente");
  const idxSaldo = headers.findIndex((h) => h === "saldo $" || h === "saldo" || h === "saldo$");

  if (idxCliente < 0 || idxSaldo < 0) {
    throw new Error("No se encontraron columnas requeridas en DETALLE_CLIENTES (Cliente / Saldo $)");
  }

  const objetivos = {};
  clientesObjetivo.forEach((c) => { objetivos[normalizarTexto(c)] = c; });

  const resultado = {};
  for (let i = data.length - 1; i >= 1; i -= 1) {
    const row = data[i];
    const clienteRaw = row[idxCliente];
    const clienteNorm = normalizarTexto(clienteRaw);
    if (!clienteNorm || !objetivos[clienteNorm]) continue;
    if (resultado[clienteNorm] !== undefined) continue;

    const saldo = parseNumber(row[idxSaldo]);
    if (saldo === null) continue;

    resultado[clienteNorm] = {
      cliente: objetivos[clienteNorm],
      saldo: saldo
    };
  }

  clientesObjetivo.forEach((cliente) => {
    const key = normalizarTexto(cliente);
    if (resultado[key]) {
      Logger.log("[Importar Saldos] Cliente encontrado: %s | saldo=%s", cliente, resultado[key].saldo);
    } else {
      Logger.log("[Importar Saldos] Cliente NO encontrado en DETALLE_CLIENTES: %s", cliente);
    }
  });

  return Object.keys(resultado).map((k) => resultado[k]);
}

function limpiarSaldosInicialesExistentes_(hojaCuentas, clientesObjetivo) {
  const lastRow = hojaCuentas.getLastRow();
  const lastCol = hojaCuentas.getLastColumn();
  if (lastRow < 2 || lastCol < 9) return;

  const range = hojaCuentas.getRange(2, 1, lastRow - 1, lastCol);
  const values = range.getValues();
  const clientesSet = {};
  clientesObjetivo.forEach((c) => { clientesSet[normalizarTexto(c)] = true; });

  const kept = [];
  let removed = 0;

  values.forEach((row) => {
    const cliente = normalizarTexto(row[1]);
    const concepto = normalizarTexto(row[2]);
    const movimiento = normalizarTexto(row[4]);

    const esClienteObjetivo = !!clientesSet[cliente];
    const esSaldoInicial = concepto === "SALDO INICIAL" || movimiento === "SALDO INICIAL";

    if (esClienteObjetivo && esSaldoInicial) {
      removed += 1;
      return;
    }
    kept.push(row);
  });

  range.clearContent();
  if (kept.length > 0) {
    hojaCuentas.getRange(2, 1, kept.length, lastCol).setValues(kept);
  }

  const rowsToDelete = (lastRow - 1) - kept.length;
  if (rowsToDelete > 0) {
    hojaCuentas.deleteRows(kept.length + 2, rowsToDelete);
  }

  Logger.log("[Importar Saldos] Saldos iniciales existentes eliminados/reemplazados: %s", removed);
}

function insertarSaldosIniciales_(hojaCuentas, ssActual, saldos) {
  if (!saldos || saldos.length === 0) {
    Logger.log("[Importar Saldos] No hay saldos para insertar");
    return 0;
  }

  const fecha = obtenerPrimerDiaMes(ssActual);
  const filas = saldos.map((item) => {
    const saldo = Number(item.saldo || 0);
    const debe = saldo > 0 ? saldo : "";
    const haber = saldo < 0 ? Math.abs(saldo) : "";
    return [
      fecha,
      item.cliente,
      "Saldo Inicial",
      "",
      "Saldo Inicial",
      "",
      "",
      debe,
      haber
    ];
  });

  const startRow = hojaCuentas.getLastRow() + 1;
  hojaCuentas.getRange(startRow, 1, filas.length, 9).setValues(filas);

  const formatoFecha = detectarFormatoFechaCuentas_(hojaCuentas);
  hojaCuentas.getRange(startRow, 1, filas.length, 1).setNumberFormat(formatoFecha);

  Logger.log("[Importar Saldos] Formato de fecha aplicado: %s", formatoFecha);
  filas.forEach((fila) => {
    Logger.log(
      "[Importar Saldos] Insertado -> cliente=%s, debe=%s, haber=%s",
      fila[1],
      fila[7] === "" ? 0 : fila[7],
      fila[8] === "" ? 0 : fila[8]
    );
  });

  return filas.length;
}

function detectarFormatoFechaCuentas_(hojaCuentas) {
  const lastRow = hojaCuentas.getLastRow();
  if (lastRow >= 2) {
    const format = String(hojaCuentas.getRange(2, 1).getNumberFormat() || "").toLowerCase();
    if (format.indexOf("dd/mm/yy") !== -1) return "dd/mm/yy";
    if (format.indexOf("dd/mm/yyyy") !== -1) return "dd/mm/yyyy";
  }
  return "dd/mm/yyyy";
}
