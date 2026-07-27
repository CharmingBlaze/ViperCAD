import { getActiveClip } from '@/core/rig/RigDocument';
import { clipFrameCount } from '@/core/rig/AnimationLibrary';
import type { RigSession } from '../RigSession';

type Props = {
  session: RigSession;
  onRefresh: () => void;
};

export function RigAnimationBar({ session, onRefresh }: Props) {
  const clip = getActiveClip(session.project, session.rigDocument);
  const duration = Math.max(0.1, clip?.duration ?? 1);
  const fps = clip?.fps ?? 24;
  const time = Math.min(session.playbackTime, duration);
  const frame = Math.round(time * fps);
  const totalFrames = clipFrameCount(clip ?? { duration, fps, id: '', name: '', tracks: [] });

  return (
    <div className="shell-switch rig-anim-bar" role="group" aria-label="Animation transport">
      <button
        type="button"
        className="tool"
        title="Previous frame"
        onClick={() => { session.stepFrame(-1); onRefresh(); }}
      >
        ‹
      </button>
      <button
        type="button"
        className={`tool${session.playing ? ' is-active' : ''}`}
        title={session.playing ? 'Pause' : 'Play'}
        onClick={() => { session.playing = !session.playing; onRefresh(); }}
      >
        {session.playing ? '❚❚' : '▶'}
      </button>
      <button
        type="button"
        className="tool"
        title="Next frame"
        onClick={() => { session.stepFrame(1); onRefresh(); }}
      >
        ›
      </button>
      <button
        type="button"
        className="tool"
        title="Go to start"
        onClick={() => { session.seekTo(0); onRefresh(); }}
      >
        ⏮
      </button>
      <button
        type="button"
        className="tool"
        title="Keyframe selected bone"
        disabled={!session.selectedBoneId}
        onClick={() => { session.insertKeyframeForSelectedBone(); onRefresh(); }}
      >
        ◆
      </button>
      <button
        type="button"
        className="tool"
        title="Keyframe all bones"
        onClick={() => { session.keyframeAllBones(); onRefresh(); }}
      >
        ◆ All
      </button>
      <span className="rig-anim-readout">
        F{frame}/{totalFrames}
      </span>
      <input
        className="rig-anim-scrub"
        type="range"
        min={0}
        max={duration}
        step={1 / fps}
        value={time}
        title="Scrub timeline"
        onChange={(event) => {
          session.seekTo(Number(event.target.value));
          onRefresh();
        }}
      />
      <label className="rig-anim-loop">
        <input
          type="checkbox"
          checked={session.loopPlayback}
          onChange={(event) => { session.loopPlayback = event.target.checked; onRefresh(); }}
        />
        Loop
      </label>
    </div>
  );
}
