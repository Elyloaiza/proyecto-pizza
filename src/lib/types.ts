// Tipos compartidos del núcleo de datos. Sin dependencias de React ni del DOM.

export type DatasetKind = 'sales' | 'customers' | 'products';

export type Cell = string | number | null;

/** Tabla ya leída de un CSV o de una hoja XLSX. `rowNumbers` son números de fila 1-based del archivo original. */
export interface Table {
  sheet: string;
  headers: string[];
  rows: Cell[][];
  rowNumbers: number[];
}

export type NumberFormat = 'auto' | 'us' | 'eu';
export type DateFormat = 'auto' | 'iso' | 'dmy' | 'mdy';

export interface ImportConfig {
  /** field.key -> índice de columna (o null si no se mapea) */
  mapping: Record<string, number | null>;
  numberFormat: NumberFormat;
  dateFormat: DateFormat;
}

export interface Sale {
  /** Identificador de transacción tal como viene en el archivo */
  id: string;
  date: string; // YYYY-MM-DD
  customerId: string; // '' si no es identificable
  productId: string;
  qty: number;
  city: string;
  branch: string;
  lineAmount: number | null;
  unitPrice: number | null;
  discountPct: number | null;
  unitCost: number | null;
  lineCost: number | null;
  /** fila del archivo de origen (referencia para mensajes) */
  row: number;
}

export interface Customer {
  id: string;
  segment: string; // '' si no tiene
}

export interface Product {
  id: string;
  name: string;
  size: string;
  category: string;
  cost: number | null;
  price: number | null;
  active: string;
}

export interface SourceInfo {
  fileName: string;
  sheet: string;
  rows: number;
  loadedAt: string;
}

export interface Dataset {
  schema: 2;
  version: string;
  createdAt: string;
  origin: 'inicial' | 'cargado';
  isDemo: boolean;
  currency: string;
  sales: Sale[];
  customers: Customer[];
  products: Product[];
  sources: Partial<Record<DatasetKind, SourceInfo>>;
  configs: Partial<Record<DatasetKind, ImportConfig>>;
}

export interface Settings {
  maxFileMB: number;
  maxSalesRows: number;
  currency: string;
}

export const DEFAULT_SETTINGS: Settings = { maxFileMB: 10, maxSalesRows: 100000, currency: 'USD' };

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  sheet?: string;
  /** Hasta 8 ejemplos de filas afectadas (números de fila del archivo) */
  rows?: number[];
  count?: number;
  column?: string;
}

export interface Filters {
  dateFrom: string; // '' = sin límite
  dateTo: string;
  cities: string[];
  branches: string[];
  segments: string[];
  products: string[]; // IDs
}

export const EMPTY_FILTERS: Filters = { dateFrom: '', dateTo: '', cities: [], branches: [], segments: [], products: [] };

/** Fila de venta enriquecida con maestros, lista para filtrar y agregar. */
export interface SaleRow {
  tx: string;
  date: string;
  month: string; // YYYY-MM
  customerId: string; // '' = no identificable
  segment: string;
  productId: string;
  productLabel: string;
  city: string;
  branch: string;
  qty: number;
  amount: number | null;
  cost: number | null;
  costSource: 'venta' | 'catalogo' | null;
  amountSource: 'linea' | 'precio' | 'catalogo' | null;
}

export const UNCLASSIFIED = 'Sin clasificar';
