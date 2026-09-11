import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyWorkspaceTheme,
  DEFAULT_WORKSPACE_THEME,
  getActiveTheme,
  isWorkspaceThemeId,
  parseHexColor,
  readStoredTheme,
  subscribeWorkspaceTheme,
  themeById,
  THEME_STORAGE_KEY,
  WORKSPACE_THEMES,
} from '@/app/theme/themeTokens';

const memory = new Map<string, string>();

describe('workspace theme tokens', () => {
  afterEach(() => {
    memory.clear();
    vi.unstubAllGlobals();
    applyWorkspaceTheme(DEFAULT_WORKSPACE_THEME);
  });

  it('ships twenty unique theme ids', () => {
    const ids = WORKSPACE_THEMES.map((theme) => theme.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(isWorkspaceThemeId('obsidian')).toBe(true);
    expect(isWorkspaceThemeId('synthwave')).toBe(true);
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
    expect(getActiveTheme().id).toBe('amber');
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

  it('notifies listeners and exposes viewport tokens', () => {
    const seen: string[] = [];
    const unsub = subscribeWorkspaceTheme(() => seen.push(getActiveTheme().id));
    expect(applyWorkspaceTheme('phosphor')).toBe('phosphor');
    expect(seen).toEqual(['phosphor']);
    expect(getActiveTheme().palette.gizmoY).toBe('#33ff66');
    expect(getActiveTheme().palette.horizon).toBe('#031208');
    unsub();
  });

  it('parses hex colours for the 3D viewport', () => {
    expect(parseHexColor('#1b1d20')).toBe(0x1b1d20);
    expect(parseHexColor('33ff66')).toBe(0x33ff66);
  });

  it('notifies on every switch including returning to a previous theme', () => {
    const seen: string[] = [];
    const unsub = subscribeWorkspaceTheme(() => seen.push(getActiveTheme().id));
    applyWorkspaceTheme('phosphor');
    applyWorkspaceTheme('synthwave');
    applyWorkspaceTheme('obsidian');
    expect(seen).toEqual(['phosphor', 'synthwave', 'obsidian']);
    expect(getActiveTheme().palette.horizon).toBe(themeById('obsidian').palette.horizon);
    unsub();
  });
});
