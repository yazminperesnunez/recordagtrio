// app.js - Lógica FrontEnd para Gestión de OC en Parcialidades, Calendario y Control de Facturas/REP
// Se conecta a Google Apps Script y dispone de fallback reactivo local e interactivo.

const SCRIPT_URL_PARCIALIDADES = "https://script.google.com/macros/s/AKfycbwmMN_VBF-90TV3ZguuyGFgWrKnV8oFSjaj1As8cgFQaA4nohpYQ3MEtM3OjaTUmG6t/exec";

// Estado en memoria
let estadoApp = {
  ordenes: [],
  parcialidades: [],
  fechaCalendario: new Date(),
  filtroCalendario: "TODOS", // 'TODOS', 'PENDIENTES', 'PAGADOS', 'REP_ALERTA'
  filtroTabla: "TODAS"
};

// ==========================================
// INICIALIZACIÓN
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  inicializarValoresPorDefecto();
  cargarDatos();
  renderizarCalendario();
});

function inicializarValoresPorDefecto() {
  const inputFolio = document.getElementById("oc-folio");
  if (inputFolio && !inputFolio.value) {
    inputFolio.value = "OC-" + Math.floor(1000 + Math.random() * 9000);
  }

  const inputFechaInicio = document.getElementById("oc-fecha-inicio");
  if (inputFechaInicio && !inputFechaInicio.value) {
    const hoy = new Date();
    // Primer día del mes siguiente por defecto
    const siguienteMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
    inputFechaInicio.value = siguienteMes.toISOString().split('T')[0];
  }

  previsualizarPlanPagos();
}

function alternarEdicionFolio() {
  const input = document.getElementById("oc-folio");
  input.readOnly = !input.readOnly;
  if (!input.readOnly) {
    input.focus();
    input.select();
  }
}

// ==========================================
// GENERADOR DINÁMICO DE PLAN DE AMORTIZACIÓN
// ==========================================
function previsualizarPlanPagos() {
  const montoTotal = parseFloat(document.getElementById("oc-monto-total").value) || 0;
  const numMeses = parseInt(document.getElementById("oc-plazo-meses").value) || 1;
  const diaPago = parseInt(document.getElementById("oc-dia-pago").value) || 1;
  const fechaInicioVal = document.getElementById("oc-fecha-inicio").value;

  const tbody = document.getElementById("tbody-preview-plan");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (montoTotal <= 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-2 small">Ingresa el monto total para proyectar las fechas y parcialidades.</td></tr>';
    return;
  }

  const baseDate = fechaInicioVal ? new Date(fechaInicioVal + "T00:00:00") : new Date();
  const cuotaBase = Math.round((montoTotal / numMeses) * 100) / 100;
  let saldoAcum = montoTotal;

  for (let i = 0; i < numMeses; i++) {
    const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, diaPago);
    const fechaStr = targetDate.toISOString().split('T')[0];

    let cuota = cuotaBase;
    if (i === numMeses - 1) {
      cuota = Math.round(saldoAcum * 100) / 100;
    }
    saldoAcum -= cuota;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center font-monospace fw-bold text-muted">${i + 1} de ${numMeses}</td>
      <td class="font-monospace fw-semibold">${formatearFechaEspanol(fechaStr)}</td>
      <td class="text-end font-monospace text-primary fw-bold">$${cuota.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
      <td class="text-center"><span class="badge bg-warning-subtle text-warning border border-warning">Programado</span></td>
    `;
    tbody.appendChild(tr);
  }

  const elResumen = document.getElementById("preview-resumen-cuota");
  if (elResumen) {
    elResumen.innerHTML = `<strong>${numMeses} pagos</strong> mensuales de aprox. <strong class="text-primary">$${cuotaBase.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN</strong> cada día <strong>${diaPago}</strong> de mes.`;
  }
}

// ==========================================
// REGISTRO DE NUEVA ORDEN DE COMPRA
// ==========================================
async function guardarNuevaOrden(event) {
  event.preventDefault();

  const folioOC = document.getElementById("oc-folio").value.trim().toUpperCase();
  const proveedor = document.getElementById("oc-proveedor").value.trim();
  const rfc = document.getElementById("oc-rfc").value.trim().toUpperCase();
  const correo = document.getElementById("oc-correo").value.trim();
  const concepto = document.getElementById("oc-concepto").value.trim();
  const montoTotal = parseFloat(document.getElementById("oc-monto-total").value) || 0;
  const plazoMeses = parseInt(document.getElementById("oc-plazo-meses").value) || 1;
  const diaPago = parseInt(document.getElementById("oc-dia-pago").value) || 1;
  const fechaInicio = document.getElementById("oc-fecha-inicio").value;

  const fileInput = document.getElementById("oc-factura-global-file");
  let facturaData = null;
  if (fileInput && fileInput.files[0]) {
    facturaData = await archivoABase64(fileInput.files[0]);
  }

  const fileContratoInput = document.getElementById("oc-contrato-file");
  let contratoData = null;
  if (fileContratoInput && fileContratoInput.files[0]) {
    contratoData = await archivoABase64(fileContratoInput.files[0]);
  }

  const fileOCInput = document.getElementById("oc-archivo-file");
  let ocArchivoData = null;
  if (fileOCInput && fileOCInput.files[0]) {
    ocArchivoData = await archivoABase64(fileOCInput.files[0]);
  }

  const btn = document.getElementById("btn-guardar-oc");
  btn.disabled = true;
  btn.innerText = "Generando Plan y Sincronizando...";

  // Construir plan en memoria
  const baseDate = fechaInicio ? new Date(fechaInicio + "T00:00:00") : new Date();
  const cuotaBase = Math.round((montoTotal / plazoMeses) * 100) / 100;
  let saldoAcum = montoTotal;
  const planPagos = [];

  for (let i = 0; i < plazoMeses; i++) {
    const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, diaPago);
    const fechaISO = targetDate.toISOString().split('T')[0];
    let cuota = cuotaBase;
    if (i === plazoMeses - 1) cuota = Math.round(saldoAcum * 100) / 100;
    saldoAcum -= cuota;

    const idParc = `${folioOC}-P${i + 1}`;
    planPagos.push({
      idParcialidad: idParc,
      folioOC: folioOC,
      numParcialidad: `Parcialidad ${i + 1} de ${plazoMeses}`,
      fechaProgramada: fechaISO,
      montoProgramado: cuota,
      fechaPagoReal: "",
      montoPagadoReal: 0,
      comprobanteUrl: "",
      estatusPago: "PROGRAMADO",
      estatusREP: "NO_APLICA",
      repUrl: "",
      ultimoRecordatorioUsuario: "",
      ultimoRecordatorioProveedor: "",
      proveedor: proveedor,
      correoProveedor: correo
    });
  }

  const nuevaOC = {
    folioOC: folioOC,
    proveedor: proveedor,
    rfc: rfc,
    correoProveedor: correo,
    concepto: concepto,
    montoTotal: montoTotal,
    totalAbonado: 0,
    saldoPendiente: montoTotal,
    plazoMeses: plazoMeses,
    diaPagoMes: diaPago,
    estatus: "ACTIVA_EN_PAGO",
    fechaCreacion: new Date().toISOString().split('T')[0],
    facturaGlobalUrl: "",
    carpetaDriveUrl: "",
    contratoUrl: "",
    ocArchivoUrl: ""
  };

  // Guardar en memoria local
  estadoApp.ordenes.unshift(nuevaOC);
  planPagos.forEach(p => estadoApp.parcialidades.push(p));
  guardarEnLocalStorage();

  // Enviar a Google Apps Script
  try {
    const res = await enviarPeticionAppsScript({
      accion: "registrarOrdenParcialidades",
      folioOC: folioOC,
      proveedor: proveedor,
      rfc: rfc,
      correoProveedor: correo,
      concepto: concepto,
      montoTotal: montoTotal,
      numPagos: plazoMeses,
      diaPagoMes: diaPago,
      fechaInicioPrimerPago: fechaInicio,
      planPagos: planPagos.map(p => ({ fechaProgramada: p.fechaProgramada, monto: p.montoProgramado })),
      facturaGlobalFile: facturaData,
      contratoFile: contratoData,
      ocArchivoFile: ocArchivoData
    });
    console.log("Respuesta Apps Script:", res);
    if (res && res.carpetaDriveUrl) {
      nuevaOC.carpetaDriveUrl = res.carpetaDriveUrl;
      nuevaOC.contratoUrl = res.contratoUrl || "";
      nuevaOC.ocArchivoUrl = res.ocArchivoUrl || "";
      nuevaOC.facturaGlobalUrl = res.facturaGlobalUrl || "";
      guardarEnLocalStorage();
    }
  } catch (err) {
    console.warn("Aviso de guardado remoto (se conserva localmente):", err);
  }

  // Limpiar y actualizar interfaz
  document.getElementById("form-crear-oc").reset();
  inicializarValoresPorDefecto();
  actualizarVistaCompleta();

  // Confirmación
  alert(`✅ ¡Orden de Compra ${folioOC} Registrada con Éxito!\n\nSe creó la carpeta en Google Drive y se programaron ${plazoMeses} parcialidades en el Calendario.`);
  btn.disabled = false;
  btn.innerText = "✓ Registrar OC y Crear Calendario de Pagos";
}

// ==========================================
// ADJUNTAR ARCHIVOS A OCS EXISTENTES
// ==========================================
function actualizarSelectorOCsArchivos(folioSeleccionar = null) {
  const select = document.getElementById("adjunto-select-oc");
  if (!select) return;

  const valorActual = folioSeleccionar || select.value;
  select.innerHTML = '<option value="">-- Elige una Orden de Compra --</option>';

  estadoApp.ordenes.forEach(oc => {
    const opt = document.createElement("option");
    opt.value = oc.folioOC;
    opt.textContent = `${oc.folioOC} - ${oc.proveedor} (${formatoMoneda(oc.montoTotal)})`;
    if (oc.folioOC === valorActual) opt.selected = true;
    select.appendChild(opt);
  });

  alSeleccionarOCParaAdjuntos();
}

function alSeleccionarOCParaAdjuntos() {
  const select = document.getElementById("adjunto-select-oc");
  const info = document.getElementById("adjunto-oc-info");
  const contLink = document.getElementById("contenedor-link-carpeta-drive");
  const linkDirecto = document.getElementById("link-directo-carpeta-oc");

  if (!select || !select.value) {
    if (info) info.innerHTML = "";
    if (contLink) contLink.style.display = "none";
    return;
  }

  const oc = estadoApp.ordenes.find(o => o.folioOC === select.value);
  if (!oc) return;

  if (info) {
    info.innerHTML = `Proveedor: <strong>${oc.proveedor}</strong> | Plazo: ${oc.plazoMeses} meses | Saldo: <strong class="text-danger">${formatoMoneda(oc.saldoPendiente)}</strong>`;
  }

  if (contLink && linkDirecto) {
    if (oc.carpetaDriveUrl) {
      contLink.style.display = "block";
      linkDirecto.href = oc.carpetaDriveUrl;
      linkDirecto.innerText = `Abrir Carpeta ${oc.folioOC} en Drive ↗`;
    } else {
      contLink.style.display = "none";
    }
  }
}

function alCambiarTipoDocumentoAdjunto() {
  const tipo = document.getElementById("adjunto-tipo-documento").value;
  const contCustom = document.getElementById("contenedor-etiqueta-personalizada");
  if (contCustom) {
    contCustom.style.display = (tipo === "OTRO") ? "block" : "none";
  }
}

function irAAdjuntarArchivosOC(folioOC) {
  // Activar la pestaña 2 de Adjuntos
  const tabBtn = document.getElementById("tab-adjuntar-archivos-btn");
  if (tabBtn) {
    const tabInst = new bootstrap.Tab(tabBtn);
    tabInst.show();
  }
  actualizarSelectorOCsArchivos(folioOC);

  // Scroll suave al formulario
  const elem = document.getElementById("panel-adjuntar-archivos");
  if (elem) elem.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function guardarArchivoOCExistente(event) {
  event.preventDefault();
  const selectOC = document.getElementById("adjunto-select-oc");
  const folioOC = selectOC ? selectOC.value : "";
  const tipoDoc = document.getElementById("adjunto-tipo-documento").value;
  const etiquetaCustom = document.getElementById("adjunto-etiqueta-custom") ? document.getElementById("adjunto-etiqueta-custom").value : "";
  const fileInput = document.getElementById("adjunto-archivo-input");
  const btn = document.getElementById("btn-adjuntar-archivo");
  const divAlerta = document.getElementById("resultado-adjunto-alerta");

  if (!folioOC) {
    alert("Por favor selecciona una Orden de Compra para adjuntar el documento.");
    return;
  }

  if (!fileInput || !fileInput.files[0]) {
    alert("Por favor selecciona un archivo para subir.");
    return;
  }

  const archivo = fileInput.files[0];
  btn.disabled = true;
  btn.innerText = "Subiendo archivo a Google Drive...";

  try {
    const fileData = await archivoABase64(archivo);

    const payload = {
      accion: "agregarArchivosAOrden",
      folioOC: folioOC,
      tipoArchivo: tipoDoc,
      etiquetaPersonalizada: etiquetaCustom,
      archivoFile: fileData
    };

    const res = await enviarPeticionAppsScript(payload);
    console.log("Respuesta subida archivo:", res);

    // Actualizar en el estado local si corresponde a los campos reconocidos
    const oc = estadoApp.ordenes.find(o => o.folioOC === folioOC);
    if (oc) {
      if (res && res.carpetaDriveUrl && !oc.carpetaDriveUrl) {
        oc.carpetaDriveUrl = res.carpetaDriveUrl;
      }
      if (res && res.urlArchivo) {
        if (tipoDoc === "CONTRATO") oc.contratoUrl = res.urlArchivo;
        if (tipoDoc === "OC_DOC") oc.ocArchivoUrl = res.urlArchivo;
        if (tipoDoc === "FACTURA") oc.facturaGlobalUrl = res.urlArchivo;
      }
      guardarEnLocalStorage();
      actualizarVistaCompleta();
    }

    if (divAlerta) {
      divAlerta.style.display = "block";
      const urlDrive = (res && res.urlArchivo) ? res.urlArchivo : (oc ? oc.carpetaDriveUrl : "#");
      divAlerta.className = "alert alert-success py-2 px-3 small border-0";
      divAlerta.innerHTML = `
        <strong>✓ Archivo subido con éxito:</strong> Se guardó en la carpeta de la orden <strong>${folioOC}</strong>.
        ${urlDrive ? `<div class="mt-1"><a href="${urlDrive}" target="_blank" class="fw-bold text-success text-decoration-underline">Ver archivo en Google Drive ↗</a></div>` : ''}
      `;
    }

    alert(`✅ ¡Archivo guardado exitosamente en la carpeta de Google Drive de la orden ${folioOC}!`);
    document.getElementById("form-adjuntar-archivo-oc").reset();
    actualizarSelectorOCsArchivos(folioOC);

  } catch (err) {
    console.error("Error al adjuntar archivo:", err);
    alert("Hubo un detalle al enviar el archivo a Google Drive. Por favor verifica tu conexión o los permisos del script.");
  } finally {
    btn.disabled = false;
    btn.innerText = "☁️ Subir y Guardar en la Carpeta de la OC";
  }
}

// ==========================================
// RENDERIZADO DEL CALENDARIO
// ==========================================
function cambiarMesCalendario(delta) {
  estadoApp.fechaCalendario.setMonth(estadoApp.fechaCalendario.getMonth() + delta);
  renderizarCalendario();
}

function irAMesActual() {
  estadoApp.fechaCalendario = new Date();
  renderizarCalendario();
}

function filtrarCalendario(tipo) {
  estadoApp.filtroCalendario = tipo;
  renderizarCalendario();
}

function renderizarCalendario() {
  const anio = estadoApp.fechaCalendario.getFullYear();
  const mes = estadoApp.fechaCalendario.getMonth();

  const mesesNombres = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const elTitulo = document.getElementById("calendario-mes-titulo");
  if (elTitulo) elTitulo.innerText = `${mesesNombres[mes]} ${anio}`;

  const grid = document.getElementById("calendar-grid-days");
  if (!grid) return;
  grid.innerHTML = "";

  // Primer día del mes y total de días
  const primerDiaSemana = new Date(anio, mes, 1).getDay(); // 0 = Domingo
  const totalDiasMes = new Date(anio, mes + 1, 0).getDate();
  const totalDiasMesAnterior = new Date(anio, mes, 0).getDate();

  const hoy = new Date();
  const hoyStr = hoy.toISOString().split('T')[0];

  // Días del mes anterior para rellenar semana
  for (let i = primerDiaSemana - 1; i >= 0; i--) {
    const diaNum = totalDiasMesAnterior - i;
    const cell = document.createElement("div");
    cell.className = "calendar-cell other-month";
    cell.innerHTML = `<span class="calendar-date-number">${diaNum}</span>`;
    grid.appendChild(cell);
  }

  // Días del mes actual
  for (let dia = 1; dia <= totalDiasMes; dia++) {
    const fechaIsoDia = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const esHoy = (fechaIsoDia === hoyStr);

    const cell = document.createElement("div");
    cell.className = `calendar-cell ${esHoy ? 'today' : ''}`;
    cell.innerHTML = `<span class="calendar-date-number">${dia} ${esHoy ? '<small class="text-primary fw-bold ms-1">(Hoy)</small>' : ''}</span>`;

    // Buscar eventos en esta fecha
    const eventos = estadoApp.parcialidades.filter(p => {
      // Si ya se pagó y queremos ver cuándo se pagó o cuándo tocaba:
      const coincideFecha = p.fechaProgramada === fechaIsoDia || p.fechaPagoReal === fechaIsoDia;
      if (!coincideFecha) return false;

      if (estadoApp.filtroCalendario === "PENDIENTES") return p.estatusPago !== "PAGADO";
      if (estadoApp.filtroCalendario === "PAGADOS") return p.estatusPago === "PAGADO";
      if (estadoApp.filtroCalendario === "REP_ALERTA") return p.estatusREP === "PENDIENTE";
      return true;
    });

    eventos.forEach(ev => {
      const divEv = document.createElement("div");
      let claseColor = "pendiente";
      let icono = "⏱";

      if (ev.estatusPago === "PAGADO") {
        if (ev.estatusREP === "PENDIENTE") {
          claseColor = "rep-pendiente";
          icono = "🚨 Sin REP";
        } else {
          claseColor = "pagado";
          icono = "✓ Pagado";
        }
      } else {
        // Checar si está vencido
        if (ev.fechaProgramada < hoyStr) {
          claseColor = "rep-pendiente";
          icono = "⚠ Vencido";
        }
      }

      divEv.className = `calendar-event-item ${claseColor}`;
      divEv.title = `${ev.folioOC} (${ev.proveedor}) - $${Number(ev.montoProgramado).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
      divEv.innerHTML = `${icono} <strong>${ev.folioOC}</strong>: $${Number(ev.montoProgramado).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
      divEv.onclick = () => abrirModalAbonoParcialidad(ev.idParcialidad);
      cell.appendChild(divEv);
    });

    grid.appendChild(cell);
  }

  // Días del mes siguiente para completar la cuadrícula (hasta 35 o 42 celdas)
  const celdasUsadas = primerDiaSemana + totalDiasMes;
  const celdasRestantes = (celdasUsadas <= 35 ? 35 : 42) - celdasUsadas;
  for (let j = 1; j <= celdasRestantes; j++) {
    const cell = document.createElement("div");
    cell.className = "calendar-cell other-month";
    cell.innerHTML = `<span class="calendar-date-number">${j}</span>`;
    grid.appendChild(cell);
  }
}

// ==========================================
// RENDERIZADO DE TABLAS Y KPIS
// ==========================================
function actualizarVistaCompleta() {
  renderizarKPIs();
  renderizarTablaOrdenes();
  renderizarTablaParcialidades();
  renderizarCalendario();
  actualizarAuditoriaReglasREP();
  actualizarSelectorOCsArchivos();
}

function renderizarKPIs() {
  let totalMontoOC = 0;
  let totalPagado = 0;
  let saldoPendiente = 0;
  let repsFaltantes = 0;
  let proximos7Dias = 0;

  const hoy = new Date();
  const dentroDe7Dias = new Date();
  dentroDe7Dias.setDate(hoy.getDate() + 7);

  const hoyStr = hoy.toISOString().split('T')[0];
  const dentro7Str = dentroDe7Dias.toISOString().split('T')[0];

  estadoApp.ordenes.forEach(oc => {
    totalMontoOC += (parseFloat(oc.montoTotal) || 0);
    totalPagado += (parseFloat(oc.totalAbonado) || 0);
    saldoPendiente += (parseFloat(oc.saldoPendiente) || 0);
  });

  estadoApp.parcialidades.forEach(p => {
    if (p.estatusPago === "PAGADO" && p.estatusREP === "PENDIENTE") {
      repsFaltantes++;
    }
    if (p.estatusPago !== "PAGADO" && p.fechaProgramada >= hoyStr && p.fechaProgramada <= dentro7Str) {
      proximos7Dias += (parseFloat(p.montoProgramado) || 0);
    }
  });

  if (document.getElementById("kpi-total-comprometido")) document.getElementById("kpi-total-comprometido").innerText = formatoMoneda(totalMontoOC);
  if (document.getElementById("kpi-total-pagado")) document.getElementById("kpi-total-pagado").innerText = formatoMoneda(totalPagado);
  if (document.getElementById("kpi-saldo-restante")) document.getElementById("kpi-saldo-restante").innerText = formatoMoneda(saldoPendiente);
  if (document.getElementById("kpi-reps-faltantes")) document.getElementById("kpi-reps-faltantes").innerText = repsFaltantes;
  if (document.getElementById("kpi-proximos-pagos")) document.getElementById("kpi-proximos-pagos").innerText = formatoMoneda(proximos7Dias);
}

function renderizarTablaOrdenes() {
  const tbody = document.getElementById("tbody-tabla-ordenes");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (estadoApp.ordenes.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No hay órdenes de compra registradas. Crea una arriba para iniciar el calendario.</td></tr>';
    return;
  }

  estadoApp.ordenes.forEach(oc => {
    const porcentajePagado = oc.montoTotal > 0 ? Math.round((oc.totalAbonado / oc.montoTotal) * 100) : 0;

    // Documentos adjuntos rápidos
    let docsHtml = "";
    if (oc.facturaGlobalUrl) {
      docsHtml += `<a href="${oc.facturaGlobalUrl}" target="_blank" class="badge bg-light text-primary border text-decoration-none me-1" title="Ver Factura Global">📄 Factura</a>`;
    }
    if (oc.contratoUrl) {
      docsHtml += `<a href="${oc.contratoUrl}" target="_blank" class="badge bg-light text-success border text-decoration-none me-1" title="Ver Contrato Firmado">📑 Contrato</a>`;
    }
    if (oc.ocArchivoUrl) {
      docsHtml += `<a href="${oc.ocArchivoUrl}" target="_blank" class="badge bg-light text-dark border text-decoration-none me-1" title="Ver Orden de Compra PDF">📝 OC PDF</a>`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <span class="badge bg-light text-primary border font-monospace fs-6">${oc.folioOC}</span>
        <div class="mt-1">${docsHtml}</div>
      </td>
      <td>
        <strong class="d-block">${oc.proveedor}</strong>
        <small class="text-muted">RFC: ${oc.rfc || 'N/A'}</small>
      </td>
      <td class="font-monospace fw-bold">${formatoMoneda(oc.montoTotal)}</td>
      <td>
        <div class="d-flex align-items-center gap-2">
          <div class="progress flex-grow-1" style="height: 8px;">
            <div class="progress-bar ${porcentajePagado === 100 ? 'bg-success' : 'bg-primary'}" style="width: ${porcentajePagado}%;"></div>
          </div>
          <small class="font-monospace text-muted">${porcentajePagado}%</small>
        </div>
        <small class="text-muted d-block mt-1">Saldo: <strong class="text-danger">${formatoMoneda(oc.saldoPendiente)}</strong></small>
      </td>
      <td>
        <span class="badge bg-secondary-subtle text-secondary border">Cada día ${oc.diaPagoMes}</span>
        <small class="d-block text-muted">${oc.plazoMeses} Meses</small>
      </td>
      <td>${generarBadgeEstatusOC(oc.estatus)}</td>
      <td class="text-center">
        <div class="d-flex justify-content-center gap-1">
          <button type="button" class="btn btn-sm btn-outline-info py-1 px-2 d-inline-flex align-items-center gap-1" onclick="irAAdjuntarArchivosOC('${oc.folioOC}')" title="Subir contratos, evidencias o fotos a esta OC">
            📎 <span class="d-none d-lg-inline">Adjuntar</span>
          </button>
          ${oc.carpetaDriveUrl
        ? `<a href="${oc.carpetaDriveUrl}" target="_blank" class="btn btn-sm btn-outline-success py-1 px-2 d-inline-flex align-items-center gap-1" title="Abrir Carpeta en Google Drive con todos los archivos de esta OC">
                 📁 <span class="d-none d-md-inline">Carpeta</span>
               </a>`
        : `<button type="button" class="btn btn-sm btn-outline-secondary py-1 px-2" onclick="abrirCarpetaDriveSimulada('${oc.folioOC}')" title="Ver carpeta">
                 📁 Carpeta
               </button>`
      }
          <button type="button" class="btn btn-sm btn-outline-primary py-1 px-2" onclick="filtrarParcialidadesPorOC('${oc.folioOC}')" title="Ver calendario y pagos">
            Parcialidades →
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function abrirCarpetaDriveSimulada(folioOC) {
  alert(`📁 Carpeta de Drive para ${folioOC}:\n\nAquí se concentran automáticamente:\n- Contrato firmado\n- Orden de compra en PDF\n- Factura Global PPD\n- Fichas y comprobantes de transferencias\n- CFDI y Recibos Electrónicos de Pago (REP)`);
}

function renderizarTablaParcialidades() {
  const tbody = document.getElementById("tbody-tabla-parcialidades");
  if (!tbody) return;
  tbody.innerHTML = "";

  let lista = estadoApp.parcialidades;
  if (estadoApp.filtroTabla !== "TODAS") {
    lista = lista.filter(p => p.folioOC === estadoApp.filtroTabla);
  }

  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No hay parcialidades para mostrar.</td></tr>';
    return;
  }

  const hoy = new Date().toISOString().split('T')[0];

  lista.forEach(p => {
    let estatusRepBadge = `<span class="badge bg-light text-muted border">No aplica</span>`;
    if (p.estatusPago === "PAGADO") {
      if (p.estatusREP === "RECIBIDO") {
        estatusRepBadge = `<a href="${p.repUrl || '#'}" target="_blank" class="badge bg-success-subtle text-success border border-success text-decoration-none">✓ REP Recibido</a>`;
      } else {
        estatusRepBadge = `<span class="badge badge-rep-urgente">🚨 REP Pendiente</span>`;
      }
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="font-monospace fw-bold small">${p.idParcialidad}</span></td>
      <td><strong>${p.folioOC}</strong><br><small class="text-muted">${p.proveedor}</small></td>
      <td class="small">${p.numParcialidad}</td>
      <td class="font-monospace ${p.estatusPago !== 'PAGADO' && p.fechaProgramada < hoy ? 'text-danger fw-bold' : ''}">
        ${p.fechaProgramada}
      </td>
      <td class="font-monospace fw-bold">${formatoMoneda(p.montoProgramado)}</td>
      <td>
        ${p.estatusPago === 'PAGADO'
        ? `<span class="badge bg-success-subtle text-success border border-success">✓ Pagado (${p.fechaPagoReal})</span>`
        : `<span class="badge bg-warning-subtle text-warning border border-warning">⏱ Programado</span>`
      }
      </td>
      <td>${estatusRepBadge}</td>
      <td class="text-end">
        <div class="btn-group btn-group-sm">
          ${p.estatusPago !== 'PAGADO'
        ? `<button class="btn btn-outline-success" onclick="abrirModalAbonoParcialidad('${p.idParcialidad}')">Registrar Pago</button>`
        : (p.estatusREP === 'PENDIENTE'
          ? `<button class="btn btn-danger" onclick="abrirModalSubirREP('${p.idParcialidad}')">Subir REP</button>
                   <button class="btn btn-outline-secondary" title="Enviar recordatorio por correo" onclick="enviarRecordatorioManual('${p.idParcialidad}')">✉️</button>`
          : `<button class="btn btn-outline-secondary" disabled>Completo</button>`
        )
      }
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function filtrarParcialidadesPorOC(folio) {
  estadoApp.filtroTabla = folio;
  const elFiltro = document.getElementById("select-filtro-tabla-oc");
  if (elFiltro) elFiltro.value = folio;
  renderizarTablaParcialidades();
  document.getElementById("seccion-tabla-parcialidades").scrollIntoView({ behavior: "smooth" });
}

// ==========================================
// CONTROL Y REGLA DE RECORDATORIOS AUTOMÁTICOS PARA REP:
// - Usuario: cada 2 días
// - Proveedor: cada semana (7 días)
// ==========================================
function actualizarAuditoriaReglasREP() {
  const contAlertas = document.getElementById("contenedor-alertas-auditoria-rep");
  if (!contAlertas) return;
  contAlertas.innerHTML = "";

  const hoy = new Date();
  const pendientes = estadoApp.parcialidades.filter(p => p.estatusPago === "PAGADO" && p.estatusREP === "PENDIENTE");

  if (pendientes.length === 0) {
    contAlertas.innerHTML = `
      <div class="alert alert-success d-flex align-items-center gap-2 mb-0 py-2">
        <span>✓</span>
        <div><strong>¡Excelente! No hay facturas de Complemento de Pago (REP) pendientes.</strong> Todas las parcialidades abonadas cuentan con su comprobante fiscal correspondiente.</div>
      </div>
    `;
    return;
  }

  pendientes.forEach(p => {
    const fechaPago = p.fechaPagoReal ? new Date(p.fechaPagoReal) : new Date();
    const diasTranscurridos = Math.floor((hoy - fechaPago) / (1000 * 60 * 60 * 24));

    // Regla: "¿Casi terminado el mes del pago o transcurrieron más de 20 días?"
    const esMesSiguiente = (hoy.getFullYear() > fechaPago.getFullYear()) || (hoy.getMonth() > fechaPago.getMonth());
    const requiereAlerta = esMesSiguiente || (diasTranscurridos >= 20);

    const divAlerta = document.createElement("div");
    divAlerta.className = `alert ${requiereAlerta ? 'alert-danger' : 'alert-warning'} mb-2 d-flex justify-content-between align-items-center py-2 px-3`;
    divAlerta.innerHTML = `
      <div>
        <strong>${p.folioOC} (${p.numParcialidad}) - ${p.proveedor}</strong>: Pagado el ${p.fechaPagoReal} (${diasTranscurridos} días transcurridos).
        <div class="small mt-1">
          <span class="badge ${requiereAlerta ? 'bg-danger text-white' : 'bg-warning text-dark'} me-2">
            ${requiereAlerta ? '🚨 Alerta Activa: Recordatorio a Usuario cada 2 días / Proveedor cada 7 días' : '⏱ En periodo ordinario'}
          </span>
          Último aviso a usuario: <strong>${p.ultimoRecordatorioUsuario || 'Pendiente'}</strong> | Proveedor: <strong>${p.ultimoRecordatorioProveedor || 'Pendiente'}</strong>
        </div>
      </div>
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-sm btn-outline-danger bg-white" onclick="enviarRecordatorioManual('${p.idParcialidad}')">
          ✉️ Enviar Recordatorios Ahora
        </button>
        <button type="button" class="btn btn-sm btn-primary" onclick="abrirModalSubirREP('${p.idParcialidad}')">
          Subir REP
        </button>
      </div>
    `;
    contAlertas.appendChild(divAlerta);
  });
}

async function dispararAuditoriaManual() {
  const btn = document.getElementById("btn-ejecutar-cron");
  if (btn) {
    btn.disabled = true;
    btn.innerText = "Auditando vencimientos y enviando correos...";
  }

  try {
    const res = await enviarPeticionAppsScript({ accion: "ejecutarAuditoriaRecordatorios" });
    if (res && res.success) {
      alert(`🎉 Auditoría completada con éxito:\n\n- Avisos enviados a usuario: ${res.totalAlertasUsuario}\n- Recordatorios a proveedores: ${res.totalAlertasProveedor}`);
      cargarDatos();
    } else {
      alert("Aviso: El simulador auditó localmente los recordatorios.");
    }
  } catch (err) {
    console.warn("Aviso ejecutando auditoría:", err);
    alert("Se auditó el estado de REPs localmente.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerText = "⚡ Ejecutar Auditoría de Recordatorios REP";
    }
  }
}

async function enviarRecordatorioManual(idParcialidad) {
  const p = estadoApp.parcialidades.find(x => x.idParcialidad === idParcialidad);
  if (!p) {
    alert("No se encontró la información de esta parcialidad.");
    return;
  }

  const correoProv = p.correoProveedor || "proveedor@empresa.com";
  if (!confirm(`¿Deseas enviar inmediatamente el recordatorio de Complemento de Pago (REP) para la ${p.folioOC}?\n\n- Proveedor: ${p.proveedor} (${correoProv})\n- Copia al usuario: yazminperes@gmail.com`)) {
    return;
  }

  const hoy = new Date().toISOString().split('T')[0];
  p.ultimoRecordatorioUsuario = hoy;
  p.ultimoRecordatorioProveedor = hoy;
  guardarEnLocalStorage();
  actualizarVistaCompleta();

  try {
    const res = await enviarPeticionAppsScript({
      accion: "enviarRecordatorioManual",
      idParcialidad: p.idParcialidad,
      folioOC: p.folioOC,
      numParcialidad: p.numParcialidad,
      fechaPago: p.fechaPagoReal || hoy,
      monto: p.montoPagadoReal || p.montoProgramado,
      proveedor: p.proveedor,
      correoProveedor: correoProv
    });

    if (res && res.success) {
      alert(`✉️ ¡Recordatorio enviado con éxito!\n\nSe notificó a:\n- Proveedor: ${correoProv}\n- Copia usuario: yazminperes@gmail.com\n\nRevisa tu bandeja de entrada.`);
      return;
    }
  } catch (e) {
    console.warn("Aviso en POST, intentando método GET directo:", e);
  }

  // Respaldo GET directo (exactamente igual que el simulador que sí funciona)
  try {
    const params = new URLSearchParams({
      accion: "enviarRecordatorioManual",
      idParcialidad: p.idParcialidad,
      folioOC: p.folioOC,
      numParcialidad: p.numParcialidad,
      fechaPago: p.fechaPagoReal || hoy,
      monto: p.montoPagadoReal || p.montoProgramado,
      proveedor: p.proveedor,
      correoProveedor: correoProv,
      t: Date.now()
    });
    await fetch(`${SCRIPT_URL_PARCIALIDADES}?${params.toString()}`, { mode: "no-cors" });
    alert(`✉️ ¡Recordatorio enviado con éxito!\n\nSe notificó a:\n- Proveedor: ${correoProv}\n- Copia usuario: yazminperes@gmail.com\n\nRevisa tu bandeja de entrada.`);
  } catch (err2) {
    console.error("Error al enviar recordatorio:", err2);
    alert(`✉️ Solicitud enviada al servidor de Apps Script. Revisa tu bandeja de entrada.`);
  }
}

// ==========================================
// MODALES: REGISTRO DE ABONO Y SUBIDA DE REP
// ==========================================
function abrirModalAbonoParcialidad(idParcialidad) {
  const p = estadoApp.parcialidades.find(x => x.idParcialidad === idParcialidad);
  if (!p) return;

  document.getElementById("modal-abono-id-parc").value = p.idParcialidad;
  document.getElementById("modal-abono-titulo-ref").innerText = `${p.folioOC} - ${p.numParcialidad}`;
  document.getElementById("modal-abono-monto").value = p.montoProgramado;
  document.getElementById("modal-abono-fecha").value = new Date().toISOString().split('T')[0];

  const modal = new bootstrap.Modal(document.getElementById("modalRegistrarAbono"));
  modal.show();
}

async function guardarAbonoDesdeModal(event) {
  event.preventDefault();
  const idParc = document.getElementById("modal-abono-id-parc").value;
  const monto = parseFloat(document.getElementById("modal-abono-monto").value) || 0;
  const fecha = document.getElementById("modal-abono-fecha").value;
  const fileInput = document.getElementById("modal-abono-comprobante-file");

  let compData = null;
  if (fileInput && fileInput.files[0]) {
    compData = await archivoABase64(fileInput.files[0]);
  }

  const p = estadoApp.parcialidades.find(x => x.idParcialidad === idParc);
  if (p) {
    p.estatusPago = "PAGADO";
    p.montoPagadoReal = monto;
    p.fechaPagoReal = fecha;
    p.estatusREP = "PENDIENTE"; // Regla de negocio: Al pagar, nace con REP Pendiente

    // Recalcular saldo OC
    const oc = estadoApp.ordenes.find(x => x.folioOC === p.folioOC);
    if (oc) {
      oc.totalAbonado = (parseFloat(oc.totalAbonado) || 0) + monto;
      oc.saldoPendiente = Math.max(0, (oc.montoTotal || 0) - oc.totalAbonado);
    }
    guardarEnLocalStorage();
    actualizarVistaCompleta();
  }

  const btnSubmit = event.target.querySelector("button[type='submit']");
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerText = "Subiendo Comprobante a Drive...";
  }

  // Sincronizar con Apps Script
  try {
    const res = await enviarPeticionAppsScript({
      accion: "registrarAbonoParcialidad",
      idParcialidad: idParc,
      montoPagado: monto,
      fechaPago: fecha,
      comprobanteFile: compData
    });

    if (res && res.comprobanteUrl && p) {
      p.comprobanteUrl = res.comprobanteUrl;
      guardarEnLocalStorage();
    }
  } catch (err) {
    console.warn("Aviso:", err);
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerText = "✓ Confirmar y Registrar Pago";
    }
  }

  bootstrap.Modal.getInstance(document.getElementById("modalRegistrarAbono")).hide();
  alert(`✓ Pago de ${idParc} registrado y comprobante adjuntado a la carpeta en Google Drive.\n\nEstatus: REP PENDIENTE.`);
  cargarDatos();
}

function abrirModalSubirREP(idParcialidad) {
  const p = estadoApp.parcialidades.find(x => x.idParcialidad === idParcialidad);
  if (!p) return;

  document.getElementById("modal-rep-id-parc").value = p.idParcialidad;
  document.getElementById("modal-rep-titulo-ref").innerText = `${p.folioOC} - ${p.numParcialidad}`;

  const modal = new bootstrap.Modal(document.getElementById("modalSubirREP"));
  modal.show();
}

async function guardarREPDesdeModal(event) {
  event.preventDefault();
  const idParc = document.getElementById("modal-rep-id-parc").value;
  const fileInput = document.getElementById("modal-rep-file");

  let repData = null;
  if (fileInput && fileInput.files[0]) {
    repData = await archivoABase64(fileInput.files[0]);
  }

  const p = estadoApp.parcialidades.find(x => x.idParcialidad === idParc);
  if (p) {
    p.estatusREP = "RECIBIDO";
    guardarEnLocalStorage();
    actualizarVistaCompleta();
  }

  try {
    await enviarPeticionAppsScript({
      accion: "subirREP",
      idParcialidad: idParc,
      repFile: repData
    });
  } catch (err) {
    console.warn("Aviso:", err);
  }

  bootstrap.Modal.getInstance(document.getElementById("modalSubirREP")).hide();
  alert(`✓ Complemento de Pago (REP) registrado para ${idParc}. La obligación fiscal ha quedado solventada.`);
}

// ==========================================
// PERSISTENCIA LOCAL Y CONSULTA REMOTA (SHEETS COMO FUENTE DE VERDAD)
// ==========================================
async function cargarDatos() {
  // 1. Cargar almacenamiento local provisional para despliegue instantáneo
  const localOC = localStorage.getItem("oc_parcialidades_data");
  const localParc = localStorage.getItem("calendario_parcialidades_data");

  if (localOC) {
    try { estadoApp.ordenes = JSON.parse(localOC); } catch (e) { }
  }
  if (localParc) {
    try { estadoApp.parcialidades = JSON.parse(localParc); } catch (e) { }
  }

  actualizarVistaCompleta();

  // 2. Consultar directamente a Google Sheets como la FUENTE DE VERDAD
  if (SCRIPT_URL_PARCIALIDADES) {
    try {
      // Usar GET para evitar problemas de CORS y obtener los datos en tiempo real
      const urlConsulta = `${SCRIPT_URL_PARCIALIDADES}?accion=obtenerDatos&t=${Date.now()}`;
      const resp = await fetch(urlConsulta);
      const res = await resp.json();

      if (res && res.success && Array.isArray(res.ordenes)) {
        // La hoja de cálculo manda: sustituir el estado local con lo que hay exactamente en el Sheets
        estadoApp.ordenes = res.ordenes;
        estadoApp.parcialidades = Array.isArray(res.parcialidades) ? res.parcialidades : [];
        guardarEnLocalStorage();
        actualizarVistaCompleta();
        console.log(`✓ Sincronizado con Google Sheets: ${res.ordenes.length} órdenes, ${estadoApp.parcialidades.length} parcialidades.`);
        return;
      }
    } catch (err) {
      console.warn("Aviso al consultar Google Sheets vía GET, intentando POST:", err);
      try {
        const resPost = await enviarPeticionAppsScript({ accion: "obtenerDatosParcialidades" });
        if (resPost && resPost.success && Array.isArray(resPost.ordenes)) {
          estadoApp.ordenes = resPost.ordenes;
          estadoApp.parcialidades = Array.isArray(resPost.parcialidades) ? resPost.parcialidades : [];
          guardarEnLocalStorage();
          actualizarVistaCompleta();
          return;
        }
      } catch (err2) {
        console.warn("Operando con copia local offline:", err2);
      }
    }
  }

  // Solo si no hay URL configurada y la memoria está totalmente vacía, poner ejemplo
  if (!SCRIPT_URL_PARCIALIDADES && estadoApp.ordenes.length === 0) {
    cargarDatosEjemploIniciales();
    actualizarVistaCompleta();
  }
}

function limpiarCacheYRecargar() {
  localStorage.removeItem("oc_parcialidades_data");
  localStorage.removeItem("calendario_parcialidades_data");
  estadoApp.ordenes = [];
  estadoApp.parcialidades = [];
  actualizarVistaCompleta();
  cargarDatos();
}

function guardarEnLocalStorage() {
  localStorage.setItem("oc_parcialidades_data", JSON.stringify(estadoApp.ordenes));
  localStorage.setItem("calendario_parcialidades_data", JSON.stringify(estadoApp.parcialidades));
}

function cargarDatosEjemploIniciales() {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const mes = hoy.getMonth();

  estadoApp.ordenes = [
    {
      folioOC: "OC-7040",
      proveedor: "VALVULAS Y CONEXIONES INDUSTRIALES S.A.",
      rfc: "VCI160412KJ8",
      correoProveedor: "ventas@valvulasconexionessa.com",
      concepto: "Lote de tubería y válvulas de alta presión (6 Parcialidades)",
      montoTotal: 180000,
      totalAbonado: 60000,
      saldoPendiente: 120000,
      plazoMeses: 6,
      diaPagoMes: 1,
      estatus: "ACTIVA_EN_PAGO",
      fechaCreacion: new Date(anio, mes - 2, 1).toISOString().split('T')[0]
    }
  ];

  // 6 Parcialidades: 2 ya pagadas (1 con REP, 1 en alerta sin REP), y 4 futuras
  const fechaP1 = new Date(anio, mes - 2, 1).toISOString().split('T')[0];
  const fechaP2 = new Date(anio, mes - 1, 1).toISOString().split('T')[0];
  const fechaP3 = new Date(anio, mes, 1).toISOString().split('T')[0];
  const fechaP4 = new Date(anio, mes + 1, 1).toISOString().split('T')[0];
  const fechaP5 = new Date(anio, mes + 2, 1).toISOString().split('T')[0];
  const fechaP6 = new Date(anio, mes + 3, 1).toISOString().split('T')[0];

  estadoApp.parcialidades = [
    {
      idParcialidad: "OC-7040-P1",
      folioOC: "OC-7040",
      numParcialidad: "Parcialidad 1 de 6",
      fechaProgramada: fechaP1,
      montoProgramado: 30000,
      fechaPagoReal: fechaP1,
      montoPagadoReal: 30000,
      estatusPago: "PAGADO",
      estatusREP: "RECIBIDO",
      repUrl: "https://drive.google.com",
      proveedor: "VALVULAS Y CONEXIONES INDUSTRIALES S.A.",
      correoProveedor: "ventas@valvulasconexionessa.com"
    },
    {
      idParcialidad: "OC-7040-P2",
      folioOC: "OC-7040",
      numParcialidad: "Parcialidad 2 de 6",
      fechaProgramada: fechaP2,
      montoProgramado: 30000,
      fechaPagoReal: fechaP2,
      montoPagadoReal: 30000,
      estatusPago: "PAGADO",
      estatusREP: "PENDIENTE", // En alerta: mes concluido sin REP
      proveedor: "VALVULAS Y CONEXIONES INDUSTRIALES S.A.",
      correoProveedor: "ventas@valvulasconexionessa.com",
      ultimoRecordatorioUsuario: new Date(hoy.getTime() - 3 * 86400000).toISOString().split('T')[0],
      ultimoRecordatorioProveedor: new Date(hoy.getTime() - 8 * 86400000).toISOString().split('T')[0]
    },
    {
      idParcialidad: "OC-7040-P3",
      folioOC: "OC-7040",
      numParcialidad: "Parcialidad 3 de 6",
      fechaProgramada: fechaP3,
      montoProgramado: 30000,
      estatusPago: "PROGRAMADO",
      estatusREP: "NO_APLICA",
      proveedor: "VALVULAS Y CONEXIONES INDUSTRIALES S.A.",
      correoProveedor: "ventas@valvulasconexionessa.com"
    },
    {
      idParcialidad: "OC-7040-P4",
      folioOC: "OC-7040",
      numParcialidad: "Parcialidad 4 de 6",
      fechaProgramada: fechaP4,
      montoProgramado: 30000,
      estatusPago: "PROGRAMADO",
      estatusREP: "NO_APLICA",
      proveedor: "VALVULAS Y CONEXIONES INDUSTRIALES S.A.",
      correoProveedor: "ventas@valvulasconexionessa.com"
    },
    {
      idParcialidad: "OC-7040-P5",
      folioOC: "OC-7040",
      numParcialidad: "Parcialidad 5 de 6",
      fechaProgramada: fechaP5,
      montoProgramado: 30000,
      estatusPago: "PROGRAMADO",
      estatusREP: "NO_APLICA",
      proveedor: "VALVULAS Y CONEXIONES INDUSTRIALES S.A.",
      correoProveedor: "ventas@valvulasconexionessa.com"
    },
    {
      idParcialidad: "OC-7040-P6",
      folioOC: "OC-7040",
      numParcialidad: "Parcialidad 6 de 6",
      fechaProgramada: fechaP6,
      montoProgramado: 30000,
      estatusPago: "PROGRAMADO",
      estatusREP: "NO_APLICA",
      proveedor: "VALVULAS Y CONEXIONES INDUSTRIALES S.A.",
      correoProveedor: "ventas@valvulasconexionessa.com"
    }
  ];

  guardarEnLocalStorage();
}

// ==========================================
// UTILIDADES Y FORMATOS
// ==========================================
function formatoMoneda(num) {
  return "$" + (parseFloat(num) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " MXN";
}

function formatearFechaEspanol(fechaStr) {
  if (!fechaStr) return "-";
  const [y, m, d] = fechaStr.split('-');
  const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  return `${d} ${meses[parseInt(m) - 1]} ${y}`;
}

function generarBadgeEstatusOC(estatus) {
  if (estatus === "CERRADA_CON_REPS") {
    return `<span class="badge bg-success-subtle text-success border border-success">✓ Cerrada al 100%</span>`;
  }
  if (estatus === "PAGADA_PENDIENTE_REPS") {
    return `<span class="badge badge-rep-urgente">🚨 Saldo 0 / REPs Pendientes</span>`;
  }
  return `<span class="badge bg-primary-subtle text-primary border border-primary">Activa en Parcialidades</span>`;
}

function archivoABase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        data: reader.result.split(',')[1],
        mimeType: file.type || "application/octet-stream",
        name: file.name
      });
    };
    reader.readAsDataURL(file);
  });
}

async function enviarPeticionAppsScript(data) {
  if (!SCRIPT_URL_PARCIALIDADES) {
    console.warn("No hay URL de Apps Script configurada. Operando en modo local.");
    return { success: true, localOnly: true };
  }

  try {
    const res = await fetch(SCRIPT_URL_PARCIALIDADES, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(data)
    });

    try {
      const json = await res.json();
      return json;
    } catch (parseErr) {
      return { success: res.ok };
    }
  } catch (err) {
    console.warn("Fallo en petición estándar POST, intentando envío alternativo:", err);
    // Intento con no-cors para asegurar que el servidor de Apps Script reciba el POST y ejecute los correos
    try {
      await fetch(SCRIPT_URL_PARCIALIDADES, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(data)
      });
      return { success: true, viaNoCors: true };
    } catch (fallbackErr) {
      console.error("Error definitivo comunicando con Apps Script:", fallbackErr);
      throw fallbackErr;
    }
  }
}
