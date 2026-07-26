import { describe, expect, it } from 'vitest';
import { importGltf } from '@/core/io/GltfAdapter';
import { validateMeshFull } from '@/core/mesh/Validation';

describe('glTF import', () => {
  it('imports self-contained triangle geometry', async () => {
    if (typeof ProgressEvent === 'undefined') {
      Object.assign(globalThis, { ProgressEvent: class ProgressEvent {} });
    }
    const binary = new Uint8Array(44);
    const view = new DataView(binary.buffer);
    [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) =>
      view.setFloat32(index * 4, value, true),
    );
    [0, 1, 2].forEach((value, index) => view.setUint16(36 + index * 2, value, true));
    const gltf = {
      asset: { version: '2.0' },
      buffers: [{ byteLength: binary.byteLength, uri: `data:application/octet-stream;base64,${btoa(String.fromCharCode(...binary))}` }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
        { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      meshes: [{ name: 'Triangle', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    };
    const encoded = new TextEncoder().encode(JSON.stringify(gltf));
    const meshes = await importGltf(encoded.buffer as ArrayBuffer);
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.faces.size).toBe(1);
    expect(validateMeshFull(meshes[0]!).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});
