// ================================================================
// Formato.js — Estilos y formato de las hojas generadas
// ================================================================

function aplicarFormatoEncabezado(hoja) {
  hoja.getRange(1, 1, 1, hoja.getLastColumn())
    .setBackground('#b6d7a8')
    .setFontWeight('bold')
    .setFontFamily('Calibri')
    .setFontSize(11)
    .setHorizontalAlignment('center');
}

function aplicarFormatoTabla(hoja) {
  const ultimaFila = hoja.getLastRow();
  const ultimaCol  = hoja.getLastColumn();

  aplicarFormatoEncabezado(hoja);
  if (ultimaFila <= 1) return;

  hoja.getRange(2, 1, ultimaFila - 1, ultimaCol)
    .setFontFamily('Calibri')
    .setFontSize(11);

  // Alineación
  [1, 2, 3, 4, 5].forEach(c => hoja.getRange(2, c, ultimaFila - 1).setHorizontalAlignment('center'));
  [6, 7, 8, 9, 10].forEach(c => hoja.getRange(2, c, ultimaFila - 1).setHorizontalAlignment('right'));

  // Formatos numéricos
  hoja.getRange(2, 1, ultimaFila - 1).setNumberFormat('dd/mm/yyyy');
  [6, 8, 9, 10].forEach(c => hoja.getRange(2, c, ultimaFila - 1).setNumberFormat('$#,##0.00'));
  hoja.getRange(2, 7, ultimaFila - 1).setNumberFormat('#,##0.00');

  hoja.getRange(1, 1, ultimaFila, ultimaCol).setBorder(true, true, true, true, true, true);

  // Resaltar filas de TOTAL KG
  const datos = hoja.getRange(2, 1, ultimaFila - 1, 10).getValues();
  datos.forEach((fila, i) => {
    if (fila[2] === "TOTAL KG") {
      hoja.getRange(i + 2, 1, 1, 10).setBackground("#d9ead3").setFontWeight("bold");
    }
  });
}

function aplicarFormatoTablaGenerica(hoja, colFecha = 0, colsMoneda = []) {
  const ultimaFila = hoja.getLastRow();
  const ultimaCol  = hoja.getLastColumn();

  aplicarFormatoEncabezado(hoja);
  if (ultimaFila <= 1) return;

  hoja.getRange(2, 1, ultimaFila - 1, ultimaCol).setFontFamily('Calibri').setFontSize(11);
  hoja.getRange(1, 1, ultimaFila, ultimaCol).setBorder(true, true, true, true, true, true);

  if (colFecha) hoja.getRange(2, colFecha, ultimaFila - 1).setNumberFormat('dd/mm/yyyy');
  colsMoneda.forEach(c => hoja.getRange(2, c, ultimaFila - 1).setNumberFormat('$#,##0.00'));
}

function aplicarFormatoTablaSueldos(hoja) {
  const ultimaFila = hoja.getLastRow();

  aplicarFormatoEncabezado(hoja);
  if (ultimaFila <= 1) return;

  hoja.getRange(2, 1, ultimaFila - 1, 4).setFontFamily('Calibri').setFontSize(11);
  hoja.getRange(2, 1, ultimaFila - 1).setHorizontalAlignment('center');
  hoja.getRange(2, 4, ultimaFila - 1).setHorizontalAlignment('right');
  hoja.getRange(2, 1, ultimaFila - 1).setNumberFormat('dd/mm/yyyy');
  hoja.getRange(2, 4, ultimaFila - 1).setNumberFormat('$#,##0.00');
  hoja.getRange(1, 1, ultimaFila, 4).setBorder(true, true, true, true, true, true);

  // Resaltar filas de totales
  const FILAS_RESALTADAS = ["SALDO INICIAL", "TOTAL SUELDO", "TOTAL ADELANTOS", "SALDO FINAL"];
  const datos = hoja.getRange(2, 1, ultimaFila - 1, 4).getValues();
  datos.forEach((fila, i) => {
    if (FILAS_RESALTADAS.includes(fila[2])) {
      hoja.getRange(i + 2, 1, 1, 4).setBackground("#d9ead3").setFontWeight("bold");
    }
  });
}
