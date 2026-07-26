import { describe, expect, it } from 'vitest';
import { boundsForView, orthographicFrameHeight, perspectiveFrameDistance } from '@/app/ViewportFraming';

describe('viewport framing', () => {
  it('builds a stable bounding sphere around points', () => {
    const bounds = boundsForView([{ x: -2, y: -1, z: 0 }, { x: 2, y: 3, z: 0 }]);
    expect(bounds?.center).toEqual({ x: 0, y: 1, z: 0 });
    expect(bounds?.radius).toBeCloseTo(Math.sqrt(8));
  });

  it('backs a perspective camera farther away for narrow panes', () => {
    expect(perspectiveFrameDistance(2, 45, 0.5)).toBeGreaterThan(
      perspectiveFrameDistance(2, 45, 2),
    );
  });

  it('expands an orthographic frame for portrait panes', () => {
    expect(orthographicFrameHeight(2, 0.5)).toBeCloseTo(9.2);
    expect(orthographicFrameHeight(2, 2)).toBeCloseTo(4.6);
  });
});
