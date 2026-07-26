import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox } from '@/core/mesh/builders';
import { faceHalfEdgeIds, faceVertexIds, getMeshStats } from '@/core/mesh/EditableMesh';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { dissolveEdges, dissolveFaces } from '@/core/mesh/ops/basic';
import { validateMeshFull } from '@/core/mesh/Validation';
import { v3 } from '@/core/math/Vec3';

beforeEach(() => resetIdCounter(1));

describe('dissolveEdges', () => {
  it('rejects an empty selection', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const result = dissolveEdges(mesh, []);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EMPTY_SELECTION');
  });

  it('merges two box faces across a shared edge into one ngon', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const edgeId = mesh.halfEdges.get(faceHalfEdgeIds(mesh, faceId)[0]!)!.edgeId;
    const beforeFaces = mesh.faces.size;
    const result = dissolveEdges(mesh, [edgeId]);
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(beforeFaces - 1);
    const ngon = result.change.recommendedSelection.faceIds?.[0];
    expect(ngon).toBeTruthy();
    expect(faceVertexIds(mesh, ngon!).length).toBe(6);
    expect(validateMeshFull(mesh).ok).toBe(true);
    expect(getMeshStats(mesh).boundaryEdges).toBe(0);
  });
});

describe('dissolveFaces', () => {
  it('dissolves two adjacent quads into one outer boundary face', () => {
    const builder = new MeshBuilder('Strip', true);
    const b0 = builder.vertex(v3(0, 0, 0));
    const b1 = builder.vertex(v3(1, 0, 0));
    const b2 = builder.vertex(v3(2, 0, 0));
    const t0 = builder.vertex(v3(0, 1, 0));
    const t1 = builder.vertex(v3(1, 1, 0));
    const t2 = builder.vertex(v3(2, 1, 0));
    builder.quad(b0, b1, t1, t0);
    builder.quad(b1, b2, t2, t1);
    const mesh = builder.build();
    const faceIds = [...mesh.faces.keys()];
    const result = dissolveFaces(mesh, faceIds);
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(1);
    expect(faceVertexIds(mesh, result.change.recommendedSelection.faceIds![0]!).length).toBe(6);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });
});
