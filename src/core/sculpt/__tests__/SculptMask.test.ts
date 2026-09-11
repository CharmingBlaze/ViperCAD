import { describe, expect, it } from 'vitest';
import { buildSphere } from '@/core/mesh/builders/SphereBuilder';
import {
  blurMeshMask,
  clearAllMeshMasks,
  clearMeshMask,
  extractMaskedGeometry,
  getMeshMask,
  hasMask,
  hydrateSculptMasks,
  invertMeshMask,
  peekMeshMask,
} from '@/core/sculpt/SculptMask';
import { EditorSession } from '@/core/editor/EditorSession';
import { commitMeshObject } from '@/core/document/ModelDocument';

describe('SculptMask', () => {
  it('handles mask storage, inversion, and clearing', () => {
    const mesh = buildSphere({ radius: 1, widthSegments: 16, heightSegments: 12 });
    const mask = getMeshMask(mesh.id);

    const firstVertex = [...mesh.vertices.keys()][0]!;
    mask.set(firstVertex, 0.8);
    expect(hasMask(mesh.id)).toBe(true);

    invertMeshMask(mesh);
    expect(mask.get(firstVertex)).toBeCloseTo(0.2, 3);

    blurMeshMask(mesh);
    expect(hasMask(mesh.id)).toBe(true);

    clearMeshMask(mesh.id);
    expect(hasMask(mesh.id)).toBe(false);
  });

  it('extracts masked geometry to a new mesh object', () => {
    const session = new EditorSession();
    const mesh = buildSphere({ radius: 1, widthSegments: 16, heightSegments: 12 });
    const { objectId } = commitMeshObject(session.document, mesh, { name: 'SourceSphere' });
    const object = session.document.objects.get(objectId)!;

    // Mask top half vertices
    const mask = getMeshMask(mesh.id);
    for (const [id, v] of mesh.vertices) {
      if (v.position.y > 0.2) mask.set(id, 1.0);
    }

    const extractedId = extractMaskedGeometry(session.document, object, mesh, 0.5, 0.05);
    expect(extractedId).not.toBeNull();

    const extractedObject = session.document.objects.get(extractedId!)!;
    expect(extractedObject.name).toContain('Extracted');
    const extractedMesh = session.document.meshes.get(extractedObject.meshId!)!;
    expect(extractedMesh.faces.size).toBeGreaterThan(0);
  });

  it('hydrates a persisted mask into the session cache', () => {
    const mesh = buildSphere({ radius: 1, widthSegments: 8, heightSegments: 6 });
    const vertexId = [...mesh.vertices.keys()][0]!;
    mesh.sculptMask = new Map([[vertexId, 0.65]]);
    clearAllMeshMasks();
    expect(peekMeshMask(mesh.id)).toBeUndefined();
    hydrateSculptMasks([mesh]);
    expect(getMeshMask(mesh.id).get(vertexId)).toBeCloseTo(0.65);
  });
});
