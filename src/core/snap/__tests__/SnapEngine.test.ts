import { describe, expect, it } from 'vitest';
import {
  resolveSnap,
  snapAngleRadians,
  snapScalarToIncrement,
  snapToPlaneGrid,
  stabilizeSnap,
  WORLD_XZ_PLANE,
  type SnapResult,
} from '@/core/snap/SnapEngine';

const candidate = (
  targetType: SnapResult['targetType'],
  distance: number,
  x: number,
): SnapResult => ({
  snapped: true,
  position: { x, y: 0, z: 0 },
  targetType,
  distance,
  confidence: 1,
});

describe('SnapEngine', () => {
  it('uses stable topology priority before distance', () => {
    const result = resolveSnap(
      {
        rawPosition: { x: 0, y: 0, z: 0 },
        allowed: ['face', 'edge', 'edgeMid', 'vertex'],
        maxWorldDistance: 1,
      },
      [
        candidate('face', 0.01, 1),
        candidate('edge', 0.02, 2),
        candidate('edgeMid', 0.03, 3),
        candidate('vertex', 0.04, 4),
      ],
    );
    expect(result.targetType).toBe('vertex');
    expect(result.position.x).toBe(4);
  });

  it('quantises increments and project-configured angles', () => {
    expect(snapScalarToIncrement(1.13, 0.25)).toBeCloseTo(1.25);
    expect((snapAngleRadians((22 * Math.PI) / 180, 15) * 180) / Math.PI).toBeCloseTo(15);
  });

  it('keeps plane-grid snapping on the construction plane', () => {
    const result = snapToPlaneGrid({ x: 0.62, y: 4, z: 1.38 }, WORLD_XZ_PLANE, 0.5);
    expect(result).toEqual({ x: 0.5, y: 0, z: 1.5 });
  });
});

describe('snap hysteresis', () => {
  it('keeps the previous geometry target inside a wider release radius', () => {
    const previous = candidate('vertex', 0.02, 1);
    const none = candidate('none', 0, 1.12);
    const stable = stabilizeSnap(previous, none, { x: 1.12, y: 0, z: 0 }, 0.1);
    expect(stable.targetType).toBe('vertex');
    expect(stabilizeSnap(previous, none, { x: 1.3, y: 0, z: 0 }, 0.1).targetType).toBe('none');
  });
});
