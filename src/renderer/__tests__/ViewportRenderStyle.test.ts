import { describe, expect, it } from 'vitest';
import { normalizeShadingMode } from '@/workspace/types';
import { applyViewportRenderStyle, renderStyleShowsAllEdges } from '@/renderer/ViewportRenderStyle';
import { createObjectRenderHandle } from '@/renderer/MeshRenderAdapter';
import { createEmptyDocument, createMaterial, commitMeshObject } from '@/core/document/ModelDocument';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';

describe('ViewportRenderStyle', () => {
  it('normalizeShadingMode migrates legacy values', () => {
    expect(normalizeShadingMode('solid-wire')).toBe('outlines');
    expect(normalizeShadingMode('solid')).toBe('material');
    expect(normalizeShadingMode('game')).toBe('game');
    expect(normalizeShadingMode('silhouette')).toBe('silhouette');
  });

  it('applyViewportRenderStyle handles silhouette mode', () => {
    const doc = createEmptyDocument('Test');
    const built = buildBox({ width: 1, height: 1, depth: 1, name: 'Box' });
    commitMeshObject(doc, built, { name: 'Box' });
    const mesh = doc.meshes.get(built.id)!;
    const material = createMaterial(doc, { name: 'Mat' });
    const handle = createObjectRenderHandle('obj', mesh, [material], {
      textures: doc.textures,
      images: doc.images,
    });

    applyViewportRenderStyle(handle, 'silhouette');
    const std = handle.materials[0] as unknown as { wireframe: boolean; color: { getHex(): number } };
    expect(std.wireframe).toBe(false);
    expect(std.color.getHex()).toBe(0x1a1a1a);
  });

  it('applyViewportRenderStyle keeps authored shading in studio preview', () => {
    const doc = createEmptyDocument('Test');
    const built = buildBox({ width: 1, height: 1, depth: 1, name: 'Box' });
    commitMeshObject(doc, built, { name: 'Box' });
    const mesh = doc.meshes.get(built.id)!;
    const material = createMaterial(doc, { name: 'Mat' });
    material.unlit = false;
    material.shadingModel = 'lit';
    material.flatShaded = false;
    const handle = createObjectRenderHandle('obj', mesh, [material], {
      textures: doc.textures,
      images: doc.images,
    });

    applyViewportRenderStyle(handle, 'wireframe');
    expect((handle.materials[0] as unknown as { wireframe: boolean }).wireframe).toBe(true);

    applyViewportRenderStyle(handle, 'game');
    expect((handle.materials[0] as unknown as { wireframe: boolean }).wireframe).toBe(false);
    expect((handle.materials[0] as unknown as { flatShading?: boolean }).flatShading).toBe(false);

    applyViewportRenderStyle(handle, 'material');
    expect((handle.materials[0] as unknown as { flatShading?: boolean }).flatShading).toBe(false);
  });

  it('restores a map assigned after the first baseline capture', () => {
    const doc = createEmptyDocument('Test');
    const built = buildBox({ width: 1, height: 1, depth: 1, name: 'Box' });
    commitMeshObject(doc, built, { name: 'Box' });
    const mesh = doc.meshes.get(built.id)!;
    const material = [...doc.materials.values()][0]!;
    const handle = createObjectRenderHandle('obj', mesh, [material]);
    const std = handle.materials[0] as unknown as { map: { uuid: string } | null };
    expect(std.map).toBeNull();
    applyViewportRenderStyle(handle, 'material');
    const map = { uuid: 'late-map' };
    std.map = map;
    applyViewportRenderStyle(handle, 'silhouette');
    expect(std.map).toBeNull();
    applyViewportRenderStyle(handle, 'material');
    expect(std.map).toBe(map);
  });

  it('keeps maps on by default and can hide them', () => {
    const doc = createEmptyDocument('Test');
    const built = buildBox({ width: 1, height: 1, depth: 1, name: 'Box' });
    commitMeshObject(doc, built, { name: 'Box' });
    const mesh = doc.meshes.get(built.id)!;
    const material = [...doc.materials.values()][0]!;
    const handle = createObjectRenderHandle('obj', mesh, [material], {
      textures: doc.textures,
      images: doc.images,
    });
    const std = handle.materials[0] as unknown as { map: unknown };
    expect(std.map).toBeTruthy();
    applyViewportRenderStyle(handle, 'material');
    expect(std.map).toBeTruthy();
    applyViewportRenderStyle(handle, 'material', { displayTextures: false });
    expect(std.map).toBeNull();
    applyViewportRenderStyle(handle, 'material', { displayTextures: true });
    expect(std.map).toBeTruthy();
  });

  it('makes solids see-through in X-Ray and restores them after', () => {
    const doc = createEmptyDocument('Test');
    const built = buildBox({ width: 1, height: 1, depth: 1, name: 'Box' });
    commitMeshObject(doc, built, { name: 'Box' });
    const mesh = doc.meshes.get(built.id)!;
    const material = [...doc.materials.values()][0]!;
    const handle = createObjectRenderHandle('obj', mesh, [material]);
    const std = handle.materials[0] as unknown as {
      opacity: number;
      transparent: boolean;
      depthWrite: boolean;
      side: number;
    };
    applyViewportRenderStyle(handle, 'material');
    expect(std.opacity).toBe(1);
    expect(std.transparent).toBe(false);
    applyViewportRenderStyle(handle, 'material', { xRay: true });
    expect(std.transparent).toBe(true);
    expect(std.opacity).toBeLessThan(0.5);
    expect(std.depthWrite).toBe(false);
    applyViewportRenderStyle(handle, 'material', { xRay: false });
    expect(std.opacity).toBe(1);
    expect(std.transparent).toBe(false);
    expect(std.depthWrite).toBe(true);
  });

  it('renderStyleShowsAllEdges only for the topology outline mode', () => {
    expect(renderStyleShowsAllEdges('material')).toBe(false);
    expect(renderStyleShowsAllEdges('outlines')).toBe(true);
    expect(renderStyleShowsAllEdges('game')).toBe(false);
    expect(renderStyleShowsAllEdges('silhouette')).toBe(false);
  });
});
