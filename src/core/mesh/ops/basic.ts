import { lengthSqVec3, lerpVec3, subVec3, type Vec3 } from '@/core/math/Vec3';
import {
  addFace,
  addVertex,
  buildEdgeLookup,
  bumpTopology,
  faceCornerIds,
  faceHalfEdgeIds,
  faceVertexIds,
  getEdgeVertices,
  mergeTopologyChange,
  removeFace,
} from '@/core/mesh/EditableMesh';
import {
  emptyTopologyChangeResult,
  type EditableMesh,
  type EdgeId,
  type FaceId,
  type TopologyChangeResult,
  type VertexId,
} from '@/core/mesh/types';
import type { GeometryOpResult } from './types';
import { triangulateFace } from '@/core/mesh/Triangulation';

type FaceSnapshot = {
  id: FaceId;
  vertices: VertexId[];
  uvs: { x: number; y: number }[];
  materialSlot: number;
  smoothingGroup: number;
  flatShaded: boolean;
};

function snapshotFace(mesh: EditableMesh, faceId: FaceId): FaceSnapshot {
  const face = mesh.faces.get(faceId)!;
  return {
    id: faceId,
    vertices: faceVertexIds(mesh, faceId),
    uvs: faceCornerIds(mesh, faceId).map((id) => {
      const uv = mesh.defaultUvLayerId ? mesh.faceCorners.get(id)?.uvs.get(mesh.defaultUvLayerId) : null;
      return uv ? { ...uv } : { x: 0, y: 0 };
    }),
    materialSlot: face.materialSlot,
    smoothingGroup: face.smoothingGroup,
    flatShaded: face.flatShaded,
  };
}

function addSnapshotFace(
  mesh: EditableMesh,
  snap: FaceSnapshot,
  vertices: VertexId[],
  uvs: { x: number; y: number }[],
  change: TopologyChangeResult,
): FaceId {
  const added = addFace(mesh, vertices, {
    uvs,
    materialSlot: snap.materialSlot,
    flatShaded: snap.flatShaded,
    edgeLookup: buildEdgeLookup(mesh),
  });
  mesh.faces.get(added.faceId)!.smoothingGroup = snap.smoothingGroup;
  mergeTopologyChange(change, added.result);
  change.replacedIds.set(snap.id, added.faceId);
  return added.faceId;
}

export function splitEdge(
  mesh: EditableMesh,
  edgeId: EdgeId,
  factor = 0.5,
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const endpoints = getEdgeVertices(mesh, edgeId);
  if (!endpoints) return failure(change, 'MISSING_EDGE', `Edge ${edgeId} not found`, [edgeId]);
  const edge = mesh.edges.get(edgeId)!;
  const faceIds = [edge.halfEdgeAId, edge.halfEdgeBId]
    .filter((id): id is string => !!id)
    .map((id) => mesh.halfEdges.get(id)?.faceId)
    .filter((id): id is FaceId => !!id);
  const snaps = faceIds.map((id) => snapshotFace(mesh, id));
  const a = mesh.vertices.get(endpoints[0])!.position;
  const b = mesh.vertices.get(endpoints[1])!.position;
  const newVertexId = addVertex(mesh, lerpVec3(a, b, Math.max(0, Math.min(1, factor))));
  change.createdVertexIds.push(newVertexId);
  for (const id of faceIds) mergeTopologyChange(change, removeFace(mesh, id));

  for (const snap of snaps) {
    let insertAt = -1;
    for (let i = 0; i < snap.vertices.length; i++) {
      const va = snap.vertices[i]!;
      const vb = snap.vertices[(i + 1) % snap.vertices.length]!;
      if ((va === endpoints[0] && vb === endpoints[1]) || (va === endpoints[1] && vb === endpoints[0])) {
        insertAt = i + 1;
        break;
      }
    }
    if (insertAt < 0) continue;
    const nextUv = snap.uvs[insertAt % snap.uvs.length]!;
    const prevUv = snap.uvs[insertAt - 1]!;
    const uv = { x: prevUv.x + (nextUv.x - prevUv.x) * factor, y: prevUv.y + (nextUv.y - prevUv.y) * factor };
    const vertices = [...snap.vertices.slice(0, insertAt), newVertexId, ...snap.vertices.slice(insertAt)];
    const uvs = [...snap.uvs.slice(0, insertAt), uv, ...snap.uvs.slice(insertAt)];
    addSnapshotFace(mesh, snap, vertices, uvs, change);
  }
  change.recommendedSelection = { mode: 'vertex', vertexIds: [newVertexId] };
  return { ok: true, value: change, change, warnings: [] };
}

export function mergeVertices(
  mesh: EditableMesh,
  vertexIds: VertexId[],
  targetPosition?: Vec3,
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const unique = [...new Set(vertexIds)].filter((id) => mesh.vertices.has(id));
  if (unique.length < 2) return failure(change, 'INSUFFICIENT_VERTICES', 'Select at least two vertices', unique);
  const targetId = unique[0]!;
  const target = mesh.vertices.get(targetId)!;
  target.position = targetPosition ?? unique.reduce(
    (sum, id) => {
      const p = mesh.vertices.get(id)!.position;
      return { x: sum.x + p.x / unique.length, y: sum.y + p.y / unique.length, z: sum.z + p.z / unique.length };
    },
    { x: 0, y: 0, z: 0 },
  );
  const replace = new Set(unique.slice(1));
  const affected = [...mesh.faces.values()].filter((face) => faceVertexIds(mesh, face.id).some((id) => replace.has(id)));
  const snaps = affected.map((f) => snapshotFace(mesh, f.id));
  for (const face of affected) mergeTopologyChange(change, removeFace(mesh, face.id));
  for (const snap of snaps) {
    const verts: VertexId[] = [];
    const uvs: { x: number; y: number }[] = [];
    for (let i = 0; i < snap.vertices.length; i++) {
      const id = replace.has(snap.vertices[i]!) ? targetId : snap.vertices[i]!;
      if (verts[verts.length - 1] === id) continue;
      verts.push(id);
      uvs.push(snap.uvs[i]!);
    }
    if (verts.length > 1 && verts[0] === verts[verts.length - 1]) { verts.pop(); uvs.pop(); }
    if (new Set(verts).size >= 3) addSnapshotFace(mesh, snap, verts, uvs, change);
    else change.warnings.push(`Removed degenerate face ${snap.id}`);
  }
  for (const id of replace) {
    mesh.vertices.delete(id);
    change.removedVertexIds.push(id);
    change.replacedIds.set(id, targetId);
  }
  bumpTopology(mesh);
  change.recommendedSelection = { mode: 'vertex', vertexIds: [targetId] };
  return { ok: true, value: change, change, warnings: change.warnings };
}

export function collapseEdge(mesh: EditableMesh, edgeId: EdgeId, factor = 0.5) {
  const endpoints = getEdgeVertices(mesh, edgeId);
  if (!endpoints) return failure(emptyTopologyChangeResult(), 'MISSING_EDGE', `Edge ${edgeId} not found`, [edgeId]);
  const a = mesh.vertices.get(endpoints[0])!.position;
  const b = mesh.vertices.get(endpoints[1])!.position;
  return mergeVertices(mesh, endpoints, lerpVec3(a, b, factor));
}

export function flipFaces(mesh: EditableMesh, faceIds: FaceId[]): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const snaps = faceIds.filter((id) => mesh.faces.has(id)).map((id) => snapshotFace(mesh, id));
  for (const snap of snaps) mergeTopologyChange(change, removeFace(mesh, snap.id));
  const selected: FaceId[] = [];
  for (const snap of snaps) selected.push(addSnapshotFace(mesh, snap, [...snap.vertices].reverse(), [...snap.uvs].reverse(), change));
  change.recommendedSelection = { mode: 'face', faceIds: selected };
  return { ok: true, value: change, change, warnings: [] };
}

/** Convert selected logical polygons into engine-friendly logical triangles. */
export function triangulateFaces(mesh: EditableMesh, faceIds: FaceId[]): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const selected: FaceId[] = [];
  for (const faceId of [...new Set(faceIds)]) {
    if (!mesh.faces.has(faceId)) continue;
    const snap = snapshotFace(mesh, faceId);
    if (snap.vertices.length === 3) {
      selected.push(faceId);
      continue;
    }
    const triangles = triangulateFace(mesh, faceId).triangles;
    mergeTopologyChange(change, removeFace(mesh, faceId));
    for (const [a, b, c] of triangles) {
      selected.push(addSnapshotFace(
        mesh,
        snap,
        [snap.vertices[a]!, snap.vertices[b]!, snap.vertices[c]!],
        [snap.uvs[a]!, snap.uvs[b]!, snap.uvs[c]!],
        change,
      ));
    }
  }
  if (!selected.length) return failure(change, 'EMPTY_SELECTION', 'Select faces to triangulate', faceIds);
  change.recommendedSelection = { mode: 'face', faceIds: selected };
  return { ok: true, value: change, change, warnings: [] };
}

/** Bridge two selected boundary edge loops with a strip of quad faces. */
export function bridgeEdgeLoops(mesh: EditableMesh, edgeIds: EdgeId[]): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const unique = [...new Set(edgeIds)].filter((id) => mesh.edges.has(id));
  if (unique.length < 6) return failure(change, 'INSUFFICIENT_EDGES', 'Select two boundary loops', unique);
  if (unique.some((id) => mesh.edges.get(id)?.halfEdgeBId != null)) {
    return failure(change, 'NOT_BOUNDARY', 'Bridge requires open boundary edges', unique);
  }
  const loops = orderedEdgeLoops(mesh, unique);
  if (!loops || loops.length !== 2) {
    return failure(change, 'INVALID_LOOPS', 'Selection must contain exactly two closed boundary loops', unique);
  }
  if (loops[0]!.length !== loops[1]!.length) {
    return failure(change, 'LOOP_COUNT_MISMATCH', 'Boundary loops need the same vertex count', unique);
  }

  const a = loops[0]!;
  const reversedB = [...loops[1]!].reverse();
  let bestB = reversedB;
  let bestScore = Infinity;
  for (let shift = 0; shift < reversedB.length; shift++) {
    const candidate = reversedB.map((_, index) => reversedB[(index + shift) % reversedB.length]!);
    const score = a.reduce((sum, vertexId, index) => {
      const pa = mesh.vertices.get(vertexId)!.position;
      const pb = mesh.vertices.get(candidate[index]!)!.position;
      return sum + lengthSqVec3(subVec3(pa, pb));
    }, 0);
    if (score < bestScore) {
      bestScore = score;
      bestB = candidate;
    }
  }

  const edgeLookup = buildEdgeLookup(mesh);
  const faces: FaceId[] = [];
  for (let index = 0; index < a.length; index++) {
    const next = (index + 1) % a.length;
    const added = addFace(
      mesh,
      [a[next]!, a[index]!, bestB[index]!, bestB[next]!],
      { edgeLookup },
    );
    mergeTopologyChange(change, added.result);
    faces.push(added.faceId);
  }
  change.recommendedSelection = { mode: 'face', faceIds: faces };
  return { ok: true, value: change, change, warnings: [] };
}

/** Merge selected (or all) vertices that fall within a cleanup tolerance. */
export function weldVerticesByDistance(
  mesh: EditableMesh,
  vertexIds: VertexId[] = [...mesh.vertices.keys()],
  threshold = 0.001,
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return failure(change, 'INVALID_DISTANCE', 'Weld distance must be greater than zero', []);
  }
  const candidates = [...new Set(vertexIds)].filter((id) => mesh.vertices.has(id));
  const remaining = new Set(candidates);
  const targets: VertexId[] = [];
  const limitSq = threshold * threshold;
  for (const seedId of candidates) {
    if (!remaining.delete(seedId) || !mesh.vertices.has(seedId)) continue;
    const seed = mesh.vertices.get(seedId)!.position;
    const group = [seedId];
    for (const otherId of [...remaining]) {
      const other = mesh.vertices.get(otherId)?.position;
      if (other && lengthSqVec3(subVec3(seed, other)) <= limitSq) {
        remaining.delete(otherId);
        group.push(otherId);
      }
    }
    if (group.length < 2) continue;
    const result = mergeVertices(mesh, group);
    if (!result.ok) return result;
    mergeTopologyChange(change, result.change);
    targets.push(group[0]!);
  }
  change.recommendedSelection = { mode: 'vertex', vertexIds: targets };
  if (!targets.length) change.warnings.push('No vertices were close enough to weld');
  return { ok: true, value: change, change, warnings: change.warnings };
}

function orderedEdgeLoops(mesh: EditableMesh, edgeIds: EdgeId[]): VertexId[][] | null {
  const remaining = new Set(edgeIds);
  const loops: VertexId[][] = [];
  while (remaining.size) {
    const firstEdgeId = remaining.values().next().value as EdgeId;
    const firstEdge = mesh.edges.get(firstEdgeId)!;
    const firstHalfEdge = mesh.halfEdges.get(firstEdge.halfEdgeAId)!;
    const start = firstHalfEdge.originVertexId;
    const destination = mesh.halfEdges.get(firstHalfEdge.nextHalfEdgeId)?.originVertexId;
    if (!destination) return null;
    const loop = [start];
    remaining.delete(firstEdgeId);
    let previous = start;
    let current = destination;
    let guard = 0;
    while (current !== start && guard++ <= edgeIds.length) {
      loop.push(current);
      const nextEdgeId = [...remaining].find((id) => {
        const pair = getEdgeVertices(mesh, id);
        return !!pair && pair.includes(current) && !pair.includes(previous);
      }) ?? [...remaining].find((id) => getEdgeVertices(mesh, id)?.includes(current));
      if (!nextEdgeId) return null;
      const pair = getEdgeVertices(mesh, nextEdgeId)!;
      remaining.delete(nextEdgeId);
      previous = current;
      current = pair[0] === current ? pair[1] : pair[0];
    }
    if (current !== start || loop.length < 3) return null;
    loops.push(loop);
  }
  return loops;
}

/** Split one logical polygon by connecting two non-adjacent vertices on its loop. */
export function splitFace(mesh: EditableMesh, faceId: FaceId, vertexA: VertexId, vertexB: VertexId): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  if (!mesh.faces.has(faceId)) return failure(change, 'MISSING_FACE', `Face ${faceId} not found`, [faceId]);
  const snap = snapshotFace(mesh, faceId); const ia = snap.vertices.indexOf(vertexA); const ib = snap.vertices.indexOf(vertexB);
  if (ia < 0 || ib < 0 || ia === ib) return failure(change, 'VERTEX_NOT_ON_FACE', 'Cut vertices must belong to the face', [faceId, vertexA, vertexB]);
  const n = snap.vertices.length; const distance = Math.abs(ia - ib);
  if (distance === 1 || distance === n - 1) return failure(change, 'ADJACENT_CUT', 'Cut vertices are already connected', [vertexA, vertexB]);
  const walk = (start: number, end: number) => { const indices: number[] = []; for (let i = start;; i = (i + 1) % n) { indices.push(i); if (i === end) break; } return indices; };
  const p1 = walk(ia, ib); const p2 = walk(ib, ia);
  mergeTopologyChange(change, removeFace(mesh, faceId));
  const f1 = addSnapshotFace(mesh, snap, p1.map((i) => snap.vertices[i]!), p1.map((i) => snap.uvs[i]!), change);
  const f2 = addSnapshotFace(mesh, snap, p2.map((i) => snap.vertices[i]!), p2.map((i) => snap.uvs[i]!), change);
  change.replacedIds.set(faceId, f1); change.recommendedSelection = { mode: 'face', faceIds: [f1, f2] };
  return { ok: true, value: change, change, warnings: [] };
}

export function assignFaceMaterial(mesh: EditableMesh, faceIds: FaceId[], materialSlot: number): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  if (materialSlot < 0 || materialSlot >= mesh.materialSlotCount) return failure(change, 'INVALID_MATERIAL_SLOT', `Material slot ${materialSlot} is invalid`, faceIds);
  for (const id of faceIds) {
    const face = mesh.faces.get(id);
    if (face) face.materialSlot = materialSlot;
  }
  mesh.geometryVersion += 1;
  mesh.dirty.materials = true;
  return { ok: true, value: change, change, warnings: [] };
}

/**
 * Dissolve manifold edges: merge the two incident faces into one ngon.
 * Does not open holes — non-manifold / boundary edges are rejected.
 */
export function dissolveEdges(
  mesh: EditableMesh,
  edgeIds: EdgeId[],
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const unique = [...new Set(edgeIds)].filter((id) => mesh.edges.has(id));
  if (!unique.length) {
    return failure(change, 'EMPTY_SELECTION', 'No edges to dissolve', []);
  }

  const selectedFaces: FaceId[] = [];
  // Process one edge at a time so sequential dissolves stay valid.
  for (const edgeId of unique) {
    if (!mesh.edges.has(edgeId)) {
      return failure(change, 'MISSING_EDGE', `Edge ${edgeId} was removed by a prior dissolve`, [edgeId]);
    }
    const edge = mesh.edges.get(edgeId)!;
    const faceIds = [edge.halfEdgeAId, edge.halfEdgeBId]
      .filter((id): id is string => !!id)
      .map((id) => mesh.halfEdges.get(id)?.faceId)
      .filter((id): id is FaceId => !!id);
    if (faceIds.length !== 2) {
      return failure(
        change,
        'NON_MANIFOLD_EDGE',
        'Dissolve requires edges shared by exactly two faces',
        [edgeId],
      );
    }

    const endpoints = getEdgeVertices(mesh, edgeId);
    if (!endpoints) {
      return failure(change, 'MISSING_EDGE', `Edge ${edgeId} not found`, [edgeId]);
    }
    const [va, vb] = endpoints;
    const snapA = snapshotFace(mesh, faceIds[0]!);
    const snapB = snapshotFace(mesh, faceIds[1]!);
    const merged = stitchFacesAcrossEdge(snapA, snapB, va, vb);
    if (!merged) {
      return failure(
        change,
        'DISSOLVE_FAILED',
        `Could not stitch faces across edge ${edgeId}`,
        [edgeId, faceIds[0]!, faceIds[1]!],
      );
    }
    if (new Set(merged.vertices).size < 3) {
      return failure(change, 'DEGENERATE_FACE', 'Dissolve would create a degenerate face', [edgeId]);
    }

    mergeTopologyChange(change, removeFace(mesh, faceIds[0]!));
    mergeTopologyChange(change, removeFace(mesh, faceIds[1]!));
    const newFace = addSnapshotFace(mesh, snapA, merged.vertices, merged.uvs, change);
    change.replacedIds.set(faceIds[0]!, newFace);
    change.replacedIds.set(faceIds[1]!, newFace);
    selectedFaces.push(newFace);
  }

  change.recommendedSelection = { mode: 'face', faceIds: selectedFaces };
  return { ok: true, value: change, change, warnings: change.warnings };
}

/**
 * Dissolve adjacent faces into their outer boundary ngon(s).
 * Internal shared edges between selected faces are removed.
 */
export function dissolveFaces(
  mesh: EditableMesh,
  faceIds: FaceId[],
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const unique = [...new Set(faceIds)].filter((id) => mesh.faces.has(id));
  if (!unique.length) {
    return failure(change, 'EMPTY_SELECTION', 'No faces to dissolve', []);
  }
  if (unique.length === 1) {
    // Single face dissolve is a no-op keep; recommend the same face.
    change.recommendedSelection = { mode: 'face', faceIds: unique };
    return { ok: true, value: change, change, warnings: ['Single face dissolve leaves the face unchanged'] };
  }

  const selected = new Set(unique);
  const snaps = unique.map((id) => snapshotFace(mesh, id));
  const template = snaps[0]!;

  // Directed boundary segments: twin face ∉ selection.
  type Seg = { a: VertexId; b: VertexId; uvA: { x: number; y: number }; uvB: { x: number; y: number } };
  const segs: Seg[] = [];
  for (const snap of snaps) {
    const heIds = faceHalfEdgeIds(mesh, snap.id);
    for (let i = 0; i < heIds.length; i++) {
      const he = mesh.halfEdges.get(heIds[i]!)!;
      const next = mesh.halfEdges.get(he.nextHalfEdgeId)!;
      const twin = he.twinHalfEdgeId ? mesh.halfEdges.get(he.twinHalfEdgeId) : null;
      const twinFace = twin?.faceId ?? null;
      if (!twinFace || !selected.has(twinFace)) {
        segs.push({
          a: he.originVertexId,
          b: next.originVertexId,
          uvA: snap.uvs[i]!,
          uvB: snap.uvs[(i + 1) % snap.uvs.length]!,
        });
      }
    }
  }

  if (segs.length < 3) {
    return failure(change, 'INVALID_REGION', 'Selection has no dissolvable outer boundary', unique);
  }

  const loops = orderDirectedLoops(segs);
  if (!loops.length) {
    return failure(change, 'INVALID_REGION', 'Could not order outer boundary loops', unique);
  }

  for (const id of unique) {
    mergeTopologyChange(change, removeFace(mesh, id));
  }

  const created: FaceId[] = [];
  for (const loop of loops) {
    if (loop.vertices.length < 3) {
      return failure(change, 'DEGENERATE_FACE', 'Dissolve produced a degenerate boundary', unique);
    }
    const faceId = addSnapshotFace(mesh, template, loop.vertices, loop.uvs, change);
    created.push(faceId);
  }
  for (const id of unique) {
    change.replacedIds.set(id, created[0]!);
  }
  change.recommendedSelection = { mode: 'face', faceIds: created };
  return { ok: true, value: change, change, warnings: change.warnings };
}

function stitchFacesAcrossEdge(
  snapA: FaceSnapshot,
  snapB: FaceSnapshot,
  va: VertexId,
  vb: VertexId,
): { vertices: VertexId[]; uvs: { x: number; y: number }[] } | null {
  const edgeIndex = (snap: FaceSnapshot, from: VertexId, to: VertexId): number => {
    for (let i = 0; i < snap.vertices.length; i++) {
      const a = snap.vertices[i]!;
      const b = snap.vertices[(i + 1) % snap.vertices.length]!;
      if (a === from && b === to) return i;
    }
    return -1;
  };

  let ia = edgeIndex(snapA, va, vb);
  let ib = edgeIndex(snapB, vb, va);
  let aSnap = snapA;
  let bSnap = snapB;
  if (ia < 0 || ib < 0) {
    ia = edgeIndex(snapA, vb, va);
    ib = edgeIndex(snapB, va, vb);
    if (ia < 0 || ib < 0) return null;
    // Endpoints swapped relative to getEdgeVertices order — still valid.
  }

  const walk = (snap: FaceSnapshot, start: number, end: number) => {
    const verts: VertexId[] = [];
    const uvs: { x: number; y: number }[] = [];
    const n = snap.vertices.length;
    for (let i = start; ; i = (i + 1) % n) {
      verts.push(snap.vertices[i]!);
      uvs.push(snap.uvs[i]!);
      if (i === end) break;
    }
    return { verts, uvs };
  };

  // From vb around A to va (inclusive), then from va around B to vb (inclusive), drop duplicate ends.
  const startA = (ia + 1) % aSnap.vertices.length; // vb
  const endA = ia; // va
  const startB = (ib + 1) % bSnap.vertices.length; // va
  const endB = ib; // vb
  const pathA = walk(aSnap, startA, endA);
  const pathB = walk(bSnap, startB, endB);
  const vertices = [...pathA.verts.slice(0, -1), ...pathB.verts.slice(0, -1)];
  const uvs = [...pathA.uvs.slice(0, -1), ...pathB.uvs.slice(0, -1)];
  if (new Set(vertices).size !== vertices.length) return null;
  return { vertices, uvs };
}

function orderDirectedLoops(
  segs: { a: VertexId; b: VertexId; uvA: { x: number; y: number }; uvB: { x: number; y: number } }[],
): { vertices: VertexId[]; uvs: { x: number; y: number }[] }[] {
  const unused = new Set(segs.map((_, i) => i));
  const outByStart = new Map<VertexId, number[]>();
  for (let i = 0; i < segs.length; i++) {
    const list = outByStart.get(segs[i]!.a) ?? [];
    list.push(i);
    outByStart.set(segs[i]!.a, list);
  }

  const loops: { vertices: VertexId[]; uvs: { x: number; y: number }[] }[] = [];
  while (unused.size) {
    const startIdx = unused.values().next().value as number;
    unused.delete(startIdx);
    const start = segs[startIdx]!;
    const usedSegs = [start];
    let curr = start.b;
    let guard = 0;
    while (curr !== start.a) {
      const candidates = (outByStart.get(curr) ?? []).filter((i) => unused.has(i));
      if (!candidates.length) return [];
      const nextIdx = candidates[0]!;
      unused.delete(nextIdx);
      const next = segs[nextIdx]!;
      usedSegs.push(next);
      curr = next.b;
      guard += 1;
      if (guard > segs.length + 2) return [];
    }
    const vertices = usedSegs.map((s) => s.a);
    const uvs = usedSegs.map((s) => s.uvA);
    if (vertices.length >= 3) loops.push({ vertices, uvs });
  }
  return loops;
}

function failure(change: TopologyChangeResult, code: string, message: string, ids: string[]): GeometryOpResult<TopologyChangeResult> {
  return { ok: false, change, warnings: [], error: { code, message, affectedElementIds: ids, recoverable: true } };
}
