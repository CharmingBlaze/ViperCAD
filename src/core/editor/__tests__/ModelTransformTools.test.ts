import { describe, expect, it } from 'vitest';
import { createEmptyDocument, commitMeshObject } from '@/core/document/ModelDocument';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import {
  centerObjectsOnAxis,
  duplicateAndMirrorFaces,
  duplicateAndMirrorObjects,
  flipObjectScale,
  mirrorObjectAcrossWorld,
  rotateObjectsDegrees,
  snapObjectsToGround,
} from '../ModelTransformTools';

describe('ModelTransformTools', () => {
  it('flips object scale along axis', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId: objId } = commitMeshObject(doc, mesh, { name: 'TestBox' });

    expect(doc.objects.get(objId)!.transform.scale.x).toBe(1);
    flipObjectScale(doc, [objId], 'x');
    expect(doc.objects.get(objId)!.transform.scale.x).toBe(-1);
    flipObjectScale(doc, [objId], 'x');
    expect(doc.objects.get(objId)!.transform.scale.x).toBe(1);
  });

  it('mirrors object across world center', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId: objId } = commitMeshObject(doc, mesh, { name: 'Wheel' });
    const obj = doc.objects.get(objId)!;
    obj.transform.position.x = 2.5;

    mirrorObjectAcrossWorld(doc, [objId], 'x');
    expect(obj.transform.position.x).toBe(-2.5);
    expect(obj.transform.scale.x).toBe(-1);
  });

  it('duplicates and mirrors objects to other side', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId: srcId } = commitMeshObject(doc, mesh, { name: 'Wheel_L' });
    const src = doc.objects.get(srcId)!;
    src.transform.position.x = 1.8;

    const [dupId] = duplicateAndMirrorObjects(doc, [srcId], 'x');
    expect(dupId).toBeDefined();
    const dup = doc.objects.get(dupId!)!;
    expect(dup.transform.position.x).toBe(-1.8);
    expect(dup.transform.scale.x).toBe(-1);
    expect(dup.name).toContain('MirrorX');
  });

  it('rotates objects by degrees', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId: objId } = commitMeshObject(doc, mesh, { name: 'Box' });
    const obj = doc.objects.get(objId)!;

    rotateObjectsDegrees(doc, [objId], 'y', 90);
    expect(obj.transform.rotation.y).toBeCloseTo(Math.PI / 2, 4);
  });

  it('centers object on axis and snaps to ground', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    const { objectId: objId } = commitMeshObject(doc, mesh, { name: 'Car' });
    const obj = doc.objects.get(objId)!;
    obj.transform.position.x = 5;
    obj.transform.position.y = 10;

    centerObjectsOnAxis(doc, [objId], 'x');
    expect(obj.transform.position.x).toBe(0);

    snapObjectsToGround(doc, [objId]);
    expect(obj.transform.position.y).toBeCloseTo(1, 4); // half height = 1
  });

  it('duplicates and mirrors mesh faces across X=0', () => {
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    const initialFaceCount = mesh.faces.size;

    // Pick 1 face strictly on +X side
    let faceId: string | null = null;
    for (const [fId] of mesh.faces) {
      faceId = fId;
      break;
    }
    expect(faceId).not.toBeNull();

    const { newFaceIds } = duplicateAndMirrorFaces(mesh, [faceId!], 'x');
    expect(newFaceIds.length).toBe(1);
    expect(mesh.faces.size).toBe(initialFaceCount + 1);
  });
});
