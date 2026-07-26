import {
  lengthVec3,
  lerpVec3,
  subVec3,
} from '@/core/math/Vec3';
import {
  addFace,
  addVertex,
  buildEdgeLookup,
  faceCornerIds,
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
import type { BevelParams, GeometryOpResult } from './types';

type FaceSnapshot = {
  id: FaceId;
  vertices: VertexId[];
  uvs: { x: number; y: number }[];
  materialSlot: number;
  smoothingGroup: number;
  flatShaded: boolean;
};

/**
 * Edge bevel / chamfer for manifold (2-face) edges.
 * `segments <= 1` keeps the classic single chamfer strip; higher values subdivide
 * the strip. `profile` biases intermediate rows (0.5 = linear).
 */
export function bevelEdges(
  mesh: EditableMesh,
  edgeIds: EdgeId[],
  params: BevelParams,
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const unique = [...new Set(edgeIds)].filter((id) => mesh.edges.has(id));
  if (!unique.length) {
    return fail(change, 'EMPTY_SELECTION', 'No edges to bevel', []);
  }
  for (const id of unique) {
    if (incidentFaces(mesh, id).length !== 2) {
      return fail(change, 'NON_MANIFOLD_EDGE', 'Bevel requires edges shared by exactly two faces', [id]);
    }
  }
  const requestedWidth = Math.max(1e-6, params.width);
  const limit = bevelWidthLimit(mesh, unique);
  const width = Math.min(requestedWidth, limit);
  if (width < requestedWidth - 1e-9) {
    change.warnings.push(`Bevel width limited from ${requestedWidth.toFixed(4)} to ${width.toFixed(4)} to prevent overlap`);
  }

  const segments = Math.max(1, Math.floor(params.segments ?? 1));
  const profile = Math.max(0.05, Math.min(0.95, params.profile ?? 0.5));

  const chamferFaces: FaceId[] = [];
  // Process longest edges first so overlapping selections fail predictably.
  // Endpoints already consumed by a prior edge in this call are tracked so
  // subsequent edges can reuse junction bevel verts when possible.
  const ordered = unique
    .map((id) => ({ id, len: edgeLength(mesh, id) }))
    .sort((a, b) => b.len - a.len);

  const junctionSpokes = new Map<VertexId, Map<VertexId, VertexId>>();

  for (const { id } of ordered) {
    if (!mesh.edges.has(id)) {
      return fail(change, 'MISSING_EDGE', `Edge ${id} was removed by a prior bevel`, [id]);
    }
    const one = bevelSingleEdge(mesh, id, width, segments, profile, change, junctionSpokes);
    if (!one.ok) return one;
    chamferFaces.push(...one.chamferIds);
  }

  change.recommendedSelection = { mode: 'face', faceIds: chamferFaces };
  return { ok: true, value: change, change, warnings: change.warnings };
}

/** Largest safe one-segment width before endpoint cuts cross adjacent edge midpoints. */
export function bevelWidthLimit(mesh: EditableMesh, edgeIds: EdgeId[]): number {
  let limit = Infinity;
  for (const edgeId of edgeIds) {
    const ends = getEdgeVertices(mesh, edgeId);
    if (!ends) continue;
    const [a, b] = ends;
    for (const faceId of incidentFaces(mesh, edgeId)) {
      const placement = edgeSideNeighbors(faceVertexIds(mesh, faceId), a, b);
      if (!placement) continue;
      const pa = mesh.vertices.get(a)!.position;
      const pb = mesh.vertices.get(b)!.position;
      limit = Math.min(
        limit,
        lengthVec3(subVec3(mesh.vertices.get(placement.prev)!.position, pa)) * 0.49,
        lengthVec3(subVec3(mesh.vertices.get(placement.next)!.position, pb)) * 0.49,
      );
    }
  }
  return Number.isFinite(limit) ? Math.max(1e-6, limit) : 1e-6;
}

function bevelSingleEdge(
  mesh: EditableMesh,
  edgeId: EdgeId,
  width: number,
  segments: number,
  profile: number,
  change: TopologyChangeResult,
  junctionSpokes: Map<VertexId, Map<VertexId, VertexId>>,
): GeometryOpResult<TopologyChangeResult> & { chamferIds: FaceId[] } {
  const ends = getEdgeVertices(mesh, edgeId);
  if (!ends) return { ...fail(change, 'MISSING_EDGE', `Edge ${edgeId} not found`, [edgeId]), chamferIds: [] };
  const [vertA, vertB] = ends;
  const faceIds = incidentFaces(mesh, edgeId);
  if (faceIds.length !== 2) {
    return {
      ...fail(
        change,
        'NON_MANIFOLD_EDGE',
        'Bevel currently supports edges shared by exactly two faces',
        [edgeId],
      ),
      chamferIds: [],
    };
  }
  const [face0, face1] = faceIds;

  const place0 = edgeSideNeighbors(faceVertexIds(mesh, face0), vertA, vertB);
  const place1 = edgeSideNeighbors(faceVertexIds(mesh, face1), vertA, vertB);
  if (!place0 || !place1) {
    return {
      ...fail(change, 'BAD_FACE_LOOP', 'Edge is not consecutive on an incident face', [edgeId]),
      chamferIds: [],
    };
  }

  const posA = mesh.vertices.get(vertA)!.position;
  const posB = mesh.vertices.get(vertB)!.position;
  const posP0 = mesh.vertices.get(place0.prev)!.position;
  const posQ0 = mesh.vertices.get(place0.next)!.position;
  const posP1 = mesh.vertices.get(place1.prev)!.position;
  const posQ1 = mesh.vertices.get(place1.next)!.position;

  const t = (from: typeof posA, to: typeof posA) => {
    const len = lengthVec3(subVec3(to, from));
    return Math.min(0.49, width / Math.max(len, 1e-8));
  };

  const a0Pos = lerpVec3(posA, posP0, t(posA, posP0));
  const b0Pos = lerpVec3(posB, posQ0, t(posB, posQ0));
  const a1Pos = lerpVec3(posA, posP1, t(posA, posP1));
  const b1Pos = lerpVec3(posB, posQ1, t(posB, posQ1));

  const a0 = reuseOrCreateSpoke(mesh, change, junctionSpokes, vertA, place0.prev, a0Pos);
  const b0 = reuseOrCreateSpoke(mesh, change, junctionSpokes, vertB, place0.next, b0Pos);
  const a1 = reuseOrCreateSpoke(mesh, change, junctionSpokes, vertA, place1.prev, a1Pos);
  const b1 = reuseOrCreateSpoke(mesh, change, junctionSpokes, vertB, place1.next, b1Pos);

  // Intermediate segment rows between face0 and face1 offsets.
  const rowA: VertexId[] = [a0];
  const rowB: VertexId[] = [b0];
  for (let i = 1; i < segments; i++) {
    const u = profileT(i / segments, profile);
    const ai = addVertex(mesh, lerpVec3(a0Pos, a1Pos, u));
    const bi = addVertex(mesh, lerpVec3(b0Pos, b1Pos, u));
    change.createdVertexIds.push(ai, bi);
    rowA.push(ai);
    rowB.push(bi);
  }
  rowA.push(a1);
  rowB.push(b1);

  const spokeAtA = new Map<VertexId, VertexId>([
    [place0.prev, a0],
    [place1.prev, a1],
  ]);
  const spokeAtB = new Map<VertexId, VertexId>([
    [place0.next, b0],
    [place1.next, b1],
  ]);
  // Merge any previously recorded junction spokes at these endpoints.
  for (const [neighbor, spoke] of junctionSpokes.get(vertA) ?? []) {
    spokeAtA.set(neighbor, spoke);
  }
  for (const [neighbor, spoke] of junctionSpokes.get(vertB) ?? []) {
    spokeAtB.set(neighbor, spoke);
  }

  // Profile arcs for endpoint fans (exclude rail endpoints already in spoke map).
  const arcA = rowA.slice(1, -1);
  const arcB = rowB.slice(1, -1);

  const affected = facesIncidentToVertices(mesh, [vertA, vertB]);
  const snaps = affected.map((id) => snapshotFace(mesh, id));
  for (const id of affected) mergeTopologyChange(change, removeFace(mesh, id));

  const lookup = buildEdgeLookup(mesh);
  const chamferIds: FaceId[] = [];
  const uvReplace = new Map<VertexId, VertexId>([
    [a0, vertA],
    [a1, vertA],
    [b0, vertB],
    [b1, vertB],
  ]);
  for (let i = 1; i < segments; i++) {
    uvReplace.set(rowA[i]!, vertA);
    uvReplace.set(rowB[i]!, vertB);
  }

  for (const snap of snaps) {
    const rebuilt = rebuildFaceVertices(snap.vertices, vertA, vertB, face0, face1, snap.id, {
      a0,
      b0,
      a1,
      b1,
      spokeAtA,
      spokeAtB,
      arcA,
      arcB,
    });
    if (!rebuilt.length || rebuilt.length < 3) continue;
    const uvs = interpolateUvs(snap, rebuilt, uvReplace);
    const added = addFace(mesh, rebuilt, {
      uvs,
      materialSlot: snap.materialSlot,
      flatShaded: snap.flatShaded,
      edgeLookup: lookup,
    });
    mesh.faces.get(added.faceId)!.smoothingGroup = snap.smoothingGroup;
    mergeTopologyChange(change, added.result);
    change.replacedIds.set(snap.id, added.faceId);
  }

  // Chamfer strip rows: segments quads from face0 side to face1 side.
  for (let i = 0; i < segments; i++) {
    const chamfer = addFace(mesh, [rowA[i]!, rowA[i + 1]!, rowB[i + 1]!, rowB[i]!], {
      materialSlot: snaps[0]?.materialSlot ?? 0,
      flatShaded: true,
      uvs: [
        { x: 0, y: i / segments },
        { x: 0, y: (i + 1) / segments },
        { x: 1, y: (i + 1) / segments },
        { x: 1, y: i / segments },
      ],
      edgeLookup: buildEdgeLookup(mesh),
    });
    mergeTopologyChange(change, chamfer.result);
    chamferIds.push(chamfer.faceId);
    change.createdFaceIds.push(chamfer.faceId);
  }

  for (const id of [vertA, vertB]) {
    if (!vertexStillUsed(mesh, id)) {
      mesh.vertices.delete(id);
      change.removedVertexIds.push(id);
      junctionSpokes.delete(id);
    }
  }

  return { ok: true, value: change, change, warnings: change.warnings, chamferIds };
}

function reuseOrCreateSpoke(
  mesh: EditableMesh,
  change: TopologyChangeResult,
  junctionSpokes: Map<VertexId, Map<VertexId, VertexId>>,
  endpoint: VertexId,
  neighbor: VertexId,
  position: { x: number; y: number; z: number },
): VertexId {
  const existing = junctionSpokes.get(endpoint)?.get(neighbor);
  if (existing && mesh.vertices.has(existing)) return existing;
  const id = addVertex(mesh, position);
  change.createdVertexIds.push(id);
  let map = junctionSpokes.get(endpoint);
  if (!map) {
    map = new Map();
    junctionSpokes.set(endpoint, map);
  }
  map.set(neighbor, id);
  return id;
}

/** Bias t∈[0,1] by profile (0.5 = linear). */
function profileT(t: number, profile: number): number {
  if (Math.abs(profile - 0.5) < 1e-6) return t;
  const exponent = Math.log(0.5) / Math.log(profile);
  return Math.pow(t, exponent);
}

function rebuildFaceVertices(
  verts: VertexId[],
  vertA: VertexId,
  vertB: VertexId,
  face0: FaceId,
  face1: FaceId,
  faceId: FaceId,
  ids: {
    a0: VertexId;
    b0: VertexId;
    a1: VertexId;
    b1: VertexId;
    spokeAtA: Map<VertexId, VertexId>;
    spokeAtB: Map<VertexId, VertexId>;
    arcA: VertexId[];
    arcB: VertexId[];
  },
): VertexId[] {
  if (faceId === face0) {
    return verts.map((v) => (v === vertA ? ids.a0 : v === vertB ? ids.b0 : v));
  }
  if (faceId === face1) {
    return verts.map((v) => (v === vertA ? ids.a1 : v === vertB ? ids.b1 : v));
  }

  const out: VertexId[] = [];
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i]!;
    if (v !== vertA && v !== vertB) {
      out.push(v);
      continue;
    }
    const prev = verts[(i - 1 + verts.length) % verts.length]!;
    const next = verts[(i + 1) % verts.length]!;
    const spoke = v === vertA ? ids.spokeAtA : ids.spokeAtB;
    const arc = v === vertA ? ids.arcA : ids.arcB;
    const fromPrev = spoke.get(prev);
    const fromNext = spoke.get(next);
    if (fromPrev && fromNext) {
      // Insert profile arc between the two spokes (row order *0 → *1).
      const startRail = v === vertA ? ids.a0 : ids.b0;
      const oriented = fromPrev === startRail ? arc : [...arc].reverse();
      out.push(fromPrev, ...oriented, fromNext);
    } else if (fromPrev) {
      out.push(fromPrev);
    } else if (fromNext) {
      out.push(fromNext);
    }
  }
  const dedup: VertexId[] = [];
  for (const id of out) {
    if (dedup[dedup.length - 1] !== id) dedup.push(id);
  }
  if (dedup.length > 1 && dedup[0] === dedup[dedup.length - 1]) dedup.pop();
  return dedup;
}

function interpolateUvs(
  snap: FaceSnapshot,
  newVerts: VertexId[],
  replacements: Map<VertexId, VertexId>,
): { x: number; y: number }[] {
  if (!snap.uvs.length) return newVerts.map(() => ({ x: 0, y: 0 }));
  const uvByOrig = new Map<VertexId, { x: number; y: number }>();
  for (let i = 0; i < snap.vertices.length; i++) {
    uvByOrig.set(snap.vertices[i]!, snap.uvs[i]!);
  }
  const avg = snap.uvs.reduce(
    (sum, uv) => ({ x: sum.x + uv.x / snap.uvs.length, y: sum.y + uv.y / snap.uvs.length }),
    { x: 0, y: 0 },
  );
  return newVerts.map((v) => {
    if (uvByOrig.has(v)) return { ...uvByOrig.get(v)! };
    const orig = replacements.get(v);
    if (orig && uvByOrig.has(orig)) return { ...uvByOrig.get(orig)! };
    return { ...avg };
  });
}

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

function edgeSideNeighbors(verts: VertexId[], a: VertexId, b: VertexId) {
  const iA = verts.indexOf(a);
  const iB = verts.indexOf(b);
  if (iA < 0 || iB < 0) return null;
  const n = verts.length;
  const aPrev = verts[(iA - 1 + n) % n]!;
  const aNext = verts[(iA + 1) % n]!;
  const bPrev = verts[(iB - 1 + n) % n]!;
  const bNext = verts[(iB + 1) % n]!;
  if (aPrev !== b && aNext !== b) return null;
  if (bPrev !== a && bNext !== a) return null;
  return {
    prev: aPrev === b ? aNext : aPrev,
    next: bPrev === a ? bNext : bPrev,
  };
}

function incidentFaces(mesh: EditableMesh, edgeId: EdgeId): FaceId[] {
  const edge = mesh.edges.get(edgeId);
  if (!edge) return [];
  return [edge.halfEdgeAId, edge.halfEdgeBId]
    .filter((id): id is string => !!id)
    .map((id) => mesh.halfEdges.get(id)?.faceId)
    .filter((id): id is FaceId => !!id);
}

function facesIncidentToVertices(mesh: EditableMesh, vertexIds: VertexId[]): FaceId[] {
  const set = new Set(vertexIds);
  const faces: FaceId[] = [];
  for (const face of mesh.faces.values()) {
    const verts = faceVertexIds(mesh, face.id);
    if (verts.some((id) => set.has(id))) faces.push(face.id);
  }
  return faces;
}

function edgeLength(mesh: EditableMesh, edgeId: EdgeId): number {
  const ends = getEdgeVertices(mesh, edgeId);
  if (!ends) return 0;
  return lengthVec3(subVec3(mesh.vertices.get(ends[0])!.position, mesh.vertices.get(ends[1])!.position));
}

function vertexStillUsed(mesh: EditableMesh, vertexId: VertexId): boolean {
  for (const face of mesh.faces.values()) {
    if (faceVertexIds(mesh, face.id).includes(vertexId)) return true;
  }
  return false;
}

function fail(
  change: TopologyChangeResult,
  code: string,
  message: string,
  ids: string[],
): GeometryOpResult<TopologyChangeResult> {
  return {
    ok: false,
    change,
    warnings: [],
    error: { code, message, affectedElementIds: ids, recoverable: true },
  };
}
