/** Crash-safe browser recovery snapshots for ViperCAD projects. */

export const AUTOSAVE_KEY = 'vipercad.autosave.v2';
const LEGACY_AUTOSAVE_KEY = 'vipercad.autosave.v1';
const DB_NAME = 'vipercad-recovery';
const STORE_NAME = 'snapshots';
const MAX_AUTOSAVES = 6;

export type AutosavePayload = {
  id: string;
  name: string;
  savedAt: number;
  project: string;
  kind: 'auto' | 'named';
};

export async function readAutosaves(): Promise<AutosavePayload[]> {
  try {
    const db = await openRecoveryDb();
    const records = await request<AutosavePayload[]>(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
    db.close();
    return records.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return readFallback();
  }
}

/** Compatibility helper: return the newest recovery snapshot. */
export async function readAutosave(): Promise<AutosavePayload | null> {
  return (await readAutosaves())[0] ?? null;
}

export async function writeAutosave(projectJson: string, name = 'Autosave'): Promise<boolean> {
  const now = Date.now();
  return writeSnapshot({
    id: `autosave:${now}`,
    name,
    savedAt: now,
    project: projectJson,
    kind: 'auto',
  });
}

export async function writeNamedAutosave(name: string, projectJson: string): Promise<boolean> {
  const safeName = name.trim() || 'Recovery point';
  return writeSnapshot({
    id: `named:${Date.now()}:${safeName}`,
    name: safeName,
    savedAt: Date.now(),
    project: projectJson,
    kind: 'named',
  });
}

export async function clearAutosave(id?: string): Promise<void> {
  try {
    const db = await openRecoveryDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    if (id) tx.objectStore(STORE_NAME).delete(id);
    else tx.objectStore(STORE_NAME).clear();
    await transactionDone(tx);
    db.close();
  } catch {
    const remaining = id ? readFallback().filter((item) => item.id !== id) : [];
    writeFallback(remaining);
  }
}

/** Clears rolling crash snapshots while preserving user-named recovery points. */
export async function clearAutomaticAutosaves(): Promise<void> {
  const snapshots = await readAutosaves();
  await Promise.all(snapshots.filter((item) => item.kind === 'auto').map((item) => clearAutosave(item.id)));
}

async function writeSnapshot(payload: AutosavePayload): Promise<boolean> {
  try {
    const db = await openRecoveryDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(payload);
    await transactionDone(tx);
    const records = await request<AutosavePayload[]>(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
    const autos = records.filter((item) => item.kind === 'auto').sort((a, b) => b.savedAt - a.savedAt);
    const expired = autos.slice(MAX_AUTOSAVES);
    if (expired.length) {
      const cleanup = db.transaction(STORE_NAME, 'readwrite');
      for (const item of expired) cleanup.objectStore(STORE_NAME).delete(item.id);
      await transactionDone(cleanup);
    }
    db.close();
    return true;
  } catch {
    const records = readFallback().filter((item) => item.id !== payload.id);
    records.unshift(payload);
    writeFallback([
      ...records.filter((item) => item.kind === 'named'),
      ...records.filter((item) => item.kind === 'auto').slice(0, MAX_AUTOSAVES),
    ]);
    return true;
  }
}

function openRecoveryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('savedAt', 'savedAt');
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('Could not open recovery storage'));
  });
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('Recovery storage request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Recovery storage transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('Recovery storage transaction aborted'));
  });
}

function readFallback(): AutosavePayload[] {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AutosavePayload[];
      if (Array.isArray(parsed)) return parsed.filter(validPayload).sort((a, b) => b.savedAt - a.savedAt);
    }
    const legacy = localStorage.getItem(LEGACY_AUTOSAVE_KEY);
    if (!legacy) return [];
    const parsed = JSON.parse(legacy) as Partial<AutosavePayload>;
    if (typeof parsed.savedAt !== 'number' || typeof parsed.project !== 'string') return [];
    return [{ id: 'autosave', name: 'Legacy autosave', savedAt: parsed.savedAt, project: parsed.project, kind: 'auto' }];
  } catch {
    return [];
  }
}

function writeFallback(payloads: AutosavePayload[]): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payloads));
    localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
  } catch {
    /* Ignore quota/private mode. */
  }
}

function validPayload(value: unknown): value is AutosavePayload {
  const item = value as Partial<AutosavePayload>;
  return !!item && typeof item.id === 'string' && typeof item.name === 'string' &&
    typeof item.savedAt === 'number' && typeof item.project === 'string' &&
    (item.kind === 'auto' || item.kind === 'named');
}

export function formatAutosaveTime(savedAt: number): string {
  try {
    return new Date(savedAt).toLocaleString();
  } catch {
    return 'unknown time';
  }
}
