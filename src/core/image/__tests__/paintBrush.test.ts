import { describe, expect, it } from 'vitest';
import { mirroredPaintPixels } from '@/core/image/paintBrush';

describe('mirroredPaintPixels', () => {
  it('returns the original pixel when mirrors are off', () => {
    expect(mirroredPaintPixels(16, 8, { x: 2, y: 3 }, false, false)).toEqual([{ x: 2, y: 3 }]);
  });

  it('mirrors across X, Y, and both without duplicates', () => {
    const points = mirroredPaintPixels(8, 8, { x: 1, y: 2 }, true, true);
    expect(points).toEqual(
      expect.arrayContaining([
        { x: 1, y: 2 },
        { x: 6, y: 2 },
        { x: 1, y: 5 },
        { x: 6, y: 5 },
      ]),
    );
    expect(points).toHaveLength(4);
  });

  it('dedupes the center pixel on an even axis', () => {
    const points = mirroredPaintPixels(5, 5, { x: 2, y: 2 }, true, true);
    expect(points).toEqual([{ x: 2, y: 2 }]);
  });
});
