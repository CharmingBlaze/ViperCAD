import type { Armature, Bone, BoneId } from '@/core/rig/types';

export type BoneTreeItem = {
  bone: Bone;
  depth: number;
};

export function buildBoneTree(armature: Armature): BoneTreeItem[] {
  const items: BoneTreeItem[] = [];
  const visit = (boneId: BoneId, depth: number) => {
    const bone = armature.bones.get(boneId);
    if (!bone) return;
    items.push({ bone, depth });
    for (const child of armature.bones.values()) {
      if (child.parentId === boneId) visit(child.id, depth + 1);
    }
  };
  for (const rootId of armature.rootBoneIds) visit(rootId, 0);
  for (const bone of armature.bones.values()) {
    if (!items.some((item) => item.bone.id === bone.id)) items.push({ bone, depth: 0 });
  }
  return items;
}
