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
  'LA YAYA':                  { nombre: 'Monica Chesta',     email: 'monicachesta@gmail.com',     nombre2: 'Maria Martini',   email2: 'martinimaria39@gmail.com',  tel_proveedor: '5493516169370', contacto: 'Mariela' },
  'ODDIS':                    { nombre: 'Pía Lucarno',       email: 'pialucarno@gmail.com',       nombre2: 'Maria Martini',   email2: 'martinimaria39@gmail.com',  tel_proveedor: '' },
  'CABALLO NEGRO':            { nombre: 'Lucas Di Stefano',  email: 'lmdestefano@gmail.com',      nombre2: 'Maria Martini',   email2: 'martinimaria39@gmail.com',  tel_proveedor: '5493758446041', contacto: 'Susana', logistica: 'correo', retira: 'Dario Votta', tel_retira: '5493512414523', punto_retiro: 'Agencia Córdoba', tel_punto_retiro: '5493518738959', dir_punto_retiro: 'Av. Juan B Justo 3577, X5001GYA Córdoba', horario_punto_retiro: '9:00-12:30 y 14:00-17:30' },
  'YEMARI':                   { nombre: 'Lucas Di Stefano',  email: 'lmdestefano@gmail.com',      nombre2: 'Maria Martini',   email2: 'martinimaria39@gmail.com',  tel_proveedor: '5493415422181', contacto: 'Carlos', logistica: 'envio_domicilio', flete: 'efectivo_al_recibir' },
  'GROEN':                    { nombre: 'Monica Chesta',     email: 'monicachesta@gmail.com',     nombre2: 'Maria Martini',   email2: 'martinimaria39@gmail.com',  tel_proveedor: '', logistica: 'envio_domicilio', pedido: 'web', url: 'https://tiendagroen.com.ar/', flete: 'gratis', descuento: '5pct_transferencia' },
  // PARAISA excluida — productos con stock infinito (null), no requieren alerta — contacto: Julia Denna +54 9 3515 31-7919
  'EL MAITEN':                { nombre: 'Pía Lucarno',       email: 'pialucarno@gmail.com',       nombre2: 'Maria Martini',   email2: 'martinimaria39@gmail.com',  tel_proveedor: '5493515067561', contacto: 'Franco' },
  'GUARDIANES DE LA COLMENA': { nombre: 'Monica Chesta',     email: 'monicachesta@gmail.com',     nombre2: 'Maria Martini',   email2: 'martinimaria39@gmail.com',  tel_proveedor: '5493513351025', contacto: 'Alejandro Sanchez', logistica: 'envio_domicilio', flete: 'sin_costo' }
};

// ── CONFIG POR MARCA — pestaña ConfigAlertas (col A: Marca, col B: Lead time días) ──
function leerConfigAlertas() {
  const defaults = {
    'CABALLO NEGRO':            { leadTime: 10, stockMinimo: 10 },
    'YEMARI':                   { leadTime: 10, stockMinimo: 10 },
    'LA YAYA':                  { leadTime: 10, stockMinimo: 10 },
    'ODDIS':                    { leadTime: 10, stockMinimo: 10 },
    'GROEN':                    { leadTime: 10, stockMinimo:  5 },
    'EL MAITEN':                { leadTime: 10, stockMinimo: 10 },
    'GUARDIANES DE LA COLMENA': { leadTime: 10, stockMinimo: 10 }
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
      config[marca] = {
        leadTime:    parseInt(data[i][1]) || 10,
        stockMinimo: data[i][2] !== '' && data[i][2] !== undefined ? (parseInt(data[i][2]) || CONFIG_STOCK.STOCK_MINIMO) : CONFIG_STOCK.STOCK_MINIMO
      };
    }
    return Object.keys(config).length > 0 ? config : defaults;
  } catch(e) {
    Logger.log('Error leyendo ConfigAlertas: ' + e);
    return defaults;
  }
}

// ── VELOCIDADES — promedio de los últimos 3 meses completos no excluidos (o 2 o 1 si no hay más) ──
function calcularVelocidades() {
  const velocidades = {};
  var diasActivos = 30;
  try {
    const ss    = SpreadsheetApp.openById(CONFIG_STOCK.VENTAS_SHEET_ID);
    const sheet = ss.getSheetByName('Ventas');
    if (!sheet) return { velocidades: velocidades, diasActivos: diasActivos };
    const data  = sheet.getDataRange().getValues();
    const hoy   = new Date();

    // Recolectar qué mes/año tienen datos en el Sheet (excluyendo el mes actual y los meses excluidos)
    const mesesConDatos = {};
    for (var i = 1; i < data.length; i++) {
      const fecha = data[i][0] ? new Date(data[i][0]) : null;
      if (!fecha) continue;
      const mes = fecha.getMonth(), anio = fecha.getFullYear();
      if (mes === hoy.getMonth() && anio === hoy.getFullYear()) continue; // mes actual incompleto
      if (MESES_EXCLUIDOS.indexOf(mes) !== -1) continue;
      mesesConDatos[anio * 12 + mes] = { mes: mes, anio: anio };
    }

    // Tomar los últimos 3 meses disponibles (orden descendente)
    const mesesParaUsar = Object.values(mesesConDatos)
      .sort(function(a, b) { return (b.anio * 12 + b.mes) - (a.anio * 12 + a.mes); })
      .slice(0, 3);

    if (mesesParaUsar.length === 0) {
      return { velocidades: velocidades, diasActivos: diasActivos };
    }

    // Acumular ventas de esos meses
    for (var j = 1; j < data.length; j++) {
      const fecha = data[j][0] ? new Date(data[j][0]) : null;
      if (!fecha) continue;
      const mes = fecha.getMonth(), anio = fecha.getFullYear();
      var enVentana = false;
      for (var k = 0; k < mesesParaUsar.length; k++) {
        if (mesesParaUsar[k].mes === mes && mesesParaUsar[k].anio === anio) { enVentana = true; break; }
      }
      if (!enVentana) continue;
      const nombre   = String(data[j][5] || '').trim();
      const cantidad = parseInt(data[j][7]) || 0;
      if (!nombre || cantidad <= 0) continue;
      velocidades[nombre] = (velocidades[nombre] || 0) + cantidad;
    }

    // Convertir a promedio mensual: dividir el total por la cantidad de meses
    const nMeses = mesesParaUsar.length;
    Object.keys(velocidades).forEach(function(nombre) {
      velocidades[nombre] = Math.round(velocidades[nombre] / nMeses);
    });
    // diasActivos = 30 → la fórmula (vel_mensual / 30) × leadTime × safety da el umbral correcto
    diasActivos = 30;

    Logger.log('Velocidades calculadas (promedio ' + nMeses + ' mes/es: ' +
      mesesParaUsar.map(function(m) { return (m.mes + 1) + '/' + m.anio; }).join(', ') +
      '): ' + JSON.stringify(velocidades));
  } catch(e) {
    Logger.log('Error calculando velocidades: ' + e);
  }
  return { velocidades: velocidades, diasActivos: diasActivos };
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
  try {
    _checkStockBajoInterno();
  } catch(e) {
    Logger.log('ERROR CRÍTICO en checkStockBajo: ' + e.message + '\n' + e.stack);
    try {
      MailApp.sendEmail({
        to: 'robertson.ine@gmail.com',
        subject: '⚠️ Tienda DL: Error en alerta de stock',
        body: 'El script de alertas de stock falló con el siguiente error:\n\n' +
              e.message + '\n\n' + e.stack + '\n\n' +
              '---\nRevisá el editor de GAS para más detalles.'
      });
    } catch(_) {}
  }
}

function _checkStockBajoInterno() {
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
      const stockMinimo = cfg.stockMinimo !== undefined ? cfg.stockMinimo : CONFIG_STOCK.STOCK_MINIMO;
      Logger.log(
        '[CHECK] ' + descripcion +
        ' | stock=' + stock +
        ' | vel60d=' + velocidad +
        ' | umbral=' + umbral +
        ' | piso=' + stockMinimo +
        ' | yaAlertado=' + yaAlertado +
        ' | clave=' + clave
      );
      // ── FIN DEBUG ──────────────────────────────────────────

      // Reset alerta regular si el stock se repuso por encima de umbral Y piso
      if (stock > umbral && stock >= stockMinimo && alertasEnviadas[clave]) {
        delete alertasEnviadas[clave];
        nuevasAlertas['__reset__'] = true;
        Logger.log('  [RESET] ' + descripcion + ' (' + stock + ' > umbral=' + umbral + ' y >= piso=' + stockMinimo + ')');
      }
      // Condición A (cualquier día): stock bajo (umbral dinámico O piso absoluto) y no alertado aún
      const condA = (stock <= umbral || stock < stockMinimo) && !alertasEnviadas[clave];
      // Condición B (3er lunes): ¿hay suficiente para abastecer el mes siguiente?
      const umbralMensual = esLunes3 ? calcularUmbralMensual(nombreProd, velocidades, diasActivos, nombreVar) : null;
      const condB = esLunes3 && umbralMensual !== null && stock < umbralMensual && !alertasEnviadas[claveLunes];

      if (!condA && !condB) {
        if (stock > umbral && stock >= stockMinimo) {
          Logger.log('  [OK] stock suficiente (' + stock + ' > ' + umbral + ', piso=' + stockMinimo + ')');
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
  const ccEmails = [];
  if (!CONFIG_STOCK.TEST_MODE) {
    if (fgp.email2 && fgp.email2 !== fgp.email) ccEmails.push(fgp.email2);
    if (CONFIG_STOCK.ADMIN_EMAIL !== fgp.email && CONFIG_STOCK.ADMIN_EMAIL !== fgp.email2) ccEmails.push(CONFIG_STOCK.ADMIN_EMAIL);
  }
  const cc = ccEmails.join(',');

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

  // Evitar duplicado: si ya hay una orden activa para esta marca, reutilizarla
  const ACTIVOS = ['Solicitado', 'Confirmado', 'En Camino'];
  const data = pedidos.getDataRange().getValues();
  Logger.log('[DUPL] Buscando orden activa para marca="' + marca + '" entre ' + (data.length - 1) + ' filas');
  for (var i = 1; i < data.length; i++) {
    const fila = data[i];
    const filaMarca  = String(fila[2]).toUpperCase().trim();
    const filaEstado = String(fila[5]).trim();
    Logger.log('[DUPL] fila ' + i + ': norden=' + fila[0] + ' marca="' + filaMarca + '" estado="' + filaEstado + '"');
    if (filaMarca === marca.toUpperCase().trim() && ACTIVOS.indexOf(filaEstado) !== -1) {
      const nordenExistente = String(fila[0]);
      Logger.log('[DUPL] Orden activa encontrada: ' + nordenExistente + ' — no se crea duplicado');
      return nordenExistente;
    }
  }

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
  var url = 'https://api.tiendanube.com/v1/' + CONFIG_STOCK.STORE_ID + '/products?per_page=200';
  var opts = {
    method: 'GET',
    headers: {
      'Authentication': 'bearer ' + CONFIG_STOCK.API_TOKEN,
      'User-Agent': 'DienteDeLeon (dientedeleon-admin@googlegroups.com)'
    },
    muteHttpExceptions: true
  };
  var lastError;
  for (var i = 0; i < 3; i++) {
    try {
      if (i > 0) Utilities.sleep(3000);
      var response = UrlFetchApp.fetch(url, opts);
      if (response.getResponseCode() === 200) {
        return JSON.parse(response.getContentText());
      }
      lastError = 'HTTP ' + response.getResponseCode() + ': ' + response.getContentText().substring(0, 200);
    } catch(e) {
      lastError = e.message;
    }
  }
  throw new Error('TiendaNube API no disponible tras 3 intentos: ' + lastError);
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

// ── EMAIL DE PRUEBA (training — no toca TiendaNube) ────────
function enviarEmailDePrueba() {
  const fgp = {
    nombre:        'Maria Martini',
    email:         CONFIG_STOCK.TEST_EMAIL,
    tel_proveedor: ''
  };
  const marca = 'EL MAITEN';
  const items = [
    {
      descripcion:   'Granola El Maiten 1 Kg',
      stock:         3,
      precio:        null,
      umbral:        10,
      umbralMensual: 15,
      cantSugerida:  12
    },
    {
      descripcion:   'Granola El Maiten 500 g',
      stock:         5,
      precio:        null,
      umbral:        10,
      umbralMensual: 12,
      cantSugerida:  7
    }
  ];

  // generarUrls registra una orden real en el Sheet → el link del email funciona
  const urls = generarUrls(items, marca, fgp);

  const destinatariosPrueba = [
    CONFIG_STOCK.TEST_EMAIL,
    'monicachesta@gmail.com',
    'pialucarno@gmail.com',
    'lmdestefano@gmail.com'
  ].join(',');

  const emailAnterior = CONFIG_STOCK.TEST_EMAIL;
  const modoAnterior  = CONFIG_STOCK.TEST_MODE;
  CONFIG_STOCK.TEST_EMAIL = destinatariosPrueba;
  CONFIG_STOCK.TEST_MODE  = true;
  try {
    enviarAlertaStock(fgp, marca, items, urls);
  } finally {
    CONFIG_STOCK.TEST_EMAIL = emailAnterior;
    CONFIG_STOCK.TEST_MODE  = modoAnterior;
  }
  Logger.log('✅ Email de prueba enviado a: ' + destinatariosPrueba);
}

// ── TRIGGER ────────────────────────────────────────────────
function crearTrigger() {
  ScriptApp.newTrigger('checkStockBajo')
    .timeBased().everyHours(6).create();
  Logger.log('Trigger creado: cada 6 horas.');
}
