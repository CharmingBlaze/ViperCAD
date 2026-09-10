import { Matrix4, Vector3 } from 'three';
import {
  addObjectToDocument,
  commitMeshObject,
  createSceneObject,
  removeObject,
} from '@/core/document/ModelDocument';
import { assertObjectKindRules } from '@/core/document/SceneObjectKind';
import type { DocumentId, MaterialId, ObjectId, SceneObject, ViperDocument, ViperProject } from '@/core/document/types';
import type { MeshId } from '@/core/mesh/types';
import { getObjectWorldMatrix } from '@/core/editor/Hierarchy';
import type { EditorSession } from '@/core/editor/EditorSession';
import { buildModelDocumentView, getViperDocument } from '@/core/document/ViperProject';
import { defaultTransform, type Transform } from '@/core/math/Transform';
import { v3, type Vec3 } from '@/core/math/Vec3';
import { cloneSelection } from '@/core/selection/SelectionManager';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { faceCornerIds, faceVertexIds } from '@/core/mesh/EditableMesh';

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

export function modelHasPlaceableGeometry(
  modelDoc: ViperDocument,
  project?: ViperProject,
  visited = new Set<DocumentId>(),
): boolean {
  if (visited.has(modelDoc.id)) return false;
  const nextVisited = new Set(visited);
  nextVisited.add(modelDoc.id);
  const walk = (objectId: ObjectId): boolean => {
    const object = modelDoc.objects.get(objectId);
    if (!object) return false;
    if (object.meshId) return true;
    if (project && object.kind === 'instance' && object.instanceSourceModelId) {
      const nested = project.documents.get(object.instanceSourceModelId);
      if (nested?.kind === 'model' && modelHasPlaceableGeometry(nested, project, nextVisited)) return true;
    }
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

  const levelView = buildModelDocumentView(project, levelDocumentId);
  const instanceWorld = getObjectWorldMatrix(levelView, instance.id);
  const parts: InstanceRenderPart[] = [];

  const walk = (
    documentId: DocumentId,
    sourceObjectId: ObjectId,
    baseMatrix: Matrix4,
    path: string[],
    documentPath: Set<DocumentId>,
  ) => {
    const document = project.documents.get(documentId);
    if (!document || document.kind !== 'model') return;
    const sourceObject = document.objects.get(sourceObjectId);
    if (!sourceObject || !sourceObject.visible) return;
    const sourceView = buildModelDocumentView(project, documentId);
    const relative = getObjectWorldMatrix(sourceView, sourceObjectId);
    const objectWorld = baseMatrix.clone().multiply(relative);
    const nextPath = [...path, sourceObjectId];
    if (sourceObject.meshId) {
      parts.push({
        handleKey: `${instance.id}::${nextPath.join('/')}`,
        instanceId: instance.id,
        sourceObjectId,
        meshId: sourceObject.meshId,
        worldMatrix: objectWorld,
        materialSlotIds: [...sourceObject.materialSlotIds],
      });
    }
    const nestedId = sourceObject.kind === 'instance'
      ? sourceObject.instanceSourceModelId
      : null;
    if (nestedId && !documentPath.has(nestedId)) {
      const nested = project.documents.get(nestedId);
      if (nested?.kind === 'model') {
        const nextDocuments = new Set(documentPath);
        nextDocuments.add(nestedId);
        for (const rootId of nested.rootObjectIds) {
          walk(nestedId, rootId, objectWorld, nextPath, nextDocuments);
        }
      }
    }
    for (const childId of sourceObject.childIds) {
      walk(documentId, childId, baseMatrix, nextPath, documentPath);
    }
  };

  const documentPath = new Set<DocumentId>([sourceDoc.id]);
  for (const rootId of sourceDoc.rootObjectIds) {
    walk(sourceDoc.id, rootId, instanceWorld, [], documentPath);
  }
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
    modelHasPlaceableGeometry(getViperDocument(project, id), project),
  );
}

function forEachModelVertex(
  project: ViperProject,
  modelDocumentId: DocumentId,
  visit: (point: Vector3) => void,
  baseMatrix = new Matrix4(),
  documentPath = new Set<DocumentId>(),
): void {
  if (documentPath.has(modelDocumentId)) return;
  const document = project.documents.get(modelDocumentId);
  if (!document || document.kind !== 'model') return;
  const nextPath = new Set(documentPath);
  nextPath.add(modelDocumentId);
  const view = buildModelDocumentView(project, modelDocumentId);
  for (const object of document.objects.values()) {
    if (!object.visible) continue;
    const objectWorld = baseMatrix.clone().multiply(getObjectWorldMatrix(view, object.id));
    if (object.meshId) {
      const mesh = project.meshes.get(object.meshId);
      if (mesh) {
        for (const vertex of mesh.vertices.values()) {
          visit(new Vector3(
            vertex.position.x,
            vertex.position.y,
            vertex.position.z,
          ).applyMatrix4(objectWorld));
        }
      }
    }
    if (object.kind === 'instance' && object.instanceSourceModelId) {
      forEachModelVertex(project, object.instanceSourceModelId, visit, objectWorld, nextPath);
    }
  }
}

/** Distance from a model document's origin to its lowest visible mesh point. */
export function modelDocumentBaseOffset(
  project: ViperProject,
  modelDocumentId: DocumentId,
): number {
  let minimumY = Infinity;
  forEachModelVertex(project, modelDocumentId, (point) => {
    minimumY = Math.min(minimumY, point.y);
  });

  return Number.isFinite(minimumY) ? Math.max(0, -minimumY) : 0;
}

/** Horizontal radius of visible model geometry around the model origin. */
export function modelDocumentPlacementRadius(
  project: ViperProject,
  modelDocumentId: DocumentId,
): number {
  let radius = 0;
  forEachModelVertex(project, modelDocumentId, (point) => {
    radius = Math.max(radius, Math.hypot(point.x, point.z));
  });
  return Math.max(0.05, radius);
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
  if (!modelHasPlaceableGeometry(modelDoc, session.project)) return null;

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

/** Convert a linked model instance into one ordinary editable mesh object. */
export function makeModelInstanceUnique(
  session: EditorSession,
  instanceId: ObjectId,
): ObjectId | null {
  const instance = session.document.objects.get(instanceId);
  if (!instance || instance.kind !== 'instance') return null;
  const parts = collectInstanceRenderParts(session.project, session.documentId, instance);
  if (!parts.length) return null;
  const materialIds: MaterialId[] = [];
  for (const part of parts) {
    for (const id of part.materialSlotIds) {
      if (!materialIds.includes(id)) materialIds.push(id);
    }
  }
  const fallback = [...session.document.materials.keys()][0];
  if (!materialIds.length && fallback) materialIds.push(fallback);
  const builder = new MeshBuilder(`${instance.name} Unique`, false);
  builder.setMaterialSlotCount(Math.max(1, materialIds.length));
  for (const part of parts) {
    const sourceMesh = session.project.meshes.get(part.meshId);
    if (!sourceMesh) continue;
    const vertexMap = new Map<string, string>();
    for (const vertex of sourceMesh.vertices.values()) {
      const point = new Vector3(
        vertex.position.x,
        vertex.position.y,
        vertex.position.z,
      ).applyMatrix4(part.worldMatrix);
      vertexMap.set(vertex.id, builder.vertex(v3(point.x, point.y, point.z)));
    }
    for (const face of sourceMesh.faces.values()) {
      const vertices = faceVertexIds(sourceMesh, face.id).map((id) => vertexMap.get(id)!);
      const corners = faceCornerIds(sourceMesh, face.id);
      const uvs = corners.map((id) => {
        const corner = sourceMesh.faceCorners.get(id)!;
        return sourceMesh.defaultUvLayerId
          ? corner.uvs.get(sourceMesh.defaultUvLayerId) ?? { x: 0, y: 0 }
          : { x: 0, y: 0 };
      });
      const sourceMaterial = part.materialSlotIds[face.materialSlot] ?? materialIds[0];
      builder.ngon(vertices, uvs, Math.max(0, sourceMaterial ? materialIds.indexOf(sourceMaterial) : 0));
    }
  }
  const committed = commitMeshObject(session.document, builder.build(), {
    name: `${instance.name} Unique`,
    materialId: materialIds[0],
  });
  const unique = session.document.objects.get(committed.objectId)!;
  unique.materialSlotIds = materialIds;
  unique.metadata = {
    ...instance.metadata,
    terrainLinkedStatus: 'unique',
  };
  delete unique.metadata.terrainSourceModelId;
  const beforeSelection = cloneSelection(session.selection.state);
  removeObject(session.document, instance.id, false);
  session.selection.selectObjects([unique.id], 'replace');
  const afterSelection = cloneSelection(session.selection.state);
  session.document.dirty = true;
  let applied = true;
  session.history.execute({
    name: `Make ${instance.name} Unique`,
    execute: () => {
      if (applied) return;
      removeObject(session.document, instance.id, false);
      addObjectToDocument(session.document, unique);
      session.selection.state = cloneSelection(afterSelection);
      session.document.dirty = true;
      session.requestRedraw();
      applied = true;
    },
    undo: () => {
      if (!applied) return;
      removeObject(session.document, unique.id, false);
      addObjectToDocument(session.document, instance);
      session.selection.state = cloneSelection(beforeSelection);
      session.document.dirty = true;
      session.requestRedraw();
      applied = false;
    },
  });
  session.requestRedraw();
  return unique.id;
}
