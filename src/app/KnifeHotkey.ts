import type { EditorSession } from '@/core/editor/EditorSession';
import { KnifeTool } from '@/core/tools/KnifeTool';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import { pushToast } from '@/app/Toast';

/** Activate Blender-style knife: click start, preview with pointer, click/Enter confirm. */
export function beginInteractiveKnife(
  session: EditorSession,
  _workspace: WorkspaceController,
): boolean {
  if (session.transform.active) return false;
  session.tools.setActive('knife', session.context());
  const tool = session.tools.getActive();
  if (!(tool instanceof KnifeTool)) {
    pushToast('Knife tool unavailable', 'error');
    return false;
  }
  pushToast('Knife: click start and end points · Enter confirms · Esc cancels', 'info');
  return true;
}
