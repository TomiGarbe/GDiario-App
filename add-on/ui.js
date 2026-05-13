function onOpen(e) {}
function onInstall(e) { onOpen(e); }

function homepage() {
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Sistema Detalles Clientes')
        .setSubtitle('ActualizaciÃ³n de movimientos')
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(btn('ðŸ’° Importar saldo inicial', 'accionImportarSaldoInicial'))
        .addWidget(btn('ðŸ”„ Actualizar detalle del mes', 'accionActualizarDetalle'))
        .addWidget(btn('ðŸ‘· Generar resumen de sueldos', 'accionResumenSueldos'))
        .addWidget(btn('ðŸ§± Reconstruir movimientos', 'accionReconstruirMovimientos'))
        .addWidget(btn('â˜ï¸ Sync a DB', 'accionSyncToBackend'))
        .addWidget(btn('ðŸ” Actualizar permisos', 'accionActualizarPermisos'))
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
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    PropertiesService.getScriptProperties().setProperty("SPREADSHEET_OBJETIVO", ss.getId());
    Logger.log("[UI Importar Saldos] Click en boton. Spreadsheet actual: %s (%s)", ss.getName(), ss.getId());

    // Debug mode: ejecutar directo para que la ejecucion muestre logs/errores inmediatos.
    procesoImportarSaldoInicial();
    return notificar("✅ Saldos importados");
  } catch (e) {
    Logger.log("[UI Importar Saldos] Error: %s", e && e.message ? e.message : e);
    Logger.log("[UI Importar Saldos] Stack: %s", e && e.stack ? e.stack : "sin stack");
    return notificar("⚠️ " + (e && e.message ? e.message : e));
  }
}

function accionActualizarDetalle() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const movimientos = calcularMovimientos(ss);
    crearHojaDetalle(ss, 'DETALLE_CLIENTES', movimientos);
    return notificar('âœ… Detalle del mes generado');
  } catch (e) {
    return notificar('âš ï¸ ' + e.message);
  }
}

function accionResumenSueldos() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    generarResumenSueldos(ss);
    return notificar('âœ… Resumen de sueldos generado');
  } catch (e) {
    return notificar('âš ï¸ ' + e.message);
  }
}

function accionReconstruirMovimientos() {
  try {
    Logger.log("ReconstrucciÃ³n iniciada");
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
    reconcileMovements(movements.map((m) => ({ ...m, source: m && m.source ? m.source : "sheet" })));
    writeMovementItems(movementItems);
    writeMovementSalaries(movementSalaries);
    writeMovementClientPayments(movementClientPayments);
    Logger.log("ReconstrucciÃ³n finalizada");
    return notificar('âœ… Movimientos reconstruidos');
  } catch (e) {
    return notificar('âš ï¸ ' + e.message);
  }
}

function accionSyncToBackend() {
  try {
    syncToBackend();
    return notificar('â˜ï¸ Sync enviado a backend');
  } catch (e) {
    return notificar('âš ï¸ ' + e.message);
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

    let mensaje = `âœ… ${agregados} permisos actualizados`;
    if (errores.length > 0) mensaje += ` | âš ï¸ errores con: ${errores.join(", ")}`;

    return notificar(mensaje);
  } catch (e) {
    return notificar('âš ï¸ ' + e.message);
  }
}


