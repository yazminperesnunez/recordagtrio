// portal_proveedor.js - Lógica del Portal de Autoservicio para Proveedores
// Permite al proveedor ver cuándo se le pagó, descargar comprobantes y subir Facturas Globales y REPs.

const SCRIPT_URL_PARCIALIDADES = "https://script.google.com/macros/s/AKfycbwmMN_VBF-90TV3ZguuyGFgWrKnV8oFSjaj1As8cgFQaA4nohpYQ3MEtM3OjaTUmG6t/exec";

let portalEstado = {
  ordenes: [],
  parcialidades: [],
  proveedorAutenticado: null // { rfc: "...", razonSocial: "..." }
};

document.addEventListener("DOMContentLoaded", () => {
  // Verificar si hay una sesión guardada en sessionStorage
  const sesionGuardada = sessionStorage.getItem("portal_prov_sesion");
  if (sesionGuardada) {
    try {
      portalEstado.proveedorAutenticado = JSON.parse(sesionGuardada);
    } catch (e) {
      portalEstado.proveedorAutenticado = null;
    }
  }

  cargarDatosPortal(false);
});

async function cargarDatosPortal(forzarRecarga = false) {
  // 1. Cargar caché local primero para rapidez
  const localOC = localStorage.getItem("oc_parcialidades_data");
  const localParc = localStorage.getItem("calendario_parcialidades_data");

  if (localOC) {
    try { portalEstado.ordenes = JSON.parse(localOC); } catch (e) {}
  }
  if (localParc) {
    try { portalEstado.parcialidades = JSON.parse(localParc); } catch (e) {}
  }

  gestionarVisibilidadSesion();

  // 2. Sincronizar en vivo con Google Sheets
  if (SCRIPT_URL_PARCIALIDADES) {
    try {
      const urlConsulta = `${SCRIPT_URL_PARCIALIDADES}?accion=obtenerDatos&t=${Date.now()}`;
      const resp = await fetch(urlConsulta);
      const res = await resp.json();

      if (res && res.success && Array.isArray(res.ordenes)) {
        portalEstado.ordenes = res.ordenes;
        portalEstado.parcialidades = Array.isArray(res.parcialidades) ? res.parcialidades : [];
        
        localStorage.setItem("oc_parcialidades_data", JSON.stringify(portalEstado.ordenes));
        localStorage.setItem("calendario_parcialidades_data", JSON.stringify(portalEstado.parcialidades));

        gestionarVisibilidadSesion();
        console.log("✓ Portal sincronizado con Google Sheets en tiempo real.");
      }
    } catch (err) {
      console.warn("Aviso al sincronizar portal con Google Sheets:", err);
    }
  }
}

// ---------------------------------------------------
// AUTENTICACIÓN / SESIÓN DEL PROVEEDOR
// ---------------------------------------------------
function iniciarSesionProveedor(event) {
  event.preventDefault();
  const alertaError = document.getElementById("login-error-alerta");
  alertaError.classList.add("d-none");
  alertaError.innerText = "";

  const rfcInput = (document.getElementById("login-rfc").value || "").trim().toUpperCase();
  const passInput = (document.getElementById("login-password").value || "").trim();

  if (!rfcInput) {
    alertaError.innerText = "Por favor ingresa tu RFC registrado.";
    alertaError.classList.remove("d-none");
    return;
  }

  // Validación de contraseña provisional requerida: 'admin'
  if (passInput !== "admin") {
    alertaError.innerText = "Contraseña incorrecta. (Clave por defecto: admin)";
    alertaError.classList.remove("d-none");
    return;
  }

  // Buscar si el RFC existe en las órdenes registradas
  // Normalizamos comparaciones quitando guiones y espacios
  const normalizarRFC = (str) => (str || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const rfcBuscado = normalizarRFC(rfcInput);

  const ordenCoincidente = portalEstado.ordenes.find(oc => normalizarRFC(oc.rfc) === rfcBuscado);

  if (!ordenCoincidente) {
    alertaError.innerText = `No encontramos órdenes de compra asignadas al RFC "${rfcInput}". Verifica que esté escrito exactamente como en tus facturas.`;
    alertaError.classList.remove("d-none");
    return;
  }

  // Inicio de sesión exitoso
  portalEstado.proveedorAutenticado = {
    rfc: ordenCoincidente.rfc || rfcInput,
    razonSocial: ordenCoincidente.proveedor || rfcInput
  };

  sessionStorage.setItem("portal_prov_sesion", JSON.stringify(portalEstado.proveedorAutenticado));
  
  // Limpiar campos
  document.getElementById("login-rfc").value = "";
  document.getElementById("login-password").value = "";

  gestionarVisibilidadSesion();
}

function cerrarSesionProveedor() {
  portalEstado.proveedorAutenticado = null;
  sessionStorage.removeItem("portal_prov_sesion");
  gestionarVisibilidadSesion();
}

function gestionarVisibilidadSesion() {
  const seccionLogin = document.getElementById("seccion-login");
  const seccionDashboard = document.getElementById("seccion-dashboard-proveedor");
  const navSesion = document.getElementById("nav-info-sesion");
  const navBadge = document.getElementById("nav-badge-proveedor");

  if (!portalEstado.proveedorAutenticado) {
    // Modo no autenticado: mostrar solo login
    if (seccionLogin) seccionLogin.style.display = "flex";
    if (seccionDashboard) seccionDashboard.style.display = "none";
    if (navSesion) navSesion.classList.add("d-none");
  } else {
    // Modo autenticado: mostrar dashboard exclusivo
    if (seccionLogin) seccionLogin.style.display = "none";
    if (seccionDashboard) seccionDashboard.style.display = "block";
    if (navSesion) {
      navSesion.classList.remove("d-none");
      navSesion.classList.add("d-flex");
    }

    if (navBadge) {
      navBadge.innerText = `👤 ${portalEstado.proveedorAutenticado.razonSocial.slice(0, 24)}... (${portalEstado.proveedorAutenticado.rfc})`;
      navBadge.title = `${portalEstado.proveedorAutenticado.razonSocial} - ${portalEstado.proveedorAutenticado.rfc}`;
    }

    // Datos del Hero
    const heroNombre = document.getElementById("portal-hero-nombre-proveedor");
    const heroRFC = document.getElementById("portal-hero-rfc");
    if (heroNombre) heroNombre.innerText = portalEstado.proveedorAutenticado.razonSocial;
    if (heroRFC) heroRFC.innerText = portalEstado.proveedorAutenticado.rfc;

    renderizarPortal();
  }
}

function renderizarPortal() {
  if (!portalEstado.proveedorAutenticado) return;

  const contenedor = document.getElementById("portal-lista-ordenes");
  if (!contenedor) return;
  contenedor.innerHTML = "";

  // FILTRADO ESTRICTO: Solo las órdenes que corresponden a este proveedor por RFC o Razón Social
  const normalizar = (str) => (str || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const provRFC = normalizar(portalEstado.proveedorAutenticado.rfc);
  const provNombre = (portalEstado.proveedorAutenticado.razonSocial || "").trim().toUpperCase();

  const ordenesVisibles = portalEstado.ordenes.filter(o => {
    return normalizar(o.rfc) === provRFC || (o.proveedor && o.proveedor.trim().toUpperCase() === provNombre);
  });

  // Actualizar KPIs del Portal
  let sumTotal = 0;
  let sumPagado = 0;
  let sumSaldo = 0;
  let obligacionesPendientes = 0;

  ordenesVisibles.forEach(oc => {
    sumTotal += (parseFloat(oc.montoTotal) || 0);
    sumPagado += (parseFloat(oc.totalAbonado) || 0);
    sumSaldo += (parseFloat(oc.saldoPendiente) || 0);
    if (!oc.facturaGlobalUrl) obligacionesPendientes++;
  });

  // Contar REPs pendientes para las OCs visibles
  const foliosVisibles = new Set(ordenesVisibles.map(o => o.folioOC));
  portalEstado.parcialidades.forEach(p => {
    if (foliosVisibles.has(p.folioOC)) {
      if (p.estatusPago === "PAGADO" && p.estatusREP === "PENDIENTE") {
        obligacionesPendientes++;
      }
    }
  });

  document.getElementById("portal-kpi-total").innerText = formatoMoneda(sumTotal);
  document.getElementById("portal-kpi-pagado").innerText = formatoMoneda(sumPagado);
  document.getElementById("portal-kpi-saldo").innerText = formatoMoneda(sumSaldo);
  document.getElementById("portal-kpi-pendientes").innerText = obligacionesPendientes;
  document.getElementById("portal-conteo-ordenes").innerText = `${ordenesVisibles.length} Órdenes`;

  if (ordenesVisibles.length === 0) {
    contenedor.innerHTML = `
      <div class="col-12 text-center py-5 text-muted">
        <h5>No hay órdenes de compra registradas para este proveedor.</h5>
        <p class="small">Si tienes una orden activa, solicita a compras que te asigne el número de orden de compra.</p>
      </div>
    `;
    return;
  }

  ordenesVisibles.forEach(oc => {
    const parcialidadesDeOC = portalEstado.parcialidades.filter(p => p.folioOC === oc.folioOC);
    const porcentaje = oc.montoTotal > 0 ? Math.round((oc.totalAbonado / oc.montoTotal) * 100) : 0;

    // Estado de Factura Global (Paso 1)
    let badgeFacturaGlobal = "";
    if (oc.facturaGlobalUrl) {
      badgeFacturaGlobal = `
        <span class="badge bg-success-subtle text-success border border-success d-inline-flex align-items-center gap-1">
          ✓ Factura Global PPD Entregada
        </span>
        <a href="${oc.facturaGlobalUrl}" target="_blank" class="btn btn-sm btn-link py-0 px-1 text-decoration-none" title="Descargar o ver factura">Ver ↗</a>
      `;
    } else {
      badgeFacturaGlobal = `
        <span class="badge bg-warning-subtle text-dark border border-warning d-inline-flex align-items-center gap-1">
          ⚠️ Factura Global PPD Pendiente
        </span>
        <button type="button" class="btn btn-sm btn-warning py-0 px-2 fw-semibold ms-1" style="font-size: 11px;" onclick="portalAbrirModalFactura('${oc.folioOC}')">
          + Cargar Factura Ahora
        </button>
      `;
    }

    const col = document.createElement("div");
    col.className = "col-12";
    col.innerHTML = `
      <div class="card card-oc-portal bg-white shadow-sm overflow-hidden">
        <!-- Cabecera de la Orden -->
        <div class="card-header bg-white py-3 border-bottom d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div>
            <div class="d-flex align-items-center gap-2">
              <span class="badge bg-primary fs-6 font-monospace">${oc.folioOC}</span>
              <strong class="text-dark fs-6">${oc.proveedor}</strong>
              <small class="text-muted">RFC: ${oc.rfc || 'N/A'}</small>
            </div>
            <div class="small text-muted mt-1">
              ${oc.concepto || 'Adquisición en parcialidades'} | Plazo acordado: <strong>${oc.plazoMeses} meses</strong> (Pago los días ${oc.diaPagoMes} de cada mes)
            </div>
          </div>
          <div class="d-flex align-items-center gap-2">
            ${badgeFacturaGlobal}
            ${oc.carpetaDriveUrl ? `
              <a href="${oc.carpetaDriveUrl}" target="_blank" class="btn btn-sm btn-outline-secondary py-1 px-2 d-inline-flex align-items-center gap-1">
                📁 Carpeta Compartida ↗
              </a>
            ` : ''}
          </div>
        </div>

        <!-- Barra de Progreso y Saldos -->
        <div class="p-3 bg-light border-bottom">
          <div class="row align-items-center g-2">
            <div class="col-md-4">
              <span class="small text-muted">Monto Contratado:</span>
              <div class="fw-bold font-monospace fs-6">${formatoMoneda(oc.montoTotal)}</div>
            </div>
            <div class="col-md-4">
              <span class="small text-muted">Total Depositado a tu Cuenta:</span>
              <div class="fw-bold font-monospace fs-6 text-success">${formatoMoneda(oc.totalAbonado)} (${porcentaje}%)</div>
            </div>
            <div class="col-md-4">
              <span class="small text-muted">Saldo Pendiente por Liquidar:</span>
              <div class="fw-bold font-monospace fs-6 text-danger">${formatoMoneda(oc.saldoPendiente)}</div>
            </div>
          </div>
          <div class="progress mt-2" style="height: 6px;">
            <div class="progress-bar bg-success" style="width: ${porcentaje}%;"></div>
          </div>
        </div>

        <!-- Tabla de Pagos de esta OC -->
        <div class="table-responsive">
          <table class="table table-hover align-middle mb-0" style="font-size: 13px;">
            <thead class="table-white">
              <tr>
                <th>Parcialidad</th>
                <th>Fecha Programada</th>
                <th class="text-end">Monto Pactado</th>
                <th class="text-center">Estado del Pago</th>
                <th>Comprobante Bancario</th>
                <th>Complemento de Pago (REP)</th>
                <th class="text-center">Acción Proveedor</th>
              </tr>
            </thead>
            <tbody>
              ${parcialidadesDeOC.map(p => {
                const pagado = (p.estatusPago === "PAGADO");
                const tieneREP = (p.estatusREP === "RECIBIDO");

                // Badge de pago
                let badgePago = pagado 
                  ? `<span class="badge bg-success-subtle text-success border border-success">✓ Pagado (${p.fechaPagoReal})</span>`
                  : `<span class="badge bg-secondary-subtle text-muted border">⏱ Programado para ${p.fechaProgramada}</span>`;

                // Comprobante
                let compHtml = '<span class="text-muted small">Aún no transferido</span>';
                if (pagado) {
                  if (p.comprobanteUrl) {
                    compHtml = `
                      <a href="${p.comprobanteUrl}" target="_blank" class="btn btn-xs btn-outline-success py-0 px-2 fw-semibold" style="font-size: 11px;">
                        📥 Descargar Ficha Bancaria ↗
                      </a>
                    `;
                  } else {
                    compHtml = `<span class="text-success small fw-semibold">✓ Transferencia confirmada</span>`;
                  }
                }

                // Estatus de REP
                let repHtml = "";
                if (!pagado) {
                  repHtml = `<span class="text-muted small">Aplica tras el pago</span>`;
                } else if (tieneREP) {
                  repHtml = `
                    <span class="badge bg-success-subtle text-success border border-success">✓ REP Entregado</span>
                    ${p.repUrl ? `<a href="${p.repUrl}" target="_blank" class="small text-decoration-none ms-1">Ver ↗</a>` : ''}
                  `;
                } else {
                  repHtml = `
                    <span class="badge bg-danger text-white">🚨 Pendiente de Facturar</span>
                  `;
                }

                // Botón para que el proveedor suba el REP
                let accionHtml = "";
                if (pagado && !tieneREP) {
                  accionHtml = `
                    <button type="button" class="btn btn-sm btn-primary py-0 px-2 fw-semibold" style="font-size: 11px;" onclick="portalAbrirModalREP('${p.idParcialidad}', '${p.folioOC}', '${p.numParcialidad}', '${p.montoPagadoReal || p.montoProgramado}', '${p.fechaPagoReal}')">
                      📤 Adjuntar REP (XML/PDF)
                    </button>
                  `;
                } else if (tieneREP) {
                  accionHtml = `<span class="text-success small fw-bold">✓ Cumplido</span>`;
                } else {
                  accionHtml = `<span class="text-muted small">-</span>`;
                }

                return `
                  <tr>
                    <td><strong class="font-monospace">${p.numParcialidad}</strong><br><small class="text-muted font-monospace">${p.idParcialidad}</small></td>
                    <td class="font-monospace">${p.fechaProgramada}</td>
                    <td class="text-end font-monospace fw-bold">${formatoMoneda(p.montoProgramado)}</td>
                    <td class="text-center">${badgePago}</td>
                    <td>${compHtml}</td>
                    <td>${repHtml}</td>
                    <td class="text-center">${accionHtml}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
    contenedor.appendChild(col);
  });
}

// ---------------------------------------------------
// MODAL: SUBIR FACTURA GLOBAL POR EL PROVEEDOR
// ---------------------------------------------------
function portalAbrirModalFactura(folioOC) {
  const oc = portalEstado.ordenes.find(o => o.folioOC === folioOC);
  document.getElementById("portal-factura-folio-oc").value = folioOC;
  document.getElementById("portal-factura-titulo-ref").innerText = `${folioOC} - ${oc ? oc.proveedor : ''}`;

  const modal = new bootstrap.Modal(document.getElementById("modalPortalFacturaGlobal"));
  modal.show();
}

async function portalGuardarFacturaGlobal(event) {
  event.preventDefault();
  const folioOC = document.getElementById("portal-factura-folio-oc").value;
  const fileInput = document.getElementById("portal-factura-file");
  const btn = document.getElementById("btn-submit-portal-factura");

  if (!fileInput || !fileInput.files[0]) {
    alert("Por favor selecciona el archivo de la Factura Global.");
    return;
  }

  btn.disabled = true;
  btn.innerText = "Subiendo Factura a la Carpeta Compartida...";

  try {
    const fileData = await archivoABase64(fileInput.files[0]);

    const res = await enviarPeticionAppsScriptPortal({
      accion: "agregarArchivosAOrden",
      folioOC: folioOC,
      tipoArchivo: "FACTURA",
      archivoFile: fileData
    });

    const oc = portalEstado.ordenes.find(o => o.folioOC === folioOC);
    if (oc) {
      if (res && res.urlArchivo) oc.facturaGlobalUrl = res.urlArchivo;
      if (res && res.carpetaDriveUrl && !oc.carpetaDriveUrl) oc.carpetaDriveUrl = res.carpetaDriveUrl;
      localStorage.setItem("oc_parcialidades_data", JSON.stringify(portalEstado.ordenes));
      renderizarPortal();
    }

    bootstrap.Modal.getInstance(document.getElementById("modalPortalFacturaGlobal")).hide();
    alert(`✅ ¡Factura Global para la orden ${folioOC} cargada con éxito!\n\nEl usuario y el departamento de compras ya pueden visualizarla en el sistema.`);
  } catch (err) {
    console.error("Error al subir Factura Global:", err);
    alert("Hubo un inconveniente al subir el archivo a Google Drive.");
  } finally {
    btn.disabled = false;
    btn.innerText = "☁️ Subir y Validar Factura";
  }
}

// ---------------------------------------------------
// MODAL: SUBIR REP POR EL PROVEEDOR
// ---------------------------------------------------
function portalAbrirModalREP(idParcialidad, folioOC, numParc, monto, fechaPago) {
  document.getElementById("portal-rep-id-parc").value = idParcialidad;
  document.getElementById("portal-rep-titulo-ref").innerText = `${folioOC} - ${numParc}`;
  document.getElementById("portal-rep-subtitulo-ref").innerText = `Pago liquidado el ${fechaPago} por $${Number(monto).toLocaleString('es-MX', {minimumFractionDigits: 2})} MXN`;

  const modal = new bootstrap.Modal(document.getElementById("modalPortalSubirREP"));
  modal.show();
}

async function portalGuardarREP(event) {
  event.preventDefault();
  const idParc = document.getElementById("portal-rep-id-parc").value;
  const fileInput = document.getElementById("portal-rep-file");
  const btn = document.getElementById("btn-submit-portal-rep");

  if (!fileInput || !fileInput.files[0]) {
    alert("Por favor selecciona el archivo XML o PDF del REP.");
    return;
  }

  btn.disabled = true;
  btn.innerText = "Subiendo Complemento de Pago (REP)...";

  try {
    const repData = await archivoABase64(fileInput.files[0]);

    const res = await enviarPeticionAppsScriptPortal({
      accion: "subirREP",
      idParcialidad: idParc,
      repFile: repData
    });

    const p = portalEstado.parcialidades.find(x => x.idParcialidad === idParc);
    if (p) {
      p.estatusREP = "RECIBIDO";
      if (res && res.urlREP) p.repUrl = res.urlREP;
      localStorage.setItem("calendario_parcialidades_data", JSON.stringify(portalEstado.parcialidades));
      renderizarPortal();
    }

    bootstrap.Modal.getInstance(document.getElementById("modalPortalSubirREP")).hide();
    alert(`✅ ¡Complemento de Pago (REP) cargado exitosamente!\n\nSe actualizó el estatus en el sistema y se cancelan los recordatorios automáticos de esta parcialidad.`);
  } catch (err) {
    console.error("Error al subir REP:", err);
    alert("Hubo un error al subir el complemento fiscal.");
  } finally {
    btn.disabled = false;
    btn.innerText = "☁️ Subir Complemento REP";
  }
}

// ---------------------------------------------------
// AUXILIARES
// ---------------------------------------------------
function formatoMoneda(num) {
  return "$" + (parseFloat(num) || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " MXN";
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

async function enviarPeticionAppsScriptPortal(data) {
  if (!SCRIPT_URL_PARCIALIDADES) return { success: true };

  try {
    const res = await fetch(SCRIPT_URL_PARCIALIDADES, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(data)
    });
    return await res.json();
  } catch (e) {
    // Intento con no-cors
    await fetch(SCRIPT_URL_PARCIALIDADES, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(data)
    });
    return { success: true };
  }
}
