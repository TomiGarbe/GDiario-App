function obtenerClientes() {
  const datosPrecios = obtenerDatosPrecios(hoyArgentinaISO());

  return Object.keys(datosPrecios).filter(function(cliente) {
    return !CLIENTES_NO_MOSTRAR_SELECTOR.includes(cliente);
  });
}

function obtenerClientesEspeciales() {
  return CLIENTES_ESPECIALES.slice();
}
