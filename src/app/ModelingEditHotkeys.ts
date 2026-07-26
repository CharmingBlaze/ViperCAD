import { runMeshTransaction } from '@/core/history/Transaction';
import type { EditorSession } from '@/core/editor/EditorSession';
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
} from '@/core/symmetry/Symmetry';

function activeMesh(session: EditorSession) {
  const objectId = session.selection.state.activeObjectId;
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
