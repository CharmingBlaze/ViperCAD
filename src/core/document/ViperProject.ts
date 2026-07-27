import { createId } from '@/core/ids/IdService';
import { defaultTransform } from '@/core/math/Transform';
import {
  createDefaultCheckerAssets,
} from '@/core/document/ModelDocument';
import type {
  DocumentId,
  DocumentKind,
  DocumentSettings,
  ModelDocument,
  ObjectId,
  ViperDocument,
  ViperProject,
} from '@/core/document/types';
import { DEFAULT_PROJECT_SETTINGS } from '@/core/document/types';
import { createDefaultRigDocumentSettings } from '@/core/rig/types';

export function createDefaultDocumentSettings(kind: DocumentKind): DocumentSettings {
  if (kind === 'model') {
    return { origin: defaultTransform(), thumbnailImageId: null };
  }
  if (kind === 'rig') {
    return { rig: createDefaultRigDocumentSettings() };
  }
  return {};
}

export function createViperDocument(name: string, kind: DocumentKind): ViperDocument {
  return {
    id: createId('doc'),
    name,
    kind,
    objects: new Map(),
    rootObjectIds: [],
    revision: 1,
    dirty: false,
    settings: createDefaultDocumentSettings(kind),
  };
}

export function createEmptyProject(projectName = 'Untitled Project'): ViperProject {
  const { material, texture, image } = createDefaultCheckerAssets();
  const model = createViperDocument('Untitled Model', 'model');
  const level = createViperDocument('Main Level', 'level');
  const rig = createViperDocument('Character Rig', 'rig');
  rig.settings.rig = createDefaultRigDocumentSettings(model.id);
  return {
    id: createId('proj'),
    name: projectName,
    version: 1,
    documents: new Map([
      [model.id, model],
      [level.id, level],
      [rig.id, rig],
    ]),
    modelDocumentIds: [model.id],
    levelDocumentIds: [level.id],
    rigDocumentIds: [rig.id],
    activeDocumentId: level.id,
    meshes: new Map(),
    materials: new Map([[material.id, material]]),
    textures: new Map([[texture.id, texture]]),
    images: new Map([[image.id, image]]),
    armatures: new Map(),
    skinBindings: new Map(),
    animationClips: new Map(),
    settings: {
      ...DEFAULT_PROJECT_SETTINGS,
      symmetry: { ...DEFAULT_PROJECT_SETTINGS.symmetry },
    },
    dirty: false,
  };
}

type DocumentViewBinding = { project: ViperProject; documentId: DocumentId };
const viewBindings = new WeakMap<ModelDocument, DocumentViewBinding>();

export function buildModelDocumentView(
  project: ViperProject,
  documentId: DocumentId,
): ModelDocument {
  const doc = project.documents.get(documentId);
  if (!doc) throw new Error(`Document ${documentId} not found`);
  const view: ModelDocument = {
    id: doc.id,
    name: doc.name,
    version: project.version,
    kind: doc.kind,
    objects: doc.objects,
    get rootObjectIds() {
      return doc.rootObjectIds;
    },
    set rootObjectIds(value: ObjectId[]) {
      doc.rootObjectIds = value;
    },
    meshes: project.meshes,
    materials: project.materials,
    textures: project.textures,
    images: project.images,
    settings: project.settings,
    get dirty() {
      return doc.dirty || project.dirty;
    },
    set dirty(value: boolean) {
      doc.dirty = value;
      if (value) project.dirty = true;
      else if (![...project.documents.values()].some((d) => d.dirty)) project.dirty = false;
    },
  };
  viewBindings.set(view, { project, documentId });
  return view;
}

export function resolveDocumentView(view: ModelDocument): DocumentViewBinding | null {
  return viewBindings.get(view) ?? null;
}

export function getViperDocument(project: ViperProject, documentId: DocumentId): ViperDocument {
  const doc = project.documents.get(documentId);
  if (!doc) throw new Error(`Document ${documentId} not found`);
  return doc;
}

export function addDocumentToProject(project: ViperProject, doc: ViperDocument): DocumentId {
  project.documents.set(doc.id, doc);
  if (doc.kind === 'model') project.modelDocumentIds.push(doc.id);
  else if (doc.kind === 'rig') project.rigDocumentIds.push(doc.id);
  else project.levelDocumentIds.push(doc.id);
  project.dirty = true;
  return doc.id;
}

export function removeDocumentFromProject(project: ViperProject, documentId: DocumentId): void {
  project.documents.delete(documentId);
  project.modelDocumentIds = project.modelDocumentIds.filter((id) => id !== documentId);
  project.levelDocumentIds = project.levelDocumentIds.filter((id) => id !== documentId);
  project.rigDocumentIds = project.rigDocumentIds.filter((id) => id !== documentId);
  if (project.activeDocumentId === documentId) {
    project.activeDocumentId =
      project.levelDocumentIds[0]
      ?? project.modelDocumentIds[0]
      ?? project.rigDocumentIds[0]
      ?? null;
  }
  project.dirty = true;
}

export function projectFromLegacyDocument(document: ModelDocument): ViperProject {
  const project = createEmptyProject(document.name);
  for (const docId of [...project.documents.keys()]) {
    project.documents.delete(docId);
  }
  project.modelDocumentIds = [];
  project.levelDocumentIds = [];
  project.rigDocumentIds = [];
  project.armatures.clear();
  project.skinBindings.clear();
  project.animationClips.clear();

  const level = createViperDocument(document.name || 'Main Level', 'level');
  level.id = document.id;
  level.objects = document.objects;
  level.rootObjectIds = [...document.rootObjectIds];
  level.dirty = document.dirty;
  project.documents.set(level.id, level);
  project.levelDocumentIds = [level.id];
  project.version = document.version;
  project.meshes = document.meshes;
  project.materials = document.materials;
  project.textures = document.textures;
  project.images = document.images;
  project.settings = {
    ...DEFAULT_PROJECT_SETTINGS,
    ...document.settings,
    symmetry: { ...DEFAULT_PROJECT_SETTINGS.symmetry, ...document.settings.symmetry },
  };
  project.activeDocumentId = level.id;
  project.dirty = document.dirty;
  return project;
}

export function projectIsDirty(project: ViperProject): boolean {
  return project.dirty || [...project.documents.values()].some((d) => d.dirty);
}

export function clearProjectDirty(project: ViperProject): void {
  project.dirty = false;
  for (const doc of project.documents.values()) doc.dirty = false;
}
