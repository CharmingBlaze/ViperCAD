import {
  clampBlockoutColumns,
  clampSplit,
  createDefaultLayoutState,
  DEFAULT_BLOCKOUT_COLUMN_A,
  DEFAULT_BLOCKOUT_COLUMN_B,
  type BlockoutArrangement,
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
    this.state = createDefaultLayoutState();
    if (initial) this.load(initial);
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

  computeBlockoutRects(width: number, height: number): ViewportRect[] {
    if (width < 1 || height < 1) return [];

    if (this.state.mode === 'maximized') {
      const id =
        this.state.maximizedViewportId ?? this.state.lastActiveViewportId ?? 'persp';
      return [this.makeRect(id, 0, 0, width, height, height)];
    }

    if (this.state.blockoutArrangement === 'columns') {
      const { a, b } = clampBlockoutColumns(this.state.blockoutColumnA, this.state.blockoutColumnB);
      const x1 = Math.max(1, Math.round(width * a));
      const x2 = Math.max(x1 + 1, Math.round(width * b));
      const w1 = x1;
      const w2 = Math.max(1, x2 - x1);
      const w3 = Math.max(1, width - x2);
      return [
        this.makeRect('front', 0, 0, w1, height, height),
        this.makeRect('right', x1, 0, w2, height, height),
        this.makeRect('persp', x2, 0, w3, height, height),
      ];
    }

    const { horizontal, upperVertical } = this.state.splits;
    const leftW = Math.max(1, Math.round(width * upperVertical));
    const rightW = Math.max(1, width - leftW);
    const frontH = Math.max(1, Math.round(height * horizontal));
    const sideH = Math.max(1, height - frontH);

    return [
      this.makeRect('front', 0, 0, leftW, frontH, height),
      this.makeRect('right', 0, frontH, leftW, sideH, height),
      this.makeRect('persp', leftW, 0, rightW, height, height),
    ];
  }

  setBlockoutArrangement(arrangement: BlockoutArrangement): void {
    this.state.blockoutArrangement = arrangement;
  }

  setBlockoutColumns(partial: { a?: number; b?: number }): void {
    const next = clampBlockoutColumns(
      partial.a ?? this.state.blockoutColumnA,
      partial.b ?? this.state.blockoutColumnB,
    );
    this.state.blockoutColumnA = next.a;
    this.state.blockoutColumnB = next.b;
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
      this.makeRect('top', 0, 0, upperLeftW, upperH, height),
      this.makeRect('persp', upperLeftW, 0, upperRightW, upperH, height),
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
      blockoutArrangement: this.state.blockoutArrangement,
      blockoutColumnA: this.state.blockoutColumnA,
      blockoutColumnB: this.state.blockoutColumnB,
    };
  }

  load(state: ViewportLayoutState): void {
    const columns = clampBlockoutColumns(
      state.blockoutColumnA ?? DEFAULT_BLOCKOUT_COLUMN_A,
      state.blockoutColumnB ?? DEFAULT_BLOCKOUT_COLUMN_B,
    );
    this.state = {
      ...state,
      splits: {
        horizontal: clampSplit(state.splits.horizontal),
        upperVertical: clampSplit(state.splits.upperVertical),
        lowerVertical: clampSplit(state.splits.lowerVertical),
      },
      blockoutArrangement: state.blockoutArrangement === 'columns' ? 'columns' : 'stack',
      blockoutColumnA: columns.a,
      blockoutColumnB: columns.b,
      hoveredViewportId: null,
    };
  }
}
