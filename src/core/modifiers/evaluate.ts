import { cloneMeshForEvaluation } from '@/core/modifiers/cloneForEvaluation';
import { applyMirrorModifier } from '@/core/modifiers/mirrorModifier';
import { catmullClarkSubdivide } from '@/core/modifiers/subdivisionModifier';
import { applyArrayModifier } from '@/core/modifiers/arrayModifier';
import { bevelEdges } from '@/core/mesh/ops/bevel';
import { solidifyMesh } from '@/core/mesh/ops/solidify';
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
      continue;
    }
    if (modifier.kind === 'solidify') {
      solidifyMesh(mesh, { thickness: modifier.thickness, offset: modifier.offset });
      continue;
    }
    if (modifier.kind === 'bevel') {
      const manifoldEdges = [...mesh.edges.values()]
        .filter((edge) => edge.halfEdgeBId != null)
        .map((edge) => edge.id);
      bevelEdges(mesh, manifoldEdges, {
        width: modifier.width,
        segments: modifier.segments,
        profile: modifier.profile,
      });
      continue;
    }
    if (modifier.kind === 'array') {
      mesh = applyArrayModifier(mesh, modifier);
    }
  }

  return mesh;
}
