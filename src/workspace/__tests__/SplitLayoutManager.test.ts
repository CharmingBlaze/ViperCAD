import { describe, expect, it } from 'vitest';
import { SplitLayoutManager } from '@/workspace/SplitLayoutManager';

describe('SplitLayoutManager CSS rects', () => {
  it('keeps rectangles in CSS pixels and computes webglY from container height', () => {
    const layout = new SplitLayoutManager();
    layout.setSplits({ horizontal: 0.5, upperVertical: 0.5, lowerVertical: 0.5 });
    const width = 1792;
    const height = 790;
    const rects = layout.computeRects(width, height);
    expect(rects).toHaveLength(4);

    const persp = rects.find((r) => r.id === 'persp')!;
    const top = rects.find((r) => r.id === 'top')!;
    expect(persp.x + persp.width).toBe(top.x);
    expect(persp.width + top.width).toBe(width);
    expect(persp.webglY).toBe(height - persp.y - persp.height);

    // Never DPR-scaled — 125% scale must not change these CSS values.
    expect(persp.x).toBe(0);
    expect(persp.y).toBe(0);
    expect(top.x).toBe(Math.round(width * 0.5));
  });

  it('hitTest uses the same CSS rectangles', () => {
    const layout = new SplitLayoutManager();
    expect(layout.hitTest(10, 10, 1000, 800)).toBe('persp');
    expect(layout.hitTest(900, 10, 1000, 800)).toBe('top');
    expect(layout.hitTest(10, 700, 1000, 800)).toBe('front');
    expect(layout.hitTest(900, 700, 1000, 800)).toBe('right');
  });

  it('maximize returns a single full-size rect and hides quad panes', () => {
    const layout = new SplitLayoutManager();
    layout.maximize('top');
    const rects = layout.computeRects(1200, 800);
    expect(rects).toHaveLength(1);
    expect(rects[0]!.id).toBe('top');
    expect(rects[0]!.width).toBe(1200);
    expect(rects[0]!.height).toBe(800);
    expect(rects[0]!.x).toBe(0);
    expect(rects[0]!.y).toBe(0);
  });

  it('maximize without an id still fills the host (never falls back to quad)', () => {
    const layout = new SplitLayoutManager();
    layout.maximize(null);
    expect(layout.mode).toBe('maximized');
    const rects = layout.computeRects(640, 480);
    expect(rects).toHaveLength(1);
    expect(rects[0]!.width).toBe(640);
    expect(rects[0]!.height).toBe(480);
  });

  it('toggleMaximize restores quad rectangles', () => {
    const layout = new SplitLayoutManager();
    layout.toggleMaximize('persp');
    expect(layout.computeRects(800, 600)).toHaveLength(1);
    layout.toggleMaximize();
    expect(layout.mode).toBe('quad');
    expect(layout.computeRects(800, 600)).toHaveLength(4);
  });
});
