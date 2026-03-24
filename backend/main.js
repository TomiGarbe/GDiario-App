function doGet() {
  return HtmlService.createHtmlOutputFromFile("index");
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Request invalido");
    }

    const data = JSON.parse(e.postData.contents);
    const action = String(data.action || data.accion || "").trim();

    if (!action) {
      throw new Error("Accion requerida");
    }

    if (action === "login") {
      return json(loginConGoogle(data.credential));
    }

    const emailAutenticado = autenticar(data);
    data.email = emailAutenticado;

    let result;

    Logger.log("Usuario autenticado: " + emailAutenticado + " | action: " + action);

    if (action === "obtenerClientes") {
      result = obtenerClientes();
    }
    else if (action === "getInitialData") {
      result = getInitialData(data.fecha || null);
    }
    else if (action === "obtenerProductosPorCliente") {
      result = obtenerProductosPorCliente(data.cliente);
    }
    else if (action === "obtenerClientesEspeciales") {
      result = obtenerClientesEspeciales();
    }
    else if (action === "obtenerPrecio") {
      result = obtenerPrecio(data.cliente, data.producto, data.fecha);
    }
    else if (action === "obtenerSaldo") {
      result = obtenerSaldo();
    }
    else if (action === "obtenerMovimientos") {
      result = obtenerMovimientosDelDia(data.fecha);
    }
    else if (action === "obtenerMovimientosDia") {
      result = obtenerMovimientosDelDia(data.fecha);
    }
    else if (action === "guardarMovimiento") {
      result = guardarMovimiento(data);
    }
    else if (action === "eliminarMovimiento") {
      if (Array.isArray(data.ids) && data.ids.length) {
        result = eliminarMovimientos(data.ids, data.fecha || null);
      } else {
        result = eliminarMovimiento(data.id, data.fecha || null);
      }
    }
    else if (action === "editarMovimiento") {
      result = editarMovimiento(data.id, data.nuevosDatos || data.data || data.movimiento || data);
    }
    else if (action === "guardarGasto") {
      result = guardarGasto(data);
    }
    else if (action === "registrarEntrega") {
      result = registrarEntrega(data);
    }
    else if (action === "registrarPagoCliente") {
      result = registrarPagoCliente(data);
    }
    else if (action === "reconstruirSaldoFabian") {
      result = reconstruirSaldoFabian(data.fecha || null);
    }
    else {
      throw new Error("Accion no soportada: " + action);
    }

    return json(result);

  } catch (err) {
    Logger.log("Error doPost: " + (err && err.message ? err.message : err));

    return json({
      ok: false,
      error: err && err.message ? err.message : "Error desconocido"
    });
  }
}
