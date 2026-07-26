import { InputRouter } from './InputRouter';
import { SplitLayoutManager } from './SplitLayoutManager';
import {
  clampTextureSplit,
  loadTextureWorkspace,
  saveTextureWorkspace,
  type TextureWorkspaceState,
} from './TextureWorkspace';
import {
  defaultPreferences,
  loadWorkspacePreferences,
  saveWorkspacePreferences,
} from './WorkspacePersistence';
import type { AppShellMode, ViewId, WorkspacePreferences } from './types';

export type InspectorTab = 'create' | 'edit' | 'material';
export type InspectorSection = 'select' | 'transform' | 'geometry' | 'symmetry' | 'scene';

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
  private listeners = new Set<Listener>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private texturePersistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.preferences = loadWorkspacePreferences();
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

  handleTab(): boolean {
    if (this.shellMode === 'texture') {
      this.toggleTextureMaximize();
      return true;
    }
    if (this.shellMode === 'terrain') return true;
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
    if (this.shellMode === mode) return;
    this.shellMode = mode;
    this.texture.open = mode === 'texture';
    if (mode === 'texture' || mode === 'terrain') {
      this.splits.setActive('persp');
      this.splits.setHovered('persp');
    }
    if (mode !== 'texture') {
      this.texture.maximize = 'none';
    }
    this.notify();
    this.scheduleTexturePersist();
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

  setTextureSplit(ratio: number): void {
    this.texture.splitRatio = clampTextureSplit(ratio);
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

  /** Viewport rects for the WebGL host (full host in texture shell = Perspective only). */
  computeViewportRects(width: number, height: number) {
    if (this.shellMode === 'texture' || this.shellMode === 'terrain') {
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
