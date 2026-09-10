import { InputRouter } from './InputRouter';
import { SplitLayoutManager } from './SplitLayoutManager';
import {
  clampTexture3dWindow,
  clampTextureSplit,
  isTextureSplitLayout,
  loadTextureWorkspace,
  saveTextureWorkspace,
  type Texture3dWindowState,
  type TexturePanelId,
  type TextureWorkspaceState,
} from './TextureWorkspace';
import {
  defaultPreferences,
  loadWorkspacePreferences,
  saveWorkspacePreferences,
} from './WorkspacePersistence';
import {
  normalizeShadingMode,
  VIEW_ORDER,
  type AppShellMode,
  type BlockoutArrangement,
  type ShadingMode,
  type ViewId,
  type WorkspacePreferences,
} from './types';
import type { VertexBezierState } from '@/core/curves/BezierFromVertices';

export type InspectorTab = 'create' | 'edit' | 'material';
export type InspectorSection = 'select' | 'transform' | 'geometry' | 'symmetry' | 'scene';
export type ViewportNavMode = 'none' | 'pan' | 'orbit' | 'zoom' | 'select';

type Listener = () => void;

/**
 * Coordinates layout, hover/active viewport, Tab maximize, and persistence.
 * Separate from ModelDocument.
 */
export class WorkspaceController {
  readonly splits: SplitLayoutManager;
  readonly input: InputRouter;
  preferences: WorkspacePreferences;
  /** Modelling quad view vs UV/Pixel authoring shell. */
  shellMode: AppShellMode = 'model';
  texture: TextureWorkspaceState;
  /** Active tab in the model-shell right inspector. */
  inspectorTab: InspectorTab = 'create';
  /** Focused workflow inside the Edit tab. */
  inspectorSection: InspectorSection = 'select';
  /** Viewport node editing for procedural curves. */
  curveNodeEditMode = false;
  selectedCurvePointIndex = 0;
  /** Overlay Bézier handles on existing mesh vertices (no new tube mesh). */
  vertexBezierEdit: VertexBezierState | null = null;
  /** LightWave-style viewport navigation tool (per viewport). */
  viewportNavMode: ViewportNavMode = 'none';
  viewportNavViewId: ViewId | null = null;
  private listeners = new Set<Listener>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private texturePersistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.preferences = loadWorkspacePreferences();
    this.preferences.viewportNavToolsVisible = true;
    this.splits = new SplitLayoutManager(this.preferences.layout);
    this.input = new InputRouter();
    this.texture = loadTextureWorkspace();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  get hoveredViewportId(): ViewId | null {
    return this.splits.state.hoveredViewportId;
  }

  get activeViewportId(): ViewId {
    return this.splits.state.lastActiveViewportId;
  }

  get layoutMode() {
    return this.splits.mode;
  }

  setHoveredViewport(id: ViewId | null): void {
    const prev = this.splits.state.hoveredViewportId;
    this.splits.setHovered(id);
    if (prev !== id) this.notify();
  }

  setActiveViewport(id: ViewId): void {
    this.splits.setActive(id);
    this.notify();
  }

  setSplits(partial: Parameters<SplitLayoutManager['setSplits']>[0]): void {
    this.splits.setSplits(partial);
    this.notify();
    this.schedulePersist();
  }

  setBlockoutArrangement(arrangement: BlockoutArrangement): void {
    this.splits.setBlockoutArrangement(arrangement);
    this.splits.restoreQuad();
    this.notify();
    this.schedulePersist();
  }

  setBlockoutColumns(partial: { a?: number; b?: number }): void {
    this.splits.setBlockoutColumns(partial);
    this.notify();
    this.schedulePersist();
  }

  handleTab(): boolean {
    if (this.shellMode === 'texture') {
      if (!isTextureSplitLayout(this.texture)) this.restoreTextureSplit();
      else this.toggleTexture3dPreview();
      return true;
    }
    if (this.shellMode === 'terrain') return true;
    if (this.shellMode === 'sculpt') return true;
    if (this.shellMode === 'rig') return true;
    if (this.shellMode === 'animate') return true;
    // Prefer hovered pane, else the last active one (never maximize with a null id).
    this.splits.toggleMaximize(
      this.splits.state.hoveredViewportId ?? this.splits.state.lastActiveViewportId,
    );
    this.notify();
    this.schedulePersist();
    return true;
  }

  /** Maximize a specific modelling viewport, or restore the quad layout. */
  toggleViewportMaximize(id: ViewId): void {
    this.splits.toggleMaximize(id);
    this.notify();
    this.schedulePersist();
  }

  setShellMode(mode: AppShellMode): void {
    const changed = this.shellMode !== mode;
    if (changed) {
      this.shellMode = mode;
      this.texture.open = mode === 'texture';
      if (this.shellMode === 'texture' || this.shellMode === 'terrain' || this.shellMode === 'sculpt' || this.shellMode === 'rig' || this.shellMode === 'animate') {
        this.splits.setActive('persp');
        this.splits.setHovered('persp');
      }
      if (mode === 'blockout') {
        this.splits.restoreQuad();
        this.setViewportNav('none', null);
      }
      if (mode !== 'texture') {
        this.texture.maximize = 'none';
      }
    }
    // Pan / orbit / zoom tools belong on every 3D (and UV) workspace.
    this.setViewportNavToolsVisible(true);
    if (changed) {
      this.notify();
      this.scheduleTexturePersist();
    }
  }

  setInspectorTab(tab: InspectorTab): void {
    if (this.inspectorTab === tab) return;
    this.inspectorTab = tab;
    this.notify();
  }

  setInspectorSection(section: InspectorSection): void {
    const changed = this.inspectorSection !== section || this.inspectorTab !== 'edit';
    this.inspectorSection = section;
    this.inspectorTab = 'edit';
    if (changed) this.notify();
  }

  setCurveNodeEditMode(enabled: boolean): void {
    if (this.curveNodeEditMode === enabled) return;
    this.curveNodeEditMode = enabled;
    if (!enabled) this.vertexBezierEdit = null;
    this.notify();
  }

  setVertexBezierEdit(state: VertexBezierState | null): void {
    this.vertexBezierEdit = state;
    this.curveNodeEditMode = state !== null;
    this.notify();
  }

  setSelectedCurvePointIndex(index: number): void {
    const next = Math.max(0, Math.round(index));
    if (this.selectedCurvePointIndex === next) return;
    this.selectedCurvePointIndex = next;
    this.notify();
  }

  setViewportNav(mode: ViewportNavMode, viewId: ViewId | null): void {
    const changed = this.viewportNavMode !== mode || this.viewportNavViewId !== viewId;
    this.viewportNavMode = mode;
    this.viewportNavViewId = mode === 'none' ? null : viewId;
    if (changed) this.notify();
  }

  toggleViewportNav(mode: Exclude<ViewportNavMode, 'none'>, viewId: ViewId): void {
    if (this.viewportNavMode === mode && this.viewportNavViewId === viewId) {
      this.setViewportNav('none', null);
    } else {
      this.setViewportNav(mode, viewId);
    }
  }

  get viewportNavToolsVisible(): boolean {
    return this.preferences.viewportNavToolsVisible;
  }

  setViewportNavToolsVisible(visible: boolean): void {
    if (this.preferences.viewportNavToolsVisible === visible) return;
    this.preferences.viewportNavToolsVisible = visible;
    if (!visible) this.setViewportNav('none', null);
    this.notify();
    this.schedulePersist();
  }

  toggleViewportNavToolsVisible(): void {
    this.setViewportNavToolsVisible(!this.preferences.viewportNavToolsVisible);
  }

  setTextureSplit(ratio: number): void {
    this.texture.splitRatio = clampTextureSplit(ratio);
    this.notify();
    this.scheduleTexturePersist();
  }

  setTexture3dWindow(partial: Partial<Texture3dWindowState>, bounds?: { width: number; height: number }): void {
    this.setTexturePanelWindow('3d', partial, bounds);
  }

  setTexturePanelWindow(
    panel: TexturePanelId,
    partial: Partial<Texture3dWindowState>,
    bounds?: { width: number; height: number },
  ): void {
    const key = panel === '3d' ? 'preview3d' : 'uvWindow';
    const next = { ...this.texture[key], ...partial };
    this.texture[key] = bounds ? clampTexture3dWindow(next, bounds) : next;
    if (next.visible && this.texture.maximize === (panel === '3d' ? 'right' : 'left')) {
      this.texture.maximize = 'none';
    }
    this.notify();
    this.scheduleTexturePersist();
  }

  restoreTextureSplit(): void {
    this.texture.maximize = 'none';
    this.texture.preview3d = { ...this.texture.preview3d, visible: true, docked: true };
    this.texture.uvWindow = { ...this.texture.uvWindow, visible: true, docked: true };
    this.notify();
    this.scheduleTexturePersist();
  }

  toggleTexture3dPreview(): void {
    if (!this.texture.preview3d.visible) {
      this.texture.preview3d.visible = true;
      if (this.texture.uvWindow.docked && this.texture.uvWindow.visible) {
        this.texture.preview3d.docked = true;
      }
      this.texture.maximize = 'none';
    } else if (this.texture.maximize === 'left') {
      this.texture.maximize = 'none';
      this.texture.preview3d.visible = true;
    } else {
      this.texture.preview3d.visible = false;
      this.texture.maximize = 'none';
    }
    this.notify();
    this.scheduleTexturePersist();
  }

  patchTexture(partial: Partial<TextureWorkspaceState>): void {
    this.texture = { ...this.texture, ...partial };
    this.notify();
    this.scheduleTexturePersist();
  }

  toggleTextureMaximize(side?: 'left' | 'right'): void {
    const current = this.texture.maximize;
    if (current !== 'none') {
      this.texture.maximize = 'none';
    } else {
      this.texture.maximize = side ?? 'right';
    }
    this.notify();
    this.scheduleTexturePersist();
  }

  /** Viewport rects for the WebGL host (full host in texture shell = Perspective only, blockout = 3 viewports). */
  computeViewportRects(width: number, height: number) {
    if (this.shellMode === 'blockout') {
      return this.splits.computeBlockoutRects(width, height);
    }
    if (this.shellMode === 'texture' || this.shellMode === 'terrain' || this.shellMode === 'sculpt' || this.shellMode === 'rig' || this.shellMode === 'animate') {
      return this.splits.computeSinglePersp(width, height);
    }
    return this.splits.computeRects(width, height);
  }

  hitTestViewport(localX: number, localY: number, width: number, height: number): ViewId | null {
    const rects = this.computeViewportRects(width, height);
    for (const r of rects) {
      if (localX >= r.x && localX < r.x + r.width && localY >= r.y && localY < r.y + r.height) {
        return r.id;
      }
    }
    return null;
  }

  private scheduleTexturePersist(): void {
    if (this.texturePersistTimer) clearTimeout(this.texturePersistTimer);
    this.texturePersistTimer = setTimeout(() => {
      saveTextureWorkspace(this.texture);
    }, 250);
  }

  updateCameraState(
    id: ViewId,
    camera: WorkspacePreferences['viewports'][ViewId]['camera'],
  ): void {
    this.preferences.viewports[id] = {
      ...this.preferences.viewports[id],
      camera,
    };
    this.schedulePersist();
  }

  getCamera(id: ViewId) {
    return this.preferences.viewports[id].camera;
  }

  getShadingMode(): ShadingMode {
    return normalizeShadingMode(this.preferences.viewports.persp.shadingMode);
  }

  getDisplayTextures(): boolean {
    return this.preferences.displayTextures !== false;
  }

  setDisplayTextures(enabled: boolean): void {
    if (this.getDisplayTextures() === enabled) return;
    this.preferences.displayTextures = enabled;
    this.notify();
    this.schedulePersist();
  }

  getDrawOnSurfaces(): boolean {
    return this.preferences.drawOnSurfaces !== false;
  }

  setDrawOnSurfaces(enabled: boolean): void {
    if (this.getDrawOnSurfaces() === enabled) return;
    this.preferences.drawOnSurfaces = enabled;
    this.notify();
    this.schedulePersist();
  }

  setShadingMode(mode: ShadingMode): void {
    const normalized = normalizeShadingMode(mode);
    let changed = false;
    if (this.getShadingMode() !== normalized) {
      for (const id of VIEW_ORDER) {
        this.preferences.viewports[id].shadingMode = normalized;
      }
      changed = true;
    }
    if (normalized === 'material' && !this.getDisplayTextures()) {
      this.preferences.displayTextures = true;
      changed = true;
    }
    if (!changed) return;
    this.notify();
    this.schedulePersist();
  }

  schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.preferences.layout = this.splits.toPersisted();
      saveWorkspacePreferences(this.preferences);
    }, 250);
  }

  resetLayout(): void {
    this.preferences = defaultPreferences();
    this.splits.load(this.preferences.layout);
    this.notify();
    this.schedulePersist();
  }
}
