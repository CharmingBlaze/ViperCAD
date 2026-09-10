import { beforeEach, describe, expect, it } from 'vitest';
import { exportDocumentGlb, objectsForExport, validateGlbRoundTrip } from '@/app/GameExport';
import {
  EXPORT_PROFILES,
  exportDiagnostics,
  gameReadiness,
} from '@/app/GameExportProfiles';
import { createEmptyDocument, commitMeshObject } from '@/core/document/ModelDocument';
import { EditorSession } from '@/core/editor/EditorSession';
import { generateMeshCollider } from '@/core/editor/GameAssetTools';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox } from '@/core/mesh/builders';
import { createTerrain } from '@/core/terrain/Terrain';
import { ensureTerrainPresetSource } from '@/core/terrain/TerrainProps';

beforeEach(() => resetIdCounter(1));

describe('gameReadiness / exportDiagnostics', () => {
  it('reports an error for an empty scene', () => {
    const doc = createEmptyDocument();
    const diagnostics = exportDiagnostics(doc, EXPORT_PROFILES.godot);
    expect(diagnostics.errors[0]).toMatch(/no objects/i);
    expect(diagnostics.stats.objects).toBe(0);
  });

  it('counts collision objects and omits library sources from export object count', () => {
    const session = new EditorSession();
    createTerrain(session, { size: 10, resolution: 4 });
    ensureTerrainPresetSource(session.document, 'tree');
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(session.document, mesh, { name: 'Prop' });
    generateMeshCollider(session.document, objectId);

    const stats = gameReadiness(session.document);
    expect(stats.hiddenLibraryObjects).toBeGreaterThanOrEqual(1);
    expect(stats.collisionObjects).toBeGreaterThanOrEqual(1);
    expect(stats.objects).toBe(session.document.objects.size - stats.hiddenLibraryObjects);

    const diagnostics = exportDiagnostics(session.document, EXPORT_PROFILES.godot);
    expect(diagnostics.warnings.some((warning) => /library\/palette/i.test(warning))).toBe(true);
  });

  it('warns about missing lightmap UVs for Unity and Unreal', () => {
    const session = new EditorSession();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    commitMeshObject(session.document, mesh, { name: 'Wall' });
    const unity = exportDiagnostics(session.document, EXPORT_PROFILES.unity);
    const unreal = exportDiagnostics(session.document, EXPORT_PROFILES.unreal);
    expect(unity.warnings.some((warning) => /lightmap/i.test(warning))).toBe(true);
    expect(unreal.warnings.some((warning) => /lightmap/i.test(warning))).toBe(true);
  });
});

describe('objectsForExport', () => {
  it('omits terrain palette/library sources even when onlyVisible is false', () => {
    const session = new EditorSession();
    createTerrain(session, { size: 8, resolution: 4 });
    const brush = ensureTerrainPresetSource(session.document, 'rock');
    expect(brush.visible).toBe(false);

    const exported = objectsForExport(session.document, EXPORT_PROFILES.godot);
    expect(exported.some((object) => object.id === brush.id)).toBe(false);
    expect(exported.some((object) => object.metadata.terrain === 'true')).toBe(true);
  });

  it('excludes colliders when the profile disables them', () => {
    const session = new EditorSession();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(session.document, mesh, { name: 'Block' });
    const colliderId = generateMeshCollider(session.document, objectId);

    const withColliders = objectsForExport(session.document, EXPORT_PROFILES.godot);
    const withoutColliders = objectsForExport(session.document, EXPORT_PROFILES.roblox);
    expect(withColliders.some((object) => object.id === colliderId)).toBe(true);
    expect(withoutColliders.some((object) => object.id === colliderId)).toBe(false);
  });

  it('honors excludeFromExport metadata', () => {
    const session = new EditorSession();
    const mesh = buildBox({ width: 1, height: 1, depth: 1 });
    const { objectId } = commitMeshObject(session.document, mesh, { name: 'Hidden Helper' });
    session.document.objects.get(objectId)!.metadata.excludeFromExport = 'true';
    const exported = objectsForExport(session.document, EXPORT_PROFILES.godot);
    expect(exported.some((object) => object.id === objectId)).toBe(false);
  });
});

describe('exportDocumentGlb', () => {
  it('exports a box that round-trips with triangles', async () => {
    if (typeof FileReader === 'undefined') {
      class NodeFileReader {
        result: ArrayBuffer | null = null;
        onloadend: ((this: NodeFileReader, ev: unknown) => void) | null = null;
        readAsArrayBuffer(blob: Blob) {
          void blob.arrayBuffer().then((buffer) => {
            this.result = buffer;
            this.onloadend?.call(this, {});
          });
        }
      }
      (globalThis as { FileReader: typeof NodeFileReader }).FileReader = NodeFileReader;
    }
    const document = createEmptyDocument('Prop');
    const { objectId } = commitMeshObject(document, buildBox({ width: 1, height: 1, depth: 1 }), { name: 'Box' });
    // Node has no canvas; strip maps so GLTFExporter does not rasterize textures.
    document.objects.get(objectId)!.materialSlotIds = [];
    document.materials.clear();
    document.textures.clear();
    document.images.clear();
    const buffer = await exportDocumentGlb(document, EXPORT_PROFILES.godot);
    expect(buffer.byteLength).toBeGreaterThan(100);
    const report = await validateGlbRoundTrip(buffer);
    expect(report.errors).toEqual([]);
    expect(report.meshes).toBeGreaterThan(0);
    expect(report.triangles).toBeGreaterThan(0);
  });
});
