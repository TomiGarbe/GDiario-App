// ================================================================
// Utilidades.js — Helpers: busqueda de archivos por mes, triggers y fechas
// ================================================================

const MESES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
];

function normalizarTexto(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

// Parsea el nombre del archivo (formato: "NN MES AAAA") y devuelve sus partes
function parsearNombreArchivo(ss) {
  const nombre = String(ss.getName() || "").trim();
  const match = nombre.match(/^(\d{1,2})\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s+(\d{4})$/);
  if (!match) {
    throw new Error("Nombre de archivo invalido. Formato esperado: 'NN MES AAAA'");
  }

  const numero = parseInt(match[1], 10);
  const mesOriginal = normalizarTexto(match[2]);
  const mesIndex = MESES.findIndex((m) => normalizarTexto(m) === mesOriginal);
  const anio = parseInt(match[3], 10);

  if (mesIndex < 0) {
    throw new Error("Mes no reconocido en nombre de archivo: " + match[2]);
  }

  return {
    numero: numero,
    mes: MESES[mesIndex],
    mesIndex: mesIndex,
    anio: anio
  };
}

function buscarArchivoPorNombre(nombre) {
  const escaped = String(nombre || "").replace(/'/g, "\\'");
  const res = Drive.Files.list({
    q: `name='${escaped}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    corpora: "allDrives"
  });

  if (!res.files || res.files.length === 0) return null;
  return SpreadsheetApp.openById(res.files[0].id);
}

function obtenerArchivoMesAnterior() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_OBJETIVO");
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  const { mesIndex, anio } = parsearNombreArchivo(ss);

  let mesAnterior = mesIndex - 1;
  let anioAnterior = anio;
  if (mesAnterior < 0) {
    mesAnterior = 11;
    anioAnterior--;
  }

  const numeroAnterior = mesAnterior + 1;
  const nombre = `${String(numeroAnterior).padStart(2, '0')} ${MESES[mesAnterior]} ${anioAnterior}`;
  Logger.log("Buscando archivo mes anterior. Actual=%s, Candidato=%s", ss.getName(), nombre);

  const archivo = buscarArchivoPorNombre(nombre);
  if (!archivo) throw new Error("No se encontro el archivo del mes anterior: " + nombre);

  Logger.log("Archivo mes anterior encontrado: %s (%s)", archivo.getName(), archivo.getId());
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
