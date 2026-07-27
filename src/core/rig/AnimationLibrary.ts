import type { ViperProject } from '@/core/document/types';
import type { ViperDocument } from '@/core/document/types';
import {
  createDefaultAnimationClip,
  getActiveClip,
  readRigDocumentSettings,
  writeRigDocumentSettings,
} from '@/core/rig/RigDocument';
import type { AnimationClip, AnimationClipId } from '@/core/rig/types';

export function listClipsForRig(project: ViperProject, rigDocument: ViperDocument): AnimationClip[] {
  const settings = readRigDocumentSettings(rigDocument);
  const ids = settings.clipIds.length
    ? settings.clipIds
    : settings.activeClipId
      ? [settings.activeClipId]
      : [];
  return ids.map((id) => project.animationClips.get(id)).filter(Boolean) as AnimationClip[];
}

export function createClipForRig(
  project: ViperProject,
  rigDocument: ViperDocument,
  name = 'Action',
): AnimationClip {
  const settings = readRigDocumentSettings(rigDocument);
  const clip = createDefaultAnimationClip(name);
  project.animationClips.set(clip.id, clip);
  if (!settings.clipIds.includes(clip.id)) settings.clipIds.push(clip.id);
  settings.activeClipId = clip.id;
  writeRigDocumentSettings(rigDocument, settings);
  project.dirty = true;
  rigDocument.dirty = true;
  return clip;
}

export function deleteClipForRig(
  project: ViperProject,
  rigDocument: ViperDocument,
  clipId: AnimationClipId,
): boolean {
  const settings = readRigDocumentSettings(rigDocument);
  if (!settings.clipIds.includes(clipId)) return false;
  if (settings.clipIds.length <= 1) return false;
  settings.clipIds = settings.clipIds.filter((id) => id !== clipId);
  project.animationClips.delete(clipId);
  if (settings.activeClipId === clipId) {
    settings.activeClipId = settings.clipIds[0] ?? null;
  }
  writeRigDocumentSettings(rigDocument, settings);
  project.dirty = true;
  rigDocument.dirty = true;
  return true;
}

export function setActiveClip(
  project: ViperProject,
  rigDocument: ViperDocument,
  clipId: AnimationClipId,
): boolean {
  const settings = readRigDocumentSettings(rigDocument);
  if (!project.animationClips.has(clipId)) return false;
  if (!settings.clipIds.includes(clipId)) settings.clipIds.push(clipId);
  settings.activeClipId = clipId;
  writeRigDocumentSettings(rigDocument, settings);
  project.dirty = true;
  rigDocument.dirty = true;
  return true;
}

export function renameClip(project: ViperProject, clipId: AnimationClipId, name: string): void {
  const clip = project.animationClips.get(clipId);
  if (!clip) return;
  clip.name = name.trim() || clip.name;
  project.dirty = true;
}

export function duplicateClip(
  project: ViperProject,
  rigDocument: ViperDocument,
  clipId: AnimationClipId,
): AnimationClip | null {
  const source = project.animationClips.get(clipId);
  if (!source) return null;
  const clip = createDefaultAnimationClip(`${source.name} Copy`);
  clip.duration = source.duration;
  clip.fps = source.fps;
  clip.tracks = source.tracks.map((track) => ({
    boneId: track.boneId,
    keyframes: track.keyframes.map((keyframe) => ({
      time: keyframe.time,
      value: {
        position: { ...keyframe.value.position },
        rotation: { ...keyframe.value.rotation },
        scale: { ...keyframe.value.scale },
      },
    })),
  }));
  project.animationClips.set(clip.id, clip);
  const settings = readRigDocumentSettings(rigDocument);
  settings.clipIds.push(clip.id);
  settings.activeClipId = clip.id;
  writeRigDocumentSettings(rigDocument, settings);
  project.dirty = true;
  rigDocument.dirty = true;
  return clip;
}

export function clipFrameCount(clip: AnimationClip): number {
  return Math.max(1, Math.round(clip.duration * clip.fps));
}

export function snapTimeToFrame(clip: AnimationClip, time: number): number {
  const frame = Math.round(time * clip.fps);
  return Math.max(0, Math.min(clip.duration, frame / clip.fps));
}

export function getActiveClipOrNull(project: ViperProject, rigDocument: ViperDocument): AnimationClip | null {
  return getActiveClip(project, rigDocument);
}
