import { useState } from 'react';
import { BlenderIcon } from '@/components/BlenderIcon';
import { getActiveClip, readRigDocumentSettings } from '@/core/rig/RigDocument';
import type { KeyframeInterpolation } from '@/core/rig/types';
import { pushToast } from '@/app/Toast';
import type { AnimationSession } from './AnimationSession';

type Props = {
  session: AnimationSession;
  onRefresh: () => void;
  onToggleCollapse?: () => void;
  style?: React.CSSProperties;
};

type ChannelKind = 'position' | 'rotation' | 'scale';

function keyMark(hasKeyHere: boolean, animated: boolean, dirty: boolean) {
  if (dirty) return { mark: '●', className: 'is-dirty', title: 'Changed · not keyed' };
  if (hasKeyHere) return { mark: '◆', className: 'is-keyed', title: 'Key on this frame' };
  if (animated) return { mark: '◇', className: 'is-animated', title: 'Animated' };
  return { mark: '◇', className: '', title: 'Not animated' };
}

export function AnimationInspectorPanel({ session, onRefresh, onToggleCollapse, style }: Props) {
  const settings = readRigDocumentSettings(session.rigDocument);
  const armature = settings.armatureId ? session.project.armatures.get(settings.armatureId) : null;
  const activeClip = getActiveClip(session.project, session.rigDocument);
  const selectedBone = session.selectedBoneId && armature ? armature.bones.get(session.selectedBoneId) : null;
  const currentTransform = session.getSelectedBoneLocalTransform();
  const time = session.playbackTime;
  const fps = activeClip?.fps || 24;
  const frame = Math.round(time * fps);
  const totalFrames = Math.round((activeClip?.duration ?? 1) * fps);

  const boneTrack = activeClip?.tracks.find((track) => track.boneId === session.selectedBoneId);
  const currentKeyframe = boneTrack?.keyframes.find((key) => Math.abs(key.time - time) < 0.001);
  const hasKeysOnBone = (boneTrack?.keyframes.length ?? 0) > 0;
  const dirty = session.poseDirty && session.poseScratch.has(session.selectedBoneId ?? '');

  const isIk = Boolean(selectedBone?.name.toLowerCase().includes('ik'));
  const isRootish = Boolean(
    selectedBone &&
      (!selectedBone.parentId || /root|pelvis|hips|hand|foot/i.test(selectedBone.name)),
  );

  const [lockPosition, setLockPosition] = useState(false);
  const [lockRotation, setLockRotation] = useState(false);
  const [lockScale, setLockScale] = useState(true);
  const [openChannels, setOpenChannels] = useState<Record<ChannelKind, boolean>>({
    position: isRootish,
    rotation: true,
    scale: false,
  });
  const [openPose, setOpenPose] = useState(true);
  const [openAnimation, setOpenAnimation] = useState(false);
  const [openIk, setOpenIk] = useState(isIk);

  const boneConstraints = session.constraints.filter((constraint) => constraint.ownerId === session.selectedBoneId);

  const handleUpdatePos = (axis: 'x' | 'y' | 'z', val: number) => {
    if (lockPosition || !currentTransform) return;
    const next = { ...currentTransform, position: { ...currentTransform.position, [axis]: val } };
    session.setSelectedBoneLocalTransform(next);
    onRefresh();
  };

  const handleUpdateRot = (axis: 'x' | 'y' | 'z', deg: number) => {
    if (lockRotation || !currentTransform) return;
    const rad = (deg * Math.PI) / 180;
    const next = { ...currentTransform, rotation: { ...currentTransform.rotation, [axis]: rad } };
    session.setSelectedBoneLocalTransform(next);
    onRefresh();
  };

  const handleUpdateScale = (axis: 'x' | 'y' | 'z', val: number) => {
    if (lockScale || !currentTransform) return;
    const next = { ...currentTransform, scale: { ...currentTransform.scale, [axis]: Math.max(0.01, val) } };
    session.setSelectedBoneLocalTransform(next);
    onRefresh();
  };

  const rotDeg = {
    x: Math.round((((currentTransform?.rotation.x ?? 0) * 180) / Math.PI) * 10) / 10,
    y: Math.round((((currentTransform?.rotation.y ?? 0) * 180) / Math.PI) * 10) / 10,
    z: Math.round((((currentTransform?.rotation.z ?? 0) * 180) / Math.PI) * 10) / 10,
  };

  const status = keyMark(Boolean(currentKeyframe), hasKeysOnBone, dirty);
  const role = isIk ? 'Control · IK' : hasKeysOnBone ? 'Bone · Animated' : 'Bone · Not Animated';

  const toggleChannel = (kind: ChannelKind) => {
    setOpenChannels((current) => ({ ...current, [kind]: !current[kind] }));
  };

  return (
    <aside className="rig-sidebar animation-inspector-panel" style={style} aria-label="Animation Inspector">
      <div className="rig-panel-header">
        <div className="rig-panel-title">
          <BlenderIcon name="properties" size={14} />
          <span>Inspector</span>
        </div>
        <div className="rig-header-actions">
          {onToggleCollapse && (
            <button type="button" className="rig-btn-sm" title="Hide Inspector" onClick={onToggleCollapse}>
              <BlenderIcon name="tria_right" size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="anim-inspector-content">
        {selectedBone ? (
          <>
            <div className="inspector-section">
              <div className="inspector-bone-hero">
                <div className="inspector-bone-name">
                  <strong>{selectedBone.name}</strong>
                  <span className="inspector-bone-role">{role}</span>
                </div>
                <span className={`anim-pose-status ${status.className}`} title={status.title}>
                  Frame {frame} / {totalFrames}
                  {dirty ? ' · Modified' : currentKeyframe ? ' · Keyed' : ''}
                </span>
              </div>
            </div>

            <div className="inspector-section">
              <div className="inspector-section-header">
                <span>Transform</span>
                <button
                  type="button"
                  className="rig-tool-btn"
                  title="Reset this bone to rest"
                  onClick={() => {
                    session.resetSelectedBonePose();
                    onRefresh();
                  }}
                >
                  Reset Pose
                </button>
              </div>

              <ChannelBlock
                title="Rotation"
                open={openChannels.rotation}
                onToggle={() => toggleChannel('rotation')}
                lock={lockRotation}
                onLock={setLockRotation}
                status={status}
                unit="°"
                values={[rotDeg.x, rotDeg.y, rotDeg.z]}
                step={1}
                disabled={lockRotation}
                onChange={handleUpdateRot}
              />
              <ChannelBlock
                title="Position"
                open={openChannels.position}
                onToggle={() => toggleChannel('position')}
                lock={lockPosition}
                onLock={setLockPosition}
                status={status}
                values={[
                  currentTransform?.position.x ?? 0,
                  currentTransform?.position.y ?? 0,
                  currentTransform?.position.z ?? 0,
                ]}
                step={0.05}
                disabled={lockPosition}
                onChange={handleUpdatePos}
              />
              <ChannelBlock
                title="Scale"
                open={openChannels.scale}
                onToggle={() => toggleChannel('scale')}
                lock={lockScale}
                onLock={setLockScale}
                status={status}
                values={[
                  currentTransform?.scale.x ?? 1,
                  currentTransform?.scale.y ?? 1,
                  currentTransform?.scale.z ?? 1,
                ]}
                step={0.05}
                disabled={lockScale}
                lockedHint
                onChange={handleUpdateScale}
              />
            </div>

            <div className="inspector-section">
              <button type="button" className="inspector-fold" onClick={() => setOpenPose((open) => !open)}>
                <span>{openPose ? '▾' : '▸'} Pose</span>
              </button>
              {openPose && (
                <div className="anim-pose-actions">
                  <button
                    type="button"
                    className="anim-key-pose-main"
                    onClick={() => {
                      session.keyCurrentPose();
                      pushToast(`Pose keyed · Frame ${frame}`, 'success');
                      onRefresh();
                    }}
                  >
                    ◆ {currentKeyframe ? 'Update Pose' : 'Key Pose'}
                  </button>
                  <div className="anim-pose-row">
                    <button type="button" className="sculpt-action-btn" onClick={() => { session.copyPose(); onRefresh(); }}>Copy</button>
                    <button type="button" className="sculpt-action-btn" onClick={() => { session.pastePose(); onRefresh(); }}>Paste</button>
                    <button type="button" className="sculpt-action-btn" onClick={() => { session.mirrorCurrentPose(); onRefresh(); }}>Mirror</button>
                  </div>
                  <button
                    type="button"
                    className="anim-key-selected"
                    disabled={!session.selectedBoneId}
                    onClick={() => {
                      session.insertKeyframeForSelectedBone();
                      onRefresh();
                    }}
                  >
                    Key Selected
                  </button>
                </div>
              )}
            </div>

            {isIk && (
              <div className="inspector-section">
                <button type="button" className="inspector-fold" onClick={() => setOpenIk((open) => !open)}>
                  <span>{openIk ? '▾' : '▸'} IK</span>
                </button>
                {openIk && (
                  <p className="anim-empty-note">
                    Two-bone IK is active in Pose mode. Select this control and drag with G to bend the chain.
                  </p>
                )}
              </div>
            )}

            {boneConstraints.length > 0 && (
              <div className="inspector-section">
                <div className="inspector-section-header">
                  <span>Constraints</span>
                </div>
                {boneConstraints.map((constraint) => (
                  <div key={constraint.id} className="constraint-mini-card">
                    <div className="constraint-title">
                      <BlenderIcon name="constraint" size={12} />
                      <span>{constraint.name}</span>
                    </div>
                    <div className="constraint-influence-row">
                      <span className="label">Influence</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={constraint.influence}
                        onChange={(event) => {
                          constraint.influence = Number(event.target.value);
                          onRefresh();
                        }}
                      />
                      <span className="value">{(constraint.influence * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="inspector-section">
              <button type="button" className="inspector-fold" onClick={() => setOpenAnimation((open) => !open)}>
                <span>{openAnimation ? '▾' : '▸'} Animation</span>
              </button>
              {openAnimation && activeClip && (
                <div className="anim-clip-props">
                  <div className="anim-prop-row">
                    <span>Clip</span>
                    <b>{activeClip.name}</b>
                  </div>
                  <label className="anim-prop-row">
                    <span>Length</span>
                    <span className="anim-length-inline">
                      <input
                        className="anim-length-input"
                        type="number"
                        min={1}
                        max={9999}
                        value={totalFrames}
                        onChange={(event) => {
                          session.setClipTotalFrames(Math.max(1, parseInt(event.target.value, 10) || 1));
                          onRefresh();
                        }}
                      />
                      <span>f</span>
                    </span>
                  </label>
                  <div className="anim-prop-row">
                    <span>Auto Key</span>
                    <b>{session.autoKeyframe ? 'On' : 'Off'}</b>
                  </div>
                  {currentKeyframe && (
                    <label className="anim-prop-row">
                      <span>Interpolation</span>
                      <select
                        className="rig-select-sm"
                        value={currentKeyframe.interpolation || 'smooth'}
                        onChange={(event) => {
                          session.setSelectedKeyframeInterpolation(event.target.value as KeyframeInterpolation);
                          onRefresh();
                        }}
                      >
                        <option value="smooth">Smooth</option>
                        <option value="linear">Linear</option>
                        <option value="step">Step</option>
                      </select>
                    </label>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          activeClip && (
            <div className="inspector-section">
              <div className="inspector-bone-hero">
                <div className="inspector-bone-name">
                  <strong>{activeClip.name}</strong>
                  <span className="inspector-bone-role">Animation Clip</span>
                </div>
              </div>
              <div className="anim-clip-props">
                <label className="anim-prop-row">
                  <span>Frames</span>
                  <span className="anim-length-inline">
                    <input
                      className="anim-length-input"
                      type="number"
                      min={1}
                      max={9999}
                      value={totalFrames}
                      onChange={(event) => {
                        session.setClipTotalFrames(Math.max(1, parseInt(event.target.value, 10) || 1));
                        onRefresh();
                      }}
                    />
                    <span>f</span>
                  </span>
                </label>
                <label className="anim-prop-row">
                  <span>Duration</span>
                  <span className="anim-length-inline">
                    <input
                      className="anim-length-input anim-length-seconds"
                      type="number"
                      min={0.05}
                      step={0.1}
                      value={Number(activeClip.duration.toFixed(2))}
                      onChange={(event) => {
                        session.setClipDuration(Math.max(0.05, parseFloat(event.target.value) || 0.1));
                        onRefresh();
                      }}
                    />
                    <span>s</span>
                  </span>
                </label>
                <div className="anim-prop-row">
                  <span>FPS</span>
                  <b>{fps}</b>
                </div>
                <div className="anim-prop-row">
                  <span>Loop</span>
                  <b>{session.loopPlayback ? 'On' : 'Off'}</b>
                </div>
                <label className="anim-prop-row">
                  <span>Root Motion</span>
                  <select
                    className="rig-select-sm"
                    value={activeClip.rootMotionMode || (activeClip.rootMotion ? 'xz' : 'none')}
                    onChange={(event) => {
                      const mode = event.target.value as 'none' | 'xz' | 'xyz' | 'rotation';
                      activeClip.rootMotion = mode !== 'none';
                      activeClip.rootMotionMode = mode;
                      session.markDirty();
                      onRefresh();
                    }}
                  >
                    <option value="none">None</option>
                    <option value="xz">XZ</option>
                    <option value="xyz">XYZ</option>
                    <option value="rotation">Rotation</option>
                  </select>
                </label>
              </div>
            </div>
          )
        )}
      </div>
    </aside>
  );
}

function ChannelBlock({
  title,
  open,
  onToggle,
  lock,
  onLock,
  status,
  values,
  step,
  disabled,
  unit = '',
  lockedHint,
  onChange,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  lock: boolean;
  onLock: (next: boolean) => void;
  status: { mark: string; className: string; title: string };
  values: [number, number, number];
  step: number;
  disabled: boolean;
  unit?: string;
  lockedHint?: boolean;
  onChange: (axis: 'x' | 'y' | 'z', value: number) => void;
}) {
  return (
    <div className="channel-group">
      <div className="channel-header">
        <button type="button" className="inspector-fold" onClick={onToggle}>
          {open ? '▾' : '▸'} {title}
          <i className={`anim-key-mark ${status.className}`} title={status.title}>{status.mark}</i>
        </button>
        <button
          type="button"
          className={`channel-lock-btn${lock ? ' is-on' : ''}`}
          title={lock ? `Unlock ${title}` : `Lock ${title}`}
          onClick={() => onLock(!lock)}
        >
          {lock ? 'Locked' : 'Lock'}
        </button>
      </div>
      {open && !lock && (
        <div className="channel-axes channel-axes-stack">
          {(['x', 'y', 'z'] as const).map((axis, index) => (
            <label key={axis} className="axis-field">
              <span className={`axis-letter ${axis}`}>{axis.toUpperCase()}</span>
              <input
                type="number"
                step={step}
                disabled={disabled}
                className="rig-input-sm"
                value={Number(values[index]!.toFixed(2))}
                onChange={(event) => onChange(axis, Number(event.target.value))}
              />
              {unit && <span className="axis-unit">{unit}</span>}
            </label>
          ))}
        </div>
      )}
      {open && lock && lockedHint && <p className="anim-empty-note">Locked to prevent accidental bone scale.</p>}
    </div>
  );
}
