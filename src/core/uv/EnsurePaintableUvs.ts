import type { EditableMesh, FaceId } from '@/core/mesh/types';
import { analyseUvs } from '@/core/uv/UvDiagnostics';
import { projectUvPlanar, unwrapUvAuto } from '@/core/uv/UvOperations';

export type PaintableUvResult = {
  changed: boolean;
  repairedFaceIds: FaceId[];
  mode: 'none' | 'auto-unwrapped' | 'repaired';
};

/**
 * Make zero-area UVs paintable without disturbing healthy mapping.
 * A completely unmapped mesh gets one packed atlas; isolated bad faces get
 * a local planar projection so existing painted faces stay in place.
 */
export function ensurePaintableUvs(mesh: EditableMesh): PaintableUvResult {
  const layerId = mesh.defaultUvLayerId;
  const faceIds = [...mesh.faces.keys()];
  if (!layerId || !faceIds.length) {
    return { changed: false, repairedFaceIds: [], mode: 'none' };
  }

  const diagnostics = analyseUvs(mesh, layerId, 256, 256);
  const degenerate = faceIds.filter((faceId) => diagnostics.faces.get(faceId)?.degenerate);
  if (!degenerate.length) {
    return { changed: false, repairedFaceIds: [], mode: 'none' };
  }

  if (degenerate.length === faceIds.length) {
    unwrapUvAuto(mesh, faceIds, layerId);
    return { changed: true, repairedFaceIds: faceIds, mode: 'auto-unwrapped' };
  }

  projectUvPlanar(mesh, degenerate, layerId);
  return { changed: true, repairedFaceIds: degenerate, mode: 'repaired' };
}
