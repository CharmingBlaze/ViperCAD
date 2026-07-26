import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/core/document/ModelDocument';
import { resetIdCounter } from '@/core/ids/IdService';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import {
  addMeshesToTerrainLibrary,
} from '@/core/terrain/TerrainObjectLibrary';
import { projectTerrainPropSources } from '@/core/terrain/TerrainProps';

beforeEach(() => resetIdCounter(1));

describe('terrain object library', () => {
  it('stores imported meshes as hidden reusable palette sources', () => {
    const document = createEmptyDocument();
    const [source] = addMeshesToTerrainLibrary(
      document,
      [buildBox({ width: 2, height: 3, depth: 2, name: 'Cabin' })],
    );

    expect(source).toBeDefined();
    expect(source!.visible).toBe(false);
    expect(source!.locked).toBe(true);
    expect(source!.metadata.terrainLibrarySource).toBe('true');
    expect(projectTerrainPropSources(document).map((object) => object.id)).toContain(source!.id);
  });
});
