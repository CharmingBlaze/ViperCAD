import type { EditorSession } from '@/core/editor/EditorSession';
import type { SceneObject } from '@/core/document/types';
import type { EditableMesh } from '@/core/mesh/types';
import { cloneMeshPreserveIds, restoreMeshFromSnapshot } from '@/core/mesh/EditableMesh';
import { bakeModifierStackOntoMesh, invalidateDisplayMeshCache } from '@/core/modifiers/displayMesh';
import {
  readObjectModifierStack,
  writeObjectModifierStack,
} from '@/core/modifiers/serialize';
import {
  createDefaultMirrorModifier,
  createDefaultSubdivisionModifier,
  createEmptyModifierStack,
  MODIFIER_STACK_METADATA_KEY,
  type MirrorAxis,
  type ModifierSpec,
  type ModifierStack,
} from '@/core/modifiers/types';

type Props = {
  session: EditorSession;
  object: SceneObject | null;
  mesh: EditableMesh | null;
  onRefresh: () => void;
};

export function ModifierStackPanel({ session, object, mesh, onRefresh }: Props) {
  if (!object || !mesh) return null;

  const stack = readObjectModifierStack(object) ?? createEmptyModifierStack();

  const commitStack = (next: ModifierStack, name: string) => {
    const beforeRaw = object.metadata[MODIFIER_STACK_METADATA_KEY];
    const afterRaw = next.modifiers.length ? JSON.stringify(next) : undefined;
    writeObjectModifierStack(object, next.modifiers.length ? next : null);
    invalidateDisplayMeshCache();
    session.document.dirty = true;
    session.requestRedraw();
    onRefresh();

    let applied = true;
    session.history.execute({
      name,
      execute: () => {
        if (applied) return;
        if (afterRaw) object.metadata[MODIFIER_STACK_METADATA_KEY] = afterRaw;
        else delete object.metadata[MODIFIER_STACK_METADATA_KEY];
        invalidateDisplayMeshCache();
        session.document.dirty = true;
        applied = true;
        session.requestRedraw();
        onRefresh();
      },
      undo: () => {
        if (beforeRaw) object.metadata[MODIFIER_STACK_METADATA_KEY] = beforeRaw;
        else delete object.metadata[MODIFIER_STACK_METADATA_KEY];
        invalidateDisplayMeshCache();
        session.document.dirty = true;
        applied = false;
        session.requestRedraw();
        onRefresh();
      },
    });
  };

  const updateModifier = (index: number, patch: Partial<ModifierSpec>) => {
    const modifiers = stack.modifiers.map((modifier, modifierIndex) => (
      modifierIndex === index ? { ...modifier, ...patch } as ModifierSpec : modifier
    ));
    commitStack({ ...stack, modifiers }, 'Edit modifier');
  };

  const addMirror = (axis: MirrorAxis = 'x') => {
    commitStack(
      { ...stack, modifiers: [...stack.modifiers, createDefaultMirrorModifier(axis)] },
      'Add Mirror',
    );
  };

  const addSubdivision = () => {
    commitStack(
      { ...stack, modifiers: [...stack.modifiers, createDefaultSubdivisionModifier(2)] },
      'Add Subdivision Surface',
    );
  };

  const removeModifier = (index: number) => {
    commitStack(
      { ...stack, modifiers: stack.modifiers.filter((_, modifierIndex) => modifierIndex !== index) },
      'Remove modifier',
    );
  };

  const moveModifier = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= stack.modifiers.length) return;
    const modifiers = [...stack.modifiers];
    const [entry] = modifiers.splice(index, 1);
    modifiers.splice(target, 0, entry!);
    commitStack({ ...stack, modifiers }, 'Reorder modifiers');
  };

  const applyStack = () => {
    if (!stack.modifiers.some((modifier) => modifier.enabled)) return;
    const beforeMesh = cloneMeshPreserveIds(mesh);
    const beforeRaw = object.metadata[MODIFIER_STACK_METADATA_KEY];
    const applied = bakeModifierStackOntoMesh(mesh, object);
    if (!applied) return;
    session.document.dirty = true;
    session.requestRedraw();
    onRefresh();

    let historyApplied = true;
    session.history.execute({
      name: 'Apply modifiers',
      execute: () => {
        if (historyApplied) return;
        restoreAppliedMesh(session, object, beforeMesh, beforeRaw);
        historyApplied = true;
        session.requestRedraw();
        onRefresh();
      },
      undo: () => {
        restoreAppliedMesh(session, object, beforeMesh, beforeRaw);
        historyApplied = false;
        session.requestRedraw();
        onRefresh();
      },
    });
  };

  return (
    <section className="uv-section">
      <h3 className="uv-section-title">Modifier Stack</h3>
      <p className="uv-meta">Non-destructive mirror and subdivision — edit the base mesh, viewport shows the result.</p>
      <div className="uv-btn-grid uv-btn-grid-2">
        <button type="button" className="tool" onClick={() => addMirror('x')}>+ Mirror</button>
        <button type="button" className="tool" onClick={addSubdivision}>+ Subdivision</button>
      </div>
      {stack.modifiers.length === 0 && (
        <p className="uv-hint">Add Mirror or Subdivision Surface modifiers like Blender.</p>
      )}
      {stack.modifiers.map((modifier, index) => (
        <div key={`${modifier.kind}-${index}`} className="uv-subsection">
          <div className="uv-btn-grid uv-btn-grid-2">
            <strong>{modifier.kind === 'mirror' ? 'Mirror' : 'Subdivision Surface'}</strong>
            <label className="uv-check">
              <input
                type="checkbox"
                checked={modifier.enabled}
                onChange={(event) => updateModifier(index, { enabled: event.target.checked })}
              />
              Enabled
            </label>
          </div>
          {modifier.kind === 'mirror' && (
            <>
              <label className="uv-field">
                <span>Axis</span>
                <select
                  className="uv-text"
                  value={modifier.axis}
                  onChange={(event) => updateModifier(index, { axis: event.target.value as MirrorAxis })}
                >
                  <option value="x">X</option>
                  <option value="y">Y</option>
                  <option value="z">Z</option>
                </select>
              </label>
              <label className="uv-check">
                <input
                  type="checkbox"
                  checked={modifier.clip}
                  onChange={(event) => updateModifier(index, { clip: event.target.checked })}
                />
                Clip (delete negative side)
              </label>
              <label className="uv-field">
                <span>Merge threshold</span>
                <input
                  className="uv-text"
                  type="number"
                  min={0}
                  step={0.0001}
                  value={modifier.mergeThreshold}
                  onChange={(event) => updateModifier(index, {
                    mergeThreshold: Math.max(0, Number(event.target.value)),
                  })}
                />
              </label>
            </>
          )}
          {modifier.kind === 'subdivision' && (
            <>
              <label className="uv-field">
                <span>Viewport levels</span>
                <input
                  className="uv-text"
                  type="number"
                  min={1}
                  max={6}
                  step={1}
                  value={modifier.levels}
                  onChange={(event) => {
                    const levels = Math.max(1, Math.min(6, Math.round(Number(event.target.value) || 1)));
                    updateModifier(index, { levels });
                  }}
                />
              </label>
              <label className="uv-check">
                <input
                  type="checkbox"
                  checked={modifier.useCrease}
                  onChange={(event) => updateModifier(index, { useCrease: event.target.checked })}
                />
                Use crease / sharp edges
              </label>
            </>
          )}
          <div className="uv-btn-grid uv-btn-grid-3">
            <button type="button" className="tool" disabled={index === 0} onClick={() => moveModifier(index, -1)}>↑</button>
            <button type="button" className="tool" disabled={index === stack.modifiers.length - 1} onClick={() => moveModifier(index, 1)}>↓</button>
            <button type="button" className="tool danger" onClick={() => removeModifier(index)}>Remove</button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="tool primary"
        disabled={!stack.modifiers.some((modifier) => modifier.enabled)}
        onClick={applyStack}
      >
        Apply modifiers (bake to mesh)
      </button>
    </section>
  );
}

function restoreAppliedMesh(
  session: EditorSession,
  object: SceneObject,
  meshSnapshot: EditableMesh,
  stackRaw: string | undefined,
): void {
  const current = session.document.meshes.get(meshSnapshot.id);
  if (current) restoreMeshFromSnapshot(current, meshSnapshot);
  if (stackRaw) object.metadata[MODIFIER_STACK_METADATA_KEY] = stackRaw;
  else delete object.metadata[MODIFIER_STACK_METADATA_KEY];
  invalidateDisplayMeshCache();
  session.document.dirty = true;
}
