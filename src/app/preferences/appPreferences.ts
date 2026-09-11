export const APP_PREFERENCES_KEY = 'vipercad.preferences.v1';

export type RenderQualityId = 'performance' | 'balanced' | 'high';

export type AppPreferences = {
  orbitSensitivity: number;
  zoomSensitivity: number;
  wheelZoomSensitivity: number;
  panSensitivity: number;
  invertOrbitY: boolean;
  invertZoom: boolean;
  renderQuality: RenderQualityId;
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  orbitSensitivity: 1,
  zoomSensitivity: 1,
  wheelZoomSensitivity: 1,
  panSensitivity: 1,
  invertOrbitY: false,
  invertZoom: false,
  renderQuality: 'balanced',
};

export const SENSITIVITY_MIN = 0.25;
export const SENSITIVITY_MAX = 2.5;

const RENDER_QUALITY_IDS: readonly RenderQualityId[] = ['performance', 'balanced', 'high'];

type Listener = (prefs: AppPreferences) => void;

let cached: AppPreferences | null = null;
const listeners = new Set<Listener>();

function clampSensitivity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, n));
}

function isRenderQualityId(value: unknown): value is RenderQualityId {
  return RENDER_QUALITY_IDS.includes(value as RenderQualityId);
}

export function normalizeAppPreferences(raw: Partial<AppPreferences> | null | undefined): AppPreferences {
  return {
    orbitSensitivity: clampSensitivity(raw?.orbitSensitivity),
    zoomSensitivity: clampSensitivity(raw?.zoomSensitivity),
    wheelZoomSensitivity: clampSensitivity(raw?.wheelZoomSensitivity),
    panSensitivity: clampSensitivity(raw?.panSensitivity),
    invertOrbitY: raw?.invertOrbitY === true,
    invertZoom: raw?.invertZoom === true,
    renderQuality: isRenderQualityId(raw?.renderQuality) ? raw.renderQuality : 'balanced',
  };
}

function loadFromStorage(): AppPreferences {
  try {
    const raw = localStorage.getItem(APP_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_APP_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<AppPreferences>;
    return normalizeAppPreferences(parsed);
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

function persist(prefs: AppPreferences): void {
  try {
    localStorage.setItem(APP_PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / quota */
  }
}

export function getAppPreferences(): AppPreferences {
  if (!cached) cached = loadFromStorage();
  return cached;
}

export function reloadAppPreferences(): AppPreferences {
  cached = loadFromStorage();
  return cached;
}

/** Drop in-memory prefs without writing storage. Used by tests. */
export function resetAppPreferencesCache(): void {
  cached = { ...DEFAULT_APP_PREFERENCES };
}

export function patchAppPreferences(partial: Partial<AppPreferences>): AppPreferences {
  const next = normalizeAppPreferences({ ...getAppPreferences(), ...partial });
  cached = next;
  persist(next);
  for (const listener of listeners) listener(next);
  return next;
}

export function resetAppPreferences(): AppPreferences {
  cached = { ...DEFAULT_APP_PREFERENCES };
  persist(cached);
  for (const listener of listeners) listener(cached);
  return cached;
}

export function subscribeAppPreferences(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function renderQualityScale(id: RenderQualityId): number {
  if (id === 'performance') return 0.6;
  if (id === 'high') return 1.35;
  return 1;
}

export function formatSensitivity(value: number): string {
  return `${Math.round(value * 100)}%`;
}
