import { describe, expect, it } from 'vitest';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import {
  addVertex,
  createEmptyMesh,
  faceVertexIds,
  getEdgeVertices,
  removeFace,
} from '@/core/mesh/EditableMesh';
import {
  deleteFaces,
  deleteVertices,
  fillBoundaryLoop,
  makeFaceFromVertices,
} from '@/core/mesh/ops/draw';
import { v3 } from '@/core/math/Vec3';

describe('draw ops', () => {
  it('makes a face from three vertices', () => {
    const mesh = createEmptyMesh('t');
    const a = addVertex(mesh, v3(0, 0, 0));
    const b = addVertex(mesh, v3(1, 0, 0));
    const c = addVertex(mesh, v3(0, 0, 1));
    const result = makeFaceFromVertices(mesh, [a, b, c]);
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(1);
    expect(faceVertexIds(mesh, result.value!.faceId)).toEqual([a, b, c]);
  });

  it('makes a double face (front + back) from three vertices', () => {
    const mesh = createEmptyMesh('t');
    const a = addVertex(mesh, v3(0, 0, 0));
    const b = addVertex(mesh, v3(1, 0, 0));
    const c = addVertex(mesh, v3(0, 0, 1));
    const result = makeFaceFromVertices(mesh, [a, b, c], { mode: 'double' });
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(2);
    expect(result.value!.faceIds).toHaveLength(2);
    expect(faceVertexIds(mesh, result.value!.faceIds[0]!)).toEqual([a, b, c]);
    expect(faceVertexIds(mesh, result.value!.faceIds[1]!)).toEqual([c, b, a]);
  });

  it('rejects faces with fewer than 3 vertices', () => {
    const mesh = createEmptyMesh('t');
    const a = addVertex(mesh, v3(0, 0, 0));
    const b = addVertex(mesh, v3(1, 0, 0));
    const result = makeFaceFromVertices(mesh, [a, b]);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INSUFFICIENT_VERTICES');
    expect(mesh.faces.size).toBe(0);
  });

  it('fills a simple boundary quad hole', () => {
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    const faceId = [...mesh.faces.keys()][0]!;
    const loop = faceVertexIds(mesh, faceId);
    expect(loop.length).toBe(4);

    const edgeIds = [...mesh.edges.keys()].filter((edgeId) => {
      const pair = getEdgeVertices(mesh, edgeId);
      if (!pair) return false;
      const [a, b] = pair;
      for (let i = 0; i < loop.length; i++) {
        const va = loop[i]!;
        const vb = loop[(i + 1) % loop.length]!;
        if ((va === a && vb === b) || (va === b && vb === a)) return true;
      }
      return false;
    });
    expect(edgeIds.length).toBe(4);

    removeFace(mesh, faceId);
    expect(mesh.faces.size).toBe(5);

    const filled = fillBoundaryLoop(mesh, edgeIds);
    expect(filled.ok).toBe(true);
    expect(mesh.faces.size).toBe(6);
  });

  it('deletes selected faces and orphan vertices', () => {
    const mesh = createEmptyMesh('t');
    const a = addVertex(mesh, v3(0, 0, 0));
    const b = addVertex(mesh, v3(1, 0, 0));
    const c = addVertex(mesh, v3(0, 0, 1));
    const face = makeFaceFromVertices(mesh, [a, b, c]);
    expect(face.ok).toBe(true);
    const del = deleteFaces(mesh, [face.value!.faceId]);
    expect(del.ok).toBe(true);
    expect(mesh.faces.size).toBe(0);
    expect(mesh.vertices.size).toBe(0);
  });

  it('deletes isolated vertices', () => {
    const mesh = createEmptyMesh('t');
    const a = addVertex(mesh, v3(0, 0, 0));
    const b = addVertex(mesh, v3(1, 0, 0));
    const del = deleteVertices(mesh, [a]);
    expect(del.ok).toBe(true);
    expect(mesh.vertices.has(a)).toBe(false);
    expect(mesh.vertices.has(b)).toBe(true);
  });
});
