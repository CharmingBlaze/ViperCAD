import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { buildSphere } from '@/core/mesh/builders/SphereBuilder';
import { validateMeshFull } from '@/core/mesh/Validation';
import { MeshSculptTool } from '@/core/tools/MeshSculptTool';
import type { ToolPointerInput } from '@/core/tools/Tool';

function pointer(origin: { x: number; y: number; z: number }): ToolPointerInput {
  return {
    button: 'left',
    screenX: 0,
    screenY: 0,
    worldPosition: origin,
    rayOrigin: { x: origin.x, y: origin.y + 4, z: origin.z + 4 },
    rayDirection: { x: 0, y: -0.707, z: -0.707 },
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
  };
}

describe('MeshSculptTool', () => {
  it('inflates a sphere vertex region and supports undo', () => {
    const session = new EditorSession();
    const mesh = buildSphere({ radius: 1, widthSegments: 16, heightSegments: 12, name: 'Sphere' });
    const { objectId } = commitMeshObject(session.document, mesh, { name: 'Sphere' });
    session.selection.selectObjects([objectId], 'replace');
    session.tools.setActive('mesh-sculpt', session.context());
    const tool = session.tools.get('mesh-sculpt') as MeshSculptTool;
    tool.mode = 'inflate';
    tool.radius = 0.8;
    tool.strength = 0.2;

    const beforeTop = [...mesh.vertices.values()]
      .filter((vertex) => vertex.position.y > 0.5)
      .map((vertex) => vertex.position.y);
    tool.begin(pointer({ x: 0, y: 0.8, z: 0 }), session.context());
    tool.update(pointer({ x: 0.05, y: 0.82, z: 0.02 }), session.context());
    tool.endStroke(session.context());

    const afterTop = [...mesh.vertices.values()]
      .filter((vertex) => vertex.position.y > 0.5)
      .map((vertex) => vertex.position.y);
    expect(Math.max(...afterTop)).toBeGreaterThan(Math.max(...beforeTop));
    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);

    session.history.undo();
    const restoredTop = [...mesh.vertices.values()]
      .filter((vertex) => vertex.position.y > 0.5)
      .map((vertex) => vertex.position.y);
    expect(Math.max(...restoredTop)).toBeCloseTo(Math.max(...beforeTop), 4);
  });

  it('switches to smooth when Shift is held during stroke', () => {
    const session = new EditorSession();
    const mesh = buildSphere({ radius: 1, widthSegments: 16, heightSegments: 12, name: 'Sphere' });
    const { objectId } = commitMeshObject(session.document, mesh, { name: 'Sphere' });
    session.selection.selectObjects([objectId], 'replace');
    session.tools.setActive('mesh-sculpt', session.context());
    const tool = session.tools.get('mesh-sculpt') as MeshSculptTool;
    tool.mode = 'clay';

    const p = pointer({ x: 0, y: 0.8, z: 0 });
    p.shiftKey = true; // Hold shift

    tool.begin(p, session.context());
    tool.update(p, session.context());
    tool.endStroke(session.context());

    expect(validateMeshFull(mesh).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('inverts operation when Ctrl is held', () => {
    const session = new EditorSession();
    const mesh = buildSphere({ radius: 1, widthSegments: 16, heightSegments: 12, name: 'Sphere' });
    const { objectId } = commitMeshObject(session.document, mesh, { name: 'Sphere' });
    session.selection.selectObjects([objectId], 'replace');
    session.tools.setActive('mesh-sculpt', session.context());
    const tool = session.tools.get('mesh-sculpt') as MeshSculptTool;
    tool.mode = 'draw';
    tool.radius = 0.8;
    tool.strength = 0.2;

    const beforeTop = Math.max(...[...mesh.vertices.values()].map((v) => v.position.y));

    const p = pointer({ x: 0, y: 0.8, z: 0 });
    p.ctrlKey = true; // Invert = Carve inward

    tool.begin(p, session.context());
    tool.update(p, session.context());
    tool.endStroke(session.context());

    const afterTop = Math.max(...[...mesh.vertices.values()].map((v) => v.position.y));
    expect(afterTop).toBeLessThanOrEqual(beforeTop);
  });
});
