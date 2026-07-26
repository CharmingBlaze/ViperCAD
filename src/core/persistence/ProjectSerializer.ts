import { reserveExistingIds } from '@/core/ids/IdService';
import { normalizeMaterialAsset } from '@/core/material/MaterialPresets';
import { emptyDirtyFlags, type EditableMesh, type FaceCorner } from '@/core/mesh/types';
import { validateMeshFull } from '@/core/mesh/Validation';
import type { ModelDocument } from '@/core/document/types';
import { DEFAULT_PROJECT_SETTINGS } from '@/core/document/types';

export const PROJECT_FORMAT = 'vipercad';
export const PROJECT_FORMAT_VERSION = 2;

type EncodedMesh = Omit<EditableMesh, 'vertices' | 'edges' | 'halfEdges' | 'faces' | 'faceCorners' | 'uvLayers' | 'triangulationHints'> & {
  vertices: EditableMesh['vertices'] extends Map<unknown, infer V> ? V[] : never;
  edges: EditableMesh['edges'] extends Map<unknown, infer V> ? V[] : never;
  halfEdges: EditableMesh['halfEdges'] extends Map<unknown, infer V> ? V[] : never;
  faces: EditableMesh['faces'] extends Map<unknown, infer V> ? V[] : never;
  faceCorners: (Omit<FaceCorner, 'uvs'> & { uvs: [string, { x: number; y: number }][] })[];
  uvLayers: EditableMesh['uvLayers'] extends Map<unknown, infer V> ? V[] : never;
  triangulationHints: [string, '0-2' | '1-3'][];
};

type ProjectFile = {
  format: typeof PROJECT_FORMAT;
  formatVersion: number;
  applicationVersion: string;
  savedAt?: string;
  checksum: string;
  document: {
    id: string; name: string; version: number; rootObjectIds: string[]; settings: ModelDocument['settings'];
    objects: ModelDocument['objects'] extends Map<unknown, infer V> ? V[] : never;
    meshes: EncodedMesh[];
    materials: ModelDocument['materials'] extends Map<unknown, infer V> ? V[] : never;
    textures: ModelDocument['textures'] extends Map<unknown, infer V> ? V[] : never;
    images: (Omit<ModelDocument['images'] extends Map<unknown, infer V> ? V : never, 'pixels'> & { pixels: number[] })[];
  };
};

export function serializeProject(doc: ModelDocument, applicationVersion = '0.0.0'): string {
  const document: ProjectFile['document'] = {
    id: doc.id, name: doc.name, version: doc.version, rootObjectIds: [...doc.rootObjectIds], settings: { ...doc.settings, symmetry: { ...doc.settings.symmetry } },
    objects: [...doc.objects.values()].map((o) => ({ ...o, childIds: [...o.childIds], materialSlotIds: [...o.materialSlotIds], transform: { position: { ...o.transform.position }, rotation: { ...o.transform.rotation }, scale: { ...o.transform.scale } }, metadata: { ...o.metadata } })),
    meshes: [...doc.meshes.values()].map(encodeMesh),
    materials: [...doc.materials.values()].map((m) => ({ ...m, baseColour: { ...m.baseColour }, emissive: { ...m.emissive } })),
    textures: [...doc.textures.values()].map((t) => ({ ...t })),
    images: [...doc.images.values()].map((i) => ({ ...i, pixels: [...i.pixels] })),
  };
  const payload = JSON.stringify(document);
  const file: ProjectFile = { format: PROJECT_FORMAT, formatVersion: PROJECT_FORMAT_VERSION, applicationVersion, savedAt: new Date().toISOString(), checksum: checksum(payload), document };
  return JSON.stringify(file);
}

export function deserializeProject(text: string): ModelDocument {
  const file = JSON.parse(text) as ProjectFile;
  if (file.format !== PROJECT_FORMAT) throw new Error('Not a ViperCAD project');
  if (file.formatVersion > PROJECT_FORMAT_VERSION) throw new Error(`Project format ${file.formatVersion} is newer than supported version ${PROJECT_FORMAT_VERSION}`);
  const payload = JSON.stringify(file.document);
  if (file.checksum !== checksum(payload)) throw new Error('Project integrity check failed');
  const d = migrateProject(file);
  const doc: ModelDocument = {
    id: d.id,
    name: d.name,
    version: d.version,
    rootObjectIds: [...d.rootObjectIds],
    settings: {
      ...DEFAULT_PROJECT_SETTINGS,
      ...d.settings,
      symmetry: {
        ...DEFAULT_PROJECT_SETTINGS.symmetry,
        ...(d.settings?.symmetry ?? {}),
      },
    },
    dirty: false,
    objects: new Map(d.objects.map((o) => [o.id, o])),
    meshes: new Map(),
    materials: new Map(d.materials.map((m) => [m.id, normalizeMaterialAsset(m)])),
    textures: new Map(d.textures.map((t) => [t.id, t])),
    images: new Map(d.images.map((i) => [i.id, { ...i, pixels: new Uint8ClampedArray(i.pixels) }])),
  };
  for (const encoded of d.meshes) {
    const mesh = decodeMesh(encoded);
    const report = validateMeshFull(mesh);
    if (!report.ok) throw new Error(`Invalid mesh ${mesh.name}: ${report.issues.filter((i) => i.severity === 'error').map((i) => i.message).join('; ')}`);
    doc.meshes.set(mesh.id, mesh);
  }
  const ids = [doc.id, ...doc.objects.keys(), ...doc.meshes.keys(), ...doc.materials.keys(), ...doc.textures.keys(), ...doc.images.keys()];
  for (const mesh of doc.meshes.values()) ids.push(...mesh.vertices.keys(), ...mesh.edges.keys(), ...mesh.halfEdges.keys(), ...mesh.faces.keys(), ...mesh.faceCorners.keys(), ...mesh.uvLayers.keys());
  reserveExistingIds(ids);
  return doc;
}

function migrateProject(file: ProjectFile): ProjectFile['document'] {
  const document = file.document;
  document.settings = {
    ...DEFAULT_PROJECT_SETTINGS,
    ...(document.settings ?? {}),
    symmetry: {
      ...DEFAULT_PROJECT_SETTINGS.symmetry,
      ...(document.settings?.symmetry ?? {}),
    },
  };
  return document;
}

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
