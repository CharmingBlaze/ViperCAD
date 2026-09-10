import type { DesktopMenuDefinition } from '@/app/DesktopMenuBar';

export type PaletteCommand = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
};

export function flattenMenuCommands(menus: DesktopMenuDefinition[]): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  for (const menu of menus) {
    for (const entry of menu.entries) {
      if (entry.kind !== 'command') continue;
      out.push({
        id: `${menu.label}:${entry.label}`,
        label: entry.label,
        shortcut: entry.shortcut,
        disabled: entry.disabled,
        run: entry.action,
      });
    }
  }
  return out;
}

export function filterPaletteCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  const available = commands.filter((command) => !command.disabled);
  if (!q) return available.slice(0, 24);
  return available
    .map((command) => {
      const label = command.label.toLowerCase();
      const index = label.indexOf(q);
      const fuzzy = index < 0 && [...q].every((ch, i, all) => {
        const from = i === 0 ? 0 : label.indexOf(all[i - 1]!) + 1;
        return label.indexOf(ch, from) >= 0;
      });
      if (index < 0 && !fuzzy) return null;
      const score = index === 0 ? 0 : index > 0 ? 1 + index : 40;
      return { command, score };
    })
    .filter((row): row is { command: PaletteCommand; score: number } => row !== null)
    .sort((a, b) => a.score - b.score || a.command.label.localeCompare(b.command.label))
    .map((row) => row.command)
    .slice(0, 24);
}
