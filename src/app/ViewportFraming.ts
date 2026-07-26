import type { ModelDocument, ObjectId } from '@/core/document/types';
import { transformPoint } from '@/core/math/Transform';
import type { Vec3 } from '@/core/math/Vec3';
import type { SelectionState } from '@/core/selection/SelectionManager';
import { gatherTargetVertexIds } from '@/core/transform/Targets';

export type ViewBounds = { center: Vec3; radius: number };

export function documentViewPoints(
  document: ModelDocument,
  selection?: SelectionState,
): Vec3[] {
  if (selection && selection.mode !== 'object') {
    const target = gatherTargetVertexIds(document, selection);
    const object = target ? document.objects.get(target.objectId) : null;
    const mesh = target ? document.meshes.get(target.meshId) : null;
    if (target && object && mesh) {
      return [...target.vertexIds]
        .map((id) => mesh.vertices.get(id))
        .filter((vertex) => vertex != null)
        .map((vertex) => transformPoint(vertex.position, object.transform));
    }
  }

  const ids: Iterable<ObjectId> = selection
    ? selection.selectedObjectIds
    : [...document.objects.values()]
        .filter((object) => object.visible)
        .map((object) => object.id);
  const points: Vec3[] = [];
  for (const id of ids) {
    const object = document.objects.get(id);
    if (!object || (!selection && !object.visible)) continue;
    const mesh = object.meshId ? document.meshes.get(object.meshId) : null;
    if (!mesh?.vertices.size) {
      points.push({ ...object.transform.position });
      continue;
    }
    for (const vertex of mesh.vertices.values()) {
      points.push(transformPoint(vertex.position, object.transform));
    }
  }
  return points;
}

export function boundsForView(points: readonly Vec3[]): ViewBounds | null {
  if (!points.length) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); minZ = Math.min(minZ, point.z);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); maxZ = Math.max(maxZ, point.z);
  }
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
  let radius = 0;
  for (const point of points) {
    radius = Math.max(radius, Math.hypot(point.x - center.x, point.y - center.y, point.z - center.z));
  }
  return { center, radius: Math.max(radius, 0.5) };
}

export function perspectiveFrameDistance(radius: number, verticalFovDegrees: number, aspect: number): number {
  const vertical = Math.max(1, Math.min(179, verticalFovDegrees)) * Math.PI / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(aspect, 1e-3));
  const limitingFov = Math.min(vertical, horizontal);
  return Math.max(0.5, radius) / Math.sin(limitingFov / 2) * 1.15;
}

export function orthographicFrameHeight(radius: number, aspect: number): number {
  return Math.max(1, radius * 2.3 / Math.min(1, Math.max(aspect, 1e-3)));
}
