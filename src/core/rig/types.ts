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

export type KeyframeInterpolation = 'smooth' | 'linear' | 'step';

export type TransformKeyframe = {
  time: number;
  value: Transform;
  interpolation?: KeyframeInterpolation;
};

export type BoneAnimationTrack = {
  boneId: BoneId;
  keyframes: TransformKeyframe[];
};

export type AnimationEvent = {
  id: string;
  time: number;
  name: string;
  parameter?: string;
  category?: 'audio' | 'gameplay' | 'fx' | 'custom';
  payload?: Record<string, unknown>;
};

export type AnimationMarker = {
  id: string;
  time: number;
  name: string;
  color?: string;
};

export type AnimationClip = {
  id: AnimationClipId;
  name: string;
  duration: number;
  fps: number;
  tracks: BoneAnimationTrack[];
  events?: AnimationEvent[];
  markers?: AnimationMarker[];
  rootMotion?: boolean;
  rootMotionMode?: 'none' | 'xz' | 'xyz' | 'rotation' | 'translation_rotation';
  loopMode?: 'once' | 'loop' | 'pingpong';
  animationType?: 'normal' | 'additive';
};

export type RigClipSequenceItem = {
  id: string;
  clipId: AnimationClipId;
  name: string;
  startTime: number;
  duration: number;
  speedMultiplier: number;
  blendIn: number;
  blendOut: number;
};

export type RigCustomPose = {
  id: string;
  name: string;
  transforms: Record<BoneId, Transform>;
};

export type RigConstraint = {
  id: string;
  name: string;
  ownerId: BoneId;
  targetId?: BoneId;
  type: string;
  influence: number;
  enabled: boolean;
  limits?: {
    min?: { x: number; y: number; z: number };
    max?: { x: number; y: number; z: number };
  };
  offset?: Transform;
};

export type RigDocumentSettings = {
  /** Model document that supplies skin meshes for this rig. */
  sourceModelDocumentId: DocumentId | null;
  armatureId: ArmatureId | null;
  skinBindingIds: SkinBindingId[];
  /** All animation clips owned by this rig document. */
  clipIds: AnimationClipId[];
  activeClipId: AnimationClipId | null;
  /** Clip sequencer playlist. Survives save/open. */
  clipSequence: RigClipSequenceItem[];
  /** Named pose snapshots from the dope sheet. Survives save/open. */
  customPoses: RigCustomPose[];
  /** Bone constraints from the animation inspector. Survives save/open. */
  constraints: RigConstraint[];
};

export function createDefaultRigDocumentSettings(sourceModelDocumentId: DocumentId | null = null): RigDocumentSettings {
  return {
    sourceModelDocumentId,
    armatureId: null,
    skinBindingIds: [],
    clipIds: [],
    activeClipId: null,
    clipSequence: [],
    customPoses: [],
    constraints: [],
  };
}
