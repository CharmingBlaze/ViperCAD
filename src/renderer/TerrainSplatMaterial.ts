import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  Vector4,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  type IUniform,
  type Material,
  type MeshBasicMaterial,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
  type Texture,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import type { ImageAsset, TextureAsset } from '@/core/document/types';
import {
  getTerrainLayerStack,
  meshHasTerrainLayers,
  type TerrainLayerSpec,
} from '@/core/terrain/TerrainLayers';
import type { EditableMesh } from '@/core/mesh/types';

type TerrainThreeMaterial = MeshStandardMaterial | MeshBasicMaterial | MeshPhysicalMaterial;

type SplatUniforms = {
  uSplatColor0: IUniform<Color>;
  uSplatColor1: IUniform<Color>;
  uSplatColor2: IUniform<Color>;
  uSplatColor3: IUniform<Color>;
  uSplatVis: IUniform<Vector4>;
  uSplatTiling: IUniform<Vector4>;
  uSplatHasMap: IUniform<Vector4>;
  uSplatMix: IUniform<number>;
  uSplatMap0: IUniform<Texture | null>;
  uSplatMap1: IUniform<Texture | null>;
  uSplatMap2: IUniform<Texture | null>;
  uSplatMap3: IUniform<Texture | null>;
};

type SplatState = {
  uniforms: SplatUniforms;
  maps: Array<Texture | null>;
  mapKey: string;
};

const EMPTY_MAPS: Array<Texture | null> = [null, null, null, null];

export type TerrainSplatSyncOptions = {
  /** 0 = authored albedo / atlas, 1 = layer splat. Used in UV/Paint. */
  albedoPreview?: boolean;
};

export function syncTerrainSplatMaterials(
  materials: Material[],
  mesh: EditableMesh,
  assets?: { textures: Map<string, TextureAsset>; images: Map<string, ImageAsset> },
  options?: TerrainSplatSyncOptions,
): void {
  if (!meshHasTerrainLayers(mesh)) return;
  const layers = getTerrainLayerStack(mesh);
  for (const material of materials) {
    applyTerrainSplatMaterial(material as TerrainThreeMaterial, layers, assets, options);
  }
}

export function applyTerrainSplatMaterial(
  material: TerrainThreeMaterial,
  layers: TerrainLayerSpec[],
  assets?: { textures: Map<string, TextureAsset>; images: Map<string, ImageAsset> },
  options?: TerrainSplatSyncOptions,
): void {
  material.vertexColors = true;
  const state = ensureSplatState(material);
  const mapKey = layers.slice(0, 4).map((layer) => layer.textureAssetId ?? '').join('|');
  if (state.mapKey !== mapKey) {
    const nextMaps = layers.slice(0, 4).map((layer) => createLayerTexture(layer, assets));
    for (const old of state.maps) disposeSplatMap(old);
    state.maps = nextMaps;
    state.mapKey = mapKey;
  }
  writeSplatUniforms(state.uniforms, layers, state.maps, options?.albedoPreview === true);
}

export function disposeTerrainSplatMaterial(material: Material): void {
  const state = (material.userData as { terrainSplat?: SplatState }).terrainSplat;
  if (!state) return;
  for (const map of state.maps) disposeSplatMap(map);
  state.maps = [...EMPTY_MAPS];
}

function ensureSplatState(material: TerrainThreeMaterial): SplatState {
  const existing = (material.userData as { terrainSplat?: SplatState }).terrainSplat;
  if (existing) {
    if (!existing.uniforms.uSplatMix) existing.uniforms.uSplatMix = { value: 1 };
    return existing;
  }

  const uniforms: SplatUniforms = {
    uSplatColor0: { value: new Color('#4a7c59') },
    uSplatColor1: { value: new Color('#7a5a3a') },
    uSplatColor2: { value: new Color('#686b73') },
    uSplatColor3: { value: new Color('#e8edf5') },
    uSplatVis: { value: new Vector4(1, 1, 1, 1) },
    uSplatTiling: { value: new Vector4(8, 8, 12, 6) },
    uSplatHasMap: { value: new Vector4(0, 0, 0, 0) },
    uSplatMix: { value: 1 },
    uSplatMap0: { value: null },
    uSplatMap1: { value: null },
    uSplatMap2: { value: null },
    uSplatMap3: { value: null },
  };
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => {
    if (typeof previous === 'function') previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uSplatColor0;
uniform vec3 uSplatColor1;
uniform vec3 uSplatColor2;
uniform vec3 uSplatColor3;
uniform vec4 uSplatVis;
uniform vec4 uSplatTiling;
uniform vec4 uSplatHasMap;
uniform float uSplatMix;
uniform sampler2D uSplatMap0;
uniform sampler2D uSplatMap1;
uniform sampler2D uSplatMap2;
uniform sampler2D uSplatMap3;`,
      )
      .replace(
        '#include <color_fragment>',
        `#ifdef USE_COLOR
	vec4 splatW = vec4(vColor.r, vColor.g, vColor.b, max(0.0, 1.0 - vColor.r - vColor.g - vColor.b));
	splatW *= uSplatVis;
	float splatSum = max(1e-5, splatW.x + splatW.y + splatW.z + splatW.w);
	splatW /= splatSum;
	vec2 splatUv = vec2(0.0);
	#ifdef USE_MAP
	splatUv = vMapUv;
	#elif defined(USE_UV)
	splatUv = vUv;
	#endif
	vec3 splat0 = uSplatColor0;
	vec3 splat1 = uSplatColor1;
	vec3 splat2 = uSplatColor2;
	vec3 splat3 = uSplatColor3;
	if (uSplatHasMap.x > 0.5) splat0 *= texture2D(uSplatMap0, splatUv * max(0.01, uSplatTiling.x)).rgb;
	if (uSplatHasMap.y > 0.5) splat1 *= texture2D(uSplatMap1, splatUv * max(0.01, uSplatTiling.y)).rgb;
	if (uSplatHasMap.z > 0.5) splat2 *= texture2D(uSplatMap2, splatUv * max(0.01, uSplatTiling.z)).rgb;
	if (uSplatHasMap.w > 0.5) splat3 *= texture2D(uSplatMap3, splatUv * max(0.01, uSplatTiling.w)).rgb;
	vec3 splatRgb = splatW.x * splat0 + splatW.y * splat1 + splatW.z * splat2 + splatW.w * splat3;
	diffuseColor.rgb = mix(diffuseColor.rgb, splatRgb, clamp(uSplatMix, 0.0, 1.0));
#endif`,
      );
  };
  const prevKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${prevKey()}|terrain-splat-v2`;
  const state: SplatState = { uniforms, maps: [...EMPTY_MAPS], mapKey: '' };
  material.userData.terrainSplat = state;
  material.needsUpdate = true;
  return state;
}

function writeSplatUniforms(
  uniforms: SplatUniforms,
  layers: TerrainLayerSpec[],
  maps: Array<Texture | null>,
  albedoPreview: boolean,
): void {
  const colors = [uniforms.uSplatColor0, uniforms.uSplatColor1, uniforms.uSplatColor2, uniforms.uSplatColor3];
  const vis = [0, 0, 0, 0];
  const tiling = [8, 8, 8, 8];
  const hasMap = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const layer = layers[i];
    colors[i]!.value.set(layer?.color || '#808080');
    vis[i] = layer && layer.visible !== false ? 1 : 0;
    tiling[i] = Math.max(0.01, layer?.tiling ?? 8);
    hasMap[i] = maps[i] ? 1 : 0;
  }
  uniforms.uSplatVis.value.set(vis[0], vis[1], vis[2], vis[3]);
  uniforms.uSplatTiling.value.set(tiling[0], tiling[1], tiling[2], tiling[3]);
  uniforms.uSplatHasMap.value.set(hasMap[0], hasMap[1], hasMap[2], hasMap[3]);
  uniforms.uSplatMix.value = albedoPreview ? 0 : 1;
  uniforms.uSplatMap0.value = maps[0] ?? null;
  uniforms.uSplatMap1.value = maps[1] ?? null;
  uniforms.uSplatMap2.value = maps[2] ?? null;
  uniforms.uSplatMap3.value = maps[3] ?? null;
}

function createLayerTexture(
  layer: TerrainLayerSpec | undefined,
  assets?: { textures: Map<string, TextureAsset>; images: Map<string, ImageAsset> },
): Texture | null {
  if (!layer?.textureAssetId || !assets) return null;
  const asset = assets.textures.get(layer.textureAssetId);
  const image = asset ? assets.images.get(asset.imageAssetId) : null;
  if (!asset || !image) return null;
  const pixels = image.pixels instanceof Uint8ClampedArray
    ? new Uint8Array(image.pixels)
    : new Uint8Array(image.pixels);
  const texture = new DataTexture(pixels, image.width, image.height, RGBAFormat);
  texture.flipY = true;
  texture.unpackAlignment = 1;
  texture.colorSpace = SRGBColorSpace;
  const powerOfTwo = isPowerOfTwo(image.width) && isPowerOfTwo(image.height);
  const filtering = asset.filtering ?? 'linear';
  texture.magFilter = filtering === 'nearest' ? NearestFilter : LinearFilter;
  texture.minFilter =
    filtering === 'nearest' ? NearestFilter : powerOfTwo ? LinearMipmapLinearFilter : LinearFilter;
  texture.wrapS = texture.wrapT = powerOfTwo ? RepeatWrapping : ClampToEdgeWrapping;
  texture.generateMipmaps = powerOfTwo && filtering !== 'nearest';
  texture.needsUpdate = true;
  return texture;
}

function disposeSplatMap(texture: Texture | null): void {
  if (!texture || texture.userData.viperSharedPlaceholder) return;
  texture.dispose();
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}
