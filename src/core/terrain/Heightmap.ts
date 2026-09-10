import type {
  ImageAsset,
  ObjectId,
} from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import { cloneVec3 } from '@/core/math/Vec3';
import { bumpPositions } from '@/core/mesh/EditableMesh';
import {
  reprojectTerrainPlacedObjects,
  restorePlacedTransforms,
  snapshotPlacedTransforms,
} from '@/core/terrain/TerrainProps';

export type HeightmapMode = 'replace' | 'add';
export type HeightmapChannel = 'luminance' | 'red' | 'green' | 'blue' | 'alpha';

export type HeightmapOptions = {
  strength: number;
  offset?: number;
  mode?: HeightmapMode;
  channel?: HeightmapChannel;
  invert?: boolean;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  reprojectObjects?: boolean;
};

export function applyHeightmap(
  session: EditorSession,
  terrainObjectId: ObjectId,
  image: ImageAsset,
  options: HeightmapOptions,
): boolean {
  const object = session.document.objects.get(terrainObjectId);
  const mesh = object?.meshId ? session.document.meshes.get(object.meshId) : null;
  if (!object || object.metadata.terrain !== 'true' || !mesh?.vertices.size) return false;
  if (image.width < 1 || image.height < 1 || image.pixels.length < image.width * image.height * 4) {
    return false;
  }

  const before = new Map(
    [...mesh.vertices].map(([id, vertex]) => [id, cloneVec3(vertex.position)]),
  );
  const beforeMetadata = { ...object.metadata };
  const beforeObjectTransforms = snapshotPlacedTransforms(session.document, terrainObjectId);
  let minX = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxZ = -Infinity;
  for (const vertex of mesh.vertices.values()) {
    const px = vertex.position.x;
    const pz = vertex.position.z;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (pz < minZ) minZ = pz;
    if (pz > maxZ) maxZ = pz;
  }
  const spanX = Math.max(1e-8, maxX - minX);
  const spanZ = Math.max(1e-8, maxZ - minZ);
  const strength = finite(options.strength, 1);
  const offset = finite(options.offset ?? 0, 0);
  const mode = options.mode ?? 'replace';
  const channel = options.channel ?? 'luminance';

  for (const vertex of mesh.vertices.values()) {
    let u = (vertex.position.x - minX) / spanX;
    let v = (vertex.position.z - minZ) / spanZ;
    if (options.flipHorizontal) u = 1 - u;
    if (options.flipVertical) v = 1 - v;
    let value = sampleHeight(image, u, v, channel);
    if (options.invert) value = 1 - value;
    vertex.position.y =
      mode === 'add'
        ? vertex.position.y + (value - 0.5) * strength + offset
        : value * strength + offset;
  }
  bumpPositions(mesh);
  if (options.reprojectObjects !== false) {
    reprojectTerrainPlacedObjects(session.document, terrainObjectId);
  }
  object.metadata.heightmapImageId = image.id;
  object.metadata.heightmapName = image.name;
  object.metadata.heightmapStrength = String(strength);
  object.metadata.heightmapOffset = String(offset);
  object.metadata.heightmapMode = mode;
  object.metadata.heightmapChannel = channel;
  object.metadata.heightmapInvert = String(!!options.invert);
  object.metadata.heightmapFlipHorizontal = String(!!options.flipHorizontal);
  object.metadata.heightmapFlipVertical = String(!!options.flipVertical);
  object.metadata.heightmapReprojectObjects = String(options.reprojectObjects !== false);
  const after = new Map(
    [...mesh.vertices].map(([id, vertex]) => [id, cloneVec3(vertex.position)]),
  );
  const afterMetadata = { ...object.metadata };
  const afterObjectTransforms = snapshotPlacedTransforms(session.document, terrainObjectId);
  let applied = true;
  const restore = (
    positions: typeof before,
    metadata: Record<string, string>,
    propTransforms: typeof beforeObjectTransforms,
  ) => {
    for (const [id, position] of positions) {
      const vertex = mesh.vertices.get(id);
      if (vertex) vertex.position = cloneVec3(position);
    }
    object.metadata = { ...metadata };
    restorePlacedTransforms(session.document, propTransforms);
    bumpPositions(mesh);
    session.document.dirty = true;
    session.requestRedraw();
  };
  session.history.execute({
    name: `Apply Heightmap ${image.name}`,
    execute: () => {
      if (applied) return;
      restore(after, afterMetadata, afterObjectTransforms);
      applied = true;
    },
    undo: () => {
      restore(before, beforeMetadata, beforeObjectTransforms);
      applied = false;
    },
  });
  session.document.dirty = true;
  session.requestRedraw();
  return true;
}

export function sampleHeight(
  image: ImageAsset,
  u: number,
  v: number,
  channel: HeightmapChannel = 'luminance',
): number {
  const x = clamp(u, 0, 1) * Math.max(0, image.width - 1);
  const y = clamp(v, 0, 1) * Math.max(0, image.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = pixelChannel(image, x0, y0, channel);
  const b = pixelChannel(image, x1, y0, channel);
  const c = pixelChannel(image, x0, y1, channel);
  const d = pixelChannel(image, x1, y1, channel);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function pixelChannel(
  image: ImageAsset,
  x: number,
  y: number,
  channel: HeightmapChannel,
): number {
  const index = (y * image.width + x) * 4;
  const r = image.pixels[index]! / 255;
  const g = image.pixels[index + 1]! / 255;
  const b = image.pixels[index + 2]! / 255;
  const a = image.pixels[index + 3]! / 255;
  if (channel === 'red') return r;
  if (channel === 'green') return g;
  if (channel === 'blue') return b;
  if (channel === 'alpha') return a;
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
