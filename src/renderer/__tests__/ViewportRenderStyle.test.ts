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
  });

  it('applyViewportRenderStyle toggles wireframe and flat shading', () => {
    const doc = createEmptyDocument('Test');
    const built = buildBox({ width: 1, height: 1, depth: 1, name: 'Box' });
    commitMeshObject(doc, built, { name: 'Box' });
    const mesh = doc.meshes.get(built.id)!;
    const material = createMaterial(doc, { name: 'Mat' });
    material.flatShaded = false;
    const handle = createObjectRenderHandle('obj', mesh, [material], {
      textures: doc.textures,
      images: doc.images,
    });

    applyViewportRenderStyle(handle, 'wireframe');
    expect((handle.materials[0] as { wireframe?: boolean })?.wireframe).toBe(true);

    applyViewportRenderStyle(handle, 'game');
    expect((handle.materials[0] as { wireframe?: boolean })?.wireframe).toBe(false);
    expect((handle.materials[0] as { flatShading?: boolean }).flatShading).toBe(true);

    applyViewportRenderStyle(handle, 'material');
    expect((handle.materials[0] as { flatShading?: boolean }).flatShading).toBe(false);
  });

  it('renderStyleShowsAllEdges for outlines and game modes', () => {
    expect(renderStyleShowsAllEdges('material')).toBe(false);
    expect(renderStyleShowsAllEdges('outlines')).toBe(true);
    expect(renderStyleShowsAllEdges('game')).toBe(true);
  });
});
