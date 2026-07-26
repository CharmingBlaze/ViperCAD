import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { CreatePrimitiveTool } from '@/core/tools/CreatePrimitiveTool';
import {
  WORLD_XY_PLANE,
  WORLD_XZ_PLANE,
  WORLD_YZ_PLANE,
  type ConstructionPlane,
} from '@/core/snap/SnapEngine';

type Ray = { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } };

function pointer(
  ray: Ray,
  screenY = 0,
  extras: Partial<{ shiftKey: boolean; worldUnitsPerPixel: number }> = {},
) {
  return {
    button: 'left' as const,
    screenX: 0,
    screenY,
    worldPosition: null,
    rayOrigin: ray.origin,
    rayDirection: ray.direction,
    shiftKey: extras.shiftKey ?? false,
    ctrlKey: false,
    altKey: false,
    worldUnitsPerPixel: extras.worldUnitsPerPixel ?? 0.05,
  };
}

function createAlongView(
  plane: ConstructionPlane,
  planeId: string,
  start: Ray,
  cornerB: Ray,
) {
  const session = new EditorSession();
  const tool = session.tools.get('create-primitive') as CreatePrimitiveTool;
  tool.selectPrimitive('box', session.context());
  session.constructionPlane = plane;
  session.constructionPlaneId = planeId;

  tool.begin(pointer(start, 200), session.context());
  tool.update(pointer(cornerB, 200), session.context());
  expect(tool.state.stage).toBe('base');
  expect(tool.getCage()?.sizeU).toBeGreaterThan(0.5);
  expect(tool.getCage()?.sizeV).toBeGreaterThan(0.5);

  tool.begin(pointer(cornerB, 200), session.context());
  expect(tool.state.stage).toBe('height');
  expect(Math.abs(tool.state.normalDistance)).toBeGreaterThan(0.5);

  tool.update(pointer(cornerB, 120), session.context());
  expect(Math.abs(tool.state.normalDistance)).toBeGreaterThan(0.5);

  tool.begin(pointer(cornerB, 120), session.context());
  expect(session.document.objects.size).toBe(1);
  expect(tool.state.stage).toBe('idle');
  return session;
}

describe('CreatePrimitiveTool in every ortho view', () => {
  it('finalizes in Top (looking along +Y)', () => {
    createAlongView(
      WORLD_XZ_PLANE,
      'top',
      { origin: { x: 0, y: 10, z: 0 }, direction: { x: 0, y: -1, z: 0 } },
      { origin: { x: 3, y: 10, z: 2 }, direction: { x: 0, y: -1, z: 0 } },
    );
  });

  it('finalizes in Front (looking along +Z)', () => {
    createAlongView(
      WORLD_XY_PLANE,
      'front',
      { origin: { x: 0, y: 0, z: 10 }, direction: { x: 0, y: 0, z: -1 } },
      { origin: { x: 3, y: 2, z: 10 }, direction: { x: 0, y: 0, z: -1 } },
    );
  });

  it('finalizes in Right (looking along +X)', () => {
    createAlongView(
      WORLD_YZ_PLANE,
      'right',
      { origin: { x: 10, y: 0, z: 0 }, direction: { x: -1, y: 0, z: 0 } },
      { origin: { x: 10, y: 2, z: 3 }, direction: { x: -1, y: 0, z: 0 } },
    );
  });

  it('Enter / confirm from height with no drag still commits', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-primitive') as CreatePrimitiveTool;
    tool.selectPrimitive('box', session.context());
    session.constructionPlane = WORLD_XZ_PLANE;
    session.constructionPlaneId = 'top';
    const down: Ray = { origin: { x: 0, y: 10, z: 0 }, direction: { x: 0, y: -1, z: 0 } };
    const corner: Ray = { origin: { x: 2, y: 10, z: 2 }, direction: { x: 0, y: -1, z: 0 } };
    tool.begin(pointer(down), session.context());
    tool.update(pointer(corner), session.context());
    tool.begin(pointer(corner), session.context());
    expect(tool.state.stage).toBe('height');
    tool.confirm(session.context());
    expect(session.document.objects.size).toBe(1);
  });

  it('cylinder finalizes on Front plane without inward-winding errors', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-primitive') as CreatePrimitiveTool;
    tool.selectPrimitive('cylinder', session.context());
    session.constructionPlane = WORLD_XY_PLANE;
    session.constructionPlaneId = 'front';
    const start: Ray = { origin: { x: 0, y: 0, z: 10 }, direction: { x: 0, y: 0, z: -1 } };
    const corner: Ray = { origin: { x: 2, y: 2, z: 10 }, direction: { x: 0, y: 0, z: -1 } };
    tool.begin(pointer(start, 200), session.context());
    tool.update(pointer(corner, 200), session.context());
    tool.begin(pointer(corner, 200), session.context());
    tool.begin(pointer(corner, 80), session.context());
    expect(session.document.objects.size).toBe(1);
  });
});
