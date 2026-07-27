import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import { faceVertexIds } from '@/core/mesh/EditableMesh';
import { validateMeshFull } from '@/core/mesh/Validation';
import { buildCurveCapsule, buildStyledCurveCapsule } from '@/core/mesh/builders/CurveSweepBuilder';

const path = [v3(0, 0, 0), v3(2, 0.1, 0), v3(4, 0, 0)];

describe('buildCurveCapsule (classic)', () => {
  it('builds true hemispherical ends regardless of cap style options', () => {
    const mesh = buildCurveCapsule({
      points: path,
      radius: 0.2,
      radialSegments: 10,
      profile: 'round',
      startCapStyle: 'open',
      endCapStyle: 'flat',
    });
    const xs = [...mesh.vertices.values()].map((vertex) => vertex.position.x);
    expect(Math.min(...xs)).toBeLessThan(-0.15);
    expect(Math.max(...xs)).toBeGreaterThan(4.15);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});

describe('buildStyledCurveCapsule caps', () => {
  it('builds open ends without cap faces', () => {
    const mesh = buildStyledCurveCapsule({
      points: path,
      radius: 0.2,
      radialSegments: 10,
      profile: 'round',
      startCapStyle: 'open',
      endCapStyle: 'open',
    });
    const ngonFaces = [...mesh.faces.values()].filter(
      (face) => faceVertexIds(mesh, face.id).length > 4,
    );
    expect(ngonFaces.length).toBe(0);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('builds flat end caps as ngons', () => {
    const mesh = buildStyledCurveCapsule({
      points: path,
      radius: 0.2,
      radialSegments: 10,
      profile: 'round',
      startCapStyle: 'flat',
      endCapStyle: 'flat',
    });
    const ngonFaces = [...mesh.faces.values()].filter(
      (face) => faceVertexIds(mesh, face.id).length > 4,
    );
    expect(ngonFaces.length).toBe(2);
  });

  it('builds round hemispherical ends without flat ngons', () => {
    const mesh = buildStyledCurveCapsule({
      points: path,
      radius: 0.2,
      radialSegments: 10,
      profile: 'round',
      startCapStyle: 'round',
      endCapStyle: 'round',
    });
    const ngonFaces = [...mesh.faces.values()].filter(
      (face) => faceVertexIds(mesh, face.id).length > 4,
    );
    expect(ngonFaces.length).toBe(0);
    expect(mesh.vertices.size).toBeGreaterThan(30);
  });

  it('round caps add hemisphere rings beyond open ends', () => {
    const open = buildStyledCurveCapsule({
      points: path,
      radius: 0.2,
      radialSegments: 10,
      profile: 'round',
      startCapStyle: 'open',
      endCapStyle: 'open',
    });
    const round = buildStyledCurveCapsule({
      points: path,
      radius: 0.2,
      radialSegments: 10,
      profile: 'round',
      startCapStyle: 'round',
      endCapStyle: 'round',
    });
    expect(round.vertices.size).toBeGreaterThan(open.vertices.size);
  });
});
