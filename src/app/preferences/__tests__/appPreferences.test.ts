import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_PREFERENCES_KEY,
  DEFAULT_APP_PREFERENCES,
  formatSensitivity,
  getAppPreferences,
  normalizeAppPreferences,
  patchAppPreferences,
  reloadAppPreferences,
  renderQualityScale,
  resetAppPreferences,
  resetAppPreferencesCache,
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
} from '@/app/preferences/appPreferences';

const memory = new Map<string, string>();

describe('app preferences', () => {
  afterEach(() => {
    memory.clear();
    vi.unstubAllGlobals();
    resetAppPreferencesCache();
  });

  const stubStorage = () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
    });
    reloadAppPreferences();
  };

  it('clamps sensitivity and rejects unknown quality ids', () => {
    expect(normalizeAppPreferences({ orbitSensitivity: 9 }).orbitSensitivity).toBe(SENSITIVITY_MAX);
    expect(normalizeAppPreferences({ zoomSensitivity: 0 }).zoomSensitivity).toBe(SENSITIVITY_MIN);
    expect(normalizeAppPreferences({ renderQuality: 'ultra' as never }).renderQuality).toBe('balanced');
    expect(formatSensitivity(1.25)).toBe('125%');
  });

  it('persists navigation and quality settings', () => {
    stubStorage();
    const next = patchAppPreferences({
      orbitSensitivity: 0.5,
      zoomSensitivity: 1.4,
      wheelZoomSensitivity: 0.8,
      invertOrbitY: true,
      renderQuality: 'high',
    });
    expect(next.orbitSensitivity).toBe(0.5);
    expect(next.invertOrbitY).toBe(true);
    expect(JSON.parse(memory.get(APP_PREFERENCES_KEY) ?? '{}').renderQuality).toBe('high');
    reloadAppPreferences();
    expect(getAppPreferences().zoomSensitivity).toBe(1.4);
    expect(getAppPreferences().invertOrbitY).toBe(true);
  });

  it('resets to defaults', () => {
    stubStorage();
    patchAppPreferences({ orbitSensitivity: 2, invertZoom: true });
    expect(resetAppPreferences()).toEqual(DEFAULT_APP_PREFERENCES);
    expect(JSON.parse(memory.get(APP_PREFERENCES_KEY) ?? '{}')).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it('maps viewport quality to a pixel-ratio scale', () => {
    expect(renderQualityScale('performance')).toBe(0.6);
    expect(renderQualityScale('balanced')).toBe(1);
    expect(renderQualityScale('high')).toBe(1.35);
  });
});
