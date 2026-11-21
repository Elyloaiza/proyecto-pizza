// Normalización y validación de una tabla leída. Función pura: no toca el estado de la aplicación.
import { FIELDS, KIND_LABEL } from './schema';
import { detectDateFormat, detectNumberFormat, isEmpty, parseDate, parseNumber } from './parseValues';
import type { Cell, Customer, DatasetKind, ImportConfig, Issue, Product, Sale, Table } from './types';

export interface FormatNeed {
  kind: 'number' | 'date';
  fields: string[];
  examples: string[];
  reason: 'ambiguous' | 'mixed';
}

export interface ImportOutcome {
  kind: DatasetKind;
  ok: boolean;
  sales: Sale[];
  customers: Customer[];
  products: Product[];
  rowsRead: number;
  issues: Issue[];
  needs: FormatNeed[];
  resolved: { numberFormat: 'us' | 'eu'; dateFormat: 'iso' | 'dmy' | 'mdy' };
}

class Collector {
  private map = new Map<string, Issue>();
  constructor(private sheet: string) {}
  add(level: Issue['level'], code: string, message: string, row?: number, column?: string) {
    const key = level + code + (column ?? '');
    let it = this.map.get(key);
    if (!it) {
      it = { level, code, message, sheet: this.sheet, rows: [], count: 0, column };
      this.map.set(key, it);
    }
    it.count = (it.count ?? 0) + 1;
    if (row !== undefined && (it.rows?.length ?? 0) < 8) it.rows!.push(row);
  }
  list(): Issue[] {
    const order = { error: 0, warning: 1, info: 2 } as const;
    return [...this.map.values()].sort((a, b) => order[a.level] - order[b.level]);
  }
}

const str = (c: Cell | undefined): string => (c === null || c === undefined ? '' : String(c).trim());

export function normalizeTable(kind: DatasetKind, table: Table, cfg: ImportConfig, limits: { maxRows: number }): ImportOutcome {
  const fields = FIELDS[kind];
  const label = KIND_LABEL[kind];
  const col = new Collector(table.sheet);
  const outcome: ImportOutcome = {
    kind,
    ok: false,
    sales: [],
    customers: [],
    products: [],
    rowsRead: table.rows.length,
    issues: [],
    needs: [],
    resolved: { numberFormat: 'us', dateFormat: 'iso' },
  };
  const finish = (): ImportOutcome => {
    outcome.issues = col.list();
    outcome.ok = !outcome.issues.some((i) => i.level === 'error') && outcome.needs.length === 0;
    return outcome;
  };

  // 1) Mapeo
  const colOf = (k: string): number | null => {
    const v = cfg.mapping[k];
    return v === null || v === undefined || v < 0 || v >= table.headers.length ? null : v;
  };
  for (const f of fields) {
    if (f.required && colOf(f.key) === null) col.add('error', 'campo_sin_mapear', `Falta asignar una columna al campo obligatorio «${f.label}» de ${label}.`);
  }
  if (kind === 'sales' && colOf('lineAmount') === null && colOf('unitPrice') === null) {
    col.add('error', 'sin_importe', 'Ventas necesita «Importe de línea» o «Precio unitario» para calcular las ventas.');
  }
  const usedCols = new Map<number, string>();
  for (const f of fields) {
    const c = colOf(f.key);
    if (c === null) continue;
    if (usedCols.has(c)) col.add('warning', 'columna_repetida', `La columna «${table.headers[c]}» está asignada a más de un campo («${usedCols.get(c)}» y «${f.label}»).`);
    else usedCols.set(c, f.label);
  }
  if (table.rows.length === 0) col.add('error', 'sin_filas', `La hoja «${table.sheet}» no tiene filas de datos debajo del encabezado.`);
  if (table.rows.length > limits.maxRows) col.add('error', 'limite_filas', `El archivo tiene ${table.rows.length.toLocaleString('es')} filas y el límite configurado es ${limits.maxRows.toLocaleString('es')}. Divida el archivo o aumente el límite en «Límites de importación».`);
  if (outcome.issues.length || col.list().some((i) => i.level === 'error')) return finish();

  // 2) Formatos numéricos y de fecha
  const numFields = fields.filter((f) => (f.type === 'number' || f.type === 'pct') && colOf(f.key) !== null);
  const dateFields = fields.filter((f) => f.type === 'date' && colOf(f.key) !== null);
  let numFmt: 'us' | 'eu' = 'us';
  if (cfg.numberFormat === 'auto') {
    const found = new Set<string>();
    const amb: string[] = [];
    const exs: string[] = [];
    let mixed = false;
    for (const f of numFields) {
      const c = colOf(f.key)!;
      const d = detectNumberFormat(table.rows.map((r) => r[c]));
      if (d.format === 'ambiguous') {
        amb.push(f.label);
        exs.push(...d.examples);
      } else if (d.format === 'mixed') {
        mixed = true;
        amb.push(f.label);
        exs.push(...d.examples);
      } else found.add(d.format);
    }
    if (found.size > 1) mixed = true;
    if (mixed || amb.length) {
      outcome.needs.push({ kind: 'number', fields: amb.length ? amb : numFields.map((f) => f.label), examples: exs.slice(0, 4), reason: mixed ? 'mixed' : 'ambiguous' });
      col.add('error', 'formato_numero', 'No se pudo determinar con certeza el formato de los números (separador decimal y de miles). Elija el formato en el importador.');
    }
    numFmt = found.has('eu') ? 'eu' : 'us';
  } else numFmt = cfg.numberFormat;

  let dateFmt: 'iso' | 'dmy' | 'mdy' = 'iso';
  if (cfg.dateFormat === 'auto') {
    for (const f of dateFields) {
      const c = colOf(f.key)!;
      const d = detectDateFormat(table.rows.map((r) => r[c]));
      if (d.format === 'ambiguous' || d.format === 'mixed') {
        outcome.needs.push({ kind: 'date', fields: [f.label], examples: d.examples, reason: d.format });
        col.add('error', 'formato_fecha', `Las fechas de «${f.label}» son ambiguas (¿día/mes o mes/día?). Elija el formato en el importador.`);
      } else dateFmt = d.format;
    }
  } else dateFmt = cfg.dateFormat;
  outcome.resolved = { numberFormat: numFmt, dateFormat: dateFmt };
  if (outcome.needs.length) return finish();

  // 3) Filas
  const name = (k: string) => table.headers[colOf(k)!] || k;
  const get = (r: Cell[], k: string): Cell | undefined => {
    const c = colOf(k);
    return c === null ? undefined : r[c];
  };
  const idText = (r: Cell[], k: string, rowN: number, flag: { numeric: number }): string => {
    const v = get(r, k);
    if (typeof v === 'number') {
      flag.numeric++;
      return String(v);
    }
    void rowN;
    return str(v);
  };
  const flag = { numeric: 0 };
  const optNum = (r: Cell[], k: string, rowN: number): number | null => {
    if (colOf(k) === null) return null;
    const v = parseNumber(get(r, k), numFmt);
    if (v.ok) return v.value;
    if (!v.empty) col.add('error', 'numero_invalido', `Valores no numéricos en «${name(k)}».`, rowN, name(k));
    return null;
  };

  if (kind === 'sales') {
    const out: Sale[] = [];
    const seenIds = new Map<string, number>();
    for (let i = 0; i < table.rows.length; i++) {
      const r = table.rows[i];
      const rowN = table.rowNumbers[i];
      const id = idText(r, 'id', rowN, flag);
      if (!id) {
        col.add('error', 'id_vacio', `Filas sin «${name('id')}»: no se puede identificar la transacción.`, rowN, name('id'));
        continue;
      }
      const dt = parseDate(get(r, 'date'), dateFmt);
      let date = '';
      if (!dt.ok) col.add('error', dt.empty ? 'fecha_vacia' : 'fecha_invalida', dt.empty ? `Filas sin «${name('date')}».` : `Fechas no válidas en «${name('date')}» para el formato ${dateFmt.toUpperCase()}.`, rowN, name('date'));
      else date = dt.value;
      const productId = idText(r, 'productId', rowN, flag);
      if (!productId) col.add('error', 'producto_vacio', `Filas sin «${name('productId')}».`, rowN, name('productId'));
      const customerId = idText(r, 'customerId', rowN, flag);
      if (!customerId) col.add('warning', 'cliente_vacio', `Ventas sin «${name('customerId')}»: se conservan pero sin cliente identificable (no cuentan como un único cliente).`, rowN, name('customerId'));
      const q = parseNumber(get(r, 'qty'), numFmt);
      let qty = 0;
      if (!q.ok) col.add('error', q.empty ? 'cantidad_vacia' : 'cantidad_invalida', q.empty ? `Filas sin «${name('qty')}».` : `Cantidades no numéricas en «${name('qty')}».`, rowN, name('qty'));
      else {
        qty = q.value;
        if (qty <= 0) col.add('warning', 'cantidad_no_positiva', `Cantidades cero o negativas en «${name('qty')}»: se conservan con su signo (se interpretan como ajuste o devolución).`, rowN, name('qty'));
      }
      let city = str(get(r, 'city'));
      if (!city) {
        city = 'Sin ciudad';
        col.add('warning', 'ciudad_vacia', `Filas sin «${name('city')}»: se agrupan como «Sin ciudad».`, rowN, name('city'));
      }
      let branch = str(get(r, 'branch'));
      if (!branch) {
        branch = 'Sin sucursal';
        col.add('warning', 'sucursal_vacia', `Filas sin «${name('branch')}»: se agrupan como «Sin sucursal».`, rowN, name('branch'));
      }
      const lineAmount = optNum(r, 'lineAmount', rowN);
      const unitPrice = optNum(r, 'unitPrice', rowN);
      const unitCost = optNum(r, 'unitCost', rowN);
      const lineCost = optNum(r, 'lineCost', rowN);
      const discountPct = optNum(r, 'discountPct', rowN);
      if (discountPct !== null && (discountPct < 0 || discountPct > 100)) col.add('warning', 'descuento_fuera_de_rango', `Descuentos fuera de 0–100 en «${name('discountPct')}».`, rowN, name('discountPct'));
      if (lineAmount !== null && lineAmount < 0) col.add('warning', 'importe_negativo', `Importes negativos en «${name('lineAmount')}»: se conservan con su signo (devoluciones).`, rowN, name('lineAmount'));
      if (lineAmount === null && unitPrice === null) col.add('warning', 'sin_importe_fila', 'Filas sin importe ni precio: se usará el precio de catálogo si existe; de lo contrario, la venta quedará sin importe.', rowN);
      seenIds.set(id, (seenIds.get(id) ?? 0) + 1);
      out.push({ id, date, customerId, productId, qty, city, branch, lineAmount, unitPrice, discountPct, unitCost, lineCost, row: rowN });
    }
    let multi = 0;
    for (const n of seenIds.values()) if (n > 1) multi++;
    if (multi) col.add('info', 'transaccion_multilinea', `${multi.toLocaleString('es')} identificadores de transacción aparecen en varias filas: se tratan como pedidos de varias líneas (una transacción cada uno).`);
    else col.add('info', 'grano_una_fila', `Cada «${name('id')}» aparece una sola vez: el archivo trae una línea de producto por transacción, así que cada fila cuenta como una transacción.`);
    outcome.sales = out;
  } else if (kind === 'customers') {
    const seen = new Set<string>();
    for (let i = 0; i < table.rows.length; i++) {
      const r = table.rows[i];
      const rowN = table.rowNumbers[i];
      const id = idText(r, 'id', rowN, flag);
      if (!id) {
        col.add('error', 'id_vacio', `Filas sin «${name('id')}».`, rowN, name('id'));
        continue;
      }
      if (seen.has(id)) {
        col.add('warning', 'id_duplicado', 'Identificadores de cliente duplicados: se conserva la primera aparición para no multiplicar ventas al relacionar.', rowN, name('id'));
        continue;
      }
      seen.add(id);
      const segment = str(get(r, 'segment'));
      if (!segment) col.add('warning', 'segmento_vacio', 'Clientes sin segmento: sus ventas se agrupan como «Sin clasificar».', rowN, name('segment'));
      outcome.customers.push({ id, segment });
    }
  } else {
    const seen = new Set<string>();
    for (let i = 0; i < table.rows.length; i++) {
      const r = table.rows[i];
      const rowN = table.rowNumbers[i];
      const id = idText(r, 'id', rowN, flag);
      if (!id) {
        col.add('error', 'id_vacio', `Filas sin «${name('id')}».`, rowN, name('id'));
        continue;
      }
      if (seen.has(id)) {
        col.add('warning', 'id_duplicado', 'Identificadores de producto duplicados: se conserva la primera aparición para no multiplicar ventas al relacionar.', rowN, name('id'));
        continue;
      }
      seen.add(id);
      const cost = optNum(r, 'cost', rowN);
      const price = optNum(r, 'price', rowN);
      if (cost === null) col.add('warning', 'costo_faltante', 'Productos sin costo: su utilidad no podrá calcularse con el catálogo.', rowN, name('cost'));
      if (price === null) col.add('warning', 'precio_faltante', 'Productos sin precio de catálogo.', rowN, name('price'));
      let pname = str(get(r, 'name'));
      if (!pname) {
        pname = id;
        col.add('warning', 'nombre_vacio', 'Productos sin nombre: se muestra su identificador.', rowN, name('name'));
      }
      outcome.products.push({ id, name: pname, size: str(get(r, 'size')), category: str(get(r, 'category')), cost, price, active: str(get(r, 'active')) });
    }
  }
  if (flag.numeric > 0) {
    col.add('warning', 'id_numerico', `${flag.numeric.toLocaleString('es')} identificadores llegaron como números. Si tenían ceros iniciales, ya se perdieron en el archivo: dé formato de texto a esa columna.`);
  }
  return finish();
}
