import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAutosave, readAutosaves, writeAutosave, writeEmergencyAutosave, writeNamedAutosave } from '@/app/autosave';

const PROMPT_RECOVERY_KEY = 'vipercad:prompt-recovery-on-startup';

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
});
