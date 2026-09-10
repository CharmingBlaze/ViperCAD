import { describe, expect, it } from 'vitest';
import { SplitLayoutManager } from '../SplitLayoutManager';
import { WorkspaceController } from '../WorkspaceController';

describe('Blockout 3-viewport layout', () => {
  it('computes 3 viewports: front, right (side), and persp', () => {
    const layout = new SplitLayoutManager();
    layout.restoreQuad();
    const rects = layout.computeBlockoutRects(1000, 800);
    expect(rects).toHaveLength(3);

    const front = rects.find((r) => r.id === 'front');
    const right = rects.find((r) => r.id === 'right');
    const persp = rects.find((r) => r.id === 'persp');

    expect(front).toBeDefined();
    expect(right).toBeDefined();
    expect(persp).toBeDefined();

    // Front: top-left
    expect(front!.x).toBe(0);
    expect(front!.y).toBe(0);
    expect(front!.width).toBe(500);
    expect(front!.height).toBe(400);

    // Right (Side): bottom-left
    expect(right!.x).toBe(0);
    expect(right!.y).toBe(400);
    expect(right!.width).toBe(500);
    expect(right!.height).toBe(400);

    // Persp: right column, full height
    expect(persp!.x).toBe(500);
    expect(persp!.y).toBe(0);
    expect(persp!.width).toBe(500);
    expect(persp!.height).toBe(800);
  });

  it('computes three full-height vertical windows in columns arrangement', () => {
    const layout = new SplitLayoutManager();
    layout.restoreQuad();
    layout.setBlockoutArrangement('columns');
    layout.setBlockoutColumns({ a: 1 / 3, b: 2 / 3 });
    const rects = layout.computeBlockoutRects(900, 600);
    expect(rects).toHaveLength(3);
    expect(rects.map((r) => r.id)).toEqual(['front', 'right', 'persp']);
    expect(rects[0]).toMatchObject({ x: 0, y: 0, width: 300, height: 600 });
    expect(rects[1]).toMatchObject({ x: 300, y: 0, width: 300, height: 600 });
    expect(rects[2]).toMatchObject({ x: 600, y: 0, width: 300, height: 600 });
  });

  it('respects maximized mode in blockout', () => {
    const layout = new SplitLayoutManager();
    layout.maximize('front');
    const rects = layout.computeBlockoutRects(1000, 800);
    expect(rects).toHaveLength(1);
    expect(rects[0]!.id).toBe('front');
    expect(rects[0]!.width).toBe(1000);
    expect(rects[0]!.height).toBe(800);
  });

  it('routes through WorkspaceController when shellMode is blockout', () => {
    const workspace = new WorkspaceController();
    workspace.setShellMode('blockout');
    const rects = workspace.computeViewportRects(1200, 600);
    expect(rects).toHaveLength(3);
    expect(rects.map((r) => r.id)).toEqual(['front', 'right', 'persp']);
  });

  it('switches Blockout to three vertical windows through WorkspaceController', () => {
    const workspace = new WorkspaceController();
    workspace.setShellMode('blockout');
    workspace.setBlockoutArrangement('columns');
    const rects = workspace.computeViewportRects(900, 450);
    expect(rects.map((r) => r.id)).toEqual(['front', 'right', 'persp']);
    expect(rects.every((r) => r.y === 0 && r.height === 450)).toBe(true);
    workspace.setBlockoutArrangement('stack');
    const stacked = workspace.computeViewportRects(1000, 800);
    expect(stacked.find((r) => r.id === 'persp')!.height).toBe(800);
    expect(stacked.find((r) => r.id === 'front')!.height).toBe(400);
  });
});
