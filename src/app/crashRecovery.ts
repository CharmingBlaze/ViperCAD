import { writeEmergencyAutosave } from '@/app/autosave';

let captureProject: (() => string | null) | null = null;
let projectIsDirtyCapture: (() => boolean) | null = null;
let handlersInstalled = false;

export function registerProjectCapture(
  capture: (() => string | null) | null,
  isDirty?: () => boolean,
): void {
  captureProject = capture;
  projectIsDirtyCapture = capture ? (isDirty ?? null) : null;
}

export function captureOpenProject(): string | null {
  try {
    return captureProject?.() ?? null;
  } catch {
    return null;
  }
}

export function flushCrashAutosave(reason: string): void {
  const project = captureOpenProject();
  if (!project) return;
  writeEmergencyAutosave(project, reason);
}

/** Page hide is a normal close; only snapshot if the project still has unsaved edits. */
export function shouldFlushPageHideAutosave(isDirty?: (() => boolean) | null): boolean {
  if (!isDirty) return true;
  try {
    return !!isDirty();
  } catch {
    return true;
  }
}

export function installCrashHandlers(): void {
  if (handlersInstalled || typeof window === 'undefined') return;
  handlersInstalled = true;
  window.addEventListener('error', () => flushCrashAutosave('Runtime error'));
  window.addEventListener('unhandledrejection', () => flushCrashAutosave('Unhandled rejection'));
  window.addEventListener('pagehide', () => {
    if (!shouldFlushPageHideAutosave(projectIsDirtyCapture)) return;
    flushCrashAutosave('Page hide');
  });
}
