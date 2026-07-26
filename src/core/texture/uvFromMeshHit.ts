import type { ImageAsset, ModelDocument, ObjectId } from '@/core/document/types';
import { getCornerUv, resolveUvLayerId } from '@/core/uv/UvEdit';
import type { EditableMesh, FaceCornerId, FaceId, UvLayerId } from '@/core/mesh/types';

/** Minimal triangle → corner map used for UV interpolation (matches render pick map). */
export type TriangleUvMap = {
  faceId: FaceId;
  cornerIds: [FaceCornerId, FaceCornerId, FaceCornerId];
};

/**
 * Interpolate UV from a render-triangle hit using corner UVs + barycentrics.
 * Prefers Three.js interpolated `uv` when present.
 */
export function uvFromTriangleHit(
  mesh: EditableMesh,
  triangleMap: TriangleUvMap[],
  faceIndex: number | undefined,
  barycentric: { x: number; y: number; z: number } | null | undefined,
  threeUv: { x: number; y: number } | null | undefined,
  layerIdOverride?: string | null,
): { uv: { x: number; y: number }; faceId: FaceId; layerId: UvLayerId } | null {
  if (faceIndex == null || faceIndex < 0 || faceIndex >= triangleMap.length) return null;
  const tri = triangleMap[faceIndex]!;
  const layerId = resolveUvLayerId(mesh, layerIdOverride ?? mesh.defaultUvLayerId);
  if (!layerId) return null;

  if (threeUv && Number.isFinite(threeUv.x) && Number.isFinite(threeUv.y)) {
    return { uv: { x: threeUv.x, y: threeUv.y }, faceId: tri.faceId, layerId };
  }

  if (!barycentric) return null;
  const a = getCornerUv(mesh, tri.cornerIds[0], layerId);
  const b = getCornerUv(mesh, tri.cornerIds[1], layerId);
  const c = getCornerUv(mesh, tri.cornerIds[2], layerId);
  // Three.js barycentric: x→vA, y→vB, z→vC
  return {
    uv: {
      x: a.x * barycentric.x + b.x * barycentric.y + c.x * barycentric.z,
      y: a.y * barycentric.x + b.y * barycentric.y + c.y * barycentric.z,
    },
    faceId: tri.faceId,
    layerId,
  };
}

/** Resolve the image painted by a hit face's material slot. */
export function resolveImageForFace(
  doc: ModelDocument,
  objectId: ObjectId,
  faceId: FaceId,
): ImageAsset | null {
  const object = doc.objects.get(objectId);
  const mesh = object?.meshId ? doc.meshes.get(object.meshId) : null;
  const face = mesh?.faces.get(faceId);
  if (!object || !face) return null;
  const materialId =
    object.materialSlotIds[face.materialSlot] ?? object.materialSlotIds[0] ?? null;
  const material = materialId ? doc.materials.get(materialId) : null;
  const texture = material?.baseColourTextureId
    ? doc.textures.get(material.baseColourTextureId)
    : null;
  return texture?.imageAssetId ? doc.images.get(texture.imageAssetId) ?? null : null;
}

export function uvToPixel(
  image: ImageAsset,
  uv: { x: number; y: number },
): { x: number; y: number } {
  // Repeating game surfaces (especially terrain) legitimately use UVs outside
  // the 0..1 tile. Preserve exact border coordinates, but wrap outer tiles so
  // painting in 3D edits the texel shown beneath the cursor.
  const u = wrapOuterUv(uv.x);
  const v = wrapOuterUv(uv.y);
  return {
    x: Math.min(image.width - 1, Math.max(0, Math.floor(u * image.width))),
    y: Math.min(image.height - 1, Math.max(0, Math.floor((1 - v) * image.height))),
  };
}

function wrapOuterUv(value: number): number {
  if (value >= 0 && value <= 1) return value;
  return ((value % 1) + 1) % 1;
}
