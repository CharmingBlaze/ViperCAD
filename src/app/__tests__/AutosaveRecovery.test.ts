import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOSAVE_KEY,
  PROMPT_RECOVERY_KEY,
  RECOVERY_DISMISSED_AT_KEY,
  clearAutosave,
  clearAutomaticAutosaves,
  readAutosaves,
  readRecoveryDismissedAt,
  rememberRecoveryDismissed,
  shouldOfferRecoveryPrompt,
  writeAutosave,
  writeEmergencyAutosave,
  writeNamedAutosave,
} from '@/app/autosave';

describe('autosave recovery system', () => {
  const store = new Map<string, string>();

  const fakeStorage: Storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => {
      store.set(key, String(val));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };

  beforeEach(async () => {
    store.clear();
    vi.stubGlobal('localStorage', fakeStorage);
    await clearAutosave();
  });

  afterEach(async () => {
    await clearAutosave();
    store.clear();
    vi.unstubAllGlobals();
  });

  it('treats a missing recovery-prompt key as unset', () => {
    expect(localStorage.getItem(PROMPT_RECOVERY_KEY)).toBeNull();
  });

  it('allows toggling startup recovery prompt preference in localStorage', () => {
    localStorage.setItem(PROMPT_RECOVERY_KEY, 'true');
    expect(localStorage.getItem(PROMPT_RECOVERY_KEY) === 'true').toBe(true);

    localStorage.setItem(PROMPT_RECOVERY_KEY, 'false');
    expect(localStorage.getItem(PROMPT_RECOVERY_KEY) === 'true').toBe(false);
  });

  it('writes a synchronous emergency snapshot to localStorage', async () => {
    expect(writeEmergencyAutosave('{"doc":"crash"}', 'Runtime error')).toBe(true);
    const snapshots = await readAutosaves();
    expect(snapshots.some((item) => item.name === 'Runtime error' && item.project.includes('crash'))).toBe(true);
  });

  it('saves and reads automatic rolling autosaves and named checkpoints', async () => {
    await writeAutosave('{"doc": 1}', 'Autosave 1');
    await writeNamedAutosave('Manual Checkpoint A', '{"doc": 2}');

    const snapshots = await readAutosaves();
    expect(snapshots.length).toBe(2);

    const named = snapshots.find((s) => s.kind === 'named');
    expect(named).toBeDefined();
    expect(named?.name).toBe('Manual Checkpoint A');

    const auto = snapshots.find((s) => s.kind === 'auto');
    expect(auto).toBeDefined();
    expect(auto?.name).toBe('Autosave 1');
  });

  it('allows clearing individual snapshots and clearing all history', async () => {
    await writeNamedAutosave('Save 1', '{"doc": 1}');
    await writeNamedAutosave('Save 2', '{"doc": 2}');

    let snapshots = await readAutosaves();
    expect(snapshots.length).toBe(2);

    await clearAutosave(snapshots[0]!.id);
    snapshots = await readAutosaves();
    expect(snapshots.length).toBe(1);

    await clearAutosave();
    snapshots = await readAutosaves();
    expect(snapshots.length).toBe(0);
  });

  it('offers the startup prompt only for new automatic snapshots', () => {
    const auto = { id: 'a', name: 'Autosave', savedAt: 100, project: '{}', kind: 'auto' as const };
    const named = { id: 'n', name: 'Checkpoint', savedAt: 200, project: '{}', kind: 'named' as const };
    expect(shouldOfferRecoveryPrompt([], { promptOnStartup: true })).toBe(false);
    expect(shouldOfferRecoveryPrompt([named], { promptOnStartup: true })).toBe(false);
    expect(shouldOfferRecoveryPrompt([auto], { promptOnStartup: false })).toBe(false);
    expect(shouldOfferRecoveryPrompt([auto], { promptOnStartup: true })).toBe(true);
    expect(shouldOfferRecoveryPrompt([auto], { promptOnStartup: true, dismissedAt: 100 })).toBe(false);
    expect(shouldOfferRecoveryPrompt([auto], { promptOnStartup: true, dismissedAt: 99 })).toBe(true);
  });

  it('records a dismissal timestamp so leftover snapshots stay quiet', () => {
    rememberRecoveryDismissed(1234);
    expect(localStorage.getItem(RECOVERY_DISMISSED_AT_KEY)).toBe('1234');
    expect(readRecoveryDismissedAt()).toBe(1234);
  });

  it('strips emergency localStorage snapshots when automatic autosaves are cleared', async () => {
    expect(writeEmergencyAutosave('{"doc":"crash"}', 'Page hide')).toBe(true);
    await writeNamedAutosave('Keep me', '{"doc":2}');

    await clearAutomaticAutosaves();

    const snapshots = await readAutosaves();
    expect(snapshots.every((item) => item.kind === 'named')).toBe(true);
    expect(snapshots.some((item) => item.name === 'Keep me')).toBe(true);
    const fallback = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? '[]') as Array<{ kind: string }>;
    expect(fallback.filter((item) => item.kind === 'auto')).toEqual([]);
  });

  it('clears localStorage emergency copies even when IndexedDB delete succeeds', async () => {
    expect(writeEmergencyAutosave('{"doc":"crash"}', 'Page hide')).toBe(true);
    const leftover = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? '[]') as Array<{ id: string }>;
    expect(leftover.length).toBeGreaterThan(0);

    installMemoryIndexedDB();
    await clearAutosave();

    expect(JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? '[]')).toEqual([]);
    expect(await readAutosaves()).toEqual([]);
  });
});

type MemoryRecord = { id: string; name: string; savedAt: number; project: string; kind: 'auto' | 'named' };

function installMemoryIndexedDB(): void {
  const records = new Map<string, MemoryRecord>();
  const request = <T,>(result: T) => {
    const req = {
      result,
      error: null as Error | null,
      onsuccess: null as ((ev?: unknown) => void) | null,
      onerror: null as ((ev?: unknown) => void) | null,
    };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };
  const db = {
    close() {},
    objectStoreNames: { contains: (name: string) => name === 'snapshots' },
    transaction() {
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore() {
          return {
            getAll: () => request([...records.values()]),
            delete: (id: string) => {
              records.delete(id);
              return request(undefined);
            },
            clear: () => {
              records.clear();
              return request(undefined);
            },
            put: (payload: MemoryRecord) => {
              records.set(payload.id, payload);
              return request(payload);
            },
          };
        },
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };
  const indexedDB = {
    open() {
      const req = {
        result: db,
        error: null as Error | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onupgradeneeded: null as (() => void) | null,
      };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
  vi.stubGlobal('indexedDB', indexedDB);
}
