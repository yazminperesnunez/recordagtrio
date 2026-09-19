# 📅 Sistema de Gestión de Órdenes de Compra con Parcialidades y Control de Facturas Complementarias (REP)

Este proyecto derivado está diseñado específicamente para **administrar pagos en parcialidades** de Órdenes de Compra y asegurar el cumplimiento en la recepción de las facturas complementarias (**Recibos Electrónicos de Pago - REP**).

---

## 🚀 Características Principales

1. **Gestión Directa de OC y Parcialidades:**
   - Autogeneración de folio (`OC-PPD-XXXX`) o ingreso manual personalizado.
   - Selección ágil del esquema de pago: plazo acordado (2 a 12 meses) y día pactado para la transferencia (ej. día 1, 5, 10, 15, 20 o 28 de cada mes).
   - Generación y vista previa en vivo de la tabla de amortización con ajuste automático de centavos.

2. **Calendario Mensual Interactivo:**
   - Vista por mes con indicadores visuales de cuotas programadas, próximas a vencer, pagadas y alertas de factura complementaria.
   - Navegación mes a mes, botón para regresar a "Hoy" y filtros por estatus.

3. **Control y Alerta de Facturas Complementarias (REP):**
   - Registro de abono con captura de referencia bancaria y comprobante de pago.
   - Si una parcialidad se paga y termina el mes o transcurre el tiempo límite sin que el proveedor entregue el REP:
     - **Recordatorio al Usuario:** Cada **2 días**.
     - **Requerimiento al Proveedor:** Cada **semana (7 días)**.
   - Botón de **"Ejecutar Auditoría y Envío de Recordatorios"** en la barra superior para detonar el motor de notificaciones en cualquier momento.

4. **Portal de Autoservicio para Proveedores (`portal_proveedor.html`):**
   - Vista web dedicada y amigable para los proveedores con filtro automático o manual por razón social/RFC.
   - Consulta transparente de fechas programadas, montos, estatus de pago y botón para **descargar la ficha/comprobante bancario**.
   - Carga directa por parte del proveedor de la **Factura Global (PPD)** y de los **Complementos de Pago (REP)**.
   - **Sincronización Bidireccional Total:** Si el usuario sube la factura o comprobante desde el panel interno (o por fuera), el proveedor lo ve reflejado de inmediato en su portal; y si el proveedor sube su factura o REP por el portal, el usuario y la hoja de cálculo se actualizan al instante.

5. **Operación Dual:**
   - Funciona de inmediato de forma local (`localStorage`) para pruebas y uso ágil en el navegador.
   - Opcionalmente se conecta a **Google Sheets y Google Drive** desplegando el archivo `backend.gs`.

---

## 🛠️ Instalación y Configuración con Google Sheets (Opcional)

Si deseas sincronizar todo con una hoja de cálculo y guardar los comprobantes en Google Drive:

1. Crea una hoja de cálculo nueva en [Google Sheets](https://sheets.new).
2. Ve a **Extensiones > Apps Script**.
3. Reemplaza el código existente pegando el contenido íntegro de [`backend.gs`](file:///c:/Users/yazmi/Documents/nousarsgroup/version_parcialidades/backend.gs).
4. Configura las variables iniciales si lo requieres (`EMAIL_NOTIFICACIONES_ADMIN`, etc.).
5. Haz clic en **Implementar > Nueva implementación**:
   - Tipo: **Aplicación web**.
   - Ejecutar como: **Yo** (tu cuenta de Google).
   - Quién tiene acceso: **Cualquiera** (Anyone).
6. Copia la **URL de la aplicación web**.
7. En [`version_parcialidades/app.js`](file:///c:/Users/yazmi/Documents/nousarsgroup/version_parcialidades/app.js), actualiza la constante `APPS_SCRIPT_URL` con tu URL:
   ```javascript
   const APPS_SCRIPT_URL = "TU_URL_DE_APPS_SCRIPT_AQUI";
   ```
8. **Automatización Diaria (Triggers):**
   - En Apps Script, ve al menú del reloj (**Activadores / Triggers**).
   - Añade un nuevo activador para la función `ejecutarAuditoriaYEnvioRecordatoriosAutomaticos`.
   - Tipo de evento: **Según tiempo**, temporizador diario (por ejemplo entre 8:00 AM y 9:00 AM).
   - Con esto, el sistema enviará automáticamente los correos cada 2 días al usuario y cada 7 días al proveedor sin necesidad de intervención manual.

---

## 💻 Uso de las Vistas

- **Panel Interno de Compras:** Abre [`index.html`](file:///c:/Users/yazmi/Documents/nousarsgroup/version_parcialidades/index.html) en tu navegador para administrar órdenes, autorizar pagos y monitorear el calendario general.
- **Portal de Proveedores:** Abre [`portal_proveedor.html`](file:///c:/Users/yazmi/Documents/nousarsgroup/version_parcialidades/portal_proveedor.html) para compartir el enlace directo a tus proveedores.
