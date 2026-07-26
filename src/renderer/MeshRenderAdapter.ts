import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshPhysicalMaterial,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Material,
} from 'three';
import type { ImageAsset, MaterialAsset, TextureAsset } from '@/core/document/types';
import { faceCornerIds, faceVertexIds, getEdgeVertices } from '@/core/mesh/EditableMesh';
import { computeCornerNormal, computeFaceNormal } from '@/core/mesh/Normals';
import { triangulateFace } from '@/core/mesh/Triangulation';
import type { EditableMesh, FaceId, FaceCornerId, VertexId } from '@/core/mesh/types';
import type { MeshEvaluationResult } from '@/renderer/workers/MeshEvaluationTypes';

export type PickTriangleMap = {
  /** render triangle index → logical face id */
  faceId: FaceId;
  cornerIds: [FaceCornerId, FaceCornerId, FaceCornerId];
  vertexIds: [VertexId, VertexId, VertexId];
};

export type MeshRenderData = {
  geometry: BufferGeometry;
  /** Maps each rendered triangle to logical topology. */
  triangleMap: PickTriangleMap[];
  /**
   * Logical vertex id for each render corner (same order as position attribute).
   * Enables cheap position-only updates during gizmo drags.
   */
  renderVertexIds: VertexId[];
  /** Logical face-corner id for each render corner; used for live UV updates. */
  renderCornerIds: FaceCornerId[];
  materialGroups: { start: number; count: number; materialSlot: number }[];
  geometryVersion: number;
  topologyVersion: number;
};

/**
 * Convert EditableMesh → Three.js BufferGeometry.
 * EditableMesh remains the source of truth; this is a derived representation.
 */
export function editableMeshToRenderData(
  mesh: EditableMesh,
  options: { flatShading?: boolean } = {},
): MeshRenderData {
  const flatShading = options.flatShading ?? false;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const atlasTileRects: number[] = [];
  const secondaryUvs: number[] = [];
  const indices: number[] = [];
  const renderVertexIds: VertexId[] = [];
  const renderCornerIds: FaceCornerId[] = [];
  const triangleMap: PickTriangleMap[] = [];
  const materialGroups: MeshRenderData['materialGroups'] = [];

  // Group faces by material slot for geometry groups.
  const facesBySlot = new Map<number, FaceId[]>();
  for (const face of mesh.faces.values()) {
    const list = facesBySlot.get(face.materialSlot) ?? [];
    list.push(face.id);
    facesBySlot.set(face.materialSlot, list);
  }

  const uvLayerId = mesh.defaultUvLayerId;
  const secondaryUvLayerId = [...mesh.uvLayers.keys()].find((id) => id !== uvLayerId);
  let vertexCursor = 0;

  for (const [slot, faceIds] of [...facesBySlot.entries()].sort((a, b) => a[0] - b[0])) {
    const groupStart = indices.length;
    for (const faceId of faceIds) {
      const face = mesh.faces.get(faceId)!;
      const useFlat = flatShading || face.flatShaded;
      const faceNormal = computeFaceNormal(mesh, faceId);
      const cornerIds = faceCornerIds(mesh, faceId);
      const vertexIds = faceVertexIds(mesh, faceId);
      const tri = triangulateFace(mesh, faceId);

      // Emit unique render corners per logical corner for flat shading / UV seams.
      const cornerRenderIndex = new Map<number, number>();
      for (let i = 0; i < cornerIds.length; i++) {
        const corner = mesh.faceCorners.get(cornerIds[i]!)!;
        const pos = mesh.vertices.get(vertexIds[i]!)!.position;
        const n = useFlat ? faceNormal : computeCornerNormal(mesh, corner.id);
        const uv = uvLayerId ? (corner.uvs.get(uvLayerId) ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
        const secondaryUv = secondaryUvLayerId
          ? (corner.uvs.get(secondaryUvLayerId) ?? { x: 0, y: 0 })
          : null;

        cornerRenderIndex.set(i, vertexCursor);
        positions.push(pos.x, pos.y, pos.z);
        normals.push(n.x, n.y, n.z);
        uvs.push(uv.x, uv.y);
        const tile = corner.atlasTile;
        atlasTileRects.push(
          tile ? tile.minU : 0,
          tile ? tile.minV : 0,
          tile ? tile.maxU - tile.minU : 0,
          tile ? tile.maxV - tile.minV : 0,
        );
        if (secondaryUv) secondaryUvs.push(secondaryUv.x, secondaryUv.y);
        renderVertexIds.push(vertexIds[i]!);
        renderCornerIds.push(cornerIds[i]!);
        vertexCursor += 1;
      }

      for (const [a, b, c] of tri.triangles) {
        const ia = cornerRenderIndex.get(a)!;
        const ib = cornerRenderIndex.get(b)!;
        const ic = cornerRenderIndex.get(c)!;
        indices.push(ia, ib, ic);
        triangleMap.push({
          faceId,
          cornerIds: [cornerIds[a]!, cornerIds[b]!, cornerIds[c]!],
          vertexIds: [vertexIds[a]!, vertexIds[b]!, vertexIds[c]!],
        });
      }
    }
    const groupCount = indices.length - groupStart;
    if (groupCount > 0) {
      materialGroups.push({ start: groupStart, count: groupCount, materialSlot: slot });
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute('atlasTileRect', new BufferAttribute(new Float32Array(atlasTileRects), 4));
  if (secondaryUvLayerId) {
    // Three.js maps `uv1` to glTF TEXCOORD_1 for lightmaps and engine UV2 workflows.
    geometry.setAttribute('uv1', new BufferAttribute(new Float32Array(secondaryUvs), 2));
  }
  geometry.setIndex(indices);

  for (let i = 0; i < materialGroups.length; i++) {
    const g = materialGroups[i]!;
    geometry.addGroup(g.start, g.count, g.materialSlot);
  }

  return {
    geometry,
    triangleMap,
    renderVertexIds,
    renderCornerIds,
    materialGroups,
    geometryVersion: mesh.geometryVersion,
    topologyVersion: mesh.topologyVersion,
  };
}

export type RenderAssetResolver = { textures: Map<string, TextureAsset>; images: Map<string, ImageAsset> };

export type MaterialToThreeOptions = {
  /**
   * glTF / Blender path. Three's GLTFExporter cannot flip DataTexture pixels via
   * canvas transforms (putImageData ignores them), so we pre-flip rows and set
   * flipY=false. Also skips the viewport-only atlas wrap shader.
   */
  forGltfExport?: boolean;
};

/** Vertically flip an RGBA pixel buffer (row 0 ↔ last row). */
export function flipImagePixelsVertically(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
): Uint8Array {
  const rowBytes = Math.max(0, width) * 4;
  const out = new Uint8Array(Math.max(0, height) * rowBytes);
  for (let y = 0; y < height; y++) {
    const src = y * rowBytes;
    const dst = (height - 1 - y) * rowBytes;
    for (let i = 0; i < rowBytes; i++) out[dst + i] = pixels[src + i]!;
  }
  return out;
}

export function materialAssetToThree(
  mat: MaterialAsset,
  assets?: RenderAssetResolver,
  options: MaterialToThreeOptions = {},
): MeshStandardMaterial | MeshBasicMaterial | MeshPhysicalMaterial {
  const colour = new Color(mat.baseColour.x, mat.baseColour.y, mat.baseColour.z);
  const emissive = new Color(
    mat.emissive.x * mat.emissiveIntensity,
    mat.emissive.y * mat.emissiveIntensity,
    mat.emissive.z * mat.emissiveIntensity,
  );
  const usePhysical =
    !mat.unlit &&
    mat.shadingModel !== 'unlit' &&
    (mat.shadingModel === 'physical' || mat.transmission > 0.01 || mat.clearcoat > 0.01);
  const transparent = mat.alphaMode === 'blend' || mat.opacity < 0.999 || mat.transmission > 0.01;
  const common = {
    color: colour,
    opacity: mat.opacity,
    transparent,
    side: mat.doubleSided ? DoubleSide : FrontSide,
    wireframe: false,
  };

  let material: MeshStandardMaterial | MeshBasicMaterial | MeshPhysicalMaterial;
  if (mat.unlit || mat.shadingModel === 'unlit') {
    material = new MeshBasicMaterial(common);
  } else if (usePhysical) {
    material = new MeshPhysicalMaterial({
      ...common,
      roughness: mat.roughness,
      metalness: mat.metallic,
      flatShading: mat.flatShaded,
      emissive,
      transmission: mat.transmission,
      ior: mat.ior,
      clearcoat: mat.clearcoat,
      clearcoatRoughness: mat.clearcoatRoughness,
      thickness: 0.5,
    });
  } else {
    material = new MeshStandardMaterial({
      ...common,
      roughness: mat.roughness,
      metalness: mat.metallic,
      flatShading: mat.flatShaded,
      emissive,
    });
  }

  if (mat.alphaMode === 'mask') {
    material.transparent = false;
    material.alphaTest = mat.alphaCutoff;
  } else if (mat.alphaMode === 'blend' || mat.transmission > 0.01) {
    material.transparent = true;
    material.depthWrite = mat.opacity > 0.95 && mat.transmission < 0.05;
  }

  if (assets) {
    bindMaterialTexture(material, 'map', mat.baseColourTextureId, mat, assets, options, 'srgb');
    if (!mat.unlit && mat.shadingModel !== 'unlit') {
      bindMaterialTexture(material, 'normalMap', mat.normalTextureId, mat, assets, options, 'linear');
      bindMaterialTexture(material, 'roughnessMap', mat.roughnessTextureId, mat, assets, options, 'linear');
      bindMaterialTexture(material, 'metalnessMap', mat.metallicTextureId, mat, assets, options, 'linear');
      bindMaterialTexture(material, 'emissiveMap', mat.emissiveTextureId, mat, assets, options, 'srgb');
    }
    if (material.map && !options.forGltfExport) patchMaterialForAtlasTileRepeat(material);
  }

  return material;
}

function bindMaterialTexture(
  material: MeshStandardMaterial | MeshBasicMaterial | MeshPhysicalMaterial,
  slot: 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'emissiveMap',
  textureId: string | null,
  mat: MaterialAsset,
  assets: RenderAssetResolver,
  options: MaterialToThreeOptions,
  colourSpace: 'srgb' | 'linear',
): void {
  if (!textureId) return;
  const asset = assets.textures.get(textureId);
  const image = asset ? assets.images.get(asset.imageAssetId) : null;
  if (!asset || !image) return;

  const forGltf = !!options.forGltfExport;
  const pixels = forGltf
    ? flipImagePixelsVertically(image.pixels, image.width, image.height)
    : image.pixels;
  const texture = new DataTexture(pixels, image.width, image.height, RGBAFormat);
  texture.flipY = !forGltf;
  const useSrgb = colourSpace === 'srgb' || asset.colourSpace === 'srgb';
  texture.colorSpace = useSrgb ? SRGBColorSpace : NoColorSpace;
  const filtering = mat.textureFiltering ?? asset.filtering;
  const wrapping = mat.textureWrapping ?? asset.wrapping;
  texture.magFilter = filtering === 'nearest' ? NearestFilter : LinearFilter;
  texture.minFilter =
    filtering === 'nearest'
      ? NearestFilter
      : asset.generateMipmaps
        ? LinearMipmapLinearFilter
        : LinearFilter;
  texture.wrapS = texture.wrapT = wrapping === 'repeat' ? RepeatWrapping : ClampToEdgeWrapping;
  texture.repeat.set(asset.repeatU ?? 1, asset.repeatV ?? 1);
  texture.offset.set(asset.offsetU ?? 0, asset.offsetV ?? 0);
  texture.center.set(0.5, 0.5);
  texture.rotation = ((asset.rotationDegrees ?? 0) * Math.PI) / 180;
  texture.generateMipmaps = forGltf ? false : asset.generateMipmaps;
  texture.needsUpdate = true;
  if (slot === 'map') material.map = texture;
  else if (slot === 'normalMap') {
    if ('normalMap' in material) material.normalMap = texture;
  } else if (slot === 'roughnessMap') {
    if ('roughnessMap' in material) material.roughnessMap = texture;
  } else if (slot === 'metalnessMap') {
    if ('metalnessMap' in material) material.metalnessMap = texture;
  } else if (slot === 'emissiveMap') {
    if ('emissiveMap' in material) material.emissiveMap = texture;
  }
}

function disposeThreeMaterialMaps(material: Material): void {
  const maps = material as MeshStandardMaterial;
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap'] as const) {
    maps[key]?.dispose();
  }
}

/**
 * Wrap expanded atlas UVs into the per-corner tile rect (no mesh subdivision).
 * Uses a local UV in the fragment shader — assigning to varyings breaks WebGL.
 */
function patchMaterialForAtlasTileRepeat(
  material: MeshStandardMaterial | MeshBasicMaterial | MeshPhysicalMaterial,
): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <uv_pars_vertex>',
        `#include <uv_pars_vertex>
attribute vec4 atlasTileRect;
varying vec4 vAtlasTileRect;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
vAtlasTileRect = atlasTileRect;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <uv_pars_fragment>',
        `#include <uv_pars_fragment>
varying vec4 vAtlasTileRect;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
	vec2 atlasSampleUv = vMapUv;
	if (vAtlasTileRect.z > 1e-8 && vAtlasTileRect.w > 1e-8) {
		vec2 tileMin = vAtlasTileRect.xy;
		vec2 tileSpan = vAtlasTileRect.zw;
		vec2 local = (atlasSampleUv - tileMin) / tileSpan;
		atlasSampleUv = tileMin + fract(local) * tileSpan;
	}
	vec4 sampledDiffuseColor = texture2D( map, atlasSampleUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,
      );
  };
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousKey()}|atlasTileWrap`;
}

export type ObjectRenderHandle = {
  objectId: string;
  meshId: string;
  group: Group;
  mesh: Mesh;
  /** Logical-edge overlay (not render-triangle wireframe). */
  edgeOverlay: LineSegments;
  renderData: MeshRenderData;
  materials: Material[];
  materialSignature: string;
};

/** Build line segments from logical topology edges only (no triangulation diagonals). */
export function buildLogicalEdgeGeometry(mesh: EditableMesh): BufferGeometry {
  const positions: number[] = [];
  for (const edge of mesh.edges.values()) {
    const pair = getEdgeVertices(mesh, edge.id);
    if (!pair) continue;
    const a = mesh.vertices.get(pair[0])!.position;
    const b = mesh.vertices.get(pair[1])!.position;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

export function createObjectRenderHandle(
  objectId: string,
  mesh: EditableMesh,
  materials: MaterialAsset[],
  assets?: RenderAssetResolver,
): ObjectRenderHandle {
  const renderData = editableMeshToRenderData(mesh);
  const threeMats = materials.map((material) => materialAssetToThree(material, assets));
  const threeMesh = new Mesh(
    renderData.geometry,
    threeMats.length === 1 ? threeMats[0]! : threeMats,
  );
  threeMesh.name = mesh.name;
  threeMesh.renderOrder = 0;
  threeMesh.userData.objectId = objectId;
  threeMesh.userData.meshId = mesh.id;
  threeMesh.userData.triangleMap = renderData.triangleMap;

  const edgeOverlay = new LineSegments(
    buildLogicalEdgeGeometry(mesh),
    new LineBasicMaterial({
      color: 0x1a1f28,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    }),
  );
  edgeOverlay.renderOrder = 1;
  edgeOverlay.raycast = () => {};

  const group = new Group();
  group.name = objectId;
  group.add(threeMesh);
  group.add(edgeOverlay);

  return {
    objectId,
    meshId: mesh.id,
    group,
    mesh: threeMesh,
    edgeOverlay,
    renderData,
    materials: threeMats,
    materialSignature: renderMaterialSignature(materials, assets),
  };
}

export function updateObjectRenderHandle(
  handle: ObjectRenderHandle,
  mesh: EditableMesh,
  materials?: MaterialAsset[],
  assets?: RenderAssetResolver,
  deferFullEvaluation?: (handle: ObjectRenderHandle, mesh: EditableMesh) => void,
): void {
  if (materials) {
    const signature = renderMaterialSignature(materials, assets);
    if (signature !== handle.materialSignature) {
      for (const old of handle.materials) {
        disposeThreeMaterialMaps(old);
        old.dispose();
      }
      handle.materials = materials.map((material) => materialAssetToThree(material, assets));
      handle.mesh.material = handle.materials.length === 1 ? handle.materials[0]! : handle.materials;
      handle.materialSignature = signature;
    }
  }
  if (
    handle.renderData.geometryVersion === mesh.geometryVersion &&
    handle.renderData.topologyVersion === mesh.topologyVersion
  ) {
    return;
  }

  // Topology unchanged → rewrite positions and per-corner UVs in place.
  if (
    handle.renderData.topologyVersion === mesh.topologyVersion &&
    handle.renderData.renderVertexIds.length > 0
  ) {
    if (updateRenderPositionsInPlace(handle, mesh)) return;
  }

  if (deferFullEvaluation) {
    deferFullEvaluation(handle, mesh);
    return;
  }

  const prev = handle.renderData.geometry;
  const next = editableMeshToRenderData(mesh);
  handle.mesh.geometry = next.geometry;
  handle.mesh.userData.triangleMap = next.triangleMap;
  handle.renderData = next;
  prev.dispose();

  const prevEdges = handle.edgeOverlay.geometry;
  handle.edgeOverlay.geometry = buildLogicalEdgeGeometry(mesh);
  prevEdges.dispose();
}

/** Apply transferable worker output to an existing render handle. */
export function applyMeshEvaluation(handle: ObjectRenderHandle, result: MeshEvaluationResult, mesh: EditableMesh): void {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(result.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(result.normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(result.uvs, 2));
  geometry.setAttribute('atlasTileRect', new BufferAttribute(result.atlasTileRects, 4));
  if (result.secondaryUvs) geometry.setAttribute('uv1', new BufferAttribute(result.secondaryUvs, 2));
  geometry.setIndex(new BufferAttribute(result.indices, 1));
  for (const group of result.materialGroups) geometry.addGroup(group.start, group.count, group.materialSlot);
  const previous = handle.renderData.geometry;
  handle.mesh.geometry = geometry;
  handle.mesh.userData.triangleMap = result.triangleMap;
  handle.renderData = { geometry, ...result };
  previous.dispose();
  const previousEdges = handle.edgeOverlay.geometry;
  handle.edgeOverlay.geometry = buildLogicalEdgeGeometry(mesh);
  previousEdges.dispose();
}

/** Update mesh + edge overlay positions without reallocating geometry. */
export function updateRenderPositionsInPlace(handle: ObjectRenderHandle, mesh: EditableMesh): boolean {
  const posAttr = handle.mesh.geometry.getAttribute('position') as BufferAttribute | undefined;
  const uvAttr = handle.mesh.geometry.getAttribute('uv') as BufferAttribute | undefined;
  let tileAttr = handle.mesh.geometry.getAttribute('atlasTileRect') as BufferAttribute | undefined;
  const ids = handle.renderData.renderVertexIds;
  const cornerIds = handle.renderData.renderCornerIds;
  if (!posAttr || !uvAttr || ids.length !== posAttr.count || cornerIds.length !== uvAttr.count) return false;
  if (!tileAttr || tileAttr.count !== uvAttr.count) {
    tileAttr = new BufferAttribute(new Float32Array(uvAttr.count * 4), 4);
    handle.mesh.geometry.setAttribute('atlasTileRect', tileAttr);
  }

  let positionStart = Infinity;
  let positionEnd = -1;
  for (let i = 0; i < ids.length; i++) {
    const v = mesh.vertices.get(ids[i]!);
    if (!v) return false;
    if (posAttr.getX(i) !== v.position.x || posAttr.getY(i) !== v.position.y || posAttr.getZ(i) !== v.position.z) {
      posAttr.setXYZ(i, v.position.x, v.position.y, v.position.z);
      positionStart = Math.min(positionStart, i * 3);
      positionEnd = Math.max(positionEnd, i * 3 + 3);
    }
  }
  markPartialUpdate(posAttr, positionStart, positionEnd);
  const layerId = mesh.defaultUvLayerId;
  let uvStart = Infinity;
  let uvEnd = -1;
  let tileStart = Infinity;
  let tileEnd = -1;
  for (let i = 0; i < cornerIds.length; i++) {
    const corner = mesh.faceCorners.get(cornerIds[i]!);
    if (!corner) return false;
    const uv = layerId ? corner.uvs.get(layerId) : null;
    const u = uv?.x ?? 0;
    const v = uv?.y ?? 0;
    if (uvAttr.getX(i) !== u || uvAttr.getY(i) !== v) {
      uvAttr.setXY(i, u, v);
      uvStart = Math.min(uvStart, i * 2);
      uvEnd = Math.max(uvEnd, i * 2 + 2);
    }
    const tile = corner.atlasTile;
    const tileValues = [
      tile ? tile.minU : 0,
      tile ? tile.minV : 0,
      tile ? tile.maxU - tile.minU : 0,
      tile ? tile.maxV - tile.minV : 0,
    ] as const;
    if (tileAttr.getX(i) !== tileValues[0] || tileAttr.getY(i) !== tileValues[1] || tileAttr.getZ(i) !== tileValues[2] || tileAttr.getW(i) !== tileValues[3]) {
      tileAttr.setXYZW(i, ...tileValues);
      tileStart = Math.min(tileStart, i * 4);
      tileEnd = Math.max(tileEnd, i * 4 + 4);
    }
  }
  markPartialUpdate(uvAttr, uvStart, uvEnd);
  markPartialUpdate(tileAttr, tileStart, tileEnd);
  if (positionEnd >= 0) handle.mesh.geometry.computeBoundingSphere();

  const edgeAttr = handle.edgeOverlay.geometry.getAttribute('position') as BufferAttribute | undefined;
  if (edgeAttr) {
    let i = 0;
    let edgeStart = Infinity;
    let edgeEnd = -1;
    for (const edge of mesh.edges.values()) {
      const pair = getEdgeVertices(mesh, edge.id);
      if (!pair) continue;
      const a = mesh.vertices.get(pair[0])!.position;
      const b = mesh.vertices.get(pair[1])!.position;
      if (i + 1 >= edgeAttr.count) break;
      if (edgeAttr.getX(i) !== a.x || edgeAttr.getY(i) !== a.y || edgeAttr.getZ(i) !== a.z) {
        edgeAttr.setXYZ(i, a.x, a.y, a.z);
        edgeStart = Math.min(edgeStart, i * 3);
        edgeEnd = Math.max(edgeEnd, i * 3 + 3);
      }
      if (edgeAttr.getX(i + 1) !== b.x || edgeAttr.getY(i + 1) !== b.y || edgeAttr.getZ(i + 1) !== b.z) {
        edgeAttr.setXYZ(i + 1, b.x, b.y, b.z);
        edgeStart = Math.min(edgeStart, (i + 1) * 3);
        edgeEnd = Math.max(edgeEnd, (i + 1) * 3 + 3);
      }
      i += 2;
    }
    markPartialUpdate(edgeAttr, edgeStart, edgeEnd);
  }

  handle.renderData.geometryVersion = mesh.geometryVersion;
  return true;
}

function markPartialUpdate(attribute: BufferAttribute, start: number, end: number): void {
  if (!Number.isFinite(start) || end <= start) return;
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(start, end - start);
  attribute.needsUpdate = true;
}

function renderMaterialSignature(materials: MaterialAsset[], assets?: RenderAssetResolver): string {
  const textureRevision = (textureId: string | null) => {
    if (!textureId || !assets) return -1;
    const texture = assets.textures.get(textureId);
    const image = texture ? assets.images.get(texture.imageAssetId) : null;
    return image?.revision ?? -1;
  };
  return materials
    .map((mat) =>
      [
        mat.id,
        mat.presetId ?? '',
        mat.baseColour.x,
        mat.baseColour.y,
        mat.baseColour.z,
        mat.roughness,
        mat.metallic,
        mat.emissive.x,
        mat.emissive.y,
        mat.emissive.z,
        mat.emissiveIntensity,
        mat.opacity,
        mat.alphaMode,
        mat.alphaCutoff,
        mat.transmission,
        mat.ior,
        mat.clearcoat,
        mat.clearcoatRoughness,
        mat.flatShaded,
        mat.shadingModel,
        mat.unlit,
        mat.doubleSided,
        mat.textureFiltering,
        mat.textureWrapping,
        mat.baseColourTextureId ?? '',
        mat.normalTextureId ?? '',
        mat.roughnessTextureId ?? '',
        mat.metallicTextureId ?? '',
        mat.emissiveTextureId ?? '',
        textureRevision(mat.baseColourTextureId),
        textureRevision(mat.normalTextureId),
        textureRevision(mat.roughnessTextureId),
        textureRevision(mat.metallicTextureId),
        textureRevision(mat.emissiveTextureId),
        'pbr3',
      ].join(':'),
    )
    .join('|');
}

/** Resolve a Three.js face index hit to a logical face id. */
export function pickLogicalFace(
  triangleMap: PickTriangleMap[],
  faceIndex: number | undefined,
): FaceId | null {
  if (faceIndex == null || faceIndex < 0 || faceIndex >= triangleMap.length) return null;
  return triangleMap[faceIndex]!.faceId;
}
