import { lengthVec3, subVec3 } from '@/core/math/Vec3';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import type { BoneId, SkinBinding } from '@/core/rig/types';
import { normalizeInfluences } from '@/core/rig/skinBindingUtils';

export function paintBoneWeight(
  mesh: EditableMesh,
  binding: SkinBinding,
  boneId: BoneId,
  brushCenterMeshLocal: { x: number; y: number; z: number },
  radius: number,
  strength: number,
  add: boolean,
): number {
  const radiusSq = radius * radius;
  let touched = 0;
  for (const vertex of mesh.vertices.values()) {
    const delta = subVec3(vertex.position, brushCenterMeshLocal);
    const distSq = delta.x * delta.x + delta.y * delta.y + delta.z * delta.z;
    if (distSq > radiusSq) continue;
    const dist = Math.sqrt(distSq);
    const falloff = 1 - dist / Math.max(radius, 0.0001);
    const influence = Math.max(0, Math.min(1, strength * falloff * falloff));
    const current = [...(binding.vertexWeights.get(vertex.id) ?? [])];
    const index = current.findIndex((entry) => entry.boneId === boneId);
    if (add) {
      const existing = index >= 0 ? current[index]!.weight : 0;
      const nextWeight = existing + influence * (1 - existing);
      if (index >= 0) current[index] = { boneId, weight: nextWeight };
      else current.push({ boneId, weight: nextWeight });
    } else if (index >= 0) {
      current[index] = { boneId, weight: Math.max(0, current[index]!.weight * (1 - influence)) };
    }
    binding.vertexWeights.set(vertex.id, normalizeInfluences(current));
    touched += 1;
  }
  return touched;
}

export function weightColorForBone(weight: number, active: boolean): [number, number, number] {
  if (active) return [1, 0.35, 0.15];
  const intensity = Math.max(0, Math.min(1, weight));
  return [0.2 + intensity * 0.5, 0.25 + intensity * 0.55, 0.35 + intensity * 0.4];
}

export function vertexWeightForBone(binding: SkinBinding, vertexId: VertexId, boneId: BoneId): number {
  return binding.vertexWeights.get(vertexId)?.find((entry) => entry.boneId === boneId)?.weight ?? 0;
}
