import type { ModelDocument } from '@/core/document/types';
import type { CommandHistory } from '@/core/history/CommandHistory';
import type { SelectionManager, SelectionMode } from '@/core/selection/SelectionManager';
import type { ConstructionPlane, SnapQuery, SnapResult } from '@/core/snap/SnapEngine';
import type { Vec3 } from '@/core/math/Vec3';
import type { GizmoMode } from '@/core/transform/types';

export type PointerButton = 'left' | 'middle' | 'right';

export type ToolPointerInput = {
  button: PointerButton;
  screenX: number;
  screenY: number;
  worldPosition: Vec3 | null;
  rayOrigin: Vec3;
  rayDirection: Vec3;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  pressure?: number;
  numericValue?: number;
  /** World units represented by one CSS pixel at the active pivot depth (ortho/persp). */
  worldUnitsPerPixel?: number;
  viewportId?: string;
};

export type ModellingContext = {
  document: ModelDocument;
  selection: SelectionManager;
  history: CommandHistory;
  constructionPlane: ConstructionPlane;
  snapEnabled: boolean;
  gridSize: number;
  resolveSnap: (query: SnapQuery) => SnapResult;
  requestRedraw: () => void;
  notify?: (text: string, kind?: 'info' | 'success' | 'error') => void;
  constructionPlaneId?: string;
  setActiveTool?: (id: ToolId) => void;
  setGizmoMode?: (mode: GizmoMode) => void;
};

export type ToolId =
  | 'select'
  | 'move'
  | 'rotate'
  | 'scale'
  | 'create-box'
  | 'create-primitive'
  | 'create-doodle'
  | 'draw-poly'
  | 'tile-draw'
  | 'extrude'
  | 'inset'
  | 'bevel'
  | 'knife'
  | 'loop-cut'
  | 'terrain-sculpt'
  | 'mesh-sculpt'
  | 'terrain-object'
  | 'terrain-feature'
  | 'blockout-vector'
  | 'blockout-solid'
  | 'blockout-round';

export interface Tool {
  id: ToolId;
  label: string;
  activate(context: ModellingContext): void;
  deactivate(context: ModellingContext): void;
  begin(input: ToolPointerInput, context: ModellingContext): void;
  update(input: ToolPointerInput, context: ModellingContext): void;
  preview(context: ModellingContext): void;
  confirm(context: ModellingContext): void;
  cancel(context: ModellingContext): void;
  getAllowedSelectionModes(): readonly SelectionMode[];
  getSnapPolicy(): readonly SnapQuery['allowed'][number][];
}
