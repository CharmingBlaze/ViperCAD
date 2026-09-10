import { describe, expect, it } from 'vitest';
import { classifyBoneHandle, boneOctahedronPositions } from '@/app/animation/AnimationBonesOverlay';

describe('classifyBoneHandle', () => {
  const head = { x: 0, y: 0, z: 0 };
  const tail = { x: 0, y: 1, z: 0 };

  it('picks the nearer endpoint inside the handle radius', () => {
    expect(classifyBoneHandle({ x: 0, y: 0.02, z: 0 }, head, tail, 0.08)).toBe('head');
    expect(classifyBoneHandle({ x: 0, y: 0.98, z: 0 }, head, tail, 0.08)).toBe('tail');
  });

  it('treats the mid-bone as shaft', () => {
    expect(classifyBoneHandle({ x: 0, y: 0.5, z: 0 }, head, tail, 0.08)).toBe('shaft');
  });
});

describe('boneOctahedronPositions', () => {
  it('starts with the head-to-tail shaft', () => {
    const head = { x: 0, y: 0, z: 0 };
    const tail = { x: 0, y: 2, z: 0 };
    const positions = boneOctahedronPositions(head, tail);
    expect(positions).toHaveLength(54);
    expect(positions.slice(0, 6)).toEqual([0, 0, 0, 0, 2, 0]);
  });
});
