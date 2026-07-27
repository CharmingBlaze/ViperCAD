import { getObjectWorldMatrix } from '@/core/editor/Hierarchy';
import { reparentObject } from '@/core/editor/Hierarchy';
import { cloneTransform } from '@/core/math/Transform';
import type { Transform } from '@/core/math/Transform';
import { inverseTransformPointApprox } from '@/core/math/Transform';
import type { ViperProject } from '@/core/document/types';
import type { ViperDocument } from '@/core/document/types';
import type { ModelDocument } from '@/core/document/types';
import type { ObjectId } from '@/core/document/types';
import { removeObject } from '@/core/document/ModelDocument';
import {
  addSceneObject,
  createRigCameraObject,
  createRigLightObject,
  type RigLightType,
} from './scene/RigSceneAssets';
import { deserializeViperProject, serializeViperProject } from '@/core/persistence/ProjectSerializer';
import {
  createClipForRig,
  deleteClipForRig,
  duplicateClip,
  listClipsForRig,
  renameClip,
  setActiveClip,
  snapTimeToFrame,
} from '@/core/rig/AnimationLibrary';
import {
  addBone,
  extrudeBone,
  removeBone,
  renameBone,
  reparentBone,
  resetBonePose,
  setBoneTail,
} from '@/core/rig/ArmatureEditor';
import {
  ensureActiveClip,
  ensureRigArmature,
  findBindingForObject,
  getActiveClip,
  getSkinBindingsForRig,
  readRigDocumentSettings,
  writeRigDocumentSettings,
} from '@/core/rig/RigDocument';
import {
  insertBoneKeyframe,
  moveBoneKeyframe,
  removeBoneKeyframe,
  sampledLocalTransforms,
} from '@/core/rig/keyframes';
import { generateEnvelopeSkinBinding, recomputeEnvelopeWeights, normalizeBindingWeights, pruneBoneInfluences } from '@/core/rig/skinning';
import { paintBoneWeight } from '@/core/rig/weightPaint';
import {
  applyCurrentPoseAsRest,
  clearAnimationTracks,
  resetArmatureRestPose,
} from '@/core/rig/RestPose';
import { ViperLink } from '@/core/link/ViperLink';
import type { AnimationClipId, BoneId } from '@/core/rig/types';
import type { RigViewportDisplayMode } from '@/core/rig/rigMeshDisplay';
import { boneWorldMatrix, invertMat4Affine, transformVec3ByMat4 } from '@/core/rig/boneMatrices';
import { Euler } from 'three';

export type RigEditMode = 'edit' | 'pose' | 'weight';

export type RigSetupStatus = {
  sourceModelName: string | null;
  meshObjectCount: number;
  armatureBoneCount: number;
  skinBindingCount: number;
  isLinked: boolean;
  isReady: boolean;
};

function objectWorldTransform(document: ModelDocument, objectId: string): Transform {
  const matrix = getObjectWorldMatrix(document, objectId);
  const euler = new Euler().setFromRotationMatrix(matrix);
  return {
    position: { x: matrix.elements[12]!, y: matrix.elements[13]!, z: matrix.elements[14]! },
    rotation: { x: euler.x, y: euler.y, z: euler.z },
    scale: {
      x: Math.hypot(matrix.elements[0]!, matrix.elements[1]!, matrix.elements[2]!) || 1,
      y: Math.hypot(matrix.elements[4]!, matrix.elements[5]!, matrix.elements[6]!) || 1,
      z: Math.hypot(matrix.elements[8]!, matrix.elements[9]!, matrix.elements[10]!) || 1,
    },
  };
}

export class RigSession {
  project: ViperProject;
  rigDocumentId: string;
  playbackTime = 0;
  playing = false;
  selectedBoneId: BoneId | null = null;
  selectedObjectId: ObjectId | null = null;
  editMode: RigEditMode = 'pose';
  autoKeyframe = true;
  weightBrushRadius = 0.15;
  weightBrushStrength = 0.35;
  weightBrushAdd = true;
  envelopeFalloff = 0.55;
  viewportDisplayMode: RigViewportDisplayMode = 'material';
  timelineZoom = 10;
  loopPlayback = true;
  private link = new ViperLink('viperrig');
  private listeners = new Set<() => void>();

  constructor(project: ViperProject, rigDocumentId: string) {
    this.project = project;
    this.rigDocumentId = rigDocumentId;
    this.link.connect(project.id);
    this.link.onMessage((envelope) => {
      if (envelope.type === 'project-snapshot') {
        const payload = envelope.payload as { projectJson?: string };
        if (payload?.projectJson) {
          this.project = deserializeViperProject(payload.projectJson).project;
          this.notify();
        }
      }
    });
    this.link.publish('request-sync', {});
  }

  get rigDocument(): ViperDocument {
    const doc = this.project.documents.get(this.rigDocumentId);
    if (!doc || doc.kind !== 'rig') throw new Error('Rig document not found');
    return doc;
  }

  getSourceModel(): ModelDocument | null {
    const settings = readRigDocumentSettings(this.rigDocument);
    const sourceId = settings.sourceModelDocumentId;
    if (!sourceId) return null;
    const doc = this.project.documents.get(sourceId);
    return doc ? (doc as ModelDocument) : null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
  }

  pushToCad(): void {
    this.link.publish('rig-snapshot', {
      rigDocumentId: this.rigDocumentId,
      projectJson: serializeViperProject(this.project),
      sourceApp: 'viperrig',
    });
  }

  pullFromCad(projectJson: string): void {
    this.project = deserializeViperProject(projectJson).project;
    this.notify();
  }

  ensureSetup(): void {
    const doc = this.rigDocument;
    ensureRigArmature(this.project, doc);
    ensureActiveClip(this.project, doc);
    if (!this.selectedBoneId) {
      const settings = readRigDocumentSettings(doc);
      const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
      this.selectedBoneId = armature?.rootBoneIds[0] ?? null;
    }
  }

  getSetupStatus(): RigSetupStatus {
    const doc = this.rigDocument;
    const settings = readRigDocumentSettings(doc);
    const source = settings.sourceModelDocumentId
      ? this.project.documents.get(settings.sourceModelDocumentId)
      : null;
    let meshObjectCount = 0;
    if (source) {
      for (const object of source.objects.values()) {
        if (object.meshId && this.project.meshes.has(object.meshId)) meshObjectCount += 1;
      }
    }
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    const skinBindingCount = getSkinBindingsForRig(this.project, doc).length;
    return {
      sourceModelName: source?.name ?? null,
      meshObjectCount,
      armatureBoneCount: armature?.bones.size ?? 0,
      skinBindingCount,
      isLinked: true,
      isReady: skinBindingCount > 0 && (armature?.bones.size ?? 0) > 0,
    };
  }

  runQuickSetup(syncToCad = true): number {
    this.ensureSetup();
    const bound = this.bindMeshesFromSourceModel(true);
    if (!this.selectedBoneId) {
      const settings = readRigDocumentSettings(this.rigDocument);
      const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
      this.selectedBoneId = armature?.rootBoneIds[0] ?? null;
    }
    if (syncToCad) this.pushToCad();
    this.notify();
    return bound;
  }

  bindMeshesFromSourceModel(recomputeExisting = false): number {
    const doc = this.rigDocument;
    const settings = readRigDocumentSettings(doc);
    const sourceId = settings.sourceModelDocumentId;
    if (!sourceId) return 0;
    const source = this.project.documents.get(sourceId);
    if (!source) return 0;
    const armature = ensureRigArmature(this.project, doc);
    let touched = 0;

    for (const object of source.objects.values()) {
      if (!object.meshId || !this.project.meshes.has(object.meshId)) continue;
      const mesh = this.project.meshes.get(object.meshId)!;
      const worldTransform = objectWorldTransform(source as ModelDocument, object.id);
      const existing = findBindingForObject(this.project, doc, object.id);

      if (existing && recomputeExisting) {
        recomputeEnvelopeWeights(existing, mesh, armature, worldTransform, this.envelopeFalloff);
        touched += 1;
        continue;
      }
      if (existing) continue;

      const binding = generateEnvelopeSkinBinding(object.name, mesh, object.id, armature, worldTransform, this.envelopeFalloff);
      this.project.skinBindings.set(binding.id, binding);
      if (!settings.skinBindingIds.includes(binding.id)) {
        settings.skinBindingIds.push(binding.id);
        touched += 1;
      }
    }

    writeRigDocumentSettings(doc, settings);
    this.project.dirty = true;
    doc.dirty = true;
    this.notify();
    return touched;
  }

  getClips() {
    return listClipsForRig(this.project, this.rigDocument);
  }

  createClip(name?: string) {
    const clip = createClipForRig(this.project, this.rigDocument, name);
    this.notify();
    return clip;
  }

  deleteClip(clipId: AnimationClipId) {
    const ok = deleteClipForRig(this.project, this.rigDocument, clipId);
    if (ok) this.notify();
    return ok;
  }

  switchClip(clipId: AnimationClipId) {
    const ok = setActiveClip(this.project, this.rigDocument, clipId);
    if (ok) {
      this.playbackTime = 0;
      this.notify();
    }
    return ok;
  }

  duplicateActiveClip() {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip) return null;
    const copy = duplicateClip(this.project, this.rigDocument, clip.id);
    if (copy) this.notify();
    return copy;
  }

  renameActiveClip(name: string) {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip) return;
    renameClip(this.project, clip.id, name);
    this.notify();
  }

  getSelectedBoneLocalTransform(): Transform | null {
    if (!this.selectedBoneId) return null;
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return null;
    if (this.editMode === 'edit') {
      return cloneTransform(armature.bones.get(this.selectedBoneId)!.localTransform);
    }
    const clip = getActiveClip(this.project, this.rigDocument);
    const locals = sampledLocalTransforms(armature, clip, this.playbackTime);
    return cloneTransform(locals.get(this.selectedBoneId) ?? armature.bones.get(this.selectedBoneId)!.localTransform);
  }

  setSelectedBoneLocalTransform(transform: Transform): void {
    if (!this.selectedBoneId) return;
    const doc = this.rigDocument;
    const settings = readRigDocumentSettings(doc);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return;
    const bone = armature.bones.get(this.selectedBoneId);
    if (!bone) return;

    const snapshot = cloneTransform(transform);

    if (this.editMode === 'edit') {
      bone.localTransform = snapshot;
    } else if (this.editMode === 'pose') {
      const clip = ensureActiveClip(this.project, doc);
      insertBoneKeyframe(clip, this.selectedBoneId, this.playbackTime, snapshot);
    } else {
      return;
    }

    this.project.dirty = true;
    doc.dirty = true;
    this.notify();
  }

  setSelectedBoneTail(tail: { x: number; y: number; z: number }): void {
    if (!this.selectedBoneId || this.editMode !== 'edit') return;
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return;
    setBoneTail(armature, this.selectedBoneId, tail);
    this.markDirty();
  }

  getSelectedBoneTail(): { x: number; y: number; z: number } | null {
    if (!this.selectedBoneId) return null;
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    const bone = armature?.bones.get(this.selectedBoneId);
    return bone ? { ...bone.tailLocal } : null;
  }

  setSelectedBoneRoll(roll: number): void {
    if (!this.selectedBoneId || this.editMode !== 'edit') return;
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const bone = armature.bones.get(this.selectedBoneId);
    if (!bone) return;
    bone.roll = roll;
    this.markDirty();
  }

  reparentSelectedBone(newParentId: BoneId | null): boolean {
    if (!this.selectedBoneId || this.editMode !== 'edit') return false;
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const ok = reparentBone(armature, this.selectedBoneId, newParentId);
    if (ok) this.markDirty();
    return ok;
  }

  seekTo(time: number): void {
    const clip = getActiveClip(this.project, this.rigDocument);
    const duration = clip?.duration ?? 1;
    this.playbackTime = Math.max(0, Math.min(duration, time));
    this.playing = false;
    this.notify();
  }

  moveKeyframe(boneId: BoneId, fromTime: number, toTime: number): boolean {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip) return false;
    const ok = moveBoneKeyframe(clip, boneId, fromTime, toTime);
    if (ok) this.markDirty();
    return ok;
  }

  /** Set bone tail from a world-space point (edit mode). */
  setSelectedBoneTailFromWorld(worldPoint: { x: number; y: number; z: number }): void {
    if (!this.selectedBoneId || this.editMode !== 'edit') return;
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return;
    const locals = sampledLocalTransforms(armature, null, 0);
    const cache = new Map();
    const world = boneWorldMatrix(armature, this.selectedBoneId, locals, cache);
    const inv = invertMat4Affine(world);
    const local = transformVec3ByMat4(inv, worldPoint);
    setBoneTail(armature, this.selectedBoneId, local);
    this.markDirty();
  }

  /** Nudge bone head in world space (edit mode). */
  nudgeSelectedBoneHead(worldDelta: { x: number; y: number; z: number }): void {
    if (!this.selectedBoneId || this.editMode !== 'edit') return;
    const transform = this.getSelectedBoneLocalTransform();
    if (!transform) return;
    transform.position.x += worldDelta.x;
    transform.position.y += worldDelta.y;
    transform.position.z += worldDelta.z;
    this.setSelectedBoneLocalTransform(transform);
  }

  keyframeAllBones(): void {
    const doc = this.rigDocument;
    const clip = ensureActiveClip(this.project, doc);
    const settings = readRigDocumentSettings(doc);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return;
    const locals = sampledLocalTransforms(armature, clip, this.playbackTime);
    for (const [boneId, value] of locals) {
      insertBoneKeyframe(clip, boneId, this.playbackTime, value);
    }
    this.markDirty();
  }

  clearAllKeyframes(): void {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (clip) {
      clip.tracks = [];
      this.markDirty();
    }
  }

  addBoneToSelection(name = 'bone'): BoneId | null {
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const parentId = this.selectedBoneId;
    const bone = addBone(armature, name, parentId);
    this.selectedBoneId = bone.id;
    this.markDirty();
    return bone.id;
  }

  extrudeSelectedBone(): BoneId | null {
    if (!this.selectedBoneId || this.editMode !== 'edit') return null;
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const child = extrudeBone(armature, this.selectedBoneId);
    if (child) {
      this.selectedBoneId = child.id;
      this.markDirty();
      return child.id;
    }
    return null;
  }

  /** Rotate selected bone in pose mode from viewport drag (radians). */
  rotateSelectedBoneInPose(deltaYaw: number, deltaPitch: number): void {
    if (!this.selectedBoneId || this.editMode !== 'pose') return;
    const transform = this.getSelectedBoneLocalTransform();
    if (!transform) return;
    transform.rotation.y += deltaYaw;
    transform.rotation.x += deltaPitch;
    this.setSelectedBoneLocalTransform(transform);
  }

  normalizeAllBindingWeights(): void {
    const settings = readRigDocumentSettings(this.rigDocument);
    for (const bindingId of settings.skinBindingIds) {
      const binding = this.project.skinBindings.get(bindingId);
      if (binding) normalizeBindingWeights(binding);
    }
    this.markDirty();
  }

  deleteSelectedBone(): boolean {
    if (!this.selectedBoneId || this.editMode !== 'edit') return false;
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature || armature.bones.size <= 1) return false;
    const removed = removeBone(armature, this.selectedBoneId);
    for (const bindingId of settings.skinBindingIds) {
      const binding = this.project.skinBindings.get(bindingId);
      if (binding) pruneBoneInfluences(binding, removed);
    }
    const clip = getActiveClip(this.project, this.rigDocument);
    if (clip) {
      clip.tracks = clip.tracks.filter((track) => !removed.includes(track.boneId));
    }
    this.selectedBoneId = armature.rootBoneIds[0] ?? null;
    this.markDirty();
    return true;
  }

  renameSelectedBone(name: string): void {
    if (!this.selectedBoneId) return;
    const armature = ensureRigArmature(this.project, this.rigDocument);
    renameBone(armature, this.selectedBoneId, name);
    this.markDirty();
  }

  applyPoseAsRest(): void {
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return;
    const clip = getActiveClip(this.project, this.rigDocument);
    applyCurrentPoseAsRest(armature, clip, this.playbackTime);
    this.markDirty();
  }

  clearPoseAnimation(): void {
    const clip = getActiveClip(this.project, this.rigDocument);
    clearAnimationTracks(clip);
    this.markDirty();
  }

  resetRestPose(): void {
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return;
    resetArmatureRestPose(armature);
    resetBonePose(armature);
    this.markDirty();
  }

  insertKeyframeForSelectedBone(): boolean {
    if (!this.selectedBoneId) return false;
    const doc = this.rigDocument;
    const clip = ensureActiveClip(this.project, doc);
    const settings = readRigDocumentSettings(doc);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return false;
    const locals = sampledLocalTransforms(armature, clip, this.playbackTime);
    const value = locals.get(this.selectedBoneId);
    if (!value) return false;
    insertBoneKeyframe(clip, this.selectedBoneId, this.playbackTime, value);
    this.markDirty();
    return true;
  }

  removeKeyframeForSelectedBone(): boolean {
    if (!this.selectedBoneId) return false;
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip) return false;
    removeBoneKeyframe(clip, this.selectedBoneId, this.playbackTime);
    this.markDirty();
    return true;
  }

  snapPlaybackToFrame(): void {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip) return;
    this.playbackTime = snapTimeToFrame(clip, this.playbackTime);
    this.notify();
  }

  stepFrame(delta: number): void {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip) return;
    const frame = Math.round(this.playbackTime * clip.fps) + delta;
    this.playbackTime = Math.max(0, Math.min(clip.duration, frame / clip.fps));
    this.playing = false;
    this.notify();
  }

  paintWeightsAt(point: { x: number; y: number; z: number }): number {
    if (!this.selectedBoneId || this.editMode !== 'weight') return 0;
    const doc = this.rigDocument;
    const settings = readRigDocumentSettings(doc);
    const source = settings.sourceModelDocumentId
      ? this.project.documents.get(settings.sourceModelDocumentId)
      : null;
    let touched = 0;
    for (const binding of settings.skinBindingIds.map((id) => this.project.skinBindings.get(id)!)) {
      if (!binding) continue;
      const mesh = this.project.meshes.get(binding.meshId);
      if (!mesh) continue;
      let localPoint = point;
      let brushRadius = this.weightBrushRadius;
      if (source) {
        const object = source.objects.get(binding.objectId);
        if (object) {
          const worldTransform = objectWorldTransform(source as ModelDocument, binding.objectId);
          localPoint = inverseTransformPointApprox(point, worldTransform);
          const scale = Math.cbrt(
            Math.abs(worldTransform.scale.x * worldTransform.scale.y * worldTransform.scale.z) || 1,
          );
          brushRadius = this.weightBrushRadius / scale;
        }
      }
      touched += paintBoneWeight(
        mesh,
        binding,
        this.selectedBoneId,
        localPoint,
        brushRadius,
        this.weightBrushStrength,
        this.weightBrushAdd,
      );
    }
    if (touched > 0) this.markDirty();
    return touched;
  }

  selectBone(boneId: BoneId | null): void {
    this.selectedBoneId = boneId;
    if (boneId) this.selectedObjectId = null;
    this.notify();
  }

  selectObject(objectId: ObjectId | null): void {
    this.selectedObjectId = objectId;
    if (objectId) this.selectedBoneId = null;
    this.notify();
  }

  addCamera(name?: string): ObjectId | null {
    const source = this.getSourceModel();
    if (!source) return null;
    const id = addSceneObject(source, createRigCameraObject(name));
    this.selectObject(id);
    this.markDirty();
    return id;
  }

  addLight(lightType: RigLightType = 'directional', name?: string): ObjectId | null {
    const source = this.getSourceModel();
    if (!source) return null;
    const id = addSceneObject(source, createRigLightObject(lightType, name));
    this.selectObject(id);
    this.markDirty();
    return id;
  }

  renameSceneObject(objectId: ObjectId, name: string): void {
    const source = this.getSourceModel();
    const object = source?.objects.get(objectId);
    if (!object) return;
    object.name = name;
    this.markDirty();
  }

  setSceneObjectVisible(objectId: ObjectId, visible: boolean): void {
    const source = this.getSourceModel();
    const object = source?.objects.get(objectId);
    if (!object) return;
    object.visible = visible;
    this.markDirty();
  }

  setSceneObjectLocked(objectId: ObjectId, locked: boolean): void {
    const source = this.getSourceModel();
    const object = source?.objects.get(objectId);
    if (!object) return;
    object.locked = locked;
    this.markDirty();
  }

  deleteSceneObject(objectId: ObjectId): void {
    const source = this.getSourceModel();
    if (!source) return;
    removeObject(source, objectId, false);
    if (this.selectedObjectId === objectId) this.selectedObjectId = null;
    this.markDirty();
  }

  reparentSceneObject(sourceId: ObjectId, newParentId: ObjectId | null): boolean {
    const source = this.getSourceModel();
    if (!source) return false;
    const ok = reparentObject(source, sourceId, newParentId);
    if (ok) this.markDirty();
    return ok;
  }

  private markDirty(): void {
    this.project.dirty = true;
    this.rigDocument.dirty = true;
    const source = this.getSourceModel();
    if (source) source.dirty = true;
    this.notify();
  }

  destroy(): void {
    this.link.destroy();
    this.listeners.clear();
  }
}

export function resolveInitialRigDocumentId(project: ViperProject, preferred: string | null): string {
  if (preferred && project.documents.get(preferred)?.kind === 'rig') return preferred;
  const first = project.rigDocumentIds[0] ?? [...project.documents.values()].find((doc) => doc.kind === 'rig')?.id;
  if (!first) throw new Error('No rig document in project');
  return first;
}
