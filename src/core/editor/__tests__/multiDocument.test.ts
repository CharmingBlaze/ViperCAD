import { describe, expect, it } from 'vitest';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { createEmptyProject, getViperDocument } from '@/core/document/ViperProject';
import { EditorSession } from '@/core/editor/EditorSession';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';

describe('multi-document switching', () => {
  it('preserves each model document objects when switching tabs', () => {
    const project = createEmptyProject();
    const firstModelId = project.modelDocumentIds[0]!;
    const session = new EditorSession(project);

    session.ensureDocumentKind('model');
    expect(session.documentId).toBe(firstModelId);
    commitMeshObject(session.document, buildBox({ width: 1, height: 1, depth: 1, name: 'First' }), {
      name: 'First',
    });

    const secondModelId = session.projectEditor.newModel('Model 2');
    session.openDocument(secondModelId);
    commitMeshObject(session.document, buildBox({ width: 2, height: 2, depth: 2, name: 'Second' }), {
      name: 'Second',
    });

    session.openDocument(firstModelId);
    expect(session.document.objects.size).toBe(1);
    expect([...session.document.objects.values()][0]?.name).toBe('First');

    session.openDocument(secondModelId);
    expect(session.document.objects.size).toBe(1);
    expect([...session.document.objects.values()][0]?.name).toBe('Second');
  });

  it('keeps rootObjectIds on the backing document when reassigned on the view', () => {
    const project = createEmptyProject();
    const modelId = project.modelDocumentIds[0]!;
    const session = new EditorSession(project);
    session.ensureDocumentKind('model');

    const { objectId } = commitMeshObject(
      session.document,
      buildBox({ width: 1, height: 1, depth: 1, name: 'Box' }),
      { name: 'Box' },
    );

    session.document.rootObjectIds = session.document.rootObjectIds.filter((id) => id !== objectId);
    session.document.rootObjectIds.push(objectId);

    const backing = getViperDocument(project, modelId);
    expect(backing.rootObjectIds).toEqual([objectId]);
    expect(backing.objects.has(objectId)).toBe(true);
  });

  it('ensureDocumentKind switches from level to model workspace target', () => {
    const project = createEmptyProject();
    const modelId = project.modelDocumentIds[0]!;
    const levelId = project.levelDocumentIds[0]!;
    const session = new EditorSession(project);

    expect(session.documentId).toBe(levelId);
    expect(session.ensureDocumentKind('model')).toBe(true);
    expect(session.documentId).toBe(modelId);
  });
});
