import type { ObjectId, SceneObject, SceneObjectKind } from '@/core/document/types';

/** Infer explicit kind from legacy objects that predate the `kind` field. */
export function migrateSceneObjectKind(object: SceneObject): SceneObjectKind {
  if (object.kind) return object.kind;

  const meta = object.metadata;
  if (object.meshId && (meta.gameRole === 'collision' || meta.collision)) {
    return 'collision';
  }
  if (meta.terrain === 'true' || meta.gameRole === 'terrain') {
    return 'terrain';
  }
  if (object.meshId) return 'mesh';
  if (!object.meshId && object.childIds.length > 0) return 'group';
  if (meta.prefab === 'true') return 'group';
  return 'empty';
}

/** Ensure `kind` and instance fields are present on a loaded or legacy object. */
export function normalizeSceneObject(object: SceneObject): SceneObject {
  const kind = migrateSceneObjectKind(object);
  object.kind = kind;
  if (object.instanceSourceModelId === undefined) {
    object.instanceSourceModelId = null;
  }
  if (kind === 'group' && object.metadata.prefab === 'true') {
    const { prefab: _removed, ...rest } = object.metadata;
    object.metadata = rest;
  }
  return object;
}

export function normalizeDocumentObjects(
  objects: Map<ObjectId, SceneObject> | Iterable<SceneObject>,
): void {
  const list = objects instanceof Map ? objects.values() : objects;
  for (const object of list) normalizeSceneObject(object);
}

export function isGroupObject(object: SceneObject | null | undefined): boolean {
  if (!object) return false;
  return migrateSceneObjectKind(object) === 'group';
}

export function inferKindForNewObject(
  meshId: SceneObject['meshId'],
  options: { kind?: SceneObjectKind } = {},
): SceneObjectKind {
  if (options.kind) return options.kind;
  return meshId ? 'mesh' : 'empty';
}

export function assertObjectKindRules(object: SceneObject): void {
  const kind = migrateSceneObjectKind(object);
  switch (kind) {
    case 'mesh':
    case 'collision':
    case 'terrain':
      if (!object.meshId) {
        throw new Error(`Object ${object.id} (${kind}) requires meshId`);
      }
      if (object.instanceSourceModelId) {
        throw new Error(`Object ${object.id} (${kind}) cannot reference a source model`);
      }
      break;
    case 'group':
      if (object.meshId) {
        throw new Error(`Group ${object.id} cannot have meshId`);
      }
      if (object.instanceSourceModelId) {
        throw new Error(`Group ${object.id} cannot reference a source model`);
      }
      break;
    case 'instance':
      if (object.meshId) {
        throw new Error(`Instance ${object.id} cannot own mesh topology`);
      }
      if (!object.instanceSourceModelId) {
        throw new Error(`Instance ${object.id} requires instanceSourceModelId`);
      }
      break;
    case 'empty':
      if (object.meshId || object.instanceSourceModelId) {
        throw new Error(`Empty object ${object.id} cannot reference mesh or model`);
      }
      break;
    default:
      break;
  }
}
