import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox, buildPlane } from '@/core/mesh/builders';
import {
  buildEdgeLookup,
  edgeKey,
  faceHalfEdgeIds,
  getEdgeVertices,
  getMeshStats,
  isBoundaryEdge,
} from '@/core/mesh/EditableMesh';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { bridgeEdgeLoops, weldVerticesByDistance } from '@/core/mesh/ops/basic';
import {
  closestBoundaryEdgeToPoint,
  findLoopCutRing,
  knifeFace,
  knifePath,
  loopCut,
  loopCutMulti,
} from '@/core/mesh/ops/cut';
import { insetFaces } from '@/core/mesh/ops/inset';
import { validateMeshFull } from '@/core/mesh/Validation';
import { v3 } from '@/core/math/Vec3';

beforeEach(() => resetIdCounter(1));

function buildOpenTube(): ReturnType<typeof buildPlane> {
  // Two open quads facing outward — boundary loops of 4 edges each.
  const b = new MeshBuilder('Tube', true);
  const a0 = b.vertex(v3(-1, 0, -0.5));
  const a1 = b.vertex(v3(1, 0, -0.5));
  const a2 = b.vertex(v3(1, 1, -0.5));
  const a3 = b.vertex(v3(-1, 1, -0.5));
  const b0 = b.vertex(v3(-1, 0, 0.5));
  const b1 = b.vertex(v3(1, 0, 0.5));
  const b2 = b.vertex(v3(1, 1, 0.5));
  const b3 = b.vertex(v3(-1, 1, 0.5));
  b.quad(a0, a1, a2, a3); // -Z outward
  b.quad(b0, b1, b2, b3); // +Z outward
  return b.build();
}

function buildQuadStrip() {
  const builder = new MeshBuilder('Quad strip', true);
  const bottom = [0, 1, 2, 3].map((x) => builder.vertex(v3(x, 0, 0)));
  const top = [0, 1, 2, 3].map((x) => builder.vertex(v3(x, 1, 0)));
  for (let index = 0; index < 3; index++) {
    builder.quad(bottom[index]!, bottom[index + 1]!, top[index + 1]!, top[index]!);
  }
  return { mesh: builder.build(), bottom, top };
}

describe('insetFaces', () => {
  it('rejects an empty selection', () => {
    const mesh = buildPlane({ width: 1, depth: 1 });
    const result = insetFaces(mesh, [], { thickness: 0.2 });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('EMPTY_SELECTION');
  });

  it('insets a box face into an inner face plus a ring', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const before = mesh.faces.size;
    const result = insetFaces(mesh, [faceId], { thickness: 0.25 });
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(before + 4); // -1 + inner + 4 ring = +4
    expect(validateMeshFull(mesh).ok).toBe(true);
    expect(getMeshStats(mesh).boundaryEdges).toBe(0);
  });

  it('region-insets adjacent faces without duplicating the shared edge seam', () => {
    const regionMesh = buildQuadStrip().mesh;
    const regionFaceIds = [...regionMesh.faces.keys()].slice(0, 2);
    const beforeFaces = regionMesh.faces.size;
    const result = insetFaces(regionMesh, regionFaceIds, { thickness: 0.25, individual: false });
    expect(result.ok).toBe(true);
    expect(validateMeshFull(regionMesh).ok).toBe(true);
    // Before 3 faces; replace 2 → 2 inner + 6 outer-boundary rim quads = 9
    expect(regionMesh.faces.size).toBe(beforeFaces - 2 + 2 + 6);
    expect(result.change.recommendedSelection.faceIds?.length).toBe(2);

    const individualMesh = buildQuadStrip().mesh;
    const individualIds = [...individualMesh.faces.keys()].slice(0, 2);
    expect(insetFaces(individualMesh, individualIds, { thickness: 0.25, individual: true }).ok).toBe(true);
    // Per-face path duplicates verts on the shared edge; region path does not.
    expect(regionMesh.vertices.size).toBeLessThan(individualMesh.vertices.size);
  });
});

describe('knifeFace / loopCut', () => {
  it('knifes a box face between opposite edges and stays manifold', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const edgeIds = faceHalfEdgeIds(mesh, faceId).map((heId) => mesh.halfEdges.get(heId)!.edgeId);
    const beforeFaces = mesh.faces.size;
    const result = knifeFace(mesh, faceId, edgeIds[0]!, edgeIds[2]!, 0.5, 0.5);
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(beforeFaces + 1);
    expect(validateMeshFull(mesh).ok).toBe(true);
    expect(getMeshStats(mesh).boundaryEdges).toBe(0);
  });

  it('knifes with non-midpoint factors', () => {
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    const faceId = [...mesh.faces.keys()][0]!;
    const edgeIds = faceHalfEdgeIds(mesh, faceId).map((heId) => mesh.halfEdges.get(heId)!.edgeId);
    const beforeFaces = mesh.faces.size;
    const result = knifeFace(mesh, faceId, edgeIds[0]!, edgeIds[2]!, 0.25, 0.75);
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(beforeFaces + 1);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });

  it('knifes a path across two adjacent coplanar quads, splitting the shared edge once', () => {
    const { mesh, bottom, top } = buildQuadStrip();
    const faceIds = [...mesh.faces.keys()];
    const face0 = faceIds[0]!;
    const face1 = faceIds[1]!;
    // Outer left edge of face0: bottom[0]-top[0]
    const leftEdge = buildEdgeLookup(mesh).get(edgeKey(bottom[0]!, top[0]!))!;
    // Shared edge face0/face1: bottom[1]-top[1]
    const sharedEdge = buildEdgeLookup(mesh).get(edgeKey(bottom[1]!, top[1]!))!;
    // Outer right edge of face1: bottom[2]-top[2]
    const rightEdge = buildEdgeLookup(mesh).get(edgeKey(bottom[2]!, top[2]!))!;
    const beforeFaces = mesh.faces.size;
    const beforeVerts = mesh.vertices.size;
    const result = knifePath(mesh, [
      { faceId: face0, edgeId: leftEdge, factor: 0.5 },
      { faceId: face0, edgeId: sharedEdge, factor: 0.5 },
      { faceId: face1, edgeId: rightEdge, factor: 0.5 },
    ]);
    expect(result.ok).toBe(true);
    // Two face splits → +2 faces; three edge splits → +3 verts
    expect(mesh.faces.size).toBe(beforeFaces + 2);
    expect(mesh.vertices.size).toBe(beforeVerts + 3);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });

  it('picks the closest boundary edge for a face point', () => {
    const mesh = buildPlane({ width: 2, depth: 2 });
    const faceId = [...mesh.faces.keys()][0]!;
    const edgeIds = faceHalfEdgeIds(mesh, faceId).map((heId) => mesh.halfEdges.get(heId)!.edgeId);
    const ends = getEdgeVertices(mesh, edgeIds[0]!)!;
    const a = mesh.vertices.get(ends[0])!.position;
    const b = mesh.vertices.get(ends[1])!.position;
    const near = v3((a.x + b.x) * 0.5, (a.y + b.y) * 0.5 + 0.01, (a.z + b.z) * 0.5);
    const hit = closestBoundaryEdgeToPoint(mesh, faceId, near);
    expect(hit?.edgeId).toBe(edgeIds[0]);
    expect(hit?.factor).toBeCloseTo(0.5, 2);
  });

  it('loop-cuts through a box quad ring', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const edgeId = faceHalfEdgeIds(mesh, faceId).map((heId) => mesh.halfEdges.get(heId)!.edgeId)[0]!;
    const beforeFaces = mesh.faces.size;
    const result = loopCut(mesh, edgeId, 0.5);
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBeGreaterThan(beforeFaces);
    expect(validateMeshFull(mesh).ok).toBe(true);
    expect(getMeshStats(mesh).boundaryEdges).toBe(0);
  });

  it('discovers the closed box ring and inserts multiple parallel cuts', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const edgeId = faceHalfEdgeIds(mesh, faceId).map(
      (heId) => mesh.halfEdges.get(heId)!.edgeId,
    )[0]!;
    const ring = findLoopCutRing(mesh, edgeId);
    expect(ring?.closed).toBe(true);
    expect(ring?.faceIds).toHaveLength(4);

    const beforeFaces = mesh.faces.size;
    const result = loopCutMulti(mesh, edgeId, [0.25, 0.5, 0.75]);
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(beforeFaces + 12);
    expect(result.change.recommendedSelection.edgeIds).toHaveLength(12);
    expect(validateMeshFull(mesh).ok).toBe(true);
    expect(getMeshStats(mesh).boundaryEdges).toBe(0);
  });

  it('discovers both directions of an open quad strip from an interior edge', () => {
    const { mesh, bottom, top } = buildQuadStrip();
    const startEdge = buildEdgeLookup(mesh).get(edgeKey(bottom[1]!, top[1]!))!;
    const ring = findLoopCutRing(mesh, startEdge);
    expect(ring?.closed).toBe(false);
    expect(ring?.faceIds).toHaveLength(3);
    expect(ring?.edgeIds).toHaveLength(4);

    const result = loopCutMulti(mesh, startEdge, [0.33, 0.66]);
    expect(result.ok).toBe(true);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });
});

describe('bridgeEdgeLoops', () => {
  it('bridges two open boundary loops into a tube of quads', () => {
    const mesh = buildOpenTube();
    const boundary = [...mesh.edges.keys()].filter((id) => isBoundaryEdge(mesh, id));
    expect(boundary.length).toBe(8);
    const beforeFaces = mesh.faces.size;
    const result = bridgeEdgeLoops(mesh, boundary);
    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(beforeFaces + 4);
    expect(getMeshStats(mesh).boundaryEdges).toBe(0);
    expect(validateMeshFull(mesh).issues.every((issue) => issue.code !== 'BAD_HE_LINK_RECIPROCITY')).toBe(true);
  });

  it('rejects interior edges', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const edgeIds = [...mesh.edges.keys()].slice(0, 8);
    const result = bridgeEdgeLoops(mesh, edgeIds);
    expect(result.ok).toBe(false);
  });
});

describe('weldVerticesByDistance', () => {
  it('welds near-duplicate vertices and reduces vertex count', () => {
    const builder = new MeshBuilder('Seam', false);
    const p0 = builder.vertex(v3(0, 0, 0));
    const p1 = builder.vertex(v3(1, 0, 0));
    const p2 = builder.vertex(v3(1, 0, 1));
    const p3 = builder.vertex(v3(0, 0, 1));
    const q0 = builder.vertex(v3(0.0002, 0, 0));
    const q1 = builder.vertex(v3(1.0002, 0, 0));
    const q2 = builder.vertex(v3(1, 0, -1));
    const q3 = builder.vertex(v3(0, 0, -1));
    builder.quad(p0, p1, p2, p3);
    builder.quad(q0, q3, q2, q1);
    const seam = builder.build();
    const before = seam.vertices.size;
    const result = weldVerticesByDistance(seam, [...seam.vertices.keys()], 0.01);
    expect(result.ok).toBe(true);
    expect(seam.vertices.size).toBeLessThan(before);
  });
});
