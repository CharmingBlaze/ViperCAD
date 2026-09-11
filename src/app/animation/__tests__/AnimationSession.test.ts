import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { AnimationSession } from '@/app/animation/AnimationSession';
import { WorkspaceController } from '@/workspace/WorkspaceController';
import { readRigDocumentSettings } from '@/core/rig/RigDocument';
import { serializeViperProject } from '@/core/persistence/ProjectSerializer';
import { openViperProjectText } from '@/core/persistence/projectHealth';
import { APP_VERSION } from '@/version';

describe('AnimationSession', () => {
  it('binds the current model into a sidecar rig with an armature and clip', () => {
    const editor = new EditorSession();
    editor.ensureDocumentKind('model');
    commitMeshObject(editor.document, buildBox({ width: 1, height: 1, depth: 1, centered: true }));
    const animation = new AnimationSession(editor);
    animation.enterForModel(editor.documentId);
    expect(animation.getSetupStatus().armatureBoneCount).toBeGreaterThan(0);
    expect(animation.getSelectedBoneName()).toBeTruthy();
    expect(animation.getArmatureWorldPoints().length).toBeGreaterThan(0);
    animation.setEditMode('edit');
    const shin = [...(animation.project.armatures.get(
      readRigDocumentSettings(animation.rigDocument).armatureId!,
    )?.bones.values() ?? [])].find((bone) => bone.name === 'shin.L');
    animation.selectBone(shin!.id);
    const before = animation.getArmatureWorldPoints();
    animation.setSelectedBoneHeadFromWorld({ x: 0.2, y: -0.4, z: 0.1 });
    expect(before.length).toBe(animation.getArmatureWorldPoints().length);
    expect(animation.selectAdjacentBone(1)).toBeTruthy();
    expect(animation.getSelectedBoneName()).toBe('thigh.R');
    animation.selectBone([...animation.project.armatures.get(
      readRigDocumentSettings(animation.rigDocument).armatureId!,
    )!.bones.values()].find((bone) => bone.name === 'upper_arm.L')!.id);
    expect(animation.selectMirroredBone()).toBeTruthy();
    expect(animation.getSelectedBoneName()).toBe('upper_arm.R');
    const bound = animation.runQuickSetup();
    expect(bound).toBeGreaterThan(0);
    expect(animation.getSetupStatus().isReady).toBe(true);
    expect(animation.getClips().length).toBeGreaterThan(0);
    expect(animation.getSetupStatus().meshObjectCount).toBeGreaterThan(0);
  });

  it('solves two-bone IK on a limb tip in pose mode', () => {
    const editor = new EditorSession();
    editor.ensureDocumentKind('model');
    commitMeshObject(editor.document, buildBox({ width: 1, height: 1, depth: 1, centered: true }));
    const animation = new AnimationSession(editor);
    animation.enterForModel(editor.documentId);
    animation.setEditMode('pose');
    const settings = readRigDocumentSettings(animation.rigDocument);
    const armature = settings.armatureId ? animation.project.armatures.get(settings.armatureId) : null;
    const shin = [...(armature?.bones.values() ?? [])].find((bone) => bone.name === 'shin.L');
    expect(shin).toBeTruthy();
    animation.selectBone(shin!.id);
    const ok = animation.applyTwoBoneIk({ x: 0.2, y: -0.55, z: 0.12 });
    expect(ok).toBe(true);
    const clip = animation.getClips()[0]!;
    expect(clip.tracks.some((track) => track.keyframes.length > 0)).toBe(true);
  });

  it('switches viewport display mode and clears clip keys', () => {
    const editor = new EditorSession();
    editor.ensureDocumentKind('model');
    commitMeshObject(editor.document, buildBox({ width: 1, height: 1, depth: 1, centered: true }));
    const animation = new AnimationSession(editor);
    animation.enterForModel(editor.documentId);
    animation.setEditMode('pose');
    animation.setViewportDisplayMode('wireframe');
    expect(animation.viewportDisplayMode).toBe('wireframe');
    animation.insertKeyframeForSelectedBone();
    expect(animation.getClips()[0]!.tracks.some((track) => track.keyframes.length > 0)).toBe(true);
    animation.clearPoseAnimation();
    expect(animation.getClips()[0]!.tracks).toEqual([]);
  });

  it('adds cameras and lights to the source model', () => {
    const editor = new EditorSession();
    editor.ensureDocumentKind('model');
    commitMeshObject(editor.document, buildBox({ width: 1, height: 1, depth: 1, centered: true }));
    const animation = new AnimationSession(editor);
    animation.enterForModel(editor.documentId);
    const cameraId = animation.addCamera('Shot cam');
    const lightId = animation.addLight('point', 'Fill');
    expect(cameraId).toBeTruthy();
    expect(lightId).toBeTruthy();
    const source = animation.getSourceModel();
    expect(source?.objects.get(cameraId!)?.kind).toBe('camera');
    expect(source?.objects.get(lightId!)?.kind).toBe('light');
    animation.deleteSceneObject(cameraId!);
    expect(source?.objects.has(cameraId!)).toBe(false);
  });

  it('keeps clip sequence and custom poses after save and open', () => {
    const editor = new EditorSession();
    editor.ensureDocumentKind('model');
    commitMeshObject(editor.document, buildBox({ width: 1, height: 1, depth: 1, centered: true }));
    const animation = new AnimationSession(editor);
    animation.enterForModel(editor.documentId);
    const clip = animation.getClips()[0]!;
    expect(animation.addClipToSequence(clip.id)).toBeTruthy();
    expect(animation.saveCustomPose('Idle')).toBe(true);
    const boneId = [...animation.project.armatures.get(
      readRigDocumentSettings(animation.rigDocument).armatureId!,
    )!.bones.keys()][0]!;
    animation.addConstraint({
      name: 'Aim',
      ownerId: boneId,
      type: 'aim',
      influence: 0.4,
      enabled: true,
    });
    animation.setConstraintInfluence(animation.constraints[0]!.id, 0.75);

    const loaded = openViperProjectText(serializeViperProject(editor.project, APP_VERSION));
    const restoredEditor = new EditorSession(loaded.project);
    const restored = new AnimationSession(restoredEditor);
    restored.enterForModel(restoredEditor.documentId);
    expect(restored.clipSequence).toHaveLength(1);
    expect(restored.clipSequence[0]?.clipId).toBe(clip.id);
    expect(restored.customPoses.some((pose) => pose.name === 'Idle')).toBe(true);
    expect(restored.constraints).toHaveLength(1);
    expect(restored.constraints[0]?.name).toBe('Aim');
    expect(restored.constraints[0]?.influence).toBeCloseTo(0.75);
  });
});

describe('workspace shell modes for rig and animate', () => {
  it('uses a single perspective view for animate', () => {
    const workspace = new WorkspaceController();
    workspace.setShellMode('animate');
    const rects = workspace.computeViewportRects(800, 600);
    expect(workspace.shellMode).toBe('animate');
    expect(rects).toHaveLength(1);
    expect(rects[0]!.id).toBe('persp');
  });

  it('uses a single perspective view for rig', () => {
    const workspace = new WorkspaceController();
    workspace.setShellMode('rig');
    const rects = workspace.computeViewportRects(800, 600);
    expect(workspace.shellMode).toBe('rig');
    expect(rects).toHaveLength(1);
    expect(rects[0]!.id).toBe('persp');
  });
});
