import { subVec3 } from '@/core/math/Vec3';
import { getEdgeVertices } from '@/core/mesh/EditableMesh';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import type { Armature, BoneId, SkinBinding } from '@/core/rig/types';
import { normalizeInfluences } from '@/core/rig/skinBindingUtils';
import { recomputeEnvelopeWeights } from '@/core/rig/skinning';

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

export function normalizeAllSkinWeights(binding: SkinBinding): void {
  for (const [vertexId, influences] of binding.vertexWeights.entries()) {
    binding.vertexWeights.set(vertexId, normalizeInfluences(influences));
  }
}

/** Mirror skin weights from +X vertices to -X vertices across armature */
export function mirrorSkinWeightsX(
  mesh: EditableMesh,
  binding: SkinBinding,
  armature: Armature,
): number {
  // Build bone L <-> R mapping
  const bonePair = new Map<BoneId, BoneId>();
  for (const b1 of armature.bones.values()) {
    const n1 = b1.name.toLowerCase();
    if (n1.endsWith('_l') || n1.endsWith('.l') || n1.includes('_l_')) {
      const counterpartName = n1.replace('_l', '_r').replace('.l', '.r').replace('_l_', '_r_');
      for (const b2 of armature.bones.values()) {
        if (b2.name.toLowerCase() === counterpartName) {
          bonePair.set(b1.id, b2.id);
          bonePair.set(b2.id, b1.id);
          break;
        }
      }
    }
  }

  const vertices = [...mesh.vertices.values()];
  let mirrored = 0;

  for (const v1 of vertices) {
    if (v1.position.x <= 0) continue; // Source side (+X)
    
    // Find symmetrical vertex at -X
    let closest: typeof v1 | null = null;
    let minDistanceSq = 1e-4; // 1cm tolerance

    for (const v2 of vertices) {
      if (v2.position.x >= 0) continue;
      const dx = v2.position.x - (-v1.position.x);
      const dy = v2.position.y - v1.position.y;
      const dz = v2.position.z - v1.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < minDistanceSq) {
        minDistanceSq = distSq;
        closest = v2;
      }
    }

    if (closest) {
      const sourceWeights = binding.vertexWeights.get(v1.id) ?? [];
      const mirroredWeights = sourceWeights.map((entry) => ({
        boneId: bonePair.get(entry.boneId) ?? entry.boneId,
        weight: entry.weight,
      }));
      binding.vertexWeights.set(closest.id, normalizeInfluences(mirroredWeights));
      mirrored++;
    }
  }
  return mirrored;
}

/** Smooth skin weight transitions between vertex neighbors */
export function smoothSkinWeights(
  mesh: EditableMesh,
  binding: SkinBinding,
  iterations = 2,
): number {
  const vertices = [...mesh.vertices.values()];
  if (vertices.length < 2) return 0;

  for (let iter = 0; iter < iterations; iter++) {
    const nextWeights = new Map<VertexId, ReturnType<typeof normalizeInfluences>>();

    for (const v of vertices) {
      const neighborIds: VertexId[] = [];
      for (const edge of mesh.edges.values()) {
        const pair = getEdgeVertices(mesh, edge.id);
        if (!pair) continue;
        if (pair[0] === v.id) neighborIds.push(pair[1]);
        else if (pair[1] === v.id) neighborIds.push(pair[0]);
      }

      if (!neighborIds.length) continue;

      const accumulated = new Map<BoneId, number>();
      const current = binding.vertexWeights.get(v.id) ?? [];
      
      // Weight current vertex 50%, neighbors 50%
      for (const entry of current) {
        accumulated.set(entry.boneId, (accumulated.get(entry.boneId) ?? 0) + entry.weight * 0.5);
      }

      const neighborFactor = 0.5 / neighborIds.length;
      for (const nId of neighborIds) {
        const nWeights = binding.vertexWeights.get(nId) ?? [];
        for (const entry of nWeights) {
          accumulated.set(entry.boneId, (accumulated.get(entry.boneId) ?? 0) + entry.weight * neighborFactor);
        }
      }

      const blended = [...accumulated.entries()].map(([boneId, weight]) => ({ boneId, weight }));
      nextWeights.set(v.id, normalizeInfluences(blended));
    }

    for (const [vId, weights] of nextWeights) {
      binding.vertexWeights.set(vId, weights);
    }
  }
  return vertices.length;
}

/** Project vertex to bone capsule segment and compute automatic skin weights */
export function computeAutoCapsuleWeights(
  mesh: EditableMesh,
  binding: SkinBinding,
  armature: Armature,
  _maxInfluences = 4,
): number {
  if (!armature.bones.size || !mesh.vertices.size) return 0;
  recomputeEnvelopeWeights(binding, mesh, armature);
  return binding.vertexWeights.size;
}
