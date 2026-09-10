import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import { addFace, addVertex, createEmptyMesh } from '@/core/mesh/EditableMesh';
import { solidifyBlockoutPolyFace } from '@/core/mesh/ops/blockoutPolySolidify';
import { validateMeshFull } from '@/core/mesh/Validation';

describe('solidifyBlockoutPolyFace', () => {
  it('extrudes, rounds, and subdivides a drawn quad', () => {
    const mesh = createEmptyMesh('Poly');
    const a = addVertex(mesh, v3(0, 0, 0));
    const b = addVertex(mesh, v3(1, 0, 0));
    const c = addVertex(mesh, v3(1, 1, 0));
    const d = addVertex(mesh, v3(0, 1, 0));
    const face = addFace(mesh, [a, b, c, d]);

    const beforeFaces = mesh.faces.size;
    const result = solidifyBlockoutPolyFace(mesh, [face.faceId], {
      thickness: 0.25,
      roundness: 0.3,
      subdivideCuts: 1,
    });

    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBeGreaterThan(beforeFaces);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('keeps a flat face when thickness is zero but can still subdivide', () => {
    const mesh = createEmptyMesh('Flat');
    const a = addVertex(mesh, v3(0, 0, 0));
    const b = addVertex(mesh, v3(1, 0, 0));
    const c = addVertex(mesh, v3(0.5, 1, 0));
    const face = addFace(mesh, [a, b, c]);

    const result = solidifyBlockoutPolyFace(mesh, [face.faceId], {
      thickness: 0,
      roundness: 0,
      subdivideCuts: 1,
    });

    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBeGreaterThan(1);
  });
});
