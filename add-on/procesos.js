function procesoImportarSaldoInicial() {
  try {
    const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_OBJETIVO");
    const ssActual = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
    if (!ssActual) throw new Error("No se pudo abrir el spreadsheet actual");

    const clientesObjetivo = ["SCURTI", "NICO", "OVIEDO", "AMANECER", "ALMACOR 35"];
    const hojaCuentas = ssActual.getSheetByName("CUENTAS");
    if (!hojaCuentas) throw new Error("No existe la hoja CUENTAS en el archivo actual");

    Logger.log("[Importar Saldos] ===== INICIO =====");
    Logger.log("[Importar Saldos] Archivo actual: %s (%s)", ssActual.getName(), ssActual.getId());
    Logger.log("[Importar Saldos] Clientes objetivo: %s", clientesObjetivo.join(", "));
    Logger.log("[Importar Saldos] Hoja CUENTAS detectada. lastRow=%s, lastCol=%s", hojaCuentas.getLastRow(), hojaCuentas.getLastColumn());

    const ssAnterior = obtenerArchivoMesAnterior();
    Logger.log("[Importar Saldos] Archivo anterior abierto: %s (%s)", ssAnterior.getName(), ssAnterior.getId());

    const hojaDetalle = ssAnterior.getSheetByName("DETALLE_CLIENTES");
    if (!hojaDetalle) {
      throw new Error("No existe la hoja DETALLE_CLIENTES en el archivo anterior: " + ssAnterior.getName());
    }
    Logger.log("[Importar Saldos] Hoja DETALLE_CLIENTES detectada. lastRow=%s, lastCol=%s", hojaDetalle.getLastRow(), hojaDetalle.getLastColumn());

    const saldos = obtenerUltimosSaldosClientes_(hojaDetalle, clientesObjetivo);
    Logger.log("[Importar Saldos] Total clientes con saldo recuperado: %s", saldos.length);

    limpiarSaldosInicialesExistentes_(hojaCuentas, clientesObjetivo);
    const filasInsertadas = insertarSaldosIniciales_(hojaCuentas, ssActual, saldos);

    Logger.log("[Importar Saldos] Filas insertadas: %s", filasInsertadas);
    Logger.log("[Importar Saldos] ===== FIN OK =====");
  } catch (e) {
    Logger.log("[Importar Saldos] Error: %s", e && e.message ? e.message : e);
    Logger.log("[Importar Saldos] Stack: %s", e && e.stack ? e.stack : "sin stack");
    Logger.log("[Importar Saldos] ===== FIN ERROR =====");
    throw e;
  } finally {
    eliminarTriggersProceso();
  }
}

function obtenerUltimosSaldosClientes_(hojaDetalle, clientesObjetivo) {
  const data = hojaDetalle.getDataRange().getValues();
  Logger.log("[Importar Saldos] Lectura DETALLE_CLIENTES: filas=%s, columnas=%s", data.length, (data[0] || []).length);

  if (!data || data.length < 2) {
    throw new Error("DETALLE_CLIENTES no tiene filas de datos");
  }

  // Estructura fija de DETALLE_CLIENTES:
  // 1 Fecha | 2 Cliente | 3 Concepto | 4 Producto | 5 Movimiento | 6 Precio |
  // 7 Cantidad | 8 Debe $ | 9 Haber $ | 10 Saldo $
  const IDX_CLIENTE = 1; // columna 2 (base 0)
  const IDX_SALDO = 9;   // columna 10 (base 0)
  Logger.log("[Importar Saldos] Indices fijos -> cliente(col 2 idx 1), saldo(col 10 idx 9)");

  const objetivos = {};
  clientesObjetivo.forEach((c) => { objetivos[String(c || "").trim().toUpperCase()] = c; });

  const resultado = {};
  let filasEvaluadas = 0;

  for (let i = data.length - 1; i >= 1; i -= 1) {
    const row = data[i];
    const clienteRaw = row[IDX_CLIENTE];
    const clienteNorm = String(clienteRaw || "").trim().toUpperCase();
    const saldoRaw = row[IDX_SALDO];
    filasEvaluadas += 1;

    Logger.log("[Importar Saldos] Fila %s analizada -> cliente='%s' saldoRaw='%s'", i + 1, clienteNorm, saldoRaw);
    if (!clienteNorm) continue;
    if (!objetivos[clienteNorm]) continue;
    if (resultado[clienteNorm] !== undefined) continue;

    const saldoTexto = String(saldoRaw === null || saldoRaw === undefined ? "" : saldoRaw).trim();
    if (!saldoTexto) {
      Logger.log("[Importar Saldos] Fila %s descartada por saldo vacio. cliente=%s", i + 1, clienteNorm);
      continue;
    }

    const saldo = parseNumber(saldoRaw);
    if (saldo === null) {
      Logger.log("[Importar Saldos] Fila %s ignorada por saldo invalido. cliente=%s valor=%s", i + 1, clienteRaw, saldoRaw);
      continue;
    }

    resultado[clienteNorm] = {
      cliente: objetivos[clienteNorm],
      saldo: saldo
    };
    Logger.log("[Importar Saldos] Saldo encontrado -> fila=%s cliente=%s saldo=%s", i + 1, objetivos[clienteNorm], saldo);
  }

  Logger.log("[Importar Saldos] Filas evaluadas en barrido inverso: %s", filasEvaluadas);

  clientesObjetivo.forEach((cliente) => {
    const key = String(cliente || "").trim().toUpperCase();
    if (resultado[key]) {
      Logger.log("[Importar Saldos] Cliente encontrado: %s | saldo=%s", cliente, resultado[key].saldo);
    } else {
      Logger.log("[Importar Saldos] Cliente NO encontrado en DETALLE_CLIENTES: %s", cliente);
    }
  });

  Object.keys(resultado).forEach((k) => {
    Logger.log("[Importar Saldos] Saldo final elegido por cliente -> %s: %s", resultado[k].cliente, resultado[k].saldo);
  });

  return Object.keys(resultado).map((k) => resultado[k]);
}

function limpiarSaldosInicialesExistentes_(hojaCuentas, clientesObjetivo) {
  const lastRow = hojaCuentas.getLastRow();
  const lastCol = hojaCuentas.getLastColumn();
  Logger.log("[Importar Saldos] Limpieza en CUENTAS. lastRow=%s lastCol=%s", lastRow, lastCol);

  if (lastRow < 2 || lastCol < 9) {
    Logger.log("[Importar Saldos] Limpieza omitida por hoja sin datos o columnas insuficientes");
    return;
  }

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
    aplicarFormatoHojaPorNombre(hojaCuentas);
  }

  const rowsToDelete = (lastRow - 1) - kept.length;
  if (rowsToDelete > 0) {
    hojaCuentas.deleteRows(kept.length + 2, rowsToDelete);
  }

  Logger.log("[Importar Saldos] Saldos iniciales existentes eliminados/reemplazados: %s", removed);
  Logger.log("[Importar Saldos] Filas conservadas en CUENTAS: %s", kept.length);
}

function insertarSaldosIniciales_(hojaCuentas, ssActual, saldos) {
  if (!saldos || saldos.length === 0) {
    Logger.log("[Importar Saldos] No hay saldos para insertar");
    return 0;
  }

  const fecha = obtenerPrimerDiaMes(ssActual);
  Logger.log("[Importar Saldos] Fecha de saldo inicial calculada: %s", fecha);

  const filas = saldos.map((item) => {
    const saldo = Number(item.saldo || 0);
    const haber = saldo > 0 ? saldo : "";
    const debe = saldo < 0 ? Math.abs(saldo) : "";
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
  Logger.log("[Importar Saldos] Insercion en CUENTAS desde fila: %s", startRow);
  hojaCuentas.getRange(startRow, 1, filas.length, 9).setValues(filas);

  const formatoFecha = detectarFormatoFechaCuentas_(hojaCuentas);
  hojaCuentas.getRange(startRow, 1, filas.length, 1).setNumberFormat(formatoFecha);
  aplicarFormatoRangoDatos(hojaCuentas, startRow, filas.length, 9, {
    colFecha: 1,
    colsMoneda: [8, 9]
  });

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
