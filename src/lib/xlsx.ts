// Lector XLSX mínimo (solo lectura) sobre JSZip. Independiente del DOM para poder probarse en Node.
// Cubre: hojas, cadenas compartidas, cadenas en línea, números, booleanos y fechas (por formato de celda).
// No evalúa fórmulas: usa el valor en caché que guarda Excel.
import JSZip from 'jszip';
import type { Cell, Table } from './types';
import { excelSerialToIso } from './parseValues';

export interface WorkbookInfo {
  sheets: string[];
}

interface Parsed {
  zip: JSZip;
  sheetPaths: Map<string, string>;
  names: string[];
  shared: string[];
  dateStyles: boolean[];
  date1904: boolean;
}

const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function unescapeXml(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e];
  });
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : undefined;
}

function colToIndex(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
  return n - 1;
}

function textOfSi(si: string): string {
  // Quita fonéticos y concatena todos los <t>
  const clean = si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out += m[1] ?? '';
  return unescapeXml(out);
}

function isDateFormatCode(code: string): boolean {
  const c = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[ymdhs]/i.test(c) && !/^(general|0|0\.0+|#,##0.*|0%.*)$/i.test(c);
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const f = zip.file(path);
  return f ? f.async('string') : null;
}

async function open(buf: ArrayBuffer | Uint8Array): Promise<Parsed> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error('El archivo no es un XLSX válido (no se pudo abrir el contenedor ZIP).');
  }
  const wbXml = await readText(zip, 'xl/workbook.xml');
  if (!wbXml) throw new Error('El archivo no parece un libro de Excel (falta xl/workbook.xml).');
  const relsXml = (await readText(zip, 'xl/_rels/workbook.xml.rels')) ?? '';
  const rels = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, ''));
  }
  const sheetPaths = new Map<string, string>();
  const names: string[] = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name');
    const rid = attr(m[0], 'r:id') ?? attr(m[0], 'id');
    if (name && rid && rels.get(rid)) {
      const n = unescapeXml(name);
      names.push(n);
      sheetPaths.set(n, rels.get(rid)!);
    }
  }
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wbXml);

  const shared: string[] = [];
  const ssXml = await readText(zip, 'xl/sharedStrings.xml');
  if (ssXml) for (const m of ssXml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) shared.push(textOfSi(m[1] ?? ''));

  const dateStyles: boolean[] = [];
  const stXml = await readText(zip, 'xl/styles.xml');
  if (stXml) {
    const custom = new Map<number, string>();
    for (const m of stXml.matchAll(/<numFmt\b[^>]*>/g)) {
      const id = Number(attr(m[0], 'numFmtId'));
      const code = attr(m[0], 'formatCode');
      if (!Number.isNaN(id) && code !== undefined) custom.set(id, unescapeXml(code));
    }
    const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stXml);
    if (cellXfs) {
      for (const m of cellXfs[1].matchAll(/<xf\b[^>]*>/g)) {
        const id = Number(attr(m[0], 'numFmtId') ?? 0);
        dateStyles.push(custom.has(id) ? isDateFormatCode(custom.get(id)!) : BUILTIN_DATE_IDS.has(id));
      }
    }
  }
  return { zip, sheetPaths, names, shared, dateStyles, date1904 };
}

export async function listSheets(buf: ArrayBuffer | Uint8Array): Promise<WorkbookInfo> {
  const p = await open(buf);
  return { sheets: p.names };
}

export interface ReadSheetOptions {
  /** Corta la lectura al superar este número de filas con datos (protección de memoria) */
  maxRows?: number;
}

export interface SheetResult {
  table: Table;
  truncated: boolean;
  totalRows: number;
  notes: string[];
}

export async function readSheet(buf: ArrayBuffer | Uint8Array, sheetName: string, opts: ReadSheetOptions = {}): Promise<SheetResult> {
  const p = await open(buf);
  const path = p.sheetPaths.get(sheetName);
  if (!path) throw new Error(`La hoja «${sheetName}» no existe en el archivo.`);
  const xml = await readText(p.zip, path);
  if (!xml) throw new Error(`No se pudo leer la hoja «${sheetName}».`);

  const rowsMap = new Map<number, Cell[]>();
  let maxCol = 0;
  let errorCells = 0;
  const notes: string[] = [];
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(xml))) {
    const a = m[1];
    const ref = /\br="([A-Z]+)(\d+)"/.exec(a);
    if (!ref) continue;
    const body = m[2];
    if (body === undefined) continue;
    const col = colToIndex(ref[1]);
    const rowN = Number(ref[2]);
    const t = attr(a, 't');
    const s = attr(a, 's');
    let value: Cell = null;
    if (t === 'inlineStr') {
      value = textOfSi(body);
    } else {
      const vm = /<v\b[^>]*?>([\s\S]*?)<\/v>/.exec(body);
      if (vm) {
        const raw = vm[1];
        if (t === 's') value = p.shared[Number(raw)] ?? null;
        else if (t === 'str') value = unescapeXml(raw);
        else if (t === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'e') {
          value = null;
          errorCells++;
        } else if (t === 'd') value = raw.slice(0, 10);
        else {
          const n = Number(raw);
          if (Number.isNaN(n)) value = raw;
          else if (s !== undefined && p.dateStyles[Number(s)]) value = excelSerialToIso(n, p.date1904) ?? n;
          else value = n;
        }
      }
    }
    if (value === null || (typeof value === 'string' && value === '')) continue;
    let row = rowsMap.get(rowN);
    if (!row) {
      row = [];
      rowsMap.set(rowN, row);
    }
    row[col] = value;
    if (col + 1 > maxCol) maxCol = col + 1;
  }
  if (errorCells) notes.push(`${errorCells} celdas con error de Excel (#N/A, #REF!, …) se leyeron como vacías.`);

  const rowNumbers = [...rowsMap.keys()].sort((x, y) => x - y);
  if (rowNumbers.length === 0) return { table: { sheet: sheetName, headers: [], rows: [], rowNumbers: [] }, truncated: false, totalRows: 0, notes };
  const headerRowN = rowNumbers[0];
  const headerRow = rowsMap.get(headerRowN)!;
  const headers: string[] = [];
  for (let i = 0; i < maxCol; i++) headers.push(headerRow[i] == null ? '' : String(headerRow[i]).trim());
  const dataRowNumbers = rowNumbers.slice(1);
  const limit = opts.maxRows ?? Infinity;
  const truncated = dataRowNumbers.length > limit;
  const use = truncated ? dataRowNumbers.slice(0, limit) : dataRowNumbers;
  const rows: Cell[][] = use.map((rn) => {
    const r = rowsMap.get(rn)!;
    const out: Cell[] = new Array(maxCol);
    for (let i = 0; i < maxCol; i++) out[i] = r[i] === undefined ? null : r[i];
    return out;
  });
  return { table: { sheet: sheetName, headers, rows, rowNumbers: use }, truncated, totalRows: dataRowNumbers.length, notes };
}
