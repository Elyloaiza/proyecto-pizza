import { useMemo, useState } from 'react';
import { applyImports, type Staged } from '../lib/dataset';
import { downloadDatasetZip } from '../lib/download';
import { fmtDateTime, fmtInt, fmtMoney } from '../lib/format';
import { computeKpis } from '../lib/metrics';
import { buildModel, qualityIssues, type Model } from '../lib/model';
import { costBasis } from '../lib/context';
import { FIELDS, KIND_LABEL } from '../lib/schema';
import type { Dataset, DatasetKind, Settings } from '../lib/types';
import { ImporterCard, IssueList } from './Importer';

const KINDS: DatasetKind[] = ['sales', 'customers', 'products'];

interface Props {
  model: Model;
  settings: Settings;
  setSettings: (s: Settings) => void;
  onCommit: (next: Dataset) => Promise<void>;
  onRestore: () => Promise<void>;
  storageNote: string | null;
}

export function DataView({ model, settings, setSettings, onCommit, onRestore, storageNote }: Props) {
  const ds = model.dataset;
  const [staged, setStaged] = useState<Partial<Record<DatasetKind, Staged>>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const onStage = (k: DatasetKind, s: Staged | null) =>
    setStaged((cur) => {
      const next = { ...cur };
      if (s) next[k] = s;
      else delete next[k];
      return next;
    });
  const prepared = KINDS.filter((k) => staged[k]);

  const candidate = useMemo(() => {
    if (!prepared.length) return null;
    try {
      const next = applyImports(ds, staged, 'cargado', settings);
      const m = buildModel(next);
      return { next, model: m, kpis: computeKpis(m.rows) };
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged, ds, settings]);
  const curKpis = useMemo(() => computeKpis(model.rows), [model]);

  const commit = async () => {
    if (!candidate) return;
    setBusy(true);
    try {
      await onCommit(candidate.next);
      setMsg({ ok: true, text: `Datos reemplazados (versión ${candidate.next.version}). Indicadores, gráficos y contexto del asistente ya usan el nuevo conjunto.` });
      setStaged({});
      setResetKey((n) => n + 1);
    } catch (e) {
      setMsg({ ok: false, text: `${(e as Error).message} Se conservaron los datos anteriores.` });
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    setConfirmRestore(false);
    try {
      await onRestore();
      setStaged({});
      setResetKey((n) => n + 1);
      setMsg({ ok: true, text: 'Se restauró el conjunto inicial incluido en el despliegue.' });
    } catch (e) {
      setMsg({ ok: false, text: `No se pudo restaurar: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const q = qualityIssues(model.quality, costBasis(model.rows));

  return (
    <div className="dataview">
      <section className="panel">
        <h2>Datos vigentes</h2>
        <p className="banner info flat">
          <span><strong>Cómo funcionan las cargas:</strong> los archivos que cargue actualizan <em>solo los datos de este navegador</em> (IndexedDB; sobreviven a recargar la página). Otros visitantes ven el conjunto inicial incluido en el despliegue. Publicar un nuevo conjunto inicial para todos requiere actualizar el despliegue; la aplicación no ofrece edición global compartida. Use «Descargar datos vigentes» para llevar sus datos a otro equipo.</span>
        </p>
        {storageNote && <p className="banner warn flat" role="alert">{storageNote}</p>}
        <dl className="srcs">
          <div><dt>Origen</dt><dd>{ds.isDemo ? 'Datos de demostración' : ds.origin === 'inicial' ? 'Datos reales del caso (conjunto inicial)' : 'Archivos cargados en este navegador'}</dd></div>
          <div><dt>Versión</dt><dd><code>{ds.version}</code></dd></div>
          <div><dt>Fecha de carga</dt><dd>{fmtDateTime(ds.createdAt)}</dd></div>
          <div><dt>Moneda</dt><dd>{ds.currency}</dd></div>
          {KINDS.map((k) => (
            <div key={k}>
              <dt>{KIND_LABEL[k]}</dt>
              <dd>
                {ds.sources[k] ? <>{ds.sources[k]!.fileName} <span className="muted">· hoja «{ds.sources[k]!.sheet}» · {fmtInt(k === 'sales' ? ds.sales.length : k === 'customers' ? ds.customers.length : ds.products.length)} filas</span></> : 'Sin datos'}
              </dd>
            </div>
          ))}
        </dl>
        <div className="row">
          {!confirmRestore ? (
            <button className="btn" disabled={busy} onClick={() => setConfirmRestore(true)}>Restaurar datos iniciales</button>
          ) : (
            <span className="banner warn flat">
              Se descartarán los datos cargados en este navegador y volverá el conjunto inicial.{' '}
              <button className="btn small primary" onClick={restore}>Sí, restaurar</button>{' '}
              <button className="btn small ghost" onClick={() => setConfirmRestore(false)}>Cancelar</button>
            </span>
          )}
          <button className="btn" disabled={ds.sales.length === 0} onClick={() => downloadDatasetZip(ds)}>Descargar datos vigentes (.zip)</button>
        </div>
        {msg && <p className={`banner ${msg.ok ? 'ok' : 'warn'} flat`} role="status">{msg.text}</p>}
        <h3>Calidad y alcance de los datos vigentes</h3>
        <IssueList issues={q} />
      </section>

      <section className="panel">
        <h2>Cargar o actualizar datos</h2>
        <p className="muted">Cada archivo (CSV o XLSX) reemplaza <strong>su propia base</strong>; las demás se conservan. Puede preparar varias y confirmarlas juntas. Volver a cargar el mismo archivo de Ventas no duplica ventas: la base se sustituye, nunca se acumula. Si una importación tiene errores, no se aplica y los datos anteriores quedan intactos.</p>
        <div className="importers" key={resetKey}>
          {KINDS.map((k) => <ImporterCard key={k} kind={k} settings={settings} onStage={onStage} staged={!!staged[k]} />)}
        </div>

        {prepared.length > 0 && (
          <div className="panel inner commit">
            <h3>Confirmar reemplazo</h3>
            <p>Se reemplazarán: <strong>{prepared.map((k) => KIND_LABEL[k]).join(', ')}</strong>. Se conservan: {KINDS.filter((k) => !prepared.includes(k)).map((k) => KIND_LABEL[k]).join(', ') || 'ninguna otra base'}.</p>
            {candidate && (
              <>
                <div className="scroll"><table className="cmp">
                  <thead><tr><th>Comparación</th><th className="num">Vigente</th><th className="num">Tras la carga</th></tr></thead>
                  <tbody>
                    <tr><td>Filas de ventas</td><td className="num">{fmtInt(ds.sales.length)}</td><td className="num">{fmtInt(candidate.next.sales.length)}</td></tr>
                    <tr><td>Período</td><td className="num">{model.options.minDate} a {model.options.maxDate}</td><td className="num">{candidate.model.options.minDate} a {candidate.model.options.maxDate}</td></tr>
                    <tr><td>Ventas totales ({ds.currency})</td><td className="num">{fmtMoney(curKpis.sales, ds.currency)}</td><td className="num">{fmtMoney(candidate.kpis.sales, ds.currency)}</td></tr>
                    <tr><td>Transacciones</td><td className="num">{fmtInt(curKpis.transactions)}</td><td className="num">{fmtInt(candidate.kpis.transactions)}</td></tr>
                  </tbody>
                </table></div>
                <h4>Relaciones y calidad tras la carga</h4>
                <IssueList issues={qualityIssues(candidate.model.quality, '').filter((i) => i.level === 'warning')} />
                <p className="muted">Los filtros que ya no apliquen se reajustarán y se le informará.</p>
              </>
            )}
            <div className="row">
              <button className="btn primary" disabled={!candidate || busy} onClick={commit}>{busy ? 'Aplicando…' : 'Confirmar y reemplazar'}</button>
              <button className="btn ghost" onClick={() => { setStaged({}); setResetKey((n) => n + 1); }}>Descartar todo</button>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Límites de importación y moneda</h2>
        <div className="row">
          <label className="inline">Tamaño máximo por archivo (MB)
            <input type="number" min={1} max={50} value={settings.maxFileMB} onChange={(e) => setSettings({ ...settings, maxFileMB: Math.max(1, Number(e.target.value) || 10) })} />
          </label>
          <label className="inline">Máx. filas de ventas
            <input type="number" min={1000} step={1000} value={settings.maxSalesRows} onChange={(e) => setSettings({ ...settings, maxSalesRows: Math.max(1000, Number(e.target.value) || 100000) })} />
          </label>
          <label className="inline">Moneda
            <input type="text" maxLength={3} size={4} value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} aria-describedby="moneda-help" />
          </label>
        </div>
        <p id="moneda-help" className="muted">Código ISO de 3 letras (USD por defecto; cámbielo si sus archivos indican otra moneda). Solo cambia la etiqueta de presentación: la aplicación no realiza conversiones de moneda. Se aplica en la siguiente carga.</p>
      </section>

      <section className="panel">
        <h2>Plantillas, ejemplos y diccionario de campos</h2>
        <div className="row">
          <a className="btn small" href="plantillas/plantilla_ventas.csv" download>Plantilla Ventas</a>
          <a className="btn small" href="plantillas/plantilla_clientes.csv" download>Plantilla Clientes</a>
          <a className="btn small" href="plantillas/plantilla_productos.csv" download>Plantilla Productos</a>
          <a className="btn small" href="plantillas/diccionario_de_campos.csv" download>Diccionario (CSV)</a>
        </div>
        <h3>Archivos de ejemplo</h3>
        <ul className="plain">
          <li><a href="ejemplos/Ventas_demo_actualizacion_2025.csv" download>Ventas_demo_actualizacion_2025.csv</a>: solo las ventas de 2025 del archivo real; al cargarlo, las ventas totales bajan (se sustituye, no se acumula) y aparece «Datos de demostración».</li>
          <li><a href="ejemplos/Ventas_demo_invalida.csv" download>Ventas_demo_invalida.csv</a>: contiene fechas, cantidades e identificadores inválidos; se rechaza con hoja y fila y se conservan los datos anteriores.</li>
          <li><a href="ejemplos/Ventas_demo_formatos_ambiguos.csv" download>Ventas_demo_formatos_ambiguos.csv</a>: fechas DD/MM o MM/DD y números europeos; el importador pide elegir el formato.</li>
          <li>Prueba pequeña con resultado conocido (ventas 50 USD, utilidad 22, margen 44 %): <a href="ejemplos/prueba_pequena/Ventas_prueba_demo.csv" download>Ventas</a> · <a href="ejemplos/prueba_pequena/Clientes_prueba_demo.csv" download>Clientes</a> · <a href="ejemplos/prueba_pequena/Productos_prueba_demo.csv" download>Productos</a> (cárguelos juntos).</li>
        </ul>
        <h3>Diccionario de campos</h3>
        <div className="scroll" tabIndex={0} role="region" aria-label="Diccionario de campos">
          <table className="dict">
            <thead><tr><th>Base</th><th>Campo</th><th>Obligatorio</th><th>Nombres reconocidos</th><th>Descripción</th></tr></thead>
            <tbody>
              {KINDS.flatMap((k) => FIELDS[k].map((f) => (
                <tr key={k + f.key}><td>{KIND_LABEL[k]}</td><td>{f.label}</td><td>{f.required ? 'Sí' : 'No'}</td><td>{f.synonyms.slice(0, 5).join(', ')}…</td><td>{f.help}</td></tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
