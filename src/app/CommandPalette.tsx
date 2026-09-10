import { useEffect, useMemo, useRef, useState } from 'react';
import { filterPaletteCommands, type PaletteCommand } from '@/app/paletteCommands';

type Props = {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
};

export function CommandPalette({ open, commands, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => filterPaletteCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActive(0);
      return;
    }
    setActive(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const run = (command: PaletteCommand) => {
    onClose();
    command.run();
  };

  return (
    <div
      className="command-palette"
      role="dialog"
      aria-label="Command palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="command-palette-panel">
        <input
          ref={inputRef}
          className="command-palette-search"
          type="search"
          value={query}
          placeholder="Search commands…"
          aria-label="Search commands"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
              event.preventDefault();
              onClose();
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(matches.length - 1, index + 1));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const command = matches[active];
              if (command) run(command);
            }
          }}
        />
        {matches.length === 0 ? (
          <p className="command-palette-empty">No matching commands</p>
        ) : (
          <ul className="command-palette-list" role="listbox">
            {matches.map((command, index) => (
              <li key={command.id}>
                <button
                  type="button"
                  className={`command-palette-item${index === active ? ' is-active' : ''}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(command)}
                >
                  <span>{command.label}</span>
                  {command.shortcut ? (
                    <kbd className="command-palette-shortcut">{command.shortcut}</kbd>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
