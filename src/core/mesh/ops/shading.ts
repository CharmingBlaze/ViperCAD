import {
  bumpTopology,
  faceHalfEdgeIds,
  faceVertexIds,
} from '@/core/mesh/EditableMesh';
import type {
  EditableMesh,
  EdgeId,
  FaceId,
  TopologyChangeResult,
  VertexId,
} from '@/core/mesh/types';
import { emptyTopologyChangeResult } from '@/core/mesh/types';
import type { GeometryOpResult } from './types';

export type FaceShadingMode = 'smooth' | 'flat';

/** Set flat/smooth shading on faces. Returns an empty topology change (metadata only). */
export function setFacesShading(
  mesh: EditableMesh,
  faceIds: FaceId[],
  mode: FaceShadingMode,
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const unique = [...new Set(faceIds)].filter((id) => mesh.faces.has(id));
  if (unique.length === 0) {
    return {
      ok: false,
      change,
      warnings: [],
      error: {
        code: 'EMPTY_SELECTION',
        message: 'Select faces to set shading',
        affectedElementIds: [],
        recoverable: true,
      },
    };
  }
  const flat = mode === 'flat';
  for (const id of unique) {
    mesh.faces.get(id)!.flatShaded = flat;
  }
  bumpTopology(mesh);
  change.recommendedSelection = { mode: 'face', faceIds: unique };
  return { ok: true, value: change, change, warnings: [] };
}

/** Mark or clear sharp edges (`sharpness` > 0 hardens corner normals). */
export function setEdgeSharpness(
  mesh: EditableMesh,
  edgeIds: EdgeId[],
  sharpness: number,
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const unique = [...new Set(edgeIds)].filter((id) => mesh.edges.has(id));
  if (unique.length === 0) {
    return {
      ok: false,
      change,
      warnings: [],
      error: {
        code: 'EMPTY_SELECTION',
        message: 'Select edges to set sharpness',
        affectedElementIds: [],
        recoverable: true,
      },
    };
  }
  const value = Math.max(0, sharpness);
  for (const id of unique) {
    mesh.edges.get(id)!.sharpness = value;
  }
  bumpTopology(mesh);
  change.recommendedSelection = { mode: 'edge', edgeIds: unique };
  return { ok: true, value: change, change, warnings: [] };
}

export type ShadingSelection = {
  mode: 'object' | 'vertex' | 'edge' | 'face';
  selectedFaceIds: Iterable<FaceId>;
  selectedEdgeIds: Iterable<EdgeId>;
  selectedVertexIds: Iterable<VertexId>;
};

/** Resolve faces for shade smooth/flat from the current selection mode. */
export function resolveShadingFaceIds(
  mesh: EditableMesh,
  selection: ShadingSelection,
): FaceId[] {
  if (selection.mode === 'face') {
    const faces = [...selection.selectedFaceIds].filter((id) => mesh.faces.has(id));
    if (faces.length > 0) return faces;
  }
  if (selection.mode === 'edge') {
    const faces = new Set<FaceId>();
    for (const edgeId of selection.selectedEdgeIds) {
      const edge = mesh.edges.get(edgeId);
      if (!edge) continue;
      for (const heId of [edge.halfEdgeAId, edge.halfEdgeBId]) {
        if (!heId) continue;
        const faceId = mesh.halfEdges.get(heId)?.faceId;
        if (faceId) faces.add(faceId);
      }
    }
    if (faces.size > 0) return [...faces];
  }
  if (selection.mode === 'vertex') {
    const verts = new Set(
      [...selection.selectedVertexIds].filter((id) => mesh.vertices.has(id)),
    );
    if (verts.size > 0) {
      return [...mesh.faces.values()]
        .filter((face) => faceVertexIds(mesh, face.id).some((id) => verts.has(id)))
        .map((face) => face.id);
    }
  }
  return [...mesh.faces.keys()];
}

/** Resolve edges for mark/clear sharp from the current selection mode. */
export function resolveSharpEdgeIds(
  mesh: EditableMesh,
  selection: ShadingSelection,
): EdgeId[] {
  if (selection.mode === 'edge') {
    const edges = [...selection.selectedEdgeIds].filter((id) => mesh.edges.has(id));
    if (edges.length > 0) return edges;
  }
  if (selection.mode === 'face') {
    const edges = new Set<EdgeId>();
    for (const faceId of selection.selectedFaceIds) {
      if (!mesh.faces.has(faceId)) continue;
      for (const heId of faceHalfEdgeIds(mesh, faceId)) {
        const edgeId = mesh.halfEdges.get(heId)?.edgeId;
        if (edgeId) edges.add(edgeId);
      }
    }
    if (edges.size > 0) return [...edges];
  }
  if (selection.mode === 'vertex') {
    const verts = new Set(
      [...selection.selectedVertexIds].filter((id) => mesh.vertices.has(id)),
    );
    if (verts.size > 0) {
      const edges: EdgeId[] = [];
      for (const edge of mesh.edges.values()) {
        const he = mesh.halfEdges.get(edge.halfEdgeAId);
        const next = he ? mesh.halfEdges.get(he.nextHalfEdgeId) : null;
        if (!he || !next) continue;
        if (verts.has(he.originVertexId) || verts.has(next.originVertexId)) {
          edges.push(edge.id);
        }
      }
      if (edges.length > 0) return edges;
    }
  }
  return [...mesh.edges.keys()];
}

/** Faces to subdivide/poke: selection, or whole mesh when empty / object mode. */
export function resolveEditFaceIds(
  mesh: EditableMesh,
  selection: ShadingSelection,
): FaceId[] {
  if (selection.mode === 'face') {
    const faces = [...selection.selectedFaceIds].filter((id) => mesh.faces.has(id));
    if (faces.length > 0) return faces;
  }
  if (selection.mode === 'edge') {
    const faces = new Set<FaceId>();
    for (const edgeId of selection.selectedEdgeIds) {
      const edge = mesh.edges.get(edgeId);
      if (!edge) continue;
      for (const heId of [edge.halfEdgeAId, edge.halfEdgeBId]) {
        if (!heId) continue;
        const faceId = mesh.halfEdges.get(heId)?.faceId;
        if (faceId) faces.add(faceId);
      }
    }
    if (faces.size > 0) return [...faces];
  }
  if (selection.mode === 'vertex') {
    const verts = new Set(
      [...selection.selectedVertexIds].filter((id) => mesh.vertices.has(id)),
    );
    if (verts.size > 0) {
      return [...mesh.faces.values()]
        .filter((face) => faceVertexIds(mesh, face.id).some((id) => verts.has(id)))
        .map((face) => face.id);
    }
  }
  return [...mesh.faces.keys()];
}
