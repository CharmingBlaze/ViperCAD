import { beforeEach, describe, expect, it } from 'vitest';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { faceHalfEdgeIds } from '@/core/mesh/EditableMesh';
import { LoopCutTool } from '@/core/tools/LoopCutTool';
import type { ToolPointerInput } from '@/core/tools/Tool';

const pointer: ToolPointerInput = {
  button: 'left',
  screenX: 100,
  screenY: 100,
  worldPosition: null,
  rayOrigin: { x: 0, y: 0, z: 5 },
  rayDirection: { x: 0, y: 0, z: -1 },
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
};

beforeEach(() => resetIdCounter(1));

function setup() {
  const document = createEmptyDocument();
  const mesh = buildBox({ width: 1, height: 1, depth: 1 });
  const { objectId } = commitMeshObject(document, mesh);
  const faceId = [...mesh.faces.keys()][0]!;
  const edgeId = faceHalfEdgeIds(mesh, faceId).map(
    (halfEdgeId) => mesh.halfEdges.get(halfEdgeId)!.edgeId,
  )[0]!;
  const session = new EditorSession(document);
  session.tools.setActive('loop-cut', session.context());
  const tool = session.tools.getActive() as LoopCutTool;
  tool.setViewportPick({ objectId, edgeId });
  tool.update(pointer, session.context());
  return { session, mesh, objectId, edgeId, tool };
}

describe('LoopCutTool', () => {
  it('previews the hovered ring and wheel-adjusted cut count', () => {
    const { session, tool } = setup();
    expect(tool.getPreviewSegments()).toHaveLength(4);

    tool.adjustCutCount(2, session.context());
    expect(tool.state.cutCount).toBe(3);
    expect(tool.getPreviewSegments()).toHaveLength(12);
  });

  it('slides, confirms one undoable multi-cut, and restores on undo', () => {
    const { session, mesh, tool } = setup();
    tool.adjustCutCount(2, session.context());
    tool.begin(pointer, session.context());
    expect(tool.state.phase).toBe('slide');

    tool.update({ ...pointer, screenX: 150 }, session.context());
    expect(tool.state.slide).toBeCloseTo(0.5);

    const beforeFaces = mesh.faces.size;
    expect(tool.confirm(session.context())).toBe(true);
    expect(mesh.faces.size).toBe(beforeFaces + 12);
    expect(session.history.canUndo()).toBe(true);

    session.history.undo();
    expect(mesh.faces.size).toBe(beforeFaces);
  });

  it('cancels without changing topology', () => {
    const { session, mesh, tool } = setup();
    const beforeFaces = mesh.faces.size;
    tool.begin(pointer, session.context());
    tool.update({ ...pointer, screenX: 170 }, session.context());
    tool.cancel(session.context());
    expect(mesh.faces.size).toBe(beforeFaces);
    expect(session.history.canUndo()).toBe(false);
  });
});
