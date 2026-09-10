import { describe, expect, it, vi } from 'vitest';
import { filterPaletteCommands, flattenMenuCommands } from '@/app/paletteCommands';

describe('command palette', () => {
  it('flattens menu commands and skips separators', () => {
    const run = vi.fn();
    const commands = flattenMenuCommands([
      {
        label: 'View',
        entries: [
          { kind: 'command', label: 'Studio Amber', action: run },
          { kind: 'separator' },
          { kind: 'command', label: 'Extrude', shortcut: 'E', disabled: true, action: run },
        ],
      },
    ]);
    expect(commands.map((command) => command.label)).toEqual(['Studio Amber', 'Extrude']);
    expect(filterPaletteCommands(commands, 'amber')[0]?.label).toBe('Studio Amber');
    expect(filterPaletteCommands(commands, 'extrude')).toEqual([]);
  });

  it('ranks prefix matches first', () => {
    const run = vi.fn();
    const commands = [
      { id: 'a', label: 'UV / Pixel Workspace', run },
      { id: 'b', label: 'Frame Selection', run },
    ];
    expect(filterPaletteCommands(commands, 'uv')[0]?.label).toBe('UV / Pixel Workspace');
    expect(filterPaletteCommands(commands, 'frame')[0]?.label).toBe('Frame Selection');
  });
});
