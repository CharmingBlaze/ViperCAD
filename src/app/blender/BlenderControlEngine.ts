import {
  beginBlenderOperator as engineBeginBlenderOperator,
  blenderIncrementSnap as engineBlenderIncrementSnap,
  handleBlenderShortcut,
  type BlenderShortcutContext,
  type BlenderOperatorId,
  type CameraAxes,
} from '@/app/input/BlenderShortcutEngine';
import type { EditorSession } from '@/core/editor/EditorSession';
import type { PointerSample } from '@/core/transform/TransformSystem';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import type { ViewId } from '@/workspace/types';

export type { CameraAxes, BlenderOperatorId };

export type BlenderControlContext = {
  session: EditorSession;
  workspace: WorkspaceController;
  getCameraAxes: (viewId: ViewId) => CameraAxes | null;
  getPointerSample?: (viewId: ViewId) => PointerSample | null;
  invalidateViewport?: () => void;
};

/**
 * Re-export increment snap check.
 */
export function blenderIncrementSnap(ctrlKey: boolean): boolean {
  return engineBlenderIncrementSnap(ctrlKey);
}

/**
 * Entry point for starting G/R/S modal transforms and Blender mesh operators.
 * Delegates to the dedicated BlenderShortcutEngine.
 */
export function beginBlenderOperator(
  id: BlenderOperatorId,
  ctx: BlenderControlContext,
): boolean {
  return engineBeginBlenderOperator(id, ctx as BlenderShortcutContext);
}

/**
 * Modelling keymap entry point.
 * Delegates to the dedicated BlenderShortcutEngine.
 */
export function handleBlenderControlKey(
  e: KeyboardEvent,
  ctx: BlenderControlContext,
): boolean {
  return handleBlenderShortcut(e, ctx as BlenderShortcutContext);
}
