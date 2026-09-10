import { useCallback, useEffect, useRef, useState } from 'react';
import { getActiveClip, readRigDocumentSettings } from '@/core/rig/RigDocument';
import { clipFrameCount } from '@/core/rig/AnimationLibrary';
import type { AnimationSession } from './AnimationSession';
import type { BoneAnimationTrack } from '@/core/rig/types';

type Props = {
  session: AnimationSession;
  onRefresh: () => void;
};

type ChannelKind = 'pos_x' | 'pos_y' | 'pos_z' | 'rot_x' | 'rot_y' | 'rot_z';

const CHANNEL_DEFS: { id: ChannelKind; name: string; color: string; group: 'Position' | 'Rotation' }[] = [
  { id: 'pos_x', name: 'Pos X', color: '#e74c3c', group: 'Position' },
  { id: 'pos_y', name: 'Pos Y', color: '#2ecc71', group: 'Position' },
  { id: 'pos_z', name: 'Pos Z', color: '#3498db', group: 'Position' },
  { id: 'rot_x', name: 'Rot X', color: '#e67e22', group: 'Rotation' },
  { id: 'rot_y', name: 'Rot Y', color: '#1abc9c', group: 'Rotation' },
  { id: 'rot_z', name: 'Rot Z', color: '#9b59b6', group: 'Rotation' },
];

export function GraphEditor({ session, onRefresh }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [activeChannels, setActiveChannels] = useState<Set<ChannelKind>>(
    new Set(['rot_x', 'rot_y', 'rot_z']),
  );

  const [dragPoint, setDragPoint] = useState<{
    keyIndex: number;
    channelId: ChannelKind;
    startX: number;
    startY: number;
    initialVal: number;
    initialTime: number;
  } | null>(null);

  const clip = getActiveClip(session.project, session.rigDocument);
  const duration = Math.max(0.1, clip?.duration ?? 1);
  const fps = clip?.fps ?? 24;
  const time = Math.min(session.playbackTime, duration);
  const totalFrames = clipFrameCount(clip ?? { duration, fps, id: '', name: '', tracks: [] });

  const selectedBoneId = session.selectedBoneId;
  const track: BoneAnimationTrack | undefined = clip?.tracks.find((t) => t.boneId === selectedBoneId);

  const toggleChannel = (ch: ChannelKind) => {
    setActiveChannels((prev) => {
      const next = new Set(prev);
      if (next.has(ch)) next.delete(ch);
      else next.add(ch);
      return next;
    });
  };

  const selectRotationOnly = () => {
    setActiveChannels(new Set(['rot_x', 'rot_y', 'rot_z']));
  };

  const selectPositionOnly = () => {
    setActiveChannels(new Set(['pos_x', 'pos_y', 'pos_z']));
  };

  const selectAllChannels = () => {
    setActiveChannels(new Set(['pos_x', 'pos_y', 'pos_z', 'rot_x', 'rot_y', 'rot_z']));
  };

  const getChannelVal = (kf: any, ch: ChannelKind): number => {
    switch (ch) {
      case 'pos_x': return kf.value.position.x;
      case 'pos_y': return kf.value.position.y;
      case 'pos_z': return kf.value.position.z;
      case 'rot_x': return kf.value.rotation.x;
      case 'rot_y': return kf.value.rotation.y;
      case 'rot_z': return kf.value.rotation.z;
    }
  };

  const setChannelVal = (kf: any, ch: ChannelKind, val: number): void => {
    switch (ch) {
      case 'pos_x': kf.value.position.x = val; break;
      case 'pos_y': kf.value.position.y = val; break;
      case 'pos_z': kf.value.position.z = val; break;
      case 'rot_x': kf.value.rotation.x = val; break;
      case 'rot_y': kf.value.rotation.y = val; break;
      case 'rot_z': kf.value.rotation.z = val; break;
    }
  };

  const drawGraph = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return;

    // Background
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, width, height);

    // Padding & plot bounds
    const padLeft = 50;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 30;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    if (plotW <= 0 || plotH <= 0) return;

    // Time to X conversion
    const timeToX = (t: number) => padLeft + (Math.max(0, Math.min(duration, t)) / duration) * plotW;

    // Determine value range (min / max across active channels)
    let minVal = -1.0;
    let maxVal = 1.0;
    if (track && track.keyframes.length > 0) {
      let foundValues = false;
      for (const kf of track.keyframes) {
        for (const def of CHANNEL_DEFS) {
          if (activeChannels.has(def.id)) {
            const v = getChannelVal(kf, def.id);
            minVal = Math.min(minVal, v);
            maxVal = Math.max(maxVal, v);
            foundValues = true;
          }
        }
      }
      if (!foundValues) {
        minVal = -1.0;
        maxVal = 1.0;
      }
    }

    // Add margin to value range
    const valSpan = Math.max(0.2, maxVal - minVal);
    const yMin = minVal - valSpan * 0.15;
    const yMax = maxVal + valSpan * 0.15;
    const valToY = (v: number) => padTop + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    // Draw horizontal grid lines & labels
    ctx.font = '10px "IBM Plex Sans", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#9c9c9c';
    ctx.strokeStyle = '#2d2d2d';
    ctx.lineWidth = 1;

    const gridSteps = 6;
    for (let i = 0; i <= gridSteps; i += 1) {
      const v = yMin + (i / gridSteps) * (yMax - yMin);
      const y = valToY(v);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();
      ctx.fillText(v.toFixed(2), padLeft - 6, y);
    }

    // Zero-axis indicator
    if (yMin <= 0 && yMax >= 0) {
      const zeroY = valToY(0);
      ctx.strokeStyle = '#444444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, zeroY);
      ctx.lineTo(padLeft + plotW, zeroY);
      ctx.stroke();
    }

    // Draw vertical time/frame grid lines & labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const frameStep = totalFrames > 60 ? 10 : 5;
    for (let f = 0; f <= totalFrames; f += frameStep) {
      const t = f / fps;
      const x = timeToX(t);
      ctx.strokeStyle = f === 0 ? '#383838' : '#282828';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();
      ctx.fillText(`F${f}`, x, padTop + plotH + 6);
    }

    // Draw curves for active channels
    if (track && track.keyframes.length > 0) {
      const keyframes = [...track.keyframes].sort((a, b) => a.time - b.time);

      for (const def of CHANNEL_DEFS) {
        if (!activeChannels.has(def.id)) continue;

        ctx.strokeStyle = def.color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        const samples = Math.max(100, Math.floor(plotW / 2));
        for (let s = 0; s <= samples; s += 1) {
          const t = (s / samples) * duration;
          const x = timeToX(t);

          // Evaluate curve at time t
          let val = 0;
          if (keyframes.length === 1) {
            val = getChannelVal(keyframes[0], def.id);
          } else {
            for (let k = 0; k < keyframes.length; k += 1) {
              const kA = keyframes[k]!;
              const kB = keyframes[k + 1];
              if (!kB || (t >= kA.time && t <= kB.time)) {
                if (!kB) {
                  val = getChannelVal(kA, def.id);
                } else {
                  const span = Math.max(1e-4, kB.time - kA.time);
                  const progress = Math.max(0, Math.min(1, (t - kA.time) / span));
                  const vA = getChannelVal(kA, def.id);
                  const vB = getChannelVal(kB, def.id);
                  const mode = kA.interpolation ?? 'smooth';
                  if (mode === 'step') {
                    val = progress < 1 ? vA : vB;
                  } else if (mode === 'linear') {
                    val = vA + (vB - vA) * progress;
                  } else {
                    const smoothProgress = progress * progress * (3 - 2 * progress);
                    val = vA + (vB - vA) * smoothProgress;
                  }
                }
                break;
              }
            }
          }

          const y = valToY(val);
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Draw keyframe point diamonds
        for (const kf of keyframes) {
          const kx = timeToX(kf.time);
          const ky = valToY(getChannelVal(kf, def.id));
          const isCurrent = Math.abs(kf.time - time) < (1 / fps) * 0.5;

          ctx.fillStyle = isCurrent ? '#ffffff' : def.color;
          ctx.strokeStyle = '#1e1e1e';
          ctx.lineWidth = 1.5;

          ctx.beginPath();
          ctx.moveTo(kx, ky - 5);
          ctx.lineTo(kx + 5, ky);
          ctx.lineTo(kx, ky + 5);
          ctx.lineTo(kx - 5, ky);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // Playhead vertical line
    const playheadX = timeToX(time);
    ctx.strokeStyle = '#1473e6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, padTop);
    ctx.lineTo(playheadX, padTop + plotH);
    ctx.stroke();

    // Playhead head tag
    ctx.fillStyle = '#1473e6';
    ctx.beginPath();
    ctx.moveTo(playheadX - 6, padTop - 12);
    ctx.lineTo(playheadX + 6, padTop - 12);
    ctx.lineTo(playheadX + 6, padTop - 4);
    ctx.lineTo(playheadX, padTop);
    ctx.lineTo(playheadX - 6, padTop - 4);
    ctx.closePath();
    ctx.fill();
  }, [activeChannels, duration, fps, time, totalFrames, track]);

  // Resize canvas to match container bounds
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        canvas.width = Math.floor(entry.contentRect.width);
        canvas.height = Math.floor(entry.contentRect.height);
        drawGraph();
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [drawGraph]);

  // Redraw whenever parameters change
  useEffect(() => {
    drawGraph();
  }, [drawGraph]);

  // Interactive mouse drag on curve points
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !track || track.keyframes.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const padLeft = 50;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 30;
    const plotW = canvas.width - padLeft - padRight;
    const plotH = canvas.height - padTop - padBottom;
    if (plotW <= 0 || plotH <= 0) return;

    // Check if clicked near any keyframe point
    let minVal = -1.0;
    let maxVal = 1.0;
    for (const kf of track.keyframes) {
      for (const def of CHANNEL_DEFS) {
        if (activeChannels.has(def.id)) {
          const v = getChannelVal(kf, def.id);
          minVal = Math.min(minVal, v);
          maxVal = Math.max(maxVal, v);
        }
      }
    }
    const valSpan = Math.max(0.2, maxVal - minVal);
    const yMin = minVal - valSpan * 0.15;
    const yMax = maxVal + valSpan * 0.15;

    for (let i = 0; i < track.keyframes.length; i++) {
      const kf = track.keyframes[i]!;
      const kx = padLeft + (kf.time / duration) * plotW;
      for (const def of CHANNEL_DEFS) {
        if (!activeChannels.has(def.id)) continue;
        const v = getChannelVal(kf, def.id);
        const ky = padTop + (1 - (v - yMin) / (yMax - yMin)) * plotH;
        if (Math.hypot(clickX - kx, clickY - ky) < 10) {
          setDragPoint({
            keyIndex: i,
            channelId: def.id,
            startX: e.clientX,
            startY: e.clientY,
            initialVal: v,
            initialTime: kf.time,
          });
          session.seekTo(kf.time);
          onRefresh();
          return;
        }
      }
    }

    // Otherwise scrub playhead
    const ratio = Math.max(0, Math.min(1, (clickX - padLeft) / plotW));
    session.seekTo(ratio * duration);
    onRefresh();
  };

  useEffect(() => {
    if (!dragPoint || !track) return;
    const onMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const padTop = 20;
      const padBottom = 30;
      const plotH = canvas.height - padTop - padBottom;
      if (plotH <= 0) return;

      const deltaY = e.clientY - dragPoint.startY;
      const valDelta = -(deltaY / plotH) * 2.0;
      const kf = track.keyframes[dragPoint.keyIndex];
      if (kf) {
        setChannelVal(kf, dragPoint.channelId, dragPoint.initialVal + valDelta);
        session.markDirty();
        drawGraph();
      }
    };
    const onUp = () => {
      setDragPoint(null);
      onRefresh();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragPoint, track, session, drawGraph, onRefresh]);

  return (
    <div className="graph-editor" ref={containerRef}>
      <header className="graph-header">
        <div className="graph-channel-list">
          <span className="graph-bone-title">
            {selectedBoneId
              ? (() => {
                  const settings = readRigDocumentSettings(session.rigDocument);
                  const armature = settings.armatureId ? session.project.armatures.get(settings.armatureId) : null;
                  return armature?.bones.get(selectedBoneId)?.name ?? 'Bone';
                })()
              : 'Select a bone to view curves'}
          </span>

          <div className="rig-bar-group" role="group" aria-label="Channel Presets">
            <button
              type="button"
              className="tool"
              onClick={selectAllChannels}
              title="Show all channels"
            >
              <span>All</span>
            </button>
            <button
              type="button"
              className="tool"
              onClick={selectRotationOnly}
              title="Show rotation channels only"
            >
              <span>Rot</span>
            </button>
            <button
              type="button"
              className="tool"
              onClick={selectPositionOnly}
              title="Show position channels only"
            >
              <span>Pos</span>
            </button>
          </div>

          <span className="bar-sep" aria-hidden />

          {CHANNEL_DEFS.map((ch) => (
            <button
              key={ch.id}
              type="button"
              className={`tool graph-channel-btn${activeChannels.has(ch.id) ? ' is-active' : ''}`}
              style={{ borderLeft: `3px solid ${ch.color}` }}
              onClick={() => toggleChannel(ch.id)}
              title={`Toggle ${ch.name}`}
            >
              <span>{ch.name}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="graph-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="graph-canvas"
          onMouseDown={handleMouseDown}
        />
      </div>
    </div>
  );
}
