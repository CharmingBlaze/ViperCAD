import { useState } from 'react';
import { BlenderIcon } from '@/components/BlenderIcon';
import { getActiveClip } from '@/core/rig/RigDocument';
import { confirmAction } from '@/app/platform/appDialogs';
import type { AnimationClipId } from '@/core/rig/types';
import type { AnimationSession } from './AnimationSession';

type Props = {
  session: AnimationSession;
  onRefresh: () => void;
  onSwitchToRig?: () => void;
  onToggleCollapse?: () => void;
  style?: React.CSSProperties;
};

export type ClipPreset = 'empty' | 'loop' | 'oneshot' | 'additive' | 'pose';

export function AnimationClipsPanel({
  session,
  onRefresh,
  onSwitchToRig,
  onToggleCollapse,
  style,
}: Props) {
  const [filterQuery, setFilterQuery] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [newClipName, setNewClipName] = useState('Walk');
  const [newClipPreset, setNewClipPreset] = useState<ClipPreset>('loop');
  const [newClipFps, setNewClipFps] = useState(30);
  const [newClipDuration, setNewClipDuration] = useState(0.8);
  const [newClipLoop, setNewClipLoop] = useState(true);
  const [newClipRootMotion, setNewClipRootMotion] = useState<'none' | 'xz' | 'xyz' | 'rotation'>('none');
  const [renamingClipId, setRenamingClipId] = useState<AnimationClipId | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const clips = session.getClips();
  const activeClip = getActiveClip(session.project, session.rigDocument);

  const filteredClips = clips.filter((clip) =>
    clip.name.toLowerCase().includes(filterQuery.toLowerCase()),
  );

  const handleCreateClip = () => {
    const name = newClipName.trim() || 'New Animation';
    let duration = Math.max(0.1, newClipDuration);
    if (newClipPreset === 'pose') {
      duration = 1 / newClipFps;
    }
    const createdClip = session.createClip(name);
    if (createdClip) {
      createdClip.duration = duration;
      createdClip.fps = newClipFps;
      createdClip.loopMode = newClipLoop ? 'loop' : 'once';
      createdClip.rootMotion = newClipRootMotion !== 'none';
      createdClip.rootMotionMode = newClipRootMotion;
      if (newClipPreset === 'additive') {
        createdClip.animationType = 'additive';
      }
      session.setActiveClip(createdClip.id);
    }
    setShowNewModal(false);
    onRefresh();
  };

  const handlePresetChange = (preset: ClipPreset) => {
    setNewClipPreset(preset);
    switch (preset) {
      case 'loop':
        setNewClipDuration(0.8);
        setNewClipLoop(true);
        break;
      case 'oneshot':
        setNewClipDuration(1.2);
        setNewClipLoop(false);
        break;
      case 'additive':
        setNewClipDuration(0.5);
        setNewClipLoop(true);
        break;
      case 'pose':
        setNewClipDuration(1 / newClipFps);
        setNewClipLoop(false);
        break;
      case 'empty':
      default:
        setNewClipDuration(1.0);
        setNewClipLoop(true);
        break;
    }
  };

  return (
    <aside className="rig-sidebar animation-clips-panel" style={style} aria-label="Animation Clips">
      {/* Header with Title & Workspace Switcher & Collapse */}
      <div className="rig-panel-header">
        <div className="rig-panel-title">
          <BlenderIcon name="action" size={14} />
            <span>Animations</span>
          <span className="rig-badge">{clips.length}</span>
          <button
            type="button"
            className="anim-clip-add"
            title="New animation"
            onClick={() => {
              setNewClipName(`Animation ${String(clips.length + 1).padStart(2, '0')}`);
              setShowNewModal(true);
            }}
          >
            +
          </button>
        </div>
        <div className="rig-header-actions">
          {onSwitchToRig && (
            <button
              type="button"
              className="rig-btn-sm"
              title="Switch to Rigging Workspace"
              onClick={onSwitchToRig}
            >
              <BlenderIcon name="armature_data" size={12} />
              <span>Rig</span>
            </button>
          )}
          {onToggleCollapse && (
            <button
              type="button"
              className="rig-btn-sm"
              title="Hide Animations panel"
              onClick={onToggleCollapse}
            >
              <BlenderIcon name="tria_left" size={12} />
            </button>
          )}
        </div>
      </div>

      {clips.length > 5 && (
        <div className="anim-clips-search">
          <input
            type="text"
            className="rig-input-sm"
            placeholder="Filter clips..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
          />
        </div>
      )}

      {/* Clip List */}
      <div className="anim-clips-list" role="list">
        {filteredClips.length === 0 ? (
          <div className="rig-empty-state">
            <p>No animations found</p>
          </div>
        ) : (
          filteredClips.map((clip) => {
            const isActive = activeClip?.id === clip.id;
            const frameCount = Math.round(clip.duration * (clip.fps || 30));
            const isLoop = clip.loopMode === 'loop' || (clip.loopMode === undefined && session.loopPlayback);

            return (
              <div
                key={clip.id}
                className={`anim-clip-item${isActive ? ' is-active' : ''}`}
                onClick={() => {
                  if (activeClip?.id !== clip.id) {
                    session.setActiveClip(clip.id);
                    onRefresh();
                  }
                }}
              >
                <div className="anim-clip-main">
                  <div className="anim-clip-status">
                    <span className={`anim-clip-dot${isActive ? ' is-playing' : ''}`} />
                  </div>

                  <div className="anim-clip-info">
                    {renamingClipId === clip.id ? (
                      <input
                        type="text"
                        className="anim-clip-rename-input"
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => {
                          if (renameValue.trim()) {
                            session.renameClip(clip.id, renameValue.trim());
                          }
                          setRenamingClipId(null);
                          onRefresh();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            if (renameValue.trim()) {
                              session.renameClip(clip.id, renameValue.trim());
                            }
                            setRenamingClipId(null);
                            onRefresh();
                          } else if (e.key === 'Escape') {
                            setRenamingClipId(null);
                          }
                        }}
                      />
                    ) : (
                      <span className="anim-clip-name" title={clip.name}>
                        {clip.name}
                      </span>
                    )}

                    <div className="anim-clip-meta">
                      <span>{clip.duration.toFixed(2)}s · {frameCount}f</span>
                    </div>
                  </div>

                  <div className="anim-clip-tags">
                    {isLoop && <span className="anim-clip-icon" title="Looping animation">∞</span>}
                    {!isLoop && <span className="anim-clip-icon" title="One-shot animation">▶</span>}
                    {clip.animationType === 'additive' && (
                      <span className="anim-clip-icon" title="Additive animation">+</span>
                    )}
                  </div>
                </div>

                <div className="anim-clip-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="rig-tool-btn"
                      title="Rename"
                      onClick={() => {
                        setRenamingClipId(clip.id);
                        setRenameValue(clip.name);
                      }}
                    >
                      <BlenderIcon name="rename" size={12} />
                    </button>
                    <button
                      type="button"
                      className="rig-tool-btn"
                      title="Duplicate Clip"
                      onClick={() => {
                        session.duplicateClip(clip.id);
                        onRefresh();
                      }}
                    >
                      <BlenderIcon name="duplicate" size={12} />
                    </button>
                    <button
                      type="button"
                      className="rig-tool-btn"
                      title="Mirror Clip Left/Right"
                      onClick={() => {
                        session.mirrorCurrentPose();
                        onRefresh();
                      }}
                    >
                      <BlenderIcon name="mirror" size={12} />
                    </button>
                    {clips.length > 1 && (
                      <button
                        type="button"
                        className="rig-tool-btn danger"
                        title="Delete Clip"
                        onClick={() => {
                          void (async () => {
                            const confirmed = await confirmAction({
                              title: 'Delete animation',
                              message: `Delete animation "${clip.name}"? This cannot be undone.`,
                              confirmLabel: 'Delete',
                              danger: true,
                            });
                            if (!confirmed) return;
                            session.deleteClip(clip.id);
                            onRefresh();
                          })();
                        }}
                      >
                        <BlenderIcon name="trash" size={12} />
                      </button>
                    )}
                  </div>
              </div>
            );
          })
        )}
      </div>

      {/* New Animation Modal */}
      {showNewModal && (
        <div className="rig-modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="rig-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rig-modal-header">
              <h3>New Animation Clip</h3>
              <button
                type="button"
                className="rig-close-btn"
                onClick={() => setShowNewModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="rig-modal-body">
              <div className="rig-field">
                <label>Clip Name</label>
                <input
                  type="text"
                  className="rig-input"
                  autoFocus
                  value={newClipName}
                  onChange={(e) => setNewClipName(e.target.value)}
                />
              </div>

              <div className="rig-field">
                <label>Preset</label>
                <select
                  className="rig-select"
                  value={newClipPreset}
                  onChange={(e) => handlePresetChange(e.target.value as ClipPreset)}
                >
                  <option value="loop">Loop (Walk / Run / Idle)</option>
                  <option value="oneshot">One Shot (Attack / Jump / Hit)</option>
                  <option value="additive">Additive (Recoil / Aim Offset)</option>
                  <option value="pose">Single Pose (Static Hold)</option>
                  <option value="empty">Empty (Custom)</option>
                </select>
              </div>

              <div className="rig-grid-2">
                <div className="rig-field">
                  <label>FPS</label>
                  <select
                    className="rig-select"
                    value={newClipFps}
                    onChange={(e) => setNewClipFps(Number(e.target.value))}
                  >
                    <option value="24">24 FPS (Cinematic)</option>
                    <option value="30">30 FPS (Standard)</option>
                    <option value="60">60 FPS (Fluid)</option>
                  </select>
                </div>

                <div className="rig-field">
                  <label>Duration (sec)</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="60"
                    className="rig-input"
                    value={newClipDuration}
                    onChange={(e) => setNewClipDuration(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="rig-grid-2">
                <div className="rig-field">
                  <label>Root Motion</label>
                  <select
                    className="rig-select"
                    value={newClipRootMotion}
                    onChange={(e) =>
                      setNewClipRootMotion(e.target.value as 'none' | 'xz' | 'xyz' | 'rotation')
                    }
                  >
                    <option value="none">None (In Place)</option>
                    <option value="xz">XZ Translation (Walk/Run)</option>
                    <option value="xyz">XYZ Translation (Jump/Climb)</option>
                    <option value="rotation">Rotation (Turn)</option>
                  </select>
                </div>

                <div className="rig-field" style={{ justifyContent: 'center' }}>
                  <label className="rig-checkbox-label" style={{ marginTop: '1.2rem' }}>
                    <input
                      type="checkbox"
                      checked={newClipLoop}
                      onChange={(e) => setNewClipLoop(e.target.checked)}
                    />
                    <span>Loop Playback</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="rig-modal-footer">
              <button
                type="button"
                className="rig-btn"
                onClick={() => setShowNewModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rig-btn rig-btn-primary"
                onClick={handleCreateClip}
              >
                Create Animation
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
