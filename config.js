// Fuente de verdad del mapeo Marca (TiendaNube brand) → Proveedor
// Incluye nombres actuales y variantes históricas del Sheet
// Sincronizado con MARCA_A_PROVEEDOR en retiro_qr.gs
var MARCA_A_PROVEEDOR = {
  // Tienda Limón — nombre actual y variantes históricas
  'TIENDA LIMÓN':             'Tienda Limón',
  'TIENDA LIMON':             'Tienda Limón',
  'EL ARISTEO':               'Tienda Limón',
  'ARISTEO':                  'Tienda Limón',
  'BENDITA LLUVIA':           'Tienda Limón',
  'CALANDRI':                 'Tienda Limón',
  // El Maiten
  'EL MAITEN':                'El Maiten',
  'GRANOLA':                  'El Maiten',
  // BioSalud — variantes del nombre
  'MIX Y FRUTOS SECOS':       'BioSalud',
  'MIX DE FRUTOS SECOS':      'BioSalud',
  'MIX & FRUTOS SECOS':       'BioSalud',
  'FRUTOS SECOS':             'BioSalud',
  'BIOSALUD':                 'BioSalud',
  // Sol de Oro
  'SOL DE PAPEL':             'Sol de Oro',
  // Guardianes
  'GUARDIANES COLMENA':       'Guardianes de la Colmena',
  'GUARDIANES DE LA COLMENA': 'Guardianes de la Colmena',
  // Carlos Villegas
  'TALLER':                   'Carlos Villegas',
  // Pajarito Amarillo
  'PAJARITO AMARILLO':        'Pajarito Amarillo',
  'PIZZA':                    'Pajarito Amarillo',
  // Resto
  'YEMARI':                   'Yemari',
  'CABALLO NEGRO':            'Caballo Negro',
  'LA YAYA':                  'La Yaya',
  'GROEN':                    'Groen',
  'ODDIS':                    'Oddis',
  'PARAISA':                  'Paraisa',
  'NAZARENO':                 'Nazareno',
};

function marcaAProveedor(marca) {
  return MARCA_A_PROVEEDOR[(marca || '').trim().toUpperCase()] || null;
}

// Mapeo inverso: Proveedor → [Marcas] (brands de TiendaNube que representa)
// Usado para cascades Proveedor → Marca en Ventas, Pedidos y Dashboards
var PROVEEDOR_A_MARCAS = {
  'Tienda Limón':             ['Bendita Lluvia', 'Calandri', 'El Aristeo', 'Tienda Limón'],
  'El Maiten':                ['El Maiten', 'Granola'],
  'BioSalud':                 ['BioSalud', 'Mix y Frutos Secos'],
  'Sol de Oro':               ['Sol de Papel'],
  'Guardianes de la Colmena': ['Guardianes de la Colmena'],
  'Carlos Villegas':          ['Taller'],
  'Pajarito Amarillo':        ['Pajarito Amarillo', 'Pizza'],
  'Yemari':                   ['Yemari'],
  'Caballo Negro':            ['Caballo Negro'],
  'La Yaya':                  ['La Yaya'],
  'Groen':                    ['Groen'],
  'Oddis':                    ['Oddis'],
  'Paraisa':                  ['Paraisa'],
  'Nazareno':                 ['Nazareno'],
};

function marcasDeProveedor(proveedor) {
  return PROVEEDOR_A_MARCAS[(proveedor || '').trim()] || [];
}

// Proveedores que NO deben aparecer en Dashboard Referentes (talleres, digitales, servicios)
var PROVEEDORES_EXCLUIR_REFERENTES = ['Carlos Villegas'];
