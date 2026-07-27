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
        <h3 className="rig-panel-title">Bone editor</h3>
        <p className="rig-hint">Create an armature with Quick setup first.</p>
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
        <h3 className="rig-panel-title">Bone editor</h3>
        {session.editMode === 'edit' && (
          <div className="rig-inline-actions">
            <button type="button" className="rig-btn-sm" title="Add child bone" onClick={() => { session.addBoneToSelection(); onRefresh(); }}>+</button>
            <button type="button" className="rig-btn-sm" title="Extrude from tail" onClick={() => { session.extrudeSelectedBone(); onRefresh(); }}>↧</button>
            <button type="button" className="rig-btn-sm" title="Delete bone" onClick={() => { session.deleteSelectedBone(); onRefresh(); }}>×</button>
          </div>
        )}
      </div>

      <p className="rig-hint rig-bone-editor-hint">
        {session.editMode === 'edit'
          ? 'Click bones in the viewport. Drag orange/yellow handles to move head and tail.'
          : 'Switch to Edit mode to change bone structure.'}
      </p>

      <ul className="rig-bone-list rig-bone-list-tall">
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

          {session.editMode === 'edit' && (
            <label className="rig-field">
              <span>Roll (rad)</span>
              <input
                className="rig-input"
                type="number"
                step={0.05}
                value={Number(selectedBone.roll.toFixed(4))}
                onChange={(event) => {
                  session.setSelectedBoneRoll(Number(event.target.value));
                  onRefresh();
                }}
              />
            </label>
          )}

          {boneTransform && (session.editMode === 'edit' || session.editMode === 'pose') && (
            <div>
              <p className="rig-hint" style={{ marginBottom: 6 }}>
                {session.editMode === 'edit' ? 'Rest transform' : 'Pose transform'}
              </p>
              {(['position', 'rotation', 'scale'] as const).map((channel) => (
                <div key={channel} className="rig-channel-block">
                  <span className="rig-channel-label">{channel}</span>
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
            </div>
          )}

          {session.editMode === 'edit' && (
            <button type="button" className="rig-btn" onClick={() => { session.resetRestPose(); onRefresh(); }}>
              Reset rest pose
            </button>
          )}

          {session.editMode === 'pose' && (
            <div className="rig-btn-row">
              <button type="button" className="rig-btn" onClick={() => { session.insertKeyframeForSelectedBone(); onRefresh(); }}>
                Keyframe bone
              </button>
              <button type="button" className="rig-btn" onClick={() => { session.applyPoseAsRest(); onRefresh(); }}>
                Apply as rest
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
