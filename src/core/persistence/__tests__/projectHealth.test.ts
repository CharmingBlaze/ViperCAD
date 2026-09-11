import { describe, expect, it } from 'vitest';
import { commitMeshObject, createEmptyDocument } from '@/core/document/ModelDocument';
import { buildModelDocumentView, projectIsDirty } from '@/core/document/ViperProject';
import { generateMeshCollider } from '@/core/editor/GameAssetTools';
import { EditorSession } from '@/core/editor/EditorSession';
import { getDocumentLighting, updateDocumentLighting } from '@/core/level/LevelLighting';
import { defaultTransform } from '@/core/math/Transform';
import type { TextureId } from '@/core/document/types';
import type { MeshId } from '@/core/mesh/types';
import { faceHalfEdgeIds } from '@/core/mesh/EditableMesh';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { buildSphere } from '@/core/mesh/builders/SphereBuilder';
import { bevelEdges } from '@/core/mesh/ops/bevel';
import { knifeFace, loopCut } from '@/core/mesh/ops/cut';
import { extrudeFaceRegion } from '@/core/mesh/ops/extrude';
import { insetFaces } from '@/core/mesh/ops/inset';
import { subdivideFaces } from '@/core/mesh/ops/subdivide';
import { createImageAsset, createTextureAsset, setPixel } from '@/core/image/PixelEditor';
import { remeshUniform } from '@/core/sculpt/MeshRemesher';
import { decimateMesh } from '@/core/sculpt/MeshDecimate';
import { clearAllMeshMasks, getMeshMask } from '@/core/sculpt/SculptMask';
import { unwrapUvSmart, markUvSeamsByAngle } from '@/core/uv/UvOperations';
import { addPaintLayer, patchPaintLayer } from '@/core/image/PaintLayers';
import { paintBoneWeight } from '@/core/rig/weightPaint';
import { v3 } from '@/core/math/Vec3';
import { serializeProject, serializeViperProject } from '@/core/persistence/ProjectSerializer';
import { BlockoutRoundTool } from '@/core/tools/BlockoutRoundTool';
import { BlockoutSolidTool } from '@/core/tools/BlockoutSolidTool';
import { BlockoutVectorTool } from '@/core/tools/BlockoutVectorTool';
import {
  firstMeshValidationError,
  inspectDocumentHealth,
  inspectProjectHealth,
  openViperProjectText,
} from '@/core/persistence/projectHealth';
import { ensureActiveClip, ensureRigArmature, readRigDocumentSettings, writeRigDocumentSettings } from '@/core/rig/RigDocument';
import { generateEnvelopeSkinBinding } from '@/core/rig/skinning';
import type { ArmatureId } from '@/core/rig/types';
import { createBirdArmature } from '@/core/rig/creatureSkeletons';
import { bakeBirdFlight } from '@/core/rig/proceduralAnimationBakers';
import { WORLD_XZ_PLANE } from '@/core/snap/SnapEngine';
import { createTerrain } from '@/core/terrain/Terrain';
import { commitLakeWithCarve, commitPathWithCarve, commitRiverWithCarve } from '@/core/terrain/TerrainFeatures';
import { terrainPlacedObjects } from '@/core/terrain/TerrainProps';
import { exportObj, importObj } from '@/core/io/ObjAdapter';
import { CreatePrimitiveTool } from '@/core/tools/CreatePrimitiveTool';
import { TerrainObjectTool } from '@/core/tools/TerrainObjectTool';
import { TileDrawTool } from '@/core/tools/TileDrawTool';
import { APP_VERSION } from '@/version';

function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

describe('inspectDocumentHealth', () => {
  it('accepts a valid box document', () => {
    const document = createEmptyDocument();
    commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }));
    expect(inspectDocumentHealth(document).ok).toBe(true);
    expect(firstMeshValidationError(buildBox({ width: 1, height: 1, depth: 1 }))).toBeNull();
  });

  it('rejects a mesh with a missing vertex', () => {
    const document = createEmptyDocument();
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }), { name: 'Broken' });
    const object = document.objects.get(objectId)!;
    const mesh = document.meshes.get(object.meshId!)!;
    const vertex = [...mesh.vertices.values()][0]!;
    mesh.vertices.delete(vertex.id);
    const report = inspectDocumentHealth(document);
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/Broken/);
  });

  it('rejects an object whose mesh id is missing', () => {
    const document = createEmptyDocument();
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }), { name: 'Prop' });
    document.objects.get(objectId)!.meshId = 'mesh_missing' as MeshId;
    const report = inspectDocumentHealth(document);
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/missing mesh/);
  });

  it('rejects a material whose texture is missing', () => {
    const document = createEmptyDocument();
    commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }), { name: 'Prop' });
    const material = [...document.materials.values()][0]!;
    material.baseColourTextureId = 'tex_missing' as TextureId;
    const report = inspectDocumentHealth(document);
    expect(report.ok).toBe(false);
    expect(report.errors[0]).toMatch(/missing texture/);
  });
});

describe('openViperProjectText', () => {
  it('opens a healthy saved project', () => {
    const document = createEmptyDocument();
    commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }), { name: 'Box' });
    const loaded = openViperProjectText(serializeProject(document));
    expect(loaded.project.meshes.size).toBeGreaterThan(0);
  });

  it('refuses a tampered checksum', () => {
    const document = createEmptyDocument();
    const file = JSON.parse(serializeProject(document)) as { checksum: string };
    file.checksum = 'deadbeef';
    expect(() => openViperProjectText(JSON.stringify(file))).toThrow(/integrity check/);
  });

  it('refuses a project with a dangling mesh reference', () => {
    const document = createEmptyDocument();
    commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }), { name: 'Prop' });
    const file = JSON.parse(serializeProject(document)) as {
      checksum: string;
      project: { documents: { objects: { meshId: string | null }[] }[] };
    };
    const object = file.project.documents.flatMap((doc) => doc.objects).find((item) => item.meshId);
    expect(object).toBeDefined();
    object!.meshId = 'mesh_missing';
    file.checksum = checksum(JSON.stringify(file.project));
    expect(() => openViperProjectText(JSON.stringify(file))).toThrow(/missing mesh/);
  });

  it('refuses a project with a dangling texture reference', () => {
    const session = new EditorSession();
    commitMeshObject(session.document, buildBox({ width: 1, height: 1, depth: 1 }), { name: 'Prop' });
    const material = [...session.project.materials.values()][0]!;
    material.baseColourTextureId = 'tex_missing' as TextureId;
    expect(inspectProjectHealth(session.project).ok).toBe(false);
    expect(() => openViperProjectText(serializeViperProject(session.project, APP_VERSION))).toThrow(/missing texture/);
  });
});

describe('0.1.0 ship freeze', () => {
  it('starts a clean project that can save, reopen tiles, and keep application version', () => {
    const session = new EditorSession();
    expect(projectIsDirty(session.project)).toBe(false);
    expect(inspectProjectHealth(session.project).ok).toBe(true);

    session.constructionPlane = WORLD_XZ_PLANE;
    const tool = session.tools.get('tile-draw') as TileDrawTool;
    tool.setConfig({ mode: 'paint', cellWidth: 1, cellHeight: 1, layer: 'Geometry' }, session.context());
    session.tools.setActive('tile-draw', session.context());
    tool.begin({
      button: 'left',
      screenX: 0.2,
      screenY: 0.2,
      worldPosition: null,
      rayOrigin: { x: 0.2, y: 10, z: 0.2 },
      rayDirection: { x: 0, y: -1, z: 0 },
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
    }, session.context());
    tool.confirm(session.context());
    expect(projectIsDirty(session.project)).toBe(true);
    expect(inspectProjectHealth(session.project).ok).toBe(true);

    const encoded = serializeViperProject(session.project, APP_VERSION);
    expect(JSON.parse(encoded).applicationVersion).toBe(APP_VERSION);
    const loaded = openViperProjectText(encoded);
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    const restored = [...loaded.project.documents.values()]
      .flatMap((doc) => [...doc.objects.values()])
      .find((object) => object.metadata.tileLayer === 'Geometry');
    expect(restored).toBeDefined();
  });

  it('round-trips level lighting, terrain, and a mesh collider', () => {
    const session = new EditorSession();
    updateDocumentLighting(session.document, { sunColor: '#ff8800', preset: 'sunset' });
    const created = createTerrain(session, { size: 16, resolution: 8, name: 'Ship Terrain' });
    const lake = commitLakeWithCarve(session, created.objectId, {
      radius: 3,
      waterLevel: 0.2,
      style: { animated: true, opacity: 0.7 },
    });
    expect(lake?.metadata.terrainFeature).toBe('lake');
    const colliderId = generateMeshCollider(session.document, created.objectId);
    expect(inspectProjectHealth(session.project).ok).toBe(true);

    const encoded = serializeViperProject(session.project, APP_VERSION);
    const loaded = openViperProjectText(encoded);
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    expect(getDocumentLighting(loaded.project).sunColor).toBe('#ff8800');
    expect(getDocumentLighting(loaded.project).preset).toBe('sunset');

    const objects = [...loaded.project.documents.values()].flatMap((doc) => [...doc.objects.values()]);
    const terrain = objects.find((object) => object.name === 'Ship Terrain');
    const collider = objects.find((object) => object.id === colliderId);
    expect(terrain?.kind).toBe('terrain');
    expect(terrain?.metadata.terrainResolution).toBe('8');
    expect(collider?.kind).toBe('collision');
    expect(collider?.metadata.terrain).toBeUndefined();
    expect(collider?.metadata.collisionFor).toBe(created.objectId);
    const lakeRestored = objects.find((object) => object.metadata.terrainFeature === 'lake');
    expect(lakeRestored?.name).toBe(lake!.name);
    expect(lakeRestored?.metadata.waterAnimated).toBe('true');
  });

  it('round-trips terrain river and path ribbons', () => {
    const session = new EditorSession();
    const created = createTerrain(session, { size: 20, resolution: 12, name: 'Ship Ground' });
    const terrainMesh = session.document.meshes.get(created.meshId)!;
    for (const vertex of terrainMesh.vertices.values()) vertex.position.y = 2;
    const river = commitRiverWithCarve(
      session,
      created.objectId,
      [
        { x: -4, y: 2, z: -1 },
        { x: 0, y: 2, z: 0 },
        { x: 4, y: 2, z: 1 },
      ],
      2.5,
      { carve: true, carveDepth: 1.1, animated: true, opacity: 0.7 },
    );
    const path = commitPathWithCarve(
      session,
      created.objectId,
      [
        { x: -3, y: 2, z: 3 },
        { x: 0, y: 2, z: 3 },
        { x: 3, y: 2, z: 2 },
      ],
      1.6,
      { carve: true, carveDepth: 0.4 },
    );
    expect(river?.metadata.terrainFeature).toBe('river');
    expect(path?.metadata.terrainFeature).toBe('path');
    const carvedMin = Math.min(...[...terrainMesh.vertices.values()].map((vertex) => vertex.position.y));
    expect(carvedMin).toBeLessThan(1.5);

    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    const objects = [...loaded.project.documents.values()].flatMap((doc) => [...doc.objects.values()]);
    const riverRestored = objects.find((object) => object.metadata.terrainFeature === 'river');
    const pathRestored = objects.find((object) => object.metadata.terrainFeature === 'path');
    expect(riverRestored?.metadata.waterAnimated).toBe('true');
    expect(pathRestored?.metadata.terrainFeature).toBe('path');
    expect(loaded.project.meshes.get(riverRestored!.meshId!)?.faces.size).toBeGreaterThan(0);
    expect(loaded.project.meshes.get(pathRestored!.meshId!)?.faces.size).toBeGreaterThan(0);
    const restoredTerrain = loaded.project.meshes.get(
      objects.find((object) => object.id === created.objectId)!.meshId!,
    )!;
    expect(Math.min(...[...restoredTerrain.vertices.values()].map((vertex) => vertex.position.y))).toBeCloseTo(carvedMin);
  });

  it('round-trips a skin binding and animation clip through open', () => {
    const session = new EditorSession();
    const modelView = buildModelDocumentView(session.project, session.project.modelDocumentIds[0]!);
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(modelView, mesh, { name: 'Body' });
    const rigDoc = session.project.documents.get(session.project.rigDocumentIds[0]!)!;
    const armature = ensureRigArmature(session.project, rigDoc);
    const binding = generateEnvelopeSkinBinding('Body', mesh, objectId, armature);
    session.project.skinBindings.set(binding.id, binding);
    const settings = readRigDocumentSettings(rigDoc);
    settings.skinBindingIds.push(binding.id);
    writeRigDocumentSettings(rigDoc, settings);

    const clip = ensureActiveClip(session.project, rigDoc);
    clip.loopMode = 'pingpong';
    clip.rootMotion = true;
    clip.rootMotionMode = 'xz';
    clip.animationType = 'additive';
    clip.events = [{ id: 'evt_foot', time: 0.25, name: 'footstep', category: 'audio' }];
    clip.markers = [{ id: 'mk_beat', time: 0.5, name: 'Beat', color: '#ff8800' }];
    clip.tracks = [{
      boneId: armature.rootBoneIds[0]!,
      keyframes: [{
        time: 0,
        value: defaultTransform(),
        interpolation: 'step',
      }],
    }];

    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    const restoredClip = loaded.project.animationClips.get(clip.id)!;
    expect(restoredClip.loopMode).toBe('pingpong');
    expect(restoredClip.rootMotion).toBe(true);
    expect(restoredClip.rootMotionMode).toBe('xz');
    expect(restoredClip.animationType).toBe('additive');
    expect(restoredClip.events?.[0]?.name).toBe('footstep');
    expect(restoredClip.markers?.[0]?.name).toBe('Beat');
    expect(restoredClip.tracks[0]?.keyframes[0]?.interpolation).toBe('step');
    const restoredBinding = loaded.project.skinBindings.get(binding.id)!;
    expect(restoredBinding.vertexWeights.size).toBe(mesh.vertices.size);
    expect(restoredBinding.armatureId).toBe(armature.id);
  });

  it('round-trips painted vertex weights through open', () => {
    const session = new EditorSession();
    const modelView = buildModelDocumentView(session.project, session.project.modelDocumentIds[0]!);
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(modelView, mesh, { name: 'Body' });
    const rigDoc = session.project.documents.get(session.project.rigDocumentIds[0]!)!;
    const armature = ensureRigArmature(session.project, rigDoc);
    const binding = generateEnvelopeSkinBinding('Body', mesh, objectId, armature);
    const boneId = armature.rootBoneIds[0]!;
    const vertex = [...mesh.vertices.values()][0]!;
    const before = binding.vertexWeights.get(vertex.id)?.find((entry) => entry.boneId === boneId)?.weight ?? 0;
    expect(paintBoneWeight(mesh, binding, boneId, vertex.position, 2, 1, true)).toBeGreaterThan(0);
    const painted = binding.vertexWeights.get(vertex.id)!.find((entry) => entry.boneId === boneId)!.weight;
    expect(painted).toBeGreaterThan(before);
    session.project.skinBindings.set(binding.id, binding);
    const settings = readRigDocumentSettings(rigDoc);
    settings.skinBindingIds.push(binding.id);
    writeRigDocumentSettings(rigDoc, settings);

    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    const restored = loaded.project.skinBindings.get(binding.id)!;
    expect(restored.vertexWeights.get(vertex.id)?.find((entry) => entry.boneId === boneId)?.weight).toBeCloseTo(painted);
  });

  it('refuses a skin binding whose armature is missing', () => {
    const session = new EditorSession();
    const modelView = buildModelDocumentView(session.project, session.project.modelDocumentIds[0]!);
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(modelView, mesh, { name: 'Body' });
    const rigDoc = session.project.documents.get(session.project.rigDocumentIds[0]!)!;
    const armature = ensureRigArmature(session.project, rigDoc);
    const binding = generateEnvelopeSkinBinding('Body', mesh, objectId, armature);
    binding.armatureId = 'arm_missing' as ArmatureId;
    session.project.skinBindings.set(binding.id, binding);
    const settings = readRigDocumentSettings(rigDoc);
    settings.skinBindingIds.push(binding.id);
    writeRigDocumentSettings(rigDoc, settings);

    expect(inspectProjectHealth(session.project).ok).toBe(false);
    expect(() => openViperProjectText(serializeViperProject(session.project, APP_VERSION))).toThrow(/missing armature/);
  });

  it('round-trips extrude, inset, knife, bevel, and loop cut', () => {
    const session = new EditorSession();
    const mesh = buildBox({ width: 2, height: 2, depth: 2 });
    commitMeshObject(session.document, mesh, { name: 'Ship Box' });

    const extrudeFace = [...mesh.faces.keys()][0]!;
    expect(extrudeFaceRegion(mesh, [extrudeFace], { distance: 0.4 }).ok).toBe(true);

    const insetFace = [...mesh.faces.keys()][0]!;
    expect(insetFaces(mesh, [insetFace], { thickness: 0.12 }).ok).toBe(true);

    const knifeTarget = [...mesh.faces.keys()].find((faceId) => {
      const edges = faceHalfEdgeIds(mesh, faceId).map((heId) => mesh.halfEdges.get(heId)!.edgeId);
      return edges.length >= 4;
    })!;
    const knifeEdges = faceHalfEdgeIds(mesh, knifeTarget).map((heId) => mesh.halfEdges.get(heId)!.edgeId);
    expect(knifeFace(mesh, knifeTarget, knifeEdges[0]!, knifeEdges[2]!, 0.5, 0.5).ok).toBe(true);

    const bevelTarget = [...mesh.faces.keys()][0]!;
    const bevelEdge = faceHalfEdgeIds(mesh, bevelTarget).map((heId) => mesh.halfEdges.get(heId)!.edgeId)[0]!;
    expect(bevelEdges(mesh, [bevelEdge], { width: 0.08 }).ok).toBe(true);

    const loopTarget = [...mesh.faces.keys()][0]!;
    const loopEdge = faceHalfEdgeIds(mesh, loopTarget).map((heId) => mesh.halfEdges.get(heId)!.edgeId)[0]!;
    expect(loopCut(mesh, loopEdge, 0.5).ok).toBe(true);

    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    expect(loaded.project.meshes.get(mesh.id)?.faces.size).toBe(mesh.faces.size);
    expect(loaded.project.meshes.get(mesh.id)?.faces.size).toBeGreaterThan(6);
  });

  it('round-trips Flat, Square, and Round blockout solids', () => {
    const session = new EditorSession();
    const rect = [v3(0, 0, 0), v3(2, 0, 0), v3(2, 2, 0), v3(0, 2, 0)];

    const flat = session.tools.get('blockout-vector') as BlockoutVectorTool;
    flat.state.points = rect;
    flat.state.activePlane = 'front';
    expect(flat.commitExtrude(session.context())).toBe(true);

    const square = session.tools.get('blockout-solid') as BlockoutSolidTool;
    square.state.points = rect.map((point) => v3(point.x + 3, point.y, point.z));
    square.state.activePlane = 'front';
    expect(square.commitExtrude(session.context())).toBe(true);

    const round = session.tools.get('blockout-round') as BlockoutRoundTool;
    round.state.points = [v3(1, 0, 3), v3(2, 1, 3), v3(1, 2, 3), v3(0, 1, 3)];
    round.state.activePlane = 'front';
    expect(round.commitExtrude(session.context())).toBe(true);

    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    const names = [...loaded.project.documents.values()]
      .flatMap((doc) => [...doc.objects.values()])
      .map((object) => object.name);
    expect(names.some((name) => /blockout|vector|flat|solid|square|round/i.test(name))).toBe(true);
    expect(loaded.project.meshes.size).toBe(3);
  });

  it('round-trips a primitive box after G, R, and S', () => {
    const session = new EditorSession();
    session.ensureDocumentKind('model');
    session.constructionPlane = WORLD_XZ_PLANE;
    session.constructionPlaneId = 'top';
    const tool = session.tools.get('create-primitive') as CreatePrimitiveTool;
    tool.selectPrimitive('box', session.context());
    const input = (
      origin: { x: number; y: number; z: number },
      direction: { x: number; y: number; z: number },
    ) => ({
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

    const objectId = [...session.document.objects.keys()][0]!;
    session.selection.setMode('object');
    session.selection.selectObjects([objectId], 'replace');

    expect(session.transform.begin({ type: 'translate', source: 'keyboard', viewportId: 'persp' })).toBe(true);
    session.transform.setAxisKey('x', false);
    session.transform.appendNumeric('2');
    session.transform.confirm();

    expect(session.transform.begin({ type: 'rotate', source: 'keyboard', viewportId: 'persp' })).toBe(true);
    session.transform.setAxisKey('z', false);
    session.transform.appendNumeric('90');
    session.transform.confirm();

    expect(session.transform.begin({ type: 'scale', source: 'keyboard', viewportId: 'persp' })).toBe(true);
    session.transform.appendNumeric('2');
    session.transform.confirm();

    const before = session.document.objects.get(objectId)!.transform;
    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    const restored = [...loaded.project.documents.values()]
      .flatMap((doc) => [...doc.objects.values()])
      .find((object) => object.id === objectId);
    expect(restored).toBeDefined();
    expect(restored!.transform.position.x).toBeCloseTo(before.position.x);
    expect(restored!.transform.position.y).toBeCloseTo(before.position.y);
    expect(restored!.transform.position.z).toBeCloseTo(before.position.z);
    expect(restored!.transform.rotation.z).toBeCloseTo(before.rotation.z);
    expect(restored!.transform.scale.x).toBeCloseTo(before.scale.x);
    expect(restored!.transform.scale.y).toBeCloseTo(before.scale.y);
    expect(restored!.transform.scale.z).toBeCloseTo(before.scale.z);
    expect(loaded.project.meshes.size).toBe(1);
  });

  it('round-trips a procedural bird-flight bake through open', () => {
    const session = new EditorSession();
    const rigDoc = session.project.documents.get(session.project.rigDocumentIds[0]!)!;
    const armature = createBirdArmature();
    session.project.armatures.set(armature.id, armature);
    const settings = readRigDocumentSettings(rigDoc);
    settings.armatureId = armature.id;
    writeRigDocumentSettings(rigDoc, settings);
    const clip = ensureActiveClip(session.project, rigDoc);
    bakeBirdFlight(clip, armature, { duration: 1, fps: 24 });
    expect(clip.tracks.length).toBeGreaterThan(3);

    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    const restored = loaded.project.animationClips.get(clip.id)!;
    expect(restored.tracks.length).toBe(clip.tracks.length);
    expect(restored.tracks.reduce((count, track) => count + track.keyframes.length, 0)).toBeGreaterThan(50);
    expect(restored.tracks[0]?.keyframes[0]?.interpolation).toBe('smooth');
    expect(loaded.project.armatures.get(armature.id)?.bones.size).toBe(armature.bones.size);
  });

  it('round-trips a clip sequence and custom pose', () => {
    const session = new EditorSession();
    const rigDoc = session.project.documents.get(session.project.rigDocumentIds[0]!)!;
    const armature = ensureRigArmature(session.project, rigDoc);
    const clip = ensureActiveClip(session.project, rigDoc);
    const boneId = [...armature.bones.keys()][0]!;
    const settings = readRigDocumentSettings(rigDoc);
    settings.clipSequence = [{
      id: 'seq_idle',
      clipId: clip.id,
      name: clip.name,
      startTime: 0,
      duration: clip.duration,
      speedMultiplier: 1,
      blendIn: 0.2,
      blendOut: 0.2,
    }];
    settings.customPoses = [{
      id: 'pose_idle',
      name: 'Idle',
      transforms: { [boneId]: defaultTransform() },
    }];
    settings.constraints = [{
      id: 'con_aim',
      name: 'Aim',
      ownerId: boneId,
      type: 'aim',
      influence: 0.6,
      enabled: true,
    }];
    writeRigDocumentSettings(rigDoc, settings);

    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    const restored = readRigDocumentSettings(loaded.project.documents.get(rigDoc.id)!);
    expect(restored.clipSequence).toHaveLength(1);
    expect(restored.clipSequence[0]?.clipId).toBe(clip.id);
    expect(restored.customPoses[0]?.name).toBe('Idle');
    expect(restored.customPoses[0]?.transforms[boneId]?.scale.x).toBe(1);
    expect(restored.constraints[0]?.name).toBe('Aim');
    expect(restored.constraints[0]?.influence).toBeCloseTo(0.6);
  });

  it('refuses a clip sequence that points at a missing clip', () => {
    const session = new EditorSession();
    const rigDoc = session.project.documents.get(session.project.rigDocumentIds[0]!)!;
    const settings = readRigDocumentSettings(rigDoc);
    settings.clipSequence = [{
      id: 'seq_missing',
      clipId: 'clip_missing',
      name: 'Gone',
      startTime: 0,
      duration: 1,
      speedMultiplier: 1,
      blendIn: 0,
      blendOut: 0,
    }];
    writeRigDocumentSettings(rigDoc, settings);
    expect(inspectProjectHealth(session.project).ok).toBe(false);
    expect(() => openViperProjectText(serializeViperProject(session.project, APP_VERSION))).toThrow(/missing sequence clip/);
  });

  it('round-trips sculpt remesh, subdivide, and decimate', () => {
    const session = new EditorSession();
    const sculpt = buildSphere({ radius: 1, widthSegments: 12, heightSegments: 8 });
    commitMeshObject(session.document, sculpt, { name: 'Sculpt' });
    expect(remeshUniform(sculpt, { targetLength: 0.4, iterations: 1 })).toBe(true);
    const remeshedFaces = sculpt.faces.size;
    expect(decimateMesh(sculpt, { ratio: 0.7 })).toBe(true);
    expect(sculpt.faces.size).toBeLessThan(remeshedFaces);

    const box = buildBox({ width: 1, height: 1, depth: 1 });
    commitMeshObject(session.document, box, { name: 'Subdiv' });
    expect(subdivideFaces(box, [...box.faces.keys()], 1).ok).toBe(true);
    expect(box.faces.size).toBe(24);

    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    expect(loaded.project.meshes.get(sculpt.id)?.faces.size).toBe(sculpt.faces.size);
    expect(loaded.project.meshes.get(box.id)?.faces.size).toBe(24);
  });

  it('round-trips a sculpt vertex mask through save and open', () => {
    const session = new EditorSession();
    const mesh = buildSphere({ radius: 1, widthSegments: 8, heightSegments: 6 });
    commitMeshObject(session.document, mesh, { name: 'Masked' });
    const vertexId = [...mesh.vertices.keys()][0]!;
    getMeshMask(mesh.id).set(vertexId, 0.8);

    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const text = serializeViperProject(session.project, APP_VERSION);
    clearAllMeshMasks();
    const loaded = openViperProjectText(text);
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    expect(loaded.project.meshes.get(mesh.id)?.sculptMask?.get(vertexId)).toBeCloseTo(0.8);

    const restored = new EditorSession(loaded.project);
    expect(getMeshMask(mesh.id).get(vertexId)).toBeCloseTo(0.8);

    clearAllMeshMasks();
    restored.loadProject(openViperProjectText(text).project);
    expect(getMeshMask(mesh.id).get(vertexId)).toBeCloseTo(0.8);
  });

  it('round-trips smart unwrap, UV seams, and a paint-layer stack', () => {
    const session = new EditorSession();
    session.ensureDocumentKind('model');
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(session.document, mesh, { name: 'Painted' });
    unwrapUvSmart(mesh, [...mesh.faces.keys()]);
    expect(markUvSeamsByAngle(mesh, 45)).toBeGreaterThan(0);
    const seamIds = [...mesh.edges.values()].filter((edge) => edge.seam).map((edge) => edge.id);
    expect(seamIds.length).toBeGreaterThan(0);
    const layerId = mesh.defaultUvLayerId!;
    const corner = [...mesh.faceCorners.values()][0]!;
    const uv = corner.uvs.get(layerId)!;

    const image = createImageAsset(session.document, 'Paint', 8, 8, [10, 20, 30, 255]);
    addPaintLayer(image, 'Details');
    expect(setPixel(image, 2, 3, [255, 0, 128, 255])).toBe(true);
    patchPaintLayer(image, image.paintLayers![1]!.id, { opacity: 0.5, name: 'Details' });
    const texture = createTextureAsset(session.document, image, 'Paint');
    const material = session.document.materials.get(
      session.document.objects.get(objectId)!.materialSlotIds[0]!,
    )!;
    material.baseColourTextureId = texture.id;

    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    const restoredMesh = loaded.project.meshes.get(mesh.id)!;
    expect(restoredMesh.faceCorners.get(corner.id)!.uvs.get(layerId)!.x).toBeCloseTo(uv.x);
    expect(restoredMesh.faceCorners.get(corner.id)!.uvs.get(layerId)!.y).toBeCloseTo(uv.y);
    expect([...restoredMesh.edges.values()].filter((edge) => edge.seam).map((edge) => edge.id)).toEqual(seamIds);
    const restoredImage = loaded.project.images.get(image.id)!;
    expect(restoredImage.paintLayers).toHaveLength(2);
    expect(restoredImage.paintLayers![1]!.name).toBe('Details');
    expect(restoredImage.paintLayers![1]!.opacity).toBeCloseTo(0.5);
    expect(restoredImage.activePaintLayerId).toBe(image.activePaintLayerId);
    const layerIndex = (3 * 8 + 2) * 4;
    expect(restoredImage.paintLayers![1]!.pixels[layerIndex]).toBe(255);
    expect(restoredImage.paintLayers![1]!.pixels[layerIndex + 2]).toBe(128);
    expect(restoredImage.userEdited).toBe(true);
  });

  it('round-trips scattered terrain props', () => {
    const session = new EditorSession();
    const terrain = createTerrain(session, { size: 20, resolution: 8 });
    const tool = session.tools.get('terrain-object') as TerrainObjectTool;
    tool.setTerrain(terrain.objectId, session.context());
    tool.setPreset('rock', session.context());
    tool.setMode('scatter', session.context());
    tool.radius = 3;
    tool.density = 6;
    tool.spacing = 0.1;
    const pointer = (x: number, z: number) => ({
      button: 'left' as const,
      screenX: 120 + x,
      screenY: 160 + z,
      worldPosition: { x, y: 0, z },
      rayOrigin: { x, y: 20, z },
      rayDirection: { x: 0, y: -1, z: 0 },
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
    });
    tool.begin(pointer(0, 0), session.context());
    tool.update(pointer(3, 0), session.context());
    tool.endStroke(session.context());
    const placed = terrainPlacedObjects(session.document, terrain.objectId);
    expect(placed.length).toBeGreaterThanOrEqual(6);

    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    const restoredDoc = [...loaded.project.documents.values()].find((doc) =>
      [...doc.objects.values()].some((object) => object.id === terrain.objectId),
    )!;
    const restored = [...restoredDoc.objects.values()].filter(
      (object) => object.metadata.terrainOwnerId === terrain.objectId,
    );
    expect(restored.length).toBe(placed.length);
  });

  it('round-trips sculpt symmetry settings', () => {
    const session = new EditorSession();
    session.project.settings.symmetry.x = true;
    session.project.settings.symmetry.radialCount = 12;
    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(loaded.project.settings.symmetry.x).toBe(true);
    expect(loaded.project.settings.symmetry.radialCount).toBe(12);
  });

  it('round-trips an imported OBJ mesh through open', () => {
    const session = new EditorSession();
    const mesh = importObj(exportObj(buildBox({ width: 1, height: 1, depth: 1 })), 'Imported');
    commitMeshObject(session.document, mesh, { name: mesh.name });
    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    expect(loaded.project.meshes.get(mesh.id)?.faces.size).toBe(6);
    expect(loaded.project.meshes.get(mesh.id)?.name).toBe('Imported');
  });

  it('round-trips sculpted terrain heights', () => {
    const session = new EditorSession();
    const created = createTerrain(session, { size: 8, resolution: 4, name: 'Hills' });
    const mesh = session.document.meshes.get(created.meshId)!;
    const vertex = [...mesh.vertices.values()][0]!;
    vertex.position.y = 1.25;
    expect(inspectProjectHealth(session.project).ok).toBe(true);
    const loaded = openViperProjectText(serializeViperProject(session.project, APP_VERSION));
    expect(inspectProjectHealth(loaded.project).ok).toBe(true);
    expect(loaded.project.meshes.get(mesh.id)?.vertices.get(vertex.id)?.position.y).toBeCloseTo(1.25);
  });
});
