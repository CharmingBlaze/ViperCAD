import type { CurveOperation, CurveStyle } from '@/core/curves/CurveOperation';

export const WORKFLOW_STYLES = ['profile-solid', 'segmented-sweep'] as const;
export type WorkflowCurveStyle = (typeof WORKFLOW_STYLES)[number];

export function isWorkflowStyle(style: CurveStyle): style is WorkflowCurveStyle {
  return style === 'profile-solid' || style === 'segmented-sweep';
}

export function isWorkflowOperation(operation: CurveOperation): boolean {
  // Workflow-only styles are enough — older scenes may lack workflowKind.
  return isWorkflowStyle(operation.style);
}
