import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleTransformHotkey } from '@/app/TransformHotkeys';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import type { PointerSample } from '@/core/transform/TransformSystem';
import { createTerrain } from '@/core/terrain/Terrain';
import { WorkspaceController } from '@/workspace/WorkspaceController';

const camera = {
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
};

function keyboardEvent(key: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key,
    target: null,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...modifiers,
  } as unknown as KeyboardEvent;
}

afterEach(() => vi.unstubAllGlobals());

describe('G modal move', () => {
  it('anchors to the current perspective cursor so the first movement is applied', () => {
    vi.stubGlobal('HTMLElement', class {});
    const document = createEmptyDocument();
    document.settings.snapEnabled = false;
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    const session = new EditorSession(document);
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');
    const workspace = new WorkspaceController();
    const start: PointerSample = {
      screenX: 100,
      screenY: 100,
      rayOrigin: { x: 0, y: 0, z: 5 },
      rayDirection: { x: 0, y: 0, z: -1 },
      viewportId: 'persp',
      shiftKey: false,
      ctrlKey: false,
      camera,
    };

    expect(
      handleTransformHotkey(
        keyboardEvent('g'),
        session,
        workspace,
        () => camera,
        () => start,
      ),
    ).toBe(true);

    session.transform.updatePointer({
      ...start,
      screenX: 110,
      rayOrigin: { x: 0.1, y: 0, z: 5 },
    });

    expect(document.objects.get(objectId)!.transform.position.x).toBeCloseTo(0.1);
    expect(session.transform.session?.activeViewportId).toBe('persp');
  });

  it('does not steal Ctrl/Cmd+G application shortcuts', () => {
    vi.stubGlobal('HTMLElement', class {});
    const session = new EditorSession(createEmptyDocument());
    const workspace = new WorkspaceController();

    expect(
      handleTransformHotkey(
        keyboardEvent('g', { ctrlKey: true }),
        session,
        workspace,
        () => camera,
      ),
    ).toBe(false);
    expect(session.transform.active).toBe(false);
  });

  it('does not start a mesh transform with G in the animate shell', () => {
    vi.stubGlobal('HTMLElement', class {});
    const document = createEmptyDocument();
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    const session = new EditorSession(document);
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');
    const workspace = new WorkspaceController();
    workspace.setShellMode('animate');

    expect(handleTransformHotkey(keyboardEvent('g'), session, workspace, () => camera)).toBe(false);
    expect(session.transform.active).toBe(false);
  });

  it('starts a mesh transform with G in the blockout shell', () => {
    vi.stubGlobal('HTMLElement', class {});
    const document = createEmptyDocument();
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    const session = new EditorSession(document);
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');
    const workspace = new WorkspaceController();
    workspace.setShellMode('blockout');
    session.tools.setActive('blockout-vector', session.context());

    expect(handleTransformHotkey(keyboardEvent('g'), session, workspace, () => camera)).toBe(true);
    expect(session.transform.active).toBe(true);
    expect(session.tools.getActive()?.id).toBe('select');
  });

  it('switches to vertex with 1 in the blockout shell', () => {
    vi.stubGlobal('HTMLElement', class {});
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    workspace.setShellMode('blockout');

    expect(handleTransformHotkey(keyboardEvent('1'), session, workspace, () => camera)).toBe(true);
    expect(session.tools.getActive()?.id).toBe('select');
    expect(session.selection.state.mode).toBe('vertex');
  });

  it('switches to Sculpt with 1 in the terrain shell', () => {
    vi.stubGlobal('HTMLElement', class {});
    const session = new EditorSession();
    createTerrain(session, { size: 8, resolution: 4 });
    const workspace = new WorkspaceController();
    workspace.setShellMode('terrain');
    session.tools.setActive('select', session.context());

    expect(handleTransformHotkey(keyboardEvent('1'), session, workspace, () => camera)).toBe(true);
    expect(session.tools.getActive()?.id).toBe('terrain-sculpt');
  });

  it('starts a prop transform with G in the terrain shell', () => {
    vi.stubGlobal('HTMLElement', class {});
    const document = createEmptyDocument();
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    const session = new EditorSession(document);
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');
    const workspace = new WorkspaceController();
    workspace.setShellMode('terrain');
    session.tools.setActive('terrain-sculpt', session.context());

    expect(handleTransformHotkey(keyboardEvent('g'), session, workspace, () => camera)).toBe(true);
    expect(session.transform.active).toBe(true);
    expect(session.tools.getActive()?.id).toBe('select');
  });

  it('switches to Round with O in the blockout shell', () => {
    vi.stubGlobal('HTMLElement', class {});
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    workspace.setShellMode('blockout');

    expect(handleTransformHotkey(keyboardEvent('o'), session, workspace, () => camera)).toBe(true);
    expect(session.tools.getActive()?.id).toBe('blockout-round');
  });

  it('switches to Flat with V in the blockout shell', () => {
    vi.stubGlobal('HTMLElement', class {});
    const session = new EditorSession();
    const workspace = new WorkspaceController();
    workspace.setShellMode('blockout');

    expect(handleTransformHotkey(keyboardEvent('v'), session, workspace, () => camera)).toBe(true);
    expect(session.tools.getActive()?.id).toBe('blockout-vector');
  });

  it.each(['Enter', 'NumpadEnter', 'Return'])('confirms G with %s', (confirmKey) => {
    vi.stubGlobal('HTMLElement', class {});
    const document = createEmptyDocument();
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    const session = new EditorSession(document);
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');
    const workspace = new WorkspaceController();

    expect(handleTransformHotkey(keyboardEvent('g'), session, workspace, () => camera)).toBe(true);
    session.transform.setAxisKey('x', false);
    session.transform.appendNumeric('2');
    expect(handleTransformHotkey(keyboardEvent(confirmKey), session, workspace, () => camera)).toBe(true);

    expect(session.transform.active).toBe(false);
    expect(workspace.input.owner).toBe('none');
    expect(document.objects.get(objectId)!.transform.position.x).toBeCloseTo(2);
    expect(session.history.canUndo()).toBe(true);
  });

  it('confirms an active transform even when a property field is focused', () => {
    class InputElement {}
    vi.stubGlobal('HTMLElement', InputElement);
    const document = createEmptyDocument();
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    const session = new EditorSession(document);
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');
    const workspace = new WorkspaceController();
    expect(handleTransformHotkey(keyboardEvent('g'), session, workspace, () => camera)).toBe(true);

    const input = Object.assign(new InputElement(), { tagName: 'INPUT', isContentEditable: false });
    expect(
      handleTransformHotkey(
        keyboardEvent('Enter', { target: input as unknown as EventTarget }),
        session,
        workspace,
        () => camera,
      ),
    ).toBe(true);
    expect(session.transform.active).toBe(false);
    expect(workspace.input.owner).toBe('none');
  });

  it('starts Blender-style Loop Cut with Ctrl+R', () => {
    vi.stubGlobal('HTMLElement', class {});
    const session = new EditorSession(createEmptyDocument());
    const workspace = new WorkspaceController();

    expect(
      handleTransformHotkey(
        keyboardEvent('r', { ctrlKey: true }),
        session,
        workspace,
        () => camera,
      ),
    ).toBe(true);
    expect(session.tools.getActive()?.id).toBe('loop-cut');
    expect(workspace.input.owner).toBe('tool');
  });

  it('starts Blender-style Box Select with B', () => {
    vi.stubGlobal('HTMLElement', class {});
    const session = new EditorSession(createEmptyDocument());
    const workspace = new WorkspaceController();

    expect(handleTransformHotkey(keyboardEvent('b'), session, workspace, () => camera)).toBe(true);
    expect(session.tools.getActive()?.id).toBe('select');
    expect(session.transform.prefs.gizmoMode).toBe('select');
  });

  it('switches to vertex mode with 1 and converts a face selection', () => {
    vi.stubGlobal('HTMLElement', class {});
    const document = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(document, mesh);
    const session = new EditorSession(document);
    session.selection.setMode('face');
    session.selection.selectObjects([objectId], 'replace');
    const faceId = [...mesh.faces.keys()][0]!;
    session.selection.selectFaces([faceId], 'replace');
    const workspace = new WorkspaceController();

    expect(
      handleTransformHotkey(keyboardEvent('1'), session, workspace, () => camera),
    ).toBe(true);
    expect(session.selection.state.mode).toBe('vertex');
    expect(session.selection.state.selectedVertexIds.size).toBe(4);
  });

  it('grows the component selection with Ctrl+=', () => {
    vi.stubGlobal('HTMLElement', class {});
    const document = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(document, mesh);
    const session = new EditorSession(document);
    session.selection.setMode('vertex');
    session.selection.selectObjects([objectId], 'replace');
    session.selection.selectVertices([[...mesh.vertices.keys()][0]!], 'replace');
    const workspace = new WorkspaceController();

    expect(
      handleTransformHotkey(
        keyboardEvent('=', { ctrlKey: true }),
        session,
        workspace,
        () => camera,
      ),
    ).toBe(true);
    expect(session.selection.state.selectedVertexIds.size).toBeGreaterThan(1);
  });
});
