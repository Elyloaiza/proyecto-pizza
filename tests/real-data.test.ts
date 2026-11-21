import assert from 'node:assert/strict';
import { test } from 'node:test';
import { datasetFromBuffers } from '../src/lib/dataset';
import { buildModel } from '../src/lib/model';
import { computeKpis } from '../src/lib/metrics';
import { bufOf, publicFile } from './helpers';

const f = (n: string) => ({ name: n + '.xlsx', buf: bufOf(publicFile(`datos-iniciales/San_Francisco_Crust_Pizza_${n}.xlsx`)) });

test('datos reales del enunciado: importación XLSX y KPIs coinciden con el cálculo independiente (pandas)', async () => {
  const ds = await datasetFromBuffers({ sales: f('Ventas'), customers: f('Clientes'), products: f('Productos') });
  assert.equal(ds.sales.length, 45900);
  assert.equal(ds.customers.length, 1000);
  assert.equal(ds.products.length, 44);
  assert.equal(ds.sales[0].id, 'V000001');
  assert.equal(ds.sales[0].date, '2024-01-28');
  assert.equal(ds.customers[0].id, 'C00001');
  const m = buildModel(ds);
  const k = computeKpis(m.rows);
  assert.ok(Math.abs(k.sales! - 1357881.66) < 0.01);
  assert.ok(Math.abs(k.cost! - 544167.9) < 0.01);
  assert.ok(Math.abs(k.profit! - 813713.76) < 0.01);
  assert.ok(Math.abs(k.margin! - 59.925233838) < 1e-6);
  assert.equal(k.transactions, 45900);
  assert.equal(k.customers, 1000);
  assert.equal(m.quality.salesCustomerNotFound, 0);
  assert.equal(m.quality.salesProductNotFound, 0);
  assert.equal(m.options.minDate, '2024-01-01');
  assert.equal(m.options.maxDate, '2025-12-28');
  assert.equal(m.options.branches.length, 8);
  assert.deepEqual(m.options.segments, ['Corporativo', 'Estudiante', 'Familiar', 'Profesional']);
});
