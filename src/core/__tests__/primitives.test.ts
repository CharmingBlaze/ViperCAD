import { describe, expect, it } from 'vitest';
import { defaultPrimitiveParameters, buildPrimitiveInCage, PRIMITIVE_KINDS } from '@/core/primitives/PrimitiveFactory';
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

  it('uses logical n-gon caps on a 12-sided cylinder', () => {
    const mesh = buildPrimitiveInCage('cylinder', cage, defaultPrimitiveParameters('cylinder'));
    expect(mesh.vertices.size).toBe(24);
    expect(mesh.faces.size).toBe(14);
    expect([...mesh.faces.values()].filter((face) => {
      let count = 0, id = face.firstHalfEdgeId; const start = id; do { count++; id = mesh.halfEdges.get(id)!.nextHalfEdgeId; } while (id !== start); return count === 12;
    })).toHaveLength(2);
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

  it('cancels a centre-based proportional cage without touching the document', () => {
    const session=new EditorSession(),tool=session.tools.get('create-primitive') as CreatePrimitiveTool;const start={button:'left' as const,screenX:0,screenY:0,worldPosition:null,rayOrigin:{x:0,y:10,z:0},rayDirection:{x:0,y:-1,z:0},shiftKey:false,ctrlKey:false,altKey:true};tool.begin(start,session.context());tool.update({...start,rayOrigin:{x:2,y:10,z:1},shiftKey:true},session.context());const cage=tool.getCage()!;expect(cage.sizeU).toBe(cage.sizeV);expect(cage.sizeU).toBe(4);tool.cancel(session.context());expect(session.document.objects.size).toBe(0);expect(session.history.canUndo()).toBe(false);
  });
});
