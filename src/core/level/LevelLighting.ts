import type { ViperDocument, ViperProject } from '@/core/document/types';

export type LevelLightingPresetId =
  | 'default'
  | 'noon'
  | 'sunset'
  | 'midnight'
  | 'foggy'
  | 'neon'
  | 'dungeon';

export type LevelLightingConfig = {
  skyColor: string;
  groundColor: string;
  ambientIntensity: number;

  fogEnabled: boolean;
  fogColor: string;
  fogDensity: number;
  fogNear: number;
  fogFar: number;

  sunEnabled: boolean;
  sunColor: string;
  sunIntensity: number;
  sunAzimuth: number; // 0..360 deg
  sunElevation: number; // 0..90 deg
  sunShadows: boolean;

  fillColor: string;
  fillIntensity: number;
  rimColor: string;
  rimIntensity: number;

  exposure: number;
  preset: LevelLightingPresetId;
};

export const DEFAULT_LEVEL_LIGHTING: LevelLightingConfig = {
  skyColor: '#d8e4f8',
  groundColor: '#282830',
  ambientIntensity: 0.42,

  fogEnabled: false,
  fogColor: '#090d12',
  fogDensity: 0.015,
  fogNear: 10,
  fogFar: 200,

  sunEnabled: true,
  sunColor: '#ffffff',
  sunIntensity: 1.0,
  sunAzimuth: 45,
  sunElevation: 60,
  sunShadows: true,

  fillColor: '#c8d4ff',
  fillIntensity: 0.42,
  rimColor: '#ffe8cc',
  rimIntensity: 0.28,

  exposure: 1.05,
  preset: 'default',
};

export const LIGHTING_PRESETS: Record<LevelLightingPresetId, { label: string; config: LevelLightingConfig }> = {
  default: {
    label: 'Studio Default',
    config: { ...DEFAULT_LEVEL_LIGHTING },
  },
  noon: {
    label: 'High Noon',
    config: {
      skyColor: '#38bdf8',
      groundColor: '#334155',
      ambientIntensity: 0.65,
      fogEnabled: false,
      fogColor: '#e0f2fe',
      fogDensity: 0.008,
      fogNear: 20,
      fogFar: 300,
      sunEnabled: true,
      sunColor: '#fffbeb',
      sunIntensity: 1.4,
      sunAzimuth: 120,
      sunElevation: 80,
      sunShadows: true,
      fillColor: '#bae6fd',
      fillIntensity: 0.35,
      rimColor: '#fef08a',
      rimIntensity: 0.2,
      exposure: 1.1,
      preset: 'noon',
    },
  },
  sunset: {
    label: 'Golden Hour Sunset',
    config: {
      skyColor: '#fdba74',
      groundColor: '#1e1b4b',
      ambientIntensity: 0.45,
      fogEnabled: true,
      fogColor: '#7c2d12',
      fogDensity: 0.012,
      fogNear: 15,
      fogFar: 180,
      sunEnabled: true,
      sunColor: '#ffedd5',
      sunIntensity: 1.5,
      sunAzimuth: 240,
      sunElevation: 12,
      sunShadows: true,
      fillColor: '#f43f5e',
      fillIntensity: 0.5,
      rimColor: '#facc15',
      rimIntensity: 0.6,
      exposure: 1.25,
      preset: 'sunset',
    },
  },
  midnight: {
    label: 'Midnight Moon',
    config: {
      skyColor: '#0f172a',
      groundColor: '#020617',
      ambientIntensity: 0.25,
      fogEnabled: true,
      fogColor: '#020617',
      fogDensity: 0.02,
      fogNear: 8,
      fogFar: 120,
      sunEnabled: true,
      sunColor: '#93c5fd',
      sunIntensity: 0.7,
      sunAzimuth: 310,
      sunElevation: 45,
      sunShadows: true,
      fillColor: '#1e3a8a',
      fillIntensity: 0.3,
      rimColor: '#38bdf8',
      rimIntensity: 0.4,
      exposure: 0.85,
      preset: 'midnight',
    },
  },
  foggy: {
    label: 'Moody Misty Fog',
    config: {
      skyColor: '#64748b',
      groundColor: '#334155',
      ambientIntensity: 0.55,
      fogEnabled: true,
      fogColor: '#475569',
      fogDensity: 0.035,
      fogNear: 5,
      fogFar: 90,
      sunEnabled: true,
      sunColor: '#f8fafc',
      sunIntensity: 0.8,
      sunAzimuth: 180,
      sunElevation: 35,
      sunShadows: false,
      fillColor: '#94a3b8',
      fillIntensity: 0.4,
      rimColor: '#cbd5e1',
      rimIntensity: 0.3,
      exposure: 1.0,
      preset: 'foggy',
    },
  },
  neon: {
    label: 'Sci-Fi Cyber Neon',
    config: {
      skyColor: '#18181b',
      groundColor: '#09090b',
      ambientIntensity: 0.3,
      fogEnabled: true,
      fogColor: '#09090b',
      fogDensity: 0.018,
      fogNear: 10,
      fogFar: 150,
      sunEnabled: true,
      sunColor: '#06b6d4',
      sunIntensity: 1.1,
      sunAzimuth: 60,
      sunElevation: 30,
      sunShadows: true,
      fillColor: '#d946ef',
      fillIntensity: 0.7,
      rimColor: '#3b82f6',
      rimIntensity: 0.6,
      exposure: 1.15,
      preset: 'neon',
    },
  },
  dungeon: {
    label: 'Dungeon Torchlight',
    config: {
      skyColor: '#1c1917',
      groundColor: '#0c0a09',
      ambientIntensity: 0.2,
      fogEnabled: true,
      fogColor: '#1c1917',
      fogDensity: 0.025,
      fogNear: 6,
      fogFar: 100,
      sunEnabled: true,
      sunColor: '#f97316',
      sunIntensity: 1.3,
      sunAzimuth: 135,
      sunElevation: 25,
      sunShadows: true,
      fillColor: '#78350f',
      fillIntensity: 0.4,
      rimColor: '#eab308',
      rimIntensity: 0.5,
      exposure: 0.95,
      preset: 'dungeon',
    },
  },
};

export function getDocumentLighting(doc: ViperDocument | ViperProject): LevelLightingConfig {
  const settings = doc.settings as Record<string, unknown>;
  const raw = settings?.lighting as Partial<LevelLightingConfig> | undefined;
  return { ...DEFAULT_LEVEL_LIGHTING, ...(raw ?? {}) };
}

export function updateDocumentLighting(
  doc: ViperDocument | ViperProject,
  updates: Partial<LevelLightingConfig>,
): LevelLightingConfig {
  const current = getDocumentLighting(doc);
  const next = { ...current, ...updates };
  if (!doc.settings) {
    (doc as unknown as { settings: Record<string, unknown> }).settings = {};
  }
  (doc.settings as Record<string, unknown>).lighting = next;
  doc.dirty = true;
  return next;
}
