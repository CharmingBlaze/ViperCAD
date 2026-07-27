import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { CreateDoodleTool } from '@/core/tools/CreateDoodleTool';
import {
  curveOperationFromStroke,
  evaluateCurveOperation,
  isPathStyle,
  localizeCurveMesh,
  type CurveInputMode,
  type CurveSolidMode,
  type CurveStyle,
} from '@/core/curves/CurveOperation';
import { v3 } from '@/core/math/Vec3';
import { validateMeshFull } from '@/core/mesh/Validation';
import type { ToolPointerInput } from '@/core/tools/Tool';

const OPEN_POINTS = [v3(0, 0, 0), v3(1, 0.35, 0.1), v3(2, -0.1, 0.2), v3(2.8, 0.15, 0.05)];
const CLOSED_POINTS = [
  v3(1, 0, 0),
  v3(0, 1, 0),
  v3(-1, 0, 0),
  v3(0, -1, 0),
  v3(1, 0.001, 0),
];

const ALL_STYLES: CurveStyle[] = [
  'sharp',
  'soft',
  'tube',
  'capsule',
  'profile-solid',
  'segmented-sweep',
  'hair',
  'hair-strip',
  'rounded-hair',
  'ribbon',
  'tapered-tube',
  'rope',
  'square-sweep',
  'rail-sweep',
];

function pointer(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
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
  };
}

function meshErrors(mesh: ReturnType<typeof evaluateCurveOperation>) {
  return validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error');
}

function evaluateStyle(
  style: CurveStyle,
  inputMode: CurveInputMode,
  cyclic: boolean,
  solidMode: CurveSolidMode = 'extrude',
) {
  const points = cyclic ? CLOSED_POINTS : OPEN_POINTS;
  const operation = curveOperationFromStroke({
    style,
    points,
    radius: 0.12,
    resolution: 'low',
    smooth: !(inputMode === 'pen' && style === 'sharp'),
    cyclic,
    inputMode,
    curveType: inputMode === 'pen' && style === 'sharp' ? 'polyline' : 'catmull-rom',
    solidMode,
    latheAxis: 'y',
    latheSegments: 12,
    latheProfileRings: 16,
    latheSmoothing: 0.15,
    latheAngle: 360,
    latheCaps: true,
    twist: style === 'rope' ? 360 : 45,
    pathRadialSegments: style === 'capsule' ? 12 : 8,
  });
  const mesh = evaluateCurveOperation(operation);
  const localized = localizeCurveMesh(mesh, operation);
  return { operation, mesh, localized, errors: meshErrors(mesh) };
}

describe('curve stroke audit', () => {
  it.each(ALL_STYLES)('%s builds valid open and closed geometry for sketch and pen', (style) => {
    for (const inputMode of ['sketch', 'pen'] as const) {
      for (const cyclic of [false, true]) {
        if (style !== 'sharp' && style !== 'soft' && cyclic && inputMode === 'sketch') {
          // Path styles only close when explicitly connected in sketch mode.
          continue;
        }
        const { mesh, localized, errors } = evaluateStyle(style, inputMode, cyclic);
        expect(mesh.vertices.size, `${style}/${inputMode}/cyclic=${cyclic} vertices`).toBeGreaterThan(0);
        expect(mesh.faces.size, `${style}/${inputMode}/cyclic=${cyclic} faces`).toBeGreaterThan(0);
        expect(errors, `${style}/${inputMode}/cyclic=${cyclic} validation`).toEqual([]);
        const centre = localized.operation.points.reduce(
          (acc, point) => v3(acc.x + point.x, acc.y + point.y, acc.z + point.z),
          v3(),
        );
        expect(Math.hypot(centre.x, centre.y, centre.z)).toBeLessThan(2.5);
      }
    }
  });

  it('lathe solid mode builds for sketch and pen on open profiles', () => {
    for (const inputMode of ['sketch', 'pen'] as const) {
      const profile = [v3(0, -1, 0), v3(0.7, -0.4, 0), v3(1, 0.3, 0), v3(0, 1, 0)];
      const operation = curveOperationFromStroke({
        style: 'sharp',
        points: profile,
        radius: 0.1,
        resolution: 'low',
        smooth: true,
        cyclic: false,
        inputMode,
        solidMode: 'lathe',
        latheAxis: 'y',
        latheSegments: 12,
        latheProfileRings: 16,
      });
      expect(operation.cyclic).toBe(false);
      const mesh = evaluateCurveOperation(operation);
      expect(mesh.vertices.size).toBeGreaterThan(24);
      expect(meshErrors(mesh)).toEqual([]);
      const localized = localizeCurveMesh(mesh, operation);
      expect(localized.operation.points.length).toBeGreaterThan(1);
      expect(meshErrors(mesh)).toEqual([]);
    }
  });

  it('path styles classify correctly and do not auto-close unfinished sketch strokes', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setStyle('ribbon', session.context());
    tool.setInputMode('sketch', session.context());
    tool.radius = 0.1;
    const origin = { x: 0, y: 0, z: 4 };

    tool.begin(pointer(origin, { x: -0.5, y: 0, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 0.5, y: 0, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 0, y: 0.3, z: -1 }), session.context());
    expect(isPathStyle('ribbon')).toBe(true);
    expect(tool.state.closed).toBe(false);
  });

  it('soft and sharp sketch strokes auto-close long open paths', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    tool.setStyle('soft', session.context());
    tool.radius = 0.1;
    const origin = { x: 0, y: 0, z: 4 };

    tool.begin(pointer(origin, { x: -0.6, y: 0.2, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 0.6, y: 0.2, z: -1 }), session.context());
    tool.update(pointer(origin, { x: 0.4, y: -0.5, z: -1 }), session.context());
    expect(tool.state.closed).toBe(true);
  });

  it('CreateDoodleTool commits every extrude style without validation errors', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-doodle') as CreateDoodleTool;
    session.tools.setActive('create-doodle', session.context());
    const origin = { x: 0, y: 0, z: 4 };

    for (const style of ALL_STYLES) {
      session.document.objects.clear();
      session.document.meshes.clear();
      session.document.rootObjectIds.length = 0;
      tool.setStyle(style, session.context());
      tool.setInputMode('sketch', session.context());
      tool.setSolidMode('extrude', session.context());
      tool.begin(pointer(origin, { x: -0.3, y: 0.1, z: -1 }), session.context());
      tool.update(pointer(origin, { x: 0, y: 0.4, z: -1 }), session.context());
      tool.update(pointer(origin, { x: 0.35, y: -0.1, z: -1 }), session.context());
      tool.confirm(session.context());
      expect(session.document.objects.size, style).toBe(1);
      const object = [...session.document.objects.values()][0]!;
      expect(Math.hypot(object.transform.position.x, object.transform.position.y, object.transform.position.z))
        .toBeGreaterThan(0.1);
      const mesh = session.document.meshes.get(object.meshId!)!;
      expect(meshErrors(mesh), style).toEqual([]);
    }
  });
});
