import {
  crossVec3,
  normalizeVec3,
  subVec3,
  type Vec3,
  v3,
} from '@/core/math/Vec3';
import { faceHalfEdgeIds, faceVertexIds } from './EditableMesh';
import type { EditableMesh, FaceCornerId, FaceId, VertexId } from './types';

/** Newell's method — robust for n-gons. */
export function computeFaceNormal(mesh: EditableMesh, faceId: FaceId): Vec3 {
  const ids = faceVertexIds(mesh, faceId);
  if (ids.length < 3) return v3(0, 1, 0);

  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < ids.length; i++) {
    const cur = mesh.vertices.get(ids[i]!)!.position;
    const next = mesh.vertices.get(ids[(i + 1) % ids.length]!)!.position;
    nx += (cur.y - next.y) * (cur.z + next.z);
    ny += (cur.z - next.z) * (cur.x + next.x);
    nz += (cur.x - next.x) * (cur.y + next.y);
  }
  return normalizeVec3(v3(nx, ny, nz));
}

export function computeAllFaceNormals(mesh: EditableMesh): Map<FaceId, Vec3> {
  const map = new Map<FaceId, Vec3>();
  for (const face of mesh.faces.values()) {
    map.set(face.id, computeFaceNormal(mesh, face.id));
  }
  return map;
}

/**
 * Average adjacent face normals for smooth shading.
 * Hard edges / flat faces should be handled at render time via corner splits.
 */
export function computeVertexNormals(mesh: EditableMesh): Map<VertexId, Vec3> {
  const faceNormals = computeAllFaceNormals(mesh);
  const accum = new Map<VertexId, Vec3>();

  for (const face of mesh.faces.values()) {
    const n = faceNormals.get(face.id)!;
    for (const vid of faceVertexIds(mesh, face.id)) {
      const cur = accum.get(vid) ?? v3(0, 0, 0);
      accum.set(vid, v3(cur.x + n.x, cur.y + n.y, cur.z + n.z));
    }
  }

  const result = new Map<VertexId, Vec3>();
  for (const [id, n] of accum) {
    result.set(id, normalizeVec3(n));
  }
  return result;
}

/** Corner normal respecting flat faces, smoothing groups and sharp edges. */
export function computeCornerNormal(mesh: EditableMesh, cornerId: FaceCornerId): Vec3 {
  const corner = mesh.faceCorners.get(cornerId);
  if (!corner) return v3(0, 1, 0);
  if (corner.splitNormal) return corner.splitNormal;
  const sourceFace = mesh.faces.get(corner.faceId);
  if (!sourceFace || sourceFace.flatShaded) return computeFaceNormal(mesh, corner.faceId);

  const incident = new Set<FaceId>();
  for (const face of mesh.faces.values()) {
    if (!face.flatShaded && faceVertexIds(mesh, face.id).includes(corner.vertexId)) incident.add(face.id);
  }
  const reachable = new Set<FaceId>([corner.faceId]);
  const queue: FaceId[] = [corner.faceId];
  while (queue.length) {
    const faceId = queue.shift()!;
    for (const heId of faceHalfEdgeIds(mesh, faceId)) {
      const he = mesh.halfEdges.get(heId)!;
      const next = mesh.halfEdges.get(he.nextHalfEdgeId)!;
      if (he.originVertexId !== corner.vertexId && next.originVertexId !== corner.vertexId) continue;
      const edge = mesh.edges.get(he.edgeId)!;
      if (edge.sharpness > 0) continue;
      const twinFace = he.twinHalfEdgeId ? mesh.halfEdges.get(he.twinHalfEdgeId)?.faceId : null;
      if (!twinFace || !incident.has(twinFace) || reachable.has(twinFace)) continue;
      const other = mesh.faces.get(twinFace)!;
      if (sourceFace.smoothingGroup && other.smoothingGroup && sourceFace.smoothingGroup !== other.smoothingGroup) continue;
      reachable.add(twinFace);
      queue.push(twinFace);
    }
  }
  let sum = v3(0, 0, 0);
  for (const faceId of reachable) {
    const n = computeFaceNormal(mesh, faceId);
    sum = v3(sum.x + n.x, sum.y + n.y, sum.z + n.z);
  }
  return normalizeVec3(sum);
}

/** Quick triangle normal for triangulation quality heuristics. */
export function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return normalizeVec3(crossVec3(subVec3(b, a), subVec3(c, a)));
}
