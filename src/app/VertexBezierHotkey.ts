import {
  enableBezierCurveGizmo,
  isVertexBezierPrepared,
  prepareVertexBezierMesh,
  readVertexBezierState,
  serializeVertexBezierState,
  VERTEX_BEZIER_META,
} from '@/core/curves/BezierFromVertices';
import { readCurveOperation } from '@/core/curves/CurveOperation';
import type { EditorSession } from '@/core/editor/EditorSession';
import { runMeshTransaction } from '@/core/history/Transaction';
import type { WorkspaceController } from '@/workspace/WorkspaceController';

/** Overlay Bézier handles on the active mesh and deform it along those curves. */
export function beginVertexBezier(
  session: EditorSession,
  workspace: WorkspaceController,
): { ok: true; enabled: boolean } | { ok: false; error: string } {
  const context = session.context();
  const objectId = session.selection.state.activeObjectId;
  const object = objectId ? session.document.objects.get(objectId) ?? null : null;
  const mesh = object?.meshId ? session.document.meshes.get(object.meshId) ?? null : null;

  if (workspace.vertexBezierEdit && workspace.vertexBezierEdit.objectId === objectId) {
    workspace.setVertexBezierEdit(null);
    session.requestRedraw();
    return { ok: true, enabled: false };
  }

  if (object && mesh && readCurveOperation(object.metadata.curveOperation)) {
    enableBezierCurveGizmo(context, object, mesh);
    workspace.setVertexBezierEdit(null);
    workspace.setInspectorTab('edit');
    workspace.setInspectorSection('geometry');
    workspace.setCurveNodeEditMode(true);
    workspace.setSelectedCurvePointIndex(0);
    session.requestRedraw();
    return { ok: true, enabled: true };
  }

  if (!object || !mesh) {
    return { ok: false, error: 'Select a mesh with at least two vertices' };
  }

  const existing = readVertexBezierState(object.metadata);
  let state =
    existing && existing.objectId === object.id && isVertexBezierPrepared(mesh, existing)
      ? existing
      : null;

  if (!state) {
    const prepared = runMeshTransaction(
      session.history,
      mesh,
      'Prepare Bézier cage',
      (editable) => prepareVertexBezierMesh(object.id, editable, session.selection.state),
      { fullValidation: true, selection: session.selection },
    );
    if (!prepared.ok || !prepared.value || 'error' in prepared.value) {
      return {
        ok: false,
        error:
          (prepared.value && 'error' in prepared.value && prepared.value.error) ||
          prepared.error ||
          'Could not prepare Bézier handles',
      };
    }
    state = prepared.value;
  }

  object.metadata[VERTEX_BEZIER_META] = serializeVertexBezierState(state);
  session.document.dirty = true;
  session.selection.switchEditMode('vertex', mesh);
  session.selection.selectVertices(state.vertexIds.filter((id) => mesh.vertices.has(id)), 'replace');
  context.setActiveTool?.('select');
  workspace.setInspectorTab('edit');
  workspace.setInspectorSection('geometry');
  workspace.setVertexBezierEdit(state);
  workspace.setSelectedCurvePointIndex(0);
  session.requestRedraw();
  return { ok: true, enabled: true };
}
