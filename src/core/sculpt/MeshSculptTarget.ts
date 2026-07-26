import {
  addVec3,
  normalizeVec3,
  subVec3,
  type Vec3,
} from '@/core/math/Vec3';
import {
  inverseTransformPointApprox,
  transformPoint,
  type Transform,
} from '@/core/math/Transform';
import { computeFaceNormal } from '@/core/mesh/Normals';
import type { EditableMesh } from '@/core/mesh/types';
import type { ModelDocument, SceneObject } from '@/core/document/types';
import { MeshBvh } from '@/core/spatial/MeshBvh';

export type SculptRayHit = {
  object: SceneObject;
  mesh: EditableMesh;
  localPosition: Vec3;
  worldPosition: Vec3;
  localNormal: Vec3;
  worldNormal: Vec3;
};

const bvhCache = new Map<string, MeshBvh>();

function bvhForMesh(mesh: EditableMesh): MeshBvh {
  let bvh = bvhCache.get(mesh.id);
  if (!bvh) {
    bvh = new MeshBvh();
    bvhCache.set(mesh.id, bvh);
  }
  return bvh;
}

export function transformDirection(dir: Vec3, transform: Transform): Vec3 {
  const origin = transformPoint({ x: 0, y: 0, z: 0 }, transform);
  const tip = transformPoint(dir, transform);
  return normalizeVec3(subVec3(tip, origin));
}

export function raycastSculptTarget(
  document: ModelDocument,
  objectId: string | null,
  rayOrigin: Vec3,
  rayDirection: Vec3,
): SculptRayHit | null {
  const candidates: SceneObject[] = [];
  if (objectId) {
    const selected = document.objects.get(objectId);
    if (selected?.meshId && selected.visible && selected.metadata.terrain !== 'true') {
      candidates.push(selected);
    }
  }
  if (!candidates.length) {
    for (const object of document.objects.values()) {
      if (!object.meshId || !object.visible || object.metadata.terrain === 'true') continue;
      candidates.push(object);
    }
  }

  let best: SculptRayHit | null = null;
  for (const object of candidates) {
    const mesh = document.meshes.get(object.meshId!);
    if (!mesh) continue;
    const localOrigin = inverseTransformPointApprox(rayOrigin, object.transform);
    const localRayPoint = inverseTransformPointApprox(
      addVec3(rayOrigin, rayDirection),
      object.transform,
    );
    const localDirection = normalizeVec3(subVec3(localRayPoint, localOrigin));
    const hit = bvhForMesh(mesh).raycast(mesh, localOrigin, localDirection);
    if (!hit) continue;
    const localNormal = computeFaceNormal(mesh, hit.faceId);
    const worldPosition = transformPoint(hit.position, object.transform);
    const worldNormal = transformDirection(localNormal, object.transform);
    const distance = Math.hypot(
      worldPosition.x - rayOrigin.x,
      worldPosition.y - rayOrigin.y,
      worldPosition.z - rayOrigin.z,
    );
    if (!best || distance < Math.hypot(
      best.worldPosition.x - rayOrigin.x,
      best.worldPosition.y - rayOrigin.y,
      best.worldPosition.z - rayOrigin.z,
    )) {
      best = {
        object,
        mesh,
        localPosition: hit.position,
        worldPosition,
        localNormal,
        worldNormal,
      };
    }
  }
  return best;
}

export function sculptableObjects(document: ModelDocument): SceneObject[] {
  return [...document.objects.values()].filter(
    (object) => object.meshId && object.visible && object.metadata.terrain !== 'true',
  );
}
