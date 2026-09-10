/** Editor-only UV / Pixel workspace state — never stored in EditableMesh. */

import type { GradientStop } from '@/core/image/GradientGenerator';
import type { ColorPalette } from '@/core/image/ColorPalettes';

export type RightEditorMode = 'combined' | 'uv' | 'pixel';
export type UvSelectionSyncMode = 'off' | 'face' | 'component' | 'island';
/** What the UV editor selects / drags: faces, UV points, or seam islands. */
export type UvEditMode = 'face' | 'point' | 'island';
/** Blockbench-style UV transform tool. */
export type UvTransformTool = 'move' | 'scale' | 'rotate';
/** Right inspector tabs in the UV / Pixel editor. */
export type UvPanelTab = 'edit' | 'tiles' | 'paint' | 'material' | 'view';
export type TextureShellMaximize = 'none' | 'left' | 'right';
export type TexturePanelId = '3d' | 'uv';
export type Texture3dWindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  /** When true, the panel sits in the left/right split instead of floating. */
  docked: boolean;
};
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
  /** Left (3D) share of the docked vertical split, 0–1. */
  splitRatio: number;
  maximize: TextureShellMaximize;
  preview3d: Texture3dWindowState;
  uvWindow: Texture3dWindowState;
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
  /** Bumped when UV camera defaults change so older localStorage can migrate. */
  uvPrefsRev: number;
  uvEditMode: UvEditMode;
  uvTransformTool: UvTransformTool;
  uvPanelTab: UvPanelTab;
  /** When false, the UV inspector collapses to a thin right-edge strip. */
  uvInspectorOpen: boolean;
  /** Docked UV / Paint inspector width in CSS pixels. */
  uvInspectorWidth: number;
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
  /** 16×16 composition grid for placing UV islands. */
  showUvGrid: boolean;
  /** Snap UV translations to texel boundaries without holding Shift. */
  uvSnapToPixels: boolean;
  showUvCheckerboard: boolean;
  pixelGridSnap: boolean;
  showPixelGrid: boolean;
  pixelTool: 'pencil' | 'eraser' | 'eyedropper' | 'fill' | 'line' | 'rectangle' | 'ellipse' | 'replace';
  activePaletteId: string;
  customPalettes: ColorPalette[];
  brushShape: 'square' | 'circle';
  foreground: [number, number, number, number];
  background: [number, number, number, number];
  brushSize: number;
  ditherMode: 'none' | 'checker' | 'bayer4';
  recolorOnlyBg: boolean;
  /** Paint bucket colour range, matching Photoshop's 0–255 tolerance control. */
  fillTolerance: number;
  /** Fill only connected pixels, or every matching pixel in the texture. */
  fillContiguous: boolean;
  /** Pixel-editor symmetry axes, applied to brush and shape tools. */
  paintMirrorX: boolean;
  paintMirrorY: boolean;
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
    splitRatio: 0.46,
    maximize: 'none',
    preview3d: { x: 16, y: 52, width: 420, height: 292, visible: true, docked: true },
    uvWindow: { x: 460, y: 52, width: 520, height: 420, visible: true, docked: true },
    activeRightEditor: 'combined',
    activeTextureId: null,
    activeImageId: null,
    activeMaterialId: null,
    activeUvLayerId: null,
    uvCamera: { ...camera },
    pixelCamera: { ...camera },
    sharedCamera: true,
    uvSelectionSync: 'face',
    uvAutoFrame3dSelection: false,
    uvPrefsRev: 2,
    uvEditMode: 'face',
    uvTransformTool: 'move',
    uvPanelTab: 'edit',
    uvInspectorOpen: true,
    uvInspectorWidth: 280,
    uvPointerMode: true,
    paintMode3D: true,
    seamPaintMode: 'off',
    uvDiagnosticMode: 'off',
    showUvOverlay: true,
    showUvGrid: true,
    uvSnapToPixels: false,
    showUvCheckerboard: false,
    pixelGridSnap: false,
    showPixelGrid: true,
    pixelTool: 'pencil',
    activePaletteId: 'pico8',
    customPalettes: [],
    brushShape: 'square',
    foreground: [220, 90, 70, 255],
    background: [0, 0, 0, 0],
    brushSize: 1,
    ditherMode: 'none',
    recolorOnlyBg: false,
    fillTolerance: 32,
    fillContiguous: true,
    paintMirrorX: false,
    paintMirrorY: false,
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
    merged.preview3d = { ...defaults.preview3d, ...(parsed.preview3d ?? {}) };
    merged.uvWindow = { ...defaults.uvWindow, ...(parsed.uvWindow ?? {}) };
    merged.splitRatio = clampTextureSplit(
      typeof parsed.splitRatio === 'number' && !Number.isNaN(parsed.splitRatio)
        ? parsed.splitRatio
        : defaults.splitRatio,
    );
    merged.uvPanelTab = normalizeUvPanelTab(parsed.uvPanelTab);
    merged.uvInspectorOpen = parsed.uvInspectorOpen !== false;
    merged.uvInspectorWidth = clampUvInspectorWidth(
      typeof parsed.uvInspectorWidth === 'number' ? parsed.uvInspectorWidth : defaults.uvInspectorWidth,
    );
    merged.pixelateMode = parsed.pixelateMode === 'center' || parsed.pixelateMode === 'mosaic'
      ? parsed.pixelateMode
      : defaults.pixelateMode;
    merged.fillTolerance = Math.max(0, Math.min(255, Math.round(
      typeof parsed.fillTolerance === 'number' ? parsed.fillTolerance : defaults.fillTolerance,
    )));
    merged.fillContiguous = parsed.fillContiguous !== false;
    merged.customPalettes = Array.isArray(parsed.customPalettes)
      ? parsed.customPalettes.filter((palette) => palette && palette.custom && Array.isArray(palette.colors))
      : [];
    merged.activePaletteId = typeof parsed.activePaletteId === 'string' ? parsed.activePaletteId : defaults.activePaletteId;
    const parsedRev = typeof parsed.uvPrefsRev === 'number' ? parsed.uvPrefsRev : 1;
    if (parsedRev < 2) {
      merged.uvAutoFrame3dSelection = false;
      merged.uvPrefsRev = 2;
    }
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
  return Math.min(0.78, Math.max(0.22, ratio));
}

export function clampUvInspectorWidth(width: number): number {
  return Math.min(420, Math.max(240, Math.round(width)));
}

export function isTextureSplitLayout(state: TextureWorkspaceState): boolean {
  return (
    state.maximize === 'none' &&
    state.preview3d.visible &&
    state.preview3d.docked &&
    state.uvWindow.visible &&
    state.uvWindow.docked
  );
}

export function clampTexture3dWindow(
  rect: Texture3dWindowState,
  bounds: { width: number; height: number },
): Texture3dWindowState {
  const minW = 260;
  const minH = 180;
  const width = Math.min(Math.max(minW, rect.width), Math.max(minW, bounds.width - 16));
  const height = Math.min(Math.max(minH, rect.height), Math.max(minH, bounds.height - 16));
  const x = Math.max(8, Math.min(bounds.width - width - 8, rect.x));
  const y = Math.max(8, Math.min(bounds.height - height - 8, rect.y));
  return { ...rect, x, y, width, height, visible: rect.visible };
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
