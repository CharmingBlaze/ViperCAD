import type { EditorSession } from '@/core/editor/EditorSession';
import { runMeshTransaction } from '@/core/history/Transaction';
import { insetFaces } from '@/core/mesh/ops/inset';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import type { ViewId } from '@/workspace/types';
import type { CameraAxes } from '@/app/TransformHotkeys';
import type { PointerSample } from '@/core/transform/TransformSystem';
import { pushToast } from '@/app/Toast';
import { expandSymmetryFaceIds } from '@/core/symmetry/Symmetry';

/**
 * Interactive inset (I): inset selected faces, then scale the new inner faces.
 * Esc undoes the inset topology via transform cancel.
 */
export function beginInteractiveInset(
  session: EditorSession,
  workspace: WorkspaceController,
  getCameraAxes: (viewId: ViewId) => CameraAxes | null,
  getPointerSample?: (viewId: ViewId) => PointerSample | null,
): boolean {
  if (session.transform.active) return false;

  const sel = session.selection.state;
  if (sel.mode !== 'face' || sel.selectedFaceIds.size === 0) {
    pushToast('Select faces to inset', 'error');
    return false;
  }

  const objectId = sel.activeObjectId ?? [...sel.selectedObjectIds][0] ?? null;
  if (!objectId) return false;
  const object = session.document.objects.get(objectId);
  if (!object?.meshId) return false;
  const mesh = session.document.meshes.get(object.meshId);
  if (!mesh) return false;

  const primaryCount = sel.selectedFaceIds.size;
  const ids = [...expandSymmetryFaceIds(
    mesh,
    sel.selectedFaceIds,
    session.document.settings.symmetry,
  )];
  const tx = runMeshTransaction(
    session.history,
    mesh,
    'Inset',
    (m) => {
      const result = insetFaces(m, ids, { thickness: 0.15, individual: true });
      if (!result.ok) throw new Error(result.error?.message ?? 'Inset failed');
      if (result.change.recommendedSelection.faceIds) {
        result.change.recommendedSelection.faceIds =
          result.change.recommendedSelection.faceIds.slice(0, primaryCount);
      }
      session.selection.applyTopologyChange(result.change);
      return result;
    },
    { fullValidation: true, selection: session.selection },
  );
  if (!tx.ok) {
    pushToast(tx.error ?? 'Inset failed', 'error');
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
    statusLabel: 'Inset',
  });
  if (started) workspace.input.begin('transform');
  session.requestRedraw();
  return started;
}
