// ============================================================
// MONITOR DE SISTEMA — Diente de León
// Proyecto GAS SEPARADO — pegar en un proyecto nuevo
// Verifica que el QR/Dashboard esté funcionando cada hora
// y manda email si detecta un problema.
// ============================================================

var WEBAPP_URL   = 'https://script.google.com/macros/s/AKfycbwt8mRYjjFZtsmFPw0JYcMpCkZcOt9J7ALFVkPByqQ8NM2NvCaYF1onagU_ag0a2ziksg/exec';
var ALERT_EMAIL  = 'robertson.ine@gmail.com';
var COOLDOWN_HS  = 4; // horas mínimas entre alertas (evita spam)

// ── Verificación principal (corre cada 1 hora por trigger) ──
function checkSistema() {
  var ok = false;
  var detalle = '';

  try {
    var resp = UrlFetchApp.fetch(WEBAPP_URL + '?action=version', {
      muteHttpExceptions: true,
      followRedirects: true
    });
    var code = resp.getResponseCode();
    var body = resp.getContentText().trim();

    if (code === 200 && body === 'Version_1.5') {
      ok = true;
    } else {
      detalle = 'Código HTTP: ' + code + '\nRespuesta recibida: ' + body.substring(0, 300);
    }
  } catch(e) {
    detalle = 'Error de red al verificar: ' + e.message;
  }

  var props = PropertiesService.getScriptProperties();

  if (!ok) {
    var ultimaAlarma = props.getProperty('ultima_alarma');
    var ahora = new Date().getTime();
    var cooldownMs = COOLDOWN_HS * 60 * 60 * 1000;

    if (!ultimaAlarma || (ahora - parseInt(ultimaAlarma)) >= cooldownMs) {
      props.setProperty('ultima_alarma', String(ahora));
      MailApp.sendEmail({
        to: ALERT_EMAIL,
        subject: '⚠️ Tienda DL: Sistema QR / Dashboard caído',
        body: 'El sistema no está respondiendo correctamente.\n\n' +
              detalle + '\n\n' +
              '→ Revisá el editor de GAS del proyecto Retiro QR.\n' +
              '→ Corré la función testVerificar() desde el editor para ver el error exacto.\n\n' +
              '---\nMonitor automático — ' + new Date().toLocaleString('es-AR')
      });
      Logger.log('⚠️ Alarma enviada: ' + detalle);
    } else {
      Logger.log('Sistema caído pero alarma ya enviada hace menos de ' + COOLDOWN_HS + ' horas — suprimida.');
    }
  } else {
    // Sistema OK — resetear cooldown para que la próxima caída avise de nuevo
    props.deleteProperty('ultima_alarma');
    Logger.log('✅ Sistema OK: ' + new Date().toLocaleString('es-AR'));
  }
}

// ── Setup: correr UNA VEZ para activar el monitor ──────────
function activarMonitor() {
  // Borra triggers anteriores para no duplicar
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkSistema').timeBased().everyHours(1).create();
  Logger.log('Monitor activado: verificación cada 1 hora.');
}
