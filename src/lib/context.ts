// Construye el contexto estructurado que se envía al asistente. Las cifras salen de metrics.ts.
// Nunca incluye archivos completos, nombres, correos ni teléfonos de clientes.
import { round1, round2 } from './format';
import { aggregate, activeFilterLabels, bySegment, byBranch, byCity, byProduct, computeKpis, describePeriod, timeSeries, type Agg } from './metrics';
import { qualityIssues, type Model } from './model';
import type { Filters, SaleRow } from './types';

export interface Evidence {
  id: string;
  titulo: string;
  columnas: string[];
  filas: (string | number | null)[][];
  parcial: boolean;
  nota?: string;
}

export interface AiContext {
  version_datos: string;
  origen_datos: string;
  fecha_carga: string;
  moneda: string;
  periodo_analizado: string;
  filtros_activos: string[];
  seleccion: { filas_de_venta: number; transacciones: number };
  definiciones: Record<string, string>;
  calidad_datos: string[];
  evidencias: Evidence[];
}

export const MAX_PRODUCT_ROWS = 60;

export const DEFINITIONS: Record<string, string> = {
  ventas_totales: 'Suma del importe neto de cada línea de venta (ya con descuentos). Si falta el importe se usa cantidad × precio efectivo; el precio de catálogo solo es alternativa documentada.',
  costo_vendido: 'Suma de cantidad × costo unitario. Se prioriza el costo histórico registrado en la venta; el costo del catálogo solo si la venta no lo trae.',
  utilidad_bruta: 'Ventas totales menos costo vendido. No es utilidad neta (no incluye gastos operativos, nómina, renta ni impuestos).',
  margen_bruto_pct: 'Utilidad bruta total ÷ ventas totales × 100, calculado sobre totales (no es un promedio de porcentajes).',
  transacciones: 'Cantidad de transacciones distintas.',
  ticket_promedio: 'Ventas de la selección ÷ transacciones distintas de la selección. Con filtro de producto es el importe de los productos seleccionados por transacción que los contiene.',
  clientes: 'Clientes distintos con compras en la selección (no es el total de clientes registrados).',
  participacion_pct: 'Ventas del grupo ÷ ventas de la selección × 100.',
};

const money = round2;

function costBasis(rows: SaleRow[]): string {
  let sale = 0;
  let cat = 0;
  let none = 0;
  for (const r of rows) {
    if (r.costSource === 'venta') sale++;
    else if (r.costSource === 'catalogo') cat++;
    else none++;
  }
  if (rows.length === 0) return 'Sin datos en la selección.';
  if (cat === 0 && none === 0) return 'Costo: histórico registrado en cada venta. La utilidad bruta no es estimada con el catálogo.';
  return `Costo: ${sale} filas con costo histórico de la venta, ${cat} filas con costo actual del catálogo (utilidad estimada) y ${none} filas sin costo (excluidas del cálculo de utilidad).`;
}
export { costBasis };

function aggRow(a: Agg, total: number | null): (string | number | null)[] {
  return [a.label, a.units, money(a.sales), money(a.cost), money(a.profit), round1(a.margin), a.transactions, money(a.ticket), a.customers, total ? round1((a.sales / total) * 100) : null];
}
const GROUP_COLS = ['grupo', 'unidades', 'ventas', 'costo_vendido', 'utilidad_bruta', 'margen_bruto_pct', 'transacciones', 'ticket_promedio', 'clientes', 'participacion_ventas_pct'];

export function buildContext(model: Model, filters: Filters, rows: SaleRow[]): AiContext {
  const ds = model.dataset;
  const k = computeKpis(rows);
  const labels = new Map(model.options.products.map((p) => [p.id, p.label]));
  const period = describePeriod(rows, filters, model.options.minDate, model.options.maxDate);
  const filterLabels = activeFilterLabels(filters, labels);
  const scope = `período ${period}; filtros: ${filterLabels.length ? filterLabels.join(' | ') : 'ninguno'}`;
  const total = k.sales;
  const evidencias: Evidence[] = [];

  const kpiRows: (string | number | null)[][] = [
    ['ventas_totales', money(k.sales), k.reasons.sales ?? ''],
    ['costo_vendido', money(k.cost), k.reasons.profit ?? ''],
    ['utilidad_bruta', money(k.profit), k.costCoverage !== null && k.costCoverage < 1 ? `Parcial: cobertura de costo ${round1(k.costCoverage * 100)} % de las ventas` : k.reasons.profit ?? ''],
    ['margen_bruto_pct', round1(k.margin), k.reasons.margin ?? ''],
    ['transacciones', k.transactions, ''],
    ['ticket_promedio', money(k.ticket), k.reasons.ticket ?? ''],
    ['clientes_con_compras', k.customers, `Clientes registrados en el maestro: ${model.quality.customersRegistered}`],
  ];
  evidencias.push({ id: 'E1', titulo: `KPIs generales (${scope})`, columnas: ['indicador', 'valor', 'nota'], filas: kpiRows, parcial: false });

  const monthly = timeSeries(rows, 'month');
  evidencias.push({
    id: 'E2', titulo: `Evolución mensual de ventas y utilidad (${scope})`,
    columnas: ['mes', 'ventas', 'utilidad_bruta', 'margen_bruto_pct', 'transacciones'],
    filas: monthly.map((a) => [a.key, money(a.sales), money(a.profit), round1(a.margin), a.transactions]), parcial: false,
  });

  const prods = byProduct(rows).sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity));
  const partialProducts = prods.length > MAX_PRODUCT_ROWS;
  evidencias.push({
    id: 'E3', titulo: `Tabla de productos, ordenada por utilidad bruta (${scope})`, columnas: ['producto', ...GROUP_COLS.slice(1)],
    filas: prods.slice(0, MAX_PRODUCT_ROWS).map((a) => aggRow(a, total)), parcial: partialProducts,
    nota: partialProducts ? `PARCIAL: se muestran los ${MAX_PRODUCT_ROWS} productos con mayor utilidad de ${prods.length}.` : `Incluye los ${prods.length} productos de la selección.`,
  });
  const cities = byCity(rows).sort((a, b) => b.sales - a.sales);
  evidencias.push({ id: 'E4', titulo: `Tabla de ciudades (${scope})`, columnas: ['ciudad', ...GROUP_COLS.slice(1)], filas: cities.map((a) => aggRow(a, total)), parcial: false });
  const branches = byBranch(rows).sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity));
  evidencias.push({ id: 'E5', titulo: `Tabla de sucursales, ordenada por utilidad bruta (${scope})`, columnas: ['sucursal', ...GROUP_COLS.slice(1)], filas: branches.map((a) => aggRow(a, total)), parcial: false });
  const segs = bySegment(rows).sort((a, b) => b.sales - a.sales);
  evidencias.push({ id: 'E6', titulo: `Tabla de segmentos de cliente (${scope})`, columnas: ['segmento', ...GROUP_COLS.slice(1)], filas: segs.map((a) => aggRow(a, total)), parcial: false });

  const quality = qualityIssues(model.quality, costBasis(rows));
  const qMsgs = quality.map((q) => q.message);
  evidencias.push({ id: 'E7', titulo: 'Calidad y alcance de los datos', columnas: ['aviso'], filas: qMsgs.map((m) => [m]), parcial: false });

  // Comparación por año solo si hay más de un año (útil para tendencias sin inventar causalidad)
  const years = aggregate(rows, (r) => r.date.slice(0, 4)).sort((a, b) => a.key.localeCompare(b.key));
  if (years.length > 1) {
    evidencias.push({ id: 'E8', titulo: `Resumen por año (${scope})`, columnas: ['año', 'ventas', 'utilidad_bruta', 'margen_bruto_pct', 'transacciones', 'meses_con_datos'],
      filas: years.map((a) => [a.key, money(a.sales), money(a.profit), round1(a.margin), a.transactions, new Set(rows.filter((r) => r.date.startsWith(a.key)).map((r) => r.month)).size]), parcial: false,
      nota: 'Los años pueden tener distinta cantidad de meses; compare con cautela.' });
  }

  return {
    version_datos: ds.version,
    origen_datos: ds.isDemo ? 'Datos de demostración' : ds.origin === 'inicial' ? 'Datos reales aportados con el enunciado (conjunto inicial)' : `Archivos cargados por el usuario: ${Object.values(ds.sources).map((s) => s?.fileName).join(', ')}`,
    fecha_carga: ds.createdAt,
    moneda: ds.currency,
    periodo_analizado: period,
    filtros_activos: filterLabels,
    seleccion: { filas_de_venta: rows.length, transacciones: k.transactions },
    definiciones: DEFINITIONS,
    calidad_datos: qMsgs,
    evidencias,
  };
}

/** Identificador del contexto: cambia si cambian los datos o los filtros. */
export function contextKey(version: string, filters: Filters): string {
  return `${version}::${JSON.stringify(filters)}`;
}

export function evidenceToMarkdown(e: Evidence): string {
  const head = `| ${e.columnas.join(' | ')} |\n| ${e.columnas.map(() => '---').join(' | ')} |`;
  const body = e.filas.map((r) => `| ${r.map((c) => (c === null ? '' : String(c))).join(' | ')} |`).join('\n');
  return `**${e.id} · ${e.titulo}**${e.parcial ? ' (PARCIAL)' : ''}\n${e.nota ? e.nota + '\n' : ''}\n${head}\n${body}`;
}
