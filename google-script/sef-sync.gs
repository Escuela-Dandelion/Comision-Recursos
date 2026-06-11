// ============================================================
// SEF — Sincronización WooCommerce → Google Sheets
// ============================================================

const CFG = {
  WC_URL:   'https://www.proyectosef.com/wp-json/wc/v3',
  CK:       'ck_f3af37eaf1c6331524c1a500872f1dfd22573940',
  CS:       'cs_05d7681e32d757c231ee28e3860177c3b4e7626e',
  SHEET_ID: '1grum3nxlMLn4y4Br6qrvvRNUs3bVLtwNJF_EI-RBgLQ',
};

const HEADERS_TRX = [
  'fecha_operacion', 'wc_orden_id', 'orden_original', 'comprador_id', 'vendedor_id',
  'emprendimiento', 'comunidad', 'monto_total', 'donacion_comprador',
  'donacion_vendedor', 'retencion_sef', 'pct_donacion',
  'destino_particular', 'calif_comprador', 'calif_vendedor'
];

const HEADERS_USR = [
  'customer_id', 'email', 'nombre', 'fecha_registro',
  'is_paying', 'ultima_compra', 'total_compras', 'curioso', 'zombi'
];

// ── AUTENTICACIÓN ──────────────────────────────────────────
function wcHeaders() {
  return {
    headers: { 'Authorization': 'Basic ' + Utilities.base64Encode(CFG.CK + ':' + CFG.CS) },
    muteHttpExceptions: true
  };
}

// ── FUNCIÓN PRINCIPAL ──────────────────────────────────────
function sincronizarTodo() {
  sincronizarTransacciones();
  sincronizarUsuarios();
}

// ── TRANSACCIONES ──────────────────────────────────────────
function sincronizarTransacciones() {
  const ss    = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = obtenerHoja(ss, 'Transacciones', HEADERS_TRX);

  const idsExistentes = obtenerSet(sheet, 2); // col 2 = wc_orden_id
  const props   = PropertiesService.getScriptProperties();
  const lastSync = props.getProperty('LAST_SYNC_TRX');

  let page = 1;
  let nuevas = 0;
  let debeParar = false;

  while (!debeParar) {
    let url = CFG.WC_URL + '/orders?status=completed&per_page=100&page=' + page + '&orderby=id&order=desc';
    if (lastSync) url += '&after=' + lastSync;

    const resp = UrlFetchApp.fetch(url, wcHeaders());
    if (resp.getResponseCode() !== 200) {
      Logger.log('Error: ' + resp.getResponseCode() + ' — ' + resp.getContentText().substring(0, 200));
      break;
    }

    const orders = JSON.parse(resp.getContentText());
    if (orders.length === 0) break;

    const rows = [];
    for (var i = 0; i < orders.length; i++) {
      const order = orders[i];
      const meta  = metaMap(order.meta_data);

      // Solo registros SEF: tienen orden_original en metadata
      if (!meta.orden_original) continue;

      const id = String(order.id);
      if (idsExistentes.has(id)) {
        debeParar = true;
        continue;
      }

      rows.push([
        meta.fecha_operacion || '',
        order.id,
        meta.orden_original   || '',
        meta.comprador        || '',
        meta.vendedor         || '',
        meta.emprendimiento   || '',
        meta.comunidad_beneficiaria || meta.comunidad_comprador || '',
        parseFloat(meta.monto_total               || 0),
        parseFloat(meta.monto_donacion_comprador   || 0),
        parseFloat(meta.monto_donacion_vendedor    || 0),
        parseFloat(meta.monto_retencion_sef        || 0),
        parseFloat(meta.porcentaje_donacion        || 0),
        (meta.dni_destino_comprador && meta.dni_destino_comprador !== '0') ? meta.dni_destino_comprador : '',
        meta.calificacion_comprador || '',
        meta.calificacion_vendedor  || ''
      ]);
      idsExistentes.add(id);
      nuevas++;
    }

    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS_TRX.length).setValues(rows);
    }

    const totalPages = parseInt(resp.getHeaders()['x-wp-totalpages'] || '1');
    Logger.log('Página ' + page + '/' + totalPages + ' — ' + nuevas + ' nuevas hasta ahora');
    if (page >= totalPages) break;
    page++;
  }

  props.setProperty('LAST_SYNC_TRX', new Date().toISOString());
  Logger.log('Transacciones: ' + nuevas + ' nuevas registradas.');
}

// ── USUARIOS ───────────────────────────────────────────────
function sincronizarUsuarios() {
  const ss       = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheetTrx = ss.getSheetByName('Transacciones');
  const sheet    = obtenerHoja(ss, 'Usuarios', HEADERS_USR);

  // Snapshot completo — limpiar antes de reescribir
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }

  // Calcular ultima_compra y total_compras desde Transacciones
  const compraMap = {}; // comprador_id → { ultima, total }
  if (sheetTrx && sheetTrx.getLastRow() > 1) {
    const data = sheetTrx.getRange(2, 1, sheetTrx.getLastRow() - 1, 4).getValues();
    for (var i = 0; i < data.length; i++) {
      const fecha = String(data[i][0]);
      const cid   = String(data[i][3]); // col 4 = comprador_id
      if (!compraMap[cid]) compraMap[cid] = { ultima: fecha, total: 0 };
      if (fecha > compraMap[cid].ultima) compraMap[cid].ultima = fecha;
      compraMap[cid].total++;
    }
  }

  const hoy = new Date();
  const hace6meses = new Date(hoy.getFullYear(), hoy.getMonth() - 6, hoy.getDate());

  let page = 1;
  const rows = [];

  while (true) {
    const resp = UrlFetchApp.fetch(CFG.WC_URL + '/customers?per_page=100&page=' + page, wcHeaders());
    if (resp.getResponseCode() !== 200) break;

    const customers = JSON.parse(resp.getContentText());
    if (customers.length === 0) break;

    for (var j = 0; j < customers.length; j++) {
      const c    = customers[j];
      const cid  = String(c.id);
      const info = compraMap[cid] || { ultima: '', total: 0 };
      const isPaying = c.is_paying_customer;

      const curioso = !isPaying;
      let zombi = false;
      if (isPaying && info.ultima) {
        zombi = new Date(info.ultima) < hace6meses;
      }

      rows.push([
        c.id,
        c.email,
        (c.first_name + ' ' + c.last_name).trim(),
        c.date_created ? c.date_created.substring(0, 10) : '',
        isPaying ? 'Si' : 'No',
        info.ultima,
        info.total,
        curioso ? 'Si' : 'No',
        zombi   ? 'Si' : 'No'
      ]);
    }

    const totalPages = parseInt(resp.getHeaders()['x-wp-totalpages'] || '1');
    if (page >= totalPages) break;
    page++;
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, HEADERS_USR.length).setValues(rows);
  }

  Logger.log('Usuarios: ' + rows.length + ' registrados en el sheet.');
}

// ── HELPERS ────────────────────────────────────────────────
function metaMap(metaData) {
  const map = {};
  if (!metaData) return map;
  for (var i = 0; i < metaData.length; i++) map[metaData[i].key] = metaData[i].value;
  return map;
}

function obtenerHoja(ss, nombre, headers) {
  var sheet = ss.getSheetByName(nombre);
  if (!sheet) {
    sheet = ss.insertSheet(nombre);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#e8f5e9');
  }
  return sheet;
}

function obtenerSet(sheet, col) {
  const set = new Set();
  if (sheet.getLastRow() < 2) return set;
  const vals = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) set.add(String(vals[i][0]));
  return set;
}

// ── API PARA EL DASHBOARD ──────────────────────────────────
var EMAILS_PERMITIDOS = [
  'robertson.ine@gmail.com',
  'martinimaria39@gmail.com'
  // agregar más emails acá
];

function doGet(e) {
  var email    = (e && e.parameter && e.parameter.email    || '').toLowerCase().trim();
  var callback = (e && e.parameter && e.parameter.callback || '');

  var data;
  if (!email || EMAILS_PERMITIDOS.indexOf(email) === -1) {
    data = { ok: false, error: 'Sin acceso' };
  } else {
    data = agregarDatos();
    data.ok = true;
  }

  var json = JSON.stringify(data);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function agregarDatos() {
  var ss       = SpreadsheetApp.openById(CFG.SHEET_ID);
  var sheetTrx = ss.getSheetByName('Transacciones');
  var sheetUsr = ss.getSheetByName('Usuarios');

  var trxRows = sheetTrx && sheetTrx.getLastRow() > 1
    ? sheetTrx.getRange(2, 1, sheetTrx.getLastRow() - 1, HEADERS_TRX.length).getValues()
    : [];
  var usrRows = sheetUsr && sheetUsr.getLastRow() > 1
    ? sheetUsr.getRange(2, 1, sheetUsr.getLastRow() - 1, HEADERS_USR.length).getValues()
    : [];

  var trxByMes = {};
  var uamByMes = {};

  for (var i = 0; i < trxRows.length; i++) {
    var r = trxRows[i];
    var fecha = String(r[0]);
    if (!fecha || fecha.length < 7) continue;
    var mes = fecha.substring(0, 7);

    if (!trxByMes[mes]) trxByMes[mes] = { cantidad:0, monto_total:0, donacion_comprador:0, donacion_vendedor:0, retencion_sef:0, a_comunidad:0, a_destinos:0 };
    if (!uamByMes[mes]) uamByMes[mes] = {};

    var t = trxByMes[mes];
    t.cantidad++;
    t.monto_total        += parseFloat(r[7])  || 0;
    t.donacion_comprador += parseFloat(r[8])  || 0;
    t.donacion_vendedor  += parseFloat(r[9])  || 0;
    t.retencion_sef      += parseFloat(r[10]) || 0;

    var destino = String(r[12]);
    if (destino && destino !== '') {
      t.a_destinos += parseFloat(r[8]) || 0;
    } else {
      t.a_comunidad += parseFloat(r[8]) || 0;
    }
    var cid = String(r[3]);
    if (cid) uamByMes[mes][cid] = true;
  }

  var curiosos = 0, zombies = 0;
  var nuevosByMes = {};
  for (var j = 0; j < usrRows.length; j++) {
    var u = usrRows[j];
    if (u[7] === 'Si') curiosos++;
    if (u[8] === 'Si') zombies++;
    var fechaReg = String(u[3]);
    if (fechaReg && fechaReg.length >= 7) {
      var mr = fechaReg.substring(0, 7);
      nuevosByMes[mr] = (nuevosByMes[mr] || 0) + 1;
    }
  }

  var allMeses = {};
  Object.keys(trxByMes).forEach(function(m) { allMeses[m] = true; });
  Object.keys(nuevosByMes).forEach(function(m) { allMeses[m] = true; });
  var meses = Object.keys(allMeses).sort();

  var porMes = meses.map(function(mes) {
    var t = trxByMes[mes] || { cantidad:0, monto_total:0, donacion_comprador:0, donacion_vendedor:0, retencion_sef:0, a_comunidad:0, a_destinos:0 };
    return {
      mes:                mes,
      nuevos_usuarios:    nuevosByMes[mes] || 0,
      uam:                Object.keys(uamByMes[mes] || {}).length,
      cantidad:           t.cantidad,
      monto_total:        Math.round(t.monto_total),
      donacion_comprador: Math.round(t.donacion_comprador),
      donacion_vendedor:  Math.round(t.donacion_vendedor),
      retencion_sef:      Math.round(t.retencion_sef),
      a_comunidad:        Math.round(t.a_comunidad),
      a_destinos:         Math.round(t.a_destinos),
      donacion_total:     Math.round(t.donacion_comprador + t.donacion_vendedor)
    };
  });

  return {
    generado:      Utilities.formatDate(new Date(), 'America/Argentina/Cordoba', 'dd/MM/yyyy HH:mm'),
    usuarios:      { total: usrRows.length, curiosos: curiosos, zombies: zombies },
    transacciones: { total: trxRows.length },
    por_mes:       porMes
  };
}

// ── TRIGGER ────────────────────────────────────────────────
function crearTrigger() {
  ScriptApp.newTrigger('sincronizarTodo').timeBased().everyHours(6).create();
  Logger.log('Trigger creado: cada 6 horas.');
}

function resetearSync() {
  PropertiesService.getScriptProperties().deleteProperty('LAST_SYNC_TRX');
  Logger.log('Sync reseteado — proxima ejecucion trae todo el historial.');
}
