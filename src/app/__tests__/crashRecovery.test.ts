import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_KEY } from '@/app/autosave';
import {
  captureOpenProject,
  flushCrashAutosave,
  registerProjectCapture,
} from '@/app/crashRecovery';

describe('crashRecovery', () => {
  const store = new Map<string, string>();
  const fakeStorage: Storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => {
      store.set(key, String(val));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', fakeStorage);
  });

  afterEach(() => {
    registerProjectCapture(null);
    store.clear();
    vi.unstubAllGlobals();
  });

  it('captures the registered project and flushes an emergency autosave', () => {
    registerProjectCapture(() => '{"ok":true}');
    expect(captureOpenProject()).toBe('{"ok":true}');
    flushCrashAutosave('Test crash');
    const stored = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? '[]') as Array<{ name: string }>;
    expect(stored[0]?.name).toBe('Test crash');
  });

  it('swallows a failing capture instead of throwing', () => {
    registerProjectCapture(() => {
      throw new Error('serialize failed');
    });
    expect(captureOpenProject()).toBeNull();
    expect(() => flushCrashAutosave('Bad capture')).not.toThrow();
  });
});
