import type { EditorSession } from '@/core/editor/EditorSession';
import { runMeshTransaction } from '@/core/history/Transaction';
import { bevelEdges } from '@/core/mesh/ops/bevel';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import type { ViewId } from '@/workspace/types';
import type { CameraAxes } from '@/app/TransformHotkeys';
import type { PointerSample } from '@/core/transform/TransformSystem';
import { pushToast } from '@/app/Toast';
import { expandSymmetryEdgeIds } from '@/core/symmetry/Symmetry';
import { getEdgeVertices } from '@/core/mesh/EditableMesh';

/**
 * Interactive bevel (Ctrl+B): chamfer selected edges, then scale for width.
 * Esc undoes via transform cancel.
 */
export function beginInteractiveBevel(
  session: EditorSession,
  workspace: WorkspaceController,
  getCameraAxes: (viewId: ViewId) => CameraAxes | null,
  getPointerSample?: (viewId: ViewId) => PointerSample | null,
): boolean {
  if (session.transform.active) return false;

  const sel = session.selection.state;
  if (sel.mode !== 'edge' || sel.selectedEdgeIds.size === 0) {
    pushToast('Select edges to bevel', 'error');
    return false;
  }

  const objectId = sel.activeObjectId ?? [...sel.selectedObjectIds][0] ?? null;
  if (!objectId) return false;
  const object = session.document.objects.get(objectId);
  if (!object?.meshId) return false;
  const mesh = session.document.meshes.get(object.meshId);
  if (!mesh) return false;

  const primaryIds = new Set(sel.selectedEdgeIds);
  const ids = [...expandSymmetryEdgeIds(
    mesh,
    sel.selectedEdgeIds,
    session.document.settings.symmetry,
  )];
  const orderedPrimary = ids
    .map((id, order) => {
      const pair = getEdgeVertices(mesh, id);
      const a = pair ? mesh.vertices.get(pair[0])?.position : null;
      const b = pair ? mesh.vertices.get(pair[1])?.position : null;
      const length = a && b
        ? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
        : 0;
      return { id, order, length, primary: primaryIds.has(id) };
    })
    .sort((a, b) => b.length - a.length || a.order - b.order)
    .map((entry) => entry.primary);
  const tx = runMeshTransaction(
    session.history,
    mesh,
    'Bevel',
    (m) => {
      const result = bevelEdges(m, ids, { width: 0.05 });
      if (!result.ok) throw new Error(result.error?.message ?? 'Bevel failed');
      if (result.change.recommendedSelection.faceIds) {
        result.change.recommendedSelection.faceIds =
          result.change.recommendedSelection.faceIds.filter((_, index) => orderedPrimary[index]);
      }
      session.selection.applyTopologyChange(result.change);
      return result;
    },
    { fullValidation: true, selection: session.selection },
  );
  if (!tx.ok) {
    pushToast(tx.error ?? 'Bevel failed', 'error');
    return false;
  }

  const viewId = workspace.hoveredViewportId ?? workspace.activeViewportId;
  const camera = getCameraAxes(viewId);
  const pointer = getPointerSample?.(viewId) ?? null;
  session.tools.setActive('select', session.context());
  session.transform.setGizmoMode('scale');
  const started = session.transform.begin({
    type: 'scale',
    source: 'keyboard',
    viewportId: viewId,
    pointer,
    camera,
    orientation: 'normal',
    undoHistoryOnCancel: true,
    statusLabel: 'Bevel',
  });
  if (started) workspace.input.end('tool');
  if (started) workspace.input.begin('transform');
  session.requestRedraw();
  return started;
}
