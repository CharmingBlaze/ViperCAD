import { describe, expect, it } from 'vitest';
import {
  marqueeModeFromDrag,
  normalizeScreenRect,
  pointInRect,
  pointsSatisfyMarquee,
  segmentHitsRect,
} from '@/core/selection/MarqueeSelect';

describe('MarqueeSelect', () => {
  it('normalizes rects drawn in any direction', () => {
    expect(normalizeScreenRect(10, 20, 5, 8)).toEqual({
      minX: 5,
      minY: 8,
      maxX: 10,
      maxY: 20,
    });
  });

  it('uses window when dragging right and crossing when dragging left', () => {
    expect(marqueeModeFromDrag(50, 80)).toBe('window');
    expect(marqueeModeFromDrag(50, 20)).toBe('crossing');
  });

  it('window requires every point inside; crossing needs any', () => {
    const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    const pts = [
      { x: 1, y: 1 },
      { x: 20, y: 1 },
    ];
    expect(pointsSatisfyMarquee(pts, rect, 'window')).toBe(false);
    expect(pointsSatisfyMarquee(pts, rect, 'crossing')).toBe(true);
    expect(pointInRect(5, 5, rect)).toBe(true);
  });

  it('detects segments that cross the rect without endpoints inside', () => {
    const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(segmentHitsRect(-5, 5, 15, 5, rect)).toBe(true);
    expect(segmentHitsRect(-5, -5, -1, -1, rect)).toBe(false);
  });
});
