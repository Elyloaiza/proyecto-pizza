// Cálculos deterministas. Todo número del dashboard y del contexto de IA sale de estas funciones.
import type { Filters, SaleRow } from './types';

export function filterRows(rows: SaleRow[], f: Filters): SaleRow[] {
  const cities = f.cities.length ? new Set(f.cities) : null;
  const branches = f.branches.length ? new Set(f.branches) : null;
  const segments = f.segments.length ? new Set(f.segments) : null;
  const products = f.products.length ? new Set(f.products) : null;
  return rows.filter(
    (r) =>
      (!f.dateFrom || r.date >= f.dateFrom) &&
      (!f.dateTo || r.date <= f.dateTo) &&
      (!cities || cities.has(r.city)) &&
      (!branches || branches.has(r.branch)) &&
      (!segments || segments.has(r.segment)) &&
      (!products || products.has(r.productId)),
  );
}

export interface Agg {
  key: string;
  label: string;
  rows: number;
  units: number;
  sales: number;
  /** Ventas de las filas que sí tienen costo conocido (base del margen) */
  salesWithCost: number;
  cost: number;
  profit: number | null;
  margin: number | null;
  transactions: number;
  ticket: number | null;
  customers: number;
  costCoverage: number | null; // 0..1 sobre ventas
}

class Acc {
  rows = 0;
  units = 0;
  sales = 0;
  salesWithCost = 0;
  cost = 0;
  rowsWithCost = 0;
  tx = new Set<string>();
  txAmt = new Set<string>();
  cust = new Set<string>();
  add(r: SaleRow) {
    this.rows++;
    this.units += r.qty;
    this.tx.add(r.tx);
    if (r.customerId) this.cust.add(r.customerId);
    if (r.amount !== null) {
      this.sales += r.amount;
      this.txAmt.add(r.tx);
      if (r.cost !== null) {
        this.salesWithCost += r.amount;
        this.cost += r.cost;
        this.rowsWithCost++;
      }
    }
  }
  done(key: string, label = key): Agg {
    const hasCost = this.rowsWithCost > 0;
    const profit = hasCost ? this.salesWithCost - this.cost : null;
    return {
      key, label, rows: this.rows, units: this.units, sales: this.sales, salesWithCost: this.salesWithCost, cost: this.cost,
      profit,
      margin: profit !== null && this.salesWithCost !== 0 ? (profit / this.salesWithCost) * 100 : null,
      transactions: this.tx.size,
      ticket: this.txAmt.size > 0 ? this.sales / this.txAmt.size : null,
      customers: this.cust.size,
      costCoverage: this.sales !== 0 ? this.salesWithCost / this.sales : hasCost ? 1 : null,
    };
  }
}

export function aggregate(rows: SaleRow[], keyOf: (r: SaleRow) => string, labelOf?: (r: SaleRow) => string): Agg[] {
  const m = new Map<string, { acc: Acc; label: string }>();
  for (const r of rows) {
    const k = keyOf(r);
    let e = m.get(k);
    if (!e) {
      e = { acc: new Acc(), label: labelOf ? labelOf(r) : k };
      m.set(k, e);
    }
    e.acc.add(r);
  }
  return [...m].map(([k, e]) => e.acc.done(k, e.label));
}

export interface Kpis {
  rows: number;
  sales: number | null;
  cost: number | null;
  profit: number | null;
  margin: number | null;
  ticket: number | null;
  customers: number;
  transactions: number;
  /** Cobertura de costo sobre ventas (0..1). <1 => utilidad parcial */
  costCoverage: number | null;
  /** Motivos legibles cuando un valor no está disponible */
  reasons: { sales?: string; profit?: string; margin?: string; ticket?: string };
  costEstimatedRows: number;
}

export function computeKpis(rows: SaleRow[]): Kpis {
  const a = new Acc();
  let costEstimatedRows = 0;
  for (const r of rows) {
    a.add(r);
    if (r.costSource === 'catalogo') costEstimatedRows++;
  }
  const g = a.done('total');
  const reasons: Kpis['reasons'] = {};
  if (rows.length === 0) {
    const none = 'Sin ventas en la selección';
    return { rows: 0, sales: null, cost: null, profit: null, margin: null, ticket: null, customers: 0, transactions: 0, costCoverage: null, reasons: { sales: none, profit: none, margin: none, ticket: none }, costEstimatedRows: 0 };
  }
  const hasAmount = a.txAmt.size > 0;
  if (!hasAmount) reasons.sales = 'No disponible: ninguna venta tiene importe';
  const hasCost = g.profit !== null;
  if (!hasCost) {
    reasons.profit = 'No disponible: faltan costos';
    reasons.margin = 'No disponible: faltan costos';
  }
  let margin = g.margin;
  if (hasCost && (g.salesWithCost === 0 || margin === null)) {
    margin = null;
    reasons.margin = 'No aplica: ventas iguales a cero';
  }
  let ticket = g.ticket;
  if (!hasAmount) reasons.ticket = 'No disponible: sin importes';
  else if (g.sales === 0) {
    ticket = null;
    reasons.ticket = 'No aplica: ventas iguales a cero';
  }
  if (hasAmount && g.sales === 0) reasons.margin = 'No aplica: ventas iguales a cero';
  return {
    rows: rows.length, sales: hasAmount ? g.sales : null, cost: hasCost ? g.cost : null, profit: g.profit, margin, ticket,
    customers: g.customers, transactions: g.transactions, costCoverage: g.costCoverage, reasons, costEstimatedRows,
  };
}

export type Grain = 'month' | 'day';

export function timeSeries(rows: SaleRow[], grain: Grain): Agg[] {
  return aggregate(rows, (r) => (grain === 'month' ? r.month : r.date)).sort((a, b) => a.key.localeCompare(b.key));
}
export const byProduct = (rows: SaleRow[]) => aggregate(rows, (r) => r.productId, (r) => r.productLabel);
export const byCity = (rows: SaleRow[]) => aggregate(rows, (r) => r.city);
export const byBranch = (rows: SaleRow[]) => aggregate(rows, (r) => r.branch);
export const bySegment = (rows: SaleRow[]) => aggregate(rows, (r) => r.segment);

export function describePeriod(rows: SaleRow[], f: Filters, min: string, max: string): string {
  if (rows.length === 0) return 'Sin ventas en la selección';
  let a = '9999';
  let b = '0000';
  for (const r of rows) {
    if (r.date < a) a = r.date;
    if (r.date > b) b = r.date;
  }
  void f;
  void min;
  void max;
  return `${a} a ${b}`;
}

export function activeFilterLabels(f: Filters, productLabels: Map<string, string>): string[] {
  const out: string[] = [];
  if (f.dateFrom || f.dateTo) out.push(`Fechas: ${f.dateFrom || 'inicio'} → ${f.dateTo || 'fin'}`);
  if (f.cities.length) out.push(`Ciudad: ${f.cities.join(', ')}`);
  if (f.branches.length) out.push(`Sucursal: ${f.branches.join(', ')}`);
  if (f.segments.length) out.push(`Segmento: ${f.segments.join(', ')}`);
  if (f.products.length) out.push(`Producto: ${f.products.map((p) => productLabels.get(p) ?? p).join(', ')}`);
  return out;
}

/** Elimina de los filtros valores que ya no existen y devuelve qué se quitó. */
export function reconcileFilters(f: Filters, o: { cities: string[]; branches: string[]; segments: string[]; products: { id: string }[]; minDate: string; maxDate: string }): { filters: Filters; removed: string[] } {
  const removed: string[] = [];
  const keep = <T>(vals: T[], ok: (v: T) => boolean, name: string) => {
    const k = vals.filter(ok);
    if (k.length !== vals.length) removed.push(name);
    return k;
  };
  const pid = new Set(o.products.map((p) => p.id));
  const filters: Filters = {
    ...f,
    cities: keep(f.cities, (v) => o.cities.includes(v), 'ciudad'),
    branches: keep(f.branches, (v) => o.branches.includes(v), 'sucursal'),
    segments: keep(f.segments, (v) => o.segments.includes(v), 'segmento'),
    products: keep(f.products, (v) => pid.has(v), 'producto'),
  };
  if (f.dateFrom && (f.dateFrom > o.maxDate || !o.maxDate)) {
    filters.dateFrom = '';
    removed.push('fecha inicial');
  }
  if (f.dateTo && (f.dateTo < o.minDate || !o.minDate)) {
    filters.dateTo = '';
    removed.push('fecha final');
  }
  return { filters, removed };
}
