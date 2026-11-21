import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyImports, ImportError } from '../src/lib/dataset';
import { computeKpis, filterRows, byBranch, reconcileFilters } from '../src/lib/metrics';
import { buildContext } from '../src/lib/context';
import { buildModel } from '../src/lib/model';
import { classifyDateString, detectDateFormat, detectNumberFormat, parseNumber, parseDate } from '../src/lib/parseValues';
import { DEFAULT_SETTINGS, EMPTY_FILTERS, type Filters } from '../src/lib/types';
import { datasetFromTexts, smallDataset, stage } from './helpers';

const close = (a: number | null, b: number, eps = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('caso conocido A/B/T1/T2: sin filtros', async () => {
  const m = buildModel(await smallDataset());
  const k = computeKpis(filterRows(m.rows, EMPTY_FILTERS));
  close(k.sales, 50);
  close(k.cost, 28);
  close(k.profit, 22);
  close(k.margin, 44);
  close(k.ticket, 25);
  assert.equal(k.customers, 2);
  assert.equal(k.transactions, 2); // T1 tiene dos líneas y cuenta una vez
  assert.equal(m.quality.grain, 'multilinea');
});

test('caso conocido: filtro por producto A (ticket = importe de A por transacción que lo contiene)', async () => {
  const m = buildModel(await smallDataset());
  const k = computeKpis(filterRows(m.rows, { ...EMPTY_FILTERS, products: ['A'] }));
  close(k.sales, 30);
  close(k.profit, 12);
  close(k.margin, 40);
  close(k.ticket, 15);
  assert.equal(k.transactions, 2);
});

test('cinco filtros combinados', async () => {
  const m = buildModel(await smallDataset());
  const f: Filters = { dateFrom: '2024-01-01', dateTo: '2024-01-05', cities: ['Dallas'], branches: ['Dallas Downtown'], segments: ['Familiar'], products: ['B'] };
  const k = computeKpis(filterRows(m.rows, f));
  close(k.sales, 20);
  assert.equal(k.transactions, 1);
  assert.equal(k.customers, 1);
});

test('selección vacía: sin NaN ni infinito', async () => {
  const m = buildModel(await smallDataset());
  const k = computeKpis(filterRows(m.rows, { ...EMPTY_FILTERS, cities: ['Nowhere'] }));
  assert.equal(k.sales, null);
  assert.equal(k.margin, null);
  assert.equal(k.ticket, null);
  assert.ok(k.reasons.margin);
});

test('ceros iniciales en identificadores (CSV) y relaciones incompletas', async () => {
  const ds = await datasetFromTexts({
    customers: 'ClienteID,Segmento\n007,VIP\n008,\n007,Duplicado\n',
    products: 'ProductoID,Producto,CostoUSD,PrecioVentaUSD\n001,Pizza,5,10\n001,Repetido,1,1\n',
    sales: 'VentaID,Fecha,ClienteID,ProductoID,Cantidad,Ciudad,Sucursal,VentaNeta,CostoUnitario\n' +
      'V1,2024-02-01,007,001,1,X,X1,10,5\nV2,2024-02-01,008,001,1,X,X1,10,5\nV3,2024-02-01,999,001,1,X,X1,10,5\nV4,2024-02-01,,001,1,X,X1,10,5\nV5,2024-02-01,007,777,1,X,X1,10,\n',
  });
  const dup = await stage('customers', 'c.csv', 'ClienteID,Segmento\n007,VIP\n007,Otro\n');
  assert.ok(dup.outcome.issues.some((i) => i.code === 'id_duplicado'), 'el duplicado se informa');
  assert.equal(ds.customers.length, 2, 'duplicado de maestro no se conserva');
  assert.equal(ds.customers[0].id, '007');
  const m = buildModel(ds);
  assert.equal(m.rows.length, 5, 'ninguna venta se elimina ni se multiplica');
  const k = computeKpis(m.rows);
  close(k.sales, 50);
  assert.equal(k.customers, 3, 'clientes 007, 008 y 999; el cliente vacío no cuenta como cliente');
  const seg = new Set(m.rows.map((r) => r.segment));
  assert.ok(seg.has('Sin clasificar') && seg.has('VIP'));
  assert.equal(m.quality.salesCustomerBlank, 1);
  assert.equal(m.quality.salesCustomerNotFound, 1);
  assert.equal(m.quality.salesProductNotFound, 1);
});

test('costo faltante: utilidad parcial, no se toma costo desconocido como cero', async () => {
  const ds = await datasetFromTexts({
    customers: 'ClienteID,Segmento\nC1,A\n',
    products: 'ProductoID,Producto,CostoUSD,PrecioVentaUSD\nP,Pizza,,10\n',
    sales: 'VentaID,Fecha,ClienteID,ProductoID,Cantidad,Ciudad,Sucursal,VentaNeta,CostoUnitario\nV1,2024-01-01,C1,P,1,X,S,10,4\nV2,2024-01-01,C1,P,1,X,S,10,\n',
  });
  const k = computeKpis(buildModel(ds).rows);
  close(k.sales, 20);
  close(k.cost, 4);
  close(k.profit, 6);
  close(k.margin, 60);
  close(k.costCoverage, 0.5);
  const none = computeKpis(buildModel(await datasetFromTexts({ customers: 'ClienteID,Segmento\nC1,A\n', products: 'ProductoID,Producto,CostoUSD,PrecioVentaUSD\nP,Pizza,,10\n', sales: 'VentaID,Fecha,ClienteID,ProductoID,Cantidad,Ciudad,Sucursal,VentaNeta\nV1,2024-01-01,C1,P,1,X,S,10\n' })).rows);
  assert.equal(none.profit, null);
  assert.equal(none.margin, null);
  assert.ok(none.reasons.profit?.includes('faltan costos'));
});

test('costo del catálogo como alternativa se marca como estimado', async () => {
  const ds = await datasetFromTexts({
    customers: 'ClienteID,Segmento\nC1,A\n',
    products: 'ProductoID,Producto,CostoUSD,PrecioVentaUSD\nP,Pizza,3,10\n',
    sales: 'VentaID,Fecha,ClienteID,ProductoID,Cantidad,Ciudad,Sucursal,VentaNeta\nV1,2024-01-01,C1,P,2,X,S,20\n',
  });
  const m = buildModel(ds);
  const k = computeKpis(m.rows);
  close(k.profit, 14);
  assert.equal(k.costEstimatedRows, 1);
  assert.equal(m.quality.costFromCatalog, 1);
});

test('importe derivado de precio × cantidad × (1 − descuento)', async () => {
  const ds = await datasetFromTexts({
    customers: 'ClienteID,Segmento\nC1,A\n',
    products: 'ProductoID,Producto,CostoUSD,PrecioVentaUSD\nP,Pizza,3,10\n',
    sales: 'VentaID,Fecha,ClienteID,ProductoID,Cantidad,Ciudad,Sucursal,PrecioUnitario,CostoUnitario,DescuentoPct\nV1,2024-01-01,C1,P,2,X,S,10,3,10\n',
  });
  close(computeKpis(buildModel(ds).rows).sales, 18);
});

test('archivo inválido: no se aplica nada y se conserva el estado previo', async () => {
  const base = await smallDataset();
  const bad = await stage('sales', 'mala.csv', 'Foo,Bar\n1,2\n');
  assert.equal(bad.outcome.ok, false);
  assert.ok(bad.outcome.issues.some((i) => i.code === 'campo_sin_mapear'));
  const before = JSON.stringify(base);
  assert.throws(() => applyImports(base, { sales: bad }, 'cargado', DEFAULT_SETTINGS), ImportError);
  assert.equal(JSON.stringify(base), before);
});

test('errores con referencia a fila: fecha inválida y cantidad no numérica', async () => {
  const bad = await stage('sales', 'x.csv', 'VentaID,Fecha,ClienteID,ProductoID,Cantidad,Ciudad,Sucursal,VentaNeta\nV1,2024-02-31,C1,P,1,X,S,10\nV2,2024-02-01,C1,P,abc,X,S,10\n');
  assert.equal(bad.outcome.ok, false);
  const f = bad.outcome.issues.find((i) => i.code === 'fecha_invalida')!;
  assert.deepEqual(f.rows, [2]);
  assert.ok(bad.outcome.issues.some((i) => i.code === 'cantidad_invalida' && i.rows?.[0] === 3));
});

test('reemplazar Ventas conserva Clientes/Productos y no acumula al recargar el mismo archivo', async () => {
  const base = await smallDataset();
  const again = await stage('sales', 'Ventas_prueba_demo.csv', 'VentaID,Fecha,ClienteID,ProductoID,Cantidad,Ciudad,Sucursal,PrecioUnitario,CostoUnitario\nT1,2024-01-05,C1,A,2,Dallas,Dallas Downtown,10,6\nT1,2024-01-05,C1,B,1,Dallas,Dallas Downtown,20,10\nT2,2024-01-06,C2,A,1,Austin,Austin North,10,6\n');
  const once = applyImports(base, { sales: again }, 'cargado', DEFAULT_SETTINGS);
  const twice = applyImports(once, { sales: again }, 'cargado', DEFAULT_SETTINGS);
  assert.equal(twice.sales.length, 3);
  assert.equal(twice.customers.length, base.customers.length);
  assert.equal(twice.products.length, base.products.length);
  assert.notEqual(twice.version, base.version);
  const nuevo = await stage('sales', 'otro.csv', 'VentaID,Fecha,ClienteID,ProductoID,Cantidad,Ciudad,Sucursal,PrecioUnitario,CostoUnitario\nZ1,2024-03-01,C1,B,3,Dallas,Dallas Downtown,20,10\n');
  const rep = applyImports(twice, { sales: nuevo }, 'cargado', DEFAULT_SETTINGS);
  close(computeKpis(buildModel(rep).rows).sales, 60);
});

test('formatos ambiguos obligan a elegir; con elección se resuelven', async () => {
  assert.equal(classifyDateString('03/04/2024'), 'ambiguous');
  assert.equal(classifyDateString('25/04/2024'), 'dmy');
  assert.equal(detectDateFormat(['03/04/2024', '05/06/2024']).format, 'ambiguous');
  assert.equal(detectDateFormat(['13/04/2024', '05/06/2024']).format, 'dmy');
  assert.equal(parseDate('03/04/2024', 'dmy').ok && (parseDate('03/04/2024', 'dmy') as { value: string }).value, '2024-04-03');
  assert.equal((parseDate('03/04/2024', 'mdy') as { value: string }).value, '2024-03-04');
  assert.equal(detectNumberFormat(['1,234', '2,500']).format, 'ambiguous');
  assert.equal(detectNumberFormat(['1.234,56']).format, 'eu');
  assert.equal(detectNumberFormat(['1,234.56']).format, 'us');
  assert.deepEqual(parseNumber('1.234,56', 'eu'), { ok: true, value: 1234.56 });
  assert.deepEqual(parseNumber('1,234', 'us'), { ok: true, value: 1234 });
  assert.deepEqual(parseNumber('', 'us'), { ok: false, empty: true });

  const csv = 'VentaID;Fecha;ClienteID;ProductoID;Cantidad;Ciudad;Sucursal;VentaNeta\nV1;03/04/2024;C1;P;1;X;S;1,234\n';
  const amb = await stage('sales', 'a.csv', csv);
  assert.equal(amb.outcome.ok, false);
  assert.ok(amb.outcome.needs.length >= 1);
  const { normalizeTable } = await import('../src/lib/importer');
  const { parseCsv } = await import('../src/lib/csv');
  const { bufOfText } = await import('./helpers');
  const t = parseCsv(bufOfText(csv)).table;
  const out = normalizeTable('sales', t, { ...amb.config, numberFormat: 'eu', dateFormat: 'dmy' }, { maxRows: 1000 });
  assert.equal(out.ok, true);
  assert.equal(out.sales[0].date, '2024-04-03');
  assert.equal(out.sales[0].lineAmount, 1.234);
});

test('límite de filas se rechaza con mensaje útil', async () => {
  const { normalizeTable } = await import('../src/lib/importer');
  const { parseCsv } = await import('../src/lib/csv');
  const { bufOfText } = await import('./helpers');
  const { proposeMapping } = await import('../src/lib/mapping');
  const t = parseCsv(bufOfText('VentaID,Fecha,ClienteID,ProductoID,Cantidad,Ciudad,Sucursal,VentaNeta\nV1,2024-01-01,C,P,1,X,S,1\nV2,2024-01-01,C,P,1,X,S,1\n')).table;
  const out = normalizeTable('sales', t, { mapping: proposeMapping('sales', t.headers), numberFormat: 'auto', dateFormat: 'auto' }, { maxRows: 1 });
  assert.equal(out.ok, false);
  assert.ok(out.issues.some((i) => i.code === 'limite_filas'));
});

test('reconciliar filtros tras reemplazar datos', async () => {
  const m = buildModel(await smallDataset());
  const { filters, removed } = reconcileFilters({ ...EMPTY_FILTERS, cities: ['Dallas', 'Fantasma'], dateFrom: '2030-01-01' }, m.options);
  assert.deepEqual(filters.cities, ['Dallas']);
  assert.equal(filters.dateFrom, '');
  assert.ok(removed.includes('ciudad') && removed.includes('fecha inicial'));
});

test('contexto de IA: mismas cifras que los KPIs, evidencias y sin datos personales', async () => {
  const ds = await smallDataset();
  const m = buildModel(ds);
  const rows = filterRows(m.rows, EMPTY_FILTERS);
  const ctx = buildContext(m, EMPTY_FILTERS, rows);
  const e1 = ctx.evidencias.find((e) => e.id === 'E1')!;
  assert.equal(e1.filas.find((r) => r[0] === 'ventas_totales')![1], 50);
  assert.equal(e1.filas.find((r) => r[0] === 'margen_bruto_pct')![1], 44);
  assert.equal(e1.filas.find((r) => r[0] === 'ticket_promedio')![1], 25);
  const ids = ctx.evidencias.map((e) => e.id);
  for (const id of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']) assert.ok(ids.includes(id));
  const sucursales = ctx.evidencias.find((e) => e.id === 'E5')!;
  const b = byBranch(rows).sort((a, c) => (c.profit ?? 0) - (a.profit ?? 0));
  assert.equal(sucursales.filas[0][0], b[0].label);
  const txt = JSON.stringify(ctx);
  assert.ok(!txt.includes('"C1"') && !txt.includes('"C2"'), 'el contexto no incluye identificadores de clientes');
  assert.ok(!('clientes' in ctx) && !('ventas' in ctx));
  assert.equal(ctx.version_datos, ds.version);
  // contexto filtrado coherente con vista filtrada
  const f = { ...EMPTY_FILTERS, products: ['A'] };
  const ctxA = buildContext(m, f, filterRows(m.rows, f));
  assert.equal(ctxA.evidencias[0].filas.find((r) => r[0] === 'ventas_totales')![1], 30);
  assert.ok(ctxA.filtros_activos[0].includes('Producto A'));
});
