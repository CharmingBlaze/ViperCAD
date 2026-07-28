import type { EditorSession } from '@/core/editor/EditorSession';
import type { EditableMesh, FaceCornerId, FaceId } from '@/core/mesh/types';
import { cornersForFaces } from '@/core/uv/UvEdit';
import { islandForFace } from '@/core/uv/UvOperations';
import type { TextureWorkspaceState } from '@/workspace/TextureWorkspace';

export const UV_ZOOM_STEPS = [0.01, 0.025, 0.05, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512];

export function uniqueFacesForCorners(
  mesh: { faceCorners: Map<FaceCornerId, { faceId: FaceId }> },
  cornerIds: FaceCornerId[],
): FaceId[] {
  const faces = new Set<FaceId>();
  for (const id of cornerIds) {
    const corner = mesh.faceCorners.get(id);
    if (corner) faces.add(corner.faceId);
  }
  return [...faces];
}

/** Prefer 3D face selection when sync is on so stale UV corners cannot win. */
export function resolveSelectedCorners(
  mesh: EditableMesh,
  session: EditorSession,
  tex: TextureWorkspaceState,
): FaceCornerId[] {
  const faces = session.selection.state.selectedFaceIds;
  if (tex.uvSelectionSync !== 'off' && tex.uvEditMode !== 'point' && faces.size) {
    let faceIds = [...faces];
    if (tex.uvSelectionSync === 'island') {
      const expanded = new Set<FaceId>();
      for (const f of faceIds) {
        const island = islandForFace(mesh, f);
        for (const id of island?.faceIds ?? [f]) expanded.add(id);
      }
      faceIds = [...expanded];
    }
    return cornersForFaces(mesh, faceIds);
  }
  let corners = [...session.uvSelection.state.selectedCornerIds];
  if (!corners.length && faces.size) {
    corners = cornersForFaces(mesh, faces);
  }
  return corners;
}

export function nearestZoomIndex(zoom: number, steps: number[] = UV_ZOOM_STEPS): number {
  let best = 0;
  let dist = Infinity;
  for (let i = 0; i < steps.length; i++) {
    const d = Math.abs(steps[i]! - zoom);
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

export function rgbaToHex(c: readonly [number, number, number, number]): string {
  return '#' + [c[0], c[1], c[2]].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    alpha,
  ];
}
