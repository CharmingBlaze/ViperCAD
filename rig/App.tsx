import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEmptyProject } from '@/core/document/ViperProject';
import { deserializeViperProject } from '@/core/persistence/ProjectSerializer';
import { parseLinkSearchParams } from '@/core/link/ViperLink';
import { getActiveClip } from '@/core/rig/RigDocument';
import { RigQuadViewport } from './components/RigQuadViewport';
import { RigViewportOverlay } from './components/RigViewportOverlay';
import { RigSidebar } from './components/RigSidebar';
import { RigAnimationBar } from './components/RigAnimationBar';
import { DopeSheet } from './components/DopeSheet';
import { RigFloatingOutliner } from './components/RigFloatingOutliner';
import { RigSession, resolveInitialRigDocumentId } from './RigSession';
import { RIG_VIEW_LABELS, RigWorkspace } from './RigWorkspace';
import './App.css';

const TIMELINE_HEIGHT_MIN = 120;
const TIMELINE_HEIGHT_DEFAULT = 240;
const TIMELINE_HEIGHT_MAX_RATIO = 0.55;

function clampTimelineHeight(height: number, containerHeight: number): number {
  const max = Math.max(TIMELINE_HEIGHT_MIN, containerHeight * TIMELINE_HEIGHT_MAX_RATIO);
  return Math.min(max, Math.max(TIMELINE_HEIGHT_MIN, height));
}

export default function RigApp() {
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const params = useMemo(() => parseLinkSearchParams(window.location.search), []);
  const sessionRef = useRef<RigSession | null>(null);
  const autoSetupDone = useRef(false);
  const workspace = useMemo(() => new RigWorkspace(), []);

  const session = useMemo(() => {
    sessionRef.current?.destroy();
    autoSetupDone.current = false;
    let project = createEmptyProject('Linked Project');
    const cached = sessionStorage.getItem(`viper-project-${params.projectId}`);
    if (cached && cached.startsWith('{') && cached.includes('"format"')) {
      try {
        project = deserializeViperProject(cached).project;
      } catch {
        // wait for live sync
      }
    }
    const rigDocumentId = resolveInitialRigDocumentId(project, params.rigDocumentId);
    const next = new RigSession(project, rigDocumentId);
    sessionRef.current = next;
    return next;
  }, [params.projectId, params.rigDocumentId]);

  const [timelineOpen, setTimelineOpen] = useState(true);
  const [timelineHeight, setTimelineHeight] = useState(TIMELINE_HEIGHT_DEFAULT);
  const [outlinerOpen, setOutlinerOpen] = useState(true);
  const workspaceStackRef = useRef<HTMLDivElement>(null);
  const timelineDragRef = useRef(false);

  useEffect(() => () => session.destroy(), [session]);
  useEffect(() => session.subscribe(refresh), [session]);
  useEffect(() => workspace.subscribe(refresh), [workspace]);

  useEffect(() => {
    if (autoSetupDone.current) return;
    const status = session.getSetupStatus();
    if (status.meshObjectCount > 0 && status.skinBindingCount === 0) {
      session.runQuickSetup(false);
      autoSetupDone.current = true;
      refresh();
    }
  }, [session]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (!session.playing) {
        last = now;
        return;
      }
      const clip = getActiveClip(session.project, session.rigDocument);
      const duration = clip?.duration ?? 1;
      session.playbackTime += (now - last) / 1000;
      if (session.playbackTime >= duration) {
        session.playbackTime = session.loopPlayback ? session.playbackTime % duration : duration;
        if (!session.loopPlayback) session.playing = false;
      }
      last = now;
      refresh();
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [session]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        workspace.handleTab();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [workspace]);

  useEffect(() => {
    if (!timelineOpen) return;
    const onMove = (event: PointerEvent) => {
      if (!timelineDragRef.current) return;
      const stack = workspaceStackRef.current;
      if (!stack) return;
      const rect = stack.getBoundingClientRect();
      setTimelineHeight(clampTimelineHeight(rect.bottom - event.clientY, rect.height));
    };
    const onUp = () => { timelineDragRef.current = false; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [timelineOpen]);

  useEffect(() => {
    const stack = workspaceStackRef.current;
    if (!stack || !timelineOpen) return;
    const clamp = () => {
      setTimelineHeight((height) => clampTimelineHeight(height, stack.clientHeight));
    };
    const observer = new ResizeObserver(clamp);
    observer.observe(stack);
    return () => observer.disconnect();
  }, [timelineOpen]);

  const status = session.getSetupStatus();
  const activePane = workspace.maximizedViewportId ?? workspace.activeViewportId;
  const viewHint = workspace.layoutMode === 'maximized'
    ? `${RIG_VIEW_LABELS[activePane as keyof typeof RIG_VIEW_LABELS] ?? 'View'} · Tab restore`
    : 'Camera · Perspective · Tab maximize';

  return (
    <div className="app">
      <header className="bar bar-slim">
        <div className="bar-left">
          <span className="mark">ViperRig</span>
          <span className="bar-sep" aria-hidden />
          <div className="shell-switch" role="group" aria-label="Edit mode">
            {(['edit', 'pose', 'weight'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`tool${session.editMode === mode ? ' is-active' : ''}`}
                onClick={() => { session.editMode = mode; refresh(); }}
              >
                {mode === 'edit' ? 'Edit bones' : mode === 'pose' ? 'Pose' : 'Weights'}
              </button>
            ))}
          </div>
          <span className="bar-sep" aria-hidden />
          <RigAnimationBar session={session} onRefresh={refresh} />
        </div>
        <div className="bar-right">
          <span className="rig-link-pill">
            <span className="rig-link-dot" aria-hidden />
            {status.sourceModelName ?? 'ViperCAD'}
          </span>
          <button type="button" className="tool" onClick={() => setOutlinerOpen((v) => !v)}>
            Outliner
          </button>
          <button type="button" className="tool" onClick={() => setTimelineOpen((v) => !v)}>
            Timeline
          </button>
          <button type="button" className="tool" onClick={() => session.pushToCad()}>
            Sync
          </button>
          <span className="meta dim">{viewHint}</span>
        </div>
      </header>

      <main className="workspace rig-workspace">
        <div className="rig-workspace-stack" ref={workspaceStackRef}>
          <div className="rig-workspace-upper">
            <div className="workspace-main rig-workspace-main">
              <RigQuadViewport session={session} workspace={workspace} onLayoutChange={refresh} />
              <RigViewportOverlay
                session={session}
                onQuickSetup={() => {
                  session.runQuickSetup(true);
                  refresh();
                }}
              />
            </div>
            <RigSidebar session={session} onRefresh={refresh} />
          </div>

          {timelineOpen && (
            <>
              <div
                className="divider divider-h rig-timeline-divider"
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize dope sheet"
                onPointerDown={() => { timelineDragRef.current = true; }}
              />
              <section
                className="rig-timeline-dock"
                style={{ height: timelineHeight }}
                aria-label="Dope sheet"
              >
                <DopeSheet session={session} onRefresh={refresh} showToolbar />
              </section>
            </>
          )}
        </div>
      </main>

      <footer className="status">
        <span>{RIG_VIEW_LABELS[activePane as keyof typeof RIG_VIEW_LABELS] ?? 'View'}</span>
        <span>
          {session.editMode}
          {' · '}
          {session.selectedBoneId ? 'bone selected' : session.selectedObjectId ? 'object selected' : 'nothing selected'}
          {' · '}
          F{Math.round(session.playbackTime * (getActiveClip(session.project, session.rigDocument)?.fps ?? 24))}
        </span>
      </footer>

      {outlinerOpen && (
        <RigFloatingOutliner
          session={session}
          workspace={workspace}
          onClose={() => setOutlinerOpen(false)}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}
