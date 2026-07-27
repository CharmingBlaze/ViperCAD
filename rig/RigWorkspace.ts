import { clampSplit, type ViewId, type ViewPreset, DEFAULT_VIEW_PRESETS } from '@/workspace/types';
import type { ObjectId } from '@/core/document/types';

/** CSS-pixel viewport rectangle for the rig animation editor. */
export type ViewportRect = {
  id: ViewId;
  x: number;
  y: number;
  width: number;
  height: number;
  webglY: number;
  cssLeft: number;
  cssTop: number;
};

/** Left pane — always scene camera look-through. */
export const RIG_CAMERA_PANE: ViewId = 'front';
/** Right pane — user perspective orbit view. */
export const RIG_PERSP_PANE: ViewId = 'persp';

export const RIG_VIEW_LABELS: Record<typeof RIG_CAMERA_PANE | typeof RIG_PERSP_PANE, string> = {
  front: 'Camera',
  persp: 'Perspective',
};

export const RIG_PANE_IDS: ViewId[] = [RIG_CAMERA_PANE, RIG_PERSP_PANE];

/** Dual-pane workspace for ViperRig: camera + perspective, vertical split. */
export class RigWorkspace {
  private listeners = new Set<() => void>();
  /** Left column width as fraction of the modelling region [0–1]. */
  verticalSplit = 0.5;
  layoutMode: 'dual' | 'maximized' = 'dual';
  maximizedViewportId: ViewId | null = null;
  lastActiveViewportId: ViewId = RIG_PERSP_PANE;
  hoveredViewportId: ViewId | null = null;
  paneViews: Record<ViewId, ViewPreset> = { ...DEFAULT_VIEW_PRESETS };
  lookThroughCameras: Partial<Record<ViewId, ObjectId>> = {};

  get activeViewportId(): ViewId {
    return this.lastActiveViewportId;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }

  private makeRect(
    id: ViewId,
    x: number,
    y: number,
    width: number,
    height: number,
    containerHeight: number,
  ): ViewportRect {
    return {
      id,
      x,
      y,
      width,
      height,
      webglY: containerHeight - y - height,
      cssLeft: x,
      cssTop: y,
    };
  }

  computeViewportRects(width: number, height: number): ViewportRect[] {
    if (width < 1 || height < 1) return [];

    if (this.layoutMode === 'maximized') {
      const id = this.maximizedViewportId ?? this.lastActiveViewportId ?? RIG_PERSP_PANE;
      return [this.makeRect(id, 0, 0, width, height, height)];
    }

    const leftW = Math.max(1, Math.round(width * this.verticalSplit));
    const rightW = Math.max(1, width - leftW);
    return [
      this.makeRect(RIG_CAMERA_PANE, 0, 0, leftW, height, height),
      this.makeRect(RIG_PERSP_PANE, leftW, 0, rightW, height, height),
    ];
  }

  hitTest(localX: number, localY: number, width: number, height: number): ViewId | null {
    for (const rect of this.computeViewportRects(width, height)) {
      if (localX >= rect.x && localX < rect.x + rect.width && localY >= rect.y && localY < rect.y + rect.height) {
        return rect.id;
      }
    }
    return null;
  }

  setHovered(id: ViewId | null): void {
    this.hoveredViewportId = id;
    if (id) this.lastActiveViewportId = id;
  }

  setActive(id: ViewId): void {
    this.lastActiveViewportId = id;
    this.notify();
  }

  toggleViewportMaximize(id?: ViewId | null): void {
    if (this.layoutMode === 'maximized') {
      this.layoutMode = 'dual';
      this.maximizedViewportId = null;
    } else {
      this.layoutMode = 'maximized';
      this.maximizedViewportId = id ?? this.hoveredViewportId ?? this.lastActiveViewportId;
      this.lastActiveViewportId = this.maximizedViewportId;
    }
    this.notify();
  }

  handleTab(): void {
    this.toggleViewportMaximize(this.hoveredViewportId ?? this.lastActiveViewportId);
  }

  setVerticalSplit(value: number): void {
    this.verticalSplit = clampSplit(value);
    this.notify();
  }

  get splitsState() {
    return { vertical: this.verticalSplit };
  }

  get splits() {
    return { state: { maximizedViewportId: this.maximizedViewportId } };
  }

  getPaneView(viewId: ViewId): ViewPreset {
    return this.paneViews[viewId];
  }

  setPaneView(viewId: ViewId, view: ViewPreset): void {
    if (this.paneViews[viewId] === view) return;
    this.paneViews = { ...this.paneViews, [viewId]: view };
    if (viewId !== RIG_CAMERA_PANE) delete this.lookThroughCameras[viewId];
    this.notify();
  }

  getLookThroughCamera(viewId: ViewId): ObjectId | null {
    return this.lookThroughCameras[viewId] ?? null;
  }

  /** Camera pane always looks through; persp pane only when explicitly set. */
  getEffectiveLookThroughCamera(viewId: ViewId): ObjectId | null {
    if (viewId === RIG_CAMERA_PANE) {
      return this.lookThroughCameras[RIG_CAMERA_PANE] ?? null;
    }
    return this.lookThroughCameras[viewId] ?? null;
  }

  setLookThroughCamera(viewId: ViewId, objectId: ObjectId | null): void {
    if (objectId) {
      if (this.lookThroughCameras[viewId] === objectId) return;
      this.lookThroughCameras = { ...this.lookThroughCameras, [viewId]: objectId };
    } else if (viewId !== RIG_CAMERA_PANE) {
      if (!(viewId in this.lookThroughCameras)) return;
      const next = { ...this.lookThroughCameras };
      delete next[viewId];
      this.lookThroughCameras = next;
    } else {
      return;
    }
    this.notify();
  }

  setCameraPaneLookThrough(objectId: ObjectId): void {
    if (this.lookThroughCameras[RIG_CAMERA_PANE] === objectId) return;
    this.lookThroughCameras = { ...this.lookThroughCameras, [RIG_CAMERA_PANE]: objectId };
    this.notify();
  }

  clearLookThroughCamera(objectId: ObjectId): void {
    let changed = false;
    const next = { ...this.lookThroughCameras };
    for (const [viewId, id] of Object.entries(next)) {
      if (id === objectId) {
        if (viewId === RIG_CAMERA_PANE) continue;
        delete next[viewId as ViewId];
        changed = true;
      }
    }
    if (changed) {
      this.lookThroughCameras = next;
      this.notify();
    }
  }
}
