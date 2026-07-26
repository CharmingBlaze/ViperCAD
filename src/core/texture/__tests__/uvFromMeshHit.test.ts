import { describe, expect, it } from 'vitest';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { editableMeshToRenderData } from '@/renderer/MeshRenderAdapter';
import { createEmptyDocument, commitMeshObject } from '@/core/document/ModelDocument';
import { stampBrushUv } from '@/core/image/paintBrush';
import { PixelStrokeRecorder } from '@/core/image/PixelStroke';
import { createImageAsset, getPixel } from '@/core/image/PixelEditor';
import {
  resolveImageForFace,
  uvFromTriangleHit,
  uvToPixel,
} from '@/core/texture/uvFromMeshHit';

describe('uvFromMeshHit', () => {
  it('interpolates UV from triangle barycentrics', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const data = editableMeshToRenderData(mesh);
    expect(data.triangleMap.length).toBeGreaterThan(0);
    const hit = uvFromTriangleHit(
      mesh,
      data.triangleMap,
      0,
      { x: 1, y: 0, z: 0 },
      null,
    );
    expect(hit).not.toBeNull();
    expect(Number.isFinite(hit!.uv.x)).toBe(true);
    expect(Number.isFinite(hit!.uv.y)).toBe(true);
  });

  it('prefers Three.js UV when provided', () => {
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const data = editableMeshToRenderData(mesh);
    const hit = uvFromTriangleHit(
      mesh,
      data.triangleMap,
      0,
      { x: 0.3, y: 0.3, z: 0.4 },
      { x: 0.25, y: 0.75 },
    );
    expect(hit!.uv.x).toBeCloseTo(0.25);
    expect(hit!.uv.y).toBeCloseTo(0.75);
  });

  it('paints a brush stamp through UV onto the object texture', () => {
    const doc = createEmptyDocument();
    const { objectId } = commitMeshObject(doc, buildBox({ width: 1, height: 1, depth: 1 }));
    const object = doc.objects.get(objectId)!;
    const mesh = doc.meshes.get(object.meshId!)!;
    const faceId = [...mesh.faces.keys()][0]!;
    const image = resolveImageForFace(doc, objectId, faceId);
    expect(image).not.toBeNull();

    const stroke = new PixelStrokeRecorder();
    stroke.begin(image!);
    const painted = stampBrushUv(
      image!,
      { x: 0.5, y: 0.5 },
      3,
      [255, 0, 0, 255],
      stroke,
      'square',
    );
    expect(painted).toBeGreaterThan(0);
    const p = uvToPixel(image!, { x: 0.5, y: 0.5 });
    expect(getPixel(image!, p.x, p.y)).toEqual([255, 0, 0, 255]);
  });

  it('wraps paint coordinates on repeating terrain-style UVs', () => {
    const image = createImageAsset(createEmptyDocument(), 'Repeat', 16, 16);
    expect(uvToPixel(image, { x: 2.25, y: -1.75 })).toEqual(
      uvToPixel(image, { x: 0.25, y: 0.25 }),
    );
  });
});
