import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyWorkspaceTheme,
  DEFAULT_WORKSPACE_THEME,
  isWorkspaceThemeId,
  readStoredTheme,
  THEME_STORAGE_KEY,
} from '@/app/theme/themeTokens';

const memory = new Map<string, string>();

describe('workspace theme tokens', () => {
  afterEach(() => {
    memory.clear();
    vi.unstubAllGlobals();
  });

  it('accepts only known theme ids', () => {
    expect(isWorkspaceThemeId('obsidian')).toBe(true);
    expect(isWorkspaceThemeId('venom')).toBe(true);
    expect(isWorkspaceThemeId('nope')).toBe(false);
  });

  it('persists a theme id', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    });
    expect(applyWorkspaceTheme('amber')).toBe('amber');
    expect(memory.get(THEME_STORAGE_KEY)).toBe('amber');
    expect(readStoredTheme()).toBe('amber');
  });

  it('falls back to default workspace theme', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(readStoredTheme()).toBe(DEFAULT_WORKSPACE_THEME);
  });
});
