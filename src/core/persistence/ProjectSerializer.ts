import { reserveExistingIds } from '@/core/ids/IdService';
import { normalizeMaterialAsset } from '@/core/material/MaterialPresets';
import { emptyDirtyFlags, type EditableMesh, type FaceCorner } from '@/core/mesh/types';
import { validateMeshFull } from '@/core/mesh/Validation';
import { normalizeDocumentObjects } from '@/core/document/SceneObjectKind';
import {
  createDefaultDocumentSettings,
  createEmptyProject,
  projectFromLegacyDocument,
  resolveDocumentView,
} from '@/core/document/ViperProject';
import type { DocumentId, ModelDocument, ObjectId, SceneObject, ViperDocument, ViperProject } from '@/core/document/types';
import { DEFAULT_PROJECT_SETTINGS } from '@/core/document/types';
import { defaultTransform } from '@/core/math/Transform';

export const PROJECT_FORMAT = 'vipercad';
export const PROJECT_FORMAT_VERSION = 3;

type EncodedMesh = Omit<EditableMesh, 'vertices' | 'edges' | 'halfEdges' | 'faces' | 'faceCorners' | 'uvLayers' | 'triangulationHints'> & {
  vertices: EditableMesh['vertices'] extends Map<unknown, infer V> ? V[] : never;
  edges: EditableMesh['edges'] extends Map<unknown, infer V> ? V[] : never;
  halfEdges: EditableMesh['halfEdges'] extends Map<unknown, infer V> ? V[] : never;
  faces: EditableMesh['faces'] extends Map<unknown, infer V> ? V[] : never;
  faceCorners: (Omit<FaceCorner, 'uvs'> & { uvs: [string, { x: number; y: number }][] })[];
  uvLayers: EditableMesh['uvLayers'] extends Map<unknown, infer V> ? V[] : never;
  triangulationHints: [string, '0-2' | '1-3'][];
};

type LegacyProjectFile = {
  format: typeof PROJECT_FORMAT;
  formatVersion: number;
  applicationVersion: string;
  savedAt?: string;
  checksum: string;
  document: {
    id: string; name: string; version: number; rootObjectIds: string[]; settings: ModelDocument['settings'];
    objects: (SceneObject & { childIds: string[]; materialSlotIds: string[] })[];
    meshes: EncodedMesh[];
    materials: ModelDocument['materials'] extends Map<unknown, infer V> ? V[] : never;
    textures: ModelDocument['textures'] extends Map<unknown, infer V> ? V[] : never;
    images: (Omit<ModelDocument['images'] extends Map<unknown, infer V> ? V : never, 'pixels'> & { pixels: number[] })[];
  };
};

type EncodedDocument = {
  id: DocumentId;
  name: string;
  kind: 'model' | 'level';
  rootObjectIds: ObjectId[];
  objects: (SceneObject & { childIds: string[]; materialSlotIds: string[] })[];
  revision: number;
  settings: ViperDocument['settings'];
};

type ProjectFileV3 = {
  format: typeof PROJECT_FORMAT;
  formatVersion: 3;
  applicationVersion: string;
  savedAt?: string;
  checksum: string;
  project: {
    id: string;
    name: string;
    version: number;
    activeDocumentId: string | null;
    modelDocumentIds: string[];
    levelDocumentIds: string[];
    documents: EncodedDocument[];
    meshes: EncodedMesh[];
    materials: ModelDocument['materials'] extends Map<unknown, infer V> ? V[] : never;
    textures: ModelDocument['textures'] extends Map<unknown, infer V> ? V[] : never;
    images: (Omit<ModelDocument['images'] extends Map<unknown, infer V> ? V : never, 'pixels'> & { pixels: number[] })[];
    settings: ModelDocument['settings'];
  };
};

export function serializeViperProject(project: ViperProject, applicationVersion = '0.0.0'): string {
  const payloadProject = {
    id: project.id,
    name: project.name,
    version: project.version,
    activeDocumentId: project.activeDocumentId,
    modelDocumentIds: [...project.modelDocumentIds],
    levelDocumentIds: [...project.levelDocumentIds],
    documents: [...project.documents.values()].map((doc) => ({
      id: doc.id,
      name: doc.name,
      kind: doc.kind,
      rootObjectIds: [...doc.rootObjectIds],
      revision: doc.revision,
      settings: structuredClone(doc.settings),
      objects: [...doc.objects.values()].map((o) => ({
        ...o,
        childIds: [...o.childIds],
        materialSlotIds: [...o.materialSlotIds],
        transform: { position: { ...o.transform.position }, rotation: { ...o.transform.rotation }, scale: { ...o.transform.scale } },
        metadata: { ...o.metadata },
      })),
    })),
    meshes: [...project.meshes.values()].map(encodeMesh),
    materials: [...project.materials.values()].map((m) => ({ ...m, baseColour: { ...m.baseColour }, emissive: { ...m.emissive } })),
    textures: [...project.textures.values()].map((t) => ({ ...t })),
    images: [...project.images.values()].map((i) => ({ ...i, pixels: [...i.pixels] })),
    settings: { ...project.settings, symmetry: { ...project.settings.symmetry } },
  };
  const payload = JSON.stringify(payloadProject);
  return JSON.stringify({
    format: PROJECT_FORMAT,
    formatVersion: PROJECT_FORMAT_VERSION,
    applicationVersion,
    savedAt: new Date().toISOString(),
    checksum: checksum(payload),
    project: payloadProject,
  });
}

export function serializeProject(doc: ModelDocument, applicationVersion = '0.0.0'): string {
  const binding = resolveDocumentView(doc);
  if (binding) {
    binding.project.activeDocumentId = binding.documentId;
    return serializeViperProject(binding.project, applicationVersion);
  }
  return serializeViperProject(projectFromLegacyDocument(doc), applicationVersion);
}

export type DeserializeProjectResult = { project: ViperProject; activeDocumentId: DocumentId };

export function deserializeViperProject(text: string): DeserializeProjectResult {
  const parsed = JSON.parse(text) as LegacyProjectFile | ProjectFileV3;
  if (parsed.format !== PROJECT_FORMAT) throw new Error('Not a ViperCAD project');
  if (parsed.formatVersion > PROJECT_FORMAT_VERSION) {
    throw new Error(`Project format ${parsed.formatVersion} is newer than supported version ${PROJECT_FORMAT_VERSION}`);
  }
  if (parsed.formatVersion >= 3 && 'project' in parsed) {
    const payload = JSON.stringify(parsed.project);
    if (parsed.checksum !== checksum(payload)) throw new Error('Project integrity check failed');
    const p = parsed.project;
    const project = createEmptyProject(p.name);
    project.id = p.id;
    project.version = p.version;
    project.activeDocumentId = p.activeDocumentId;
    project.modelDocumentIds = [...p.modelDocumentIds];
    project.levelDocumentIds = [...p.levelDocumentIds];
    project.settings = { ...DEFAULT_PROJECT_SETTINGS, ...p.settings, symmetry: { ...DEFAULT_PROJECT_SETTINGS.symmetry, ...(p.settings?.symmetry ?? {}) } };
    project.documents.clear();
    for (const encoded of p.documents) {
      const doc: ViperDocument = {
        id: encoded.id,
        name: encoded.name,
        kind: encoded.kind,
        rootObjectIds: [...encoded.rootObjectIds],
        revision: encoded.revision ?? 1,
        dirty: false,
        settings: encoded.kind === 'model'
          ? { ...createDefaultDocumentSettings('model'), ...encoded.settings, origin: encoded.settings.origin ?? defaultTransform() }
          : { ...encoded.settings },
        objects: new Map(encoded.objects.map((o) => [o.id, { ...o, childIds: [...o.childIds], materialSlotIds: [...o.materialSlotIds], instanceSourceModelId: o.instanceSourceModelId ?? null, kind: o.kind ?? 'empty' }])),
      };
      normalizeDocumentObjects(doc.objects);
      project.documents.set(doc.id, doc);
    }
    project.meshes.clear();
    for (const encoded of p.meshes) {
      const mesh = decodeMesh(encoded);
      const report = validateMeshFull(mesh);
      if (!report.ok) throw new Error(`Invalid mesh ${mesh.name}`);
      project.meshes.set(mesh.id, mesh);
    }
    project.materials = new Map(p.materials.map((m) => [m.id, normalizeMaterialAsset(m)]));
    project.textures = new Map(p.textures.map((t) => [t.id, t]));
    project.images = new Map(p.images.map((i) => [i.id, { ...i, pixels: new Uint8ClampedArray(i.pixels) }]));
    reserveProjectIds(project);
    const activeDocumentId = project.activeDocumentId ?? project.levelDocumentIds[0] ?? project.modelDocumentIds[0]!;
    project.activeDocumentId = activeDocumentId;
    return { project, activeDocumentId };
  }

  const legacy = parsed as LegacyProjectFile;
  const payload = JSON.stringify(legacy.document);
  if (legacy.checksum !== checksum(payload)) throw new Error('Project integrity check failed');
  const d = migrateLegacyDocument(legacy);
  const legacyDoc = buildLegacyModelDocument(d);
  const project = projectFromLegacyDocument(legacyDoc);
  reserveProjectIds(project);
  return { project, activeDocumentId: project.activeDocumentId ?? project.levelDocumentIds[0]! };
}

export function deserializeProject(text: string): ModelDocument {
  const { project, activeDocumentId } = deserializeViperProject(text);
  const doc = project.documents.get(activeDocumentId)!;
  return {
    id: doc.id,
    name: doc.name,
    version: project.version,
    kind: doc.kind,
    objects: doc.objects,
    rootObjectIds: doc.rootObjectIds,
    meshes: project.meshes,
    materials: project.materials,
    textures: project.textures,
    images: project.images,
    settings: project.settings,
    dirty: false,
  };
}

function migrateLegacyDocument(file: LegacyProjectFile): LegacyProjectFile['document'] {
  const document = file.document;
  document.settings = {
    ...DEFAULT_PROJECT_SETTINGS,
    ...(document.settings ?? {}),
    symmetry: { ...DEFAULT_PROJECT_SETTINGS.symmetry, ...(document.settings?.symmetry ?? {}) },
  };
  return document;
}

function buildLegacyModelDocument(d: LegacyProjectFile['document']): ModelDocument {
  const doc: ModelDocument = {
    id: d.id,
    name: d.name,
    version: d.version,
    rootObjectIds: [...d.rootObjectIds],
    settings: d.settings,
    dirty: false,
    objects: new Map(d.objects.map((o) => [o.id, { ...o, childIds: [...o.childIds], materialSlotIds: [...o.materialSlotIds], instanceSourceModelId: o.instanceSourceModelId ?? null, kind: o.kind ?? 'empty' }])),
    meshes: new Map(),
    materials: new Map(d.materials.map((m) => [m.id, normalizeMaterialAsset(m)])),
    textures: new Map(d.textures.map((t) => [t.id, t])),
    images: new Map(d.images.map((i) => [i.id, { ...i, pixels: new Uint8ClampedArray(i.pixels) }])),
  };
  for (const encoded of d.meshes) {
    const mesh = decodeMesh(encoded);
    const report = validateMeshFull(mesh);
    if (!report.ok) throw new Error(`Invalid mesh ${mesh.name}`);
    doc.meshes.set(mesh.id, mesh);
  }
  normalizeDocumentObjects(doc.objects);
  return doc;
}

function reserveProjectIds(project: ViperProject): void {
  const ids: string[] = [project.id, ...project.documents.keys(), ...project.meshes.keys(), ...project.materials.keys(), ...project.textures.keys(), ...project.images.keys()];
  for (const doc of project.documents.values()) ids.push(...doc.objects.keys());
  for (const mesh of project.meshes.values()) {
    ids.push(...mesh.vertices.keys(), ...mesh.edges.keys(), ...mesh.halfEdges.keys(), ...mesh.faces.keys(), ...mesh.faceCorners.keys(), ...mesh.uvLayers.keys());
  }
  reserveExistingIds(ids);
}

// Legacy types removed — v3 is primary; v1/v2 load via legacy branch above.

function encodeMesh(mesh: EditableMesh): EncodedMesh {
  return { ...mesh, dirty: { ...mesh.dirty }, vertices: [...mesh.vertices.values()].map((v) => ({ ...v, position: { ...v.position } })), edges: [...mesh.edges.values()].map((e) => ({ ...e })), halfEdges: [...mesh.halfEdges.values()].map((h) => ({ ...h })), faces: [...mesh.faces.values()].map((f) => ({ ...f })), faceCorners: [...mesh.faceCorners.values()].map((c) => ({ ...c, uvs: [...c.uvs.entries()].map(([id, uv]) => [id, { ...uv }]) })), uvLayers: [...mesh.uvLayers.values()].map((u) => ({ ...u })), triangulationHints: [...mesh.triangulationHints] } as EncodedMesh;
}

function decodeMesh(encoded: EncodedMesh): EditableMesh {
  return { ...encoded, vertices: new Map(encoded.vertices.map((v) => [v.id, v])), edges: new Map(encoded.edges.map((e) => [e.id, e])), halfEdges: new Map(encoded.halfEdges.map((h) => [h.id, h])), faces: new Map(encoded.faces.map((f) => [f.id, f])), faceCorners: new Map(encoded.faceCorners.map((c) => [c.id, { ...c, uvs: new Map(c.uvs) }])), uvLayers: new Map(encoded.uvLayers.map((u) => [u.id, u])), triangulationHints: new Map(encoded.triangulationHints), dirty: emptyDirtyFlags(true) };
}

function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
