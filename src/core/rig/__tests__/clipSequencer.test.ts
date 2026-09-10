import { describe, expect, it } from 'vitest';
import {
  bakeSequenceToSingleClip,
  calculateItemWeight,
  getSequenceTotalDuration,
  sampleSequencedClips,
  type ClipSequenceItem,
} from '@/core/rig/clipSequencer';
import { createHumanoidArmature } from '@/core/rig/creatureSkeletons';
import { defaultTransform } from '@/core/math/Transform';
import { insertBoneKeyframe } from '@/core/rig/keyframes';
import type { AnimationClip, AnimationClipId } from '@/core/rig/types';

describe('clipSequencer', () => {
  it('calculates smooth blend-in and blend-out weights correctly', () => {
    const item: ClipSequenceItem = {
      id: 'seq1',
      clipId: 'clip1',
      name: 'Walk',
      startTime: 0,
      duration: 2.0,
      speedMultiplier: 1.0,
      blendIn: 0.5,
      blendOut: 0.5,
    };

    expect(calculateItemWeight(item, -0.1)).toBe(0);
    expect(calculateItemWeight(item, 0.0)).toBe(0);
    expect(calculateItemWeight(item, 0.25)).toBeCloseTo(0.5, 1);
    expect(calculateItemWeight(item, 1.0)).toBe(1.0);
    expect(calculateItemWeight(item, 1.75)).toBeCloseTo(0.5, 1);
    expect(calculateItemWeight(item, 2.0)).toBe(0);
    expect(calculateItemWeight(item, 2.5)).toBe(0);
  });

  it('calculates total sequence duration across layered and sequential items', () => {
    const items: ClipSequenceItem[] = [
      { id: '1', clipId: 'c1', name: 'A', startTime: 0, duration: 1.5, speedMultiplier: 1, blendIn: 0, blendOut: 0 },
      { id: '2', clipId: 'c2', name: 'B', startTime: 1.2, duration: 2.0, speedMultiplier: 1, blendIn: 0.3, blendOut: 0 },
    ];
    expect(getSequenceTotalDuration(items)).toBeCloseTo(3.2);
  });

  it('samples cross-faded blended transforms between overlapping clips', () => {
    const arm = createHumanoidArmature();
    const rootId = arm.rootBoneIds[0]!;

    const clipA: AnimationClip = {
      id: 'clipA',
      name: 'ClipA',
      duration: 2.0,
      fps: 24,
      tracks: [],
    };
    const tA = defaultTransform();
    tA.position.y = 1.0;
    insertBoneKeyframe(clipA, rootId, 0, tA);
    insertBoneKeyframe(clipA, rootId, 2.0, tA);

    const clipB: AnimationClip = {
      id: 'clipB',
      name: 'ClipB',
      duration: 2.0,
      fps: 24,
      tracks: [],
    };
    const tB = defaultTransform();
    tB.position.y = 3.0;
    insertBoneKeyframe(clipB, rootId, 0, tB);
    insertBoneKeyframe(clipB, rootId, 2.0, tB);

    const clipsMap = new Map<AnimationClipId, AnimationClip>([
      ['clipA', clipA],
      ['clipB', clipB],
    ]);

    const items: ClipSequenceItem[] = [
      { id: '1', clipId: 'clipA', name: 'A', startTime: 0, duration: 2.0, speedMultiplier: 1, blendIn: 0, blendOut: 1.0 },
      { id: '2', clipId: 'clipB', name: 'B', startTime: 1.0, duration: 2.0, speedMultiplier: 1, blendIn: 1.0, blendOut: 0 },
    ];

    // At t=0.5: only Clip A is active (Y = 1.0)
    const poseAt05 = sampleSequencedClips(items, clipsMap, arm, 0.5);
    expect(poseAt05.get(rootId)!.position.y).toBeCloseTo(1.0);

    // At t=1.5: 50/50 blend between Clip A (1.0) and Clip B (3.0) -> Y = 2.0
    const poseAt15 = sampleSequencedClips(items, clipsMap, arm, 1.5);
    expect(poseAt15.get(rootId)!.position.y).toBeCloseTo(2.0, 1);

    // At t=2.5: only Clip B is active (Y = 3.0)
    const poseAt25 = sampleSequencedClips(items, clipsMap, arm, 2.5);
    expect(poseAt25.get(rootId)!.position.y).toBeCloseTo(3.0);
  });

  it('bakes entire multi-clip sequence track into a single AnimationClip', () => {
    const arm = createHumanoidArmature();
    const rootId = arm.rootBoneIds[0]!;

    const clipA: AnimationClip = { id: 'cA', name: 'A', duration: 1.0, fps: 24, tracks: [] };
    insertBoneKeyframe(clipA, rootId, 0, defaultTransform());
    insertBoneKeyframe(clipA, rootId, 1.0, defaultTransform());

    const clipsMap = new Map<AnimationClipId, AnimationClip>([['cA', clipA]]);
    const items: ClipSequenceItem[] = [
      { id: '1', clipId: 'cA', name: 'A', startTime: 0, duration: 1.0, speedMultiplier: 1, blendIn: 0, blendOut: 0 },
    ];

    const baked = bakeSequenceToSingleClip(items, clipsMap, arm, { name: 'Final_Bake', fps: 24 });
    expect(baked.name).toBe('Final_Bake');
    expect(baked.duration).toBeCloseTo(1.0);
    expect(baked.tracks.length).toBeGreaterThan(0);
  });
});
