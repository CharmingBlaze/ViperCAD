export type ViperAppId = 'vipercad' | 'viperrig';

export type ViperLinkMessageType =
  | 'hello'
  | 'request-sync'
  | 'project-snapshot'
  | 'rig-snapshot'
  | 'focus-document'
  | 'ping';

export type ViperLinkHello = {
  app: ViperAppId;
  projectId: string | null;
  version: string;
};

export type ViperLinkProjectSnapshot = {
  projectJson: string;
  activeDocumentId: string | null;
  sourceApp: ViperAppId;
};

export type ViperLinkRigSnapshot = {
  rigDocumentId: string;
  projectJson: string;
  sourceApp: ViperAppId;
};

export type ViperLinkFocusDocument = {
  documentId: string;
  kind: 'model' | 'level' | 'rig';
};

export type ViperLinkEnvelope<TType extends ViperLinkMessageType = ViperLinkMessageType> = {
  id: string;
  channel: string;
  source: ViperAppId;
  type: TType;
  projectId: string;
  payload: unknown;
  timestamp: number;
};

export function viperLinkChannel(projectId: string): string {
  return `viper-link-${projectId}`;
}
