import { getObjectWorldMatrix } from '@/core/editor/Hierarchy';
import { reparentObject } from '@/core/editor/Hierarchy';
import { cloneTransform, defaultTransform } from '@/core/math/Transform';
import type { Transform } from '@/core/math/Transform';
import { inverseTransformPointApprox } from '@/core/math/Transform';
import type { ViperProject } from '@/core/document/types';
import type { ViperDocument } from '@/core/document/types';
import type { ModelDocument } from '@/core/document/types';
import type { ObjectId } from '@/core/document/types';
import { removeObject } from '@/core/document/ModelDocument';
import { addDocumentToProject, createViperDocument } from '@/core/document/ViperProject';
import {
  addSceneObject,
  createRigCameraObject,
  createRigLightObject,
  type RigLightType,
} from '@/core/rig/RigSceneAssets';
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
  subdivideBone,
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
  getNextKeyframeTime,
  getPrevKeyframeTime,
  hasKeyframeAt,
  insertBoneKeyframe,
  moveBoneKeyframe,
  removeBoneKeyframe,
  sampledLocalTransforms,
  setKeyframeInterpolation,
} from '@/core/rig/keyframes';
import { generateEnvelopeSkinBinding, recomputeEnvelopeWeights, normalizeBindingWeights, pruneBoneInfluences } from '@/core/rig/skinning';
import { computeAutoCapsuleWeights, mirrorSkinWeightsX, paintBoneWeight, smoothSkinWeights } from '@/core/rig/weightPaint';
import { applyPosePreset, generateIdleCycle, generateWalkCycle, type PosePresetName } from '@/core/rig/PosePresets';
import {
  applyCurrentPoseAsRest,
  clearAnimationTracks,
  resetArmatureRestPose,
} from '@/core/rig/RestPose';
import { getMirroredBoneName, mirrorArmaturePose } from '@/core/rig/poseMirror';
import {
  createCreatureArmature,
  fitArmatureToMeshBounds,
  type CreaturePresetType,
} from '@/core/rig/creatureSkeletons';
import {
  bakeBirdDrink,
  bakeBirdFlight,
  bakeCombatAttack,
  bakeFishSwim,
  bakeQuadrupedLocomotion,
  bakeSquashAndStretch,
} from '@/core/rig/proceduralAnimationBakers';
import {
  bakeSequenceToSingleClip,
  type ClipSequenceItem,
} from '@/core/rig/clipSequencer';
import {
  exportGlbaSceneJson,
  exportGlbkfKeyframesJson,
  parseGlbaSceneJson,
  parseGlbkfKeyframesJson,
} from '@/core/rig/glbAnimatorIO';
import {
  assignVertexWeights,
  generateRigidSkinBinding,
  type WeightOperation,
} from '@/core/rig/directWeights';
import type {
  Constraint,
} from '@/core/rig/constraints';
import { createId } from '@/core/ids/IdService';
import type { EditorSession } from '@/core/editor/EditorSession';
import { buildBoneTree } from '@/core/rig/boneTree';
import {
  createDefaultRigDocumentSettings,
  type AnimationClip,
  type AnimationClipId,
  type AnimationEvent,
  type BoneId,
} from '@/core/rig/types';
import type { RigViewportDisplayMode } from '@/core/rig/rigMeshDisplay';
import { boneHeadTailWorld, boneWorldMatrix, invertMat4Affine, multiplyMat4, transformToMat4, transformVec3ByMat4, translationMat4 } from '@/core/rig/boneMatrices';
import { evaluateArmaturePose } from '@/core/rig/evaluatePose';
import { solveTwoBoneIK } from '@/core/rig/IkSolver';
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

export class AnimationSession {
  playbackTime = 0;
  playing = false;
  selectedBoneId: BoneId | null = null;
  selectedObjectId: ObjectId | null = null;
  editMode: RigEditMode = 'pose';
  gizmoMode: 'move' | 'rotate' | 'universal' = 'universal';
  autoKeyframe = false;
  poseScratch = new Map<BoneId, Transform>();
  poseDirty = false;
  weightBrushRadius = 0.15;
  weightBrushStrength = 0.35;
  weightBrushAdd = true;
  weightXray = true;
  envelopeFalloff = 0.55;
  viewportDisplayMode: RigViewportDisplayMode = 'material';
  timelineZoom = 10;
  timelineViewMode: 'dopesheet' | 'graph' = 'dopesheet';
  playbackSpeed = 1.0;
  loopPlayback = true;
  onionSkinning = {
    enabled: false,
    framesBefore: 2,
    framesAfter: 2,
    step: 1,
    opacity: 0.35,
  };
  keyingMode: 'manual' | 'auto' | 'pose' = 'pose';
  riggingSubMode: 'build' | 'bind' | 'pose' = 'build';
  skinBindingMode: 'smooth' | 'rigid' | 'automatic' = 'smooth';
  maxBoneInfluences: 4 | 8 = 4;
  constraints: Constraint[] = [];
  selectedConstraintId: string | null = null;
  poseClipboard = new Map<BoneId, Transform>();
  customPoses: { id: string; name: string; transforms: Record<BoneId, Transform> }[] = [];
  clipSequence: ClipSequenceItem[] = [];
  selectedSequenceItemId: string | null = null;
  private editor: EditorSession;
  private listeners = new Set<() => void>();

  constructor(editor: EditorSession) {
    this.editor = editor;
  }

  get project(): ViperProject {
    return this.editor.project;
  }

  get rigDocumentId(): string {
    return this.ensureRigDocument().id;
  }

  get rigDocument(): ViperDocument {
    return this.ensureRigDocument();
  }

  get sourceModelDocument(): ModelDocument | null {
    return this.getSourceModel();
  }

  /** Stay on the model document; bind/create the sidecar rig for that mesh. */
  enterForModel(modelDocumentId: string): void {
    const rig = this.ensureRigDocument();
    const settings = readRigDocumentSettings(rig);
    if (settings.sourceModelDocumentId !== modelDocumentId) {
      settings.sourceModelDocumentId = modelDocumentId;
      writeRigDocumentSettings(rig, settings);
      this.project.dirty = true;
      rig.dirty = true;
    }
    this.ensureSetup();
    this.syncFromProject();
    this.notify();
  }

  /** Reload sequencer playlist, custom poses, and constraints from the open project. */
  syncFromProject(): void {
    const settings = readRigDocumentSettings(this.rigDocument);
    this.clipSequence = settings.clipSequence.map((item) => ({ ...item }));
    this.customPoses = settings.customPoses.map((pose) => ({
      id: pose.id,
      name: pose.name,
      transforms: Object.fromEntries(
        Object.entries(pose.transforms).map(([id, transform]) => [id, cloneTransform(transform)]),
      ),
    }));
    this.constraints = settings.constraints.map((item) => ({ ...item })) as Constraint[];
    this.selectedSequenceItemId = null;
  }

  /** Copy live sequencer / pose / constraint edits onto the rig document before save. */
  flushToProject(): void {
    this.persistAnimationWorkspace();
  }

  private persistAnimationWorkspace(): void {
    const existingId = this.project.rigDocumentIds[0];
    const doc = existingId ? this.project.documents.get(existingId) : null;
    if (!doc || doc.kind !== 'rig') return;
    const settings = readRigDocumentSettings(doc);
    settings.clipSequence = this.clipSequence.map((item) => ({ ...item }));
    settings.customPoses = this.customPoses.map((pose) => ({
      id: pose.id,
      name: pose.name,
      transforms: Object.fromEntries(
        Object.entries(pose.transforms).map(([id, transform]) => [id, cloneTransform(transform)]),
      ),
    }));
    settings.constraints = this.constraints.map((item) => ({ ...item }));
    writeRigDocumentSettings(doc, settings);
  }

  private ensureRigDocument(): ViperDocument {
    const existingId = this.project.rigDocumentIds[0];
    const existing = existingId ? this.project.documents.get(existingId) : null;
    if (existing && existing.kind === 'rig') return existing;
    const rig = createViperDocument('Character Rig', 'rig');
    const modelId = this.editor.document.kind === 'model'
      ? this.editor.documentId
      : this.project.modelDocumentIds[0] ?? null;
    rig.settings.rig = createDefaultRigDocumentSettings(modelId);
    addDocumentToProject(this.project, rig);
    return rig;
  }

  getSourceModel(): ModelDocument | null {
    const settings = readRigDocumentSettings(this.rigDocument);
    const sourceId = settings.sourceModelDocumentId;
    if (sourceId) {
      const doc = this.project.documents.get(sourceId);
      if (doc) return doc as unknown as ModelDocument;
    }
    if (this.editor.document.kind === 'model') {
      settings.sourceModelDocumentId = this.editor.documentId;
      writeRigDocumentSettings(this.rigDocument, settings);
      return this.editor.document as unknown as ModelDocument;
    }
    return null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(): void {
    for (const listener of this.listeners) listener();
    this.editor.requestRedraw();
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

  setGizmoMode(mode: 'move' | 'rotate' | 'universal'): void {
    this.gizmoMode = mode;
    this.notify();
  }

  setViewportDisplayMode(mode: RigViewportDisplayMode): void {
    this.viewportDisplayMode = mode;
    this.notify();
  }

  setEditMode(mode: RigEditMode): void {
    this.editMode = mode;
    this.notify();
  }

  togglePlayback(): void {
    this.playing = !this.playing;
    this.notify();
  }

  setTimelineViewMode(mode: 'dopesheet' | 'graph'): void {
    this.timelineViewMode = mode;
    this.notify();
  }

  setPlaybackSpeed(speed: number): void {
    this.playbackSpeed = speed;
    this.notify();
  }

  setLoopPlayback(loop: boolean): void {
    this.loopPlayback = loop;
    this.notify();
  }

  setClipDuration(newDuration: number, scaleKeyframes = false): void {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip) return;
    const oldDuration = Math.max(0.001, clip.duration);
    const targetDuration = Math.max(0.05, newDuration);
    if (Math.abs(targetDuration - oldDuration) < 0.0001) return;

    if (scaleKeyframes) {
      const scaleFactor = targetDuration / oldDuration;
      for (const track of clip.tracks) {
        for (const kf of track.keyframes) {
          kf.time = Math.max(0, Math.min(targetDuration, kf.time * scaleFactor));
        }
      }
      if (clip.events) {
        for (const ev of clip.events) {
          ev.time = Math.max(0, Math.min(targetDuration, ev.time * scaleFactor));
        }
      }
    } else {
      for (const track of clip.tracks) {
        for (const kf of track.keyframes) {
          if (kf.time > targetDuration) {
            kf.time = targetDuration;
          }
        }
      }
      if (clip.events) {
        for (const ev of clip.events) {
          if (ev.time > targetDuration) {
            ev.time = targetDuration;
          }
        }
      }
    }

    clip.duration = targetDuration;
    if (this.playbackTime > targetDuration) {
      this.playbackTime = targetDuration;
    }
    this.markDirty();
    this.notify();
  }

  scaleEntireClip(scaleFactor: number): void {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip || scaleFactor <= 0) return;
    this.setClipDuration(clip.duration * scaleFactor, true);
  }

  setClipFps(fps: number): void {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip) return;
    clip.fps = Math.max(1, Math.min(240, Math.round(fps)));
    this.markDirty();
    this.notify();
  }

  setClipTotalFrames(totalFrames: number, scaleKeyframes = false): void {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip) return;
    const fps = clip.fps || 30;
    const newDuration = Math.max(1, totalFrames) / fps;
    this.setClipDuration(newDuration, scaleKeyframes);
  }

  advancePlayback(dtSeconds: number): void {
    if (!this.playing) return;
    const clip = getActiveClip(this.project, this.rigDocument);
    const duration = Math.max(0.001, clip?.duration ?? 1);
    this.playbackTime += dtSeconds * this.playbackSpeed;
    if (this.playbackTime >= duration) {
      this.playbackTime = this.loopPlayback ? this.playbackTime % duration : duration;
      if (!this.loopPlayback) this.playing = false;
    }
    this.notify();
  }

  getSetupStatus(): RigSetupStatus {
    const doc = this.rigDocument;
    const settings = readRigDocumentSettings(doc);
    const source = settings.sourceModelDocumentId
      ? this.project.documents.get(settings.sourceModelDocumentId)
      : null;
    const meshStore = (source && source.kind === 'model' && 'meshes' in source
      ? source.meshes
      : this.project.meshes) as Map<string, unknown>;
    const objects = source?.objects.size
      ? source.objects
      : this.editor.document.kind === 'model'
        ? this.editor.document.objects
        : null;
    let meshObjectCount = 0;
    if (objects) {
      for (const object of objects.values()) {
        if (object.kind === 'mesh' && object.meshId) meshObjectCount += 1;
        else if (object.meshId && meshStore.has(object.meshId)) meshObjectCount += 1;
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

  runQuickSetup(): number {
    this.ensureSetup();
    const bound = this.bindMeshesFromSourceModel(true);
    if (!this.selectedBoneId) {
      const settings = readRigDocumentSettings(this.rigDocument);
      const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
      this.selectedBoneId = armature?.rootBoneIds[0] ?? null;
    }
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
      const worldTransform = objectWorldTransform(source as unknown as ModelDocument, object.id);
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
    if (ok) {
      this.clipSequence = this.clipSequence.filter((item) => item.clipId !== clipId);
      if (this.selectedSequenceItemId && !this.clipSequence.some((item) => item.id === this.selectedSequenceItemId)) {
        this.selectedSequenceItemId = null;
      }
      this.notify();
    }
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

  setActiveClip(clipId: AnimationClipId) {
    return this.switchClip(clipId);
  }

  duplicateClip(clipId: AnimationClipId) {
    const copy = duplicateClip(this.project, this.rigDocument, clipId);
    if (copy) this.notify();
    return copy;
  }

  renameClip(clipId: AnimationClipId, name: string) {
    renameClip(this.project, clipId, name);
    this.notify();
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
    const scratch = this.poseScratch.get(this.selectedBoneId);
    if (scratch) return cloneTransform(scratch);
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
      if (this.autoKeyframe) {
        const clip = ensureActiveClip(this.project, doc);
        insertBoneKeyframe(clip, this.selectedBoneId, this.playbackTime, snapshot);
        this.poseScratch.delete(this.selectedBoneId);
        this.poseDirty = this.poseScratch.size > 0;
      } else {
        this.poseScratch.set(this.selectedBoneId, snapshot);
        this.poseDirty = true;
      }
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
    this.clearPoseScratch();
    this.notify();
  }

  clearPoseScratch(): void {
    if (this.poseScratch.size === 0 && !this.poseDirty) return;
    this.poseScratch.clear();
    this.poseDirty = false;
  }

  commitPoseScratch(): void {
    if (this.poseScratch.size === 0) return;
    const clip = ensureActiveClip(this.project, this.rigDocument);
    for (const [boneId, transform] of this.poseScratch) {
      insertBoneKeyframe(clip, boneId, this.playbackTime, transform);
    }
    this.clearPoseScratch();
    this.markDirty();
  }

  selectedKeyframes: Set<string> = new Set(); // format: `${boneId}:${time.toFixed(4)}`

  isKeyframeSelected(boneId: BoneId, time: number): boolean {
    return this.selectedKeyframes.has(`${boneId}:${time.toFixed(4)}`);
  }

  selectKeyframe(boneId: BoneId, time: number, multi = false): void {
    if (!multi) {
      this.selectedKeyframes.clear();
    }
    this.selectedKeyframes.add(`${boneId}:${time.toFixed(4)}`);
    this.notify();
  }

  toggleKeyframeSelected(boneId: BoneId, time: number): void {
    const key = `${boneId}:${time.toFixed(4)}`;
    if (this.selectedKeyframes.has(key)) {
      this.selectedKeyframes.delete(key);
    } else {
      this.selectedKeyframes.add(key);
    }
    this.notify();
  }

  selectAllKeyframes(): void {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip) return;
    this.selectedKeyframes.clear();
    for (const track of clip.tracks) {
      for (const kf of track.keyframes) {
        this.selectedKeyframes.add(`${track.boneId}:${kf.time.toFixed(4)}`);
      }
    }
    this.notify();
  }

  clearKeyframeSelection(): void {
    this.selectedKeyframes.clear();
    this.notify();
  }

  deleteSelectedKeyframes(): number {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip || this.selectedKeyframes.size === 0) return 0;
    let count = 0;
    for (const item of this.selectedKeyframes) {
      const [boneId, timeStr] = item.split(':');
      if (!boneId || !timeStr) continue;
      const t = parseFloat(timeStr);
      if (hasKeyframeAt(clip, boneId, t)) {
        removeBoneKeyframe(clip, boneId, t);
        count++;
      }
    }
    this.selectedKeyframes.clear();
    this.markDirty();
    return count;
  }

  duplicateSelectedKeyframes(offsetTime: number): number {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip || this.selectedKeyframes.size === 0) return 0;
    const items = Array.from(this.selectedKeyframes);
    const newSelection = new Set<string>();
    let count = 0;
    for (const item of items) {
      const [boneId, timeStr] = item.split(':');
      if (!boneId || !timeStr) continue;
      const t = parseFloat(timeStr);
      const track = clip.tracks.find((tr) => tr.boneId === boneId);
      const kf = track?.keyframes.find((k) => Math.abs(k.time - t) < 0.001);
      if (kf) {
        const newTime = Math.max(0, Math.min(clip.duration, kf.time + offsetTime));
        insertBoneKeyframe(clip, boneId, newTime, cloneTransform(kf.value), kf.interpolation);
        newSelection.add(`${boneId}:${newTime.toFixed(4)}`);
        count++;
      }
    }
    this.selectedKeyframes = newSelection;
    this.markDirty();
    return count;
  }

  scaleSelectedKeyframes(scaleFactor: number, pivotTime = this.playbackTime): number {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip || this.selectedKeyframes.size === 0) return 0;
    const items = Array.from(this.selectedKeyframes);
    const updated = new Set<string>();
    let count = 0;
    for (const item of items) {
      const [boneId, timeStr] = item.split(':');
      if (!boneId || !timeStr) continue;
      const oldTime = parseFloat(timeStr);
      const newTime = Math.max(0, Math.min(clip.duration, pivotTime + (oldTime - pivotTime) * scaleFactor));
      if (moveBoneKeyframe(clip, boneId, oldTime, newTime)) {
        updated.add(`${boneId}:${newTime.toFixed(4)}`);
        count++;
      }
    }
    this.selectedKeyframes = updated;
    this.markDirty();
    return count;
  }

  mirrorPoseLeftRight(): boolean {
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return false;
    const clip = getActiveClip(this.project, this.rigDocument);
    const currentPose = sampledLocalTransforms(armature, clip, this.playbackTime);
    const mirrored = mirrorArmaturePose(armature, currentPose);
    for (const [boneId, transform] of mirrored) {
      if (this.editMode === 'edit') {
        const bone = armature.bones.get(boneId);
        if (bone) bone.localTransform = cloneTransform(transform);
      } else {
        const targetClip = ensureActiveClip(this.project, this.rigDocument);
        insertBoneKeyframe(targetClip, boneId, this.playbackTime, cloneTransform(transform));
      }
    }
    this.markDirty();
    this.notify();
    return true;
  }

  saveCustomPose(name: string): boolean {
    const doc = this.rigDocument;
    const settings = readRigDocumentSettings(doc);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    const clip = getActiveClip(this.project, doc);
    if (!armature) return false;
    const locals = sampledLocalTransforms(armature, clip, this.playbackTime);
    const transforms: Record<BoneId, Transform> = {};
    for (const [boneId, tr] of locals.entries()) {
      transforms[boneId] = cloneTransform(tr);
    }
    this.customPoses.push({
      id: createId('clip'),
      name: name.trim() || `Pose ${this.customPoses.length + 1}`,
      transforms,
    });
    this.persistAnimationWorkspace();
    this.markDirty();
    this.notify();
    return true;
  }

  applyCustomPose(poseId: string): boolean {
    const pose = this.customPoses.find((p) => p.id === poseId);
    const doc = this.rigDocument;
    const settings = readRigDocumentSettings(doc);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    const clip = ensureActiveClip(this.project, doc);
    if (!pose || !armature || !clip) return false;
    for (const [boneId, tr] of Object.entries(pose.transforms)) {
      insertBoneKeyframe(clip, boneId, this.playbackTime, cloneTransform(tr));
    }
    this.markDirty();
    this.notify();
    return true;
  }

  deleteCustomPose(poseId: string): void {
    this.customPoses = this.customPoses.filter((p) => p.id !== poseId);
    this.persistAnimationWorkspace();
    this.markDirty();
    this.notify();
  }

  autoWeightMesh(): number {
    const doc = this.rigDocument;
    const settings = readRigDocumentSettings(doc);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return 0;
    const bindings = getSkinBindingsForRig(this.project, doc);
    let total = 0;
    for (const binding of bindings) {
      const mesh = this.project.meshes.get(binding.meshId);
      if (!mesh) continue;
      total += computeAutoCapsuleWeights(mesh, binding, armature, this.maxBoneInfluences);
    }
    if (total > 0) {
      this.markDirty();
      this.notify();
    }
    return total;
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

  /** Move selected bone head in world space, keeping the tail where it is. */
  setSelectedBoneHeadFromWorld(worldPoint: { x: number; y: number; z: number }): void {
    if (!this.selectedBoneId || this.editMode !== 'edit') return;
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return;
    const bone = armature.bones.get(this.selectedBoneId);
    if (!bone) return;
    const locals = sampledLocalTransforms(armature, null, 0);
    const cache = new Map();
    const world = boneWorldMatrix(armature, this.selectedBoneId, locals, cache);
    const { tail } = boneHeadTailWorld(bone, world);
    const parentBone = bone.parentId ? armature.bones.get(bone.parentId) : null;
    const parentWorld = bone.parentId
      ? boneWorldMatrix(armature, bone.parentId, locals, cache)
      : transformToMat4(armature.restTransform);
    const linked = parentBone
      ? multiplyMat4(parentWorld, translationMat4(parentBone.tailLocal))
      : parentWorld;
    const local = transformVec3ByMat4(invertMat4Affine(linked), worldPoint);
    const transform = cloneTransform(bone.localTransform);
    transform.position = local;
    this.setSelectedBoneLocalTransform(transform);
    this.setSelectedBoneTailFromWorld(tail);
  }

  getArmatureWorldPoints(): { x: number; y: number; z: number }[] {
    this.ensureSetup();
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return [];
    const clip = getActiveClip(this.project, this.rigDocument);
    const locals = sampledLocalTransforms(armature, clip, this.playbackTime);
    for (const [id, transform] of this.poseScratch) locals.set(id, transform);
    const cache = new Map();
    const points: { x: number; y: number; z: number }[] = [];
    for (const bone of armature.bones.values()) {
      const world = boneWorldMatrix(armature, bone.id, locals, cache);
      const { head, tail } = boneHeadTailWorld(bone, world);
      points.push(head, tail);
    }
    return points;
  }

  /** Nudge bone head in world space (edit mode). */
  nudgeSelectedBoneHead(worldDelta: { x: number; y: number; z: number }): void {
    if (!this.selectedBoneId || this.editMode !== 'edit') return;
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    const bone = this.selectedBoneId && armature ? armature.bones.get(this.selectedBoneId) : null;
    if (!armature || !bone) return;
    const locals = sampledLocalTransforms(armature, null, 0);
    const cache = new Map();
    const world = boneWorldMatrix(armature, this.selectedBoneId, locals, cache);
    const { head } = boneHeadTailWorld(bone, world);
    this.setSelectedBoneHeadFromWorld({
      x: head.x + worldDelta.x,
      y: head.y + worldDelta.y,
      z: head.z + worldDelta.z,
    });
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
    this.clearPoseAnimation();
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

  subdivideSelectedBone(cuts = 1): BoneId[] {
    if (!this.selectedBoneId || this.editMode !== 'edit') return [];
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const created = subdivideBone(armature, this.selectedBoneId, cuts);
    if (created.length > 0) {
      this.selectedBoneId = created[0]!.id;
      this.markDirty();
      return created.map((b) => b.id);
    }
    return [];
  }

  jumpToNextKeyframe(): void {
    const clip = getActiveClip(this.project, this.rigDocument);
    const next = getNextKeyframeTime(clip, this.playbackTime);
    if (next !== null) this.seekTo(next);
  }

  jumpToPrevKeyframe(): void {
    const clip = getActiveClip(this.project, this.rigDocument);
    const prev = getPrevKeyframeTime(clip, this.playbackTime);
    if (prev !== null) this.seekTo(prev);
  }

  copyPose(): void {
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return;
    const clip = getActiveClip(this.project, this.rigDocument);
    const locals = sampledLocalTransforms(armature, clip, this.playbackTime);
    this.poseClipboard.clear();
    for (const [id, tf] of locals.entries()) {
      this.poseClipboard.set(id, cloneTransform(tf));
    }
    this.notify();
  }

  pastePose(): void {
    if (this.poseClipboard.size === 0) return;
    const doc = this.rigDocument;
    const clip = ensureActiveClip(this.project, doc);
    for (const [boneId, value] of this.poseClipboard.entries()) {
      insertBoneKeyframe(clip, boneId, this.playbackTime, value);
    }
    this.markDirty();
  }

  mirrorCurrentPose(): void {
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature) return;
    const doc = this.rigDocument;
    const clip = ensureActiveClip(this.project, doc);
    const locals = sampledLocalTransforms(armature, clip, this.playbackTime);
    const mirrored = mirrorArmaturePose(armature, locals);
    for (const [boneId, tf] of mirrored.entries()) {
      insertBoneKeyframe(clip, boneId, this.playbackTime, tf);
    }
    this.markDirty();
  }

  getEvents(): AnimationEvent[] {
    const clip = getActiveClip(this.project, this.rigDocument);
    return clip?.events ? [...clip.events] : [];
  }

  addEvent(name: string, time?: number, parameter?: string): AnimationEvent | null {
    const doc = this.rigDocument;
    const clip = ensureActiveClip(this.project, doc);
    if (!clip.events) clip.events = [];
    const eventTime = time ?? this.playbackTime;
    const newEvent: AnimationEvent = {
      id: `ev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim() || 'event',
      time: Math.max(0, Math.min(clip.duration, eventTime)),
      parameter: parameter?.trim() || undefined,
    };
    clip.events.push(newEvent);
    clip.events.sort((a, b) => a.time - b.time);
    this.markDirty();
    return newEvent;
  }

  removeEvent(eventId: string): boolean {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip?.events) return false;
    const initialLen = clip.events.length;
    clip.events = clip.events.filter((e) => e.id !== eventId);
    if (clip.events.length !== initialLen) {
      this.markDirty();
      return true;
    }
    return false;
  }

  updateEvent(eventId: string, updates: Partial<Omit<AnimationEvent, 'id'>>): boolean {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip?.events) return false;
    const ev = clip.events.find((e) => e.id === eventId);
    if (!ev) return false;
    if (updates.name !== undefined) ev.name = updates.name.trim() || ev.name;
    if (updates.time !== undefined) ev.time = Math.max(0, Math.min(clip.duration, updates.time));
    if (updates.parameter !== undefined) ev.parameter = updates.parameter.trim() || undefined;
    clip.events.sort((a, b) => a.time - b.time);
    this.markDirty();
    return true;
  }

  getRootMotion(): boolean {
    const clip = getActiveClip(this.project, this.rigDocument);
    return Boolean(clip?.rootMotion);
  }

  setRootMotion(enabled: boolean): void {
    const doc = this.rigDocument;
    const clip = ensureActiveClip(this.project, doc);
    clip.rootMotion = enabled;
    this.markDirty();
  }

  setKeyingMode(mode: 'manual' | 'auto' | 'pose'): void {
    this.keyingMode = mode;
    this.autoKeyframe = mode === 'auto';
    this.notify();
  }

  resetSelectedBonePose(): void {
    if (!this.selectedBoneId || this.editMode !== 'pose') return;
    const doc = this.rigDocument;
    const clip = ensureActiveClip(this.project, doc);
    insertBoneKeyframe(clip, this.selectedBoneId, this.playbackTime, defaultTransform());
    this.markDirty();
  }

  setSelectedKeyframeInterpolation(mode: 'smooth' | 'linear' | 'step'): void {
    if (!this.selectedBoneId) return;
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip) return;
    setKeyframeInterpolation(clip, this.selectedBoneId, this.playbackTime, mode);
    this.markDirty();
  }

  /** Rotate selected bone in pose mode from viewport drag (radians). */
  rotateSelectedBoneInPose(deltaYaw: number, deltaPitch: number, deltaRoll = 0): void {
    if (!this.selectedBoneId || this.editMode !== 'pose') return;
    if (Number.isNaN(deltaYaw) || Number.isNaN(deltaPitch) || Number.isNaN(deltaRoll)) return;

    // Clamp per-frame delta to max 0.35 rad (~20 deg) to prevent sudden off-screen flips
    const yaw = Math.max(-0.35, Math.min(0.35, deltaYaw));
    const pitch = Math.max(-0.35, Math.min(0.35, deltaPitch));
    const roll = Math.max(-0.35, Math.min(0.35, deltaRoll));

    const transform = this.getSelectedBoneLocalTransform();
    if (!transform) return;

    transform.rotation.y = (Number.isNaN(transform.rotation.y) ? 0 : transform.rotation.y) + yaw;
    transform.rotation.x = (Number.isNaN(transform.rotation.x) ? 0 : transform.rotation.x) + pitch;
    transform.rotation.z = (Number.isNaN(transform.rotation.z) ? 0 : transform.rotation.z) + roll;

    this.setSelectedBoneLocalTransform(transform);
    if (this.autoKeyframe) {
      this.insertKeyframeForSelectedBone();
    }
  }

  translateSelectedBoneInPose(deltaX: number, deltaY: number, deltaZ = 0): void {
    if (!this.selectedBoneId || this.editMode !== 'pose') return;
    const transform = this.getSelectedBoneLocalTransform();
    if (!transform) return;
    transform.position.x += deltaX;
    transform.position.y += deltaY;
    transform.position.z += deltaZ;
    this.setSelectedBoneLocalTransform(transform);
    if (this.autoKeyframe) this.insertKeyframeForSelectedBone();
  }

  /** Viewport pose drag: rotate, translate, or two-bone IK depending on gizmo mode. */
  applyPosePointerDelta(dx: number, dy: number): void {
    if (this.editMode !== 'pose' || !this.selectedBoneId) return;
    if (this.gizmoMode === 'move') {
      if (this.applyTwoBoneIkFromPointer(dx, dy)) return;
      this.translateSelectedBoneInPose(dx * 0.22, -dy * 0.22, 0);
      return;
    }
    if (this.gizmoMode === 'universal') {
      this.rotateSelectedBoneInPose(dx, dy);
      this.translateSelectedBoneInPose(dx * 0.08, -dy * 0.08, 0);
      return;
    }
    this.rotateSelectedBoneInPose(dx, dy);
  }

  private twoBoneIkChain(): { rootId: BoneId; midId: BoneId; endId: BoneId } | null {
    if (!this.selectedBoneId) return null;
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    const end = armature?.bones.get(this.selectedBoneId);
    const mid = end?.parentId ? armature?.bones.get(end.parentId) : null;
    const root = mid?.parentId ? armature?.bones.get(mid.parentId) : null;
    if (!armature || !end || !mid || !root) return null;
    return { rootId: root.id, midId: mid.id, endId: end.id };
  }

  private applyTwoBoneIkFromPointer(dx: number, dy: number): boolean {
    const chain = this.twoBoneIkChain();
    if (!chain) return false;
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!armature) return false;
    const poses = evaluateArmaturePose(armature, clip, this.playbackTime, this.poseScratch);
    const endPose = poses.get(chain.endId);
    if (!endPose) return false;
    return this.applyTwoBoneIk({
      x: endPose.headWorld.x + dx * 0.35,
      y: endPose.headWorld.y,
      z: endPose.headWorld.z + dy * 0.35,
    });
  }

  applyTwoBoneIk(target: { x: number; y: number; z: number }): boolean {
    if (this.editMode !== 'pose') return false;
    const chain = this.twoBoneIkChain();
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!chain || !armature || !clip) return false;
    const poses = evaluateArmaturePose(armature, clip, this.playbackTime, this.poseScratch);
    const rootPose = poses.get(chain.rootId);
    const midPose = poses.get(chain.midId);
    const endPose = poses.get(chain.endId);
    if (!rootPose || !midPose || !endPose) return false;
    const solved = solveTwoBoneIK(rootPose.headWorld, midPose.headWorld, endPose.headWorld, target);
    if (!solved.solved) return false;

    const locals = sampledLocalTransforms(armature, clip, this.playbackTime);
    const cache = new Map();
    const rootWorld = boneWorldMatrix(armature, chain.rootId, locals, cache);
    const midLocal = cloneTransform(locals.get(chain.midId) ?? armature.bones.get(chain.midId)!.localTransform);
    const midParentLocalPos = transformVec3ByMat4(invertMat4Affine(rootWorld), solved.midPosition);
    midLocal.position = midParentLocalPos;
    insertBoneKeyframe(clip, chain.midId, this.playbackTime, midLocal);
    locals.set(chain.midId, midLocal);

    const midWorld = boneWorldMatrix(armature, chain.midId, locals, new Map());
    const endLocal = cloneTransform(locals.get(chain.endId) ?? armature.bones.get(chain.endId)!.localTransform);
    endLocal.position = transformVec3ByMat4(invertMat4Affine(midWorld), solved.endPosition);
    insertBoneKeyframe(clip, chain.endId, this.playbackTime, endLocal);
    this.selectedBoneId = chain.endId;
    this.markDirty();
    return true;
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

  applyPosePresetToRig(presetName: PosePresetName): number {
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const clip = ensureActiveClip(this.project, this.rigDocument);
    const count = applyPosePreset(armature, clip, presetName, this.playbackTime);
    this.markDirty();
    return count;
  }

  generateWalkCycleForRig(): void {
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const clip = ensureActiveClip(this.project, this.rigDocument);
    generateWalkCycle(clip, armature);
    this.markDirty();
  }

  generateIdleCycleForRig(): void {
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const clip = ensureActiveClip(this.project, this.rigDocument);
    generateIdleCycle(clip, armature);
    this.markDirty();
  }

  applyCreatureSkeleton(type: CreaturePresetType, autoFit = true): void {
    const doc = this.rigDocument;
    const settings = readRigDocumentSettings(doc);
    const newArmature = createCreatureArmature(type);

    if (autoFit) {
      let minX = Infinity; let maxX = -Infinity;
      let minY = Infinity; let maxY = -Infinity;
      let minZ = Infinity; let maxZ = -Infinity;
      let hasVertices = false;

      for (const mesh of this.project.meshes.values()) {
        for (const vertex of mesh.vertices.values()) {
          minX = Math.min(minX, vertex.position.x);
          maxX = Math.max(maxX, vertex.position.x);
          minY = Math.min(minY, vertex.position.y);
          maxY = Math.max(maxY, vertex.position.y);
          minZ = Math.min(minZ, vertex.position.z);
          maxZ = Math.max(maxZ, vertex.position.z);
          hasVertices = true;
        }
      }

      if (hasVertices) {
        fitArmatureToMeshBounds(newArmature, {
          min: { x: minX, y: minY, z: minZ },
          max: { x: maxX, y: maxY, z: maxZ },
        });
      }
    }

    this.project.armatures.set(newArmature.id, newArmature);
    settings.armatureId = newArmature.id;

    // Automatically bind all meshes in source model
    const source = this.getSourceModel();
    if (source) {
      settings.skinBindingIds = [];
      for (const object of source.objects.values()) {
        if (!object.meshId) continue;
        const mesh = this.project.meshes.get(object.meshId);
        if (!mesh) continue;
        const binding = generateEnvelopeSkinBinding(
          `${object.name}_Skin`,
          mesh,
          object.id,
          newArmature,
          null,
          this.envelopeFalloff,
        );
        this.project.skinBindings.set(binding.id, binding);
        settings.skinBindingIds.push(binding.id);
      }
    }

    writeRigDocumentSettings(doc, settings);
    this.selectedBoneId = newArmature.rootBoneIds[0] ?? null;
    this.markDirty();
  }

  bakeBirdFlightForRig(options?: { duration?: number; flapSpeed?: number }): void {
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const clip = ensureActiveClip(this.project, this.rigDocument);
    bakeBirdFlight(clip, armature, options);
    this.markDirty();
  }

  bakeBirdDrinkForRig(options?: { duration?: number }): void {
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const clip = ensureActiveClip(this.project, this.rigDocument);
    bakeBirdDrink(clip, armature, options);
    this.markDirty();
  }

  bakeQuadrupedLocomotionForRig(isRun = false): void {
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const clip = ensureActiveClip(this.project, this.rigDocument);
    bakeQuadrupedLocomotion(clip, armature, { isRun });
    this.markDirty();
  }

  bakeFishSwimForRig(options?: { duration?: number; waveSpeed?: number }): void {
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const clip = ensureActiveClip(this.project, this.rigDocument);
    bakeFishSwim(clip, armature, options);
    this.markDirty();
  }

  bakeCombatAttackForRig(options?: { duration?: number }): void {
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const clip = ensureActiveClip(this.project, this.rigDocument);
    bakeCombatAttack(clip, armature, options);
    this.markDirty();
  }

  bakeSquashAndStretchForRig(options?: { intensity?: number }): void {
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const clip = ensureActiveClip(this.project, this.rigDocument);
    bakeSquashAndStretch(clip, armature, options);
    this.markDirty();
  }

  // Clip Sequencer Methods
  addClipToSequence(clipId: AnimationClipId, startTime?: number): ClipSequenceItem | null {
    const clip = this.project.animationClips.get(clipId);
    if (!clip) return null;
    const currentEnd = this.clipSequence.reduce((max, s) => Math.max(max, s.startTime + s.duration), 0);
    const item: ClipSequenceItem = {
      id: createId('seq'),
      clipId,
      name: clip.name,
      startTime: startTime ?? currentEnd,
      duration: clip.duration,
      speedMultiplier: 1.0,
      blendIn: 0.2,
      blendOut: 0.2,
    };
    this.clipSequence.push(item);
    this.selectedSequenceItemId = item.id;
    this.persistAnimationWorkspace();
    this.markDirty();
    return item;
  }

  removeSequenceItem(itemId: string): void {
    this.clipSequence = this.clipSequence.filter((i) => i.id !== itemId);
    if (this.selectedSequenceItemId === itemId) this.selectedSequenceItemId = null;
    this.persistAnimationWorkspace();
    this.markDirty();
  }

  updateSequenceItem(itemId: string, updates: Partial<ClipSequenceItem>): void {
    const item = this.clipSequence.find((i) => i.id === itemId);
    if (!item) return;
    Object.assign(item, updates);
    this.persistAnimationWorkspace();
    this.markDirty();
  }

  bakeSequenceToNewClip(name = 'Sequence_Baked'): AnimationClip | null {
    if (this.clipSequence.length === 0) return null;
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const baked = bakeSequenceToSingleClip(this.clipSequence, this.project.animationClips, armature, { name });
    this.project.animationClips.set(baked.id, baked);
    const doc = this.rigDocument;
    const settings = readRigDocumentSettings(doc);
    settings.clipIds.push(baked.id);
    settings.activeClipId = baked.id;
    writeRigDocumentSettings(doc, settings);
    this.markDirty();
    return baked;
  }

  clearSequence(): void {
    this.clipSequence = [];
    this.selectedSequenceItemId = null;
    this.persistAnimationWorkspace();
    this.markDirty();
  }

  // GLB Animator Project IO
  exportGlbaScene(): string {
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) ?? null : null;
    const clips = this.getClips();
    const sourceName = this.getSourceModel()?.name;
    return exportGlbaSceneJson(armature, clips, this.clipSequence, sourceName);
  }

  importGlbaScene(jsonString: string): boolean {
    try {
      const parsed = parseGlbaSceneJson(jsonString);
      const doc = this.rigDocument;
      const settings = readRigDocumentSettings(doc);

      if (parsed.armature) {
        this.project.armatures.set(parsed.armature.id, parsed.armature);
        settings.armatureId = parsed.armature.id;
      }

      settings.clipIds = [];
      for (const clip of parsed.clips) {
        this.project.animationClips.set(clip.id, clip);
        settings.clipIds.push(clip.id);
      }
      if (parsed.clips.length > 0) {
        settings.activeClipId = parsed.clips[0]!.id;
      }

      this.clipSequence = parsed.clipSequence ?? [];
      settings.clipSequence = this.clipSequence.map((item) => ({ ...item }));
      writeRigDocumentSettings(doc, settings);
      this.markDirty();
      return true;
    } catch {
      return false;
    }
  }

  exportActiveClipGlbkf(): string | null {
    const clip = getActiveClip(this.project, this.rigDocument);
    if (!clip) return null;
    return exportGlbkfKeyframesJson(clip);
  }

  importGlbkf(jsonString: string): boolean {
    try {
      const parsed = parseGlbkfKeyframesJson(jsonString);
      const active = getActiveClip(this.project, this.rigDocument);
      if (!active) return false;
      active.tracks = parsed.tracks;
      active.duration = parsed.duration;
      active.fps = parsed.fps;
      this.markDirty();
      return true;
    } catch {
      return false;
    }
  }

  keyCurrentPose(): number {
    this.commitPoseScratch();
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const clip = ensureActiveClip(this.project, this.rigDocument);
    const locals = sampledLocalTransforms(armature, clip, this.playbackTime);
    let count = 0;
    for (const [boneId, transform] of locals) {
      insertBoneKeyframe(clip, boneId, this.playbackTime, transform, 'smooth');
      count++;
    }
    this.markDirty();
    return count;
  }

  selectedMeshVertexIds(): string[] {
    const selection = this.editor.selection.state;
    if (selection.mode !== 'vertex' || selection.selectedVertexIds.size === 0) return [];
    return [...selection.selectedVertexIds];
  }

  assignDirectVertexWeights(
    vertexIds: string[],
    boneId: string,
    weight: number,
    operation: WeightOperation = 'set',
  ): number {
    const settings = readRigDocumentSettings(this.rigDocument);
    let count = 0;
    for (const bindingId of settings.skinBindingIds) {
      const binding = this.project.skinBindings.get(bindingId);
      if (!binding) continue;
      count += assignVertexWeights(binding, vertexIds, boneId, weight, operation, this.maxBoneInfluences);
    }
    if (count > 0) this.markDirty();
    return count;
  }

  applyRigidSkinningToRig(): number {
    const doc = this.rigDocument;
    const settings = readRigDocumentSettings(doc);
    const armature = ensureRigArmature(this.project, doc);
    const source = this.getSourceModel();
    if (!source) return 0;

    settings.skinBindingIds = [];
    let count = 0;
    for (const object of source.objects.values()) {
      if (!object.meshId) continue;
      const mesh = this.project.meshes.get(object.meshId);
      if (!mesh) continue;
      const binding = generateRigidSkinBinding(`${object.name}_RigidSkin`, mesh, object.id, armature);
      this.project.skinBindings.set(binding.id, binding);
      settings.skinBindingIds.push(binding.id);
      count++;
    }
    writeRigDocumentSettings(doc, settings);
    this.markDirty();
    return count;
  }

  parentObjectToBone(objectId: string, boneId: string | null): boolean {
    const source = this.getSourceModel();
    if (!source) return false;
    const object = source.objects.get(objectId);
    if (!object) return false;
    object.parentId = boneId;
    this.markDirty();
    return true;
  }

  addConstraint(constraint: Omit<Constraint, 'id'>): Constraint {
    const newConstraint: Constraint = {
      ...constraint,
      id: createId('cmd'),
    };
    this.constraints.push(newConstraint);
    this.selectedConstraintId = newConstraint.id;
    this.persistAnimationWorkspace();
    this.markDirty();
    return newConstraint;
  }

  removeConstraint(id: string): void {
    this.constraints = this.constraints.filter((c) => c.id !== id);
    if (this.selectedConstraintId === id) this.selectedConstraintId = null;
    this.persistAnimationWorkspace();
    this.markDirty();
  }

  toggleConstraint(id: string): void {
    const c = this.constraints.find((item) => item.id === id);
    if (c) {
      c.enabled = !c.enabled;
      this.persistAnimationWorkspace();
      this.markDirty();
    }
  }

  setConstraintInfluence(id: string, influence: number): void {
    const constraint = this.constraints.find((item) => item.id === id);
    if (!constraint) return;
    constraint.influence = Math.max(0, Math.min(1, influence));
    this.persistAnimationWorkspace();
    this.markDirty();
  }

  mirrorSkinWeightsXForRig(): number {
    const armature = ensureRigArmature(this.project, this.rigDocument);
    const settings = readRigDocumentSettings(this.rigDocument);
    let totalMirrored = 0;
    for (const bindingId of settings.skinBindingIds) {
      const binding = this.project.skinBindings.get(bindingId);
      if (!binding) continue;
      const object = this.sourceModelDocument?.objects.get(binding.objectId);
      const mesh = object?.meshId ? this.project.meshes.get(object.meshId) : null;
      if (mesh) {
        totalMirrored += mirrorSkinWeightsX(mesh, binding, armature);
      }
    }
    this.markDirty();
    return totalMirrored;
  }

  smoothSkinWeightsForRig(): number {
    const settings = readRigDocumentSettings(this.rigDocument);
    let totalSmoothed = 0;
    for (const bindingId of settings.skinBindingIds) {
      const binding = this.project.skinBindings.get(bindingId);
      if (!binding) continue;
      const object = this.sourceModelDocument?.objects.get(binding.objectId);
      const mesh = object?.meshId ? this.project.meshes.get(object.meshId) : null;
      if (mesh) {
        totalSmoothed += smoothSkinWeights(mesh, binding, 2);
      }
    }
    this.markDirty();
    return totalSmoothed;
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
    const scratch = this.poseScratch.get(this.selectedBoneId);
    const locals = sampledLocalTransforms(armature, clip, this.playbackTime);
    const value = scratch ?? locals.get(this.selectedBoneId);
    if (!value) return false;
    insertBoneKeyframe(clip, this.selectedBoneId, this.playbackTime, value);
    this.poseScratch.delete(this.selectedBoneId);
    this.poseDirty = this.poseScratch.size > 0;
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
          const worldTransform = objectWorldTransform(source as unknown as ModelDocument, binding.objectId);
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

  getSelectedBoneName(): string | null {
    if (!this.selectedBoneId) return null;
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    return armature?.bones.get(this.selectedBoneId)?.name ?? null;
  }

  selectAdjacentBone(delta: number): BoneId | null {
    this.ensureSetup();
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    if (!armature || armature.bones.size === 0) return null;
    const tree = buildBoneTree(armature);
    if (tree.length === 0) return null;
    const current = tree.findIndex((item) => item.bone.id === this.selectedBoneId);
    const index = current < 0 ? 0 : (current + delta + tree.length) % tree.length;
    const next = tree[index]!;
    this.selectBone(next.bone.id);
    return next.bone.id;
  }

  selectMirroredBone(): BoneId | null {
    const name = this.getSelectedBoneName();
    const mirrorName = name ? getMirroredBoneName(name) : null;
    if (!mirrorName) return null;
    const settings = readRigDocumentSettings(this.rigDocument);
    const armature = settings.armatureId ? this.project.armatures.get(settings.armatureId) : null;
    const match = armature ? [...armature.bones.values()].find((bone) => bone.name === mirrorName) : null;
    if (!match) return null;
    this.selectBone(match.id);
    return match.id;
  }

  ensureSkinForWeightPaint(): boolean {
    const status = this.getSetupStatus();
    if (status.meshObjectCount > 0 && status.skinBindingCount === 0) {
      this.runQuickSetup();
      return true;
    }
    return false;
  }

  adjustWeightBrushRadius(factor: number): number {
    this.weightBrushRadius = Math.min(0.8, Math.max(0.02, this.weightBrushRadius * factor));
    this.notify();
    return this.weightBrushRadius;
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

  markDirty(): void {
    this.project.dirty = true;
    this.rigDocument.dirty = true;
    const source = this.getSourceModel();
    if (source) source.dirty = true;
    this.notify();
  }

  destroy(): void {
    this.playing = false;
    this.listeners.clear();
  }
}
