import { describe, expect, it } from 'vitest';
import { solveTwoBoneIK } from '@/core/rig/IkSolver';
import { v3 } from '@/core/math/Vec3';

describe('IkSolver', () => {
  it('solves 2-bone IK limb reach', () => {
    const root = v3(0, 0, 0);
    const mid = v3(0, 1, 0);
    const end = v3(0, 2, 0);
    const target = v3(0, 1.5, 0.5);

    const result = solveTwoBoneIK(root, mid, end, target);
    expect(result.solved).toBe(true);
    expect(result.rootPosition).toEqual(root);
    expect(result.endPosition).toEqual(target);
    expect(result.midPosition).not.toEqual(mid);
  });

  it('clamps reach when target is beyond max limb length', () => {
    const root = v3(0, 0, 0);
    const mid = v3(0, 1, 0);
    const end = v3(0, 2, 0);
    const target = v3(0, 10, 0);

    const result = solveTwoBoneIK(root, mid, end, target);
    expect(result.solved).toBe(true);
    // End position clamped near max length 2.0
    const reach = Math.hypot(result.endPosition.x, result.endPosition.y, result.endPosition.z);
    expect(reach).toBeLessThanOrEqual(2.0);
    expect(reach).toBeGreaterThan(1.9);
  });
});
