import {
  clampSplit,
  createDefaultLayoutState,
  type LayoutMode,
  type QuadSplitRatios,
  type ViewId,
  type ViewportLayoutState,
} from './types';

/** CSS-pixel viewport rectangle. All layout/hit-test/render systems share this. */
export type ViewportRect = {
  id: ViewId;
  /** CSS X from left of modelling region. */
  x: number;
  /** CSS Y from top of modelling region. */
  y: number;
  width: number;
  height: number;
  /** WebGL Y from bottom of modelling region (CSS space — do not multiply by DPR). */
  webglY: number;
  /** @deprecated use x */
  cssLeft: number;
  /** @deprecated use y */
  cssTop: number;
};

/**
 * Owns quad split ratios, maximize/restore, and rectangle computation.
 * Does not own cameras or the document.
 */
export class SplitLayoutManager {
  state: ViewportLayoutState;

  constructor(initial?: ViewportLayoutState) {
    this.state = initial ?? createDefaultLayoutState();
  }

  get mode(): LayoutMode {
    return this.state.mode;
  }

  get splits(): QuadSplitRatios {
    return this.state.splits;
  }

  setSplits(partial: Partial<QuadSplitRatios>): void {
    if (partial.horizontal != null) this.state.splits.horizontal = clampSplit(partial.horizontal);
    if (partial.upperVertical != null) {
      this.state.splits.upperVertical = clampSplit(partial.upperVertical);
    }
    if (partial.lowerVertical != null) {
      this.state.splits.lowerVertical = clampSplit(partial.lowerVertical);
    }
  }

  setHovered(id: ViewId | null): void {
    this.state.hoveredViewportId = id;
    if (id) this.state.lastActiveViewportId = id;
  }

  setActive(id: ViewId): void {
    this.state.lastActiveViewportId = id;
  }

  toggleMaximize(targetId?: ViewId | null): void {
    if (this.state.mode === 'maximized') {
      this.restoreQuad();
      return;
    }
    this.maximize(targetId);
  }

  maximize(id?: ViewId | null): void {
    const viewId = id ?? this.state.hoveredViewportId ?? this.state.lastActiveViewportId ?? 'persp';
    this.state.mode = 'maximized';
    this.state.maximizedViewportId = viewId;
    this.state.lastActiveViewportId = viewId;
  }

  restoreQuad(): void {
    this.state.mode = 'quad';
    this.state.maximizedViewportId = null;
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

  /**
   * Compute viewport rectangles in CSS pixel space (origin top-left).
   * Pass these CSS values to Three.js setViewport/setScissor — never multiply by DPR.
   */
  computeSinglePersp(width: number, height: number): ViewportRect[] {
    if (width < 1 || height < 1) return [];
    return [this.makeRect('persp', 0, 0, width, height, height)];
  }

  computeRects(width: number, height: number): ViewportRect[] {
    if (width < 1 || height < 1) return [];

    if (this.state.mode === 'maximized') {
      const id =
        this.state.maximizedViewportId ?? this.state.lastActiveViewportId ?? 'persp';
      return [this.makeRect(id, 0, 0, width, height, height)];
    }

    const { horizontal, upperVertical, lowerVertical } = this.state.splits;
    const upperH = Math.max(1, Math.round(height * horizontal));
    const lowerH = Math.max(1, height - upperH);
    const upperLeftW = Math.max(1, Math.round(width * upperVertical));
    const upperRightW = Math.max(1, width - upperLeftW);
    const lowerLeftW = Math.max(1, Math.round(width * lowerVertical));
    const lowerRightW = Math.max(1, width - lowerLeftW);

    return [
      this.makeRect('persp', 0, 0, upperLeftW, upperH, height),
      this.makeRect('top', upperLeftW, 0, upperRightW, upperH, height),
      this.makeRect('front', 0, upperH, lowerLeftW, lowerH, height),
      this.makeRect('right', lowerLeftW, upperH, lowerRightW, lowerH, height),
    ];
  }

  hitTest(localX: number, localY: number, width: number, height: number): ViewId | null {
    const rects = this.computeRects(width, height);
    for (const r of rects) {
      if (localX >= r.x && localX < r.x + r.width && localY >= r.y && localY < r.y + r.height) {
        return r.id;
      }
    }
    return null;
  }

  toPersisted(): ViewportLayoutState {
    return {
      mode: this.state.mode,
      maximizedViewportId: this.state.maximizedViewportId,
      splits: { ...this.state.splits },
      lastActiveViewportId: this.state.lastActiveViewportId,
      hoveredViewportId: null,
    };
  }

  load(state: ViewportLayoutState): void {
    this.state = {
      ...state,
      splits: {
        horizontal: clampSplit(state.splits.horizontal),
        upperVertical: clampSplit(state.splits.upperVertical),
        lowerVertical: clampSplit(state.splits.lowerVertical),
      },
      hoveredViewportId: null,
    };
  }
}
