import { addVec3, cloneVec3, normalizeVec3, scaleVec3, type Vec3, v3 } from '@/core/math/Vec3';
import {
  addFace,
  addVertex,
  buildEdgeLookup,
  faceHalfEdgeIds,
  faceCornerIds,
  faceVertexIds,
  getEdgeVertices,
  isBoundaryEdge,
  mergeTopologyChange,
  removeFace,
} from '@/core/mesh/EditableMesh';
import { computeFaceNormal } from '@/core/mesh/Normals';
import {
  emptyTopologyChangeResult,
  type EditableMesh,
  type EdgeId,
  type FaceId,
  type TopologyChangeResult,
  type VertexId,
} from '@/core/mesh/types';
import type { ExtrudeParams, GeometryOpResult } from './types';

type FaceSnapshot = {
  id: FaceId;
  verts: VertexId[];
  materialSlot: number;
  flatShaded: boolean;
  uvs: { x: number; y: number }[];
};

/**
 * Region face extrusion:
 * 1. Capture face loops + region boundary
 * 2. Duplicate region vertices along direction
 * 3. Remove original selected faces (opens boundary edges)
 * 4. Create top faces
 * 5. Create side faces only on the outer boundary
 */
export function extrudeFaceRegion(
  mesh: EditableMesh,
  faceIds: FaceId[],
  params: ExtrudeParams,
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  if (faceIds.length === 0) {
    return {
      ok: false,
      change,
      warnings: [],
      error: {
        code: 'EMPTY_SELECTION',
        message: 'No faces to extrude',
        affectedElementIds: [],
        recoverable: true,
      },
    };
  }

  for (const id of faceIds) {
    if (!mesh.faces.has(id)) {
      return {
        ok: false,
        change,
        warnings: [],
        error: {
          code: 'MISSING_FACE',
          message: `Face ${id} not found`,
          affectedElementIds: [id],
          recoverable: true,
        },
      };
    }
  }

  const selected = new Set(faceIds);
  const direction =
    params.direction ??
    normalizeVec3(
      faceIds.reduce((acc, id) => addVec3(acc, computeFaceNormal(mesh, id)), v3(0, 0, 0)),
    );

  if (direction.x === 0 && direction.y === 0 && direction.z === 0) {
    return {
      ok: false,
      change,
      warnings: [],
      error: {
        code: 'DEGENERATE_EXTRUDE',
        message: 'Extrude direction is zero',
        affectedElementIds: faceIds,
        recoverable: true,
      },
    };
  }

  const offset = scaleVec3(direction, params.distance);

  const snapshots: FaceSnapshot[] = [];
  const regionVerts = new Set<VertexId>();
  const boundaryPairs: { a: VertexId; b: VertexId; materialSlot: number }[] = [];

  for (const faceId of faceIds) {
    const face = mesh.faces.get(faceId)!;
    const verts = faceVertexIds(mesh, faceId);
    snapshots.push({
      id: faceId,
      verts,
      materialSlot: face.materialSlot,
      flatShaded: face.flatShaded,
      uvs: faceCornerIds(mesh, faceId).map((id) => {
        const uv = mesh.defaultUvLayerId ? mesh.faceCorners.get(id)?.uvs.get(mesh.defaultUvLayerId) : null;
        return uv ? { ...uv } : { x: 0, y: 0 };
      }),
    });
    for (const vid of verts) regionVerts.add(vid);

    for (const heId of faceHalfEdgeIds(mesh, faceId)) {
      const he = mesh.halfEdges.get(heId)!;
      const next = mesh.halfEdges.get(he.nextHalfEdgeId)!;
      const twin = he.twinHalfEdgeId ? mesh.halfEdges.get(he.twinHalfEdgeId) : null;
      const twinFace = twin?.faceId ?? null;
      if (!twinFace || !selected.has(twinFace)) {
        boundaryPairs.push({
          a: he.originVertexId,
          b: next.originVertexId,
          materialSlot: params.sideMaterialSlot ?? face.materialSlot,
        });
      }
    }
  }

  const vertMap = new Map<VertexId, VertexId>();
  for (const vid of regionVerts) {
    const src = mesh.vertices.get(vid)!;
    const newId = addVertex(mesh, addVec3(src.position, offset));
    vertMap.set(vid, newId);
    change.createdVertexIds.push(newId);
  }

  // Remove originals first so boundary edges have a free half-edge slot.
  for (const faceId of faceIds) {
    mergeTopologyChange(change, removeFace(mesh, faceId));
  }

  const edgeLookup = buildEdgeLookup(mesh);
  const newFaceIds: FaceId[] = [];

  for (const snap of snapshots) {
    const newVerts = snap.verts.map((id) => vertMap.get(id)!);
    const { faceId: topId, result } = addFace(mesh, newVerts, {
      materialSlot: snap.materialSlot,
      flatShaded: snap.flatShaded,
      uvs: snap.uvs,
      edgeLookup,
    });
    mergeTopologyChange(change, result);
    newFaceIds.push(topId);
  }

  for (const pair of boundaryPairs) {
    const a2 = vertMap.get(pair.a)!;
    const b2 = vertMap.get(pair.b)!;
    // a -> b along old boundary; then up to extruded verts.
    const { faceId: sideId, result } = addFace(mesh, [pair.a, pair.b, b2, a2], {
      materialSlot: pair.materialSlot,
      uvs: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      edgeLookup,
    });
    mergeTopologyChange(change, result);
    newFaceIds.push(sideId);
  }

  change.recommendedSelection = { mode: 'face', faceIds: newFaceIds.slice(0, snapshots.length) };
  return { ok: true, value: change, change, warnings: change.warnings };
}

/**
 * Extrude selected edges:
 * - If they fully enclose one or more faces, extrude those faces (region).
 * - Otherwise extrude boundary edges into side faces (Blender-like edge extrude).
 */
export function extrudeEdges(
  mesh: EditableMesh,
  edgeIds: EdgeId[],
  params: ExtrudeParams,
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const unique = [...new Set(edgeIds)].filter((id) => mesh.edges.has(id));
  if (!unique.length) {
    return {
      ok: false,
      change,
      warnings: [],
      error: {
        code: 'EMPTY_SELECTION',
        message: 'No edges to extrude',
        affectedElementIds: [],
        recoverable: true,
      },
    };
  }

  const enclosed = facesFullyBoundedByEdges(mesh, unique);
  if (enclosed.length) {
    return extrudeFaceRegion(mesh, enclosed, params);
  }

  const boundary = unique.filter((id) => isBoundaryEdge(mesh, id));
  if (!boundary.length) {
    return {
      ok: false,
      change,
      warnings: [],
      error: {
        code: 'NO_BOUNDARY_EDGES',
        message: 'Select boundary edges, or a closed loop of edges around a face',
        affectedElementIds: unique,
        recoverable: true,
      },
    };
  }

  const direction =
    params.direction ?? averageBoundaryEdgeNormal(mesh, boundary);
  if (direction.x === 0 && direction.y === 0 && direction.z === 0) {
    return {
      ok: false,
      change,
      warnings: [],
      error: {
        code: 'DEGENERATE_EXTRUDE',
        message: 'Extrude direction is zero',
        affectedElementIds: boundary,
        recoverable: true,
      },
    };
  }

  const offset = scaleVec3(direction, params.distance);
  const regionVerts = new Set<VertexId>();
  for (const edgeId of boundary) {
    const pair = getEdgeVertices(mesh, edgeId);
    if (!pair) continue;
    regionVerts.add(pair[0]);
    regionVerts.add(pair[1]);
  }

  const vertMap = new Map<VertexId, VertexId>();
  for (const vid of regionVerts) {
    const src = mesh.vertices.get(vid)!;
    const newId = addVertex(mesh, addVec3(src.position, offset));
    vertMap.set(vid, newId);
    change.createdVertexIds.push(newId);
  }

  const edgeLookup = buildEdgeLookup(mesh);
  const newFaceIds: FaceId[] = [];

  for (const edgeId of boundary) {
    const existing = getEdgeVertices(mesh, edgeId);
    if (!existing) continue;
    const [from, to] = existing;
    const from2 = vertMap.get(from)!;
    const to2 = vertMap.get(to)!;
    // Existing boundary half-edge runs from→to; new face must run to→from on that edge.
    const { faceId, result } = addFace(mesh, [to, from, from2, to2], {
      materialSlot: params.sideMaterialSlot ?? 0,
      uvs: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      edgeLookup,
    });
    mergeTopologyChange(change, result);
    newFaceIds.push(faceId);
  }

  change.recommendedSelection = {
    mode: 'vertex',
    vertexIds: [...vertMap.values()],
  };
  return { ok: true, value: change, change, warnings: change.warnings };
}

/** Faces whose entire boundary is contained in the edge selection. */
export function facesFullyBoundedByEdges(mesh: EditableMesh, edgeIds: EdgeId[]): FaceId[] {
  const selected = new Set(edgeIds);
  const result: FaceId[] = [];
  for (const face of mesh.faces.values()) {
    const heIds = faceHalfEdgeIds(mesh, face.id);
    if (!heIds.length) continue;
    let all = true;
    for (const heId of heIds) {
      const edgeId = mesh.halfEdges.get(heId)?.edgeId;
      if (!edgeId || !selected.has(edgeId)) {
        all = false;
        break;
      }
    }
    if (all) result.push(face.id);
  }
  return result;
}

function averageBoundaryEdgeNormal(mesh: EditableMesh, edgeIds: EdgeId[]): Vec3 {
  let acc = v3(0, 0, 0);
  let count = 0;
  for (const edgeId of edgeIds) {
    const edge = mesh.edges.get(edgeId);
    if (!edge) continue;
    const he = mesh.halfEdges.get(edge.halfEdgeAId);
    if (he?.faceId) {
      acc = addVec3(acc, computeFaceNormal(mesh, he.faceId));
      count += 1;
    }
  }
  if (count === 0) return v3(0, 1, 0);
  return normalizeVec3(acc);
}

export function translateVertices(
  mesh: EditableMesh,
  vertexIds: VertexId[],
  delta: Vec3,
): void {
  for (const id of vertexIds) {
    const v = mesh.vertices.get(id);
    if (!v) continue;
    v.position = addVec3(v.position, delta);
  }
  mesh.geometryVersion += 1;
  mesh.dirty.positions = true;
  mesh.dirty.normals = true;
  mesh.dirty.bounds = true;
  mesh.dirty.bvh = true;
}

export function setVerticesPositions(
  mesh: EditableMesh,
  positions: Map<VertexId, Vec3>,
): void {
  for (const [id, pos] of positions) {
    const v = mesh.vertices.get(id);
    if (!v) continue;
    v.position = cloneVec3(pos);
  }
  mesh.geometryVersion += 1;
  mesh.dirty.positions = true;
  mesh.dirty.normals = true;
  mesh.dirty.bounds = true;
  mesh.dirty.bvh = true;
}
