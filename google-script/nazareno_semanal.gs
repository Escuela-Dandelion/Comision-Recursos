// ============================================================
// RESUMEN SEMANAL — Productos Stock Infinito (a pedido)
// Incluye: Alfajores Nazareno, Pizzas, Paraisa, y todo producto
// sin stock acumulado que se gestiona semana a semana.
// Corre cada jueves y envía a Franco Alini el resumen de pedidos.
// Setup: correr activarResumenNazareno() UNA VEZ desde el editor.
// ============================================================

var NAZARENO_EMAIL       = 'francoalini@gmail.com';
var NAZARENO_MARCA       = 'Productos_Stock_Infinito';  // tag de marca en TiendaNube / col 12 de Ventas
var NAZARENO_CC          = 'robertson.ine@gmail.com';

// Mapeo de palabras clave en el nombre del producto → nombre del proveedor
// Agregar una entrada por cada proveedor de stock infinito nuevo
var PROVEEDOR_KEYWORDS = [
  { keyword: 'nazareno',       proveedor: 'Nazareno'         },
  { keyword: 'pajarito',       proveedor: 'Pajarito Amarillo' },
  { keyword: 'paraisa',        proveedor: 'Paraisa'           }
];

function detectarProveedor(nombreProducto) {
  var lp = nombreProducto.toLowerCase();
  for (var i = 0; i < PROVEEDOR_KEYWORDS.length; i++) {
    if (lp.indexOf(PROVEEDOR_KEYWORDS[i].keyword) !== -1) return PROVEEDOR_KEYWORDS[i].proveedor;
  }
  return 'Otros';
}

// ── Función principal (corre cada jueves por trigger) ────────
function enviarResumenNazareno() {
  var ss    = SpreadsheetApp.openById(CONFIG.VENTAS_SHEET_ID);
  var sheet = ss.getSheetByName('Ventas');
  if (!sheet) { Logger.log('Hoja Ventas no encontrada'); return; }

  var data  = sheet.getDataRange().getValues();
  if (data.length <= 1) { Logger.log('Sin datos en Ventas'); return; }

  // Tomar los últimos 7 días
  var hoy     = new Date();
  var hace7   = new Date(hoy.getTime() - 7 * 864e5);

  // Columnas: 0=Fecha, 1=Pedido#, 3=Nombre, 4=Email, 5=Producto, 6=SKU, 7=Cantidad, 8=PrecioU, 12=Marca
  // { proveedor: { productos: { nombre: {cant, familias} }, pedidosSet } }
  var porProveedor = {};
  var pedidosSetTotal = {};

  for (var r = 1; r < data.length; r++) {
    var row   = data[r];
    var fecha = row[0] ? new Date(row[0]) : null;
    if (!fecha || fecha < hace7) continue;

    var marca = String(row[12] || '').trim();
    if (marca !== NAZARENO_MARCA) continue;

    var pedido   = String(row[1] || '');
    var familia  = String(row[3] || 'Sin nombre');
    var producto = String(row[5] || '');
    var cantidad = parseInt(row[7]) || 1;

    var prov = detectarProveedor(producto);
    if (!porProveedor[prov]) porProveedor[prov] = { productos: {}, pedidosSet: {} };
    if (!porProveedor[prov].productos[producto]) porProveedor[prov].productos[producto] = { cant: 0, familias: [] };
    porProveedor[prov].productos[producto].cant += cantidad;
    porProveedor[prov].productos[producto].familias.push({ nombre: familia, cant: cantidad, pedido: pedido });
    porProveedor[prov].pedidosSet[pedido] = true;
    pedidosSetTotal[pedido] = true;
  }

  var proveedores = Object.keys(porProveedor);
  if (proveedores.length === 0) {
    Logger.log('Sin pedidos de stock infinito en los últimos 7 días — no se envía mail.');
    return;
  }

  var fechaStr      = Utilities.formatDate(hoy, 'America/Argentina/Cordoba', 'dd/MM/yyyy');
  var totalFamilias = Object.keys(pedidosSetTotal).length;
  var asuntoProvs   = proveedores.join(', ');

  // ── Armar cuerpo del mail ────────────────────────────────
  var cuerpo = '';
  proveedores.forEach(function(prov) {
    var datos    = porProveedor[prov];
    var products = Object.keys(datos.productos);
    var nFamilias = Object.keys(datos.pedidosSet).length;

    cuerpo += '════════════════════════════\n';
    cuerpo += prov.toUpperCase() + ' — ' + nFamilias + ' familia' + (nFamilias !== 1 ? 's' : '') + '\n';
    cuerpo += '════════════════════════════\n';

    products.forEach(function(prod) {
      var p = datos.productos[prod];
      cuerpo += '\n  ' + prod + ' → ' + p.cant + ' u. total\n';
      p.familias.forEach(function(f) {
        cuerpo += '    - ' + f.nombre + ': ' + f.cant + ' u. (Pedido ' + f.pedido + ')\n';
      });
    });
    cuerpo += '\n';
  });

  var body =
    'Hola Franco,\n\n' +
    'Resumen de pedidos a gestionar esta semana (' + fechaStr + ').\n' +
    'Total: ' + totalFamilias + ' familia' + (totalFamilias !== 1 ? 's' : '') + '.\n\n' +
    cuerpo +
    'Recordá que estos productos se hacen a pedido — no acumulan stock.\n\n' +
    'Dashboard referentes: https://escuela-dandelion.github.io/Comision-Recursos/dashboard-referentes.html\n\n' +
    '---\nEnvío automático — Tienda Diente de León';

  MailApp.sendEmail({
    to:      NAZARENO_EMAIL,
    cc:      NAZARENO_CC,
    subject: '📦 Pedidos ' + asuntoProvs + ' — ' + fechaStr,
    body:    body
  });

  Logger.log('Resumen Nazareno enviado a ' + NAZARENO_EMAIL + ' — ' + productos.length + ' productos, ' + totalFamilias + ' familias.');
}

// ── Setup: correr UNA VEZ para activar el trigger semanal ───
function activarResumenNazareno() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'enviarResumenNazareno') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarResumenNazareno')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.THURSDAY)
    .atHour(9)
    .create();
  Logger.log('Trigger activado: enviarResumenNazareno todos los jueves a las 9hs.');
}

// ── Test: envía el mail a Inés en lugar de Franco ────────────
function testResumenNazareno() {
  var emailOriginal = NAZARENO_EMAIL;
  NAZARENO_EMAIL = 'robertson.ine@gmail.com';
  enviarResumenNazareno();
  NAZARENO_EMAIL = emailOriginal;
}
