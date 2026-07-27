import { transformPoint } from '@/core/math/Transform';
import type { Transform } from '@/core/math/Transform';
import { dotVec3, lengthVec3, subVec3 } from '@/core/math/Vec3';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import type { Armature, BoneInfluence, SkinBinding } from '@/core/rig/types';
import { createId } from '@/core/ids/IdService';
import type { ObjectId } from '@/core/document/types';
import {
  boneHeadTailWorld,
  boneWorldMatrix,
  orderedBoneIds,
  restBoneLocalTransforms,
} from '@/core/rig/boneMatrices';
import { normalizeInfluences } from '@/core/rig/skinBindingUtils';

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

function envelopeWeight(distance: number, radius: number): number {
  const t = clamp(distance / Math.max(radius, 0.001), 0, 1);
  if (t >= 1) return 0;
  const edge = t * t * (3 - 2 * t);
  return 1 - edge;
}

/** Hierarchy-aware envelope weights using bone segment distance in armature space. */
export function generateEnvelopeSkinBinding(
  name: string,
  mesh: EditableMesh,
  objectId: ObjectId,
  armature: Armature,
  objectTransform: Transform | null = null,
  falloff = 0.55,
): SkinBinding {
  const vertexWeights = new Map<VertexId, BoneInfluence[]>();
  const restLocals = restBoneLocalTransforms(armature);
  const worldCache = new Map();
  const boneSegments: {
    boneId: string;
    head: { x: number; y: number; z: number };
    tail: { x: number; y: number; z: number };
    radius: number;
  }[] = [];

  for (const boneId of orderedBoneIds(armature)) {
    const bone = armature.bones.get(boneId);
    if (!bone) continue;
    const world = boneWorldMatrix(armature, boneId, restLocals, worldCache);
    const { head, tail } = boneHeadTailWorld(bone, world);
    const segmentLength = Math.max(lengthVec3(subVec3(tail, head)), 0.05);
    boneSegments.push({
      boneId,
      head,
      tail,
      radius: Math.max(segmentLength * falloff, falloff * 0.35, 0.08),
    });
  }

  const objTransform = objectTransform ?? {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };

  for (const vertex of mesh.vertices.values()) {
    const worldPos = transformPoint(vertex.position, objTransform);
    const influences: BoneInfluence[] = [];

    for (const segment of boneSegments) {
      const distance = distanceToSegment(worldPos, segment.head, segment.tail);
      const weight = envelopeWeight(distance, segment.radius);
      if (weight > 0.0005) influences.push({ boneId: segment.boneId, weight });
    }

    influences.sort((a, b) => b.weight - a.weight);
    vertexWeights.set(vertex.id, normalizeInfluences(influences));
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

/** Recompute weights for an existing binding (preserves id). */
export function recomputeEnvelopeWeights(
  binding: SkinBinding,
  mesh: EditableMesh,
  armature: Armature,
  objectTransform: Transform | null = null,
  falloff = 0.55,
): void {
  const fresh = generateEnvelopeSkinBinding(binding.name, mesh, binding.objectId, armature, objectTransform, falloff);
  binding.vertexWeights = fresh.vertexWeights;
}

export { normalizeInfluences, pruneBoneInfluences, normalizeBindingWeights, skinBindingSignature } from '@/core/rig/skinBindingUtils';
