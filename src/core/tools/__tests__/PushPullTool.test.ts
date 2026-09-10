import { beforeEach, describe, expect, it } from 'vitest';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { defaultTransform } from '@/core/math/Transform';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { computeFaceNormal } from '@/core/mesh/Normals';
import { PushPullTool } from '@/core/tools/PushPullTool';
import type { ToolPointerInput } from '@/core/tools/Tool';

function pointer(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  extras: Partial<ToolPointerInput> = {},
): ToolPointerInput {
  return {
    button: 'left',
    screenX: 100,
    screenY: 100,
    worldPosition: null,
    rayOrigin: origin,
    rayDirection: direction,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    worldUnitsPerPixel: 0.02,
    ...extras,
  };
}

beforeEach(() => resetIdCounter(1));

function setup() {
  const document = createEmptyDocument();
  const mesh = buildBox({ width: 2, height: 2, depth: 2 });
  const { objectId } = commitMeshObject(document, mesh);
  // Prefer a +Y face so push along world up is easy to assert.
  let faceId = [...mesh.faces.keys()][0]!;
  for (const id of mesh.faces.keys()) {
    const n = computeFaceNormal(mesh, id);
    if (n.y > 0.9) {
      faceId = id;
      break;
    }
  }
  const session = new EditorSession(document);
  session.tools.setActive('push-pull', session.context());
  const tool = session.tools.getActive() as PushPullTool;
  tool.setViewportPick({
    objectId,
    faceId,
    localPoint: { x: 0, y: 1, z: 0 },
    transform: defaultTransform(),
  });
  return { session, mesh, objectId, faceId, tool };
}

describe('PushPullTool', () => {
  it('extrudes a hovered face by drag distance and undoes as one step', () => {
    const { session, mesh, tool } = setup();
    const beforeVerts = mesh.vertices.size;
    const beforeFaces = mesh.faces.size;

    tool.begin(pointer({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }), session.context());
    expect(tool.state.phase).toBe('dragging');
    expect(mesh.vertices.size).toBeGreaterThan(beforeVerts);
    expect(mesh.faces.size).toBeGreaterThan(beforeFaces);

    // Move along +Y: plane at y=1, ray from side toward y=2 on the push plane.
    tool.update(pointer({ x: 4, y: 2, z: 0 }, { x: -1, y: 0, z: 0 }), session.context());
    expect(tool.state.distance).toBeGreaterThan(0.5);

    const midY = Math.max(...[...mesh.vertices.values()].map((v) => v.position.y));
    expect(midY).toBeGreaterThan(1.4);

    tool.confirm(session.context());
    expect(tool.state.phase).toBe('hover');
    expect(session.history.canUndo()).toBe(true);

    session.history.undo();
    expect(mesh.vertices.size).toBe(beforeVerts);
    expect(mesh.faces.size).toBe(beforeFaces);
  });

  it('cancels without history when Esc restores the mesh', () => {
    const { session, mesh, tool } = setup();
    const beforeVerts = mesh.vertices.size;
    const beforeFaces = mesh.faces.size;

    tool.begin(pointer({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }), session.context());
    tool.update(pointer({ x: 4, y: 3, z: 0 }, { x: -1, y: 0, z: 0 }), session.context());
    expect(tool.state.distance).not.toBe(0);

    tool.cancel(session.context());
    expect(tool.state.phase).toBe('hover');
    expect(mesh.vertices.size).toBe(beforeVerts);
    expect(mesh.faces.size).toBe(beforeFaces);
    expect(session.history.canUndo()).toBe(false);
  });

  it('treats a zero-length push as cancel', () => {
    const { session, mesh, tool } = setup();
    const beforeVerts = mesh.vertices.size;

    tool.begin(pointer({ x: 0, y: 5, z: 0 }, { x: 0, y: -1, z: 0 }), session.context());
    tool.confirm(session.context());
    expect(mesh.vertices.size).toBe(beforeVerts);
    expect(session.history.canUndo()).toBe(false);
  });
});
