// IndexedDB mínimo (clave-valor). Un solo registro «dataset» se reemplaza de forma atómica (una transacción).
import type { Dataset, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

const DB_NAME = 'sfcp-bi';
const STORE = 'kv';
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no está disponible en este navegador.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir IndexedDB.'));
    req.onblocked = () => reject(new Error('IndexedDB bloqueada por otra pestaña.'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = run(t.objectStore(STORE));
    let value: T;
    r.onsuccess = () => {
      value = r.result;
    };
    t.oncomplete = () => resolve(value);
    t.onerror = () => reject(t.error ?? new Error('Error de almacenamiento.'));
    t.onabort = () => reject(t.error ?? new Error('Transacción abortada (¿cuota excedida?).'));
  });
}

export const loadDataset = () => tx<Dataset | undefined>('readonly', (s) => s.get('dataset')).then((d) => (d && d.schema === 2 ? d : undefined));
export const saveDataset = (d: Dataset) => tx('readwrite', (s) => s.put(d, 'dataset')).then(() => undefined);
export const clearDataset = () => tx('readwrite', (s) => s.delete('dataset')).then(() => undefined);

export async function loadSettings(): Promise<Settings> {
  try {
    const s = await tx<Settings | undefined>('readonly', (st) => st.get('settings'));
    return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export const saveSettings = (s: Settings) => tx('readwrite', (st) => st.put(s, 'settings')).then(() => undefined);
