function accionImportarSaldoInicial(){

  try {

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    PropertiesService.getScriptProperties()
      .setProperty("SPREADSHEET_OBJETIVO", ss.getId());

    eliminarTriggersProceso();

    ScriptApp.newTrigger("procesoImportarSaldoInicial")
      .timeBased()
      .after(2000)
      .create();

    return notificar("⏳ Buscando saldo final del mes anterior...");

  } catch (e) {
    return notificar("⚠️ " + e.message);
  }
}


function accionActualizarDetalle(){

  try {

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const movimientos = calcularMovimientos(ss);

    crearHojaDetalle(ss, 'DETALLE_CLIENTES', movimientos);

    return notificar('✅ Detalle del mes generado');

  } catch (e) {
    return notificar('⚠️ ' + e.message);
  }
}


function accionResumenSueldos(){

  try {

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    generarResumenSueldos(ss);

    return notificar('✅ Resumen de sueldos generado');

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
    let errores = [];

    emails.forEach(email => {

      try {
        ss.addEditor(email);
        agregados++;

      } catch (e) {
        errores.push(email);
      }

    });

    let mensaje = `✅ ${agregados} permisos actualizados`;

    if (errores.length > 0) {
      mensaje += ` | ⚠️ errores con: ${errores.join(", ")}`;
    }

    return notificar(mensaje);

  } catch (e) {
    return notificar('⚠️ ' + e.message);
  }
}


//////////////////////////////////////
// 🔥 NUEVAS ACCIONES (BACKEND)
//////////////////////////////////////

function accionFetchFromBackend(){

  try {

    fetchFromBackend();

    return notificar('📥 Datos actualizados desde la base');

  } catch (e) {

    return notificar('⚠️ ' + e.message);
  }
}


function accionSyncToBackend(){

  try {

    syncToBackend();

    return notificar('☁️ Datos enviados a la base');

  } catch (e) {

    return notificar('⚠️ ' + e.message);
  }
}