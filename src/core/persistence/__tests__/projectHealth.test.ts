import { describe, expect, it } from 'vitest';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import type { MeshId } from '@/core/mesh/types';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { serializeProject } from '@/core/persistence/ProjectSerializer';
import {
  firstMeshValidationError,
  inspectDocumentHealth,
  openViperProjectText,
} from '@/core/persistence/projectHealth';

function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

describe('inspectDocumentHealth', () => {
  it('accepts a valid box document', () => {
    const document = createEmptyDocument();
    commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    expect(inspectDocumentHealth(document).ok).toBe(true);
    expect(firstMeshValidationError(buildBox({ width: 1, height: 1, depth: 1 }))).toBeNull();
  });

  it('rejects a mesh with a missing vertex', () => {
    const document = createEmptyDocument();
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }), { name: 'Broken' });
    const object = document.objects.get(objectId)!;
    const mesh = document.meshes.get(object.meshId!)!;
    const vertex = [...mesh.vertices.values()][0]!;
    mesh.vertices.delete(vertex.id);
    const report = inspectDocumentHealth(document);
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/Broken/);
  });

  it('rejects an object whose mesh id is missing', () => {
    const document = createEmptyDocument();
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }), { name: 'Prop' });
    document.objects.get(objectId)!.meshId = 'mesh_missing' as MeshId;
    const report = inspectDocumentHealth(document);
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/missing mesh/);
  });
});

describe('openViperProjectText', () => {
  it('opens a healthy saved project', () => {
    const document = createEmptyDocument();
    commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }), { name: 'Box' });
    const loaded = openViperProjectText(serializeProject(document));
    expect(loaded.project.meshes.size).toBeGreaterThan(0);
  });

  it('refuses a tampered checksum', () => {
    const document = createEmptyDocument();
    const file = JSON.parse(serializeProject(document)) as { checksum: string };
    file.checksum = 'deadbeef';
    expect(() => openViperProjectText(JSON.stringify(file))).toThrow(/integrity check/);
  });

  it('refuses a project with a dangling mesh reference', () => {
    const document = createEmptyDocument();
    commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }), { name: 'Prop' });
    const file = JSON.parse(serializeProject(document)) as {
      checksum: string;
      project: { documents: { objects: { meshId: string | null }[] }[] };
    };
    const object = file.project.documents.flatMap((doc) => doc.objects).find((item) => item.meshId);
    expect(object).toBeDefined();
    object!.meshId = 'mesh_missing';
    file.checksum = checksum(JSON.stringify(file.project));
    expect(() => openViperProjectText(JSON.stringify(file))).toThrow(/missing mesh/);
  });
});
