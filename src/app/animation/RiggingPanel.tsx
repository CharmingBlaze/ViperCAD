import { useState } from 'react';
import { BoneEditorPanel } from './BoneEditorPanel';
import { BlenderIcon } from '@/components/BlenderIcon';
import { WeightBrushPanel } from './WeightBrushPanel';
import { RigSceneAssetsPanel } from './RigSceneAssetsPanel';
import type { CreaturePresetType } from '@/core/rig/creatureSkeletons';
import { pushToast } from '@/app/Toast';
import type { AnimationSession } from './AnimationSession';

type Props = {
  session: AnimationSession;
  onRefresh: () => void;
  onSwitchToAnimate?: () => void;
  onSwitchToModel?: () => void;
  onToggleCollapse?: () => void;
  style?: React.CSSProperties;
};

export function RiggingPanel({
  session,
  onRefresh,
  onSwitchToAnimate,
  onSwitchToModel,
  onToggleCollapse,
  style,
}: Props) {
  const [activeTab, setActiveTab] = useState<'build' | 'bind' | 'pose'>('build');
  const [directWeight, setDirectWeight] = useState<number>(1.0);
  const status = session.getSetupStatus();
  const selectedBone = session.selectedBoneId
    ? session.project.armatures.get(session.rigDocument.id)?.bones.get(session.selectedBoneId)
    : null;

  const sourceModel = session.sourceModelDocument;
  const sceneObjects = sourceModel ? Array.from(sourceModel.objects.values()) : [];
  const selectedVertexCount = session.selectedMeshVertexIds().length;

  const applyDirectWeights = (operation: 'set' | 'add' | 'subtract' | 'remove') => {
    if (!session.selectedBoneId) return;
    const vertexIds = session.selectedMeshVertexIds();
    if (vertexIds.length === 0) {
      pushToast('Select mesh vertices in Vertex mode first', 'info');
      return;
    }
    session.assignDirectVertexWeights(
      vertexIds,
      session.selectedBoneId,
      operation === 'remove' ? 0 : directWeight,
      operation,
    );
    onRefresh();
  };

  return (
    <aside className="animation-panel rigging-panel" style={style} aria-label="Rigging">
      <header className="animation-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span className="animation-panel-kicker">Rigging Workspace</span>
            <strong>{status.sourceModelName ?? 'Current model'}</strong>
          </div>
          {onToggleCollapse && (
            <button
              type="button"
              className="rig-btn-sm"
              title="Hide Rigging panel"
              onClick={onToggleCollapse}
            >
              <BlenderIcon name="tria_right" size={12} />
            </button>
          )}
        </div>
        <p>
          {status.meshObjectCount} mesh{status.meshObjectCount === 1 ? '' : 'es'}
          {' · '}
          {status.armatureBoneCount} bone{status.armatureBoneCount === 1 ? '' : 's'}
          {' · '}
          {status.skinBindingCount} bound
        </p>
      </header>

      <div className="inspector-subtabs anim-subtabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'build'}
          className={activeTab === 'build' ? 'is-active' : ''}
          onClick={() => {
            setActiveTab('build');
            session.editMode = 'edit';
            onRefresh();
          }}
          title="Build skeleton, edit bones, and parent accessories"
        >
          Build
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'bind'}
          className={activeTab === 'bind' ? 'is-active' : ''}
          onClick={() => {
            setActiveTab('bind');
            session.editMode = 'weight';
            onRefresh();
          }}
          title="Skin mesh, paint weights, and direct vertex assignment"
        >
          Bind
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'pose'}
          className={activeTab === 'pose' ? 'is-active' : ''}
          onClick={() => {
            setActiveTab('pose');
            session.editMode = 'pose';
            onRefresh();
          }}
          title="Test pose controls without creating animation keys"
        >
          Pose
        </button>
      </div>

      <div className={`animation-panel-body${activeTab === 'build' ? ' is-fill' : ''}`}>
        {status.meshObjectCount === 0 && (
          <div className={`rig-empty-hint${status.armatureBoneCount > 0 ? ' is-compact' : ''}`}>
            <p className="rig-hint" style={{ margin: 0 }}>
              {status.armatureBoneCount > 0
                ? 'No mesh is linked yet. Create or select a mesh in Model, then use Bind.'
                : 'Create a mesh in Model first, then apply a skeleton preset below.'}
            </p>
            {onSwitchToModel && status.armatureBoneCount === 0 && (
              <button type="button" className="rig-btn rig-btn-block" onClick={onSwitchToModel} style={{ marginTop: 6 }}>
                Open Model
              </button>
            )}
          </div>
        )}

        {activeTab === 'build' && (
          <div className="rig-build-stack">
            <BoneEditorPanel session={session} onRefresh={onRefresh} />

            <details className="rig-panel rig-build-extras">
              <summary className="rig-panel-title">Creature Skeleton Presets</summary>
              <div className="anim-preset-list">
                {([
                  ['humanoid', 'Humanoid (20 Bones)'],
                  ['bird', 'Bird / Winged (18 Bones)'],
                  ['quadruped', 'Quadruped / Dog (20 Bones)'],
                  ['fish', 'Fish / Aquatic (10 Bones)'],
                ] as const).map(([type, title]) => (
                  <div key={type} className="anim-preset-card">
                    <span style={{ fontSize: '0.74rem', color: 'var(--text)' }}>{title}</span>
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
            </details>

            <details className="rig-panel rig-build-extras">
              <summary className="rig-panel-title">Object Parenting (Weapons / Accessories)</summary>
              <p className="rig-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Parent an accessory mesh (e.g. Sword, Hat) directly to a bone without skin weights.
              </p>
              {sceneObjects.length === 0 ? (
                <p className="rig-hint">No objects in source model.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {sceneObjects.map((obj) => (
                    <label key={obj.id} className="rig-field">
                      <span>{obj.name} Parent Bone:</span>
                      <select
                        className="rig-select"
                        value={obj.parentId ?? ''}
                        onChange={(e) => {
                          session.parentObjectToBone(obj.id, e.target.value || null);
                          onRefresh();
                        }}
                      >
                        <option value="">(None - Root Space)</option>
                        {Array.from(session.project.armatures.get(session.rigDocument.id)?.bones.values() ?? []).map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </details>
          </div>
        )}

        {activeTab === 'bind' && (
          <>
            <section className="rig-panel">
              <h3 className="rig-panel-title">Skin Binding Mode</h3>
              <div className="rig-btn-row rig-btn-row-3">
                <button
                  type="button"
                  className={`rig-btn${session.skinBindingMode === 'smooth' && session.maxBoneInfluences === 4 ? ' rig-btn-primary' : ''}`}
                  onClick={() => {
                    session.skinBindingMode = 'smooth';
                    session.maxBoneInfluences = 4;
                    session.runQuickSetup();
                    onRefresh();
                  }}
                  title="Smooth skin with 4 max bone influences (Standard game models)"
                >
                  Smooth (4)
                </button>
                <button
                  type="button"
                  className={`rig-btn${session.skinBindingMode === 'smooth' && session.maxBoneInfluences === 8 ? ' rig-btn-primary' : ''}`}
                  onClick={() => {
                    session.skinBindingMode = 'smooth';
                    session.maxBoneInfluences = 8;
                    session.runQuickSetup();
                    onRefresh();
                  }}
                  title="Smooth skin with 8 max bone influences (High quality meshes)"
                >
                  Smooth (8)
                </button>
                <button
                  type="button"
                  className={`rig-btn${session.skinBindingMode === 'rigid' ? ' rig-btn-primary' : ''}`}
                  onClick={() => {
                    session.skinBindingMode = 'rigid';
                    session.applyRigidSkinningToRig();
                    onRefresh();
                  }}
                  title="Rigid binding: exactly 1 bone per vertex (Robotics, weapons, low-poly)"
                >
                  Rigid (1)
                </button>
              </div>

              <label className="rig-field" style={{ marginTop: 8 }}>
                <span>Envelope Falloff ({session.envelopeFalloff.toFixed(2)})</span>
                <input
                  className="rig-input"
                  type="range"
                  min={0.25}
                  max={1.5}
                  step={0.05}
                  value={session.envelopeFalloff}
                  onChange={(e) => {
                    session.envelopeFalloff = Number(e.target.value);
                    onRefresh();
                  }}
                />
              </label>

              <div className="rig-btn-row rig-btn-row-2" style={{ marginTop: 6 }}>
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

            {/* Direct Vertex Geometry Assignment Panel */}
            <section className="rig-panel">
              <h3 className="rig-panel-title">Direct Vertex Weight Assignment</h3>
              <p className="rig-hint" style={{ marginTop: 0, marginBottom: 6 }}>
                Switch to Vertex mode, select vertices, then assign weights on <strong>{selectedBone?.name ?? 'selected bone'}</strong>.
              </p>
              <label className="rig-field">
                <span>Influence ({directWeight.toFixed(2)})</span>
                <input
                  className="rig-input"
                  type="range"
                  min={0.0}
                  max={1.0}
                  step={0.05}
                  value={directWeight}
                  onChange={(e) => setDirectWeight(Number(e.target.value))}
                />
              </label>
              <div className="rig-btn-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 6 }}>
                <button
                  type="button"
                  className="rig-btn rig-btn-primary"
                  disabled={!session.selectedBoneId || selectedVertexCount === 0}
                  title="Assign weight to selected vertices"
                  onClick={() => applyDirectWeights('set')}
                >
                  Set
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  disabled={!session.selectedBoneId || selectedVertexCount === 0}
                  title="Add weight to selected vertices"
                  onClick={() => applyDirectWeights('add')}
                >
                  Add
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  disabled={!session.selectedBoneId || selectedVertexCount === 0}
                  title="Subtract weight from selected vertices"
                  onClick={() => applyDirectWeights('subtract')}
                >
                  Sub
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  disabled={!session.selectedBoneId || selectedVertexCount === 0}
                  title="Remove bone influence completely"
                  onClick={() => applyDirectWeights('remove')}
                >
                  Clear
                </button>
              </div>
            </section>

            <WeightBrushPanel session={session} onRefresh={onRefresh} />
          </>
        )}

        {activeTab === 'pose' && (
          <>
            <section className="rig-panel">
              <h3 className="rig-panel-title">Test Pose Mode</h3>
              <p className="rig-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                Manipulate controls to test range of motion without generating animation keys.
              </p>
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
              <div className="rig-btn-row rig-btn-row-2" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="rig-btn"
                  onClick={() => { session.resetSelectedBonePose(); onRefresh(); }}
                >
                  Reset Bone
                </button>
                <button
                  type="button"
                  className="rig-btn"
                  onClick={() => { session.resetRestPose(); onRefresh(); }}
                >
                  Reset All
                </button>
              </div>
            </section>

            <RigSceneAssetsPanel session={session} onRefresh={onRefresh} showSceneObjects={true} />
          </>
        )}

        {onSwitchToAnimate && (
          <button
            type="button"
            className="rig-btn rig-btn-primary rig-btn-block"
            onClick={onSwitchToAnimate}
            style={{ marginTop: 12 }}
            title="Switch to Animation Workspace"
          >
            <BlenderIcon name="action" size={13} />
            <span>Open Animate Workspace</span>
          </button>
        )}
      </div>
    </aside>
  );
}
