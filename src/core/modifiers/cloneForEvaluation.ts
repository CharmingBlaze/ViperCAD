import { createId } from '@/core/ids/IdService';
import { cloneMeshPreserveIds } from '@/core/mesh/EditableMesh';
import type { EditableMesh } from '@/core/mesh/types';

/** Deep-clone a mesh for transient modifier evaluation (not stored in the document). */
export function cloneMeshForEvaluation(source: EditableMesh): EditableMesh {
  const clone = cloneMeshPreserveIds(source);
  clone.id = createId('mesh');
  clone.name = `${source.name}_eval`;
  return clone;
}
