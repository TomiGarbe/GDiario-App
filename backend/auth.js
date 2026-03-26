const USUARIOS_PERMITIDOS = Object.freeze([
  "tomigarbe2003@gmail.com",
  "cristiangarbe@gmail.com",
  "angel2018dios@gmail.com"
]);
const DEV_TOKEN = "dev-token";
const DEV_EMAIL = "dev@local";
const NOMBRE_PLANILLA_BASE = "Planilla Vacia";
const NOMBRE_HOJA_TOKENS = "TOKENS";
const CABECERA_TOKENS = Object.freeze(["Token", "Email", "Fecha Creacion"]);

let _ssBaseTokens = null;
let _hojaTokens = null;

function normalizarEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function parseJwt(token) {
  const rawToken = String(token || "").trim();
  if (!rawToken) throw new Error("Token requerido");

  const partes = rawToken.split(".");
  if (partes.length < 2) throw new Error("Token invalido");

  let base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";

  try {
    const jsonPayload = Utilities
      .newBlob(Utilities.base64Decode(base64))
      .getDataAsString();

    return JSON.parse(jsonPayload);
  } catch (e) {
    throw new Error("Token invalido");
  }
}

function validarUsuario(email) {
  const usuario = normalizarEmail(email);
  if (!usuario) return false;

  const permitidos = USUARIOS_PERMITIDOS.map(normalizarEmail);
  return permitidos.includes(usuario);
}

function obtenerPlanillaBaseTokens() {
  if (_ssBaseTokens) return _ssBaseTokens;

  const idPlanilla = String(
    PropertiesService.getScriptProperties().getProperty("ID_PLANILLA_BASE") || ""
  ).trim();

  if (idPlanilla) {
    _ssBaseTokens = SpreadsheetApp.openById(idPlanilla);
    return _ssBaseTokens;
  }

  const archivos = DriveApp.getFilesByName(NOMBRE_PLANILLA_BASE);
  if (!archivos.hasNext()) {
    throw new Error("No se encontro la planilla base: " + NOMBRE_PLANILLA_BASE);
  }

  _ssBaseTokens = SpreadsheetApp.openById(archivos.next().getId());
  return _ssBaseTokens;
}

function obtenerHojaTokens() {
  if (_hojaTokens) return _hojaTokens;

  const ss = obtenerPlanillaBaseTokens();
  let hoja = ss.getSheetByName(NOMBRE_HOJA_TOKENS);

  if (!hoja) {
    hoja = ss.insertSheet(NOMBRE_HOJA_TOKENS);
    hoja.appendRow(CABECERA_TOKENS);
  } else if (hoja.getLastRow() === 0) {
    hoja.appendRow(CABECERA_TOKENS);
  }

  _hojaTokens = hoja;
  return _hojaTokens;
}

function generarToken(email) {
  return Utilities.getUuid();
}

function guardarToken(token, email) {
  const tokenFinal = String(token || "").trim();
  const emailFinal = normalizarEmail(email);

  if (!tokenFinal || !emailFinal) {
    throw new Error("Token o email invalido");
  }

  const hoja = obtenerHojaTokens();
  hoja.appendRow([tokenFinal, emailFinal, new Date()]);
}

function validarToken(token) {
  const tokenBuscado = String(token || "").trim();
  if (!tokenBuscado) return null;

  if (tokenBuscado === DEV_TOKEN) {
    return DEV_EMAIL;
  }

  const hoja = obtenerHojaTokens();
  const lastRow = hoja.getLastRow();
  if (lastRow < 2) return null;

  const datos = hoja.getRange(2, 1, lastRow - 1, 2).getValues();

  for (let i = datos.length - 1; i >= 0; i--) {
    if (String(datos[i][0] || "").trim() === tokenBuscado) {
      const email = normalizarEmail(datos[i][1]);
      return email || null;
    }
  }

  return null;
}

function loginConGoogle(credential) {
  const cred = String(credential || "").trim();
  if (!cred) {
    throw new Error("Token requerido");
  }

  if (cred === DEV_TOKEN) {
    return { ok: true, token: DEV_TOKEN, email: DEV_EMAIL };
  }

  const payload = parseJwt(cred);
  const emailToken = normalizarEmail(payload.email);
  const emailVerificado = payload.email_verified === true || payload.email_verified === "true";

  if (!emailToken || !emailVerificado) {
    throw new Error("Login invalido");
  }

  if (payload.exp && Number(payload.exp) * 1000 < Date.now()) {
    throw new Error("Token expirado");
  }

  if (!validarUsuario(emailToken)) {
    throw new Error("Usuario no autorizado");
  }

  const token = generarToken(emailToken);
  guardarToken(token, emailToken);

  return {
    ok: true,
    token: token,
    email: emailToken
  };
}

function autenticar(data) {
  if (!data || !data.token) {
    throw new Error("No autorizado");
  }

  const email = validarToken(data.token);
  if (!email) {
    throw new Error("No autorizado");
  }

  return email;
}
