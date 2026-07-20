// ============================================================
// DIENTE DE LEÓN — Agendamiento de Retiro de Mercadería
// ============================================================
// Recibe POST desde retiro-proveedor.html (GitHub Pages),
// crea evento en Google Calendar y envía WhatsApp al colaborador.
// ============================================================

const CONFIG_RETIRO = {
  CALENDAR_ID:      'd464a84a472a8802d4b6cd6641f19b2c71d71f257b5409e975d0cc4ee66bf0ad@group.calendar.google.com',
  PEDIDOS_SHEET_ID: '1NmjnYWllrXrFpJI8GYJOjkGz90lPtvvDi0IQEYZl7-I',
  PEDIDOS_GID:      '857535467'
};

const PHONE_MAP = {
  'Ines Robertson':          '5493512112050',
  'Jose Carranza':           '5493516529993',
  'Yuliana Longhi':          '5493513645612',
  'Maria Martini':           '5493516865078',
  'Luli del Castillo':       '5493513003789',
  'Valeria Pierobon':        '5493512389386',
  'Andrea Truppia':          '5493515640578',
  'Dario Vota':              '5493512414523',
  'Otra Persona del Pool':   null  // teléfono se recibe en data.telefono_manual
};

// ── WEB APP ENDPOINT ────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    Logger.log('Datos recibidos: ' + JSON.stringify(data));

    let resultado;
    const action = data.action || 'agendarRetiro';

    if (action === 'agendarRetiro') {
      resultado = agendarRetiro(data);
    } else if (action === 'updateEstado') {
      resultado = updateEstadoPedido(data);
    } else if (action === 'registrarPedido') {
      resultado = registrarPedidoEnSheet(data);
    } else if (action === 'subirComprobante') {
      resultado = subirComprobanteEnDrive(data);
    } else if (action === 'eliminarPedido') {
      resultado = eliminarPedidoDeSheet(data);
    } else if (action === 'updateTotal') {
      resultado = updateTotalPedido(data);
    } else if (action === 'updateProductos') {
      resultado = updateProductosPedido(data);
    } else if (action === 'updateProveedor') {
      resultado = updateProveedorPedido(data);
    } else if (action === 'saveStockOverride') {
      guardarOverrideStock(data.clave, data.nombre, data.umbralOverride, data.pisoOverride);
      resultado = { saved: true };
    } else {
      throw new Error('Acción no reconocida: ' + action);
    }

    // resultado puede ser string o {url:...}
    const respuesta = (typeof resultado === 'object')
      ? Object.assign({ ok: true }, resultado)
      : { ok: true, mensaje: resultado };

    return ContentService
      .createTextOutput(JSON.stringify(respuesta))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('Error en doPost: ' + err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// GET: permite leer pedidos por query param ?action=getPedidos o ?action=getPedido&id=ORD-xxx
function doGet(e) {
  try {
    const action = e.parameter.action || '';

    if (action === 'getPedidos') {
      const excluir        = e.parameter.excluir || 'Cerrado'; // por defecto excluye Cerrados
      const incluirCerrados = e.parameter.incluirCerrados === '1';
      let pedidos = leerPedidos();
      if (!incluirCerrados && excluir) {
        const excluidos = excluir.split(',').map(function(s){ return s.trim(); });
        pedidos = pedidos.filter(function(p){ return excluidos.indexOf(p.estado) === -1; });
      }
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, pedidos: pedidos }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'getProductosTN') {
      const productos = obtenerProductosTN();
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, productos: productos }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'getProveedores') {
      // 1. Teles guardados en la tab Proveedores
      const ss    = SpreadsheetApp.openById(CONFIG_RETIRO.PEDIDOS_SHEET_ID);
      const sheet = ss.getSheetByName('Proveedores');
      const telMap = {};
      if (sheet) {
        const data = sheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          if (data[i][0]) telMap[String(data[i][0]).toUpperCase()] = String(data[i][1] || '');
        }
      }
      // 2. Marcas de TiendaNube como lista base
      let brandsSet = {};
      try { brandsSet = obtenerMarcasTN(); } catch(e) { Logger.log('Error marcas TN: ' + e.message); }
      // 3. Merge: marcas TN + proveedores del Sheet (puede haber proveedores sin marca TN)
      const listaMap = {};
      Object.keys(brandsSet).forEach(function(key) {
        listaMap[key] = { nombre: brandsSet[key], tel: telMap[key] || '' };
      });
      Object.keys(telMap).forEach(function(key) {
        if (!listaMap[key]) listaMap[key] = { nombre: key, tel: telMap[key] };
      });
      const lista = Object.values(listaMap).sort(function(a,b){ return a.nombre.localeCompare(b.nombre); });
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, proveedores: lista }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'getTelProveedores') {
      const ss    = SpreadsheetApp.openById(CONFIG_RETIRO.PEDIDOS_SHEET_ID);
      const sheet = ss.getSheetByName('Proveedores');
      const map   = {};
      if (sheet) {
        const data = sheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          if (data[i][0]) map[String(data[i][0]).toUpperCase()] = String(data[i][1] || '');
        }
      }
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, proveedores: map }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'getPedido') {
      const id = e.parameter.id;
      if (!id) throw new Error('Falta parámetro id');
      const pedido = leerPedidoPorId(id);
      if (!pedido) throw new Error('Pedido no encontrado: ' + id);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, pedido: pedido }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'updateNotas') {
      const resultado = leerPedidoPorId(e.parameter.norden || '');
      if (!resultado) throw new Error('Pedido no encontrado');
      const sheet = getPedidosSheet();
      sheet.getRange(resultado.fila, COL.NOTAS + 1).setValue(e.parameter.notas || '');
      Logger.log('Notas actualizadas: ' + e.parameter.norden);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'updateRetiroData') {
      const resultado = actualizarRetiroEnSheet(e.parameter);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, updated: true, mensaje: resultado }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'updateEstado') {
      const resultado = updateEstadoPedido({
        norden: e.parameter.norden || '',
        estado: e.parameter.estado || '',
        quien:  e.parameter.quien  || '',
        notas:  e.parameter.notas  || ''
      });
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, updated: true, mensaje: resultado }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'getStockDashboard') {
      const dash = getStockDashboard();
      return ContentService
        .createTextOutput(JSON.stringify(dash))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Health check
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, updated: false, status: 'DdL Retiro API activa' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── LÓGICA PRINCIPAL ────────────────────────────────────────
function agendarRetiro(data) {
  const {
    proveedor,
    producto,
    retira,
    lugar,
    fecha_retiro,
    fecha_escuela,
    norden,
    notas,
    fgp
  } = data;

  // 1. Crear evento en Google Calendar
  crearEventoCalendario(data);

  // 2. Guardar todos los datos del retiro en la planilla
  if (norden) {
    try {
      const resultado = leerPedidoPorId(norden);
      if (resultado) {
        const sheet = getPedidosSheet();
        const fila  = resultado.fila;
        if (retira)        sheet.getRange(fila, COL.QUIEN + 1).setValue(retira);
        if (fecha_retiro)  sheet.getRange(fila, COL.FECHA_RETIRO + 1).setValue(fecha_retiro);
        if (lugar)         sheet.getRange(fila, COL.LUGAR_RETIRO + 1).setValue(lugar);
        if (fecha_escuela) sheet.getRange(fila, COL.FECHA_ESCUELA + 1).setValue(fecha_escuela);
      }
    } catch(e) {
      Logger.log('No se pudo registrar datos de retiro: ' + e.message);
    }
  }

  return 'Retiro agendado: ' + proveedor + ' — ' + fecha_retiro;
}

// ── CALENDARIO ──────────────────────────────────────────────
function crearEventoCalendario(data) {
  const cal = CalendarApp.getCalendarById(CONFIG_RETIRO.CALENDAR_ID);
  if (!cal) throw new Error('Calendario no encontrado: ' + CONFIG_RETIRO.CALENDAR_ID);

  const fechaRetiro = parsearFecha(data.fecha_retiro);

  const titulo = '🚚 Retiro ' + data.proveedor + ' — ' + data.retira;

  const cantidadStr = (data.cantidad ? data.cantidad + (data.unidad ? ' ' + data.unidad : '') : '');
  const descripcion = [
    '📦 Proveedor: '    + data.proveedor,
    '🛍️ Producto: '     + data.producto + (cantidadStr ? ' (' + cantidadStr + ')' : ''),
    '👤 Retira: '       + data.retira,
    '📍 Lugar: '        + (data.lugar || '—'),
    '📋 N° Orden: '     + (data.norden || '—'),
    '🏫 Entrega escuela: ' + (data.fecha_escuela || 'A confirmar'),
    '',
    data.notas ? '📝 Notas: ' + data.notas : '',
    '',
    data.fgp ? 'FGP responsable: ' + data.fgp : ''
  ].filter(l => l !== undefined).join('\n');

  if (data.fecha_escuela) {
    // Evento de dos días: retiro → entrega a escuela
    const fechaEscuela = parsearFecha(data.fecha_escuela);
    // createAllDayEvent con fecha fin (exclusiva, +1 día)
    fechaEscuela.setDate(fechaEscuela.getDate() + 1);
    cal.createAllDayEvent(titulo, fechaRetiro, fechaEscuela, { description: descripcion });
  } else {
    cal.createAllDayEvent(titulo, fechaRetiro, { description: descripcion });
  }

  Logger.log('Evento creado: ' + titulo + ' | ' + data.fecha_retiro);
}

function parsearFecha(fechaStr) {
  // fechaStr viene como "YYYY-MM-DD" del input type="date"
  const partes = fechaStr.split('-');
  return new Date(
    parseInt(partes[0]),
    parseInt(partes[1]) - 1,
    parseInt(partes[2])
  );
}

function formatearFecha(fechaStr) {
  const partes = fechaStr.split('-');
  return partes[2] + '/' + partes[1] + '/' + partes[0];
}

// ── GESTIÓN DE PEDIDOS EN SHEET ─────────────────────────────
// Columnas: N° Orden(0) · Fecha(1) · Marca/Proveedor(2) · FGP(3) · Producto(s)(4) ·
//           Estado(5) · Fecha Estado(6) · Quien lo busca(7) · Comprobante Pago(8) · Notas(9)
// Los precios y cantidades van embebidos en el campo Productos:
//   "Shampoo x3 Unid. ($1500)\nJabón x2 kg ($800)"

// ── TIENDANUBE ───────────────────────────────────────────────
const TN_STORE_ID   = '7396246';
const TN_API_TOKEN  = 'e3d744d94ddbf13317bef0082c53e2c46fb50631';

function obtenerMarcasTN() {
  const resp = UrlFetchApp.fetch(
    'https://api.tiendanube.com/v1/' + TN_STORE_ID + '/products?per_page=200&fields=id,name,brand', {
    headers: {
      'Authentication': 'bearer ' + TN_API_TOKEN,
      'User-Agent': 'DienteDeLeon (dientedeleon-admin@googlegroups.com)'
    }
  });
  const data   = JSON.parse(resp.getContentText());
  const brands = {};
  data.forEach(function(p) {
    const brand = p.brand ? String(p.brand).trim() : '';
    if (brand) brands[brand.toUpperCase()] = brand;
  });
  return brands;
}

function obtenerProductosTN() {
  const resp = UrlFetchApp.fetch(
    'https://api.tiendanube.com/v1/' + TN_STORE_ID + '/products?per_page=200&fields=id,name,variants', {
    headers: {
      'Authentication': 'bearer ' + TN_API_TOKEN,
      'User-Agent': 'DienteDeLeon (dientedeleon-admin@googlegroups.com)'
    }
  });
  const data  = JSON.parse(resp.getContentText());
  const skus  = {};
  const lista = [];
  data.forEach(function(p) {
    const nombre = p.name && p.name.es ? p.name.es : String(p.name || '');
    (p.variants || []).forEach(function(v) {
      const sku = v.sku ? String(v.sku).trim() : '';
      if (sku && !skus[nombre.toUpperCase()]) {
        skus[nombre.toUpperCase()] = sku;
        lista.push({ nombre: nombre, sku: sku });
      }
    });
  });
  return lista;
}

const COL = {
  NORDEN:      0,   // A
  FECHA:       1,   // B
  PROVEEDOR:   2,   // C
  FGP:         3,   // D
  PRODUCTOS:   4,   // E
  ESTADO:      5,   // F
  FECHA_EST:   6,   // G
  QUIEN:       7,   // H
  TOTAL:       8,   // I
  NOTAS:       9,   // J
  ESTADO_PAGO:   10,  // K
  FECHA_PAGO:    11,  // L
  COMPROBANTE:   12,  // M
  FECHA_RETIRO:  13,  // N
  LUGAR_RETIRO:  14,  // O
  FECHA_ESCUELA: 15   // P
};

function getPedidosSheet() {
  const ss = SpreadsheetApp.openById(CONFIG_RETIRO.PEDIDOS_SHEET_ID);
  const sheets = ss.getSheets();
  // Buscar por GID
  for (let i = 0; i < sheets.length; i++) {
    if (String(sheets[i].getSheetId()) === CONFIG_RETIRO.PEDIDOS_GID) return sheets[i];
  }
  return ss.getSheets()[0]; // fallback
}

function fmtCelFecha(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, 'America/Argentina/Cordoba', 'dd/MM/yyyy');
  // Si es string ISO (yyyy-mm-dd), convertir a dd/MM/yyyy
  var iso = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[3] + '/' + iso[2] + '/' + iso[1];
  return String(val);
}

function filaAObjeto(fila) {
  return {
    norden:      fila[COL.NORDEN],
    fecha:       fmtCelFecha(fila[COL.FECHA]),
    proveedor:   fila[COL.PROVEEDOR],
    fgp:         fila[COL.FGP],
    productos:   fila[COL.PRODUCTOS],
    estado:      fila[COL.ESTADO],
    fechaEstado: fmtCelFecha(fila[COL.FECHA_EST]),
    quien:       fila[COL.QUIEN],
    comprobante: fila[COL.COMPROBANTE],
    notas:       fila[COL.NOTAS],
    total:       fila[COL.TOTAL] || '',
    estadoPago:   fila[COL.ESTADO_PAGO]  || '',
    fechaPago:    fmtCelFecha(fila[COL.FECHA_PAGO]),
    fechaRetiro:  fmtCelFecha(fila[COL.FECHA_RETIRO]),
    lugarRetiro:  fila[COL.LUGAR_RETIRO] || '',
    fechaEscuela: fmtCelFecha(fila[COL.FECHA_ESCUELA])
  };
}

function leerPedidos() {
  const sheet = getPedidosSheet();
  const data  = sheet.getDataRange().getValues();
  const rows  = data.slice(1); // quitar cabecera
  return rows
    .filter(r => r[COL.NORDEN])
    .map(filaAObjeto);
}

function leerPedidoPorId(norden) {
  const sheet = getPedidosSheet();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL.NORDEN]) === String(norden)) {
      return { fila: i + 1, pedido: filaAObjeto(data[i]) };
    }
  }
  return null;
}

// data: { action:'updateEstado', norden, estado, quien (opcional), notas (opcional) }
function updateEstadoPedido(data) {
  const { norden, estado, quien, notas } = data;
  if (!norden || !estado) throw new Error('Faltan campos: norden y estado son requeridos');

  const ESTADOS_VALIDOS = ['Solicitado','Confirmado','En Camino','En Proceso','Entregado en Escuela','Recibido','Cerrado','Cancelado'];
  if (!ESTADOS_VALIDOS.includes(estado)) throw new Error('Estado inválido: ' + estado);

  const resultado = leerPedidoPorId(norden);
  if (!resultado) throw new Error('Pedido no encontrado: ' + norden);

  const sheet = getPedidosSheet();
  const fila  = resultado.fila;
  const hoy   = Utilities.formatDate(new Date(), 'America/Argentina/Cordoba', 'dd/MM/yyyy');

  // Actualizar validación de la columna con todos los estados actuales
  const estadosValidos = ['Solicitado','Confirmado','En Camino','Entregado en Escuela','Cerrado','Cancelado'];
  const regla = SpreadsheetApp.newDataValidation()
    .requireValueInList(estadosValidos)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(fila, COL.ESTADO + 1).setDataValidation(regla).setValue(estado);
  sheet.getRange(fila, COL.FECHA_EST + 1).setValue(hoy);
  if (quien) sheet.getRange(fila, COL.QUIEN + 1).setValue(quien);
  if (notas) sheet.getRange(fila, COL.NOTAS + 1).setValue(notas);

  Logger.log('Estado actualizado: ' + norden + ' → ' + estado);
  return norden + ' actualizado a ' + estado;
}

// data: { action:'registrarPedido', norden, fecha, proveedor, fgp, tel, productos, total, notas }
function registrarPedidoEnSheet(data) {
  const { norden, fecha, proveedor, fgp, productos, notas } = data;
  if (!norden) throw new Error('Falta norden');

  // Evitar duplicados
  const existente = leerPedidoPorId(norden);
  if (existente) {
    Logger.log('Pedido ya existía: ' + norden);
    // Aprovechar para actualizar el tel si llegó uno nuevo
    if (data.tel && proveedor) guardarTelProveedor(proveedor, data.tel);
    return 'Pedido ya registrado: ' + norden;
  }

  const sheet = getPedidosSheet();
  const hoy   = Utilities.formatDate(new Date(), 'America/Argentina/Cordoba', 'dd/MM/yyyy');

  const fila = new Array(13).fill('');
  fila[COL.NORDEN]    = norden;
  fila[COL.FECHA]     = fecha || hoy;
  fila[COL.PROVEEDOR] = proveedor || '';
  fila[COL.FGP]       = fgp || '';
  fila[COL.PRODUCTOS] = productos || '';
  fila[COL.ESTADO]    = 'Solicitado';
  fila[COL.FECHA_EST] = hoy;
  fila[COL.TOTAL]     = data.total ? parseFloat(data.total) : '';
  fila[COL.NOTAS]     = notas || '';
  fila[COL.ESTADO_PAGO] = 'No pagado';

  sheet.appendRow(fila);

  // Guardar tel del proveedor para reutilizar en futuras alertas
  if (data.tel && proveedor) guardarTelProveedor(proveedor, data.tel);

  Logger.log('Pedido registrado: ' + norden);
  return 'Pedido registrado: ' + norden;
}

// Upsert tel en tab "Proveedores" (crea la tab si no existe)
function guardarTelProveedor(proveedor, tel) {
  const ss    = SpreadsheetApp.openById(CONFIG_RETIRO.PEDIDOS_SHEET_ID);
  let   sheet = ss.getSheetByName('Proveedores');
  if (!sheet) {
    sheet = ss.insertSheet('Proveedores');
    sheet.getRange('A1:B1').setValues([['Proveedor', 'Telefono']]);
    sheet.getRange('A1:B1').setFontWeight('bold').setBackground('#e8f5e9').setFontColor('#3a7d44');
  }
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toUpperCase() === proveedor.toUpperCase()) {
      sheet.getRange(i + 1, 2).setValue(tel);
      Logger.log('Tel actualizado: ' + proveedor + ' → ' + tel);
      return;
    }
  }
  sheet.appendRow([proveedor, tel]);
  Logger.log('Tel nuevo guardado: ' + proveedor + ' → ' + tel);
}

// data: { action:'updateTotal', norden, total }
function updateTotalPedido(data) {
  const { norden, total } = data;
  if (!norden) throw new Error('Falta norden');
  const resultado = leerPedidoPorId(norden);
  if (!resultado) throw new Error('Pedido no encontrado: ' + norden);
  const sheet = getPedidosSheet();
  sheet.getRange(resultado.fila, COL.TOTAL + 1).setValue(parseFloat(total) || 0);
  Logger.log('Total actualizado: ' + norden + ' → ' + total);
  return 'Total actualizado: ' + norden;
}

// data: { action:'updateProductos', norden, productos, total (opcional) }
function updateProductosPedido(data) {
  const { norden, productos } = data;
  if (!norden) throw new Error('Falta norden');
  const resultado = leerPedidoPorId(norden);
  if (!resultado) throw new Error('Pedido no encontrado: ' + norden);
  const sheet = getPedidosSheet();
  sheet.getRange(resultado.fila, COL.PRODUCTOS + 1).setValue(productos || '');
  if (data.total !== null && data.total !== undefined) sheet.getRange(resultado.fila, COL.TOTAL + 1).setValue(parseFloat(data.total) || 0);
  SpreadsheetApp.flush();
  Logger.log('Productos actualizados: ' + norden);
  return 'Productos actualizados: ' + norden;
}

// data: { action:'updateProveedor', norden, proveedor, tel }
function updateProveedorPedido(data) {
  const { norden, proveedor, tel } = data;
  if (!norden) throw new Error('Falta norden');
  if (!proveedor) throw new Error('El nombre del proveedor es obligatorio');
  const resultado = leerPedidoPorId(norden);
  if (!resultado) throw new Error('Pedido no encontrado: ' + norden);
  const sheet = getPedidosSheet();
  sheet.getRange(resultado.fila, COL.PROVEEDOR + 1).setValue(proveedor);
  Logger.log('Proveedor actualizado: ' + norden + ' → ' + proveedor);
  // Guardar tel en tab Proveedores para reusar en futuras alertas
  if (tel) guardarTelProveedor(proveedor, tel);
  return 'Proveedor actualizado: ' + norden;
}

// Actualiza datos de retiro en Sheet y sincroniza con Google Calendar
function actualizarRetiroEnSheet(params) {
  const norden       = params.norden       || '';
  const quien        = params.quien        || '';
  const fechaRetiro  = params.fecha_retiro || '';
  const lugar        = params.lugar        || '';
  const fechaEscuela = params.fecha_escuela|| '';
  const proveedor    = params.proveedor    || '';
  const producto     = params.producto     || '';
  const fgp          = params.fgp          || '';

  if (!norden) throw new Error('Falta norden');

  const resultado = leerPedidoPorId(norden);
  if (!resultado) throw new Error('Pedido no encontrado: ' + norden);

  const sheet = getPedidosSheet();
  const fila  = resultado.fila;
  if (quien)        sheet.getRange(fila, COL.QUIEN + 1).setValue(quien);
  if (fechaRetiro)  sheet.getRange(fila, COL.FECHA_RETIRO + 1).setValue(fechaRetiro);
  if (lugar)        sheet.getRange(fila, COL.LUGAR_RETIRO + 1).setValue(lugar);
  if (fechaEscuela) sheet.getRange(fila, COL.FECHA_ESCUELA + 1).setValue(fechaEscuela);

  // Actualizar Google Calendar: eliminar evento anterior y crear nuevo
  if (fechaRetiro) {
    try {
      const cal = CalendarApp.getCalendarById(CONFIG_RETIRO.CALENDAR_ID);
      // Buscar y eliminar evento anterior del mismo norden
      const buscarDesde = new Date(fechaRetiro + 'T00:00:00');
      buscarDesde.setDate(buscarDesde.getDate() - 30);
      const buscarHasta = new Date(fechaRetiro + 'T23:59:59');
      buscarHasta.setDate(buscarHasta.getDate() + 60);
      cal.getEvents(buscarDesde, buscarHasta).forEach(function(ev) {
        if (ev.getDescription().indexOf(norden) !== -1) ev.deleteEvent();
      });
      // Crear nuevo evento
      const data = {
        proveedor: proveedor, producto: producto, retira: quien,
        lugar: lugar, fecha_retiro: fechaRetiro, fecha_escuela: fechaEscuela,
        norden: norden, fgp: fgp
      };
      crearEventoCalendario(data);
      Logger.log('Calendario actualizado para: ' + norden);
    } catch(e) {
      Logger.log('Error actualizando calendario: ' + e.message);
    }
  }
  return 'Retiro actualizado: ' + norden;
}

// data: { action:'eliminarPedido', norden }
// Solo elimina si el estado es 'Solicitado'
function eliminarPedidoDeSheet(data) {
  const { norden } = data;
  if (!norden) throw new Error('Falta norden');

  const resultado = leerPedidoPorId(norden);
  if (!resultado) throw new Error('Pedido no encontrado: ' + norden);

  // Estado vacío se trata como 'Solicitado' (igual que el frontend)
  const estadoActual = String(resultado.pedido.estado || 'Solicitado').trim();
  Logger.log('Eliminar pedido ' + norden + ' | estado: "' + estadoActual + '" | fila: ' + resultado.fila);

  if (estadoActual.toLowerCase() !== 'solicitado') {
    throw new Error('Solo se pueden eliminar pedidos en estado Solicitado (estado actual: "' + estadoActual + '")');
  }

  const sheet = getPedidosSheet();
  sheet.deleteRow(resultado.fila);
  Logger.log('Pedido eliminado: ' + norden);
  return 'Pedido eliminado: ' + norden;
}

// data: { action:'subirComprobante', norden, filename, mimeType, base64 }
// Sube el archivo a Google Drive (carpeta "Comprobantes DdL"), guarda el link en Sheet
// y pasa el estado a Pagado.
function subirComprobanteEnDrive(data) {
  const { norden, filename, mimeType, base64 } = data;
  if (!norden || !base64) throw new Error('Faltan datos: norden y base64 son requeridos');

  // Buscar o crear carpeta en Drive
  const CARPETA = 'Comprobantes DdL';
  let folder;
  const iter = DriveApp.getFoldersByName(CARPETA);
  folder = iter.hasNext() ? iter.next() : DriveApp.createFolder(CARPETA);

  // Crear archivo
  const bytes = Utilities.base64Decode(base64);
  const blob  = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', norden + '_' + filename);
  const file  = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const url = file.getUrl();

  // Actualizar Sheet: link + estado Pagado
  const encontrado = leerPedidoPorId(norden);
  if (!encontrado) throw new Error('Pedido no encontrado: ' + norden);
  const sheet = getPedidosSheet();
  const fila  = encontrado.fila;
  const hoy   = Utilities.formatDate(new Date(), 'America/Argentina/Cordoba', 'dd/MM/yyyy');

  sheet.getRange(fila, COL.COMPROBANTE + 1).setValue(url);
  sheet.getRange(fila, COL.ESTADO_PAGO + 1).setValue('Pagado');
  sheet.getRange(fila, COL.FECHA_PAGO + 1).setValue(hoy);

  Logger.log('Comprobante subido: ' + norden + ' → ' + url);
  return { url: url };
}

// ── MIGRACIÓN / MANTENIMIENTO ────────────────────────────────

/**
 * Ejecutar UNA VEZ desde el editor GAS para ver el estado actual de la Sheet.
 * Ver Registros (Ctrl+Enter) para leer el resultado.
 */
// ── MIGRACIÓN DE COLUMNAS ────────────────────────────────────
// Ejecutar UNA VEZ para reorganizar el Sheet al nuevo formato de 13 columnas.
// SEGURO: crea una copia de respaldo antes de modificar nada.
function migrarColumnasSheet() {
  const ss    = SpreadsheetApp.openById(CONFIG_RETIRO.PEDIDOS_SHEET_ID);
  // 1. Buscar la hoja Pedidos por nombre (más confiable que por GID)
  const sheet = ss.getSheetByName('Pedidos');
  if (!sheet) { Logger.log('ERROR: no se encontró la hoja "Pedidos"'); return; }

  const data = sheet.getDataRange().getValues();
  Logger.log('Filas encontradas: ' + data.length);

  // 2. Crear copia de respaldo
  const backup = ss.getSheetByName('Pedidos_backup') || ss.insertSheet('Pedidos_backup');
  backup.clearContents();
  backup.getRange(1, 1, data.length, data[0].length).setValues(data);
  Logger.log('Backup creado en "Pedidos_backup" con ' + data.length + ' filas');

  // 3. Construir nuevos datos
  // Viejo: 0=Orden,1=Fecha,2=Prov,3=FGP,4=Prods,5=Estado,6=FechaEst,7=Quien,8=Comprobante,9=Notas,10=Total
  // Nuevo: 0=Orden,1=Fecha,2=Prov,3=FGP,4=Prods,5=Estado,6=FechaEst,7=Quien,8=Total,9=Notas,10=EstPago,11=FechaPago,12=Comprobante
  const header = ['N° Orden','Fecha','Proveedor','FGP','Productos','Estado','Fecha Estado','Quien retira','Total','Notas','Estado Pago','Fecha de Pago','Comprobante'];
  const newData = [header];
  let migradas = 0;

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0] && !r[1] && !r[2]) continue; // fila completamente vacía
    const estadoPago = r[8] ? 'Pagado' : 'No pagado'; // si tenía comprobante → Pagado
    const fechaPago  = r[8] ? (r[6] || '') : '';       // usar fecha estado como referencia
    newData.push([
      r[0]  || '', // N° Orden
      r[1]  || '', // Fecha
      r[2]  || '', // Proveedor
      r[3]  || '', // FGP
      r[4]  || '', // Productos
      r[5]  || '', // Estado
      r[6]  || '', // Fecha Estado
      r[7]  || '', // Quien
      r[10] || '', // Total (viejo 10 → nuevo 8)
      r[9]  || '', // Notas (viejo 9 → nuevo 9)
      estadoPago,  // Estado Pago (nuevo K)
      fechaPago,   // Fecha Pago (nuevo L)
      r[8]  || ''  // Comprobante (viejo 8 → nuevo M)
    ]);
    migradas++;
  }

  // 4. Reescribir la hoja (SIN clearContents — sobreescribimos desde A1)
  sheet.getRange(1, 1, newData.length, 13).setValues(newData);
  // Borrar columnas extra si había más de 13
  if (sheet.getLastColumn() > 13) {
    sheet.deleteColumns(14, sheet.getLastColumn() - 13);
  }

  // 5. Actualizar validaciones
  const reglaEstado = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Solicitado','Confirmado','En Camino','Entregado en Escuela','Cerrado','Cancelado'])
    .setAllowInvalid(false).build();
  sheet.getRange('F2:F1000').setDataValidation(reglaEstado);

  const reglaEstadoPago = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Pagado','No pagado'])
    .setAllowInvalid(false).build();
  sheet.getRange('K2:K1000').setDataValidation(reglaEstadoPago);

  Logger.log('✅ Migración completada. ' + migradas + ' pedidos migrados. Backup en "Pedidos_backup".');
}

// Ejecutar UNA VEZ para actualizar la validación de estados en todo el Sheet
function actualizarValidacionEstados() {
  const sheet = getPedidosSheet();
  const estadosValidos = ['Solicitado','Confirmado','En Camino','Entregado en Escuela','Cerrado','Cancelado'];
  const regla = SpreadsheetApp.newDataValidation()
    .requireValueInList(estadosValidos)
    .setAllowInvalid(false)
    .build();
  sheet.getRange('F2:F1000').setDataValidation(regla);
  Logger.log('Validación actualizada con: ' + estadosValidos.join(', '));
}

function diagnosticarSheet() {
  const sheet = getPedidosSheet();
  const data  = sheet.getDataRange().getValues();

  Logger.log('Total filas (incl. cabecera): ' + data.length);
  Logger.log('Total columnas: ' + (data[0] ? data[0].length : 0));
  Logger.log('CABECERA: ' + JSON.stringify(data[0]));
  if (data[1]) Logger.log('FILA 2: ' + JSON.stringify(data[1]));
  if (data[2]) Logger.log('FILA 3: ' + JSON.stringify(data[2]));
}

/**
 * Ejecutar UNA VEZ si la Sheet tiene columnas extra (CANTIDAD, UNIDAD, PRECIO, TOTAL
 * entre Productos y Estado). Elimina esas columnas y deja la estructura de 10 cols.
 *
 * ESTRUCTURA OBJETIVO:
 *   A: N°Orden · B: Fecha · C: Proveedor · D: FGP · E: Productos
 *   F: Estado · G: Fecha Estado · H: Quien · I: Comprobante · J: Notas
 *
 * Antes de ejecutar: corré diagnosticarSheet() y confirmá que la columna F
 * dice "Estado" o contiene estados como "Solicitado". Si dice "Cantidad" o
 * un número, entonces sí necesitás correr normalizarColumnas().
 */
function normalizarColumnas() {
  const sheet   = getPedidosSheet();
  const data    = sheet.getDataRange().getValues();
  const numCols = data[0] ? data[0].length : 0;

  if (numCols <= 10) {
    Logger.log('La Sheet ya tiene ' + numCols + ' columnas — no necesita normalización.');
    return;
  }

  // Detectar índice de "Estado" buscando en la fila 2 un valor que sea un estado válido
  const ESTADOS = ['Solicitado','Confirmado','En Proceso','Entregado en Escuela','Recibido','Cerrado','Cancelado'];
  let estadoCol = -1;
  if (data[1]) {
    for (let c = 4; c < numCols; c++) {
      if (ESTADOS.includes(String(data[1][c]).trim())) { estadoCol = c; break; }
    }
  }

  if (estadoCol === -1) {
    Logger.log('No se encontró columna Estado en las filas de datos. Revisá manualmente con diagnosticarSheet().');
    return;
  }

  // Columnas extras entre Productos (col 4) y Estado (estadoCol)
  const extrasCount = estadoCol - 5; // cuántas columnas sobran (0 = ninguna)
  if (extrasCount <= 0) {
    Logger.log('No hay columnas extras. La estructura parece correcta (Estado en col ' + (estadoCol+1) + ').');
    return;
  }

  Logger.log('Hay ' + extrasCount + ' columna(s) extra entre Productos y Estado. Eliminando...');

  // Eliminar columnas en orden inverso para no desplazar índices
  for (let i = 0; i < extrasCount; i++) {
    sheet.deleteColumn(6); // col F (índice 6 en base-1), repetir según extras
  }

  Logger.log('Listo. Columnas después de migración: ' + sheet.getDataRange().getNumColumns());
}

// ── TESTING ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
// ESTADO INVENTARIO — Dashboard de stock (autocontenido)
// Usa TN_STORE_ID / TN_API_TOKEN ya declarados en este archivo.
// ══════════════════════════════════════════════════════════════

const INV_SHEET_ID      = CONFIG_RETIRO.PEDIDOS_SHEET_ID;
const INV_VENTAS_ID     = '1-57n6RmTFQjwNFVYxNPzll8MMuV4NvXXx5v0wTvR_6g';
const INV_SAFETY        = 1.5;
const INV_DIAS_VENTANA  = 60;
const INV_PISO_DEFAULT  = 10;
const INV_UMBRAL_FB     = 10;
const INV_MESES_EXC     = [0, 1, 2, 6]; // Ene, Feb, Mar, Jul

const INV_FGP = {
  'LA YAYA':                  { nombre: 'Yuliana Longhi',   email: 'longhi.yuliana@gmail.com'  },
  'ODDIS':                    { nombre: 'Luli del Castillo', email: 'lourdelcastillo@gmail.com' },
  'CABALLO NEGRO':            { nombre: 'Maria Martini',     email: 'martinimaria39@gmail.com'  },
  'YEMARI':                   { nombre: 'Maria Martini',     email: 'martinimaria39@gmail.com'  },
  'GROEN':                    { nombre: 'Maria Martini',     email: 'martinimaria39@gmail.com'  },
  'EL MAITEN':                { nombre: 'Maria Martini',     email: 'martinimaria39@gmail.com'  },
  'GUARDIANES DE LA COLMENA': { nombre: 'Maria Martini',     email: 'martinimaria39@gmail.com'  }
};

const INV_PISO_MARCA = {
  'GROEN': 5
};

function invGetVelocidades() {
  const props  = PropertiesService.getScriptProperties();
  const cached = props.getProperty('VELOCIDADES_CACHE');
  const dias   = parseInt(props.getProperty('DIAS_ACTIVOS_CACHE')) || INV_DIAS_VENTANA;
  if (cached) return { velocidades: JSON.parse(cached), diasActivos: dias };

  // Sin cache: calcular on-the-fly
  const velocidades = {};
  var diasActivos = 0;
  try {
    const ss    = SpreadsheetApp.openById(INV_VENTAS_ID);
    const sheet = ss.getSheetByName('Ventas');
    if (sheet) {
      const data   = sheet.getDataRange().getValues();
      const hoy    = new Date();
      const hace60 = new Date(hoy.getTime() - INV_DIAS_VENTANA * 864e5);
      for (var d = new Date(hace60.getTime()); d <= hoy; d.setDate(d.getDate() + 1)) {
        if (INV_MESES_EXC.indexOf(d.getMonth()) === -1) diasActivos++;
      }
      for (var i = 1; i < data.length; i++) {
        const fecha = data[i][0] ? new Date(data[i][0]) : null;
        if (!fecha || fecha < hace60 || fecha > hoy) continue;
        if (INV_MESES_EXC.indexOf(fecha.getMonth()) !== -1) continue;
        const nombre   = String(data[i][5] || '').trim();
        const cantidad = parseInt(data[i][7]) || 0;
        if (!nombre || cantidad <= 0) continue;
        velocidades[nombre] = (velocidades[nombre] || 0) + cantidad;
      }
    }
  } catch(e) { Logger.log('invGetVelocidades error: ' + e); }
  return { velocidades: velocidades, diasActivos: diasActivos || INV_DIAS_VENTANA };
}

function invBuscarVel(nombreProd, nombreVar, velocidades) {
  if (velocidades[nombreProd] !== undefined) return velocidades[nombreProd];
  if (nombreVar) {
    const conVar = nombreProd + ' (' + nombreVar + ')';
    if (velocidades[conVar] !== undefined) return velocidades[conVar];
  }
  const lp = nombreProd.toLowerCase();
  const lv = nombreVar ? (nombreProd + ' (' + nombreVar + ')').toLowerCase() : null;
  var found;
  Object.keys(velocidades).forEach(function(k) {
    const kl = k.toLowerCase();
    if (kl === lp || (lv && kl === lv)) found = velocidades[k];
  });
  return found !== undefined ? found : 0;
}

function invCalcUmbral(nombreProd, leadTime, velocidades, diasActivos, nombreVar) {
  const total = invBuscarVel(nombreProd, nombreVar, velocidades);
  if (!total) return INV_UMBRAL_FB;
  return Math.ceil((total / diasActivos) * leadTime * INV_SAFETY);
}

function invLeerConfig() {
  const defaults = {};
  Object.keys(INV_FGP).forEach(function(m) {
    defaults[m] = { leadTime: 14, stockMinimo: INV_PISO_MARCA[m] || INV_PISO_DEFAULT };
  });
  try {
    const ss    = SpreadsheetApp.openById(INV_SHEET_ID);
    const sheet = ss.getSheetByName('ConfigAlertas');
    if (!sheet) return defaults;
    const data  = sheet.getDataRange().getValues();
    const cfg   = {};
    for (var i = 1; i < data.length; i++) {
      const marca = String(data[i][0] || '').toUpperCase().trim();
      if (!marca) continue;
      cfg[marca] = {
        leadTime:    parseInt(data[i][1]) || 14,
        stockMinimo: data[i][2] !== '' && data[i][2] !== undefined ? (parseInt(data[i][2]) || INV_PISO_DEFAULT) : (INV_PISO_MARCA[marca] || INV_PISO_DEFAULT)
      };
    }
    return Object.keys(cfg).length ? cfg : defaults;
  } catch(e) { return defaults; }
}

function invLeerOverrides() {
  const map = {};
  try {
    const ss    = SpreadsheetApp.openById(INV_SHEET_ID);
    const sheet = ss.getSheetByName('ConfigStock');
    if (!sheet) return map;
    const data  = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      const clave = String(data[i][0] || '').trim();
      if (!clave) continue;
      map[clave] = {
        umbralOverride: data[i][2] !== '' && data[i][2] !== null ? parseInt(data[i][2]) : null,
        pisoOverride:   data[i][3] !== '' && data[i][3] !== null ? parseInt(data[i][3]) : null
      };
    }
  } catch(e) { Logger.log('invLeerOverrides error: ' + e); }
  return map;
}

function guardarOverrideStock(clave, nombre, umbralOverride, pisoOverride) {
  const ss  = SpreadsheetApp.openById(INV_SHEET_ID);
  var sheet = ss.getSheetByName('ConfigStock');
  if (!sheet) {
    sheet = ss.insertSheet('ConfigStock');
    sheet.appendRow(['Clave', 'Nombre', 'Umbral Override', 'Piso Override']);
  }
  const data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === clave) {
      sheet.getRange(i + 1, 3).setValue(umbralOverride !== null && umbralOverride !== '' ? umbralOverride : '');
      sheet.getRange(i + 1, 4).setValue(pisoOverride   !== null && pisoOverride   !== '' ? pisoOverride   : '');
      return;
    }
  }
  sheet.appendRow([clave, nombre,
    umbralOverride !== null && umbralOverride !== '' ? umbralOverride : '',
    pisoOverride   !== null && pisoOverride   !== '' ? pisoOverride   : ''
  ]);
}

function getStockDashboard() {
  const { velocidades, diasActivos } = invGetVelocidades();
  const configMarca = invLeerConfig();
  const overrides   = invLeerOverrides();
  const alertas     = JSON.parse(PropertiesService.getScriptProperties().getProperty('ALERTAS_ENVIADAS') || '{}');

  // Pedidos activos por marca
  const pedidosActivos = {};
  try {
    const ACTIVOS = ['Solicitado', 'Confirmado', 'En Camino'];
    const data    = getPedidosSheet().getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      const norden = String(data[i][0] || '').trim();
      const marca  = String(data[i][2] || '').toUpperCase().trim();
      const estado = String(data[i][5] || '').trim();
      if (!norden || !marca || ACTIVOS.indexOf(estado) === -1) continue;
      if (!pedidosActivos[marca]) pedidosActivos[marca] = [];
      pedidosActivos[marca].push({ norden: norden, estado: estado, fecha: String(data[i][1] || '') });
    }
  } catch(e) { Logger.log('getStockDashboard pedidos error: ' + e); }

  // Productos TiendaNube
  const productos = obtenerProductosTN();
  const resultado = [];

  productos.forEach(function(producto) {
    const marca     = (producto.brand || '').toUpperCase();
    const fgp       = INV_FGP[marca];
    if (!fgp) return;
    const cfg        = configMarca[marca] || { leadTime: 14, stockMinimo: INV_PISO_DEFAULT };
    const nombreProd = producto.name && producto.name.es ? producto.name.es : String(producto.name || '');

    const variantes = [];
    (producto.variants || []).forEach(function(variante) {
      if (variante.stock === null) return;
      const stock     = parseInt(variante.stock);
      const clave     = producto.id + '_' + variante.id;
      const nombreVar = variante.values && variante.values.length
        ? variante.values.map(function(v) { return v.es || v; }).join(' / ')
        : null;

      const ov           = overrides[clave] || {};
      const umbralCalc   = invCalcUmbral(nombreProd, cfg.leadTime, velocidades, diasActivos, nombreVar);
      const umbralFinal  = (ov.umbralOverride !== null && ov.umbralOverride !== undefined) ? ov.umbralOverride : umbralCalc;
      const pisoMarca    = cfg.stockMinimo;
      const pisoFinal    = (ov.pisoOverride !== null && ov.pisoOverride !== undefined) ? ov.pisoOverride : pisoMarca;
      const velocidad    = invBuscarVel(nombreProd, nombreVar, velocidades);
      const alertaEnviada = !!alertas[clave];

      var semaforo;
      if (stock < pisoFinal || stock <= umbralFinal) semaforo = 'rojo';
      else if (stock <= umbralFinal * 2)              semaforo = 'amarillo';
      else                                            semaforo = 'verde';

      variantes.push({
        id: variante.id, clave: clave,
        nombre: nombreVar || nombreProd,
        stock: stock, velocidad: velocidad, diasActivos: diasActivos,
        umbralCalc: umbralCalc, umbralOverride: ov.umbralOverride !== undefined ? ov.umbralOverride : null,
        pisoMarca: pisoMarca,  pisoOverride:   ov.pisoOverride   !== undefined ? ov.pisoOverride   : null,
        umbralFinal: umbralFinal, pisoFinal: pisoFinal,
        alertaEnviada: alertaEnviada, semaforo: semaforo
      });
    });

    if (!variantes.length) return;
    resultado.push({
      id: producto.id, nombre: nombreProd, marca: marca,
      fgp: fgp.nombre,
      pedidos:   pedidosActivos[marca] || [],
      variantes: variantes
    });
  });

  return { ok: true, productos: resultado, diasActivos: diasActivos };
}

// ── TEST ───────────────────────────────────────────────────
function testAgendarRetiro() {
  const dataPrueba = {
    proveedor:     'La Yaya',
    producto:      'Crema hidratante facial x 50ml',
    retira:        'Ines Robertson',
    lugar:         'Av. Colón 1234, Córdoba',
    fecha_retiro:  '2026-04-10',
    fecha_escuela: '2026-04-11',
    norden:        'ORD-20260410-042',
    notas:         'Llamar antes de ir',
    fgp:           'Maria Martini'
  };
  const resultado = agendarRetiro(dataPrueba);
  Logger.log('Resultado: ' + resultado);
}
