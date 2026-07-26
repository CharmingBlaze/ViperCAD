import {
  addObjectToDocument,
  commitMeshObject,
  createMaterial,
  removeObject,
} from '@/core/document/ModelDocument';
import type {
  ImageAsset,
  MaterialAsset,
  ModelDocument,
  ObjectId,
  SceneObject,
  TextureAsset,
  TextureId,
} from '@/core/document/types';
import type { EditorSession } from '@/core/editor/EditorSession';
import { createId } from '@/core/ids/IdService';
import {
  inverseTransformPointApprox,
  transformPoint,
} from '@/core/math/Transform';
import { v2 } from '@/core/math/Vec2';
import type { Vec3 } from '@/core/math/Vec3';
import { MeshBuilder } from '@/core/mesh/MeshBuilder';
import type { EditableMesh, VertexId } from '@/core/mesh/types';
import {
  reprojectTerrainPlacedObjects,
  restorePlacedTransforms,
  snapshotPlacedTransforms,
  terrainHeightAtLocalPoint,
} from '@/core/terrain/TerrainProps';
import {
  carveTerrainBasin,
  carveTerrainChannel,
  carveTerrainOceanBed,
  restoreTerrainHeights,
  snapshotTerrainHeights,
  type XZ,
} from '@/core/terrain/WaterCarve';

export type TerrainFeatureKind = 'river' | 'path' | 'lake' | 'ocean';

export type TerrainFeatureStyle = {
  textureId?: TextureId | null;
  colour?: Vec3;
  opacity?: number;
  animated?: boolean;
  flowSpeed?: number;
  textureScale?: number;
};

export function buildTerrainRibbon(
  points: Vec3[],
  width: number,
  textureScale = 2,
  name = 'Terrain Ribbon',
): EditableMesh {
  if (points.length < 2) throw new Error('Draw a longer stroke to create this feature');
  const builder = new MeshBuilder(name);
  const halfWidth = Math.max(0.025, width) / 2;
  const left: string[] = [];
  const right: string[] = [];
  const distances = [0];

  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    const previous = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    let dx = next.x - previous.x;
    let dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    dx /= length;
    dz /= length;
    const sideX = -dz * halfWidth;
    const sideZ = dx * halfWidth;
    // Soft bank edges so the ribbon reads as a water surface, not a hard slab.
    left.push(builder.vertex({ x: point.x + sideX, y: point.y - 0.008, z: point.z + sideZ }));
    right.push(builder.vertex({ x: point.x - sideX, y: point.y - 0.008, z: point.z - sideZ }));
    if (index > 0) {
      const before = points[index - 1]!;
      distances[index] =
        distances[index - 1]! +
        Math.hypot(point.x - before.x, point.y - before.y, point.z - before.z);
    }
  }

  const repeat = Math.max(0.1, textureScale);
  for (let index = 0; index < points.length - 1; index++) {
    const v0 = distances[index]! / repeat;
    const v1 = distances[index + 1]! / repeat;
    builder.quad(
      left[index]!,
      left[index + 1]!,
      right[index + 1]!,
      right[index]!,
      [v2(0, v0), v2(0, v1), v2(1, v1), v2(1, v0)],
    );
  }
  return builder.build();
}

/** Subdivided lake disc with natural shoreline and denser UVs for flow. */
export function buildLakeMesh(
  radius: number,
  segments = 48,
  shorelineVariation = 0.1,
  rings = 4,
): EditableMesh {
  const builder = new MeshBuilder('Lake');
  const count = Math.max(8, Math.min(128, Math.round(segments)));
  const ringCount = Math.max(2, Math.min(8, Math.round(rings)));
  const r = Math.max(0.1, radius);
  const variation = clamp(shorelineVariation, 0, 0.22);
  const centre = builder.vertex({ x: 0, y: 0, z: 0 });
  const uvAt = (x: number, z: number) => v2(x / (r * 2) + 0.5, z / (r * 2) + 0.5);

  const ringIds: string[][] = [];
  for (let ring = 1; ring <= ringCount; ring++) {
    const t = ring / ringCount;
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      const angle = -(index / count) * Math.PI * 2;
      const shore =
        1 +
        variation *
          t *
          (
            Math.sin(angle * 3 + 0.7) * 0.48 +
            Math.sin(angle * 5 - 1.1) * 0.3 +
            Math.sin(angle * 9 + 2.2) * 0.22
          );
      const edge = r * t * shore;
      const x = Math.cos(angle) * edge;
      const z = Math.sin(angle) * edge;
      ids.push(builder.vertex({ x, y: 0, z }));
    }
    ringIds.push(ids);
  }

  const first = ringIds[0]!;
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count;
    const a = first[index]!;
    const b = first[next]!;
    const angle0 = -(index / count) * Math.PI * 2;
    const angle1 = -((index + 1) / count) * Math.PI * 2;
    const rr = r / ringCount;
    builder.ngon(
      [centre, a, b],
      [
        uvAt(0, 0),
        uvAt(Math.cos(angle0) * rr, Math.sin(angle0) * rr),
        uvAt(Math.cos(angle1) * rr, Math.sin(angle1) * rr),
      ],
    );
  }

  for (let ring = 0; ring < ringCount - 1; ring++) {
    const inner = ringIds[ring]!;
    const outer = ringIds[ring + 1]!;
    const t0 = (ring + 1) / ringCount;
    const t1 = (ring + 2) / ringCount;
    for (let index = 0; index < count; index++) {
      const next = (index + 1) % count;
      const angle0 = -(index / count) * Math.PI * 2;
      const angle1 = -((index + 1) / count) * Math.PI * 2;
      builder.quad(
        inner[index]!,
        outer[index]!,
        outer[next]!,
        inner[next]!,
        [
          uvAt(Math.cos(angle0) * r * t0, Math.sin(angle0) * r * t0),
          uvAt(Math.cos(angle0) * r * t1, Math.sin(angle0) * r * t1),
          uvAt(Math.cos(angle1) * r * t1, Math.sin(angle1) * r * t1),
          uvAt(Math.cos(angle1) * r * t0, Math.sin(angle1) * r * t0),
        ],
      );
    }
  }

  return builder.build();
}

/** Subdivided ocean plane for smoother shading and animated UVs. */
export function buildOceanMesh(size: number, divisions = 12): EditableMesh {
  const builder = new MeshBuilder('Ocean');
  const half = Math.max(0.1, size) / 2;
  const divs = Math.max(2, Math.min(32, Math.round(divisions)));
  const ids: string[][] = [];
  for (let z = 0; z <= divs; z++) {
    const row: string[] = [];
    for (let x = 0; x <= divs; x++) {
      const u = x / divs;
      const v = z / divs;
      row.push(builder.vertex({
        x: -half + u * half * 2,
        y: 0,
        z: -half + v * half * 2,
      }));
    }
    ids.push(row);
  }
  for (let z = 0; z < divs; z++) {
    for (let x = 0; x < divs; x++) {
      const u0 = (x / divs) * 8;
      const u1 = ((x + 1) / divs) * 8;
      const v0 = (z / divs) * 8;
      const v1 = ((z + 1) / divs) * 8;
      builder.quad(
        ids[z]![x]!,
        ids[z + 1]![x]!,
        ids[z + 1]![x + 1]!,
        ids[z]![x + 1]!,
        [v2(u0, v0), v2(u0, v1), v2(u1, v1), v2(u1, v0)],
      );
    }
  }
  return builder.build();
}

export function createTerrainFeatureMaterial(
  document: ModelDocument,
  kind: TerrainFeatureKind,
  style: TerrainFeatureStyle,
): MaterialAsset {
  const water = kind !== 'path';
  const material = createMaterial(document, {
    name: water ? `${title(kind)} Water` : 'Terrain Path',
  });
  material.baseColour = style.colour ?? (water
    ? kind === 'ocean'
      ? { x: 0.04, y: 0.28, z: 0.48 }
      : kind === 'river'
        ? { x: 0.06, y: 0.38, z: 0.58 }
        : { x: 0.05, y: 0.34, z: 0.52 }
    : { x: 0.3, y: 0.22, z: 0.14 });
  const textureId = style.textureId ?? (water ? ensureWaterRippleTexture(document) : null);
  material.baseColourTextureId = textureId;
  material.opacity = water ? clamp(style.opacity ?? 0.78, 0.05, 1) : 1;
  material.alphaMode = material.opacity < 1 ? 'blend' : 'opaque';
  material.roughness = water ? 0.08 : 0.82;
  material.metallic = water ? 0.22 : 0;
  material.emissive = water ? { x: 0.01, y: 0.04, z: 0.06 } : { x: 0, y: 0, z: 0 };
  material.doubleSided = true;
  material.flatShaded = false;
  material.textureFiltering = 'linear';
  material.textureWrapping = 'repeat';
  return material;
}

/** Soft procedural ripple / caustic texture used when no custom water texture is set. */
export function ensureWaterRippleTexture(document: ModelDocument): TextureId {
  for (const texture of document.textures.values()) {
    if (texture.name === 'Water Ripple') return texture.id;
  }
  const size = 64;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const wave =
        Math.sin((u * 9 + v * 3) * Math.PI * 2) * 0.5 +
        Math.sin((u * 3 - v * 11) * Math.PI * 2) * 0.35 +
        Math.sin((u * 17 + v * 13) * Math.PI * 2) * 0.15;
      const n = 0.5 + wave * 0.5;
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(18 + n * 40);
      pixels[i + 1] = Math.round(70 + n * 90);
      pixels[i + 2] = Math.round(110 + n * 100);
      pixels[i + 3] = 255;
    }
  }
  const image: ImageAsset = {
    id: createId('img'),
    name: 'Water Ripple',
    width: size,
    height: size,
    colourMode: 'rgba',
    pixels,
    revision: 1,
  };
  const texture: TextureAsset = {
    id: createId('tex'),
    name: 'Water Ripple',
    imageAssetId: image.id,
    filtering: 'linear',
    wrapping: 'repeat',
    colourSpace: 'srgb',
    generateMipmaps: true,
  };
  document.images.set(image.id, image);
  document.textures.set(texture.id, texture);
  return texture.id;
}

export type TerrainCarveUndo = {
  mesh: EditableMesh;
  before: Map<VertexId, Vec3>;
  after: Map<VertexId, Vec3>;
  beforeProps: Map<ObjectId, { position: Vec3; rotation: Vec3 }>;
  afterProps: Map<ObjectId, { position: Vec3; rotation: Vec3 }>;
};

export function commitTerrainFeature(
  session: EditorSession,
  terrainObjectId: ObjectId,
  kind: TerrainFeatureKind,
  mesh: EditableMesh,
  style: TerrainFeatureStyle,
  carve?: TerrainCarveUndo | null,
): SceneObject {
  const material = createTerrainFeatureMaterial(session.document, kind, style);
  const committed = commitMeshObject(session.document, mesh, {
    name: title(kind),
    materialId: material.id,
  });
  const object = session.document.objects.get(committed.objectId)!;
  object.metadata = {
    terrainFeature: kind,
    terrainOwnerId: terrainObjectId,
    waterAnimated: kind !== 'path' && style.animated !== false ? 'true' : 'false',
    waterFlowSpeed: String(clamp(style.flowSpeed ?? 0.12, -4, 4)),
    textureScale: String(Math.max(0.1, style.textureScale ?? 2)),
    waterCarved: carve ? 'true' : 'false',
  };

  const savedObject = cloneObject(object);
  const rippleTextureId = material.baseColourTextureId;
  const rippleImageId = rippleTextureId
    ? session.document.textures.get(rippleTextureId)?.imageAssetId ?? null
    : null;
  const rippleTexture = rippleTextureId
    ? session.document.textures.get(rippleTextureId) ?? null
    : null;
  const rippleImage = rippleImageId
    ? session.document.images.get(rippleImageId) ?? null
    : null;
  let applied = true;
  session.history.execute({
    name: carve ? `Create carved ${title(kind)}` : `Create ${title(kind)}`,
    execute: () => {
      if (applied) return;
      if (carve) {
        restoreTerrainHeights(carve.mesh, carve.after);
        restorePlacedTransforms(session.document, carve.afterProps);
      }
      if (rippleImage) session.document.images.set(rippleImage.id, rippleImage);
      if (rippleTexture) session.document.textures.set(rippleTexture.id, rippleTexture);
      session.document.materials.set(material.id, material);
      session.document.meshes.set(mesh.id, mesh);
      addObjectToDocument(session.document, cloneObject(savedObject));
      session.requestRedraw();
      applied = true;
    },
    undo: () => {
      removeObject(session.document, object.id, true);
      session.document.materials.delete(material.id);
      if (carve) {
        restoreTerrainHeights(carve.mesh, carve.before);
        restorePlacedTransforms(session.document, carve.beforeProps);
      }
      session.document.dirty = true;
      session.requestRedraw();
      applied = false;
    },
  });
  session.selection.setMode('object');
  session.selection.selectObjects([object.id], 'replace');
  session.document.dirty = true;
  session.requestRedraw();
  return object;
}

/**
 * Carve a channel under a river/path stroke, then place a ribbon in the cut.
 * Rivers sit mid-channel; paths sit on the worn bed.
 */
export function commitRibbonWithCarve(
  session: EditorSession,
  terrainObjectId: ObjectId,
  kind: Extract<TerrainFeatureKind, 'river' | 'path'>,
  worldPoints: Vec3[],
  width: number,
  style: TerrainFeatureStyle & { surfaceOffset?: number; carveDepth?: number; carve?: boolean },
): SceneObject | null {
  const terrain = session.document.objects.get(terrainObjectId);
  const terrainMesh = terrain?.meshId ? session.document.meshes.get(terrain.meshId) : null;
  if (!terrain || !terrainMesh || worldPoints.length < 2) return null;

  const carveEnabled = style.carve !== false;
  const defaultDepth = kind === 'path'
    ? Math.max(0.12, width * 0.2)
    : Math.max(0.35, width * 0.45);
  const depth = Math.max(0.05, style.carveDepth ?? defaultDepth);
  const surfaceOffset = style.surfaceOffset ?? (kind === 'path' ? 0.04 : 0.03);

  const localStroke: XZ[] = worldPoints.map((point) => {
    const local = inverseTransformPointApprox(point, terrain.transform);
    return { x: local.x, z: local.z };
  });

  let carveUndo: TerrainCarveUndo | null = null;
  if (carveEnabled) {
    const before = snapshotTerrainHeights(terrainMesh);
    const beforeProps = snapshotPlacedTransforms(session.document, terrainObjectId);
    // Paths use a slightly wider, softer shoulder for a worn trail look.
    carveTerrainChannel(
      terrainMesh,
      localStroke,
      kind === 'path' ? width * 1.05 : width,
      depth,
      kind === 'path' ? { feather: width * 0.45 } : undefined,
    );
    reprojectTerrainPlacedObjects(session.document, terrainObjectId);
    carveUndo = {
      mesh: terrainMesh,
      before,
      after: snapshotTerrainHeights(terrainMesh),
      beforeProps,
      afterProps: snapshotPlacedTransforms(session.document, terrainObjectId),
    };
  }

  const ribbonPoints = worldPoints.map((point) => {
    const local = inverseTransformPointApprox(point, terrain.transform);
    const bed = terrainHeightAtLocalPoint(terrain, terrainMesh, local.x, local.z);
    // Rivers fill mid-channel; paths sit on the carved bed.
    const fill = carveEnabled
      ? bed + depth * (kind === 'path' ? 0.08 : 0.42)
      : bed;
    const world = transformPoint(
      { x: local.x, y: fill + surfaceOffset, z: local.z },
      terrain.transform,
    );
    return world;
  });

  const mesh = buildTerrainRibbon(
    ribbonPoints,
    width,
    style.textureScale ?? 2,
    kind === 'path' ? 'Path' : 'River',
  );
  return commitTerrainFeature(session, terrainObjectId, kind, mesh, {
    ...style,
    animated: kind === 'river' ? style.animated : false,
  }, carveUndo);
}

/** @deprecated Prefer commitRibbonWithCarve — kept for call-site clarity. */
export function commitRiverWithCarve(
  session: EditorSession,
  terrainObjectId: ObjectId,
  worldPoints: Vec3[],
  width: number,
  style: TerrainFeatureStyle & { surfaceOffset?: number; carveDepth?: number; carve?: boolean },
): SceneObject | null {
  return commitRibbonWithCarve(session, terrainObjectId, 'river', worldPoints, width, style);
}

export function commitPathWithCarve(
  session: EditorSession,
  terrainObjectId: ObjectId,
  worldPoints: Vec3[],
  width: number,
  style: TerrainFeatureStyle & { surfaceOffset?: number; carveDepth?: number; carve?: boolean },
): SceneObject | null {
  return commitRibbonWithCarve(session, terrainObjectId, 'path', worldPoints, width, style);
}

/** Carve a lake basin and place a subdivided water disc at the fill level. */
export function commitLakeWithCarve(
  session: EditorSession,
  terrainObjectId: ObjectId,
  options: {
    radius: number;
    waterLevel: number;
    carveDepth?: number;
    carve?: boolean;
    shorelineVariation?: number;
    style: TerrainFeatureStyle;
    centre?: { x: number; z: number };
  },
): SceneObject | null {
  const terrain = session.document.objects.get(terrainObjectId);
  const terrainMesh = terrain?.meshId ? session.document.meshes.get(terrain.meshId) : null;
  if (!terrain || !terrainMesh) return null;

  const radius = Math.max(0.1, options.radius);
  const centre = options.centre ?? { x: 0, z: 0 };
  const depth = Math.max(0.08, options.carveDepth ?? Math.max(0.5, radius * 0.22));
  const carveEnabled = options.carve !== false;

  let carveUndo: TerrainCarveUndo | null = null;
  if (carveEnabled) {
    const before = snapshotTerrainHeights(terrainMesh);
    const beforeProps = snapshotPlacedTransforms(session.document, terrainObjectId);
    carveTerrainBasin(terrainMesh, centre.x, centre.z, radius, depth, {
      waterLevel: options.waterLevel,
    });
    reprojectTerrainPlacedObjects(session.document, terrainObjectId);
    carveUndo = {
      mesh: terrainMesh,
      before,
      after: snapshotTerrainHeights(terrainMesh),
      beforeProps,
      afterProps: snapshotPlacedTransforms(session.document, terrainObjectId),
    };
  }

  const mesh = buildLakeMesh(radius, 56, options.shorelineVariation ?? 0.1, 5);
  for (const vertex of mesh.vertices.values()) {
    vertex.position.x += terrain.transform.position.x + centre.x;
    vertex.position.y += terrain.transform.position.y + options.waterLevel + 0.02;
    vertex.position.z += terrain.transform.position.z + centre.z;
  }
  return commitTerrainFeature(
    session,
    terrainObjectId,
    'lake',
    mesh,
    options.style,
    carveUndo,
  );
}

/** Carve a broad ocean bed and place a subdivided water plane. */
export function commitOceanWithCarve(
  session: EditorSession,
  terrainObjectId: ObjectId,
  options: {
    size: number;
    waterLevel: number;
    carveDepth?: number;
    carve?: boolean;
    style: TerrainFeatureStyle;
  },
): SceneObject | null {
  const terrain = session.document.objects.get(terrainObjectId);
  const terrainMesh = terrain?.meshId ? session.document.meshes.get(terrain.meshId) : null;
  if (!terrain || !terrainMesh) return null;

  const size = Math.max(0.1, options.size);
  const depth = Math.max(0.08, options.carveDepth ?? Math.max(0.4, size * 0.04));
  const carveEnabled = options.carve !== false;

  let carveUndo: TerrainCarveUndo | null = null;
  if (carveEnabled) {
    const before = snapshotTerrainHeights(terrainMesh);
    const beforeProps = snapshotPlacedTransforms(session.document, terrainObjectId);
    carveTerrainOceanBed(terrainMesh, size / 2, depth, options.waterLevel);
    reprojectTerrainPlacedObjects(session.document, terrainObjectId);
    carveUndo = {
      mesh: terrainMesh,
      before,
      after: snapshotTerrainHeights(terrainMesh),
      beforeProps,
      afterProps: snapshotPlacedTransforms(session.document, terrainObjectId),
    };
  }

  const mesh = buildOceanMesh(size, 14);
  for (const vertex of mesh.vertices.values()) {
    vertex.position.x += terrain.transform.position.x;
    vertex.position.y += terrain.transform.position.y + options.waterLevel + 0.02;
    vertex.position.z += terrain.transform.position.z;
  }
  return commitTerrainFeature(
    session,
    terrainObjectId,
    'ocean',
    mesh,
    options.style,
    carveUndo,
  );
}

function cloneObject(object: SceneObject): SceneObject {
  return {
    ...object,
    childIds: [...object.childIds],
    materialSlotIds: [...object.materialSlotIds],
    transform: {
      position: { ...object.transform.position },
      rotation: { ...object.transform.rotation },
      scale: { ...object.transform.scale },
    },
    metadata: { ...object.metadata },
  };
}

function title(kind: TerrainFeatureKind): string {
  return kind[0]!.toUpperCase() + kind.slice(1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value) || 0));
}
