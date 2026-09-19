/**
 * backend.gs - Módulo Especializado: Órdenes de Compra en Parcialidades, Calendario y Automatización de Recordatorios REP
 * 
 * Funciones Principales:
 * 1. Control de Órdenes de Compra y Parcialidades PPD en Google Sheets.
 * 2. Guardado seguro de comprobantes bancarios y Facturas/REPs (XML y PDF) en Google Drive.
 * 3. Automatización de Recordatorios por Correo:
 *    - Recordatorio al USUARIO/EMPRESA cada 2 días si hay pagos con mes vencido sin REP.
 *    - Recordatorio al PROVEEDOR cada 7 días (semanal) requiriendo el Complemento de Pago (REP).
 * 4. Activador Automático (Trigger Cron diario) para auditar vencimientos.
 */

function getSpreadsheet() {
  try {
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    // Si se enlaza de forma externa coloca el ID de tu hoja:
    return SpreadsheetApp.openById("1YMUl2NumIZ-HGbuJP-l9eYC64wwG5ZJe0aAOvRQcCFY");
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respuestaJSON({ success: false, error: "No se recibieron datos POST" }, 400);
    }

    const data = JSON.parse(e.postData.contents);
    const accion = data.accion;

    if (accion === "obtenerDatosParcialidades") {
      return respuestaJSON(obtenerDatosCompletos());
    }

    if (accion === "registrarOrdenParcialidades") {
      return respuestaJSON(procesarNuevaOrdenParcialidades(data));
    }

    if (accion === "registrarAbonoParcialidad") {
      return respuestaJSON(procesarAbono(data));
    }

    if (accion === "subirREP") {
      return respuestaJSON(procesarSubidaREP(data));
    }

    if (accion === "enviarRecordatorioManual") {
      return respuestaJSON(enviarRecordatorioEspecifico(data));
    }

    if (accion === "ejecutarAuditoriaRecordatorios") {
      return respuestaJSON(ejecutarAuditoriaYEnvioRecordatoriosAutomaticos());
    }

    return respuestaJSON({ success: false, error: "Acción no reconocida: " + accion }, 400);
  } catch (error) {
    return respuestaJSON({ success: false, error: error.toString() }, 500);
  }
}

function doGet(e) {
  const accion = (e && e.parameter) ? e.parameter.accion : "";
  if (accion === "obtenerDatos" || !accion) {
    return respuestaJSON(obtenerDatosCompletos());
  }
  if (accion === "cronRecordatorios") {
    return respuestaJSON(ejecutarAuditoriaYEnvioRecordatoriosAutomaticos());
  }
  return respuestaJSON({ success: true, message: "API Parcialidades y Control REP Activa" });
}

// ---------------------------------------------------
// 1. OBTENER DATOS COMPLETOS
// ---------------------------------------------------
function obtenerDatosCompletos() {
  const ss = getSpreadsheet();
  asegurarHojasEstructura(ss);

  const sheetOC = ss.getSheetByName("OC_Parcialidades");
  const sheetParc = ss.getSheetByName("Calendario_Pagos");

  const dataOC = sheetOC.getDataRange().getValues();
  const dataParc = sheetParc.getDataRange().getValues();

  const ordenes = [];
  for (let i = 1; i < dataOC.length; i++) {
    const row = dataOC[i];
    if (!row[0]) continue;
    ordenes.push({
      folioOC: row[0],
      proveedor: row[1],
      rfc: row[2],
      correoProveedor: row[3],
      concepto: row[4],
      montoTotal: parseFloat(row[5]) || 0,
      totalAbonado: parseFloat(row[6]) || 0,
      saldoPendiente: parseFloat(row[7]) || 0,
      plazoMeses: row[8],
      diaPagoMes: row[9],
      estatus: row[10],
      fechaCreacion: row[11],
      facturaGlobalUrl: row[12] || ""
    });
  }

  const parcialidades = [];
  for (let j = 1; j < dataParc.length; j++) {
    const row = dataParc[j];
    if (!row[0]) continue;
    parcialidades.push({
      idParcialidad: row[0],
      folioOC: row[1],
      numParcialidad: row[2],
      fechaProgramada: formatearFechaString(row[3]),
      montoProgramado: parseFloat(row[4]) || 0,
      fechaPagoReal: formatearFechaString(row[5]),
      montoPagadoReal: parseFloat(row[6]) || 0,
      comprobanteUrl: row[7] || "",
      estatusPago: row[8], // 'PROGRAMADO', 'PAGADO'
      estatusREP: row[9],   // 'NO_APLICA', 'PENDIENTE', 'RECIBIDO'
      repUrl: row[10] || "",
      ultimoRecordatorioUsuario: formatearFechaString(row[11]),
      ultimoRecordatorioProveedor: formatearFechaString(row[12]),
      proveedor: row[13] || "",
      correoProveedor: row[14] || ""
    });
  }

  return {
    success: true,
    ordenes: ordenes,
    parcialidades: parcialidades,
    fechaServidor: new Date().toISOString()
  };
}

// ---------------------------------------------------
// 2. REGISTRAR ORDEN DE COMPRA CON PLAN DE PAGOS
// ---------------------------------------------------
function procesarNuevaOrdenParcialidades(data) {
  const ss = getSpreadsheet();
  asegurarHojasEstructura(ss);

  const sheetOC = ss.getSheetByName("OC_Parcialidades");
  const sheetParc = ss.getSheetByName("Calendario_Pagos");

  const folioOC = (data.folioOC || ("OC-" + Math.floor(1000 + Math.random() * 9000))).toUpperCase().trim();
  const montoTotal = parseFloat(data.montoTotal) || 0;
  const numPagos = parseInt(data.numPagos || data.plazoMeses) || 1;
  const diaPago = parseInt(data.diaPagoMes) || 1;

  // Carpeta de Drive para esta OC
  let iter = DriveApp.getFoldersByName("CONTROL_PARCIALIDADES_OC");
  let carpetaRaiz = iter.hasNext() ? iter.next() : DriveApp.createFolder("CONTROL_PARCIALIDADES_OC");
  let carpetaOC = carpetaRaiz.createFolder(folioOC + "_" + (data.rfc || "PROV"));
  carpetaOC.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  let urlFacturaGlobal = "";
  if (data.facturaGlobalFile) {
    urlFacturaGlobal = guardarArchivoDriveBlob(carpetaOC, data.facturaGlobalFile, "Factura_Global_" + folioOC);
  }

  // Insertar cabecera de OC
  sheetOC.appendRow([
    folioOC,
    data.proveedor || "Proveedor General",
    data.rfc || "",
    data.correoProveedor || "",
    data.concepto || "Compra diferida en parcialidades",
    montoTotal,
    0, // Total Abonado Inicial
    montoTotal, // Saldo Pendiente Inicial
    numPagos,
    diaPago,
    "ACTIVA_EN_PAGO",
    new Date(),
    urlFacturaGlobal,
    carpetaOC.getUrl()
  ]);

  // Generar el desglose de parcialidades en Calendario_Pagos
  const planPagos = Array.isArray(data.planPagos) && data.planPagos.length > 0 
    ? data.planPagos 
    : generarFechasAmortizacion(montoTotal, numPagos, diaPago, data.fechaInicioPrimerPago);

  planPagos.forEach((p, idx) => {
    const idParc = folioOC + "-P" + (idx + 1);
    sheetParc.appendRow([
      idParc,
      folioOC,
      `Parcialidad ${idx + 1} de ${numPagos}`,
      p.fechaProgramada,
      p.monto,
      "", // Fecha pago real
      0,  // Monto pagado real
      "", // Comprobante URL
      "PROGRAMADO",
      "NO_APLICA", // Pasa a PENDIENTE cuando se paga
      "", // REP URL
      "", // Ultimo recordatorio usuario
      "", // Ultimo recordatorio proveedor
      data.proveedor || "",
      data.correoProveedor || ""
    ]);
  });

  return {
    success: true,
    folioOC: folioOC,
    carpetaDriveUrl: carpetaOC.getUrl(),
    totalParcialidades: planPagos.length
  };
}

// ---------------------------------------------------
// 3. REGISTRAR ABONO / PAGO REAL DE UNA PARCIALIDAD
// ---------------------------------------------------
function procesarAbono(data) {
  const ss = getSpreadsheet();
  const sheetParc = ss.getSheetByName("Calendario_Pagos");
  const sheetOC = ss.getSheetByName("OC_Parcialidades");

  const idParcialidad = data.idParcialidad;
  const dataParc = sheetParc.getDataRange().getValues();

  let filaEncontrada = -1;
  let folioOC = "";
  let fechaPago = data.fechaPago || new Date().toISOString().split('T')[0];
  let montoPagado = parseFloat(data.montoPagado) || 0;

  for (let i = 1; i < dataParc.length; i++) {
    if (dataParc[i][0] === idParcialidad) {
      filaEncontrada = i + 1;
      folioOC = dataParc[i][1];
      if (montoPagado <= 0) montoPagado = parseFloat(dataParc[i][4]) || 0;
      break;
    }
  }

  if (filaEncontrada === -1) throw new Error("Parcialidad no encontrada: " + idParcialidad);

  // Subir ficha o comprobante de pago
  let urlComprobante = "";
  if (data.comprobanteFile) {
    let carpeta = obtenerCarpetaOC(folioOC);
    urlComprobante = guardarArchivoDriveBlob(carpeta, data.comprobanteFile, "Comprobante_" + idParcialidad);
  }

  // Actualizar la parcialidad: Pasa a PAGADO y Estatus REP a PENDIENTE
  sheetParc.getRange(filaEncontrada, 6).setValue(fechaPago);
  sheetParc.getRange(filaEncontrada, 7).setValue(montoPagado);
  if (urlComprobante) sheetParc.getRange(filaEncontrada, 8).setValue(urlComprobante);
  sheetParc.getRange(filaEncontrada, 9).setValue("PAGADO");
  sheetParc.getRange(filaEncontrada, 10).setValue("PENDIENTE"); // El proveedor debe expedir el REP

  // Recalcular saldo de la OC global
  actualizarSaldosOC(folioOC);

  return { success: true, idParcialidad: idParcialidad, estatusREP: "PENDIENTE" };
}

// ---------------------------------------------------
// 4. SUBIR COMPLEMENTO DE PAGO (REP)
// ---------------------------------------------------
function procesarSubidaREP(data) {
  const ss = getSpreadsheet();
  const sheetParc = ss.getSheetByName("Calendario_Pagos");

  const idParcialidad = data.idParcialidad;
  const dataParc = sheetParc.getDataRange().getValues();

  let filaEncontrada = -1;
  let folioOC = "";

  for (let i = 1; i < dataParc.length; i++) {
    if (dataParc[i][0] === idParcialidad) {
      filaEncontrada = i + 1;
      folioOC = dataParc[i][1];
      break;
    }
  }

  if (filaEncontrada === -1) throw new Error("Parcialidad no encontrada: " + idParcialidad);

  let urlREP = "";
  if (data.repFile) {
    let carpeta = obtenerCarpetaOC(folioOC);
    urlREP = guardarArchivoDriveBlob(carpeta, data.repFile, "REP_Complemento_" + idParcialidad);
  }

  // Marcar como RECIBIDO
  sheetParc.getRange(filaEncontrada, 10).setValue("RECIBIDO");
  if (urlREP) sheetParc.getRange(filaEncontrada, 11).setValue(urlREP);

  actualizarSaldosOC(folioOC);

  return { success: true, idParcialidad: idParcialidad, estatusREP: "RECIBIDO", urlREP: urlREP };
}

// ---------------------------------------------------
// 5. MOTOR INTELIGENTE DE RECORDATORIOS (REGLA DE NEGOCIO):
//    - Si se pagó y al siguiente mes casi terminado no se hizo el REP:
//      -> Recordatorio al USUARIO cada 2 días
//      -> Recordatorio al PROVEEDOR cada 7 días (semanal)
// ---------------------------------------------------
function ejecutarAuditoriaYEnvioRecordatoriosAutomaticos() {
  const ss = getSpreadsheet();
  const sheetParc = ss.getSheetByName("Calendario_Pagos");
  const dataParc = sheetParc.getDataRange().getValues();

  const hoy = new Date();
  let recordatoriosEnviadosUsuario = 0;
  let recordatoriosEnviadosProveedor = 0;
  const logDetalle = [];

  for (let i = 1; i < dataParc.length; i++) {
    const row = dataParc[i];
    const idParc = row[0];
    const folioOC = row[1];
    const numParc = row[2];
    const fechaPagoRealStr = row[5];
    const montoPagado = row[6];
    const estatusPago = row[8];
    const estatusREP = (row[9] || "").toString().toUpperCase();
    const ultimoRecUserStr = row[11];
    const ultimoRecProvStr = row[12];
    const provNombre = row[13] || "Proveedor";
    const provCorreo = row[14] || "";

    // Solo auditar si está pagado y el REP sigue PENDIENTE
    if (estatusPago === "PAGADO" && estatusREP === "PENDIENTE" && fechaPagoRealStr) {
      const fechaPago = new Date(fechaPagoRealStr);
      
      // Regla: "Al siguiente mes casi terminado"
      // En México el plazo legal del SAT para el REP es hasta el 5to día natural del mes siguiente.
      // Si ya pasó el fin de mes del pago o transcurrieron más de 20 días desde el pago:
      const diasDesdePago = Math.floor((hoy - fechaPago) / (1000 * 60 * 60 * 24));
      
      // Condición de vencimiento: más de 20 días o mes siguiente iniciado
      const esMesSiguiente = (hoy.getFullYear() > fechaPago.getFullYear()) || (hoy.getMonth() > fechaPago.getMonth());
      const estaEnAlertaREP = esMesSiguiente || (diasDesdePago >= 20);

      if (estaEnAlertaREP) {
        // 1. REGLA USUARIO: Recordar cada 2 días
        let debeNotificarUsuario = false;
        if (!ultimoRecUserStr) {
          debeNotificarUsuario = true;
        } else {
          const ultUser = new Date(ultimoRecUserStr);
          const diasDesdeUltUser = Math.floor((hoy - ultUser) / (1000 * 60 * 60 * 24));
          if (diasDesdeUltUser >= 2) debeNotificarUsuario = true;
        }

        // 2. REGLA PROVEEDOR: Recordar cada 7 días (semanal)
        let debeNotificarProveedor = false;
        if (!ultimoRecProvStr) {
          debeNotificarProveedor = true;
        } else {
          const ultProv = new Date(ultimoRecProvStr);
          const diasDesdeUltProv = Math.floor((hoy - ultProv) / (1000 * 60 * 60 * 24));
          if (diasDesdeUltProv >= 7) debeNotificarProveedor = true;
        }

        // Ejecutar envíos
        if (debeNotificarUsuario) {
          enviarCorreoAlertaUsuario(idParc, folioOC, provNombre, montoPagado, fechaPagoRealStr, diasDesdePago);
          sheetParc.getRange(i + 1, 12).setValue(hoy.toISOString().split('T')[0]);
          recordatoriosEnviadosUsuario++;
        }

        if (debeNotificarProveedor && provCorreo) {
          enviarCorreoRequerimientoProveedor(provCorreo, provNombre, folioOC, numParc, montoPagado, fechaPagoRealStr);
          sheetParc.getRange(i + 1, 13).setValue(hoy.toISOString().split('T')[0]);
          recordatoriosEnviadosProveedor++;
        }

        logDetalle.push({
          idParcialidad: idParc,
          folioOC: folioOC,
          proveedor: provNombre,
          diasDesdePago: diasDesdePago,
          notificoUsuario: debeNotificarUsuario,
          notificoProveedor: debeNotificarProveedor
        });
      }
    }
  }

  return {
    success: true,
    totalAlertasUsuario: recordatoriosEnviadosUsuario,
    totalAlertasProveedor: recordatoriosEnviadosProveedor,
    detalle: logDetalle
  };
}

// ---------------------------------------------------
// 6. FUNCIONES DE CORREO (PLANTILLAS EJECUTIVAS)
// ---------------------------------------------------
function enviarCorreoAlertaUsuario(idParc, folioOC, proveedor, monto, fechaPago, dias) {
  const correoAdmin = Session.getActiveUser().getEmail() || "admin@empresa.com";
  const asunto = `🚨 [URGENTE CADA 2 DÍAS] Complemento de Pago (REP) Pendiente: ${folioOC} - ${proveedor}`;
  const cuerpoHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #d63939; color: white; padding: 18px 24px;">
        <h3 style="margin: 0; font-size: 18px;">Alerta Interna: Proveedor en Incumplimiento de Factura REP</h3>
      </div>
      <div style="padding: 24px; color: #334155; line-height: 1.6;">
        <p>Hola,</p>
        <p>El sistema te recuerda que se cubrió una parcialidad y <strong>aún no se ha recibido el Recibo Electrónico de Pago (REP / Complemento)</strong> del proveedor:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 18px 0; background: #f8fafc;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #cbd5e1;"><strong>Orden de Compra:</strong></td><td style="padding: 8px; border-bottom: 1px solid #cbd5e1;">${folioOC}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #cbd5e1;"><strong>Parcialidad:</strong></td><td style="padding: 8px; border-bottom: 1px solid #cbd5e1;">${idParc}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #cbd5e1;"><strong>Proveedor:</strong></td><td style="padding: 8px; border-bottom: 1px solid #cbd5e1;">${proveedor}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #cbd5e1;"><strong>Monto Pagado:</strong></td><td style="padding: 8px; border-bottom: 1px solid #cbd5e1;">$${Number(monto).toLocaleString('es-MX', {minimumFractionDigits: 2})} MXN</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #cbd5e1;"><strong>Fecha de Transferencia:</strong></td><td style="padding: 8px; border-bottom: 1px solid #cbd5e1;">${fechaPago}</td></tr>
          <tr><td style="padding: 8px;"><strong>Días Transcurridos:</strong></td><td style="padding: 8px; color: #d63939; font-weight: bold;">${dias} días sin REP</td></tr>
        </table>
        <p style="font-size: 13px; color: #64748b;">(Esta alerta se emitirá <strong>cada 2 días</strong> hasta que el proveedor adjunte el XML/PDF del REP en el sistema).</p>
      </div>
    </div>
  `;
  enviarEmailUniversal(correoAdmin, asunto, cuerpoHtml);
}

function enviarCorreoRequerimientoProveedor(correoProv, provNombre, folioOC, numParc, monto, fechaPago) {
  const asunto = `⚠️ [REQUERIMIENTO SEMANAL] Complemento de Pago (REP) Pendiente - OC ${folioOC}`;
  const cuerpoHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #0054a6; color: white; padding: 18px 24px;">
        <h3 style="margin: 0; font-size: 18px;">Requerimiento Formal de Complemento de Recepción de Pagos (REP)</h3>
      </div>
      <div style="padding: 24px; color: #1e293b; line-height: 1.6;">
        <p>Estimado(a) <strong>${provNombre}</strong>,</p>
        <p>Hacemos referencia a la transferencia bancaria realizada correspondiente a su cotización y Orden de Compra:</p>
        <ul style="background: #f1f5f9; padding: 16px 30px; border-radius: 6px;">
          <li><strong>Orden de Compra:</strong> ${folioOC}</li>
          <li><strong>Parcialidad Abonada:</strong> ${numParc}</li>
          <li><strong>Monto Liquidado:</strong> $${Number(monto).toLocaleString('es-MX', {minimumFractionDigits: 2})} MXN</li>
          <li><strong>Fecha de Pago Realizada:</strong> ${fechaPago}</li>
        </ul>
        <p>De conformidad con las disposiciones fiscales aplicables (Artículo 29-A del CFF), le solicitamos atentamente <strong>emitir y remitir el CFDI con Complemento para Recepción de Pagos (REP)</strong> a la brevedad posible.</p>
        <p style="font-size: 13px; color: #64748b;">Por favor responda a este correo adjuntando el archivo XML y PDF de dicho complemento fiscal.</p>
      </div>
    </div>
  `;
  enviarEmailUniversal(correoProv, asunto, cuerpoHtml);
}

function enviarEmailUniversal(destinatario, asunto, htmlBody) {
  try {
    if (typeof GmailApp !== "undefined") {
      GmailApp.sendEmail(destinatario, asunto, "", { htmlBody: htmlBody });
    } else {
      MailApp.sendEmail({ to: destinatario, subject: asunto, htmlBody: htmlBody });
    }
  } catch (err) {
    Logger.log("Aviso enviando correo: " + err);
  }
}

// ---------------------------------------------------
// 7. AUXILIARES DE CÁLCULO Y DRIVE
// ---------------------------------------------------
function generarFechasAmortizacion(montoTotal, numMeses, diaPagoMes, fechaInicio) {
  const plan = [];
  const montoPorPago = Math.round((montoTotal / numMeses) * 100) / 100;
  let saldoAcum = montoTotal;

  let baseDate = fechaInicio ? new Date(fechaInicio) : new Date();

  for (let i = 0; i < numMeses; i++) {
    let year = baseDate.getFullYear();
    let month = baseDate.getMonth() + i;

    // Ajustar año y mes si se excede diciembre
    const targetDate = new Date(year, month, diaPagoMes);
    const fechaISO = Utilities.formatDate(targetDate, Session.getScriptTimeZone() || "GMT-6", "yyyy-MM-dd");

    let cuota = montoPorPago;
    if (i === numMeses - 1) {
      cuota = Math.round(saldoAcum * 100) / 100; // Ajuste de centavos en la última cuota
    }
    saldoAcum -= cuota;

    plan.push({
      fechaProgramada: fechaISO,
      monto: cuota
    });
  }
  return plan;
}

function actualizarSaldosOC(folioOC) {
  const ss = getSpreadsheet();
  const sheetOC = ss.getSheetByName("OC_Parcialidades");
  const sheetParc = ss.getSheetByName("Calendario_Pagos");

  const dataOC = sheetOC.getDataRange().getValues();
  const dataParc = sheetParc.getDataRange().getValues();

  let filaOC = -1;
  let montoTotal = 0;

  for (let i = 1; i < dataOC.length; i++) {
    if (dataOC[i][0] === folioOC) {
      filaOC = i + 1;
      montoTotal = parseFloat(dataOC[i][5]) || 0;
      break;
    }
  }

  if (filaOC === -1) return;

  let sumPagado = 0;
  let totalParcs = 0;
  let pagadasCount = 0;
  let repsPendientes = 0;

  for (let j = 1; j < dataParc.length; j++) {
    if (dataParc[j][1] === folioOC) {
      totalParcs++;
      const pagado = parseFloat(dataParc[j][6]) || 0;
      sumPagado += pagado;
      if (dataParc[j][8] === "PAGADO") pagadasCount++;
      if (dataParc[j][9] === "PENDIENTE") repsPendientes++;
    }
  }

  const saldoRestante = Math.max(0, montoTotal - sumPagado);
  sheetOC.getRange(filaOC, 7).setValue(sumPagado);
  sheetOC.getRange(filaOC, 8).setValue(saldoRestante);

  let estatus = "ACTIVA_EN_PAGO";
  if (saldoRestante === 0) {
    estatus = (repsPendientes === 0) ? "CERRADA_CON_REPS" : "PAGADA_PENDIENTE_REPS";
  }
  sheetOC.getRange(filaOC, 11).setValue(estatus);
}

function asegurarHojasEstructura(ss) {
  let sheetOC = ss.getSheetByName("OC_Parcialidades");
  if (!sheetOC) {
    sheetOC = ss.insertSheet("OC_Parcialidades");
    sheetOC.appendRow([
      "Folio_OC", "Proveedor", "RFC", "Correo", "Concepto",
      "Monto_Total", "Total_Abonado", "Saldo_Pendiente",
      "Plazo_Meses", "Dia_Pago", "Estatus", "Fecha_Creacion", "Factura_Global_URL", "Carpeta_Drive"
    ]);
  }

  let sheetParc = ss.getSheetByName("Calendario_Pagos");
  if (!sheetParc) {
    sheetParc = ss.insertSheet("Calendario_Pagos");
    sheetParc.appendRow([
      "ID_Parcialidad", "Folio_OC", "Num_Parcialidad", "Fecha_Programada", "Monto_Programado",
      "Fecha_Pago_Real", "Monto_Pagado_Real", "Comprobante_URL", "Estatus_Pago", "Estatus_REP",
      "REP_URL", "Ultimo_Rec_Usuario", "Ultimo_Rec_Proveedor", "Proveedor", "Correo_Proveedor"
    ]);
  }
}

function obtenerCarpetaOC(folioOC) {
  let iter = DriveApp.getFoldersByName("CONTROL_PARCIALIDADES_OC");
  let carpetaRaiz = iter.hasNext() ? iter.next() : DriveApp.createFolder("CONTROL_PARCIALIDADES_OC");
  let iterOC = carpetaRaiz.getFoldersByName(folioOC);
  return iterOC.hasNext() ? iterOC.next() : carpetaRaiz.createFolder(folioOC);
}

function guardarArchivoDriveBlob(carpetaTarget, fileObj, nombreDeseado) {
  let decoded = Utilities.base64Decode(fileObj.data);
  let blob = Utilities.newBlob(decoded, fileObj.mimeType || "application/octet-stream", nombreDeseado + "_" + (fileObj.name || "archivo.pdf"));
  let archivo = carpetaTarget.createFile(blob);
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return archivo.getUrl();
}

function formatearFechaString(d) {
  if (!d) return "";
  if (d instanceof Date) return Utilities.formatDate(d, Session.getScriptTimeZone() || "GMT-6", "yyyy-MM-dd");
  return d.toString().split('T')[0];
}

function respuestaJSON(obj, code) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
