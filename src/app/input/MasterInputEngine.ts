import type { EditorSession } from '@/core/editor/EditorSession';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import type { ViewId } from '@/workspace/types';
import type { PointerSample } from '@/core/transform/TransformSystem';
import { isTypingTarget } from '@/workspace/InputRouter';
import { commitDeleteSelection } from '@/core/editor/DeleteSelection';
import { exitGroupFocus } from '@/core/editor/GroupFocus';
import { commitCopySelection, commitPasteClipboard } from '@/core/editor/Clipboard';
import { commitGroupSelection, commitUngroupSelection } from '@/core/editor/HierarchyCommands';
import { CreatePrimitiveTool } from '@/core/tools/CreatePrimitiveTool';
import { CreateDoodleTool } from '@/core/tools/CreateDoodleTool';
import { DrawPolyTool } from '@/core/tools/DrawPolyTool';
import { KnifeTool } from '@/core/tools/KnifeTool';
import { LoopCutTool } from '@/core/tools/LoopCutTool';
import { BlockoutVectorTool } from '@/core/tools/BlockoutVectorTool';
import {
  handleBlenderShortcut,
  handleBlenderModalKeys,
  type CameraAxes,
} from '@/app/input/BlenderShortcutEngine';

export interface MasterInputViewport {
  getCameraAxes: (viewId: ViewId) => CameraAxes | null;
  getLastPointerSample: (viewId: ViewId) => PointerSample | null;
  syncTransformInteractionState?: () => void;
  syncLiveTransform?: () => void;
  syncGizmo?: () => void;
  invalidate?: () => void;
  frameSelection?: () => void;
  frameAll?: () => void;
  resetView?: () => void;
  getModelPlacement?: () => unknown;
  cancelModelPlacement?: () => void;
  syncInputControls?: () => void;
}

export interface MasterInputActions {
  refresh?: () => void;
  pushToast?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  setHotkeysOpen?: (update: boolean | ((open: boolean) => boolean)) => void;
  setPaletteOpen?: (update: boolean | ((open: boolean) => boolean)) => void;
  setZenMode?: (update: boolean | ((open: boolean) => boolean)) => void;
  setSidebarCollapsed?: (update: boolean | ((collapsed: boolean) => boolean)) => void;
  newProject?: () => void;
  saveProject?: (saveAs?: boolean) => void;
  openProject?: () => void;
  hotkeysOpen?: boolean;
  zenMode?: boolean;
  animation?: {
    extrudeSelectedBone: () => string | null;
    getSelectedBoneName: () => string | null;
    deleteSelectedBone: () => void;
    selectAdjacentBone: (direction: number) => void;
    selectMirroredBone: () => void;
    adjustWeightBrushRadius: (factor: number) => void;
    togglePlayback: () => void;
    setGizmoMode: (mode: 'move' | 'rotate' | 'universal') => void;
    keyframeAllBones: () => void;
    insertKeyframeForSelectedBone: () => void;
    removeKeyframeForSelectedBone: () => void;
    jumpToPrevKeyframe: () => void;
    jumpToNextKeyframe: () => void;
    stepFrame: (delta: number) => void;
    editMode?: string;
  };
}

export interface MasterInputContext {
  session: EditorSession;
  workspace: WorkspaceController;
  viewport?: MasterInputViewport;
  actions?: MasterInputActions;
}

export class MasterInputEngine {
  private activeContext: MasterInputContext | null = null;
  private pointerState = {
    x: 0,
    y: 0,
    buttons: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  };
  private boundTarget: Window | HTMLElement | null = null;

  setContext(ctx: MasterInputContext): void {
    this.activeContext = ctx;
  }

  getContext(): MasterInputContext | null {
    return this.activeContext;
  }

  getPointerPosition(): { x: number; y: number } {
    return { x: this.pointerState.x, y: this.pointerState.y };
  }

  isButtonPressed(button: number): boolean {
    return (this.pointerState.buttons & (1 << button)) !== 0;
  }

  isShiftPressed(): boolean {
    return this.pointerState.shiftKey;
  }

  isCtrlPressed(): boolean {
    return this.pointerState.ctrlKey;
  }

  isAltPressed(): boolean {
    return this.pointerState.altKey;
  }

  attach(target: Window | HTMLElement = window): void {
    if (this.boundTarget) {
      this.detach();
    }
    this.boundTarget = target;
    target.addEventListener('keydown', this.onKeyDown as EventListener);
    target.addEventListener('keyup', this.onKeyUp as EventListener);
    target.addEventListener('pointerdown', this.onPointerDown as EventListener);
    target.addEventListener('pointermove', this.onPointerMove as EventListener);
    target.addEventListener('contextmenu', this.onContextMenu as EventListener);
  }

  detach(): void {
    if (!this.boundTarget) return;
    this.boundTarget.removeEventListener('keydown', this.onKeyDown as EventListener);
    this.boundTarget.removeEventListener('keyup', this.onKeyUp as EventListener);
    this.boundTarget.removeEventListener('pointerdown', this.onPointerDown as EventListener);
    this.boundTarget.removeEventListener('pointermove', this.onPointerMove as EventListener);
    this.boundTarget.removeEventListener('contextmenu', this.onContextMenu as EventListener);
    this.boundTarget = null;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.pointerState.shiftKey = e.shiftKey;
    this.pointerState.ctrlKey = e.ctrlKey;
    this.pointerState.altKey = e.altKey;
    this.pointerState.metaKey = e.metaKey;
    this.handleKeyDown(e);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.pointerState.shiftKey = e.shiftKey;
    this.pointerState.ctrlKey = e.ctrlKey;
    this.pointerState.altKey = e.altKey;
    this.pointerState.metaKey = e.metaKey;
    this.handleKeyUp(e);
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.pointerState.x = e.clientX;
    this.pointerState.y = e.clientY;
    this.pointerState.buttons = e.buttons;
    this.pointerState.shiftKey = e.shiftKey;
    this.pointerState.ctrlKey = e.ctrlKey;
    this.pointerState.altKey = e.altKey;
    this.pointerState.metaKey = e.metaKey;
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.pointerState.x = e.clientX;
    this.pointerState.y = e.clientY;
    this.pointerState.buttons = e.buttons;
    this.pointerState.shiftKey = e.shiftKey;
    this.pointerState.ctrlKey = e.ctrlKey;
    this.pointerState.altKey = e.altKey;
    this.pointerState.metaKey = e.metaKey;
  };

  private onContextMenu = (e: MouseEvent): void => {
    this.handleContextMenu(e);
  };

  handleContextMenu(e: MouseEvent): boolean {
    const ctx = this.activeContext;
    if (!ctx) return false;
    const { session, workspace, viewport } = ctx;

    // In 3D apps (Blender), right-click during modal transform immediately cancels it
    if (session.transform.active) {
      e.preventDefault();
      session.transform.cancel();
      workspace.input.end('transform');
      viewport?.syncTransformInteractionState?.();
      viewport?.syncGizmo?.();
      viewport?.invalidate?.();
      session.requestRedraw();
      return true;
    }
    return false;
  }

  handleKeyUp(_e: KeyboardEvent): boolean {
    return false;
  }

  handleKeyDown(e: KeyboardEvent): boolean {
    const ctx = this.activeContext;
    if (!ctx) return false;
    const { session, workspace, viewport, actions } = ctx;

    // 1. Never swallow inputs from form fields
    if (isTypingTarget(e.target)) return false;

    // 2. Active modal transform keys (x, y, z, numeric, Enter, Esc)
    if (session.transform.active) {
      const handled = handleBlenderModalKeys(e, {
        session,
        workspace,
        getCameraAxes: (id) => viewport?.getCameraAxes(id) ?? null,
        getPointerSample: (id) => viewport?.getLastPointerSample(id) ?? null,
        invalidateViewport: () => viewport?.invalidate?.(),
      });
      if (handled) {
        viewport?.syncTransformInteractionState?.();
        if (session.transform.active) {
          viewport?.syncLiveTransform?.();
        } else {
          viewport?.syncGizmo?.();
          viewport?.invalidate?.();
        }
        return true;
      }
      return false;
    }

    // 3. Active interactive tool cancellation and confirmation
    if (e.key === 'Escape') {
      if (actions?.hotkeysOpen) {
        e.preventDefault();
        actions.setHotkeysOpen?.(false);
        return true;
      }
      if (viewport?.getModelPlacement?.()) {
        e.preventDefault();
        viewport.cancelModelPlacement?.();
        return true;
      }
      if (session.focusGroupId && workspace.input.owner === 'none') {
        e.preventDefault();
        exitGroupFocus(session);
        viewport?.invalidate?.();
        return true;
      }
      const tool = session.tools.getActive();
      if (tool instanceof CreatePrimitiveTool || tool instanceof CreateDoodleTool) {
        e.preventDefault();
        tool.cancel(session.context());
        session.tools.setActive('select', session.context());
        workspace.input.end('tool');
        viewport?.invalidate?.();
        return true;
      }
      if (tool instanceof DrawPolyTool) {
        e.preventDefault();
        tool.cancel(session.context());
        if (tool.state.chain.length === 0) {
          session.tools.setActive('select', session.context());
          workspace.input.end('tool');
        }
        viewport?.invalidate?.();
        return true;
      }
      if (tool instanceof KnifeTool) {
        e.preventDefault();
        tool.cancel(session.context());
        if (!tool.state.dragging) {
          session.tools.setActive('select', session.context());
        }
        workspace.input.end('tool');
        viewport?.syncInputControls?.();
        viewport?.invalidate?.();
        return true;
      }
      if (tool instanceof LoopCutTool) {
        e.preventDefault();
        tool.cancel(session.context());
        session.tools.setActive('select', session.context());
        workspace.input.end('tool');
        viewport?.syncInputControls?.();
        viewport?.invalidate?.();
        return true;
      }
      if (
        session.selection.state.selectedObjectIds.size > 0 ||
        session.selection.state.selectedVertexIds.size > 0 ||
        session.selection.state.selectedEdgeIds.size > 0 ||
        session.selection.state.selectedFaceIds.size > 0
      ) {
        e.preventDefault();
        session.selection.clear();
        session.requestRedraw();
        viewport?.invalidate?.();
        return true;
      }
    }

    const tool = session.tools.getActive();
    if (e.key === 'Enter') {
      if (tool instanceof KnifeTool && tool.state.dragging) {
        e.preventDefault();
        tool.confirm(session.context());
        workspace.input.end('tool');
        viewport?.syncInputControls?.();
        viewport?.invalidate?.();
        return true;
      }
      if (tool instanceof LoopCutTool && tool.state.phase === 'slide') {
        e.preventDefault();
        if (tool.confirm(session.context())) {
          session.tools.setActive('select', session.context());
          workspace.input.end('tool');
          viewport?.syncInputControls?.();
        }
        viewport?.invalidate?.();
        return true;
      }
      if (tool instanceof CreatePrimitiveTool && tool.state.stage !== 'idle') {
        e.preventDefault();
        tool.confirm(session.context());
        viewport?.invalidate?.();
        return true;
      }
      if (tool instanceof CreateDoodleTool && tool.state.stage === 'drawing') {
        e.preventDefault();
        tool.confirm(session.context());
        workspace.setCurveNodeEditMode(false);
        workspace.setSelectedCurvePointIndex(0);
        workspace.input.end('tool');
        viewport?.invalidate?.();
        return true;
      }
      if (tool instanceof DrawPolyTool) {
        e.preventDefault();
        const canCommit =
          tool.topologyMode === 'points'
            ? tool.state.createdInChain.length > 0
            : tool.state.chain.length >= 3;
        if (canCommit) {
          tool.confirm(session.context());
        } else if (tool.state.chain.length === 0) {
          const objectId = tool.finishDraw(session.context());
          session.tools.setActive('select', session.context());
          workspace.input.end('tool');
          if (objectId) {
            session.selection.setMode('object');
            session.selection.selectObjects([objectId], 'replace');
          }
        }
        viewport?.invalidate?.();
        return true;
      }
    }

    if (e.key === 'Backspace') {
      if (tool instanceof CreateDoodleTool && tool.inputMode === 'pen' && tool.state.stage === 'drawing') {
        e.preventDefault();
        tool.popPoint(session.context());
        viewport?.invalidate?.();
        return true;
      }
      if (tool instanceof DrawPolyTool) {
        e.preventDefault();
        if (tool.state.chain.length > 0) {
          tool.popLast(session.context());
        } else {
          commitDeleteSelection(session);
        }
        viewport?.invalidate?.();
        return true;
      }
    }

    if (tool instanceof BlockoutVectorTool) {
      if (
        e.key === 'Enter' ||
        e.key === 'Escape' ||
        e.key === 'Backspace' ||
        e.key === 'Delete' ||
        e.code === 'KeyC'
      ) {
        e.preventDefault();
        tool.onKeyDown(e, session.context());
        if (e.key === 'Enter' && tool.state.points.length === 0) {
          session.transform.setGizmoMode('combined');
        }
        viewport?.invalidate?.();
        return true;
      }
    }

    // 4. Shell-specific shortcuts for Rigging and Animation
    if (workspace.shellMode === 'rig' && actions?.animation) {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.code === 'KeyE' && !e.shiftKey) {
          e.preventDefault();
          const newBoneId = actions.animation.extrudeSelectedBone();
          if (newBoneId) {
            actions.pushToast?.(`Extruded ${actions.animation.getSelectedBoneName() ?? 'bone'}`, 'success');
            actions.refresh?.();
          }
          return true;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          actions.animation.deleteSelectedBone();
          actions.refresh?.();
          return true;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          actions.animation.selectAdjacentBone(e.key === 'ArrowDown' ? 1 : -1);
          actions.refresh?.();
          return true;
        }
        if (e.code === 'KeyM' && !e.shiftKey) {
          e.preventDefault();
          actions.animation.selectMirroredBone();
          actions.refresh?.();
          return true;
        }
        if (actions.animation.editMode === 'weight' && (e.key === '[' || e.key === ']')) {
          e.preventDefault();
          actions.animation.adjustWeightBrushRadius(e.key === ']' ? 1.15 : 0.85);
          actions.refresh?.();
          return true;
        }
      }
    }

    if (workspace.shellMode === 'animate' && actions?.animation) {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.code === 'Space' && !e.shiftKey) {
          e.preventDefault();
          actions.animation.togglePlayback();
          actions.refresh?.();
          return true;
        }
        if (e.code === 'KeyG' && !e.shiftKey) {
          e.preventDefault();
          actions.animation.setGizmoMode('move');
          actions.refresh?.();
          return true;
        }
        if (e.code === 'KeyR' && !e.shiftKey) {
          e.preventDefault();
          actions.animation.setGizmoMode('rotate');
          actions.refresh?.();
          return true;
        }
        if (e.code === 'KeyU' && !e.shiftKey) {
          e.preventDefault();
          actions.animation.setGizmoMode('universal');
          actions.refresh?.();
          return true;
        }
        if (e.code === 'KeyI') {
          e.preventDefault();
          if (e.shiftKey) actions.animation.keyframeAllBones();
          else actions.animation.insertKeyframeForSelectedBone();
          actions.refresh?.();
          return true;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          actions.animation.removeKeyframeForSelectedBone();
          actions.refresh?.();
          return true;
        }
        if (e.key === 'ArrowLeft' && !e.shiftKey) {
          e.preventDefault();
          actions.animation.jumpToPrevKeyframe();
          actions.refresh?.();
          return true;
        }
        if (e.key === 'ArrowRight' && !e.shiftKey) {
          e.preventDefault();
          actions.animation.jumpToNextKeyframe();
          actions.refresh?.();
          return true;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          actions.animation.stepFrame(e.shiftKey ? 10 : 1);
          actions.refresh?.();
          return true;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          actions.animation.stepFrame(e.shiftKey ? -10 : -1);
          actions.refresh?.();
          return true;
        }
        if (actions.animation.editMode === 'weight' && (e.key === '[' || e.key === ']')) {
          e.preventDefault();
          actions.animation.adjustWeightBrushRadius(e.key === ']' ? 1.15 : 0.85);
          actions.refresh?.();
          return true;
        }
      }
    }

    // 5. Dedicated Blender Shortcut Engine (e, i, s, g, r, 1, 2, 3, Tab, A, etc.)
    const handledBlender = handleBlenderShortcut(e, {
      session,
      workspace,
      getCameraAxes: (id) => viewport?.getCameraAxes(id) ?? null,
      getPointerSample: (id) => viewport?.getLastPointerSample(id) ?? null,
      invalidateViewport: () => viewport?.invalidate?.(),
    });
    if (handledBlender) {
      viewport?.syncTransformInteractionState?.();
      if (session.transform.active) {
        viewport?.syncLiveTransform?.();
      } else {
        viewport?.syncGizmo?.();
        viewport?.invalidate?.();
      }
      return true;
    }

    // 6. Viewport camera framing & navigation
    if (
      !session.transform.active &&
      (workspace.shellMode === 'model' ||
        workspace.shellMode === 'animate' ||
        workspace.shellMode === 'rig' ||
        workspace.shellMode === 'blockout')
    ) {
      if (e.code === 'NumpadDecimal' || e.key === '.' || e.key.toLowerCase() === 'f') {
        e.preventDefault();
        viewport?.frameSelection?.();
        return true;
      }
      if (e.key === 'Home' && e.shiftKey) {
        e.preventDefault();
        viewport?.resetView?.();
        return true;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        viewport?.frameAll?.();
        return true;
      }
    }

    // 7. Universal commands (Ctrl/Meta)
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase();
      if (key === 'k' && !e.shiftKey) {
        e.preventDefault();
        actions?.setPaletteOpen?.((open) => !open);
        return true;
      }
      if (key === 'n') {
        e.preventDefault();
        actions?.newProject?.();
        return true;
      }
      if (key === 'o') {
        e.preventDefault();
        actions?.openProject?.();
        return true;
      }
      if (key === 's') {
        e.preventDefault();
        actions?.saveProject?.(e.shiftKey);
        return true;
      }
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const activeTool = session.tools.getActive();
        if (activeTool instanceof DrawPolyTool && activeTool.undoDraw(session.context())) {
          actions?.refresh?.();
          actions?.pushToast?.('Undo', 'info');
          return true;
        }
        if (session.undo()) {
          if (activeTool instanceof DrawPolyTool) activeTool.syncAfterHistory(session.context());
          actions?.refresh?.();
          actions?.pushToast?.('Undo', 'info');
        }
        return true;
      }
      if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        const activeTool = session.tools.getActive();
        if (activeTool instanceof DrawPolyTool && activeTool.redoDraw(session.context())) {
          actions?.refresh?.();
          actions?.pushToast?.('Redo', 'info');
          return true;
        }
        if (session.redo()) {
          if (activeTool instanceof DrawPolyTool) activeTool.syncAfterHistory(session.context());
          actions?.refresh?.();
          actions?.pushToast?.('Redo', 'info');
        }
        return true;
      }
      if (key === 'c') {
        e.preventDefault();
        if (commitCopySelection(session)) {
          actions?.refresh?.();
          actions?.pushToast?.('Copied selection', 'success');
        } else {
          actions?.pushToast?.('Nothing to copy', 'error');
        }
        return true;
      }
      if (key === 'v') {
        e.preventDefault();
        if (commitPasteClipboard(session)) {
          actions?.refresh?.();
          actions?.pushToast?.('Pasted', 'success');
        } else {
          actions?.pushToast?.('Clipboard is empty', 'error');
        }
        return true;
      }
      if (key === 'g') {
        e.preventDefault();
        if (e.shiftKey) {
          if (commitUngroupSelection(session)) {
            actions?.refresh?.();
            actions?.pushToast?.('Ungrouped', 'success');
          } else {
            actions?.pushToast?.('Select a group to ungroup', 'error');
          }
        } else if (commitGroupSelection(session)) {
          actions?.refresh?.();
          actions?.pushToast?.('Grouped', 'success');
        } else {
          actions?.pushToast?.('Select objects to group', 'error');
        }
        return true;
      }
    }

    // 8. Cheatsheet hotkey
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      e.preventDefault();
      actions?.setHotkeysOpen?.((open) => !open);
      return true;
    }

    // 9. Delete selection
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (workspace.shellMode === 'animate' || workspace.shellMode === 'rig') return false;
      e.preventDefault();
      commitDeleteSelection(session);
      viewport?.invalidate?.();
      return true;
    }

    // 10. Space / Shift+Space / N
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.code === 'Space' && e.shiftKey) {
        e.preventDefault();
        actions?.setZenMode?.((open) => !open);
        return true;
      }
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        if (workspace.shellMode === 'texture') {
          workspace.patchTexture({ uvInspectorOpen: !workspace.texture.uvInspectorOpen });
        } else if (workspace.shellMode === 'model') {
          if (actions?.zenMode) {
            actions.setZenMode?.(false);
            actions.setSidebarCollapsed?.(false);
          } else {
            actions?.setSidebarCollapsed?.((prev) => !prev);
          }
        }
        return true;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        workspace.toggleViewportMaximize(workspace.activeViewportId || 'persp');
        viewport?.invalidate?.();
        actions?.refresh?.();
        return true;
      }
    }

    // 11. Tab fallback (viewport maximize if not handled by Blender mode switch)
    if (workspace.input.canHandleTab(e)) {
      e.preventDefault();
      workspace.handleTab();
      viewport?.invalidate?.();
      return true;
    }

    return false;
  }
}

export const masterInputEngine = new MasterInputEngine();
