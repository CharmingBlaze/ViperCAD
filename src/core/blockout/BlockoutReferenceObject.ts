import { removeObject } from '@/core/document/ModelDocument';
import type { ModelDocument, ObjectId, SceneObject } from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import { createImagePlane, type ImagePlaneResult } from '@/core/editor/ImagePlane';
import { importImageFile } from '@/core/image/ImageImport';
import type {
  BlockoutReferenceState,
  ReferenceImageConfig,
} from './ReferenceImages';
import { createDefaultReferenceImage } from './ReferenceImages';

export const BLOCKOUT_REFERENCE_META = 'blockoutReference';

export function isBlockoutReferenceObject(object: SceneObject | null | undefined): boolean {
  const view = object?.metadata[BLOCKOUT_REFERENCE_META];
  return view === 'front' || view === 'side';
}

export function blockoutReferenceView(object: SceneObject | null | undefined): 'front' | 'side' | null {
  const view = object?.metadata[BLOCKOUT_REFERENCE_META];
  return view === 'front' || view === 'side' ? view : null;
}

export function findBlockoutReferenceObjectId(
  doc: ModelDocument,
  view: 'front' | 'side',
): ObjectId | null {
  for (const object of doc.objects.values()) {
    if (object.metadata[BLOCKOUT_REFERENCE_META] === view) return object.id;
  }
  return null;
}

export function lockBlockoutReferences(doc: ModelDocument, locked: boolean): void {
  for (const object of doc.objects.values()) {
    if (isBlockoutReferenceObject(object)) object.locked = locked;
  }
  doc.dirty = true;
}

export function setBlockoutReferenceLocked(
  doc: ModelDocument,
  objectId: ObjectId,
  locked: boolean,
): void {
  const object = doc.objects.get(objectId);
  if (!object || !isBlockoutReferenceObject(object)) return;
  object.locked = locked;
  doc.dirty = true;
}

/** Skip locked meshes and blueprints the current view / draw tool should not hit. */
export function shouldPickSceneObject(
  doc: ModelDocument,
  objectId: ObjectId,
  options: {
    paneId?: string | null;
    showInPersp?: boolean;
    blockoutToolActive?: boolean;
    allowLocked?: boolean;
  } = {},
): boolean {
  const object = doc.objects.get(objectId);
  if (!object || !object.visible) return false;
  if (object.locked && !options.allowLocked) return false;
  const view = blockoutReferenceView(object);
  if (!view) return true;
  if (options.blockoutToolActive) return false;
  const pane = options.paneId ?? null;
  if (pane === 'front') return view === 'front';
  if (pane === 'right') return view === 'side';
  if (pane === 'persp') return options.showInPersp !== false;
  return true;
}

export function placeBlockoutReferenceObject(
  doc: ModelDocument,
  created: ImagePlaneResult,
  view: 'front' | 'side',
  options: { locked?: boolean; opacity?: number } = {},
): ObjectId {
  const previousId = findBlockoutReferenceObjectId(doc, view);
  if (previousId && previousId !== created.objectId) {
    removeObject(doc, previousId, true);
  }

  const object = doc.objects.get(created.objectId);
  if (!object) return created.objectId;
  object.metadata[BLOCKOUT_REFERENCE_META] = view;
  object.metadata.imagePlane = 'true';
  object.metadata.planeHeight = String(created.height);
  object.locked = options.locked ?? true;
  object.visible = true;
  object.transform.position = { x: 0, y: created.height / 2, z: 0 };
  object.transform.rotation = view === 'side' ? { x: 0, y: Math.PI / 2, z: 0 } : { x: 0, y: 0, z: 0 };
  object.transform.scale = { x: 1, y: 1, z: 1 };

  const material = doc.materials.get(created.materialId);
  if (material) {
    material.opacity = options.opacity ?? 0.65;
    material.alphaMode = 'blend';
    material.unlit = true;
    material.shadingModel = 'unlit';
    material.doubleSided = true;
  }
  doc.dirty = true;
  return object.id;
}

export function syncReferenceConfigFromObject(
  doc: ModelDocument,
  config: ReferenceImageConfig,
): void {
  const object = config.objectId ? doc.objects.get(config.objectId) : null;
  if (!object) return;
  const materialId = object.materialSlotIds[0];
  const material = materialId ? doc.materials.get(materialId) : null;
  config.visible = object.visible;
  config.locked = object.locked;
  config.posX = object.transform.position.x;
  config.posY = object.transform.position.y;
  config.posZ = object.transform.position.z;
  config.scale = referenceWorldHeight(doc, object);
  config.flipX = object.transform.scale.x < 0;
  if (material) config.opacity = material.opacity;
}

export function applyReferenceConfigToObject(
  doc: ModelDocument,
  config: ReferenceImageConfig,
): void {
  const object = config.objectId ? doc.objects.get(config.objectId) : null;
  if (!object) return;
  object.visible = config.visible;
  object.locked = config.locked;
  object.transform.position = { x: config.posX, y: config.posY, z: config.posZ };
  setReferenceWorldHeight(doc, object, config.scale, config.flipX);
  const materialId = object.materialSlotIds[0];
  const material = materialId ? doc.materials.get(materialId) : null;
  if (material) {
    material.opacity = Math.max(0.05, Math.min(1, config.opacity));
    material.alphaMode = 'blend';
  }
  doc.dirty = true;
}

export function referenceWorldHeight(_doc: ModelDocument, object: SceneObject): number {
  const local = Number(object.metadata.planeHeight);
  const height = Number.isFinite(local) && local > 0 ? local : 2;
  return Math.abs(object.transform.scale.y) * height;
}

export function setReferenceWorldHeight(
  doc: ModelDocument,
  object: SceneObject,
  height: number,
  flipX = object.transform.scale.x < 0,
): void {
  const local = Number(object.metadata.planeHeight);
  const base = Number.isFinite(local) && local > 0 ? local : 2;
  const scale = Math.max(0.01, height) / base;
  object.transform.scale = {
    x: (flipX ? -1 : 1) * scale,
    y: scale,
    z: scale,
  };
  doc.dirty = true;
}

export function configFromReferenceObject(
  doc: ModelDocument,
  view: 'front' | 'side',
  fallback?: Partial<ReferenceImageConfig>,
): ReferenceImageConfig | null {
  const objectId = findBlockoutReferenceObjectId(doc, view);
  if (!objectId) return null;
  const object = doc.objects.get(objectId);
  if (!object) return null;
  const config = createDefaultReferenceImage(
    fallback?.url ?? '',
    view,
    object.name,
    fallback?.aspectRatio ?? (Number(object.metadata.sourceAspect) || 1),
  );
  config.objectId = objectId;
  syncReferenceConfigFromObject(doc, config);
  if (fallback?.url) config.url = fallback.url;
  if (fallback?.id) config.id = fallback.id;
  return config;
}

export async function importBlockoutReference(
  session: EditorSession,
  file: File,
  view: 'front' | 'side',
): Promise<{ objectId: ObjectId; config: ReferenceImageConfig }> {
  const label = file.name.replace(/\.[^.]+$/, '') || `${view} reference`;
  const name = `${view === 'front' ? 'Front' : 'Side'} · ${label}`;
  const imported = await importImageFile(session.document, file, { name: label });
  const aspect = imported.width / Math.max(1, imported.height);
  const targetHeight = 2;
  const maxSize = Math.max(targetHeight, targetHeight * aspect);
  const created = createImagePlane(session.document, {
    textureId: imported.textureId,
    imageId: imported.imageId,
    imageWidth: imported.width,
    imageHeight: imported.height,
    name,
    maxSize,
  });
  const objectId = placeBlockoutReferenceObject(session.document, created, view, {
    locked: true,
    opacity: 0.65,
  });

  const url = URL.createObjectURL(file);
  const config = createDefaultReferenceImage(url, view, file.name, aspect);
  config.objectId = objectId;
  syncReferenceConfigFromObject(session.document, config);

  const object = session.document.objects.get(objectId)!;
  const mesh = session.document.meshes.get(created.meshId)!;
  const material = session.document.materials.get(created.materialId)!;
  const texture = session.document.textures.get(created.textureId)!;
  const image = session.document.images.get(created.imageId)!;
  let applied = true;

  session.history.execute({
    name: `Add ${view} reference`,
    execute: () => {
      if (applied) return;
      session.document.images.set(image.id, image);
      session.document.textures.set(texture.id, texture);
      session.document.materials.set(material.id, material);
      session.document.meshes.set(mesh.id, mesh);
      session.document.objects.set(object.id, object);
      if (!session.document.rootObjectIds.includes(object.id)) {
        session.document.rootObjectIds.push(object.id);
      }
      session.document.dirty = true;
      applied = true;
    },
    undo: () => {
      removeObject(session.document, object.id, true);
      session.document.materials.delete(material.id);
      session.document.textures.delete(texture.id);
      session.document.images.delete(image.id);
      session.document.dirty = true;
      applied = false;
    },
  });

  if (view === 'front') session.blockoutReference.front = config;
  else session.blockoutReference.side = config;
  session.blockoutReference.revision += 1;
  session.document.dirty = true;
  session.requestRedraw();
  return { objectId, config };
}

export function removeBlockoutReference(
  session: EditorSession,
  view: 'front' | 'side',
): void {
  const config = view === 'front' ? session.blockoutReference.front : session.blockoutReference.side;
  const objectId = config?.objectId ?? findBlockoutReferenceObjectId(session.document, view);
  if (objectId) removeObject(session.document, objectId, true);
  if (config?.url.startsWith('blob:')) URL.revokeObjectURL(config.url);
  if (view === 'front') session.blockoutReference.front = null;
  else session.blockoutReference.side = null;
  session.blockoutReference.revision += 1;
  session.document.dirty = true;
  session.requestRedraw();
}

export function overlayStateWithoutObjects(state: BlockoutReferenceState): BlockoutReferenceState {
  return {
    ...state,
    front: state.front?.objectId ? { ...state.front, visible: false } : state.front,
    side: state.side?.objectId ? { ...state.side, visible: false } : state.side,
  };
}
