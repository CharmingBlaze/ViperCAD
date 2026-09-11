import { describe, expect, it } from 'vitest';
import {
  hydrateBlockoutReferences,
  isBlockoutReferenceObject,
  lockBlockoutReferences,
  placeBlockoutReferenceObject,
  readBlockoutShowInPersp,
  setBlockoutShowInPersp,
  shouldPickSceneObject,
  setReferenceWorldHeight,
  referenceWorldHeight,
} from '../BlockoutReferenceObject';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import { createImagePlane } from '@/core/editor/ImagePlane';
import { EditorSession } from '@/core/editor/EditorSession';
import { addDocumentToProject, createViperDocument } from '@/core/document/ViperProject';
import { createImageAsset, createTextureAsset } from '@/core/image/PixelEditor';
import { serializeViperProject } from '@/core/persistence/ProjectSerializer';
import { openViperProjectText } from '@/core/persistence/projectHealth';
import { APP_VERSION } from '@/version';

function makeReference(view: 'front' | 'side') {
  const document = createEmptyDocument();
  const image = createImageAsset(document, 'Ref', 100, 200, [255, 255, 255, 255]);
  const texture = createTextureAsset(document, image, 'Ref');
  const created = createImagePlane(document, {
    textureId: texture.id,
    imageId: image.id,
    imageWidth: 100,
    imageHeight: 200,
    name: 'Ref',
    maxSize: 2,
  });
  placeBlockoutReferenceObject(document, created, view);
  return { document, created };
}

describe('BlockoutReferenceObject', () => {
  it('commits a locked front plane sitting on the ground', () => {
    const { document, created } = makeReference('front');
    const object = document.objects.get(created.objectId)!;
    expect(isBlockoutReferenceObject(object)).toBe(true);
    expect(object.locked).toBe(true);
    expect(object.transform.position.y).toBeCloseTo(created.height / 2);
    expect(object.transform.rotation.y).toBeCloseTo(0);
    expect(document.rootObjectIds).toContain(object.id);
    const material = document.materials.get(created.materialId)!;
    expect(material.opacity).toBeCloseTo(0.65);
    expect(material.baseColourTextureId).toBe(textureId(document, created.objectId));
  });

  it('faces Side references along world +X', () => {
    const { document, created } = makeReference('side');
    const object = document.objects.get(created.objectId)!;
    expect(object.transform.rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it('ignores locked blueprints and Front refs in the Side pane', () => {
    const { document, created } = makeReference('front');
    expect(
      shouldPickSceneObject(document, created.objectId, { paneId: 'front', blockoutToolActive: true }),
    ).toBe(false);
    expect(shouldPickSceneObject(document, created.objectId, { paneId: 'front' })).toBe(false);
    document.objects.get(created.objectId)!.locked = false;
    expect(shouldPickSceneObject(document, created.objectId, { paneId: 'front' })).toBe(true);
    expect(shouldPickSceneObject(document, created.objectId, { paneId: 'right' })).toBe(false);
  });

  it('scales the world height from the stored plane size', () => {
    const { document, created } = makeReference('front');
    const object = document.objects.get(created.objectId)!;
    setReferenceWorldHeight(document, object, 4);
    expect(referenceWorldHeight(document, object)).toBeCloseTo(4);
  });

  it('does not dirty a document with no blueprints when locking', () => {
    const document = createEmptyDocument();
    document.dirty = false;
    lockBlockoutReferences(document, true);
    expect(document.dirty).toBe(false);
  });

  it('dirties only when a blueprint lock actually changes', () => {
    const { document, created } = makeReference('front');
    document.dirty = false;
    lockBlockoutReferences(document, true);
    expect(document.dirty).toBe(false);
    lockBlockoutReferences(document, false);
    expect(document.dirty).toBe(true);
    expect(document.objects.get(created.objectId)!.locked).toBe(false);
  });

  it('restores Front and Side slots after loadProject', () => {
    const session = new EditorSession();
    session.ensureDocumentKind('model');
    const image = createImageAsset(session.document, 'Ref', 8, 16, [255, 255, 255, 255]);
    const texture = createTextureAsset(session.document, image, 'Ref');
    const created = createImagePlane(session.document, {
      textureId: texture.id,
      imageId: image.id,
      imageWidth: 8,
      imageHeight: 16,
      name: 'Front · Ref',
      maxSize: 2,
    });
    placeBlockoutReferenceObject(session.document, created, 'front');
    expect(session.blockoutReference.front).toBeNull();

    session.blockoutReference = hydrateBlockoutReferences(session.project, session.blockoutReference);
    expect(session.blockoutReference.front?.objectId).toBe(created.objectId);
    expect(session.blockoutReference.front?.locked).toBe(true);

    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    const restored = new EditorSession();
    restored.loadProject(loaded.project);
    expect(restored.blockoutReference.front?.objectId).toBe(created.objectId);
    expect(restored.blockoutReference.front?.locked).toBe(true);
    expect(restored.blockoutReference.side).toBeNull();
  });

  it('restores Show in perspective after loadProject', () => {
    const session = new EditorSession();
    session.ensureDocumentKind('model');
    setBlockoutShowInPersp(session, false);
    expect(session.blockoutReference.showInPersp).toBe(false);

    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    const restored = new EditorSession();
    restored.loadProject(loaded.project);
    expect(restored.blockoutReference.showInPersp).toBe(false);
  });

  it('reads Show in perspective from the active document first', () => {
    const session = new EditorSession();
    session.ensureDocumentKind('model');
    const first = session.project.documents.get(session.documentId)!;
    first.settings.blockoutShowInPersp = true;
    const extra = createViperDocument('Other Model', 'model');
    extra.settings.blockoutShowInPersp = false;
    addDocumentToProject(session.project, extra);
    session.project.activeDocumentId = extra.id;
    expect(readBlockoutShowInPersp(session.project)).toBe(false);
  });
});

function textureId(document: ReturnType<typeof createEmptyDocument>, objectId: string): string | null {
  const object = document.objects.get(objectId)!;
  const material = document.materials.get(object.materialSlotIds[0]!)!;
  return material.baseColourTextureId;
}
