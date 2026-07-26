import type { ModelDocument } from '@/core/document/types';
import { collectDescendantIds, getObjectWorldTransform, isGroupObject } from '@/core/editor/Hierarchy';
import { transformPoint } from '@/core/math/Transform';
import { addVec3, scaleVec3, v3, type Vec3 } from '@/core/math/Vec3';
import { faceVertexIds, getEdgeVertices } from '@/core/mesh/EditableMesh';
import type { SelectionState } from '@/core/selection/SelectionManager';
import type { TransformPivotMode } from './types';
import { gatherTargetVertexIds } from './Targets';

export function computePivot(
  doc: ModelDocument,
  selection: SelectionState,
  mode: TransformPivotMode,
): Vec3 {
  if (selection.mode === 'object') {
    return objectPivot(doc, selection, mode);
  }
  return componentPivot(doc, selection, mode);
}

function collectObjectWorldPoints(doc: ModelDocument, objectId: string): Vec3[] {
  const object = doc.objects.get(objectId);
  if (!object) return [];
  const worldXform = getObjectWorldTransform(doc, objectId);

  if (isGroupObject(object)) {
    const points: Vec3[] = [];
    for (const descId of collectDescendantIds(doc, objectId)) {
      if (descId === objectId) continue;
      points.push(...collectObjectWorldPoints(doc, descId));
    }
    if (points.length) return points;
    return [{ ...worldXform.position }];
  }

  if (!object.meshId) return [{ ...worldXform.position }];
  const mesh = doc.meshes.get(object.meshId);
  if (!mesh || !mesh.vertices.size) return [{ ...worldXform.position }];
  const points: Vec3[] = [];
  for (const vertex of mesh.vertices.values()) {
    points.push(transformPoint(vertex.position, worldXform));
  }
  return points;
}

function objectPivot(doc: ModelDocument, selection: SelectionState, mode: TransformPivotMode): Vec3 {
  const ids = [...selection.selectedObjectIds];
  const objects = ids.map((id) => doc.objects.get(id)).filter(Boolean);
  if (!objects.length) return v3();

  // Object origin = world-space transform origin (respects parent groups).
  if (mode === 'object-origin' || mode === 'active') {
    const activeId = selection.activeObjectId ?? objects[objects.length - 1]!.id;
    return { ...getObjectWorldTransform(doc, activeId).position };
  }

  // Median / Bounds: use mesh geometry in world space (groups → descendant meshes).
  const worldPoints: Vec3[] = [];
  for (const object of objects) {
    if (!object) continue;
    worldPoints.push(...collectObjectWorldPoints(doc, object.id));
  }
  if (!worldPoints.length) return v3();
  if (mode === 'bounding-box') return boundsCentre(worldPoints);
  return average(worldPoints);
}

function componentPivot(doc: ModelDocument, selection: SelectionState, mode: TransformPivotMode): Vec3 {
  const objectId = selection.activeObjectId;
  const object = objectId ? doc.objects.get(objectId) : null;
  const mesh = object?.meshId ? doc.meshes.get(object.meshId) : null;
  if (!object || !mesh) return v3();
  const worldXform = getObjectWorldTransform(doc, object.id);

  if (mode === 'active') {
    if (selection.mode === 'vertex' && selection.activeVertexId) {
      const p = mesh.vertices.get(selection.activeVertexId)?.position;
      if (p) return transformPoint(p, worldXform);
    }
    if (selection.mode === 'edge' && selection.activeEdgeId) {
      const pair = getEdgeVertices(mesh, selection.activeEdgeId);
      if (pair) {
        const a = transformPoint(mesh.vertices.get(pair[0])!.position, worldXform);
        const b = transformPoint(mesh.vertices.get(pair[1])!.position, worldXform);
        return scaleVec3(addVec3(a, b), 0.5);
      }
    }
    if (selection.mode === 'face' && selection.activeFaceId) {
      const ids = faceVertexIds(mesh, selection.activeFaceId);
      const pts = ids.map((id) => transformPoint(mesh.vertices.get(id)!.position, worldXform));
      return average(pts);
    }
  }

  const target = gatherTargetVertexIds(doc, selection);
  if (!target) return { ...worldXform.position };
  const pts = [...target.vertexIds].map((id) =>
    transformPoint(mesh.vertices.get(id)!.position, worldXform),
  );
  // Object Origin is meaningful in object mode, but in edit/component modes
  // Blender-style manipulation belongs at the selected geometry. Treat the
  // default object-origin preference as the selection median here so switching
  // Vertex / Edge / Face mode never leaves the gizmo behind at the mesh origin.
  if (mode === 'bounding-box') return boundsCentre(pts);
  return average(pts);
}

function average(pts: Vec3[]): Vec3 {
  if (!pts.length) return v3();
  const sum = pts.reduce((a, p) => addVec3(a, p), v3());
  return scaleVec3(sum, 1 / pts.length);
}

function boundsCentre(pts: Vec3[]): Vec3 {
  if (!pts.length) return v3();
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); maxZ = Math.max(maxZ, p.z);
  }
  return v3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
}
