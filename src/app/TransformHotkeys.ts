import { beginInteractivePushPull } from '@/app/PushPullHotkey';
import {
  handleBlenderControlKey,
  type BlenderControlContext,
  type CameraAxes,
} from '@/app/blender/BlenderControlEngine';
import type { EditorSession } from '@/core/editor/EditorSession';
import type { PointerSample } from '@/core/transform/TransformSystem';
import { isTypingTarget } from '@/workspace/InputRouter';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import type { ViewId } from '@/workspace/types';

export type { CameraAxes };

/**
 * Modelling keymap entry. All Blender modal operators live in BlenderControlEngine.
 * SketchUp Push/Pull stays available when a face selection is active (P).
 */
export function handleTransformHotkey(
  e: KeyboardEvent,
  session: EditorSession,
  workspace: WorkspaceController,
  getCameraAxes: (viewId: ViewId) => CameraAxes | null,
  getPointerSample?: (viewId: ViewId) => PointerSample | null,
): boolean {
  const confirmOrCancel = e.key === 'Enter' || e.key === 'NumpadEnter' || e.key === 'Return' || e.key === 'Escape';
  if (isTypingTarget(e.target) && !(session.transform.active && confirmOrCancel)) return false;
  if (workspace.input.owner === 'divider') return false;

  const key = e.key;
  if ((key === 'p' || key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (session.selection.state.mode === 'face' && session.selection.state.selectedFaceIds.size > 0) {
      e.preventDefault();
      return beginInteractivePushPull(session, workspace);
    }
  }

  const ctx: BlenderControlContext = {
    session,
    workspace,
    getCameraAxes,
    getPointerSample,
  };
  return handleBlenderControlKey(e, ctx);
}
