export type MirrorAxis = 'x' | 'y' | 'z';

export type MirrorModifierSpec = {
  kind: 'mirror';
  enabled: boolean;
  axis: MirrorAxis;
  /** Weld vertices on the mirror plane within this distance. */
  mergeThreshold: number;
  /** Remove geometry on the negative side of the mirror plane before mirroring. */
  clip: boolean;
};

export type SubdivisionModifierSpec = {
  kind: 'subdivision';
  enabled: boolean;
  /** Subdivision levels (1–6), like Blender viewport levels. */
  levels: number;
  /** Respect edge crease / sharp flags when subdividing. */
  useCrease: boolean;
};

export type ModifierSpec = MirrorModifierSpec | SubdivisionModifierSpec;

export type ModifierStack = {
  version: 1;
  modifiers: ModifierSpec[];
};

export const MODIFIER_STACK_METADATA_KEY = 'modifierStack';

export function createDefaultMirrorModifier(axis: MirrorAxis = 'x'): MirrorModifierSpec {
  return {
    kind: 'mirror',
    enabled: true,
    axis,
    mergeThreshold: 0.001,
    clip: true,
  };
}

export function createDefaultSubdivisionModifier(levels = 2): SubdivisionModifierSpec {
  return {
    kind: 'subdivision',
    enabled: true,
    levels: Math.max(1, Math.min(6, Math.round(levels))),
    useCrease: true,
  };
}

export function createEmptyModifierStack(): ModifierStack {
  return { version: 1, modifiers: [] };
}

export function stackHasEnabledModifiers(stack: ModifierStack | null | undefined): boolean {
  return !!stack?.modifiers.some((modifier) => modifier.enabled);
}
