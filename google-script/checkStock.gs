// ============================================================
// DIENTE DE LEÓN — Alerta de Stock Bajo + Orden de Pedido
// ============================================================

const CONFIG_STOCK = {
  STORE_ID:        '7396246',
  API_TOKEN:       'e3d744d94ddbf13317bef0082c53e2c46fb50631',
  STOCK_UMBRAL:    10,           // fallback si no hay historial de ventas
  STOCK_MINIMO:    10,           // piso absoluto: alerta siempre si stock < este valor
  VELOCIDAD_DIAS:  60,
  SAFETY_FACTOR:   1.5,
  VENTAS_SHEET_ID: '1-57n6RmTFQjwNFVYxNPzll8MMuV4NvXXx5v0wTvR_6g',
  FORM_URL:        'https://escuela-dandelion.github.io/Comision-Recursos/orden-de-pedido.html',
  RETIRO_URL:      'https://escuela-dandelion.github.io/Comision-Recursos/retiro-proveedor.html',
  SHEET_ID:        '1NmjnYWllrXrFpJI8GYJOjkGz90lPtvvDi0IQEYZl7-I',
  ADMIN_EMAIL:     'martinimaria39@gmail.com',
  TEST_MODE:       false,
  TEST_EMAIL:      'robertson.ine@gmail.com'
};

// Meses excluidos del cálculo de velocidad (0=Ene, 1=Feb, 2=Mar, 6=Jul)
const MESES_EXCLUIDOS = [0, 1, 2, 6];

const FGP_POR_MARCA = {
  'LA YAYA':                  { nombre: 'Yuliana Longhi',    email: 'longhi.yuliana@gmail.com',   tel_proveedor: '' },
  'ODDIS':                    { nombre: 'Luli del Castillo',  email: 'lourdelcastillo@gmail.com',  tel_proveedor: '' },
  'CABALLO NEGRO':            { nombre: 'Maria Martini',      email: 'martinimaria39@gmail.com',   tel_proveedor: '' },
  'YEMARI':                   { nombre: 'Maria Martini',      email: 'martinimaria39@gmail.com',   tel_proveedor: '' },
  'GROEN':                    { nombre: 'Maria Martini',      email: 'martinimaria39@gmail.com',   tel_proveedor: '' },
  // PARAISA excluida — productos con stock infinito (null), no requieren alerta
  'EL MAITEN':                { nombre: 'Maria Martini',      email: 'martinimaria39@gmail.com',   tel_proveedor: '' },
  'GUARDIANES DE LA COLMENA': { nombre: 'Maria Martini',      email: 'martinimaria39@gmail.com',   tel_proveedor: '' }
};

// ── CONFIG POR MARCA — pestaña ConfigAlertas (col A: Marca, col B: Lead time días) ──
function leerConfigAlertas() {
  const defaults = {
    'CABALLO NEGRO':            { leadTime: 14 },
    'YEMARI':                   { leadTime: 14 },
    'LA YAYA':                  { leadTime: 14 },
    'ODDIS':                    { leadTime: 14 },
    'GROEN':                    { leadTime: 14 },
    'EL MAITEN':                { leadTime: 14 },
    'GUARDIANES DE LA COLMENA': { leadTime: 14 }
  };
  try {
    const ss    = SpreadsheetApp.openById(CONFIG_STOCK.SHEET_ID);
    const sheet = ss.getSheetByName('ConfigAlertas');
    if (!sheet) return defaults;
    const data   = sheet.getDataRange().getValues();
    const config = {};
    for (var i = 1; i < data.length; i++) {
      const marca = String(data[i][0] || '').toUpperCase().trim();
      if (!marca) continue;
      config[marca] = { leadTime: parseInt(data[i][1]) || 14 };
    }
    return Object.keys(config).length > 0 ? config : defaults;
  } catch(e) {
    Logger.log('Error leyendo ConfigAlertas: ' + e);
    return defaults;
  }
}

// ── VELOCIDADES — lee el Sheet de Ventas (últimos 60 días, por nombre de producto) ──
function calcularVelocidades() {
  const velocidades = {};
  var diasActivos = 0;
  try {
    const ss    = SpreadsheetApp.openById(CONFIG_STOCK.VENTAS_SHEET_ID);
    const sheet = ss.getSheetByName('Ventas');
    if (!sheet) return { velocidades: velocidades, diasActivos: CONFIG_STOCK.VELOCIDAD_DIAS };
    const data   = sheet.getDataRange().getValues();
    const hoy    = new Date();
    const hace60 = new Date(hoy.getTime() - CONFIG_STOCK.VELOCIDAD_DIAS * 24 * 60 * 60 * 1000);

    // Contar solo los días activos (no excluidos) dentro de la ventana de 60 días
    for (var d = new Date(hace60.getTime()); d <= hoy; d.setDate(d.getDate() + 1)) {
      if (MESES_EXCLUIDOS.indexOf(d.getMonth()) === -1) diasActivos++;
    }

    for (var i = 1; i < data.length; i++) {
      const fecha    = data[i][0] ? new Date(data[i][0]) : null;
      if (!fecha || fecha < hace60 || fecha > hoy) continue;
      if (MESES_EXCLUIDOS.indexOf(fecha.getMonth()) !== -1) continue; // saltar mes excluido
      const nombre   = String(data[i][5] || '').trim();
      const cantidad = parseInt(data[i][7]) || 0;
      if (!nombre || cantidad <= 0) continue;
      velocidades[nombre] = (velocidades[nombre] || 0) + cantidad;
    }
    Logger.log('Velocidades calculadas (' + diasActivos + ' días activos): ' + JSON.stringify(velocidades));
  } catch(e) {
    Logger.log('Error calculando velocidades: ' + e);
  }
  return { velocidades: velocidades, diasActivos: diasActivos || CONFIG_STOCK.VELOCIDAD_DIAS };
}

// ── VELOCIDADES CON CACHE — se recalcula una vez por mes en el 3er lunes ──
function getVelocidades() {
  const hoy   = new Date();
  const llave = 'VEL_' + hoy.getFullYear() + '_' + hoy.getMonth();
  const props = PropertiesService.getScriptProperties();

  if (esTercerLunes() && !props.getProperty(llave)) {
    const result = calcularVelocidades();
    props.setProperty('VELOCIDADES_CACHE', JSON.stringify(result.velocidades));
    props.setProperty('DIAS_ACTIVOS_CACHE', String(result.diasActivos));
    props.setProperty(llave, '1');
    Logger.log('Velocidades recalculadas y guardadas para este mes.');
    return result;
  }
  const cached = props.getProperty('VELOCIDADES_CACHE');
  if (cached) {
    const diasActivos = parseInt(props.getProperty('DIAS_ACTIVOS_CACHE')) || CONFIG_STOCK.VELOCIDAD_DIAS;
    return { velocidades: JSON.parse(cached), diasActivos: diasActivos };
  }

  // Sin cache aún (primera vez): calcular aunque no sea 3er lunes
  Logger.log('Sin cache de velocidades — calculando por primera vez.');
  const result = calcularVelocidades();
  props.setProperty('VELOCIDADES_CACHE', JSON.stringify(result.velocidades));
  props.setProperty('DIAS_ACTIVOS_CACHE', String(result.diasActivos));
  return result;
}

// ── BUSCAR VELOCIDAD ─────────────────────────────────────────
// Prueba: nombre exacto → nombre + "(variante)" → case-insensitive
function buscarVelocidad(nombreProducto, nombreVariante, velocidades) {
  if (velocidades[nombreProducto] !== undefined) return velocidades[nombreProducto];
  if (nombreVariante) {
    const conVar = nombreProducto + ' (' + nombreVariante + ')';
    if (velocidades[conVar] !== undefined) return velocidades[conVar];
  }
  const lowProd  = nombreProducto.toLowerCase();
  const lowConVar = nombreVariante ? (nombreProducto + ' (' + nombreVariante + ')').toLowerCase() : null;
  var found;
  Object.keys(velocidades).forEach(function(k) {
    const kl = k.toLowerCase();
    if (kl === lowProd || (lowConVar && kl === lowConVar)) found = velocidades[k];
  });
  return found !== undefined ? found : 0;
}

// ── UMBRAL REACTIVO (buffer de lead time, cualquier día) ───
function calcularUmbral(nombreProducto, leadTime, velocidades, diasActivos, nombreVariante) {
  const total = buscarVelocidad(nombreProducto, nombreVariante || null, velocidades);
  if (!total) return CONFIG_STOCK.STOCK_UMBRAL;
  return Math.ceil((total / diasActivos) * leadTime * CONFIG_STOCK.SAFETY_FACTOR);
}

// ── UMBRAL MENSUAL (demanda proyectada del mes siguiente, 3er lunes) ──
function calcularUmbralMensual(nombreProducto, velocidades, diasActivos, nombreVariante) {
  const total = buscarVelocidad(nombreProducto, nombreVariante || null, velocidades);
  if (!total) return null;
  // diasActivos días activos → proyectar a 30 días de mes activo
  return Math.ceil((total / diasActivos) * 30);
}

// ── TERCER LUNES DEL MES ───────────────────────────────────
function esTercerLunes() {
  const hoy  = new Date();
  const anio = hoy.getFullYear();
  const mes  = hoy.getMonth();
  var count  = 0;
  for (var d = 1; d <= 31; d++) {
    var fecha = new Date(anio, mes, d);
    if (fecha.getMonth() !== mes) break;
    if (fecha.getDay() === 1) {
      count++;
      if (count === 3) return fecha.getDate() === hoy.getDate();
    }
  }
  return false;
}

// ── FUNCIÓN PRINCIPAL ──────────────────────────────────────
function checkStockBajo() {
  const configMarca              = leerConfigAlertas();
  const { velocidades, diasActivos } = getVelocidades();
  const esLunes3                 = esTercerLunes();
  const productos       = obtenerProductos();
  const alertasEnviadas = obtenerAlertasEnviadas();
  const nuevasAlertas   = {};
  const alertasPorGrupo = {};

  const hoy   = new Date();
  const yyyyM = hoy.getFullYear() + '_' + hoy.getMonth();

  Logger.log('Productos: ' + productos.length + ' | Es 3er lunes: ' + esLunes3);

  productos.forEach(function(producto) {
    const marca      = (producto.brand || '').toUpperCase();
    const fgp        = FGP_POR_MARCA[marca];
    if (!fgp) return;

    const cfg        = configMarca[marca] || { leadTime: 14 };
    const nombreProd = producto.name && producto.name.es ? producto.name.es : String(producto.name || '');

    producto.variants.forEach(function(variante) {
      const nombreVar  = variante.values && variante.values.length > 0
        ? variante.values.map(function(v) { return v.es || v; }).join(' / ')
        : null;
      const descripcion = nombreVar ? nombreProd + ' — ' + nombreVar : nombreProd;
      const clave      = producto.id + '_' + variante.id;
      const claveLunes = clave + '_tlunes_' + yyyyM;

      // ── DEBUG ──────────────────────────────────────────────
      if (variante.stock === null) {
        Logger.log('[SKIP] ' + descripcion + ' — stock null (infinito en TiendaNube)');
        return;
      }
      const stock      = parseInt(variante.stock);
      const velocidad  = buscarVelocidad(nombreProd, nombreVar, velocidades);
      const umbral     = calcularUmbral(nombreProd, cfg.leadTime, velocidades, diasActivos, nombreVar);
      const yaAlertado = !!alertasEnviadas[clave];
      Logger.log(
        '[CHECK] ' + descripcion +
        ' | stock=' + stock +
        ' | vel60d=' + velocidad +
        ' | umbral=' + umbral +
        ' | yaAlertado=' + yaAlertado +
        ' | clave=' + clave
      );
      // ── FIN DEBUG ──────────────────────────────────────────

      // Reset alerta regular si el stock se repuso
      if (stock > umbral && alertasEnviadas[clave]) {
        delete alertasEnviadas[clave];
        nuevasAlertas['__reset__'] = true;
        Logger.log('  [RESET] ' + descripcion + ' (' + stock + ' > ' + umbral + ')');
      }

      // Condición A (cualquier día): stock bajo (umbral dinámico O piso absoluto) y no alertado aún
      const condA = (stock <= umbral || stock < CONFIG_STOCK.STOCK_MINIMO) && !alertasEnviadas[clave];
      // Condición B (3er lunes): ¿hay suficiente para abastecer el mes siguiente?
      const umbralMensual = esLunes3 ? calcularUmbralMensual(nombreProd, velocidades, diasActivos, nombreVar) : null;
      const condB = esLunes3 && umbralMensual !== null && stock < umbralMensual && !alertasEnviadas[claveLunes];

      if (!condA && !condB) {
        if (stock > umbral && stock >= CONFIG_STOCK.STOCK_MINIMO) {
          Logger.log('  [OK] stock suficiente (' + stock + ' > ' + umbral + ', mínimo=' + CONFIG_STOCK.STOCK_MINIMO + ')');
        } else if (yaAlertado) {
          Logger.log('  [BLOQUEADO] alerta ya enviada — resetear con resetearAlertas() para re-alertar');
        }
        return;
      }

      const grupoKey = fgp.email + '|' + marca;
      if (!alertasPorGrupo[grupoKey]) {
        alertasPorGrupo[grupoKey] = { fgp: fgp, marca: marca, items: [], _claves: {} };
      }
      if (!alertasPorGrupo[grupoKey]._claves[clave]) {
        alertasPorGrupo[grupoKey].items.push({
          clave:         clave,
          descripcion:   descripcion,
          stock:         stock,
          precio:        variante.price || null,
          umbral:        condA ? umbral : null,
          umbralMensual: condB ? umbralMensual : null,
          cantSugerida:  condB ? Math.max(0, umbralMensual - stock) : null
        });
        alertasPorGrupo[grupoKey]._claves[clave] = true;
      }
      if (condA) nuevasAlertas[clave]      = hoy.toISOString();
      if (condB) nuevasAlertas[claveLunes] = hoy.toISOString();
      Logger.log('  ⚠️ ' + (condA ? 'condA' : '') + (condB ? ' condB(mensual:' + umbralMensual + ')' : '') + ': ' + clave + ' (' + stock + ')');
    });
  });

  Object.values(alertasPorGrupo).forEach(function(grupo) {
    const urls = generarUrls(grupo.items, grupo.marca, grupo.fgp);
    enviarAlertaStock(grupo.fgp, grupo.marca, grupo.items, urls);
    Logger.log('Email enviado a ' + grupo.fgp.nombre + ' | ' + grupo.marca + ' | ' + grupo.items.length + ' ítem(s)');
  });

  delete alertasEnviadas['__reset__'];
  delete nuevasAlertas['__reset__'];
  PropertiesService.getScriptProperties()
    .setProperty('ALERTAS_ENVIADAS', JSON.stringify(Object.assign(alertasEnviadas, nuevasAlertas)));
}

// ── ENVÍO DE EMAIL ─────────────────────────────────────────
function enviarAlertaStock(fgp, marca, items, urls) {
  const destinatario = CONFIG_STOCK.TEST_MODE ? CONFIG_STOCK.TEST_EMAIL : fgp.email;
  const cc = (destinatario !== CONFIG_STOCK.ADMIN_EMAIL && !CONFIG_STOCK.TEST_MODE)
    ? CONFIG_STOCK.ADMIN_EMAIL : '';

  const intro = items.length === 1
    ? 'El siguiente producto de <strong>' + marca + '</strong> tiene stock bajo:'
    : 'Los siguientes productos de <strong>' + marca + '</strong> tienen stock bajo:';

  const listaHtml = items.map(function(item) {
    var linea = '<li style="margin-bottom:10px"><strong>' + item.descripcion + '</strong> — ' + item.stock + ' unidades en stock';
    if (item.umbralMensual !== null && item.umbralMensual !== undefined) {
      linea += '<br><span style="color:#92400e;font-size:13px">Según los últimos meses debés contar con <strong>' + item.umbralMensual + ' u.</strong>';
      if (item.cantSugerida > 0) {
        linea += ' — pedí al menos <strong>' + item.cantSugerida + ' u.</strong>';
      } else {
        linea += ' — tenés suficiente para el mes.';
      }
      linea += '</span>';
    } else if (item.umbral) {
      linea += ' <span style="color:#6b7280;font-size:12px">(umbral: ' + item.umbral + ' u.)</span>';
    }
    linea += '</li>';
    return linea;
  }).join('');

  const asunto   = 'Diente de León - Stock bajo: ' + marca;
  const cuerpoHtml = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
      <div style="background:#3a7d44;padding:20px 24px;border-radius:10px 10px 0 0;text-align:center">
        <img src="https://escuela-dandelion.github.io/Comision-Recursos/Logo_Diente_de_Leon_transparent.png" alt="Diente de León" style="height:64px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto">
        <h2 style="color:#fff;margin:0;font-size:18px">🌼 Diente de León — Stock Bajo</h2>
      </div>
      <div style="background:#f7f8fa;padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 10px 10px">
        <p>Hola <strong>${fgp.nombre}</strong>! ${intro}</p>
        <ul style="margin:16px 0;padding-left:20px;line-height:1.8">${listaHtml}</ul>
        <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
        <p><strong>📋 1. Hacer el pedido al proveedor:</strong></p>
        <p><a href="${urls.orden}" style="display:inline-block;background:#3a7d44;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700">Hacer el pedido</a></p>
        <br>
        <p><strong>📅 2. Agendar el retiro (cuando el proveedor confirme):</strong></p>
        <p><a href="${urls.retiro}" style="display:inline-block;background:#3a7d44;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700">Agendar el retiro</a></p>
        <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0">
        <p style="font-size:12px;color:#6b7280">Este mensaje fue generado automáticamente por el sistema Diente de León.</p>
      </div>
    </div>`;

  const opciones = { htmlBody: cuerpoHtml };
  if (cc) opciones.cc = cc;

  Logger.log('Enviando email a: ' + destinatario + (cc ? ' | CC: ' + cc : ''));
  MailApp.sendEmail(destinatario, asunto, '', opciones);
  Logger.log('Email enviado OK');
}

// ── LEER TEL DE PROVEEDOR DESDE EL SHEET ───────────────────
function leerTelProveedor(marca) {
  try {
    const ss    = SpreadsheetApp.openById(CONFIG_STOCK.SHEET_ID);
    const sheet = ss.getSheetByName('Proveedores');
    if (!sheet) return '';
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).toUpperCase() === marca.toUpperCase()) return String(data[i][1] || '');
    }
  } catch(e) { Logger.log('Error leyendo tel proveedor: ' + e.message); }
  return '';
}

// ── GENERAR AMBAS URLs (orden + retiro) ────────────────────
function generarUrls(items, marca, fgp) {
  const nOrden = registrarNuevaOrden(marca, fgp, items);

  const productos  = items.map(function(i) { return i.descripcion; }).join('|');
  const cantidades = items.map(function(i) { return i.stock; }).join('|');
  const precios    = items.map(function(i) { return i.precio || ''; }).join('|');

  const telProveedor = fgp.tel_proveedor || leerTelProveedor(marca);

  const paramsOrden = {
    producto:  productos,
    cantidad:  cantidades,
    precio:    precios,
    proveedor: marca,
    fgp:       fgp.nombre,
    norden:    nOrden
  };
  if (telProveedor) paramsOrden.tel = telProveedor;

  const paramsRetiro = {
    proveedor: marca,
    producto:  productos.replace(/\|/g, '\n'),
    fgp:       fgp.nombre,
    norden:    nOrden
  };

  return {
    orden:  buildUrl(CONFIG_STOCK.FORM_URL,   paramsOrden),
    retiro: buildUrl(CONFIG_STOCK.RETIRO_URL, paramsRetiro)
  };
}

function buildUrl(base, params) {
  const query = Object.keys(params)
    .map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
    .join('&');
  return base + '?' + query;
}

// ── GOOGLE SHEETS — REGISTRO DE ÓRDENES ───────────────────
function registrarNuevaOrden(marca, fgp, items) {
  const ss     = SpreadsheetApp.openById(CONFIG_STOCK.SHEET_ID);
  const config = ss.getSheetByName('Config');
  const pedidos = ss.getSheetByName('Pedidos');

  const ultimo = parseInt(config.getRange('B2').getValue()) || 0;
  const nuevo  = ultimo + 1;
  config.getRange('B2').setValue(nuevo);

  const anio   = new Date().getFullYear();
  const nOrden = 'ORD-' + anio + '-' + String(nuevo).padStart(3, '0');

  const descripcionProductos = items.map(function(i) { return i.descripcion; }).join('\n');
  const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');

  pedidos.appendRow([
    nOrden, fecha, marca, fgp.nombre, descripcionProductos,
    'Solicitado', fecha, '', '', '', 'No pagado', '', ''
  ]);

  Logger.log('Orden registrada: ' + nOrden + ' | ' + marca + ' | ' + fgp.nombre);
  return nOrden;
}

// ── TIENDANUBE API ─────────────────────────────────────────
function obtenerProductos() {
  const response = UrlFetchApp.fetch(
    'https://api.tiendanube.com/v1/' + CONFIG_STOCK.STORE_ID + '/products?per_page=200', {
    method: 'GET',
    headers: {
      'Authentication': 'bearer ' + CONFIG_STOCK.API_TOKEN,
      'User-Agent': 'DienteDeLeon (dientedeleon-admin@googlegroups.com)'
    }
  });
  return JSON.parse(response.getContentText());
}

// ── ALERTAS ────────────────────────────────────────────────
function obtenerAlertasEnviadas() {
  const raw = PropertiesService.getScriptProperties().getProperty('ALERTAS_ENVIADAS');
  return raw ? JSON.parse(raw) : {};
}

function resetearAlertas() {
  PropertiesService.getScriptProperties().deleteProperty('ALERTAS_ENVIADAS');
  Logger.log('Alertas reseteadas.');
}

function resetearVelocidades() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('VELOCIDADES_CACHE');
  props.deleteProperty('DIAS_ACTIVOS_CACHE');
  Logger.log('Cache de velocidades reseteado — se recalculará en la próxima corrida.');
}

// ── TRIGGER ────────────────────────────────────────────────
function crearTrigger() {
  ScriptApp.newTrigger('checkStockBajo')
    .timeBased().everyHours(6).create();
  Logger.log('Trigger creado: cada 6 horas.');
}
