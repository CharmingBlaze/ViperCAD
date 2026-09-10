import { combineMeshObjects } from '@/core/editor/GameAssetTools';
import type { ModellingContext, Tool, ToolPointerInput } from './Tool';

/** Join mesh objects into one combined mesh. */
export class CombineMeshesTool implements Tool {
  id = 'combine-meshes' as const;
  label = 'Combine';

  activate(context: ModellingContext): void {
    context.selection.setMode('object');
  }

  deactivate(_context: ModellingContext): void {}

  begin(_input: ToolPointerInput, _context: ModellingContext): void {}

  update(_input: ToolPointerInput, _context: ModellingContext): void {}

  preview(_context: ModellingContext): void {}

  confirm(context: ModellingContext): void {
    this.combineSelection(context);
  }

  cancel(context: ModellingContext): void {
    context.requestRedraw();
  }

  combineSelection(context: ModellingContext) {
    return combineMeshObjects(
      context.document,
      context.selection.state.selectedObjectIds,
    );
  }

  getAllowedSelectionModes() {
    return ['object'] as const;
  }

  getSnapPolicy() {
    return [] as const;
  }
}
