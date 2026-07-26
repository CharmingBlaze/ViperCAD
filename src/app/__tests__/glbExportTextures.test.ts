import { describe, expect, it } from 'vitest';
import { bakeAtlasTilesForExport, wrapIntoRange } from '@/app/AtlasGltfBake';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { faceCornerIds } from '@/core/mesh/EditableMesh';
import { applyAtlasTileToFaces } from '@/core/uv/AtlasUv';
import { flipImagePixelsVertically, materialAssetToThree } from '@/renderer/MeshRenderAdapter';
import type { ImageAsset, MaterialAsset, TextureAsset } from '@/core/document/types';

describe('GLB texture export helpers', () => {
  it('flips RGBA rows so glTF top-left matches V-up authored UVs', () => {
    // 2x2: top row red, bottom row blue
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255, 255, 0, 0, 255,
      0, 0, 255, 255, 0, 0, 255, 255,
    ]);
    const flipped = flipImagePixelsVertically(pixels, 2, 2);
    expect([...flipped.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
    expect([...flipped.subarray(8, 12)]).toEqual([255, 0, 0, 255]);
  });

  it('builds export materials with flipY=false and pre-flipped pixels', () => {
    const image: ImageAsset = {
      id: 'img',
      name: 'Atlas',
      width: 2,
      height: 2,
      colourMode: 'rgba',
      pixels: new Uint8ClampedArray([
        255, 0, 0, 255, 255, 0, 0, 255,
        0, 0, 255, 255, 0, 0, 255, 255,
      ]),
      revision: 1,
    };
    const texture: TextureAsset = {
      id: 'tex',
      name: 'AtlasTex',
      imageAssetId: image.id,
      colourSpace: 'srgb',
      filtering: 'nearest',
      wrapping: 'clamp',
      generateMipmaps: false,
    };
    const material: MaterialAsset = {
      id: 'mat',
      name: 'Mat',
      shadingModel: 'lit',
      presetId: null,
      baseColour: { x: 1, y: 1, z: 1 },
      baseColourTextureId: texture.id,
      normalTextureId: null,
      roughness: 1,
      roughnessTextureId: null,
      metallic: 0,
      metallicTextureId: null,
      emissive: { x: 0, y: 0, z: 0 },
      emissiveIntensity: 1,
      emissiveTextureId: null,
      opacity: 1,
      alphaMode: 'opaque',
      alphaCutoff: 0.5,
      transmission: 0,
      ior: 1.5,
      clearcoat: 0,
      clearcoatRoughness: 0.03,
      doubleSided: false,
      unlit: false,
      flatShaded: true,
      textureFiltering: 'nearest',
      textureWrapping: 'clamp',
      uvLayerIndex: 0,
    };
    const three = materialAssetToThree(material, {
      textures: new Map([[texture.id, texture]]),
      images: new Map([[image.id, image]]),
    }, { forGltfExport: true });
    expect(three.map).toBeTruthy();
    expect(three.map!.flipY).toBe(false);
    const imageData = three.map!.image as { data: Uint8Array };
    expect([...imageData.data.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
  });

  it('wraps expanded atlas UVs into the tile rect', () => {
    // Matches GLSL fract used by the viewport wrap shader.
    expect(wrapIntoRange(0.25 + 2 * 0.25, 0.25, 0.25)).toBeCloseTo(0.25);
    expect(wrapIntoRange(0.25, 0.25, 0.25)).toBeCloseTo(0.25);
    expect(wrapIntoRange(0.25 + 0.5 * 0.25, 0.25, 0.25)).toBeCloseTo(0.25 + 0.5 * 0.25);
  });

  it('bakes repeated atlas tiles into subdivided faces with in-rect UVs', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const layerId = mesh.defaultUvLayerId!;
    const faceId = [...mesh.faces.keys()][0]!;
    applyAtlasTileToFaces(mesh, [faceId], layerId, {
      imageWidth: 64,
      imageHeight: 64,
      x: 16,
      y: 16,
      width: 16,
      height: 16,
      repeatU: 3,
      repeatV: 2,
    });
    expect(faceCornerIds(mesh, faceId).some((id) => mesh.faceCorners.get(id)?.atlasTile)).toBe(true);

    const baked = bakeAtlasTilesForExport(mesh);
    expect(baked.faces.size).toBe(mesh.faces.size - 1 + 3 * 2);

    let tiledFaces = 0;
    for (const id of baked.faces.keys()) {
      const cornerIds = faceCornerIds(baked, id);
      for (const cornerId of cornerIds) {
        expect(baked.faceCorners.get(cornerId)!.atlasTile).toBeNull();
      }
      const uvs = cornerIds.map((cornerId) => baked.faceCorners.get(cornerId)!.uvs.get(layerId)!);
      const inTile = uvs.every(
        (uv) =>
          uv.x >= 16 / 64 - 1e-5 &&
          uv.x <= 32 / 64 + 1e-5 &&
          uv.y >= 32 / 64 - 1e-5 &&
          uv.y <= 48 / 64 + 1e-5,
      );
      if (inTile) tiledFaces += 1;
    }
    expect(tiledFaces).toBe(3 * 2);
    // Source mesh untouched.
    expect(faceCornerIds(mesh, faceId).some((id) => mesh.faceCorners.get(id)?.atlasTile)).toBe(true);
  });
});
