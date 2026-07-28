/** Editor-only UV / Pixel workspace state — never stored in EditableMesh. */

import type { GradientStop } from '@/core/image/GradientGenerator';

export type RightEditorMode = 'combined' | 'uv' | 'pixel';
export type UvSelectionSyncMode = 'off' | 'face' | 'component' | 'island';
/** What the UV editor selects / drags: faces, UV points, or seam islands. */
export type UvEditMode = 'face' | 'point' | 'island';
/** Blockbench-style UV transform tool. */
export type UvTransformTool = 'move' | 'scale' | 'rotate';
/** Right inspector tabs in the UV / Pixel editor. */
export type UvPanelTab = 'edit' | 'tiles' | 'paint' | 'material' | 'view';
export type TextureShellMaximize = 'none' | 'left' | 'right';
export type AtlasGridPreset = {
  id: string;
  name: string;
  tileWidth: number;
  tileHeight: number;
  marginX: number;
  marginY: number;
  offsetX: number;
  offsetY: number;
  padding: number;
};

export type UvCameraState = {
  /** Pan in editor CSS pixels (image origin offset). */
  panX: number;
  panY: number;
  /** Zoom: screen pixels per image pixel. */
  zoom: number;
};

export type PixelCameraState = UvCameraState;

export type TextureWorkspaceState = {
  open: boolean;
  /** Left 3D width as fraction of modelling region [0–1]. */
  splitRatio: number;
  maximize: TextureShellMaximize;
  activeRightEditor: RightEditorMode;
  activeTextureId: string | null;
  activeImageId: string | null;
  activeMaterialId: string | null;
  activeUvLayerId: string | null;
  uvCamera: UvCameraState;
  pixelCamera: PixelCameraState;
  /** Shared camera for combined canvas (uvCamera used when shared). */
  sharedCamera: boolean;
  uvSelectionSync: UvSelectionSyncMode;
  uvAutoFrame3dSelection: boolean;
  uvEditMode: UvEditMode;
  uvTransformTool: UvTransformTool;
  uvPanelTab: UvPanelTab;
  /**
   * When true, LMB in Combined mode edits UVs instead of painting.
   * Set by Face/Point/Island/Move/Scale/Rotate; cleared by pixel tools.
   */
  uvPointerMode: boolean;
  /** When true, LMB on the 3D mesh paints the active texture via UVs. */
  paintMode3D: boolean;
  seamPaintMode: 'off' | 'mark' | 'clear';
  uvDiagnosticMode: 'off' | 'distortion' | 'density';
  showUvOverlay: boolean;
  showUvCheckerboard: boolean;
  pixelGridSnap: boolean;
  showPixelGrid: boolean;
  pixelTool: 'pencil' | 'eraser' | 'eyedropper' | 'fill';
  brushShape: 'square' | 'circle';
  foreground: [number, number, number, number];
  background: [number, number, number, number];
  brushSize: number;
  /** Pixelate filter block size in texels. */
  pixelateBlockSize: number;
  pixelateMode: 'average' | 'center' | 'mosaic';
  gradientStops: GradientStop[];
  gradientAngle: number;
  gradientType: 'linear' | 'radial';
  atlasTileWidth: number;
  atlasTileHeight: number;
  atlasTileX: number;
  atlasTileY: number;
  atlasPadding: number;
  atlasQuarterTurns: 0 | 1 | 2 | 3;
  atlasFlipU: boolean;
  atlasFlipV: boolean;
  atlasPaintMode: boolean;
  atlasAutoAdvance: boolean;
  atlasPlaneOrientation: 'floor' | 'wall-x' | 'wall-z';
  atlasPlaneSize: number;
  atlasMarginX: number;
  atlasMarginY: number;
  atlasOffsetX: number;
  atlasOffsetY: number;
  atlasSelectionColumns: number;
  atlasSelectionRows: number;
  /** How many times to stamp the selected tile across a face / plane (U axis). */
  atlasRepeatU: number;
  /** How many times to stamp the selected tile across a face / plane (V axis). */
  atlasRepeatV: number;
  atlasFillColumns: number;
  atlasFillRows: number;
  atlasFillPattern: 'repeat' | 'random';
  atlasRandomSeed: number;
  atlasUsePixelDensity: boolean;
  atlasPixelsPerUnit: number;
  atlasGridPresets: AtlasGridPreset[];
  activeAtlasGridPresetId: string;
  atlasDrawMode: 'paint' | 'erase' | 'replace' | 'pick' | 'fill';
  atlasDrawShape: 'stroke' | 'rectangle';
  atlasAutoTile: boolean;
  atlasTileLayer: 'Geometry' | 'Decoration' | 'Collision' | 'Decal';
  atlasPanelOpen: boolean;
  atlasPanelMinimized: boolean;
  atlasPanelX: number;
  atlasPanelY: number;
};

export function createDefaultTextureWorkspace(): TextureWorkspaceState {
  const camera = { panX: 24, panY: 24, zoom: 8 };
  return {
    open: false,
    splitRatio: 0.5,
    maximize: 'none',
    activeRightEditor: 'combined',
    activeTextureId: null,
    activeImageId: null,
    activeMaterialId: null,
    activeUvLayerId: null,
    uvCamera: { ...camera },
    pixelCamera: { ...camera },
    sharedCamera: true,
    uvSelectionSync: 'face',
    uvAutoFrame3dSelection: true,
    uvEditMode: 'face',
    uvTransformTool: 'move',
    uvPanelTab: 'edit',
    uvPointerMode: true,
    paintMode3D: true,
    seamPaintMode: 'off',
    uvDiagnosticMode: 'off',
    showUvOverlay: true,
    showUvCheckerboard: false,
    pixelGridSnap: false,
    showPixelGrid: true,
    pixelTool: 'pencil',
    brushShape: 'square',
    foreground: [220, 90, 70, 255],
    background: [0, 0, 0, 0],
    brushSize: 2,
    pixelateBlockSize: 4,
    pixelateMode: 'average',
    gradientStops: [
      { color: '#0030e8', position: 0, opacity: 100 },
      { color: '#ffffff', position: 100, opacity: 100 },
    ],
    gradientAngle: 90,
    gradientType: 'linear',
    atlasTileWidth: 16,
    atlasTileHeight: 16,
    atlasTileX: 0,
    atlasTileY: 0,
    atlasPadding: 0,
    atlasQuarterTurns: 0,
    atlasFlipU: false,
    atlasFlipV: false,
    atlasPaintMode: false,
    atlasAutoAdvance: false,
    atlasPlaneOrientation: 'wall-x',
    atlasPlaneSize: 1,
    atlasMarginX: 0,
    atlasMarginY: 0,
    atlasOffsetX: 0,
    atlasOffsetY: 0,
    atlasSelectionColumns: 1,
    atlasSelectionRows: 1,
    atlasRepeatU: 1,
    atlasRepeatV: 1,
    atlasFillColumns: 4,
    atlasFillRows: 4,
    atlasFillPattern: 'repeat',
    atlasRandomSeed: 1,
    atlasUsePixelDensity: true,
    atlasPixelsPerUnit: 16,
    atlasGridPresets: [{
      id: 'default-16',
      name: '16 px tiles',
      tileWidth: 16,
      tileHeight: 16,
      marginX: 0,
      marginY: 0,
      offsetX: 0,
      offsetY: 0,
      padding: 0,
    }],
    activeAtlasGridPresetId: 'default-16',
    atlasDrawMode: 'paint',
    atlasDrawShape: 'stroke',
    atlasAutoTile: false,
    atlasTileLayer: 'Geometry',
    atlasPanelOpen: false,
    atlasPanelMinimized: false,
    atlasPanelX: 360,
    atlasPanelY: 88,
  };
}

const STORAGE_KEY = 'vipercad.textureWorkspace.v1';

export function loadTextureWorkspace(): TextureWorkspaceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultTextureWorkspace();
    const parsed = JSON.parse(raw) as Partial<TextureWorkspaceState> & {
      gradientStart?: string;
      gradientEnd?: string;
    };
    const defaults = createDefaultTextureWorkspace();
    const merged = { ...defaults, ...parsed, open: false };
    merged.uvPanelTab = normalizeUvPanelTab(parsed.uvPanelTab);
    merged.pixelateMode = parsed.pixelateMode === 'center' || parsed.pixelateMode === 'mosaic'
      ? parsed.pixelateMode
      : defaults.pixelateMode;
    if (!Array.isArray(parsed.gradientStops) || parsed.gradientStops.length < 2) {
      merged.gradientStops = [
        {
          color: parsed.gradientStart ?? defaults.gradientStops[0]!.color,
          position: 0,
          opacity: 100,
        },
        {
          color: parsed.gradientEnd ?? defaults.gradientStops[defaults.gradientStops.length - 1]!.color,
          position: 100,
          opacity: 100,
        },
      ];
    }
    return merged;
  } catch {
    return createDefaultTextureWorkspace();
  }
}

export function saveTextureWorkspace(state: TextureWorkspaceState): void {
  try {
    const { open: _open, ...rest } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch {
    /* ignore quota */
  }
}

export function clampTextureSplit(ratio: number): number {
  return Math.min(0.85, Math.max(0.2, ratio));
}

export function editorCamera(state: TextureWorkspaceState): UvCameraState {
  return state.sharedCamera ? state.uvCamera : state.pixelCamera;
}

/** Map legacy Select/Xform/Layout tabs onto the combined Edit tab. */
export function normalizeUvPanelTab(tab: unknown): UvPanelTab {
  if (tab === 'tiles' || tab === 'paint' || tab === 'material' || tab === 'view' || tab === 'edit') return tab;
  if (tab === 'select' || tab === 'transform' || tab === 'layout') return 'edit';
  return 'edit';
}
