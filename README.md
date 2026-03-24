# Registro Diario App

Aplicación web mobile-first para registrar movimientos diarios, gastos y saldo, con autenticación Google y backend en Google Apps Script usando Google Sheets como base de datos.

## Qué hace la app

- Registrar movimientos del día:
  - Compra
  - Descarga
  - Pago a cliente
- Registrar gastos:
  - Tipos predefinidos y "Otro"
  - Modo ayudantes con varios empleados
- Gestionar saldo:
  - Ver saldo actual
  - Ver movimientos por fecha
  - Editar y eliminar movimientos
  - Selección múltiple (eliminar y edición masiva de fecha)
- Mostrar notificaciones tipo toast y loaders por sección.

## Stack técnico

- Frontend:
  - HTML/CSS
  - JavaScript vanilla
- Backend:
  - Google Apps Script (Web App)
- Base de datos:
  - Google Sheets
- Auth:
  - Google Identity Services + validación de usuarios permitidos en backend

## Estructura del proyecto

- `frontend/`
  - `index.html`: layout principal (Auth gate, secciones Movimientos/Gastos/Saldo)
  - `css/styles.css`: estilos globales y mobile-first
  - `js/`
    - `auth.js`: login/logout y gate de autenticación
    - `api.js`: cliente HTTP hacia Apps Script
    - `ui.js`: inicialización de app, navegación entre secciones
    - `movimientos.js`: lógica de alta de movimientos
    - `gastos.js`: lógica de alta de gastos
    - `saldo.js`: vista de saldo y gestión de movimientos existentes
    - `clientes.js`: carga inicial de datos (`getInitialData`) y cache local
    - `clienteSelector.js`: selectores custom (clientes/productos)
    - `utils.js`: helpers comunes, toast y loaders
- `backend/`
  - `main.js`: router de acciones (`doPost`)
  - `auth.js`: login con Google y emisión/validación de tokens
  - `movimientos.js`: CRUD y reconstrucción de saldo
  - `caja.js`: operaciones de saldo y consulta diaria
  - `gastos.js`: registro de gastos
  - `precios.js`: precios por cliente/producto e inicialización (`getInitialData`)
  - `clientes.js`: clientes y clientes especiales
  - `sheets.js`, `utils.js`: utilidades de planillas y helpers

## Cómo funciona (flujo general)

1. El usuario inicia sesión con Google.
2. Frontend envía `action: "login"` al Web App de Apps Script.
3. Backend valida usuario permitido y devuelve token propio.
4. Frontend guarda token en `localStorage`.
5. Al iniciar app:
   - carga datos iniciales una sola vez con `getInitialData` (clientes, productos, precios)
   - inicializa formularios y secciones
6. Las operaciones CRUD se envían al backend con `token`.
7. Backend lee/escribe en Google Sheets y devuelve respuesta JSON.

## Acciones principales del backend (`doPost`)

- `login`
- `getInitialData`
- `obtenerSaldo`
- `obtenerMovimientos` / `obtenerMovimientosDia`
- `guardarMovimiento`
- `editarMovimiento`
- `eliminarMovimiento`
- `guardarGasto`
- `registrarEntrega`
- `registrarPagoCliente`
- `reconstruirSaldoFabian`

## Datos iniciales y rendimiento

La app precarga datos clave al inicio:

- `clientes`
- `productos`
- `precios`
- `clientesEspeciales`

Esto evita llamadas repetidas por interacción (búsqueda de cliente/producto/precio) y mejora la respuesta en móvil.

## Configuración rápida

1. Desplegar backend como Web App de Apps Script.
2. Configurar acceso del Web App para que frontend pueda consumirlo.
3. Poner la URL `/exec` en `frontend/js/api.js` (`API_URL`) o vía `window.API_URL`.
4. Definir usuarios permitidos en `backend/auth.js` (`USUARIOS_PERMITIDOS`).
5. Verificar `GOOGLE_CLIENT_ID` en `frontend/js/auth.js`.

## Notas

- La UI es mobile-first y soporta modales, inputs dinámicos y navegación inferior fija.
- El sistema usa loaders de sección (no loader global bloqueante).
- La edición masiva de fecha respeta validaciones de negocio (ej. compras en fin de semana).
