import { describe, expect, it } from 'vitest';
import { defaultPrimitiveParameters, buildPrimitiveInCage, PRIMITIVE_KINDS } from '@/core/primitives/PrimitiveFactory';
import { computeFaceNormal } from '@/core/mesh/Normals';
import { validateMeshFull } from '@/core/mesh/Validation';
import { EditorSession } from '@/core/editor/EditorSession';
import { CreatePrimitiveTool } from '@/core/tools/CreatePrimitiveTool';
import { WORLD_XZ_PLANE } from '@/core/snap/SnapEngine';

const cage = { origin: { x: -1, y: 0, z: -1.5 }, axisU: { x: 1, y: 0, z: 0 }, axisV: { x: 0, y: 0, z: 1 }, axisNormal: { x: 0, y: 1, z: 0 }, sizeU: 2, sizeV: 3, sizeNormal: 4, minLocal: { x: 0, y: 0, z: 0 }, maxLocal: { x: 2, y: 4, z: 3 }, constructionPlaneId: 'top', creationDirection: 1 as const };

describe('universal primitive factory', () => {
  for (const kind of PRIMITIVE_KINDS) {
    it(`${kind} builds valid editable topology inside one cage`, () => {
      const mesh = buildPrimitiveInCage(kind, kind === 'plane' ? { ...cage, sizeNormal: 0 } : cage, defaultPrimitiveParameters(kind));
      const report = validateMeshFull(mesh);
      expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(mesh.faces.size).toBeGreaterThan(0);
      for (const vertex of mesh.vertices.values()) {
        expect(vertex.position.x).toBeGreaterThanOrEqual(cage.origin.x - 1e-8);
        expect(vertex.position.x).toBeLessThanOrEqual(cage.origin.x + cage.sizeU + 1e-8);
      }
    });
  }

  it('plane faces the construction-plane top, not the underside', () => {
    const top = buildPrimitiveInCage('plane', { ...cage, sizeNormal: 0 }, defaultPrimitiveParameters('plane'));
    const frontCage = {
      ...cage,
      axisU: { x: 1, y: 0, z: 0 },
      axisV: { x: 0, y: 1, z: 0 },
      axisNormal: { x: 0, y: 0, z: 1 },
      sizeNormal: 0,
      constructionPlaneId: 'front',
    };
    const rightCage = {
      ...cage,
      axisU: { x: 0, y: 0, z: 1 },
      axisV: { x: 0, y: 1, z: 0 },
      axisNormal: { x: 1, y: 0, z: 0 },
      sizeNormal: 0,
      constructionPlaneId: 'right',
    };
    const front = buildPrimitiveInCage('plane', frontCage, defaultPrimitiveParameters('plane'));
    const right = buildPrimitiveInCage('plane', rightCage, defaultPrimitiveParameters('plane'));
    const topN = computeFaceNormal(top, [...top.faces.keys()][0]!);
    const frontN = computeFaceNormal(front, [...front.faces.keys()][0]!);
    const rightN = computeFaceNormal(right, [...right.faces.keys()][0]!);
    expect(topN.y).toBeGreaterThan(0.9);
    expect(frontN.z).toBeGreaterThan(0.9);
    expect(rightN.x).toBeGreaterThan(0.9);
  });

  it('pyramid fills the construction cage like a cone', () => {
    const mesh = buildPrimitiveInCage('pyramid', cage, defaultPrimitiveParameters('pyramid'));
    const xs = [...mesh.vertices.values()].map((vertex) => vertex.position.x);
    const ys = [...mesh.vertices.values()].map((vertex) => vertex.position.y);
    const zs = [...mesh.vertices.values()].map((vertex) => vertex.position.z);
    expect(Math.min(...xs)).toBeCloseTo(cage.origin.x);
    expect(Math.max(...xs)).toBeCloseTo(cage.origin.x + cage.sizeU);
    expect(Math.min(...ys)).toBeCloseTo(cage.origin.y);
    expect(Math.max(...ys)).toBeCloseTo(cage.origin.y + cage.sizeNormal);
    expect(Math.min(...zs)).toBeCloseTo(cage.origin.z);
    expect(Math.max(...zs)).toBeCloseTo(cage.origin.z + cage.sizeV);
    const tip = [...mesh.vertices.values()].reduce((best, vertex) =>
      vertex.position.y > best.position.y ? vertex : best,
    );
    expect(tip.position.x).toBeCloseTo(cage.origin.x + cage.sizeU / 2);
    expect(tip.position.z).toBeCloseTo(cage.origin.z + cage.sizeV / 2);
  });

  it('pyramid tip follows a negative height drag', () => {
    const down = { ...cage, creationDirection: -1 as const, origin: { x: -1, y: -4, z: -1.5 } };
    const mesh = buildPrimitiveInCage('pyramid', down, defaultPrimitiveParameters('pyramid'));
    const ys = [...mesh.vertices.values()].map((vertex) => vertex.position.y);
    expect(Math.min(...ys)).toBeCloseTo(down.origin.y);
    expect(Math.max(...ys)).toBeCloseTo(down.origin.y + down.sizeNormal);
    const tip = [...mesh.vertices.values()].reduce((best, vertex) =>
      vertex.position.y < best.position.y ? vertex : best,
    );
    expect(tip.position.y).toBeCloseTo(down.origin.y);
  });

  it('uses logical n-gon caps on a 12-sided cylinder', () => {
    const mesh = buildPrimitiveInCage('cylinder', cage, defaultPrimitiveParameters('cylinder'));
    expect(mesh.vertices.size).toBe(24);
    expect(mesh.faces.size).toBe(14);
    expect([...mesh.faces.values()].filter((face) => {
      let count = 0, id = face.firstHalfEdgeId; const start = id; do { count++; id = mesh.halfEdges.get(id)!.nextHalfEdgeId; } while (id !== start); return count === 12;
    })).toHaveLength(2);
  });

  it('creates a top-view pyramid whose tip sits on the height of the cage', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-primitive') as CreatePrimitiveTool;
    tool.selectPrimitive('pyramid', session.context());
    session.constructionPlane = WORLD_XZ_PLANE;
    session.constructionPlaneId = 'top';
    const input = (origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }) => ({
      button: 'left' as const,
      screenX: 0,
      screenY: 0,
      worldPosition: null,
      rayOrigin: origin,
      rayDirection: direction,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
    });
    tool.begin(input({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }), session.context());
    tool.update(input({ x: 2, y: 10, z: 2 }, { x: 0, y: -1, z: 0 }), session.context());
    tool.begin(input({ x: 2, y: 10, z: 2 }, { x: 0, y: -1, z: 0 }), session.context());
    tool.update(input({ x: 2, y: 4, z: 10 }, { x: 0, y: 0, z: -1 }), session.context());
    tool.begin(input({ x: 2, y: 4, z: 10 }, { x: 0, y: 0, z: -1 }), session.context());
    expect(session.document.objects.size).toBe(1);
    const mesh = [...session.document.meshes.values()][0]!;
    const object = [...session.document.objects.values()][0]!;
    expect(object.transform.position.x).toBeCloseTo(1);
    expect(object.transform.position.z).toBeCloseTo(1);
    const xs = [...mesh.vertices.values()].map((vertex) => vertex.position.x);
    const ys = [...mesh.vertices.values()].map((vertex) => vertex.position.y);
    const zs = [...mesh.vertices.values()].map((vertex) => vertex.position.z);
    expect(Math.min(...xs)).toBeCloseTo(-1);
    expect(Math.max(...xs)).toBeCloseTo(1);
    expect(Math.min(...ys)).toBeCloseTo(-object.transform.position.y);
    expect(Math.max(...ys)).toBeCloseTo(object.transform.position.y);
    expect(Math.min(...zs)).toBeCloseTo(-1);
    expect(Math.max(...zs)).toBeCloseTo(1);
    const tip = [...mesh.vertices.values()].reduce((best, vertex) =>
      vertex.position.y > best.position.y ? vertex : best,
    );
    expect(tip.position.x).toBeCloseTo(0);
    expect(tip.position.z).toBeCloseTo(0);
    expect(tip.position.y).toBeCloseTo(object.transform.position.y);
  });

  it('creates a top-view cylinder as one undoable three-stage command', () => {
    const session=new EditorSession(),tool=session.tools.get('create-primitive') as CreatePrimitiveTool;tool.selectPrimitive('cylinder',session.context());session.constructionPlane=WORLD_XZ_PLANE;session.constructionPlaneId='top';
    const input=(origin:{x:number;y:number;z:number},direction:{x:number;y:number;z:number})=>({button:'left' as const,screenX:0,screenY:0,worldPosition:null,rayOrigin:origin,rayDirection:direction,shiftKey:false,ctrlKey:false,altKey:false});
    tool.begin(input({x:0,y:10,z:0},{x:0,y:-1,z:0}),session.context());
    tool.update(input({x:2,y:10,z:3},{x:0,y:-1,z:0}),session.context());
    tool.begin(input({x:2,y:10,z:3},{x:0,y:-1,z:0}),session.context());
    tool.update(input({x:2,y:4,z:10},{x:0,y:0,z:-1}),session.context());
    tool.begin(input({x:2,y:4,z:10},{x:0,y:0,z:-1}),session.context());
    expect(session.document.objects.size).toBe(1);const mesh=[...session.document.meshes.values()][0]!;expect(mesh.vertices.size).toBe(24);expect(mesh.faces.size).toBe(14);const objectId=[...session.document.objects.keys()][0]!;const object=session.document.objects.get(objectId)!;const meshId=mesh.id;
    expect(object.transform.position).toEqual({ x: 1, y: 2, z: 1.5 });
    const xs=[...mesh.vertices.values()].map((vertex)=>vertex.position.x),ys=[...mesh.vertices.values()].map((vertex)=>vertex.position.y),zs=[...mesh.vertices.values()].map((vertex)=>vertex.position.z);
    expect(Math.min(...xs)).toBeCloseTo(-1);expect(Math.max(...xs)).toBeCloseTo(1);
    expect(Math.min(...ys)).toBeCloseTo(-2);expect(Math.max(...ys)).toBeCloseTo(2);
    expect(Math.min(...zs)).toBeCloseTo(-1.5);expect(Math.max(...zs)).toBeCloseTo(1.5);
    expect(JSON.parse(object.metadata.primitiveOperation!)).toMatchObject({ kind: 'cylinder', cage: { constructionPlaneId: 'top' } });
    expect(session.undo()).toBe(true);expect(session.document.objects.size).toBe(0);expect(session.redo()).toBe(true);expect(session.document.objects.has(objectId)).toBe(true);expect(session.document.meshes.has(meshId)).toBe(true);
  });

  it('shows an idle ghost as soon as a primitive type is chosen', () => {
    const session = new EditorSession();
    const tool = session.tools.get('create-primitive') as CreatePrimitiveTool;
    expect(tool.getPreviewMesh()).toBeNull();
    tool.selectPrimitive('box', session.context());
    expect(tool.getIdleCage()).toBeTruthy();
    expect(tool.getPreviewMesh()?.faces.size).toBeGreaterThan(0);
  });

  it('cancels a centre-based proportional cage without touching the document', () => {
    const session=new EditorSession(),tool=session.tools.get('create-primitive') as CreatePrimitiveTool;const start={button:'left' as const,screenX:0,screenY:0,worldPosition:null,rayOrigin:{x:0,y:10,z:0},rayDirection:{x:0,y:-1,z:0},shiftKey:false,ctrlKey:false,altKey:true};tool.begin(start,session.context());tool.update({...start,rayOrigin:{x:2,y:10,z:1},shiftKey:true},session.context());const cage=tool.getCage()!;expect(cage.sizeU).toBe(cage.sizeV);expect(cage.sizeU).toBe(4);tool.cancel(session.context());expect(session.document.objects.size).toBe(0);expect(session.history.canUndo()).toBe(false);
  });
});
