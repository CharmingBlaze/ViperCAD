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
  createDefaultArrayModifier,
  createDefaultBevelModifier,
  createDefaultSolidifyModifier,
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

  const addModifier = (modifier: ModifierSpec, name: string) => {
    commitStack(
      { ...stack, modifiers: [...stack.modifiers, modifier] },
      name,
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
      <p className="uv-meta">Edit the base mesh while the viewport shows the complete non-destructive result.</p>
      <div className="uv-btn-grid uv-btn-grid-3">
        <button type="button" className="tool" onClick={() => addMirror('x')}>+ Mirror</button>
        <button type="button" className="tool" onClick={addSubdivision}>+ Subdivision</button>
        <button type="button" className="tool" onClick={() => addModifier(createDefaultSolidifyModifier(), 'Add Solidify')}>+ Solidify</button>
        <button type="button" className="tool" onClick={() => addModifier(createDefaultBevelModifier(), 'Add Bevel')}>+ Bevel</button>
        <button type="button" className="tool" onClick={() => addModifier(createDefaultArrayModifier(), 'Add Array')}>+ Array</button>
      </div>
      {stack.modifiers.length === 0 && (
        <p className="uv-hint">Build a live stack with Mirror, Subdivision, Solidify, Bevel, and Array.</p>
      )}
      {stack.modifiers.map((modifier, index) => (
        <div key={`${modifier.kind}-${index}`} className="uv-subsection">
          <div className="uv-btn-grid uv-btn-grid-2">
            <strong>{modifierLabel(modifier)}</strong>
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
          {modifier.kind === 'solidify' && (
            <>
              <label className="uv-field">
                <span>Thickness</span>
                <input className="uv-text" type="number" step={0.01} value={modifier.thickness} onChange={(event) => updateModifier(index, { thickness: Number(event.target.value) || 0.01 })} />
              </label>
              <label className="uv-field">
                <span>Offset · {modifier.offset.toFixed(2)}</span>
                <input className="uv-range" type="range" min={-1} max={1} step={0.05} value={modifier.offset} onChange={(event) => updateModifier(index, { offset: Number(event.target.value) })} />
              </label>
            </>
          )}
          {modifier.kind === 'bevel' && (
            <>
              <label className="uv-field">
                <span>Width</span>
                <input className="uv-text" type="number" min={0.0001} step={0.01} value={modifier.width} onChange={(event) => updateModifier(index, { width: Math.max(0.0001, Number(event.target.value) || 0.0001) })} />
              </label>
              <label className="uv-field">
                <span>Segments · {modifier.segments}</span>
                <input className="uv-range" type="range" min={1} max={8} step={1} value={modifier.segments} onChange={(event) => updateModifier(index, { segments: Number(event.target.value) })} />
              </label>
              <label className="uv-field">
                <span>Profile · {modifier.profile.toFixed(2)}</span>
                <input className="uv-range" type="range" min={0.05} max={0.95} step={0.05} value={modifier.profile} onChange={(event) => updateModifier(index, { profile: Number(event.target.value) })} />
              </label>
            </>
          )}
          {modifier.kind === 'array' && (
            <>
              <label className="uv-field">
                <span>Axis</span>
                <select className="uv-text" value={modifier.axis} onChange={(event) => updateModifier(index, { axis: event.target.value as MirrorAxis })}>
                  <option value="x">X</option>
                  <option value="y">Y</option>
                  <option value="z">Z</option>
                </select>
              </label>
              <label className="uv-field">
                <span>Count · {modifier.count}</span>
                <input className="uv-range" type="range" min={1} max={32} step={1} value={modifier.count} onChange={(event) => updateModifier(index, { count: Number(event.target.value) })} />
              </label>
              <label className="uv-field">
                <span>Spacing</span>
                <input className="uv-text" type="number" step={0.1} value={modifier.spacing} onChange={(event) => updateModifier(index, { spacing: Number(event.target.value) || 0 })} />
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

function modifierLabel(modifier: ModifierSpec): string {
  if (modifier.kind === 'subdivision') return 'Subdivision Surface';
  return modifier.kind[0]!.toUpperCase() + modifier.kind.slice(1);
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
