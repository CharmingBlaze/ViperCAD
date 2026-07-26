import { describe, expect, it } from 'vitest';
import {
  isOrthoCameraAligned,
  sanitizeOrthoCamera,
} from '@/workspace/orthoCameras';
import type { CameraSnapshot } from '@/workspace/types';

function cam(
  partial: Partial<CameraSnapshot> & Pick<CameraSnapshot, 'position' | 'target' | 'up'>,
): CameraSnapshot {
  return {
    fov: 45,
    orthoHeight: 10,
    zoom: 1,
    ...partial,
  };
}

describe('sanitizeOrthoCamera', () => {
  it('keeps an aligned right view on +X', () => {
    const input = cam({
      position: [12, 0, 0],
      target: [0, 0, 0],
      up: [0, 1, 0],
    });
    expect(isOrthoCameraAligned('right', input)).toBe(true);
    const out = sanitizeOrthoCamera('right', input);
    expect(out.position[0]).toBeCloseTo(12);
    expect(out.position[1]).toBeCloseTo(0);
    expect(out.position[2]).toBeCloseTo(0);
    expect(out.up).toEqual([0, 1, 0]);
  });

  it('repairs a drifted right camera that looks like perspective', () => {
    const input = cam({
      position: [5, 3.5, 6],
      target: [0, 0, 0],
      up: [0, 1, 0],
    });
    expect(isOrthoCameraAligned('right', input)).toBe(false);
    const out = sanitizeOrthoCamera('right', input);
    const dist = Math.hypot(5, 3.5, 6);
    expect(out.position[0]).toBeCloseTo(dist);
    expect(out.position[1]).toBeCloseTo(0);
    expect(out.position[2]).toBeCloseTo(0);
    expect(out.target).toEqual([0, 0, 0]);
    expect(out.up).toEqual([0, 1, 0]);
    expect(isOrthoCameraAligned('right', out)).toBe(true);
  });

  it('preserves pan target while snapping right to +X through target', () => {
    const input = cam({
      position: [14, 2, 3],
      target: [2, 2, 3],
      up: [0, 1, 0],
    });
    // Off-axis from target along X by 12, but also wrong — position y matches target so actually on +X?
    // position-target = (12, 0, 0) — already aligned
    expect(isOrthoCameraAligned('right', input)).toBe(true);

    const drifted = cam({
      position: [10, 4, 8],
      target: [2, 2, 3],
      up: [0, 1, 0],
    });
    const out = sanitizeOrthoCamera('right', drifted);
    expect(out.target).toEqual([2, 2, 3]);
    expect(out.position[1]).toBeCloseTo(2);
    expect(out.position[2]).toBeCloseTo(3);
    expect(out.position[0]).toBeGreaterThan(2);
  });

  it('pushes a too-close ortho camera back so solids are not near-clipped', () => {
    const input = cam({
      position: [0.4, 0, 0],
      target: [0, 0, 0],
      up: [0, 1, 0],
    });
    expect(isOrthoCameraAligned('right', input)).toBe(false);
    const out = sanitizeOrthoCamera('right', input);
    expect(out.position[0]).toBeGreaterThanOrEqual(8);
    expect(out.position[1]).toBeCloseTo(0);
    expect(out.position[2]).toBeCloseTo(0);
    expect(isOrthoCameraAligned('right', out)).toBe(true);
  });
});
