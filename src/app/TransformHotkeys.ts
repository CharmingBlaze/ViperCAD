import { beginInteractiveExtrude } from '@/app/ExtrudeHotkey';
import { beginInteractiveInset } from '@/app/InsetHotkey';
import { beginInteractiveKnife } from '@/app/KnifeHotkey';
import { beginInteractiveBevel } from '@/app/BevelHotkey';
import { beginInteractiveLoopCut } from '@/app/LoopCutHotkey';
import {
  applyShadeHotkey,
  applySubdivideHotkey,
} from '@/app/ModelingEditHotkeys';
import type { EditorSession } from '@/core/editor/EditorSession';
import { CreateDoodleTool } from '@/core/tools/CreateDoodleTool';
import { CreatePrimitiveTool } from '@/core/tools/CreatePrimitiveTool';
import { DrawPolyTool } from '@/core/tools/DrawPolyTool';
import { KnifeTool } from '@/core/tools/KnifeTool';
import { LoopCutTool } from '@/core/tools/LoopCutTool';
import { isNumericInputChar } from '@/core/transform/NumericParser';
import { cycleOrientation, cyclePivotMode } from '@/core/transform/Orientation';
import type { PointerSample } from '@/core/transform/TransformSystem';
import type { TransformType } from '@/core/transform/types';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import { isTypingTarget } from '@/workspace/InputRouter';
import type { ViewId } from '@/workspace/types';

export type CameraAxes = {
  right: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  forward: { x: number; y: number; z: number };
};

/**
 * Handle G/R/S modal transform hotkeys.
 * Returns true if the event was consumed.
 */
export function handleTransformHotkey(
  e: KeyboardEvent,
  session: EditorSession,
  workspace: WorkspaceController,
  getCameraAxes: (viewId: ViewId) => CameraAxes | null,
  getPointerSample?: (viewId: ViewId) => PointerSample | null,
): boolean {
  if (isTypingTarget(e.target)) return false;
  if (workspace.input.owner === 'divider') return false;

  const transform = session.transform;
  const key = e.key;

  if (transform.active) {
    if (key === 'Escape') {
      e.preventDefault();
      transform.cancel();
      workspace.input.end('transform');
      return true;
    }
    if (key === 'Enter') {
      e.preventDefault();
      transform.confirm();
      workspace.input.end('transform');
      return true;
    }
    if (key === 'Backspace') {
      e.preventDefault();
      transform.appendNumeric('Backspace');
      return true;
    }
    if (key === 'x' || key === 'X' || key === 'y' || key === 'Y' || key === 'z' || key === 'Z') {
      e.preventDefault();
      const axis = key.toLowerCase() as 'x' | 'y' | 'z';
      const viewId =
        workspace.hoveredViewportId ?? workspace.activeViewportId;
      transform.setAxisKey(axis, e.shiftKey, getCameraAxes(viewId));
      return true;
    }
    if (isNumericInputChar(key)) {
      e.preventDefault();
      transform.appendNumeric(key);
      return true;
    }
    // Block unrelated shortcuts during transform
    if (key.length === 1) {
      e.preventDefault();
      return true;
    }
    return false;
  }

  // Don't steal keys while a create tool is mid-gesture.
  const activeTool = session.tools.getActive();
  if (activeTool instanceof CreatePrimitiveTool && activeTool.state.stage !== 'idle') {
    return false;
  }
  if (activeTool instanceof CreateDoodleTool && activeTool.state.stage === 'drawing') {
    return false;
  }
  if (activeTool instanceof DrawPolyTool && activeTool.state.chain.length > 0) {
    return false;
  }
  if (activeTool instanceof KnifeTool && activeTool.state.dragging) {
    return false;
  }
  if (activeTool instanceof LoopCutTool) {
    return false;
  }

  // Blender-style Extrude
  if (key === 'e' || key === 'E') {
    const mode = session.selection.state.mode;
    const canExtrude =
      (mode === 'face' && session.selection.state.selectedFaceIds.size > 0) ||
      (mode === 'edge' && session.selection.state.selectedEdgeIds.size > 0);
    if (!canExtrude) return false;
    e.preventDefault();
    return beginInteractiveExtrude(session, workspace, getCameraAxes, getPointerSample);
  }

  // Interactive Inset
  if (key === 'i' || key === 'I') {
    if (session.selection.state.mode !== 'face' || session.selection.state.selectedFaceIds.size === 0) {
      return false;
    }
    e.preventDefault();
    return beginInteractiveInset(session, workspace, getCameraAxes, getPointerSample);
  }

  // Interactive Knife
  if (key === 'k' || key === 'K') {
    e.preventDefault();
    return beginInteractiveKnife(session, workspace);
  }

  // Interactive Bevel (Ctrl+B — plain B is brush in UV paint)
  if ((key === 'b' || key === 'B') && (e.ctrlKey || e.metaKey) && !e.altKey) {
    if (session.selection.state.mode !== 'edge' || session.selection.state.selectedEdgeIds.size === 0) {
      return false;
    }
    e.preventDefault();
    return beginInteractiveBevel(session, workspace, getCameraAxes, getPointerSample);
  }

  // Blender Loop Cut
  if ((key === 'r' || key === 'R') && (e.ctrlKey || e.metaKey) && !e.altKey) {
    e.preventDefault();
    return beginInteractiveLoopCut(session, workspace);
  }

  // Subdivide (Ctrl+Shift+D)
  if ((key === 'd' || key === 'D') && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
    e.preventDefault();
    return applySubdivideHotkey(session, 1);
  }

  // Shade Smooth / Flat (Shift+Alt+S / Shift+Alt+F)
  if ((key === 's' || key === 'S') && e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    return applyShadeHotkey(session, 'smooth');
  }
  if ((key === 'f' || key === 'F') && e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    return applyShadeHotkey(session, 'flat');
  }

  // Start G / R / S
  if (key === 'g' || key === 'G' || key === 'r' || key === 'R' || key === 's' || key === 'S') {
    // Keep application shortcuts such as Ctrl/Cmd+G available to the shell.
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (!transform.canBegin()) return false;
    e.preventDefault();
    const type: TransformType =
      key === 'g' || key === 'G' ? 'translate' : key === 'r' || key === 'R' ? 'rotate' : 'scale';
    // Rotate defaults to the object's own axes so rings match the selection.
    if (type === 'rotate' && transform.prefs.orientation === 'global') {
      transform.setOrientation('local');
    }
    if (type === 'rotate') {
      transform.setGizmoMode('rotate');
    } else if (type === 'translate') {
      transform.setGizmoMode('move');
    } else {
      transform.setGizmoMode('scale');
    }
    const viewId = workspace.hoveredViewportId ?? workspace.activeViewportId;
    const pointer = getPointerSample?.(viewId) ?? null;
    const started = transform.begin({
      type,
      source: 'keyboard',
      viewportId: viewId,
      pointer,
      camera: pointer?.camera ?? getCameraAxes(viewId),
    });
    if (started) workspace.input.begin('transform');
    return started;
  }

  // Cycle transform space (Blender-style . / ,)
  if (key === '.' || key === '>') {
    e.preventDefault();
    transform.setOrientation(cycleOrientation(transform.prefs.orientation));
    return true;
  }
  if (key === ',' || key === '<') {
    e.preventDefault();
    transform.setPivotMode(cyclePivotMode(transform.prefs.pivotMode));
    return true;
  }

  return false;
}
