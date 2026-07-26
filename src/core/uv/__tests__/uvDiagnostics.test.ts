import { describe, expect, it } from 'vitest';
import { buildPlane } from '@/core/mesh/builders/PlaneBuilder';
import { analyseUvs } from '@/core/uv/UvDiagnostics';

describe('UV diagnostics', () => {
  it('reports predictable texel density for a unit plane', () => {
    const mesh = buildPlane({ width: 1, depth: 1 });
    const result = analyseUvs(mesh, mesh.defaultUvLayerId!, 64, 64);
    expect(result.averageDensity).toBeCloseTo(64, 5);
    expect(result.maximumDistortion).toBeCloseTo(1, 5);
    expect(result.degenerateFaces).toBe(0);
  });

  it('flags collapsed UV faces', () => {
    const mesh = buildPlane({ width: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    for (const corner of mesh.faceCorners.values()) corner.uvs.set(layerId, { x: 0, y: 0 });
    const result = analyseUvs(mesh, layerId, 16, 16);
    expect(result.degenerateFaces).toBe(1);
    expect(result.averageDensity).toBe(0);
  });
});
