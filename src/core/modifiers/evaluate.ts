import { cloneMeshForEvaluation } from '@/core/modifiers/cloneForEvaluation';
import { applyMirrorModifier } from '@/core/modifiers/mirrorModifier';
import { catmullClarkSubdivide } from '@/core/modifiers/subdivisionModifier';
import type { ModifierStack } from '@/core/modifiers/types';
import type { EditableMesh } from '@/core/mesh/types';

export function evaluateModifierStack(source: EditableMesh, stack: ModifierStack): EditableMesh {
  let mesh = cloneMeshForEvaluation(source);

  for (const modifier of stack.modifiers) {
    if (!modifier.enabled) continue;
    if (modifier.kind === 'mirror') {
      mesh = applyMirrorModifier(mesh, modifier);
      continue;
    }
    if (modifier.kind === 'subdivision') {
      mesh = catmullClarkSubdivide(mesh, modifier.levels, modifier.useCrease);
    }
  }

  return mesh;
}
