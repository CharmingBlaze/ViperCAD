import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { DrawPolyTool } from '@/core/tools/DrawPolyTool';
import type { ToolPointerInput } from '@/core/tools/Tool';

function pointer(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  screenX = 100,
  screenY = 100,
  extras: Partial<ToolPointerInput> = {},
): ToolPointerInput {
  return {
    button: 'left',
    screenX,
    screenY,
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

/** Ray from above hitting XZ plane near (x,z). */
function planeClick(x: number, z: number, extras: Partial<ToolPointerInput> = {}): ToolPointerInput {
  return pointer({ x, y: 5, z }, { x: 0, y: -1, z: 0 }, 100 + x * 10, 100 + z * 10, extras);
}

describe('DrawPolyTool', () => {
  it('places verts, closes a face on start click, and undoes as one Draw Face', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(1, 0), session.context());
    tool.begin(planeClick(0, 1), session.context());
    expect(tool.state.chain.length).toBe(3);

    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.vertices.size).toBe(3);
    expect(mesh.faces.size).toBe(0);

    tool.begin(planeClick(0, 0), session.context());
    expect(tool.state.chain.length).toBe(0);
    expect(mesh.faces.size).toBe(1);
    expect(mesh.vertices.size).toBe(3);

    // One undo should remove the whole face (and staged verts from that draw).
    expect(session.undo()).toBe(true);
    expect(mesh.faces.size).toBe(0);
    expect(mesh.vertices.size).toBe(0);
  });

  it('clears the staged chain on Esc without a history entry', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(1, 0), session.context());
    expect(tool.state.chain.length).toBe(2);
    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.vertices.size).toBe(2);

    const canUndoBefore = session.history.canUndo();
    tool.cancel(session.context());
    expect(tool.state.chain.length).toBe(0);
    expect(mesh.faces.size).toBe(0);
    expect(mesh.vertices.size).toBe(0);
    // Esc discard should not add undo steps beyond Create Draw Mesh.
    expect(session.history.canUndo()).toBe(canUndoBefore);
  });

  it('closes with Enter when chain has ≥3 verts', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(2, 0), session.context());
    tool.begin(planeClick(1, 2), session.context());
    tool.confirm(session.context());

    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.faces.size).toBe(1);
    expect(tool.state.chain.length).toBe(0);
    expect(tool.getPreviewInfo(session.context()).allVertexPoints).toHaveLength(3);
    expect(tool.getPreviewInfo(session.context()).allEdgeSegments).toHaveLength(3);
  });

  it('axis-locks the rubber-band with Shift', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.update(planeClick(1, 0.4, { shiftKey: true }), session.context());
    expect(tool.state.axisLocked).toBe(true);
    expect(tool.state.previewPoint).not.toBeNull();
    // Dominant axis is X — Z offset should collapse toward 0.
    expect(Math.abs(tool.state.previewPoint!.z)).toBeLessThan(0.05);
    expect(tool.state.previewPoint!.x).toBeGreaterThan(0.5);
  });

  it('pops the last staged point with Backspace', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(1, 0), session.context());
    tool.begin(planeClick(0, 1), session.context());
    expect(tool.popLast(session.context())).toBe(true);
    expect(tool.state.chain.length).toBe(2);
    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.vertices.size).toBe(2);
  });

  it('reuses old vertices from selection to complete a face', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());

    // First face
    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(1, 0), session.context());
    tool.begin(planeClick(0, 1), session.context());
    tool.confirm(session.context());
    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.faces.size).toBe(1);
    const oldVerts = [...mesh.vertices.keys()];
    expect(oldVerts.length).toBe(3);

    // Seed two old verts, place one new, close
    session.selection.setMode('vertex');
    session.selection.selectVertices([oldVerts[0]!, oldVerts[1]!], 'replace');
    expect(tool.seedFromSelection(session.context())).toBe(true);
    expect(tool.state.chain.length).toBe(2);
    tool.begin(planeClick(1, 1), session.context());
    expect(tool.state.chain.length).toBe(3);
    tool.confirm(session.context());
    expect(mesh.faces.size).toBe(2);
    expect(mesh.vertices.size).toBe(4);
  });

  it('creates front and back faces in double mode', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());
    tool.setFaceMode('double', session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(2, 0), session.context());
    tool.begin(planeClick(1, 2), session.context());
    tool.confirm(session.context());

    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.faces.size).toBe(2);
  });

  it('lays out loose vertices and commits them as one editable batch', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());
    tool.setBuildMode('vertices', session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(2, 0), session.context());
    tool.begin(planeClick(2, 2), session.context());
    tool.confirm(session.context());

    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.vertices.size).toBe(3);
    expect(mesh.faces.size).toBe(0);
    expect(tool.state.chain.length).toBe(0);
    expect(session.selection.state.mode).toBe('vertex');
    expect(session.selection.state.selectedVertexIds.size).toBe(3);

    expect(session.undo()).toBe(true);
    expect(mesh.vertices.size).toBe(0);
  });

  it('places exact world coordinates for precision modelling', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());
    tool.setBuildMode('vertices', session.context());

    expect(tool.placeExactPoint({ x: 1.25, y: -2.5, z: 3.75 }, session.context())).toBe(true);
    const mesh = [...session.document.meshes.values()][0]!;
    const point = [...mesh.vertices.values()][0]!.position;
    expect(point).toEqual({ x: 1.25, y: -2.5, z: 3.75 });

    expect(tool.placeExactPoint({ x: Number.NaN, y: 0, z: 0 }, session.context())).toBe(false);
    expect(mesh.vertices.size).toBe(1);
  });

  it('can explicitly start a new mesh instead of modifying the selected object', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());
    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(1, 0), session.context());
    tool.begin(planeClick(0, 1), session.context());
    tool.confirm(session.context());
    expect(session.document.objects.size).toBe(1);
    const originalObjectId = tool.state.meshObjectId;

    tool.startNewMesh(session.context());
    expect(session.document.objects.size).toBe(2);
    expect(tool.state.meshObjectId).not.toBe(originalObjectId);
    expect(session.selection.state.activeObjectId).toBe(tool.state.meshObjectId);
  });
});
