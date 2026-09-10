import { useState } from 'react';
import { buildBoneTree } from '@/core/rig/boneTree';
import { readRigDocumentSettings } from '@/core/rig/RigDocument';
import { BlenderIcon } from '@/components/BlenderIcon';
import { getMirroredBoneName } from '@/core/rig/poseMirror';
import type { BoneId } from '@/core/rig/types';
import type { AnimationSession } from './AnimationSession';

type Props = {
  session: AnimationSession;
  onRefresh: () => void;
  compact?: boolean;
};

export function BoneEditorPanel({ session, onRefresh, compact = false }: Props) {
  const [filter, setFilter] = useState('');
  const settings = readRigDocumentSettings(session.rigDocument);
  const armature = settings.armatureId ? session.project.armatures.get(settings.armatureId) : null;
  const boneTreeAll = armature ? buildBoneTree(armature) : [];
  const boneTree = filter.trim()
    ? boneTreeAll.filter(({ bone }) => bone.name.toLowerCase().includes(filter.toLowerCase()))
    : boneTreeAll;
  const sourceModel = session.sourceModelDocument;
  const sceneObjects = sourceModel ? Array.from(sourceModel.objects.values()) : [];
  const selectedBone = session.selectedBoneId && armature
    ? armature.bones.get(session.selectedBoneId)
    : null;
  const boneTransform = session.getSelectedBoneLocalTransform();
  const boneTail = session.getSelectedBoneTail();

  if (!armature) {
    return (
      <section className="rig-panel">
        <h3 className="rig-panel-title">Bone Editor</h3>
        <p className="rig-hint">Add or extrude a bone to start a skeleton.</p>
      </section>
    );
  }

  const updateField = (
    field: 'x' | 'y' | 'z',
    axis: 'position' | 'rotation' | 'scale',
    value: number,
  ) => {
    if (!boneTransform) return;
    boneTransform[axis][field] = value;
    session.setSelectedBoneLocalTransform(boneTransform);
    onRefresh();
  };

  const updateTail = (field: 'x' | 'y' | 'z', value: number) => {
    if (!boneTail) return;
    boneTail[field] = value;
    session.setSelectedBoneTail(boneTail);
    onRefresh();
  };

  return (
    <section className={`rig-panel rig-bone-editor${compact ? ' is-compact' : ''}`}>
      <div className="rig-bone-editor-toolbar">
        <div className="rig-panel-head">
          <h3 className="rig-panel-title">Bone Editor</h3>
          <span className="rig-anim-readout">{armature.bones.size} bones</span>
        </div>
        <div className="rig-inline-actions" role="toolbar" aria-label="Bone tools">
          {session.editMode === 'edit' && (
            <>
            <button
              type="button"
              className="rig-btn-sm"
              title="Add child bone"
              onClick={() => { session.addBoneToSelection(); onRefresh(); }}
            >
              <BlenderIcon name="add" size={11} />
            </button>
            <button
              type="button"
              className="rig-btn-sm"
              title="Extrude from tail"
              onClick={() => { session.extrudeSelectedBone(); onRefresh(); }}
            >
              <span>Extrude</span>
            </button>
            <button
              type="button"
              className="rig-btn-sm"
              title="Subdivide bone"
              onClick={() => { session.subdivideSelectedBone(1); onRefresh(); }}
            >
              <span>Subdiv</span>
            </button>
            <button
              type="button"
              className="rig-btn-sm"
              title="Delete bone"
              onClick={() => { session.deleteSelectedBone(); onRefresh(); }}
            >
              <BlenderIcon name="cancel" size={11} />
            </button>
            </>
          )}
          <button
            type="button"
            className="rig-btn-sm"
            title="Select mirrored bone (M)"
            disabled={!session.getSelectedBoneName() || !getMirroredBoneName(session.getSelectedBoneName() ?? '')}
            onClick={() => { session.selectMirroredBone(); onRefresh(); }}
          >
            <span>L/R</span>
          </button>
        </div>
      </div>

      <input
        type="text"
        className="dope-bone-filter"
        placeholder="Filter bones..."
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <div className="rig-bone-list" role="listbox" aria-label="Bones">
        {boneTree.length === 0 ? (
          <p className="rig-hint dope-empty">No bones match this filter.</p>
        ) : boneTree.map(({ bone, depth }) => {
          const childObjects = sceneObjects.filter((obj) => obj.parentId === bone.id);
          return (
            <div key={bone.id} className="rig-bone-row">
              <button
                type="button"
                role="option"
                aria-selected={session.selectedBoneId === bone.id}
                className={`rig-bone${session.selectedBoneId === bone.id ? ' is-active' : ''}`}
                style={{ paddingLeft: `${10 + depth * 14}px` }}
                onClick={() => { session.selectBone(bone.id); onRefresh(); }}
              >
                <span className="rig-bone-dot" aria-hidden />
                <span className="rig-bone-name">{bone.name}</span>
              </button>
              {childObjects.map((obj) => (
                <div
                  key={obj.id}
                  className="rig-bone is-parented"
                  style={{ paddingLeft: `${24 + depth * 14}px` }}
                  title={`Object "${obj.name}" parented to bone "${bone.name}"`}
                >
                  <BlenderIcon name="mesh_cube" size={11} />
                  <span className="rig-bone-name">{obj.name}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {selectedBone && (
        <div className="rig-bone-props">
          <p className="rig-bone-props-label">Selected bone</p>
          <label className="rig-field">
            <span>Name</span>
            <input
              className="rig-input"
              value={selectedBone.name}
              disabled={session.editMode !== 'edit'}
              onChange={(event) => {
                session.renameSelectedBone(event.target.value);
                onRefresh();
              }}
            />
          </label>

          {session.editMode === 'edit' && (
            <label className="rig-field">
              <span>Parent</span>
              <select
                className="rig-select"
                value={selectedBone.parentId ?? ''}
                onChange={(event) => {
                  const parentId = event.target.value ? (event.target.value as BoneId) : null;
                  session.reparentSelectedBone(parentId);
                  onRefresh();
                }}
              >
                <option value="">None (root)</option>
                {boneTreeAll
                  .filter(({ bone }) => bone.id !== selectedBone.id)
                  .map(({ bone, depth }) => (
                    <option key={bone.id} value={bone.id}>
                      {'-'.repeat(depth)} {bone.name}
                    </option>
                  ))}
              </select>
            </label>
          )}

          {session.editMode === 'edit' && (
            <details className="rig-bone-advanced">
              <summary>Shape & rest</summary>
              {boneTail && (
                <div>
                  <p className="rig-hint" style={{ marginBottom: 6 }}>Tail (local)</p>
                  <div className="rig-transform-grid">
                    {(['x', 'y', 'z'] as const).map((axis) => (
                      <label key={`tail-${axis}`} className="rig-field">
                        <span>{axis.toUpperCase()}</span>
                        <input
                          className="rig-input"
                          type="number"
                          step={0.01}
                          value={Number(boneTail[axis].toFixed(4))}
                          onChange={(event) => updateTail(axis, Number(event.target.value))}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <label className="rig-field">
                <span>Roll (deg)</span>
                <input
                  className="rig-input"
                  type="number"
                  step={5}
                  value={Number(((selectedBone.roll * 180) / Math.PI).toFixed(2))}
                  onChange={(event) => {
                    session.setSelectedBoneRoll((Number(event.target.value) * Math.PI) / 180);
                    onRefresh();
                  }}
                />
              </label>

              {boneTransform && !compact && (
                <details className="rig-details">
                  <summary>Rest transform</summary>
                  {(['position', 'rotation', 'scale'] as const).map((channel) => (
                    <div key={channel} style={{ marginBottom: 6 }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'capitalize' }}>
                        {channel} {channel === 'rotation' ? '(rad)' : ''}
                      </span>
                      <div className="rig-transform-grid">
                        {(['x', 'y', 'z'] as const).map((axis) => (
                          <label key={`${channel}-${axis}`} className="rig-field">
                            <span>{axis.toUpperCase()}</span>
                            <input
                              className="rig-input"
                              type="number"
                              step={channel === 'rotation' ? 0.05 : 0.01}
                              value={Number(boneTransform[channel][axis].toFixed(4))}
                              onChange={(event) => updateField(axis, channel, Number(event.target.value))}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </details>
              )}

              <button
                type="button"
                className="rig-btn"
                onClick={() => { session.resetRestPose(); onRefresh(); }}
              >
                Reset rest pose
              </button>
            </details>
          )}

          {boneTransform && session.editMode === 'pose' && (
            <div className="rig-bone-advanced is-open">
              <p className="rig-hint" style={{ marginBottom: 6 }}>Pose transform (relative to parent)</p>
              {(['position', 'rotation', 'scale'] as const).map((channel) => (
                <div key={channel} style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'capitalize' }}>
                    {channel} {channel === 'rotation' ? '(rad)' : ''}
                  </span>
                  <div className="rig-transform-grid">
                    {(['x', 'y', 'z'] as const).map((axis) => (
                      <label key={`${channel}-${axis}`} className="rig-field">
                        <span>{axis.toUpperCase()}</span>
                        <input
                          className="rig-input"
                          type="number"
                          step={channel === 'rotation' ? 0.05 : 0.01}
                          value={Number(boneTransform[channel][axis].toFixed(4))}
                          onChange={(event) => updateField(axis, channel, Number(event.target.value))}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="rig-btn"
                onClick={() => { session.applyPoseAsRest(); onRefresh(); }}
              >
                Apply as rest
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
