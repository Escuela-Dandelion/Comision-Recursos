import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'mcp-ddl',
  version: '1.0.0'
});

// ── RESOURCES ────────────────────────────────────────────────

server.resource('ddl-config', 'ddl://config', async () => ({
  contents: [{
    uri: 'ddl://config',
    mimeType: 'application/json',
    text: JSON.stringify({
      descripcion: 'Tienda agroecológica comunitaria de la Escuela Waldorf Dandelion, Córdoba, Argentina.',
      gas_url: 'https://script.google.com/macros/s/AKfycbwt8mRYjjFZtsmFPw0JYcMpCkZcOt9J7ALFVkPByqQ8NM2NvCaYF1onagU_ag0a2ziksg/exec',
      gas_version_actual: 'Version_1.6_digitales',
      client_id_google: '308208183848-mcirv9g7cttetoa4eb1k6gt9p8chcr16.apps.googleusercontent.com',
      store_id_tiendanube: '7396246',
      ventas_sheet_id: '1-57n6RmTFQjwNFVYxNPzll8MMuV4NvXXx5v0wTvR_6g',
      github_pages_url: 'https://escuela-dandelion.github.io/Comision-Recursos/',
      repo: 'https://github.com/Escuela-Dandelion/Comision-Recursos',
      repo_local: '/Users/irobertson/Documents/Dandelion',
      gas_local: '/Users/irobertson/Documents/Dandelion/google-script/retiro_qr.gs',
      nota_deploy: 'Los cambios en retiro_qr.gs deben copiarse manualmente al editor de script.google.com y deployarse como nueva versión. GitHub Pages sirve desde la RAÍZ del repo — siempre editar HTMLs en raíz y copiar a docs/.',
      gateway_fee_wire_transfer: 0.01815,
      digital_product_ids: ['371016918'],
      ines_tel_whatsapp: '5493512112050'
    }, null, 2)
  }]
}));

server.resource('ddl-auth', 'ddl://auth_emails', async () => ({
  contents: [{
    uri: 'ddl://auth_emails',
    mimeType: 'application/json',
    text: JSON.stringify({
      descripcion: 'Usuarios autorizados en AUTH_EMAILS del GAS. Roles: ADMIN (acceso total), FGP (ver ventas/pedidos), referente (ver su grado), digital (ver ventas digitales), staff (registrar entregas).',
      usuarios: [
        { email: 'robertson.ine@gmail.com',              role: 'ADMIN',    name: 'Inés' },
        { email: 'longhi.yuliana@gmail.com',             role: 'ADMIN',    name: 'Yuliana' },
        { email: 'yuliana.longhi@dandelion.edu.ar',      role: 'ADMIN',    name: 'Yuliana' },
        { email: 'pialucarno@gmail.com',                 role: 'ADMIN',    name: 'Pia',    marcas: ['EL MAITEN','ODDIS'] },
        { email: 'monicachesta@gmail.com',               role: 'ADMIN',    name: 'Monica', marcas: ['LA YAYA','GUARDIANES COLMENA','GROEN'] },
        { email: 'lmdestefano@dandelion.edu.ar',         role: 'ADMIN',    name: 'Lucas',  marcas: ['YEMARI','CABALLO NEGRO'] },
        { email: 'lmdestefano@gmail.com',                role: 'ADMIN',    name: 'Lucas',  marcas: ['YEMARI','CABALLO NEGRO'] },
        { email: 'francoalini@gmail.com',                role: 'ADMIN',    name: 'Franco', marcas: ['NAZARENO'] },
        { email: 'martinimaria39@gmail.com',             role: 'FGP',      name: 'Maria',   marcas: ['YEMARI','CABALLO NEGRO','LA YAYA','GUARDIANES COLMENA','EL MAITEN','ODDIS','GROEN','PARAISA'] },
        { email: 'amandabenedi@gmail.com',               role: 'FGP',      name: 'Amanda',  marcas: [] },
        { email: 'lourdelcastillo@gmail.com',            role: 'FGP',      name: 'Luli',    marcas: ['LA YAYA','ODDIS'] },
        { email: 'belen.ravaza@dandelion.edu.ar',        role: 'FGP',      name: 'Belén',   marcas: [] },
        { email: 'avilaclaudio1905@gmail.com',           role: 'referente', name: 'Claudio' },
        { email: 'inesitavasquezoliva@gmail.com',        role: 'referente', name: 'Inés V.' },
        { email: 'elinapipino8@gmail.com',               role: 'referente', name: 'Elina' },
        { email: 'paola@bodegatres.com.ar',              role: 'referente', name: 'Paola' },
        { email: 'delfinasalvettilarrea@gmail.com',      role: 'referente', name: 'Delfina' },
        { email: 'jdiaz.elencuentro@gmail.com',          role: 'referente', name: 'Juan' },
        { email: 'karytramitesescolares@gmail.com',      role: 'referente', name: 'Karina' },
        { email: 'dominguezgabydl@gmail.com',            role: 'referente', name: 'Gaby' },
        { email: 'yaninafuentes33@gmail.com',            role: 'referente', name: 'Yana' },
        { email: 'ariasgibertsabina@gmail.com',          role: 'referente', name: 'Sabi' },
        { email: 'dolo.dominguez@dandelion.edu.ar',      role: 'referente', name: 'Dolo' },
        { email: 'maximiliano.contreras@dandelion.edu.ar', role: 'referente', name: 'Maximiliano' },
        { email: 'leilaremedi1@gmail.com',               role: 'digital',  name: 'Leila' }
      ]
    }, null, 2)
  }]
}));

server.resource('ddl-sheets', 'ddl://sheet_schemas', async () => ({
  contents: [{
    uri: 'ddl://sheet_schemas',
    mimeType: 'application/json',
    text: JSON.stringify({
      descripcion: 'Esquemas de las hojas del Google Sheet de Diente de León.',
      hojas: {
        Retiros: {
          descripcion: 'Un registro por pedido físico procesado (QR enviado).',
          columnas: ['ID interno (TN)', 'Pedido #', 'Nombre', 'Email', 'Productos', 'Total', 'Fecha', 'Estado', 'Staff', 'Notas', 'Grado (normalizado)', 'Descuento', 'Tipo Descuento']
        },
        Ventas: {
          descripcion: 'Un registro por línea de producto de cada pedido físico.',
          columnas: ['Fecha', 'Pedido #', 'ID Interno', 'Nombre', 'Email', 'Producto', 'SKU', 'Cantidad', 'Precio Unit.', 'Subtotal Bruto', 'Total Pedido', 'Comentarios', 'Marca', 'Costo Unit.', 'Total Pagado Línea', 'Neto Línea', 'Fee Procesamiento', 'Método Pago', 'Descuento', 'Tipo Descuento', 'Aporte Grado', 'Grado Destino', 'Aporte Escuela']
        },
        Digitales: {
          descripcion: 'Un registro por producto digital vendido (entradas a talleres, etc.).',
          columnas: ['Fecha', 'Pedido #', 'ID Interno', 'Nombre', 'Email', 'Producto', 'SKU', 'Cantidad', 'Precio Unit.', 'Total Línea', 'Total Pedido', 'Método Pago']
        },
        ConfigProductos: {
          descripcion: 'Reglas de distribución de aportes por SKU, marca o DEFAULT. Incluye % al grado y % a la escuela.',
          columnas: ['Clave (SKU / MARCA:xxx / DEFAULT)', 'Descripción', '% Grado', '% Escuela', 'Vigente desde']
        }
      }
    }, null, 2)
  }]
}));

server.resource('ddl-paginas', 'ddl://paginas', async () => ({
  contents: [{
    uri: 'ddl://paginas',
    mimeType: 'application/json',
    text: JSON.stringify({
      descripcion: 'Páginas del proyecto y sus roles de acceso.',
      paginas: [
        { archivo: 'admin.html',            url: 'escuela-dandelion.github.io/Comision-Recursos/admin.html',            roles: ['ADMIN', 'FGP', 'referente', 'staff'], descripcion: 'Panel principal: pedidos, ventas, inventario, entregas QR' },
        { archivo: 'ventas-digitales.html', url: 'escuela-dandelion.github.io/Comision-Recursos/ventas-digitales.html', roles: ['ADMIN', 'digital'],                  descripcion: 'Ventas de productos digitales (talleres, entradas)' },
        { archivo: 'informe-aportes.html',  url: 'escuela-dandelion.github.io/Comision-Recursos/informe-aportes.html',  roles: ['ADMIN'],                             descripcion: 'Informe mensual de aportes por grado con comprobantes de transferencia' }
      ],
      nota: 'GitHub Pages sirve desde la raíz del repo. Siempre editar en raíz y copiar a docs/. Auth via Google Sign-In + validación contra AUTH_EMAILS en GAS.'
    }, null, 2)
  }]
}));

server.resource('ddl-proveedores', 'ddl://proveedores', async () => ({
  contents: [{
    uri: 'ddl://proveedores',
    mimeType: 'application/json',
    text: JSON.stringify({
      descripcion: 'Proveedores de la Tienda Diente de León y sus FGPs responsables. La clave "marca_tn" es el valor exacto del campo brand en TiendaNube y en CONFIG.ALIAS_PAGO.',
      proveedores: [
        {
          nombre: 'Yemari',
          marca_tn: 'YEMARI',
          producto: 'Yerba mate',
          fgps: ['lmdestefano@dandelion.edu.ar', 'martinimaria39@gmail.com'],
          pago: { alias: 'Yerba.yemari', titular: 'Claudio Daniel Avila Moyano', banco: 'Mercado Pago', cbu: '00000031000040988897724' }
        },
        {
          nombre: 'Caballo Negro',
          marca_tn: 'CABALLO NEGRO',
          producto: 'Yerba mate',
          fgps: ['lmdestefano@dandelion.edu.ar', 'martinimaria39@gmail.com'],
          pago: { alias: 'TOPE.POROTO.RUBIO', titular: 'Gabriel Alejandro Michalec', cbu: '2850006540094869600518' }
        },
        {
          nombre: 'Miel La Yaya',
          marca_tn: 'LA YAYA',
          producto: 'Miel',
          fgps: ['monicachesta@gmail.com', 'martinimaria39@gmail.com'],
          soporte: ['lourdelcastillo@gmail.com'],
          pago: { alias: 'MUNDO.TACO.LANA', titular: 'Mariela Isabel Conci', banco: 'Banco Galicia', cbu: '0070362630004011663770' }
        },
        {
          nombre: 'Guardianes de la Colmena',
          marca_tn: 'GUARDIANES COLMENA',
          producto: 'Miel',
          fgps: ['monicachesta@gmail.com', 'martinimaria39@gmail.com'],
          pago: { titular: 'Alejandro Sánchez Penak', banco: 'Mercado Pago', cbu: '0000003100017116879020' }
        },
        {
          nombre: 'El Maiten',
          marca_tn: 'EL MAITEN',
          producto: 'Granola · Frutos secos',
          fgps: ['pialucarno@gmail.com', 'martinimaria39@gmail.com'],
          pago: { alias: 'El.maiten2025' }
        },
        {
          nombre: 'Oddis',
          marca_tn: 'ODDIS',
          producto: 'Pasta de maní',
          fgps: ['pialucarno@gmail.com', 'martinimaria39@gmail.com'],
          soporte: ['lourdelcastillo@gmail.com'],
          pago: { titular: 'Rece SA', banco: 'Mercado Pago', cbu: '0000003100008850705997' }
        },
        {
          nombre: 'Alfajores Nazareno',
          marca_tn: 'NAZARENO',
          producto: 'Alfajores',
          fgps: ['francoalini@gmail.com'],
          nota: 'Franco recibe resumen automático por mail y gestiona el pedido directo con Nazareno. Pedido semanal los jueves.',
          pago: { alias: 'Lapaz293', titular: 'Franco Alini (intermediario)' }
        },
        {
          nombre: 'Groen',
          marca_tn: 'GROEN',
          producto: 'Limpieza (Detergente Sólido XL)',
          fgps: ['monicachesta@gmail.com', 'martinimaria39@gmail.com'],
          pago: { titular: 'Daniel Elías González', banco: 'Banco Santander Río', cbu: '0720242388000036973204' }
        },
        {
          nombre: 'Paraisa',
          marca_tn: 'PARAISA',
          producto: 'Biocosmética',
          fgps: ['martinimaria39@gmail.com'],
          pago: { alias: 'Paraisabiocosmetica' }
        }
      ]
    }, null, 2)
  }]
}));

// ── TRANSPORT ────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
