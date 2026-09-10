import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildBoneTree } from '@/core/rig/boneTree';
import { getActiveClip, readRigDocumentSettings } from '@/core/rig/RigDocument';
import { clipFrameCount } from '@/core/rig/AnimationLibrary';
import { BlenderIcon } from '@/components/BlenderIcon';
import { GraphEditor } from './GraphEditor';
import { applyPosePreset, type PosePresetName } from '@/core/rig/PosePresets';
import { EXPORT_PROFILES, type ExportProfile } from '@/app/GameExportProfiles';
import { exportRigGlb, validateGlbRoundTrip } from '@/app/GameExport';
import {
  chooseNativeSaveTarget,
  GLB_FILE,
  IMAGE_FILES,
  writeNativeFile,
} from '@/app/platform/FileDialogs';
import { generateSpriteSheet, type SpriteDirectionCount } from '@/core/export/SpriteSheetGenerator';
import type { BoneId } from '@/core/rig/types';
import type { AnimationSession } from './AnimationSession';
import { AnimationEventForm } from './AnimationEventForm';

type Props = {
  session: AnimationSession;
  onRefresh: () => void;
  showToolbar?: boolean;
};

type DragState = {
  boneId: BoneId;
  keyTime: number;
  startX: number;
};

type DockTab = 'timeline' | 'curves' | 'events' | 'motion' | 'poses' | 'layers' | 'diagnostics' | 'export';

export function DopeSheet({ session, onRefresh, showToolbar = true }: Props) {
  const [activeDockTab, setActiveDockTab] = useState<DockTab>('timeline');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [poseName, setPoseName] = useState('');

  // If session timeline view mode is set to graph via external trigger
  useEffect(() => {
    if (session.timelineViewMode === 'graph' && activeDockTab === 'timeline') {
      setActiveDockTab('curves');
    }
  }, [session.timelineViewMode, activeDockTab]);

  const doc = session.rigDocument;
  const clip = getActiveClip(session.project, doc);
  const settings = readRigDocumentSettings(doc);
  const armature = settings.armatureId ? session.project.armatures.get(settings.armatureId) : null;
  const boneTreeAll = armature ? buildBoneTree(armature) : [];
  const duration = Math.max(0.1, clip?.duration ?? 1);
  const fps = clip?.fps ?? 24;
  const time = Math.min(session.playbackTime, duration);
  const frame = Math.round(time * fps);
  const totalFrames = clipFrameCount(clip ?? { duration, fps, id: '', name: '', tracks: [] });
  const pxPerFrame = session.timelineZoom;
  const trackWidth = Math.max(totalFrames * pxPerFrame, 400);
  const playheadX = (time / duration) * trackWidth;

  const scrollRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [expandedBones, setExpandedBones] = useState<Set<BoneId>>(new Set());
  const [boneFilter, setBoneFilter] = useState('');
  const [scaleKeysOnResize, setScaleKeysOnResize] = useState(false);

  // Events & Motion Tab state
  const [exportingGlb, setExportingGlb] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('godot');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const boneTree = useMemo(() => {
    if (!boneFilter.trim()) return boneTreeAll;
    const q = boneFilter.toLowerCase();
    return boneTreeAll.filter(({ bone }) => bone.name.toLowerCase().includes(q));
  }, [boneTreeAll, boneFilter]);

  const toggleBoneExpanded = (boneId: BoneId, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedBones((prev) => {
      const next = new Set(prev);
      if (next.has(boneId)) next.delete(boneId);
      else next.add(boneId);
      return next;
    });
  };

  const rulerTicks = useMemo(() => {
    const ticks: { frame: number; major: boolean }[] = [];
    const step = pxPerFrame < 6 ? 5 : pxPerFrame < 12 ? 2 : 1;
    const majorEvery = fps === 24 || fps === 12 ? 6 : fps === 30 ? 5 : 8;
    for (let f = 0; f <= totalFrames; f += step) {
      ticks.push({ frame: f, major: f % majorEvery === 0 });
    }
    return ticks;
  }, [totalFrames, pxPerFrame, fps]);

  const syncLabelScroll = () => {
    if (scrollRef.current && labelsRef.current) {
      labelsRef.current.scrollTop = scrollRef.current.scrollTop;
    }
  };

  const syncTracksScroll = () => {
    if (scrollRef.current && labelsRef.current) {
      scrollRef.current.scrollTop = labelsRef.current.scrollTop;
    }
  };

  useEffect(() => {
    if (!drag || !clip) return;
    const onMove = (event: MouseEvent) => {
      const deltaFrames = Math.round((event.clientX - drag.startX) / pxPerFrame);
      const newTime = Math.max(0, Math.min(duration, drag.keyTime + deltaFrames / fps));
      if (session.moveKeyframe(drag.boneId, drag.keyTime, newTime)) {
        drag.keyTime = newTime;
        drag.startX = event.clientX;
        onRefresh();
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, clip, duration, fps, pxPerFrame, session, onRefresh]);

  // Timeline keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (session.selectedKeyframes.size > 0) {
          e.preventDefault();
          session.deleteSelectedKeyframes();
          onRefresh();
        }
      } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        session.selectAllKeyframes();
        onRefresh();
      } else if (e.key === 'd' && e.shiftKey) {
        if (session.selectedKeyframes.size > 0) {
          e.preventDefault();
          session.duplicateSelectedKeyframes(0.1);
          onRefresh();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session, onRefresh]);

  const seekFromClientX = useCallback(
    (clientX: number, trackLeft: number) => {
      const x = clientX - trackLeft;
      const ratio = Math.max(0, Math.min(1, x / trackWidth));
      session.seekTo(ratio * duration);
      onRefresh();
    },
    [duration, onRefresh, session, trackWidth],
  );

  const onTrackBackgroundClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      (event.target as HTMLElement).closest('.dope-key') ||
      (event.target as HTMLElement).closest('.dope-event-marker')
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    seekFromClientX(event.clientX, rect.left);
  };

  const handleAddEventAtPlayhead = () => {
    setEditingEventId(null);
    setActiveDockTab('events');
  };

  const events = session.getEvents();

  const handleExportGlb = async () => {
    setExportingGlb(true);
    setStatusMessage(null);
    try {
      const profile: ExportProfile =
        EXPORT_PROFILES[selectedProfileId as keyof typeof EXPORT_PROFILES] ?? EXPORT_PROFILES.godot;
      const target = await chooseNativeSaveTarget({
        suggestedName: `${clip?.name || 'character'}-${profile.id}.glb`,
        types: [GLB_FILE],
      });
      if (!target) {
        setExportingGlb(false);
        return;
      }
      const buffer = await exportRigGlb(session, profile);
      const validation = await validateGlbRoundTrip(buffer);
      await writeNativeFile(target, buffer, 'model/gltf-binary');
      setStatusMessage(`Exported ${target.name} (${validation.triangles} tris)`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportingGlb(false);
    }
  };

  const [exportingSpriteSheet, setExportingSpriteSheet] = useState(false);
  const [spriteDirections, setSpriteDirections] = useState<SpriteDirectionCount>(8);
  const [spriteFrameSize, setSpriteFrameSize] = useState<number>(128);

  const handleExportSpriteSheet = async () => {
    setExportingSpriteSheet(true);
    setStatusMessage(null);
    try {
      const result = await generateSpriteSheet(session, {
        frameWidth: spriteFrameSize,
        frameHeight: spriteFrameSize,
        directionCount: spriteDirections,
      });
      const target = await chooseNativeSaveTarget({
        suggestedName: result.filename,
        types: IMAGE_FILES,
      });
      if (target) {
        await writeNativeFile(target, result.blob, 'image/png');
        setStatusMessage(`Saved sprite sheet: ${target.name} (${result.metadata.columns * result.metadata.frameWidth}×${result.metadata.rows * result.metadata.frameHeight}px)`);
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Sprite sheet generation failed');
    } finally {
      setExportingSpriteSheet(false);
    }
  };

  return (
    <div className="dope-sheet">
      {/* Timeline Tabs Ribbon */}
      <div className="dope-tabs-header" role="tablist">
        <button
          type="button"
          className={`dope-tab-btn${activeDockTab === 'timeline' ? ' is-active' : ''}`}
          onClick={() => {
            setActiveDockTab('timeline');
            session.setTimelineViewMode('dopesheet');
            onRefresh();
          }}
        >
          <BlenderIcon name="action" size={13} />
          <span>Dope Sheet</span>
        </button>
        <button
          type="button"
          className={`dope-tab-btn${activeDockTab === 'curves' ? ' is-active' : ''}`}
          onClick={() => {
            setActiveDockTab('curves');
            session.setTimelineViewMode('graph');
            onRefresh();
          }}
        >
          <BlenderIcon name="graph" size={13} />
          <span>Curves</span>
        </button>
        <button
          type="button"
          className={`dope-tab-btn${activeDockTab === 'events' ? ' is-active' : ''}`}
          onClick={() => setActiveDockTab('events')}
        >
          <BlenderIcon name="driver" size={13} />
          <span>Events ({events.length})</span>
        </button>
        <select
          className="dope-more-select"
          aria-label="More animation editors"
          value={['motion', 'poses', 'layers', 'diagnostics', 'export'].includes(activeDockTab) ? activeDockTab : ''}
          onChange={(event) => {
            const next = event.target.value as DockTab;
            if (next) setActiveDockTab(next);
          }}
        >
          <option value="">More</option>
          <option value="motion">Root Motion</option>
          <option value="poses">Poses</option>
          <option value="layers">Layers</option>
          <option value="diagnostics">Diagnostics</option>
          <option value="export">Game Export</option>
        </select>
      </div>

      {/* Tab: Curves Graph Editor */}
      {activeDockTab === 'curves' ? (
        <GraphEditor session={session} onRefresh={onRefresh} />
      ) : activeDockTab === 'events' ? (
        /* Tab: Game Events Lane */
        <div className="dope-tab-content">
          <div className="rig-toolbar" style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>Game Animation Events</span>
            <button
              type="button"
              className="rig-btn"
              onClick={() => setEditingEventId(null)}
            >
              New event
            </button>
          </div>
          <AnimationEventForm
            key={editingEventId ?? 'new'}
            defaultName={editingEventId ? events.find((event) => event.id === editingEventId)?.name : 'Footstep.Left'}
            defaultParameter={editingEventId ? events.find((event) => event.id === editingEventId)?.parameter ?? '' : ''}
            submitLabel={editingEventId ? 'Save event' : `Add at frame ${frame}`}
            onSubmit={(name, parameter) => {
              if (editingEventId) {
                session.updateEvent(editingEventId, { name, parameter: parameter ?? '' });
              } else {
                session.addEvent(name, session.playbackTime, parameter);
              }
              setEditingEventId(null);
              onRefresh();
            }}
            onDelete={editingEventId ? () => {
              session.removeEvent(editingEventId);
              setEditingEventId(null);
              onRefresh();
            } : undefined}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="inspector-section">
              <span className="inspector-section-header">Events in Clip ({events.length})</span>
              {events.length === 0 ? (
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0' }}>
                  No game events in this clip. Add events like <code>Footstep.Left</code>, <code>Hitbox.Enable</code>, or <code>Sound.Swing</code>.
                </p>
              ) : (
                events.map((ev) => (
                  <div key={ev.id} className="anim-preset-card">
                    <div className="anim-preset-info">
                      <strong>{ev.name}</strong>
                      <span>Frame {Math.round(ev.time * fps)} ({ev.time.toFixed(2)}s) {ev.parameter ? `• ${ev.parameter}` : ''}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        className="rig-btn-sm"
                        onClick={() => {
                          session.seekTo(ev.time);
                          setEditingEventId(ev.id);
                          onRefresh();
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="rig-btn-sm danger"
                        onClick={() => {
                          session.removeEvent(ev.id);
                          onRefresh();
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="inspector-section">
              <span className="inspector-section-header">Common Event Presets</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                {['Footstep.Left', 'Footstep.Right', 'Hitbox.Enable', 'Hitbox.Disable', 'FX.Trail.Start', 'FX.Trail.Stop', 'Audio.Impact', 'Combo.Window'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="rig-btn-sm"
                    onClick={() => {
                      session.addEvent(preset, session.playbackTime);
                      onRefresh();
                    }}
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : activeDockTab === 'motion' ? (
        /* Tab: Root Motion */
        <div className="dope-tab-content">
          <div className="inspector-section" style={{ maxWidth: 600 }}>
            <span className="inspector-section-header">Root Motion Settings & Extraction</span>
            <div className="rig-grid-2">
              <div className="rig-field">
                <label>Root Motion Mode</label>
                <select
                  className="rig-select"
                  value={clip?.rootMotionMode || (clip?.rootMotion ? 'xz' : 'none')}
                  onChange={(e) => {
                    if (!clip) return;
                    const mode = e.target.value as 'none' | 'xz' | 'xyz' | 'rotation';
                    clip.rootMotion = mode !== 'none';
                    clip.rootMotionMode = mode;
                    session.markDirty();
                    onRefresh();
                  }}
                >
                  <option value="none">None (In Place)</option>
                  <option value="xz">XZ Translation (Standard Walk/Run)</option>
                  <option value="xyz">XYZ Translation (Jump / Climb)</option>
                  <option value="rotation">Rotation Only (Turn in place)</option>
                </select>
              </div>

              <div className="rig-field">
                <label>Playback Loop</label>
                <select
                  className="rig-select"
                  value={clip?.loopMode || 'loop'}
                  onChange={(e) => {
                    if (!clip) return;
                    clip.loopMode = e.target.value as 'once' | 'loop' | 'pingpong';
                    session.markDirty();
                    onRefresh();
                  }}
                >
                  <option value="loop">Loop</option>
                  <option value="once">Once</option>
                  <option value="pingpong">Ping Pong</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                type="button"
                className="rig-btn"
                onClick={() => {
                  if (clip) {
                    clip.rootMotion = false;
                    clip.rootMotionMode = 'none';
                    session.markDirty();
                    onRefresh();
                  }
                }}
              >
                Make In Place
              </button>
              <button
                type="button"
                className="rig-btn"
                onClick={() => {
                  if (clip) {
                    clip.rootMotion = true;
                    clip.rootMotionMode = 'xz';
                    session.markDirty();
                    onRefresh();
                  }
                }}
              >
                Extract Root Motion XZ
              </button>
            </div>
          </div>
        </div>
      ) : activeDockTab === 'poses' ? (
        /* Tab: Pose Library */
        <div className="dope-tab-content">
          <div className="inspector-section">
            <span className="inspector-section-header">Pose Library Presets</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 6, margin: '8px 0' }}>
              {(['T-Pose', 'A-Pose', 'Combat Stance', 'Sitting', 'Crouching'] as PosePresetName[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="rig-btn"
                  onClick={() => {
                    if (armature && clip) {
                      applyPosePreset(armature, clip, preset, session.playbackTime);
                      session.markDirty();
                      onRefresh();
                    }
                  }}
                >
                  Apply {preset}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
              <input
                className="rig-input"
                value={poseName}
                onChange={(event) => setPoseName(event.target.value)}
                placeholder="Pose name"
              />
              <button
                type="button"
                className="rig-btn rig-btn-primary"
                onClick={() => {
                  session.saveCustomPose(poseName.trim() || `Pose ${session.customPoses.length + 1}`);
                  setPoseName('');
                  onRefresh();
                }}
              >
                Capture pose
              </button>
              <button
                type="button"
                className="rig-btn"
                onClick={() => {
                  session.copyPose();
                  onRefresh();
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className="rig-btn"
                onClick={() => {
                  session.pastePose();
                  onRefresh();
                }}
              >
                Paste
              </button>
              <button
                type="button"
                className="rig-btn"
                onClick={() => {
                  session.mirrorCurrentPose();
                  onRefresh();
                }}
              >
                Mirror L ↔ R
              </button>
            </div>

            {session.customPoses.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <span className="inspector-section-header">Captured Project Poses</span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, marginTop: 6 }}>
                  {session.customPoses.map((p) => (
                    <div key={p.id} style={{ display: 'flex', gap: 2 }}>
                      <button
                        type="button"
                        className="rig-btn"
                        style={{ flex: 1 }}
                        onClick={() => {
                          session.applyCustomPose(p.id);
                          onRefresh();
                        }}
                      >
                        {p.name}
                      </button>
                      <button
                        type="button"
                        className="tool"
                        title="Delete custom pose"
                        onClick={() => {
                          session.deleteCustomPose(p.id);
                          onRefresh();
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : activeDockTab === 'layers' ? (
        /* Tab: Layers & Bone Masks */
        <div className="dope-tab-content">
          <div className="inspector-section" style={{ maxWidth: 500 }}>
            <span className="inspector-section-header">Animation Layers & Masks</span>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0' }}>
              Clip Type: <strong>{clip?.animationType === 'additive' ? 'Additive (Aim Offset / Recoil)' : 'Base Override'}</strong>
            </p>
            <div className="rig-field">
              <label>Animation Layer Mode</label>
              <select
                className="rig-select"
                value={clip?.animationType || 'normal'}
                onChange={(e) => {
                  if (!clip) return;
                  clip.animationType = e.target.value as 'normal' | 'additive';
                  session.markDirty();
                  onRefresh();
                }}
              >
                <option value="normal">Normal (Base Full-Body)</option>
                <option value="additive">Additive (Breathing / Recoil / Aim)</option>
              </select>
            </div>
          </div>
        </div>
      ) : activeDockTab === 'diagnostics' ? (
        /* Tab: Diagnostics & Key Reduction */
        <div className="dope-tab-content">
          <div className="inspector-section" style={{ maxWidth: 600 }}>
            <span className="inspector-section-header">Animation Quality Check</span>
            <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4, margin: '6px 0' }}>
              <div>✓ <strong>Tracks:</strong> {clip?.tracks.length ?? 0} animated bones</div>
              <div>✓ <strong>Keyframes:</strong> {clip?.tracks.reduce((sum, t) => sum + t.keyframes.length, 0) ?? 0} total transform keys</div>
              <div>✓ <strong>Duration:</strong> {clip?.duration.toFixed(2)}s ({totalFrames} frames @ {clip?.fps || 30} FPS)</div>
              <div>✓ <strong>Root Motion:</strong> {clip?.rootMotion ? `Enabled (${clip.rootMotionMode || 'XZ'})` : 'In-Place'}</div>
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                type="button"
                className="rig-btn"
                onClick={() => {
                  session.clearAllKeyframes();
                  onRefresh();
                }}
              >
                Clear All Keys
              </button>
            </div>
          </div>
        </div>
      ) : activeDockTab === 'export' ? (
        /* Tab: Game Export */
        <div className="dope-tab-content">
          <div className="inspector-section" style={{ maxWidth: 600 }}>
            <span className="inspector-section-header">Target Game Engine Profile</span>
            <div className="rig-grid-2">
              <div className="rig-field">
                <label>Engine Target</label>
                <select
                  className="rig-select"
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                >
                  <option value="godot">Godot 4 (+Y Up, 1.0x)</option>
                  <option value="unity">Unity (+Y Up, 1.0x)</option>
                  <option value="unreal">Unreal Engine (+Z Up, 100x)</option>
                  <option value="roblox">Roblox (+Y Up, 3.57x)</option>
                  <option value="minecraft">Minecraft-style (Pixel Nearest)</option>
                </select>
              </div>

              <div className="rig-field" style={{ justifyContent: 'center' }}>
                <button
                  type="button"
                  disabled={exportingGlb}
                  className="rig-btn rig-btn-primary"
                  style={{ marginTop: 18 }}
                  onClick={handleExportGlb}
                >
                  <BlenderIcon name="export" size={13} />
                  <span>{exportingGlb ? 'Exporting...' : 'Export Skinned GLB'}</span>
                </button>
              </div>
            </div>

            {statusMessage && (
              <p style={{ fontSize: 11, color: '#38bdf8', marginTop: 8 }}>
                {statusMessage}
              </p>
            )}
          </div>

          <div className="inspector-section" style={{ maxWidth: 600, marginTop: 8 }}>
            <span className="inspector-section-header">2D Animated Sprite Sheet Atlas Generator</span>
            <div className="rig-grid-2">
              <div className="rig-field">
                <label>Angles / Directions</label>
                <select
                  className="rig-select"
                  value={spriteDirections}
                  onChange={(e) => setSpriteDirections(Number(e.target.value) as SpriteDirectionCount)}
                >
                  <option value={8}>8 Directions (Isometric / Top-Down)</option>
                  <option value={4}>4 Directions (Cardinals)</option>
                  <option value={1}>Single Angle (Side-Scroller / Front)</option>
                </select>
              </div>

              <div className="rig-field">
                <label>Frame Resolution</label>
                <select
                  className="rig-select"
                  value={spriteFrameSize}
                  onChange={(e) => setSpriteFrameSize(Number(e.target.value))}
                >
                  <option value={64}>64 × 64 px (Pixel Art / Retro)</option>
                  <option value={128}>128 × 128 px (Standard 2D HD)</option>
                  <option value={256}>256 × 256 px (Ultra Hi-Res)</option>
                </select>
              </div>
            </div>

            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              <button
                type="button"
                disabled={exportingSpriteSheet}
                className="rig-btn rig-btn-primary"
                onClick={handleExportSpriteSheet}
              >
                <BlenderIcon name="image" size={13} />
                <span>{exportingSpriteSheet ? 'Rendering Sprite Sheet...' : 'Export Sprite Sheet (PNG)'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Default Tab: Dope Sheet Timeline */
        <>
          {showToolbar && (
            <div className="dope-toolbar">
              <div className="dope-toolbar-left">
                <span className="dope-clip-name">{clip?.name ?? 'No clip'}</span>

                {/* Transport Controls */}
                <button
                  type="button"
                  className="tool"
                  title="Jump to Start"
                  onClick={() => { session.seekTo(0); onRefresh(); }}
                >
                  <BlenderIcon name="rew" size={13} />
                </button>
                <button
                  type="button"
                  className="tool"
                  title="Previous Keyframe"
                  onClick={() => { session.jumpToPrevKeyframe(); onRefresh(); }}
                >
                  <BlenderIcon name="prev_keyframe" size={13} />
                </button>
                <button
                  type="button"
                  className="tool"
                  title="Previous Frame"
                  onClick={() => { session.stepFrame(-1); onRefresh(); }}
                >
                  <span style={{ fontSize: 11, fontWeight: 'bold' }}>-1</span>
                </button>
                <button
                  type="button"
                  className={`tool${session.playing ? ' is-active' : ''}`}
                  title={session.playing ? 'Pause' : 'Play'}
                  onClick={() => { session.togglePlayback(); onRefresh(); }}
                >
                  <BlenderIcon name={session.playing ? 'pause' : 'play'} size={13} />
                </button>
                <button
                  type="button"
                  className="tool"
                  title="Next Frame"
                  onClick={() => { session.stepFrame(1); onRefresh(); }}
                >
                  <span style={{ fontSize: 11, fontWeight: 'bold' }}>+1</span>
                </button>
                <button
                  type="button"
                  className="tool"
                  title="Next Keyframe"
                  onClick={() => { session.jumpToNextKeyframe(); onRefresh(); }}
                >
                  <BlenderIcon name="next_keyframe" size={13} />
                </button>
                <button
                  type="button"
                  className="tool"
                  title="Jump to End"
                  onClick={() => { session.seekTo(duration); onRefresh(); }}
                >
                  <BlenderIcon name="ff" size={13} />
                </button>

                <button
                  type="button"
                  className={`tool${session.loopPlayback ? ' is-active' : ''}`}
                  title={session.loopPlayback ? 'Loop Playback: ON (Click for Once)' : 'Loop Playback: OFF (Click to Loop)'}
                  onClick={() => { session.setLoopPlayback(!session.loopPlayback); onRefresh(); }}
                >
                  <BlenderIcon name="driver" size={13} />
                  <span>{session.loopPlayback ? 'Loop' : 'Once'}</span>
                </button>

                <select
                  className="dope-mini-select"
                  title="Playback Speed"
                  value={session.playbackSpeed}
                  onChange={(e) => { session.setPlaybackSpeed(Number(e.target.value)); onRefresh(); }}
                >
                  <option value={0.25}>0.25x</option>
                  <option value={0.5}>0.5x</option>
                  <option value={1.0}>1x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2.0}>2x</option>
                </select>

                <span className="bar-sep" aria-hidden />

                {/* Keying buttons */}
                <button
                  type="button"
                  className="tool"
                  title="Keyframe selected bone (K)"
                  disabled={!session.selectedBoneId}
                  onClick={() => { session.insertKeyframeForSelectedBone(); onRefresh(); }}
                >
                  <BlenderIcon name="keyframe" size={13} />
                  <span>Key (K)</span>
                </button>

                <button
                  type="button"
                  className="tool"
                  title="Key entire current pose across all changed bones (Pose Key)"
                  onClick={() => { session.keyCurrentPose(); onRefresh(); }}
                >
                  <BlenderIcon name="pose_hlt" size={13} />
                  <span>Key Pose</span>
                </button>

                {/* Keyframe Selection Tools */}
                {session.selectedKeyframes.size > 0 ? (
                  <div className="rig-bar-group" role="group" aria-label="Selection actions">
                    <span className="dope-sel-badge">{session.selectedKeyframes.size} selected</span>
                    <button
                      type="button"
                      className="tool"
                      title="Duplicate Selected Keyframes"
                      onClick={() => { session.duplicateSelectedKeyframes(0.1); onRefresh(); }}
                    >
                      <span>Dup</span>
                    </button>
                    <button
                      type="button"
                      className="tool"
                      title="Scale Selected (0.5x)"
                      onClick={() => { session.scaleSelectedKeyframes(0.5); onRefresh(); }}
                    >
                      <span>0.5x</span>
                    </button>
                    <button
                      type="button"
                      className="tool"
                      title="Scale Selected (2.0x)"
                      onClick={() => { session.scaleSelectedKeyframes(2.0); onRefresh(); }}
                    >
                      <span>2.0x</span>
                    </button>
                    <button
                      type="button"
                      className="tool"
                      title="Delete Selected Keyframes (Delete)"
                      onClick={() => { session.deleteSelectedKeyframes(); onRefresh(); }}
                    >
                      <span>Del</span>
                    </button>
                    <button
                      type="button"
                      className="tool"
                      title="Clear Keyframe Selection"
                      onClick={() => { session.clearKeyframeSelection(); onRefresh(); }}
                    >
                      <span>✕</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="tool"
                    title="Select All Keyframes (Ctrl+A)"
                    onClick={() => { session.selectAllKeyframes(); onRefresh(); }}
                  >
                    <span>Select All</span>
                  </button>
                )}
              </div>

              <div className="dope-toolbar-right">
                {/* Timing & Length controls */}
                <div className="dope-timing-controls" role="group" aria-label="Animation length & timing">
                  <span className="dope-time-readout" title={`Current Frame: ${frame}`}>F{frame}</span>
                  
                  <div className="dope-length-input-group" title="End Frame / Total length in frames (Editable)">
                    <span className="dope-input-label">End:</span>
                    <input
                      type="number"
                      className="dope-frame-input"
                      min={1}
                      max={9999}
                      value={totalFrames}
                      onChange={(e) => {
                        const f = Math.max(1, parseInt(e.target.value, 10) || 1);
                        session.setClipTotalFrames(f, scaleKeysOnResize);
                        onRefresh();
                      }}
                    />
                    <span className="dope-input-unit">f</span>
                  </div>

                  <div className="dope-length-input-group" title="Duration in seconds (Editable)">
                    <input
                      type="number"
                      className="dope-duration-input"
                      min={0.05}
                      step={0.1}
                      value={Number(duration.toFixed(2))}
                      onChange={(e) => {
                        const d = Math.max(0.05, parseFloat(e.target.value) || 0.1);
                        session.setClipDuration(d, scaleKeysOnResize);
                        onRefresh();
                      }}
                    />
                    <span className="dope-input-unit">s</span>
                  </div>

                  <select
                    className="dope-mini-select"
                    title="Frame Rate (FPS)"
                    value={clip?.fps ?? 30}
                    onChange={(e) => {
                      session.setClipFps(Number(e.target.value));
                      onRefresh();
                    }}
                  >
                    <option value={12}>12 FPS</option>
                    <option value={24}>24 FPS</option>
                    <option value={30}>30 FPS</option>
                    <option value={60}>60 FPS</option>
                  </select>

                  <button
                    type="button"
                    className={`tool dope-stretch-btn${scaleKeysOnResize ? ' is-active' : ''}`}
                    title={scaleKeysOnResize ? 'Stretch Keyframes: ON (Keyframes scale proportionally when changing length)' : 'Stretch Keyframes: OFF (Changing length only adjusts the timeline end)'}
                    onClick={() => setScaleKeysOnResize(!scaleKeysOnResize)}
                  >
                    <span>Stretch</span>
                  </button>
                </div>

                <label className="dope-zoom">
                  Zoom
                  <input
                    type="range"
                    min={4}
                    max={28}
                    value={pxPerFrame}
                    onChange={(event) => {
                      session.timelineZoom = Number(event.target.value);
                      onRefresh();
                    }}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Dope Body: Left Track Labels + Right Keyframe Tracks */}
          <div className="dope-body">
            <div className="dope-labels" ref={labelsRef} onScroll={syncTracksScroll}>
              <div className="dope-label dope-ruler-spacer">
                <input
                  type="text"
                  className="dope-bone-filter"
                  placeholder="Filter tracks..."
                  value={boneFilter}
                  onChange={(e) => setBoneFilter(e.target.value)}
                />
                {!showToolbar && (
                  <label className="dope-zoom dope-zoom-inline" title="Timeline Zoom">
                    <input
                      type="range"
                      min={4}
                      max={28}
                      value={pxPerFrame}
                      onChange={(event) => {
                        session.timelineZoom = Number(event.target.value);
                        onRefresh();
                      }}
                    />
                  </label>
                )}
              </div>

              {session.clipSequence.length > 0 && (
                <div className="dope-label dope-seq-label">
                  <BlenderIcon name="action" size={12} />
                  <span>Sequencer</span>
                </div>
              )}

              <div className="dope-label dope-event-label" onClick={handleAddEventAtPlayhead} title="Click to add event at current frame">
                <BlenderIcon name="driver" size={12} />
                <span>Events ({events.length}) +</span>
              </div>

              {boneTree.map(({ bone, depth }) => {
                const isExpanded = expandedBones.has(bone.id);
                const isSelected = session.selectedBoneId === bone.id;
                const track = clip?.tracks.find((t) => t.boneId === bone.id);
                const kfCount = track?.keyframes.length ?? 0;

                return (
                  <div key={bone.id} className="dope-label-group">
                    <button
                      type="button"
                      className={`dope-label${isSelected ? ' is-active' : ''}`}
                      style={{ paddingLeft: 8 + depth * 10 }}
                      onClick={() => {
                        session.selectedBoneId = bone.id;
                        onRefresh();
                      }}
                    >
                      <span
                        className="dope-fold-btn"
                        onClick={(e) => toggleBoneExpanded(bone.id, e)}
                        title={isExpanded ? 'Collapse' : 'Expand channels'}
                      >
                        <BlenderIcon name={isExpanded ? 'tria_down' : 'tria_right'} size={10} />
                      </span>
                      <BlenderIcon name="bone_data" size={12} />
                      <span className="dope-label-text" title={bone.name}>{bone.name}</span>
                      {kfCount > 0 && <span className="dope-summary-key" title={`${kfCount} keys`}>◆</span>}
                    </button>

                    {isExpanded && (
                      <>
                        <div className="dope-label dope-sublabel" style={{ paddingLeft: 24 + depth * 12 }}>
                          <span className="dope-channel-dot loc" /> Position (XYZ)
                        </div>
                        <div className="dope-label dope-sublabel" style={{ paddingLeft: 24 + depth * 12 }}>
                          <span className="dope-channel-dot rot" /> Rotation (Euler)
                        </div>
                        <div className="dope-label dope-sublabel" style={{ paddingLeft: 24 + depth * 12 }}>
                          <span className="dope-channel-dot scale" /> Scale
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Keyframe Track Canvas */}
            <div
              className="dope-tracks-scroll"
              ref={scrollRef}
              onScroll={syncLabelScroll}
            >
              <div className="dope-tracks-area" style={{ width: trackWidth }} onClick={onTrackBackgroundClick}>
                {/* Timeline Ruler */}
                <div className="dope-ruler">
                  {rulerTicks.map(({ frame: f, major }) => (
                    <span
                      key={f}
                      className={`dope-tick${major ? ' is-major' : ''}`}
                      style={{ left: f * pxPerFrame }}
                    >
                      {major ? f : ''}
                    </span>
                  ))}
                </div>

                {/* Sequence Strips Area */}
                {session.clipSequence.length > 0 && (
                  <div className="dope-track dope-seq-track">
                    {session.clipSequence.map((item) => {
                      const left = (item.startTime / duration) * trackWidth;
                      const width = Math.max(20, (item.duration / duration) * trackWidth);
                      const isSelected = session.selectedSequenceItemId === item.id;
                      return (
                        <div
                          key={item.id}
                          className={`dope-seq-strip${isSelected ? ' is-selected' : ''}`}
                          style={{ left, width }}
                          title={`${item.name} (${item.duration.toFixed(2)}s) — Start: ${item.startTime.toFixed(2)}s`}
                          onClick={(e) => {
                            e.stopPropagation();
                            session.selectedSequenceItemId = item.id;
                            session.seekTo(item.startTime);
                            onRefresh();
                          }}
                        >
                          <span className="dope-seq-strip-title">{item.name}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Events Track Area */}
                <div className="dope-track dope-event-track" title="Click to add event at time">
                  {events.map((ev) => {
                    const evX = (ev.time / duration) * trackWidth;
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        className="dope-event-marker"
                        style={{ left: evX }}
                        title={`Event: ${ev.name} @ ${ev.time.toFixed(2)}s (Click to remove/edit)`}
                          onClick={(e) => {
                          e.stopPropagation();
                          session.seekTo(ev.time);
                          setEditingEventId(ev.id);
                          setActiveDockTab('events');
                          onRefresh();
                        }}
                      >
                        <span className="dope-event-flag">!</span>
                        <span className="dope-event-text">{ev.name}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Bone Tracks */}
                {boneTree.map(({ bone }) => {
                  const track = clip?.tracks.find((t) => t.boneId === bone.id);
                  const keyframes = track?.keyframes ?? [];
                  const isExpanded = expandedBones.has(bone.id);
                  const isSelected = session.selectedBoneId === bone.id;

                  return (
                    <div key={bone.id} className="dope-track-group">
                      <div className={`dope-track${isSelected ? ' is-active' : ''}`}>
                        {keyframes.map((kf) => {
                          const keyTime = kf.time;
                          const mode = kf.interpolation ?? 'smooth';
                          const isAtPlayhead = Math.abs(keyTime - time) < (duration / trackWidth) * 4;
                          const isKeySelected = session.isKeyframeSelected(bone.id, keyTime);

                          return (
                            <button
                              key={keyTime}
                              type="button"
                              className={`dope-key${isAtPlayhead ? ' is-at-playhead' : ''}${isKeySelected ? ' is-selected' : ''} dope-key-${mode}`}
                              style={{ left: (keyTime / duration) * trackWidth }}
                              title={`${bone.name} @ ${keyTime.toFixed(2)}s (${mode})`}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (event.shiftKey) {
                                  session.toggleKeyframeSelected(bone.id, keyTime);
                                } else {
                                  session.selectKeyframe(bone.id, keyTime);
                                  session.seekTo(keyTime);
                                  session.selectBone(bone.id);
                                }
                                onRefresh();
                              }}
                              onMouseDown={(event) => {
                                event.stopPropagation();
                                if (!event.shiftKey && !isKeySelected) {
                                  session.selectKeyframe(bone.id, keyTime);
                                }
                                setDrag({ boneId: bone.id, keyTime, startX: event.clientX });
                              }}
                            >
                              <span className="dope-key-diamond" />
                            </button>
                          );
                        })}
                      </div>

                      {isExpanded && (
                        <>
                          <div className="dope-track dope-subtrack">
                            {keyframes.map((kf) => (
                              <div
                                key={`loc-${kf.time}`}
                                className="dope-key-sub dope-key-loc"
                                style={{ left: (kf.time / duration) * trackWidth }}
                              />
                            ))}
                          </div>
                          <div className="dope-track dope-subtrack">
                            {keyframes.map((kf) => (
                              <div
                                key={`rot-${kf.time}`}
                                className="dope-key-sub dope-key-rot"
                                style={{ left: (kf.time / duration) * trackWidth }}
                              />
                            ))}
                          </div>
                          <div className="dope-track dope-subtrack">
                            {keyframes.map((kf) => (
                              <div
                                key={`scale-${kf.time}`}
                                className="dope-key-sub dope-key-scale"
                                style={{ left: (kf.time / duration) * trackWidth }}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Playhead */}
                <div className="dope-playhead" style={{ left: playheadX }}>
                  <span className="dope-playhead-label">{frame}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
