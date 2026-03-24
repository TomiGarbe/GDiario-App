const TZ_AR = "America/Argentina/Buenos_Aires";

const CLIENTES_ESPECIALES = Object.freeze([
  "BUENOS DIAS",
  "CORDIEZ",
  "MARIANO",
  "SCURTI",
  "AMANECER",
  "OVIEDO",
  "ALMACOR 35"
]);

const CLIENTES_EXCLUIDOS_PRECIO_CERO = CLIENTES_ESPECIALES;

const CLIENTES_NO_MOSTRAR_SELECTOR = Object.freeze([
  "NICO",
  "MARCOS",
  "REFINERIA"
]);

const AYUDANTES_SUELDOS = Object.freeze([
  "Tomas",
  "Kevin"
]);

function normalizarCliente(cliente) {
  return String(cliente || "").trim().toUpperCase();
}

function parseFecha(fechaStr) {
  if (fechaStr instanceof Date) {
    const y = fechaStr.getFullYear();
    const m = String(fechaStr.getMonth() + 1).padStart(2, "0");
    const d = String(fechaStr.getDate()).padStart(2, "0");
    return new Date(`${y}-${m}-${d}T12:00:00`);
  }

  const raw = String(fechaStr || "").trim();
  if (!raw) throw new Error("Fecha inválida");

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T12:00:00`);
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const partes = raw.split("/");
    const iso = `${partes[2]}-${partes[1]}-${partes[0]}`;
    return new Date(`${iso}T12:00:00`);
  }

  const fallback = new Date(raw);
  if (isNaN(fallback.getTime())) throw new Error(`Fecha inválida: ${raw}`);
  return parseFecha(fallback);
}

function formatFecha(fecha) {
  return Utilities.formatDate(parseFecha(fecha), TZ_AR, "dd/MM/yyyy");
}

function hoyArgentinaISO() {
  return Utilities.formatDate(new Date(), TZ_AR, "yyyy-MM-dd");
}

function mismaFecha(a, b) {
  try {
    return formatFecha(a) === formatFecha(b);
  } catch (e) {
    return false;
  }
}
