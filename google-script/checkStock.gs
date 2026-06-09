// ============================================================
// DIENTE DE LEÓN — Alerta de Stock Bajo + Orden de Pedido
// ============================================================

const CONFIG_STOCK = {
  STORE_ID:     '7396246',
  API_TOKEN:    'e3d744d94ddbf13317bef0082c53e2c46fb50631',
  STOCK_UMBRAL: 10,
  FORM_URL:     'https://escuela-dandelion.github.io/Comision-Recursos/orden-de-pedido.html',
  RETIRO_URL:   'https://escuela-dandelion.github.io/Comision-Recursos/retiro-proveedor.html',
  SHEET_ID:     '1NmjnYWllrXrFpJI8GYJOjkGz90lPtvvDi0IQEYZl7-I',
  ADMIN_EMAIL:  'martinimaria39@gmail.com',   // siempre recibe copia del aviso
  TEST_MODE:    false,
  TEST_EMAIL:   'robertson.ine@gmail.com'     // usado solo si TEST_MODE: true
};

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

// ── FUNCIÓN PRINCIPAL ──────────────────────────────────────
function checkStockBajo() {
  const productos = obtenerProductos();
  Logger.log(`Productos encontrados: ${productos.length}`);

  const alertasEnviadas = obtenerAlertasEnviadas();
  Logger.log(`Alertas enviadas previamente: ${JSON.stringify(alertasEnviadas)}`);
  const nuevasAlertas = {};

  // Agrupar alertas por FGP + marca (= un email por proveedor por FGP)
  const alertasPorGrupo = {};

  productos.forEach(producto => {
    const marca = (producto.brand || '').toUpperCase();
    const fgp = FGP_POR_MARCA[marca];
    Logger.log(`Producto: ${JSON.stringify(producto.name)} | Marca: "${marca}" | FGP encontrado: ${!!fgp}`);

    if (!fgp) return;

    const nombreProducto = producto.name && producto.name.es
      ? producto.name.es
      : String(producto.name || 'Producto sin nombre');

    producto.variants.forEach(variante => {
      if (variante.stock === null) return;
      const stock = parseInt(variante.stock);
      const clave = `${producto.id}_${variante.id}`;
      Logger.log(`  Variante: ${clave} | Stock: ${stock} | Ya enviada: ${!!alertasEnviadas[clave]}`);

      if (stock > CONFIG_STOCK.STOCK_UMBRAL && alertasEnviadas[clave]) {
        // Stock se repuso — limpiar la alerta para que vuelva a disparar cuando baje de nuevo
        delete alertasEnviadas[clave];
        nuevasAlertas['__reset__'] = true;
        Logger.log(`  Stock repuesto — alerta reseteada: ${clave}`);
      }

      if (stock <= CONFIG_STOCK.STOCK_UMBRAL && !alertasEnviadas[clave]) {
        const nombreVariante = variante.values && variante.values.length > 0
          ? variante.values.map(v => v.es || v).join(' / ')
          : null;
        const descripcion = nombreVariante
          ? `${nombreProducto} — ${nombreVariante}`
          : nombreProducto;

        const grupoKey = fgp.email + '|' + marca;
        if (!alertasPorGrupo[grupoKey]) {
          alertasPorGrupo[grupoKey] = { fgp: fgp, marca: marca, items: [] };
        }
        alertasPorGrupo[grupoKey].items.push({
          clave:       clave,
          descripcion: descripcion,
          stock:       stock,
          precio:      variante.price || null
        });
        nuevasAlertas[clave] = new Date().toISOString();
      }
    });
  });

  // Enviar UN email por FGP + proveedor
  Object.values(alertasPorGrupo).forEach(function(grupo) {
    const fgp   = grupo.fgp;
    const marca = grupo.marca;
    const items = grupo.items;
    const urls  = generarUrls(items, marca, fgp);

    enviarEmail(fgp, marca, items, urls);
    Logger.log('Email enviado a ' + fgp.nombre + ' (' + fgp.email + ') | Proveedor: ' + marca + ' | ' + items.length + ' producto(s)');
  });

  delete alertasEnviadas['__reset__'];
  delete nuevasAlertas['__reset__'];
  const toGuardar = Object.assign(alertasEnviadas, nuevasAlertas);
  PropertiesService.getScriptProperties()
    .setProperty('ALERTAS_ENVIADAS', JSON.stringify(toGuardar));
}

// ── ENVÍO DE EMAIL ─────────────────────────────────────────
function enviarEmail(fgp, marca, items, urls) {
  const destinatario = CONFIG_STOCK.TEST_MODE ? CONFIG_STOCK.TEST_EMAIL : fgp.email;

  // CC al admin, evitando duplicado si el FGP ya es el admin
  const cc = (destinatario !== CONFIG_STOCK.ADMIN_EMAIL && !CONFIG_STOCK.TEST_MODE)
    ? CONFIG_STOCK.ADMIN_EMAIL
    : '';

  const intro = items.length === 1
    ? `El siguiente producto de <strong>${marca}</strong> tiene stock bajo:`
    : `Los siguientes productos de <strong>${marca}</strong> tienen stock bajo:`;

  const listaHtml = items.map(function(item) {
    return `<li><strong>${item.descripcion}</strong> — ${item.stock} unidades restantes</li>`;
  }).join('');

  const asunto = `🌼 Diente de León — Stock bajo: ${marca}`;

  const cuerpoHtml = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
      <div style="background:#3a7d44;padding:20px 24px;border-radius:10px 10px 0 0;text-align:center">
        <img src="https://escuela-dandelion.github.io/Comision-Recursos/Logo_Diente_de_Leon.png" alt="Diente de León" style="height:64px;margin-bottom:12px;display:block;margin-left:auto;margin-right:auto">
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

// ── TRIGGER ────────────────────────────────────────────────
function crearTrigger() {
  ScriptApp.newTrigger('checkStockBajo')
    .timeBased().everyHours(6).create();
  Logger.log('Trigger creado: cada 6 horas.');
}
