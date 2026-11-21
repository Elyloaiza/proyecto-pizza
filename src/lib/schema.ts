import type { DatasetKind } from './types';

export type FieldType = 'id' | 'text' | 'date' | 'int' | 'number' | 'pct';

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  type: FieldType;
  /** Nombres equivalentes en español e inglés (se comparan sin tildes, mayúsculas ni separadores) */
  synonyms: string[];
  help: string;
  example: string;
}

export const SALES_FIELDS: FieldDef[] = [
  { key: 'id', label: 'Identificador de transacción', required: true, type: 'id', synonyms: ['ventaid', 'idventa', 'transaccion', 'transaccionid', 'idtransaccion', 'transactionid', 'transaction', 'orderid', 'order', 'pedido', 'pedidoid', 'factura', 'ticket', 'ticketid', 'folio', 'saleid'], help: 'Identifica la transacción. Si se repite en varias filas, esas filas son líneas de un mismo pedido y cuentan como una sola transacción.', example: 'V000001' },
  { key: 'date', label: 'Fecha', required: true, type: 'date', synonyms: ['fecha', 'date', 'fechaventa', 'saledate', 'fechatransaccion', 'orderdate'], help: 'Fecha de la venta (AAAA-MM-DD recomendado).', example: '2024-01-28' },
  { key: 'customerId', label: 'Identificador de cliente', required: true, type: 'id', synonyms: ['clienteid', 'idcliente', 'cliente', 'customerid', 'customer', 'codigocliente'], help: 'Relaciona con Clientes. Si está vacío, la venta se conserva pero sin cliente identificable.', example: 'C00673' },
  { key: 'productId', label: 'Identificador de producto', required: true, type: 'id', synonyms: ['productoid', 'idproducto', 'producto', 'productid', 'product', 'sku', 'codigoproducto', 'itemid'], help: 'Relaciona con Productos.', example: 'P032' },
  { key: 'qty', label: 'Cantidad', required: true, type: 'number', synonyms: ['cantidad', 'qty', 'quantity', 'unidades', 'units', 'cant'], help: 'Unidades vendidas en la línea.', example: '2' },
  { key: 'city', label: 'Ciudad', required: true, type: 'text', synonyms: ['ciudad', 'city'], help: 'Ciudad de la sucursal donde ocurrió la venta.', example: 'Dallas' },
  { key: 'branch', label: 'Sucursal', required: true, type: 'text', synonyms: ['sucursal', 'branch', 'tienda', 'store', 'local', 'restaurante', 'location'], help: 'Sucursal que realizó la venta.', example: 'Dallas Downtown' },
  { key: 'lineAmount', label: 'Importe de línea (neto)', required: false, type: 'number', synonyms: ['ventaneta', 'importe', 'importelinea', 'importeneto', 'netsales', 'netamount', 'lineamount', 'linetotal', 'totallinea', 'monto', 'amount', 'ventatotal', 'ingreso', 'revenue'], help: 'Importe efectivamente vendido de la línea, ya con descuentos aplicados. Si existe, se usa como ventas.', example: '15.46' },
  { key: 'unitPrice', label: 'Precio unitario', required: false, type: 'number', synonyms: ['preciounitario', 'precio', 'unitprice', 'price', 'precioventa'], help: 'Alternativa al importe: ventas = cantidad × precio × (1 − descuento).', example: '15.46' },
  { key: 'unitCost', label: 'Costo unitario (histórico)', required: false, type: 'number', synonyms: ['costounitario', 'costo', 'unitcost', 'cost', 'cogsunitario'], help: 'Costo registrado en la venta. Es el que se prioriza para el costo vendido.', example: '6.95' },
  { key: 'lineCost', label: 'Costo total de línea', required: false, type: 'number', synonyms: ['costototal', 'totalcost', 'linecost', 'costolinea', 'cogs'], help: 'Solo se usa si no hay costo unitario.', example: '6.95' },
  { key: 'discountPct', label: 'Descuento (%)', required: false, type: 'pct', synonyms: ['descuentopct', 'descuento', 'discount', 'discountpct', 'descuentoporcentaje', 'pctdescuento'], help: 'Porcentaje de descuento (0–100). Solo se usa para derivar el importe cuando no hay importe de línea.', example: '10' },
];

export const CUSTOMER_FIELDS: FieldDef[] = [
  { key: 'id', label: 'Identificador de cliente', required: true, type: 'id', synonyms: ['clienteid', 'idcliente', 'cliente', 'customerid', 'customer', 'codigocliente'], help: 'Clave única del cliente.', example: 'C00001' },
  { key: 'segment', label: 'Segmento', required: true, type: 'text', synonyms: ['segmento', 'segment', 'tipocliente', 'customersegment', 'perfil'], help: 'Segmento del cliente. Vacío se agrupa como «Sin clasificar».', example: 'Estudiante' },
];

export const PRODUCT_FIELDS: FieldDef[] = [
  { key: 'id', label: 'Identificador de producto', required: true, type: 'id', synonyms: ['productoid', 'idproducto', 'producto', 'productid', 'product', 'sku', 'codigoproducto'], help: 'Clave única del producto.', example: 'P001' },
  { key: 'name', label: 'Nombre del producto', required: true, type: 'text', synonyms: ['producto', 'nombre', 'nombreproducto', 'productname', 'name', 'descripcion', 'item'], help: 'Nombre visible del producto.', example: 'Pepperoni' },
  { key: 'cost', label: 'Costo unitario (catálogo)', required: true, type: 'number', synonyms: ['costousd', 'costo', 'costounitario', 'cost', 'unitcost'], help: 'Costo actual del catálogo. Solo se usa como alternativa cuando la venta no trae costo.', example: '6.38' },
  { key: 'price', label: 'Precio de venta (catálogo)', required: true, type: 'number', synonyms: ['precioventausd', 'precioventa', 'precio', 'price', 'saleprice', 'unitprice'], help: 'Precio de catálogo. Solo alternativa documentada si la venta no trae importe.', example: '14.31' },
  { key: 'category', label: 'Categoría', required: false, type: 'text', synonyms: ['categoria', 'category', 'familia', 'linea'], help: 'Agrupación del producto.', example: 'Pizzas' },
  { key: 'size', label: 'Tamaño', required: false, type: 'text', synonyms: ['tamano', 'tamaño', 'size', 'presentacion'], help: 'Variante de tamaño; se añade al nombre para distinguir productos.', example: 'M' },
  { key: 'active', label: 'Activo', required: false, type: 'text', synonyms: ['activo', 'active', 'vigente', 'estado'], help: 'Informativo.', example: 'Sí' },
];

export const FIELDS: Record<DatasetKind, FieldDef[]> = {
  sales: SALES_FIELDS,
  customers: CUSTOMER_FIELDS,
  products: PRODUCT_FIELDS,
};

export const KIND_LABEL: Record<DatasetKind, string> = {
  sales: 'Ventas',
  customers: 'Clientes',
  products: 'Productos',
};

export function normalizeHeader(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** CSV de plantilla (encabezados + una fila de ejemplo) */
export function templateCsv(kind: DatasetKind): string {
  const f = FIELDS[kind];
  const canonical: Record<DatasetKind, string[]> = {
    sales: ['VentaID', 'Fecha', 'ClienteID', 'ProductoID', 'Cantidad', 'Ciudad', 'Sucursal', 'VentaNeta', 'PrecioUnitario', 'CostoUnitario', 'CostoTotal', 'DescuentoPct'],
    customers: ['ClienteID', 'Segmento'],
    products: ['ProductoID', 'Producto', 'CostoUSD', 'PrecioVentaUSD', 'Categoria', 'Tamaño', 'Activo'],
  };
  return canonical[kind].join(',') + '\n' + f.map((x) => x.example).join(',') + '\n';
}

export function dictionaryCsv(): string {
  const rows: string[][] = [['Base', 'Campo', 'Obligatorio', 'Tipo', 'Nombres equivalentes reconocidos', 'Descripción', 'Ejemplo']];
  (Object.keys(FIELDS) as DatasetKind[]).forEach((k) =>
    FIELDS[k].forEach((f) => rows.push([KIND_LABEL[k], f.label, f.required ? 'Sí' : 'No', f.type, f.synonyms.join(' | '), f.help, f.example])),
  );
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
}
