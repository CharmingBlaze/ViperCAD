import {
  cloneMeshPreserveIds,
  restoreMeshFromSnapshot,
} from '@/core/mesh/EditableMesh';
import type { EditableMesh } from '@/core/mesh/types';
import type { ValidationReport } from '@/core/mesh/Validation';
import { validateMeshFast, validateMeshFull } from '@/core/mesh/Validation';
import type { CommandHistory } from './CommandHistory';
import { cloneSelection, type SelectionManager, type SelectionState } from '@/core/selection/SelectionManager';

export type TransactionResult<T> = {
  ok: boolean;
  value?: T;
  error?: string;
  validation?: ValidationReport;
};

/**
 * Geometry transaction: snapshot → mutate → validate → commit undo entry, or restore.
 * Mutate runs once; history stores before/after snapshots for undo/redo.
 */
export function runMeshTransaction<T>(
  history: CommandHistory,
  mesh: EditableMesh,
  name: string,
  mutate: (mesh: EditableMesh) => T,
  options: { fullValidation?: boolean; selection?: SelectionManager } = {},
): TransactionResult<T> {
  const before = cloneMeshPreserveIds(mesh);
  const selectionBefore = options.selection ? cloneSelection(options.selection.state) : null;

  try {
    const value = mutate(mesh);
    const validation = options.fullValidation ? validateMeshFull(mesh) : validateMeshFast(mesh);
    if (!validation.ok) {
      restoreMeshFromSnapshot(mesh, before);
      return {
        ok: false,
        error: validation.issues
          .filter((i) => i.severity === 'error')
          .map((i) => i.message)
          .join('; '),
        validation,
      };
    }

    const after = cloneMeshPreserveIds(mesh);
    const selectionAfter = options.selection ? cloneSelection(options.selection.state) : null;
    let applied = true;

    history.execute({
      name,
      execute: () => {
        if (!applied) {
          restoreMeshFromSnapshot(mesh, after);
          if (options.selection && selectionAfter) restoreSelection(options.selection, selectionAfter);
          applied = true;
        }
      },
      undo: () => {
        restoreMeshFromSnapshot(mesh, before);
        if (options.selection && selectionBefore) restoreSelection(options.selection, selectionBefore);
        applied = false;
      },
    });

    return { ok: true, value, validation };
  } catch (err) {
    restoreMeshFromSnapshot(mesh, before);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function restoreSelection(manager: SelectionManager, snapshot: SelectionState): void {
  manager.state = cloneSelection(snapshot);
}
