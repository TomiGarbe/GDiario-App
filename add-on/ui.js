function onOpen(e) {}
function onInstall(e) { onOpen(e); }

function homepage() {
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Sistema Detalles Clientes')
        .setSubtitle('Actualización de movimientos')
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(btn('💰 Importar saldo inicial', 'accionImportarSaldoInicial'))
        .addWidget(btn('🔄 Actualizar detalle del mes', 'accionActualizarDetalle'))
        .addWidget(btn('👷 Generar resumen de sueldos', 'accionResumenSueldos'))
        .addWidget(btn('🧱 Reconstruir movimientos', 'accionReconstruirMovimientos'))
        .addWidget(btn('☁️ Sync a DB', 'accionSyncToBackend'))
        .addWidget(btn('🔐 Actualizar permisos', 'accionActualizarPermisos'))
    )
    .build();
}

function btn(text, fn) {
  return CardService.newTextButton()
    .setText(text)
    .setOnClickAction(CardService.newAction().setFunctionName(fn));
}

function notificar(msg) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification().setText(msg))
    .build();
}

// ========================= BOTONES =========================

function accionImportarSaldoInicial() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_OBJETIVO", ss.getId());

  eliminarTriggersProceso();
  ScriptApp.newTrigger("procesoImportarSaldoInicial").timeBased().after(2000).create();

  return notificar("⏳ Buscando saldo final del mes anterior...");
}

function accionActualizarDetalle() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const movimientos = calcularMovimientos(ss);
    crearHojaDetalle(ss, 'DETALLE_CLIENTES', movimientos);
    return notificar('✅ Detalle del mes generado');
  } catch (e) {
    return notificar('⚠️ ' + e.message);
  }
}

function accionResumenSueldos() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    generarResumenSueldos(ss);
    return notificar('✅ Resumen de sueldos generado');
  } catch (e) {
    return notificar('⚠️ ' + e.message);
  }
}

function accionReconstruirMovimientos() {
  try {
    Logger.log("Reconstrucción iniciada");
    const result = reconstruirMovimientos() || {};
    const rebuiltMovements = Array.isArray(result.movements) ? result.movements : [];
    const existingMovements = readMovements();
    const preservedMovements = (existingMovements || []).filter((m) => {
      const source = String((m && m.source) || "").trim().toLowerCase();
      return source === "app-entrega";
    });
    const movements = preservedMovements.concat(rebuiltMovements);
    const movementItems = Array.isArray(result.movement_items) ? result.movement_items : [];
    const movementSalaries = Array.isArray(result.movement_salaries) ? result.movement_salaries : [];
    const movementClientPayments = Array.isArray(result.movement_client_payments) ? result.movement_client_payments : [];
    writeMovements(movements.map((m) => ({ ...m, source: m && m.source ? m.source : "sheet" })));
    writeMovementItems(movementItems);
    writeMovementSalaries(movementSalaries);
    writeMovementClientPayments(movementClientPayments);
    Logger.log("Reconstrucción finalizada");
    return notificar('✅ Movimientos reconstruidos');
  } catch (e) {
    return notificar('⚠️ ' + e.message);
  }
}

function accionSyncToBackend() {
  try {
    syncToBackend();
    return notificar('☁️ Sync enviado a backend');
  } catch (e) {
    return notificar('⚠️ ' + e.message);
  }
}

function accionActualizarPermisos() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const emails = [
      "tomigarbe2003@gmail.com",
      "cristiangarbe@gmail.com",
      "angel2018dios@gmail.com"
    ];

    let agregados = 0;
    const errores = [];

    emails.forEach(email => {
      try {
        ss.addEditor(email);
        agregados++;
      } catch (e) {
        errores.push(email);
        Logger.log("Error con " + email + ": " + e.message);
      }
    });

    let mensaje = `✅ ${agregados} permisos actualizados`;
    if (errores.length > 0) mensaje += ` | ⚠️ errores con: ${errores.join(", ")}`;

    return notificar(mensaje);
  } catch (e) {
    return notificar('⚠️ ' + e.message);
  }
}
