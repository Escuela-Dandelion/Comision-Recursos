// ============================================================
// SEF — Sincronización WooCommerce → Google Sheets
// ============================================================

const CFG = {
  WC_URL:    'https://www.proyectosef.com/wp-json/wc/v3',
  CK:        'ck_f3af37eaf1c6331524c1a500872f1dfd22573940',
  CS:        'cs_05d7681e32d757c231ee28e3860177c3b4e7626e',
  SHEET_ID:  '1grum3nxlMLn4y4Br6qrvvRNUs3bVLtwNJF_EI-RBgLQ',
  FECHA_MIN: '2024-01-01T00:00:00', // ignorar transacciones anteriores a 2024
};

const HEADERS_FEES = [
  'fecha', 'wc_orden_id', 'mp_payment_id', 'monto', 'fee_meli'
];

const HEADERS_DEV = [
  'fecha_operacion', 'wc_orden_id', 'quien_informo', 'comprador_id', 'vendedor_id',
  'emprendimiento', 'comunidad', 'monto_total', 'donacion_comprador',
  'donacion_vendedor', 'retencion_sef', 'destino_particular'
];
 
const HEADERS_TRX = [
  'fecha_operacion', 'wc_orden_id', 'orden_original', 'comprador_id', 'vendedor_id',
  'emprendimiento', 'comunidad', 'monto_total', 'donacion_comprador',
  'donacion_vendedor', 'retencion_sef', 'pct_donacion',
  'destino_particular', 'calif_comprador', 'calif_vendedor'
];

const HEADERS_CPEND = HEADERS_TRX; // misma estructura, distinta hoja

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
  sincronizarDevengadas();
  sincronizarTransacciones();
  sincronizarConfirmadasPendientes();
  sincronizarFeesMeli();
  sincronizarUsuarios();
}

// Guardar el access token de MP una sola vez desde el editor de Apps Script:
//   configurarTokenMP('APP_USR-...')
function configurarTokenMP(token) {
  PropertiesService.getScriptProperties().setProperty('MP_ACCESS_TOKEN', token);
  Logger.log('Token MP guardado.');
}

// ── DEVENGADAS (step 1: consumidor informa) ────────────────
// Captura órdenes con quien_informo en metadata pero sin orden_original.
// Representa todos los consumos informados, confirmados o no.
function sincronizarDevengadas() {
  const ss    = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = obtenerHoja(ss, 'Devengadas', HEADERS_DEV);

  const idsExistentes = obtenerSet(sheet, 2); // col 2 = wc_orden_id
  const props    = PropertiesService.getScriptProperties();
  const lastSync = props.getProperty('LAST_SYNC_DEV');

  let page = 1, nuevas = 0, debeParar = false;

  while (!debeParar) {
    let url = CFG.WC_URL + '/orders?status=completed&per_page=50&page=' + page + '&orderby=id&order=desc';
    url += '&after=' + (lastSync || CFG.FECHA_MIN);

    const resp = UrlFetchApp.fetch(url, wcHeaders());
    if (resp.getResponseCode() !== 200) {
      Logger.log('Devengadas error: ' + resp.getResponseCode());
      break;
    }

    const orders = JSON.parse(resp.getContentText());
    if (orders.length === 0) break;

    const rows = [];
    for (var i = 0; i < orders.length; i++) {
      const order = orders[i];
      const meta  = metaMap(order.meta_data);

      // Step 1: tiene quien_informo pero NO tiene orden_original
      if (!meta.quien_informo || meta.orden_original) continue;

      const id = String(order.id);
      if (idsExistentes.has(id)) { debeParar = true; continue; }

      var fechaOp = meta.fecha_operacion || (order.date_created ? order.date_created.substring(0, 10) : '');
      rows.push([
        fechaOp,
        order.id,
        meta.quien_informo || '',
        meta.comprador     || '',
        meta.vendedor      || '',
        meta.emprendimiento || '',
        meta.comunidad_beneficiaria || meta.comunidad_comprador || '',
        parseFloat(meta.monto_total                || 0),
        parseFloat(meta.monto_donacion_comprador   || 0),
        parseFloat(meta.monto_donacion_vendedor    || 0),
        parseFloat(meta.monto_retencion_sef        || 0),
        (meta.dni_destino_comprador && meta.dni_destino_comprador !== '0') ? meta.dni_destino_comprador : ''
      ]);
      idsExistentes.add(id);
      nuevas++;
    }

    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS_DEV.length).setValues(rows);
    }

    const totalPages = parseInt(resp.getHeaders()['x-wp-totalpages'] || '1');
    Logger.log('Devengadas página ' + page + '/' + totalPages + ' — ' + nuevas + ' nuevas');
    if (page >= totalPages) break;
    page++;
    Utilities.sleep(2000);
  }

  props.setProperty('LAST_SYNC_DEV', new Date().toISOString());
  Logger.log('Devengadas: ' + nuevas + ' nuevas registradas.');
}

function resetearDevengadas() {
  PropertiesService.getScriptProperties().deleteProperty('LAST_SYNC_DEV');
  Logger.log('Sync devengadas reseteado.');
}

// ── TRANSACCIONES ──────────────────────────────────────────
function sincronizarTransacciones() {
  const ss    = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = obtenerHoja(ss, 'Transacciones Confirmadas', HEADERS_TRX);

  const idsExistentes = obtenerSet(sheet, 2); // col 2 = wc_orden_id
  const props   = PropertiesService.getScriptProperties();
  const lastSync = props.getProperty('LAST_SYNC_TRX');

  let page = 1;
  let nuevas = 0;
  let debeParar = false;

  while (!debeParar) {
    let url = CFG.WC_URL + '/orders?status=completed&per_page=50&page=' + page + '&orderby=id&order=desc';
    url += '&after=' + (lastSync || CFG.FECHA_MIN);

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

      var fechaOp = meta.fecha_operacion || (order.date_created ? order.date_created.substring(0, 10) : '');
      rows.push([
        fechaOp,
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
    Utilities.sleep(2000); // 2 segundos entre páginas para no saturar el servidor
  }

  props.setProperty('LAST_SYNC_TRX', new Date().toISOString());
  Logger.log('Transacciones: ' + nuevas + ' nuevas registradas.');
}

// ── CONFIRMACIONES PENDIENTES DE PAGO ──────────────────────
// Órdenes de paso 2 (confirmación del vendedor) con status pending/on-hold.
// Se reconstruye completo en cada sync porque el volumen es pequeño.
function sincronizarConfirmadasPendientes() {
  const ss    = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = obtenerHoja(ss, 'Confirmaciones Pendientes', HEADERS_CPEND);

  if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);

  const rows = [];
  var statuses = ['pending', 'on-hold'];
  for (var si = 0; si < statuses.length; si++) {
    var page = 1;
    while (true) {
      var url  = CFG.WC_URL + '/orders?status=' + statuses[si] + '&per_page=100&page=' + page + '&orderby=id&order=desc';
      var resp = UrlFetchApp.fetch(url, wcHeaders());
      if (resp.getResponseCode() !== 200) break;
      var orders = JSON.parse(resp.getContentText());
      if (!orders.length) break;

      for (var i = 0; i < orders.length; i++) {
        var order = orders[i];
        var meta  = metaMap(order.meta_data);
        if (!meta.orden_original || !meta.quien_informo) continue;
        var fechaOp = meta.fecha_operacion || (order.date_created ? order.date_created.substring(0, 10) : '');
        rows.push([
          fechaOp, order.id, meta.orden_original || '',
          meta.comprador || '', meta.vendedor || '', meta.emprendimiento || '',
          meta.comunidad_beneficiaria || meta.comunidad_comprador || '',
          parseFloat(meta.monto_total              || 0),
          parseFloat(meta.monto_donacion_comprador || 0),
          parseFloat(meta.monto_donacion_vendedor  || 0),
          parseFloat(meta.monto_retencion_sef      || 0),
          parseFloat(meta.porcentaje_donacion      || 0),
          (meta.dni_destino_comprador && meta.dni_destino_comprador !== '0') ? meta.dni_destino_comprador : '',
          meta.calificacion_comprador || '', meta.calificacion_vendedor || ''
        ]);
      }
      var totalPages = parseInt(resp.getHeaders()['x-wp-totalpages'] || '1');
      if (page >= totalPages) break;
      page++;
      Utilities.sleep(1000);
    }
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, HEADERS_CPEND.length).setValues(rows);
  }
  Logger.log('Confirmaciones Pendientes: ' + rows.length + ' registradas.');
}

// ── USUARIOS ───────────────────────────────────────────────
function sincronizarUsuarios() {
  const ss       = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheetTrx = ss.getSheetByName('Transacciones Confirmadas');
  const sheet    = obtenerHoja(ss, 'Usuarios', HEADERS_USR);

  // Snapshot completo — limpiar antes de reescribir
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  }

  // Calcular ultima_compra y total_compras desde Transacciones
  const compraMap = {}; // comprador_id → { ultima: "YYYY-MM", total }
  if (sheetTrx && sheetTrx.getLastRow() > 1) {
    const data = sheetTrx.getRange(2, 1, sheetTrx.getLastRow() - 1, 4).getValues();
    for (var i = 0; i < data.length; i++) {
      var mes = toMes(data[i][0]); // normaliza Date obj o string a "YYYY-MM"
      if (!mes) continue;
      var cid = String(data[i][3]);
      if (!compraMap[cid]) compraMap[cid] = { ultima: mes, total: 0 };
      if (mes > compraMap[cid].ultima) compraMap[cid].ultima = mes;
      compraMap[cid].total++;
    }
  }

  const hoy = new Date();
  const hace6meses = new Date(hoy.getFullYear(), hoy.getMonth() - 6, hoy.getDate());

  let page = 1;
  const rows = [];

  while (true) {
    const resp = UrlFetchApp.fetch(CFG.WC_URL + '/customers?per_page=50&page=' + page, wcHeaders());
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
        zombi = new Date(info.ultima + '-01') < hace6meses; // "YYYY-MM" → "YYYY-MM-01"
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
    Utilities.sleep(2000); // 2 segundos entre páginas para no saturar el servidor
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
  'martinimaria39@gmail.com',
  'andyest@gmail.com'
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

// Normaliza cualquier valor de fecha (Date obj, ISO string, DD/MM/YYYY, etc.) a "YYYY-MM"
function toMes(val) {
  if (!val && val !== 0) return null;
  if (Object.prototype.toString.call(val) === '[object Date]') {
    var y  = val.getFullYear();
    var mo = ('0' + (val.getMonth() + 1)).slice(-2);
    return isNaN(y) ? null : y + '-' + mo;
  }
  var s = String(val).trim();
  // ISO: 2026-01-15 o 2026-01
  if (/^\d{4}-\d{2}/.test(s)) return s.substring(0, 7);
  // DD/MM/YYYY o D/M/YYYY
  var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2);
  return null;
}

function agregarDatos() {
  var ss         = SpreadsheetApp.openById(CFG.SHEET_ID);
  var sheetTrx   = ss.getSheetByName('Transacciones Confirmadas');
  var sheetCpend = ss.getSheetByName('Confirmaciones Pendientes');
  var sheetUsr   = ss.getSheetByName('Usuarios');
  var sheetFees  = ss.getSheetByName('FeesMeli');
  var sheetDev   = ss.getSheetByName('Devengadas');

  // fees por mes: mes → total fee
  var feesByMes = {};
  if (sheetFees && sheetFees.getLastRow() > 1) {
    var feesData = sheetFees.getRange(2, 1, sheetFees.getLastRow() - 1, HEADERS_FEES.length).getValues();
    for (var fi = 0; fi < feesData.length; fi++) {
      var fMes = toMes(feesData[fi][0]);
      if (!fMes) continue;
      feesByMes[fMes] = (feesByMes[fMes] || 0) + (parseFloat(feesData[fi][4]) || 0);
    }
  }

  var trxRows = sheetTrx && sheetTrx.getLastRow() > 1
    ? sheetTrx.getRange(2, 1, sheetTrx.getLastRow() - 1, HEADERS_TRX.length).getValues()
    : [];

  var cpendRows = sheetCpend && sheetCpend.getLastRow() > 1
    ? sheetCpend.getRange(2, 1, sheetCpend.getLastRow() - 1, HEADERS_CPEND.length).getValues()
    : [];

  // confirmadas pendientes de pago: por mes
  var cpendByMes = {}, cpendMontoByMes = {};
  for (var cpi = 0; cpi < cpendRows.length; cpi++) {
    var cMes = toMes(cpendRows[cpi][0]);
    if (!cMes) continue;
    cpendByMes[cMes]      = (cpendByMes[cMes]      || 0) + 1;
    cpendMontoByMes[cMes] = (cpendMontoByMes[cMes] || 0) + (parseFloat(cpendRows[cpi][7]) || 0);
  }

  // Set de orden_original confirmadas (trx pagadas + confirmaciones pendientes de pago)
  var confirmados = {};
  for (var ci = 0; ci < trxRows.length; ci++) {
    var oid = String(trxRows[ci][2]);
    if (oid) confirmados[oid] = true;
  }
  for (var cpi0 = 0; cpi0 < cpendRows.length; cpi0++) {
    var oid0 = String(cpendRows[cpi0][2]); // orden_original col 2
    if (oid0) confirmados[oid0] = true;
  }

  var usrRowsEarly = sheetUsr && sheetUsr.getLastRow() > 1
    ? sheetUsr.getRange(2, 1, sheetUsr.getLastRow() - 1, HEADERS_USR.length).getValues()
    : [];
  var vidToNombre = {};
  for (var ui = 0; ui < usrRowsEarly.length; ui++) {
    var uid = String(usrRowsEarly[ui][0]);
    if (uid) vidToNombre[uid] = String(usrRowsEarly[ui][2]).trim() || uid;
  }

  // devengadas por mes + pendientes por emprendimiento
  var devByMes = {}, devMontoByMes = {};
  var devConfByMes = {}, devConfMontoByMes = {}; // confirmadas, agrupadas por fecha de la devengada
  var pendientesPorEmp = {};
  var totalInformados = 0;
  var empTotales = {}; // total informados por emprendimiento (todos, confirmados o no)
  if (sheetDev && sheetDev.getLastRow() > 1) {
    var devData = sheetDev.getRange(2, 1, sheetDev.getLastRow() - 1, HEADERS_DEV.length).getValues();
    for (var di = 0; di < devData.length; di++) {
      var dRow  = devData[di];
      var dMes  = toMes(dRow[0]);
      var dMonto = parseFloat(dRow[7]) || 0;
      if (dMes) {
        devByMes[dMes]      = (devByMes[dMes]      || 0) + 1;
        devMontoByMes[dMes] = (devMontoByMes[dMes] || 0) + dMonto;
        var dIdConf = String(dRow[1]);
        if (confirmados[dIdConf]) {
          devConfByMes[dMes]      = (devConfByMes[dMes]      || 0) + 1;
          devConfMontoByMes[dMes] = (devConfMontoByMes[dMes] || 0) + dMonto;
        }
      }

      var empRaw = String(dRow[5]).trim();
      var emp    = empRaw || vidToNombre[String(dRow[4])] || 'Sin nombre';
      totalInformados++;
      empTotales[emp] = (empTotales[emp] || 0) + 1;

      var dId = String(dRow[1]);
      if (!confirmados[dId]) {
        var monto  = parseFloat(dRow[7]) || 0;
        var dFecha = dRow[0] ? (Object.prototype.toString.call(dRow[0]) === '[object Date]'
          ? dRow[0].toISOString().substring(0, 10)
          : String(dRow[0]).substring(0, 10)) : '';
        if (!pendientesPorEmp[emp]) pendientesPorEmp[emp] = { count: 0, monto: 0, oldest: dFecha, orders: [] };
        pendientesPorEmp[emp].count++;
        pendientesPorEmp[emp].monto += monto;
        pendientesPorEmp[emp].orders.push({ id: dId, monto: monto, fecha: dFecha });
        if (dFecha && (!pendientesPorEmp[emp].oldest || dFecha < pendientesPorEmp[emp].oldest))
          pendientesPorEmp[emp].oldest = dFecha;
      }
    }
  }
  var usrRows = usrRowsEarly;

  var trxByMes          = {};
  var compraCountByMes  = {}; // mes → { cid → count }
  var vendedoresByMes   = {}; // mes → { vid → true }
  var emprendByMes      = {}; // mes → { eid → true }
  var emprendFirstSeen  = {}; // eid → first mes
  var dniByMes          = {}; // mes → { dni → true }

  for (var i = 0; i < trxRows.length; i++) {
    var r = trxRows[i];
    var mes = toMes(r[0]);
    if (!mes) continue;

    if (!trxByMes[mes])         trxByMes[mes]         = { cantidad:0, monto_total:0, donacion_comprador:0, donacion_vendedor:0, retencion_sef:0, a_comunidad:0, a_destinos:0 };
    if (!compraCountByMes[mes]) compraCountByMes[mes]  = {};
    if (!vendedoresByMes[mes])  vendedoresByMes[mes]   = {};
    if (!emprendByMes[mes])     emprendByMes[mes]      = {};
    if (!dniByMes[mes])         dniByMes[mes]          = {};

    var t = trxByMes[mes];
    t.cantidad++;
    t.monto_total        += parseFloat(r[7])  || 0;
    t.donacion_comprador += parseFloat(r[8])  || 0;
    t.donacion_vendedor  += parseFloat(r[9])  || 0;
    t.retencion_sef      += parseFloat(r[10]) || 0;

    var destino = String(r[12]);
    if (destino && destino !== '') {
      t.a_destinos += parseFloat(r[8]) || 0;
      dniByMes[mes][destino] = true;
    } else {
      t.a_comunidad += parseFloat(r[8]) || 0;
    }

    var cid = String(r[3]);
    if (cid) compraCountByMes[mes][cid] = (compraCountByMes[mes][cid] || 0) + 1;

    var vid = String(r[4]);
    if (vid) vendedoresByMes[mes][vid] = true;

    var eid = String(r[5]);
    if (eid) {
      emprendByMes[mes][eid] = true;
      if (!emprendFirstSeen[eid] || mes < emprendFirstSeen[eid]) emprendFirstSeen[eid] = mes;
    }
  }

  var curiosos = 0, zombies = 0;
  var nuevosByMes    = {}; // mes registro → nuevos usuarios
  var curiososByMes  = {}; // mes registro → nuevos curiosos (registrado ese mes, nunca compró)
  var zombiesByMes   = {}; // mes ultima_compra → zombies (última compra ese mes, ahora inactivos)
  for (var j = 0; j < usrRows.length; j++) {
    var u = usrRows[j];
    if (u[7] === 'Si') curiosos++;
    if (u[8] === 'Si') zombies++;
    var mr = toMes(u[3]); // fecha_registro
    if (mr) {
      nuevosByMes[mr] = (nuevosByMes[mr] || 0) + 1;
      if (u[7] === 'Si') curiososByMes[mr] = (curiososByMes[mr] || 0) + 1;
    }
    var mz = toMes(u[5]); // ultima_compra
    if (mz && u[8] === 'Si') zombiesByMes[mz] = (zombiesByMes[mz] || 0) + 1;
  }

  var fechaMinMes = CFG.FECHA_MIN.substring(0, 7); // "2024-01"
  var allMeses = {};
  Object.keys(trxByMes).forEach(function(m)   { if (m >= fechaMinMes) allMeses[m] = true; });
  Object.keys(nuevosByMes).forEach(function(m) { if (m >= fechaMinMes) allMeses[m] = true; });
  Object.keys(devByMes).forEach(function(m)    { if (m >= fechaMinMes) allMeses[m] = true; });
  var meses = Object.keys(allMeses).sort();

  var porMes = meses.map(function(mes) {
    var t   = trxByMes[mes]         || { cantidad:0, monto_total:0, donacion_comprador:0, donacion_vendedor:0, retencion_sef:0, a_comunidad:0, a_destinos:0 };
    var cc  = compraCountByMes[mes] || {};
    var vnd = vendedoresByMes[mes]  || {};
    var emp = emprendByMes[mes]     || {};
    var dni = dniByMes[mes]         || {};

    var uam = 0, eventuales = 0, activos = 0;
    Object.keys(cc).forEach(function(cid) {
      uam++;
      if (cc[cid] === 1) eventuales++;
      else activos++;
    });

    var nuevos_emprendimientos = Object.keys(emp).filter(function(eid) {
      return emprendFirstSeen[eid] === mes;
    }).length;

    return {
      mes:                    mes,
      nuevos_usuarios:        nuevosByMes[mes]   || 0,
      uam:                    uam,
      eventuales:             eventuales,
      activos:                activos,
      prosumidores:           Object.keys(vnd).length,
      emprendimientos:        Object.keys(emp).length,
      nuevos_emprendimientos: nuevos_emprendimientos,
      nuevos_curiosos:        curiososByMes[mes] || 0,
      nuevos_zombies:         zombiesByMes[mes]  || 0,
      cantidad:               t.cantidad,
      monto_total:            Math.round(t.monto_total),
      donacion_comprador:     Math.round(t.donacion_comprador),
      donacion_vendedor:      Math.round(t.donacion_vendedor),
      retencion_sef:          Math.round(t.retencion_sef),
      a_comunidad:            Math.round(t.a_comunidad),
      a_destinos:             Math.round(t.a_destinos),
      donacion_total:         Math.round(t.donacion_comprador + t.donacion_vendedor),
      dni_destino:            Object.keys(dni).length,
      fee_meli:               Math.round(feesByMes[mes] || 0),
      cantidad_informada:     devByMes[mes]          || 0,
      monto_informada:        Math.round(devMontoByMes[mes]     || 0),
      cantidad_confirmada:    devConfByMes[mes]      || 0,
      monto_confirmada:       Math.round(devConfMontoByMes[mes] || 0)
    };
  });

  // Exponer comprador y vendedor por mes para cálculo de ventana en el cliente
  var compradoresPorMes = {};
  var vendedoresPorMes  = {};
  Object.keys(compraCountByMes).forEach(function(m) {
    compradoresPorMes[m] = compraCountByMes[m];
  });
  Object.keys(vendedoresByMes).forEach(function(m) {
    vendedoresPorMes[m] = Object.keys(vendedoresByMes[m]);
  });

  var pendientesArr = Object.keys(pendientesPorEmp).map(function(emp) {
    return {
      emprendimiento: emp,
      count:          pendientesPorEmp[emp].count,
      total:          empTotales[emp] || 0,
      monto:          Math.round(pendientesPorEmp[emp].monto),
      oldest:         pendientesPorEmp[emp].oldest,
      orders:         pendientesPorEmp[emp].orders
    };
  }).sort(function(a, b) { return b.monto - a.monto; });

  return {
    generado:               Utilities.formatDate(new Date(), 'America/Argentina/Cordoba', 'dd/MM/yyyy HH:mm'),
    usuarios:               { total: usrRows.length, curiosos: curiosos, zombies: zombies },
    transacciones:          { total: trxRows.length },
    por_mes:                porMes,
    compradores_por_mes:    compradoresPorMes,
    vendedores_por_mes:     vendedoresPorMes,
    pendientes_por_vendedor: pendientesArr,
    total_informados:        totalInformados
  };
}

// ── FEES MERCADO PAGO ──────────────────────────────────────
// Captura las órdenes de "Pago de Donaciones" (paso 3 del flujo SEF),
// consulta la API de MP por el fee real de cada una y lo guarda en FeesMeli.
function sincronizarFeesMeli() {
  const token = PropertiesService.getScriptProperties().getProperty('MP_ACCESS_TOKEN');
  if (!token) {
    Logger.log('FeesMeli: sin token MP — salteando. Corré configurarTokenMP(token) primero.');
    return;
  }

  const ss    = SpreadsheetApp.openById(CFG.SHEET_ID);
  const sheet = obtenerHoja(ss, 'FeesMeli', HEADERS_FEES);

  const idsExistentes = obtenerSet(sheet, 2); // col 2 = wc_orden_id
  const props     = PropertiesService.getScriptProperties();
  const lastSync  = props.getProperty('LAST_SYNC_FEES');
  const startTime = Date.now();
  const MAX_MS    = 5 * 60 * 1000; // corta a los 5 min para no chocar con el límite de 6

  // Retoma desde la página donde quedó si hubo un corte anterior
  let page   = parseInt(props.getProperty('FEES_RESUME_PAGE') || '1');
  let nuevas = 0;

  while (true) {
    let url = CFG.WC_URL + '/orders?status=completed&per_page=50&page=' + page + '&orderby=id&order=desc';
    url += '&after=' + (lastSync || CFG.FECHA_MIN);

    const resp = UrlFetchApp.fetch(url, wcHeaders());
    if (resp.getResponseCode() !== 200) break;

    const orders = JSON.parse(resp.getContentText());
    if (orders.length === 0) break;

    const rows = [];
    for (var i = 0; i < orders.length; i++) {
      const order = orders[i];
      const meta  = metaMap(order.meta_data);

      if (!meta.orden_de_pago || !meta._Mercado_Pago_Payment_IDs) continue;

      const id = String(order.id);
      if (idsExistentes.has(id)) continue; // ya procesada, salteamos sin parar

      const mpId  = String(meta._Mercado_Pago_Payment_IDs).trim();
      const fecha = order.date_created ? order.date_created.substring(0, 10) : '';
      const monto = parseFloat(order.total) || 0;
      const fee   = obtenerFeeMeli(mpId, token);

      rows.push([fecha, order.id, mpId, monto, fee]);
      idsExistentes.add(id);
      nuevas++;

      Utilities.sleep(500);
    }

    if (rows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS_FEES.length).setValues(rows);
    }

    const totalPages = parseInt(resp.getHeaders()['x-wp-totalpages'] || '1');
    Logger.log('FeesMeli página ' + page + '/' + totalPages + ' — ' + nuevas + ' nuevas esta ejecucion');

    if (page >= totalPages) {
      // Sync completo
      props.deleteProperty('FEES_RESUME_PAGE');
      props.setProperty('LAST_SYNC_FEES', new Date().toISOString());
      Logger.log('FeesMeli: sync completo. ' + nuevas + ' nuevas registradas.');
      return;
    }

    page++;

    if (Date.now() - startTime > MAX_MS) {
      // Guarda la página donde quedó y avisa
      props.setProperty('FEES_RESUME_PAGE', String(page));
      Logger.log('FeesMeli: tiempo limite alcanzado. Corré sincronizarFeesMeli() de nuevo para continuar desde página ' + page + '/' + totalPages + '.');
      return;
    }

    Utilities.sleep(2000);
  }

  props.deleteProperty('FEES_RESUME_PAGE');
  props.setProperty('LAST_SYNC_FEES', new Date().toISOString());
  Logger.log('FeesMeli: ' + nuevas + ' nuevas registradas.');
}

function obtenerFeeMeli(mpPaymentId, token) {
  try {
    const resp = UrlFetchApp.fetch(
      'https://api.mercadopago.com/v1/payments/' + mpPaymentId,
      { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return 0;
    const data = JSON.parse(resp.getContentText());
    var fee = 0;
    (data.fee_details || []).forEach(function(f) { fee += f.amount || 0; });
    return Math.round(fee);
  } catch(e) {
    Logger.log('Error fee MP ' + mpPaymentId + ': ' + e);
    return 0;
  }
}

function resetearFees() {
  PropertiesService.getScriptProperties().deleteProperty('LAST_SYNC_FEES');
  Logger.log('Sync fees reseteado.');
}

// ── RESALTAR PENDIENTES ────────────────────────────────────
// Correr manualmente desde el editor para pintar las filas
// de Devengadas que aún no fueron confirmadas por el vendedor.
function resaltarPendientes() {
  var ss       = SpreadsheetApp.openById(CFG.SHEET_ID);
  var sheetDev = ss.getSheetByName('Devengadas');
  var sheetTrx = ss.getSheetByName('Transacciones Confirmadas');

  if (!sheetDev) { Logger.log('Hoja Devengadas no encontrada.'); return; }

  // Set de orden_original confirmadas
  var confirmados = {};
  if (sheetTrx && sheetTrx.getLastRow() > 1) {
    var trxIds = sheetTrx.getRange(2, 3, sheetTrx.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < trxIds.length; i++) {
      var oid = String(trxIds[i][0]);
      if (oid) confirmados[oid] = true;
    }
  }

  var lastRow = sheetDev.getLastRow();
  if (lastRow < 2) { Logger.log('Devengadas vacía.'); return; }

  var ids   = sheetDev.getRange(2, 2, lastRow - 1, 1).getValues(); // col B = wc_orden_id
  var range = sheetDev.getRange(2, 1, lastRow - 1, HEADERS_DEV.length);
  var bgs   = range.getBackgrounds();

  var PENDIENTE = '#FFE0B2'; // naranja claro
  var NORMAL    = '#FFFFFF';

  var pendientes = 0;
  for (var r = 0; r < ids.length; r++) {
    var dId      = String(ids[r][0]);
    var isPend   = dId && !confirmados[dId];
    var color    = isPend ? PENDIENTE : NORMAL;
    for (var c = 0; c < HEADERS_DEV.length; c++) {
      bgs[r][c] = color;
    }
    if (isPend) pendientes++;
  }

  range.setBackgrounds(bgs);
  Logger.log('Listo. ' + pendientes + ' filas resaltadas como pendientes de confirmacion.');
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
