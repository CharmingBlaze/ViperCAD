import type { ViperDocument } from '@/core/document/types';
import type { ViperProject } from '@/core/document/types';
import { cloneTransform } from '@/core/math/Transform';
import { createDefaultArmature } from '@/core/rig/ArmatureFactory';
import {
  createDefaultRigDocumentSettings,
  type AnimationClip,
  type Armature,
  type RigClipSequenceItem,
  type RigConstraint,
  type RigCustomPose,
  type RigDocumentSettings,
  type SkinBinding,
} from '@/core/rig/types';
import { createId } from '@/core/ids/IdService';

export function readRigDocumentSettings(doc: ViperDocument): RigDocumentSettings {
  const rig = doc.settings.rig;
  if (!rig) return createDefaultRigDocumentSettings();
  const activeClipId = rig.activeClipId ?? null;
  const clipIds = rig.clipIds?.length
    ? [...rig.clipIds]
    : activeClipId
      ? [activeClipId]
      : [];
  return {
    sourceModelDocumentId: rig.sourceModelDocumentId ?? null,
    armatureId: rig.armatureId ?? null,
    skinBindingIds: [...(rig.skinBindingIds ?? [])],
    clipIds,
    activeClipId,
    clipSequence: cloneClipSequence(rig.clipSequence),
    customPoses: cloneCustomPoses(rig.customPoses),
    constraints: cloneConstraints(rig.constraints),
  };
}

export function writeRigDocumentSettings(doc: ViperDocument, settings: RigDocumentSettings): void {
  doc.settings.rig = {
    sourceModelDocumentId: settings.sourceModelDocumentId,
    armatureId: settings.armatureId,
    skinBindingIds: [...settings.skinBindingIds],
    clipIds: [...settings.clipIds],
    activeClipId: settings.activeClipId,
    clipSequence: cloneClipSequence(settings.clipSequence),
    customPoses: cloneCustomPoses(settings.customPoses),
    constraints: cloneConstraints(settings.constraints),
  };
}

function cloneConstraints(items: RigConstraint[] | undefined): RigConstraint[] {
  if (!items?.length) return [];
  return items.map((item) => ({
    ...item,
    limits: item.limits
      ? {
          min: item.limits.min ? { ...item.limits.min } : undefined,
          max: item.limits.max ? { ...item.limits.max } : undefined,
        }
      : undefined,
    offset: item.offset ? cloneTransform(item.offset) : undefined,
  }));
}

function cloneClipSequence(items: RigClipSequenceItem[] | undefined): RigClipSequenceItem[] {
  if (!items?.length) return [];
  return items.map((item) => ({ ...item }));
}

function cloneCustomPoses(poses: RigCustomPose[] | undefined): RigCustomPose[] {
  if (!poses?.length) return [];
  return poses.map((pose) => ({
    id: pose.id,
    name: pose.name,
    transforms: Object.fromEntries(
      Object.entries(pose.transforms ?? {}).map(([id, transform]) => [id, cloneTransform(transform)]),
    ),
  }));
}

export function ensureRigArmature(project: ViperProject, rigDocument: ViperDocument): Armature {
  const settings = readRigDocumentSettings(rigDocument);
  if (settings.armatureId) {
    const existing = project.armatures.get(settings.armatureId);
    if (existing) return existing;
  }
  const armature = createDefaultArmature(`${rigDocument.name} Armature`);
  project.armatures.set(armature.id, armature);
  settings.armatureId = armature.id;
  writeRigDocumentSettings(rigDocument, settings);
  project.dirty = true;
  rigDocument.dirty = true;
  return armature;
}

export function listRigDocuments(project: ViperProject): ViperDocument[] {
  return project.rigDocumentIds
    .map((id) => project.documents.get(id))
    .filter(Boolean) as ViperDocument[];
}

export function createDefaultAnimationClip(name = 'Action'): AnimationClip {
  return {
    id: createId('clip'),
    name,
    duration: 1,
    fps: 24,
    tracks: [],
  };
}

export function getActiveClip(project: ViperProject, rigDocument: ViperDocument): AnimationClip | null {
  const settings = readRigDocumentSettings(rigDocument);
  if (!settings.activeClipId) return null;
  return project.animationClips.get(settings.activeClipId) ?? null;
}

export function ensureActiveClip(project: ViperProject, rigDocument: ViperDocument): AnimationClip {
  const settings = readRigDocumentSettings(rigDocument);
  if (settings.activeClipId) {
    const existing = project.animationClips.get(settings.activeClipId);
    if (existing) return existing;
  }
  const clip = createDefaultAnimationClip('Action');
  project.animationClips.set(clip.id, clip);
  settings.clipIds.push(clip.id);
  settings.activeClipId = clip.id;
  writeRigDocumentSettings(rigDocument, settings);
  project.dirty = true;
  rigDocument.dirty = true;
  return clip;
}

export function getSkinBindingsForRig(project: ViperProject, rigDocument: ViperDocument): SkinBinding[] {
  const settings = readRigDocumentSettings(rigDocument);
  return settings.skinBindingIds
    .map((id) => project.skinBindings.get(id))
    .filter(Boolean) as SkinBinding[];
}

export function findBindingForObject(
  project: ViperProject,
  rigDocument: ViperDocument,
  objectId: string,
): SkinBinding | null {
  return getSkinBindingsForRig(project, rigDocument).find((binding) => binding.objectId === objectId) ?? null;
}
