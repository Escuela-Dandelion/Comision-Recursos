// v2026-11-04 — migración única: setear marca y proveedor en productos TiendaNube
// Correr desde el editor de GAS (Proyecto 1 — retiro_qr)
// 1. Correr migrarProveedoresDryRun() para revisar sin modificar nada
// 2. Correr migrarProveedores() para aplicar los cambios

var MARCA_A_PROVEEDOR = {
  'YEMARI':                  'Yemari',
  'CABALLO NEGRO':           'Caballo Negro',
  'SOL DE PAPEL':            'Sol de Oro',
  'LA YAYA':                 'La Yaya',
  'GUARDIANES DE LA COLMENA':'Guardianes de la Colmena',
  'GUARDIANES COLMENA':      'Guardianes de la Colmena',
  'GROEN':                   'Groen',
  'EL MAITEN':               'El Maiten',
  'ODDIS':                   'Oddis',
  'PARAISA':                 'Paraisa',
  'MIX Y FRUTOS SECOS':      'BioSalud',
  'NAZARENO':                'Nazareno',
  'TIENDA LIMÓN':            'Tienda Limón',
  'ARISTEO':                 'Tienda Limón',
  'EL ARISTEO':              'Tienda Limón',
  'BENDITA LLUVIA':          'Tienda Limón',
  'CALANDRI':                'Tienda Limón',
  'PAJARITO AMARILLO':       'Pajarito Amarillo',
  'TALLER':                  'Carlos Villegas',
};

// Marcas que hay que renombrar en el campo brand de TiendaNube
var RENOMBRAR_MARCA = {
  'EL MAITEN':        'Granola',
  'PAJARITO AMARILLO':'Pizza',
};

// Para productos con brand = TIENDA LIMÓN, detectar la marca real desde el título
var MARCAS_TIENDA_LIMON = ['El Aristeo', 'Bendita Lluvia', 'Calandri'];

// Overrides manuales por ID de producto (casos que no se detectan automáticamente)
var ID_OVERRIDE = {
  '377140380': { marca: 'Calandri', proveedor: 'Tienda Limón' },
};

function migrarProveedoresDryRun() { _migrar(true);  }
function migrarProveedores()       { _migrar(false); }

function _migrar(dryRun) {
  var storeId  = CONFIG.STORE_ID;
  var apiToken = CONFIG.API_TOKEN;
  var headers  = {
    'Authentication': 'bearer ' + apiToken,
    'User-Agent':     'DienteDeLeon/1.0',
    'Content-Type':   'application/json'
  };

  // 1. Traer todos los productos (paginado)
  var allProducts = [];
  var page = 1;
  while (true) {
    var resp     = UrlFetchApp.fetch(
      'https://api.tiendanube.com/v1/' + storeId + '/products?per_page=200&page=' + page,
      { headers: headers, muteHttpExceptions: true }
    );
    var products = JSON.parse(resp.getContentText());
    if (!Array.isArray(products) || products.length === 0) break;
    allProducts = allProducts.concat(products);
    if (products.length < 200) break;
    page++;
    Utilities.sleep(500);
  }
  Logger.log('Total productos: ' + allProducts.length);

  var ok            = [];
  var sinProveedor  = [];
  var renombrados   = [];
  var sinMarcaTL    = [];  // Tienda Limón sin marca detectable en el título

  allProducts.forEach(function(p) {
    var brandRaw  = p.brand ? String(p.brand).trim() : '';
    var brandUp   = brandRaw.toUpperCase();
    var nombre    = p.name && p.name.es ? p.name.es : String(p.name || '');

    var override   = ID_OVERRIDE[String(p.id)];
    var proveedor  = override ? override.proveedor : MARCA_A_PROVEEDOR[brandUp];
    var nuevaMarca = override ? override.marca      : (RENOMBRAR_MARCA[brandUp] || null);

    // Para TIENDA LIMÓN: intentar detectar marca del título
    if (!override && brandUp === 'TIENDA LIMÓN') {
      for (var i = 0; i < MARCAS_TIENDA_LIMON.length; i++) {
        if (nombre.toLowerCase().indexOf(MARCAS_TIENDA_LIMON[i].toLowerCase()) !== -1) {
          nuevaMarca = MARCAS_TIENDA_LIMON[i];
          break;
        }
      }
      if (!nuevaMarca) sinMarcaTL.push({ id: p.id, nombre: nombre });
    }

    if (!proveedor) {
      sinProveedor.push({ id: p.id, nombre: nombre, brand: brandRaw });
      return;
    }

    if (nuevaMarca) renombrados.push({ id: p.id, nombre: nombre, de: brandRaw, a: nuevaMarca });

    if (!dryRun) {
      // Actualizar brand si cambió
      if (nuevaMarca) {
        UrlFetchApp.fetch('https://api.tiendanube.com/v1/' + storeId + '/products/' + p.id, {
          method:            'PUT',
          headers:           headers,
          payload:           JSON.stringify({ brand: nuevaMarca }),
          muteHttpExceptions: true
        });
        Utilities.sleep(300);
      }

      // Buscar metafield proveedor existente
      var mfResp = UrlFetchApp.fetch(
        'https://api.tiendanube.com/v1/' + storeId + '/products/' + p.id + '/metafields',
        { headers: headers, muteHttpExceptions: true }
      );
      var metafields = JSON.parse(mfResp.getContentText());
      var existing   = null;
      if (Array.isArray(metafields)) {
        for (var j = 0; j < metafields.length; j++) {
          if (metafields[j].namespace === 'custom' && metafields[j].key === 'proveedor') {
            existing = metafields[j]; break;
          }
        }
      }

      if (existing) {
        UrlFetchApp.fetch('https://api.tiendanube.com/v1/' + storeId + '/metafields/' + existing.id, {
          method:            'PUT',
          headers:           headers,
          payload:           JSON.stringify({ value: proveedor }),
          muteHttpExceptions: true
        });
      } else {
        UrlFetchApp.fetch('https://api.tiendanube.com/v1/' + storeId + '/products/' + p.id + '/metafields', {
          method:            'POST',
          headers:           headers,
          payload:           JSON.stringify({ namespace: 'custom', key: 'proveedor', value: proveedor, value_type: 'string' }),
          muteHttpExceptions: true
        });
      }
      Utilities.sleep(300);
    }

    ok.push({ id: p.id, nombre: nombre, brand: nuevaMarca || brandRaw, proveedor: proveedor });
  });

  // Log de resultados
  Logger.log('=== ' + (dryRun ? 'DRY RUN' : 'EJECUTADO') + ' ===');
  Logger.log('✅ Procesados: ' + ok.length);
  Logger.log('⚠️  Sin proveedor conocido: ' + sinProveedor.length);
  Logger.log('✏️  Marcas a renombrar: ' + renombrados.length);
  Logger.log('🔍 Tienda Limón sin marca detectable: ' + sinMarcaTL.length);

  if (sinProveedor.length) {
    Logger.log('\n--- SIN PROVEEDOR ---');
    sinProveedor.forEach(function(p){ Logger.log(p.id + ' | ' + p.nombre + ' | brand: ' + p.brand); });
  }
  if (renombrados.length) {
    Logger.log('\n--- MARCAS A RENOMBRAR ---');
    renombrados.forEach(function(p){ Logger.log(p.id + ' | ' + p.nombre + ' | ' + p.de + ' → ' + p.a); });
  }
  if (sinMarcaTL.length) {
    Logger.log('\n--- TIENDA LIMÓN SIN MARCA DETECTABLE (revisar a mano) ---');
    sinMarcaTL.forEach(function(p){ Logger.log(p.id + ' | ' + p.nombre); });
  }
}
