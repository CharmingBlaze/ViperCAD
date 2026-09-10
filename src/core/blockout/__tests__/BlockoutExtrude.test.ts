import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import { computeFaceNormal } from '@/core/mesh/Normals';
import { validateMeshFull } from '@/core/mesh/Validation';
import { buildBlockoutExtrudeMesh, buildLowPolyEllipseContour, localizeMeshToBoundsCentre } from '../BlockoutExtrude';

describe('buildBlockoutExtrudeMesh', () => {
  it('keeps Front silhouettes outward', () => {
    const mesh = buildBlockoutExtrudeMesh(
      [v3(0, 0, 0), v3(2, 0, 0), v3(2, 2, 0), v3(0, 2, 0)],
      'front',
      1,
      true,
    );
    expect(mesh).toBeTruthy();
    expectOutward(mesh!);
  });

  it('flips Side silhouettes so they are not inside-out', () => {
    const mesh = buildBlockoutExtrudeMesh(
      [v3(0, 0, 0), v3(0, 0, 2), v3(0, 2, 2), v3(0, 2, 0)],
      'side',
      1,
      true,
    );
    expect(mesh).toBeTruthy();
    expect(validateMeshFull(mesh!).issues.some((issue) => issue.code === 'INWARD_WINDING')).toBe(false);
    expectOutward(mesh!);
  });

  it('unwraps faces so the default clay map can land', () => {
    const mesh = buildBlockoutExtrudeMesh(
      [v3(0, 0, 0), v3(2, 0, 0), v3(2, 2, 0), v3(0, 2, 0)],
      'front',
      1,
      true,
    )!;
    const layerId = mesh.defaultUvLayerId!;
    let minU = Infinity;
    let maxU = -Infinity;
    for (const corner of mesh.faceCorners.values()) {
      const uv = corner.uvs.get(layerId);
      if (!uv) continue;
      minU = Math.min(minU, uv.x);
      maxU = Math.max(maxU, uv.x);
    }
    expect(maxU - minU).toBeGreaterThan(0.1);
  });

  it('moves the local origin to the bounds centre', () => {
    const mesh = buildBlockoutExtrudeMesh(
      [v3(0, 0, 0), v3(2, 0, 0), v3(2, 2, 0), v3(0, 2, 0)],
      'front',
      1,
      true,
    )!;
    const origin = localizeMeshToBoundsCentre(mesh);
    expect(origin.x).toBeCloseTo(1);
    expect(origin.y).toBeCloseTo(1);
    expect(origin.z).toBeCloseTo(0);
    const xs = [...mesh.vertices.values()].map((v) => v.position.x);
    expect(Math.min(...xs)).toBeCloseTo(-1);
    expect(Math.max(...xs)).toBeCloseTo(1);
  });

  it('flips Top silhouettes so they are not inside-out', () => {
    const mesh = buildBlockoutExtrudeMesh(
      [v3(0, 0, 0), v3(2, 0, 0), v3(2, 0, 2), v3(0, 0, 2)],
      'top',
      1,
      true,
    );
    expect(mesh).toBeTruthy();
    expectOutward(mesh!);
  });
});

describe('buildLowPolyEllipseContour', () => {
  it('makes an 8-sided ellipse that fills the bounding box', () => {
    const points = buildLowPolyEllipseContour(v3(0, 0, 0), v3(2, 2, 0), 'front', 8);
    expect(points).toHaveLength(8);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(2);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(2);
    expect(points.every((p) => Math.abs(p.z) < 1e-9)).toBe(true);
  });

  it('stays on the Side plane', () => {
    const points = buildLowPolyEllipseContour(v3(3, 0, 0), v3(3, 2, 4), 'side', 6);
    expect(points).toHaveLength(6);
    expect(points.every((p) => Math.abs(p.x - 3) < 1e-9)).toBe(true);
  });

  it('rejects a degenerate box', () => {
    expect(buildLowPolyEllipseContour(v3(), v3(0.01, 0, 0), 'front')).toEqual([]);
  });
});

function expectOutward(mesh: NonNullable<ReturnType<typeof buildBlockoutExtrudeMesh>>): void {
  const verts = [...mesh.vertices.values()];
  const origin = verts.reduce(
    (sum, vert) => ({
      x: sum.x + vert.position.x / verts.length,
      y: sum.y + vert.position.y / verts.length,
      z: sum.z + vert.position.z / verts.length,
    }),
    { x: 0, y: 0, z: 0 },
  );
  for (const face of mesh.faces.values()) {
    const ids = faceVertexIds(mesh, face.id);
    const centre = ids.reduce(
      (sum, id) => {
        const point = mesh.vertices.get(id)!.position;
        return {
          x: sum.x + point.x / ids.length,
          y: sum.y + point.y / ids.length,
          z: sum.z + point.z / ids.length,
        };
      },
      { x: 0, y: 0, z: 0 },
    );
    const normal = computeFaceNormal(mesh, face.id);
    expect(
      normal.x * (centre.x - origin.x) +
        normal.y * (centre.y - origin.y) +
        normal.z * (centre.z - origin.z),
      `face ${face.id} should face away from the solid centre`,
    ).toBeGreaterThan(0);
  }
}
