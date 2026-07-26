import type { CurveStyle } from '@/core/curves/CurveOperation';
import { ensurePaintableUvs } from '@/core/uv/EnsurePaintableUvs';
import { unwrapUvAuto } from '@/core/uv/UvOperations';
import type { EditableMesh } from '@/core/mesh/types';

const SWEEP_STYLES = new Set<CurveStyle>([
  'ribbon',
  'hair',
  'hair-strip',
  'rounded-hair',
  'tapered-tube',
  'rope',
  'square-sweep',
  'rail-sweep',
]);

/** Keep curve output paintable while preserving builder-assigned strip/planar UVs. */
export function finalizeCurveMeshUvs(
  mesh: EditableMesh,
  style: CurveStyle,
  cyclic: boolean,
): void {
  const layerId = mesh.defaultUvLayerId;
  if (!layerId || mesh.faces.size === 0) return;

  const faceIds = [...mesh.faces.keys()];
  const unset = [...mesh.faceCorners.values()].every((corner) => {
    const uv = corner.uvs.get(layerId);
    return !uv || (uv.x === 0 && uv.y === 0);
  });
  if (unset) {
    unwrapUvAuto(mesh, faceIds, layerId);
    return;
  }

  if (style === 'tube' || SWEEP_STYLES.has(style) || (style === 'capsule' && !cyclic)) {
    ensurePaintableUvs(mesh);
    return;
  }

  ensurePaintableUvs(mesh);
}
