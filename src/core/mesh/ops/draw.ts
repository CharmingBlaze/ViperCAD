import { commitMeshObject } from '@/core/document/ModelDocument';
import type { ModelDocument, ObjectId } from '@/core/document/types';
import { type Vec3 } from '@/core/math/Vec3';
import {
  addFace,
  addVertex,
  bumpTopology,
  createEmptyMesh,
  getEdgeVertices,
  isBoundaryEdge,
  mergeTopologyChange,
  removeFace,
} from '@/core/mesh/EditableMesh';
import {
  emptyTopologyChangeResult,
  type EditableMesh,
  type EdgeId,
  type FaceId,
  type MeshId,
  type TopologyChangeResult,
  type VertexId,
} from '@/core/mesh/types';
import type { SelectionManager } from '@/core/selection/SelectionManager';
import type { GeometryOpResult } from './types';

export type DrawMeshTarget = {
  objectId: ObjectId;
  meshId: MeshId;
  mesh: EditableMesh;
  created: boolean;
};

/** Active mesh object, or create an empty Draw mesh + scene object. */
export function ensureDrawMesh(doc: ModelDocument, selection: SelectionManager): DrawMeshTarget {
  const activeId =
    selection.state.activeObjectId ?? [...selection.state.selectedObjectIds][0] ?? null;
  if (activeId) {
    const object = doc.objects.get(activeId);
    if (object?.meshId) {
      const mesh = doc.meshes.get(object.meshId);
      if (mesh) {
        return { objectId: activeId, meshId: object.meshId, mesh, created: false };
      }
    }
  }

  const mesh = createEmptyMesh('Draw');
  const { objectId, meshId } = commitMeshObject(doc, mesh, { name: 'Draw' });
  selection.selectObjects([objectId], 'replace');
  return { objectId, meshId, mesh, created: true };
}

export function addVertexAt(mesh: EditableMesh, position: Vec3): VertexId {
  return addVertex(mesh, position);
}

export type MakeFaceMode = 'single' | 'double';

export function makeFaceFromVertices(
  mesh: EditableMesh,
  vertexIds: VertexId[],
  options: { mode?: MakeFaceMode } = {},
): GeometryOpResult<{ faceId: FaceId; faceIds: FaceId[] } & TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const mode = options.mode ?? 'single';
  const unique = [...new Set(vertexIds)];
  if (unique.length < 3) {
    return failure(change, 'INSUFFICIENT_VERTICES', 'Face requires at least 3 vertices', unique);
  }
  for (const id of unique) {
    if (!mesh.vertices.has(id)) {
      return failure(change, 'MISSING_VERTEX', `Vertex ${id} not found`, [id]);
    }
  }
  if (unique.length !== vertexIds.length) {
    return failure(change, 'DUPLICATE_VERTICES', 'Face vertices must be unique', vertexIds);
  }

  try {
    // Prefer the given order; if shared edges reject the winding, try reversed
    // so completing a face from existing ("old") verts just works.
    const oriented = addFaceOriented(mesh, vertexIds);
    mergeTopologyChange(change, oriented.result);
    const faceIds: FaceId[] = [oriented.faceId];
    const usedOrder = oriented.order;

    if (mode === 'double') {
      // Opposite winding fills the twin half-edge slots → visible from both sides.
      const back = addFace(mesh, [...usedOrder].reverse());
      mergeTopologyChange(change, back.result);
      faceIds.push(back.faceId);
    }

    change.recommendedSelection = { mode: 'face', faceIds };
    return {
      ok: true,
      value: { faceId: oriented.faceId, faceIds, ...change },
      change,
      warnings: [],
    };
  } catch (err) {
    return failure(
      change,
      'ADD_FACE_FAILED',
      err instanceof Error ? err.message : String(err),
      vertexIds,
    );
  }
}

function addFaceOriented(
  mesh: EditableMesh,
  vertexIds: VertexId[],
): { faceId: FaceId; result: TopologyChangeResult; order: VertexId[] } {
  try {
    const added = addFace(mesh, vertexIds);
    return { faceId: added.faceId, result: added.result, order: vertexIds };
  } catch {
    const reversed = [...vertexIds].reverse();
    const added = addFace(mesh, reversed);
    return { faceId: added.faceId, result: added.result, order: reversed };
  }
}

/**
 * If selected edges form one ordered boundary loop, fill it with a face.
 */
export function fillBoundaryLoop(
  mesh: EditableMesh,
  edgeIds: EdgeId[],
): GeometryOpResult<{ faceId: FaceId } & TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const unique = [...new Set(edgeIds)].filter((id) => mesh.edges.has(id));
  if (unique.length < 3) {
    return failure(change, 'INSUFFICIENT_EDGES', 'Need at least 3 boundary edges', unique);
  }
  for (const id of unique) {
    if (!isBoundaryEdge(mesh, id)) {
      return failure(change, 'NOT_BOUNDARY', `Edge ${id} is not a boundary edge`, [id]);
    }
  }

  const loop = orderBoundaryLoop(mesh, unique);
  if (!loop) {
    return failure(
      change,
      'INVALID_LOOP',
      'Selection must form a single closed boundary loop',
      unique,
    );
  }

  return makeFaceFromVertices(mesh, loop);
}

/**
 * Fill boundary hole(s). Partial edge selections are expanded to their full
 * closed boundary loop(s). With no seeds, every boundary loop is filled.
 */
export function fillHoles(
  mesh: EditableMesh,
  edgeIds?: EdgeId[],
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const seeds = edgeIds?.length
    ? [...new Set(edgeIds)].filter((id) => mesh.edges.has(id))
    : [...mesh.edges.keys()].filter((id) => isBoundaryEdge(mesh, id));

  if (!seeds.length) {
    return failure(change, 'EMPTY_SELECTION', 'No boundary edges to fill', []);
  }

  for (const id of seeds) {
    if (!isBoundaryEdge(mesh, id)) {
      return failure(change, 'NOT_BOUNDARY', `Edge ${id} is not a boundary edge`, [id]);
    }
  }

  const filledKeys = new Set<string>();
  const faceIds: FaceId[] = [];

  for (const seed of seeds) {
    // Skip seeds already consumed by a prior fill in this call.
    if (!mesh.edges.has(seed) || !isBoundaryEdge(mesh, seed)) continue;

    const loopEdges = completeBoundaryLoopEdges(mesh, seed);
    if (!loopEdges || loopEdges.length < 3) {
      return failure(
        change,
        'INVALID_LOOP',
        'Could not complete a closed boundary loop from the selection',
        [seed],
      );
    }

    const key = [...loopEdges].sort().join('|');
    if (filledKeys.has(key)) continue;
    filledKeys.add(key);

    const filled = fillBoundaryLoop(mesh, loopEdges);
    if (!filled.ok) return filled;
    mergeTopologyChange(change, filled.change);
    if (filled.value?.faceId) faceIds.push(filled.value.faceId);
  }

  if (!faceIds.length) {
    return failure(change, 'EMPTY_SELECTION', 'No holes were filled', seeds);
  }

  change.recommendedSelection = { mode: 'face', faceIds };
  return { ok: true, value: change, change, warnings: change.warnings };
}

/** Expand a seed boundary edge to every edge in its closed hole loop. */
export function completeBoundaryLoopEdges(
  mesh: EditableMesh,
  seedEdgeId: EdgeId,
): EdgeId[] | null {
  if (!isBoundaryEdge(mesh, seedEdgeId)) return null;

  const adj = new Map<VertexId, EdgeId[]>();
  for (const edgeId of mesh.edges.keys()) {
    if (!isBoundaryEdge(mesh, edgeId)) continue;
    const pair = getEdgeVertices(mesh, edgeId);
    if (!pair) continue;
    for (const v of pair) {
      const list = adj.get(v) ?? [];
      list.push(edgeId);
      adj.set(v, list);
    }
  }

  const start = getEdgeVertices(mesh, seedEdgeId);
  if (!start) return null;

  const edges: EdgeId[] = [seedEdgeId];
  const used = new Set<EdgeId>([seedEdgeId]);
  let prev = start[0];
  let curr = start[1];

  while (curr !== start[0]) {
    const links = (adj.get(curr) ?? []).filter((e) => !used.has(e));
    if (!links.length) return null;
    const nextEdge =
      links.find((e) => {
        const pair = getEdgeVertices(mesh, e);
        if (!pair) return false;
        const other = pair[0] === curr ? pair[1] : pair[0];
        return other !== prev;
      }) ?? links[0]!;
    used.add(nextEdge);
    edges.push(nextEdge);
    const pair = getEdgeVertices(mesh, nextEdge);
    if (!pair) return null;
    const nextVert = pair[0] === curr ? pair[1] : pair[0];
    prev = curr;
    curr = nextVert;
    if (edges.length > mesh.edges.size) return null;
  }

  return edges.length >= 3 ? edges : null;
}

/** Delete mesh elements implied by the current component selection. */
export function deleteMeshSelection(
  mesh: EditableMesh,
  selection: SelectionManager,
): GeometryOpResult<TopologyChangeResult> {
  const mode = selection.state.mode;
  if (mode === 'face') {
    return deleteFaces(mesh, [...selection.state.selectedFaceIds]);
  }
  if (mode === 'edge') {
    return deleteEdges(mesh, [...selection.state.selectedEdgeIds]);
  }
  if (mode === 'vertex') {
    return deleteVertices(mesh, [...selection.state.selectedVertexIds]);
  }
  return failure(emptyTopologyChangeResult(), 'WRONG_MODE', 'No mesh components selected', []);
}

export function deleteFaces(
  mesh: EditableMesh,
  faceIds: FaceId[],
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const ids = [...new Set(faceIds)].filter((id) => mesh.faces.has(id));
  if (!ids.length) {
    return failure(change, 'EMPTY_SELECTION', 'No faces to delete', []);
  }
  const touchedVerts = new Set<VertexId>();
  for (const faceId of ids) {
    for (const he of mesh.halfEdges.values()) {
      if (he.faceId === faceId) touchedVerts.add(he.originVertexId);
    }
    mergeTopologyChange(change, removeFace(mesh, faceId));
  }
  pruneOrphanVertices(mesh, change, touchedVerts);
  bumpTopology(mesh);
  return { ok: true, value: change, change, warnings: [] };
}

export function deleteEdges(
  mesh: EditableMesh,
  edgeIds: EdgeId[],
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const ids = [...new Set(edgeIds)].filter((id) => mesh.edges.has(id));
  if (!ids.length) {
    return failure(change, 'EMPTY_SELECTION', 'No edges to delete', []);
  }
  const faceIds = new Set<FaceId>();
  const touchedVerts = new Set<VertexId>();
  for (const edgeId of ids) {
    const edge = mesh.edges.get(edgeId);
    if (!edge) continue;
    const pair = getEdgeVertices(mesh, edgeId);
    if (pair) {
      touchedVerts.add(pair[0]);
      touchedVerts.add(pair[1]);
    }
    for (const heId of [edge.halfEdgeAId, edge.halfEdgeBId]) {
      if (!heId) continue;
      const faceId = mesh.halfEdges.get(heId)?.faceId;
      if (faceId) faceIds.add(faceId);
    }
  }
  for (const faceId of faceIds) {
    mergeTopologyChange(change, removeFace(mesh, faceId));
  }
  pruneOrphanVertices(mesh, change, touchedVerts);
  bumpTopology(mesh);
  return { ok: true, value: change, change, warnings: [] };
}

export function deleteVertices(
  mesh: EditableMesh,
  vertexIds: VertexId[],
): GeometryOpResult<TopologyChangeResult> {
  const change = emptyTopologyChangeResult();
  const ids = [...new Set(vertexIds)].filter((id) => mesh.vertices.has(id));
  if (!ids.length) {
    return failure(change, 'EMPTY_SELECTION', 'No vertices to delete', []);
  }
  const target = new Set(ids);
  const faceIds = new Set<FaceId>();
  for (const face of mesh.faces.values()) {
    let heId = face.firstHalfEdgeId;
    const start = heId;
    do {
      const he = mesh.halfEdges.get(heId);
      if (!he) break;
      if (target.has(he.originVertexId)) faceIds.add(face.id);
      heId = he.nextHalfEdgeId;
    } while (heId !== start);
  }
  for (const faceId of faceIds) {
    mergeTopologyChange(change, removeFace(mesh, faceId));
  }
  for (const id of ids) {
    if (!mesh.vertices.has(id)) continue;
    const stillUsed = [...mesh.halfEdges.values()].some((he) => he.originVertexId === id);
    if (!stillUsed) {
      mesh.vertices.delete(id);
      change.removedVertexIds.push(id);
    }
  }
  bumpTopology(mesh);
  return { ok: true, value: change, change, warnings: [] };
}

export function hasDeletableSelection(doc: ModelDocument, selection: SelectionManager): boolean {
  const mode = selection.state.mode;
  if (mode === 'object') return selection.state.selectedObjectIds.size > 0;
  const objectId = selection.state.activeObjectId ?? [...selection.state.selectedObjectIds][0];
  if (!objectId) return false;
  const meshId = doc.objects.get(objectId)?.meshId;
  if (!meshId || !doc.meshes.has(meshId)) return false;
  if (mode === 'face') return selection.state.selectedFaceIds.size > 0;
  if (mode === 'edge') return selection.state.selectedEdgeIds.size > 0;
  if (mode === 'vertex') return selection.state.selectedVertexIds.size > 0;
  return false;
}

/** Walk selected boundary edges into a closed vertex loop, wound to fill the hole. */
function orderBoundaryLoop(mesh: EditableMesh, edgeIds: EdgeId[]): VertexId[] | null {
  const adj = new Map<VertexId, { other: VertexId; edgeId: EdgeId }[]>();
  for (const edgeId of edgeIds) {
    const pair = getEdgeVertices(mesh, edgeId);
    if (!pair) return null;
    const [a, b] = pair;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push({ other: b, edgeId });
    adj.get(b)!.push({ other: a, edgeId });
  }
  for (const links of adj.values()) {
    if (links.length !== 2) return null;
  }

  const startEdge = edgeIds[0]!;
  const startPair = getEdgeVertices(mesh, startEdge);
  if (!startPair) return null;

  const verts: VertexId[] = [startPair[0]];
  const used = new Set<EdgeId>([startEdge]);
  let prev = startPair[0];
  let curr = startPair[1];

  while (curr !== startPair[0]) {
    verts.push(curr);
    const links = adj.get(curr);
    if (!links) return null;
    const nextLink = links.find((l) => l.other !== prev && !used.has(l.edgeId));
    if (!nextLink) return null;
    used.add(nextLink.edgeId);
    prev = curr;
    curr = nextLink.other;
    if (verts.length > edgeIds.length + 1) return null;
  }

  if (used.size !== edgeIds.length || verts.length !== edgeIds.length) return null;

  // Existing boundary half-edge runs from→to; new face must run to→from on that edge.
  const existing = getEdgeVertices(mesh, startEdge);
  if (!existing) return verts;
  const [from, to] = existing;
  const i = verts.indexOf(to);
  if (i < 0) return verts;
  const next = verts[(i + 1) % verts.length];
  if (next !== from) verts.reverse();
  return verts;
}

function pruneOrphanVertices(
  mesh: EditableMesh,
  change: TopologyChangeResult,
  candidates: Set<VertexId>,
): void {
  for (const id of candidates) {
    if (!mesh.vertices.has(id)) continue;
    const stillUsed = [...mesh.halfEdges.values()].some((he) => he.originVertexId === id);
    if (!stillUsed) {
      mesh.vertices.delete(id);
      change.removedVertexIds.push(id);
    }
  }
}

function failure(
  change: TopologyChangeResult,
  code: string,
  message: string,
  ids: string[],
): GeometryOpResult<never> {
  return {
    ok: false,
    change,
    warnings: [],
    error: { code, message, affectedElementIds: ids, recoverable: true },
  };
}
