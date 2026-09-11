import { describe, expect, it, vi } from 'vitest';
import { masterInputEngine } from '@/app/input/MasterInputEngine';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { WorkspaceController } from '@/workspace/WorkspaceController';
import { isBoundaryEdge, removeFace } from '@/core/mesh/EditableMesh';

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

function setupTest() {
  vi.stubGlobal('HTMLElement', class {});
  const document = createEmptyDocument();
  const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
  const session = new EditorSession(document);
  session.selection.setMode('object');
  session.selection.selectObjects([objectId], 'replace');
  const workspace = new WorkspaceController();

  const viewport = {
    getCameraAxes: () => ({
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
    }),
    getLastPointerSample: () => null,
    syncTransformInteractionState: vi.fn(),
    syncLiveTransform: vi.fn(),
    syncGizmo: vi.fn(),
    invalidate: vi.fn(),
    frameSelection: vi.fn(),
    frameAll: vi.fn(),
    resetView: vi.fn(),
    getModelPlacement: () => null,
    cancelModelPlacement: vi.fn(),
    syncInputControls: vi.fn(),
  };

  const actions = {
    refresh: vi.fn(),
    pushToast: vi.fn(),
    setHotkeysOpen: vi.fn(),
    setPaletteOpen: vi.fn(),
    setPropertiesOpen: vi.fn(),
    setZenMode: vi.fn(),
    setSidebarCollapsed: vi.fn(),
    newProject: vi.fn(),
    saveProject: vi.fn(),
    openProject: vi.fn(),
    hotkeysOpen: false,
    zenMode: false,
    modelQuickToolsOpen: false,
    setModelQuickToolsOpen: vi.fn(),
  };

  masterInputEngine.setContext({
    session,
    workspace,
    viewport,
    actions,
  });

  return { session, workspace, viewport, actions, objectId };
}

describe('MasterInputEngine', () => {
  it('does not intercept shortcuts when target is an input field', () => {
    setupTest();
    class MockInputElement {}
    vi.stubGlobal('HTMLElement', MockInputElement);
    const mockInput = Object.create(MockInputElement.prototype);
    mockInput.tagName = 'INPUT';

    const inputEvent = {
      ...key('g'),
      target: mockInput,
    };
    const handled = masterInputEngine.handleKeyDown(inputEvent);
    expect(handled).toBe(false);
  });

  it('routes Blender transform shortcuts through to BlenderShortcutEngine', () => {
    const { session, viewport } = setupTest();
    const handled = masterInputEngine.handleKeyDown(key('g'));
    expect(handled).toBe(true);
    expect(session.transform.active).toBe(true);
    expect(viewport.syncTransformInteractionState).toHaveBeenCalled();
  });

  it('cancels active modal transform on right-click contextmenu', () => {
    const { session, viewport } = setupTest();
    masterInputEngine.handleKeyDown(key('g'));
    expect(session.transform.active).toBe(true);

    const preventDefault = vi.fn();
    const handled = masterInputEngine.handleContextMenu({
      preventDefault,
    } as unknown as MouseEvent);

    expect(handled).toBe(true);
    expect(session.transform.active).toBe(false);
    expect(preventDefault).toHaveBeenCalled();
    expect(viewport.invalidate).toHaveBeenCalled();
  });

  it('frames the selection with F in Object mode', () => {
    const { viewport } = setupTest();
    const handled = masterInputEngine.handleKeyDown(key('f'));
    expect(handled).toBe(true);
    expect(viewport.frameSelection).toHaveBeenCalled();
  });

  it('frames the selection with Numpad .', () => {
    const { viewport } = setupTest();
    const handled = masterInputEngine.handleKeyDown(key('.', { code: 'NumpadDecimal' }));
    expect(handled).toBe(true);
    expect(viewport.frameSelection).toHaveBeenCalled();
  });

  it('uses F to fill in edit mode instead of framing', () => {
    const { session, viewport, objectId } = setupTest();
    const mesh = session.document.meshes.get(session.document.objects.get(objectId)!.meshId!)!;
    const faceId = [...mesh.faces.keys()][0]!;
    removeFace(mesh, faceId);
    const seed = [...mesh.edges.keys()].find((id) => isBoundaryEdge(mesh, id))!;
    session.selection.switchEditMode('edge', mesh);
    session.selection.selectEdges([seed], 'replace');
    const facesBefore = mesh.faces.size;

    const handled = masterInputEngine.handleKeyDown(key('f'));
    expect(handled).toBe(true);
    expect(viewport.frameSelection).not.toHaveBeenCalled();
    expect(mesh.faces.size).toBe(facesBefore + 1);
  });

  it('routes universal hotkeys like Ctrl+Z and Ctrl+Y', () => {
    const { session, actions } = setupTest();
    const undoSpy = vi.spyOn(session, 'undo').mockReturnValue(true);

    const handled = masterInputEngine.handleKeyDown(key('z', { ctrlKey: true }));
    expect(handled).toBe(true);
    expect(undoSpy).toHaveBeenCalled();
    expect(actions.refresh).toHaveBeenCalled();
  });

  it('routes command palette (Ctrl+K)', () => {
    const { actions } = setupTest();
    const handled = masterInputEngine.handleKeyDown(key('k', { ctrlKey: true }));
    expect(handled).toBe(true);
    expect(actions.setPaletteOpen).toHaveBeenCalled();
  });

  it('routes properties (Ctrl+,)', () => {
    const { actions } = setupTest();
    const handled = masterInputEngine.handleKeyDown(key(',', { ctrlKey: true }));
    expect(handled).toBe(true);
    expect(actions.setPropertiesOpen).toHaveBeenCalled();
  });

  it('routes flip and mirror tools panel (Shift+M)', () => {
    const { actions } = setupTest();
    const setModelToolsSpy = vi.fn();
    actions.setModelQuickToolsOpen = setModelToolsSpy;

    const handled = masterInputEngine.handleKeyDown(key('M', { shiftKey: true, code: 'KeyM' }));
    expect(handled).toBe(true);
    expect(setModelToolsSpy).toHaveBeenCalled();
  });
});
