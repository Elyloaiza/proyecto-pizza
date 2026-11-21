import { useMemo, useState } from 'react';
import { activeFilterLabels, byBranch, byCity, byProduct, bySegment, computeKpis, describePeriod, timeSeries, type Agg, type Grain } from '../lib/metrics';
import { fmtCompactMoney, fmtDateTime, fmtDay, fmtInt, fmtMonth, fmtMoney, fmtPct, NA } from '../lib/format';
import { costBasis } from '../lib/context';
import type { Model } from '../lib/model';
import { EMPTY_FILTERS, type Filters, type SaleRow } from '../lib/types';
import { BarChart, LineChart } from './Charts';
import { DataTable, type Col } from './DataTable';
import { MultiSelect } from './MultiSelect';

interface Props {
  model: Model;
  rows: SaleRow[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  notice: string | null;
  dismissNotice: () => void;
}

function Help({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="help">
      <button type="button" className="helpbtn" aria-expanded={open} aria-label="Ver definición" onClick={() => setOpen(!open)}>?</button>
      {open && <span className="helptext" role="note">{text}</span>}
    </span>
  );
}

export function Dashboard({ model, rows, filters, setFilters, notice, dismissNotice }: Props) {
  const ds = model.dataset;
  const cur = ds.currency;
  const [grain, setGrain] = useState<Grain>('month');
  const [topMode, setTopMode] = useState<'units' | 'sales'>('sales');
  const [branchCrit, setBranchCrit] = useState<'profit' | 'sales' | 'margin'>('profit');

  const k = useMemo(() => computeKpis(rows), [rows]);
  const series = useMemo(() => timeSeries(rows, grain), [rows, grain]);
  const prods = useMemo(() => byProduct(rows), [rows]);
  const cities = useMemo(() => byCity(rows).sort((a, b) => b.sales - a.sales), [rows]);
  const branches = useMemo(() => byBranch(rows), [rows]);
  const segs = useMemo(() => bySegment(rows).sort((a, b) => b.sales - a.sales), [rows]);
  const labels = useMemo(() => new Map(model.options.products.map((p) => [p.id, p.label])), [model]);
  const active = activeFilterLabels(filters, labels);
  const period = describePeriod(rows, filters, model.options.minDate, model.options.maxDate);
  const totalSales = k.sales ?? 0;
  const set = (p: Partial<Filters>) => setFilters({ ...filters, ...p });
  const o = model.options;

  const money = (v: number | null) => fmtMoney(v, cur);
  const pct = (v: number | null) => fmtPct(v);

  const kpiCards: { label: string; value: string; reason?: string; help: string }[] = [
    { label: 'Ventas totales', value: k.sales === null ? NA : money(k.sales), reason: k.reasons.sales, help: 'Suma del importe neto de cada línea de venta (ya con descuentos). Sin importe de línea se usa cantidad × precio efectivo; el precio de catálogo es solo una alternativa documentada.' },
    { label: 'Utilidad bruta', value: k.profit === null ? NA : money(k.profit), reason: k.reasons.profit ?? (k.costCoverage !== null && k.costCoverage < 1 ? `Parcial: costo conocido en ${fmtPct((k.costCoverage ?? 0) * 100, 1)} de las ventas` : undefined), help: 'Ventas totales menos costo vendido (cantidad × costo unitario). No es utilidad neta: no incluye gastos operativos, nómina, renta ni impuestos.' },
    { label: 'Margen bruto', value: k.margin === null ? (k.reasons.margin?.startsWith('No aplica') ? 'No aplica' : NA) : pct(k.margin), reason: k.margin === null ? k.reasons.margin : undefined, help: 'Utilidad bruta total ÷ ventas totales × 100. Se calcula sobre los totales; nunca es un promedio de porcentajes de filas o productos.' },
    { label: 'Ticket promedio', value: k.ticket === null ? (k.reasons.ticket?.startsWith('No aplica') ? 'No aplica' : NA) : money(k.ticket), reason: k.ticket === null ? k.reasons.ticket : undefined, help: 'Ventas de la selección ÷ transacciones distintas de la selección. Con filtro de producto, es el importe de los productos seleccionados por transacción que los contiene.' },
    { label: 'Clientes', value: fmtInt(k.customers), reason: `Con compras en la selección · registrados: ${fmtInt(model.quality.customersRegistered)}`, help: 'Clientes distintos con compras en la selección. Se diferencia del total de clientes registrados en el maestro. Las ventas sin cliente identificable no se cuentan como un cliente.' },
    { label: 'Transacciones', value: fmtInt(k.transactions), reason: model.quality.grain === 'fila_por_transaccion' ? 'Cada fila de ventas es una transacción' : 'Pedidos distintos (varias líneas = 1)', help: 'Cantidad de transacciones distintas. Un pedido con varias líneas cuenta una sola vez.' },
  ];

  const summary = () => {
    const t = [
      `Resumen San Francisco Crust Pizza — ${ds.isDemo ? 'DATOS DE DEMOSTRACIÓN' : 'datos reales del caso'}`,
      `Período: ${period} · Filtros: ${active.length ? active.join(' | ') : 'ninguno'}`,
      `Origen: ${Object.values(ds.sources).map((s) => s?.fileName).join(', ')} · Cargado: ${fmtDateTime(ds.createdAt)} · Versión ${ds.version} · Moneda ${cur}`,
      ...kpiCards.map((c) => `${c.label}: ${c.value}${c.reason ? ` (${c.reason})` : ''}`),
      costBasis(rows),
    ].join('\n');
    return navigator.clipboard?.writeText(t);
  };
  const [copied, setCopied] = useState(false);

  // ------- columnas de tablas -------
  const aggCols = (name: string): Col<Agg>[] => [
    { key: 'label', label: name, value: (a) => a.label },
    { key: 'sales', label: `Ventas (${cur})`, num: true, value: (a) => a.sales, render: (a) => money(a.sales) },
    { key: 'cost', label: `Costo (${cur})`, num: true, value: (a) => (a.profit === null ? null : a.cost), render: (a) => (a.profit === null ? NA : money(a.cost)) },
    { key: 'profit', label: `Utilidad bruta (${cur})`, num: true, value: (a) => a.profit, render: (a) => (a.profit === null ? NA : money(a.profit)) },
    { key: 'margin', label: 'Margen bruto (%)', num: true, value: (a) => a.margin, render: (a) => (a.margin === null ? 'No aplica' : pct(a.margin)) },
    { key: 'units', label: 'Unidades', num: true, value: (a) => a.units, render: (a) => fmtInt(a.units) },
    { key: 'tx', label: 'Transacciones', num: true, value: (a) => a.transactions, render: (a) => fmtInt(a.transactions) },
    { key: 'ticket', label: `Ticket (${cur})`, num: true, value: (a) => a.ticket, render: (a) => (a.ticket === null ? 'No aplica' : money(a.ticket)) },
  ];
  const segCols: Col<Agg>[] = [
    { key: 'label', label: 'Segmento', value: (a) => a.label },
    { key: 'sales', label: `Ventas (${cur})`, num: true, value: (a) => a.sales, render: (a) => money(a.sales) },
    { key: 'share', label: 'Participación (%)', num: true, value: (a) => (totalSales ? (a.sales / totalSales) * 100 : null), render: (a) => (totalSales ? pct((a.sales / totalSales) * 100) : 'No aplica') },
    { key: 'customers', label: 'Clientes', num: true, value: (a) => a.customers, render: (a) => fmtInt(a.customers) },
    { key: 'profit', label: `Utilidad bruta (${cur})`, num: true, value: (a) => a.profit, render: (a) => (a.profit === null ? NA : money(a.profit)) },
    { key: 'ticket', label: `Ticket (${cur})`, num: true, value: (a) => a.ticket, render: (a) => (a.ticket === null ? 'No aplica' : money(a.ticket)) },
  ];
  const cityCols: Col<Agg>[] = [
    { key: 'label', label: 'Ciudad', value: (a) => a.label },
    { key: 'sales', label: `Ventas (${cur})`, num: true, value: (a) => a.sales, render: (a) => money(a.sales) },
    { key: 'share', label: 'Participación (%)', num: true, value: (a) => (totalSales ? (a.sales / totalSales) * 100 : null), render: (a) => (totalSales ? pct((a.sales / totalSales) * 100) : 'No aplica') },
    { key: 'profit', label: `Utilidad bruta (${cur})`, num: true, value: (a) => a.profit, render: (a) => (a.profit === null ? NA : money(a.profit)) },
    { key: 'tx', label: 'Transacciones', num: true, value: (a) => a.transactions, render: (a) => fmtInt(a.transactions) },
  ];
  const serieCols: Col<Agg>[] = [
    { key: 'label', label: grain === 'month' ? 'Mes' : 'Fecha', value: (a) => a.key, render: (a) => (grain === 'month' ? fmtMonth(a.key) : fmtDay(a.key)) },
    { key: 'sales', label: `Ventas (${cur})`, num: true, value: (a) => a.sales, render: (a) => money(a.sales) },
    { key: 'profit', label: `Utilidad bruta (${cur})`, num: true, value: (a) => a.profit, render: (a) => (a.profit === null ? NA : money(a.profit)) },
    { key: 'margin', label: 'Margen bruto (%)', num: true, value: (a) => a.margin, render: (a) => (a.margin === null ? 'No aplica' : pct(a.margin)) },
    { key: 'tx', label: 'Transacciones', num: true, value: (a) => a.transactions, render: (a) => fmtInt(a.transactions) },
  ];

  const bestBy = (list: Agg[], f: (a: Agg) => number | null) => {
    const v = list.filter((a) => f(a) !== null);
    if (!v.length) return null;
    return [...v].sort((a, b) => (f(b) as number) - (f(a) as number));
  };
  const branchVal = (a: Agg) => (branchCrit === 'profit' ? a.profit : branchCrit === 'sales' ? a.sales : a.margin);
  const rankedBranches = bestBy(branches, branchVal);
  const critLabel = { profit: 'utilidad bruta', sales: 'ventas', margin: 'margen bruto' }[branchCrit];
  const fmtCrit = (a: Agg) => (branchCrit === 'margin' ? pct(a.margin) : money(branchVal(a)));
  const topProfit = bestBy(prods, (a) => a.profit);
  const topMargin = bestBy(prods, (a) => a.margin);
  const topUnits = bestBy(prods, (a) => a.units);
  const topSales = bestBy(prods, (a) => a.sales);

  const topItems = [...prods].sort((a, b) => (topMode === 'units' ? b.units - a.units : b.sales - a.sales)).slice(0, 10);

  if (ds.sales.length === 0) {
    return (
      <section className="panel empty">
        <h2>Aún no hay datos</h2>
        <p>La base de ventas está vacía. Vaya a la sección <strong>Datos</strong> para cargar los archivos o restaurar el conjunto inicial.</p>
      </section>
    );
  }

  return (
    <div className="dash">
      {notice && (
        <div className="banner info" role="status">
          <span>{notice}</span>
          <button className="btn small ghost" onClick={dismissNotice}>Entendido</button>
        </div>
      )}

      <section className="panel contextbar" aria-label="Contexto del análisis">
        <dl>
          <div><dt>Período analizado</dt><dd>{period}</dd></div>
          <div><dt>Moneda</dt><dd>{cur} (sin conversiones)</dd></div>
          <div><dt>Origen de los datos</dt><dd>{ds.isDemo ? 'Datos de demostración' : ds.origin === 'inicial' ? 'Datos reales del caso (conjunto inicial)' : 'Archivos cargados en este navegador'}</dd></div>
          <div><dt>Fecha de carga</dt><dd>{fmtDateTime(ds.createdAt)}</dd></div>
        </dl>
        <p className="chips" aria-label="Filtros activos">
          {active.length ? active.map((a) => <span className="chip" key={a}>{a}</span>) : <span className="muted">Sin filtros activos: se muestran todas las ventas.</span>}
        </p>
      </section>

      <section className="panel filters" aria-label="Filtros globales">
        <div className="field">
          <label htmlFor="df" className="lbl">Desde</label>
          <input id="df" type="date" min={o.minDate} max={o.maxDate} value={filters.dateFrom} onChange={(e) => set({ dateFrom: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="dt" className="lbl">Hasta</label>
          <input id="dt" type="date" min={o.minDate} max={o.maxDate} value={filters.dateTo} onChange={(e) => set({ dateTo: e.target.value })} />
        </div>
        <MultiSelect label="Ciudad" options={o.cities.map((c) => ({ id: c, label: c }))} value={filters.cities} onChange={(v) => set({ cities: v })} />
        <MultiSelect label="Sucursal" options={o.branches.map((c) => ({ id: c, label: c }))} value={filters.branches} onChange={(v) => set({ branches: v })} />
        <MultiSelect label="Segmento" options={o.segments.map((c) => ({ id: c, label: c }))} value={filters.segments} onChange={(v) => set({ segments: v })} />
        <MultiSelect label="Producto" options={o.products} value={filters.products} onChange={(v) => set({ products: v })} />
        <div className="field actions">
          <button className="btn" onClick={() => setFilters(EMPTY_FILTERS)} disabled={active.length === 0}>Limpiar filtros</button>
          <button className="btn ghost" onClick={async () => { await summary(); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? 'Copiado ✓' : 'Copiar resumen'}</button>
        </div>
      </section>

      {rows.length === 0 ? (
        <section className="panel empty" role="status">
          <h2>Sin resultados para esta combinación de filtros</h2>
          <p>Ninguna venta cumple a la vez: {active.join(' · ')}. Pruebe ampliar el rango de fechas o quitar algún filtro.</p>
          <button className="btn primary" onClick={() => setFilters(EMPTY_FILTERS)}>Limpiar filtros</button>
        </section>
      ) : (
        <>
          <section aria-label="Indicadores clave" className="kpis">
            {kpiCards.map((c) => (
              <article className="kpi" key={c.label}>
                <h3>{c.label} <Help text={c.help} /></h3>
                <p className="kpival">{c.value}</p>
                {c.reason && <p className="kpisub">{c.reason}</p>}
              </article>
            ))}
          </section>
          <p className="muted basis">{costBasis(rows)} {k.costEstimatedRows > 0 && <strong>La utilidad se estima con el costo actual del catálogo en {fmtInt(k.costEstimatedRows)} filas.</strong>}</p>

          <section className="panel" aria-labelledby="h-evol">
            <div className="sechead">
              <h2 id="h-evol">Evolución de ventas y utilidad</h2>
              <div className="seg" role="group" aria-label="Agrupación">
                <button className={grain === 'month' ? 'on' : ''} aria-pressed={grain === 'month'} onClick={() => setGrain('month')}>Mensual</button>
                <button className={grain === 'day' ? 'on' : ''} aria-pressed={grain === 'day'} onClick={() => setGrain('day')}>Diaria</button>
              </div>
            </div>
            <LineChart
              title={`Evolución ${grain === 'month' ? 'mensual' : 'diaria'} de ventas y utilidad bruta en ${cur}`}
              xs={series.map((s) => s.key)}
              series={[
                { name: 'Ventas', cls: 's1', values: series.map((s) => s.sales) },
                { name: 'Utilidad bruta', cls: 's2', values: series.map((s) => s.profit) },
              ]}
              xLabel={(x) => (grain === 'month' ? fmtMonth(x) : fmtDay(x))}
              yFormat={(v) => fmtCompactMoney(v, cur)}
              fmtTip={(v) => (v === null ? NA : money(v))}
              yTitle={`${cur} por ${grain === 'month' ? 'mes' : 'día'}`}
            />
            <details><summary>Ver tabla</summary>
              <DataTable caption="Evolución por fecha" rows={series} cols={serieCols} rowKey={(a) => a.key} defaultSort={{ key: 'label', dir: 'asc' }} csvName={`evolucion_${grain === 'month' ? 'mensual' : 'diaria'}.csv`} pageSize={12} />
            </details>
          </section>

          <section className="panel" aria-labelledby="h-top">
            <div className="sechead">
              <h2 id="h-top">Productos más vendidos</h2>
              <div className="seg" role="group" aria-label="Criterio">
                <button className={topMode === 'sales' ? 'on' : ''} aria-pressed={topMode === 'sales'} onClick={() => setTopMode('sales')}>Por ingresos</button>
                <button className={topMode === 'units' ? 'on' : ''} aria-pressed={topMode === 'units'} onClick={() => setTopMode('units')}>Por unidades</button>
              </div>
            </div>
            <BarChart
              title={`Top 10 productos ${topMode === 'units' ? 'por unidades vendidas' : 'por ingresos'}`}
              unit={topMode === 'units' ? 'unidades' : cur}
              cls={topMode === 'units' ? 's3' : 's1'}
              items={topItems.map((a) => ({ label: a.label, value: topMode === 'units' ? a.units : a.sales, text: topMode === 'units' ? `${fmtInt(a.units)} u.` : money(a.sales), sub: `Unidades ${fmtInt(a.units)} · Ingresos ${money(a.sales)}` }))}
            />
            <p className="muted">Más unidades no implica más rentabilidad: compare con la tabla siguiente.
              {topUnits && topSales && <> Más vendido por unidades: <strong>{topUnits[0].label}</strong> ({fmtInt(topUnits[0].units)}); por ingresos: <strong>{topSales[0].label}</strong> ({money(topSales[0].sales)}).</>}</p>
          </section>

          <section className="panel" aria-labelledby="h-rent">
            <h2 id="h-rent">Rentabilidad por producto</h2>
            {topProfit && topMargin && (
              <p className="callouts">
                <span><b>Mayor contribución de utilidad:</b> {topProfit[0].label} ({money(topProfit[0].profit)})</span>
                <span><b>Mayor margen porcentual:</b> {topMargin[0].label} ({pct(topMargin[0].margin)})</span>
                {topProfit.length > 1 && <span><b>Menor contribución de utilidad:</b> {topProfit[topProfit.length - 1].label} ({money(topProfit[topProfit.length - 1].profit)})</span>}
              </p>
            )}
            <DataTable caption="Rentabilidad por producto" rows={prods} cols={aggCols('Producto')} rowKey={(a) => a.key} defaultSort={{ key: 'profit', dir: 'desc' }} csvName="rentabilidad_por_producto.csv" />
          </section>

          <section className="panel" aria-labelledby="h-city">
            <h2 id="h-city">Ventas por ciudad</h2>
            <BarChart title={`Ventas por ciudad en ${cur}`} unit={cur} items={cities.map((a) => ({ label: a.label, value: a.sales, text: money(a.sales), sub: totalSales ? pct((a.sales / totalSales) * 100) : undefined }))} />
            <DataTable caption="Ventas por ciudad" rows={cities} cols={cityCols} rowKey={(a) => a.key} defaultSort={{ key: 'sales', dir: 'desc' }} csvName="ventas_por_ciudad.csv" />
          </section>

          <section className="panel" aria-labelledby="h-suc">
            <div className="sechead">
              <h2 id="h-suc">Desempeño por sucursal</h2>
              <label className="inline">Ordenar mejor/peor por
                <select value={branchCrit} onChange={(e) => setBranchCrit(e.target.value as typeof branchCrit)}>
                  <option value="profit">Utilidad bruta (criterio inicial)</option>
                  <option value="sales">Ventas</option>
                  <option value="margin">Margen bruto</option>
                </select>
              </label>
            </div>
            {rankedBranches && (
              <p className="callouts">
                <span><b>Mejor sucursal por {critLabel}:</b> {rankedBranches[0].label} ({fmtCrit(rankedBranches[0])})</span>
                {rankedBranches.length > 1 && <span><b>Peor sucursal por {critLabel}:</b> {rankedBranches[rankedBranches.length - 1].label} ({fmtCrit(rankedBranches[rankedBranches.length - 1])})</span>}
              </p>
            )}
            <BarChart title={`Sucursales por ${critLabel}`} unit={branchCrit === 'margin' ? '% de margen bruto' : cur} cls="s2"
              items={(rankedBranches ?? []).map((a) => ({ label: a.label, value: branchVal(a), text: fmtCrit(a), sub: `Ventas ${money(a.sales)} · Margen ${pct(a.margin)}` }))} />
            <DataTable caption="Desempeño por sucursal" rows={branches} cols={aggCols('Sucursal')} rowKey={(a) => a.key} defaultSort={{ key: branchCrit, dir: 'desc' }} csvName="desempeno_por_sucursal.csv" />
          </section>

          <section className="panel" aria-labelledby="h-seg">
            <h2 id="h-seg">Segmentos de cliente</h2>
            <BarChart title={`Ventas por segmento de cliente en ${cur}`} unit={cur} cls="s3" items={segs.map((a) => ({ label: a.label, value: a.sales, text: money(a.sales), sub: `${totalSales ? pct((a.sales / totalSales) * 100) + ' de las ventas · ' : ''}Clientes ${fmtInt(a.customers)}` }))} />
            <DataTable caption="Segmentos de cliente" rows={segs} cols={segCols} rowKey={(a) => a.key} defaultSort={{ key: 'sales', dir: 'desc' }} csvName="ventas_por_segmento.csv" />
          </section>
        </>
      )}
    </div>
  );
}
