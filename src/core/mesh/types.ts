import type { ElementId } from '@/core/ids/IdService';
import type { Vec2 } from '@/core/math/Vec2';
import type { Vec3 } from '@/core/math/Vec3';

export type VertexId = ElementId;
export type EdgeId = ElementId;
export type HalfEdgeId = ElementId;
export type FaceId = ElementId;
export type FaceCornerId = ElementId;
export type MeshId = ElementId;
export type UvLayerId = ElementId;

/** Logical vertex in mesh-local space. */
export type Vertex = {
  id: VertexId;
  position: Vec3;
  outgoingHalfEdgeId: HalfEdgeId | null;
  flags: number;
};

/** Undirected logical edge shared by adjacent faces. */
export type Edge = {
  id: EdgeId;
  halfEdgeAId: HalfEdgeId;
  halfEdgeBId: HalfEdgeId | null; // null = boundary
  sharpness: number;
  seam: boolean;
  crease: number;
  flags: number;
};

/** Directed half-edge for adjacency and face loops. */
export type HalfEdge = {
  id: HalfEdgeId;
  originVertexId: VertexId;
  edgeId: EdgeId;
  faceId: FaceId | null; // null for unpaired boundary helper (unused currently)
  twinHalfEdgeId: HalfEdgeId | null;
  nextHalfEdgeId: HalfEdgeId;
  previousHalfEdgeId: HalfEdgeId;
  faceCornerId: FaceCornerId | null;
};

/** Logical face: triangle, quad, or n-gon. */
export type Face = {
  id: FaceId;
  firstHalfEdgeId: HalfEdgeId;
  materialSlot: number;
  smoothingGroup: number;
  flatShaded: boolean;
  hidden: boolean;
  flags: number;
};

/** Atlas tile rect used by the renderer to wrap expanded UVs (tile repeat). */
export type AtlasTileRect = {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
};

/** Per-corner attributes (UVs, split normals, colours). */
export type FaceCorner = {
  id: FaceCornerId;
  faceId: FaceId;
  vertexId: VertexId;
  halfEdgeId: HalfEdgeId;
  /** UV coordinates keyed by UV layer id. */
  uvs: Map<UvLayerId, Vec2>;
  splitNormal: Vec3 | null;
  vertexColour: Vec3 | null;
  /** When set, renderer wraps UVs into this atlas rect (safe tile repeat). */
  atlasTile?: AtlasTileRect | null;
};

export type UvLayer = {
  id: UvLayerId;
  name: string;
};

export type MeshDirtyFlags = {
  topology: boolean;
  positions: boolean;
  normals: boolean;
  uvs: boolean;
  materials: boolean;
  bounds: boolean;
  triangulation: boolean;
  bvh: boolean;
};

export type EditableMesh = {
  id: MeshId;
  name: string;
  vertices: Map<VertexId, Vertex>;
  edges: Map<EdgeId, Edge>;
  halfEdges: Map<HalfEdgeId, HalfEdge>;
  faces: Map<FaceId, Face>;
  faceCorners: Map<FaceCornerId, FaceCorner>;
  uvLayers: Map<UvLayerId, UvLayer>;
  defaultUvLayerId: UvLayerId | null;
  materialSlotCount: number;
  /** Increments on topology mutations. */
  topologyVersion: number;
  /** Increments on any geometry-affecting mutation. */
  geometryVersion: number;
  dirty: MeshDirtyFlags;
  /** Optional stable render triangulation preference for logical quads. */
  triangulationHints: Map<FaceId, '0-2' | '1-3'>;
};

export type TopologyChangeResult = {
  createdVertexIds: VertexId[];
  removedVertexIds: VertexId[];
  createdEdgeIds: EdgeId[];
  removedEdgeIds: EdgeId[];
  createdFaceIds: FaceId[];
  removedFaceIds: FaceId[];
  createdHalfEdgeIds: HalfEdgeId[];
  removedHalfEdgeIds: HalfEdgeId[];
  createdFaceCornerIds: FaceCornerId[];
  removedFaceCornerIds: FaceCornerId[];
  replacedIds: Map<ElementId, ElementId>;
  recommendedSelection: {
    mode?: 'vertex' | 'edge' | 'face';
    vertexIds?: VertexId[];
    edgeIds?: EdgeId[];
    faceIds?: FaceId[];
  };
  warnings: string[];
};

export function emptyTopologyChangeResult(): TopologyChangeResult {
  return {
    createdVertexIds: [],
    removedVertexIds: [],
    createdEdgeIds: [],
    removedEdgeIds: [],
    createdFaceIds: [],
    removedFaceIds: [],
    createdHalfEdgeIds: [],
    removedHalfEdgeIds: [],
    createdFaceCornerIds: [],
    removedFaceCornerIds: [],
    replacedIds: new Map(),
    recommendedSelection: {},
    warnings: [],
  };
}

export function emptyDirtyFlags(all = true): MeshDirtyFlags {
  return {
    topology: all,
    positions: all,
    normals: all,
    uvs: all,
    materials: all,
    bounds: all,
    triangulation: all,
    bvh: all,
  };
}
