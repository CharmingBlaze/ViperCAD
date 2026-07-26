import type { AxisConstraint, TransformOrientation } from './types';

/**
 * Blender-style axis key: first press uses active orientation axes;
 * when orientation is Global, second press of same axis switches to local.
 */
export function applyAxisKey(
  key: 'x' | 'y' | 'z',
  shift: boolean,
  current: AxisConstraint,
  lastAxisKey: 'x' | 'y' | 'z' | null,
  orientation: TransformOrientation,
  constraintUsesLocal: boolean,
): { constraint: AxisConstraint; lastAxisKey: 'x' | 'y' | 'z' | null; constraintUsesLocal: boolean } {
  if (shift) {
    const plane: AxisConstraint = key === 'x' ? 'yz' : key === 'y' ? 'xz' : 'xy';
    return { constraint: plane, lastAxisKey: key, constraintUsesLocal: false };
  }

  if (orientation === 'global' && lastAxisKey === key && current === key && !constraintUsesLocal) {
    return { constraint: key, lastAxisKey: key, constraintUsesLocal: true };
  }

  if (current === key && lastAxisKey === key) {
    // Toggle off
    return { constraint: 'none', lastAxisKey: null, constraintUsesLocal: false };
  }

  return {
    constraint: key,
    lastAxisKey: key,
    constraintUsesLocal: orientation === 'local' || orientation === 'normal' || orientation === 'view',
  };
}

export function constraintLabel(c: AxisConstraint): string {
  if (c === 'none') return 'Free';
  return c.toUpperCase();
}
