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

  it('creates more chamfer faces when segments > 1', () => {
    const mesh1 = buildBox({ width: 2, height: 2, depth: 2 });
    const mesh2 = buildBox({ width: 2, height: 2, depth: 2 });
    const edge1 = faceHalfEdgeIds(mesh1, [...mesh1.faces.keys()][0]!)
      .map((heId) => mesh1.halfEdges.get(heId)!.edgeId)[0]!;
    const edge2 = faceHalfEdgeIds(mesh2, [...mesh2.faces.keys()][0]!)
      .map((heId) => mesh2.halfEdges.get(heId)!.edgeId)[0]!;
    const one = bevelEdges(mesh1, [edge1], { width: 0.2, segments: 1 });
    const two = bevelEdges(mesh2, [edge2], { width: 0.2, segments: 2 });
    expect(one.ok).toBe(true);
    expect(two.ok).toBe(true);
    expect(mesh2.faces.size).toBeGreaterThan(mesh1.faces.size);
    expect(two.change.recommendedSelection.faceIds?.length).toBe(2);
    expect(validateMeshFull(mesh2).ok).toBe(true);
    expect(getMeshStats(mesh2).boundaryEdges).toBe(0);
  });
});
