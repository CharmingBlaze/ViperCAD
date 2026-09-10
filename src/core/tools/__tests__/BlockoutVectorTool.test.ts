import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { v3 } from '@/core/math/Vec3';
import { WORLD_XY_PLANE } from '@/core/snap/SnapEngine';
import { BlockoutVectorTool } from '../BlockoutVectorTool';
import type { ToolPointerInput } from '../Tool';

function pointer(viewportId: string, origin = v3(0, 0, 10), dir = v3(0, 0, -1)): ToolPointerInput {
  return {
    worldPosition: v3(0, 0, 0),
    rayOrigin: origin,
    rayDirection: dir,
    screenX: 0,
    screenY: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    button: 'left',
    viewportId,
  };
}

describe('BlockoutVectorTool', () => {
  it('extrudes a 2D vector silhouette into a 3D solid mesh on Enter', () => {
    const session = new EditorSession();
    const tool = new BlockoutVectorTool();

    // Set up a simple 4-point rectangle silhouette
    tool.state.points = [
      v3(0, 0, 0),
      v3(2, 0, 0),
      v3(2, 2, 0),
      v3(0, 2, 0),
    ];
    tool.state.activePlane = 'front';
    tool.thickness = 1.0;
    tool.symmetric = true;

    const committed = tool.commitExtrude(session.context());
    expect(committed).toBe(true);

    // Verify created mesh in document
    const activeObjId = session.selection.state.activeObjectId;
    expect(activeObjId).toBeTruthy();

    const obj = session.document.objects.get(activeObjId!);
    expect(obj).toBeDefined();

    const mesh = session.document.meshes.get(obj!.meshId!);
    expect(mesh).toBeDefined();

    // 4 points extruded = 8 vertices, 6 faces (2 cap triangles * 2 + 4 side quads = 8 faces)
    expect(mesh!.vertices.size).toBe(8);
    expect(mesh!.faces.size).toBeGreaterThanOrEqual(6);

    // Symmetric extrusion [-0.5, 0.5] along Z, origin at the solid centre
    const zPositions = [...mesh!.vertices.values()].map((v) => v.position.z);
    expect(Math.min(...zPositions)).toBeCloseTo(-0.5);
    expect(Math.max(...zPositions)).toBeCloseTo(0.5);
    expect(obj!.transform.position.x).toBeCloseTo(1);
    expect(obj!.transform.position.y).toBeCloseTo(1);
    expect(obj!.transform.position.z).toBeCloseTo(0);
    expect(session.document.rootObjectIds).toContain(obj!.id);
    const material = session.document.materials.get(obj!.materialSlotIds[0]!);
    expect(material?.baseColourTextureId).toBeTruthy();
  });

  it('rejects extrusion if less than 3 points placed', () => {
    const session = new EditorSession();
    const tool = new BlockoutVectorTool();

    tool.state.points = [v3(0, 0, 0), v3(1, 1, 0)];
    const committed = tool.commitExtrude(session.context());
    expect(committed).toBe(false);
  });

  it('supports Mirror X mode reflecting half-silhouette across centerline', () => {
    const session = new EditorSession();
    const tool = new BlockoutVectorTool();

    // Draw half silhouette: (0, 2, 0) top center -> (1, 1, 0) shoulder -> (0, 0, 0) bottom center
    tool.state.points = [v3(0, 2, 0), v3(1, 1, 0), v3(0, 0, 0)];
    tool.state.activePlane = 'front';
    tool.mirrorX = true;
    tool.thickness = 0.5;

    const committed = tool.commitExtrude(session.context());
    expect(committed).toBe(true);

    const activeObjId = session.selection.state.activeObjectId!;
    const obj = session.document.objects.get(activeObjId)!;
    const mesh = session.document.meshes.get(obj.meshId!)!;

    // 4 points (top, right shoulder, bottom, left shoulder) * 2 = 8 vertices
    expect(mesh.vertices.size).toBe(8);

    const xPositions = [...mesh.vertices.values()].map((v) => v.position.x);
    expect(Math.min(...xPositions)).toBeCloseTo(-1.0);
    expect(Math.max(...xPositions)).toBeCloseTo(1.0);
  });

  it('keeps silhouette points when deactivated', () => {
    const session = new EditorSession();
    const tool = new BlockoutVectorTool();
    tool.state.points = [v3(0, 0, 0), v3(1, 0, 0), v3(1, 1, 0)];
    tool.deactivate(session.context());
    expect(tool.state.points).toHaveLength(3);
  });

  it('places points from perspective onto the construction plane', () => {
    const session = new EditorSession();
    session.constructionPlane = WORLD_XY_PLANE;
    session.constructionPlaneId = 'front';
    const tool = new BlockoutVectorTool();
    tool.onPointerDown(pointer('persp', v3(1, 1, 8), v3(0, 0, -1)), session.context());
    expect(tool.state.points).toHaveLength(1);
    expect(tool.state.activePlane).toBe('front');
    expect(tool.state.points[0]!.z).toBeCloseTo(0);
  });

  it('does not mix Front and Side points on one silhouette', () => {
    const session = new EditorSession();
    const tool = new BlockoutVectorTool();
    tool.onPointerDown(pointer('front'), session.context());
    expect(tool.state.points).toHaveLength(1);
    tool.onPointerDown(pointer('right', v3(10, 0, 0), v3(-1, 0, 0)), session.context());
    expect(tool.state.points).toHaveLength(1);
    expect(tool.state.activePlane).toBe('front');
  });

  it('continues a Front silhouette from perspective', () => {
    const session = new EditorSession();
    const tool = new BlockoutVectorTool();
    tool.onPointerDown(pointer('front', v3(0, 0, 10), v3(0, 0, -1)), session.context());
    tool.onPointerDown(pointer('persp', v3(1.5, 0.8, 6), v3(0, 0, -1)), session.context());
    expect(tool.state.points).toHaveLength(2);
    expect(tool.state.activePlane).toBe('front');
    expect(tool.state.points[1]!.z).toBeCloseTo(0);
    expect(tool.state.points[1]!.x).toBeCloseTo(1.5);
  });

  it('closes the loop when the first vertex is clicked, without requiring it', () => {
    const session = new EditorSession();
    const tool = new BlockoutVectorTool();
    tool.onPointerDown(pointer('front', v3(0, 0, 10), v3(0, 0, -1)), session.context());
    tool.onPointerDown(pointer('front', v3(2, 0, 10), v3(0, 0, -1)), session.context());
    tool.onPointerDown(pointer('front', v3(2, 2, 10), v3(0, 0, -1)), session.context());
    expect(tool.state.closed).toBe(false);
    expect(tool.state.points).toHaveLength(3);

    tool.onPointerDown(pointer('front', v3(0.05, 0.04, 10), v3(0, 0, -1)), session.context());
    expect(tool.state.closed).toBe(true);
    expect(tool.state.stage).toBe('width');
    expect(tool.state.points).toHaveLength(3);
    expect(tool.getPreviewInfo().chainPoints[0]).toEqual(tool.getPreviewInfo().chainPoints.at(-1));
  });

  it('pulls 3D width on drag after the silhouette is closed, then commits on release', () => {
    const session = new EditorSession();
    const tool = new BlockoutVectorTool();
    tool.state.points = [v3(0, 0, 0), v3(2, 0, 0), v3(2, 2, 0), v3(0, 2, 0)];
    tool.state.activePlane = 'front';
    tool.state.closed = true;
    tool.onPointerDown(pointer('persp', v3(1, 1, 4), v3(0, 0.2, -1)), session.context());
    expect(tool.state.stage).toBe('width');
    expect(session.document.objects.size).toBe(0);
    tool.onPointerMove(pointer('persp', v3(1, 1, 3), v3(0.1, 0, -1)), session.context());
    expect(tool.thickness).toBeGreaterThan(0.01);
    tool.onPointerUp(pointer('persp', v3(1, 1, 3), v3(0.1, 0, -1)), session.context());
    expect(session.document.objects.size).toBe(1);
  });

  it('Enter starts a width stage instead of committing immediately', () => {
    const session = new EditorSession();
    const tool = new BlockoutVectorTool();
    tool.state.points = [v3(0, 0, 0), v3(2, 0, 0), v3(2, 2, 0), v3(0, 2, 0)];
    tool.state.activePlane = 'front';
    expect(tool.beginWidthStage(session.context())).toBe(true);
    expect(tool.state.stage).toBe('width');
    expect(session.document.objects.size).toBe(0);
    expect(tool.getPreviewMesh()?.vertices.size).toBeGreaterThan(0);

    tool.onPointerMove(
      pointer('persp', v3(1, 1, 4), v3(0, 0.2, -1)),
      session.context(),
    );
    expect(tool.thickness).toBeGreaterThan(0.01);
    expect(tool.commitExtrude(session.context())).toBe(true);
    expect(session.document.objects.size).toBe(1);
  });

  it('Escape leaves the width stage without deleting the silhouette', () => {
    const session = new EditorSession();
    const tool = new BlockoutVectorTool();
    tool.state.points = [v3(0, 0, 0), v3(2, 0, 0), v3(1, 2, 0)];
    tool.beginWidthStage(session.context());
    tool.onKeyDown(
      { key: 'Escape', preventDefault() {} } as KeyboardEvent,
      session.context(),
    );
    expect(tool.state.stage).toBe('draw');
    expect(tool.state.points).toHaveLength(3);
  });

  it('extrudes an unclosed silhouette of 3 or more points', () => {
    const session = new EditorSession();
    const tool = new BlockoutVectorTool();
    tool.state.points = [v3(0, 0, 0), v3(2, 0, 0), v3(1, 2, 0)];
    tool.state.activePlane = 'front';
    tool.state.closed = false;
    expect(tool.commitExtrude(session.context())).toBe(true);
  });

  it('starts a top-view silhouette on the ground plane', () => {
    const session = new EditorSession();
    const tool = new BlockoutVectorTool();
    tool.onPointerDown(pointer('top', v3(1, 10, 2), v3(0, -1, 0)), session.context());
    expect(tool.state.points).toHaveLength(1);
    expect(tool.state.activePlane).toBe('top');
    expect(tool.state.points[0]!.y).toBeCloseTo(0);
  });

  it('switches to select after a successful extrude', () => {
    const session = new EditorSession();
    session.tools.setActive('blockout-vector', session.context());
    const tool = session.tools.get('blockout-vector') as BlockoutVectorTool;
    tool.state.points = [v3(0, 0, 0), v3(2, 0, 0), v3(2, 2, 0), v3(0, 2, 0)];
    tool.state.activePlane = 'front';
    expect(tool.commitExtrude(session.context())).toBe(true);
    expect(session.tools.getActive()?.id).toBe('select');
  });
});
