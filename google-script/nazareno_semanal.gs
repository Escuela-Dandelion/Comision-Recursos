// ============================================================
// RESUMEN SEMANAL — Nazareno (pedido a pedido)
// Corre cada jueves y envía a Franco Alini el resumen semanal.
// Setup: correr activarResumenNazareno() UNA VEZ desde el editor.
// ============================================================

var NAZARENO_EMAIL    = 'francoalini@gmail.com';
var NAZARENO_MARCA    = 'NAZARENO';
var NAZARENO_CC       = 'robertson.ine@gmail.com';
var NAZARENO_SHEET_ID = '1-57n6RmTFQjwNFVYxNPzll8MMuV4NvXXx5v0wTvR_6g';

function enviarResumenNazareno() {
  var ss    = SpreadsheetApp.openById(NAZARENO_SHEET_ID);
  var sheet = ss.getSheetByName('Ventas');
  if (!sheet) { Logger.log('Hoja Ventas no encontrada'); return; }
  var data = sheet.getDataRange().getValues();
  var hoy = new Date();

  // desde: último jueves a las 9:00hs
  var dow = hoy.getDay(); // 0=Dom … 4=Jue … 6=Sab
  var diasDesdeJueves = (dow + 7 - 4) % 7;
  if (diasDesdeJueves === 0 && hoy.getHours() < 19) diasDesdeJueves = 7;
  var desdeFecha = new Date(hoy);
  desdeFecha.setDate(desdeFecha.getDate() - diasDesdeJueves);
  desdeFecha.setHours(19, 0, 0, 0);

  // hasta: hoy a las 19:00
  var hastaFecha = new Date(hoy);
  hastaFecha.setHours(19, 0, 0, 0);

  // porFamilia: { key: { nombre, email, totalPesos, items:[{producto,cant,subtotal}] } }
  // porVariante: { producto: totalUnidades }
  var porFamilia  = {};
  var porVariante = {};
  var totalGeneral = 0;
  var totalPesos   = 0;
  var pedidosSet   = {};

  for (var r = 1; r < data.length; r++) {
    var row   = data[r];
    var fecha = row[0] ? new Date(row[0]) : null;
    if (!fecha || fecha < desdeFecha || fecha >= hastaFecha) continue;
    if (String(row[12]||'').trim().toUpperCase() !== NAZARENO_MARCA) continue;

    var pedido   = String(row[1]||'');
    var familia  = String(row[3]||'Sin nombre');
    var email    = String(row[4]||'');
    var producto = String(row[5]||'');
    var cantidad = parseFloat(row[7])||1;
    var precioU  = parseFloat(row[8])||0;
    var subtotal = cantidad * precioU;

    var key = familia + '||' + email;
    if (!porFamilia[key]) porFamilia[key] = { nombre: familia, email: email, totalPesos: 0, items: [], pedidosMap: {} };
    porFamilia[key].totalPesos += subtotal;
    porFamilia[key].items.push({ producto: producto, cant: cantidad, subtotal: subtotal });
    if (!porFamilia[key].pedidosMap[pedido]) porFamilia[key].pedidosMap[pedido] = fecha;

    porVariante[producto] = (porVariante[producto] || 0) + cantidad;
    totalGeneral += cantidad;
    totalPesos   += subtotal;
    pedidosSet[pedido] = true;
  }

  var familias  = Object.keys(porFamilia);
  var variantes = Object.keys(porVariante);
  if (familias.length === 0) { Logger.log('Sin pedidos NAZARENO — no se envía.'); return; }

  var tz       = 'America/Argentina/Cordoba';
  var desdeStr = Utilities.formatDate(desdeFecha, tz, 'dd/MM') + ' 19hs';
  var hastaStr = Utilities.formatDate(hastaFecha, tz, 'dd/MM/yyyy') + ' 19hs';
  var rangoStr = 'del ' + desdeStr + ' al ' + hastaStr;
  var totalPedidos = Object.keys(pedidosSet).length;

  function pesos(n) { return '$ ' + n.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2}); }

  // ── Resumen de variantes ─────────────────────────────────
  var sumRows = '';
  variantes.forEach(function(v) {
    sumRows +=
      '<tr>' +
        '<td style="padding:6px 8px;font-size:13px;">' + v + '</td>' +
        '<td style="padding:6px 8px;font-size:13px;text-align:right;font-weight:700;color:#15803d;white-space:nowrap;">' + porVariante[v] + ' u.</td>' +
      '</tr>';
  });

  // ── Detalle por familia ──────────────────────────────────
  var TH = 'background:#dbeafe;color:#1e3a5f;font-size:11px;font-weight:700;text-transform:uppercase;padding:9px 12px;text-align:';
  var TD = 'padding:10px 12px;font-size:13px;border-bottom:1px solid #f1f5f9;';

  var detalle = '';
  familias.forEach(function(key) {
    var fam = porFamilia[key];
    var filas = '';
    fam.items.forEach(function(item, i) {
      var borderB = (i < fam.items.length - 1) ? 'border-bottom:1px solid #f1f5f9;' : '';
      filas +=
        '<tr>' +
          '<td style="padding:10px 12px;font-size:13px;' + borderB + '">' + item.producto + '</td>' +
          '<td style="padding:10px 12px;font-size:13px;font-weight:700;text-align:right;white-space:nowrap;' + borderB + '">' + item.cant + ' u.</td>' +
        '</tr>';
    });
    var pedidoNums = Object.keys(fam.pedidosMap);
    var pedidoInfo = '';
    for (var pi = 0; pi < pedidoNums.length; pi++) {
      if (pi > 0) pedidoInfo += ' &nbsp;&#124;&nbsp; ';
      var pNum = pedidoNums[pi];
      var pFecha = fam.pedidosMap[pNum];
      pedidoInfo += 'Pedido #' + pNum + ' &middot; ' + Utilities.formatDate(new Date(pFecha), tz, 'dd/MM HH:mm') + 'hs';
    }
    detalle +=
      '<div style="margin:24px 0 4px;">' +
        '<span style="font-size:16px;font-weight:700;color:#1e3a5f;">' + fam.nombre + '</span>' +
        '<div style="font-size:12px;color:#94a3b8;margin-top:3px;">' + pedidoInfo + '</div>' +
      '</div>' +
      '<table style="width:100%;border-collapse:collapse;">' +
        '<thead><tr>' +
          '<th style="' + TH + 'left;">Producto</th>' +
          '<th style="' + TH + 'right;">Cant.</th>' +
        '</tr></thead>' +
        '<tbody>' + filas + '</tbody>' +
      '</table>';
  });

  // ── HTML completo ────────────────────────────────────────
  var html =
    '<html><body style="margin:0;padding:16px;background:#f1f5f9;font-family:Arial,sans-serif;">' +
    '<div style="max-width:700px;margin:0 auto;background:#ffffff;">' +

    '<div style="background:#14532d;padding:28px 32px;">' +
      '<h1 style="margin:0 0 4px;font-size:20px;color:#ffffff;">📦 Pedidos Nazareno — ' + rangoStr + '</h1>' +
      '<p style="margin:0;font-size:13px;color:#bbf7d0;">' + totalGeneral + ' unidades · ' + totalPedidos + ' pedido' + (totalPedidos!==1?'s':'') + '</p>' +
    '</div>' +

    '<div style="padding:24px 32px 0;">' +
      '<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:16px 20px;">' +
        '<p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#15803d;">Resumen por variante</p>' +
        '<table style="width:100%;border-collapse:collapse;">' + sumRows + '</table>' +
        '<table style="width:100%;border-collapse:collapse;border-top:1px solid #bbf7d0;margin-top:12px;">' +
          '<tr>' +
            '<td style="padding-top:12px;font-size:13px;font-weight:700;color:#15803d;">Total del pedido</td>' +
            '<td style="padding-top:12px;font-size:15px;font-weight:700;color:#15803d;text-align:right;white-space:nowrap;">' + pesos(totalPesos) + '</td>' +
          '</tr>' +
        '</table>' +
      '</div>' +
    '</div>' +

    '<div style="padding:24px 32px 32px;">' +
      '<p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#1e3a5f;border-top:1px solid #e2e8f0;padding-top:20px;">' +
        'Detalle por familia — qué le entregamos a cada una' +
      '</p>' +
      detalle +
    '</div>' +

    '<div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 32px;font-size:12px;color:#94a3b8;">' +
      'Envío automático · Tienda Diente de León · ' +
      '<a href="https://escuela-dandelion.github.io/Comision-Recursos/dashboard-referentes.html" style="color:#16a34a;text-decoration:none;">Dashboard referentes ↗</a>' +
    '</div>' +

    '</div></body></html>';

  MailApp.sendEmail({
    to:       NAZARENO_EMAIL,
    cc:       NAZARENO_CC,
    subject:  '📦 Pedidos Nazareno — ' + rangoStr,
    body:     'Ver versión HTML.',
    htmlBody: html
  });

  Logger.log('Mail enviado — ' + variantes.length + ' variantes, ' + familias.length + ' familias.');
}

function activarResumenNazareno() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'enviarResumenNazareno') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarResumenNazareno')
    .timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(19).create();
  Logger.log('Trigger activado: todos los jueves a las 19hs.');
}

function testResumenNazareno() {
  var orig = NAZARENO_EMAIL;
  NAZARENO_EMAIL = 'robertson.ine@gmail.com';
  enviarResumenNazareno();
  NAZARENO_EMAIL = orig;
}
