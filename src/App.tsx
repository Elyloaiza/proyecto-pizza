import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Assistant } from './components/Assistant';
import { DataView } from './components/DataView';
import { Dashboard } from './components/Dashboard';
import { buildContext } from './lib/context';
import { emptyDataset, loadInitialDataset } from './lib/dataset';
import { activeFilterLabels, describePeriod, filterRows, reconcileFilters } from './lib/metrics';
import { buildModel } from './lib/model';
import { clearDataset, loadDataset, loadSettings, saveDataset, saveSettings } from './lib/storage';
import { DEFAULT_SETTINGS, EMPTY_FILTERS, type Dataset, type Filters, type Settings } from './lib/types';

type Tab = 'dashboard' | 'datos' | 'asistente';
const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'datos', label: 'Datos' },
  { id: 'asistente', label: 'Asistente IA' },
];
const tabFromHash = (): Tab => {
  const h = window.location.hash.replace('#/', '');
  return (TABS.find((t) => t.id === h)?.id ?? 'dashboard') as Tab;
};

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash());
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const h = () => setTab(tabFromHash());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  const persist = useCallback(async (ds: Dataset) => {
    try {
      await saveDataset(ds);
      setStorageNote(null);
    } catch {
      setStorageNote('No se pudo guardar en el almacenamiento del navegador (IndexedDB). Puede seguir trabajando, pero los cambios NO se conservarán al recargar la página.');
    }
  }, []);

  const init = useCallback(async () => {
    setLoadError(null);
    const s = await loadSettings();
    setSettingsState(s);
    try {
      let ds: Dataset | undefined;
      try {
        ds = await loadDataset();
      } catch {
        setStorageNote('El almacenamiento del navegador (IndexedDB) no está disponible: los datos solo se mantendrán en memoria y no se conservarán al recargar.');
      }
      if (!ds) {
        ds = await loadInitialDataset('', s);
        await persist(ds);
      }
      setDataset(ds);
    } catch (e) {
      setLoadError((e as Error).message);
      setDataset(emptyDataset(s));
    }
  }, [persist]);

  useEffect(() => {
    init();
  }, [init]);

  const model = useMemo(() => (dataset ? buildModel(dataset) : null), [dataset]);

  // Al cambiar el conjunto de datos se reajustan los filtros que ya no existen
  const lastVersion = useRef<string | null>(null);
  useEffect(() => {
    if (!model) return;
    if (lastVersion.current !== null && lastVersion.current !== model.dataset.version) {
      const { filters: f, removed } = reconcileFilters(filters, model.options);
      if (removed.length) {
        setFilters(f);
        setNotice(`Los datos cambiaron y algunos filtros ya no eran compatibles; se reajustaron: ${removed.join(', ')}.`);
      } else setNotice('Los datos se actualizaron: indicadores, gráficos y contexto del asistente se recalcularon.');
    }
    lastVersion.current = model.dataset.version;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  const rows = useMemo(() => (model ? filterRows(model.rows, filters) : []), [model, filters]);
  const labels = useMemo(() => new Map((model?.options.products ?? []).map((p) => [p.id, p.label])), [model]);

  const setSettings = (s: Settings) => {
    setSettingsState(s);
    saveSettings(s).catch(() => undefined);
  };

  const onCommit = useCallback(async (next: Dataset) => {
    await persist(next);
    setDataset(next);
  }, [persist]);

  const onRestore = useCallback(async () => {
    const ds = await loadInitialDataset('', settingsRef.current);
    try {
      await clearDataset();
    } catch {
      /* se informa en persist */
    }
    await persist(ds);
    setFilters(EMPTY_FILTERS);
    setDataset(ds);
  }, [persist]);

  const go = (t: Tab) => {
    window.location.hash = `#/${t}`;
    setTab(t);
  };

  const ds = dataset;
  return (
    <>
      <a className="skip" href="#main">Saltar al contenido</a>
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">🍕</span>
          <div>
            <h1>San Francisco Crust Pizza</h1>
            <p>Inteligencia de negocios · proyecto académico</p>
          </div>
        </div>
        <nav aria-label="Secciones">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>{t.label}</button>
          ))}
        </nav>
        {ds?.isDemo && <span className="badge demo" role="status">Datos de demostración</span>}
      </header>
      <main id="main">
        {!ds || !model ? (
          <section className="panel empty" role="status"><h2>Cargando datos…</h2><p>Leyendo y validando los archivos iniciales (unos segundos la primera vez).</p></section>
        ) : (
          <>
            {loadError && (
              <section className="banner warn" role="alert">
                <span><strong>No se pudo cargar el conjunto inicial:</strong> {loadError}</span>
                <button className="btn small" onClick={init}>Reintentar</button>
              </section>
            )}
            {storageNote && tab !== 'datos' && <p className="banner warn" role="alert">{storageNote}</p>}
            {tab === 'dashboard' && <Dashboard model={model} rows={rows} filters={filters} setFilters={setFilters} notice={notice} dismissNotice={() => setNotice(null)} />}
            {tab === 'datos' && <DataView model={model} settings={settings} setSettings={setSettings} onCommit={onCommit} onRestore={onRestore} storageNote={storageNote} />}
            <div hidden={tab !== 'asistente'}>
              <Assistant
                version={ds.version}
                filters={filters}
                filterLabels={activeFilterLabels(filters, labels)}
                period={describePeriod(rows, filters, model.options.minDate, model.options.maxDate)}
                getContext={() => buildContext(model, filters, rows)}
              />
            </div>
          </>
        )}
      </main>
      <footer>
        <p>Proyecto académico: sin autenticación ni base de datos remota. Los datos cargados viven solo en este navegador. La utilidad es <strong>bruta</strong> (no neta). Las respuestas del asistente son propuestas para valoración crítica.</p>
      </footer>
    </>
  );
}
