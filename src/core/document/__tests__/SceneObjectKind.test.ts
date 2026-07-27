import { beforeEach, describe, expect, it } from 'vitest';
import { createSceneObject } from '@/core/document/ModelDocument';
import {
  isGroupObject,
  migrateSceneObjectKind,
  normalizeSceneObject,
} from '@/core/document/SceneObjectKind';
import { resetIdCounter } from '@/core/ids/IdService';

beforeEach(() => resetIdCounter(1));

describe('SceneObjectKind migration', () => {
  it('infers mesh, group, collision, terrain, and empty kinds from legacy objects', () => {
    const mesh = createSceneObject('Mesh', 'mesh_1' as never, [], { kind: 'mesh' });
    delete (mesh as { kind?: string }).kind;
    expect(migrateSceneObjectKind(mesh)).toBe('mesh');

    const group = createSceneObject('Group', null, [], { kind: 'group' });
    delete (group as { kind?: string }).kind;
    group.meshId = null;
    group.childIds = ['child_1' as never];
    expect(migrateSceneObjectKind(group)).toBe('group');

    const prefabGroup = createSceneObject('Prefab', null);
    delete (prefabGroup as { kind?: string }).kind;
    prefabGroup.metadata.prefab = 'true';
    expect(migrateSceneObjectKind(prefabGroup)).toBe('group');

    const collision = createSceneObject('Collider', 'mesh_2' as never);
    delete (collision as { kind?: string }).kind;
    collision.metadata.gameRole = 'collision';
    expect(migrateSceneObjectKind(collision)).toBe('collision');

    const terrain = createSceneObject('Terrain', 'mesh_3' as never);
    delete (terrain as { kind?: string }).kind;
    terrain.metadata.terrain = 'true';
    expect(migrateSceneObjectKind(terrain)).toBe('terrain');

    const empty = createSceneObject('Empty');
    delete (empty as { kind?: string }).kind;
    expect(migrateSceneObjectKind(empty)).toBe('empty');
  });

  it('normalizes legacy prefab groups and removes prefab metadata', () => {
    const group = createSceneObject('Legacy Group', null);
    delete (group as { kind?: string }).kind;
    group.metadata.prefab = 'true';
    group.childIds = ['child' as never];

    normalizeSceneObject(group);
    expect(group.kind).toBe('group');
    expect(group.metadata.prefab).toBeUndefined();
    expect(isGroupObject(group)).toBe(true);
  });
});
