import type { EditableMesh, MeshId } from '@/core/mesh/types';
import type {
  MaterialId,
  ModelDocument,
  ObjectId,
  SceneObject,
  ViperProject,
} from '@/core/document/types';
import { validateMeshFull } from '@/core/mesh/Validation';
import {
  deserializeViperProject,
  type DeserializeProjectResult,
} from '@/core/persistence/ProjectSerializer';

function collectMeshErrors(name: string, mesh: EditableMesh, errors: string[]): void {
  try {
    const report = validateMeshFull(mesh);
    if (report.ok) return;
    const first = report.issues.find((issue) => issue.severity === 'error');
    errors.push(first ? `${name}: ${first.message}` : `${name} failed validation`);
  } catch (error) {
    errors.push(error instanceof Error ? `${name}: ${error.message}` : `${name} failed validation`);
  }
}

function collectSceneErrors(
  label: string,
  objects: Map<ObjectId, SceneObject>,
  rootObjectIds: ObjectId[],
  meshes: Map<MeshId, EditableMesh>,
  materials: Map<MaterialId, unknown>,
  errors: string[],
): void {
  for (const rootId of rootObjectIds) {
    if (!objects.has(rootId)) errors.push(`${label}: missing root object`);
  }
  for (const object of objects.values()) {
    if (object.parentId && !objects.has(object.parentId)) {
      errors.push(`${object.name}: missing parent`);
    }
    for (const childId of object.childIds) {
      if (!objects.has(childId)) errors.push(`${object.name}: missing child`);
    }
    if (object.meshId && !meshes.has(object.meshId)) {
      errors.push(`${object.name}: missing mesh`);
    }
    for (const materialId of object.materialSlotIds) {
      if (!materials.has(materialId)) errors.push(`${object.name}: missing material`);
    }
  }
}

export type ProjectHealthReport = {
  ok: boolean;
  errors: string[];
};

/** Block saves that would persist broken topology or dangling scene refs. */
export function inspectDocumentHealth(document: ModelDocument): ProjectHealthReport {
  const errors: string[] = [];
  for (const mesh of document.meshes.values()) {
    collectMeshErrors(mesh.name, mesh, errors);
  }
  collectSceneErrors(
    document.name,
    document.objects,
    document.rootObjectIds,
    document.meshes,
    document.materials,
    errors,
  );
  return { ok: errors.length === 0, errors };
}

export function inspectProjectHealth(project: ViperProject): ProjectHealthReport {
  const errors: string[] = [];
  for (const mesh of project.meshes.values()) {
    collectMeshErrors(mesh.name, mesh, errors);
  }
  if (project.activeDocumentId && !project.documents.has(project.activeDocumentId)) {
    errors.push('Active document is missing');
  }
  for (const documentId of [
    ...project.modelDocumentIds,
    ...project.levelDocumentIds,
    ...project.rigDocumentIds,
  ]) {
    if (!project.documents.has(documentId)) errors.push('Project lists a missing document');
  }
  for (const document of project.documents.values()) {
    collectSceneErrors(
      document.name,
      document.objects,
      document.rootObjectIds,
      project.meshes,
      project.materials,
      errors,
    );
  }
  return { ok: errors.length === 0, errors };
}

/** Open a `.viper` payload only when checksum, topology, and scene refs are valid. */
export function openViperProjectText(text: string): DeserializeProjectResult {
  const result = deserializeViperProject(text);
  const health = inspectProjectHealth(result.project);
  if (!health.ok) throw new Error(health.errors[0] ?? 'Project failed validation');
  return result;
}

export function firstMeshValidationError(mesh: EditableMesh): string | null {
  const report = validateMeshFull(mesh);
  if (report.ok) return null;
  const first = report.issues.find((issue) => issue.severity === 'error');
  return first?.message ?? `${mesh.name} failed validation`;
}
