import { pushToast } from '@/app/Toast';
import type { EditorSession } from '@/core/editor/EditorSession';
import { PushPullTool } from '@/core/tools/PushPullTool';
import type { WorkspaceController } from '@/workspace/WorkspaceController';

/** Activate SketchUp-style face Push/Pull (click face → drag → click). */
export function beginInteractivePushPull(
  session: EditorSession,
  workspace: WorkspaceController,
): boolean {
  if (session.transform.active) return false;
  session.tools.setActive('push-pull', session.context());
  const tool = session.tools.getActive();
  if (!(tool instanceof PushPullTool)) {
    pushToast('Push/Pull tool unavailable', 'error');
    return false;
  }
  workspace.input.begin('tool');
  pushToast('Push/Pull: click a face, move to extrude, click again to finish', 'info');
  return true;
}
