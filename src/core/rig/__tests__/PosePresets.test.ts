import { describe, expect, it } from 'vitest';
import { createDefaultArmature } from '@/core/rig/ArmatureFactory';
import { createDefaultAnimationClip } from '@/core/rig/RigDocument';
import { applyPosePreset, generateIdleCycle, generateWalkCycle } from '@/core/rig/PosePresets';

describe('PosePresets', () => {
  it('applies pose preset to matching bones', () => {
    const armature = createDefaultArmature('Human');
    const clip = createDefaultAnimationClip('Action');

    const applied = applyPosePreset(armature, clip, 'A-Pose', 0);
    expect(applied).toBeGreaterThan(0);
    expect(clip.tracks.length).toBeGreaterThan(0);
  });

  it('generates 24-frame walk cycle animation', () => {
    const armature = createDefaultArmature('Human');
    const clip = createDefaultAnimationClip('Walk');

    generateWalkCycle(clip, armature);
    expect(clip.duration).toBe(1.0);
    expect(clip.fps).toBe(24);
    expect(clip.tracks.length).toBeGreaterThan(0);
    expect(clip.tracks[0]!.keyframes.length).toBeGreaterThanOrEqual(24);
  });

  it('generates 48-frame idle breathing cycle animation', () => {
    const armature = createDefaultArmature('Human');
    const clip = createDefaultAnimationClip('Idle');

    generateIdleCycle(clip, armature);
    expect(clip.duration).toBe(2.0);
    expect(clip.fps).toBe(24);
    expect(clip.tracks.length).toBeGreaterThan(0);
    expect(clip.tracks[0]!.keyframes.length).toBeGreaterThanOrEqual(48);
  });
});
