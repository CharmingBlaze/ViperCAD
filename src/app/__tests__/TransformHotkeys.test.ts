import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleTransformHotkey } from '@/app/TransformHotkeys';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import type { PointerSample } from '@/core/transform/TransformSystem';
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
});
