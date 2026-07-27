import type { Transform } from '@/core/math/Transform';
import type { Vec3 } from '@/core/math/Vec3';
import type { Armature, AnimationClip, BoneId } from '@/core/rig/types';
import { boneHeadTailWorld, boneWorldMatrix } from '@/core/rig/boneMatrices';
import { sampledLocalTransforms } from '@/core/rig/keyframes';
import { mat4ToTransform } from '@/core/rig/boneMatrices';

export type BonePose = {
  worldTransform: Transform;
  headWorld: Vec3;
  tailWorld: Vec3;
};

/** Evaluate bone poses using the same matrix hierarchy as GPU skinning. */
export function evaluateArmaturePose(
  armature: Armature,
  clip: AnimationClip | null,
  time: number,
): Map<BoneId, BonePose> {
  const locals = sampledLocalTransforms(armature, clip, time);
  const worldCache = new Map<BoneId, import('@/core/rig/boneMatrices').Mat4>();
  const poses = new Map<BoneId, BonePose>();

  for (const bone of armature.bones.values()) {
    const worldMat = boneWorldMatrix(armature, bone.id, locals, worldCache);
    const { head, tail } = boneHeadTailWorld(bone, worldMat);
    poses.set(bone.id, {
      worldTransform: mat4ToTransform(worldMat),
      headWorld: head,
      tailWorld: tail,
    });
  }
  return poses;
}
