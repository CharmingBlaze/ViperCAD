import {
  handleBlenderControlKey,
  type BlenderControlContext,
  type CameraAxes,
} from '@/app/blender/BlenderControlEngine';
import type { EditorSession } from '@/core/editor/EditorSession';
import type { PointerSample } from '@/core/transform/TransformSystem';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import type { ViewId } from '@/workspace/types';

export type { CameraAxes };

/**
 * Modelling keymap entry. All Blender modal operators live in BlenderControlEngine.
 */
export function handleTransformHotkey(
  e: KeyboardEvent,
  session: EditorSession,
  workspace: WorkspaceController,
  getCameraAxes: (viewId: ViewId) => CameraAxes | null,
  getPointerSample?: (viewId: ViewId) => PointerSample | null,
): boolean {
  const ctx: BlenderControlContext = {
    session,
    workspace,
    getCameraAxes,
    getPointerSample,
  };
  return handleBlenderControlKey(e, ctx);
}
