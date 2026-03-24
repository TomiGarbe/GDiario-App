function obtenerSpreadsheetPorFecha(fecha) {

  const meses = [
    "ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO",
    "JULIO","AGOSTO","SEPTIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"
  ];

  const f = parseFecha(fecha);

  const numeroMes = String(f.getMonth() + 1).padStart(2, '0');
  const nombreMes = meses[f.getMonth()];
  const anio = f.getFullYear();

  const nombreArchivo = `${numeroMes} ${nombreMes} ${anio}`;

  const archivos = DriveApp.getFilesByName(nombreArchivo);

  if (!archivos.hasNext()) {
    throw new Error("No se encontró el archivo: " + nombreArchivo);
  }

  return SpreadsheetApp.openById(archivos.next().getId());
}
