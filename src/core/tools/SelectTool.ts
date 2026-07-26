import type { ModellingContext, Tool, ToolPointerInput } from './Tool';

export class SelectTool implements Tool {
  id = 'select' as const;
  label = 'Select';

  activate(_context: ModellingContext): void {}
  deactivate(_context: ModellingContext): void {}
  begin(_input: ToolPointerInput, _context: ModellingContext): void {}
  update(_input: ToolPointerInput, _context: ModellingContext): void {}
  preview(_context: ModellingContext): void {}
  confirm(_context: ModellingContext): void {}
  cancel(_context: ModellingContext): void {}
  getAllowedSelectionModes() {
    return ['object', 'vertex', 'edge', 'face'] as const;
  }
  getSnapPolicy() {
    return ['vertex', 'edge', 'face', 'grid'] as const;
  }
}
