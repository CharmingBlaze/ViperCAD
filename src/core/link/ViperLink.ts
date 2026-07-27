import type { ViperAppId, ViperLinkEnvelope, ViperLinkMessageType } from '@/core/link/types';
import { viperLinkChannel } from '@/core/link/types';

type Listener = (envelope: ViperLinkEnvelope) => void;

let messageCounter = 0;

function createEnvelope(
  source: ViperAppId,
  projectId: string,
  type: ViperLinkMessageType,
  payload: unknown,
): ViperLinkEnvelope {
  messageCounter += 1;
  return {
    id: `msg_${messageCounter}`,
    channel: viperLinkChannel(projectId),
    source,
    type,
    projectId,
    payload,
    timestamp: Date.now(),
  };
}

/** Cross-app bridge between ViperCAD and ViperRig via BroadcastChannel + window.postMessage. */
export class ViperLink {
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<Listener>();
  private readonly app: ViperAppId;
  private projectId: string | null = null;
  private childWindow: Window | null = null;

  constructor(app: ViperAppId) {
    this.app = app;
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.handleWindowMessage);
    }
  }

  connect(projectId: string): void {
    if (this.projectId === projectId && this.channel) return;
    this.disconnect();
    this.projectId = projectId;
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(viperLinkChannel(projectId));
      this.channel.onmessage = (event: MessageEvent<ViperLinkEnvelope>) => {
        const envelope = event.data;
        if (!envelope || envelope.source === this.app) return;
        this.dispatch(envelope);
      };
    }
    this.publish('hello', { app: this.app, projectId, version: '1' });
  }

  disconnect(): void {
    this.channel?.close();
    this.channel = null;
    this.projectId = null;
  }

  destroy(): void {
    this.disconnect();
    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this.handleWindowMessage);
    }
    this.listeners.clear();
    this.childWindow = null;
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(type: ViperLinkMessageType, payload: unknown): void {
    if (!this.projectId) return;
    const envelope = createEnvelope(this.app, this.projectId, type, payload);
    this.channel?.postMessage(envelope);
    if (this.childWindow && !this.childWindow.closed) {
      this.childWindow.postMessage(envelope, '*');
    }
    if (typeof window !== 'undefined' && window.opener && !window.opener.closed) {
      window.opener.postMessage(envelope, '*');
    }
  }

  attachChildWindow(child: Window | null): void {
    this.childWindow = child;
  }

  private handleWindowMessage = (event: MessageEvent): void => {
    const envelope = event.data as ViperLinkEnvelope | undefined;
    if (!envelope?.type || envelope.source === this.app) return;
    if (this.projectId && envelope.projectId !== this.projectId) return;
    this.dispatch(envelope);
  };

  private dispatch(envelope: ViperLinkEnvelope): void {
    for (const listener of this.listeners) listener(envelope);
  }
}

export function parseLinkSearchParams(search: string): { projectId: string | null; rigDocumentId: string | null } {
  const params = new URLSearchParams(search);
  return {
    projectId: params.get('projectId'),
    rigDocumentId: params.get('rigDocumentId'),
  };
}
