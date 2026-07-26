import { describe, expect, it } from 'vitest';
import { v3 } from '@/core/math/Vec3';
import { validateMeshFull } from '@/core/mesh/Validation';
import {
  curveOperationFromStroke,
  evaluateCurvePath,
  evaluateCurveOperation,
  readCurveOperation,
  serializeCurveOperation,
} from '@/core/curves/CurveOperation';

describe('CurveOperation', () => {
  it('round-trips editable tube source data and evaluates a valid mesh', () => {
    const operation = curveOperationFromStroke({
        style: 'tube',
      points: [v3(0, 0, 0), v3(1, 0.4, 0), v3(2, 0, 0)],
      radius: 0.12,
      resolution: 'low',
      smooth: true,
      cyclic: false,
    });
    const restored = readCurveOperation(serializeCurveOperation(operation));
    expect(restored).toEqual(operation);
    const mesh = evaluateCurveOperation(restored!);
    expect(mesh.vertices.size).toBeGreaterThan(0);
    expect(validateMeshFull(mesh).ok).toBe(true);
  });

  it('changes resolution without losing the original control points', () => {
    const operation = curveOperationFromStroke({
        style: 'tapered-tube',
      points: [v3(0, 0, 0), v3(1, 0.5, 0), v3(2, 0, 0)],
      radius: 0.1,
      resolution: 'low',
      smooth: false,
      cyclic: false,
    });
    const low = evaluateCurveOperation(operation);
    const medium = evaluateCurveOperation({ ...operation, resolution: 'medium' });
    expect(medium.vertices.size).toBeGreaterThan(low.vertices.size);
    expect(operation.points).toEqual([
      v3(0, 0, 0),
      v3(1, 0.5, 0),
      v3(2, 0, 0),
    ]);
  });

  it('rejects malformed stored curve data', () => {
    expect(readCurveOperation('{"version":1,"style":"tube","points":[]}')).toBeNull();
    expect(readCurveOperation('not json')).toBeNull();
  });

  it.each([
    'ribbon',
    'hair',
    'rope',
    'square-sweep',
    'rail-sweep',
  ] as const)('evaluates the %s procedural output as valid geometry', (style) => {
    const operation = curveOperationFromStroke({
      style,
      points: [v3(0, 0, 0), v3(0.8, 0.35, 0.2), v3(1.6, -0.15, 0.4), v3(2.4, 0.2, 0.1)],
      radius: 0.15,
      resolution: 'medium',
      smooth: true,
      cyclic: false,
      inputMode: 'pen',
      startScale: 0.65,
      endScale: 1.25,
      twist: style === 'rope' ? 540 : 90,
      profileWidth: 1.2,
      profileHeight: 0.8,
    });
    const mesh = evaluateCurveOperation(operation);
    expect(mesh.vertices.size).toBeGreaterThan(0);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('upgrades legacy version-one curves with the new sweep defaults', () => {
    const restored = readCurveOperation(JSON.stringify({
      version: 1,
      style: 'tube',
      points: [v3(0, 0, 0), v3(1, 0, 0)],
      radius: 0.1,
      resolution: 'low',
      smooth: true,
      cyclic: false,
    }));
    expect(restored).toMatchObject({
      inputMode: 'sketch',
      startScale: 1,
      endScale: 1,
      twist: 0,
      profileWidth: 1,
      profileHeight: 1,
      curveType: 'catmull-rom',
      tipStyle: 'square',
    });
  });

  it('stores pointed ribbon tips as part of the procedural curve', () => {
    const operation = curveOperationFromStroke({
      style: 'ribbon',
      points: [v3(0, 0, 0), v3(1, 0.4, 0), v3(2, 0, 0)],
      radius: 0.1,
      resolution: 'low',
      smooth: true,
      cyclic: false,
      tipStyle: 'pointed',
    });
    expect(readCurveOperation(serializeCurveOperation(operation))?.tipStyle).toBe('pointed');
    expect(validateMeshFull(evaluateCurveOperation(operation)).ok).toBe(true);
  });

  it('builds Capsule paths with true rounded ends and editable side precision', () => {
    const operation = curveOperationFromStroke({
      style: 'capsule',
      points: [v3(0, 0, 0), v3(1, 0.25, 0), v3(2, 0, 0)],
      radius: 0.2,
      resolution: 'medium',
      smooth: false,
      cyclic: false,
      inputMode: 'pen',
      curveType: 'polyline',
      pathRadialSegments: 16,
    });
    const mesh = evaluateCurveOperation(operation);
    const xs = [...mesh.vertices.values()].map((vertex) => vertex.position.x);
    expect(Math.min(...xs)).toBeLessThan(-0.15);
    expect(Math.max(...xs)).toBeGreaterThan(2.15);
    expect(mesh.vertices.size).toBeGreaterThan(16 * operation.points.length);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('fills a closed capsule outline into a low-poly solid', () => {
    const ring = [
      v3(1, 0, 0),
      v3(0, 1, 0),
      v3(-1, 0, 0),
      v3(0, -1, 0),
      v3(1, 0.001, 0),
    ];
    const operation = curveOperationFromStroke({
      style: 'capsule',
      points: ring,
      radius: 0.12,
      resolution: 'low',
      smooth: false,
      cyclic: true,
      inputMode: 'pen',
      curveType: 'polyline',
      pathRadialSegments: 12,
    });
    const mesh = evaluateCurveOperation(operation);
    expect(mesh.vertices.size).toBeGreaterThan(24);
    expect(mesh.faces.size).toBeGreaterThan(24);
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('fills closed outline and blob curves into soft-inflate domes', () => {
    const points = [v3(1, 0, 0), v3(0, 1, 0), v3(-1, 0, 0), v3(0, -1, 0), v3(1, 0.001, 0)];
    const outline = evaluateCurveOperation(curveOperationFromStroke({
      style: 'sharp',
      points,
      radius: 0.1,
      resolution: 'low',
      smooth: false,
      cyclic: true,
    }));
    const blob = evaluateCurveOperation(curveOperationFromStroke({
      style: 'soft',
      points,
      radius: 0.1,
      resolution: 'low',
      smooth: false,
      cyclic: true,
    }));
    expect(blob.vertices.size).toBeGreaterThan(outline.vertices.size);
    for (const mesh of [outline, blob]) {
      expect(mesh.vertices.size).toBeGreaterThan(20);
      expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    }
  });

  it('stores a drawn lathe profile and rebuilds it at different precision', () => {
    const operation = curveOperationFromStroke({
      style: 'sharp',
      points: [
        v3(0, -1, 0),
        v3(0.8, -0.5, 0),
        v3(1.1, 0.25, 0),
        v3(0, 1, 0),
      ],
      radius: 0.1,
      resolution: 'low',
      smooth: true,
      cyclic: false,
      solidMode: 'lathe',
      latheAxis: 'y',
      latheSegments: 12,
      latheProfileRings: 24,
      latheSmoothing: 0.2,
      latheAngle: 360,
      latheCaps: true,
    });
    const restored = readCurveOperation(serializeCurveOperation(operation))!;
    expect(restored).toMatchObject({
      solidMode: 'lathe',
      latheAxis: 'y',
      latheSegments: 12,
      latheProfileRings: 24,
      latheSmoothing: 0.2,
      latheAngle: 360,
      latheCaps: true,
      cyclic: false,
    });
    const low = evaluateCurveOperation(restored);
    const high = evaluateCurveOperation({ ...restored, latheSegments: 32 });
    expect(high.vertices.size).toBeGreaterThan(low.vertices.size);
    expect(validateMeshFull(high).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('round-trips the complete editable Path Settings suite', () => {
    const operation = curveOperationFromStroke({
      style: 'tube',
      points: [v3(0, 0, 0), v3(1, 0.5, 0), v3(2, 0, 0)],
      radius: 0.1,
      resolution: 'low',
      smooth: true,
      cyclic: false,
      pathOutput: 'cards',
      pathStartCap: 'round',
      pathEndCap: 'open',
      pathRadiusScale: 1.5,
      pathRadialSegments: 12,
      pathOffset: 0.25,
      pathSpacing: 0.5,
      pathProfile: 'rectangle',
      pathChainAlternating: false,
      pathCardCrossed: true,
      pathDistributionMode: 'count',
      pathCount: 9,
      pathStartPadding: 0.2,
      pathEndPadding: 0.3,
      pathRandomScale: 0.15,
      pathRotation: 20,
      pathRandomRotation: 35,
      pathAlternateRotation: true,
      pathMirrorAlternate: true,
      pathSeed: 123,
      pathKeepInstances: true,
      pathSourceObjectId: 'obj_source',
    });
    expect(readCurveOperation(serializeCurveOperation(operation))).toEqual(operation);
  });

  it('supports polyline, smooth spline, and editable cubic Bézier interpolation', () => {
    const base = curveOperationFromStroke({
      style: 'tube',
      points: [v3(0, 0, 0), v3(1, 1, 0), v3(2, 0, 0)],
      radius: 0.1,
      resolution: 'medium',
      smooth: false,
      cyclic: false,
      curveType: 'polyline',
    });
    expect(evaluateCurvePath(base)).toHaveLength(3);
    expect(evaluateCurvePath({ ...base, curveType: 'catmull-rom' }).length).toBeGreaterThan(3);

    const bezier = {
      ...base,
      curveType: 'bezier' as const,
      handlesOut: base.handlesOut.map((handle, index) =>
        index === 0 ? v3(handle.x, handle.y + 1.5, handle.z) : handle,
      ),
    };
    const evaluated = evaluateCurvePath(bezier);
    expect(evaluated.length).toBeGreaterThan(3);
    expect(evaluated.some((point) => point.y > 1)).toBe(true);
    expect(readCurveOperation(serializeCurveOperation(bezier))?.handlesOut).toEqual(
      bezier.handlesOut,
    );
  });
});
