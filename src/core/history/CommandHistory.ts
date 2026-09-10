import { createId } from '@/core/ids/IdService';

export type Command = {
  id: string;
  name: string;
  timestamp: number;
  execute: () => void;
  undo: () => void;
  canMerge?: (other: Command) => boolean;
  merge?: (other: Command) => void;
  /** Optional payload for merge helpers (e.g. pixel patches). */
  meta?: unknown;
};

export class CommandHistory {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private maxSize: number;

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  execute(command: Omit<Command, 'id' | 'timestamp'> & { id?: string; timestamp?: number }): void {
    const cmd: Command = {
      id: command.id ?? createId('cmd'),
      timestamp: command.timestamp ?? Date.now(),
      name: command.name,
      execute: command.execute,
      undo: command.undo,
      canMerge: command.canMerge,
      merge: command.merge,
      meta: command.meta,
    };

    cmd.execute();

    const last = this.undoStack[this.undoStack.length - 1];
    if (last?.canMerge?.(cmd) && last.merge) {
      last.merge(cmd);
    } else {
      this.undoStack.push(cmd);
      if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    return true;
  }

  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this.undoStack.push(cmd);
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  getUndoNames(): string[] {
    return this.undoStack.map((c) => c.name);
  }

  getRedoNames(): string[] {
    return this.redoStack.map((c) => c.name);
  }

  /** A compact, presentation-ready view of the most recent editing steps. */
  getTimeline(limit = 12): { id: string; name: string; timestamp: number; state: 'done' | 'redo' }[] {
    const done = this.undoStack.map((command) => ({
      id: command.id,
      name: command.name,
      timestamp: command.timestamp,
      state: 'done' as const,
    }));
    const redo = [...this.redoStack].reverse().map((command) => ({
      id: command.id,
      name: command.name,
      timestamp: command.timestamp,
      state: 'redo' as const,
    }));
    return [...done, ...redo].slice(-Math.max(1, limit));
  }
}
