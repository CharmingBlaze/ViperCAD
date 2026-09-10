import { describe, expect, it, vi } from 'vitest';
import {
  blenderIncrementSnap,
  handleBlenderShortcut,
  type BlenderShortcutContext,
} from '@/app/input/BlenderShortcutEngine';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { WorkspaceController } from '@/workspace/WorkspaceController';
import { prepareTileDraw } from '@/app/tilesetWorkspace';
import { TileDrawTool } from '@/core/tools/TileDrawTool';

const camera = {
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
};

function key(name: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: name,
    code: `Key${name.toUpperCase()}`,
    target: null,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...modifiers,
  } as unknown as KeyboardEvent;
}

function setupTestScene() {
  vi.stubGlobal('HTMLElement', class {});
  const document = createEmptyDocument();
  const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
  const session = new EditorSession(document);
  session.selection.setMode('object');
  session.selection.selectObjects([objectId], 'replace');
  const workspace = new WorkspaceController();
  const invalidateViewport = vi.fn();
  const ctx: BlenderShortcutContext = {
    session,
    workspace,
    getCameraAxes: () => camera,
    getPointerSample: () => null,
    invalidateViewport,
  };
  return { document, objectId, session, workspace, invalidateViewport, ctx };
}

describe('BlenderShortcutEngine', () => {
  it('increment snap returns ctrl key state', () => {
    expect(blenderIncrementSnap(false)).toBe(false);
    expect(blenderIncrementSnap(true)).toBe(true);
  });

  describe('Fast Mode Switching (1, 2, 3)', () => {
    it('switches to vertex mode on "1" and triggers immediate redraw', () => {
      const { session, ctx, invalidateViewport } = setupTestScene();
      const redrawSpy = vi.fn();
      session.onRedraw(redrawSpy);

      const handled = handleBlenderShortcut(key('1'), ctx);
      expect(handled).toBe(true);
      expect(session.selection.state.mode).toBe('vertex');
      expect(redrawSpy).toHaveBeenCalled();
      expect(invalidateViewport).toHaveBeenCalled();
    });

    it('switches to edge mode on "2"', () => {
      const { session, ctx } = setupTestScene();
      const handled = handleBlenderShortcut(key('2'), ctx);
      expect(handled).toBe(true);
      expect(session.selection.state.mode).toBe('edge');
    });

    it('switches to face mode on "3"', () => {
      const { session, ctx } = setupTestScene();
      const handled = handleBlenderShortcut(key('3'), ctx);
      expect(handled).toBe(true);
      expect(session.selection.state.mode).toBe('face');
    });

    it('automatically enables combined gizmo if currently select mode', () => {
      const { session, ctx } = setupTestScene();
      session.transform.setGizmoMode('select');
      handleBlenderShortcut(key('1'), ctx);
      expect(session.transform.prefs.gizmoMode).toBe('combined');
    });
  });

  describe('Blender Tab Toggle', () => {
    it('toggles from object mode into edit mode when object is selected', () => {
      const { session, ctx } = setupTestScene();
      expect(session.selection.state.mode).toBe('object');
      const handled = handleBlenderShortcut(key('Tab'), ctx);
      expect(handled).toBe(true);
      expect(session.selection.state.mode).toBe('vertex');
    });

    it('toggles from component mode back to object mode', () => {
      const { session, ctx } = setupTestScene();
      handleBlenderShortcut(key('3'), ctx);
      expect(session.selection.state.mode).toBe('face');

      const handled = handleBlenderShortcut(key('Tab'), ctx);
      expect(handled).toBe(true);
      expect(session.selection.state.mode).toBe('object');
    });

    it('returns false when in object mode and no object is selected', () => {
      const { session, ctx } = setupTestScene();
      session.selection.clear();
      const handled = handleBlenderShortcut(key('Tab'), ctx);
      expect(handled).toBe(false);
      expect(session.selection.state.mode).toBe('object');
    });
  });

  describe('Blender Selection Chords (A / Alt+A)', () => {
    it('selects all objects on A in object mode, and deselects on Alt+A', () => {
      const { session, ctx } = setupTestScene();
      session.selection.clear();
      expect(session.selection.state.selectedObjectIds.size).toBe(0);

      // A: Select All
      handleBlenderShortcut(key('a'), ctx);
      expect(session.selection.state.selectedObjectIds.size).toBe(1);

      // Alt+A: Deselect All
      handleBlenderShortcut(key('a', { altKey: true }), ctx);
      expect(session.selection.state.selectedObjectIds.size).toBe(0);
    });

    it('selects all vertices on A in vertex mode, and toggles to deselect if all selected', () => {
      const { session, ctx, objectId } = setupTestScene();
      handleBlenderShortcut(key('1'), ctx);
      const mesh = session.document.meshes.get(session.document.objects.get(objectId)!.meshId!)!;
      expect(session.selection.state.selectedVertexIds.size).toBe(0);

      // A: Select all vertices
      handleBlenderShortcut(key('a'), ctx);
      expect(session.selection.state.selectedVertexIds.size).toBe(mesh.vertices.size);

      // A: When all are selected, A toggles to clear
      handleBlenderShortcut(key('a'), ctx);
      expect(session.selection.state.selectedVertexIds.size).toBe(0);
    });
  });

  describe('Modal Transforms (G, R, S)', () => {
    it('starts translate on G', () => {
      const { session, ctx } = setupTestScene();
      const handled = handleBlenderShortcut(key('g'), ctx);
      expect(handled).toBe(true);
      expect(session.transform.active).toBe(true);
      expect(session.transform.session?.type).toBe('translate');
    });

    it('handles axis constraints during active modal transform', () => {
      const { session, ctx } = setupTestScene();
      handleBlenderShortcut(key('g'), ctx);
      expect(session.transform.active).toBe(true);

      // Press X to lock X axis
      const handledX = handleBlenderShortcut(key('x'), ctx);
      expect(handledX).toBe(true);
      expect(session.transform.session?.axisConstraint).toBe('x');

      // Press Escape to cancel
      const handledEsc = handleBlenderShortcut(key('Escape'), ctx);
      expect(handledEsc).toBe(true);
      expect(session.transform.active).toBe(false);
    });

    it('uses G as Grab brush in sculpt instead of translate', () => {
      const { session, workspace, ctx } = setupTestScene();
      workspace.setShellMode('sculpt');
      const handled = handleBlenderShortcut(key('g'), ctx);
      expect(handled).toBe(true);
      expect(session.transform.active).toBe(false);
      expect(session.tools.getActive()?.id).toBe('mesh-sculpt');
    });

    it('keeps 3D tile draw modes on B/X instead of select/erase conflicts', () => {
      const { session, workspace, ctx } = setupTestScene();
      expect(prepareTileDraw(session, workspace)).toBe(true);
      expect(handleBlenderShortcut(key('x'), ctx)).toBe(true);
      expect(session.tools.getActive()?.id).toBe('tile-draw');
      expect((session.tools.getActive() as TileDrawTool).config.mode).toBe('erase');
      expect(handleBlenderShortcut(key('b'), ctx)).toBe(true);
      expect((session.tools.getActive() as TileDrawTool).config.mode).toBe('paint');
    });
  });
});
