import { describe, expect, it } from 'vitest';
import { addDocumentToProject, createEmptyProject, buildModelDocumentView, createViperDocument } from '@/core/document/ViperProject';
import { addObjectToDocument, commitMeshObject, createSceneObject } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import {
  commitPlaceModelInLevel,
  collectInstanceRenderParts,
  modelDocumentBaseOffset,
  modelDocumentPlacementRadius,
  modelHasPlaceableGeometry,
} from '@/core/editor/ModelInstances';
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

  it('renders every object from nested reusable models', () => {
    const project = createEmptyProject();
    const parentId = project.modelDocumentIds[0]!;
    const child = createViperDocument('Nested Model', 'model');
    addDocumentToProject(project, child);
    const childView = buildModelDocumentView(project, child.id);
    commitMeshObject(childView, buildBox({ width: 1, height: 1, depth: 1, name: 'Nested Mesh' }), { name: 'Nested Mesh' });

    const parentView = buildModelDocumentView(project, parentId);
    const nestedInstance = createSceneObject('Nested Model', null, [], { kind: 'instance' });
    nestedInstance.instanceSourceModelId = child.id;
    nestedInstance.transform.position.x = 3;
    addObjectToDocument(parentView, nestedInstance);

    const session = new EditorSession(project);
    const levelId = project.levelDocumentIds[0]!;
    session.openDocument(levelId);
    const placedId = commitPlaceModelInLevel(session, parentId);
    const placed = session.document.objects.get(placedId!)!;
    const parts = collectInstanceRenderParts(project, levelId, placed);

    expect(parts).toHaveLength(1);
    expect(parts[0]!.worldMatrix.elements[12]).toBeCloseTo(3);
    expect(modelDocumentBaseOffset(project, parentId)).toBeCloseTo(0.5);
    expect(modelDocumentPlacementRadius(project, parentId)).toBeGreaterThan(3);
  });
});
