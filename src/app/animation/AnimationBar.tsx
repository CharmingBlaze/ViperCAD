import { useState } from 'react';
import { getActiveClip } from '@/core/rig/RigDocument';
import { clipFrameCount } from '@/core/rig/AnimationLibrary';
import { BlenderIcon } from '@/components/BlenderIcon';
import { pushToast } from '@/app/Toast';
import type { AnimationSession } from './AnimationSession';
import { BonePicker } from './BonePicker';

type Props = {
  session: AnimationSession;
  onRefresh: () => void;
  onRequestTimeline?: () => void;
  timelineOpen?: boolean;
  onToggleTimeline?: () => void;
  clipsOpen?: boolean;
  onToggleClips?: () => void;
  inspectorOpen?: boolean;
  onToggleInspector?: () => void;
};

export function AnimationBar({
  session,
  onRefresh,
  onRequestTimeline,
  timelineOpen = true,
  onToggleTimeline,
  clipsOpen = true,
  onToggleClips,
  inspectorOpen = true,
  onToggleInspector,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const clip = getActiveClip(session.project, session.rigDocument);
  const duration = Math.max(0.1, clip?.duration ?? 1);
  const fps = clip?.fps ?? 24;
  const time = Math.min(session.playbackTime, duration);
  const frame = Math.round(time * fps);
  const totalFrames = clipFrameCount(clip ?? { duration, fps, id: '', name: '', tracks: [] });
  const clips = session.getClips();

  return (
    <div className="rig-anim-bar" role="group" aria-label="Animation transport">
      <div className="rig-bar-group" role="group" aria-label="Active clip selector">
        <select
          className="rig-select-sm anim-clip-select"
          title="Active animation clip"
          value={clip?.id || ''}
          onChange={(e) => {
            session.setActiveClip(e.target.value);
            onRefresh();
          }}
        >
          {clips.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      <span className="bar-sep" aria-hidden />

      <button type="button" className="tool" title="Jump to start" onClick={() => { session.seekTo(0); onRefresh(); }}>
        <BlenderIcon name="rew" size={13} />
      </button>
      <button type="button" className="tool" title="Previous key" onClick={() => { session.jumpToPrevKeyframe(); onRefresh(); }}>
        <BlenderIcon name="prev_keyframe" size={13} />
      </button>
      <button
        type="button"
        className={`tool${session.playing ? ' is-active' : ''}`}
        title={session.playing ? 'Pause' : 'Play'}
        onClick={() => { session.togglePlayback(); onRefresh(); }}
      >
        <BlenderIcon name={session.playing ? 'pause' : 'play'} size={13} />
      </button>
      <button type="button" className="tool" title="Next key" onClick={() => { session.jumpToNextKeyframe(); onRefresh(); }}>
        <BlenderIcon name="next_keyframe" size={13} />
      </button>
      <button type="button" className="tool" title="Jump to end" onClick={() => { session.seekTo(duration); onRefresh(); }}>
        <BlenderIcon name="ff" size={13} />
      </button>

      <div className="anim-length-group" role="group" aria-label="Clip length">
        <span className="rig-anim-readout" title="Current frame">F{frame}</span>
        <span className="anim-length-slash">/</span>
        <button
          type="button"
          className="anim-length-step"
          title="Shorter by 1 frame · Shift: −8"
          disabled={!clip}
          onClick={(event) => {
            const step = event.shiftKey ? 8 : 1;
            session.setClipTotalFrames(Math.max(1, totalFrames - step));
            onRefresh();
          }}
        >
          −
        </button>
        <input
          className="anim-length-input"
          type="number"
          min={1}
          max={9999}
          value={totalFrames}
          disabled={!clip}
          title="Clip length in frames. Type a new end frame."
          aria-label="Clip length in frames"
          onChange={(event) => {
            const next = Math.max(1, parseInt(event.target.value, 10) || 1);
            session.setClipTotalFrames(next);
            onRefresh();
          }}
        />
        <span className="anim-length-unit">f</span>
        <button
          type="button"
          className="anim-length-step"
          title="Longer by 1 frame · Shift: +8"
          disabled={!clip}
          onClick={(event) => {
            const step = event.shiftKey ? 8 : 1;
            session.setClipTotalFrames(totalFrames + step);
            onRefresh();
          }}
        >
          +
        </button>
        <input
          className="anim-length-input anim-length-seconds"
          type="number"
          min={0.05}
          step={0.1}
          value={Number(duration.toFixed(2))}
          disabled={!clip}
          title="Clip length in seconds"
          aria-label="Clip length in seconds"
          onChange={(event) => {
            session.setClipDuration(Math.max(0.05, parseFloat(event.target.value) || 0.1));
            onRefresh();
          }}
        />
        <span className="anim-length-unit">s</span>
      </div>

      <span className="bar-sep" aria-hidden />

      <button
        type="button"
        className="tool anim-key-pose-btn"
        title="Key the current pose on this frame"
        onClick={() => {
          const count = session.keyCurrentPose();
          pushToast(`Pose keyed · Frame ${frame}`, 'success');
          onRefresh();
          return count;
        }}
      >
        <BlenderIcon name="pose_hlt" size={13} />
        <span>Key Pose</span>
      </button>

      <button
        type="button"
        className={`tool anim-auto-key-btn${session.autoKeyframe ? ' is-on' : ''}`}
        title={session.autoKeyframe ? 'Auto Key is on' : 'Auto Key is off'}
        aria-pressed={session.autoKeyframe}
        onClick={() => {
          session.autoKeyframe = !session.autoKeyframe;
          session.keyingMode = session.autoKeyframe ? 'auto' : 'pose';
          onRefresh();
        }}
      >
        <span className="anim-auto-dot" aria-hidden />
        <span>Auto Key</span>
      </button>

      <button
        type="button"
        className={`tool${session.loopPlayback ? ' is-active' : ''}`}
        title={session.loopPlayback ? 'Loop on' : 'Loop off'}
        aria-pressed={session.loopPlayback}
        onClick={() => { session.setLoopPlayback(!session.loopPlayback); onRefresh(); }}
      >
        <span>∞</span>
        <span>Loop</span>
      </button>

      <span className="bar-sep" aria-hidden />

      <div className="anim-picker-wrap">
        <button
          type="button"
          className={`tool${pickerOpen ? ' is-active' : ''}`}
          title="Bone picker"
          aria-pressed={pickerOpen}
          onClick={() => setPickerOpen((open) => !open)}
        >
          <span>Picker</span>
        </button>
        {pickerOpen && (
          <BonePicker
            session={session}
            onRefresh={onRefresh}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>

      <span className="bar-sep" aria-hidden />

      <div className="rig-bar-group" role="group" aria-label="Panel visibility">
        {onToggleClips && (
          <button
            type="button"
            className={`tool${clipsOpen ? ' is-active' : ''}`}
            title={clipsOpen ? 'Hide clips' : 'Show clips'}
            aria-pressed={clipsOpen}
            onClick={onToggleClips}
          >
            <span>Clips</span>
          </button>
        )}
        {onToggleTimeline && (
          <button
            type="button"
            className={`tool${timelineOpen ? ' is-active' : ''}`}
            title={timelineOpen ? 'Hide timeline' : 'Show timeline'}
            aria-pressed={timelineOpen}
            onClick={() => {
              onToggleTimeline();
              if (!timelineOpen) onRequestTimeline?.();
            }}
          >
            <span>Timeline</span>
          </button>
        )}
        {onToggleInspector && (
          <button
            type="button"
            className={`tool${inspectorOpen ? ' is-active' : ''}`}
            title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
            aria-pressed={inspectorOpen}
            onClick={onToggleInspector}
          >
            <span>Inspector</span>
          </button>
        )}
      </div>
    </div>
  );
}
