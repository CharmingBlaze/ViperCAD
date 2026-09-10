import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORIENTATION_AXES,
  orientationGizmoHandles,
  orientationGizmoSpoke,
  resolveOrientationClick,
} from '@/app/orientationGizmo';

describe('orientation gizmo', () => {
  it('draws farther axis tips before nearer ones so overlaps match the camera', () => {
    const handles = orientationGizmoHandles({
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
    });
    const nearest = handles[handles.length - 1]!;
    const farthest = handles[0]!;
    expect(nearest.axis).toBe('z');
    expect(nearest.sign).toBe(1);
    expect(farthest.axis).toBe('z');
    expect(farthest.sign).toBe(-1);
    expect(farthest.depth).toBeGreaterThan(nearest.depth);
  });

  it('keeps opposite tips mirrored around the centre', () => {
    const handles = orientationGizmoHandles(DEFAULT_ORIENTATION_AXES, 41, 28);
    const plusY = handles.find((handle) => handle.axis === 'y' && handle.sign === 1)!;
    const minusY = handles.find((handle) => handle.axis === 'y' && handle.sign === -1)!;
    expect(plusY.x + minusY.x).toBeCloseTo(82);
    expect(plusY.y + minusY.y).toBeCloseTo(82);
  });

  it('stops spokes short of the handle discs', () => {
    const [handle] = orientationGizmoHandles(DEFAULT_ORIENTATION_AXES);
    const spoke = orientationGizmoSpoke(handle!, 36);
    const full = Math.hypot(handle!.x - 36, handle!.y - 36);
    const drawn = Math.hypot(spoke.x2 - spoke.x1, spoke.y2 - spoke.y1);
    expect(drawn).toBeLessThan(full);
  });

  it('flips to the opposite side when the clicked axis is already the view', () => {
    expect(resolveOrientationClick({ x: 0, y: -1, z: 0 }, 'y', 1)).toBe(-1);
    expect(resolveOrientationClick({ x: 0, y: 1, z: 0 }, 'y', -1)).toBe(1);
    expect(resolveOrientationClick({ x: 0, y: -1, z: 0 }, 'y', -1)).toBe(-1);
    expect(resolveOrientationClick({ x: 0.4, y: -0.5, z: 0.7 }, 'z', 1)).toBe(1);
  });
});
