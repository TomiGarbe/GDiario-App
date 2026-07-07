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

function importarPreciosDesdeMesAnterior() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_OBJETIVO", ss.getId());

  const ssAnterior = obtenerArchivoMesAnterior();
  const hojaAnterior = ssAnterior.getSheetByName("PRECIOS");
  if (!hojaAnterior) {
    throw new Error("El archivo del mes anterior no tiene hoja PRECIOS");
  }

  const lastRow = hojaAnterior.getLastRow();
  const lastCol = hojaAnterior.getLastColumn();
  if (lastRow < 2 || lastCol < 4) {
    throw new Error("La hoja PRECIOS del mes anterior no tiene datos suficientes");
  }

  const values = hojaAnterior.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0] || [];
  const idxCliente = buscarIndiceHeaderPrecios_(headers, ["cliente", "client", "client name"]);
  const idxProducto = buscarIndiceHeaderPrecios_(headers, ["producto", "product", "product name"]);
  const idxFecha = buscarIndiceHeaderPrecios_(headers, ["fecha desde", "start date", "fecha inicio", "date", "fecha"]);
  const idxPrecio = buscarIndiceHeaderPrecios_(headers, ["precio", "price", "unit price"]);

  if (idxCliente < 0 || idxProducto < 0 || idxFecha < 0 || idxPrecio < 0) {
    throw new Error("Encabezados invalidos en PRECIOS del mes anterior");
  }

  const latestByKey = {};
  values.slice(1).forEach((row, index) => {
    const cliente = limpiarTextoPrecio_(row[idxCliente]);
    const producto = limpiarTextoPrecio_(row[idxProducto]);
    const fecha = parsearFechaPrecio_(row[idxFecha]);
    const precioRaw = row[idxPrecio];
    if (precioRaw === null || precioRaw === undefined || precioRaw === "") return;
    const precio = parseNumber(precioRaw);
    if (!cliente || !producto || !fecha || !Number.isFinite(precio) || precio < 0) return;

    const key = normalizarTexto(cliente) + "|" + normalizarTexto(producto);
    const current = latestByKey[key];
    if (!current || fecha.getTime() >= current.fecha.getTime()) {
      latestByKey[key] = {
        cliente: cliente,
        producto: producto,
        fecha: fecha,
        precio: precio,
        rowNumber: index + 2
      };
    }
  });

  const targetDate = obtenerPrimerDiaMes(ss);
  const rows = Object.keys(latestByKey)
    .sort()
    .map((key) => {
      const item = latestByKey[key];
      return [item.cliente, item.producto, targetDate, item.precio];
    });

  if (!rows.length) {
    throw new Error("No se encontraron precios validos en el mes anterior");
  }

  const hojaActual = _getOrCreateSheet("PRECIOS");
  hojaActual.clear();
  hojaActual.getRange(1, 1, 1, 4).setValues([["Cliente", "Producto", "Fecha Desde", "Precio"]]);
  hojaActual.getRange(2, 1, rows.length, 4).setValues(rows);
  aplicarFormatoTablaGenerica(hojaActual, 3, [4]);

  return {
    count: rows.length,
    source: ssAnterior.getName(),
    targetDate: Utilities.formatDate(targetDate, Session.getScriptTimeZone(), "yyyy-MM-dd")
  };
}

function buscarIndiceHeaderPrecios_(headers, candidates) {
  const normalized = (headers || []).map((header) => normalizarHeaderPrecio_(header));
  for (let i = 0; i < candidates.length; i += 1) {
    const target = normalizarHeaderPrecio_(candidates[i]);
    const index = normalized.indexOf(target);
    if (index >= 0) return index;
  }
  return -1;
}

function normalizarHeaderPrecio_(value) {
  return String(value == null ? "" : value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, " ");
}

function limpiarTextoPrecio_(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function parsearFechaPrecio_(value) {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const text = String(value == null ? "" : value).trim();
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return construirFechaPrecio_(Number(match[3]), Number(match[2]), Number(match[1]));

  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    const year = Number(match[3].length === 2 ? "20" + match[3] : match[3]);
    return construirFechaPrecio_(Number(match[1]), Number(match[2]), year);
  }

  const fallback = new Date(text);
  return isNaN(fallback.getTime())
    ? null
    : new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
}

function construirFechaPrecio_(day, month, year) {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
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
