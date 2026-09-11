import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import type { ModelDocument } from '@/core/document/types';
import { EditorSession } from '@/core/editor/EditorSession';
import { createTerrain } from '@/core/terrain/Terrain';
import { APP_VERSION } from '@/version';
import {
  deserializeProject,
  deserializeViperProject,
  PROJECT_FORMAT,
  PROJECT_FORMAT_VERSION,
  serializeProject,
  serializeViperProject,
} from '@/core/persistence/ProjectSerializer';
import { WORLD_XZ_PLANE } from '@/core/snap/SnapEngine';
import { TileDrawTool } from '@/core/tools/TileDrawTool';

function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function legacyV1Payload(doc: ModelDocument, formatVersion = 1) {
  const document = {
    id: doc.id,
    name: doc.name,
    version: doc.version,
    rootObjectIds: [...doc.rootObjectIds],
    settings: { ...doc.settings, symmetry: { ...doc.settings.symmetry } },
    objects: [],
    meshes: [],
    materials: [...doc.materials.values()],
    textures: [...doc.textures.values()],
    images: [...doc.images.values()].map((image) => ({
      ...image,
      pixels: [...image.pixels],
    })),
  };
  return {
    format: PROJECT_FORMAT,
    formatVersion,
    applicationVersion: 'legacy',
    document,
    checksum: checksum(JSON.stringify(document)),
  };
}

describe('ProjectSerializer migrations', () => {
  it('writes the current format with save metadata', () => {
    const encoded = JSON.parse(serializeProject(createEmptyDocument(), 'test'));
    expect(encoded.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(encoded.applicationVersion).toBe('test');
    expect(JSON.parse(serializeProject(createEmptyDocument())).applicationVersion).toBe(APP_VERSION);
    expect(Number.isNaN(Date.parse(encoded.savedAt))).toBe(false);
    expect(encoded.project).toBeDefined();
  });

  it('migrates v1 project settings without losing existing values', () => {
    const encoded = legacyV1Payload(createEmptyDocument(), 1);
    const settings = encoded.document.settings as Record<string, unknown>;
    delete settings.angleSnapDegrees;
    delete settings.snapIncrement;
    encoded.checksum = checksum(JSON.stringify(encoded.document));

    const loaded = deserializeProject(JSON.stringify(encoded));
    expect(loaded.settings.angleSnapDegrees).toBe(15);
    expect(loaded.settings.snapIncrement).toBe(0.25);
  });

  it('adds complete symmetry defaults to projects saved before symmetry existed', () => {
    const encoded = legacyV1Payload(createEmptyDocument());
    const settings = encoded.document.settings as Record<string, unknown>;
    delete settings.modellingProfile;
    delete settings.symmetry;
    encoded.checksum = checksum(JSON.stringify(encoded.document));

    const loaded = deserializeProject(JSON.stringify(encoded));
    expect(loaded.settings.modellingProfile).toBe('general');
    expect(loaded.settings.symmetry).toMatchObject({
      x: false,
      y: false,
      z: false,
      radialEnabled: false,
      radialAxis: 'y',
      radialCount: 8,
      liveMirror: true,
    });
  });

  it('rejects project versions newer than the application', () => {
    const encoded = JSON.parse(serializeProject(createEmptyDocument(), 'future'));
    encoded.formatVersion = PROJECT_FORMAT_VERSION + 1;
    expect(() => deserializeProject(JSON.stringify(encoded))).toThrow(/newer than supported/);
  });

  it('rejects a tampered checksum', () => {
    const encoded = JSON.parse(serializeProject(createEmptyDocument()));
    encoded.checksum = '00000000';
    expect(() => deserializeProject(JSON.stringify(encoded))).toThrow(/integrity check/);
  });

  it('serializes and deserializes level lighting settings and presets', () => {
    const doc = createEmptyDocument();
    (doc.settings as Record<string, unknown>).lighting = {
      sunEnabled: true,
      sunColor: '#ff0000',
      sunAzimuth: 180,
      sunElevation: 45,
      fogEnabled: true,
      preset: 'sunset',
    };
    const serialized = serializeProject(doc, 'test');
    const deserialized = deserializeProject(serialized);
    const lighting = (deserialized.settings as Record<string, unknown>).lighting as Record<string, unknown>;
    expect(lighting).toBeDefined();
    expect(lighting.sunColor).toBe('#ff0000');
    expect(lighting.preset).toBe('sunset');
  });

  it('serializes skybox settings and terrain layer metadata', () => {
    const doc = createEmptyDocument();
    (doc.settings as Record<string, unknown>).skybox = {
      preset: 'night',
      starIntensity: 0.8,
      zenithColor: '#020617',
    };
    const session = new EditorSession(doc);
    createTerrain(session, { size: 16, resolution: 8, name: 'Layered Terrain' });
    const terrainMesh = [...session.document.meshes.values()].find((mesh) => mesh.metadata?.terrainLayers);
    expect(terrainMesh?.metadata?.terrainLayers).toBeTruthy();

    const deserialized = deserializeProject(serializeProject(session.document, 'test'));
    const skybox = (deserialized.settings as Record<string, unknown>).skybox as Record<string, unknown>;
    expect(skybox.preset).toBe('night');
    expect(skybox.starIntensity).toBe(0.8);
    const loadedMesh = [...deserialized.meshes.values()].find((mesh) => mesh.metadata?.terrainLayers);
    expect(loadedMesh?.metadata?.terrainLayers).toContain('layer_grass');
    const sourceCorner = [...(terrainMesh?.faceCorners.values() ?? [])][0];
    const loadedCorner = [...(loadedMesh?.faceCorners.values() ?? [])][0];
    expect(loadedCorner?.vertexColour?.x).toBeCloseTo(sourceCorner?.vertexColour?.x ?? 1);
  });

  it('round-trips 3D tile-draw object metadata', () => {
    const session = new EditorSession();
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

    const object = [...session.document.objects.values()][0]!;
    expect(object.metadata.tileLayer).toBe('Geometry');
    expect(object.metadata.tileDrawCells).toBeTruthy();

    const loaded = deserializeViperProject(serializeViperProject(session.project, 'test'));
    const restored = [...loaded.project.documents.values()]
      .flatMap((doc) => [...doc.objects.values()])
      .find((candidate) => candidate.metadata.tileLayer === 'Geometry');
    expect(restored?.metadata.tileLayer).toBe('Geometry');
    expect(restored?.metadata.tileDrawCells).toBe(object.metadata.tileDrawCells);
    expect(restored?.metadata.tilePlaneKey).toBe(object.metadata.tilePlaneKey);
  });
});
