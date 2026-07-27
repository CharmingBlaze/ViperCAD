import { createId } from '@/core/ids/IdService';
import { defaultTransform } from '@/core/math/Transform';
import { v3 } from '@/core/math/Vec3';
import { createBone } from '@/core/rig/ArmatureFactory';
import type { Armature, Bone, BoneId } from '@/core/rig/types';

export function renameBone(armature: Armature, boneId: BoneId, name: string): void {
  const bone = armature.bones.get(boneId);
  if (!bone) return;
  bone.name = name.trim() || bone.name;
}

export function setBoneTail(armature: Armature, boneId: BoneId, tailLocal: { x: number; y: number; z: number }): void {
  const bone = armature.bones.get(boneId);
  if (!bone) return;
  bone.tailLocal = { ...tailLocal };
}

export function addBone(
  armature: Armature,
  name: string,
  parentId: BoneId | null,
  tailLocal = v3(0, 0.2, 0),
): Bone {
  const bone = createBone(name, parentId, tailLocal);
  armature.bones.set(bone.id, bone);
  if (!parentId && !armature.rootBoneIds.includes(bone.id)) {
    armature.rootBoneIds.push(bone.id);
  }
  return bone;
}

export function extrudeBone(armature: Armature, boneId: BoneId, name?: string): Bone | null {
  const parent = armature.bones.get(boneId);
  if (!parent) return null;
  const child = addBone(armature, name ?? `${parent.name}_end`, boneId, { ...parent.tailLocal });
  parent.tailLocal = v3(0, 0.15, 0);
  return child;
}

export function removeBone(armature: Armature, boneId: BoneId): BoneId[] {
  const removed: BoneId[] = [];
  const collect = (id: BoneId) => {
    removed.push(id);
    for (const bone of armature.bones.values()) {
      if (bone.parentId === id) collect(bone.id);
    }
  };
  if (!armature.bones.has(boneId)) return removed;
  collect(boneId);

  for (const id of removed) {
    armature.bones.delete(id);
    armature.rootBoneIds = armature.rootBoneIds.filter((rootId) => rootId !== id);
  }

  for (const bone of [...armature.bones.values()]) {
    if (bone.parentId && removed.includes(bone.parentId)) {
      bone.parentId = null;
      if (!armature.rootBoneIds.includes(bone.id)) armature.rootBoneIds.push(bone.id);
    }
  }

  return removed;
}

export function reparentBone(armature: Armature, boneId: BoneId, newParentId: BoneId | null): boolean {
  if (boneId === newParentId) return false;
  const bone = armature.bones.get(boneId);
  if (!bone) return false;
  if (newParentId) {
    if (!armature.bones.has(newParentId)) return false;
    let cursor: BoneId | null = newParentId;
    while (cursor) {
      if (cursor === boneId) return false;
      cursor = armature.bones.get(cursor)?.parentId ?? null;
    }
  }

  armature.rootBoneIds = armature.rootBoneIds.filter((id) => id !== boneId);
  bone.parentId = newParentId;
  if (!newParentId && !armature.rootBoneIds.includes(boneId)) {
    armature.rootBoneIds.push(boneId);
  }
  return true;
}

export function resetBonePose(armature: Armature, boneId?: BoneId): void {
  const targets = boneId ? [boneId] : [...armature.bones.keys()];
  for (const id of targets) {
    const bone = armature.bones.get(id);
    if (bone) bone.localTransform = defaultTransform();
  }
}
