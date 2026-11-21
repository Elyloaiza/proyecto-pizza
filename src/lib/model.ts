// Relaciona Ventas con Clientes y Productos y deriva importes/costos. Se recalcula cuando cambia cualquier base.
import type { Dataset, Issue, Product, SaleRow } from './types';
import { UNCLASSIFIED } from './types';

export interface Quality {
  salesRows: number;
  txCount: number;
  multiLineTx: number;
  compositeTxIds: number;
  grain: 'fila_por_transaccion' | 'multilinea';
  customersRegistered: number;
  productsRegistered: number;
  dupCustomerIds: number;
  dupProductIds: number;
  salesCustomerBlank: number;
  salesCustomerNotFound: number;
  salesProductNotFound: number;
  customersWithoutSegment: number;
  salesWithoutAmount: number;
  salesWithoutCost: number;
  costFromCatalog: number;
  amountFromCatalog: number;
  costRowsCompared: number;
  costMismatchRows: number;
  priceRowsCompared: number;
  priceMismatchRows: number;
}

export interface Options {
  cities: string[];
  branches: string[];
  segments: string[];
  products: { id: string; label: string }[];
  minDate: string;
  maxDate: string;
}

export interface Model {
  dataset: Dataset;
  rows: SaleRow[];
  quality: Quality;
  options: Options;
}

export function productLabel(p: Product): string {
  const size = p.size && p.size.toLowerCase() !== 'único' && p.size.toLowerCase() !== 'unico' ? ` ${p.size}` : '';
  return `${p.name}${size}`;
}

export function buildModel(ds: Dataset): Model {
  const segByCustomer = new Map<string, string>();
  let dupCustomerIds = 0;
  let customersWithoutSegment = 0;
  for (const c of ds.customers) {
    if (segByCustomer.has(c.id)) dupCustomerIds++;
    else {
      segByCustomer.set(c.id, c.segment);
      if (!c.segment) customersWithoutSegment++;
    }
  }
  const prodById = new Map<string, Product>();
  let dupProductIds = 0;
  for (const p of ds.products) {
    if (prodById.has(p.id)) dupProductIds++;
    else prodById.set(p.id, p);
  }
  const labelCount = new Map<string, number>();
  for (const p of prodById.values()) labelCount.set(productLabel(p), (labelCount.get(productLabel(p)) ?? 0) + 1);
  const labelOf = (p: Product) => (labelCount.get(productLabel(p))! > 1 ? `${productLabel(p)} · ${p.id}` : productLabel(p));

  // Clave de transacción: el identificador, salvo que se repita en fechas/sucursales distintas.
  const ctx = new Map<string, string>();
  const composite = new Set<string>();
  for (const s of ds.sales) {
    const k = `${s.date}|${s.branch}`;
    const prev = ctx.get(s.id);
    if (prev === undefined) ctx.set(s.id, k);
    else if (prev !== k) composite.add(s.id);
  }

  const q: Quality = {
    salesRows: ds.sales.length, txCount: 0, multiLineTx: 0, compositeTxIds: composite.size, grain: 'fila_por_transaccion',
    customersRegistered: segByCustomer.size, productsRegistered: prodById.size, dupCustomerIds, dupProductIds,
    salesCustomerBlank: 0, salesCustomerNotFound: 0, salesProductNotFound: 0, customersWithoutSegment,
    salesWithoutAmount: 0, salesWithoutCost: 0, costFromCatalog: 0, amountFromCatalog: 0,
    costRowsCompared: 0, costMismatchRows: 0, priceRowsCompared: 0, priceMismatchRows: 0,
  };

  const rows: SaleRow[] = new Array(ds.sales.length);
  const txLines = new Map<string, number>();
  const cities = new Set<string>();
  const branches = new Set<string>();
  const segments = new Set<string>();
  const products = new Map<string, string>();
  let minDate = '9999';
  let maxDate = '0000';

  for (let i = 0; i < ds.sales.length; i++) {
    const s = ds.sales[i];
    const tx = composite.has(s.id) ? `${s.id}|${s.date}|${s.branch}` : s.id;
    txLines.set(tx, (txLines.get(tx) ?? 0) + 1);
    const prod = prodById.get(s.productId);
    if (!prod) q.salesProductNotFound++;

    let segment = UNCLASSIFIED;
    if (!s.customerId) q.salesCustomerBlank++;
    else if (!segByCustomer.has(s.customerId)) q.salesCustomerNotFound++;
    else segment = segByCustomer.get(s.customerId) || UNCLASSIFIED;

    let amount: number | null = null;
    let amountSource: SaleRow['amountSource'] = null;
    if (s.lineAmount !== null) {
      amount = s.lineAmount;
      amountSource = 'linea';
    } else if (s.unitPrice !== null) {
      amount = s.qty * s.unitPrice * (1 - (s.discountPct ?? 0) / 100);
      amountSource = 'precio';
    } else if (prod && prod.price !== null) {
      amount = s.qty * prod.price;
      amountSource = 'catalogo';
      q.amountFromCatalog++;
    }
    if (amount === null) q.salesWithoutAmount++;

    let cost: number | null = null;
    let costSource: SaleRow['costSource'] = null;
    if (s.unitCost !== null) {
      cost = s.qty * s.unitCost;
      costSource = 'venta';
    } else if (s.lineCost !== null) {
      cost = s.lineCost;
      costSource = 'venta';
    } else if (prod && prod.cost !== null) {
      cost = s.qty * prod.cost;
      costSource = 'catalogo';
      q.costFromCatalog++;
    }
    if (cost === null) q.salesWithoutCost++;

    if (prod) {
      if (s.unitCost !== null && prod.cost !== null) {
        q.costRowsCompared++;
        if (Math.abs(s.unitCost - prod.cost) > 0.005) q.costMismatchRows++;
      }
      if (s.unitPrice !== null && prod.price !== null) {
        q.priceRowsCompared++;
        if (Math.abs(s.unitPrice - prod.price) > 0.005) q.priceMismatchRows++;
      }
    }

    const label = prod ? labelOf(prod) : `Producto sin ficha (${s.productId})`;
    cities.add(s.city);
    branches.add(s.branch);
    segments.add(segment);
    products.set(s.productId, label);
    if (s.date < minDate) minDate = s.date;
    if (s.date > maxDate) maxDate = s.date;
    rows[i] = { tx, date: s.date, month: s.date.slice(0, 7), customerId: s.customerId, segment, productId: s.productId, productLabel: label, city: s.city, branch: s.branch, qty: s.qty, amount, cost, costSource, amountSource };
  }
  q.txCount = txLines.size;
  for (const n of txLines.values()) if (n > 1) q.multiLineTx++;
  q.grain = q.multiLineTx > 0 ? 'multilinea' : 'fila_por_transaccion';

  const sorted = (x: Set<string>) => [...x].sort((a, b) => a.localeCompare(b, 'es'));
  return {
    dataset: ds,
    rows,
    quality: q,
    options: {
      cities: sorted(cities), branches: sorted(branches), segments: sorted(segments),
      products: [...products].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, 'es')),
      minDate: rows.length ? minDate : '', maxDate: rows.length ? maxDate : '',
    },
  };
}

const n = (x: number) => x.toLocaleString('es-US');

/** Avisos de calidad legibles (los usa la pestaña Datos, el dashboard y el contexto de IA). */
export function qualityIssues(q: Quality, costBasis: string): Issue[] {
  const out: Issue[] = [];
  const w = (code: string, message: string, count?: number) => out.push({ level: 'warning', code, message, count });
  out.push({
    level: 'info', code: 'grano',
    message: q.grain === 'fila_por_transaccion'
      ? `Grano de Ventas: una línea de producto por transacción (${n(q.txCount)} identificadores distintos en ${n(q.salesRows)} filas). Cada fila cuenta como una transacción.`
      : `Grano de Ventas: pedidos de varias líneas (${n(q.multiLineTx)} de ${n(q.txCount)} transacciones tienen más de una línea). Las transacciones se cuentan por identificador distinto.`,
  });
  if (q.compositeTxIds) w('clave_compuesta', `${n(q.compositeTxIds)} identificadores de transacción se repiten en fechas o sucursales distintas; se usó una clave compuesta (id + fecha + sucursal).`, q.compositeTxIds);
  if (q.salesCustomerBlank) w('ventas_sin_cliente', `${n(q.salesCustomerBlank)} ventas no tienen cliente identificable: cuentan en ventas pero no en el número de clientes; segmento «Sin clasificar».`, q.salesCustomerBlank);
  if (q.salesCustomerNotFound) w('cliente_no_encontrado', `${n(q.salesCustomerNotFound)} ventas referencian clientes que no están en la base Clientes: segmento «Sin clasificar».`, q.salesCustomerNotFound);
  if (q.salesProductNotFound) w('producto_no_encontrado', `${n(q.salesProductNotFound)} ventas referencian productos que no están en la base Productos.`, q.salesProductNotFound);
  if (q.customersWithoutSegment) w('clientes_sin_segmento', `${n(q.customersWithoutSegment)} clientes sin segmento: se agrupan como «Sin clasificar».`, q.customersWithoutSegment);
  if (q.dupCustomerIds) w('dup_clientes', `${n(q.dupCustomerIds)} identificadores de cliente duplicados en el maestro (se usa la primera aparición).`, q.dupCustomerIds);
  if (q.dupProductIds) w('dup_productos', `${n(q.dupProductIds)} identificadores de producto duplicados en el maestro (se usa la primera aparición).`, q.dupProductIds);
  if (q.salesWithoutAmount) w('sin_importe', `${n(q.salesWithoutAmount)} ventas sin importe calculable: no suman a ventas (alcance parcial).`, q.salesWithoutAmount);
  if (q.salesWithoutCost) w('sin_costo', `${n(q.salesWithoutCost)} ventas sin costo conocido: la utilidad y el margen se calculan solo sobre las ventas con costo (alcance parcial); el costo desconocido no se toma como cero.`, q.salesWithoutCost);
  if (q.amountFromCatalog) w('importe_catalogo', `${n(q.amountFromCatalog)} ventas usaron el precio del catálogo como alternativa documentada porque no traían importe.`, q.amountFromCatalog);
  if (q.costFromCatalog) w('costo_catalogo', `${n(q.costFromCatalog)} ventas usaron el costo actual del catálogo (no histórico): la utilidad de esas ventas es una estimación.`, q.costFromCatalog);
  if (q.costRowsCompared && q.costMismatchRows) w('costo_vs_catalogo', `En ${n(q.costMismatchRows)} de ${n(q.costRowsCompared)} ventas el costo registrado difiere del costo del catálogo. Se usa el costo registrado en la venta (histórico).`, q.costMismatchRows);
  if (q.priceRowsCompared && q.priceMismatchRows) w('precio_vs_catalogo', `En ${n(q.priceMismatchRows)} de ${n(q.priceRowsCompared)} ventas el precio unitario registrado difiere del precio del catálogo. Las ventas se calculan con el importe registrado, no con el catálogo.`, q.priceMismatchRows);
  out.push({ level: 'info', code: 'base_costo', message: costBasis });
  return out;
}
