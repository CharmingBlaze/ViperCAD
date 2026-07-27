import type { SceneObject } from '@/core/document/types';
import { restoreMeshFromSnapshot } from '@/core/mesh/EditableMesh';
import type { EditableMesh } from '@/core/mesh/types';
import { evaluateModifierStack } from '@/core/modifiers/evaluate';
import {
  readObjectModifierStack,
  serializeModifierStack,
  writeObjectModifierStack,
} from '@/core/modifiers/serialize';
import type { ModifierStack } from '@/core/modifiers/types';
import { stackHasEnabledModifiers } from '@/core/modifiers/types';

const displayCache = new Map<string, EditableMesh>();
const CACHE_LIMIT = 96;

function cacheKey(base: EditableMesh, stack: ModifierStack): string {
  return `${base.id}:${base.topologyVersion}:${base.geometryVersion}:${serializeModifierStack(stack)}`;
}

function trimCache(): void {
  if (displayCache.size <= CACHE_LIMIT) return;
  const keys = [...displayCache.keys()];
  for (let index = 0; index < keys.length - CACHE_LIMIT; index += 1) {
    displayCache.delete(keys[index]!);
  }
}

export function resolveDisplayMesh(base: EditableMesh, object: SceneObject): EditableMesh {
  const stack = readObjectModifierStack(object);
  if (!stackHasEnabledModifiers(stack)) return base;

  const key = cacheKey(base, stack!);
  const cached = displayCache.get(key);
  if (cached) return cached;

  const evaluated = evaluateModifierStack(base, stack!);
  displayCache.set(key, evaluated);
  trimCache();
  return evaluated;
}

export function invalidateDisplayMeshCache(): void {
  displayCache.clear();
}

export function bakeModifierStackOntoMesh(base: EditableMesh, object: SceneObject): boolean {
  const stack = readObjectModifierStack(object);
  if (!stackHasEnabledModifiers(stack)) return false;
  const evaluated = evaluateModifierStack(base, stack!);
  restoreMeshFromSnapshot(base, evaluated);
  writeObjectModifierStack(object, null);
  invalidateDisplayMeshCache();
  return true;
}
