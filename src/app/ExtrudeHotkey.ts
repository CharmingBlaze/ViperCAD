import type { EditorSession } from '@/core/editor/EditorSession';
import { runMeshTransaction } from '@/core/history/Transaction';
import {
  addVec3,
  crossVec3,
  normalizeVec3,
  v3,
  type Vec3,
} from '@/core/math/Vec3';
import { getEdgeVertices, isBoundaryEdge } from '@/core/mesh/EditableMesh';
import { computeFaceNormal } from '@/core/mesh/Normals';
import { extrudeEdges, extrudeFaceRegion } from '@/core/mesh/ops/extrude';
import type { EditableMesh, EdgeId } from '@/core/mesh/types';
import type { OrientationBasis } from '@/core/transform/types';
import type { WorkspaceController } from '@/workspace/WorkspaceController';
import type { ViewId } from '@/workspace/types';
import type { CameraAxes } from '@/app/TransformHotkeys';
import type { PointerSample } from '@/core/transform/TransformSystem';
import { pushToast } from '@/app/Toast';
import {
  expandSymmetryEdgeIds,
  expandSymmetryFaceIds,
} from '@/core/symmetry/Symmetry';

/**
 * Blender-style Extrude (E): extrude faces/edges at distance 0, then grab
 * along the normal. Esc undoes the extruded topology.
 */
export function beginInteractiveExtrude(
  session: EditorSession,
  workspace: WorkspaceController,
  getCameraAxes: (viewId: ViewId) => CameraAxes | null,
  getPointerSample?: (viewId: ViewId) => PointerSample | null,
): boolean {
  if (session.transform.active) return false;

  const sel = session.selection.state;
  const objectId = sel.activeObjectId ?? [...sel.selectedObjectIds][0] ?? null;
  if (!objectId) return false;
  const object = session.document.objects.get(objectId);
  if (!object?.meshId) return false;
  const mesh = session.document.meshes.get(object.meshId);
  if (!mesh) return false;

  const viewId = workspace.hoveredViewportId ?? workspace.activeViewportId;
  const camera = getCameraAxes(viewId);
  const pointer = getPointerSample?.(viewId) ?? null;

  if (sel.mode === 'face' && sel.selectedFaceIds.size > 0) {
    const primaryCount = sel.selectedFaceIds.size;
    const primaryDirection = normalizeVec3(
      [...sel.selectedFaceIds].reduce(
        (sum, id) => addVec3(sum, computeFaceNormal(mesh, id)),
        v3(0, 0, 0),
      ),
    );
    const ids = [...expandSymmetryFaceIds(
      mesh,
      sel.selectedFaceIds,
      session.document.settings.symmetry,
    )];
    const tx = runMeshTransaction(
      session.history,
      mesh,
      'Extrude',
      (m) => {
        const result = extrudeFaceRegion(m, ids, {
          distance: 0,
          direction: primaryDirection,
        });
        if (!result.ok) throw new Error(result.error?.message ?? 'Extrude failed');
        if (result.change.recommendedSelection.faceIds) {
          result.change.recommendedSelection.faceIds =
            result.change.recommendedSelection.faceIds.slice(0, primaryCount);
        }
        session.selection.applyTopologyChange(result.change);
        return result;
      },
      { fullValidation: true, selection: session.selection },
    );
    if (!tx.ok) {
      pushToast(tx.error ?? 'Extrude failed', 'error');
      return false;
    }
    return startExtrudeGrab(session, workspace, viewId, camera, pointer, null);
  }

  if (sel.mode === 'edge' && sel.selectedEdgeIds.size > 0) {
    const primaryEdgeIds = [...sel.selectedEdgeIds];
    const primaryVertexCount = new Set(
      primaryEdgeIds.flatMap((id) => getEdgeVertices(mesh, id) ?? []),
    ).size;
    const ids = [...expandSymmetryEdgeIds(
      mesh,
      sel.selectedEdgeIds,
      session.document.settings.symmetry,
    )];
    const grabBasis = edgeExtrudeBasis(mesh, primaryEdgeIds);
    const tx = runMeshTransaction(
      session.history,
      mesh,
      'Extrude',
      (m) => {
        const result = extrudeEdges(m, ids, {
          distance: 0,
          direction: grabBasis.z,
        });
        if (!result.ok) throw new Error(result.error?.message ?? 'Extrude failed');
        if (result.change.recommendedSelection.vertexIds) {
          result.change.recommendedSelection.vertexIds =
            result.change.recommendedSelection.vertexIds.slice(0, primaryVertexCount);
        }
        session.selection.applyTopologyChange(result.change);
        return result;
      },
      { fullValidation: true, selection: session.selection },
    );
    if (!tx.ok) {
      pushToast(tx.error ?? 'Extrude failed', 'error');
      return false;
    }

    // Face-region path leaves face selection — use normal orientation.
    if (session.selection.state.mode === 'face') {
      return startExtrudeGrab(session, workspace, viewId, camera, pointer, null);
    }
    return startExtrudeGrab(session, workspace, viewId, camera, pointer, grabBasis);
  }

  return false;
}

function startExtrudeGrab(
  session: EditorSession,
  workspace: WorkspaceController,
  viewId: ViewId,
  camera: CameraAxes | null,
  pointer: PointerSample | null,
  orientationBasis: OrientationBasis | null,
): boolean {
  session.tools.setActive('select', session.context());
  session.transform.setGizmoMode('move');
  const started = session.transform.begin({
    type: 'translate',
    source: 'keyboard',
    viewportId: viewId,
    pointer,
    camera,
    orientation: orientationBasis ? 'custom' : 'normal',
    orientationBasis: orientationBasis ?? undefined,
    constraint: 'z',
    undoHistoryOnCancel: true,
    statusLabel: 'Extrude',
  });
  if (started) workspace.input.begin('transform');
  session.requestRedraw();
  return started;
}

function edgeExtrudeBasis(mesh: EditableMesh, edgeIds: EdgeId[]): OrientationBasis {
  const boundary = edgeIds.filter((id) => isBoundaryEdge(mesh, id));
  let acc = v3(0, 0, 0);
  let count = 0;
  for (const edgeId of boundary.length ? boundary : edgeIds) {
    const edge = mesh.edges.get(edgeId);
    if (!edge) continue;
    for (const heId of [edge.halfEdgeAId, edge.halfEdgeBId]) {
      if (!heId) continue;
      const faceId = mesh.halfEdges.get(heId)?.faceId;
      if (!faceId) continue;
      acc = addVec3(acc, computeFaceNormal(mesh, faceId));
      count += 1;
    }
  }
  const z = count > 0 ? normalizeVec3(acc) : v3(0, 1, 0);
  return basisFromZ(z);
}

function basisFromZ(zIn: Vec3): OrientationBasis {
  const z = normalizeVec3(zIn);
  let x = crossVec3(v3(0, 1, 0), z);
  if (Math.hypot(x.x, x.y, x.z) < 1e-6) x = crossVec3(v3(1, 0, 0), z);
  x = normalizeVec3(x);
  const y = normalizeVec3(crossVec3(z, x));
  return { x, y, z };
}
