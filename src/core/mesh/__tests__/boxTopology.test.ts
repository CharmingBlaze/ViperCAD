import { describe, expect, it, beforeEach } from 'vitest';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox, buildPlane } from '@/core/mesh/builders';
import { faceVertexIds, getMeshStats, isBoundaryEdge } from '@/core/mesh/EditableMesh';
import { computeFaceNormal } from '@/core/mesh/Normals';
import { triangulateMesh } from '@/core/mesh/Triangulation';
import { validateMeshFull } from '@/core/mesh/Validation';
import { editableMeshToRenderData, pickLogicalFace } from '@/renderer/MeshRenderAdapter';
import { dotVec3, v3 } from '@/core/math/Vec3';

beforeEach(() => {
  resetIdCounter(1);
});

describe('Box topology', () => {
  it('has 8 vertices, 12 edges, 6 quad faces', () => {
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    const stats = getMeshStats(mesh);
    expect(stats.verts).toBe(8);
    expect(stats.edges).toBe(12);
    expect(stats.faces).toBe(6);
    expect(stats.quads).toBe(6);
    expect(stats.tris).toBe(0);
    expect(stats.boundaryEdges).toBe(0);
    expect(stats.halfEdges).toBe(24);
  });

  it('has valid half-edge twins on every closed edge', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    for (const edge of mesh.edges.values()) {
      expect(edge.halfEdgeBId).not.toBeNull();
      const a = mesh.halfEdges.get(edge.halfEdgeAId)!;
      const b = mesh.halfEdges.get(edge.halfEdgeBId!)!;
      expect(a.twinHalfEdgeId).toBe(b.id);
      expect(b.twinHalfEdgeId).toBe(a.id);
      expect(a.edgeId).toBe(edge.id);
      expect(b.edgeId).toBe(edge.id);
    }
  });

  it('has outward face normals', () => {
    const mesh = buildBox({ width: 2, height: 2, depth: 2, centered: true });
    for (const face of mesh.faces.values()) {
      const n = computeFaceNormal(mesh, face.id);
      const verts = faceVertexIds(mesh, face.id);
      const centre = verts.reduce(
        (acc, id) => {
          const p = mesh.vertices.get(id)!.position;
          return v3(acc.x + p.x / verts.length, acc.y + p.y / verts.length, acc.z + p.z / verts.length);
        },
        v3(0, 0, 0),
      );
      // Normal should point away from origin for a centred box.
      expect(dotVec3(n, centre)).toBeGreaterThan(0);
    }
  });

  it('passes full validation', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const report = validateMeshFull(mesh);
    expect(report.ok).toBe(true);
    expect(report.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('keeps logical quads while render triangulates to 12 triangles', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const tris = triangulateMesh(mesh);
    expect(tris.size).toBe(6);
    let total = 0;
    for (const t of tris.values()) {
      expect(t.triangles.length).toBe(2);
      total += t.triangles.length;
    }
    expect(total).toBe(12);

    const render = editableMeshToRenderData(mesh);
    expect(render.triangleMap.length).toBe(12);
    // Every triangle maps to one of the 6 logical faces.
    const faceIds = new Set(render.triangleMap.map((t) => t.faceId));
    expect(faceIds.size).toBe(6);
    expect(pickLogicalFace(render.triangleMap, 0)).not.toBeNull();
    expect(pickLogicalFace(render.triangleMap, 11)).not.toBeNull();
  });
});

describe('Plane boundary topology', () => {
  it('has 4 boundary edges', () => {
    const mesh = buildPlane({ width: 2, depth: 2 });
    const stats = getMeshStats(mesh);
    expect(stats.verts).toBe(4);
    expect(stats.faces).toBe(1);
    expect(stats.quads).toBe(1);
    expect(stats.boundaryEdges).toBe(4);
    for (const edge of mesh.edges.values()) {
      expect(isBoundaryEdge(mesh, edge.id)).toBe(true);
    }
    expect(validateMeshFull(mesh).ok).toBe(true);
  });
});
