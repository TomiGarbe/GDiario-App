// ================================================================
// Utilidades.js — Helpers: búsqueda de archivos por mes, triggers y fechas
// ================================================================

const MESES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
];

// Parsea el nombre del archivo (formato: "NN MES AAAA") y devuelve sus partes
function parsearNombreArchivo(ss) {
  const partes = ss.getName().split(" ");
  return {
    numero:   parseInt(partes[0]),
    mes:      partes[1],
    mesIndex: MESES.indexOf(partes[1]),
    anio:     parseInt(partes[2])
  };
}

function buscarArchivoPorNombre(nombre) {
  const res = Drive.Files.list({
    q: `name='${nombre}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives"
  });

  if (!res.files || res.files.length === 0) return null;
  return SpreadsheetApp.openById(res.files[0].id);
}

function obtenerArchivoMesAnterior() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_OBJETIVO");
  const ss = SpreadsheetApp.openById(id);
  const { numero, mesIndex, anio } = parsearNombreArchivo(ss);

  let mesAnterior = mesIndex - 1;
  let anioAnterior = anio;
  if (mesAnterior < 0) { mesAnterior = 11; anioAnterior--; }

  const nombre = `${String(numero - 1).padStart(2, '0')} ${MESES[mesAnterior]} ${anioAnterior}`;
  const archivo = buscarArchivoPorNombre(nombre);

  if (!archivo) throw new Error("No se encontró el archivo del mes anterior");
  return archivo;
}

function obtenerArchivos3Meses() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_OBJETIVO");
  const ss = SpreadsheetApp.openById(id);
  const { numero, mesIndex, anio } = parsearNombreArchivo(ss);

  const archivos = [];

  for (let i = 0; i < 3; i++) {
    let m = mesIndex - i;
    let y = anio;
    if (m < 0) { m += 12; y--; }

    const nombre = `${String(numero - i).padStart(2, '0')} ${MESES[m]} ${y}`;
    const archivo = buscarArchivoPorNombre(nombre);
    if (archivo) archivos.push(archivo);
  }

  if (archivos.length === 0) throw new Error("No se encontraron archivos de meses anteriores");
  return archivos;
}

function obtenerPrimerDiaMes(ss) {
  const { mes, anio } = parsearNombreArchivo(ss);
  return new Date(anio, MESES.indexOf(mes), 1);
}

function eliminarTriggersProceso() {
  ScriptApp.getProjectTriggers()
    .filter(t => ["procesoDetalle3Meses", "procesoImportarSaldoInicial"].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
}