// v2026-11-04 — secrets movidos a PropertiesService; APPS_URL dinámico

// ─── Configuración ────────────────────────────────────────────────────────────

var MAIL_CONFIG = {
  MES:        '2026-10',                   // ← actualizar cada mes antes de correr
  TEST_MODE:  true,                         // ← cambiar a false para envío real
  TEST_EMAIL: 'robertson.ine@gmail.com',
  LOGO_URL:   'https://escuela-dandelion.github.io/Comision-Recursos/Logo_Diente_de_Leon.png',
  COMP_BASE:  'https://escuela-dandelion.github.io/Comision-Recursos/comprobantes/',
  FROM_EMAIL: 'tiendavirtual.dientedeleon@gmail.com',
  FROM_NAME:  'Tienda Diente de León',
};

var REFERENTES_MAIL = {
  'J':  { nombre: 'Lourdes',    email: 'lourdelcastillo@gmail.com',        cc: 'longhi.yuliana@gmail.com,martinimaria39@gmail.com',               grado: 'Jardín', archivo: 'jardin' },
  '1':  { nombre: 'Mariana',    email: 'bmary84@gmail.com',                cc: '',                                                                 grado: '1ro',    archivo: '1ro'    },
  '2':  { nombre: 'Paola',      email: 'pao_belen@hotmail.com',            cc: 'dolo.dominguez@dandelion.edu.ar',                                  grado: '2do',    archivo: '2do'    },
  '3':  { nombre: 'Alejandro',  email: 'ahouspan@gmail.com',               cc: 'elinapipino8@gmail.com',                                           grado: '3ro',    archivo: '3ro'    },
  '4':  { nombre: 'Pablo',      email: 'contrerasmaximiliano@live.com.ar', cc: 'robertson.ine@gmail.com',                                          grado: '4to',    archivo: '4to'    },
  '5':  { nombre: 'Marianela',  email: 'marianelasegalla@hotmail.com.ar',  cc: 'dominguezgabydl@gmail.com,yaninafuentes33@gmail.com',              grado: '5to',    archivo: '5to'    },
  '6':  { nombre: 'Virginia',   email: 'vbattelli@gmail.com',              cc: 'delfinasalvettilarrea@gmail.com',                                  grado: '6to',    archivo: '6to'    },
  '7':  { nombre: 'Magui',      email: 'maguidebat@gmail.com',             cc: 'karytramitesescolares@gmail.com',                                  grado: '7mo',    archivo: '7mo'    },
  '8':  { nombre: 'Juan',       email: 'jdiaz.elencuentro@gmail.com',      cc: '',                                                                 grado: '8vo',    archivo: '8vo'    },
  '9':  { nombre: 'Cecilia',    email: 'cecimogni3007@gmail.com',          cc: 'ariasgibertsabina@gmail.com',                                      grado: '9no',    archivo: '9no'    },
  '10': { nombre: 'Delfina',    email: 'delfinamariasalvetti@gmail.com',   cc: 'delfinasalvettilarrea@gmail.com',                                  grado: '10mo',   archivo: '10mo'   },
  '11': { nombre: 'Pía',        email: 'pialucarno@gmail.com',             cc: '',                                                                 grado: '11mo',   archivo: '11mo'   },
  // '12' sin referente — no se envía
};

// ─── Test: un solo mail a robertson.ine ──────────────────────────────────────
// Correr esto primero para verificar el diseño antes del envío real

function testMailAportes() {
  var logoBlob = UrlFetchApp.fetch(MAIL_CONFIG.LOGO_URL).getBlob();
  logoBlob.setName('logo.png');
  var mesTexto       = _formatearMes(MAIL_CONFIG.MES);
  var comprobanteUrl = MAIL_CONFIG.COMP_BASE + MAIL_CONFIG.MES + '/4to.pdf';

  GmailApp.sendEmail(MAIL_CONFIG.TEST_EMAIL,
    'TEST — Tienda Diente de León — Aportes ' + mesTexto + ' — 4to',
    '', {
      htmlBody:     _buildHtml('Pablo', '4to', mesTexto, '$9.825', comprobanteUrl),
      inlineImages: { logo: logoBlob },
      cc:           MAIL_CONFIG.TEST_EMAIL,
      from:         MAIL_CONFIG.FROM_EMAIL,
      name:         MAIL_CONFIG.FROM_NAME
    }
  );
  Logger.log('Test enviado a ' + MAIL_CONFIG.TEST_EMAIL);
}

// ─── Función principal ────────────────────────────────────────────────────────
// Con TEST_MODE = true: todos los mails van a TEST_EMAIL (para revisar antes de enviar)
// Con TEST_MODE = false: cada mail va al referente real

function enviarMailsAportes() {
  var mes      = MAIL_CONFIG.MES;
  var testMode = MAIL_CONFIG.TEST_MODE;

  // 1. Leer aportes de la API (URL del mismo proyecto GAS)
  var appsUrl = ScriptApp.getService().getUrl();
  var resp = UrlFetchApp.fetch(appsUrl + '?action=api_aportes');
  var rows = JSON.parse(resp.getContentText()).rows || [];

  // 2. Agrupar totales por grado para el mes
  var totales = {};
  rows.forEach(function(row) {
    if (row.mes !== mes) return;
    var g = String(row.grado);
    totales[g] = (totales[g] || 0) + (parseFloat(row.aporte_grado) || 0);
  });

  // 3. Descargar logo una sola vez (se embebe en todos los mails via inlineImages)
  var logoBlob = UrlFetchApp.fetch(MAIL_CONFIG.LOGO_URL).getBlob();
  logoBlob.setName('logo.png');

  var mesTexto = _formatearMes(mes);
  var enviados = [];
  var omitidos = [];

  // 4. Enviar un mail por referente (orden explícito: Jardín primero)
  var ORDEN_ENVIO = ['J','1','2','3','4','5','6','7','8','9','10','11'];
  ORDEN_ENVIO.forEach(function(key) {
    var ref   = REFERENTES_MAIL[key];
    var monto = Math.round(totales[key] || 0);

    if (monto === 0) {
      omitidos.push(ref.grado + ' — sin aportes');
      return;
    }

    var dest           = testMode ? MAIL_CONFIG.TEST_EMAIL : ref.email;
    var comprobanteUrl = MAIL_CONFIG.COMP_BASE + mes + '/' + ref.archivo + '.pdf';
    var montoFmt       = _fmt(monto);

    var opts = {
      htmlBody:     _buildHtml(ref.nombre, ref.grado, mesTexto, montoFmt, comprobanteUrl),
      inlineImages: { logo: logoBlob },
      from:         MAIL_CONFIG.FROM_EMAIL,
      name:         MAIL_CONFIG.FROM_NAME
    };
    if (!testMode && ref.cc) opts.cc = ref.cc;

    GmailApp.sendEmail(dest,
      'Tienda Diente de León — Aportes ' + mesTexto + ' — ' + ref.grado,
      '', opts
    );

    enviados.push(ref.grado + ' → ' + (testMode ? 'TEST' : ref.email) + ' (' + montoFmt + ')');
    Utilities.sleep(500); // evitar rate limit de Gmail
  });

  Logger.log('=== ENVIADOS (' + enviados.length + ') ===');
  enviados.forEach(function(s) { Logger.log(s); });
  if (omitidos.length) {
    Logger.log('=== OMITIDOS (' + omitidos.length + ') ===');
    omitidos.forEach(function(s) { Logger.log(s); });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _formatearMes(mes) {
  var MESES = ['enero','febrero','marzo','abril','mayo','junio',
               'julio','agosto','septiembre','octubre','noviembre','diciembre'];
  var p = mes.split('-');
  return MESES[parseInt(p[1]) - 1] + ' ' + p[0];
}

function _fmt(n) {
  return '$' + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function _buildHtml(nombre, grado, mes, monto, comprobanteUrl) {
  return '<div style="font-family:-apple-system,\'Segoe UI\',sans-serif;max-width:560px;margin:auto;padding:24px;color:#1a1a2e">' +

  // Logo
  '<div style="text-align:center;padding:0 0 20px 0">' +
  '<img src="cid:logo" style="max-width:200px;width:55%" alt="Diente de León">' +
  '</div>' +

  // Encabezado
  '<h2 style="color:#3a7d44;margin:0 0 4px 0;font-size:20px">Aportes · ' + mes + '</h2>' +
  '<p style="color:#555;margin:0 0 20px 0;font-size:14px;line-height:1.6">Hola ' + nombre + ', acá te compartimos el resumen de lo recaudado para <strong>' + grado + '</strong> durante ' + mes + ' a través de la Tienda Diente de León.</p>' +

  // Card monto
  '<div style="background:#f0f7e8;border:1px solid #c8e6c9;border-radius:10px;padding:24px;text-align:center;margin:0 0 20px 0">' +
  '<p style="margin:0 0 6px 0;font-size:12px;color:#6a8a4a;text-transform:uppercase;letter-spacing:1px">Total recaudado · ' + grado + '</p>' +
  '<p style="margin:0;font-size:40px;font-weight:700;color:#1a5c2a">' + monto + '</p>' +
  '</div>' +

  // Texto + botón
  '<p style="font-size:14px;color:#555;margin:0 0 16px 0;line-height:1.6">Podés ver el comprobante de transferencia en el siguiente link:</p>' +
  '<div style="text-align:center;margin:0 0 24px 0">' +
  '<a href="' + comprobanteUrl + '" style="display:inline-block;padding:12px 28px;background:#3a7d44;color:#fff;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Ver comprobante</a>' +
  '</div>' +

  '<p style="font-size:14px;color:#555;line-height:1.6">Gracias por ser parte de este proyecto. ' +
  'Y si querés, podés ver los aportes en otros grados <a href="https://escuela-dandelion.github.io/Comision-Recursos/informe-aportes.html" style="color:#3a7d44">acá</a>.</p>' +

  // Footer
  '<p style="font-size:11px;color:#aaa;margin-top:24px;padding-top:14px;border-top:1px solid #eee;text-align:center">Tienda Diente de León · Escuela Dandelion Pedagogía Waldorf · Córdoba</p>' +

  '</div>';
}
