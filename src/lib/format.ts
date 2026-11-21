export const NA = 'No disponible';

export function fmtMoney(v: number | null | undefined, currency = 'USD', digits = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  try {
    return new Intl.NumberFormat('es-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  } catch {
    return `${v.toFixed(digits)} ${currency}`;
  }
}
export function fmtCompactMoney(v: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('es-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(v);
  } catch {
    return String(Math.round(v));
  }
}
export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  return new Intl.NumberFormat('es-US', { maximumFractionDigits: 0 }).format(v);
}
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return NA;
  return `${new Intl.NumberFormat('es-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)} %`;
}
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('es-US', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}
export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}
export const round2 = (v: number | null): number | null => (v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
export const round1 = (v: number | null): number | null => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
