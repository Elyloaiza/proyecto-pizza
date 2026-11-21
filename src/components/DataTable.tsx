import { useMemo, useState, type ReactNode } from 'react';
import { downloadText, toCsv } from '../lib/download';

export interface Col<T> {
  key: string;
  label: string;
  num?: boolean;
  /** valor para ordenar y exportar */
  value: (r: T) => string | number | null;
  render?: (r: T) => ReactNode;
  help?: string;
}

interface Props<T> {
  caption: string;
  rows: T[];
  cols: Col<T>[];
  rowKey: (r: T) => string;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  csvName?: string;
  pageSize?: number;
  empty?: string;
}

export function DataTable<T>({ caption, rows, cols, rowKey, defaultSort, csvName, pageSize = 15, empty = 'Sin filas para mostrar.' }: Props<T>) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const c = cols.find((x) => x.key === sort.key);
    if (!c) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = c.value(a);
      const vb = c.value(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // vacíos siempre al final
      if (vb === null) return -1;
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'es')) * dir;
    });
  }, [rows, cols, sort]);
  const shown = all ? sorted : sorted.slice(0, pageSize);
  return (
    <div className="tablewrap">
      <div className="tablebar">
        <span className="muted">{rows.length.toLocaleString('es-US')} filas</span>
        {csvName && rows.length > 0 && (
          <button className="btn small" onClick={() => downloadText(csvName, toCsv(cols.map((c) => c.label), sorted.map((r) => cols.map((c) => c.value(r)))))}>
            Descargar CSV
          </button>
        )}
      </div>
      <div className="scroll" tabIndex={0} role="region" aria-label={caption}>
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {cols.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" className={c.num ? 'num' : ''} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button className="thbtn" title={c.help} onClick={() => setSort({ key: c.key, dir: active && sort!.dir === 'desc' ? 'asc' : 'desc' })}>
                      {c.label}
                      <span aria-hidden="true">{active ? (sort!.dir === 'asc' ? ' ▲' : ' ▼') : ' ↕'}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={cols.length} className="muted">{empty}</td>
              </tr>
            )}
            {shown.map((r) => (
              <tr key={rowKey(r)}>
                {cols.map((c) => (
                  <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : String(c.value(r) ?? '—')}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > pageSize && (
        <button className="btn small ghost" onClick={() => setAll(!all)}>{all ? 'Mostrar menos' : `Mostrar las ${sorted.length} filas`}</button>
      )}
    </div>
  );
}
