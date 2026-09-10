import {
  addObjectToDocument,
  commitMeshObject,
  createSceneObject,
  duplicateObject,
  removeObject,
} from '@/core/document/ModelDocument';
import type { ModelDocument, ObjectId, SceneObject } from '@/core/document/types';
import { isGroupObject } from '@/core/document/SceneObjectKind';
import {
  getObjectWorldMatrix,
  matrixFromTransform,
  matrixToTransform,
  topmostObjectIds,
} from '@/core/editor/Hierarchy';
import { cloneTransform } from '@/core/math/Transform';
import { v3 } from '@/core/math/Vec3';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import { faceCornerIds, faceVertexIds } from '@/core/mesh/EditableMesh';
import type { EditableMesh, UvLayerId } from '@/core/mesh/types';
import { createUvLayer, unwrapUvAuto } from '@/core/uv/UvOperations';
import { deleteFaces } from '@/core/mesh/ops/draw';
import { Matrix4, Vector3 } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import {
  readCurveOperation,
  serializeCurveOperation,
} from '@/core/curves/CurveOperation';
import { subVec3 } from '@/core/math/Vec3';

export const LIGHTMAP_UV_NAME = 'Lightmap UV';

/** Add or rebuild a packed secondary UV channel suitable for baked lighting. */
export function generateLightmapUv(mesh: EditableMesh): UvLayerId {
  const existing = [...mesh.uvLayers.values()].find((layer) => layer.name === LIGHTMAP_UV_NAME);
  const layerId = existing?.id ?? createUvLayer(mesh, LIGHTMAP_UV_NAME);
  unwrapUvAuto(mesh, [...mesh.faces.keys()], layerId, 0.02);
  return layerId;
}

export function hasLightmapUv(mesh: EditableMesh): boolean {
  return [...mesh.uvLayers.values()].some((layer) => layer.name === LIGHTMAP_UV_NAME);
}

/** Add a generic transform marker that engines can interpret as a joint or socket. */
export function createRigMarker(
  document: ModelDocument,
  parentObjectId: ObjectId,
  role: 'joint' | 'socket',
  name?: string,
): ObjectId {
  const parent = document.objects.get(parentObjectId);
  if (!parent) throw new Error('Select an object before adding a rig marker');
  const existing = [...document.objects.values()].filter(
    (object) => object.metadata.gameRole === role,
  ).length;
  const marker = createSceneObject(
    name?.trim() || `${role === 'joint' ? 'Joint' : 'Socket'} ${existing + 1}`,
    null,
    [],
    { kind: 'empty' },
  );
  marker.parentId = parent.id;
  marker.metadata.gameRole = role;
  marker.metadata.rigParent = parent.id;
  marker.metadata.exportTransform = 'true';
  addObjectToDocument(document, marker);
  document.dirty = true;
  return marker.id;
}

/** Create a lightweight box collider aligned to the selected object's local bounds. */
export function generateBoxCollider(document: ModelDocument, sourceObjectId: ObjectId): ObjectId {
  const source = document.objects.get(sourceObjectId);
  const sourceMesh = source?.meshId ? document.meshes.get(source.meshId) : null;
  if (!source || !sourceMesh || sourceMesh.vertices.size === 0) {
    throw new Error('Select a mesh object before generating collision');
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const vertex of sourceMesh.vertices.values()) {
    minX = Math.min(minX, vertex.position.x);
    minY = Math.min(minY, vertex.position.y);
    minZ = Math.min(minZ, vertex.position.z);
    maxX = Math.max(maxX, vertex.position.x);
    maxY = Math.max(maxY, vertex.position.y);
    maxZ = Math.max(maxZ, vertex.position.z);
  }
  const mesh = buildBox({
    width: Math.max(0.0001, maxX - minX),
    height: Math.max(0.0001, maxY - minY),
    depth: Math.max(0.0001, maxZ - minZ),
    name: `UCX_${source.name}`,
    centered: true,
  });
  const centre = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
  };
  for (const vertex of mesh.vertices.values()) {
    vertex.position.x += centre.x;
    vertex.position.y += centre.y;
    vertex.position.z += centre.z;
  }
  const committed = commitMeshObject(document, mesh, {
    name: `UCX_${source.name}`,
    materialId: source.materialSlotIds[0],
  });
  const collider = document.objects.get(committed.objectId)!;
  collider.transform = cloneTransform(source.transform);
  collider.kind = 'collision';
  collider.metadata.gameRole = 'collision';
  collider.metadata.collision = 'box';
  collider.metadata.collisionFor = source.id;
  source.metadata.collision = 'box';
  source.metadata.colliderObject = collider.id;
  document.dirty = true;
  return collider.id;
}

/** Create an exact, independently editable collision copy of the source mesh. */
export function generateMeshCollider(document: ModelDocument, sourceObjectId: ObjectId): ObjectId {
  const source = document.objects.get(sourceObjectId);
  if (!source?.meshId) throw new Error('Select a mesh object before generating collision');
  const id = duplicateObject(document, sourceObjectId, true);
  const collider = document.objects.get(id)!;
  collider.name = `UCX_${source.name}`;
  collider.kind = 'collision';
  collider.metadata.gameRole = 'collision';
  collider.metadata.collision = 'mesh';
  collider.metadata.collisionFor = source.id;
  source.metadata.collision = 'mesh';
  source.metadata.colliderObject = collider.id;
  document.dirty = true;
  return id;
}

/** Create a reduced convex hull collider from the source object's vertices. */
export function generateConvexCollider(document: ModelDocument, sourceObjectId: ObjectId): ObjectId {
  const source = document.objects.get(sourceObjectId);
  const sourceMesh = source?.meshId ? document.meshes.get(source.meshId) : null;
  if (!source || !sourceMesh || sourceMesh.vertices.size < 4) {
    throw new Error('Convex collision requires a mesh with at least four vertices');
  }

  const geometry = new ConvexGeometry(
    [...sourceMesh.vertices.values()].map(
      (vertex) => new Vector3(vertex.position.x, vertex.position.y, vertex.position.z),
    ),
  );
  const positions = geometry.getAttribute('position');
  if (!positions || positions.count < 3) {
    geometry.dispose();
    throw new Error('Could not build a convex hull from this mesh');
  }
  const builder = new MeshBuilder(`UCX_${source.name}`, true);
  const vertices = new Map<string, ReturnType<typeof builder.vertex>>();
  const getVertex = (index: number) => {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const key = `${x.toFixed(7)},${y.toFixed(7)},${z.toFixed(7)}`;
    let id = vertices.get(key);
    if (!id) {
      id = builder.vertex(v3(x, y, z));
      vertices.set(key, id);
    }
    return id;
  };
  for (let index = 0; index < positions.count; index += 3) {
    builder.tri(getVertex(index), getVertex(index + 1), getVertex(index + 2));
  }
  const mesh = builder.build();
  geometry.dispose();
  const committed = commitMeshObject(document, mesh, {
    name: `UCX_${source.name}`,
    materialId: source.materialSlotIds[0],
  });
  const collider = document.objects.get(committed.objectId)!;
  collider.transform = cloneTransform(source.transform);
  collider.kind = 'collision';
  collider.metadata.gameRole = 'collision';
  collider.metadata.collision = 'convex';
  collider.metadata.collisionFor = source.id;
  source.metadata.collision = 'convex';
  source.metadata.colliderObject = collider.id;
  document.dirty = true;
  return collider.id;
}

/** Group objects under an identity transform while preserving world transforms. */
export function groupObjects(document: ModelDocument, objectIds: ObjectId[], name = 'Group'): ObjectId {
  const selected = topmostObjectIds(document, objectIds)
    .map((id) => document.objects.get(id))
    .filter((object): object is SceneObject => !!object);
  if (!selected.length) throw new Error('Select at least one object to group');
  const worldTransforms = new Map(
    selected.map((object) => [object.id, getObjectWorldMatrix(document, object.id)]),
  );
  const commonParent = selected.every((object) => object.parentId === selected[0]!.parentId)
    ? selected[0]!.parentId
    : null;
  const group = createSceneObject(name, null, [], { kind: 'group' });
  group.parentId = commonParent;
  addObjectToDocument(document, group);
  const inverseGroupWorld = getObjectWorldMatrix(document, group.id).invert();

  for (const object of selected) {
    if (object.id === group.id) continue;
    if (object.parentId) {
      const parent = document.objects.get(object.parentId);
      if (parent) parent.childIds = parent.childIds.filter((id) => id !== object.id);
    } else {
      document.rootObjectIds = document.rootObjectIds.filter((id) => id !== object.id);
    }
    object.parentId = group.id;
    object.transform = matrixToTransform(
      inverseGroupWorld.clone().multiply(worldTransforms.get(object.id)!),
    );
    if (!group.childIds.includes(object.id)) group.childIds.push(object.id);
  }
  document.dirty = true;
  return group.id;
}

/** Remove a group container without deleting its children. */
export function ungroupObject(document: ModelDocument, groupId: ObjectId): ObjectId[] {
  const group = document.objects.get(groupId);
  if (!group || !isGroupObject(group) || group.childIds.length === 0) {
    throw new Error('Select a group with children');
  }
  const parentId = group.parentId;
  const children = [...group.childIds];
  const groupWorld = getObjectWorldMatrix(document, group.id);
  const inverseParentWorld = parentId
    ? getObjectWorldMatrix(document, parentId).invert()
    : new Matrix4();
  for (const childId of children) {
    const child = document.objects.get(childId);
    if (!child) continue;
    const childWorld = groupWorld.clone().multiply(matrixFromTransform(child.transform));
    child.parentId = parentId;
    child.transform = matrixToTransform(inverseParentWorld.clone().multiply(childWorld));
    if (parentId) {
      const parent = document.objects.get(parentId);
      if (parent && !parent.childIds.includes(childId)) parent.childIds.push(childId);
    } else if (!document.rootObjectIds.includes(childId)) {
      document.rootObjectIds.push(childId);
    }
  }
  if (parentId) {
    const parent = document.objects.get(parentId);
    if (parent) parent.childIds = parent.childIds.filter((id) => id !== groupId);
  } else {
    document.rootObjectIds = document.rootObjectIds.filter((id) => id !== groupId);
  }
  document.objects.delete(groupId);
  document.dirty = true;
  return children;
}

/** Create a linked mesh instance mirrored around its object origin. */
export function createMirroredInstance(
  document: ModelDocument,
  sourceObjectId: ObjectId,
  axis: 'x' | 'y' | 'z' = 'x',
): ObjectId {
  const source = document.objects.get(sourceObjectId);
  if (!source?.meshId) throw new Error('Select a mesh object to mirror');
  const id = duplicateObject(document, sourceObjectId, false);
  const mirror = document.objects.get(id)!;
  mirror.name = `${source.name}_Mirror${axis.toUpperCase()}`;
  mirror.transform.scale[axis] *= -1;
  mirror.metadata.prefabSource = source.id;
  mirror.metadata.linkedInstance = 'true';
  document.dirty = true;
  return id;
}

/** Create linked radial copies around the source object's local origin. */
export function createRadialInstances(
  document: ModelDocument,
  sourceObjectId: ObjectId,
  axis: 'x' | 'y' | 'z' = 'y',
  count = 8,
): ObjectId[] {
  const source = document.objects.get(sourceObjectId);
  if (!source?.meshId) throw new Error('Select a mesh object for radial duplication');
  const total = Math.max(2, Math.min(32, Math.round(count)));
  const ids: ObjectId[] = [];
  for (let index = 1; index < total; index++) {
    const id = duplicateObject(document, sourceObjectId, false);
    const copy = document.objects.get(id)!;
    copy.name = `${source.name}_Radial${index + 1}`;
    copy.transform.rotation[axis] += (index / total) * Math.PI * 2;
    copy.metadata.prefabSource = source.id;
    copy.metadata.linkedInstance = 'true';
    copy.metadata.radialAxis = axis;
    copy.metadata.radialIndex = String(index);
    copy.metadata.radialCount = String(total);
    ids.push(id);
  }
  document.dirty = true;
  return ids;
}

/** Join selected scene meshes into one world-aligned level chunk. */
export function joinMeshObjects(document: ModelDocument, objectIds: ObjectId[], name = 'Joined Mesh'): ObjectId {
  const sources = [...new Set(objectIds)]
    .map((id) => document.objects.get(id))
    .filter((object): object is SceneObject => !!object?.meshId && document.meshes.has(object.meshId));
  if (sources.length < 2) throw new Error('Select at least two mesh objects to join');

  const materialIds: string[] = [];
  for (const object of sources) {
    for (const materialId of object.materialSlotIds) {
      if (!materialIds.includes(materialId)) materialIds.push(materialId);
    }
  }
  const fallbackMaterial = [...document.materials.keys()][0];
  if (!materialIds.length && fallbackMaterial) materialIds.push(fallbackMaterial);

  const builder = new MeshBuilder(name, true);
  builder.setMaterialSlotCount(Math.max(1, materialIds.length));
  for (const object of sources) {
    const mesh = document.meshes.get(object.meshId!)!;
    const world = getObjectWorldMatrix(document, object.id);
    const reverseWinding = world.determinant() < 0;
    const vertexMap = new Map<string, ReturnType<typeof builder.vertex>>();
    for (const vertex of mesh.vertices.values()) {
      const point = new Vector3(vertex.position.x, vertex.position.y, vertex.position.z).applyMatrix4(world);
      vertexMap.set(vertex.id, builder.vertex(v3(point.x, point.y, point.z)));
    }
    for (const face of mesh.faces.values()) {
      const sourceVertices = faceVertexIds(mesh, face.id);
      const cornerIds = faceCornerIds(mesh, face.id);
      const sourceUvs = cornerIds.map((cornerId) => {
        const corner = mesh.faceCorners.get(cornerId)!;
        return mesh.defaultUvLayerId
          ? (corner.uvs.get(mesh.defaultUvLayerId) ?? { x: 0, y: 0 })
          : { x: 0, y: 0 };
      });
      const sourceMaterial = object.materialSlotIds[face.materialSlot] ?? materialIds[0];
      const materialSlot = Math.max(0, sourceMaterial ? materialIds.indexOf(sourceMaterial) : 0);
      const vertices = sourceVertices.map((id) => vertexMap.get(id)!);
      builder.ngon(
        reverseWinding ? [...vertices].reverse() : vertices,
        reverseWinding ? [...sourceUvs].reverse() : sourceUvs,
        materialSlot,
      );
    }
  }

  const mesh = builder.build();
  const committed = commitMeshObject(document, mesh, { name, materialId: materialIds[0] });
  const joined = document.objects.get(committed.objectId)!;
  joined.materialSlotIds = materialIds;
  joined.metadata.gameRole = 'geometry';
  joined.metadata.joinedSources = sources.map((source) => source.name).join(', ');
  for (const source of sources) removeObject(document, source.id, true);
  document.dirty = true;
  return joined.id;
}

export type CombineMeshesResult =
  | { ok: true; objectId: ObjectId; sourceCount: number }
  | { ok: false; message: string };

/** Mesh-bearing objects at the document root (typical curve/primitive pieces). */
export function rootMeshObjectIds(document: ModelDocument): ObjectId[] {
  return document.rootObjectIds.filter((id) => {
    const object = document.objects.get(id);
    return !!object?.meshId && document.meshes.has(object.meshId);
  });
}

/**
 * Join mesh objects into one combined mesh.
 * Uses the current selection when 2+ mesh objects are selected; otherwise joins all root mesh objects.
 */
export function combineMeshObjects(
  document: ModelDocument,
  selectedIds: Iterable<ObjectId>,
  options: { name?: string; allowCombineAll?: boolean } = {},
): CombineMeshesResult {
  const allowCombineAll = options.allowCombineAll !== false;
  let ids = [...new Set(selectedIds)].filter((id) => {
    const object = document.objects.get(id);
    return !!object?.meshId && document.meshes.has(object.meshId);
  });
  if (ids.length < 2 && allowCombineAll) {
    ids = rootMeshObjectIds(document);
  }
  if (ids.length < 2) {
    return {
      ok: false,
      message: 'Need at least two mesh objects. Shift+click to select multiple, or draw more pieces first.',
    };
  }
  try {
    const objectId = joinMeshObjects(document, ids, options.name ?? 'Combined Mesh');
    return { ok: true, objectId, sourceCount: ids.length };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Combine failed',
    };
  }
}

/** Move the object origin to its local bounds centre without moving visible geometry. */
export function centreObjectOrigin(document: ModelDocument, objectId: ObjectId): void {
  const object = document.objects.get(objectId);
  const mesh = object?.meshId ? document.meshes.get(object.meshId) : null;
  if (!object || !mesh || mesh.vertices.size === 0) throw new Error('Select a mesh object');
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const vertex of mesh.vertices.values()) {
    minX = Math.min(minX, vertex.position.x); minY = Math.min(minY, vertex.position.y); minZ = Math.min(minZ, vertex.position.z);
    maxX = Math.max(maxX, vertex.position.x); maxY = Math.max(maxY, vertex.position.y); maxZ = Math.max(maxZ, vertex.position.z);
  }
  const centre = v3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  for (const vertex of mesh.vertices.values()) {
    vertex.position.x -= centre.x;
    vertex.position.y -= centre.y;
    vertex.position.z -= centre.z;
  }
  mesh.geometryVersion += 1;
  mesh.dirty.positions = true;
  mesh.dirty.bounds = true;

  const operation = readCurveOperation(object.metadata.curveOperation);
  if (operation) {
    object.metadata.curveOperation = serializeCurveOperation({
      ...operation,
      points: operation.points.map((point) => subVec3(point, centre)),
      handlesIn: operation.handlesIn.map((point) => subVec3(point, centre)),
      handlesOut: operation.handlesOut.map((point) => subVec3(point, centre)),
    });
  }

  const offset = new Matrix4().makeTranslation(centre.x, centre.y, centre.z);
  object.transform = matrixToTransform(matrixFromTransform(object.transform).multiply(offset));
  const inverseOffset = new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z);
  for (const childId of object.childIds) {
    const child = document.objects.get(childId);
    if (child) child.transform = matrixToTransform(inverseOffset.clone().multiply(matrixFromTransform(child.transform)));
  }
  document.dirty = true;
}

/** Detach selected faces into a new object while retaining materials and object placement. */
export function separateFacesToObject(
  document: ModelDocument,
  sourceObjectId: ObjectId,
  faceIds: string[],
  name = 'Separated Mesh',
): ObjectId {
  const source = document.objects.get(sourceObjectId);
  const sourceMesh = source?.meshId ? document.meshes.get(source.meshId) : null;
  if (!source || !sourceMesh) throw new Error('Select faces on a mesh object');
  const selected = [...new Set(faceIds)].filter((id) => sourceMesh.faces.has(id));
  if (!selected.length) throw new Error('Select at least one face to separate');
  if (selected.length === sourceMesh.faces.size) throw new Error('Keep at least one face in the source mesh');

  const builder = new MeshBuilder(name, true);
  builder.setMaterialSlotCount(sourceMesh.materialSlotCount);
  const vertexMap = new Map<string, ReturnType<typeof builder.vertex>>();
  for (const faceId of selected) {
    const face = sourceMesh.faces.get(faceId)!;
    const oldVertices = faceVertexIds(sourceMesh, faceId);
    const newVertices = oldVertices.map((vertexId) => {
      let mapped = vertexMap.get(vertexId);
      if (!mapped) {
        const point = sourceMesh.vertices.get(vertexId)!.position;
        mapped = builder.vertex(v3(point.x, point.y, point.z));
        vertexMap.set(vertexId, mapped);
      }
      return mapped;
    });
    const uvs = faceCornerIds(sourceMesh, faceId).map((cornerId) => {
      const corner = sourceMesh.faceCorners.get(cornerId)!;
      return sourceMesh.defaultUvLayerId
        ? (corner.uvs.get(sourceMesh.defaultUvLayerId) ?? { x: 0, y: 0 })
        : { x: 0, y: 0 };
    });
    builder.ngon(newVertices, uvs, face.materialSlot);
  }
  const separatedMesh = builder.build();
  const committed = commitMeshObject(document, separatedMesh, {
    name,
    materialId: source.materialSlotIds[0],
  });
  const separated = document.objects.get(committed.objectId)!;
  separated.materialSlotIds = [...source.materialSlotIds];
  separated.transform = cloneTransform(source.transform);
  separated.metadata = { ...source.metadata, separatedFrom: source.id };
  const deletion = deleteFaces(sourceMesh, selected);
  if (!deletion.ok) throw new Error(deletion.error?.message ?? 'Failed to separate faces');
  document.dirty = true;
  return separated.id;
}
