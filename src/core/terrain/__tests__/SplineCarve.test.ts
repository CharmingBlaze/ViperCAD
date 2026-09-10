import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import { buildPlane } from '@/core/mesh/builders/PlaneBuilder';
import {
  carveTerrainSplinePath,
  evaluateCatmullRomSpline,
  generateRiverWaterMesh,
} from '@/core/terrain/SplineCarve';

describe('SplineCarve', () => {
  it('evaluates Catmull-Rom spline curves', () => {
    const points = [v3(0, 0, 0), v3(10, 0, 0), v3(20, 0, 10)];
    const result = evaluateCatmullRomSpline(points, 0.5);
    expect(result.position.x).toBeGreaterThan(0);
    expect(result.position.x).toBeLessThan(20);
    expect(result.tangent).toBeDefined();
  });

  it('carves riverbed spline path into terrain', () => {
    const mesh = buildPlane({ width: 20, depth: 20 });
    const points = [v3(-12, 0, -10), v3(0, 0, -10), v3(12, 0, -10)];

    const affected = carveTerrainSplinePath(mesh, points, {
      width: 25,
      depth: 2,
      mode: 'river',
    });

    expect(affected).toBeGreaterThan(0);
  });

  it('flattens road spline path onto terrain', () => {
    const mesh = buildPlane({ width: 20, depth: 20 });
    const points = [v3(-12, 2, -10), v3(0, 2, -10), v3(12, 2, -10)];

    const affected = carveTerrainSplinePath(mesh, points, {
      width: 25,
      mode: 'road',
    });

    expect(affected).toBeGreaterThan(0);

    const vert = [...mesh.vertices.values()][0]!;
    expect(vert).toBeDefined();
    expect(vert.position.y).toBeGreaterThan(0.5);
  });

  it('generates river water ribbon mesh with flow-aligned UVs', () => {
    const points = [v3(-10, 0, 0), v3(0, 0, 5), v3(10, 0, 0)];
    const riverMesh = generateRiverWaterMesh(points, 4, 4);

    expect(riverMesh.vertices.size).toBeGreaterThan(0);
    expect(riverMesh.faces.size).toBeGreaterThan(0);

    const defaultLayer = riverMesh.defaultUvLayerId!;
    for (const corner of riverMesh.faceCorners.values()) {
      const uv = corner.uvs.get(defaultLayer);
      expect(uv).toBeDefined();
      expect(uv!.x).toBeGreaterThanOrEqual(0);
      expect(uv!.x).toBeLessThanOrEqual(1.05);
    }
  });
});
