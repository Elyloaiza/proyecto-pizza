// Conversión de celdas a números y fechas. Nunca convierte vacíos en ceros.
import type { Cell, DateFormat, NumberFormat } from './types';

export type NumResult =
  | { ok: true; value: number }
  | { ok: false; empty: true }
  | { ok: false; empty: false; ambiguous?: boolean };

export function isEmpty(c: Cell | undefined): boolean {
  return c === null || c === undefined || (typeof c === 'string' && c.trim() === '');
}

function cleanNumberString(raw: string): { s: string; neg: boolean } {
  let s = raw.trim().replace(/[ \s']/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^(usd|us\$|eur|€|\$|£)/i, '').replace(/(usd|eur|€|\$|%)$/i, '');
  if (s.endsWith('-')) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  return { s, neg };
}

/** Clasifica una cadena numérica según sus separadores. */
export type SepKind = 'plain' | 'us' | 'eu' | 'ambiguous' | 'invalid';

export function classifyNumberString(raw: string): SepKind {
  const { s } = cleanNumberString(raw);
  const body = s.replace(/^[+-]/, '');
  if (!/^[\d.,]+$/.test(body) || !/\d/.test(body)) return 'invalid';
  const hasDot = body.includes('.');
  const hasComma = body.includes(',');
  if (!hasDot && !hasComma) return 'plain';
  if (hasDot && hasComma) {
    return body.lastIndexOf('.') > body.lastIndexOf(',') ? 'us' : 'eu';
  }
  const sep = hasDot ? '.' : ',';
  const parts = body.split(sep);
  if (parts.length > 2) {
    // 1.234.567 -> miles. Cualquier grupo posterior debe tener 3 dígitos
    return parts.slice(1).every((p) => p.length === 3) ? (sep === ',' ? 'us' : 'eu') : 'invalid';
  }
  const dec = parts[1];
  if (dec.length === 3 && parts[0].length >= 1 && parts[0].length <= 3 && parts[0] !== '0') return 'ambiguous';
  return sep === '.' ? 'us' : 'eu';
}

/** Detecta el formato numérico de una columna. Devuelve 'ambiguous' si hay que preguntar al usuario. */
export function detectNumberFormat(values: Cell[]): { format: 'us' | 'eu' | 'ambiguous' | 'mixed'; examples: string[] } {
  let us = 0;
  let eu = 0;
  let amb = 0;
  const examples: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string' || isEmpty(v)) continue;
    const k = classifyNumberString(v);
    if (k === 'us') us++;
    else if (k === 'eu') eu++;
    else if (k === 'ambiguous') {
      amb++;
      if (examples.length < 3) examples.push(v.trim());
    }
  }
  if (us && eu) return { format: 'mixed', examples };
  if (us) return { format: 'us', examples };
  if (eu) return { format: 'eu', examples };
  if (amb) return { format: 'ambiguous', examples };
  return { format: 'us', examples };
}

export function parseNumber(c: Cell | undefined, fmt: 'us' | 'eu'): NumResult {
  if (typeof c === 'number') return Number.isFinite(c) ? { ok: true, value: c } : { ok: false, empty: false };
  if (isEmpty(c)) return { ok: false, empty: true };
  const { s, neg } = cleanNumberString(String(c));
  let body = s.replace(/^\+/, '');
  let sign = 1;
  if (body.startsWith('-')) {
    sign = -1;
    body = body.slice(1);
  }
  if (!/^[\d.,]+$/.test(body) || !/\d/.test(body)) return { ok: false, empty: false };
  const thousands = fmt === 'us' ? ',' : '.';
  const decimal = fmt === 'us' ? '.' : ',';
  if (body.split(decimal).length > 2) return { ok: false, empty: false };
  const parts = body.split(decimal);
  const intPart = parts[0];
  if (intPart.includes(thousands)) {
    const groups = intPart.split(thousands);
    if (groups[0].length === 0 || groups[0].length > 3 || !groups.slice(1).every((g) => g.length === 3)) return { ok: false, empty: false };
  }
  const frac = parts[1] ?? '';
  if (frac.includes(thousands)) return { ok: false, empty: false };
  const n = Number(intPart.split(thousands).join('') + (frac ? '.' + frac : ''));
  if (!Number.isFinite(n)) return { ok: false, empty: false };
  return { ok: true, value: (neg ? -1 : 1) * sign * n };
}

// ---------------- Fechas ----------------

export type DateKind = 'iso' | 'dmy' | 'mdy' | 'ambiguous' | 'invalid';

const ISO_RE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/;
const SLASH_RE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[T\s].*)?$/;

function validYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function classifyDateString(raw: string): DateKind {
  const s = raw.trim();
  if (ISO_RE.test(s)) return 'iso';
  const m = SLASH_RE.exec(s);
  if (!m) return 'invalid';
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > 12 && b <= 12) return 'dmy';
  if (b > 12 && a <= 12) return 'mdy';
  if (a > 12 && b > 12) return 'invalid';
  return a === b ? 'dmy' : 'ambiguous'; // 05/05/2024 es igual en ambos órdenes
}

export function detectDateFormat(values: Cell[]): { format: Exclude<DateFormat, 'auto'> | 'ambiguous' | 'mixed'; examples: string[] } {
  let iso = 0;
  let dmy = 0;
  let mdy = 0;
  let amb = 0;
  const examples: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string' || isEmpty(v)) continue;
    const k = classifyDateString(v);
    if (k === 'iso') iso++;
    else if (k === 'dmy') dmy++;
    else if (k === 'mdy') mdy++;
    else if (k === 'ambiguous') {
      amb++;
      if (examples.length < 3) examples.push(v.trim());
    }
  }
  const kinds = [iso, dmy, mdy].filter((x) => x > 0).length;
  if (kinds > 1) return { format: 'mixed', examples };
  if (dmy) return { format: 'dmy', examples };
  if (mdy) return { format: 'mdy', examples };
  if (amb) return { format: 'ambiguous', examples };
  return { format: 'iso', examples };
}

/** Serial de Excel (sistema 1900) -> AAAA-MM-DD */
export function excelSerialToIso(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + Math.floor(serial) * 86400000);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export type DateResult = { ok: true; value: string; fromSerial?: boolean } | { ok: false; empty: boolean };

export function parseDate(c: Cell | undefined, fmt: Exclude<DateFormat, 'auto'>): DateResult {
  if (isEmpty(c)) return { ok: false, empty: true };
  if (typeof c === 'number') {
    const iso = excelSerialToIso(c);
    return iso ? { ok: true, value: iso, fromSerial: true } : { ok: false, empty: false };
  }
  const s = String(c).trim();
  const iso = ISO_RE.exec(s);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return validYmd(y, m, d) ? { ok: true, value: `${pad(y, 4)}-${pad(m)}-${pad(d)}` } : { ok: false, empty: false };
  }
  const sl = SLASH_RE.exec(s);
  if (!sl) return { ok: false, empty: false };
  if (fmt === 'iso') return { ok: false, empty: false };
  let a = Number(sl[1]);
  let b = Number(sl[2]);
  let y = Number(sl[3]);
  if (sl[3].length === 2) y += 2000;
  if (sl[3].length === 3) return { ok: false, empty: false };
  const [d, m] = fmt === 'dmy' ? [a, b] : [b, a];
  void a;
  void b;
  return validYmd(y, m, d) ? { ok: true, value: `${pad(y, 4)}-${pad(m)}-${pad(d)}` } : { ok: false, empty: false };
}
