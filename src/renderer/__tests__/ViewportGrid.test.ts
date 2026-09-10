import { describe, expect, it } from 'vitest';
import { ShaderMaterial, Vector3 } from 'three';
import { niceGridSize, niceGridSpacing, ViewportGrid } from '@/renderer/ViewportGrid';

describe('ViewportGrid', () => {
  it('anchors the floor patch on the snapped view target', () => {
    const grid = new ViewportGrid();
    grid.update('top', 20, new Vector3(100, 0, -50), 1);
    expect(grid.mesh.position.x).toBeCloseTo(100);
    expect(grid.mesh.position.z).toBeCloseTo(-50);
    expect((grid.mesh.material as ShaderMaterial).uniforms.planeMode.value).toBe(0);
    expect((grid.mesh.material as ShaderMaterial).uniforms.cellSize.value).toBe(1);
  });

  it('uses a vertical plane for front views', () => {
    const grid = new ViewportGrid();
    grid.update('front', 20, new Vector3(0, 4, 0), 1);
    expect((grid.mesh.material as ShaderMaterial).uniforms.planeMode.value).toBe(1);
    expect(grid.mesh.position.y).toBeCloseTo(4);
  });

  it('keeps about eighteen cells visible across a view span', () => {
    const span = 512;
    const spacing = niceGridSpacing(span);
    const cells = span / spacing;
    expect(cells).toBeGreaterThan(10);
    expect(cells).toBeLessThan(40);
  });

  it('extends the perspective patch far beyond the visible span', () => {
    expect(niceGridSize(16, true)).toBeGreaterThan(niceGridSize(16, false));
  });
});
