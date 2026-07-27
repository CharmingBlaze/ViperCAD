import type { RigSession } from '../RigSession';
import { getActiveClip } from '@/core/rig/RigDocument';
import { keyframeTimesForBone } from '@/core/rig/keyframes';
import { clipFrameCount } from '@/core/rig/AnimationLibrary';

type Props = {
  session: RigSession;
  onRefresh: () => void;
};

export function TimelinePanel({ session, onRefresh }: Props) {
  const doc = session.rigDocument;
  const clip = getActiveClip(session.project, doc);
  const duration = Math.max(0.1, clip?.duration ?? 1);
  const fps = clip?.fps ?? 24;
  const time = Math.min(session.playbackTime, duration);
  const progress = duration > 0 ? (time / duration) * 100 : 0;
  const frame = Math.round(time * fps);
  const totalFrames = clipFrameCount(clip ?? { duration, fps, id: '', name: '', tracks: [] });
  const boneKeys = session.selectedBoneId && clip
    ? keyframeTimesForBone(clip, session.selectedBoneId)
    : [];

  return (
    <footer className="rig-footer">
      <div className="rig-timeline-head">
        <h3>Timeline · {clip?.name ?? 'No clip'}</h3>
        <div className="rig-transport">
          <button
            type="button"
            className="rig-transport-btn"
            title="Previous frame"
            onClick={() => { session.stepFrame(-1); onRefresh(); }}
          >
            ‹
          </button>
          <button
            type="button"
            className={`rig-transport-btn${session.playing ? ' is-active' : ''}`}
            title={session.playing ? 'Pause' : 'Play'}
            onClick={() => {
              session.playing = !session.playing;
              onRefresh();
            }}
          >
            {session.playing ? '❚❚' : '▶'}
          </button>
          <button
            type="button"
            className="rig-transport-btn"
            title="Next frame"
            onClick={() => { session.stepFrame(1); onRefresh(); }}
          >
            ›
          </button>
          <button
            type="button"
            className="rig-transport-btn"
            title="Go to start"
            onClick={() => {
              session.playbackTime = 0;
              session.playing = false;
              onRefresh();
            }}
          >
            ⏮
          </button>
          <button
            type="button"
            className="rig-transport-btn"
            title="Keyframe selected bone"
            disabled={!session.selectedBoneId}
            onClick={() => {
              if (session.insertKeyframeForSelectedBone()) onRefresh();
            }}
          >
            ◆
          </button>
          <button
            type="button"
            className="rig-transport-btn"
            title="Delete keyframe at playhead"
            disabled={!session.selectedBoneId}
            onClick={() => {
              if (session.removeKeyframeForSelectedBone()) onRefresh();
            }}
          >
            ◇
          </button>
        </div>
        <span className="rig-time-readout">
          F{frame} / F{totalFrames} · {time.toFixed(2)}s
        </span>
      </div>

      <div className="rig-track-wrap">
        <div className="rig-track-fill" style={{ width: `${progress}%` }} />
        {boneKeys.map((keyTime) => (
          <span
            key={keyTime}
            className="rig-keyframe"
            style={{ left: `${(keyTime / duration) * 100}%` }}
          />
        ))}
        <span className="rig-playhead" style={{ left: `${progress}%` }} />
        <input
          className="rig-track-scrubber"
          type="range"
          min={0}
          max={duration}
          step={1 / fps}
          value={time}
          onChange={(event) => {
            session.playbackTime = Number(event.target.value);
            session.playing = false;
            onRefresh();
          }}
        />
      </div>

      <div className="rig-timeline-meta">
        <span>
          {session.selectedBoneId
            ? `${boneKeys.length} keyframe${boneKeys.length === 1 ? '' : 's'} on selected bone`
            : 'Select a bone to keyframe'}
        </span>
        <label className="rig-duration-field">
          Duration
          <input
            className="rig-input"
            type="number"
            min={0.1}
            step={0.1}
            value={duration}
            onChange={(event) => {
              if (!clip) return;
              clip.duration = Math.max(0.1, Number(event.target.value));
              session.project.dirty = true;
              doc.dirty = true;
              onRefresh();
            }}
          />
          s
        </label>
        <label className="rig-duration-field">
          FPS
          <input
            className="rig-input"
            type="number"
            min={1}
            max={120}
            step={1}
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
    </footer>
  );
}
