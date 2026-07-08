// ================================================================
// Formato.js - Estilos y formato de las hojas generadas
// ================================================================

const FORMATO_FUENTE_FAMILIA = 'Calibri';
const FORMATO_FUENTE_TAMANIO = 11;
const FORMATO_NUMERO = '#,##0.00';
const FORMATO_MONEDA = '$#,##0.00';
const FORMATO_FECHA = 'dd/mm/yyyy';

function aplicarFormatoEncabezado(hoja) {
  hoja.getRange(1, 1, 1, hoja.getLastColumn())
    .setBackground('#b6d7a8')
    .setFontWeight('bold')
    .setFontFamily(FORMATO_FUENTE_FAMILIA)
    .setFontSize(FORMATO_FUENTE_TAMANIO)
    .setHorizontalAlignment('center');
}

function aplicarFormatoRangoDatos(hoja, startRow, numRows, numCols, opciones = {}) {
  if (!hoja || numRows <= 0 || numCols <= 0) return;

  hoja.getRange(startRow, 1, numRows, numCols)
    .setFontFamily(FORMATO_FUENTE_FAMILIA)
    .setFontSize(FORMATO_FUENTE_TAMANIO);

  const colFecha = Number(opciones.colFecha || 0);
  const colsMoneda = Array.isArray(opciones.colsMoneda) ? opciones.colsMoneda : [];
  const colsNumero = Array.isArray(opciones.colsNumero) ? opciones.colsNumero : [];

  if (colFecha && colFecha <= numCols) hoja.getRange(startRow, colFecha, numRows).setNumberFormat(FORMATO_FECHA);
  colsNumero.forEach(c => {
    if (c >= 1 && c <= numCols) hoja.getRange(startRow, c, numRows).setNumberFormat(FORMATO_NUMERO);
  });
  colsMoneda.forEach(c => {
    if (c >= 1 && c <= numCols) hoja.getRange(startRow, c, numRows).setNumberFormat(FORMATO_MONEDA);
  });
}

function aplicarFormatoHojaPorNombre(hoja) {
  if (!hoja) return;
  const nombre = String(hoja.getName() || '').toUpperCase();
  const ultimaFila = hoja.getLastRow();
  const ultimaCol = hoja.getLastColumn();
  if (ultimaFila < 1 || ultimaCol < 1) return;

  aplicarFormatoEncabezado(hoja);
  if (ultimaFila <= 1) return;

  if (nombre === 'MOVEMENTS') return aplicarFormatoTablaGenerica(hoja, 3, [4]);
  if (nombre === 'ITEMS') return aplicarFormatoTablaGenerica(hoja, 0, [5, 6], [4]);
  if (nombre === 'SALARIES') return aplicarFormatoTablaGenerica(hoja, ultimaCol >= 4 ? 4 : 0, [3]);
  if (nombre === 'CLIENT_PAYMENTS') return aplicarFormatoTablaGenerica(hoja, 0, [3]);
  if (nombre === 'CUENTAS') return aplicarFormatoTablaGenerica(hoja, 1, [8, 9]);
  if (nombre === 'SUELDOS') return aplicarFormatoTablaGenerica(hoja, 1, [5]);
  if (nombre === 'GASTOS') return aplicarFormatoTablaGenerica(hoja, 1, [3]);
  if (nombre === 'PRECIOS') return aplicarFormatoTablaGenerica(hoja, 3, [4]);
  if (nombre === 'GRASA' || nombre === 'HUESOS') {
    const colsNumero = [];
    for (let c = 3; c <= ultimaCol; c += 1) colsNumero.push(c);
    return aplicarFormatoTablaGenerica(hoja, 0, [], colsNumero);
  }

  aplicarFormatoRangoDatos(hoja, 2, ultimaFila - 1, ultimaCol);
  hoja.getRange(1, 1, ultimaFila, ultimaCol).setBorder(true, true, true, true, true, true);
}

function aplicarFormatoTabla(hoja) {
  const ultimaFila = hoja.getLastRow();
  const ultimaCol = hoja.getLastColumn();

  aplicarFormatoEncabezado(hoja);
  if (ultimaFila <= 1) return;

  hoja.getRange(2, 1, ultimaFila - 1, ultimaCol)
    .setFontFamily(FORMATO_FUENTE_FAMILIA)
    .setFontSize(FORMATO_FUENTE_TAMANIO);

  [1, 2, 3, 4, 5].forEach(c => hoja.getRange(2, c, ultimaFila - 1).setHorizontalAlignment('center'));
  [6, 7, 8, 9, 10].forEach(c => hoja.getRange(2, c, ultimaFila - 1).setHorizontalAlignment('right'));

  hoja.getRange(2, 1, ultimaFila - 1).setNumberFormat(FORMATO_FECHA);
  [6, 8, 9, 10].forEach(c => hoja.getRange(2, c, ultimaFila - 1).setNumberFormat(FORMATO_MONEDA));
  hoja.getRange(2, 7, ultimaFila - 1).setNumberFormat(FORMATO_NUMERO);

  hoja.getRange(1, 1, ultimaFila, ultimaCol).setBorder(true, true, true, true, true, true);

  const datos = hoja.getRange(2, 1, ultimaFila - 1, 10).getValues();
  datos.forEach((fila, i) => {
    if (fila[2] === "TOTAL KG") {
      hoja.getRange(i + 2, 1, 1, 10).setBackground("#d9ead3").setFontWeight("bold");
    }
  });
}

function aplicarFormatoTablaGenerica(hoja, colFecha = 0, colsMoneda = [], colsNumero = []) {
  const ultimaFila = hoja.getLastRow();
  const ultimaCol = hoja.getLastColumn();

  aplicarFormatoEncabezado(hoja);
  if (ultimaFila <= 1) return;

  aplicarFormatoRangoDatos(hoja, 2, ultimaFila - 1, ultimaCol, {
    colFecha,
    colsMoneda,
    colsNumero
  });
  hoja.getRange(1, 1, ultimaFila, ultimaCol).setBorder(true, true, true, true, true, true);
}

function aplicarFormatoTablaSueldos(hoja) {
  const ultimaFila = hoja.getLastRow();

  aplicarFormatoEncabezado(hoja);
  if (ultimaFila <= 1) return;

  hoja.getRange(2, 1, ultimaFila - 1, 4)
    .setFontFamily(FORMATO_FUENTE_FAMILIA)
    .setFontSize(FORMATO_FUENTE_TAMANIO);
  hoja.getRange(2, 1, ultimaFila - 1).setHorizontalAlignment('center');
  hoja.getRange(2, 4, ultimaFila - 1).setHorizontalAlignment('right');
  hoja.getRange(2, 1, ultimaFila - 1).setNumberFormat(FORMATO_FECHA);
  hoja.getRange(2, 4, ultimaFila - 1).setNumberFormat(FORMATO_MONEDA);
  hoja.getRange(1, 1, ultimaFila, 4).setBorder(true, true, true, true, true, true);

  const FILAS_RESALTADAS = ["TOTAL SUELDO", "TOTAL SALDO / ADELANTOS / OTROS", "SALDO FINAL"];
  const datos = hoja.getRange(2, 1, ultimaFila - 1, 4).getValues();
  datos.forEach((fila, i) => {
    if (FILAS_RESALTADAS.includes(fila[2])) {
      hoja.getRange(i + 2, 1, 1, 4).setBackground("#d9ead3").setFontWeight("bold");
    }
  });
}
