import { runMeshTransaction } from '@/core/history/Transaction';
import type { EditorSession } from '@/core/editor/EditorSession';
import {
  faceVertexIds,
  getEdgeVertices,
  isBoundaryEdge,
} from '@/core/mesh/EditableMesh';
import { mergeVertices } from '@/core/mesh/ops/basic';
import {
  completeBoundaryLoopEdges,
  fillBoundaryLoop,
  fillHoles,
  makeFaceFromVertices,
} from '@/core/mesh/ops/draw';
import type { GeometryOpResult } from '@/core/mesh/ops/types';
import {
  resolveEditFaceIds,
  resolveShadingFaceIds,
  resolveSharpEdgeIds,
  setEdgeSharpness,
  setFacesShading,
} from '@/core/mesh/ops/shading';
import { pokeFaces, subdivideFaces } from '@/core/mesh/ops/subdivide';
import {
  expandSymmetryEdgeIds,
  expandSymmetryFaceIds,
  expandSymmetryVertexIds,
} from '@/core/symmetry/Symmetry';
import type { EditableMesh, EdgeId, TopologyChangeResult, VertexId } from '@/core/mesh/types';
import { emptyTopologyChangeResult } from '@/core/mesh/types';

function activeMesh(session: EditorSession) {
  let objectId = session.selection.state.activeObjectId;
  if (!objectId && session.selection.state.selectedObjectIds.size > 0) {
    objectId = [...session.selection.state.selectedObjectIds][0] ?? null;
  }
  const object = objectId ? session.document.objects.get(objectId) : null;
  const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
  return mesh ?? null;
}

function selectionInput(session: EditorSession) {
  const sel = session.selection.state;
  return {
    mode: sel.mode,
    selectedFaceIds: sel.selectedFaceIds,
    selectedEdgeIds: sel.selectedEdgeIds,
    selectedVertexIds: sel.selectedVertexIds,
  };
}

export function applyShadeHotkey(
  session: EditorSession,
  mode: 'smooth' | 'flat',
): boolean {
  const mesh = activeMesh(session);
  if (!mesh) return false;
  const faces = [...expandSymmetryFaceIds(
    mesh,
    resolveShadingFaceIds(mesh, selectionInput(session)),
    session.document.settings.symmetry,
  )];
  const tx = runMeshTransaction(
    session.history,
    mesh,
    mode === 'smooth' ? 'Shade Smooth' : 'Shade Flat',
    (editable) => {
      const result = setFacesShading(editable, faces, mode);
      if (!result.ok) throw new Error(result.error?.message ?? 'Shading failed');
    },
    { fullValidation: false, selection: session.selection },
  );
  if (tx.ok) session.requestRedraw();
  return tx.ok;
}

export function applySharpHotkey(
  session: EditorSession,
  sharpness: number,
): boolean {
  const mesh = activeMesh(session);
  if (!mesh) return false;
  const edges = [...expandSymmetryEdgeIds(
    mesh,
    resolveSharpEdgeIds(mesh, selectionInput(session)),
    session.document.settings.symmetry,
  )];
  const tx = runMeshTransaction(
    session.history,
    mesh,
    sharpness > 0 ? 'Mark Sharp' : 'Clear Sharp',
    (editable) => {
      const result = setEdgeSharpness(editable, edges, sharpness);
      if (!result.ok) throw new Error(result.error?.message ?? 'Sharpness failed');
    },
    { fullValidation: false, selection: session.selection },
  );
  if (tx.ok) session.requestRedraw();
  return tx.ok;
}

export function applySubdivideHotkey(session: EditorSession, cuts = 1): boolean {
  const mesh = activeMesh(session);
  if (!mesh) return false;
  const faces = [...expandSymmetryFaceIds(
    mesh,
    resolveEditFaceIds(mesh, selectionInput(session)),
    session.document.settings.symmetry,
  )];
  const tx = runMeshTransaction(
    session.history,
    mesh,
    'Subdivide',
    (editable) => {
      const result = subdivideFaces(editable, faces, cuts);
      if (!result.ok) throw new Error(result.error?.message ?? 'Subdivide failed');
      session.selection.applyTopologyChange(result.change);
    },
    { fullValidation: true, selection: session.selection },
  );
  if (tx.ok) session.requestRedraw();
  return tx.ok;
}

function mergeVertexIds(session: EditorSession, mesh: EditableMesh): VertexId[] {
  const sel = selectionInput(session);
  const symmetry = session.document.settings.symmetry;
  if (sel.mode === 'vertex') {
    return [...expandSymmetryVertexIds(mesh, sel.selectedVertexIds, symmetry)];
  }
  if (sel.mode === 'edge') {
    const verts = new Set<VertexId>();
    for (const edgeId of expandSymmetryEdgeIds(mesh, sel.selectedEdgeIds, symmetry)) {
      const pair = getEdgeVertices(mesh, edgeId);
      if (!pair) continue;
      verts.add(pair[0]);
      verts.add(pair[1]);
    }
    return [...verts];
  }
  if (sel.mode === 'face') {
    const verts = new Set<VertexId>();
    for (const faceId of expandSymmetryFaceIds(mesh, sel.selectedFaceIds, symmetry)) {
      for (const id of faceVertexIds(mesh, faceId)) verts.add(id);
    }
    return [...verts];
  }
  return [];
}

function selectedBoundaryEdges(mesh: EditableMesh, vertexIds: Iterable<VertexId>): EdgeId[] {
  const selected = new Set(vertexIds);
  const edges: EdgeId[] = [];
  for (const edgeId of mesh.edges.keys()) {
    if (!isBoundaryEdge(mesh, edgeId)) continue;
    const pair = getEdgeVertices(mesh, edgeId);
    if (!pair) continue;
    if (selected.has(pair[0]) && selected.has(pair[1])) edges.push(edgeId);
  }
  return edges;
}

function vertsFromEdges(mesh: EditableMesh, edgeIds: Iterable<EdgeId>): VertexId[] {
  const verts: VertexId[] = [];
  const seen = new Set<VertexId>();
  for (const id of edgeIds) {
    const pair = getEdgeVertices(mesh, id);
    if (!pair) continue;
    for (const vertexId of pair) {
      if (seen.has(vertexId)) continue;
      seen.add(vertexId);
      verts.push(vertexId);
    }
  }
  return verts;
}

function interiorHoleSeed(mesh: EditableMesh): EdgeId | null {
  const seen = new Set<string>();
  let seed: EdgeId | null = null;
  let holes = 0;
  for (const edgeId of mesh.edges.keys()) {
    if (!isBoundaryEdge(mesh, edgeId)) continue;
    const loop = completeBoundaryLoopEdges(mesh, edgeId);
    if (!loop || loop.length < 3) continue;
    const key = [...loop].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    if (!loopIsInteriorHole(mesh, loop)) continue;
    holes += 1;
    seed = loop[0]!;
    if (holes > 1) return null;
  }
  return holes === 1 ? seed : null;
}

function loopIsInteriorHole(mesh: EditableMesh, loop: EdgeId[]): boolean {
  const loopSet = new Set(loop);
  const verts = new Set<VertexId>();
  for (const edgeId of loop) {
    const pair = getEdgeVertices(mesh, edgeId);
    if (!pair) continue;
    verts.add(pair[0]);
    verts.add(pair[1]);
  }
  for (const vertexId of verts) {
    for (const edge of mesh.edges.values()) {
      const pair = getEdgeVertices(mesh, edge.id);
      if (!pair) continue;
      if (pair[0] !== vertexId && pair[1] !== vertexId) continue;
      if (loopSet.has(edge.id)) continue;
      if (!isBoundaryEdge(mesh, edge.id)) return true;
    }
  }
  return false;
}

export function canFillSelection(session: EditorSession): boolean {
  const mesh = activeMesh(session);
  if (!mesh || session.selection.state.mode === 'object') return false;
  const sel = session.selection.state;
  if (sel.mode === 'vertex' && sel.selectedVertexIds.size >= 3) return true;
  if (sel.mode === 'edge') {
    if ([...sel.selectedEdgeIds].some((id) => isBoundaryEdge(mesh, id))) return true;
    if (vertsFromEdges(mesh, sel.selectedEdgeIds).length >= 3) return true;
  }
  return interiorHoleSeed(mesh) !== null;
}

export function canMergeSelection(session: EditorSession): boolean {
  const mesh = activeMesh(session);
  if (!mesh) return false;
  return mergeVertexIds(session, mesh).length >= 2;
}

/** Blender F: make a face from verts / edges, or fill a hole. */
export function applyFillHotkey(session: EditorSession): boolean {
  const mesh = activeMesh(session);
  if (!mesh || session.selection.state.mode === 'object') return false;
  const sel = session.selection.state;
  const tx = runMeshTransaction(
    session.history,
    mesh,
    sel.mode === 'vertex' && sel.selectedVertexIds.size >= 3 ? 'Make Face' : 'Fill',
    (editable) => {
      const result = fillFromSelection(editable, sel);
      if (!result.ok) throw new Error(result.error?.message ?? 'Fill failed');
      session.selection.applyTopologyChange(result.change);
    },
    { fullValidation: true, selection: session.selection },
  );
  if (tx.ok) session.requestRedraw();
  return tx.ok;
}

function fillFromSelection(
  mesh: EditableMesh,
  sel: ReturnType<typeof selectionInput>,
): GeometryOpResult<TopologyChangeResult> {
  if (sel.mode === 'vertex' && sel.selectedVertexIds.size >= 3) {
    return fillFromVertices(mesh, [...sel.selectedVertexIds]);
  }
  if (sel.mode === 'edge' && sel.selectedEdgeIds.size > 0) {
    const edges = [...sel.selectedEdgeIds];
    if (edges.some((id) => isBoundaryEdge(mesh, id))) {
      const holes = fillHoles(mesh, edges);
      if (holes.ok) return holes;
    }
    const verts = vertsFromEdges(mesh, edges);
    if (verts.length >= 3) return makeFaceFromVertices(mesh, verts);
  }
  const seed = interiorHoleSeed(mesh);
  if (seed) return fillHoles(mesh, [seed]);
  return {
    ok: false,
    change: emptyTopologyChangeResult(),
    error: { code: 'EMPTY_SELECTION', message: 'Select vertices, a hole, or edges to fill', affectedElementIds: [], recoverable: true },
    warnings: [],
  };
}

function fillFromVertices(mesh: EditableMesh, vertexIds: VertexId[]) {
  const loopEdges = selectedBoundaryEdges(mesh, vertexIds);
  if (loopEdges.length >= 3) {
    const loop = fillBoundaryLoop(mesh, loopEdges);
    if (loop.ok) return loop;
  }
  return makeFaceFromVertices(mesh, vertexIds);
}

/** Blender M: merge selected verts, or collapse selected edges / faces, at center. */
export function applyMergeHotkey(session: EditorSession): boolean {
  const mesh = activeMesh(session);
  if (!mesh) return false;
  const verts = mergeVertexIds(session, mesh);
  if (verts.length < 2) return false;
  const tx = runMeshTransaction(
    session.history,
    mesh,
    'Merge',
    (editable) => {
      const result = mergeVertices(editable, verts);
      if (!result.ok) throw new Error(result.error?.message ?? 'Merge failed');
      session.selection.applyTopologyChange(result.change);
    },
    { fullValidation: true, selection: session.selection },
  );
  if (tx.ok) session.requestRedraw();
  return tx.ok;
}

export function applyPokeHotkey(session: EditorSession): boolean {
  const mesh = activeMesh(session);
  if (!mesh) return false;
  const faces = [...expandSymmetryFaceIds(
    mesh,
    resolveEditFaceIds(mesh, selectionInput(session)),
    session.document.settings.symmetry,
  )];
  const tx = runMeshTransaction(
    session.history,
    mesh,
    'Poke Faces',
    (editable) => {
      const result = pokeFaces(editable, faces);
      if (!result.ok) throw new Error(result.error?.message ?? 'Poke failed');
      session.selection.applyTopologyChange(result.change);
    },
    { fullValidation: true, selection: session.selection },
  );
  if (tx.ok) session.requestRedraw();
  return tx.ok;
}
