import { describe, expect, it } from 'vitest';
import { createEmptyProject, buildModelDocumentView } from '@/core/document/ViperProject';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { commitPlaceModelInLevel, collectInstanceRenderParts, modelHasPlaceableGeometry } from '@/core/editor/ModelInstances';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';

describe('ModelInstances', () => {
  it('places a linked instance into the active level', () => {
    const project = createEmptyProject();
    const modelId = project.modelDocumentIds[0]!;
    const levelId = project.levelDocumentIds[0]!;
    const modelDoc = project.documents.get(modelId)!;
    const modelView = buildModelDocumentView(project, modelId);
    commitMeshObject(modelView, buildBox({ width: 1, height: 1, depth: 1, name: 'Asset' }), { name: 'Asset' });

    const session = new EditorSession(project);
    session.openDocument(levelId);
    const instanceId = commitPlaceModelInLevel(session, modelId);
    expect(instanceId).toBeTruthy();

    const instance = session.document.objects.get(instanceId!);
    expect(instance?.kind).toBe('instance');
    expect(instance?.instanceSourceModelId).toBe(modelId);

    const parts = collectInstanceRenderParts(session.project, levelId, instance!);
    expect(parts.length).toBe(1);
    expect(modelHasPlaceableGeometry(modelDoc)).toBe(true);
  });

  it('reports empty models as not placeable', () => {
    const project = createEmptyProject();
    const modelDoc = project.documents.get(project.modelDocumentIds[0]!)!;
    expect(modelHasPlaceableGeometry(modelDoc)).toBe(false);
  });
});
