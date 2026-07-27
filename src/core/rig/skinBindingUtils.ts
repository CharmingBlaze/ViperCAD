import type { EditableMesh } from '@/core/mesh/types';
import type { Armature, BoneId, BoneInfluence, SkinBinding } from '@/core/rig/types';

const MAX_INFLUENCES = 4;

export function normalizeInfluences(weights: BoneInfluence[]): BoneInfluence[] {
  const top = weights
    .filter((entry) => entry.weight > 0.0001)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_INFLUENCES);
  const sum = top.reduce((acc, entry) => acc + entry.weight, 0) || 1;
  return top.map((entry) => ({ boneId: entry.boneId, weight: entry.weight / sum }));
}

/** Remove deleted bones from all vertex weights and renormalize. */
export function pruneBoneInfluences(binding: SkinBinding, removedBoneIds: Iterable<BoneId>): void {
  const removed = new Set(removedBoneIds);
  if (removed.size === 0) return;
  for (const [vertexId, influences] of binding.vertexWeights) {
    const filtered = influences.filter((entry) => !removed.has(entry.boneId));
    binding.vertexWeights.set(vertexId, normalizeInfluences(filtered));
  }
}

/** Ensure every vertex with weights sums to ~1. */
export function normalizeBindingWeights(binding: SkinBinding): void {
  for (const [vertexId, influences] of binding.vertexWeights) {
    binding.vertexWeights.set(vertexId, normalizeInfluences(influences));
  }
}

/** Fingerprint for detecting when GPU skin data must be rebuilt. */
export function skinBindingSignature(
  binding: SkinBinding,
  armature: Armature,
  mesh: EditableMesh,
): string {
  let weightChecksum = 0;
  for (const influences of binding.vertexWeights.values()) {
    for (const entry of influences) {
      weightChecksum += Math.round(entry.weight * 10_000) + entry.boneId.length;
    }
  }
  let rollChecksum = 0;
  let restChecksum = 0;
  for (const bone of armature.bones.values()) {
    rollChecksum += Math.round(bone.roll * 1000);
    restChecksum += Math.round(bone.localTransform.rotation.y * 1000);
    restChecksum += Math.round(bone.localTransform.position.y * 1000);
  }
  return [
    binding.id,
    armature.bones.size,
    mesh.vertices.size,
    binding.vertexWeights.size,
    weightChecksum,
    rollChecksum,
    restChecksum,
  ].join(':');
}
