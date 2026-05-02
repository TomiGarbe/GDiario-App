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

function obtenerPrimerDiaMes(ss) {
  const { mes, anio } = parsearNombreArchivo(ss);
  return new Date(anio, MESES.indexOf(mes), 1);
}

function eliminarTriggersProceso() {
  ScriptApp.getProjectTriggers()
    .filter(t => ["procesoDetalle3Meses", "procesoImportarSaldoInicial"].includes(t.getHandlerFunction()))
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let str = String(value).trim();
  if (!str) return 0;

  str = str.replace(/\$/g, "");
  str = str.replace(/\s+/g, "");
  str = str.replace(/\./g, "");
  str = str.replace(",", ".");

  const num = parseFloat(str);
  if (isNaN(num)) {
    Logger.log("Numero invalido: " + value);
    return null;
  }

  return num;
}
