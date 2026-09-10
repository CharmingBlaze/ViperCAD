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
      {/* 1. Setup & Project Document (Collapsible once setup is complete) */}
      <details className="rig-panel rig-collapsible" open={status.armatureBoneCount === 0}>
        <summary className="rig-panel-summary">
          <span className="rig-panel-title">Project &amp; Armature</span>
          <span className="rig-panel-badge">
            {status.armatureBoneCount > 0 ? `${status.armatureBoneCount} bones` : 'Setup needed'}
          </span>
        </summary>

        <div className="rig-collapsible-content">
          <div className="rig-stat-row">
            <span className="rig-stat">{status.meshObjectCount} meshes</span>
            <span className="rig-stat">{status.armatureBoneCount} bones</span>
            <span className="rig-stat">{status.skinBindingCount} bindings</span>
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
              className={`rig-btn${status.armatureBoneCount === 0 ? ' rig-btn-primary' : ' rig-btn-secondary'}`}
              onClick={() => {
                session.runQuickSetup(true);
                onRefresh();
              }}
            >
              Quick setup (Armature &amp; Weights)
            </button>
          </div>
        </div>
      </details>

      {/* 2. Weight Paint Specific Tools */}
      {session.editMode === 'weight' && (
        <>
          <section className="rig-panel">
            <h3 className="rig-panel-title">Weight brush</h3>
            <label className="rig-field">
              <span>Radius ({session.weightBrushRadius.toFixed(2)})</span>
              <input
                className="rig-input"
                type="range"
                min={0.02}
                max={0.8}
                step={0.01}
                value={session.weightBrushRadius}
                onChange={(event) => { session.weightBrushRadius = Number(event.target.value); onRefresh(); }}
              />
            </label>
            <label className="rig-field">
              <span>Strength ({Math.round(session.weightBrushStrength * 100)}%)</span>
              <input
                className="rig-input"
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={session.weightBrushStrength}
                onChange={(event) => { session.weightBrushStrength = Number(event.target.value); onRefresh(); }}
              />
            </label>
            <label className="rig-check">
              <input
                type="checkbox"
                checked={session.weightBrushAdd}
                onChange={(event) => { session.weightBrushAdd = event.target.checked; onRefresh(); }}
              />
              Add weight mode (uncheck to subtract)
            </label>
          </section>

          <section className="rig-panel">
            <h3 className="rig-panel-title">Skinning Falloff</h3>
            <label className="rig-field">
              <span>Envelope falloff ({session.envelopeFalloff.toFixed(2)})</span>
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
              <button
                type="button"
                className="rig-btn rig-btn-secondary"
                onClick={() => { session.bindMeshesFromSourceModel(true); onRefresh(); }}
              >
                Rebind envelope
              </button>
              <button
                type="button"
                className="rig-btn rig-btn-secondary"
                onClick={() => { session.normalizeAllBindingWeights(); onRefresh(); }}
              >
                Normalize weights
              </button>
            </div>
          </section>
        </>
      )}

      {/* 3. Bone Editor (Hierarchies, Joint Structure, Poses, and Bone Picker for Weights) */}
      <BoneEditorPanel session={session} onRefresh={onRefresh} />

      {/* 4. Animation Clips (Dominant in Pose mode) */}
      {session.editMode === 'pose' && (
        <section className="rig-panel">
          <h3 className="rig-panel-title">Test Animation Clips</h3>
          <label className="rig-field">
            <span>Active clip</span>
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
            <button type="button" className="rig-btn rig-btn-secondary" onClick={() => { session.createClip(`Action ${clips.length + 1}`); onRefresh(); }}>+ New</button>
            <button type="button" className="rig-btn rig-btn-secondary" onClick={() => { session.duplicateActiveClip(); onRefresh(); }}>Dup</button>
            <button type="button" className="rig-btn rig-btn-secondary" disabled={clips.length <= 1} onClick={() => { if (activeClip) session.deleteClip(activeClip.id); onRefresh(); }}>Del</button>
          </div>
          <label className="rig-check" style={{ marginTop: '8px' }}>
            <input type="checkbox" checked={session.autoKeyframe} onChange={(event) => { session.autoKeyframe = event.target.checked; onRefresh(); }} />
            Auto-keyframe changes
          </label>
        </section>
      )}

      {/* 5. Compact Viewport Shading */}
      <section className="rig-panel rig-panel-compact">
        <h3 className="rig-panel-title">Viewport Display</h3>
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
      </section>
    </aside>
  );
}
