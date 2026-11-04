// Fuente de verdad del mapeo Marca (TiendaNube brand) → Proveedor
// Sincronizado con MARCA_A_PROVEEDOR en retiro_qr.gs
var MARCA_A_PROVEEDOR = {
  'TIENDA LIMÓN':             'Tienda Limón',
  'TIENDA LIMON':             'Tienda Limón',
  'EL MAITEN':                'El Maiten',
  'PAJARITO AMARILLO':        'Pajarito Amarillo',
  'SOL DE PAPEL':             'Sol de Oro',
  'GUARDIANES COLMENA':       'Guardianes de la Colmena',
  'MIX Y FRUTOS SECOS':       'BioSalud',
  'TALLER':                   'Carlos Villegas',
  'YEMARI':                   'Yemari',
  'CABALLO NEGRO':            'Caballo Negro',
  'LA YAYA':                  'La Yaya',
  'GUARDIANES DE LA COLMENA': 'Guardianes de la Colmena',
  'GROEN':                    'Groen',
  'ODDIS':                    'Oddis',
  'PARAISA':                  'Paraisa',
  'NAZARENO':                 'Nazareno',
  'GRANOLA':                  'El Maiten',
  'PIZZA':                    'Pajarito Amarillo',
  'EL ARISTEO':               'Tienda Limón',
  'ARISTEO':                  'Tienda Limón',
  'BENDITA LLUVIA':           'Tienda Limón',
  'CALANDRI':                 'Tienda Limón',
};

function marcaAProveedor(marca) {
  return MARCA_A_PROVEEDOR[(marca || '').trim().toUpperCase()] || null;
}

// Proveedores que NO deben aparecer en Dashboard Referentes (talleres, digitales, servicios)
var PROVEEDORES_EXCLUIR_REFERENTES = ['Carlos Villegas'];
