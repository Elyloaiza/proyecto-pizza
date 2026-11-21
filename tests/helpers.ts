import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { autoImport, applyImports, emptyDataset, type Staged } from '../src/lib/dataset';
import { buildModel } from '../src/lib/model';
import { DEFAULT_SETTINGS, type Dataset, type DatasetKind } from '../src/lib/types';

const here = dirname(fileURLToPath(import.meta.url));
export const fixture = (n: string) => join(here, 'fixtures', n);
export const publicFile = (n: string) => join(here, '..', 'public', n);

export function bufOf(path: string): ArrayBuffer {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
export function bufOfText(text: string): ArrayBuffer {
  const b = Buffer.from(text, 'utf8');
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

export async function stage(kind: DatasetKind, name: string, text: string): Promise<Staged> {
  return autoImport(kind, name, bufOfText(text), DEFAULT_SETTINGS);
}

export async function datasetFromTexts(t: { sales: string; customers: string; products: string }): Promise<Dataset> {
  const staged = {
    customers: await stage('customers', 'c.csv', t.customers),
    products: await stage('products', 'p.csv', t.products),
    sales: await stage('sales', 'v.csv', t.sales),
  };
  return applyImports(emptyDataset(), staged, 'cargado', DEFAULT_SETTINGS, 1_700_000_000_000);
}

export async function smallDataset(): Promise<Dataset> {
  const r = (n: string) => readFileSync(fixture(n), 'utf8');
  return datasetFromTexts({ sales: r('Ventas_prueba_demo.csv'), customers: r('Clientes_prueba_demo.csv'), products: r('Productos_prueba_demo.csv') });
}

export const modelOf = (d: Dataset) => buildModel(d);
