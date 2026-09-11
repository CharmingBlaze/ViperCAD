import { describe, expect, it } from 'vitest';
import { importGltf } from '@/core/io/GltfAdapter';
import { validateMeshFull } from '@/core/mesh/Validation';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { serializeViperProject } from '@/core/persistence/ProjectSerializer';
import { inspectProjectHealth, openViperProjectText } from '@/core/persistence/projectHealth';
import { APP_VERSION } from '@/version';

function encodeTriangleGltf(indices: number[]): ArrayBuffer {
  if (typeof ProgressEvent === 'undefined') {
    Object.assign(globalThis, { ProgressEvent: class ProgressEvent {} });
  }
  const indexBytes = indices.length * 2;
  const binary = new Uint8Array(36 + indexBytes);
  const view = new DataView(binary.buffer);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) =>
    view.setFloat32(index * 4, value, true),
  );
  indices.forEach((value, index) => view.setUint16(36 + index * 2, value, true));
  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.byteLength, uri: `data:application/octet-stream;base64,${btoa(String.fromCharCode(...binary))}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: indexBytes, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    meshes: [{ name: 'Triangle', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  return new TextEncoder().encode(JSON.stringify(gltf)).buffer as ArrayBuffer;
}

describe('glTF import', () => {
  it('imports self-contained triangle geometry', async () => {
    const meshes = await importGltf(encodeTriangleGltf([0, 1, 2]));
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.faces.size).toBe(1);
    expect(validateMeshFull(meshes[0]!).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('refuses an out-of-range vertex index', async () => {
    await expect(importGltf(encodeTriangleGltf([0, 1, 9]))).rejects.toThrow(/out of range/);
  });

  it('refuses duplicate faces that break topology', async () => {
    await expect(importGltf(encodeTriangleGltf([0, 1, 2, 0, 1, 2]))).rejects.toThrow(/winding|validation|duplicate/i);
  });

  it('refuses a mesh whose every triangle is degenerate', async () => {
    await expect(importGltf(encodeTriangleGltf([0, 1, 1]))).rejects.toThrow(/no importable mesh geometry/);
  });

  it('round-trips an imported glTF mesh through open', async () => {
    const meshes = await importGltf(encodeTriangleGltf([0, 1, 2]));
    const session = new EditorSession();
    const { objectId } = commitMeshObject(session.document, meshes[0]!, { name: meshes[0]!.name });
    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    const restored = [...loaded.project.documents.values()]
      .flatMap((doc) => [...doc.objects.values()])
      .find((object) => object.id === objectId);
    expect(loaded.project.meshes.get(restored!.meshId!)?.faces.size).toBe(1);
  });
});
