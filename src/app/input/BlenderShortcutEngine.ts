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
import { lockBlockoutReferences } from '@/core/blockout/BlockoutReferenceObject';
import {
  activateTerrainWorkspaceTool,
  adjustTerrainBrushSize,
} from '@/app/terrainWorkspace';
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
import type { EditableMesh } from '@/core/mesh/types';

export type CameraAxes = {
  right: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  forward: { x: number; y: number; z: number };
};

export type BlenderShortcutContext = {
  session: EditorSession;
  workspace: WorkspaceController;
  getCameraAxes: (viewId: ViewId) => CameraAxes | null;
  getPointerSample?: (viewId: ViewId) => PointerSample | null;
  invalidateViewport?: () => void;
};

export type BlenderOperatorId =
  | 'translate'
  | 'rotate'
  | 'scale'
  | 'extrude'
  | 'inset'
  | 'bevel'
  | 'knife'
  | 'loop-cut';

/**
 * Helper to resolve the mesh currently targeted for editing.
 * Checks activeObjectId first, then falls back to the first selected object ID.
 */
export function getActiveEditMesh(session: EditorSession): EditableMesh | null {
  let objectId = session.selection.state.activeObjectId;
  if (!objectId && session.selection.state.selectedObjectIds.size > 0) {
    objectId = [...session.selection.state.selectedObjectIds][0] ?? null;
  }
  const object = objectId ? session.document.objects.get(objectId) : null;
  return object?.meshId ? session.document.meshes.get(object.meshId) ?? null : null;
}

/**
 * Blender-style increment snap: hold Ctrl.
 */
export function blenderIncrementSnap(ctrlKey: boolean): boolean {
  return ctrlKey;
}

/**
 * Begin a Blender operator (G/R/S modal transforms or interactive mesh operators).
 */
export function beginBlenderOperator(
  id: BlenderOperatorId,
  ctx: BlenderShortcutContext,
): boolean {
  const { session, workspace, getCameraAxes, getPointerSample } = ctx;
  if (id === 'extrude') {
    return beginInteractiveExtrude(session, workspace, getCameraAxes, getPointerSample);
  }
  if (id === 'inset') {
    return beginInteractiveInset(session, workspace, getCameraAxes, getPointerSample);
  }
  if (id === 'bevel') {
    return beginInteractiveBevel(session, workspace, getCameraAxes, getPointerSample);
  }
  if (id === 'knife') {
    return beginInteractiveKnife(session, workspace);
  }
  if (id === 'loop-cut') {
    return beginInteractiveLoopCut(session, workspace);
  }
  return beginModalTransform(id, ctx);
}

function beginModalTransform(
  type: TransformType,
  ctx: BlenderShortcutContext,
): boolean {
  const { session, workspace, getCameraAxes, getPointerSample } = ctx;
  const transform = session.transform;
  if (!transform.canBegin()) return false;

  if (workspace.shellMode === 'blockout') {
    const toolId = session.tools.getActive()?.id;
    if (toolId === 'blockout-vector' || toolId === 'blockout-solid' || toolId === 'blockout-round') {
      session.tools.setActive('select', session.context());
    }
  }
  if (workspace.shellMode === 'terrain') {
    const toolId = session.tools.getActive()?.id;
    if (toolId === 'terrain-sculpt' || toolId === 'terrain-object' || toolId === 'terrain-feature') {
      session.tools.setActive('select', session.context());
    }
  }

  if (type === 'rotate' && transform.prefs.orientation === 'global') {
    transform.setOrientation('local');
  }
  if (type === 'rotate') transform.setGizmoMode('rotate');
  else if (type === 'translate') transform.setGizmoMode('move');
  else transform.setGizmoMode('scale');

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

/**
 * Handle in-flight modal transform keystrokes (x/y/z axis, shift planes, numbers, enter, esc).
 */
export function handleBlenderModalKeys(
  e: KeyboardEvent,
  ctx: BlenderShortcutContext,
): boolean {
  const { session, workspace, getCameraAxes } = ctx;
  const transform = session.transform;
  if (!transform.active) return false;
  const key = e.key;

  if (key === 'Escape') {
    e.preventDefault();
    transform.cancel();
    workspace.input.end('transform');
    session.requestRedraw();
    ctx.invalidateViewport?.();
    return true;
  }
  if (key === 'Enter' || key === 'NumpadEnter' || key === 'Return') {
    e.preventDefault();
    transform.confirm();
    workspace.input.end('transform');
    session.requestRedraw();
    ctx.invalidateViewport?.();
    return true;
  }
  if (key === 'Backspace') {
    e.preventDefault();
    transform.appendNumeric('Backspace');
    session.requestRedraw();
    ctx.invalidateViewport?.();
    return true;
  }
  if (key === 'x' || key === 'X' || key === 'y' || key === 'Y' || key === 'z' || key === 'Z') {
    e.preventDefault();
    const axis = key.toLowerCase() as 'x' | 'y' | 'z';
    const viewId = workspace.hoveredViewportId ?? workspace.activeViewportId;
    transform.setAxisKey(axis, e.shiftKey, getCameraAxes(viewId));
    session.requestRedraw();
    ctx.invalidateViewport?.();
    return true;
  }
  if (isNumericInputChar(key)) {
    e.preventDefault();
    transform.appendNumeric(key);
    session.requestRedraw();
    ctx.invalidateViewport?.();
    return true;
  }
  if (key.length === 1) {
    e.preventDefault();
    return true;
  }
  return false;
}

/**
 * Switches component selection mode (1: Vertex, 2: Edge, 3: Face) with immediate redraw.
 */
export function switchComponentMode(
  mode: 'vertex' | 'edge' | 'face',
  ctx: BlenderShortcutContext,
): boolean {
  const { session, workspace, invalidateViewport } = ctx;
  const meshEdit = workspace.shellMode === 'model' || workspace.shellMode === 'blockout';
  if (!meshEdit) return false;

  let objectId = session.selection.state.activeObjectId;
  if (!objectId && session.selection.state.selectedObjectIds.size > 0) {
    objectId = [...session.selection.state.selectedObjectIds][0] ?? null;
    if (objectId) {
      session.selection.state.activeObjectId = objectId;
    }
  }
  const mesh = getActiveEditMesh(session);

  session.tools.setActive('select', session.context());
  session.selection.switchEditMode(mode, mesh);

  if (session.transform.prefs.gizmoMode === 'select') {
    session.transform.setGizmoMode('combined');
  }

  session.requestRedraw();
  invalidateViewport?.();
  return true;
}

/**
 * Blender-style Tab toggle:
 * - If in vertex/edge/face mode: switch to object mode.
 * - If in object mode and an object is selected: switch to edit mode (defaulting to vertex).
 * - If no object is selected: returns false so Tab falls through to workspace layout maximize.
 */
export function handleBlenderTabToggle(ctx: BlenderShortcutContext): boolean {
  const { session, workspace, invalidateViewport } = ctx;
  const meshEdit = workspace.shellMode === 'model' || workspace.shellMode === 'blockout';
  if (!meshEdit) return false;

  const currentMode = session.selection.state.mode;

  if (currentMode !== 'object') {
    session.tools.setActive('select', session.context());
    session.selection.setMode('object');
    session.requestRedraw();
    invalidateViewport?.();
    return true;
  }

  let objectId = session.selection.state.activeObjectId;
  if (!objectId && session.selection.state.selectedObjectIds.size > 0) {
    objectId = [...session.selection.state.selectedObjectIds][0] ?? null;
    if (objectId) {
      session.selection.state.activeObjectId = objectId;
    }
  }

  if (!objectId) return false;

  const mesh = getActiveEditMesh(session);
  session.tools.setActive('select', session.context());
  session.selection.switchEditMode('vertex', mesh);
  if (session.transform.prefs.gizmoMode === 'select') {
    session.transform.setGizmoMode('combined');
  }

  session.requestRedraw();
  invalidateViewport?.();
  return true;
}

/**
 * Blender-style Select All / Deselect All (A / Alt+A).
 */
export function handleBlenderSelectAll(
  e: KeyboardEvent,
  ctx: BlenderShortcutContext,
): boolean {
  const { session, workspace, invalidateViewport } = ctx;
  const meshEdit = workspace.shellMode === 'model' || workspace.shellMode === 'blockout';
  if (!meshEdit) return false;

  if (e.altKey) {
    session.selection.clear();
    session.requestRedraw();
    invalidateViewport?.();
    return true;
  }

  const currentMode = session.selection.state.mode;
  if (currentMode === 'object') {
    const allObjectIds = [...session.document.objects.keys()];
    if (allObjectIds.length === 0) return false;
    const allSelected = allObjectIds.every((id) => session.selection.state.selectedObjectIds.has(id));
    if (allSelected) {
      session.selection.clear();
    } else {
      session.selection.selectObjects(allObjectIds, 'replace');
    }
    session.requestRedraw();
    invalidateViewport?.();
    return true;
  }

  const mesh = getActiveEditMesh(session);
  if (!mesh) return false;

  let allSelected = false;
  if (currentMode === 'vertex') {
    allSelected = mesh.vertices.size > 0 && session.selection.state.selectedVertexIds.size === mesh.vertices.size;
  } else if (currentMode === 'edge') {
    allSelected = mesh.edges.size > 0 && session.selection.state.selectedEdgeIds.size === mesh.edges.size;
  } else if (currentMode === 'face') {
    allSelected = mesh.faces.size > 0 && session.selection.state.selectedFaceIds.size === mesh.faces.size;
  }

  if (allSelected) {
    session.selection.clear();
  } else {
    session.selection.selectAll(mesh);
  }

  session.requestRedraw();
  invalidateViewport?.();
  return true;
}

/**
 * Dedicated engine dispatch for all Blender shortcuts:
 * - Operators: E (extrude), I (inset), K (knife), Ctrl+B (bevel), Ctrl+R (loop cut)
 * - Modal transforms: G (move), R (rotate), S (scale)
 * - Mode switches: 1 (vertex), 2 (edge), 3 (face), Tab (edit/object toggle)
 * - Selection utilities: A / Alt+A, Ctrl+= / Ctrl+-, Ctrl+L
 * - Transforms & Gizmo: ., ,, p, b, q
 */
export function handleBlenderShortcut(
  e: KeyboardEvent,
  ctx: BlenderShortcutContext,
): boolean {
  const { session, workspace, invalidateViewport } = ctx;

  if (handleBlenderModalKeys(e, ctx)) return true;
  if (isTypingTarget(e.target)) return false;
  if (workspace.input.owner === 'divider') return false;

  const key = e.key;
  const activeTool = session.tools.getActive();

  if (activeTool instanceof CreatePrimitiveTool && activeTool.state.stage !== 'idle') {
    return false;
  }
  if (activeTool instanceof CreateDoodleTool && activeTool.state.stage === 'drawing') {
    if (activeTool.inputMode === 'pen') return false;
    if (activeTool.inputMode === 'sketch' && !activeTool.state.strokeLocked) return false;
    if (workspace.curveNodeEditMode) return false;
  }
  if (activeTool instanceof DrawPolyTool && activeTool.state.chain.length > 0) {
    return false;
  }
  if (
    activeTool instanceof DrawPolyTool &&
    activeTool.state.chain.length === 0 &&
    (key === 'g' || key === 'G' || key === 'r' || key === 'R' || key === 's' || key === 'S') &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey
  ) {
    const drawObjectId = activeTool.state.meshObjectId;
    if (drawObjectId && session.selection.state.mode !== 'object') {
      session.selection.setMode('object');
      session.selection.selectObjects([drawObjectId], 'replace');
    }
  }
  if (activeTool instanceof KnifeTool && activeTool.state.dragging) {
    return false;
  }
  if (activeTool instanceof LoopCutTool) {
    return false;
  }

  // --- Fast Component Mode Switching: 1 (Vertex), 2 (Edge), 3 (Face) ---
  const meshEdit = workspace.shellMode === 'model' || workspace.shellMode === 'blockout';
  if (meshEdit && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (key === '1') {
      e.preventDefault();
      return switchComponentMode('vertex', ctx);
    }
    if (key === '2') {
      e.preventDefault();
      return switchComponentMode('edge', ctx);
    }
    if (key === '3') {
      e.preventDefault();
      return switchComponentMode('face', ctx);
    }
  }

  // --- Blender Tab: Toggle Object / Edit Mode ---
  if (key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (handleBlenderTabToggle(ctx)) {
      e.preventDefault();
      return true;
    }
  }

  // --- Blender Selection Chords: A / Alt+A ---
  if ((key === 'a' || key === 'A') && !e.ctrlKey && !e.metaKey) {
    if (handleBlenderSelectAll(e, ctx)) {
      e.preventDefault();
      return true;
    }
  }

  // --- Blender Mesh Operators: E (Extrude), I (Inset), K (Knife), Ctrl+B (Bevel), Ctrl+R (LoopCut) ---
  if ((key === 'e' || key === 'E') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    const mode = session.selection.state.mode;
    const canExtrude =
      (mode === 'face' && session.selection.state.selectedFaceIds.size > 0) ||
      (mode === 'edge' && session.selection.state.selectedEdgeIds.size > 0);
    if (!canExtrude) return false;
    e.preventDefault();
    return beginBlenderOperator('extrude', ctx);
  }

  if ((key === 'i' || key === 'I') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (session.selection.state.mode !== 'face' || session.selection.state.selectedFaceIds.size === 0) {
      return false;
    }
    e.preventDefault();
    return beginBlenderOperator('inset', ctx);
  }

  if ((key === 'k' || key === 'K') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    return beginBlenderOperator('knife', ctx);
  }

  if ((key === 'b' || key === 'B') && (e.ctrlKey || e.metaKey) && !e.altKey) {
    const selection = session.selection.state;
    const canBevel =
      (selection.mode === 'edge' && selection.selectedEdgeIds.size > 0) ||
      (selection.mode === 'face' && selection.selectedFaceIds.size > 0);
    if (!canBevel) return false;
    e.preventDefault();
    return beginBlenderOperator('bevel', ctx);
  }

  if ((key === 'r' || key === 'R') && (e.ctrlKey || e.metaKey) && !e.altKey) {
    e.preventDefault();
    return beginBlenderOperator('loop-cut', ctx);
  }

  if ((key === 'd' || key === 'D') && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
    e.preventDefault();
    return applySubdivideHotkey(session, 1);
  }

  if ((key === 's' || key === 'S') && e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    return applyShadeHotkey(session, 'smooth');
  }
  if ((key === 'f' || key === 'F') && e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    return applyShadeHotkey(session, 'flat');
  }

  // --- Blockout Mode Operators ---
  if (workspace.shellMode === 'blockout' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (key === 'v' || key === 'V') {
      e.preventDefault();
      lockBlockoutReferences(session.document, true);
      session.tools.setActive('blockout-vector', session.context());
      session.selection.switchEditMode('object', getActiveEditMesh(session));
      session.requestRedraw();
      invalidateViewport?.();
      return true;
    }
    if (key === 'q' || key === 'Q') {
      e.preventDefault();
      lockBlockoutReferences(session.document, true);
      session.tools.setActive('blockout-solid', session.context());
      session.selection.switchEditMode('object', getActiveEditMesh(session));
      session.requestRedraw();
      invalidateViewport?.();
      return true;
    }
    if (key === 'o' || key === 'O') {
      e.preventDefault();
      lockBlockoutReferences(session.document, true);
      session.tools.setActive('blockout-round', session.context());
      session.selection.switchEditMode('object', getActiveEditMesh(session));
      session.requestRedraw();
      invalidateViewport?.();
      return true;
    }
  }

  // --- Terrain Mode Operators ---
  if (workspace.shellMode === 'terrain' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (key === '1') {
      e.preventDefault();
      return activateTerrainWorkspaceTool(session, 'sculpt');
    }
    if (key === '2') {
      e.preventDefault();
      return activateTerrainWorkspaceTool(session, 'objects');
    }
    if (key === '3') {
      e.preventDefault();
      return activateTerrainWorkspaceTool(session, 'water');
    }
    if (key === '[' || key === ']') {
      e.preventDefault();
      return adjustTerrainBrushSize(session, key === ']' ? 1.12 : 0.89);
    }
  }

  // --- Blender Modal Transforms: G (Grab), R (Rotate), S (Scale) ---
  if (key === 'g' || key === 'G' || key === 'r' || key === 'R' || key === 's' || key === 'S') {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    if (workspace.shellMode !== 'model' && workspace.shellMode !== 'blockout' && workspace.shellMode !== 'terrain') {
      return false;
    }
    e.preventDefault();
    const type: TransformType =
      key === 'g' || key === 'G' ? 'translate' : key === 'r' || key === 'R' ? 'rotate' : 'scale';
    return beginBlenderOperator(type, ctx);
  }

  // --- Select Tool Toggle: B / Q ---
  if ((key === 'b' || key === 'B' || key === 'q' || key === 'Q') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    if (workspace.shellMode === 'model' || workspace.shellMode === 'blockout') {
      e.preventDefault();
      session.tools.setActive('select', session.context());
      session.transform.setGizmoMode('select');
      session.requestRedraw();
      invalidateViewport?.();
      return true;
    }
  }

  // --- Origin Mode Toggle: P ---
  if ((key === 'p' || key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    const currentMode = session.transform.prefs.gizmoMode;
    session.transform.setGizmoMode(currentMode === 'origin' ? 'combined' : 'origin');
    session.requestRedraw();
    invalidateViewport?.();
    return true;
  }

  // --- Orientation & Pivot: . and , ---
  if (key === '.' || key === '>') {
    e.preventDefault();
    session.transform.setOrientation(cycleOrientation(session.transform.prefs.orientation));
    session.requestRedraw();
    invalidateViewport?.();
    return true;
  }
  if (key === ',' || key === '<') {
    e.preventDefault();
    session.transform.setPivotMode(cyclePivotMode(session.transform.prefs.pivotMode));
    session.requestRedraw();
    invalidateViewport?.();
    return true;
  }

  // --- Selection Grow / Shrink / Connected ---
  const mesh = getActiveEditMesh(session);
  const canEditComponents = meshEdit && !!mesh && session.selection.state.mode !== 'object';

  if (canEditComponents && (e.ctrlKey || e.metaKey) && !e.altKey && (key === '=' || key === '+' || key === 'Add')) {
    e.preventDefault();
    session.selection.grow(mesh!);
    session.requestRedraw();
    invalidateViewport?.();
    return true;
  }
  if (canEditComponents && (e.ctrlKey || e.metaKey) && !e.altKey && (key === '-' || key === '_' || key === 'Subtract')) {
    e.preventDefault();
    session.selection.shrink(mesh!);
    session.requestRedraw();
    invalidateViewport?.();
    return true;
  }
  if (canEditComponents && (e.ctrlKey || e.metaKey) && !e.altKey && (key === 'l' || key === 'L')) {
    e.preventDefault();
    session.selection.selectConnected(mesh!);
    session.requestRedraw();
    invalidateViewport?.();
    return true;
  }

  return false;
}
