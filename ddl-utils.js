// Utilidades compartidas para páginas Diente de León
// Incluir antes de cualquier script que use estas funciones

var DDL_GAS_URL = 'https://script.google.com/macros/s/AKfycbz-SRI6_udFy4ktEoE4lABW8RbDNDZAQ8cfC6ZjGKonSI2BY6R_fQZMeVIAU5tEQlzGBQ/exec';

// Lee el email de la sesión activa de Google Sign-In desde localStorage
function ddlGetEmail() {
  try {
    var s = JSON.parse(localStorage.getItem('dl_admin_session') || 'null');
    return (s && s.email && Date.now() < s.expires) ? s.email : '';
  } catch(e) { return ''; }
}

// Carga los proveedores desde el GAS y llama a callback(data)
// Siempre incluye el email → el GAS filtra según el rol (FGP ve solo los suyos, admin ve todos)
function ddlFetchProveedores(callback) {
  var email = ddlGetEmail();
  fetch(DDL_GAS_URL + '?action=getProveedores' + (email ? '&email=' + encodeURIComponent(email) : ''), { redirect: 'follow' })
    .then(function(r) { return r.json(); })
    .then(function(data) { callback(data); })
    .catch(function(err) { console.error('[DdL] ddlFetchProveedores error:', err); callback({ ok: false }); });
}
