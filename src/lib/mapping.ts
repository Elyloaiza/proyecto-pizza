import { FIELDS, normalizeHeader } from './schema';
import type { DatasetKind } from './types';

/** Propone un mapeo campo -> columna comparando nombres equivalentes (es/en). Cada columna se usa una sola vez. */
export function proposeMapping(kind: DatasetKind, headers: string[]): Record<string, number | null> {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: Record<string, number | null> = {};
  for (const f of FIELDS[kind]) {
    let found: number | null = null;
    // el orden de sinónimos expresa prioridad (p. ej. «productoid» antes que «producto»)
    for (const syn of f.synonyms) {
      const idx = norm.findIndex((h, i) => h === syn && !used.has(i));
      if (idx >= 0) {
        found = idx;
        break;
      }
    }
    if (found !== null) used.add(found);
    mapping[f.key] = found;
  }
  return mapping;
}

/** Encabezados repetidos o vacíos reciben un sufijo para poder elegirlos en los selectores. */
export function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h, i) => {
    const base = h || `(columna ${i + 1})`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
}
