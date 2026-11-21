// Lectura de CSV: detección de codificación y separador, con los parsers de d3-dsv.
import { dsvFormat } from 'd3-dsv';
import type { Cell, Table } from './types';

export type Delimiter = 'auto' | ',' | ';' | '\t' | '|';

export function decodeBytes(buf: ArrayBuffer | Uint8Array): { text: string; encoding: string } {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text: text.replace(/^﻿/, ''), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' };
  }
}

const CANDIDATES: Exclude<Delimiter, 'auto'>[] = [',', ';', '\t', '|'];

export function detectDelimiter(text: string): Exclude<Delimiter, 'auto'> {
  const sample = text.split(/\r?\n/).slice(0, 40).join('\n');
  let best: Exclude<Delimiter, 'auto'> = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const rows = dsvFormat(d).parseRows(sample).filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ''));
    if (rows.length === 0) continue;
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    let modeLen = 0;
    let modeFreq = 0;
    for (const [len, f] of counts) if (f > modeFreq || (f === modeFreq && len > modeLen)) [modeLen, modeFreq] = [len, f];
    if (modeLen < 2) continue;
    const score = (modeFreq / rows.length) * 1000 + modeLen;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export interface CsvResult {
  table: Table;
  delimiter: Exclude<Delimiter, 'auto'>;
  encoding: string;
  totalRows: number;
  truncated: boolean;
}

export function parseCsv(buf: ArrayBuffer | Uint8Array, opts: { delimiter?: Delimiter; maxRows?: number; sheetName?: string } = {}): CsvResult {
  const { text, encoding } = decodeBytes(buf);
  const delimiter = !opts.delimiter || opts.delimiter === 'auto' ? detectDelimiter(text) : opts.delimiter;
  const all = dsvFormat(delimiter).parseRows(text);
  // número de fila 1-based tal como lo vería el usuario en el archivo (aprox. por registros)
  const rowNumbers: number[] = [];
  const rows: Cell[][] = [];
  let headers: string[] = [];
  let headerFound = false;
  let totalRows = 0;
  let truncated = false;
  const limit = opts.maxRows ?? Infinity;
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    const blank = r.every((c) => c.trim() === '');
    if (blank) continue;
    if (!headerFound) {
      headers = r.map((h) => h.trim());
      headerFound = true;
      continue;
    }
    totalRows++;
    if (rows.length >= limit) {
      truncated = true;
      continue;
    }
    const cells: Cell[] = headers.map((_, j) => (r[j] === undefined || r[j] === '' ? null : r[j]));
    rows.push(cells);
    rowNumbers.push(i + 1);
  }
  return { table: { sheet: opts.sheetName ?? 'CSV', headers, rows, rowNumbers }, delimiter, encoding, totalRows, truncated };
}
