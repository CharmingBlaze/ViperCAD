import { pushToast } from '@/app/Toast';
import type { EditorSession } from '@/core/editor/EditorSession';
import { LoopCutTool } from '@/core/tools/LoopCutTool';
import type { WorkspaceController } from '@/workspace/WorkspaceController';

/** Activate Blender-style Ctrl+R loop-cut preview and modal controls. */
export function beginInteractiveLoopCut(
  session: EditorSession,
  workspace: WorkspaceController,
): boolean {
  if (session.transform.active) return false;
  session.tools.setActive('loop-cut', session.context());
  const tool = session.tools.getActive();
  if (!(tool instanceof LoopCutTool)) {
    pushToast('Loop Cut tool unavailable', 'error');
    return false;
  }
  workspace.input.begin('tool');
  pushToast('Loop Cut: hover a quad ring · wheel changes cuts · click to slide', 'info');
  return true;
}
