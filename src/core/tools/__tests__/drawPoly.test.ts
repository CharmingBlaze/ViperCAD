import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { getObjectOrigin } from '@/core/editor/OriginTools';
import { DEFAULT_PLACEHOLDER_IMAGE_NAME } from '@/core/image/DefaultPlaceholderImage';
import { transformPoint } from '@/core/math/Transform';
import { WORLD_XY_PLANE } from '@/core/snap/SnapEngine';
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
  it('defaults to Quad mode and auto-creates a 4-point face on the 4th click', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());

    expect(tool.topologyMode).toBe('quad');
    tool.begin(planeClick(0, 0), session.context());
    expect(tool.state.chain.length).toBe(1);
    tool.begin(planeClick(2, 0), session.context());
    expect(tool.state.chain.length).toBe(2);
    tool.begin(planeClick(2, 2), session.context());
    expect(tool.state.chain.length).toBe(3);

    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.faces.size).toBe(0);

    // 4th click auto-creates the quad face!
    tool.begin(planeClick(0, 2), session.context());
    expect(tool.state.chain.length).toBe(0);
    expect(mesh.faces.size).toBe(1);
    expect(mesh.vertices.size).toBe(4);

    const object = [...session.document.objects.values()][0]!;
    const origin = getObjectOrigin(session.document, object.id);
    expect(origin.x).toBeCloseTo(1, 5);
    expect(origin.y).toBeCloseTo(0, 5);
    expect(origin.z).toBeCloseTo(1, 5);
    const material = session.document.materials.get(object.materialSlotIds[0]!)!;
    expect(material.baseColourTextureId).toBeTruthy();
    const texture = session.document.textures.get(material.baseColourTextureId!)!;
    expect(session.document.images.get(texture.imageAssetId)?.name).toBe(
      DEFAULT_PLACEHOLDER_IMAGE_NAME,
    );

    // Undoing removes the quad face and staged vertices
    expect(session.undo()).toBe(true);
    expect(mesh.faces.size).toBe(0);
    expect(mesh.vertices.size).toBe(0);
  });

  it('auto-creates a Tri face on the 3rd click in Tri mode', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());
    tool.setTopologyMode('tri', session.context());

    tool.begin(planeClick(0, 0), session.context());
    expect(tool.state.chain.length).toBe(1);
    tool.begin(planeClick(2, 0), session.context());
    expect(tool.state.chain.length).toBe(2);

    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.faces.size).toBe(0);

    // 3rd click auto-creates the tri face!
    tool.begin(planeClick(1, 2), session.context());
    expect(tool.state.chain.length).toBe(0);
    expect(mesh.faces.size).toBe(1);
    expect(mesh.vertices.size).toBe(3);
  });

  it('closes a freeform polygon on start click or Enter in N-gon mode', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());
    tool.setTopologyMode('ngon', session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(2, 0), session.context());
    tool.begin(planeClick(3, 1), session.context());
    tool.begin(planeClick(2, 2), session.context());
    tool.begin(planeClick(0, 2), session.context());
    expect(tool.state.chain.length).toBe(5);

    tool.confirm(session.context());
    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.faces.size).toBe(1);
    expect(tool.state.chain.length).toBe(0);
    expect(tool.getPreviewInfo(session.context()).allVertexPoints).toHaveLength(5);
  });

  it('clears the staged chain on Esc without an extra history entry', () => {
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
    expect(session.history.canUndo()).toBe(canUndoBefore);
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
    tool.setTopologyMode('tri', session.context());

    // First face (triangle)
    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(1, 0), session.context());
    tool.begin(planeClick(0, 1), session.context());
    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.faces.size).toBe(1);
    const oldVerts = [...mesh.vertices.keys()];
    expect(oldVerts.length).toBe(3);

    // Seed two old verts, place one new in Tri mode -> auto-creates connected 2nd face!
    session.selection.setMode('vertex');
    session.selection.selectVertices([oldVerts[0]!, oldVerts[1]!], 'replace');
    expect(tool.seedFromSelection(session.context())).toBe(true);
    expect(tool.state.chain.length).toBe(2);
    tool.begin(planeClick(1, 1), session.context());
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
    tool.begin(planeClick(2, 2), session.context());
    tool.begin(planeClick(0, 2), session.context());

    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.faces.size).toBe(2);
  });

  it('lays out loose vertices and commits them as one editable batch in Points mode', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());
    tool.setTopologyMode('points', session.context());

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
    tool.setTopologyMode('points', session.context());

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
    tool.begin(planeClick(1, 1), session.context());
    tool.begin(planeClick(0, 1), session.context());
    expect(session.document.objects.size).toBe(1);
    const originalObjectId = tool.state.meshObjectId;

    tool.startNewMesh(session.context());
    expect(session.document.objects.size).toBe(2);
    expect(tool.state.meshObjectId).not.toBe(originalObjectId);
    expect(session.selection.state.activeObjectId).toBe(tool.state.meshObjectId);
  });

  it('starts in any-view mode so each viewport can supply its own plane', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    expect(tool.planeLock).toBe('view');
    tool.setPlaneLock('front', session.context());
    expect(tool.planeLock).toBe('front');
    tool.setPlaneLock('view', session.context());
    expect(tool.planeLock).toBe('view');
  });

  it('grows a 3D mesh by drawing a second face on the Front plane from a shared edge', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(2, 0), session.context());
    tool.begin(planeClick(2, 2), session.context());
    tool.begin(planeClick(0, 2), session.context());
    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.faces.size).toBe(1);
    expect(mesh.vertices.size).toBe(4);

    session.constructionPlane = WORLD_XY_PLANE;
    session.constructionPlaneId = 'front';

    const frontClick = (x: number, y: number) =>
      pointer({ x, y, z: 8 }, { x: 0, y: 0, z: -1 }, 100 + x * 10, 100 + y * 10);

    tool.begin(frontClick(0, 0), session.context());
    tool.begin(frontClick(2, 0), session.context());
    tool.begin(frontClick(2, 2), session.context());
    tool.begin(frontClick(0, 2), session.context());
    expect(mesh.faces.size).toBe(2);
    expect(mesh.vertices.size).toBe(6);
    const object = [...session.document.objects.values()][0]!;
    const ys = [...mesh.vertices.values()].map(
      (vertex) => transformPoint(vertex.position, object.transform).y,
    );
    expect(Math.max(...ys)).toBeGreaterThan(1);
  });

  it('welds to existing vertices along the click ray even when they sit off the construction plane', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(2, 0), session.context());
    tool.begin(planeClick(2, 2), session.context());
    tool.begin(planeClick(0, 2), session.context());
    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.faces.size).toBe(1);
    expect(mesh.vertices.size).toBe(4);

    const idsBefore = new Set(mesh.vertices.keys());
    // Aim at the far-Z corners from a Front-like ray. Those verts are at z=2 while
    // the XY construction plane hit is at z=0, so plane-distance snap would miss them.
    const rayAt = (x: number, y: number) =>
      pointer({ x, y, z: 10 }, { x: 0, y: 0, z: -1 }, 100 + x * 10, 100 + y * 10, {
        worldUnitsPerPixel: 0.02,
      });

    tool.begin(rayAt(0, 0), session.context());
    tool.begin(rayAt(2, 0), session.context());
    expect(tool.state.chain.every((id) => idsBefore.has(id))).toBe(true);
    expect(tool.state.chain.length).toBe(2);
    expect(mesh.vertices.size).toBe(4);

    tool.begin(rayAt(2, 2), session.context());
    tool.begin(rayAt(1, 2), session.context());
    expect(mesh.faces.size).toBe(2);
    expect(mesh.vertices.size).toBe(6);
  });

  it('hovers existing vertices and continues a new chain from a clicked old vertex', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(2, 0), session.context());
    tool.begin(planeClick(2, 2), session.context());
    tool.begin(planeClick(0, 2), session.context());
    const object = [...session.document.objects.values()][0]!;
    const mesh = session.document.meshes.get(object.meshId!)!;
    const start = [...mesh.vertices.values()].find((vertex) => {
      const world = transformPoint(vertex.position, object.transform);
      return Math.abs(world.x) < 1e-6 && Math.abs(world.z) < 1e-6;
    })!;

    tool.setViewportVertexPick({
      objectId: object.id,
      vertexId: start.id,
      position: { x: 0, y: 0, z: 0 },
    });
    tool.update(planeClick(0, 0), session.context());
    expect(tool.state.hoverVertexId).toBe(start.id);
    expect(tool.state.hoverKind).toBe('continue');
    expect(tool.getPreviewInfo(session.context()).hoverKind).toBe('continue');

    tool.begin(planeClick(0, 0), session.context());
    expect(tool.state.chain).toEqual([start.id]);
    expect(mesh.vertices.size).toBe(4);
  });

  it('merges a near-miss new vertex into an existing vertex on click', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());
    tool.setAutoCommit(false, session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(2, 0), session.context());
    const object = [...session.document.objects.values()][0]!;
    const mesh = session.document.meshes.get(object.meshId!)!;
    const first = [...mesh.vertices.values()].find(
      (vertex) => vertex.position.x === 0 && vertex.position.z === 0,
    )!;
    expect(mesh.vertices.size).toBe(2);

    tool.placeExactPoint({ x: 0.02, y: 0, z: 0.01 }, session.context());
    expect(mesh.vertices.size).toBe(3);
    const created = tool.state.chain[2]!;

    tool.setViewportVertexPick({
      objectId: object.id,
      vertexId: first.id,
      position: { x: 0, y: 0, z: 0 },
    });
    tool.begin(planeClick(0, 0), session.context());
    expect(mesh.vertices.has(created)).toBe(false);
    expect(mesh.vertices.size).toBe(2);
    expect(tool.state.chain[tool.state.chain.length - 1]).toBe(first.id);
  });

  it('Enter finishDraw assigns the default texture and recenters the origin', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());
    tool.setTopologyMode('ngon', session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(2, 0), session.context());
    tool.begin(planeClick(2, 2), session.context());
    tool.confirm(session.context());

    const objectId = tool.finishDraw(session.context());
    expect(objectId).toBeTruthy();
    const object = session.document.objects.get(objectId!)!;
    const origin = getObjectOrigin(session.document, object.id);
    expect(origin.x).toBeCloseTo(1, 5);
    expect(origin.z).toBeCloseTo(1, 5);
    const material = session.document.materials.get(object.materialSlotIds[0]!)!;
    expect(material.baseColourTextureId).toBeTruthy();
  });

  it('undoes and redoes staged points, then undoes a committed face', () => {
    const session = new EditorSession();
    const tool = session.tools.get('draw-poly') as DrawPolyTool;
    session.tools.setActive('draw-poly', session.context());
    tool.setAutoCommit(false, session.context());

    tool.begin(planeClick(0, 0), session.context());
    tool.begin(planeClick(2, 0), session.context());
    tool.begin(planeClick(2, 2), session.context());
    expect(tool.state.chain.length).toBe(3);
    expect(tool.undoDraw(session.context())).toBe(true);
    expect(tool.state.chain.length).toBe(2);
    expect(tool.redoDraw(session.context())).toBe(true);
    expect(tool.state.chain.length).toBe(3);

    tool.confirm(session.context());
    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.faces.size).toBe(1);
    expect(tool.undoDraw(session.context())).toBe(false);
    expect(session.undo()).toBe(true);
    tool.syncAfterHistory(session.context());
    expect(mesh.faces.size).toBe(0);
    expect(session.redo()).toBe(true);
    tool.syncAfterHistory(session.context());
    expect(mesh.faces.size).toBe(1);
  });
});
