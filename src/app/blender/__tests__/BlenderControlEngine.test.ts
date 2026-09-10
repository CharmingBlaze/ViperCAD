import { describe, expect, it, vi } from 'vitest';
import {
  beginBlenderOperator,
  blenderIncrementSnap,
  handleBlenderControlKey,
} from '@/app/blender/BlenderControlEngine';
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

function key(name: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: name,
    target: null,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    ...modifiers,
  } as unknown as KeyboardEvent;
}

describe('BlenderControlEngine', () => {
  it('uses Ctrl for increment snap', () => {
    expect(blenderIncrementSnap(false)).toBe(false);
    expect(blenderIncrementSnap(true)).toBe(true);
  });

  it('starts rotate from one operator entry and stays continuous while project snap is on', () => {
    vi.stubGlobal('HTMLElement', class {});
    const document = createEmptyDocument();
    document.settings.snapEnabled = true;
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    const session = new EditorSession(document);
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');
    const workspace = new WorkspaceController();
    const start: PointerSample = {
      screenX: 100,
      screenY: 100,
      rayOrigin: { x: 1, y: 5, z: 0 },
      rayDirection: { x: 0, y: -1, z: 0 },
      viewportId: 'persp',
      shiftKey: false,
      ctrlKey: false,
      camera: {
        right: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 0, z: -1 },
        forward: { x: 0, y: -1, z: 0 },
      },
    };
    const ctx = {
      session,
      workspace,
      getCameraAxes: () => start.camera,
      getPointerSample: () => start,
    };

    expect(beginBlenderOperator('rotate', ctx)).toBe(true);
    session.transform.updatePointer({
      ...start,
      screenX: 112,
      rayOrigin: { x: 0.9, y: 5, z: 0.2 },
    });
    const deg = (document.objects.get(objectId)!.transform.rotation.y * 180) / Math.PI;
    expect(Math.abs(deg)).toBeGreaterThan(0.2);
    expect(Math.abs(deg % 15)).not.toBeCloseTo(0, 1);
  });

  it('routes G through the shared keymap', () => {
    vi.stubGlobal('HTMLElement', class {});
    const document = createEmptyDocument();
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    const session = new EditorSession(document);
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');
    const workspace = new WorkspaceController();

    expect(
      handleBlenderControlKey(key('g'), {
        session,
        workspace,
        getCameraAxes: () => camera,
      }),
    ).toBe(true);
    expect(session.transform.active).toBe(true);
    expect(session.transform.session?.type).toBe('translate');
  });
});
