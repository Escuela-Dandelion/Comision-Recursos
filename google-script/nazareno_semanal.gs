// ============================================================
// RESUMEN SEMANAL — Alfajores Nazareno
// Corre cada jueves y envía a Franco Alini la lista de pedidos
// de la semana para que gestione el pedido a Nazareno.
// Setup: correr activarResumenNazareno() UNA VEZ desde el editor.
// ============================================================

var NAZARENO_EMAIL       = 'francoalini@gmail.com';
var NAZARENO_MARCA       = 'NAZARENO';  // nombre de marca en TiendaNube / col 12 de Ventas
var NAZARENO_CC          = 'robertson.ine@gmail.com';

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
  var porProducto = {};  // { producto: { cant, familias: [{nombre, cant, pedido}] } }
  var pedidosSet  = {};

  for (var r = 1; r < data.length; r++) {
    var row   = data[r];
    var fecha = row[0] ? new Date(row[0]) : null;
    if (!fecha || fecha < hace7) continue;

    var marca = String(row[12] || '').toUpperCase().trim();
    if (marca !== NAZARENO_MARCA) continue;

    var pedido   = String(row[1] || '');
    var familia  = String(row[3] || 'Sin nombre');
    var producto = String(row[5] || '');
    var cantidad = parseInt(row[7]) || 1;
    var precioU  = parseFloat(row[8]) || 0;

    if (!porProducto[producto]) porProducto[producto] = { cant: 0, precioU: precioU, familias: [] };
    porProducto[producto].cant += cantidad;
    porProducto[producto].familias.push({ nombre: familia, cant: cantidad, pedido: pedido });
    pedidosSet[pedido] = true;
  }

  var productos = Object.keys(porProducto);
  if (productos.length === 0) {
    Logger.log('Sin pedidos Nazareno en los últimos 7 días — no se envía mail.');
    return;
  }

  var fechaStr = Utilities.formatDate(hoy, 'America/Argentina/Cordoba', 'dd/MM/yyyy');
  var totalFamilias = Object.keys(pedidosSet).length;

  // ── Armar cuerpo del mail ────────────────────────────────
  var resumenProductos = '';
  productos.forEach(function(prod) {
    var p = porProducto[prod];
    resumenProductos += '  • ' + prod + ' → ' + p.cant + ' u.\n';
  });

  var detalleFamilias = '';
  productos.forEach(function(prod) {
    var p = porProducto[prod];
    detalleFamilias += '\n' + prod + ':\n';
    p.familias.forEach(function(f) {
      detalleFamilias += '  - ' + f.nombre + ': ' + f.cant + ' u. (Pedido ' + f.pedido + ')\n';
    });
  });

  var body =
    'Hola Franco,\n\n' +
    'Acá va el resumen de pedidos de Alfajores Nazareno de esta semana (' + fechaStr + ').\n' +
    'Son ' + totalFamilias + ' familias en total.\n\n' +
    '────────────────────────────\n' +
    'RESUMEN POR PRODUCTO\n' +
    '────────────────────────────\n' +
    resumenProductos + '\n' +
    '────────────────────────────\n' +
    'DETALLE POR FAMILIA\n' +
    '────────────────────────────\n' +
    detalleFamilias + '\n' +
    '────────────────────────────\n\n' +
    'Con esta info podés gestionar el pedido a Nazareno para la semana.\n' +
    'Recordá que los alfajores tienen vencimiento de 10 días — se pide solo lo necesario.\n\n' +
    'Dashboard referentes: https://escuela-dandelion.github.io/Comision-Recursos/dashboard-referentes.html\n\n' +
    '---\nEnvío automático — Tienda Diente de León';

  MailApp.sendEmail({
    to:      NAZARENO_EMAIL,
    cc:      NAZARENO_CC,
    subject: '📦 Pedido Alfajores Nazareno — ' + fechaStr,
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

// ── Test: probar manualmente sin esperar el jueves ───────────
function testResumenNazareno() {
  enviarResumenNazareno();
}
