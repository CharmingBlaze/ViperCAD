import { describe, expect, it } from 'vitest';
import {
  exportGlbaSceneJson,
  exportGlbcaSequenceJson,
  exportGlbkfKeyframesJson,
  parseGlbaSceneJson,
  parseGlbcaSequenceJson,
  parseGlbkfKeyframesJson,
} from '@/core/rig/glbAnimatorIO';
import { createHumanoidArmature } from '@/core/rig/creatureSkeletons';
import { defaultTransform } from '@/core/math/Transform';
import { insertBoneKeyframe } from '@/core/rig/keyframes';
import type { AnimationClip } from '@/core/rig/types';

describe('glbAnimatorIO', () => {
  it('exports and parses .glba full scene JSON with armature, clips, and sequences', () => {
    const arm = createHumanoidArmature('Hero_Rig');
    const clip: AnimationClip = {
      id: 'c1',
      name: 'Walk',
      duration: 1.5,
      fps: 24,
      tracks: [],
    };
    insertBoneKeyframe(clip, arm.rootBoneIds[0]!, 0, defaultTransform());

    const json = exportGlbaSceneJson(arm, [clip], [
      { id: 's1', clipId: 'c1', name: 'Walk', startTime: 0, duration: 1.5, speedMultiplier: 1, blendIn: 0, blendOut: 0 },
    ], 'Hero_Model');

    const parsed = parseGlbaSceneJson(json);
    expect(parsed.armature?.name).toBe('Hero_Rig');
    expect(parsed.armature?.bones.size).toBe(arm.bones.size);
    expect(parsed.clips.length).toBe(1);
    expect(parsed.clips[0]!.name).toBe('Walk');
    expect(parsed.clipSequence.length).toBe(1);
    expect(parsed.sourceModelName).toBe('Hero_Model');
  });

  it('exports and parses .glbkf keyframes JSON', () => {
    const clip: AnimationClip = {
      id: 'c1',
      name: 'Run',
      duration: 0.8,
      fps: 30,
      tracks: [],
    };
    insertBoneKeyframe(clip, 'bone_root', 0.4, defaultTransform(), 'smooth');

    const json = exportGlbkfKeyframesJson(clip);
    const parsed = parseGlbkfKeyframesJson(json);
    expect(parsed.format).toBe('GLBKF_KEYFRAMES');
    expect(parsed.clipName).toBe('Run');
    expect(parsed.tracks.length).toBe(1);
    expect(parsed.tracks[0]!.keyframes[0]!.time).toBe(0.4);
  });

  it('exports and parses .glbca clip sequences JSON', () => {
    const items = [
      { id: '1', clipId: 'c1', name: 'A', startTime: 0, duration: 1, speedMultiplier: 1, blendIn: 0.2, blendOut: 0.2 },
    ];
    const json = exportGlbcaSequenceJson(items, 1.0);
    const parsed = parseGlbcaSequenceJson(json);
    expect(parsed.format).toBe('GLBCA_CLIP_SEQUENCE');
    expect(parsed.totalDuration).toBe(1.0);
    expect(parsed.items.length).toBe(1);
  });
});
