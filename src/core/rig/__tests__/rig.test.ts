import { beforeEach, describe, expect, it } from 'vitest';
import { resetIdCounter } from '@/core/ids/IdService';
import { createEmptyProject, buildModelDocumentView } from '@/core/document/ViperProject';
import { serializeViperProject, deserializeViperProject, PROJECT_FORMAT_VERSION } from '@/core/persistence/ProjectSerializer';
import { createDefaultArmature } from '@/core/rig/ArmatureFactory';
import { ensureRigArmature, ensureActiveClip } from '@/core/rig/RigDocument';
import { evaluateArmaturePose } from '@/core/rig/evaluatePose';
import { buildBox } from '@/core/mesh/builders';
import { generateEnvelopeSkinBinding } from '@/core/rig/skinning';
import { commitMeshObject } from '@/core/document/ModelDocument';

beforeEach(() => resetIdCounter(1));

describe('rig project integration', () => {
  it('creates a default rig document in new projects', () => {
    const project = createEmptyProject();
    expect(project.rigDocumentIds.length).toBe(1);
    const rig = project.documents.get(project.rigDocumentIds[0]!);
    expect(rig?.kind).toBe('rig');
    expect(rig?.settings.rig?.sourceModelDocumentId).toBe(project.modelDocumentIds[0]);
  });

  it('round-trips armatures and clips through project v4', () => {
    const project = createEmptyProject();
    const rigDoc = project.documents.get(project.rigDocumentIds[0]!)!;
    const armature = ensureRigArmature(project, rigDoc);
    const clip = ensureActiveClip(project, rigDoc);
    clip.duration = 2.5;

    const json = serializeViperProject(project);
    expect(json).toContain('"formatVersion":4');
    const loaded = deserializeViperProject(json).project;
    expect(loaded.armatures.get(armature.id)?.bones.size).toBe(armature.bones.size);
    expect(loaded.animationClips.get(clip.id)?.duration).toBe(2.5);
  });

  it('evaluates armature pose at time zero', () => {
    const armature = createDefaultArmature();
    const poses = evaluateArmaturePose(armature, null, 0);
    expect(poses.size).toBe(armature.bones.size);
  });

  it('generates envelope skin weights for a mesh', () => {
    const project = createEmptyProject();
    const modelView = buildModelDocumentView(project, project.modelDocumentIds[0]!);
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    project.meshes.set(mesh.id, mesh);
    const { objectId } = commitMeshObject(modelView, mesh, { name: 'Body' });
    const armature = createDefaultArmature();
    const binding = generateEnvelopeSkinBinding('Body', mesh, objectId, armature);
    expect(binding.vertexWeights.size).toBe(mesh.vertices.size);
    expect(PROJECT_FORMAT_VERSION).toBeGreaterThanOrEqual(4);
  });
});
