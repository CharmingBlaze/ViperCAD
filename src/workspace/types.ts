export type ViewId = 'persp' | 'top' | 'front' | 'right';

export type ViewPreset =
  | 'perspective'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'front'
  | 'back';

export type LayoutMode = 'quad' | 'maximized';

export type BlockoutArrangement = 'stack' | 'columns';

export type ProjectionType = 'perspective' | 'orthographic';

export type ShadingMode = 'material' | 'wireframe' | 'outlines' | 'game' | 'silhouette';

export const SHADING_MODE_LABELS: Record<ShadingMode, string> = {
  material: 'Material',
  wireframe: 'Wireframe',
  outlines: 'Outlines',
  // Kept as `game` in saved workspace data for backward compatibility; it is
  // presented as a studio modelling preview in the UI.
  game: 'Studio',
  silhouette: 'Silhouette',
};

export function normalizeShadingMode(value: unknown): ShadingMode {
  if (
    value === 'wireframe' ||
    value === 'outlines' ||
    value === 'game' ||
    value === 'material' ||
    value === 'silhouette'
  ) {
    return value;
  }
  if (value === 'solid-wire') return 'outlines';
  return 'material';
}

/** Split ratios for default quad tree (root horizontal, then vertical per row). */
export type QuadSplitRatios = {
  /** Upper row height as fraction of modelling region [0–1]. */
  horizontal: number;
  /** Perspective width within upper row [0–1]. */
  upperVertical: number;
  /** Front width within lower row [0–1]. */
  lowerVertical: number;
};

export type CameraSnapshot = {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  /** Perspective FOV degrees, or unused for ortho. */
  fov: number;
  /** Orthographic view height (world units). Preserved across resize. */
  orthoHeight: number;
  zoom: number;
};

export type ViewportState = {
  id: ViewId;
  label: string;
  projection: ProjectionType;
  camera: CameraSnapshot;
  shadingMode: ShadingMode;
  gridVisible: boolean;
  xRay: boolean;
};

export type ViewportLayoutState = {
  mode: LayoutMode;
  maximizedViewportId: ViewId | null;
  splits: QuadSplitRatios;
  lastActiveViewportId: ViewId;
  hoveredViewportId: ViewId | null;
  /** Blockout: stacked Front/Side + Perspective, or three vertical windows. */
  blockoutArrangement: BlockoutArrangement;
  /** First column divider as a fraction of width (columns layout). */
  blockoutColumnA: number;
  /** Second column divider as a fraction of width (columns layout). */
  blockoutColumnB: number;
};

/** Top-level application shell: modelling, sculpt, terrain, UV/Pixel, rig, animation, or blockout. */
export type AppShellMode = 'model' | 'sculpt' | 'terrain' | 'texture' | 'rig' | 'animate' | 'blockout';

export type WorkspacePreferences = {
  version: 3;
  layout: ViewportLayoutState;
  viewports: Record<ViewId, Pick<ViewportState, 'camera' | 'shadingMode' | 'gridVisible' | 'xRay'>>;
  /** Per-viewport nav toolbar (center, pan, rotate, zoom, maximize). */
  viewportNavToolsVisible: boolean;
  /** Show material maps in the modelling view. On unless the user turns it off. */
  displayTextures: boolean;
  /** Click-drag create tools sit on the hit mesh or terrain. On unless the user turns it off. */
  drawOnSurfaces: boolean;
};

export const DEFAULT_SPLITS: QuadSplitRatios = {
  horizontal: 0.5,
  upperVertical: 0.5,
  lowerVertical: 0.5,
};

export const MIN_SPLIT = 0.15;
export const MAX_SPLIT = 0.85;

export const VIEW_ORDER: ViewId[] = ['persp', 'top', 'front', 'right'];

export const VIEW_PRESETS: ViewPreset[] = [
  'perspective',
  'top',
  'bottom',
  'left',
  'right',
  'front',
  'back',
];

export const DEFAULT_VIEW_PRESETS: Record<ViewId, ViewPreset> = {
  persp: 'perspective',
  top: 'top',
  front: 'front',
  right: 'right',
};

export const VIEW_PRESET_LABELS: Record<ViewPreset, string> = {
  perspective: 'Perspective',
  top: 'Top',
  bottom: 'Bottom',
  left: 'Left',
  right: 'Right',
  front: 'Front',
  back: 'Back',
};

export const VIEW_LABELS: Record<ViewId, string> = {
  persp: 'User',
  top: 'Top',
  front: 'Front',
  right: 'Right',
};

export const DEFAULT_BLOCKOUT_COLUMN_A = 1 / 3;
export const DEFAULT_BLOCKOUT_COLUMN_B = 2 / 3;

export function clampSplit(value: number): number {
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));
}

export function clampBlockoutColumns(a: number, b: number): { a: number; b: number } {
  const min = 0.12;
  const colA = Math.min(Math.max(a, min), 1 - 2 * min);
  const colB = Math.min(Math.max(b, colA + min), 1 - min);
  return { a: colA, b: Math.max(colB, colA + min) };
}

export function createDefaultLayoutState(): ViewportLayoutState {
  return {
    mode: 'maximized',
    maximizedViewportId: 'persp',
    splits: { ...DEFAULT_SPLITS },
    lastActiveViewportId: 'persp',
    hoveredViewportId: null,
    blockoutArrangement: 'stack',
    blockoutColumnA: DEFAULT_BLOCKOUT_COLUMN_A,
    blockoutColumnB: DEFAULT_BLOCKOUT_COLUMN_B,
  };
}
