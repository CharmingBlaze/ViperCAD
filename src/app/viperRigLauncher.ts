import type { ViperProject } from '@/core/document/types';
import { deserializeViperProject, serializeViperProject } from '@/core/persistence/ProjectSerializer';
import { ViperLink } from '@/core/link/ViperLink';

let linkHost: ViperLink | null = null;
let rigWindow: Window | null = null;

export function getViperLinkHost(): ViperLink {
  if (!linkHost) linkHost = new ViperLink('vipercad');
  return linkHost;
}

export function buildViperRigUrl(projectId: string, rigDocumentId: string | null): string {
  const params = new URLSearchParams({ projectId });
  if (rigDocumentId) params.set('rigDocumentId', rigDocumentId);
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/rig/?${params.toString()}`;
}

export function launchViperRig(project: ViperProject, rigDocumentId: string | null): Window | null {
  const link = getViperLinkHost();
  link.connect(project.id);
  syncProjectToRig(project, rigDocumentId);
  const url = buildViperRigUrl(project.id, rigDocumentId);
  if (rigWindow && !rigWindow.closed) {
    rigWindow.focus();
    rigWindow.location.href = url;
  } else {
    rigWindow = window.open(url, 'viperrig', 'width=1440,height=900');
  }
  if (!rigWindow) return null;
  link.attachChildWindow(rigWindow);
  return rigWindow;
}

export function syncProjectToRig(project: ViperProject, activeDocumentId: string | null): void {
  const link = getViperLinkHost();
  link.connect(project.id);
  const projectJson = serializeViperProject(project);
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(`viper-project-${project.id}`, projectJson);
  }
  link.publish('project-snapshot', {
    projectJson,
    activeDocumentId,
    sourceApp: 'vipercad',
  } satisfies import('@/core/link/types').ViperLinkProjectSnapshot);
}

export function applyRigProjectSnapshot(projectJson: string): ViperProject {
  return deserializeViperProject(projectJson).project;
}

export function bindViperCadLink(
  project: ViperProject,
  onProjectFromRig: (project: ViperProject) => void,
): () => void {
  const link = getViperLinkHost();
  link.connect(project.id);
  return link.onMessage((envelope) => {
    if (envelope.type === 'request-sync') {
      syncProjectToRig(project, project.activeDocumentId);
      return;
    }
    if (envelope.type === 'rig-snapshot' || envelope.type === 'project-snapshot') {
      const payload = envelope.payload as import('@/core/link/types').ViperLinkProjectSnapshot;
      if (!payload?.projectJson) return;
      onProjectFromRig(applyRigProjectSnapshot(payload.projectJson));
    }
  });
}
