import type { ModellingContext, Tool, ToolId, ToolPointerInput } from './Tool';

export class ToolController {
  private tools = new Map<ToolId, Tool>();
  private active: Tool | null = null;

  register(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  getActive(): Tool | null {
    return this.active;
  }

  get(id: ToolId): Tool | undefined {
    return this.tools.get(id);
  }

  setActive(id: ToolId, context: ModellingContext): void {
    const next = this.tools.get(id);
    if (!next) throw new Error(`Unknown tool ${id}`);
    if (this.active?.id === id) return;
    this.active?.deactivate(context);
    this.active = next;
    this.active.activate(context);
  }

  begin(input: ToolPointerInput, context: ModellingContext): void {
    this.active?.begin(input, context);
  }

  update(input: ToolPointerInput, context: ModellingContext): void {
    this.active?.update(input, context);
  }

  confirm(context: ModellingContext): void {
    this.active?.confirm(context);
  }

  cancel(context: ModellingContext): void {
    this.active?.cancel(context);
  }
}
