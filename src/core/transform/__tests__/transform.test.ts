import { describe, expect, it } from 'vitest';
import { createEmptyDocument, commitMeshObject } from '@/core/document/ModelDocument';
import { CommandHistory } from '@/core/history/CommandHistory';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { faceVertexIds, getEdgeVertices } from '@/core/mesh/EditableMesh';
import { SelectionManager } from '@/core/selection/SelectionManager';
import { applyAxisKey } from '../Constraints';
import { parseTransformNumber } from '../NumericParser';
import { buildOrientationBasis } from '../Orientation';
import { computePivot } from '../Pivot';
import { gatherTargetVertexIds } from '../Targets';
import { TransformSystem } from '../TransformSystem';

describe('NumericParser', () => {
  it('parses decimals and signs', () => {
    expect(parseTransformNumber('2')).toEqual({ ok: true, value: 2, unit: 'none' });
    expect(parseTransformNumber('-1.5')).toEqual({ ok: true, value: -1.5, unit: 'none' });
    expect(parseTransformNumber('.25')).toEqual({ ok: true, value: 0.25, unit: 'none' });
  });

  it('parses length and degree units', () => {
    expect(parseTransformNumber('2m')).toEqual({ ok: true, value: 2, unit: 'm' });
    expect(parseTransformNumber('15cm')).toEqual({ ok: true, value: 0.15, unit: 'cm' });
    expect(parseTransformNumber('90deg')).toEqual({ ok: true, value: 90, unit: 'deg' });
  });

  it('rejects incomplete and invalid input', () => {
    expect(parseTransformNumber('-').ok).toBe(false);
    expect(parseTransformNumber('abc').ok).toBe(false);
  });
});

describe('axis constraints', () => {
  it('uses global then local on double axis when orientation is Global', () => {
    const first = applyAxisKey('x', false, 'none', null, 'global', false);
    expect(first.constraint).toBe('x');
    expect(first.constraintUsesLocal).toBe(false);

    const second = applyAxisKey('x', false, 'x', 'x', 'global', false);
    expect(second.constraint).toBe('x');
    expect(second.constraintUsesLocal).toBe(true);
  });

  it('maps Shift+Z to XY plane', () => {
    const plane = applyAxisKey('z', true, 'none', null, 'global', false);
    expect(plane.constraint).toBe('xy');
  });
});

describe('orientation defaults', () => {
  it('defaults to local object axes and object-origin pivot', () => {
    const doc = createEmptyDocument();
    const selection = new SelectionManager();
    const history = new CommandHistory();
    const transform = new TransformSystem(doc, selection, history, () => {});
    expect(transform.prefs.orientation).toBe('local');
    expect(transform.prefs.pivotMode).toBe('object-origin');
  });

  it('builds local basis from object rotation', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(doc, mesh);
    doc.objects.get(objectId)!.transform.rotation.y = Math.PI / 2;
    const selection = new SelectionManager();
    selection.setMode('object');
    selection.selectObjects([objectId], 'replace');
    const basis = buildOrientationBasis(doc, selection.state, 'local', null, false);
    // 90° Y: local X ≈ world -Z, local Z ≈ world +X
    expect(basis.x.z).toBeCloseTo(-1, 5);
    expect(basis.z.x).toBeCloseTo(1, 5);
  });
});

describe('computePivot', () => {
  it('places object median at mesh centre, not corner origin', () => {
    const doc = createEmptyDocument();
    // Interactive-style box: mesh from 0..2, object origin at corner
    const mesh = buildBox({ width: 2, height: 2, depth: 2, centered: false });
    const { objectId } = commitMeshObject(doc, mesh);
    const object = doc.objects.get(objectId)!;
    object.transform.position = { x: 5, y: 0, z: 3 };
    const selection = new SelectionManager();
    selection.setMode('object');
    selection.selectObjects([objectId], 'replace');

    const median = computePivot(doc, selection.state, 'median');
    expect(median.x).toBeCloseTo(6, 5); // 5 + 1
    expect(median.y).toBeCloseTo(1, 5);
    expect(median.z).toBeCloseTo(4, 5); // 3 + 1

    const origin = computePivot(doc, selection.state, 'object-origin');
    expect(origin.x).toBeCloseTo(5, 5);
    expect(origin.y).toBeCloseTo(0, 5);
    expect(origin.z).toBeCloseTo(3, 5);
  });

  it('places the default gizmo pivot on selected vertices, edges, and faces', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 2, height: 2, depth: 2, centered: false });
    const { objectId } = commitMeshObject(doc, mesh);
    doc.objects.get(objectId)!.transform.position = { x: 5, y: 3, z: 7 };
    const selection = new SelectionManager();
    selection.selectObjects([objectId], 'replace');

    const vertexId = [...mesh.vertices.keys()][0]!;
    const vertex = mesh.vertices.get(vertexId)!.position;
    selection.setMode('vertex');
    selection.selectVertices([vertexId], 'replace');
    expect(computePivot(doc, selection.state, 'object-origin')).toEqual({
      x: vertex.x + 5,
      y: vertex.y + 3,
      z: vertex.z + 7,
    });

    const edgeId = [...mesh.edges.keys()][0]!;
    const edgeVertices = getEdgeVertices(mesh, edgeId)!;
    const edgeA = mesh.vertices.get(edgeVertices[0])!.position;
    const edgeB = mesh.vertices.get(edgeVertices[1])!.position;
    selection.setMode('edge');
    selection.selectEdges([edgeId], 'replace');
    const edgePivot = computePivot(doc, selection.state, 'object-origin');
    expect(edgePivot.x).toBeCloseTo((edgeA.x + edgeB.x) / 2 + 5);
    expect(edgePivot.y).toBeCloseTo((edgeA.y + edgeB.y) / 2 + 3);
    expect(edgePivot.z).toBeCloseTo((edgeA.z + edgeB.z) / 2 + 7);

    const faceId = [...mesh.faces.keys()][0]!;
    const facePoints = faceVertexIds(mesh, faceId).map((id) => mesh.vertices.get(id)!.position);
    selection.setMode('face');
    selection.selectFaces([faceId], 'replace');
    const facePivot = computePivot(doc, selection.state, 'object-origin');
    expect(facePivot.x).toBeCloseTo(
      facePoints.reduce((sum, point) => sum + point.x, 0) / facePoints.length + 5,
    );
    expect(facePivot.y).toBeCloseTo(
      facePoints.reduce((sum, point) => sum + point.y, 0) / facePoints.length + 3,
    );
    expect(facePivot.z).toBeCloseTo(
      facePoints.reduce((sum, point) => sum + point.z, 0) / facePoints.length + 7,
    );
  });
});

describe('gatherTargetVertexIds', () => {
  it('uniques shared vertices across selected faces', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(doc, mesh);
    const selection = new SelectionManager();
    selection.setMode('face');
    selection.selectObjects([objectId], 'replace');
    const faceIds = [...mesh.faces.keys()];
    selection.selectFaces(faceIds, 'replace');
    const target = gatherTargetVertexIds(doc, selection.state);
    expect(target?.vertexIds.size).toBe(8);
  });
});

describe('TransformSystem history', () => {
  it('uses an operation label in modal scale feedback', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(doc, mesh);
    const selection = new SelectionManager();
    selection.setMode('object');
    selection.selectObjects([objectId], 'replace');
    const transform = new TransformSystem(doc, selection, new CommandHistory(), () => {});

    transform.begin({
      type: 'scale',
      source: 'keyboard',
      viewportId: 'persp',
      statusLabel: 'Inset',
    });

    expect(transform.statusLine()).toMatch(/^Inset —/);
  });

  it('updates a large multi-object selection as one transform', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId: firstId } = commitMeshObject(doc, mesh);
    const ids = [firstId];
    const first = doc.objects.get(firstId)!;
    for (let index = 1; index < 250; index++) {
      const object = {
        ...first,
        id: `obj_perf_${index}`,
        name: `Box ${index}`,
        childIds: [],
        transform: {
          position: { x: index, y: 0, z: 0 },
          rotation: { ...first.transform.rotation },
          scale: { ...first.transform.scale },
        },
        materialSlotIds: [...first.materialSlotIds],
        metadata: {},
      };
      doc.objects.set(object.id, object);
      doc.rootObjectIds.push(object.id);
      ids.push(object.id);
    }
    const selection = new SelectionManager();
    selection.setMode('object');
    selection.selectObjects(ids, 'replace');
    const transform = new TransformSystem(doc, selection, new CommandHistory(), () => {});
    expect(transform.begin({ type: 'translate', source: 'keyboard', viewportId: 'persp' })).toBe(true);
    transform.setAxisKey('y', false);
    transform.appendNumeric('2');
    expect(doc.objects.get(firstId)!.transform.position.y).toBeCloseTo(2);
    expect(doc.objects.get(ids.at(-1)!)!.transform.position.y).toBeCloseTo(2);
    transform.confirm();
  });

  it('snaps translation pivots to shared geometry candidates', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(doc, mesh);
    const selection = new SelectionManager();
    const history = new CommandHistory();
    const transform = new TransformSystem(doc, selection, history, () => {}, (query) => ({
      snapped: true,
      position: { x: 2, y: 0, z: 0 },
      targetType: query.allowed.includes('vertex') ? 'vertex' : 'none',
      distance: 0,
      confidence: 1,
    }));
    selection.setMode('object');
    selection.selectObjects([objectId], 'replace');
    const camera = {
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
    };
    const start = {
      screenX: 100,
      screenY: 100,
      rayOrigin: { x: 0, y: 0, z: 5 },
      rayDirection: { x: 0, y: 0, z: -1 },
      viewportId: 'persp' as const,
      shiftKey: false,
      ctrlKey: false,
      camera,
    };
    transform.begin({ type: 'translate', source: 'gizmo', viewportId: 'persp', pointer: start });
    transform.updatePointer({ ...start, screenX: 140, rayOrigin: { x: 1.1, y: 0, z: 5 }, ctrlKey: true });

    expect(doc.objects.get(objectId)!.transform.position.x).toBeCloseTo(2);
    expect(transform.statusLine()).toContain('snap vertex');
  });

  it('allows gizmo translations smaller than the snap increment', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(doc, mesh);
    const selection = new SelectionManager();
    const transform = new TransformSystem(doc, selection, new CommandHistory(), () => {});
    selection.setMode('object');
    selection.selectObjects([objectId], 'replace');
    const camera = {
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
    };
    const start = {
      screenX: 100,
      screenY: 100,
      rayOrigin: { x: 0, y: 0, z: 5 },
      rayDirection: { x: 0, y: 0, z: -1 },
      viewportId: 'persp' as const,
      shiftKey: false,
      ctrlKey: false,
      camera,
    };
    transform.begin({ type: 'translate', source: 'gizmo', viewportId: 'persp', pointer: start });
    transform.updatePointer({ ...start, screenX: 104, rayOrigin: { x: 0.05, y: 0, z: 5 } });

    expect(doc.objects.get(objectId)!.transform.position.x).toBeCloseTo(0.05);
    expect(transform.statusLine()).not.toContain('snap');
  });

  it('maps perspective axis drags onto a camera-facing axis plane', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(doc, mesh);
    const selection = new SelectionManager();
    const transform = new TransformSystem(doc, selection, new CommandHistory(), () => {});
    selection.setMode('object');
    selection.selectObjects([objectId], 'replace');
    const normalize = (x: number, y: number, z: number) => {
      const length = Math.hypot(x, y, z);
      return { x: x / length, y: y / length, z: z / length };
    };
    const cameraPosition = { x: 5, y: 3, z: 5 };
    const camera = {
      right: normalize(1, 0, -1),
      up: normalize(-3, 10, -3),
      forward: normalize(-5, -3, -5),
    };
    const start = {
      screenX: 100,
      screenY: 100,
      rayOrigin: cameraPosition,
      rayDirection: normalize(-5, -3, -5),
      viewportId: 'persp' as const,
      shiftKey: false,
      ctrlKey: false,
      camera,
    };
    transform.begin({
      type: 'translate',
      source: 'gizmo',
      viewportId: 'persp',
      pointer: start,
      constraint: 'x',
    });
    transform.updatePointer({
      ...start,
      screenX: 104,
      rayDirection: normalize(-4.95, -3, -5),
    });

    expect(doc.objects.get(objectId)!.transform.position.x).toBeCloseTo(0.05, 4);
    expect(doc.objects.get(objectId)!.transform.position.y).toBeCloseTo(0, 6);
    expect(doc.objects.get(objectId)!.transform.position.z).toBeCloseTo(0, 6);
  });

  it('confirms one undoable object move and cancels restore exactly', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(doc, mesh);
    const selection = new SelectionManager();
    const history = new CommandHistory();
    let redraws = 0;
    const transform = new TransformSystem(doc, selection, history, () => {
      redraws += 1;
    });
    selection.setMode('object');
    selection.selectObjects([objectId], 'replace');

    expect(transform.begin({ type: 'translate', source: 'keyboard', viewportId: 'persp' })).toBe(true);
    transform.appendNumeric('2');
    transform.setAxisKey('x', false);
    // Re-apply numeric after axis (append already applied; set axis re-applies)
    transform.clearNumeric();
    transform.appendNumeric('2');
    const mid = doc.objects.get(objectId)!.transform.position.x;
    expect(mid).toBeCloseTo(2, 5);
    transform.confirm();
    expect(history.canUndo()).toBe(true);
    expect(doc.objects.get(objectId)!.transform.position.x).toBeCloseTo(2, 5);

    history.undo();
    expect(doc.objects.get(objectId)!.transform.position.x).toBeCloseTo(0, 5);
    history.redo();
    expect(doc.objects.get(objectId)!.transform.position.x).toBeCloseTo(2, 5);

    transform.begin({ type: 'translate', source: 'keyboard', viewportId: 'persp' });
    transform.setAxisKey('y', false);
    transform.appendNumeric('3');
    expect(doc.objects.get(objectId)!.transform.position.y).toBeCloseTo(3, 5);
    transform.cancel();
    expect(doc.objects.get(objectId)!.transform.position.y).toBeCloseTo(0, 5);
    expect(redraws).toBeGreaterThan(0);
  });

  it('rotate gizmo drag around Y changes object rotation', () => {
    const doc = createEmptyDocument();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(doc, mesh);
    const selection = new SelectionManager();
    const history = new CommandHistory();
    const transform = new TransformSystem(doc, selection, history, () => {});
    selection.setMode('object');
    selection.selectObjects([objectId], 'replace');

    const camera = {
      right: { x: 1, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
    };
    // Start on the +X side of the Y ring, then drag toward +Z.
    const start = {
      screenX: 100,
      screenY: 100,
      rayOrigin: { x: 1, y: 5, z: 0 },
      rayDirection: { x: 0, y: -1, z: 0 },
      viewportId: 'persp' as const,
      shiftKey: false,
      ctrlKey: false,
      camera,
    };
    expect(
      transform.begin({
        type: 'rotate',
        source: 'gizmo',
        viewportId: 'persp',
        constraint: 'y',
        pointer: start,
        camera,
      }),
    ).toBe(true);

    transform.updatePointer({
      ...start,
      screenX: 140,
      rayOrigin: { x: 0, y: 5, z: 1 },
      rayDirection: { x: 0, y: -1, z: 0 },
    });

    const rotation = doc.objects.get(objectId)!.transform.rotation;
    expect(Math.abs(rotation.y)).toBeGreaterThan(0.2);
    transform.confirm();
    expect(Math.abs(doc.objects.get(objectId)!.transform.rotation.y)).toBeGreaterThan(0.2);
  });
});
