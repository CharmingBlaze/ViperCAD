import {
  createDefaultMirrorModifier,
  createDefaultSubdivisionModifier,
  createEmptyModifierStack,
  MODIFIER_STACK_METADATA_KEY,
  type MirrorAxis,
  type ModifierSpec,
  type ModifierStack,
} from '@/core/modifiers/types';
import type { SceneObject } from '@/core/document/types';

function normalizeMirrorAxis(value: unknown): MirrorAxis {
  return value === 'y' || value === 'z' ? value : 'x';
}

function normalizeModifier(raw: unknown): ModifierSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.kind === 'mirror') {
    const defaults = createDefaultMirrorModifier(normalizeMirrorAxis(value.axis));
    return {
      kind: 'mirror',
      enabled: value.enabled !== false,
      axis: normalizeMirrorAxis(value.axis),
      mergeThreshold: typeof value.mergeThreshold === 'number'
        ? Math.max(0, value.mergeThreshold)
        : defaults.mergeThreshold,
      clip: value.clip !== false,
    };
  }
  if (value.kind === 'subdivision') {
    const levels = typeof value.levels === 'number' ? Math.round(value.levels) : 2;
    return {
      kind: 'subdivision',
      enabled: value.enabled !== false,
      levels: Math.max(1, Math.min(6, levels)),
      useCrease: value.useCrease !== false,
    };
  }
  return null;
}

export function normalizeModifierStack(raw: unknown): ModifierStack {
  if (!raw || typeof raw !== 'object') return createEmptyModifierStack();
  const value = raw as Partial<ModifierStack>;
  const modifiers = Array.isArray(value.modifiers)
    ? value.modifiers.map(normalizeModifier).filter(Boolean) as ModifierSpec[]
    : [];
  return { version: 1, modifiers };
}

export function readModifierStack(raw: string | undefined): ModifierStack | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const stack = normalizeModifierStack(parsed);
    return stack.modifiers.length ? stack : null;
  } catch {
    return null;
  }
}

export function readObjectModifierStack(object: SceneObject): ModifierStack | null {
  return readModifierStack(object.metadata[MODIFIER_STACK_METADATA_KEY]);
}

export function serializeModifierStack(stack: ModifierStack): string {
  return JSON.stringify(normalizeModifierStack(stack));
}

export function writeObjectModifierStack(object: SceneObject, stack: ModifierStack | null): void {
  if (!stack?.modifiers.length) {
    delete object.metadata[MODIFIER_STACK_METADATA_KEY];
    return;
  }
  object.metadata[MODIFIER_STACK_METADATA_KEY] = serializeModifierStack(stack);
}
