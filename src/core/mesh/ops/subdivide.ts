import { lerpVec3 } from '@/core/math/Vec3';
import {
  addFace,
  addVertex,
  buildEdgeLookup,
  edgeKey,
  faceCornerIds,
  faceVertexIds,
  mergeTopologyChange,
  removeFace,
} from '@/core/mesh/EditableMesh';
import {
  emptyTopologyChangeResult,
  type EditableMesh,
  type FaceId,
  type TopologyChangeResult,
  type VertexId,
} from '@/core/mesh/types';
import type { GeometryOpResult } from './types';

type FaceSnapshot = {
  id: FaceId;
  vertices: VertexId[];
  uvs: { x: number; y: number }[];
  materialSlot: number;
  smoothingGroup: number;
  flatShaded: boolean;
};

/**
 * Linear face subdivide (1–3 cuts). Shared boundary edges get one midpoint;
 * each selected face is replaced by n quads around a face centre.
 */
export function subdivideFaces(
  mesh: EditableMesh,
  faceIds: FaceId[],
  cuts = 1,
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  let current = [...new Set(faceIds)].filter((id) => mesh.faces.has(id));
  if (current.length === 0) {
    return failure(change, 'EMPTY_SELECTION', 'Select at least one face to subdivide', []);
  }
  const levels = Math.max(1, Math.min(3, Math.round(cuts)));

  for (let level = 0; level < levels; level++) {
    const once = subdivideOnce(mesh, current, change);
    if (!once.ok) return once;
    current = once.newFaceIds;
  }

  change.recommendedSelection = { mode: 'face', faceIds: current };
  return { ok: true, value: change, change, warnings: change.warnings };
}

/** Insert a centre vertex and fan triangles to each boundary edge. */
export function pokeFaces(
  mesh: EditableMesh,
  faceIds: FaceId[],
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const unique = [...new Set(faceIds)].filter((id) => mesh.faces.has(id));
  if (unique.length === 0) {
    return failure(change, 'EMPTY_SELECTION', 'Select at least one face to poke', []);
  }

  const snaps = unique.map((id) => snapshotFace(mesh, id));
  for (const snap of snaps) mergeTopologyChange(change, removeFace(mesh, snap.id));

  const created: FaceId[] = [];
  const edgeLookup = buildEdgeLookup(mesh);
  for (const snap of snaps) {
    if (snap.vertices.length < 3) continue;
    const centreId = addVertex(mesh, averagePositions(mesh, snap.vertices));
    change.createdVertexIds.push(centreId);
    const centreUv = averageUvs(snap.uvs);

    for (let index = 0; index < snap.vertices.length; index++) {
      const a = snap.vertices[index]!;
      const b = snap.vertices[(index + 1) % snap.vertices.length]!;
      const uvA = snap.uvs[index] ?? { x: 0, y: 0 };
      const uvB = snap.uvs[(index + 1) % snap.uvs.length] ?? { x: 0, y: 0 };
      created.push(
        addSnapshotFace(
          mesh,
          snap,
          [centreId, a, b],
          [centreUv, uvA, uvB],
          change,
          edgeLookup,
        ),
      );
    }
  }

  change.recommendedSelection = { mode: 'face', faceIds: created };
  return { ok: true, value: change, change, warnings: change.warnings };
}

function subdivideOnce(
  mesh: EditableMesh,
  faceIds: FaceId[],
  change: TopologyChangeResult,
): GeometryOpResult<TopologyChangeResult> & { newFaceIds: FaceId[] } {
  const selected = new Set(faceIds.filter((id) => mesh.faces.has(id)));
  if (selected.size === 0) {
    return {
      ...failure(change, 'EMPTY_SELECTION', 'No faces left to subdivide', []),
      newFaceIds: [],
    };
  }

  const selectedSnaps = [...selected].map((id) => snapshotFace(mesh, id));
  const splitKeys = new Set<string>();
  for (const snap of selectedSnaps) {
    for (let index = 0; index < snap.vertices.length; index++) {
      splitKeys.add(edgeKey(
        snap.vertices[index]!,
        snap.vertices[(index + 1) % snap.vertices.length]!,
      ));
    }
  }

  const rebuild = new Set(selected);
  for (const face of mesh.faces.values()) {
    if (selected.has(face.id)) continue;
    const verts = faceVertexIds(mesh, face.id);
    for (let index = 0; index < verts.length; index++) {
      if (splitKeys.has(edgeKey(verts[index]!, verts[(index + 1) % verts.length]!))) {
        rebuild.add(face.id);
        break;
      }
    }
  }

  const neighborSnaps = [...rebuild]
    .filter((id) => !selected.has(id))
    .map((id) => snapshotFace(mesh, id));

  const midpoints = new Map<string, VertexId>();
  for (const snap of selectedSnaps) {
    for (let index = 0; index < snap.vertices.length; index++) {
      const a = snap.vertices[index]!;
      const b = snap.vertices[(index + 1) % snap.vertices.length]!;
      const key = edgeKey(a, b);
      if (midpoints.has(key)) continue;
      const midId = addVertex(
        mesh,
        lerpVec3(mesh.vertices.get(a)!.position, mesh.vertices.get(b)!.position, 0.5),
      );
      midpoints.set(key, midId);
      change.createdVertexIds.push(midId);
    }
  }

  for (const id of rebuild) mergeTopologyChange(change, removeFace(mesh, id));

  const edgeLookup = buildEdgeLookup(mesh);
  const newFaceIds: FaceId[] = [];

  for (const snap of selectedSnaps) {
    const n = snap.vertices.length;
    if (n < 3) continue;
    const centreId = addVertex(mesh, averagePositions(mesh, snap.vertices));
    change.createdVertexIds.push(centreId);
    const centreUv = averageUvs(snap.uvs);

    for (let index = 0; index < n; index++) {
      const prev = snap.vertices[(index + n - 1) % n]!;
      const corner = snap.vertices[index]!;
      const next = snap.vertices[(index + 1) % n]!;
      const midPrev = midpoints.get(edgeKey(prev, corner))!;
      const midNext = midpoints.get(edgeKey(corner, next))!;
      const uvPrev = snap.uvs[(index + n - 1) % n] ?? { x: 0, y: 0 };
      const uvCorner = snap.uvs[index] ?? { x: 0, y: 0 };
      const uvNext = snap.uvs[(index + 1) % n] ?? { x: 0, y: 0 };
      newFaceIds.push(
        addSnapshotFace(
          mesh,
          snap,
          [centreId, midPrev, corner, midNext],
          [centreUv, lerpUv(uvPrev, uvCorner, 0.5), uvCorner, lerpUv(uvCorner, uvNext, 0.5)],
          change,
          edgeLookup,
        ),
      );
    }
  }

  for (const snap of neighborSnaps) {
    const verts: VertexId[] = [];
    const uvs: { x: number; y: number }[] = [];
    for (let index = 0; index < snap.vertices.length; index++) {
      const a = snap.vertices[index]!;
      const b = snap.vertices[(index + 1) % snap.vertices.length]!;
      const uvA = snap.uvs[index] ?? { x: 0, y: 0 };
      const uvB = snap.uvs[(index + 1) % snap.uvs.length] ?? { x: 0, y: 0 };
      verts.push(a);
      uvs.push(uvA);
      const mid = midpoints.get(edgeKey(a, b));
      if (mid) {
        verts.push(mid);
        uvs.push(lerpUv(uvA, uvB, 0.5));
      }
    }
    if (verts.length >= 3) {
      addSnapshotFace(mesh, snap, verts, uvs, change, edgeLookup);
    }
  }

  return { ok: true, value: change, change, warnings: change.warnings, newFaceIds };
}

function snapshotFace(mesh: EditableMesh, faceId: FaceId): FaceSnapshot {
  const face = mesh.faces.get(faceId)!;
  return {
    id: faceId,
    vertices: faceVertexIds(mesh, faceId),
    uvs: faceCornerIds(mesh, faceId).map((id) => {
      const uv = mesh.defaultUvLayerId
        ? mesh.faceCorners.get(id)?.uvs.get(mesh.defaultUvLayerId)
        : null;
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
  edgeLookup: Map<string, string>,
): FaceId {
  const added = addFace(mesh, vertices, {
    uvs,
    materialSlot: snap.materialSlot,
    flatShaded: snap.flatShaded,
    edgeLookup,
  });
  mesh.faces.get(added.faceId)!.smoothingGroup = snap.smoothingGroup;
  mergeTopologyChange(change, added.result);
  change.replacedIds.set(snap.id, added.faceId);
  return added.faceId;
}

function averagePositions(mesh: EditableMesh, vertexIds: VertexId[]) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const id of vertexIds) {
    const p = mesh.vertices.get(id)!.position;
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = Math.max(1, vertexIds.length);
  return { x: x / n, y: y / n, z: z / n };
}

function averageUvs(uvs: { x: number; y: number }[]) {
  if (uvs.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const uv of uvs) {
    x += uv.x;
    y += uv.y;
  }
  return { x: x / uvs.length, y: y / uvs.length };
}

function lerpUv(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function failure(
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
