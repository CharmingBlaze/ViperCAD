import { useState } from 'react';
import { getActiveClip, readRigDocumentSettings } from '@/core/rig/RigDocument';
import { BlenderIcon } from '@/components/BlenderIcon';
import { EXPORT_PROFILES, type ExportProfile } from '@/app/GameExportProfiles';
import { exportRigGlb, validateGlbRoundTrip } from '@/app/GameExport';
import {
  chooseNativeSaveTarget,
  openNativeFile,
  GLB_FILE,
  GLBA_FILE,
  GLBKF_FILE,
  writeNativeFile,
} from '@/app/platform/FileDialogs';
import type { PosePresetName } from '@/core/rig/PosePresets';
import type { CreaturePresetType } from '@/core/rig/creatureSkeletons';
import { RigSceneAssetsPanel } from './RigSceneAssetsPanel';
import { AnimationEventForm } from './AnimationEventForm';
import type { AnimationSession } from './AnimationSession';

type Props = {
  session: AnimationSession;
  onRefresh: () => void;
  onSwitchToRig?: () => void;
};

export function AnimationPanel({ session, onRefresh, onSwitchToRig }: Props) {
  const [activeTab, setActiveTab] = useState<'motion' | 'creatures' | 'sequencer' | 'pose' | 'ik' | 'export'>('motion');
  const settings = readRigDocumentSettings(session.rigDocument);
  const status = session.getSetupStatus();
  const clips = session.getClips();
  const activeClip = getActiveClip(session.project, session.rigDocument);
  const events = session.getEvents();

  const [selectedProfileId, setSelectedProfileId] = useState<string>('godot');
  const [exporting, setExporting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [scaleKeysOnPanelResize, setScaleKeysOnPanelResize] = useState(false);

  const handleExportGlb = async () => {
    setExporting(true);
    setStatusMessage(null);
    try {
      const profile: ExportProfile =
        EXPORT_PROFILES[selectedProfileId as keyof typeof EXPORT_PROFILES] ?? EXPORT_PROFILES.godot;
      const target = await chooseNativeSaveTarget({
        suggestedName: `${activeClip?.name || 'character'}-${profile.id}.glb`,
        types: [GLB_FILE],
      });
      if (!target) {
        setExporting(false);
        return;
      }
      const buffer = await exportRigGlb(session, profile);
      const validation = await validateGlbRoundTrip(buffer);
      await writeNativeFile(target, buffer, 'model/gltf-binary');
      setStatusMessage(
        `Exported ${target.name} (${validation.triangles} tris, ${clips.length} clip${clips.length === 1 ? '' : 's'})`,
      );
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleExportGlba = async () => {
    try {
      const json = session.exportGlbaScene();
      const target = await chooseNativeSaveTarget({
        suggestedName: `${status.sourceModelName || 'project'}.glba`,
        types: [GLBA_FILE],
      });
      if (!target) return;
      const encoder = new TextEncoder();
      await writeNativeFile(target, encoder.encode(json).buffer, 'application/json');
      setStatusMessage(`Saved scene to ${target.name}`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Save .glba failed');
    }
  };

  const handleImportGlba = async () => {
    try {
      const opened = await openNativeFile({ types: [GLBA_FILE] });
      if (!opened) return;
      const text = await opened.file.text();
      const ok = session.importGlbaScene(text);
      if (ok) {
        setStatusMessage(`Loaded scene from ${opened.file.name}`);
        onRefresh();
      } else {
        setStatusMessage('Invalid .glba file');
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Open .glba failed');
    }
  };

  const handleExportGlbkf = async () => {
    try {
      const json = session.exportActiveClipGlbkf();
      if (!json) {
        setStatusMessage('No active clip to export');
        return;
      }
      const target = await chooseNativeSaveTarget({
        suggestedName: `${activeClip?.name || 'motion'}.glbkf`,
        types: [GLBKF_FILE],
      });
      if (!target) return;
      const encoder = new TextEncoder();
      await writeNativeFile(target, encoder.encode(json).buffer, 'application/json');
      setStatusMessage(`Exported keyframes to ${target.name}`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Export .glbkf failed');
    }
  };

  const handleImportGlbkf = async () => {
    try {
      const opened = await openNativeFile({ types: [GLBKF_FILE] });
      if (!opened) return;
      const text = await opened.file.text();
      const ok = session.importGlbkf(text);
      if (ok) {
        setStatusMessage(`Imported keyframes into ${activeClip?.name}`);
        onRefresh();
      } else {
        setStatusMessage('Invalid .glbkf file');
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Import .glbkf failed');
    }
  };

  return (
    <aside className="animation-panel" aria-label="Animation">
      <header className="animation-panel-header">
        <span className="animation-panel-kicker">GLB Animator</span>
        <strong>{status.sourceModelName ?? 'Current model'}</strong>
        <p>
          {clips.length} clip{clips.length === 1 ? '' : 's'}
          {' · '}
          {status.armatureBoneCount} bone{status.armatureBoneCount === 1 ? '' : 's'}
          {' · '}
          {events.length} event{events.length === 1 ? '' : 's'}
        </p>
      </header>

      {/* Subtabs */}
      <div className="inspector-subtabs anim-subtabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'motion'}
          className={activeTab === 'motion' ? 'is-active' : ''}
          onClick={() => setActiveTab('motion')}
          title="Motion clips & procedural animation generators"
        >
          Motion
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'creatures'}
          className={activeTab === 'creatures' ? 'is-active' : ''}
          onClick={() => setActiveTab('creatures')}
          title="Creature & character skeleton presets"
        >
          Creatures
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'sequencer'}
          className={activeTab === 'sequencer' ? 'is-active' : ''}
          onClick={() => setActiveTab('sequencer')}
          title="Non-linear clip sequencer & cross-fade blending"
        >
          Sequencer
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pose'}
          className={activeTab === 'pose' ? 'is-active' : ''}
          onClick={() => setActiveTab('pose')}
          title="Pose editing & presets"
        >
          Pose
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'ik'}
          className={activeTab === 'ik' ? 'is-active' : ''}
          onClick={() => setActiveTab('ik')}
          title="IK solvers & rigging"
        >
          IK / Rig
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'export'}
          className={activeTab === 'export' ? 'is-active' : ''}
          onClick={() => setActiveTab('export')}
          title="Game engine GLB export & project files"
        >
          Export
        </button>
      </div>

      <div className="animation-panel-body">
        {activeTab === 'motion' && (
          <>
            <section className="rig-panel">
              <h3 className="rig-panel-title">Clip</h3>
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
              <div className="rig-btn-row rig-btn-row-3">
                <button
                  type="button"
                  className="rig-btn"
                  onClick={() => { session.createClip(`Action_${clips.length + 1}`); onRefresh(); }}
                >
                  New
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  onClick={() => { session.duplicateActiveClip(); onRefresh(); }}
                >
                  Dup
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  disabled={clips.length <= 1}
                  onClick={() => { if (activeClip) session.deleteClip(activeClip.id); onRefresh(); }}
                >
                  Del
                </button>
              </div>
              {activeClip && (
                <>
                  <div className="clip-timing-row" style={{ marginTop: 8 }}>
                    <label className="rig-field">
                      <span>Total Frames</span>
                      <input
                        className="rig-input"
                        type="number"
                        min={1}
                        max={9999}
                        value={Math.round(activeClip.duration * (activeClip.fps || 30))}
                        onChange={(event) => {
                          const frames = Math.max(1, parseInt(event.target.value, 10) || 1);
                          session.setClipTotalFrames(frames, scaleKeysOnPanelResize);
                          onRefresh();
                        }}
                      />
                    </label>
                    <label className="rig-field">
                      <span>Duration (s)</span>
                      <input
                        className="rig-input"
                        type="number"
                        min={0.05}
                        step={0.1}
                        value={Number(activeClip.duration.toFixed(2))}
                        onChange={(event) => {
                          const d = Math.max(0.05, parseFloat(event.target.value) || 0.1);
                          session.setClipDuration(d, scaleKeysOnPanelResize);
                          onRefresh();
                        }}
                      />
                    </label>
                    <label className="rig-field">
                      <span>FPS</span>
                      <select
                        className="rig-select"
                        value={activeClip.fps || 30}
                        onChange={(event) => {
                          session.setClipFps(Number(event.target.value));
                          onRefresh();
                        }}
                      >
                        <option value={12}>12</option>
                        <option value={24}>24</option>
                        <option value={30}>30</option>
                        <option value={60}>60</option>
                      </select>
                    </label>
                  </div>

                  <label className="rig-check" style={{ marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={scaleKeysOnPanelResize}
                      onChange={(event) => setScaleKeysOnPanelResize(event.target.checked)}
                    />
                    <span>Stretch keyframes proportionally with length</span>
                  </label>

                  {/* Quick Length Presets */}
                  <div className="anim-length-presets" style={{ marginTop: 8 }}>
                    <span className="rig-hint" style={{ margin: '0 0 4px', fontSize: '0.62rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Quick Length Presets
                    </span>
                    <div className="anim-preset-btn-row">
                      {[
                        { sec: 1, label: '1s' },
                        { sec: 2, label: '2s' },
                        { sec: 3, label: '3s' },
                        { sec: 4, label: '4s' },
                        { sec: 5, label: '5s' },
                      ].map(({ sec, label }) => (
                        <button
                          key={sec}
                          type="button"
                          className="rig-btn-sm"
                          title={`Set animation length to ${sec}s (${sec * (activeClip.fps || 30)} frames)`}
                          onClick={() => {
                            session.setClipDuration(sec, scaleKeysOnPanelResize);
                            onRefresh();
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quick Speed Multipliers */}
                  <div className="anim-speed-row" style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    <button
                      type="button"
                      className="rig-btn"
                      title="Make animation 2x faster (0.5x duration)"
                      onClick={() => {
                        session.scaleEntireClip(0.5);
                        onRefresh();
                      }}
                    >
                      <BlenderIcon name="ff" size={11} />
                      <span>2x Faster (0.5x)</span>
                    </button>
                    <button
                      type="button"
                      className="rig-btn"
                      title="Make animation 2x slower (2.0x duration)"
                      onClick={() => {
                        session.scaleEntireClip(2.0);
                        onRefresh();
                      }}
                    >
                      <BlenderIcon name="rew" size={11} />
                      <span>2x Slower (2.0x)</span>
                    </button>
                  </div>
                </>
              )}
              <label className="rig-check" style={{ marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={session.getRootMotion()}
                  onChange={(event) => {
                    session.setRootMotion(event.target.checked);
                    onRefresh();
                  }}
                />
                <span>Root motion</span>
              </label>
            </section>

            <section className="rig-panel">
              <h3 className="rig-panel-title">Procedural Motion Bakers</h3>
              <p className="rig-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                One-click procedural generators baked directly into real keyframes.
              </p>
              <div className="anim-gen-grid">
                <button
                  type="button"
                  className="rig-btn"
                  title="Bake Bird Flight & Wing Flapping"
                  onClick={() => { session.bakeBirdFlightForRig(); onRefresh(); }}
                >
                  Bird Fly
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  title="Bake Bird Drinking / Pecking"
                  onClick={() => { session.bakeBirdDrinkForRig(); onRefresh(); }}
                >
                  Bird Drink
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  title="Bake 4-Leg Quadruped Walk"
                  onClick={() => { session.bakeQuadrupedLocomotionForRig(false); onRefresh(); }}
                >
                  Dog Walk
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  title="Bake 4-Leg Quadruped Run / Trot"
                  onClick={() => { session.bakeQuadrupedLocomotionForRig(true); onRefresh(); }}
                >
                  Dog Run
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  title="Bake Fish Swimming Undulation"
                  onClick={() => { session.bakeFishSwimForRig(); onRefresh(); }}
                >
                  Fish Swim
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  title="Bake Combat Slash Attack"
                  onClick={() => { session.bakeCombatAttackForRig(); onRefresh(); }}
                >
                  Attack Slash
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  title="Bake Human Walk Cycle"
                  onClick={() => { session.generateWalkCycleForRig(); onRefresh(); }}
                >
                  Human Walk
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  title="Bake Human Idle Breathing"
                  onClick={() => { session.generateIdleCycleForRig(); onRefresh(); }}
                >
                  Idle Breathe
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  title="Bake Volume-Preserving Squash & Stretch"
                  onClick={() => { session.bakeSquashAndStretchForRig(); onRefresh(); }}
                >
                  Squash & Stretch
                </button>
              </div>
            </section>
          </>
        )}

        {activeTab === 'creatures' && (
          <>
            <section className="rig-panel">
              <h3 className="rig-panel-title">Creature Skeleton Presets</h3>
              <p className="rig-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                Auto-fit built-in skeletons to your 3D model bounding box with automatic skin weights.
              </p>
              <div className="anim-preset-list">
                {([
                  ['humanoid', 'Humanoid (Biped)', '20 Bones — Pelvis, Spine, Chest, Arms, Legs'],
                  ['bird', 'Bird / Winged', '18 Bones — Wings, Neck, Beak, Tail, Legs'],
                  ['quadruped', 'Quadruped / Dog', '20 Bones — Spine, 4 Legs, Neck, Head, Tail'],
                  ['fish', 'Fish / Aquatic', '10 Bones — Spine 1-4, Tail Fin, Pectoral Fins'],
                ] as const).map(([type, title, desc]) => (
                  <div key={type} className="anim-preset-card">
                    <div className="anim-preset-info">
                      <strong>{title}</strong>
                      <span>{desc}</span>
                    </div>
                    <button
                      type="button"
                      className="rig-btn rig-btn-primary"
                      onClick={() => {
                        session.applyCreatureSkeleton(type as CreaturePresetType, true);
                        onRefresh();
                      }}
                    >
                      Apply & Fit
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="rig-panel">
              <h3 className="rig-panel-title">Skinning & Weights</h3>
              <label className="rig-field">
                <span>Envelope Falloff</span>
                <input
                  className="rig-input"
                  type="number"
                  min={0.1}
                  max={2.0}
                  step={0.05}
                  value={session.envelopeFalloff}
                  onChange={(e) => {
                    session.envelopeFalloff = Number(e.target.value);
                    onRefresh();
                  }}
                />
              </label>
              <div className="rig-btn-row rig-btn-row-2" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="rig-btn"
                  onClick={() => { session.mirrorSkinWeightsXForRig(); onRefresh(); }}
                >
                  Mirror Weights X
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  onClick={() => { session.smoothSkinWeightsForRig(); onRefresh(); }}
                >
                  Smooth Weights
                </button>
              </div>
            </section>
          </>
        )}

        {activeTab === 'sequencer' && (
          <>
            <section className="rig-panel">
              <div className="rig-panel-head">
                <h3 className="rig-panel-title">Clip Sequence Track ({session.clipSequence.length})</h3>
                <button
                  type="button"
                  className="rig-btn-sm"
                  disabled={!activeClip}
                  title="Add active clip to timeline sequence"
                  onClick={() => {
                    if (activeClip) session.addClipToSequence(activeClip.id);
                    onRefresh();
                  }}
                >
                  + Add Clip
                </button>
              </div>
              <p className="rig-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                Sequence multiple clips with smooth cross-fade blend transitions.
              </p>

              {session.clipSequence.length === 0 ? (
                <p className="rig-hint">No clips in sequence. Click &quot;+ Add Clip&quot; to arrange your animation timeline.</p>
              ) : (
                <div className="anim-seq-list">
                  {session.clipSequence.map((item, idx) => (
                    <div
                      key={item.id}
                      className={`anim-seq-card${session.selectedSequenceItemId === item.id ? ' is-active' : ''}`}
                      onClick={() => {
                        session.selectedSequenceItemId = item.id;
                        onRefresh();
                      }}
                    >
                      <div className="anim-seq-header">
                        <span className="anim-seq-num">#{idx + 1}</span>
                        <strong className="anim-seq-name">{item.name}</strong>
                        <button
                          type="button"
                          className="rig-event-del"
                          title="Remove from sequence"
                          onClick={(e) => {
                            e.stopPropagation();
                            session.removeSequenceItem(item.id);
                            onRefresh();
                          }}
                        >
                          ×
                        </button>
                      </div>
                      <div className="anim-seq-grid">
                        <label className="rig-field">
                          <span>Start (s)</span>
                          <input
                            className="rig-input"
                            type="number"
                            step={0.1}
                            min={0}
                            value={Number(item.startTime.toFixed(2))}
                            onChange={(e) => {
                              session.updateSequenceItem(item.id, { startTime: Math.max(0, Number(e.target.value)) });
                              onRefresh();
                            }}
                          />
                        </label>
                        <label className="rig-field">
                          <span>Speed</span>
                          <input
                            className="rig-input"
                            type="number"
                            step={0.1}
                            min={0.1}
                            max={5.0}
                            value={item.speedMultiplier}
                            onChange={(e) => {
                              session.updateSequenceItem(item.id, { speedMultiplier: Math.max(0.1, Number(e.target.value)) });
                              onRefresh();
                            }}
                          />
                        </label>
                      </div>
                      <div className="anim-seq-grid" style={{ marginTop: 4 }}>
                        <label className="rig-field">
                          <span>Blend In (s)</span>
                          <input
                            className="rig-input"
                            type="number"
                            step={0.05}
                            min={0}
                            value={Number(item.blendIn.toFixed(2))}
                            onChange={(e) => {
                              session.updateSequenceItem(item.id, { blendIn: Math.max(0, Number(e.target.value)) });
                              onRefresh();
                            }}
                          />
                        </label>
                        <label className="rig-field">
                          <span>Blend Out (s)</span>
                          <input
                            className="rig-input"
                            type="number"
                            step={0.05}
                            min={0}
                            value={Number(item.blendOut.toFixed(2))}
                            onChange={(e) => {
                              session.updateSequenceItem(item.id, { blendOut: Math.max(0, Number(e.target.value)) });
                              onRefresh();
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="rig-btn-row rig-btn-row-2" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="rig-btn rig-btn-primary"
                  disabled={session.clipSequence.length === 0}
                  onClick={() => {
                    const baked = session.bakeSequenceToNewClip(`Sequence_Bake_${clips.length + 1}`);
                    if (baked) {
                      setStatusMessage(`Baked sequence into new clip: ${baked.name}`);
                      onRefresh();
                    }
                  }}
                >
                  Bake to Clip
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  disabled={session.clipSequence.length === 0}
                  onClick={() => { session.clearSequence(); onRefresh(); }}
                >
                  Clear Track
                </button>
              </div>
            </section>
          </>
        )}

        {activeTab === 'pose' && (
          <>
            <section className="rig-panel">
              <h3 className="rig-panel-title">Transform Tool</h3>
              <div className="rig-btn-row rig-btn-row-3">
                {([
                  ['rotate', 'Rotate', 'R'],
                  ['move', 'Move', 'G'],
                  ['universal', 'Universal', 'U'],
                ] as const).map(([mode, label, key]) => (
                  <button
                    key={mode}
                    type="button"
                    title={`${label} (${key})`}
                    className={`rig-btn${session.gizmoMode === mode ? ' rig-btn-primary' : ''}`}
                    onClick={() => { session.setGizmoMode(mode); onRefresh(); }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="rig-hint">
                {session.gizmoMode === 'move'
                  ? 'Drag a limb to translate or solve IK.'
                  : session.gizmoMode === 'universal'
                    ? 'Drag to rotate and translate simultaneously.'
                    : 'Drag a selected bone to rotate in 3D.'}
              </p>
              <div className="rig-btn-row rig-btn-row-3">
                <button type="button" className="rig-btn" onClick={() => { session.copyPose(); onRefresh(); }}>
                  Copy Pose
                </button>
                <button type="button" className="rig-btn" onClick={() => { session.pastePose(); onRefresh(); }}>
                  Paste Pose
                </button>
                <button type="button" className="rig-btn" onClick={() => { session.mirrorCurrentPose(); onRefresh(); }}>
                  Mirror X
                </button>
              </div>
              <div className="rig-btn-row rig-btn-row-2" style={{ marginTop: 4 }}>
                <button type="button" className="rig-btn" onClick={() => { session.resetSelectedBonePose(); onRefresh(); }}>
                  Reset Bone
                </button>
                <button type="button" className="rig-btn" onClick={() => { session.resetRestPose(); onRefresh(); }}>
                  Reset All
                </button>
              </div>
            </section>

            <section className="rig-panel">
              <h3 className="rig-panel-title">Pose Library</h3>
              <label className="rig-field">
                <span>Pose Preset</span>
                <select
                  className="rig-select"
                  defaultValue=""
                  onChange={(event) => {
                    const name = event.target.value as PosePresetName;
                    if (!name) return;
                    session.applyPosePresetToRig(name);
                    event.currentTarget.value = '';
                    onRefresh();
                  }}
                >
                  <option value="">Apply Preset…</option>
                  <option value="T-Pose">T-Pose</option>
                  <option value="A-Pose">A-Pose</option>
                  <option value="Combat Stance">Combat Stance</option>
                  <option value="Sitting">Sitting</option>
                  <option value="Crouching">Crouching</option>
                </select>
              </label>
            </section>

            <RigSceneAssetsPanel session={session} onRefresh={onRefresh} showClearKeys showOnion />
          </>
        )}

        {activeTab === 'ik' && (
          <>
            <section className="rig-panel">
              <h3 className="rig-panel-title">Two-bone IK</h3>
              <p className="rig-hint" style={{ marginTop: 0 }}>
                In Pose mode, select a hand or foot bone and drag with G to bend the limb. Build and bind the skeleton in Rig.
              </p>
              <button
                type="button"
                className="rig-btn rig-btn-primary"
                onClick={() => {
                  session.setEditMode('pose');
                  onRefresh();
                }}
              >
                Pose mode
              </button>
            </section>
            {onSwitchToRig && (
              <button type="button" className="rig-btn rig-btn-block" onClick={onSwitchToRig} style={{ marginTop: 8 }}>
                <BlenderIcon name="armature_data" size={13} />
                <span>Open Rig Workspace</span>
              </button>
            )}
          </>
        )}

        {activeTab === 'export' && (
          <>
            <section className="rig-panel">
              <h3 className="rig-panel-title">Game Engine Export</h3>
              <label className="rig-field">
                <span>Target Engine</span>
                <select
                  className="rig-select"
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                >
                  <option value="godot">Godot 4</option>
                  <option value="unity">Unity</option>
                  <option value="unreal">Unreal Engine</option>
                  <option value="threejs">Three.js / WebGL</option>
                </select>
              </label>
              <button
                type="button"
                className="rig-btn rig-btn-primary rig-btn-block"
                disabled={exporting || !status.isReady}
                title={status.isReady ? 'Export skinned GLB with all clips' : 'Bind a mesh in Rig first'}
                onClick={handleExportGlb}
              >
                {exporting ? 'Exporting…' : 'Export Skeletal GLB'}
              </button>
              {!status.isReady && (
                <p className="rig-hint">Apply a skeleton or bind a mesh before export.</p>
              )}
            </section>

            <section className="rig-panel">
              <h3 className="rig-panel-title">GLB Animator Project</h3>
              <div className="rig-btn-row rig-btn-row-2">
                <button type="button" className="rig-btn" title="Save full animator scene document (.glba)" onClick={handleExportGlba}>
                  Save .glba
                </button>
                <button type="button" className="rig-btn" title="Open animator scene document (.glba)" onClick={handleImportGlba}>
                  Load .glba
                </button>
              </div>
              <div className="rig-btn-row rig-btn-row-2" style={{ marginTop: 4 }}>
                <button type="button" className="rig-btn" title="Export active clip keyframes (.glbkf)" onClick={handleExportGlbkf}>
                  Export .glbkf
                </button>
                <button type="button" className="rig-btn" title="Import keyframes into active clip (.glbkf)" onClick={handleImportGlbkf}>
                  Import .glbkf
                </button>
              </div>
            </section>

            <section className="rig-panel">
              <div className="rig-panel-head">
                <h3 className="rig-panel-title">Events ({events.length})</h3>
              </div>
              <p className="rig-hint" style={{ marginTop: 0 }}>
                Markers for footsteps, hits, and audio at the playhead.
              </p>
              <AnimationEventForm
                submitLabel="Add at playhead"
                onSubmit={(name, parameter) => {
                  session.addEvent(name, session.playbackTime, parameter);
                  onRefresh();
                }}
              />
              {events.length > 0 && (
                <ul className="rig-event-list">
                  {events.map((ev) => (
                    <li key={ev.id} className="rig-event-item">
                      <span className="rig-event-time">{ev.time.toFixed(2)}s</span>
                      <span className="rig-event-name">{ev.name}</span>
                      {ev.parameter && <span className="rig-event-param">{ev.parameter}</span>}
                      <button
                        type="button"
                        className="rig-event-del"
                        title="Delete event"
                        onClick={() => { session.removeEvent(ev.id); onRefresh(); }}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {statusMessage && (
          <div className="rig-panel" style={{ marginTop: 8 }}>
            <p className="rig-hint" style={{ color: '#fff' }}>{statusMessage}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
