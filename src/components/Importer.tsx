import { useEffect, useRef, useState } from 'react';
import type { Delimiter } from '../lib/csv';
import { inspectFile, readTable, ImportError, type LoadedFile, type Staged, type TableRead } from '../lib/dataset';
import { normalizeTable, type ImportOutcome } from '../lib/importer';
import { proposeMapping, uniqueHeaders } from '../lib/mapping';
import { FIELDS, KIND_LABEL } from '../lib/schema';
import type { DatasetKind, DateFormat, ImportConfig, Issue, NumberFormat, Settings } from '../lib/types';

export function IssueList({ issues, sheet }: { issues: Issue[]; sheet?: string }) {
  if (issues.length === 0) return null;
  const icon = { error: '⛔', warning: '⚠️', info: 'ℹ️' } as const;
  const label = { error: 'Error', warning: 'Advertencia', info: 'Información' } as const;
  return (
    <ul className="issues">
      {issues.map((i, n) => (
        <li key={i.code + n} className={`issue ${i.level}`}>
          <span aria-hidden="true">{icon[i.level]}</span> <strong>{label[i.level]}:</strong> {i.message}
          {i.rows && i.rows.length > 0 && (
            <span className="muted"> Hoja «{i.sheet ?? sheet}», fila{i.rows.length > 1 ? 's' : ''} {i.rows.join(', ')}{(i.count ?? 0) > i.rows.length ? ` … (${(i.count ?? 0).toLocaleString('es-US')} en total)` : ''}.</span>
          )}
          {(!i.rows || i.rows.length === 0) && (i.count ?? 0) > 1 && <span className="muted"> ({(i.count ?? 0).toLocaleString('es-US')} casos)</span>}
        </li>
      ))}
    </ul>
  );
}

interface Props {
  kind: DatasetKind;
  settings: Settings;
  onStage: (k: DatasetKind, s: Staged | null) => void;
  staged: boolean;
}

export function ImporterCard({ kind, settings, onStage, staged }: Props) {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [sheet, setSheet] = useState('');
  const [delimiter, setDelimiter] = useState<Delimiter>('auto');
  const [read, setRead] = useState<TableRead | null>(null);
  const [config, setConfig] = useState<ImportConfig | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const maxRows = kind === 'sales' ? settings.maxSalesRows : 100000;
  const fields = FIELDS[kind];

  const load = async (f: LoadedFile, sh: string, d: Delimiter) => {
    setBusy(true);
    setError(null);
    try {
      const r = await readTable(f, sh, { delimiter: d, maxRows: maxRows + 1 });
      setRead(r);
      setConfig((prev) => ({ mapping: proposeMapping(kind, r.table.headers), numberFormat: prev?.numberFormat ?? 'auto', dateFormat: prev?.dateFormat ?? 'auto' }));
    } catch (e) {
      setRead(null);
      setConfig(null);
      setOutcome(null);
      onStage(kind, null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (f: File | undefined | null) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    onStage(kind, null);
    setOutcome(null);
    setConfig(null); // un archivo nuevo vuelve a formatos «Automático»
    setDelimiter('auto');
    try {
      const buf = await f.arrayBuffer();
      const lf = await inspectFile(f.name, buf, settings);
      setFile(lf);
      setSheet(lf.sheets[0]);
      await load(lf, lf.sheets[0], 'auto');
    } catch (e) {
      setFile(null);
      setRead(null);
      setConfig(null);
      setError(e instanceof ImportError || e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    } finally {
      setBusy(false);
    }
  };

  // Validar cada vez que cambian la tabla o el mapeo/formatos
  useEffect(() => {
    if (!read || !config || !file) return;
    const out = normalizeTable(kind, read.table, config, { maxRows });
    setOutcome(out);
    onStage(kind, out.ok ? { outcome: out, config, source: { fileName: file.name, sheet: read.table.sheet, rows: read.table.rows.length, loadedAt: new Date().toISOString() } } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, config, maxRows]);

  const headers = read ? uniqueHeaders(read.table.headers) : [];
  const errors = outcome?.issues.filter((i) => i.level === 'error') ?? [];

  const clear = () => {
    setFile(null);
    setRead(null);
    setConfig(null);
    setOutcome(null);
    setError(null);
    onStage(kind, null);
    if (input.current) input.current.value = '';
  };

  return (
    <article className={`panel importer ${staged ? 'staged' : ''}`} aria-labelledby={`imp-${kind}`}>
      <div className="sechead">
        <h3 id={`imp-${kind}`}>{KIND_LABEL[kind]}</h3>
        {staged && <span className="badge ok">Listo para confirmar</span>}
        {outcome && !outcome.ok && <span className="badge bad">Con errores</span>}
      </div>

      <div
        className={`drop ${drag ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void pick(e.dataTransfer.files?.[0]); }}
      >
        <p>Arrastre aquí un archivo CSV o XLSX de <strong>{KIND_LABEL[kind]}</strong> o</p>
        <label className="btn">
          Elegir archivo
          <input ref={input} type="file" accept=".csv,.xlsx,.txt,.tsv" className="sr-only" data-kind={kind} aria-label={`Archivo de ${KIND_LABEL[kind]}`} onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        {file && <p className="muted">{file.name} · {(file.size / 1024).toFixed(0)} KB <button className="btn small ghost" onClick={clear}>Quitar</button></p>}
        {busy && <p role="status">Leyendo archivo…</p>}
      </div>

      {error && <div className="banner error" role="alert">{error}</div>}

      {file && read && config && (
        <>
          <div className="row">
            {file.type === 'xlsx' && (
              <div className="field">
                <label className="lbl" htmlFor={`sh-${kind}`}>Hoja</label>
                <select id={`sh-${kind}`} value={sheet} onChange={(e) => { setSheet(e.target.value); void load(file, e.target.value, delimiter); }}>
                  {file.sheets.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            )}
            {file.type === 'csv' && (
              <div className="field">
                <label className="lbl" htmlFor={`dl-${kind}`}>Separador</label>
                <select id={`dl-${kind}`} value={delimiter} onChange={(e) => { const d = e.target.value as Delimiter; setDelimiter(d); void load(file, sheet, d); }}>
                  <option value="auto">Automático{read.delimiter ? ` (${read.delimiter === '\t' ? 'tabulador' : read.delimiter})` : ''}</option>
                  <option value=",">Coma ( , )</option><option value=";">Punto y coma ( ; )</option><option value={'\t'}>Tabulador</option><option value="|">Barra ( | )</option>
                </select>
              </div>
            )}
            <div className="field">
              <label className="lbl" htmlFor={`nf-${kind}`}>Formato de números</label>
              <select id={`nf-${kind}`} value={config.numberFormat} onChange={(e) => setConfig({ ...config, numberFormat: e.target.value as NumberFormat })}>
                <option value="auto">Automático</option><option value="us">1,234.56 (coma miles, punto decimal)</option><option value="eu">1.234,56 (punto miles, coma decimal)</option>
              </select>
            </div>
            {fields.some((f) => f.type === 'date') && (
              <div className="field">
                <label className="lbl" htmlFor={`df-${kind}`}>Formato de fechas</label>
                <select id={`df-${kind}`} value={config.dateFormat} onChange={(e) => setConfig({ ...config, dateFormat: e.target.value as DateFormat })}>
                  <option value="auto">Automático</option><option value="iso">AAAA-MM-DD</option><option value="dmy">Día/Mes/Año</option><option value="mdy">Mes/Día/Año</option>
                </select>
              </div>
            )}
          </div>
          {read.encoding && read.encoding !== 'UTF-8' && <p className="muted">Codificación detectada: {read.encoding}.</p>}
          {read.notes.map((n) => <p key={n} className="muted">{n}</p>)}

          <h4>Vista previa ({read.table.rows.length.toLocaleString('es-US')} filas, {read.table.headers.length} columnas)</h4>
          <div className="scroll" tabIndex={0} role="region" aria-label={`Vista previa de ${KIND_LABEL[kind]}`}>
            <table className="preview">
              <thead><tr><th>Fila</th>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {read.table.rows.slice(0, 6).map((r, i) => (
                  <tr key={i}><td className="muted">{read.table.rowNumbers[i]}</td>{r.map((c, j) => <td key={j}>{c === null ? '' : String(c)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4>Asignación de columnas</h4>
          <p className="muted">Se propone por nombres equivalentes en español e inglés. Corrija lo que haga falta.</p>
          <div className="mapgrid">
            {fields.map((f) => (
              <div key={f.key} className="field">
                <label className="lbl" htmlFor={`map-${kind}-${f.key}`}>{f.label}{f.required ? ' *' : ''}</label>
                <select id={`map-${kind}-${f.key}`} value={config.mapping[f.key] ?? ''} onChange={(e) => setConfig({ ...config, mapping: { ...config.mapping, [f.key]: e.target.value === '' ? null : Number(e.target.value) } })}>
                  <option value="">— sin asignar —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select>
                <span className="hint">{f.help}</span>
              </div>
            ))}
          </div>

          {outcome && outcome.needs.length > 0 && (
            <div className="banner warn" role="alert">
              <strong>Hace falta su decisión:</strong>
              {outcome.needs.map((n, i) => (
                <p key={i}>
                  {n.kind === 'number' ? 'Los números' : 'Las fechas'} de {n.fields.join(', ')} {n.reason === 'mixed' ? 'mezclan formatos' : 'son ambiguos'}
                  {n.examples.length ? ` (por ejemplo: ${n.examples.join(', ')})` : ''}. Elija el formato de {n.kind === 'number' ? 'números' : 'fechas'} arriba.
                </p>
              ))}
            </div>
          )}

          {outcome && (
            <>
              <h4>Validación</h4>
              {errors.length === 0 && outcome.needs.length === 0 && <p className="okmsg">✔ Sin errores. {outcome.rowsRead.toLocaleString('es-US')} filas leídas.</p>}
              <IssueList issues={outcome.issues} sheet={read.table.sheet} />
            </>
          )}
        </>
      )}
    </article>
  );
}
