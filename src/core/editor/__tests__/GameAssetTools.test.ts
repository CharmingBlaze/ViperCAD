import { beforeEach, describe, expect, it } from 'vitest';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import {
  generateBoxCollider,
  generateConvexCollider,
  generateLightmapUv,
  createMirroredInstance,
  createRadialInstances,
  centreObjectOrigin,
  groupObjects,
  hasLightmapUv,
  joinMeshObjects,
  separateFacesToObject,
  ungroupObject,
} from '@/core/editor/GameAssetTools';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { editableMeshToRenderData } from '@/renderer/MeshRenderAdapter';
import { bridgeEdgeLoops, triangulateFaces, weldVerticesByDistance } from '@/core/mesh/ops/basic';
import { validateMeshFull } from '@/core/mesh/Validation';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { v3 } from '@/core/math/Vec3';
import { getMeshStats } from '@/core/mesh/EditableMesh';

beforeEach(() => resetIdCounter(1));

describe('game asset tools', () => {
  it('creates an aligned box collider with engine metadata', () => {
    const document = createEmptyDocument();
    const source = commitMeshObject(document, buildBox({ width: 2, height: 4, depth: 6 }));
    const sourceObject = document.objects.get(source.objectId)!;
    sourceObject.transform.position = { x: 8, y: 2, z: -3 };

    const colliderId = generateBoxCollider(document, source.objectId);
    const collider = document.objects.get(colliderId)!;
    const colliderMesh = document.meshes.get(collider.meshId!)!;

    expect(collider.name).toBe(`UCX_${sourceObject.name}`);
    expect(collider.metadata).toMatchObject({
      gameRole: 'collision',
      collision: 'box',
      collisionFor: source.objectId,
    });
    expect(collider.transform).toEqual(sourceObject.transform);
    expect(colliderMesh.vertices.size).toBe(8);
    expect(colliderMesh.faces.size).toBe(6);
  });

  it('builds a secondary UV attribute for GLB lightmaps', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    expect(hasLightmapUv(mesh)).toBe(false);
    generateLightmapUv(mesh);
    expect(hasLightmapUv(mesh)).toBe(true);

    const render = editableMeshToRenderData(mesh);
    expect(render.geometry.getAttribute('uv1')).toBeDefined();
    expect(render.geometry.getAttribute('uv1').count).toBe(render.geometry.getAttribute('position').count);
  });

  it('groups selected objects into a reusable prefab hierarchy', () => {
    const document = createEmptyDocument();
    const first = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    const second = commitMeshObject(document, buildBox({ width: 2, height: 1, depth: 1 }));
    document.objects.get(first.objectId)!.transform.position.x = 2;
    const groupId = groupObjects(document, [first.objectId, second.objectId]);
    const group = document.objects.get(groupId)!;

    expect(group.metadata.prefab).toBe('true');
    expect(group.childIds).toEqual([first.objectId, second.objectId]);
    expect(document.rootObjectIds).toEqual([groupId]);
    expect(document.objects.get(first.objectId)?.parentId).toBe(groupId);
    expect(document.objects.get(second.objectId)?.parentId).toBe(groupId);

    group.transform.position.x = 5;
    const restored = ungroupObject(document, groupId);
    expect(restored).toEqual([first.objectId, second.objectId]);
    expect(document.objects.has(groupId)).toBe(false);
    expect(document.rootObjectIds).toEqual([first.objectId, second.objectId]);
    expect(document.objects.get(first.objectId)?.transform.position.x).toBeCloseTo(7);
    expect(document.objects.get(second.objectId)?.transform.position.x).toBeCloseTo(5);
  });

  it('creates a valid reduced convex collider and a linked mirror', () => {
    const document = createEmptyDocument();
    const source = commitMeshObject(document, buildBox({ width: 2, height: 3, depth: 4 }));

    const colliderId = generateConvexCollider(document, source.objectId);
    const collider = document.objects.get(colliderId)!;
    const colliderMesh = document.meshes.get(collider.meshId!)!;
    expect(collider.metadata.collision).toBe('convex');
    expect(colliderMesh.vertices.size).toBe(8);
    expect(colliderMesh.faces.size).toBe(12);

    const mirrorId = createMirroredInstance(document, source.objectId, 'x');
    const mirror = document.objects.get(mirrorId)!;
    expect(mirror.meshId).toBe(source.meshId);
    expect(mirror.transform.scale.x).toBe(-1);
    expect(mirror.metadata.linkedInstance).toBe('true');
  });

  it('creates linked radial duplicates around any selected axis', () => {
    const document = createEmptyDocument();
    const source = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));

    const ids = createRadialInstances(document, source.objectId, 'z', 4);
    expect(ids).toHaveLength(3);
    expect(document.objects.get(ids[0]!)?.meshId).toBe(source.meshId);
    expect(document.objects.get(ids[0]!)?.transform.rotation.z).toBeCloseTo(Math.PI / 2);
    expect(document.objects.get(ids[2]!)?.transform.rotation.z).toBeCloseTo(Math.PI * 1.5);
    expect(document.objects.get(ids[1]!)?.metadata).toMatchObject({
      linkedInstance: 'true',
      radialAxis: 'z',
      radialCount: '4',
    });
  });

  it('joins transformed objects into one world-aligned level chunk', () => {
    const document = createEmptyDocument();
    const first = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    const second = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    document.objects.get(second.objectId)!.transform.position.x = 3;

    const joinedId = joinMeshObjects(document, [first.objectId, second.objectId]);
    const joined = document.objects.get(joinedId)!;
    const mesh = document.meshes.get(joined.meshId!)!;
    const xs = [...mesh.vertices.values()].map((vertex) => vertex.position.x);

    expect(document.objects.size).toBe(1);
    expect(mesh.vertices.size).toBe(16);
    expect(mesh.faces.size).toBe(12);
    expect(Math.min(...xs)).toBeCloseTo(-0.5);
    expect(Math.max(...xs)).toBeCloseTo(3.5);
  });

  it('centres an origin without moving the visible mesh in world space', () => {
    const document = createEmptyDocument();
    const source = commitMeshObject(document, buildBox({ width: 2, height: 2, depth: 2, centered: false }));
    const object = document.objects.get(source.objectId)!;
    object.transform.position.x = 5;

    centreObjectOrigin(document, source.objectId);
    const mesh = document.meshes.get(source.meshId)!;
    const localXs = [...mesh.vertices.values()].map((vertex) => vertex.position.x);
    const worldXs = localXs.map((x) => x + object.transform.position.x);

    expect(Math.min(...localXs)).toBeCloseTo(-1);
    expect(Math.max(...localXs)).toBeCloseTo(1);
    expect(Math.min(...worldXs)).toBeCloseTo(5);
    expect(Math.max(...worldXs)).toBeCloseTo(7);
  });

  it('separates selected faces into a valid independent object', () => {
    const document = createEmptyDocument();
    const source = commitMeshObject(document, buildBox({ width: 2, height: 2, depth: 2 }));
    const sourceObject = document.objects.get(source.objectId)!;
    sourceObject.transform.position.z = 4;
    const sourceMesh = document.meshes.get(source.meshId)!;
    const faceId = [...sourceMesh.faces.keys()][0]!;

    const separatedId = separateFacesToObject(document, source.objectId, [faceId]);
    const separated = document.objects.get(separatedId)!;
    const separatedMesh = document.meshes.get(separated.meshId!)!;

    expect(sourceMesh.faces.size).toBe(5);
    expect(separatedMesh.faces.size).toBe(1);
    expect(separated.transform).toEqual(sourceObject.transform);
    expect(validateMeshFull(sourceMesh).issues.some((issue) => issue.severity === 'error')).toBe(false);
    expect(validateMeshFull(separatedMesh).issues.some((issue) => issue.severity === 'error')).toBe(false);
  });

  it('turns selected quads into logical triangles', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const faceId = [...mesh.faces.keys()][0]!;
    const result = triangulateFaces(mesh, [faceId]);

    expect(result.ok).toBe(true);
    expect(mesh.faces.size).toBe(7);
    expect(result.change.recommendedSelection.faceIds).toHaveLength(2);
    expect(validateMeshFull(mesh).issues.some((issue) => issue.severity === 'error')).toBe(false);
  });

  it('bridges two boundary rings into a closed quad strip', () => {
    const builder = new MeshBuilder('Bridge Test', true);
    const bottom = [
      builder.vertex(v3(-1, 0, -1)), builder.vertex(v3(1, 0, -1)),
      builder.vertex(v3(1, 0, 1)), builder.vertex(v3(-1, 0, 1)),
    ];
    const top = [
      builder.vertex(v3(-1, 2, -1)), builder.vertex(v3(1, 2, -1)),
      builder.vertex(v3(1, 2, 1)), builder.vertex(v3(-1, 2, 1)),
    ];
    builder.quad(bottom[0]!, bottom[1]!, bottom[2]!, bottom[3]!);
    builder.quad(top[0]!, top[3]!, top[2]!, top[1]!);
    const mesh = builder.build();

    const result = bridgeEdgeLoops(mesh, [...mesh.edges.keys()]);
    const stats = getMeshStats(mesh);
    expect(result.ok).toBe(true);
    expect(stats.faces).toBe(6);
    expect(stats.quads).toBe(6);
    expect(stats.boundaryEdges).toBe(0);
    expect(validateMeshFull(mesh).issues.some((issue) => issue.severity === 'error')).toBe(false);
  });

  it('welds near-duplicate seam vertices into shared topology', () => {
    const builder = new MeshBuilder('Weld Test', true);
    const a = builder.vertex(v3(0, 0, 0));
    const b = builder.vertex(v3(1, 0, 0));
    const c = builder.vertex(v3(1, 1, 0));
    const a2 = builder.vertex(v3(0.0001, 0, 0));
    const c2 = builder.vertex(v3(1.0001, 1, 0));
    const d = builder.vertex(v3(0, 1, 0));
    builder.tri(a, b, c);
    builder.tri(a2, c2, d);
    const mesh = builder.build();

    const result = weldVerticesByDistance(mesh, [...mesh.vertices.keys()], 0.001);
    const stats = getMeshStats(mesh);
    expect(result.ok).toBe(true);
    expect(stats.verts).toBe(4);
    expect(stats.edges).toBe(5);
    expect(stats.boundaryEdges).toBe(4);
    expect(validateMeshFull(mesh).issues.some((issue) => issue.severity === 'error')).toBe(false);
  });
});
