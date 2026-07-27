import type { ModelDocument } from '@/core/document/types';
import type { CommandHistory } from '@/core/history/CommandHistory';
import type { SelectionManager, SelectionMode } from '@/core/selection/SelectionManager';
import type { ConstructionPlane, SnapQuery, SnapResult } from '@/core/snap/SnapEngine';
import type { Vec3 } from '@/core/math/Vec3';

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
  numericValue?: number;
  /** World units represented by one CSS pixel at the active pivot depth (ortho/persp). */
  worldUnitsPerPixel?: number;
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
  constructionPlaneId?: string;
};

export type ToolId =
  | 'select'
  | 'move'
  | 'rotate'
  | 'scale'
  | 'create-box'
  | 'create-primitive'
  | 'create-doodle'
  | 'combine-meshes'
  | 'draw-poly'
  | 'tile-draw'
  | 'extrude'
  | 'inset'
  | 'bevel'
  | 'knife'
  | 'loop-cut'
  | 'push-pull'
  | 'terrain-sculpt'
  | 'mesh-sculpt'
  | 'terrain-object'
  | 'terrain-feature';

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
