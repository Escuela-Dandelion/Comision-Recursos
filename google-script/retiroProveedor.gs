// v2026-11-11 — getVentasSinStock: estadoPedido devuelve estado real (Solicitado, En Camino…)
// ============================================================
// DIENTE DE LEÓN — Agendamiento de Retiro de Mercadería
// ============================================================
// Script Properties requeridas (Proyecto 2 — retiroProveedor):
//   TN_API_TOKEN     → token de TiendaNube
//   PEDIDOS_SHEET_ID → ID del Google Sheet de Pedidos/ConfigStock
//   CALENDAR_ID      → ID del Google Calendar de retiros
// ============================================================

const _PR = PropertiesService.getScriptProperties();
const CONFIG_RETIRO = {
  CALENDAR_ID:      _PR.getProperty('CALENDAR_ID'),
  PEDIDOS_SHEET_ID: _PR.getProperty('PEDIDOS_SHEET_ID'),
  PEDIDOS_GID:      '857535467'
};

// Copia del mapping de retiro_qr.gs — cubre nombres viejos y nuevos post-migración
const MARCA_A_PROVEEDOR_RP = {
  'TIENDA LIMÓN': 'Tienda Limón', 'TIENDA LIMON': 'Tienda Limón',
  'EL MAITEN': 'El Maiten',       'PAJARITO AMARILLO': 'Pajarito Amarillo',
  'SOL DE PAPEL': 'Sol de Oro',   'GUARDIANES COLMENA': 'Guardianes de la Colmena',
  'MIX Y FRUTOS SECOS': 'BioSalud', 'TALLER': 'Carlos Villegas',
  'YEMARI': 'Yemari',             'CABALLO NEGRO': 'Caballo Negro',
  'LA YAYA': 'La Yaya',           'GUARDIANES DE LA COLMENA': 'Guardianes de la Colmena',
  'GROEN': 'Groen',               'ODDIS': 'Oddis',
  'PARAISA': 'Paraisa',           'NAZARENO': 'Nazareno',
  'GRANOLA': 'El Maiten',         'PIZZA': 'Pajarito Amarillo',
  'EL ARISTEO': 'Tienda Limón',   'ARISTEO': 'Tienda Limón',
  'BENDITA LLUVIA': 'Tienda Limón', 'CALANDRI': 'Tienda Limón',
};

function marcaToProveedorRP(marca) {
  return MARCA_A_PROVEEDOR_RP[(marca || '').trim().toUpperCase()] || null;
}

// Normaliza nombre de proveedor para comparaciones: lowercase + sin tildes
// Permite matchear "TIENDA LIMON" con "Tienda Limón"
function normProv(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

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
    } else if (action === 'updateCostoEnvio') {
      resultado = updateCostoEnvioPedido(data);
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
      const excluir         = e.parameter.excluir || 'Cerrado';
      const incluirCerrados = e.parameter.incluirCerrados === '1';
      const email           = (e.parameter.email || '').toLowerCase().trim();
      let pedidos = leerPedidos();
      if (!incluirCerrados && excluir) {
        const excluidos = excluir.split(',').map(function(s){ return s.trim(); });
        pedidos = pedidos.filter(function(p){ return excluidos.indexOf(p.estado) === -1; });
      }
      const proveedoresFGP = getMarcasFGP(email);
      if (Array.isArray(proveedoresFGP)) {
        const provsLower = proveedoresFGP.map(function(p){ return p.toLowerCase(); });
        pedidos = pedidos.filter(function(p) {
          const prov = (p.proveedor || '').toLowerCase();
          if (provsLower.indexOf(prov) !== -1) return true;
          // Normalizar datos legacy donde se guardó brand name en vez de proveedor
          const provNorm = (marcaToProveedorRP(p.proveedor) || '').toLowerCase();
          return provNorm && provsLower.indexOf(provNorm) !== -1;
        });
      }
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, pedidos: pedidos }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'getProductosTN') {
      const provFilter = e.parameter.proveedor || '';
      const productos = obtenerProductosTN(provFilter);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, productos: productos }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'getProveedores') {
      // 1. Teles guardados en la tab Proveedores (col A = nombre proveedor, col B = tel)
      const ss    = SpreadsheetApp.openById(CONFIG_RETIRO.PEDIDOS_SHEET_ID);
      const sheet = ss.getSheetByName('Proveedores');
      const telPorProv = {}; // PROVEEDOR_UPPER → tel
      const nombrePorKey = {}; // PROVEEDOR_UPPER → nombre original (para display)
      if (sheet) {
        const data = sheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          const nombre = String(data[i][0] || '').trim();
          if (!nombre) continue;
          const key = nombre.toUpperCase();
          telPorProv[key]    = String(data[i][1] || '');
          nombrePorKey[key]  = nombre;
        }
      }
      // 2. Marcas de TiendaNube → mapear a nombre de Proveedor
      let brandsSet = {};
      try { brandsSet = obtenerMarcasTN(); } catch(e) { Logger.log('Error marcas TN: ' + e.message); }
      // 3. Construir lista con NOMBRES DE PROVEEDOR (no brands)
      //    Para cada brand TN: si mapea a un proveedor conocido, usar ese; si no, usar la brand como proveedor
      const provMap = {}; // PROVEEDOR_UPPER → { nombre, tel }
      Object.keys(brandsSet).forEach(function(brandKey) {
        const brandNombre = brandsSet[brandKey];
        const provName = marcaToProveedorRP(brandNombre) || brandNombre;
        const provKey  = provName.toUpperCase();
        if (!provMap[provKey]) {
          provMap[provKey] = { nombre: provName, tel: telPorProv[provKey] || '' };
        }
      });
      // Agregar proveedores del Sheet que no vinieron de TN
      Object.keys(nombrePorKey).forEach(function(key) {
        if (!provMap[key]) provMap[key] = { nombre: nombrePorKey[key], tel: telPorProv[key] || '' };
      });
      // Excluir proveedores de productos digitales/servicios (no generan pedidos físicos)
      const EXCLUIR_PEDIDOS = ['Carlos Villegas'];
      let lista = Object.values(provMap)
        .filter(function(p) { return EXCLUIR_PEDIDOS.indexOf(p.nombre) === -1; })
        .sort(function(a,b){ return a.nombre.localeCompare(b.nombre); });
      // 4. Si es FGP, filtrar solo sus proveedores (ahora p.nombre ya ES un proveedor)
      const emailGP = (e.parameter.email || '').toLowerCase().trim();
      const proveedoresGP = getMarcasFGP(emailGP);
      if (Array.isArray(proveedoresGP)) {
        const provsLower = proveedoresGP.map(function(p){ return p.toLowerCase(); });
        lista = lista.filter(function(p) {
          return provsLower.indexOf(p.nombre.toLowerCase()) !== -1;
        });
      }
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

    if (action === 'saveStockOverride') {
      const alarmaActivada = e.parameter.alarmaActivada !== '0';
      guardarOverrideStock(e.parameter.clave, e.parameter.nombre_variante,
        e.parameter.umbral, e.parameter.piso, alarmaActivada);
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, saved: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'getStockDashboard') {
      const dash = getStockDashboard();
      return ContentService
        .createTextOutput(JSON.stringify(dash))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'getStockValorizacion') {
      const val = getStockValorizacion();
      return ContentService
        .createTextOutput(JSON.stringify(val))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'getVentasSinStock') {
      const emailParam    = (e.parameter.email || '').toLowerCase().trim();
      const marcasFGP     = getMarcasFGP(emailParam);
      // undefined = sin auth → retornar error
      if (marcasFGP === undefined) {
        return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Sin autorización.' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      // null = admin ve todo; array = FGP ve solo sus proveedores
      const provsPermitidos = Array.isArray(marcasFGP)
        ? marcasFGP.map(function(p) { return normProv(p); })
        : null;

      const skusInf  = obtenerSkusStockInfinito();
      const ss       = SpreadsheetApp.openById(INV_VENTAS_ID);
      const sheet    = ss.getSheetByName('Ventas');
      const data     = sheet.getDataRange().getValues();
      const desdeStr = e.parameter.desde || '';
      const hastaStr = e.parameter.hasta || '';
      const desde    = desdeStr ? new Date(desdeStr + 'T00:00:00') : null;
      const hasta    = hastaStr ? new Date(hastaStr + 'T23:59:59') : null;

      // Leer pedidos: por proveedor, ordenados por fecha (más viejos primero)
      // Matching FIFO por cantidad: cada venta se asigna al pedido más viejo con qty disponible del SKU
      const ESTADOS_OCULTAR = ['Entregado en Escuela', 'Cerrado'];
      const pedidosPorProv  = {}; // normProv → [{norden, estado, fecha, skuQty: {sku → qty restante}}]
      try {
        const sPed  = getPedidosSheet();
        const dPed  = sPed.getDataRange().getValues();
        for (let i = 1; i < dPed.length; i++) {
          const fila   = dPed[i];
          const prov   = normProv(fila[COL.PROVEEDOR]);
          const est    = String(fila[COL.ESTADO]    || '').trim();
          const prods  = String(fila[COL.PRODUCTOS]  || '');
          const norden = String(fila[COL.NORDEN]     || '').trim();
          if (!prov || est === 'Cancelado') continue;
          // Parsear qty por SKU: cada línea tiene formato "Nombre xN Unidad ($precio) [SKU]"
          // El precio y la unidad son opcionales; SKU siempre está entre [ ]
          const skuQty = {};
          prods.split('\n').forEach(function(line) {
            const skuMatch = line.match(/\[([^\]]+)\]/);
            if (!skuMatch) return;
            const sku = skuMatch[1].trim();
            const qtyMatch = line.match(/x(\d+)/);
            const qty = qtyMatch ? (parseInt(qtyMatch[1]) || 1) : 1;
            skuQty[sku] = (skuQty[sku] || 0) + qty;
          });
          if (Object.keys(skuQty).length === 0) continue;
          const fechaRaw = fila[COL.FECHA];
          let fechaPed;
          if (fechaRaw instanceof Date) {
            fechaPed = fechaRaw;
          } else {
            const pp = String(fechaRaw).match(/^(\d+)\/(\d+)\/(\d+)/);
            fechaPed = pp ? new Date(parseInt(pp[3]), parseInt(pp[2]) - 1, parseInt(pp[1])) : new Date(fechaRaw);
          }
          if (!pedidosPorProv[prov]) pedidosPorProv[prov] = [];
          pedidosPorProv[prov].push({ norden, estado: est, fecha: fechaPed, skuQty });
        }
        // Ordenar pedidos de cada proveedor más viejo primero (FIFO)
        Object.keys(pedidosPorProv).forEach(function(p) {
          pedidosPorProv[p].sort(function(a, b) { return a.fecha - b.fecha; });
        });
      } catch(pe) { Logger.log('Error leyendo pedidos: ' + pe.message); }

      // Recolectar ventas en el rango sin asignar todavía
      const rawLineas = [];
      for (let i = 1; i < data.length; i++) {
        const fila     = data[i];
        const rawFecha = fila[0];
        if (!rawFecha) continue;
        let fecha;
        if (rawFecha instanceof Date) {
          fecha = rawFecha;
        } else {
          const parts = String(rawFecha).match(/^(\d+)\/(\d+)\/(\d+)/);
          fecha = parts
            ? new Date(parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1]))
            : new Date(rawFecha);
        }
        if (isNaN(fecha.getTime())) continue;
        if (hasta && fecha > hasta) continue; // hasta siempre estricto
        // desde: se aplica después del FIFO para ventas sin pedido (ver abajo)

        const sku      = String(fila[6] || '').trim();
        const cantidad = parseInt(fila[7]) || 0;
        if (!sku || cantidad <= 0 || !skusInf[sku]) continue;

        const costoStr  = String(fila[13] || '');
        const costo     = parseFloat(costoStr.replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
        const proveedor = String(fila[12] || '').trim();

        // Filtrar por proveedores permitidos del FGP
        if (provsPermitidos !== null && provsPermitidos.indexOf(normProv(proveedor)) === -1) continue;

        rawLineas.push({ fechaObj: fecha, pedido: String(fila[1] || ''), comprador: String(fila[3] || ''),
          producto: String(fila[5] || ''), sku, cantidad, precio: String(fila[8] || ''), proveedor, costo });
      }

      // Ordenar ventas de más vieja a más nueva para asignación FIFO
      rawLineas.sort(function(a, b) { return a.fechaObj - b.fechaObj; });

      // Asignar cada venta al pedido más viejo con qty disponible del SKU
      const lineas = [];
      rawLineas.forEach(function(l) {
        const pedsProv = pedidosPorProv[normProv(l.proveedor)] || [];
        let estadoPedido = null;
        let norden = null;
        for (let pi = 0; pi < pedsProv.length; pi++) {
          const ped = pedsProv[pi];
          if (!ped.skuQty[l.sku] || ped.skuQty[l.sku] <= 0) continue;
          ped.skuQty[l.sku] -= l.cantidad;
          norden = ped.norden;
          estadoPedido = ped.estado; // 'Solicitado', 'Confirmado', 'En Camino', etc.
          break;
        }
        if (estadoPedido !== null && ESTADOS_OCULTAR.indexOf(estadoPedido) !== -1) return; // ocultar ventas ya entregadas
        // Ventas anteriores al rango solo se muestran si tienen pedido asignado
        if (desde && l.fechaObj < desde && estadoPedido === null) return;

        lineas.push({
          fecha:        Utilities.formatDate(l.fechaObj, 'America/Argentina/Cordoba', 'dd/MM/yyyy'),
          pedido:       l.pedido,
          comprador:    l.comprador,
          producto:     l.producto,
          sku:          l.sku,
          cantidad:     l.cantidad,
          precio:       l.precio,
          proveedor:    l.proveedor,
          costo:        l.costo,
          estadoPedido: estadoPedido, // null | 'vigente'
          norden:       norden,       // norden del pedido que cubre esta venta, o null
        });
      });

      const grupos = {};
      lineas.forEach(function(l) {
        const prov = l.proveedor || 'Sin proveedor';
        if (!grupos[prov]) grupos[prov] = [];
        grupos[prov].push(l);
      });

      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, grupos: grupos }))
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
const TN_API_TOKEN  = _PR.getProperty('TN_API_TOKEN');

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

function obtenerProductosTN(provFilter) {
  const resp = UrlFetchApp.fetch(
    'https://api.tiendanube.com/v1/' + TN_STORE_ID + '/products?per_page=200&fields=id,name,brand,variants', {
    headers: {
      'Authentication': 'bearer ' + TN_API_TOKEN,
      'User-Agent': 'DienteDeLeon (dientedeleon-admin@googlegroups.com)'
    }
  });
  const data         = JSON.parse(resp.getContentText());
  const normFilter   = provFilter ? normProv(provFilter) : '';
  const seen         = {};
  const lista        = [];
  data.forEach(function(p) {
    const nombreBase = p.name && p.name.es ? p.name.es : String(p.name || '');
    // Filtrar por proveedor si se especifica: brand TN → proveedor via MARCA_A_PROVEEDOR_RP
    if (normFilter) {
      const brand   = String(p.brand || '').trim();
      const provDeBrand = marcaToProveedorRP(brand);
      if (!provDeBrand || normProv(provDeBrand) !== normFilter) return;
    }
    (p.variants || []).forEach(function(v) {
      if (v.visible === false) return;
      const sku = v.sku ? String(v.sku).trim() : '';
      const varNombre = v.values && v.values.length
        ? v.values.map(function(val) { return val.es || val; }).join(' / ')
        : '';
      const nombreCompleto = varNombre ? nombreBase + ' ' + varNombre : nombreBase;
      if (sku && !seen[nombreCompleto.toUpperCase()]) {
        seen[nombreCompleto.toUpperCase()] = true;
        lista.push({ nombre: nombreCompleto, sku: sku });
      }
    });
  });
  return lista;
}

function obtenerSkusStockInfinito() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get('skusInf_v1');
  if (cached) return JSON.parse(cached);

  const skus = {};
  let page = 1;
  while (true) {
    const resp = UrlFetchApp.fetch(
      'https://api.tiendanube.com/v1/' + TN_STORE_ID + '/products?per_page=200&page=' + page + '&fields=id,brand,variants', {
      headers: {
        'Authentication': 'bearer ' + TN_API_TOKEN,
        'User-Agent': 'DienteDeLeon (dientedeleon-admin@googlegroups.com)'
      }
    });
    const data = JSON.parse(resp.getContentText());
    if (!data || data.length === 0) break;
    data.forEach(function(p) {
      (p.variants || []).forEach(function(v) {
        if (v.stock === null && v.sku) {
          skus[v.sku.trim()] = true;
        }
      });
    });
    if (data.length < 200) break;
    page++;
  }
  cache.put('skusInf_v1', JSON.stringify(skus), 3600); // cache 1 hora
  return skus;
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
  FECHA_ESCUELA: 15,  // P
  COSTO_ENVIO:   16   // Q
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
    fechaEscuela: fmtCelFecha(fila[COL.FECHA_ESCUELA]),
    costoEnvio:   fila[COL.COSTO_ENVIO]  || ''
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
  fila[COL.PROVEEDOR] = proveedor || ''; // guardar nombre de proveedor tal cual, sin mapear a marca
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

function updateCostoEnvioPedido(data) {
  const { norden, costoEnvio } = data;
  if (!norden) throw new Error('Falta norden');
  const resultado = leerPedidoPorId(norden);
  if (!resultado) throw new Error('Pedido no encontrado: ' + norden);
  const sheet = getPedidosSheet();
  sheet.getRange(resultado.fila, COL.COSTO_ENVIO + 1).setValue(parseFloat(costoEnvio) || 0);
  Logger.log('Costo envío actualizado: ' + norden + ' → ' + costoEnvio);
  return 'Costo envío actualizado: ' + norden;
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

// data: { action:'subirComprobante', norden, filename, mimeType, base64, tipoPago }
// tipoPago: 'completo' → marca Pagado | 'envio'|'parcial' → solo guarda el link
function subirComprobanteEnDrive(data) {
  const { norden, filename, mimeType, base64, tipoPago } = data;
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

  const existing = sheet.getRange(fila, COL.COMPROBANTE + 1).getValue() || '';
  const newVal   = existing ? existing + '|' + url : url;
  sheet.getRange(fila, COL.COMPROBANTE + 1).setValue(newVal);
  if (!tipoPago || tipoPago === 'completo') {
    sheet.getRange(fila, COL.ESTADO_PAGO + 1).setValue('Pagado');
    sheet.getRange(fila, COL.FECHA_PAGO + 1).setValue(hoy);
  }

  Logger.log('Comprobante subido: ' + norden + ' → ' + newVal + ' (tipoPago: ' + (tipoPago||'completo') + ')');
  return { url: url, comprobante: newVal };
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
  'LA YAYA':                  { nombre: 'Monica Chesta',     email: 'monicachesta@gmail.com'    },
  'GUARDIANES COLMENA':       { nombre: 'Monica Chesta',     email: 'monicachesta@gmail.com'    },
  'GUARDIANES DE LA COLMENA': { nombre: 'Monica Chesta',     email: 'monicachesta@gmail.com'    },
  'GROEN':                    { nombre: 'Monica Chesta',     email: 'monicachesta@gmail.com'    },
  'CABALLO NEGRO':            { nombre: 'Lucas De Stefano',  email: 'lmdestefano@gmail.com'     },
  'YEMARI':                   { nombre: 'Lucas De Stefano',  email: 'lmdestefano@gmail.com'     },
  'SOL DE PAPEL':             { nombre: 'Lucas De Stefano',  email: 'lmdestefano@gmail.com'     },
  'EL MAITEN':                { nombre: 'Pia Lucarno',       email: 'pialucarno@gmail.com'      },
  'ODDIS':                    { nombre: 'Pia Lucarno',       email: 'pialucarno@gmail.com'      },
  'MIX Y FRUTOS SECOS':       { nombre: 'Pia Lucarno',       email: 'pialucarno@gmail.com'      },
  'PARAISA':                  { nombre: 'Maria Martini',     email: 'martinimaria39@gmail.com'  },
  'ODDIS':                    { nombre: 'Luli del Castillo', email: 'lourdelcastillo@gmail.com' },
};

// Tabla local de emails autorizados (mantener sincronizada con AUTH_EMAILS en retiro_qr.gs)
// null en proveedores = admin (ve todo); array = FGP (ve solo sus proveedores)
const AUTH_EMAILS_RP = {
  'robertson.ine@gmail.com':              null,
  'longhi.yuliana@gmail.com':             null,
  'yuliana.longhi@dandelion.edu.ar':      null,
  'martinimaria39@gmail.com':             ['Yemari','Caballo Negro','La Yaya','Guardianes de la Colmena','El Maiten','Oddis','Groen','Paraisa'],
  'lourdelcastillo@gmail.com':            ['La Yaya','Oddis'],
  'pialucarno@gmail.com':                 ['El Maiten','Oddis','BioSalud','Pajarito Amarillo'],
  'monicachesta@gmail.com':               ['La Yaya','Guardianes de la Colmena','Groen','Oddis','Yemari','Caballo Negro'],
  'lmdestefano@dandelion.edu.ar':         ['Yemari','Caballo Negro','Sol de Oro'],
  'lmdestefano@gmail.com':               ['Yemari','Caballo Negro','Sol de Oro'],
  'francoalini@gmail.com':               ['Nazareno'],
  'tiendalimon.natural@gmail.com':       ['Tienda Limón'],
  'dominguez.dolo@gmail.com':            ['Sol de Oro'],
};

// Devuelve array de proveedores si es FGP, null si es admin (ve todo),
// undefined si el email no está autorizado.
function getMarcasFGP(email) {
  if (!email) return undefined;
  var em = email.toLowerCase().trim();
  if (!(em in AUTH_EMAILS_RP)) return undefined;
  return AUTH_EMAILS_RP[em]; // null = admin, array = FGP
}

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
    defaults[m] = { leadTime: 10, stockMinimo: INV_PISO_MARCA[m] || INV_PISO_DEFAULT };
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
        pisoOverride:   data[i][3] !== '' && data[i][3] !== null ? parseInt(data[i][3]) : null,
        alarmaActivada: !(data[i][6] === false || data[i][6] === 'FALSE' || data[i][6] === 0)
      };
    }
  } catch(e) { Logger.log('invLeerOverrides error: ' + e); }
  return map;
}

function guardarOverrideStock(clave, nombre, umbralOverride, pisoOverride, alarmaActivada) {
  const ss  = SpreadsheetApp.openById(INV_SHEET_ID);
  var sheet = ss.getSheetByName('ConfigStock');
  if (!sheet) {
    sheet = ss.insertSheet('ConfigStock');
    sheet.appendRow(['Clave', 'Nombre', 'Umbral Override', 'Piso Override', 'Stock Primario', 'Stock Secundario', 'Alarma Activada']);
  }
  const alarmaVal = alarmaActivada !== false;
  const data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === clave) {
      sheet.getRange(i + 1, 3).setValue(umbralOverride !== null && umbralOverride !== '' ? umbralOverride : '');
      sheet.getRange(i + 1, 4).setValue(pisoOverride   !== null && pisoOverride   !== '' ? pisoOverride   : '');
      sheet.getRange(i + 1, 7).setValue(alarmaVal);
      return;
    }
  }
  sheet.appendRow([clave, nombre,
    umbralOverride !== null && umbralOverride !== '' ? umbralOverride : '',
    pisoOverride   !== null && pisoOverride   !== '' ? pisoOverride   : '',
    '', '', alarmaVal
  ]);
}

function invObtenerProductosTN() {
  const resp = UrlFetchApp.fetch(
    'https://api.tiendanube.com/v1/' + TN_STORE_ID + '/products?per_page=200', {
    headers: {
      'Authentication': 'bearer ' + TN_API_TOKEN,
      'User-Agent': 'DienteDeLeon (dientedeleon-admin@googlegroups.com)'
    }
  });
  return JSON.parse(resp.getContentText());
}

function getStockDashboard() {
  const { velocidades, diasActivos } = invGetVelocidades();
  const configMarca = invLeerConfig();
  const overrides   = invLeerOverrides();
  const alertas     = JSON.parse(PropertiesService.getScriptProperties().getProperty('ALERTAS_ENVIADAS') || '{}');

  // Pedidos activos por marca
  const pedidosActivos = {};
  try {
    const ACTIVOS = ['solicitado', 'confirmado', 'en camino'];
    const data    = getPedidosSheet().getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      const norden      = String(data[i][0] || '').trim();
      const proveedorRaw = String(data[i][2] || '').trim();
      const estado      = String(data[i][5] || '').trim();
      if (!norden || !proveedorRaw || ACTIVOS.indexOf(estado.toLowerCase()) === -1) continue;
      // Normalizar: si el proveedor coincide con una marca conocida, usar esa key
      const marca = invDetectarMarca(proveedorRaw) || proveedorRaw.toUpperCase();
      if (!pedidosActivos[marca]) pedidosActivos[marca] = [];
      pedidosActivos[marca].push({ norden: norden, estado: estado, fecha: String(data[i][1] || '') });
    }
  } catch(e) { Logger.log('getStockDashboard pedidos error: ' + e); }

  // Productos TiendaNube
  const productos = invObtenerProductosTN();
  const resultado = [];

  productos.forEach(function(producto) {
    const nombreProd = producto.name && producto.name.es ? producto.name.es : String(producto.name || '');
    const marca      = invDetectarMarca(nombreProd);
    const fgp        = marca ? INV_FGP[marca] : null;
    const cfg        = configMarca[marca] || { leadTime: 10, stockMinimo: INV_PISO_DEFAULT };

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
        sku: variante.sku || '',
        stock: stock, velocidad: velocidad, diasActivos: diasActivos,
        leadTime: cfg.leadTime,
        umbralCalc: umbralCalc, umbralOverride: ov.umbralOverride !== undefined ? ov.umbralOverride : null,
        pisoMarca: pisoMarca,  pisoOverride:   ov.pisoOverride   !== undefined ? ov.pisoOverride   : null,
        umbralFinal: umbralFinal, pisoFinal: pisoFinal,
        alertaEnviada: alertaEnviada, semaforo: semaforo,
        violaUmbral: stock <= umbralFinal,
        alarmaActivada: ov.alarmaActivada !== false
      });
    });

    if (!variantes.length) return;
    resultado.push({
      id: producto.id, nombre: nombreProd, marca: marca,
      fgp: fgp ? fgp.nombre : null,
      pedidos:   (marca ? pedidosActivos[marca] : []) || [],
      variantes: variantes
    });
  });

  return { ok: true, productos: resultado, diasActivos: diasActivos };
}

function normalizarTexto(s) {
  return String(s).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function invDetectarMarca(nombreProd) {
  const n = normalizarTexto(nombreProd);
  var found = null;
  Object.keys(INV_FGP).forEach(function(marca) {
    if (n.indexOf(normalizarTexto(marca)) !== -1) found = marca;
  });
  return found;
}

// ── STOCK VALORIZACION ────────────────────────────────────
function getStockValorizacion() {
  const productos = invObtenerProductosTN();
  var total = 0;
  var items = [];

  productos.forEach(function(prod) {
    var nombre = (prod.name && prod.name.es) ? prod.name.es : String(prod.name || '');
    (prod.variants || []).forEach(function(v) {
      var stock = parseInt(v.stock || 0);
      var costo = parseFloat(v.cost || 0);
      var peso  = parseFloat(v.weight || 0);
      if (stock <= 0) return;
      if (peso === 0) return; // excluye digitales (sin envío)
      var valor = stock * costo;
      total += valor;
      var varNombre = '';
      if (v.values && v.values.length > 0) {
        varNombre = v.values.map(function(vv) {
          return vv.es || vv.pt || Object.values(vv)[0] || '';
        }).join(' / ');
      }
      items.push({ nombre: nombre, variante: varNombre, stock: stock, costo: costo, valor: valor });
    });
  });

  items.sort(function(a, b) { return b.valor - a.valor; });
  return { ok: true, total: Math.round(total), items: items, ts: new Date().toLocaleString('es-AR') };
}


// ── Tests diagnóstico ─────────────────────────────────────────────────────────

function testGetVentasSinStock() {
  const e = { parameter: { action: 'getVentasSinStock', desde: '2026-01-01', hasta: '2026-12-31' } };
  const result = JSON.parse(doGet(e).getContent());
  Logger.log('ok: ' + result.ok);
  Logger.log('grupos: ' + JSON.stringify(Object.keys(result.grupos || {})));
  const total = Object.values(result.grupos || {}).reduce(function(s, g) { return s + g.length; }, 0);
  Logger.log('total lineas: ' + total);
}

function testSkusStockInfinito() {
  const skus = obtenerSkusStockInfinito();
  Logger.log('Total SKUs stock infinito: ' + Object.keys(skus).length);
  Logger.log('CREMA_SOLIDA_BL_70G: ' + (skus['CREMA_SOLIDA_BL_70G'] ? 'SÍ' : 'NO'));
}

// Chequeo liviano: busca la venta 817/CREMA en el sheet sin llamar a TN
function testVenta817Sheet() {
  const ss    = SpreadsheetApp.openById(INV_VENTAS_ID);
  const sheet = ss.getSheetByName('Ventas');
  const data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]) === '817') {
      Logger.log('pedido=817 sku=' + data[i][6] + ' proveedor=' + data[i][12]);
    }
  }
}

// Chequeo liviano: muestra todas las ventas de CREMA_SOLIDA_BL_70G con su proveedor
function testVentasCrema() {
  const ss    = SpreadsheetApp.openById(INV_VENTAS_ID);
  const sheet = ss.getSheetByName('Ventas');
  const data  = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][6]).trim() === 'CREMA_SOLIDA_BL_70G') {
      Logger.log('pedido=' + data[i][1] + ' proveedor=' + data[i][12] + ' normProv=' + normProv(String(data[i][12])));
    }
  }
}

// Chequeo liviano: muestra pedidos de Tienda Limón con sus SKUs parseados
function testPedidosTiendaLimon() {
  const sh   = getPedidosSheet();
  const data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    const prov = String(data[i][COL.PROVEEDOR] || '');
    if (normProv(prov).indexOf('tienda limon') !== -1 || normProv(prov).indexOf('tienda limon') !== -1) {
      const prods = String(data[i][COL.PRODUCTOS] || '');
      const skus  = (prods.match(/\[([^\]]+)\]/g) || []).join(', ');
      Logger.log('norden=' + data[i][COL.NORDEN] + ' prov=' + prov + ' estado=' + data[i][COL.ESTADO] + ' skus=' + skus);
    }
  }
}

function testFiltroFGP() {
  var emails = [
    'tiendalimon.natural@gmail.com', // Natalia → solo Tienda Limón
    'francoalini@gmail.com',         // Franco → solo Nazareno
    'dominguez.dolo@gmail.com',      // Dolo → solo Sol de Oro
    'robertson.ine@gmail.com',       // Ines → admin, ve todo
    'emaildesconocido@test.com'      // sin auth → error
  ];
  emails.forEach(function(em) {
    var provs = getMarcasFGP(em);
    if (provs === undefined) {
      Logger.log(em + ' → SIN AUTORIZACIÓN');
    } else if (provs === null) {
      Logger.log(em + ' → ADMIN (ve todo)');
    } else {
      Logger.log(em + ' → FGP: ' + JSON.stringify(provs));
    }
  });
}
