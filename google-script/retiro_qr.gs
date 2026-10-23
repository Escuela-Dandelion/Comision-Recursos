// v2026-10-21 — Stock por ubicación (Primario/Secundario), permisos FGP, Franco como FGP
var CONFIG = {
  STORE_ID:        '7396246',
  API_TOKEN:       'e3d744d94ddbf13317bef0082c53e2c46fb50631',
  SECRET:          'retiro2026',
  TIENDA_NOMBRE:   'Diente de León',
  STAFF_TOKEN:     'test',
  VENTAS_SHEET_ID: '1-57n6RmTFQjwNFVYxNPzll8MMuV4NvXXx5v0wTvR_6g',

  // Tasas de costo de procesamiento por método de pago (TiendaNube no las expone en la API)
  // Actualizar aquí cuando cambien las tarifas
  GATEWAY_FEES: {
    'wire_transfer': 0.01815,  // Transferencia bancaria vía Pago Nube: 1.815%
  },

  // Datos de pago por proveedor (alias/CBU para transferencia)
  // Clave = nombre de marca en TiendaNube (uppercase) o nombre del proveedor
  ALIAS_PAGO: {
    'YEMARI':             { alias: 'Yerba.yemari',        titular: 'Claudio Daniel Avila Moyano', banco: 'Mercado Pago', cbu: '00000031000040988897724' },
    'LA YAYA':            { alias: 'MUNDO.TACO.LANA',     titular: 'Mariela Isabel Conci', banco: 'Banco Galicia', cbu: '0070362630004011663770' },
    'PARAISA':            { alias: 'Paraisabiocosmetica',  titular: '',                    banco: '',              cbu: '' },
    'CABALLO NEGRO':      { alias: 'TOPE.POROTO.RUBIO',    titular: 'Gabriel Alejandro Michalec', banco: '', cbu: '2850006540094869600518' },
    'GUARDIANES COLMENA': { alias: '',                      titular: 'Alejandro Sánchez Penak', banco: 'Mercado Pago', cbu: '0000003100017116879020' },
    'EL MAITEN':          { alias: 'El.maiten2025',          titular: '',                    banco: '',              cbu: '' },
    'ODDIS':              { alias: '',                      titular: 'Rece SA',             banco: 'Mercado Pago',  cbu: '0000003100008850705997' },
    'NAZARENO':           { alias: 'Lapaz293',              titular: 'Franco Alini (intermediario)', banco: '', cbu: '' },
    'GROEN':              { alias: '',                      titular: 'Daniel Elías González', banco: 'Banco Santander Río', cbu: '0720242388000036973204' },
    'MIX Y FRUTOS SECOS': { alias: '',                      titular: '',                    banco: '',              cbu: '' }
  },

  // Tel de Inés para WhatsApp de "Solicitar Pago"
  INES_TEL: '5493512112050',

  // Nombres que aparecen en el dropdown de confirmación de entrega QR
  // IDs de productos digitales (no requieren envío físico ni QR)
  // Agregar acá cada nuevo producto digital creado en TiendaNube
  DIGITAL_PRODUCT_IDS: ['371016918'],

  STAFF_NAMES: [
    'Yuliana.Longhi',
    'Maria.Martini',
    'Amanda.Benedi',
    'Ines.Robertson',
    'Delfina.Salvetti',
    'Dolo.Dominguez',
    'Gaby.Dominguez',
    'Juan.Diaz',
    'Karina',
    'Monica.Chesta',
    'Paola',
    'Pia',
    'Sabi',
    'Yana',
    'Elina',
    'Claudio',
    'Ines.Vasquez'
  ]

};

var LOGO_B64 = "https://escuela-dandelion.github.io/Comision-Recursos/Logo_Diente_de_Leon.png";

// ═══════════════════════════════════════════════════════════
//  PUNTO DE RETIRO — Tiendanube + QR automático
// ═══════════════════════════════════════════════════════════


// ──────────────────────────────────────────────────────────
// ENTRY POINTS
// ──────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var body   = JSON.parse(e.postData.contents);
    var action = body.action || '';

    if (action === 'update_producto') {
      var res = apiUpdateProducto(body.email || '', body.producto_id || '', body.nombre, body.descripcion);
      return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
    }
    if (action === 'update_variante') {
      var res = apiUpdateVariante(body.email || '', body.producto_id || '', body.variante_id || '', body.precio, body.precio_promo, body.costo, body.stock);
      return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
    }
    if (action === 'update_imagen') {
      var res = apiUpdateImagen(body.email || '', body.producto_id || '', body.base64 || '', body.mime_type || 'image/jpeg');
      return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
    }

    // Webhook de TiendaNube
    var evento  = body.event || '';
    var orderId = String(body.id);
    if (evento === 'order/paid' || evento === 'order/updated') {
      var order = fetchOrder(orderId);
      if (order && order.payment_status === 'paid' && !yaFueEnviado(orderId)) {
        var partes = separarProductos(order);
        if (partes.digitales.length > 0) {
          registrarEnDigitales(order, partes.digitales);
        }
        if (partes.fisicos.length > 0) {
          var ordenFisica = JSON.parse(JSON.stringify(order));
          ordenFisica.products = partes.fisicos;
          procesarPedido(ordenFisica);
        } else {
          Logger.log('Orden #' + order.number + ' es solo digital — sin QR.');
        }
      }
    }
    return ContentService.createTextOutput('OK');
  } catch(err) {
    Logger.log('doPost error: ' + err);
    return ContentService.createTextOutput('error');
  }
}

// Detecta si un producto del line item de la orden es digital.
// TiendaNube no expone requires_shipping en los line items de órdenes,
// por lo que usamos la lista explícita de IDs + fallback por peso/dimensiones = 0.
function esProductoDigital(p) {
  if (CONFIG.DIGITAL_PRODUCT_IDS.indexOf(String(p.product_id)) !== -1) return true;
  return parseFloat(p.weight || 0) === 0
      && parseFloat(p.depth  || 0) === 0
      && parseFloat(p.height || 0) === 0
      && parseFloat(p.width  || 0) === 0;
}

// Separa productos físicos y digitales de una orden.
// Retorna { fisicos: [...], digitales: [...] }
function separarProductos(order) {
  var fisicos   = [];
  var digitales = [];
  (order.products || []).forEach(function(p) {
    if (esProductoDigital(p)) digitales.push(p);
    else fisicos.push(p);
  });
  return { fisicos: fisicos, digitales: digitales };
}

function getDigitalesSheet() {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Digitales');
  if (!sheet) {
    sheet = ss.insertSheet('Digitales');
    sheet.appendRow(['Fecha','Pedido #','ID Interno','Nombre','Email','Producto','SKU','Cantidad','Precio Unit.','Total Línea','Total Pedido','Método Pago']);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
  }
  return sheet;
}

function yaFueRegistradoDigital(orderId) {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Digitales');
  if (!sheet) return false;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][2]) === String(orderId)) return true;
  }
  return false;
}

function registrarEnDigitales(order, productosDigitales) {
  if (yaFueRegistradoDigital(order.id)) {
    Logger.log('Digitales: pedido #' + order.number + ' ya registrado, se omite.');
    return;
  }
  try {
    var sheet  = getDigitalesSheet();
    var fecha  = order.created_at ? new Date(order.created_at) : new Date();
    var paymentMethod = (order.payment_details && order.payment_details.method) || '';
    // Agrupar por variante para consolidar si compran N unidades del mismo producto
    var agrupados = {};
    productosDigitales.forEach(function(p) {
      var key = String(p.product_id || '') + '_' + String(p.variant_id || '') + '_' + String(p.sku || '');
      if (agrupados[key]) {
        agrupados[key].qty += (p.quantity || 1);
      } else {
        var nombre = (typeof p.name === 'object')
          ? (p.name.es || p.name.pt || Object.values(p.name)[0] || '')
          : (p.name || '');
        agrupados[key] = { nombre: nombre, sku: p.sku || '', qty: p.quantity || 1, precioUnit: parseFloat(p.price || 0) };
      }
    });
    Object.keys(agrupados).forEach(function(key) {
      var g = agrupados[key];
      sheet.appendRow([
        fecha,
        order.number,
        String(order.id),
        order.contact_name  || '',
        order.contact_email || '',
        g.nombre,
        g.sku,
        g.qty,
        g.precioUnit,
        g.precioUnit * g.qty,
        parseFloat(order.total || 0),
        paymentMethod
      ]);
    });
    Logger.log('Digitales: ' + Object.keys(agrupados).length + ' fila(s) para pedido #' + order.number);
  } catch(err) {
    Logger.log('Error registrarEnDigitales: ' + err);
  }
}

function doGet(e) {
  try {
    return doGetInterno(e);
  } catch(err) {
    Logger.log('doGet error: ' + err + ' | stack: ' + err.stack);
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:24px;color:red">' +
      '<strong>Error:</strong> ' + err.message + '</div>'
    );
  }
}

function doGetInterno(e) {
  var action    = e.parameter.action    || '';
  var orderId   = e.parameter.id        || '';
  var token     = e.parameter.token     || '';
  var pass      = e.parameter.pass      || '';
  var staffName = e.parameter.staff     || '';
  var entregado = e.parameter.entregado || '';

  if (action === 'version') {
    return ContentService.createTextOutput('Version_1.6_digitales');
  }

  if (action === 'portal') {
    if (pass !== CONFIG.STAFF_TOKEN) {
      return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;color:red">Acceso no autorizado.</p>');
    }
    return paginaPortalStaff(entregado === '1');
  }

  // Endpoint JSON para verificación de PIN desde el cliente (AJAX)
  if (action === 'api_entregar') {
    var notasParam   = e.parameter.notas   || '';
    var emailParam   = e.parameter.email   || '';
    var parcialParam = e.parameter.parcial === '1';
    var resultado = apiEntregar(orderId, staffName, pass, token, notasParam, emailParam, parcialParam);
    return ContentService
      .createTextOutput(JSON.stringify(resultado))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Entrega directa desde el portal (admin, sin QR) — muestra el formulario de PIN
  if (action === 'entregar_admin') {
    if (pass !== CONFIG.STAFF_TOKEN) {
      return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;color:red">Acceso no autorizado.</p>');
    }
    return paginaConfirmar(orderId, generarToken(orderId), null, pass);
  }

  if (action === 'addNotasRetiro') {
    var ordId  = e.parameter.id    || '';
    var notas  = e.parameter.notas || '';
    var sheet  = getSheet();
    var data   = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(ordId)) {
        sheet.getRange(i + 1, 10).setValue(notas);
        _invalidarCacheRetiros();
        return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Pedido no encontrado' })).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'getRetiros') {
    var estadoFiltro = e.parameter.estado || '';  // 'Pendiente', 'Entregado', o '' = todos
    var diasFiltro   = parseInt(e.parameter.dias || '0');
    var retiros = getRetirosData(estadoFiltro, diasFiltro);
    return ContentService.createTextOutput(JSON.stringify({ ok: true, retiros: retiros }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'api_auth') {
    var res = apiAuthEmail(e.parameter.email || '');
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'api_dashboard') {
    var res = apiDashboard(e.parameter.email || '');
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'api_aportes') {
    var res = apiAportes();
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'api_digitales') {
    var res = apiDigitales(e.parameter.email || '');
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'api_productos') {
    var res = apiProductos(e.parameter.email || '');
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'update_producto') {
    var res = apiUpdateProducto(e.parameter.email || '', e.parameter.producto_id || '', e.parameter.nombre, e.parameter.descripcion);
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'update_variante') {
    var res = apiUpdateVariante(e.parameter.email || '', e.parameter.producto_id || '', e.parameter.variante_id || '', e.parameter.precio, e.parameter.precio_promo, e.parameter.costo, e.parameter.stock);
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'update_stock_ubicaciones') {
    var res = apiUpdateStockUbicaciones(
      e.parameter.email        || '',
      e.parameter.producto_id  || '',
      e.parameter.variante_id  || '',
      e.parameter.nombre_variante || '',
      e.parameter.stock_p,
      e.parameter.stock_s,
      e.parameter.stock_total_anterior
    );
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'saveStockOverride') {
    try {
      var clave   = e.parameter.clave || '';
      var nomVar  = e.parameter.nombre_variante || '';
      var umbralV = (e.parameter.umbral !== undefined && e.parameter.umbral !== '') ? parseInt(e.parameter.umbral) : null;
      var pisoV   = (e.parameter.piso   !== undefined && e.parameter.piso   !== '') ? parseInt(e.parameter.piso)   : null;
      var ss2  = SpreadsheetApp.openById(CONFIG_STOCK.SHEET_ID);
      var sh2  = ss2.getSheetByName('ConfigStock');
      if (!sh2) { sh2 = ss2.insertSheet('ConfigStock'); sh2.appendRow(['Clave','Nombre','Umbral Override','Piso Override']); }
      var dat2 = sh2.getDataRange().getValues();
      var found2 = false;
      for (var k = 1; k < dat2.length; k++) {
        if (String(dat2[k][0]).trim() === clave) {
          sh2.getRange(k + 1, 3).setValue(umbralV !== null ? umbralV : '');
          sh2.getRange(k + 1, 4).setValue(pisoV   !== null ? pisoV   : '');
          found2 = true; break;
        }
      }
      if (!found2) sh2.appendRow([clave, nomVar, umbralV !== null ? umbralV : '', pisoV !== null ? pisoV : '']);
      _invalidarCacheProductos(e.parameter.email || '');
      return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
    } catch(err2) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err2) })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (action === 'preview_informe') {
    return previewInformeMensual(e.parameter.mes || '');
  }

  // ── AUTH para admin.html ──────────────────────────────────

  if (action === 'verificarEmail') {
    var res = apiVerificarEmail(e.parameter.email || '');
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'sendOTP') {
    var res = apiSendOTP(e.parameter.tel || '');
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'verifyOTP') {
    var res = apiVerifyOTP(e.parameter.tel || '', e.parameter.code || '');
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'api_verificar') {
    var res = apiVerificar(orderId, token);
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }

  if (!orderId || !verificarToken(orderId, token)) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px;color:red">QR inválido o expirado.</p>');
  }

  if (action === 'verificar') {
    var adminUrl = 'https://escuela-dandelion.github.io/Comision-Recursos/admin.html?view=qr&id='
                   + encodeURIComponent(orderId) + '&token=' + encodeURIComponent(token);
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#f0fdf4;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}' +
      '.card{background:#fff;border-radius:16px;padding:32px 24px;max-width:360px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.1)}' +
      'img{width:80px;margin-bottom:16px}.title{font-size:20px;font-weight:800;color:#166534;margin-bottom:8px}.sub{font-size:14px;color:#6b7280;margin-bottom:28px}' +
      '.btn{display:block;width:100%;padding:16px;background:#2d5a27;color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;cursor:pointer}</style></head>' +
      '<body><div class="card">' +
      '<img src="https://escuela-dandelion.github.io/Comision-Recursos/Logo_Diente_de_Leon_transparent.png">' +
      '<div class="title">✅ Pedido listo para confirmar</div>' +
      '<div class="sub">Tocá el botón para registrar la entrega</div>' +
      '<button class="btn" onclick="window.open(\'' + adminUrl.replace(/'/g, "\\'") + '\',\'_blank\')">Confirmar entrega →</button>' +
      '<button onclick="window.close()" style="margin-top:12px;width:100%;padding:12px;background:none;border:1px solid #d1d5db;border-radius:10px;font-size:14px;color:#6b7280;cursor:pointer">✕ Cerrar</button>' +
      '</div></body></html>'
    ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (action === 'confirmar')  return paginaConfirmar(orderId, token);

  return HtmlService.createHtmlOutput('<p>URL inválida.</p>');
}


// ──────────────────────────────────────────────────────────
// LÓGICA PRINCIPAL
// ──────────────────────────────────────────────────────────

function procesarPedido(order) {
  var orderId    = String(order.id);
  var buyerEmail = order.contact_email;
  var buyerName  = (order.contact_name || 'comprador').split(' ')[0];
  var productos  = order.products.map(function(p) {
    return p.quantity + 'x ' + p.name;
  }).join('\n');

  var token     = generarToken(orderId);
  var verifyUrl = 'https://escuela-dandelion.github.io/Comision-Recursos/admin.html?view=qr&id='
                  + encodeURIComponent(orderId) + '&token=' + encodeURIComponent(token);
  var qrApiUrl  = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=L&margin=1&data='
                  + encodeURIComponent(verifyUrl);
  var qrBlob    = UrlFetchApp.fetch(qrApiUrl).getBlob().setName('qr.png').setContentType('image/png');

  enviarEmail(buyerEmail, buyerName, order, qrBlob, productos);
  registrarEnSheet(order, token);
  registrarEnVentas(order);

  Logger.log('Pedido #' + order.number + ' procesado OK — email enviado a ' + buyerEmail);
}

// ──────────────────────────────────────────────────────────
// TIENDANUBE API
// ──────────────────────────────────────────────────────────

// Trae pedidos de TiendaNube con payment_status=pending (cliente aún no pagó)
function fetchPendingPaymentOrders() {
  var url = 'https://api.tiendanube.com/v1/' + CONFIG.STORE_ID + '/orders?payment_status=pending&per_page=50';
  var resp = UrlFetchApp.fetch(url, {
    headers: {
      'Authentication': 'bearer ' + CONFIG.API_TOKEN,
      'User-Agent': CONFIG.TIENDA_NOMBRE + ' (retiro-automatico)'
    },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) return [];
  var orders = JSON.parse(resp.getContentText());
  return (orders || []).filter(function(o) { return o.status !== 'cancelled'; });
}

function fetchOrder(orderId) {
  var url  = 'https://api.tiendanube.com/v1/' + CONFIG.STORE_ID + '/orders/' + orderId;
  var resp = UrlFetchApp.fetch(url, {
    headers: {
      'Authentication': 'bearer ' + CONFIG.API_TOKEN,
      'User-Agent': CONFIG.TIENDA_NOMBRE + ' (retiro-automatico)',
    },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    Logger.log('fetchOrder error ' + resp.getResponseCode() + ': ' + resp.getContentText());
    return null;
  }
  return JSON.parse(resp.getContentText());
}

// ──────────────────────────────────────────────────────────
// EMAIL AL COMPRADOR
// ──────────────────────────────────────────────────────────

function formatearGrado(g) {
  if (!g) return '';
  var s = String(g).trim();
  if (s === 'J' || s.toLowerCase().indexOf('jard') !== -1) return 'Jardín';
  var SUFIJOS = { '1':'er','2':'do','3':'er','4':'to','5':'to','6':'to','7':'mo','8':'vo','9':'no','10':'mo','11':'mo','12':'mo' };
  var n = parseInt(s);
  if (!isNaN(n) && SUFIJOS[String(n)]) return n + SUFIJOS[String(n)] + ' Grado';
  return s; // fallback: devuelve tal cual si no reconoce
}

function leerConfigProductos() {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('ConfigProductos');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var clave = String(data[i][0] || '').trim().toUpperCase();
    if (!clave) continue;
    var pctGrado   = (data[i][2] !== '' && data[i][2] !== null) ? parseFloat(data[i][2]) : 0;
    var pctEscuela = (data[i][3] !== '' && data[i][3] !== null && data[i][3] !== undefined) ? parseFloat(data[i][3]) : null;
    var vigente    = data[i][4] ? new Date(data[i][4]) : new Date('2000-01-01');
    rows.push({ clave: clave, pctGrado: pctGrado, pctEscuela: pctEscuela, vigente: vigente });
  }
  return rows;
}

// Devuelve la regla más reciente vigente a la fecha del pedido
function buscarRegla(configRows, clave, fechaOrden) {
  var candidatos = configRows.filter(function(r) {
    return r.clave === clave && r.vigente <= fechaOrden;
  });
  if (!candidatos.length) return null;
  candidatos.sort(function(a, b) { return b.vigente - a.vigente; });
  return candidatos[0];
}

function calcularAporteGrado(order) {
  var grado = normalizarGradoGAS(order.note || order.notes || '');
  if (!grado || grado === '(Sin observaciones)') return null;

  var configRows = leerConfigProductos();
  var fechaOrden = order.created_at ? new Date(order.created_at) : new Date();
  var montoGrado   = 0;
  var montoEscuela = 0;

  (order.products || []).forEach(function(p) {
    var precio = parseFloat(p.price || 0);
    var qty    = parseInt(p.quantity || 1);
    var sku    = String(p.sku || '').trim().toUpperCase();
    var datos  = fetchDatosDeProducto(p.product_id || '', p.variant_id || '');
    var costo  = datos.costo || 0;
    var marca  = (datos.marca || '').trim().toUpperCase();

    // Prioridad: SKU exacto → MARCA:marca → DEFAULT
    var regla = buscarRegla(configRows, sku, fechaOrden)
             || buscarRegla(configRows, 'MARCA:' + marca, fechaOrden)
             || buscarRegla(configRows, 'DEFAULT', fechaOrden)
             || null;

    if (!regla) return;
    var subtotal = precio * qty;
    montoGrado  += subtotal * regla.pctGrado;

    if (regla.pctEscuela !== null) {
      montoEscuela += subtotal * regla.pctEscuela;
    } else {
      montoEscuela += subtotal - (costo * qty) - (subtotal * regla.pctGrado);
    }
  });

  return {
    grado:        grado,
    montoGrado:   Math.round(montoGrado),
    montoEscuela: Math.max(0, Math.round(montoEscuela))
  };
}

function enviarEmail(email, nombre, order, qrBlob, productos) {
  var asunto = 'Diente de Leon - Tu QR para retirar el pedido #' + order.number;

  var bloqueGrado = '';
  var mostrarAporte = new Date() >= new Date('2026-10-01');
  var aporte = mostrarAporte ? calcularAporteGrado(order) : null;
  if (aporte && aporte.montoGrado > 0) {
    var totalCompra = parseFloat(order.total || 0);
    bloqueGrado =
      '<div style="background:#f0f7e6;border-left:4px solid #3a7d44;border-radius:6px;padding:14px 16px;margin:20px 0">' +
      '<p style="margin:0 0 10px 0;font-size:15px;color:#3a7d44"><strong>Tu aporte a la comunidad</strong></p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
      '<tr style="border-bottom:1px solid #c8e6c9"><td style="padding:4px 0;color:#888">Tu compra</td>' +
      '<td style="padding:4px 0;text-align:right;color:#888">$' + totalCompra.toLocaleString('es-AR') + '</td></tr>' +
      '<tr><td style="padding:4px 0;color:#555">Tu aporte al ' + formatearGrado(aporte.grado) + '</td>' +
      '<td style="padding:4px 0;text-align:right;font-weight:700;color:#1a5c2a">$' + aporte.montoGrado.toLocaleString('es-AR') + '</td></tr>' +
      '</table>' +
      '<p style="margin:10px 0 0 0;font-size:12px;color:#6b9e6b">¡Gracias por apoyar a la comunidad Dandelion!</p>' +
      '<p style="margin:8px 0 0 0;font-size:11px;color:#999">Este aporte fue asignado al ' + formatearGrado(aporte.grado) + ' porque lo indicaste al momento de hacer tu compra. Si elegiste un destino diferente o querés hacer alguna corrección, <a href="https://wa.me/' + CONFIG.INES_TEL + '?text=' + encodeURIComponent('Hola! Quiero consultar sobre el aporte a grado de mi pedido #' + order.number) + '" style="color:#3a7d44">escribinos por WhatsApp</a>.</p>' +
      '</div>';
  } else if (mostrarAporte) {
    bloqueGrado =
      '<div style="background:#f0f7e6;border-left:4px solid #3a7d44;border-radius:6px;padding:14px 16px;margin:20px 0">' +
      '<p style="margin:0 0 10px 0;font-size:15px;color:#3a7d44"><strong>Tu aporte a la comunidad</strong></p>' +
      '<p style="margin:0 0 10px 0;font-size:14px;color:#555;line-height:1.6">Como no indicaste un grado en especial, tu aporte fue íntegramente para la Escuela Dandelion.</p>' +
      '<p style="margin:0;font-size:11px;color:#999">Si necesitás cambiar el destino de tu aporte o tenés alguna corrección, <a href="https://wa.me/' + CONFIG.INES_TEL + '?text=' + encodeURIComponent('Hola! Quiero consultar sobre el aporte de mi pedido #' + order.number) + '" style="color:#3a7d44">escribinos por WhatsApp</a>.</p>' +
      '</div>';
  }

  var html =
    '<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px">' +
    '<div style="text-align:center;padding:16px 0 24px 0">' +
    '<img src="' + LOGO_B64 + '" style="max-width:220px;width:60%" alt="' + CONFIG.TIENDA_NOMBRE + '">' +
    '</div>' +
    '<h2 style="color:#1a1a1a">¡Hola ' + nombre + '!</h2>' +
    '<p>Tu pago fue confirmado. Guardá este QR para retirar tu pedido en el punto de retiro.</p>' +
    '<div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:20px 0">' +
    '<p style="margin:0 0 6px 0"><strong>Pedido #' + order.number + '</strong></p>' +
    '<p style="margin:0;color:#555;white-space:pre-line">' + productos + '</p>' +
    '<p style="margin:10px 0 0 0;color:#555"><strong>Total: ' + order.total + '</strong></p>' +
    '</div>' +
    bloqueGrado +
    '<div style="text-align:center;margin:28px 0">' +
    '<img src="cid:qr_code" width="200" height="200"' +
    ' style="border:1px solid #eee;padding:10px;border-radius:8px" alt="QR Retiro"/>' +
    '<p style="color:#888;font-size:13px;margin-top:8px">Mostrá este QR en el punto de retiro</p>' +
    '</div>' +
    '<p style="font-size:13px;color:#aaa">¿Preguntas? Respondé este email.</p>' +
    '</div>';

  GmailApp.sendEmail(email, asunto, '', {
    htmlBody: html,
    from: 'tiendavirtual.dientedeleon@gmail.com',
    inlineImages: { qr_code: qrBlob }
  });
}

// ──────────────────────────────────────────────────────────
// GOOGLE SHEETS
// ──────────────────────────────────────────────────────────

function getSheet() {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Retiros');
  if (!sheet) {
    sheet = ss.insertSheet('Retiros');
    sheet.appendRow(['ID interno','Pedido #','Nombre','Email','Productos','Total','Fecha','Estado','Staff','Notas','Grado','Descuento']);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,11).setFontWeight('bold');
  }
  return sheet;
}

function registrarEnSheet(order, token) {
  var sheet     = getSheet();
  var productos = order.products.map(function(p) {
    return p.quantity + 'x ' + p.name;
  }).join(' | ');

  sheet.appendRow([
    String(order.id),
    order.number,
    order.contact_name,
    order.contact_email,
    productos,
    parseFloat(order.total) || 0,
    new Date(),
    'PENDIENTE',
    '',  // col 9: Staff (se completa al entregar)
    '',  // col 10: Notas (se completa al entregar)
    normalizarGradoGAS(order.note || order.notes || ''), // col 11: Grado (normalizado)
    getOrderDiscount(order),                             // col 12: Descuento total del pedido
    getDiscountType(order)                               // col 13: Tipo de descuento (Cupón / DxC / Cupón+DxC)
  ]);
  _invalidarCacheRetiros();
}

// Normaliza col 11 (Grado) en todas las filas del sheet Retiros
function migrarGradosRetiros() {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Retiros');
  if (!sheet) { Logger.log('No existe hoja Retiros'); return; }
  var data = sheet.getDataRange().getValues();
  var actualizados = 0;
  for (var i = 1; i < data.length; i++) {
    var raw  = String(data[i][10] || '');
    var norm = normalizarGradoGAS(raw);
    if (norm !== raw) {
      sheet.getRange(i + 1, 11).setValue(norm);
      actualizados++;
      Logger.log('Fila ' + (i+1) + ': "' + raw + '" → "' + norm + '"');
    }
  }
  Logger.log('Grados normalizados: ' + actualizados + ' filas.');
}

// Corrige cols S (índice 18) y T (índice 19) del sheet Ventas con getOrderDiscount() correcto
function migrarDescuentosVentas() {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Ventas');
  if (!sheet) { Logger.log('No existe hoja Ventas'); return; }

  var data = sheet.getDataRange().getValues();
  // Construir mapa orderId → {discount, type} para no llamar la API varias veces por pedido
  var cache = {};
  var actualizados = 0;

  for (var i = 1; i < data.length; i++) {
    var orderId = String(data[i][2] || ''); // col C = ID interno (TiendaNube)
    if (!orderId) continue;
    if (!cache[orderId]) {
      var order = fetchOrder(orderId);
      if (!order) { Utilities.sleep(2000); cache[orderId] = { discount: 0, type: '' }; continue; }
      cache[orderId] = {
        discount: getOrderDiscount(order),
        type:     getDiscountType(order)
      };
      Utilities.sleep(400);
    }
    var d = cache[orderId];
    sheet.getRange(i + 1, 19).setValue(d.discount); // col S
    sheet.getRange(i + 1, 20).setValue(d.type);     // col T
    actualizados++;
  }
  Logger.log('migrarDescuentosVentas: ' + actualizados + ' filas actualizadas.');
}

// Rellena col 12 (Descuento) en filas de Retiros que no la tienen aún
function migrarDescuentosRetiros() {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Retiros');
  if (!sheet) { Logger.log('No existe hoja Retiros'); return; }

  var data = sheet.getDataRange().getValues();
  var actualizados = 0;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var orderId = String(row[0]);
    if (!orderId) continue;
    var order = fetchOrder(orderId);
    if (!order) { Utilities.sleep(2000); continue; } // pausa extra si hay error
    if (String(order.number) === '232') {
      Logger.log('DEBUG migrar #232: discount=' + order.discount +
        ' promo=' + JSON.stringify(order.promotional_discount) +
        ' discount_coupon=' + order.discount_coupon);
    }
    var discount     = getOrderDiscount(order);
    var discountType = getDiscountType(order);
    sheet.getRange(i + 1, 12).setValue(discount);
    sheet.getRange(i + 1, 13).setValue(discountType);
    actualizados++;
    Logger.log('Retiro fila ' + (i+1) + ' pedido #' + row[1] + ' discount=' + discount + ' type=' + discountType);
    Utilities.sleep(400); // ~150 pedidos × 400ms = ~60 segundos, dentro del límite
  }
  Logger.log('Migración completa. ' + actualizados + ' filas actualizadas.');
}

function getVentasSheet() {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Ventas');
  if (!sheet) {
    sheet = ss.insertSheet('Ventas');
    sheet.appendRow([
      'Fecha','Pedido #','ID Interno','Nombre','Email',
      'Producto','SKU','Cantidad','Precio Unit.','Subtotal Bruto','Total Pedido','Comentarios','Marca','Costo Unit.',
      'Total Pagado Línea','Neto Línea','Fee Procesamiento','Método Pago',
      'Descuento','Tipo Descuento',
      'Aporte Grado','Grado Destino','Aporte Escuela'
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 23).setFontWeight('bold');
  }
  return sheet;
}

// Cache por "productId:variantId" → { marca, costo }
var _prodCache = {};

// Normaliza el grado escrito libremente por el comprador
function normalizarGradoGAS(g) {
  var s = String(g || '').trim();
  if (!s) return '';
  var l = s.toLowerCase()
    .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i')
    .replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/ñ/g,'n');

  // Sin grado
  if (l === 'na' || l === 'n/a' || l === 'no aplica' || l === 'ninguno' || l === 'ninguna' || l === '-' || l === 'escuela' || l === 'para la escuela' || l === 'escuela general') return '(Sin observaciones)';

  // Jardín
  if (l.indexOf('jard') !== -1 || l.indexOf('inic') !== -1 || l === 'j') return 'J';

  // Palabras → número
  var PALABRAS = {
    'primer':1,'primero':1,'primerito':1,'1er':1,'1ro':1,
    'segundo':2,'2do':2,'2 grado':2,
    'tercer':3,'tercero':3,'3ro':3,'3er':3,
    'cuarto':4,'4to':4,
    'quinto':5,'5to':5,
    'sexto':6,'6to':6,
    'septimo':7,'setimo':7,'7mo':7,
    'octavo':8,'8vo':8,
    'noveno':9,'9no':9,
    'decimo':10,'10mo':10,
    'undecimo':11,'decimoprimero':11,'11vo':11,
    'duodecimo':12,'decimosegundo':12,'12vo':12
  };
  for (var k in PALABRAS) {
    if (l.indexOf(k) !== -1) return String(PALABRAS[k]);
  }

  // Número directo al inicio
  var m = l.match(/^(\d+)/);
  if (m) {
    var n = parseInt(m[1]);
    if (n >= 1 && n <= 12) return String(n);
  }

  return s; // devuelve original si no se reconoce
}

// Retorna el descuento total del pedido (order.discount ya incluye cupones y DxC)
function getOrderDiscount(order) {
  return parseFloat(order.discount || 0);
}

// Retorna el tipo de descuento: usa promotional_discount para clasificar
function getDiscountType(order) {
  var total = parseFloat(order.discount || 0);
  if (total <= 0) return '';
  var promo = parseFloat((order.promotional_discount && order.promotional_discount.total_discount_amount) || 0);
  if (promo > 0 && (total - promo) > 0.01) return 'Cupón + DxC';
  if (promo > 0) return 'DxC';
  return 'Cupón';
}

function fetchDatosDeProducto(productId, variantId) {
  if (!productId) return { marca: '', costo: 0 };
  var cacheKey = productId + ':' + (variantId || '');
  if (_prodCache[cacheKey] !== undefined) return _prodCache[cacheKey];
  try {
    var url  = 'https://api.tiendanube.com/v1/' + CONFIG.STORE_ID + '/products/' + productId;
    var resp = UrlFetchApp.fetch(url, {
      headers: {
        'Authentication': 'bearer ' + CONFIG.API_TOKEN,
        'User-Agent': CONFIG.TIENDA_NOMBRE + ' (retiro-automatico)'
      },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) { _prodCache[cacheKey] = { marca: '', costo: 0 }; return _prodCache[cacheKey]; }
    var prod = JSON.parse(resp.getContentText());
    var marca = String(prod.brand || '').trim().toUpperCase();

    // El costo está en la variante, no en el producto raíz
    var costo = 0;
    var variants = prod.variants || [];
    if (variantId) {
      for (var i = 0; i < variants.length; i++) {
        if (String(variants[i].id) === String(variantId)) {
          costo = parseFloat(variants[i].cost || 0);
          break;
        }
      }
    }
    // Fallback: primera variante si no hubo match
    if (!costo && variants.length > 0) {
      costo = parseFloat(variants[0].cost || 0);
    }

    var datos = { marca: marca, costo: costo };
    _prodCache[cacheKey] = datos;
    return datos;
  } catch(e) {
    Logger.log('fetchDatosDeProducto error: ' + e);
    _prodCache[cacheKey] = { marca: '', costo: 0 };
    return _prodCache[cacheKey];
  }
}

function fetchMarcaDeProducto(productId) {
  return fetchDatosDeProducto(productId, null).marca;
}

function registrarEnVentas(order) {
  try {
    var sheet  = getVentasSheet();
    var fecha  = order.created_at ? new Date(order.created_at) : new Date();
    var nota   = order.note || order.notes || '';

    // Subtotal bruto del pedido (suma de precio × qty de todos los productos)
    var subtotalBruto = (order.products || []).reduce(function(sum, p) {
      return sum + parseFloat(p.price || 0) * (p.quantity || 1);
    }, 0);
    var orderTotal      = parseFloat(order.total || 0);
    var paymentMethod   = (order.payment_details && order.payment_details.method) || '';
    var gatewayFee      = CONFIG.GATEWAY_FEES[paymentMethod] || 0;
    var gatewayCost     = orderTotal * gatewayFee;
    var orderNeto       = orderTotal - gatewayCost;

    // Aporte a grado: cargar config una sola vez para todo el pedido
    var configAporte  = leerConfigProductos();
    var gradoNorm     = normalizarGradoGAS(nota);
    var gradoValido   = (gradoNorm && gradoNorm !== '(Sin observaciones)') ? gradoNorm : '';

    // Log de diagnóstico para pedido #232
    if (String(order.number) === '232') {
      Logger.log('DEBUG #232: discount=' + order.discount +
        ' promotional_discount=' + JSON.stringify(order.promotional_discount) +
        ' discount_coupon=' + order.discount_coupon +
        ' total=' + order.total);
    }

    order.products.forEach(function(p) {
      var nombre = (typeof p.name === 'object')
        ? (p.name.es || p.name.pt || Object.values(p.name)[0] || '')
        : (p.name || '');
      var sku        = p.sku || '';
      var qty        = p.quantity || 1;
      var precioUnit = parseFloat(p.price || 0);
      var totalLinea = precioUnit * qty;  // subtotal bruto de esta línea
      var proporcion = subtotalBruto > 0 ? totalLinea / subtotalBruto : (1 / (order.products.length || 1));
      var totalPagadoLinea = proporcion * orderTotal;
      var netoLinea        = proporcion * orderNeto;
      var datos      = fetchDatosDeProducto(p.product_id || '', p.variant_id || '');

      // Calcular aportes al grado y escuela para esta línea
      var aporteLinea = 0;
      var aporteEscuelaLinea = 0;
      var skuUp   = sku.trim().toUpperCase();
      var marcaUp = (datos.marca || '').trim().toUpperCase();
      var regla = buscarRegla(configAporte, skuUp, fecha)
               || buscarRegla(configAporte, 'MARCA:' + marcaUp, fecha)
               || buscarRegla(configAporte, 'DEFAULT', fecha)
               || null;
      if (regla) {
        // Aporte grado: solo si el comprador eligió grado
        if (gradoValido) {
          aporteLinea = Math.round(totalPagadoLinea * regla.pctGrado);
        }
        // Aporte escuela: siempre que haya regla vigente
        if (regla.pctEscuela !== null && regla.pctEscuela !== undefined) {
          aporteEscuelaLinea = Math.round(totalPagadoLinea * regla.pctEscuela);
        } else {
          var costoTotal = (datos.costo || 0) * qty;
          aporteEscuelaLinea = Math.max(0, Math.round(totalPagadoLinea - costoTotal - aporteLinea));
        }
      }

      sheet.appendRow([
        fecha,
        order.number,
        String(order.id),
        order.contact_name  || '',
        order.contact_email || '',
        nombre,
        sku,
        qty,
        precioUnit,
        totalLinea,            // col J (índice 9):  subtotal bruto (precio × qty)
        parseFloat(order.total || 0),  // col K (índice 10): total del pedido
        nota,
        datos.marca,
        datos.costo,
        totalPagadoLinea,                    // col O (índice 14): monto pagado proporcional (con descuento)
        netoLinea,                           // col P (índice 15): monto neto proporcional
        totalPagadoLinea - netoLinea,        // col Q (índice 16): fee procesamiento proporcional a esta línea
        paymentMethod,                       // col R (índice 17): método de pago
        getOrderDiscount(order),             // col S (índice 18): descuento total del pedido
        getDiscountType(order),              // col T (índice 19): tipo de descuento
        aporteLinea,                         // col U (índice 20): aporte al grado de esta línea
        gradoValido,                         // col V (índice 21): grado destino normalizado
        aporteEscuelaLinea                   // col W (índice 22): aporte a la escuela de esta línea
      ]);
    });
    Logger.log('Ventas: ' + order.products.length + ' fila(s) para pedido #' + order.number);
  } catch(err) {
    Logger.log('Error registrarEnVentas: ' + err);
  }
}

// Agrega los headers de Aporte Grado, Grado Destino y Aporte Escuela a la hoja Ventas existente
function migrarHeaderVentas() {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Ventas');
  if (!sheet) { Logger.log('No existe hoja Ventas'); return; }
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (header.indexOf('Aporte Grado') !== -1) {
    Logger.log('Headers ya existen'); return;
  }
  var nextCol = sheet.getLastColumn() + 1;
  sheet.getRange(1, nextCol, 1, 3).setValues([['Aporte Grado', 'Grado Destino', 'Aporte Escuela']]);
  sheet.getRange(1, nextCol, 1, 3).setFontWeight('bold');
  Logger.log('Headers agregados en cols ' + nextCol + ', ' + (nextCol + 1) + ' y ' + (nextCol + 2));
}

// Recalcula cols U (Aporte Grado), V (Grado Destino) y W (Aporte Escuela) para todas las filas existentes
function reprocesarAportesVentas() {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Ventas');
  if (!sheet) { Logger.log('No existe hoja Ventas'); return; }

  var config = leerConfigProductos();
  var data   = sheet.getDataRange().getValues();
  if (data.length <= 1) { Logger.log('Sin filas de datos'); return; }

  var aporteData = [];

  for (var i = 1; i < data.length; i++) {
    var row        = data[i];
    var fecha      = row[0] ? new Date(row[0]) : new Date();
    var sku             = String(row[6]  || '').trim().toUpperCase();
    var qty             = parseInt(row[7])  || 1;
    var totalPagado     = parseFloat(row[14]) || parseFloat(row[9]) || 0;  // col O (pagado) con fallback a col J (bruto)
    var comentario      = String(row[11] || '').trim();
    var marca           = String(row[12] || '').trim().toUpperCase();
    var costoUnit       = parseFloat(row[13]) || 0;

    var gradoNorm   = normalizarGradoGAS(comentario);
    var gradoValido = (gradoNorm && gradoNorm !== '(Sin observaciones)') ? gradoNorm : '';

    var regla = buscarRegla(config, sku, fecha)
             || buscarRegla(config, 'MARCA:' + marca, fecha)
             || buscarRegla(config, 'DEFAULT', fecha);

    if (!regla) {
      // Sin regla vigente para esta fecha → celdas vacías
      aporteData.push(['', '', '']);
    } else {
      // Aporte grado: solo si el comprador eligió grado
      var aporteLinea = gradoValido ? Math.round(totalPagado * regla.pctGrado) : 0;
      // Aporte escuela: siempre que haya regla vigente
      var aporteEscuelaLinea = 0;
      if (regla.pctEscuela !== null && regla.pctEscuela !== undefined) {
        aporteEscuelaLinea = Math.round(totalPagado * regla.pctEscuela);
      } else {
        var costoTotal = costoUnit * qty;
        aporteEscuelaLinea = Math.max(0, Math.round(totalPagado - costoTotal - aporteLinea));
      }
      aporteData.push([aporteLinea, gradoValido, aporteEscuelaLinea]);
    }
  }

  sheet.getRange(2, 21, aporteData.length, 3).setValues(aporteData);
  Logger.log('Filas procesadas: ' + aporteData.length);
}

function limpiarNAenGradoDestino() {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Ventas');
  if (!sheet) { Logger.log('No existe hoja Ventas'); return; }
  var data    = sheet.getDataRange().getValues();
  var limpios = 0;
  for (var i = 1; i < data.length; i++) {
    var v = String(data[i][21] || '').trim().toLowerCase();
    if (v === 'na' || v === 'n/a' || v === 'no aplica' || v === 'ninguno' || v === 'ninguna') {
      sheet.getRange(i + 1, 22).clearContent();
      limpios++;
    }
  }
  Logger.log('Celdas limpiadas: ' + limpios);
}

function testReprocesarFila() {
  // Testea la lógica de una fila específica sin tocar el sheet
  var config      = leerConfigProductos();
  var fecha       = new Date('2026-09-10'); // fecha dentro de vigencia
  var totalPagado = 13000;
  var costoUnit   = 10000;
  var qty         = 1;
  var comentario  = 'GRADO:1';
  var sku         = '';
  var marca       = 'PARAISA';

  var gradoNorm   = normalizarGradoGAS(comentario);
  var gradoValido = (gradoNorm && gradoNorm !== '(Sin observaciones)') ? gradoNorm : '';

  var regla = buscarRegla(config, sku, fecha)
           || buscarRegla(config, 'MARCA:' + marca, fecha)
           || buscarRegla(config, 'DEFAULT', fecha);

  Logger.log('gradoValido: ' + gradoValido);
  Logger.log('regla: ' + JSON.stringify(regla));

  var aporteLinea = gradoValido ? Math.round(totalPagado * regla.pctGrado) : 0;
  Logger.log('aporteLinea: ' + aporteLinea);

  var aporteEscuelaLinea = 0;
  if (regla.pctEscuela !== null && regla.pctEscuela !== undefined) {
    aporteEscuelaLinea = Math.round(totalPagado * regla.pctEscuela);
    Logger.log('aporteEscuela (fijo): ' + aporteEscuelaLinea);
  } else {
    var costoTotal = costoUnit * qty;
    aporteEscuelaLinea = Math.max(0, Math.round(totalPagado - costoTotal - aporteLinea));
    Logger.log('aporteEscuela (residual): ' + aporteEscuelaLinea + ' = ' + totalPagado + ' - ' + costoTotal + ' - ' + aporteLinea);
  }

  Logger.log('SUMA: ' + (aporteLinea + aporteEscuelaLinea) + ' | MARGEN ESPERADO: ' + (totalPagado - costoUnit * qty));
}

function testFechasConfig() {
  var config = leerConfigProductos();
  Logger.log('=== CONFIG cargada ===');
  config.forEach(function(r) {
    Logger.log('clave=' + r.clave + ' | pctGrado=' + r.pctGrado + ' | vigente=' + r.vigente + ' | tipo=' + typeof r.vigente);
  });

  // Testear con una fecha de agosto (antes del sistema) y una de septiembre
  var fechaAntes  = new Date('2026-08-15');
  var fechaDespues = new Date('2026-09-10');
  var reglaAntes   = buscarRegla(config, 'DEFAULT', fechaAntes);
  var reglaDespues = buscarRegla(config, 'DEFAULT', fechaDespues);
  Logger.log('buscarRegla DEFAULT para 15/08/2026: ' + JSON.stringify(reglaAntes));
  Logger.log('buscarRegla DEFAULT para 10/09/2026: ' + JSON.stringify(reglaDespues));
}

function yaFueEnviado(orderId) {
  var sheet = getSheet();
  var data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(orderId)) return true;
  }
  return false;
}

function marcarEntregado(orderId, staffName, notas, parcial) {
  var sheet = getSheet();
  var data  = sheet.getDataRange().getValues();
  var buyerEmail  = '';
  var buyerName   = '';
  var orderNumber = '';
  var productos   = '';

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(orderId)) {
      var estadoNuevo = parcial
        ? 'ENTREGA PARCIAL — ' + new Date().toLocaleString('es-AR')
        : 'ENTREGADO ✓ — ' + new Date().toLocaleString('es-AR');
      sheet.getRange(i + 1, 8).setValue(estadoNuevo);
      sheet.getRange(i + 1, 9).setValue(staffName);
      if (notas) sheet.getRange(i + 1, 10).setValue(notas);
      if (!parcial) {
        buyerEmail  = data[i][3];
        buyerName   = data[i][2];
        orderNumber = data[i][1];
        productos   = data[i][4];
      }
      break;
    }
  }

  if (!parcial) {
    marcarFulfillmentTiendanube(orderId);
    if (buyerEmail) {
      enviarEmailEntrega(buyerEmail, buyerName, orderNumber, productos);
    }
  }

}

// ──────────────────────────────────────────────────────────
// PÁGINAS HTML
// ──────────────────────────────────────────────────────────

// JSON endpoint: verifica token, consulta Tiendanube y devuelve datos del pedido
function apiVerificar(orderId, token) {
  if (!orderId || !verificarToken(orderId, token)) {
    return { ok: false, error: 'QR inválido o expirado.' };
  }

  // ¿Ya fue entregado o tiene entrega parcial?
  var sheet = getSheet();
  var data  = sheet.getDataRange().getValues();
  var esParcial    = false;
  var notasPrevias = '';
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(orderId)) {
      var estadoCol = String(data[i][7]);
      if (estadoCol.indexOf('ENTREGADO') !== -1) {
        return {
          ok:            true,
          entregado:     true,
          pedido_numero: data[i][1],
          estado:        estadoCol
        };
      }
      if (estadoCol.indexOf('ENTREGA PARCIAL') !== -1) {
        esParcial    = true;
        notasPrevias = String(data[i][9] || '');
      }
      break;
    }
  }

  var order = fetchOrder(orderId);
  if (!order) return { ok: false, error: 'No se encontró el pedido.' };

  if (order.status === 'cancelled') {
    return { ok: false, error: 'El pedido #' + order.number + ' fue cancelado y no puede entregarse.' };
  }
  if (order.payment_status === 'voided' || order.payment_status === 'refunded') {
    return { ok: false, error: 'El pedido #' + order.number + ' tiene un pago revertido o reembolsado.' };
  }

  return {
    ok:            true,
    entregado:     false,
    parcial:       esParcial,
    notas_previas: notasPrevias,
    order: {
      id:             String(order.id),
      number:         order.number,
      contact_name:   order.contact_name  || '',
      contact_email:  order.contact_email || '',
      total:          order.total || '',
      payment_status: order.payment_status,
      products: (order.products || []).map(function(p) {
        return { name: p.name, quantity: p.quantity };
      })
    }
  };
}

// Página inicial del QR — carga rápido con spinner, luego llama api_verificar
function paginaVerificar(orderId, token) {
  var webAppUrl    = ScriptApp.getService().getUrl();
  var apiUrl       = webAppUrl + '?action=api_verificar&id=' + encodeURIComponent(orderId) + '&token=' + encodeURIComponent(token);
  var portalUrl    = webAppUrl + '?action=portal&pass=' + CONFIG.STAFF_TOKEN;
  var extraParam   = '&token=' + encodeURIComponent(token);
  var staffOptions = CONFIG.STAFF_NAMES.map(function(name) {
    return '<option value="' + name.trim() + '">' + name.trim() + '</option>';
  }).join('');

  var html =
    '<!DOCTYPE html><html><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' +
    'body{font-family:sans-serif;padding:20px;max-width:420px;margin:auto;color:#1a1a1a}' +
    'h2{margin-bottom:4px}' +
    '#loading{text-align:center;padding:60px 20px;color:#aaa}' +
    '.spinner{width:40px;height:40px;border:4px solid #eee;border-top-color:#00A650;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px}' +
    '.sc{width:22px;height:22px;border:3px solid #eee;border-top-color:#00A650;border-radius:50%;animation:spin .8s linear infinite;display:inline-block;vertical-align:middle;margin-right:8px}' +
    '@keyframes spin{to{transform:rotate(360deg)}}' +
    '.card{background:#f5f5f5;border-radius:10px;padding:16px;margin:16px 0}' +
    '.btn{display:block;width:100%;padding:18px;background:#00A650;color:#fff;border:none;border-radius:10px;font-size:20px;font-weight:bold;margin-top:24px;cursor:pointer;box-sizing:border-box}' +
    '.btn:disabled{background:#aaa;cursor:not-allowed}' +
    '.btn-portal{display:inline-block;padding:14px 28px;background:#1a1a6e;color:#fff;border-radius:10px;text-decoration:none;font-size:16px;font-weight:bold}' +
    'select,input{width:100%;padding:14px;font-size:16px;border:1px solid #ccc;border-radius:8px;margin:8px 0;box-sizing:border-box}' +
    '#err{color:red;font-weight:bold;text-align:center;display:none;margin:8px 0}' +
    '#sp-confirm{display:none;text-align:center;margin-top:12px;color:#555}' +
    '</style></head><body>' +
    '<div style="text-align:center;padding:16px 0 8px">' +
    '<img src="' + LOGO_B64 + '" style="max-width:200px;width:60%" alt="' + CONFIG.TIENDA_NOMBRE + '">' +
    '</div>' +
    '<div id="loading"><div class="spinner"></div><p>Cargando pedido...</p></div>' +
    '<div id="content" style="display:none"></div>' +
    '<script>' +
    'var WEB_URL="' + webAppUrl + '";' +
    'var ORDEN_ID="' + orderId + '";' +
    'var EXTRA="' + extraParam + '";' +
    'var PORTAL_URL="' + portalUrl + '";' +
    'function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}' +
    'fetch("' + apiUrl + '",{redirect:"follow"})' +
    '  .then(function(r){return r.json();})' +
    '  .then(function(d){' +
    '    document.getElementById("loading").style.display="none";' +
    '    var c=document.getElementById("content");c.style.display="block";' +
    '    if(!d.ok){' +
    '      c.innerHTML=\'<div style="text-align:center"><p style="font-size:60px;margin:0">&#x274C;</p><h2 style="color:#E63946">Error</h2><p style="color:#555">\'+esc(d.error||"Error desconocido")+\'</p></div>\';' +
    '      return;' +
    '    }' +
    '    if(d.entregado){' +
    '      c.innerHTML=\'<div style="text-align:center">\'' +
    '        +\'<p style="font-size:60px;margin:0">&#x2705;</p>\'' +
    '        +\'<h2 style="color:#00A650">Pedido #\'+d.pedido_numero+\'</h2>\'' +
    '        +\'<p style="font-size:18px;color:#555">Este pedido ya fue entregado.</p>\'' +
    '        +\'<p style="color:#aaa;font-size:13px">\'+esc(d.estado)+\'</p>\'' +
    '        +\'<br><a href="\'+PORTAL_URL+\'" class="btn-portal">&#x2190; Volver al portal</a></div>\';' +
    '      return;' +
    '    }' +
    '    var isParcial=d.parcial===true;' +
    '    var notasPrev=d.notas_previas||"";' +
    '    var o=d.order;' +
    '    var pagoOk=o.payment_status==="paid";' +
    '    var est=pagoOk' +
    '      ?\'<span style="color:#00A650;font-weight:bold;font-size:18px">&#x2713; PAGO CONFIRMADO</span>\'' +
    '      :\'<span style="color:#E63946;font-weight:bold;font-size:18px">&#x26A0; PAGO NO CONFIRMADO</span>\';' +
    '    var items=o.products.map(function(p){return\'<li style="padding:4px 0">\'+p.quantity+\'x <strong>\'+esc(p.name)+\'</strong></li>\';}).join("");' +
    '    var parcialBanner=isParcial' +
    '      ?\'<div style="background:#fff3cd;border:1px solid #f97316;border-radius:8px;padding:12px 16px;margin:0 0 12px">\'' +
    '        +\'<strong>&#x26A0; Entrega parcial pendiente</strong>\'' +
    '        +\'<p style="margin:6px 0 0;font-size:14px;color:#555">En la entrega anterior qued\\u00f3 algo sin entregar.</p>\'' +
    '        +(notasPrev?\'<p style="margin:6px 0 0;font-size:13px;color:#374151;background:#fffbeb;padding:6px 10px;border-radius:4px">\\u201C\'+esc(notasPrev)+\'\\u201D</p>\':"")' +
    '        +\'</div>\':"";\'' +
    '    var notasInput=\'<label style="display:block;margin-top:16px;font-weight:bold;font-size:14px">Notas (opcional)</label>\'' +
    '      +\'<textarea id="notas" style="width:100%;padding:10px;font-size:15px;border:1px solid #ccc;border-radius:8px;margin:8px 0;box-sizing:border-box;min-height:70px">\'+esc(isParcial?notasPrev:"")+\'</textarea>\';' +
    '    var checkParcial=isParcial?"":\'<label style="display:flex;align-items:center;gap:10px;margin:12px 0;font-size:15px;cursor:pointer"><input type="checkbox" id="chk-parcial" style="width:20px;height:20px;flex-shrink:0"> Queda algo pendiente de entregar</label>\';' +
    '    var btnLabel=isParcial?"&#x2713; Confirmar entrega completa":"&#x2713; Confirmar entrega";' +
    '    var formHtml=pagoOk' +
    '      ?(\'<label>Tu nombre:</label><select id="staff">' + staffOptions + '</select>\')+notasInput+checkParcial+(\'<button id="btn" class="btn" onclick="confirmar()">\'+btnLabel+\'</button><p id="sp-confirm"><span class="sc"></span>Registrando entrega...</p>\')' +
    '      :\'<p style="color:#E63946;text-align:center">No se puede entregar: pago pendiente.</p>\';' +
    '    c.innerHTML=parcialBanner+\'<h2>Pedido #\'+o.number+\'</h2><p>\'+est+\'</p>\'' +
    '      +\'<div class="card"><p style="margin:0 0 4px"><strong>\'+esc(o.contact_name)+\'</strong></p>\'' +
    '      +\'<p style="margin:0;color:#888;font-size:14px">\'+esc(o.contact_email)+\'</p></div>\'' +
    '      +\'<div class="card"><ul style="margin:0;padding-left:18px">\'+items+\'</ul>\'' +
    '      +\'<p style="margin:12px 0 0"><strong>Total: \'+esc(o.total)+\'</strong></p></div>\'' +
    '      +\'<p id="err"></p>\'' +
    '      +formHtml;' +
    '  })' +
    '  .catch(function(){' +
    '    document.getElementById("loading").style.display="none";' +
    '    document.getElementById("content").innerHTML=\'<p style="color:red;text-align:center">Error de conexi\\u00f3n. Recarg\\u00e1 la p\\u00e1gina.</p>\';' +
    '    document.getElementById("content").style.display="block";' +
    '  });' +
    'function confirmar(){' +
    '  var staff=document.getElementById("staff").value;' +
    '  if(!staff){var el=document.getElementById("err");el.textContent="Seleccion\\u00e1 tu nombre.";el.style.color="red";el.style.display="block";return;}' +
    '  var btn=document.getElementById("btn");' +
    '  var notasEl=document.getElementById("notas");' +
    '  var notas=notasEl?notasEl.value.trim():"";' +
    '  var chkEl=document.getElementById("chk-parcial");' +
    '  var parcial=chkEl&&chkEl.checked?"1":"0";' +
    '  btn.disabled=true;' +
    '  document.getElementById("sp-confirm").style.display="block";' +
    '  document.getElementById("err").style.display="none";' +
    '  var url=WEB_URL+"?action=api_entregar&id="+encodeURIComponent(ORDEN_ID)+"&staff="+encodeURIComponent(staff)+"&notas="+encodeURIComponent(notas)+"&parcial="+parcial+EXTRA;' +
    '  fetch(url,{redirect:"follow"})' +
    '    .then(function(r){return r.json();})' +
    '    .then(function(data){' +
    '      if(data.ok){' +
    '        var esParcialResp=data.parcial===true;' +
    '        document.body.innerHTML=\'<div style="font-family:sans-serif;text-align:center;padding:48px 24px;max-width:420px;margin:auto">\'' +
    '          +(esParcialResp' +
    '            ?\'<p style="font-size:72px;margin:0">&#x26A0;&#xFE0F;</p><h2 style="color:#f97316;margin:16px 0 8px">Entrega parcial registrada</h2><p style="color:#555;margin-bottom:32px">La familia volver\\u00e1 por el resto. El QR sigue activo.</p>\'' +
    '            :\'<p style="font-size:72px;margin:0">&#x2705;</p><h2 style="color:#00A650;margin:16px 0 8px">\\u00a1Entrega registrada!</h2><p style="color:#555;margin-bottom:32px">El pedido fue marcado como entregado.</p>\')+' +
    '          \'<a href="\'+PORTAL_URL+\'" style="display:inline-block;padding:14px 28px;background:#1a1a6e;color:#fff;border-radius:10px;text-decoration:none;font-size:16px;font-weight:bold">\\u2190 Volver al portal</a></div>\';' +
    '      }else{' +
    '        var el=document.getElementById("err");' +
    '        el.textContent=data.error||"Error desconocido.";' +
    '        el.style.color="red";el.style.display="block";' +
    '        btn.disabled=false;' +
    '        document.getElementById("sp-confirm").style.display="none";' +
    '      }' +
    '    })' +
    '    .catch(function(){' +
    '      var el=document.getElementById("err");' +
    '      el.textContent="Error de red. Intent\\u00e1 de nuevo.";' +
    '      el.style.color="red";el.style.display="block";' +
    '      btn.disabled=false;' +
    '      document.getElementById("sp-confirm").style.display="none";' +
    '    });' +
    '}' +
    '<\/script>' +
    '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function paginaPortalStaff(mostrarExito) {
  var sheet     = getSheet();
  var data      = sheet.getDataRange().getValues();
  var webAppUrl = ScriptApp.getService().getUrl();

  var pagosClientePendientes = fetchPendingPaymentOrders();

  var pendientes = [];
  var entregados = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var entregado = String(row[7]).indexOf('ENTREGADO') !== -1;
    var esParcialRow = String(row[7]).indexOf('ENTREGA PARCIAL') !== -1;
    var item = {
      id:        String(row[0]),
      numero:    row[1],
      nombre:    row[2],
      productos: row[4],
      total:     row[5],
      fecha:     row[6] ? new Date(row[6]).toLocaleString('es-AR') : '',
      estado:    row[7],
      parcial:   esParcialRow,
      urlVer:    'https://escuela-dandelion.github.io/Comision-Recursos/admin.html?view=qr&id=' + row[0] + '&token=' + generarToken(String(row[0])),
      urlAdmin:  webAppUrl + '?action=entregar_admin&id=' + row[0] + '&pass=' + CONFIG.STAFF_TOKEN
    };
    if (entregado) entregados.push(item); else pendientes.push(item);
  }

  function filaHtml(item, esEntregado) {
    var bg    = esEntregado ? '#f5fff8' : (item.parcial ? '#fffbeb' : '#fff');
    var badge = esEntregado
      ? '<span style="background:#e0f5e0;color:#00A650;padding:2px 8px;border-radius:12px;font-size:12px">✓ entregado</span>'
      : item.parcial
        ? '<span style="background:#fff3cd;color:#9a3412;padding:2px 8px;border-radius:12px;font-size:12px">⚠ entrega parcial</span>'
        : '<span style="background:#fff3cd;color:#856404;padding:2px 8px;border-radius:12px;font-size:12px">pendiente</span>';

    var acciones = '';
    if (!esEntregado) {
      acciones =
        '<a href="' + item.urlVer + '" style="color:#3483FA;font-size:13px;text-decoration:none;margin-right:10px">Ver →</a>' +
        '<a href="' + item.urlAdmin + '" style="color:#fff;background:#00A650;font-size:12px;text-decoration:none;padding:4px 10px;border-radius:6px">Entregar</a>';
    }

    return '<tr style="background:' + bg + ';border-bottom:1px solid #eee">' +
      '<td style="padding:12px 8px">' +
        '<strong>Pedido #' + item.numero + '</strong><br>' +
        '<span style="color:#555;font-size:13px">' + item.nombre + '</span><br>' +
        '<span style="color:#888;font-size:12px">' + item.productos + '</span>' +
      '</td>' +
      '<td style="padding:12px 8px;text-align:right;white-space:nowrap">' +
        '<strong>' + item.total + '</strong><br>' +
        badge + '<br>' +
        '<div style="margin-top:6px">' + acciones + '</div>' +
      '</td>' +
      '</tr>';
  }

  function filaHtmlPagoCliente(order) {
    var prods = (order.products || []).map(function(p) {
      var n = (p.name && typeof p.name === 'object') ? (p.name.es || p.name.pt || Object.values(p.name)[0] || '') : (p.name || '');
      return p.quantity + 'x ' + n;
    });
    var prodsCorto = prods.join(', ');
    var prodsLargo = prods.join('\n');

    // Buscar alias del proveedor según la marca del primer producto
    var marcaKey = '';
    if (order.products && order.products[0] && order.products[0].brand) {
      marcaKey = String(order.products[0].brand).toUpperCase();
    }
    var pagoInfo = CONFIG.ALIAS_PAGO[marcaKey];
    var aliasLine = pagoInfo ? '\nAlias: ' + pagoInfo.alias + (pagoInfo.cbu ? '\nCBU: ' + pagoInfo.cbu : '') + (pagoInfo.titular ? '\nTitular: ' + pagoInfo.titular : '') : '';

    var msg = encodeURIComponent(
      '🌼 Diente de León — Pago pendiente de cliente\n\n' +
      'Pedido #' + order.number + '\n' +
      'Cliente: ' + (order.contact_name || '') + ' (' + (order.contact_email || '') + ')\n' +
      'Productos:\n' + prodsLargo + '\n' +
      'Total: $' + order.total +
      aliasLine
    );
    var waLink = 'https://wa.me/' + CONFIG.INES_TEL + '?text=' + msg;

    return '<tr style="background:#fff;border-bottom:1px solid #eee">' +
      '<td style="padding:12px 8px">' +
        '<strong>Pedido #' + order.number + '</strong><br>' +
        '<span style="color:#555;font-size:13px">' + (order.contact_name || '') + '</span><br>' +
        '<span style="color:#888;font-size:12px">' + prodsCorto + '</span>' +
      '</td>' +
      '<td style="padding:12px 8px;text-align:right;white-space:nowrap">' +
        '<strong>$' + order.total + '</strong><br>' +
        '<span style="background:#fdecea;color:#c62828;padding:2px 8px;border-radius:12px;font-size:12px">sin pagar</span><br>' +
        '<div style="margin-top:6px"><a href="' + waLink + '" style="color:#fff;background:#25D366;font-size:12px;text-decoration:none;padding:6px 10px;border-radius:6px">💬 Solicitar pago</a></div>' +
      '</td>' +
      '</tr>';
  }

  var filasPagoCliente = pagosClientePendientes.length > 0
    ? pagosClientePendientes.map(filaHtmlPagoCliente).join('')
    : '';

  var filasPendientes = pendientes.length > 0
    ? pendientes.map(function(i) { return filaHtml(i, false); }).join('')
    : '<tr><td colspan="2" style="padding:20px;text-align:center;color:#aaa">Sin pedidos pendientes</td></tr>';

  var filasEntregados = entregados.slice(-10).reverse()
    .map(function(i) { return filaHtml(i, true); }).join('');

  var html =
    '<html><head>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' +
    'body{font-family:sans-serif;padding:0;margin:0;background:#f5f5f5;color:#1a1a1a}' +
    '.header{background:#1a1a1a;color:#fff;padding:16px 20px;position:sticky;top:0;z-index:10}' +
    '.header h1{margin:0;font-size:20px}' +
    '.header p{margin:4px 0 0;font-size:13px;color:#aaa}' +
    '.section{padding:16px 12px 4px;font-size:11px;font-weight:bold;color:#888;text-transform:uppercase;letter-spacing:1px}' +
    'table{width:100%;border-collapse:collapse;background:#fff}' +
    '.badge-count{background:#E63946;color:#fff;border-radius:12px;padding:2px 8px;font-size:13px;margin-left:8px}' +
    '</style></head><body>' +
    '<div class="header">' +
    '<h1>' + CONFIG.TIENDA_NOMBRE + '</h1>' +
    '<p>Portal de retiros — ' + new Date().toLocaleDateString('es-AR') + '</p>' +
    '</div>' +
    (mostrarExito ? '<div style="background:#00A650;color:#fff;padding:14px 20px;text-align:center;font-weight:bold;font-size:16px">&#x2705; Pedido marcado como entregado</div>' : '') +
    (filasPagoCliente ? '<div class="section" style="color:#c62828">⚠️ Sin pagar<span class="badge-count" style="background:#c62828">' + pagosClientePendientes.length + '</span></div><table>' + filasPagoCliente + '</table>' : '') +
    '<div class="section">Pendientes de entrega' +
    (pendientes.length > 0 ? '<span class="badge-count">' + pendientes.length + '</span>' : '') +
    '</div>' +
    '<table>' + filasPendientes + '</table>' +
    '<div class="section">Últimas entregas</div>' +
    '<table>' + (filasEntregados || '<tr><td style="padding:20px;text-align:center;color:#aaa">Sin entregas registradas</td></tr>') + '</table>' +
    '<div style="height:40px"></div>' +
    '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function paginaConfirmar(orderId, token, errorMsg, adminPass) {
  var webAppUrl    = ScriptApp.getService().getUrl();
  var portalUrl    = webAppUrl + '?action=portal&pass=' + CONFIG.STAFF_TOKEN + '&entregado=1';
  var staffOptions = CONFIG.STAFF_NAMES.map(function(name) {
    return '<option value="' + name.trim() + '">' + name.trim() + '</option>';
  }).join('');

  // El endpoint AJAX que registra la entrega, devuelve JSON
  var extraParam = adminPass
    ? '&pass=' + encodeURIComponent(adminPass)
    : '&token=' + encodeURIComponent(token);

  var html =
    '<!DOCTYPE html><html><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' +
    'body{font-family:sans-serif;padding:24px;max-width:420px;margin:auto;color:#1a1a1a}' +
    'h2{text-align:center}' +
    'select,input{width:100%;padding:14px;font-size:16px;border:1px solid #ccc;border-radius:8px;margin:8px 0;box-sizing:border-box}' +
    '.btn{display:block;width:100%;padding:16px;background:#00A650;color:#fff;border:none;border-radius:10px;font-size:18px;font-weight:bold;margin-top:16px;cursor:pointer}' +
    '.btn:disabled{background:#aaa;cursor:not-allowed}' +
    '#error{color:red;font-weight:bold;text-align:center;display:none;margin:8px 0}' +
    '#loading{text-align:center;display:none;color:#555;margin-top:16px}' +
    '</style></head><body>' +
    '<div style="text-align:center;padding:16px 0 8px 0">' +
    '<img src="' + LOGO_B64 + '" style="max-width:200px;width:60%" alt="' + CONFIG.TIENDA_NOMBRE + '">' +
    '</div>' +
    '<h2>Confirmar entrega</h2>' +
    '<p style="text-align:center;color:#555">Pedido #' + getOrderNumber(orderId) + '</p>' +
    '<p id="error">' + (errorMsg || '') + '</p>' +
    '<label>Tu nombre:</label>' +
    '<select id="staff">' + staffOptions + '</select>' +
    '<button id="btn" class="btn" onclick="confirmar()">&#x2713; Confirmar entrega</button>' +
    '<p id="loading">Registrando entrega...</p>' +
    '<script>' +
    'var WEB_URL="' + webAppUrl + '";' +
    'var PORTAL_URL="' + portalUrl + '";' +
    'var ORDEN_ID="' + orderId + '";' +
    'var EXTRA="' + extraParam + '";' +
    (errorMsg ? 'document.getElementById("error").style.display="block";' : '') +
    'function confirmar(){' +
    '  var staff=document.getElementById("staff").value;' +
    '  if(!staff){var el=document.getElementById("error");el.textContent="Seleccion\\u00e1 tu nombre.";el.style.display="block";return;}' +
    '  var btn=document.getElementById("btn");' +
    '  btn.disabled=true;' +
    '  document.getElementById("loading").style.display="block";' +
    '  document.getElementById("error").style.display="none";' +
    '  var url=WEB_URL+"?action=api_entregar&id="+encodeURIComponent(ORDEN_ID)+"&staff="+encodeURIComponent(staff)+EXTRA;' +
    '  fetch(url,{redirect:"follow"})' +
    '    .then(function(r){return r.json();})' +
    '    .then(function(data){' +
    '      if(data.ok){' +
    '        document.body.innerHTML=' +
    '          \'<div style="font-family:sans-serif;text-align:center;padding:48px 24px;max-width:420px;margin:auto">\'' +
    '          +\'<p style="font-size:72px;margin:0">\\u2705</p>\'' +
    '          +\'<h2 style="color:#00A650;margin:16px 0 8px">\\u00a1Entrega registrada!</h2>\'' +
    '          +\'<p style="color:#555;margin-bottom:32px">El pedido fue marcado como entregado.</p>\'' +
    '          +\'<a href="\'+PORTAL_URL+\'" style="display:inline-block;padding:14px 28px;background:#00A650;color:#fff;border-radius:10px;text-decoration:none;font-size:16px;font-weight:bold">\\u2190 Volver al portal</a>\'' +
    '          +\'</div>\';' +
    '      } else {' +
    '        var el=document.getElementById("error");' +
    '        el.textContent=data.error||"Error desconocido.";' +
    '        el.style.display="block";' +
    '        btn.disabled=false;' +
    '        document.getElementById("loading").style.display="none";' +
    '      }' +
    '    })' +
    '    .catch(function(e){' +
    '      document.getElementById("error").textContent="Error de red. Intent\\u00e1 de nuevo.";' +
    '      document.getElementById("error").style.display="block";' +
    '      btn.disabled=false;' +
    '      document.getElementById("loading").style.display="none";' +
    '    });' +
    '}' +
    '<\/script>' +
    '</body></html>';

  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function paginaEntregado(orderId, staffName) {
  var webAppUrl = ScriptApp.getService().getUrl();
  var portalUrl = webAppUrl + '?action=portal&pass=' + CONFIG.STAFF_TOKEN + '&entregado=1';
  var html =
    '<!DOCTYPE html><html><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="refresh" content="0;url=' + portalUrl + '">' +
    '</head><body>' +
    '<p style="font-family:sans-serif;padding:24px;text-align:center">' +
    '&#x2705; Entregado! <a href="' + portalUrl + '">Volver al portal</a>' +
    '</p>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html);
}

// ──────────────────────────────────────────────────────────
// TOKEN DE SEGURIDAD
// ──────────────────────────────────────────────────────────

function generarToken(orderId) {
  var raw  = String(orderId) + CONFIG.SECRET;
  var hash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return hash.slice(0, 8)
    .map(function(b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); })
    .join('')
    .substring(0, 12);
}

function verificarToken(orderId, token) {
  return generarToken(orderId) === token;
}

function getOrderNumber(orderId) {
  var data = getSheet().getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(orderId)) return data[i][1];
  }
  return orderId; // fallback: si no lo encuentra, muestra el ID interno
}

// ──────────────────────────────────────────────────────────
// ENTREGA
// ──────────────────────────────────────────────────────────

function apiEntregar(orderId, staffName, adminPass, token, notas, email, parcial) {
  if (adminPass) {
    if (adminPass !== CONFIG.STAFF_TOKEN) return { ok: false, error: 'Acceso no autorizado.' };
  } else {
    if (!orderId || !verificarToken(orderId, token)) return { ok: false, error: 'QR inválido o expirado.' };
  }
  var staffKey = staffName ? staffName.trim() : '';
  if (!staffKey) return { ok: false, error: 'Seleccioná tu nombre.' };
  try {
    marcarEntregado(orderId, staffKey, notas || '', parcial || false);
    _invalidarCacheRetiros();
  } catch(err) {
    Logger.log('Error al marcar entregado: ' + err);
    return { ok: false, error: 'No se pudo registrar la entrega: ' + err.message };
  }
  return { ok: true, parcial: parcial || false };
}

function procesarEntrega(orderId, staffName) {
  var res = apiEntregar(orderId, staffName, null, generarToken(orderId));
  if (!res.ok) return paginaConfirmar(orderId, generarToken(orderId), res.error);
  return paginaPortalStaff(true);
}

function paginaError(mensaje) {
  return HtmlService.createHtmlOutput(
    '<html><head><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font-family:sans-serif;padding:32px 24px;max-width:420px;margin:auto;text-align:center;color:#1a1a1a}</style>' +
    '</head><body>' +
    '<p style="font-size:60px;margin:0">&#x26A0;</p>' +
    '<h2 style="color:#E63946">Error</h2>' +
    '<p style="color:#555">' + mensaje + '</p>' +
    '<p style="font-size:13px;color:#aaa">Contactá al administrador.</p>' +
    '</body></html>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function marcarFulfillmentTiendanube(orderId) {
  try {
    var url = 'https://api.tiendanube.com/v1/' + CONFIG.STORE_ID + '/orders/' + orderId + '/fulfill';
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ notify_customer: true }),
      headers: {
        'Authentication': 'bearer ' + CONFIG.API_TOKEN,
        'User-Agent': CONFIG.TIENDA_NOMBRE + ' (retiro-automatico)',
      },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    Logger.log('TiendaNube fulfill → HTTP ' + code + ' | ' + resp.getContentText().substring(0, 300));
  } catch(err) {
    Logger.log('Error fulfillment TiendaNube: ' + err);
  }
}

function enviarEmailEntrega(email, nombre, numeroPedido, productos) {
  try {
    var asunto = '✅ Tu pedido #' + numeroPedido + ' fue entregado — Diente de León';
    var cuerpo =
      'Hola ' + nombre + ',\n\n' +
      'Tu pedido #' + numeroPedido + ' fue entregado correctamente. 🎉\n\n' +
      'Productos:\n' + productos + '\n\n' +
      'Muchas gracias por tu compra en la tienda Diente de León.\n\n' +
      'Comisión de Recursos\nEscuela Diente de León';
    GmailApp.sendEmail(email, asunto, cuerpo, { from: 'tiendavirtual.dientedeleon@gmail.com' });
    Logger.log('Email entrega enviado a ' + email);
  } catch(err) {
    Logger.log('Error email entrega: ' + err);
  }
}

// ──────────────────────────────────────────────────────────
// UTILIDADES
// ──────────────────────────────────────────────────────────

// Registra manualmente una orden digital que ya entró antes del fix
function reprocesarOrdenDigital() {
  var ORDER_ID = '2091239608'; // Taller Tercer Septenio
  var order = fetchOrder(ORDER_ID);
  if (!order) { Logger.log('Pedido no encontrado'); return; }
  var partes = separarProductos(order);
  if (partes.digitales.length === 0) { Logger.log('No se detectaron productos digitales'); return; }
  registrarEnDigitales(order, partes.digitales);
  Logger.log('OK — ' + partes.digitales.length + ' producto(s) registrado(s) en hoja Digitales');
}

function testConPedido() {
  var ORDER_ID_REAL = 'PEGA_UN_ID_DE_PEDIDO_REAL'; // ← reemplazá
  var order = fetchOrder(ORDER_ID_REAL);
  if (!order) { Logger.log('No se encontró el pedido'); return; }
  Logger.log('Pedido encontrado: #' + order.number + ' — ' + order.contact_email);
  procesarPedido(order);
}

// Trae todas las órdenes pagadas de Tiendanube con paginación
function fetchAllPaidOrders() {
  var allOrders = [];
  var page = 1;
  while (true) {
    var url = 'https://api.tiendanube.com/v1/' + CONFIG.STORE_ID +
              '/orders?payment_status=paid&per_page=200&page=' + page;
    var resp = UrlFetchApp.fetch(url, {
      headers: {
        'Authentication': 'bearer ' + CONFIG.API_TOKEN,
        'User-Agent': CONFIG.TIENDA_NOMBRE + ' (retiro-automatico)'
      },
      muteHttpExceptions: true
    });
    var batch = JSON.parse(resp.getContentText());
    if (!batch || batch.length === 0) break;
    allOrders = allOrders.concat(batch);
    Logger.log('Página ' + page + ': ' + batch.length + ' pedidos');
    if (batch.length < 200) break;
    page++;
  }
  // Ordenar de más viejo a más nuevo por ID (IDs son secuenciales en TiendaNube)
  allOrders.sort(function(a, b) { return a.id - b.id; });
  return allOrders;
}

// Borra la pestaña Ventas y la rellena con todos los pedidos pagados históricos
function reprocesarVentas() {
  Logger.log('Iniciando reproceso de Ventas...');

  // Limpiar hoja (dejando el encabezado)
  var sheet = getVentasSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }

  var orders = fetchAllPaidOrders();
  Logger.log('Total pedidos pagados: ' + orders.length);

  // Diagnóstico: loguear el primer pedido individual para ver si trae gateway_cost

  var registrados = 0;
  orders.forEach(function(order) {
    if (order.status === 'cancelled') return;
    // Fetch individual para obtener gateway_cost (no disponible en endpoint de lista)
    var fullOrder = fetchOrder(String(order.id));
    registrarEnVentas(fullOrder || order);
    registrados++;
  });

  Logger.log('Listo. ' + registrados + ' pedidos → ' + registrados + '+ filas en Ventas.');
}

function reprocesarPendientes() {
  var url  = 'https://api.tiendanube.com/v1/' + CONFIG.STORE_ID + '/orders?payment_status=paid&per_page=50';
  var resp = UrlFetchApp.fetch(url, {
    headers: {
      'Authentication': 'bearer ' + CONFIG.API_TOKEN,
      'User-Agent': CONFIG.TIENDA_NOMBRE + ' (retiro-automatico)'
    },
    muteHttpExceptions: true
  });
  var orders = JSON.parse(resp.getContentText());
  Logger.log('Pedidos encontrados: ' + orders.length);
  orders.forEach(function(order) {
    if (order.status !== 'cancelled' && !yaFueEnviado(String(order.id))) {
      var partes = separarProductos(order);
      if (partes.digitales.length > 0) registrarEnDigitales(order, partes.digitales);
      if (partes.fisicos.length > 0) {
        Logger.log('Procesando pedido #' + order.number + ' — ' + order.contact_email);
        var ordenFisica = JSON.parse(JSON.stringify(order));
        ordenFisica.products = partes.fisicos;
        procesarPedido(ordenFisica);
      } else {
        Logger.log('Saltando pedido #' + order.number + ' (solo digital)');
      }
    } else {
      Logger.log('Saltando pedido #' + order.number + ' (cancelado o ya enviado)');
    }
  });
  Logger.log('Listo.');
}

// ──────────────────────────────────────────────────────────
// REPROCESO — Marcar en TiendaNube todos los pedidos ya entregados en Sheets
// Ejecutar UNA SOLA VEZ manualmente desde el editor de GAS
// ──────────────────────────────────────────────────────────
function reprocesarEntregasTiendaNube() {
  var sheet = getSheet();
  var data  = sheet.getDataRange().getValues();
  var procesados = 0;
  var errores    = 0;

  for (var i = 1; i < data.length; i++) {
    var orderId = String(data[i][0]);
    var estado  = String(data[i][7]);

    if (estado.indexOf('ENTREGADO') === -1) continue;
    if (!orderId || orderId === '') continue;

    Logger.log('Procesando orden ' + orderId + ' (fila ' + (i+1) + ')...');
    try {
      marcarFulfillmentTiendanube(orderId);
      procesados++;
      Utilities.sleep(500); // pausa entre llamadas para no saturar la API
    } catch(err) {
      Logger.log('ERROR en orden ' + orderId + ': ' + err);
      errores++;
    }
  }

  Logger.log('=== REPROCESO COMPLETO === Procesados: ' + procesados + ' | Errores: ' + errores);
}

function registrarWebhook() {
  var url = 'https://api.tiendanube.com/v1/' + CONFIG.STORE_ID + '/webhooks';
  var payload = JSON.stringify({
    event: 'order/paid',
    url: 'https://script.google.com/macros/s/AKfycbwt8mRYjjFZtsmFPw0JYcMpCkZcOt9J7ALFVkPByqQ8NM2NvCaYF1onagU_ag0a2ziksg/exec'
  });
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: payload,
    headers: {
      'Authentication': 'bearer ' + CONFIG.API_TOKEN,
      'User-Agent': CONFIG.TIENDA_NOMBRE + ' (retiro-automatico)'
    },
    muteHttpExceptions: true
  });
  Logger.log(resp.getResponseCode() + ' → ' + resp.getContentText());
}

// ──────────────────────────────────────────────────────────
// AUTH API — validación liviana por email (sin cargar datos)
// ──────────────────────────────────────────────────────────

function apiAuthEmail(email) {
  if (!email) return { ok: false, error: 'Email requerido.' };
  var user = AUTH_EMAILS[email.toLowerCase().trim()];
  if (!user) return { ok: false, error: 'Email no autorizado.' };
  return { ok: true, role: user.role, name: user.name, marcas: user.marcas || null };
}

// ──────────────────────────────────────────────────────────
// APORTES PÚBLICOS — solo datos agregados, sin info personal
// ──────────────────────────────────────────────────────────

function apiAportes() {
  try {
    var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
    var sheet = ss.getSheetByName('Ventas');
    var data  = sheet.getDataRange().getValues();
    if (data.length <= 1) return { ok: true, rows: [] };

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row   = data[i];
      var fecha = row[0] instanceof Date ? row[0] : null;
      var mes   = fecha ? (fecha.getFullYear() + '-' + ('0' + (fecha.getMonth()+1)).slice(-2)) : '';
      var grado = normalizarGradoGAS(String(row[11] || '').trim());
      if (!mes || !grado || grado === '(Sin observaciones)') continue;
      var aporte = parseFloat(row[20]) || 0;
      if (aporte <= 0) continue;
      rows.push({
        mes:          mes,
        grado:        grado,
        aporte_grado: Math.round(aporte * 100) / 100,
        cantidad:     parseInt(row[7]) || 0
      });
    }
    return { ok: true, rows: rows };
  } catch(e) {
    Logger.log('Error en apiAportes: ' + e);
    return { ok: false, error: 'Error al cargar datos.' };
  }
}

// ──────────────────────────────────────────────────────────
// DASHBOARD API
// ──────────────────────────────────────────────────────────

function apiDashboard(email) {
  if (!email) return { ok: false, error: 'Email no autorizado.' };
  var authUser = AUTH_EMAILS[email.toLowerCase().trim()];
  if (!authUser) return { ok: false, error: 'Email no autorizado.' };
  var userRole = authUser.role || 'staff';

  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Ventas');
  var data  = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return { ok: true, rows: [], retiros_map: {}, meses_todos: [], total_pedidos: 0, total_pesos: 0, total_costo: 0, actualizado: new Date().toLocaleString('es-AR') };
  }

  // Columnas: 0=Fecha,1=Pedido#,2=IDInt,3=Nombre,4=Email,5=Producto,6=SKU,7=Cantidad,8=PrecioU,9=SubtotalBruto,10=TotPedido,11=Comentarios,12=Marca,13=CostoUnitario,14=TotalPagadoLinea,15=NetoLinea,20=AporteGrado,21=GradoDestino
  var rows       = [];
  var mesesSet   = {};
  var pedidosSet = {};
  var totalPesos = 0;
  var totalCosto = 0;
  var totalAporte = 0;

  for (var r = 1; r < data.length; r++) {
    var row        = data[r];
    var fecha      = row[0] ? new Date(row[0]) : null;
    var pedido     = String(row[1] || '');
    var nombre     = String(row[3] || 'Sin nombre');
    var email      = String(row[4] || '');
    var producto   = String(row[5] || '');
    var cantidad   = parseInt(row[7]) || 1;
    var subtotalBrutoLinea  = parseFloat(row[9])  || 0;
    var totalPedido         = parseFloat(row[10]) || 0;
    var comentario          = String(row[11] || '').trim();
    var marca               = String(row[12] || '');
    var totalPagadoLinea    = parseFloat(row[14]) || subtotalBrutoLinea;
    var netoLinea           = parseFloat(row[15]) || totalPagadoLinea;
    var feeProcesamiento    = parseFloat(row[16]) || 0;
    var orderDiscount       = parseFloat(row[18]) || 0;
    var aporteGrado         = parseFloat(row[20]) || 0;
    var mes         = fecha ? (fecha.getFullYear() + '-' + ('0' + (fecha.getMonth()+1)).slice(-2)) : '';
    var gradoNorm   = normalizarGradoGAS(comentario);
    var grado       = (gradoNorm && gradoNorm !== '(Sin observaciones)') ? gradoNorm : '(Sin observaciones)';

    var costoUnit  = parseFloat(row[13]) || 0;
    var costoLinea = costoUnit * cantidad;
    totalCosto    += costoLinea;
    totalAporte   += aporteGrado;

    if (mes) mesesSet[mes] = true;
    if (pedido && !pedidosSet[pedido]) {
      totalPesos += totalPedido;
    }
    if (pedido) pedidosSet[pedido] = true;

    rows.push({
      fecha:               fecha ? fecha.toLocaleDateString('es-AR') : '',
      fechaHora:           fecha ? (('0'+fecha.getDate()).slice(-2)+'/'+('0'+(fecha.getMonth()+1)).slice(-2)+'/'+String(fecha.getFullYear()).slice(-2)+' '+('0'+fecha.getHours()).slice(-2)+':'+('0'+fecha.getMinutes()).slice(-2)) : '',
      mes:                 mes,
      pedido:              pedido,
      familia:             nombre,
      email:               email,
      producto:            producto,
      marca:               marca,
      cantidad:            cantidad,
      total_linea:         Math.round(subtotalBrutoLinea * 100) / 100,
      total_pagado_linea:  Math.round(totalPagadoLinea * 100) / 100,
      neto_linea:          Math.round(netoLinea * 100) / 100,
      fee_procesamiento:   Math.round(feeProcesamiento * 100) / 100,
      order_discount:      Math.round(orderDiscount * 100) / 100,
      costo_linea:         Math.round(costoLinea * 100) / 100,
      grado:               grado,
      aporte_grado:        Math.round(aporteGrado * 100) / 100
    });
  }

  // Mapa pedido# → estado de entrega (leemos el mismo SS que ya abrimos)
  var retirosMap = {};
  try {
    var rSheet = ss.getSheetByName('Retiros');
    if (rSheet) {
      var rData = rSheet.getDataRange().getValues();
      for (var ri = 1; ri < rData.length; ri++) {
        var rNum = String(rData[ri][1] || '');
        var rEst = String(rData[ri][7] || '');
        if (rNum) retirosMap[rNum] = rEst.indexOf('ENTREGADO') !== -1 ? 'Entregado' : 'Pendiente';
      }
    }
  } catch(e) { Logger.log('Error leyendo Retiros en apiDashboard: ' + e); }

  return {
    ok:            true,
    role:          userRole,
    rows:          rows,
    retiros_map:   retirosMap,
    meses_todos:   Object.keys(mesesSet).sort(),
    total_pedidos: Object.keys(pedidosSet).length,
    total_pesos:   Math.round(totalPesos * 100) / 100,
    total_costo:   Math.round(totalCosto * 100) / 100,
    total_aporte:  Math.round(totalAporte * 100) / 100,
    actualizado:   new Date().toLocaleString('es-AR')
  };
}

// ═══════════════════════════════════════════════════════════
//  AUTH — admin.html
// ═══════════════════════════════════════════════════════════

// Lista blanca de emails con su rol
var AUTH_EMAILS = {
  'robertson.ine@gmail.com':    { role: 'ADMIN', name: 'Inés' },
  'longhi.yuliana@gmail.com':        { role: 'ADMIN', name: 'Yuliana' },
  'yuliana.longhi@dandelion.edu.ar': { role: 'ADMIN', name: 'Yuliana' },
  'martinimaria39@gmail.com':        { role: 'FGP', name: 'Maria',  marcas: ['YEMARI','CABALLO NEGRO','LA YAYA','GUARDIANES COLMENA','EL MAITEN','ODDIS','GROEN','PARAISA'] },
  'amandabenedi@gmail.com':          { role: 'FGP', name: 'Amanda', marcas: [] },
  'lourdelcastillo@gmail.com':       { role: 'FGP', name: 'Luli',   marcas: ['LA YAYA','ODDIS'] },
  'belen.ravaza@dandelion.edu.ar':   { role: 'FGP', name: 'Belén',  marcas: [] },
  'avilaclaudio1905@gmail.com':      { role: 'referente', name: 'Claudio' },
  'inesitavasquezoliva@gmail.com':   { role: 'referente', name: 'Inés' },
  'pialucarno@gmail.com':            { role: 'FGP',   name: 'Pia',    marcas: ['EL MAITEN','ODDIS','MIX Y FRUTOS SECOS'] },
  'elinapipino8@gmail.com':          { role: 'referente', name: 'Elina' },
  'paola@bodegatres.com.ar':         { role: 'referente', name: 'Paola' },
  'monicachesta@gmail.com':          { role: 'FGP',   name: 'Monica', marcas: ['LA YAYA','GUARDIANES COLMENA','GROEN'] },
  'lmdestefano@dandelion.edu.ar':    { role: 'FGP',   name: 'Lucas',  marcas: ['YEMARI','CABALLO NEGRO','SOL DE ORO'] },
  'lmdestefano@gmail.com':           { role: 'FGP',   name: 'Lucas',  marcas: ['YEMARI','CABALLO NEGRO','SOL DE ORO'] },
  'delfinasalvettilarrea@gmail.com': { role: 'referente', name: 'Delfina' },
  'jdiaz.elencuentro@gmail.com':     { role: 'referente', name: 'Juan' },
  'karytramitesescolares@gmail.com': { role: 'referente', name: 'Karina' },
  'dominguezgabydl@gmail.com':       { role: 'referente', name: 'Gaby' },
  'yaninafuentes33@gmail.com':       { role: 'referente', name: 'Yana' },
  'ariasgibertsabina@gmail.com':     { role: 'referente', name: 'Sabi' },
  'dolo.dominguez@dandelion.edu.ar': { role: 'referente', name: 'Dolo' },
  'francoalini@gmail.com':           { role: 'FGP',   name: 'Franco', marcas: ['NAZARENO'] },
  'maximiliano.contreras@dandelion.edu.ar': { role: 'referente', name: 'Maximiliano' },
  'leilaremedi1@gmail.com':                 { role: 'digital',   name: 'Leila' }
};

// Lista blanca de teléfonos de referentes (sin el +, formato internacional)
var AUTH_REFERENTES = {
  '5493513645612': { role: 'REFERENTE', name: 'Yuliana' },
  '5493516865078': { role: 'REFERENTE', name: 'Maria'   },
  '5493512112050': { role: 'REFERENTE', name: 'Inés'    },
  '5493543512538': { role: 'REFERENTE', name: 'Delfina' },
  '5493516523262': { role: 'REFERENTE', name: 'Dolo'    },
  '5493517076221': { role: 'REFERENTE', name: 'Gaby'    },
  '5493515514893': { role: 'REFERENTE', name: 'Juan'    },
  '5493512130302': { role: 'REFERENTE', name: 'Karina'  },
  '5493516808115': { role: 'ADMIN',     name: 'Monica'  },
  '5493516166134': { role: 'REFERENTE', name: 'Paola'   },
  '5493516602546': { role: 'ADMIN',     name: 'Pia'     },
  '5493517888479': { role: 'REFERENTE', name: 'Sabi'    },
  '5493512114209': { role: 'REFERENTE', name: 'Yana'    },
  '5493512032487': { role: 'REFERENTE', name: 'Elina'   },
  '5493516319266': { role: 'REFERENTE', name: 'Claudio' }
};

// Verificar Google Sign-In — devuelve {ok, role, name, marcas}
function apiVerificarEmail(email) {
  email = email.toLowerCase().trim();
  var user = AUTH_EMAILS[email];
  if (!user) return { ok: false, error: 'Email no autorizado' };
  return { ok: true, role: user.role, name: user.name, marcas: user.marcas || null };
}

// Generar y enviar OTP por WhatsApp
function apiSendOTP(tel) {
  tel = tel.replace(/\D/g, ''); // solo dígitos
  if (!AUTH_REFERENTES[tel]) return { ok: false, error: 'Número no registrado' };

  var code = String(Math.floor(100000 + Math.random() * 900000));
  var expira = new Date().getTime() + 5 * 60 * 1000; // 5 minutos

  // Guardar en PropertiesService (temporal, expira)
  PropertiesService.getScriptProperties().setProperty('otp_' + tel, code + '|' + expira);

  // Enviar por WhatsApp
  try {
    UrlFetchApp.fetch(
      'https://api.green-api.com/waInstance' + CONFIG.GREEN_INSTANCE + '/sendMessage/' + CONFIG.GREEN_TOKEN,
      {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify({
          chatId: tel + '@c.us',
          message: '🌼 *Diente de León*\n\nTu código de acceso es: *' + code + '*\n\nExpira en 5 minutos.'
        })
      }
    );
  } catch(err) {
    Logger.log('Error enviando OTP: ' + err);
    return { ok: false, error: 'Error enviando WhatsApp' };
  }

  return { ok: true };
}

// Verificar OTP ingresado
function apiVerifyOTP(tel, code) {
  tel = tel.replace(/\D/g, '');
  var stored = PropertiesService.getScriptProperties().getProperty('otp_' + tel);
  if (!stored) return { ok: false, error: 'Código no encontrado o expirado' };

  var parts  = stored.split('|');
  var savedCode  = parts[0];
  var expira     = Number(parts[1]);

  if (new Date().getTime() > expira) {
    PropertiesService.getScriptProperties().deleteProperty('otp_' + tel);
    return { ok: false, error: 'Código expirado' };
  }

  if (code !== savedCode) return { ok: false, error: 'Código incorrecto' };

  // Limpiar OTP usado
  PropertiesService.getScriptProperties().deleteProperty('otp_' + tel);

  var user = AUTH_REFERENTES[tel];
  return { ok: true, role: user.role, name: user.name };
}

// Mapeo staff → grado
var STAFF_GRADOS = {
  'Yuliana.Longhi ':  'Jardín',
  'Maria.Martini ':   'Jardín',
  'Ines.Robertson':   '4to',
  'Delfina.Salvetti': '6to',
  'Dolo.Dominguez':   '2do',
  'Gaby.Dominguez':   '5to',
  'Juan.Diaz':        '8vo',
  'Karina':           '7mo',
  'Monica.Chesta':    'Maestros/Docentes',
  'Paola':            '2do',
  'Pia':              '11vo',
  'Sabi':             '9no',
  'Yana':             '5to',
  'Elina':            '3ro',
  'Claudio':          'Tiendita'
};

function staffToGrado(staffKey) {
  if (!staffKey) return '';
  var k = staffKey.trim();
  if (STAFF_GRADOS[k + ' '] !== undefined) return STAFF_GRADOS[k + ' '];
  if (STAFF_GRADOS[k] !== undefined) return STAFF_GRADOS[k];
  // buscar por nombre parcial
  var keys = Object.keys(STAFF_GRADOS);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].trim().toLowerCase() === k.toLowerCase()) return STAFF_GRADOS[keys[i]];
  }
  return '';
}

// ── RETIROS CON ESTADO ENTREGADO/PENDIENTE ───────────────────
function getRetirosData(estadoFiltro, diasFiltro) {
  var cacheKey = _retirosCacheKey(estadoFiltro, diasFiltro);
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch(e) {}

  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);

  // Construir mapa pedido# → set de marcas desde el sheet Ventas
  var marcasMap = {};
  try {
    var ventasSheet = ss.getSheetByName('Ventas');
    if (ventasSheet) {
      var vData = ventasSheet.getDataRange().getValues();
      for (var v = 1; v < vData.length; v++) {
        var pedNum = String(vData[v][1] || '');
        var marca  = String(vData[v][12] || '').trim();
        if (!pedNum || !marca) continue;
        if (!marcasMap[pedNum]) marcasMap[pedNum] = {};
        marcasMap[pedNum][marca] = true;
      }
    }
  } catch(e) {}

  var sheet = ss.getSheetByName('Retiros');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row    = data[i];
    if (!row[0]) continue;
    var estado        = String(row[7] || '');
    var entregado     = estado.indexOf('ENTREGADO') !== -1;
    var esParcial     = estado.indexOf('ENTREGA PARCIAL') !== -1;
    var fechaEntrega  = entregado ? estado.replace('ENTREGADO ✓ — ', '').trim() : '';
    var staffRaw      = String(row[8] || '').trim();                   // 'Juan.Diaz' — para lookup de grado
    var staff         = staffRaw.replace('.', ' ');                    // 'Juan Diaz' — para mostrar
    var fechaPedido   = '';
    try { fechaPedido = row[6] ? Utilities.formatDate(new Date(row[6]), 'America/Argentina/Cordoba', 'dd/MM/yyyy') : ''; } catch(e) {}
    // Filtro por estado
    if (estadoFiltro && estadoFiltro !== entregado ? 'Entregado' : 'Pendiente') {
      if (estadoFiltro === 'Pendiente' && entregado) continue;
      if (estadoFiltro === 'Entregado' && !entregado) continue;
    }
    // Filtro por días (solo para Entregado)
    if (diasFiltro > 0 && entregado) {
      var fechaRow = row[6] ? new Date(row[6]) : null;
      if (fechaRow) {
        var limite = new Date();
        limite.setDate(limite.getDate() - diasFiltro);
        if (fechaRow < limite) continue;
      }
    }
    rows.push({
      id:           String(row[0]),
      numero:       row[1],
      nombre:       String(row[2] || ''),
      email:        String(row[3] || ''),
      productos:    String(row[4] || ''),
      total:        String(row[5] || ''),
      fecha:        fechaPedido,
      estado:       entregado ? 'Entregado' : (esParcial ? 'Parcial' : 'Pendiente'),
      parcial:      esParcial,
      fechaEntrega: fechaEntrega,
      staff:        staff,
      grado:         staffToGrado(staffRaw) || String(row[10] || '').trim(),
      notas:         String(row[9] || ''),
      discount:      parseFloat(row[11] || 0),
      discount_type: String(row[12] || ''),
      marcas:        Object.keys(marcasMap[String(row[1] || '')] || {})
    });
  }
  var result = rows.reverse();
  try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 180); } catch(e) {}
  return result;
}

// ── TEST: distintos casos de uso ──────────────────────────────
function _logAporte(label, resultado, totalCompra, esperadoGrado, esperadoEscuela) {
  Logger.log('');
  Logger.log('=== ' + label + ' ===');
  if (!resultado || (resultado.montoGrado === 0 && resultado.montoEscuela === 0)) {
    Logger.log('Sin aporte — bloque no aparece en el mail.');
    return;
  }
  Logger.log('Compra total:  $' + totalCompra);
  if (resultado.montoGrado > 0)   Logger.log('→ ' + formatearGrado(resultado.grado) + ': $' + resultado.montoGrado  + (esperadoGrado   ? '  (esperado: $' + esperadoGrado + ')' : ''));
  if (resultado.montoEscuela > 0) Logger.log('→ Escuela:      $' + resultado.montoEscuela + (esperadoEscuela ? '  (esperado: $' + esperadoEscuela + ')' : ''));
}

// CASO 1 — Productos regulares con grado seleccionado (pedido 630)
// Esperado: $4.800 al grado 9, $9.541 a la escuela
function testCaso1_RegularConGrado() {
  var order = {
    id: '2070879050', number: 630, total: '32000.00',
    created_at: '2026-09-15T12:00:00-03:00', note: '9',
    products: [
      { sku: 'MIEL_GUARDIANES_COLMENA_1000',       product_id: '335149136', variant_id: '1490635565', price: '11000.00', quantity: 1 },
      { sku: 'YERBA_CABALLO_NEGRO_BARBACUA_1KG',    product_id: '330467927', variant_id: '1576337722', price: '8000.00',  quantity: 1 },
      { sku: 'YERBA_CABALLO_NEGRO_TRADICIONAL_1KG', product_id: '330386845', variant_id: '1576330774', price: '8000.00',  quantity: 1 },
      { sku: 'YERBA_YEMARI_1KG',                   product_id: '330380951', variant_id: '1470321979', price: '5000.00',  quantity: 1 }
    ]
  };
  _logAporte('CASO 1: Regulares con grado (pedido 630)', calcularAporteGrado(order), 32000, 4800, 9541);
}

// CASO 2 — Solo escuela: pizza con grado seleccionado → 0% grado, 10% escuela
// Esperado: $0 al grado, $2.500 a la escuela (10% de $25.000)
function testCaso2_PizzaSoloEscuela() {
  var order = {
    id: 'TEST002', number: 999, total: '25000.00',
    created_at: '2026-09-18T12:00:00-03:00', note: '4to',
    products: [
      { sku: 'PIZZAS_PAJARITO_AMARILLO_3UNIDADES', product_id: '', variant_id: '', price: '25000.00', quantity: 1 }
    ]
  };
  _logAporte('CASO 2: Pizza — solo va a la escuela', calcularAporteGrado(order), 25000, 0, 2500);
}

// CASO 3 — Alfajores Nazareno con grado: 25% grado, 5% escuela
// Esperado: $2.000 al grado, $400 a la escuela (sobre $8.000)
function testCaso3_Nazareno() {
  var order = {
    id: 'TEST003', number: 998, total: '8000.00',
    created_at: '2026-09-18T12:00:00-03:00', note: '6to',
    products: [
      { sku: 'NAZARENO_ALFAJORES_CHOCO_TRADICIONAL', product_id: '', variant_id: '', price: '8000.00', quantity: 1 }
    ]
  };
  _logAporte('CASO 3: Nazareno — 25% grado / 5% escuela', calcularAporteGrado(order), 8000, 2000, 400);
}

// CASO 4 — Sin grado en la nota → no aparece el bloque
function testCaso4_SinGrado() {
  var order = {
    id: 'TEST004', number: 997, total: '12000.00',
    created_at: '2026-09-18T12:00:00-03:00', note: '',
    products: [
      { sku: 'MIEL_GUARDIANES_COLMENA_1000', product_id: '335149136', variant_id: '1490635565', price: '12000.00', quantity: 1 }
    ]
  };
  _logAporte('CASO 4: Sin grado — no muestra bloque', calcularAporteGrado(order), 12000, null, null);
}

// Corre todos los casos juntos (solo logs, no manda mails)
function testTodosLosCasos() {
  testCaso1_RegularConGrado();
  testCaso2_PizzaSoloEscuela();
  testCaso3_Nazareno();
  testCaso4_SinGrado();
}

// Manda el mail exacto (con QR real) a robertson.ine@gmail.com usando el pedido 630
// Corré desde el editor — no requiere redeploy
function testEnviarEmailAporte() {
  var ORDER_ID = '2070879050';
  var resp  = UrlFetchApp.fetch(
    'https://api.tiendanube.com/v1/' + CONFIG.STORE_ID + '/orders/' + ORDER_ID,
    { headers: { 'Authentication': 'bearer ' + CONFIG.API_TOKEN, 'User-Agent': CONFIG.TIENDA_NOMBRE + ' (retiro-automatico)' }, muteHttpExceptions: true }
  );
  var order = JSON.parse(resp.getContentText());

  var orderId   = String(order.id);
  var nombre    = (order.contact_name || 'Familia').split(' ')[0];
  var productos = (order.products || []).map(function(p) {
    var n = p.name; n = (typeof n === 'object') ? (n.es || n.pt || Object.values(n)[0] || '') : (n || '');
    return p.quantity + 'x ' + n;
  }).join('\n');

  var token     = generarToken(orderId);
  var verifyUrl = 'https://escuela-dandelion.github.io/Comision-Recursos/admin.html?view=qr&id='
                  + encodeURIComponent(orderId) + '&token=' + encodeURIComponent(token);
  var qrApiUrl  = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=L&margin=1&data='
                  + encodeURIComponent(verifyUrl);
  var qrBlob    = UrlFetchApp.fetch(qrApiUrl).getBlob().setName('qr.png').setContentType('image/png');

  // Redirigir a email de prueba en lugar del comprador real
  enviarEmail('robertson.ine@gmail.com', nombre, order, qrBlob, productos);
  Logger.log('[TEST] Mail enviado a robertson.ine@gmail.com — pedido #' + order.number);
}

// ── PREVIEW INFORME MENSUAL (browser, sin enviar mails) ─────────────────────
// Acceder con: ?action=preview_informe   (mes actual - 1)
//              ?action=preview_informe&mes=2026-09  (mes específico)
function previewInformeMensual(mesParam) {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Ventas');
  if (!sheet) return HtmlService.createHtmlOutput('<p>Sheet Ventas no encontrada.</p>');

  var data = sheet.getDataRange().getValues();

  var mesPasado;
  if (mesParam && mesParam.match(/^\d{4}-\d{2}$/)) {
    var parts = mesParam.split('-');
    mesPasado = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
  } else {
    var hoy = new Date();
    mesPasado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  }
  var mesNum    = mesPasado.getMonth();
  var anioNum   = mesPasado.getFullYear();
  var mesNombre = mesPasado.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  var mesLabel  = mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1);

  var porGrado = {}, totalAporte = 0, totalUnidades = 0;

  for (var i = 1; i < data.length; i++) {
    var row   = data[i];
    var fecha = new Date(row[0]);
    if (isNaN(fecha.getTime())) continue;
    if (fecha.getMonth() !== mesNum || fecha.getFullYear() !== anioNum) continue;
    var qty         = parseInt(row[7])    || 0;
    var aporteGrado = parseFloat(row[20]) || 0;
    var grado       = normalizarGradoGAS(String(row[21] || ''));
    totalUnidades  += qty;
    totalAporte    += aporteGrado;
    if (grado && grado !== '(Sin observaciones)') {
      if (!porGrado[grado]) porGrado[grado] = { aporte: 0, unidades: 0 };
      porGrado[grado].aporte   += aporteGrado;
      porGrado[grado].unidades += qty;
    }
  }

  var grados = Object.keys(porGrado).sort(function(a, b) {
    if (a === 'J') return -1;
    if (b === 'J') return 1;
    return parseInt(a) - parseInt(b);
  });

  if (grados.length === 0) {
    return HtmlService.createHtmlOutput(
      '<p style="font-family:sans-serif;padding:32px;color:#888">Sin aportes por grado en ' + mesLabel + '.</p>'
    );
  }

  var filasGrado = grados.map(function(g) {
    var d = porGrado[g];
    return '<tr>' +
      '<td style="padding:10px 14px;border-bottom:1px solid #e8f5e9;color:#374151">' + formatearGrado(g) + '</td>' +
      '<td style="padding:10px 14px;border-bottom:1px solid #e8f5e9;text-align:right;font-weight:700;color:#1a5c2a">$' + Math.round(d.aporte).toLocaleString('es-AR') + '</td>' +
      '<td style="padding:10px 14px;border-bottom:1px solid #e8f5e9;text-align:right;color:#6b7280">' + d.unidades + '</td>' +
      '</tr>';
  }).join('');

  var html =
    '<div style="font-family:-apple-system,\'Segoe UI\',sans-serif;max-width:560px;margin:auto;padding:24px;color:#1a1a2e">' +
    '<p style="font-size:11px;color:#c00;background:#fff3cd;padding:8px 12px;border-radius:6px;margin-bottom:20px">⚠️ PREVIEW — este mail aún no fue enviado</p>' +
    '<div style="text-align:center;padding:0 0 24px 0">' +
    '<img src="' + LOGO_B64 + '" style="max-width:200px;width:55%" alt="Diente de León">' +
    '</div>' +
    '<h2 style="color:#3a7d44;margin:0 0 8px 0;font-size:20px">Resumen de aportes · ' + mesLabel + '</h2>' +
    '<p style="color:#555;margin:0 0 20px 0;font-size:14px;line-height:1.6">Gracias a las compras de toda la comunidad Dandelion, este mes se generaron aportes para cada grado. Acá compartimos el resumen:</p>' +
    '<table style="width:100%;border-collapse:collapse;margin-bottom:20px;border-radius:10px;overflow:hidden;border:1px solid #c8e6c9">' +
    '<thead><tr style="background:#3a7d44">' +
    '<th style="padding:11px 14px;text-align:left;color:#fff;font-size:13px;font-weight:600">Grado</th>' +
    '<th style="padding:11px 14px;text-align:right;color:#fff;font-size:13px;font-weight:600">Aporte recaudado</th>' +
    '<th style="padding:11px 14px;text-align:right;color:#fff;font-size:13px;font-weight:600">Unidades vendidas</th>' +
    '</tr></thead>' +
    '<tbody>' + filasGrado + '</tbody>' +
    '<tfoot><tr style="background:#e8f5e9">' +
    '<td style="padding:11px 14px;font-weight:700;font-size:14px">Total</td>' +
    '<td style="padding:11px 14px;text-align:right;font-weight:700;font-size:14px;color:#1a5c2a">$' + Math.round(totalAporte).toLocaleString('es-AR') + '</td>' +
    '<td style="padding:11px 14px;text-align:right;font-weight:700;font-size:14px;color:#555">' + totalUnidades + '</td>' +
    '</tr></tfoot>' +
    '</table>' +
    '<p style="font-size:13px;color:#555;line-height:1.6">Los aportes se transfieren a cada grado durante los primeros días del mes. Si tenés alguna consulta o querés verificar el destino de tu aporte, <a href="https://escuela-dandelion.github.io/Comision-Recursos/wiki-aportes-grado.html" style="color:#3a7d44">visitá nuestra wiki</a>.</p>' +
    '<p style="font-size:11px;color:#aaa;margin-top:24px;padding-top:14px;border-top:1px solid #eee;text-align:center">Tienda Diente de León · Escuela Dandelion Pedagogía Waldorf · Córdoba</p>' +
    '</div>';

  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── VENTAS DIGITALES ────────────────────────────────────────────────────────

function apiDigitales(email) {
  if (!email) return { ok: false, error: 'Email requerido.' };
  var user = AUTH_EMAILS[email.toLowerCase().trim()];
  if (!user) return { ok: false, error: 'Email no autorizado.' };
  if (user.role !== 'ADMIN' && user.role !== 'digital') return { ok: false, error: 'Sin permiso para ver ventas digitales.' };

  try {
    var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
    var sheet = ss.getSheetByName('Digitales');
    if (!sheet) return { ok: true, rows: [] };
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { ok: true, rows: [] };
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row   = data[i];
      var fecha = row[0] instanceof Date ? row[0] : null;
      rows.push({
        fecha:         fecha ? Utilities.formatDate(fecha, 'America/Argentina/Cordoba', 'dd/MM/yyyy HH:mm') : '',
        pedido:        String(row[1] || ''),
        id:            String(row[2] || ''),
        nombre:        String(row[3] || ''),
        email:         String(row[4] || ''),
        producto:      String(row[5] || ''),
        sku:           String(row[6] || ''),
        cantidad:      parseInt(row[7]) || 0,
        precio_unit:   parseFloat(row[8]) || 0,
        total_linea:   parseFloat(row[9]) || 0,
        total_pedido:  parseFloat(row[10]) || 0,
        metodo_pago:   String(row[11] || '')
      });
    }
    return { ok: true, rows: rows };
  } catch(e) {
    Logger.log('Error apiDigitales: ' + e);
    return { ok: false, error: 'Error al cargar datos.' };
  }
}

// ── INFORME MENSUAL ─────────────────────────────────────────────────────────

// Ejecutar una vez para activar el trigger automático el 1ro de cada mes
function configurarTriggerMensual() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'enviarInformeMensual') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarInformeMensual')
    .timeBased()
    .onMonthDay(1)
    .atHour(9)
    .create();
  Logger.log('Trigger configurado: enviarInformeMensual el 1ro de cada mes a las 9hs.');
}

function enviarInformeMensual() {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Ventas');
  if (!sheet) { Logger.log('Sheet Ventas no encontrada.'); return; }

  var data = sheet.getDataRange().getValues();

  var hoy       = new Date();
  var mesPasado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  var mesNum    = mesPasado.getMonth();
  var anioNum   = mesPasado.getFullYear();
  var mesNombre = mesPasado.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  var mesLabel  = mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1);

  var porGrado      = {};
  var emailsSet     = {};
  var totalAporte   = 0;
  var totalUnidades = 0;

  for (var i = 1; i < data.length; i++) {
    var row   = data[i];
    var fecha = new Date(row[0]);
    if (isNaN(fecha.getTime())) continue;
    if (fecha.getMonth() !== mesNum || fecha.getFullYear() !== anioNum) continue;

    var email       = String(row[4]  || '').trim();
    var qty         = parseInt(row[7])      || 0;
    var aporteGrado = parseFloat(row[20])   || 0;
    var grado       = normalizarGradoGAS(String(row[21] || ''));

    if (email && email.indexOf('@') > -1) emailsSet[email] = true;

    totalUnidades += qty;
    totalAporte   += aporteGrado;

    if (grado && grado !== '(Sin observaciones)') {
      if (!porGrado[grado]) porGrado[grado] = { aporte: 0, unidades: 0 };
      porGrado[grado].aporte   += aporteGrado;
      porGrado[grado].unidades += qty;
    }
  }

  var grados = Object.keys(porGrado).sort(function(a, b) {
    if (a === 'J') return -1;
    if (b === 'J') return 1;
    return parseInt(a) - parseInt(b);
  });

  if (grados.length === 0) {
    Logger.log('Sin aportes por grado en ' + mesLabel + '. No se envía mail.');
    return;
  }

  var filasGrado = grados.map(function(g) {
    var d = porGrado[g];
    return '<tr>' +
      '<td style="padding:10px 14px;border-bottom:1px solid #e8f5e9;color:#374151">' + formatearGrado(g) + '</td>' +
      '<td style="padding:10px 14px;border-bottom:1px solid #e8f5e9;text-align:right;font-weight:700;color:#1a5c2a">$' + Math.round(d.aporte).toLocaleString('es-AR') + '</td>' +
      '<td style="padding:10px 14px;border-bottom:1px solid #e8f5e9;text-align:right;color:#6b7280">' + d.unidades + '</td>' +
      '</tr>';
  }).join('');

  var html =
    '<div style="font-family:-apple-system,\'Segoe UI\',sans-serif;max-width:560px;margin:auto;padding:24px;color:#1a1a2e">' +
    '<div style="text-align:center;padding:0 0 24px 0">' +
    '<img src="' + LOGO_B64 + '" style="max-width:200px;width:55%" alt="Diente de León">' +
    '</div>' +
    '<h2 style="color:#3a7d44;margin:0 0 8px 0;font-size:20px">Resumen de aportes · ' + mesLabel + '</h2>' +
    '<p style="color:#555;margin:0 0 20px 0;font-size:14px;line-height:1.6">Gracias a las compras de toda la comunidad Dandelion, este mes se generaron aportes para cada grado. Acá compartimos el resumen:</p>' +

    '<table style="width:100%;border-collapse:collapse;margin-bottom:20px;border-radius:10px;overflow:hidden;border:1px solid #c8e6c9">' +
    '<thead><tr style="background:#3a7d44">' +
    '<th style="padding:11px 14px;text-align:left;color:#fff;font-size:13px;font-weight:600">Grado</th>' +
    '<th style="padding:11px 14px;text-align:right;color:#fff;font-size:13px;font-weight:600">Aporte recaudado</th>' +
    '<th style="padding:11px 14px;text-align:right;color:#fff;font-size:13px;font-weight:600">Unidades vendidas</th>' +
    '</tr></thead>' +
    '<tbody>' + filasGrado + '</tbody>' +
    '<tfoot><tr style="background:#e8f5e9">' +
    '<td style="padding:11px 14px;font-weight:700;font-size:14px">Total</td>' +
    '<td style="padding:11px 14px;text-align:right;font-weight:700;font-size:14px;color:#1a5c2a">$' + Math.round(totalAporte).toLocaleString('es-AR') + '</td>' +
    '<td style="padding:11px 14px;text-align:right;font-weight:700;font-size:14px;color:#555">' + totalUnidades + '</td>' +
    '</tr></tfoot>' +
    '</table>' +

    '<p style="font-size:13px;color:#555;line-height:1.6">Los aportes se transfieren a cada grado durante los primeros días del mes. Si tenés alguna consulta o querés verificar el destino de tu aporte, <a href="https://escuela-dandelion.github.io/Comision-Recursos/wiki-aportes-grado.html" style="color:#3a7d44">visitá nuestra wiki</a>.</p>' +
    '<p style="font-size:11px;color:#aaa;margin-top:24px;padding-top:14px;border-top:1px solid #eee;text-align:center">Tienda Diente de León · Escuela Dandelion Pedagogía Waldorf · Córdoba</p>' +
    '</div>';

  var asunto  = 'Tienda Diente de León — Aportes de ' + mesLabel;
  var emails  = Object.keys(emailsSet);
  var enviados = 0;

  emails.forEach(function(email) {
    try {
      GmailApp.sendEmail(email, asunto, '', {
        htmlBody:    html,
        from:        'tiendavirtual.dientedeleon@gmail.com',
        name:        'Tienda Diente de León'
      });
      enviados++;
    } catch(e) {
      Logger.log('Error enviando a ' + email + ': ' + e.message);
    }
  });

  Logger.log('Informe ' + mesLabel + ' enviado a ' + enviados + '/' + emails.length + ' destinatarios. Aporte total: $' + Math.round(totalAporte) + ' | Unidades: ' + totalUnidades);
}

// Test: envía el informe solo a robertson.ine@gmail.com para previsualizar
function testEnviarInformeMensual() {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Ventas');
  if (!sheet) { Logger.log('Sheet Ventas no encontrada.'); return; }

  var data = sheet.getDataRange().getValues();

  // Forzar septiembre 2026 para el test
  var mesPasado = new Date(2026, 8, 1);
  var mesNum    = mesPasado.getMonth();
  var anioNum   = mesPasado.getFullYear();
  var mesNombre = mesPasado.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  var mesLabel  = mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1);

  var porGrado      = {};
  var totalAporte   = 0;
  var totalUnidades = 0;

  for (var i = 1; i < data.length; i++) {
    var row   = data[i];
    var fecha = new Date(row[0]);
    if (isNaN(fecha.getTime())) continue;
    if (fecha.getMonth() !== mesNum || fecha.getFullYear() !== anioNum) continue;

    var qty         = parseInt(row[7])    || 0;
    var aporteGrado = parseFloat(row[20]) || 0;
    var grado       = normalizarGradoGAS(String(row[21] || ''));

    totalUnidades += qty;
    totalAporte   += aporteGrado;

    if (grado && grado !== '(Sin observaciones)') {
      if (!porGrado[grado]) porGrado[grado] = { aporte: 0, unidades: 0 };
      porGrado[grado].aporte   += aporteGrado;
      porGrado[grado].unidades += qty;
    }
  }

  var grados = Object.keys(porGrado).sort(function(a, b) {
    if (a === 'J') return -1;
    if (b === 'J') return 1;
    return parseInt(a) - parseInt(b);
  });

  if (grados.length === 0) {
    Logger.log('[TEST] Sin aportes por grado en ' + mesLabel + '. Nada para enviar.');
    return;
  }

  var filasGrado = grados.map(function(g) {
    var d = porGrado[g];
    return '<tr>' +
      '<td style="padding:10px 14px;border-bottom:1px solid #e8f5e9;color:#374151">' + formatearGrado(g) + '</td>' +
      '<td style="padding:10px 14px;border-bottom:1px solid #e8f5e9;text-align:right;font-weight:700;color:#1a5c2a">$' + Math.round(d.aporte).toLocaleString('es-AR') + '</td>' +
      '<td style="padding:10px 14px;border-bottom:1px solid #e8f5e9;text-align:right;color:#6b7280">' + d.unidades + '</td>' +
      '</tr>';
  }).join('');

  var html =
    '<div style="font-family:-apple-system,\'Segoe UI\',sans-serif;max-width:560px;margin:auto;padding:24px;color:#1a1a2e">' +
    '<div style="text-align:center;padding:0 0 24px 0">' +
    '<img src="' + LOGO_B64 + '" style="max-width:200px;width:55%" alt="Diente de León">' +
    '</div>' +
    '<h2 style="color:#3a7d44;margin:0 0 8px 0;font-size:20px">Resumen de aportes · ' + mesLabel + '</h2>' +
    '<p style="color:#555;margin:0 0 20px 0;font-size:14px;line-height:1.6">Gracias a las compras de toda la comunidad Dandelion, este mes se generaron aportes para cada grado. Acá compartimos el resumen:</p>' +
    '<table style="width:100%;border-collapse:collapse;margin-bottom:20px;border-radius:10px;overflow:hidden;border:1px solid #c8e6c9">' +
    '<thead><tr style="background:#3a7d44">' +
    '<th style="padding:11px 14px;text-align:left;color:#fff;font-size:13px;font-weight:600">Grado</th>' +
    '<th style="padding:11px 14px;text-align:right;color:#fff;font-size:13px;font-weight:600">Aporte recaudado</th>' +
    '<th style="padding:11px 14px;text-align:right;color:#fff;font-size:13px;font-weight:600">Unidades vendidas</th>' +
    '</tr></thead>' +
    '<tbody>' + filasGrado + '</tbody>' +
    '<tfoot><tr style="background:#e8f5e9">' +
    '<td style="padding:11px 14px;font-weight:700;font-size:14px">Total</td>' +
    '<td style="padding:11px 14px;text-align:right;font-weight:700;font-size:14px;color:#1a5c2a">$' + Math.round(totalAporte).toLocaleString('es-AR') + '</td>' +
    '<td style="padding:11px 14px;text-align:right;font-weight:700;font-size:14px;color:#555">' + totalUnidades + '</td>' +
    '</tr></tfoot>' +
    '</table>' +
    '<p style="font-size:13px;color:#555;line-height:1.6">Los aportes se transfieren a cada grado durante los primeros días del mes. Si tenés alguna consulta o querés verificar el destino de tu aporte, <a href="https://escuela-dandelion.github.io/Comision-Recursos/wiki-aportes-grado.html" style="color:#3a7d44">visitá nuestra wiki</a>.</p>' +
    '<p style="font-size:11px;color:#aaa;margin-top:24px;padding-top:14px;border-top:1px solid #eee;text-align:center">Tienda Diente de León · Escuela Dandelion Pedagogía Waldorf · Córdoba</p>' +
    '</div>';

  GmailApp.sendEmail('robertson.ine@gmail.com', '[TEST] Tienda Diente de León — Aportes de ' + mesLabel, '', {
    htmlBody: html,
    from:     'tiendavirtual.dientedeleon@gmail.com',
    name:     'Tienda Diente de León'
  });
  Logger.log('[TEST] Mail de prueba enviado a robertson.ine@gmail.com — ' + mesLabel + ' | Aportes: $' + Math.round(totalAporte) + ' | Unidades: ' + totalUnidades);
}

// ══════════════════════════════════════════════════════════════
//  GESTIÓN DE PRODUCTOS — TiendaNube API
// ══════════════════════════════════════════════════════════════

function _tnHeaders() {
  return {
    'Authentication': 'bearer ' + CONFIG.API_TOKEN,
    'Content-Type':   'application/json',
    'User-Agent':     CONFIG.TIENDA_NOMBRE + ' (gestion-productos)'
  };
}

function _puedeGestionarMarca(user, brand) {
  if (!user.marcas || user.marcas.length === 0) return user.role === 'ADMIN';
  var up = String(brand || '').toUpperCase();
  return user.marcas.some(function(m) { return m.toUpperCase() === up; });
}

function _authGestion(email) {
  if (!email) return null;
  var user = AUTH_EMAILS[email.toLowerCase().trim()];
  if (!user) return null;
  var puedeGestionar = user.role === 'ADMIN' || user.role === 'digital' || (user.marcas && user.marcas.length > 0);
  return puedeGestionar ? user : null;
}

function _retirosCacheKey(estadoFiltro, diasFiltro) {
  return 'RETIROS_V1_' + (estadoFiltro || 'todos') + '_' + (diasFiltro || 0);
}

function _invalidarCacheRetiros() {
  try {
    CacheService.getScriptCache().removeAll([
      'RETIROS_V1_Pendiente_0',
      'RETIROS_V1_Entregado_60',
      'RETIROS_V1_Todos_30',
      'RETIROS_V1_todos_0',
      'RETIROS_V1__0'
    ]);
  } catch(e) {}
}

function _productosCacheKey(email) {
  var v = PropertiesService.getScriptProperties().getProperty('PROD_CACHE_VERSION') || '0';
  return 'PROD_v' + v + '_' + email.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function _invalidarCacheProductos(email) {
  try { CacheService.getScriptCache().remove(_productosCacheKey(email)); } catch(e) {}
}

function apiProductos(email) {
  var user = _authGestion(email);
  if (!user) return { ok: false, error: 'Sin permiso para gestionar productos.' };

  try {
    var url  = 'https://api.tiendanube.com/v1/' + CONFIG.STORE_ID + '/products?per_page=200';
    var resp = UrlFetchApp.fetch(url, { headers: _tnHeaders(), muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return { ok: false, error: 'Error al cargar productos de TiendaNube.' };
    var productos = JSON.parse(resp.getContentText());

    if (user.role === 'digital') {
      productos = productos.filter(function(p) {
        return CONFIG.DIGITAL_PRODUCT_IDS.indexOf(String(p.id)) !== -1;
      });
    } else if (user.role !== 'ADMIN' && user.marcas && user.marcas.length > 0) {
      var marcasUp = user.marcas.map(function(m) { return m.toUpperCase(); });
      productos = productos.filter(function(p) {
        return marcasUp.indexOf(String(p.brand || '').toUpperCase()) !== -1;
      });
    }

    var velResult  = getVelocidades();
    var velocidades = velResult.velocidades;
    var diasActivos = velResult.diasActivos;
    var overrides   = leerOverridesStock();
    var configMarcas = leerConfigAlertas();
    var ORDEN_SEM = { rojo: 0, naranja: 1, verde: 2 };

    var rows = productos.map(function(p) {
      var nombre = typeof p.name        === 'object' ? (p.name.es        || p.name.pt        || Object.values(p.name)[0]        || '') : (p.name        || '');
      var desc   = typeof p.description === 'object' ? (p.description.es || p.description.pt || '') : (p.description || '');
      var marcaUp = String(p.brand || '').toUpperCase();
      var cfg     = configMarcas[marcaUp] || { leadTime: 10, stockMinimo: CONFIG_STOCK.STOCK_MINIMO };

      var variantes = (p.variants || []).map(function(v) {
        var vn = typeof v.name === 'object' ? (Object.values(v.name).filter(Boolean)[0] || '') : (v.name || '');
        var ov = overrides[p.id + '_' + v.id] || {};
        var sku     = v.sku || '';
        var velMes  = buscarVelocidad(sku, velocidades) || 0;
        var umbral  = (ov.umbralOverride !== null && ov.umbralOverride !== undefined)
                        ? ov.umbralOverride
                        : calcularUmbral(sku, cfg.leadTime, velocidades, diasActivos);
        var piso    = (ov.pisoOverride   !== null && ov.pisoOverride   !== undefined)
                        ? ov.pisoOverride
                        : cfg.stockMinimo;
        var precio  = parseFloat(v.price || 0);
        var costo   = parseFloat(v.cost  || 0);
        var margen  = precio > 0 ? Math.round(((precio - costo) / precio) * 100) : null;
        var semaforo = 'verde';
        if (v.stock !== null && v.stock !== undefined) {
          var st = parseInt(v.stock);
          if (st < piso)     semaforo = 'rojo';
          else if (st <= umbral) semaforo = 'naranja';
        }
        return {
          id:             String(v.id),
          sku:            v.sku || '',
          nombre:         vn,
          precio:         precio,
          costo:          costo,
          margen:         margen,
          stock:          (v.stock === null || v.stock === undefined) ? null : parseInt(v.stock),
          stockP:         (ov.stockP !== null && ov.stockP !== undefined) ? ov.stockP : null,
          stockS:         (ov.stockS !== null && ov.stockS !== undefined) ? ov.stockS : null,
          umbral:         umbral,
          umbralOverride: (ov.umbralOverride !== null && ov.umbralOverride !== undefined) ? ov.umbralOverride : null,
          piso:           piso,
          pisoOverride:   (ov.pisoOverride   !== null && ov.pisoOverride   !== undefined) ? ov.pisoOverride   : null,
          leadTime:       cfg.leadTime || 10,
          velMes:         velMes,
          semaforo:       semaforo,
          activo:         v.visible !== false,
          _dbg_clave_vel: sku
        };
      });

      // semáforo del producto = el peor de sus variantes activas
      var semProd = 'verde';
      variantes.forEach(function(v) {
        if (v.activo && ORDEN_SEM[v.semaforo] < ORDEN_SEM[semProd]) semProd = v.semaforo;
      });

      return {
        id:        String(p.id),
        nombre:    nombre,
        descripcion: desc,
        imagen:    p.images && p.images.length > 0 ? p.images[0].src : '',
        imagenes:  (p.images || []).map(function(img) { return { id: String(img.id), src: img.src }; }),
        brand:     String(p.brand || ''),
        publicado: p.published !== false,
        esDigital: CONFIG.DIGITAL_PRODUCT_IDS.indexOf(String(p.id)) !== -1,
        semaforo:  semProd,
        variantes: variantes
      };
    });

    // Pedidos activos por marca — normalización elimina artículos para comparación robusta
    function normMarca(s) {
      return String(s || '').toUpperCase()
        .replace(/\b(DE|LA|EL|LOS|LAS|DEL|Y|E)\b/g, '')
        .replace(/\s+/g, ' ').trim();
    }
    var pedidosActivos = {};
    try {
      var ACTIVOS_EST = ['solicitado', 'confirmado', 'en camino', 'entregado en escuela', 'recibido', 'en proceso'];
      var ss2 = SpreadsheetApp.openById('1NmjnYWllrXrFpJI8GYJOjkGz90lPtvvDi0IQEYZl7-I');
      var pedSheet = null;
      var allSheets = ss2.getSheets();
      for (var si = 0; si < allSheets.length; si++) {
        if (String(allSheets[si].getSheetId()) === '857535467') { pedSheet = allSheets[si]; break; }
      }
      if (!pedSheet) pedSheet = ss2.getSheets()[0];
      var pedData = pedSheet.getDataRange().getValues();
      for (var pi = 1; pi < pedData.length; pi++) {
        var norden       = String(pedData[pi][0] || '').trim();
        var proveedorRaw = String(pedData[pi][2] || '').trim();
        var estadoPed    = String(pedData[pi][5] || '').trim();
        if (!norden || !proveedorRaw || ACTIVOS_EST.indexOf(estadoPed.toLowerCase()) === -1) continue;
        var marcaPed = normMarca(proveedorRaw);
        if (!pedidosActivos[marcaPed]) pedidosActivos[marcaPed] = [];
        pedidosActivos[marcaPed].push({ norden: norden, estado: estadoPed });
      }
    } catch(errPed) { Logger.log('apiProductos pedidos activos error: ' + errPed); }

    rows.forEach(function(r) {
      var brandKey = normMarca(r.brand);
      r.pedidos = pedidosActivos[brandKey] || [];
    });

    // Ordenar: rojo → naranja → verde
    rows.sort(function(a, b) { return ORDEN_SEM[a.semaforo] - ORDEN_SEM[b.semaforo]; });
    return { ok: true, productos: rows };
  } catch(err) {
    Logger.log('Error apiProductos: ' + err);
    return { ok: false, error: 'Error al cargar productos: ' + err.toString() };
  }
}

function apiUpdateProducto(email, productoId, nombre, descripcion) {
  var user = _authGestion(email);
  if (!user) return { ok: false, error: 'Sin permiso.' };
  if (user.role !== 'ADMIN') {
    var marca = fetchMarcaDeProducto(productoId);
    if (!_puedeGestionarMarca(user, marca)) return { ok: false, error: 'Sin permiso para editar este producto.' };
  }
  var body = {};
  if (nombre      !== undefined && nombre      !== null) body.name        = { es: nombre };
  if (descripcion !== undefined && descripcion !== null) body.description = { es: descripcion };
  if (!Object.keys(body).length) return { ok: false, error: 'Sin datos para actualizar.' };
  var url  = 'https://api.tiendanube.com/v1/' + CONFIG.STORE_ID + '/products/' + productoId;
  var resp = UrlFetchApp.fetch(url, { method: 'put', headers: _tnHeaders(), payload: JSON.stringify(body), muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) { Logger.log('apiUpdateProducto error: ' + resp.getContentText()); return { ok: false, error: 'Error al actualizar producto.' }; }
  _invalidarCacheProductos(email);
  return { ok: true };
}

function apiUpdateVariante(email, productoId, varianteId, precio, precioPromo, costo, stock) {
  var user = _authGestion(email);
  if (!user) return { ok: false, error: 'Sin permiso.' };
  if (user.role !== 'ADMIN') {
    var marca = fetchMarcaDeProducto(productoId);
    if (!_puedeGestionarMarca(user, marca)) return { ok: false, error: 'Sin permiso para editar este producto.' };
  }
  var body = {};
  if (precio      !== undefined && precio      !== null && precio      !== '') body.price             = parseFloat(precio);
  if (precioPromo !== undefined && precioPromo !== null && precioPromo !== '') body.promotional_price = parseFloat(precioPromo) > 0 ? parseFloat(precioPromo) : null;
  if (costo       !== undefined && costo       !== null && costo       !== '') body.cost              = parseFloat(costo);
  if (stock       !== undefined && stock       !== null) body.stock = (stock === '' || stock === 'null' || stock === null) ? null : parseInt(stock);
  if (!Object.keys(body).length) return { ok: false, error: 'Sin datos para actualizar.' };
  var url  = 'https://api.tiendanube.com/v1/' + CONFIG.STORE_ID + '/products/' + productoId + '/variants/' + varianteId;
  var resp = UrlFetchApp.fetch(url, { method: 'put', headers: _tnHeaders(), payload: JSON.stringify(body), muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) { Logger.log('apiUpdateVariante error: ' + resp.getContentText()); return { ok: false, error: 'Error al actualizar variante.' }; }
  _invalidarCacheProductos(email);
  return { ok: true };
}

function apiUpdateStockUbicaciones(email, productoId, varianteId, nombreVariante, stockPStr, stockSStr, stockAnteriorStr) {
  var user = _authGestion(email);
  if (!user) return { ok: false, error: 'Sin permiso.' };
  if (user.role !== 'ADMIN') {
    var marca = fetchMarcaDeProducto(productoId);
    if (!_puedeGestionarMarca(user, marca)) return { ok: false, error: 'Sin permiso para editar este producto.' };
  }

  var stockP = (stockPStr !== undefined && stockPStr !== '' && stockPStr !== null) ? parseInt(stockPStr) : 0;
  var stockS = (stockSStr !== undefined && stockSStr !== '' && stockSStr !== null) ? parseInt(stockSStr) : 0;
  var nuevoTotal    = stockP + stockS;
  var totalAnterior = (stockAnteriorStr !== undefined && stockAnteriorStr !== '' && stockAnteriorStr !== null) ? parseInt(stockAnteriorStr) : null;
  var totalCambio   = totalAnterior === null || nuevoTotal !== totalAnterior;

  // Guardar P/S en ConfigStock (cols 5 y 6)
  try {
    var ss  = SpreadsheetApp.openById(CONFIG_STOCK.SHEET_ID);
    var sh  = ss.getSheetByName('ConfigStock');
    if (!sh) { sh = ss.insertSheet('ConfigStock'); sh.appendRow(['Clave','Nombre','Umbral Override','Piso Override','Stock Primario','Stock Secundario']); }
    var dat = sh.getDataRange().getValues();
    var clave = productoId + '_' + varianteId;
    var found = false;
    for (var k = 1; k < dat.length; k++) {
      if (String(dat[k][0]).trim() === clave) {
        sh.getRange(k + 1, 5).setValue(stockP);
        sh.getRange(k + 1, 6).setValue(stockS);
        found = true; break;
      }
    }
    if (!found) sh.appendRow([clave, nombreVariante, '', '', stockP, stockS]);
  } catch(err) {
    Logger.log('Error guardando stock ubicaciones: ' + err);
    return { ok: false, error: 'Error al guardar en sheet.' };
  }

  // Solo sincronizar TiendaNube si el total cambió
  if (totalCambio) {
    var url  = 'https://api.tiendanube.com/v1/' + CONFIG.STORE_ID + '/products/' + productoId + '/variants/' + varianteId;
    var resp = UrlFetchApp.fetch(url, { method: 'put', headers: _tnHeaders(), payload: JSON.stringify({ stock: nuevoTotal }), muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return { ok: false, error: 'Stock guardado localmente pero error al sincronizar TiendaNube.' };
  }

  _invalidarCacheProductos(email);
  return { ok: true, totalCambio: totalCambio, nuevoTotal: nuevoTotal, stockP: stockP, stockS: stockS };
}

function apiUpdateImagen(email, productoId, base64Data, mimeType) {
  var user = _authGestion(email);
  if (!user) return { ok: false, error: 'Sin permiso.' };
  if (user.role !== 'ADMIN') {
    var marca = fetchMarcaDeProducto(productoId);
    if (!_puedeGestionarMarca(user, marca)) return { ok: false, error: 'Sin permiso para editar este producto.' };
  }
  if (!base64Data) return { ok: false, error: 'Imagen requerida.' };
  try {
    var prodUrl = 'https://api.tiendanube.com/v1/' + CONFIG.STORE_ID + '/products/' + productoId;
    var headers = { 'Authentication': 'bearer ' + CONFIG.API_TOKEN, 'User-Agent': CONFIG.TIENDA_NOMBRE + ' (gestion-productos)' };

    // Eliminar imágenes existentes
    var prodResp = UrlFetchApp.fetch(prodUrl, { headers: headers, muteHttpExceptions: true });
    if (prodResp.getResponseCode() === 200) {
      var prod = JSON.parse(prodResp.getContentText());
      (prod.images || []).forEach(function(img) {
        UrlFetchApp.fetch(prodUrl + '/images/' + img.id, { method: 'delete', headers: headers, muteHttpExceptions: true });
      });
    }

    // Subir nueva imagen como multipart
    var bytes = Utilities.base64Decode(base64Data);
    var blob  = Utilities.newBlob(bytes, mimeType || 'image/jpeg', 'producto.jpg');
    var uploadResp = UrlFetchApp.fetch(prodUrl + '/images', {
      method: 'post', headers: headers,
      payload: { 'filename': blob }, muteHttpExceptions: true
    });
    var code = uploadResp.getResponseCode();
    if (code !== 200 && code !== 201) { Logger.log('apiUpdateImagen error: ' + code + ' ' + uploadResp.getContentText()); return { ok: false, error: 'Error al subir imagen.' }; }
    return { ok: true };
  } catch(err) {
    Logger.log('Error apiUpdateImagen: ' + err);
    return { ok: false, error: 'Error al procesar imagen.' };
  }
}
