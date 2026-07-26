import { describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, LineSegments, Vector3 } from 'three';
import { GRID_BASE_DIVISIONS, niceGridSize, ViewportGrid } from '@/renderer/ViewportGrid';

describe('ViewportGrid', () => {
  it('centres its adaptive patch around the snapped view target', () => {
    const grid = new ViewportGrid();
    grid.update('top', 20, new Vector3(100, 0, -50));

    const lines = grid.children[0] as LineSegments<BufferGeometry>;
    const positions = lines.geometry.getAttribute('position') as BufferAttribute;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < positions.count; i++) {
      minX = Math.min(minX, positions.getX(i)); maxX = Math.max(maxX, positions.getX(i));
      minZ = Math.min(minZ, positions.getZ(i)); maxZ = Math.max(maxZ, positions.getZ(i));
    }
    expect((minX + maxX) / 2).toBeCloseTo(100);
    expect((minZ + maxZ) / 2).toBeCloseTo(-50);
  });

  it('keeps about twenty cells visible at wide camera overviews', () => {
    const size = niceGridSize(512);
    const spacing = size / GRID_BASE_DIVISIONS;
    expect(size / spacing).toBe(GRID_BASE_DIVISIONS);
  });
});
