import type { ModelDocument } from '@/core/document/types';
import { getObjectWorldTransform } from '@/core/editor/Hierarchy';
import { transformPoint } from '@/core/math/Transform';
import {
  crossVec3,
  normalizeVec3,
  subVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import { faceVertexIds, getEdgeVertices } from '@/core/mesh/EditableMesh';
import { computeFaceNormal } from '@/core/mesh/Normals';
import type { SelectionState } from '@/core/selection/SelectionManager';
import type { ViewId } from '@/workspace/types';
import { identityBasis, type OrientationBasis, type TransformOrientation } from './types';

export type CameraAxes = {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
};

export function buildOrientationBasis(
  doc: ModelDocument,
  selection: SelectionState,
  orientation: TransformOrientation,
  camera: CameraAxes | null,
  constraintUsesLocal: boolean,
): OrientationBasis {
  // Double-axis local override while Global is selected.
  if (constraintUsesLocal) {
    return localObjectBasis(doc, selection);
  }

  switch (orientation) {
    case 'local':
      return localObjectBasis(doc, selection);
    case 'view':
      return camera ? viewBasis(camera) : identityBasis();
    case 'normal':
      // Face/edge normal in edit mode; for objects this is the object's own axes.
      return normalBasis(doc, selection) ?? localObjectBasis(doc, selection);
    case 'custom':
    case 'global':
    default:
      return identityBasis();
  }
}

/** Object's own axes in world space (respects parent groups). */
function localObjectBasis(doc: ModelDocument, selection: SelectionState): OrientationBasis {
  const objectId = selection.activeObjectId ?? [...selection.selectedObjectIds][0];
  const object = objectId ? doc.objects.get(objectId) : null;
  if (!object) return identityBasis();
  const world = getObjectWorldTransform(doc, object.id);
  return basisFromEuler(world.rotation);
}

function basisFromEuler(r: Vec3): OrientationBasis {
  // Columns of rotation matrix from Euler XYZ (same as transformPoint / Three.js).
  const cx = Math.cos(r.x), sx = Math.sin(r.x);
  const cy = Math.cos(r.y), sy = Math.sin(r.y);
  const cz = Math.cos(r.z), sz = Math.sin(r.z);
  const x = normalizeVec3({
    x: cy * cz,
    y: sx * sy * cz + cx * sz,
    z: -cx * sy * cz + sx * sz,
  });
  const y = normalizeVec3({
    x: -cy * sz,
    y: -sx * sy * sz + cx * cz,
    z: cx * sy * sz + sx * cz,
  });
  const z = normalizeVec3({
    x: sy,
    y: -sx * cy,
    z: cx * cy,
  });
  return { x, y, z };
}

function viewBasis(camera: CameraAxes): OrientationBasis {
  const z = normalizeVec3(camera.forward);
  const y = normalizeVec3(camera.up);
  const x = normalizeVec3(crossVec3(y, z));
  const y2 = normalizeVec3(crossVec3(z, x));
  return { x, y: y2, z };
}

function normalBasis(doc: ModelDocument, selection: SelectionState): OrientationBasis | null {
  const objectId = selection.activeObjectId;
  const object = objectId ? doc.objects.get(objectId) : null;
  const mesh = object?.meshId ? doc.meshes.get(object.meshId) : null;
  if (!object || !mesh) return null;

  // Object mode: Normal = object local axes (same as Local).
  if (selection.mode === 'object') {
    return localObjectBasis(doc, selection);
  }

  const world = getObjectWorldTransform(doc, object.id);
  let normal = v3(0, 1, 0);
  let tangent = v3(1, 0, 0);

  if (selection.mode === 'face') {
    const faceId = selection.activeFaceId ?? [...selection.selectedFaceIds][0];
    if (!faceId) return null;
    const nLocal = computeFaceNormal(mesh, faceId);
    normal = normalizeVec3(rotateDirection(nLocal, world.rotation));
    const verts = faceVertexIds(mesh, faceId);
    if (verts.length >= 2) {
      const a = transformPoint(mesh.vertices.get(verts[0]!)!.position, world);
      const b = transformPoint(mesh.vertices.get(verts[1]!)!.position, world);
      tangent = normalizeVec3(subVec3(b, a));
    }
  } else if (selection.mode === 'edge') {
    const edgeId = selection.activeEdgeId ?? [...selection.selectedEdgeIds][0];
    if (!edgeId) return null;
    const pair = getEdgeVertices(mesh, edgeId);
    if (!pair) return null;
    const a = transformPoint(mesh.vertices.get(pair[0])!.position, world);
    const b = transformPoint(mesh.vertices.get(pair[1])!.position, world);
    const dir = normalizeVec3(subVec3(b, a));
    normal = dir;
    tangent =
      Math.abs(dir.y) < 0.9
        ? normalizeVec3(crossVec3(dir, v3(0, 1, 0)))
        : normalizeVec3(crossVec3(dir, v3(1, 0, 0)));
  } else if (selection.mode === 'vertex' && selection.activeVertexId) {
    normal = v3(0, 1, 0);
    tangent = v3(1, 0, 0);
  } else {
    return null;
  }

  const z = normalizeVec3(normal);
  let x = normalizeVec3(crossVec3(tangent, z));
  if (Math.hypot(x.x, x.y, x.z) < 1e-6) {
    x = normalizeVec3(crossVec3(v3(0, 1, 0), z));
  }
  const y = normalizeVec3(crossVec3(z, x));
  return { x, y, z };
}

function rotateDirection(v: Vec3, rotation: Vec3): Vec3 {
  let x = v.x, y = v.y, z = v.z;
  const cx = Math.cos(rotation.x), sx = Math.sin(rotation.x);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  const cy = Math.cos(rotation.y), sy = Math.sin(rotation.y);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cz = Math.cos(rotation.z), sz = Math.sin(rotation.z);
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return { x, y, z };
}

/** Default free-move plane normal for a viewport (view plane / ortho plane). */
export function freeMovePlaneNormal(viewId: ViewId, camera: CameraAxes): Vec3 {
  if (viewId === 'top') return v3(0, 1, 0);
  if (viewId === 'front') return v3(0, 0, 1);
  if (viewId === 'right') return v3(1, 0, 0);
  return normalizeVec3(camera.forward);
}

export function axisVector(basis: OrientationBasis, axis: 'x' | 'y' | 'z'): Vec3 {
  return axis === 'x' ? basis.x : axis === 'y' ? basis.y : basis.z;
}

const ORIENTATION_CYCLE: TransformOrientation[] = ['local', 'global', 'normal', 'view'];
const PIVOT_CYCLE: Array<'object-origin' | 'median' | 'bounding-box' | 'active'> = [
  'object-origin',
  'median',
  'bounding-box',
  'active',
];

export function cycleOrientation(current: TransformOrientation): TransformOrientation {
  const index = ORIENTATION_CYCLE.indexOf(current);
  return ORIENTATION_CYCLE[(index + 1) % ORIENTATION_CYCLE.length]!;
}

export function cyclePivotMode(
  current: 'object-origin' | 'median' | 'bounding-box' | 'active',
): 'object-origin' | 'median' | 'bounding-box' | 'active' {
  const index = PIVOT_CYCLE.indexOf(current);
  return PIVOT_CYCLE[(index + 1) % PIVOT_CYCLE.length]!;
}
