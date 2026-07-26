import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox, buildPlane } from '@/core/mesh/builders';
import { getMeshStats } from '@/core/mesh/EditableMesh';
import { pokeFaces, subdivideFaces } from '@/core/mesh/ops/subdivide';
import { validateMeshFull } from '@/core/mesh/Validation';

beforeEach(() => resetIdCounter(1));

describe('subdivideFaces', () => {
  it('rejects an empty selection', () => {
    const mesh = buildPlane({ width: 1, depth: 1 });
    const result = subdivideFaces(mesh, []);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EMPTY_SELECTION');
  });

  it('splits a box face into four quads', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const beforeFaces = mesh.faces.size;
    const beforeVerts = mesh.vertices.size;
    const result = subdivideFaces(mesh, [faceId], 1);
    expect(result.ok).toBe(true);
    // One quad → 4 quads; shared edges insert midpoints into neighbor faces.
    expect(mesh.faces.size).toBe(beforeFaces - 1 + 4);
    expect(mesh.vertices.size).toBeGreaterThan(beforeVerts);
    expect(validateMeshFull(mesh).ok).toBe(true);
    expect([...mesh.faceCorners.values()].every((corner) => corner.uvs.size > 0)).toBe(true);
  });

  it('subdivides the whole mesh when all faces are selected', () => {
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    const faces = [...mesh.faces.keys()];
    const result = subdivideFaces(mesh, faces, 1);
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(24); // 6 faces × 4
    expect(validateMeshFull(mesh).ok).toBe(true);
    expect(getMeshStats(mesh).boundaryEdges).toBe(0);
  });

  it('supports multiple cut levels', () => {
    const mesh = buildPlane({ width: 2, depth: 2 });
    const faceId = [...mesh.faces.keys()][0]!;
    const result = subdivideFaces(mesh, [faceId], 2);
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(16); // 4 then 4×4
    expect(validateMeshFull(mesh).ok).toBe(true);
  });
});

describe('pokeFaces', () => {
  it('fans a quad into four triangles', () => {
    const mesh = buildPlane({ width: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const result = pokeFaces(mesh, [faceId]);
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(4);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });
});
