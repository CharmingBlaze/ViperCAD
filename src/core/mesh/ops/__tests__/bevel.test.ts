import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox } from '@/core/mesh/builders';
import { faceHalfEdgeIds, getMeshStats } from '@/core/mesh/EditableMesh';
import { bevelEdges, bevelWidthLimit } from '@/core/mesh/ops/bevel';
import { validateMeshFull } from '@/core/mesh/Validation';

beforeEach(() => resetIdCounter(1));

describe('bevelEdges', () => {
  it('chamfers a box edge and stays manifold', () => {
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    const faceId = [...mesh.faces.keys()][0]!;
    const edgeId = faceHalfEdgeIds(mesh, faceId).map((heId) => mesh.halfEdges.get(heId)!.edgeId)[0]!;
    const beforeFaces = mesh.faces.size;
    const beforeVerts = mesh.vertices.size;

    const result = bevelEdges(mesh, [edgeId], { width: 0.2 });
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBeGreaterThan(beforeFaces);
    expect(mesh.vertices.size).toBeGreaterThan(beforeVerts);
    expect(validateMeshFull(mesh).ok).toBe(true);
    expect(getMeshStats(mesh).boundaryEdges).toBe(0);
  });

  it('rejects empty selection', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const result = bevelEdges(mesh, [], { width: 0.1 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EMPTY_SELECTION');
  });

  it('limits oversized widths before they overlap adjacent edges', () => {
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    const faceId = [...mesh.faces.keys()][0]!;
    const edgeId = faceHalfEdgeIds(mesh, faceId).map((heId) => mesh.halfEdges.get(heId)!.edgeId)[0]!;
    expect(bevelWidthLimit(mesh, [edgeId])).toBeCloseTo(0.98);
    const result = bevelEdges(mesh, [edgeId], { width: 10 });
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toMatch(/limited/);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });
});
