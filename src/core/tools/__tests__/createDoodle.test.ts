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
    expect(session.history.canUndo()).toBe(true);

    expect(session.undo()).toBe(true);
    expect(session.document.objects.size).toBe(0);
    expect(session.redo()).toBe(true);
    expect(session.document.objects.size).toBe(1);
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
    expect(committed.points[1]!.x).toBe(1.234567891);
    expect(committed.handlesOut[0]).toEqual(movedHandle);
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
});
