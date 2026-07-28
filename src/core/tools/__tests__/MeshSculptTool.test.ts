import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { buildSphere } from '@/core/mesh/builders/SphereBuilder';
import { validateMeshFull } from '@/core/mesh/Validation';
import { MeshSculptTool } from '@/core/tools/MeshSculptTool';
import type { ToolPointerInput } from '@/core/tools/Tool';
import { applyMeshBrush } from '@/core/sculpt/BrushOps';
import { cloneMeshPreserveIds } from '@/core/mesh/EditableMesh';

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

  it('keeps the back side fixed when front-face protection is enabled', () => {
    const mesh = buildSphere({
      radius: 1,
      widthSegments: 16,
      heightSegments: 12,
      name: 'Protected sphere',
    });
    const bottomBefore = Math.min(...[...mesh.vertices.values()].map((vertex) => vertex.position.y));
    applyMeshBrush(mesh, 'clay', { x: 0, y: 1, z: 0 }, 2.2, 0.25, 'smooth', false, {
      hardness: 0.3,
      frontFacesOnly: true,
      surfaceNormal: { x: 0, y: 1, z: 0 },
    });

    const topAfter = Math.max(...[...mesh.vertices.values()].map((vertex) => vertex.position.y));
    const bottomAfter = Math.min(...[...mesh.vertices.values()].map((vertex) => vertex.position.y));
    expect(topAfter).toBeGreaterThan(1);
    expect(bottomAfter).toBeCloseTo(bottomBefore, 6);
  });

  it('scales clay buildup with pen pressure', () => {
    const base = buildSphere({
      radius: 1,
      widthSegments: 16,
      heightSegments: 12,
      name: 'Pressure sphere',
    });
    const light = cloneMeshPreserveIds(base);
    const firm = cloneMeshPreserveIds(base);
    const options = {
      surfaceNormal: { x: 0, y: 1, z: 0 },
      frontFacesOnly: true,
      hardness: 0.2,
    };
    applyMeshBrush(light, 'clay', { x: 0, y: 1, z: 0 }, 1, 0.2, 'smooth', false, {
      ...options,
      pressure: 0.2,
    });
    applyMeshBrush(firm, 'clay', { x: 0, y: 1, z: 0 }, 1, 0.2, 'smooth', false, {
      ...options,
      pressure: 1,
    });

    const lightTop = Math.max(...[...light.vertices.values()].map((vertex) => vertex.position.y));
    const firmTop = Math.max(...[...firm.vertices.values()].map((vertex) => vertex.position.y));
    expect(firmTop - 1).toBeGreaterThan((lightTop - 1) * 3);
  });
});
