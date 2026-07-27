import type { DocumentId, ObjectId } from '@/core/document/types';
import type { ElementId } from '@/core/ids/IdService';
import type { Transform } from '@/core/math/Transform';
import type { Vec3 } from '@/core/math/Vec3';
import type { MeshId, VertexId } from '@/core/mesh/types';

export type BoneId = ElementId;
export type ArmatureId = ElementId;
export type SkinBindingId = ElementId;
export type AnimationClipId = ElementId;

export type Bone = {
  id: BoneId;
  name: string;
  parentId: BoneId | null;
  /** Tip relative to head in bone-local space (Y-up bone axis). */
  tailLocal: Vec3;
  roll: number;
  /** Pose transform relative to parent bone. */
  localTransform: Transform;
};

export type Armature = {
  id: ArmatureId;
  name: string;
  rootBoneIds: BoneId[];
  bones: Map<BoneId, Bone>;
  /** Object-space rest transform for the armature root. */
  restTransform: Transform;
};

export type BoneInfluence = {
  boneId: BoneId;
  weight: number;
};

export type SkinBinding = {
  id: SkinBindingId;
  name: string;
  meshId: MeshId;
  objectId: ObjectId;
  armatureId: ArmatureId;
  /** Up to four bone influences per mesh vertex. */
  vertexWeights: Map<VertexId, BoneInfluence[]>;
};

export type TransformKeyframe = {
  time: number;
  value: Transform;
};

export type BoneAnimationTrack = {
  boneId: BoneId;
  keyframes: TransformKeyframe[];
};

export type AnimationClip = {
  id: AnimationClipId;
  name: string;
  duration: number;
  fps: number;
  tracks: BoneAnimationTrack[];
};

export type RigDocumentSettings = {
  /** Model document that supplies skin meshes for this rig. */
  sourceModelDocumentId: DocumentId | null;
  armatureId: ArmatureId | null;
  skinBindingIds: SkinBindingId[];
  /** All animation clips owned by this rig document. */
  clipIds: AnimationClipId[];
  activeClipId: AnimationClipId | null;
};

export function createDefaultRigDocumentSettings(sourceModelDocumentId: DocumentId | null = null): RigDocumentSettings {
  return {
    sourceModelDocumentId,
    armatureId: null,
    skinBindingIds: [],
    clipIds: [],
    activeClipId: null,
  };
}
