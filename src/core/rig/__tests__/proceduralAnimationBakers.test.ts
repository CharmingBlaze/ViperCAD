import { describe, expect, it } from 'vitest';
import {
  bakeBirdDrink,
  bakeBirdFlight,
  bakeCombatAttack,
  bakeFishSwim,
  bakeQuadrupedLocomotion,
  bakeSquashAndStretch,
} from '@/core/rig/proceduralAnimationBakers';
import {
  createBirdArmature,
  createFishArmature,
  createHumanoidArmature,
  createQuadrupedArmature,
} from '@/core/rig/creatureSkeletons';
import type { AnimationClip } from '@/core/rig/types';

function createEmptyClip(name = 'Test'): AnimationClip {
  return {
    id: 'clip_test',
    name,
    duration: 1.0,
    fps: 24,
    tracks: [],
  };
}

describe('proceduralAnimationBakers', () => {
  it('bakes bird flight animation keyframes across wings and body', () => {
    const arm = createBirdArmature();
    const clip = createEmptyClip('Bird_Fly');
    bakeBirdFlight(clip, arm, { duration: 1.0, fps: 24 });

    expect(clip.tracks.length).toBeGreaterThan(3);
    const totalKeyframes = clip.tracks.reduce((sum, tr) => sum + tr.keyframes.length, 0);
    expect(totalKeyframes).toBeGreaterThan(50);
  });

  it('bakes bird drinking action with dipping head and tail response', () => {
    const arm = createBirdArmature();
    const clip = createEmptyClip('Bird_Drink');
    bakeBirdDrink(clip, arm, { duration: 2.0 });

    expect(clip.tracks.length).toBeGreaterThan(2);
    expect(clip.duration).toBe(2.0);
  });

  it('bakes quadruped walk and run cycles with 4-leg gait', () => {
    const arm = createQuadrupedArmature();
    const walkClip = createEmptyClip('Dog_Walk');
    bakeQuadrupedLocomotion(walkClip, arm, { isRun: false });
    expect(walkClip.tracks.length).toBeGreaterThan(4);

    const runClip = createEmptyClip('Dog_Run');
    bakeQuadrupedLocomotion(runClip, arm, { isRun: true });
    expect(runClip.tracks.length).toBeGreaterThan(4);
  });

  it('bakes fish swim wave propagation across spine segments', () => {
    const arm = createFishArmature();
    const clip = createEmptyClip('Fish_Swim');
    bakeFishSwim(clip, arm, { duration: 1.2 });

    expect(clip.tracks.length).toBeGreaterThan(4);
    for (const track of clip.tracks) {
      expect(track.keyframes.length).toBeGreaterThan(10);
    }
  });

  it('bakes combat attack slash with windup and recovery', () => {
    const arm = createHumanoidArmature();
    const clip = createEmptyClip('Attack');
    bakeCombatAttack(clip, arm, { duration: 0.8 });

    expect(clip.tracks.length).toBeGreaterThan(3);
    expect(clip.duration).toBe(0.8);
  });

  it('bakes volume-preserving squash and stretch onto root bone', () => {
    const arm = createHumanoidArmature();
    const clip = createEmptyClip('Squash_Test');
    clip.duration = 1.0;
    bakeSquashAndStretch(clip, arm, { intensity: 0.3 });

    expect(clip.tracks.length).toBe(1);
    const rootTrack = clip.tracks[0]!;
    // Scale on Y should vary while X & Z scale inversely
    const maxScaleY = Math.max(...rootTrack.keyframes.map((k) => k.value.scale.y));
    const minScaleXZ = Math.min(...rootTrack.keyframes.map((k) => k.value.scale.x));
    expect(maxScaleY).toBeGreaterThan(1.1);
    expect(minScaleXZ).toBeLessThan(0.99);
  });
});
