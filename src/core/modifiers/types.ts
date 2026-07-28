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

export type SolidifyModifierSpec = {
  kind: 'solidify';
  enabled: boolean;
  thickness: number;
  offset: number;
};

export type BevelModifierSpec = {
  kind: 'bevel';
  enabled: boolean;
  width: number;
  segments: number;
  profile: number;
};

export type ArrayModifierSpec = {
  kind: 'array';
  enabled: boolean;
  axis: MirrorAxis;
  count: number;
  spacing: number;
};

export type ModifierSpec =
  | MirrorModifierSpec
  | SubdivisionModifierSpec
  | SolidifyModifierSpec
  | BevelModifierSpec
  | ArrayModifierSpec;

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

export function createDefaultSolidifyModifier(): SolidifyModifierSpec {
  return { kind: 'solidify', enabled: true, thickness: 0.1, offset: 0 };
}

export function createDefaultBevelModifier(): BevelModifierSpec {
  return { kind: 'bevel', enabled: true, width: 0.05, segments: 1, profile: 0.5 };
}

export function createDefaultArrayModifier(): ArrayModifierSpec {
  return { kind: 'array', enabled: true, axis: 'x', count: 3, spacing: 1.25 };
}

export function createEmptyModifierStack(): ModifierStack {
  return { version: 1, modifiers: [] };
}

export function stackHasEnabledModifiers(stack: ModifierStack | null | undefined): boolean {
  return !!stack?.modifiers.some((modifier) => modifier.enabled);
}
