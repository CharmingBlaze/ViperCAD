import { buildBoneTree } from '@/core/rig/boneTree';
import { readRigDocumentSettings } from '@/core/rig/RigDocument';
import type { BoneId } from '@/core/rig/types';
import type { RigSession } from '../RigSession';

type Props = {
  session: RigSession;
  onRefresh: () => void;
};

export function BoneEditorPanel({ session, onRefresh }: Props) {
  const settings = readRigDocumentSettings(session.rigDocument);
  const armature = settings.armatureId ? session.project.armatures.get(settings.armatureId) : null;
  const boneTree = armature ? buildBoneTree(armature) : [];
  const selectedBone = session.selectedBoneId && armature
    ? armature.bones.get(session.selectedBoneId)
    : null;
  const boneTransform = session.getSelectedBoneLocalTransform();
  const boneTail = session.getSelectedBoneTail();

  if (!armature) {
    return (
      <section className="rig-panel">
        <h3 className="rig-panel-title">Armature</h3>
        <p className="rig-empty-text">No armature found. Run Quick Setup above to generate one.</p>
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
    <section className="rig-panel rig-bone-editor">
      <div className="rig-panel-head">
        <h3 className="rig-panel-title">
          {session.editMode === 'edit'
            ? 'Bone Structure'
            : session.editMode === 'pose'
              ? 'Pose & Transforms'
              : 'Bone Hierarchy'}
        </h3>
        {session.editMode === 'edit' && (
          <div className="rig-inline-actions">
            <button
              type="button"
              className="rig-btn-sm"
              title="Add child bone"
              onClick={() => { session.addBoneToSelection(); onRefresh(); }}
            >
              +
            </button>
            <button
              type="button"
              className="rig-btn-sm"
              title="Extrude bone from tail"
              onClick={() => { session.extrudeSelectedBone(); onRefresh(); }}
            >
              ↧
            </button>
            <button
              type="button"
              className="rig-btn-sm rig-btn-sm-danger"
              title="Delete selected bone"
              onClick={() => { session.deleteSelectedBone(); onRefresh(); }}
            >
              ×
            </button>
          </div>
        )}
      </div>

      <ul className="rig-bone-list rig-bone-list-tall" aria-label="Bones">
        {boneTree.map(({ bone, depth }) => (
          <li key={bone.id}>
            <button
              type="button"
              className={`rig-bone${session.selectedBoneId === bone.id ? ' is-active' : ''}`}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              onClick={() => { session.selectBone(bone.id); onRefresh(); }}
            >
              <span className="rig-bone-dot" aria-hidden />
              {bone.name}
            </button>
          </li>
        ))}
      </ul>

      {selectedBone && (
        <>
          <label className="rig-field" style={{ marginTop: '8px' }}>
            <span>Bone name</span>
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
              <span>Parent bone</span>
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
                {boneTree
                  .filter(({ bone }) => bone.id !== selectedBone.id)
                  .map(({ bone, depth }) => (
                    <option key={bone.id} value={bone.id}>
                      {'—'.repeat(depth)} {bone.name}
                    </option>
                  ))}
              </select>
            </label>
          )}

          {boneTail && session.editMode === 'edit' && (
            <div className="rig-prop-group">
              <div className="rig-prop-title">Tail Offset (Local)</div>
              <div className="rig-axis-row">
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <div key={`tail-${axis}`} className="rig-axis-input-group" title={`Tail ${axis.toUpperCase()}`}>
                    <span className={`rig-axis-chip axis-${axis}`}>{axis.toUpperCase()}</span>
                    <input
                      className="rig-input"
                      type="number"
                      step={0.01}
                      value={Number(boneTail[axis].toFixed(3))}
                      onChange={(event) => updateTail(axis, Number(event.target.value))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {session.editMode === 'edit' && (
            <label className="rig-field">
              <span>Roll (rad)</span>
              <input
                className="rig-input"
                type="number"
                step={0.05}
                value={Number(selectedBone.roll.toFixed(3))}
                onChange={(event) => {
                  session.setSelectedBoneRoll(Number(event.target.value));
                  onRefresh();
                }}
              />
            </label>
          )}

          {boneTransform && (session.editMode === 'edit' || session.editMode === 'pose') && (
            <div className="rig-transforms-section">
              <div className="rig-prop-title">
                {session.editMode === 'edit' ? 'Rest Transform' : 'Pose Transform'}
              </div>

              {/* Position */}
              <div className="rig-channel-block">
                <span className="rig-channel-label">Position</span>
                <div className="rig-axis-row">
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <div key={`pos-${axis}`} className="rig-axis-input-group" title={`Position ${axis.toUpperCase()}`}>
                      <span className={`rig-axis-chip axis-${axis}`}>{axis.toUpperCase()}</span>
                      <input
                        className="rig-input"
                        type="number"
                        step={0.01}
                        value={Number(boneTransform.position[axis].toFixed(3))}
                        onChange={(event) => updateField(axis, 'position', Number(event.target.value))}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Rotation */}
              <div className="rig-channel-block">
                <span className="rig-channel-label">Rotation</span>
                <div className="rig-axis-row">
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <div key={`rot-${axis}`} className="rig-axis-input-group" title={`Rotation ${axis.toUpperCase()}`}>
                      <span className={`rig-axis-chip axis-${axis}`}>{axis.toUpperCase()}</span>
                      <input
                        className="rig-input"
                        type="number"
                        step={0.05}
                        value={Number(boneTransform.rotation[axis].toFixed(3))}
                        onChange={(event) => updateField(axis, 'rotation', Number(event.target.value))}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Scale - tucked under expandable disclosure */}
              <details className="rig-scale-disclosure">
                <summary className="rig-scale-summary">
                  <span className="rig-channel-label">Scale</span>
                  <span className="rig-scale-preview">
                    {Number(boneTransform.scale.x.toFixed(2))}, {Number(boneTransform.scale.y.toFixed(2))}, {Number(boneTransform.scale.z.toFixed(2))}
                  </span>
                </summary>
                <div className="rig-axis-row" style={{ marginTop: '6px' }}>
                  {(['x', 'y', 'z'] as const).map((axis) => (
                    <div key={`scale-${axis}`} className="rig-axis-input-group" title={`Scale ${axis.toUpperCase()}`}>
                      <span className={`rig-axis-chip axis-${axis}`}>{axis.toUpperCase()}</span>
                      <input
                        className="rig-input"
                        type="number"
                        step={0.01}
                        value={Number(boneTransform.scale[axis].toFixed(3))}
                        onChange={(event) => updateField(axis, 'scale', Number(event.target.value))}
                      />
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

          {session.editMode === 'edit' && (
            <div className="rig-btn-row" style={{ marginTop: '12px' }}>
              <button
                type="button"
                className="rig-btn rig-btn-secondary"
                onClick={() => { session.resetRestPose(); onRefresh(); }}
              >
                Reset Rest Pose
              </button>
            </div>
          )}

          {session.editMode === 'pose' && (
            <div className="rig-btn-row" style={{ marginTop: '12px' }}>
              <button
                type="button"
                className="rig-btn rig-btn-primary"
                onClick={() => { session.insertKeyframeForSelectedBone(); onRefresh(); }}
              >
                Keyframe Bone
              </button>
              <button
                type="button"
                className="rig-btn rig-btn-caution"
                title="Overwrites base rest pose with current pose transforms"
                onClick={() => { session.applyPoseAsRest(); onRefresh(); }}
              >
                Apply Pose as Rest…
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
