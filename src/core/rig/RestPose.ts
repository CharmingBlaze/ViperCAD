import { cloneTransform } from '@/core/math/Transform';
import type { Armature, AnimationClip } from '@/core/rig/types';
import { sampledLocalTransforms } from '@/core/rig/keyframes';

/** Bake the current animated pose into bone rest transforms and clear animation tracks. */
export function applyCurrentPoseAsRest(armature: Armature, clip: AnimationClip | null, time: number): void {
  const locals = sampledLocalTransforms(armature, clip, time);
  for (const [boneId, transform] of locals) {
    const bone = armature.bones.get(boneId);
    if (bone) bone.localTransform = cloneTransform(transform);
  }
  if (clip) clip.tracks = [];
}

/** Clear all animation keyframes without changing rest pose. */
export function clearAnimationTracks(clip: AnimationClip | null): void {
  if (!clip) return;
  clip.tracks = [];
}

/** Reset all bone local transforms to identity (rest pose). */
export function resetArmatureRestPose(armature: Armature): void {
  for (const bone of armature.bones.values()) {
    bone.localTransform = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
  }
}
