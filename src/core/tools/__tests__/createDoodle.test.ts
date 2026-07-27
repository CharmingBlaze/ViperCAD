import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { CreateDoodleTool, smoothDoodlePoints } from '@/core/tools/CreateDoodleTool';
import { v3 } from '@/core/math/Vec3';
import type { ToolPointerInput } from '@/core/tools/Tool';
import { readCurveOperation } from '@/core/curves/CurveOperation';

function pointer(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  screenX = 100,
  screenY = 100,
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
  };
}

describe('CreateDoodleTool', () => {
  it('commits a doodle mesh on confirm and undoes it', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setDepthHint(4);

    tool.begin(pointer({ x: 0, y: 2, z: 4 }, { x: 0, y: 0, z: -1 }, 40, 40), session.context());
    expect(tool.state.stage).toBe('drawing');

    tool.update(pointer({ x: 0, y: 2, z: 4 }, { x: 0.2, y: 0, z: -1 }, 80, 40), session.context());
    tool.update(pointer({ x: 0, y: 2, z: 4 }, { x: 0.4, y: 0.1, z: -1 }, 120, 50), session.context());
    expect(tool.state.points.length).toBeGreaterThanOrEqual(2);

    tool.confirm(session.context());
    expect(tool.state.stage).toBe('idle');
    expect(session.document.objects.size).toBe(1);
    expect(session.document.meshes.size).toBe(1);
    const object = [...session.document.objects.values()][0]!;
    const operation = readCurveOperation(object.metadata.curveOperation);
    expect(operation?.style).toBe('soft');
    expect(operation?.points.length).toBeGreaterThanOrEqual(2);
    expect(Math.hypot(object.transform.position.x, object.transform.position.y, object.transform.position.z))
      .toBeGreaterThan(0.5);
    const mesh = session.document.meshes.get(object.meshId!)!;
    const zs = [...mesh.vertices.values()].map((vertex) => vertex.position.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(2);
    expect(session.history.canUndo()).toBe(true);

    expect(session.undo()).toBe(true);
    expect(session.document.objects.size).toBe(0);
    expect(session.redo()).toBe(true);
    expect(session.document.objects.size).toBe(1);
  });

  it('leaves Vector Pen ready for another stroke after confirm', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setInputMode('pen', session.context());
    tool.setStyle('sharp', session.context());
    const origin = { x: 0, y: 0, z: 4 };

    tool.begin(pointer(origin, { x: -0.4, y: 0.2, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 0.4, y: 0.2, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 0, y: -0.4, z: -1 }), session.context());
    tool.confirm(session.context());

    expect(tool.state.stage).toBe('idle');
    expect(tool.state.points).toHaveLength(0);
    expect(session.selection.state.selectedObjectIds.size).toBe(0);

    tool.begin(pointer(origin, { x: -0.2, y: 0.35, z: -1 }), session.context());
    expect(tool.state.stage).toBe('drawing');
    expect(tool.state.points).toHaveLength(1);
  });

  it('cancels an in-progress stroke without committing', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.begin(pointer({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: -1 }), session.context());
    tool.update(pointer({ x: 0, y: 0, z: 5 }, { x: 0.3, y: 0, z: -1 }, 90, 40), session.context());
    tool.cancel(session.context());
    expect(tool.state.stage).toBe('idle');
    expect(session.document.objects.size).toBe(0);
  });

  it('inflates when the stroke end connects back to the start', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.radius = 0.1;
    tool.setDepthHint(4);

    // Draw a rough circle in front of the camera (ray origin fixed, vary direction).
    const origin = { x: 0, y: 0, z: 4 };
    const dirs = [
      { x: 0, y: 0.5, z: -1 },
      { x: 0.45, y: 0.25, z: -1 },
      { x: 0.5, y: -0.2, z: -1 },
      { x: 0.1, y: -0.5, z: -1 },
      { x: -0.4, y: -0.25, z: -1 },
      { x: -0.45, y: 0.2, z: -1 },
      { x: -0.05, y: 0.48, z: -1 }, // near start
    ];
    tool.begin(pointer(origin, dirs[0]!, 50, 20), session.context());
    for (let i = 1; i < dirs.length; i++) {
      tool.update(pointer(origin, dirs[i]!, 50 + i * 10, 20 + i * 5), session.context());
    }
    expect(tool.state.closed).toBe(true);
    tool.confirm(session.context());
    expect(session.document.objects.size).toBe(1);
    const mesh = [...session.document.meshes.values()][0]!;
    // Inflated solid has front+back rings; more faces than a short open tube of same samples.
    expect(mesh.faces.size).toBeGreaterThan(20);
  });

  it('auto-closes and fills an unfinished sharp outline on release', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setStyle('sharp', session.context());
    tool.radius = 0.1;
    tool.setDepthHint(4);

    const origin = { x: 0, y: 0, z: 4 };
    tool.begin(pointer(origin, { x: -0.4, y: 0.4, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 0.45, y: 0.35, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 0.35, y: -0.4, z: -1 }), session.context());
    tool.update(pointer(origin, { x: -0.3, y: -0.35, z: -1 }), session.context());
    expect(tool.state.closed).toBe(true);

    tool.confirm(session.context());
    const mesh = [...session.document.meshes.values()][0]!;
    expect(mesh.faces.size).toBeGreaterThan(16);
  });

  it('samples filled outlines on one stable drawing plane', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setDepthHint(4);
    const origin = { x: 0, y: 0, z: 4 };
    tool.begin(pointer(origin, { x: 0, y: 0, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 0.5, y: 0.2, z: -1 }), session.context());
    tool.update(pointer(origin, { x: -0.4, y: 0.3, z: -1 }), session.context());
    const zValues = tool.state.points.map((point) => point.z);
    expect(Math.max(...zValues) - Math.min(...zValues)).toBeLessThan(1e-6);
  });

  it('exposes the live source guide while freehand Sketch drawing', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setStyle('tube', session.context());
    const origin = { x: 0, y: 0, z: 4 };
    tool.begin(pointer(origin, { x: -0.3, y: 0.1, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 0, y: 0.35, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 0.35, y: 0, z: -1 }), session.context());

    const guide = tool.getDraftOperation();
    expect(guide).toMatchObject({
      inputMode: 'sketch',
      style: 'tube',
    });
    expect(guide!.points.length).toBeGreaterThanOrEqual(2);
  });

  it('smooths an open stroke while preserving both endpoints', () => {
    const points = [v3(0, 0, 0), v3(1, 0.5, 0), v3(2, -0.5, 0), v3(3, 0, 0)];
    const smooth = smoothDoodlePoints(points, false, 2);
    expect(smooth[0]).toEqual(points[0]);
    expect(smooth[smooth.length - 1]).toEqual(points[points.length - 1]);
    expect(Math.abs(smooth[1]!.y)).toBeLessThan(Math.abs(points[1]!.y));
    expect(Math.abs(smooth[2]!.y)).toBeLessThan(Math.abs(points[2]!.y));
  });

  it('preserves the overall size of a smoothed closed outline', () => {
    const points = [v3(-1, -1, 0), v3(1, -1.2, 0), v3(1.1, 1, 0), v3(-1, 1.1, 0)];
    const smooth = smoothDoodlePoints(points, true, 2);
    const radius = (values: typeof points) =>
      values.reduce((sum, point) => sum + Math.hypot(point.x, point.y), 0) / values.length;
    expect(radius(smooth)).toBeCloseTo(radius(points), 1);
  });

  it('builds a precise Vector Pen sweep from click-by-click control points', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setInputMode('pen', session.context());
    tool.setStyle('rail-sweep', session.context());
    const origin = { x: 0, y: 0, z: 4 };

    tool.begin(pointer(origin, { x: -0.35, y: 0.2, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 0, y: 0.45, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 0, y: 0.45, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 0.4, y: 0.1, z: -1 }), session.context());
    expect(tool.state.points).toHaveLength(3);

    tool.popPoint(session.context());
    expect(tool.state.points).toHaveLength(2);
    tool.begin(pointer(origin, { x: 0.4, y: -0.15, z: -1 }), session.context());
    tool.confirm(session.context());

    const object = [...session.document.objects.values()][0]!;
    const operation = readCurveOperation(object.metadata.curveOperation);
    expect(operation).toMatchObject({
      style: 'rail-sweep',
      inputMode: 'pen',
    });
    expect(operation?.points).toHaveLength(3);
  });

  it('keeps Vector Pen draft nodes and Bézier handles editable before finish', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setInputMode('pen', session.context());
    tool.setCurveType('bezier', session.context());
    tool.setStyle('ribbon', session.context());
    const origin = { x: 0, y: 0, z: 4 };

    tool.begin(pointer(origin, { x: -0.4, y: -0.2, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 0, y: 0.45, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 0.45, y: -0.1, z: -1 }), session.context());
    const before = tool.getDraftOperation()!;
    expect(before.points).toHaveLength(3);

    const movedHandle = {
      ...tool.state.handlesOut[0]!,
      y: tool.state.handlesOut[0]!.y + 0.75,
    };
    tool.updateDraftControl(
      { kind: 'handle-out', index: 0 },
      movedHandle,
      session.context(),
    );
    tool.setDraftPointCoordinate(1, 'x', 1.234567891, session.context());
    const edited = tool.getDraftOperation()!;
    expect(edited.handlesOut[0]).toEqual(movedHandle);
    expect(edited.points[1]!.x).toBe(1.234567891);
    expect(tool.getPreviewMesh()?.vertices.size).toBeGreaterThan(0);

    tool.confirm(session.context());
    const object = [...session.document.objects.values()][0]!;
    const committed = readCurveOperation(object.metadata.curveOperation)!;
    expect(committed.points[1]!.x + object.transform.position.x).toBeCloseTo(1.234567891, 5);
    expect(committed.handlesOut[0]!.x + object.transform.position.x).toBeCloseTo(movedHandle.x, 5);
    expect(committed.handlesOut[0]!.y + object.transform.position.y).toBeCloseTo(movedHandle.y, 5);
    expect(committed.handlesOut[0]!.z + object.transform.position.z).toBeCloseTo(movedHandle.z, 5);
  });

  it('can begin another stroke after confirm while the doodle tool stays active', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setDepthHint(4);
    tool.begin(pointer({ x: 0, y: 2, z: 4 }, { x: 0, y: 0, z: -1 }, 40, 40), session.context());
    tool.update(pointer({ x: 0, y: 2, z: 4 }, { x: 0.4, y: 0.1, z: -1 }, 120, 50), session.context());
    tool.confirm(session.context());
    expect(tool.state.stage).toBe('idle');
    expect(session.document.objects.size).toBe(1);
    expect(session.tools.getActive()).toBe(tool);

    tool.begin(pointer({ x: 1, y: 2, z: 4 }, { x: 0, y: 0, z: -1 }, 40, 40), session.context());
    expect(tool.state.stage).toBe('drawing');
    expect(tool.state.points.length).toBe(1);
  });

  it('lets locked sketch strokes edit points before finish', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setInputMode('sketch', session.context());
    const origin = { x: 0, y: 0, z: 4 };

    tool.begin(pointer(origin, { x: 0, y: 0, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 0.5, y: 0, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 1, y: 0.2, z: -1 }), session.context());
    tool.lockSketchStroke(session.context());

    expect(tool.state.strokeLocked).toBe(true);
    expect(tool.isSketchStrokeLocked()).toBe(true);
    expect(tool.isDraftNodeEditing()).toBe(false);
    tool.setDraftPointCoordinate(1, 'y', 0.75, session.context());
    expect(tool.state.points[1]!.y).toBe(0.75);
  });

  it('does not auto-close a Vector Pen outline until the cursor returns to the start', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setInputMode('pen', session.context());
    tool.setStyle('sharp', session.context());
    tool.radius = 0.08;
    const origin = { x: 0, y: 0, z: 4 };

    tool.begin(pointer(origin, { x: -1.2, y: 0, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 1.2, y: 0, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 0, y: 0.2, z: -1 }), session.context());
    expect(tool.state.closed).toBe(false);

    tool.update(pointer(origin, { x: -1.2, y: 0.01, z: -1 }), session.context());
    expect(tool.state.closed).toBe(true);
  });

  it('closes a freehand sketch when releasing near the start point', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setInputMode('sketch', session.context());
    tool.setStyle('profile-solid', session.context());
    tool.radius = 0.1;
    tool.autoConnect = true;
    const origin = { x: 0, y: 0, z: 4 };

    tool.begin(pointer(origin, { x: 0, y: 0, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 1, y: 0, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 1, y: 0.8, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 0.02, y: 0.02, z: -1 }), session.context());
    tool.lockSketchStroke(session.context());

    expect(tool.state.closed).toBe(true);
    expect(tool.state.points[0]).toEqual(tool.state.points[tool.state.points.length - 1]);
    expect(tool.isClosedStroke()).toBe(true);
  });

  it('snaps a Vector Pen Capsule exactly to its first point when Auto Connect is enabled', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setInputMode('pen', session.context());
    tool.setStyle('capsule', session.context());
    tool.radius = 0.1;
    const origin = { x: 0, y: 0, z: 4 };
    const firstRay = { x: -0.35, y: 0.2, z: -1 };

    tool.begin(pointer(origin, firstRay), session.context());
    tool.begin(pointer(origin, { x: 0.1, y: 0.5, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 0.45, y: -0.15, z: -1 }), session.context());
    const first = { ...tool.state.points[0]! };
    tool.update(pointer(origin, { x: -0.345, y: 0.205, z: -1 }), session.context());

    expect(tool.state.closed).toBe(true);
    expect(tool.state.previewPoint).toEqual(first);

    tool.setAutoConnect(false, session.context());
    tool.update(pointer(origin, { x: -0.345, y: 0.205, z: -1 }), session.context());
    expect(tool.state.closed).toBe(false);
    expect(tool.state.previewPoint).not.toEqual(first);
  });

  it('Blockout Sketch does not auto-close at 3 points; needs 4+ near start or Close loop', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setCreateContext('workflows', 'sketch', session.context());
    tool.setInputMode('pen', session.context());
    tool.setCurveType('polyline', session.context());
    tool.setStyle('profile-solid', session.context());
    tool.setAutoConnect(true, session.context());
    tool.radius = 0.22;
    const origin = { x: 0, y: 0, z: 4 };

    tool.begin(pointer(origin, { x: 0, y: 0, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 1, y: 0, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 1, y: 1, z: -1 }), session.context());
    expect(tool.state.points).toHaveLength(3);
    expect(tool.canCloseLoop()).toBe(true);

    // Hover near start while still on 3 points — must NOT snap-close.
    tool.update(pointer(origin, { x: 0.05, y: 0.05, z: -1 }), session.context());
    expect(tool.state.closed).toBe(false);
    expect(tool.state.previewPoint).not.toEqual(tool.state.points[0]);

    // Fourth corner (away from start).
    tool.begin(pointer(origin, { x: 0, y: 1, z: -1 }), session.context());
    expect(tool.state.points).toHaveLength(4);
    expect(tool.state.closed).toBe(false);

    // Now near start with 4 points — snap preview allowed.
    tool.update(pointer(origin, { x: 0.02, y: 0.02, z: -1 }), session.context());
    expect(tool.state.previewPoint).toEqual(tool.state.points[0]);
    expect(tool.state.closed).toBe(true);

    const before = session.document.objects.size;
    expect(tool.closeLoop(session.context())).toBe(true);
    expect(tool.state.stage).toBe('idle');
    expect(session.document.objects.size).toBe(before + 1);
  });

  it('Blockout Poly click-close keeps all four square corners (not a triangle)', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setCreateContext('workflows', 'sketch', session.context());
    tool.setInputMode('pen', session.context());
    tool.setCurveType('polyline', session.context());
    tool.setStyle('profile-solid', session.context());
    tool.setAutoConnect(true, session.context());
    tool.blockoutPolyMode = true;
    tool.radius = 0.28;
    const origin = { x: 0, y: 0, z: 4 };

    tool.begin(pointer(origin, { x: 0, y: 0, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 2, y: 0, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 2, y: 2, z: -1 }), session.context());
    tool.begin(pointer(origin, { x: 0, y: 2, z: -1 }), session.context());
    expect(tool.state.points).toHaveLength(4);

    // Click near start to close — must keep 4 unique corners.
    tool.begin(pointer(origin, { x: 0.01, y: 0.01, z: -1 }), session.context());
    expect(tool.state.stage).toBe('idle');
    expect(session.document.objects.size).toBe(1);

    const object = [...session.document.objects.values()][0]!;
    const operation = readCurveOperation(object.metadata.curveOperation);
    expect(operation).not.toBeNull();
    expect(operation!.cyclic).toBe(true);
    // Stored closed polys drop the duplicate end point: A,B,C,D (4 unique corners).
    expect(operation!.points).toHaveLength(4);
    const unique = new Set(
      operation!.points.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`),
    );
    expect(unique.size).toBe(4);
  });
});
