import { Matrix4 } from 'three';
import { addObjectToDocument, createSceneObject } from '@/core/document/ModelDocument';
import { assertObjectKindRules } from '@/core/document/SceneObjectKind';
import type { DocumentId, MaterialId, ObjectId, SceneObject, ViperDocument, ViperProject } from '@/core/document/types';
import type { MeshId } from '@/core/mesh/types';
import { getObjectWorldMatrix } from '@/core/editor/Hierarchy';
import type { EditorSession } from '@/core/editor/EditorSession';
import { buildModelDocumentView, getViperDocument } from '@/core/document/ViperProject';
import { defaultTransform, type Transform } from '@/core/math/Transform';
import { v3, type Vec3 } from '@/core/math/Vec3';
import { cloneSelection } from '@/core/selection/SelectionManager';

export type InstanceRenderPart = {
  handleKey: string;
  instanceId: ObjectId;
  sourceObjectId: ObjectId;
  meshId: MeshId;
  worldMatrix: Matrix4;
  materialSlotIds: MaterialId[];
};

export function instanceHandleKey(instanceId: ObjectId, sourceObjectId: ObjectId): string {
  return `${instanceId}::${sourceObjectId}`;
}

export function isInstanceObject(object: SceneObject | null | undefined): boolean {
  return object?.kind === 'instance';
}

export function modelHasPlaceableGeometry(modelDoc: ViperDocument): boolean {
  const walk = (objectId: ObjectId): boolean => {
    const object = modelDoc.objects.get(objectId);
    if (!object) return false;
    if (object.meshId) return true;
    return object.childIds.some(walk);
  };
  return modelDoc.rootObjectIds.some(walk);
}

export function collectInstanceRenderParts(
  project: ViperProject,
  levelDocumentId: DocumentId,
  instance: SceneObject,
): InstanceRenderPart[] {
  if (instance.kind !== 'instance' || !instance.instanceSourceModelId) return [];
  const sourceDoc = project.documents.get(instance.instanceSourceModelId);
  if (!sourceDoc || sourceDoc.kind !== 'model') return [];

  const sourceView = buildModelDocumentView(project, sourceDoc.id);
  const levelView = buildModelDocumentView(project, levelDocumentId);
  const instanceWorld = getObjectWorldMatrix(levelView, instance.id);
  const parts: InstanceRenderPart[] = [];

  const walk = (sourceObjectId: ObjectId) => {
    const sourceObject = sourceDoc.objects.get(sourceObjectId);
    if (!sourceObject || !sourceObject.visible) return;
    if (sourceObject.meshId) {
      const relative = getObjectWorldMatrix(sourceView, sourceObjectId);
      parts.push({
        handleKey: instanceHandleKey(instance.id, sourceObjectId),
        instanceId: instance.id,
        sourceObjectId,
        meshId: sourceObject.meshId,
        worldMatrix: instanceWorld.clone().multiply(relative),
        materialSlotIds: [...sourceObject.materialSlotIds],
      });
    }
    for (const childId of sourceObject.childIds) walk(childId);
  };

  for (const rootId of sourceDoc.rootObjectIds) walk(rootId);
  return parts;
}

function countModelInstancesInLevel(levelDoc: ViperDocument, modelDocumentId: DocumentId): number {
  let count = 0;
  for (const object of levelDoc.objects.values()) {
    if (object.kind === 'instance' && object.instanceSourceModelId === modelDocumentId) count++;
  }
  return count;
}

export function defaultPlacementTransform(instanceIndex: number, position?: Vec3): Transform {
  const transform = defaultTransform();
  transform.position = position ?? v3(instanceIndex * 2, 0, 0);
  return transform;
}

export function listPlaceableModelIds(project: ViperProject): DocumentId[] {
  return project.modelDocumentIds.filter((id) =>
    modelHasPlaceableGeometry(getViperDocument(project, id)),
  );
}

/** Switch to a level document when the user wants to place models. */
export function openLevelForPlacement(session: EditorSession): DocumentId | null {
  if (session.document.kind === 'level') return session.documentId;
  const preferred =
    session.project.levelDocumentIds.find((id) => session.projectEditor.openDocuments.has(id))
    ?? session.project.levelDocumentIds[0];
  if (!preferred) return null;
  session.openDocument(preferred);
  return preferred;
}

/** Place a linked copy of a Model into the active Level document. */
export function commitPlaceModelInLevel(
  session: EditorSession,
  modelDocumentId: DocumentId,
  options: { position?: Vec3 } = {},
): ObjectId | null {
  const levelView = session.document;
  if (levelView.kind !== 'level') return null;

  const modelDoc = getViperDocument(session.project, modelDocumentId);
  if (modelDoc.kind !== 'model') return null;
  if (!modelHasPlaceableGeometry(modelDoc)) return null;

  const instanceIndex = countModelInstancesInLevel(
    getViperDocument(session.project, levelView.id),
    modelDocumentId,
  );

  const instance = createSceneObject(modelDoc.name, null, [], { kind: 'instance' });
  instance.kind = 'instance';
  instance.instanceSourceModelId = modelDocumentId;
  instance.name = `${modelDoc.name} ${instanceIndex + 1}`;
  instance.transform = defaultPlacementTransform(instanceIndex, options.position);
  assertObjectKindRules(instance);

  const beforeSelection = cloneSelection(session.selection.state);
  const afterSelection = cloneSelection(session.selection.state);
  afterSelection.mode = 'object';
  afterSelection.selectedObjectIds = new Set([instance.id]);
  afterSelection.activeObjectId = instance.id;

  addObjectToDocument(levelView, instance);
  session.selection.state = cloneSelection(afterSelection);
  levelView.dirty = true;
  let applied = true;

  session.history.execute({
    name: `Place ${modelDoc.name}`,
    execute: () => {
      if (applied) return;
      addObjectToDocument(levelView, instance);
      session.selection.state = cloneSelection(afterSelection);
      levelView.dirty = true;
      applied = true;
      session.requestRedraw();
    },
    undo: () => {
      if (!applied) return;
      levelView.objects.delete(instance.id);
      levelView.rootObjectIds = levelView.rootObjectIds.filter((id) => id !== instance.id);
      session.selection.state = cloneSelection(beforeSelection);
      levelView.dirty = true;
      applied = false;
      session.requestRedraw();
    },
  });

  session.requestRedraw();
  return instance.id;
}
