function onOpen(e) {}
function onInstall(e) { onOpen(e); }

function homepage() {
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle("Sistema Detalles Clientes")
        .setSubtitle("Actualizacion de movimientos")
    )
    .addSection(
      CardService.newCardSection()
        .addWidget(btn("💰 Importar saldo inicial", "accionImportarSaldoInicial"))
        .addWidget(btn("📋 Actualizar detalle del mes", "accionActualizarDetalle"))
        .addWidget(btn("💵 Generar resumen de sueldos", "accionResumenSueldos"))
        .addWidget(btn("🔄 Reconstruir movimientos", "accionReconstruirMovimientos"))
        .addWidget(btn("⬆️ Sync desde sheets a app", "accionSyncToBackend"))
        .addWidget(btn("⬇️ Sync desde app a sheets", "accionSyncFromBackend"))
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

function accionImportarSaldoInicial() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    PropertiesService.getScriptProperties().setProperty("SPREADSHEET_OBJETIVO", ss.getId());
    Logger.log("[UI Importar Saldos] Click en boton. Spreadsheet actual: %s (%s)", ss.getName(), ss.getId());

    procesoImportarSaldoInicial();
    return notificar("Saldos importados");
  } catch (e) {
    Logger.log("[UI Importar Saldos] Error: %s", e && e.message ? e.message : e);
    Logger.log("[UI Importar Saldos] Stack: %s", e && e.stack ? e.stack : "sin stack");
    return notificar(e && e.message ? e.message : String(e));
  }
}

function accionActualizarDetalle() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const movimientos = calcularMovimientos(ss);
    crearHojaDetalle(ss, "DETALLE_CLIENTES", movimientos);
    return notificar("Detalle del mes generado");
  } catch (e) {
    return notificar(e && e.message ? e.message : String(e));
  }
}

function accionResumenSueldos() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    generarResumenSueldos(ss);
    return notificar("Resumen de sueldos generado");
  } catch (e) {
    return notificar(e && e.message ? e.message : String(e));
  }
}

function accionReconstruirMovimientos() {
  try {
    Logger.log("Reconstruccion iniciada");
    const result = reconstruirMovimientos() || {};
    const rebuiltMovements = Array.isArray(result.movements) ? result.movements : [];
    const existingMovements = readMovements();
    const preservedMovements = (existingMovements || []).filter((movement) => {
      const source = String((movement && movement.source) || "").trim().toLowerCase();
      return source === "app-entrega";
    });
    const movements = preservedMovements.concat(rebuiltMovements);
    const movementItems = Array.isArray(result.movement_items) ? result.movement_items : [];
    const movementSalaries = Array.isArray(result.movement_salaries) ? result.movement_salaries : [];
    const movementClientPayments = Array.isArray(result.movement_client_payments) ? result.movement_client_payments : [];

    reconcileMovements(movements.map((movement) => ({
      ...movement,
      source: movement && movement.source ? movement.source : "sheet"
    })));
    writeMovementItems(movementItems);
    writeMovementSalaries(movementSalaries);
    writeMovementClientPayments(movementClientPayments);

    Logger.log("Reconstruccion finalizada");
    return notificar("Movimientos reconstruidos");
  } catch (e) {
    return notificar(e && e.message ? e.message : String(e));
  }
}

function accionSyncToBackend() {
  try {
    syncToBackend();
    return notificar("Sync enviado a backend");
  } catch (e) {
    return notificar(e && e.message ? e.message : String(e));
  }
}

function accionSyncFromBackend() {
  try {
    const result = syncFromBackendToSheet();
    return notificar(
      "Sync desde app listo: " +
      result.movements + " movs, " +
      result.movement_items + " items"
    );
  } catch (e) {
    return notificar(e && e.message ? e.message : String(e));
  }
}
