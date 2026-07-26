import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import { buildStrokeTube, resampleStrokePoints } from '@/core/mesh/builders/StrokeTubeBuilder';
import { validateMeshFull } from '@/core/mesh/Validation';

describe('StrokeTubeBuilder', () => {
  it('resamples near-duplicate points', () => {
    const pts = [v3(0, 0, 0), v3(0.01, 0, 0), v3(1, 0, 0)];
    const out = resampleStrokePoints(pts, 0.1);
    expect(out.length).toBe(2);
    expect(out[0]!.x).toBe(0);
    expect(out[1]!.x).toBe(1);
  });

  it('builds a valid low-poly tube along a path', () => {
    const mesh = buildStrokeTube({
      points: [v3(0, 0, 0), v3(1, 0, 0), v3(1, 1, 0), v3(2, 1.5, 0.5)],
      radius: 0.1,
      radialSegments: 6,
    });
    expect(mesh.faces.size).toBeGreaterThan(0);
    expect(mesh.vertices.size).toBe(4 * 6); // rings * segments (caps share ring verts)
    for (const v of mesh.vertices.values()) {
      expect(Number.isFinite(v.position.x)).toBe(true);
      expect(Number.isFinite(v.position.y)).toBe(true);
      expect(Number.isFinite(v.position.z)).toBe(true);
    }
    const report = validateMeshFull(mesh);
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('scales vertex count with radial segments', () => {
    const path = [v3(0, 0, 0), v3(0, 0, 1), v3(0, 1, 2)];
    const low = buildStrokeTube({ points: path, radius: 0.08, radialSegments: 6 });
    const mid = buildStrokeTube({ points: path, radius: 0.08, radialSegments: 10 });
    expect(mid.vertices.size).toBeGreaterThan(low.vertices.size);
    expect(mid.faces.size).toBeGreaterThan(low.faces.size);
  });
});
