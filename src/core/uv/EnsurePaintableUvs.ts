import type { EditableMesh, FaceId } from '@/core/mesh/types';
import { analyseUvs } from '@/core/uv/UvDiagnostics';
import { createUvLayer, projectUvPlanar, unwrapUvAuto } from '@/core/uv/UvOperations';

export type PaintableUvResult = {
  changed: boolean;
  repairedFaceIds: FaceId[];
  mode: 'none' | 'auto-unwrapped' | 'repaired';
};

/**
 * Guarantees a mesh has a UV layer the editor can work with. Imported or
 * procedural meshes are allowed to have no UV layer at all; create one before
 * running the normal paintability repair so the UV editor never has to reject
 * an otherwise editable mesh.
 */
export function ensureEditableUvs(mesh: EditableMesh): PaintableUvResult {
  const hasValidDefault = !!mesh.defaultUvLayerId && mesh.uvLayers.has(mesh.defaultUvLayerId);
  if (!hasValidDefault) {
    createUvLayer(mesh, 'UVMap');
    const faceIds = [...mesh.faces.keys()];
    if (faceIds.length) unwrapUvAuto(mesh, faceIds, mesh.defaultUvLayerId!);
    return { changed: true, repairedFaceIds: faceIds, mode: 'auto-unwrapped' };
  }
  return ensurePaintableUvs(mesh);
}

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
