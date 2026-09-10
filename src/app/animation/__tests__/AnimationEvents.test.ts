import { describe, expect, it } from 'vitest';
import { EditorSession } from '@/core/editor/EditorSession';
import { commitMeshObject } from '@/core/document/ModelDocument';
import { buildBox } from '@/core/mesh/builders/BoxBuilder';
import { AnimationSession } from '@/app/animation/AnimationSession';

describe('Animation Events and Game Controls', () => {
  it('adds, sorts, updates, and removes animation events', () => {
    const editor = new EditorSession();
    editor.ensureDocumentKind('model');
    commitMeshObject(editor.document, buildBox({ width: 1, height: 1, depth: 1 }));
    const session = new AnimationSession(editor);
    session.enterForModel(editor.documentId);
    session.runQuickSetup();

    // Add events out of order
    const ev2 = session.addEvent('hit_frame', 0.5, 'damage=25');
    const ev1 = session.addEvent('footstep_l', 0.1);
    const ev3 = session.addEvent('sound_fx', 0.8, 'whoosh');

    expect(ev1).not.toBeNull();
    expect(ev2).not.toBeNull();
    expect(ev3).not.toBeNull();

    // Events should be sorted by time
    const events = session.getEvents();
    expect(events).toHaveLength(3);
    expect(events[0]!.name).toBe('footstep_l');
    expect(events[1]!.name).toBe('hit_frame');
    expect(events[2]!.name).toBe('sound_fx');

    // Update event
    session.updateEvent(ev1!.id, { name: 'footstep_r', time: 0.15 });
    const updated = session.getEvents();
    expect(updated[0]!.name).toBe('footstep_r');
    expect(updated[0]!.time).toBe(0.15);

    // Remove event
    const removed = session.removeEvent(ev2!.id);
    expect(removed).toBe(true);
    expect(session.getEvents()).toHaveLength(2);
  });

  it('toggles root motion and playback speed', () => {
    const editor = new EditorSession();
    editor.ensureDocumentKind('model');
    commitMeshObject(editor.document, buildBox({ width: 1, height: 1, depth: 1 }));
    const session = new AnimationSession(editor);
    session.enterForModel(editor.documentId);
    session.runQuickSetup();

    expect(session.getRootMotion()).toBe(false);
    session.setRootMotion(true);
    expect(session.getRootMotion()).toBe(true);

    expect(session.playbackSpeed).toBe(1.0);
    session.setPlaybackSpeed(2.0);
    expect(session.playbackSpeed).toBe(2.0);

    // Test speed influence on advancePlayback
    session.playing = true;
    session.playbackTime = 0;
    session.advancePlayback(0.1);
    expect(session.playbackTime).toBeCloseTo(0.2); // 0.1 * 2.0 speed
  });

  it('switches timeline view mode between dopesheet and graph', () => {
    const editor = new EditorSession();
    const session = new AnimationSession(editor);
    expect(session.timelineViewMode).toBe('dopesheet');
    session.setTimelineViewMode('graph');
    expect(session.timelineViewMode).toBe('graph');
    session.setTimelineViewMode('dopesheet');
    expect(session.timelineViewMode).toBe('dopesheet');
  });
});
