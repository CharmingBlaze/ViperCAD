import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildBoneTree } from '@/core/rig/boneTree';
import { getActiveClip, readRigDocumentSettings } from '@/core/rig/RigDocument';
import { clipFrameCount } from '@/core/rig/AnimationLibrary';
import { keyframeTimesForBone } from '@/core/rig/keyframes';
import type { BoneId } from '@/core/rig/types';
import type { RigSession } from '../RigSession';

type Props = {
  session: RigSession;
  onRefresh: () => void;
  showToolbar?: boolean;
};

type DragState = {
  boneId: BoneId;
  keyTime: number;
  startX: number;
};

export function DopeSheet({ session, onRefresh, showToolbar = true }: Props) {
  const doc = session.rigDocument;
  const clip = getActiveClip(session.project, doc);
  const settings = readRigDocumentSettings(doc);
  const armature = settings.armatureId ? session.project.armatures.get(settings.armatureId) : null;
  const boneTree = armature ? buildBoneTree(armature) : [];
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

  const rulerTicks = useMemo(() => {
    const ticks: { frame: number; major: boolean }[] = [];
    const step = pxPerFrame < 6 ? 5 : pxPerFrame < 12 ? 2 : 1;
    for (let f = 0; f <= totalFrames; f += step) {
      ticks.push({ frame: f, major: f % (step * 5) === 0 || step === 1 });
    }
    return ticks;
  }, [totalFrames, pxPerFrame]);

  const syncLabelScroll = () => {
    if (scrollRef.current && labelsRef.current) {
      labelsRef.current.scrollTop = scrollRef.current.scrollTop;
    }
  };

  useEffect(() => {
    if (!drag || !clip) return;
    const onMove = (event: MouseEvent) => {
      const deltaFrames = Math.round((event.clientX - drag.startX) / pxPerFrame);
      const newTime = Math.max(0, Math.min(duration, drag.keyTime + (deltaFrames / fps)));
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

  const seekFromClientX = useCallback((clientX: number, trackLeft: number) => {
    const x = clientX - trackLeft;
    const ratio = Math.max(0, Math.min(1, x / trackWidth));
    session.seekTo(ratio * duration);
    onRefresh();
  }, [duration, onRefresh, session, trackWidth]);

  const onTrackBackgroundClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.dope-key')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    seekFromClientX(event.clientX, rect.left);
  };

  return (
    <div className="dope-sheet" role="region" aria-label="Dope sheet">
      {showToolbar && (
      <div className="dope-toolbar">
        <div className="dope-toolbar-left">
          <span className="dope-clip-name">{clip?.name ?? 'No clip'}</span>
          <div className="rig-transport">
            <button type="button" className="rig-transport-btn" title="Previous frame" onClick={() => { session.stepFrame(-1); onRefresh(); }}>‹</button>
            <button
              type="button"
              className={`rig-transport-btn${session.playing ? ' is-active' : ''}`}
              onClick={() => { session.playing = !session.playing; onRefresh(); }}
            >
              {session.playing ? '❚❚' : '▶'}
            </button>
            <button type="button" className="rig-transport-btn" title="Next frame" onClick={() => { session.stepFrame(1); onRefresh(); }}>›</button>
            <button type="button" className="rig-transport-btn" title="Start" onClick={() => { session.seekTo(0); onRefresh(); }}>⏮</button>
            <button type="button" className="rig-transport-btn" title="End" onClick={() => { session.seekTo(duration); onRefresh(); }}>⏭</button>
            <button type="button" className="rig-transport-btn" title="Keyframe selected" disabled={!session.selectedBoneId} onClick={() => { session.insertKeyframeForSelectedBone(); onRefresh(); }}>◆</button>
            <button type="button" className="rig-transport-btn" title="Delete key at playhead" disabled={!session.selectedBoneId} onClick={() => { session.removeKeyframeForSelectedBone(); onRefresh(); }}>◇</button>
            <button type="button" className="rig-transport-btn dope-btn-wide" title="Keyframe all bones" onClick={() => { session.keyframeAllBones(); onRefresh(); }}>◆ All</button>
          </div>
        </div>
        <div className="dope-toolbar-right">
          <span className="dope-time-readout">F{frame} / F{totalFrames} · {time.toFixed(2)}s</span>
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
          <label className="rig-check dope-loop">
            <input type="checkbox" checked={session.loopPlayback} onChange={(event) => { session.loopPlayback = event.target.checked; onRefresh(); }} />
            Loop
          </label>
          <label className="dope-duration-field">
            Dur
            <input
              className="rig-input"
              type="number"
              min={0.1}
              step={0.1}
              value={Number(duration.toFixed(2))}
              onChange={(event) => {
                if (!clip) return;
                clip.duration = Math.max(0.1, Number(event.target.value));
                session.project.dirty = true;
                doc.dirty = true;
                onRefresh();
              }}
            />
          </label>
          <label className="dope-duration-field">
            FPS
            <input
              className="rig-input"
              type="number"
              min={1}
              max={120}
              value={fps}
              onChange={(event) => {
                if (!clip) return;
                clip.fps = Math.max(1, Number(event.target.value));
                session.project.dirty = true;
                doc.dirty = true;
                onRefresh();
              }}
            />
          </label>
        </div>
      </div>
      )}

      <div className="dope-body">
        <div className="dope-label-col">
          <div className="dope-label-header">Bone</div>
          <div className="dope-labels" ref={labelsRef}>
            {boneTree.map(({ bone, depth }) => (
              <button
                key={bone.id}
                type="button"
                className={`dope-label${session.selectedBoneId === bone.id ? ' is-active' : ''}`}
                style={{ paddingLeft: `${8 + depth * 10}px` }}
                onClick={() => { session.selectBone(bone.id); onRefresh(); }}
              >
                {bone.name}
              </button>
            ))}
            {!boneTree.length && <p className="rig-hint dope-empty">No bones</p>}
          </div>
        </div>

        <div
          className="dope-scroll"
          ref={scrollRef}
          onScroll={syncLabelScroll}
        >
          <div className="dope-tracks-area" style={{ width: trackWidth }} onClick={onTrackBackgroundClick}>
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

            {boneTree.map(({ bone }) => {
              const keys = clip ? keyframeTimesForBone(clip, bone.id) : [];
              return (
                <div key={bone.id} className={`dope-track${session.selectedBoneId === bone.id ? ' is-active' : ''}`}>
                  {keys.map((keyTime) => (
                    <button
                      key={keyTime}
                      type="button"
                      className={`dope-key${Math.abs(keyTime - time) < 1e-4 ? ' is-at-playhead' : ''}`}
                      style={{ left: (keyTime / duration) * trackWidth }}
                      title={`${bone.name} @ ${keyTime.toFixed(2)}s`}
                      onClick={(event) => {
                        event.stopPropagation();
                        session.seekTo(keyTime);
                        session.selectBone(bone.id);
                        onRefresh();
                      }}
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        setDrag({ boneId: bone.id, keyTime, startX: event.clientX });
                      }}
                    />
                  ))}
                </div>
              );
            })}

            <div className="dope-playhead" style={{ left: playheadX }} />
          </div>
        </div>
      </div>
    </div>
  );
}
