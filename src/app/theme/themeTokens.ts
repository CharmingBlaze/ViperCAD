export const THEME_STORAGE_KEY = 'vipercad.theme';

export type WorkspaceThemeId = 'obsidian' | 'venom' | 'amber' | 'nordic';

export type WorkspaceTheme = {
  id: WorkspaceThemeId;
  label: string;
  accent: string;
};

export const WORKSPACE_THEMES: readonly WorkspaceTheme[] = [
  { id: 'obsidian', label: 'Photoshop Dark', accent: '#2787e8' },
  { id: 'venom', label: 'Photoshop Deep Dark', accent: '#2787e8' },
  { id: 'amber', label: 'Photoshop Medium Dark', accent: '#2787e8' },
  { id: 'nordic', label: 'Photoshop Slate', accent: '#2787e8' },
] as const;

export const DEFAULT_WORKSPACE_THEME: WorkspaceThemeId = 'obsidian';

export function isWorkspaceThemeId(value: unknown): value is WorkspaceThemeId {
  return WORKSPACE_THEMES.some((theme) => theme.id === value);
}

export function readStoredTheme(): WorkspaceThemeId {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isWorkspaceThemeId(stored)) return stored;
  } catch {
    /* private mode / SSR */
  }
  return DEFAULT_WORKSPACE_THEME;
}

export function applyWorkspaceTheme(id: WorkspaceThemeId): WorkspaceThemeId {
  const next = isWorkspaceThemeId(id) ? id : DEFAULT_WORKSPACE_THEME;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = next;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* ignore quota / missing storage */
  }
  return next;
}

export function themeById(id: WorkspaceThemeId): WorkspaceTheme {
  return WORKSPACE_THEMES.find((theme) => theme.id === id) ?? WORKSPACE_THEMES[0]!;
}
