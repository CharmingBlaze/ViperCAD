import { createId } from '@/core/ids/IdService';
import type { ObjectId } from '@/core/document/types';
import { dotVec3, lengthVec3, subVec3 } from '@/core/math/Vec3';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import type { Armature, BoneId, BoneInfluence, SkinBinding } from '@/core/rig/types';
import { normalizeInfluences } from '@/core/rig/skinBindingUtils';
import { restBoneLocalTransforms } from '@/core/rig/boneMatrices';

export type WeightOperation = 'set' | 'add' | 'subtract' | 'remove';

/**
 * Assign or modify weights for a specific set of vertices on a bone.
 */
export function assignVertexWeights(
  binding: SkinBinding,
  vertexIds: VertexId[],
  boneId: BoneId,
  weight: number,
  operation: WeightOperation = 'set',
  maxInfluences = 4,
): number {
  let modifiedCount = 0;
  const clampedWeight = Math.max(0, Math.min(1, weight));

  for (const vertexId of vertexIds) {
    let influences = [...(binding.vertexWeights.get(vertexId) ?? [])];
    const existingIndex = influences.findIndex((inf) => inf.boneId === boneId);

    if (operation === 'remove') {
      if (existingIndex >= 0) {
        influences.splice(existingIndex, 1);
        influences = normalizeInfluences(influences);
        binding.vertexWeights.set(vertexId, influences);
        modifiedCount++;
      }
      continue;
    }

    let targetWeight = clampedWeight;
    if (operation === 'add' && existingIndex >= 0) {
      targetWeight = Math.min(1, influences[existingIndex]!.weight + clampedWeight);
    } else if (operation === 'subtract' && existingIndex >= 0) {
      targetWeight = Math.max(0, influences[existingIndex]!.weight - clampedWeight);
    }

    if (targetWeight <= 0.001) {
      if (existingIndex >= 0) {
        influences.splice(existingIndex, 1);
      }
    } else if (existingIndex >= 0) {
      influences[existingIndex]!.weight = targetWeight;
    } else {
      influences.push({ boneId, weight: targetWeight });
    }

    // Prune to maxInfluences and normalize
    if (influences.length > maxInfluences) {
      influences.sort((a, b) => b.weight - a.weight);
      influences = influences.slice(0, maxInfluences);
    }
    influences = normalizeInfluences(influences);
    binding.vertexWeights.set(vertexId, influences);
    modifiedCount++;
  }

  return modifiedCount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distanceToSegment(
  point: { x: number; y: number; z: number },
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const ab = subVec3(b, a);
  const ap = subVec3(point, a);
  const denom = dotVec3(ab, ab);
  const t = denom > 1e-8 ? clamp(dotVec3(ap, ab) / denom, 0, 1) : 0;
  const closest = {
    x: a.x + ab.x * t,
    y: a.y + ab.y * t,
    z: a.z + ab.z * t,
  };
  return lengthVec3(subVec3(point, closest));
}

/**
 * Rigid Skin Binding: exactly 1 bone per vertex (100% influence).
 * Essential for robots, low-poly models, weapons, machinery, and stylized geometry.
 */
export function generateRigidSkinBinding(
  name: string,
  mesh: EditableMesh,
  objectId: ObjectId,
  armature: Armature,
): SkinBinding {
  const vertexWeights = new Map<VertexId, BoneInfluence[]>();
  const restLocals = restBoneLocalTransforms(armature);

  // Compute bone segment lines
  const boneSegments: { boneId: BoneId; head: { x: number; y: number; z: number }; tail: { x: number; y: number; z: number } }[] = [];
  for (const [id, bone] of armature.bones) {
    const head = restLocals.get(id)?.position ?? { x: 0, y: 0, z: 0 };
    const tail = {
      x: head.x + bone.tailLocal.x,
      y: head.y + bone.tailLocal.y,
      z: head.z + bone.tailLocal.z,
    };
    boneSegments.push({ boneId: id, head, tail });
  }

  for (const [vId, vertex] of mesh.vertices) {
    let closestBoneId: BoneId | null = null;
    let minDistance = Infinity;

    for (const segment of boneSegments) {
      const dist = distanceToSegment(vertex.position, segment.head, segment.tail);
      if (dist < minDistance) {
        minDistance = dist;
        closestBoneId = segment.boneId;
      }
    }

    if (closestBoneId) {
      vertexWeights.set(vId, [{ boneId: closestBoneId, weight: 1.0 }]);
    }
  }

  return {
    id: createId('skin'),
    name,
    meshId: mesh.id,
    objectId,
    armatureId: armature.id,
    vertexWeights,
  };
}
