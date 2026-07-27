import { readRigDocumentSettings, writeRigDocumentSettings } from '@/core/rig/RigDocument';
import { getActiveClip } from '@/core/rig/RigDocument';
import { BoneEditorPanel } from './BoneEditorPanel';
import type { RigSession } from '../RigSession';

type Props = {
  session: RigSession;
  onRefresh: () => void;
};

export function RigSidebar({ session, onRefresh }: Props) {
  const doc = session.rigDocument;
  const settings = readRigDocumentSettings(doc);
  const status = session.getSetupStatus();
  const clips = session.getClips();
  const activeClip = getActiveClip(session.project, doc);

  return (
    <aside className="app-inspector rig-sidebar">
      <section className="rig-panel">
        <h3 className="rig-panel-title">Rig document</h3>
        <p className="rig-doc-name">{doc.name}</p>
        <div className="rig-stat-row">
          <span className="rig-stat">{status.meshObjectCount} meshes</span>
          <span className="rig-stat">{status.armatureBoneCount} bones</span>
          <span className="rig-stat">{status.skinBindingCount} bindings</span>
        </div>

        <div className="rig-segmented rig-segmented-3" role="tablist" aria-label="Edit mode">
          {(['edit', 'pose', 'weight'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`rig-segment${session.editMode === mode ? ' is-active' : ''}`}
              onClick={() => { session.editMode = mode; onRefresh(); }}
            >
              {mode === 'edit' ? 'Edit bones' : mode === 'pose' ? 'Pose' : 'Weights'}
            </button>
          ))}
        </div>

        <label className="rig-field">
          <span>Source model</span>
          <select
            className="rig-select"
            value={settings.sourceModelDocumentId ?? ''}
            onChange={(event) => {
              writeRigDocumentSettings(doc, {
                ...settings,
                sourceModelDocumentId: event.target.value || null,
              });
              session.project.dirty = true;
              doc.dirty = true;
              onRefresh();
            }}
          >
            <option value="">Choose model…</option>
            {session.project.modelDocumentIds.map((id) => {
              const model = session.project.documents.get(id);
              return <option key={id} value={id}>{model?.name ?? id}</option>;
            })}
          </select>
        </label>

        <div className="rig-btn-row">
          <button
            type="button"
            className="rig-btn rig-btn-primary"
            onClick={() => {
              session.runQuickSetup(true);
              onRefresh();
            }}
          >
            Quick setup
          </button>
          <button type="button" className="rig-btn" onClick={() => { session.bindMeshesFromSourceModel(true); onRefresh(); }}>
            Rebind weights
          </button>
          <button type="button" className="rig-btn" onClick={() => session.pushToCad()}>
            Sync to ViperCAD
          </button>
        </div>
      </section>

      <section className="rig-panel">
        <h3 className="rig-panel-title">Viewport</h3>
        <div className="rig-segmented rig-segmented-3" role="tablist" aria-label="Mesh display">
          {([
            ['material', 'Materials'],
            ['uv', 'UVs'],
            ['wireframe', 'Wire'],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`rig-segment${session.viewportDisplayMode === mode ? ' is-active' : ''}`}
              onClick={() => { session.viewportDisplayMode = mode; onRefresh(); }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="rig-hint">Materials use project textures. UV mode shows a checker map.</p>
      </section>

      <section className="rig-panel">
        <h3 className="rig-panel-title">Skinning</h3>
        <label className="rig-field">
          <span>Envelope falloff</span>
          <input
            className="rig-input"
            type="range"
            min={0.25}
            max={1.2}
            step={0.05}
            value={session.envelopeFalloff}
            onChange={(event) => {
              session.envelopeFalloff = Number(event.target.value);
              onRefresh();
            }}
          />
        </label>
        <div className="rig-btn-row">
          <button type="button" className="rig-btn" onClick={() => { session.bindMeshesFromSourceModel(true); onRefresh(); }}>
            Rebind envelope
          </button>
          <button type="button" className="rig-btn" onClick={() => { session.normalizeAllBindingWeights(); onRefresh(); }}>
            Normalize weights
          </button>
        </div>
        <p className="rig-hint">Drag bones in Pose mode to rotate. Paint weights in Weight mode.</p>
      </section>

      <section className="rig-panel">
        <h3 className="rig-panel-title">Clips</h3>
        <label className="rig-field">
          <span>Active</span>
          <select
            className="rig-select"
            value={settings.activeClipId ?? ''}
            onChange={(event) => {
              if (event.target.value) session.switchClip(event.target.value);
              onRefresh();
            }}
          >
            {clips.map((clip) => (
              <option key={clip.id} value={clip.id}>{clip.name}</option>
            ))}
          </select>
        </label>
        {activeClip && (
          <label className="rig-field">
            <span>Name</span>
            <input
              className="rig-input"
              value={activeClip.name}
              onChange={(event) => {
                session.renameActiveClip(event.target.value);
                onRefresh();
              }}
            />
          </label>
        )}
        <div className="rig-btn-row rig-btn-row-inline">
          <button type="button" className="rig-btn" onClick={() => { session.createClip(`Action ${clips.length + 1}`); onRefresh(); }}>+ New</button>
          <button type="button" className="rig-btn" onClick={() => { session.duplicateActiveClip(); onRefresh(); }}>Dup</button>
          <button type="button" className="rig-btn" disabled={clips.length <= 1} onClick={() => { if (activeClip) session.deleteClip(activeClip.id); onRefresh(); }}>Del</button>
        </div>
        <label className="rig-check">
          <input type="checkbox" checked={session.autoKeyframe} onChange={(event) => { session.autoKeyframe = event.target.checked; onRefresh(); }} />
          Auto-keyframe transforms
        </label>
      </section>

      {(session.editMode === 'edit' || session.editMode === 'pose') && (
        <BoneEditorPanel session={session} onRefresh={onRefresh} />
      )}

      {session.editMode === 'weight' && (
        <section className="rig-panel">
          <h3 className="rig-panel-title">Weight brush</h3>
          <label className="rig-field">
            <span>Radius</span>
            <input className="rig-input" type="range" min={0.02} max={0.8} step={0.01} value={session.weightBrushRadius} onChange={(event) => { session.weightBrushRadius = Number(event.target.value); onRefresh(); }} />
          </label>
          <label className="rig-field">
            <span>Strength</span>
            <input className="rig-input" type="range" min={0.05} max={1} step={0.05} value={session.weightBrushStrength} onChange={(event) => { session.weightBrushStrength = Number(event.target.value); onRefresh(); }} />
          </label>
          <label className="rig-check">
            <input type="checkbox" checked={session.weightBrushAdd} onChange={(event) => { session.weightBrushAdd = event.target.checked; onRefresh(); }} />
            Add weight (off subtracts)
          </label>
          <p className="rig-hint">Select a bone in the list, then paint on the mesh.</p>
        </section>
      )}
    </aside>
  );
}
