import { createId } from '@/core/ids/IdService';
import { cloneVec2, v2, type Vec2 } from '@/core/math/Vec2';
import { cloneVec3, type Vec3 } from '@/core/math/Vec3';
import {
  emptyDirtyFlags,
  emptyTopologyChangeResult,
  type EditableMesh,
  type Edge,
  type EdgeId,
  type Face,
  type FaceCorner,
  type FaceCornerId,
  type FaceId,
  type HalfEdge,
  type HalfEdgeId,
  type TopologyChangeResult,
  type UvLayerId,
  type Vertex,
  type VertexId,
} from './types';

export function createEmptyMesh(name = 'Mesh'): EditableMesh {
  const uvLayerId = createId('uv');
  return {
    id: createId('mesh'),
    name,
    vertices: new Map(),
    edges: new Map(),
    halfEdges: new Map(),
    faces: new Map(),
    faceCorners: new Map(),
    uvLayers: new Map([[uvLayerId, { id: uvLayerId, name: 'UVMap' }]]),
    defaultUvLayerId: uvLayerId,
    materialSlotCount: 1,
    topologyVersion: 0,
    geometryVersion: 0,
    dirty: emptyDirtyFlags(true),
    triangulationHints: new Map(),
  };
}

export function bumpTopology(mesh: EditableMesh): void {
  mesh.topologyVersion += 1;
  mesh.geometryVersion += 1;
  mesh.dirty.topology = true;
  mesh.dirty.positions = true;
  mesh.dirty.normals = true;
  mesh.dirty.uvs = true;
  mesh.dirty.materials = true;
  mesh.dirty.bounds = true;
  mesh.dirty.triangulation = true;
  mesh.dirty.bvh = true;
}

export function bumpPositions(mesh: EditableMesh): void {
  mesh.geometryVersion += 1;
  mesh.dirty.positions = true;
  mesh.dirty.normals = true;
  mesh.dirty.bounds = true;
  mesh.dirty.bvh = true;
}

export function markClean(mesh: EditableMesh): void {
  mesh.dirty = emptyDirtyFlags(false);
}

export function addVertex(mesh: EditableMesh, position: Vec3): VertexId {
  const id = createId('v');
  const vertex: Vertex = {
    id,
    position: cloneVec3(position),
    outgoingHalfEdgeId: null,
    flags: 0,
  };
  mesh.vertices.set(id, vertex);
  bumpTopology(mesh);
  return id;
}

export function setVertexPosition(mesh: EditableMesh, id: VertexId, position: Vec3): void {
  const vertex = mesh.vertices.get(id);
  if (!vertex) throw new Error(`Vertex ${id} not found`);
  vertex.position = cloneVec3(position);
  bumpPositions(mesh);
}

/** Undirected edge key for lookup maps. */
export function edgeKey(a: VertexId, b: VertexId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function buildEdgeLookup(mesh: EditableMesh): Map<string, EdgeId> {
  const map = new Map<string, EdgeId>();
  for (const edge of mesh.edges.values()) {
    const heA = mesh.halfEdges.get(edge.halfEdgeAId);
    if (!heA) continue;
    const heB = edge.halfEdgeBId ? mesh.halfEdges.get(edge.halfEdgeBId) : null;
    const a = heA.originVertexId;
    const b = heB ? heB.originVertexId : mesh.halfEdges.get(heA.nextHalfEdgeId)?.originVertexId;
    if (!b) continue;
    map.set(edgeKey(a, b), edge.id);
  }
  return map;
}

export function getEdgeVertices(mesh: EditableMesh, edgeId: EdgeId): [VertexId, VertexId] | null {
  const edge = mesh.edges.get(edgeId);
  if (!edge) return null;
  const heA = mesh.halfEdges.get(edge.halfEdgeAId);
  if (!heA) return null;
  const next = mesh.halfEdges.get(heA.nextHalfEdgeId);
  if (!next) return null;
  return [heA.originVertexId, next.originVertexId];
}

export function faceVertexIds(mesh: EditableMesh, faceId: FaceId): VertexId[] {
  const face = mesh.faces.get(faceId);
  if (!face) return [];
  const ids: VertexId[] = [];
  let heId = face.firstHalfEdgeId;
  const start = heId;
  do {
    const he = mesh.halfEdges.get(heId);
    if (!he) break;
    ids.push(he.originVertexId);
    heId = he.nextHalfEdgeId;
  } while (heId !== start);
  return ids;
}

export function faceHalfEdgeIds(mesh: EditableMesh, faceId: FaceId): HalfEdgeId[] {
  const face = mesh.faces.get(faceId);
  if (!face) return [];
  const ids: HalfEdgeId[] = [];
  let heId = face.firstHalfEdgeId;
  const start = heId;
  do {
    const he = mesh.halfEdges.get(heId);
    if (!he) break;
    ids.push(he.id);
    heId = he.nextHalfEdgeId;
  } while (heId !== start);
  return ids;
}

export function faceCornerIds(mesh: EditableMesh, faceId: FaceId): FaceCornerId[] {
  return faceHalfEdgeIds(mesh, faceId)
    .map((heId) => mesh.halfEdges.get(heId)?.faceCornerId)
    .filter((id): id is FaceCornerId => id != null);
}

export function isBoundaryEdge(mesh: EditableMesh, edgeId: EdgeId): boolean {
  const edge = mesh.edges.get(edgeId);
  return !!edge && edge.halfEdgeBId == null;
}

export function isBoundaryHalfEdge(mesh: EditableMesh, heId: HalfEdgeId): boolean {
  const he = mesh.halfEdges.get(heId);
  return !!he && he.twinHalfEdgeId == null;
}

/** Remove one logical face while preserving any adjacent boundary topology. */
export function removeFace(mesh: EditableMesh, faceId: FaceId): TopologyChangeResult {
  const result = emptyTopologyChangeResult();
  const face = mesh.faces.get(faceId);
  if (!face) return result;
  const heIds = faceHalfEdgeIds(mesh, faceId);
  mesh.triangulationHints.delete(faceId);
  for (const heId of heIds) {
    const he = mesh.halfEdges.get(heId);
    if (!he) continue;
    const edge = mesh.edges.get(he.edgeId);
    if (edge) {
      if (edge.halfEdgeAId === heId && edge.halfEdgeBId) {
        const survivor = mesh.halfEdges.get(edge.halfEdgeBId)!;
        survivor.twinHalfEdgeId = null;
        edge.halfEdgeAId = survivor.id;
        edge.halfEdgeBId = null;
      } else if (edge.halfEdgeBId === heId) {
        const survivor = mesh.halfEdges.get(edge.halfEdgeAId);
        if (survivor) survivor.twinHalfEdgeId = null;
        edge.halfEdgeBId = null;
      } else {
        mesh.edges.delete(edge.id);
        result.removedEdgeIds.push(edge.id);
      }
    }
    if (he.faceCornerId) {
      mesh.faceCorners.delete(he.faceCornerId);
      result.removedFaceCornerIds.push(he.faceCornerId);
    }
    mesh.halfEdges.delete(heId);
    result.removedHalfEdgeIds.push(heId);
  }
  mesh.faces.delete(faceId);
  result.removedFaceIds.push(faceId);
  for (const vertex of mesh.vertices.values()) {
    if (vertex.outgoingHalfEdgeId && !mesh.halfEdges.has(vertex.outgoingHalfEdgeId)) {
      vertex.outgoingHalfEdgeId = [...mesh.halfEdges.values()].find((he) => he.originVertexId === vertex.id)?.id ?? null;
    }
  }
  bumpTopology(mesh);
  return result;
}

/**
 * Create a logical face from ordered vertex IDs (CCW from outside).
 * Builds shared edges, half-edges, and face corners with optional UVs.
 */
export function addFace(
  mesh: EditableMesh,
  vertexIds: VertexId[],
  options: {
    materialSlot?: number;
    uvs?: Vec2[];
    uvLayerId?: UvLayerId;
    flatShaded?: boolean;
    edgeLookup?: Map<string, EdgeId>;
  } = {},
): { faceId: FaceId; result: TopologyChangeResult } {
  if (vertexIds.length < 3) {
    throw new Error('Face requires at least 3 vertices');
  }
  for (const vid of vertexIds) {
    if (!mesh.vertices.has(vid)) throw new Error(`Vertex ${vid} not found`);
  }

  const result = emptyTopologyChangeResult();
  const edgeLookup = options.edgeLookup ?? buildEdgeLookup(mesh);
  const uvLayerId = options.uvLayerId ?? mesh.defaultUvLayerId;
  const materialSlot = options.materialSlot ?? 0;
  const flatShaded = options.flatShaded ?? true;

  const faceId = createId('f');
  const halfEdgeIds: HalfEdgeId[] = [];
  const cornerIds: FaceCornerId[] = [];

  // Create half-edges and corners first (next/prev wired after).
  for (let i = 0; i < vertexIds.length; i++) {
    const origin = vertexIds[i]!;
    const heId = createId('he');
    const cornerId = createId('fc');
    halfEdgeIds.push(heId);
    cornerIds.push(cornerId);

    const uvs = new Map<UvLayerId, Vec2>();
    if (uvLayerId && options.uvs?.[i]) {
      uvs.set(uvLayerId, cloneVec2(options.uvs[i]!));
    } else if (uvLayerId) {
      uvs.set(uvLayerId, v2(0, 0));
    }

    const corner: FaceCorner = {
      id: cornerId,
      faceId,
      vertexId: origin,
      halfEdgeId: heId,
      uvs,
      splitNormal: null,
      vertexColour: null,
      atlasTile: null,
    };
    mesh.faceCorners.set(cornerId, corner);
    result.createdFaceCornerIds.push(cornerId);

    const he: HalfEdge = {
      id: heId,
      originVertexId: origin,
      edgeId: '' as EdgeId, // set below
      faceId,
      twinHalfEdgeId: null,
      nextHalfEdgeId: heId, // temporary
      previousHalfEdgeId: heId,
      faceCornerId: cornerId,
    };
    mesh.halfEdges.set(heId, he);
    result.createdHalfEdgeIds.push(heId);

    const vertex = mesh.vertices.get(origin)!;
    if (!vertex.outgoingHalfEdgeId) {
      vertex.outgoingHalfEdgeId = heId;
    }
  }

  // Wire loop and edges / twins.
  for (let i = 0; i < halfEdgeIds.length; i++) {
    const heId = halfEdgeIds[i]!;
    const nextId = halfEdgeIds[(i + 1) % halfEdgeIds.length]!;
    const prevId = halfEdgeIds[(i - 1 + halfEdgeIds.length) % halfEdgeIds.length]!;
    const he = mesh.halfEdges.get(heId)!;
    he.nextHalfEdgeId = nextId;
    he.previousHalfEdgeId = prevId;

    const a = vertexIds[i]!;
    const b = vertexIds[(i + 1) % vertexIds.length]!;
    const key = edgeKey(a, b);
    let edgeId = edgeLookup.get(key);

    if (!edgeId) {
      edgeId = createId('e');
      const edge: Edge = {
        id: edgeId,
        halfEdgeAId: heId,
        halfEdgeBId: null,
        sharpness: 0,
        seam: false,
        crease: 0,
        flags: 0,
      };
      mesh.edges.set(edgeId, edge);
      edgeLookup.set(key, edgeId);
      result.createdEdgeIds.push(edgeId);
      he.edgeId = edgeId;
    } else {
      const edge = mesh.edges.get(edgeId)!;
      if (edge.halfEdgeBId != null) {
        throw new Error(`Non-manifold edge between ${a} and ${b}: more than two faces`);
      }
      const twin = mesh.halfEdges.get(edge.halfEdgeAId);
      if (!twin) throw new Error(`Missing half-edge for edge ${edgeId}`);
      const twinNext = mesh.halfEdges.get(twin.nextHalfEdgeId);
      if (twin.originVertexId !== b || twinNext?.originVertexId !== a) {
        throw new Error(`Inconsistent face winding on edge between ${a} and ${b}`);
      }
      edge.halfEdgeBId = heId;
      he.twinHalfEdgeId = twin.id;
      twin.twinHalfEdgeId = heId;
      he.edgeId = edgeId;
    }
  }

  const face: Face = {
    id: faceId,
    firstHalfEdgeId: halfEdgeIds[0]!,
    materialSlot,
    smoothingGroup: 0,
    flatShaded,
    hidden: false,
    flags: 0,
  };
  mesh.faces.set(faceId, face);
  result.createdFaceIds.push(faceId);
  result.recommendedSelection = { mode: 'face', faceIds: [faceId] };

  bumpTopology(mesh);
  return { faceId, result };
}

export function getMeshStats(mesh: EditableMesh): {
  verts: number;
  edges: number;
  faces: number;
  halfEdges: number;
  corners: number;
  boundaryEdges: number;
  quads: number;
  tris: number;
  ngons: number;
} {
  let boundaryEdges = 0;
  let quads = 0;
  let tris = 0;
  let ngons = 0;
  for (const edge of mesh.edges.values()) {
    if (edge.halfEdgeBId == null) boundaryEdges += 1;
  }
  for (const face of mesh.faces.values()) {
    const n = faceVertexIds(mesh, face.id).length;
    if (n === 3) tris += 1;
    else if (n === 4) quads += 1;
    else ngons += 1;
  }
  return {
    verts: mesh.vertices.size,
    edges: mesh.edges.size,
    faces: mesh.faces.size,
    halfEdges: mesh.halfEdges.size,
    corners: mesh.faceCorners.size,
    boundaryEdges,
    quads,
    tris,
    ngons,
  };
}

/** Deep clone preserving stable IDs (for undo snapshots / transactions). */
export function cloneMeshPreserveIds(mesh: EditableMesh): EditableMesh {
  const vertices = new Map<VertexId, Vertex>();
  for (const [id, v] of mesh.vertices) {
    vertices.set(id, {
      ...v,
      position: cloneVec3(v.position),
    });
  }

  const edges = new Map<EdgeId, Edge>();
  for (const [id, e] of mesh.edges) {
    edges.set(id, { ...e });
  }

  const halfEdges = new Map<HalfEdgeId, HalfEdge>();
  for (const [id, he] of mesh.halfEdges) {
    halfEdges.set(id, { ...he });
  }

  const faces = new Map<FaceId, Face>();
  for (const [id, f] of mesh.faces) {
    faces.set(id, { ...f });
  }

  const faceCorners = new Map<FaceCornerId, FaceCorner>();
  for (const [id, c] of mesh.faceCorners) {
    const uvs = new Map<UvLayerId, Vec2>();
    for (const [layerId, uv] of c.uvs) {
      uvs.set(layerId, cloneVec2(uv));
    }
    faceCorners.set(id, {
      ...c,
      uvs,
      splitNormal: c.splitNormal ? cloneVec3(c.splitNormal) : null,
      vertexColour: c.vertexColour ? cloneVec3(c.vertexColour) : null,
      atlasTile: c.atlasTile ? { ...c.atlasTile } : null,
    });
  }

  const uvLayers = new Map(mesh.uvLayers);

  return {
    id: mesh.id,
    name: mesh.name,
    vertices,
    edges,
    halfEdges,
    faces,
    faceCorners,
    uvLayers,
    defaultUvLayerId: mesh.defaultUvLayerId,
    materialSlotCount: mesh.materialSlotCount,
    topologyVersion: mesh.topologyVersion,
    geometryVersion: mesh.geometryVersion,
    dirty: { ...mesh.dirty },
    triangulationHints: new Map(mesh.triangulationHints),
  };
}

/** Replace mesh contents in-place from a snapshot (same mesh id). */
export function restoreMeshFromSnapshot(target: EditableMesh, snapshot: EditableMesh): void {
  const clone = cloneMeshPreserveIds(snapshot);
  target.name = clone.name;
  target.vertices = clone.vertices;
  target.edges = clone.edges;
  target.halfEdges = clone.halfEdges;
  target.faces = clone.faces;
  target.faceCorners = clone.faceCorners;
  target.uvLayers = clone.uvLayers;
  target.defaultUvLayerId = clone.defaultUvLayerId;
  target.materialSlotCount = clone.materialSlotCount;
  target.topologyVersion = clone.topologyVersion + 1;
  target.geometryVersion = clone.geometryVersion + 1;
  target.dirty = emptyDirtyFlags(true);
  target.triangulationHints = new Map(clone.triangulationHints);
}

/** Merge a topology change returned by a lower-level operation. */
export function mergeTopologyChange(target: TopologyChangeResult, source: TopologyChangeResult): void {
  target.createdVertexIds.push(...source.createdVertexIds);
  target.removedVertexIds.push(...source.removedVertexIds);
  target.createdEdgeIds.push(...source.createdEdgeIds);
  target.removedEdgeIds.push(...source.removedEdgeIds);
  target.createdFaceIds.push(...source.createdFaceIds);
  target.removedFaceIds.push(...source.removedFaceIds);
  target.createdHalfEdgeIds.push(...source.createdHalfEdgeIds);
  target.removedHalfEdgeIds.push(...source.removedHalfEdgeIds);
  target.createdFaceCornerIds.push(...source.createdFaceCornerIds);
  target.removedFaceCornerIds.push(...source.removedFaceCornerIds);
  for (const [from, to] of source.replacedIds) target.replacedIds.set(from, to);
  target.warnings.push(...source.warnings);
}
