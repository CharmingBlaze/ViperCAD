import { writeEmergencyAutosave } from '@/app/autosave';

let captureProject: (() => string | null) | null = null;
let handlersInstalled = false;

export function registerProjectCapture(capture: (() => string | null) | null): void {
  captureProject = capture;
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

export function installCrashHandlers(): void {
  if (handlersInstalled || typeof window === 'undefined') return;
  handlersInstalled = true;
  window.addEventListener('error', () => flushCrashAutosave('Runtime error'));
  window.addEventListener('unhandledrejection', () => flushCrashAutosave('Unhandled rejection'));
  window.addEventListener('pagehide', () => flushCrashAutosave('Page hide'));
}
