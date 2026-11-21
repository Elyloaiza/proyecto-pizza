// Lectura de archivos, ensamblaje de conjuntos de datos y reemplazo atómico.
import { parseCsv, type Delimiter } from './csv';
import { normalizeTable, type ImportOutcome } from './importer';
import { proposeMapping } from './mapping';
import { KIND_LABEL } from './schema';
import type { Dataset, DatasetKind, ImportConfig, Settings, SourceInfo, Table } from './types';
import { DEFAULT_SETTINGS } from './types';
import { listSheets, readSheet } from './xlsx';

export interface LoadedFile {
  name: string;
  size: number;
  type: 'csv' | 'xlsx';
  buf: ArrayBuffer;
  sheets: string[];
}

export class ImportError extends Error {}

export async function inspectFile(name: string, buf: ArrayBuffer, settings: Settings): Promise<LoadedFile> {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const max = settings.maxFileMB * 1024 * 1024;
  if (buf.byteLength > max) {
    throw new ImportError(`El archivo pesa ${(buf.byteLength / 1048576).toFixed(1)} MB y el límite configurado es ${settings.maxFileMB} MB. Reduzca el archivo o aumente el límite en «Límites de importación».`);
  }
  if (buf.byteLength === 0) throw new ImportError('El archivo está vacío.');
  if (ext === 'xlsx') {
    const { sheets } = await listSheets(buf).catch((e: Error) => {
      throw new ImportError(e.message);
    });
    if (sheets.length === 0) throw new ImportError('El libro no contiene hojas legibles.');
    return { name, size: buf.byteLength, type: 'xlsx', buf, sheets };
  }
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') return { name, size: buf.byteLength, type: 'csv', buf, sheets: ['CSV'] };
  throw new ImportError(`Formato «.${ext}» no admitido. Use archivos CSV o XLSX (los .xls antiguos deben guardarse como XLSX).`);
}

export interface TableRead {
  table: Table;
  notes: string[];
  totalRows: number;
  truncated: boolean;
  delimiter?: string;
  encoding?: string;
}

export async function readTable(file: LoadedFile, sheet: string, opts: { delimiter?: Delimiter; maxRows: number }): Promise<TableRead> {
  if (file.type === 'csv') {
    const r = parseCsv(file.buf, { delimiter: opts.delimiter, maxRows: opts.maxRows });
    return { table: r.table, notes: [], totalRows: r.totalRows, truncated: r.truncated, delimiter: r.delimiter, encoding: r.encoding };
  }
  const r = await readSheet(file.buf, sheet, { maxRows: opts.maxRows });
  return { table: r.table, notes: r.notes, totalRows: r.totalRows, truncated: r.truncated };
}

export function emptyDataset(settings: Settings = DEFAULT_SETTINGS): Dataset {
  return { schema: 2, version: 'vacio', createdAt: new Date().toISOString(), origin: 'inicial', isDemo: false, currency: settings.currency, sales: [], customers: [], products: [], sources: {}, configs: {} };
}

export interface Staged {
  outcome: ImportOutcome;
  config: ImportConfig;
  source: SourceInfo;
}

export function newVersion(ds: Pick<Dataset, 'sales'>, now = Date.now()): string {
  return `v${now.toString(36)}-${ds.sales.length}`;
}

/** Aplica varias sustituciones a la vez. Si alguna tiene errores, no se aplica ninguna. Devuelve un conjunto nuevo (el anterior no se muta). */
export function applyImports(base: Dataset, staged: Partial<Record<DatasetKind, Staged>>, origin: Dataset['origin'], settings: Settings, now = Date.now()): Dataset {
  const bad = (Object.keys(staged) as DatasetKind[]).filter((k) => !staged[k]!.outcome.ok);
  if (bad.length) throw new ImportError(`No se aplicó ningún cambio: ${bad.map((k) => KIND_LABEL[k]).join(', ')} tiene errores pendientes. Se conservan los datos anteriores.`);
  const next: Dataset = { ...base, sources: { ...base.sources }, configs: { ...base.configs } };
  if (staged.sales) {
    next.sales = staged.sales.outcome.sales; // sustituye, nunca acumula
    next.sources.sales = staged.sales.source;
    next.configs.sales = staged.sales.config;
  }
  if (staged.customers) {
    next.customers = staged.customers.outcome.customers;
    next.sources.customers = staged.customers.source;
    next.configs.customers = staged.customers.config;
  }
  if (staged.products) {
    next.products = staged.products.outcome.products;
    next.sources.products = staged.products.source;
    next.configs.products = staged.products.config;
  }
  next.origin = origin;
  next.currency = settings.currency;
  next.createdAt = new Date(now).toISOString();
  next.isDemo = Object.values(next.sources).some((s) => s && /demo/i.test(s.fileName));
  next.version = newVersion(next, now);
  return next;
}

/** Importación automática (mapeo propuesto, formatos automáticos). La usan el conjunto inicial y las pruebas. */
export async function autoImport(kind: DatasetKind, name: string, buf: ArrayBuffer, settings: Settings, sheet?: string): Promise<Staged> {
  const file = await inspectFile(name, buf, settings);
  const sh = sheet ?? file.sheets[0];
  const read = await readTable(file, sh, { maxRows: kind === 'sales' ? settings.maxSalesRows + 1 : 100001 });
  const config: ImportConfig = { mapping: proposeMapping(kind, read.table.headers), numberFormat: 'auto', dateFormat: 'auto' };
  const outcome = normalizeTable(kind, read.table, config, { maxRows: kind === 'sales' ? settings.maxSalesRows : 100000 });
  return { outcome, config, source: { fileName: name, sheet: sh, rows: read.table.rows.length, loadedAt: new Date().toISOString() } };
}

export async function datasetFromBuffers(files: Record<DatasetKind, { name: string; buf: ArrayBuffer }>, settings: Settings = DEFAULT_SETTINGS, origin: Dataset['origin'] = 'inicial'): Promise<Dataset> {
  const staged: Partial<Record<DatasetKind, Staged>> = {};
  for (const k of ['customers', 'products', 'sales'] as DatasetKind[]) staged[k] = await autoImport(k, files[k].name, files[k].buf, settings);
  return applyImports(emptyDataset(settings), staged, origin, settings);
}

export const INITIAL_FILES: Record<DatasetKind, string> = {
  sales: 'datos-iniciales/San_Francisco_Crust_Pizza_Ventas.xlsx',
  customers: 'datos-iniciales/San_Francisco_Crust_Pizza_Clientes.xlsx',
  products: 'datos-iniciales/San_Francisco_Crust_Pizza_Productos.xlsx',
};

export async function loadInitialDataset(baseUrl: string, settings: Settings = DEFAULT_SETTINGS): Promise<Dataset> {
  const files = {} as Record<DatasetKind, { name: string; buf: ArrayBuffer }>;
  for (const k of Object.keys(INITIAL_FILES) as DatasetKind[]) {
    const res = await fetch(baseUrl + INITIAL_FILES[k]);
    if (!res.ok) throw new Error(`No se pudo cargar el conjunto inicial de ${KIND_LABEL[k]} (HTTP ${res.status}).`);
    files[k] = { name: INITIAL_FILES[k].split('/').pop()!, buf: await res.arrayBuffer() };
  }
  return datasetFromBuffers(files, settings, 'inicial');
}
