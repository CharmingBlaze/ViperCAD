import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesktopMenuDefinition } from '@/app/DesktopMenuBar';

export function CommandPalette({
  open,
  menus,
  onClose,
}: {
  open: boolean;
  menus: DesktopMenuDefinition[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useMemo(
    () => menus.flatMap((menu) =>
      menu.entries.flatMap((entry) =>
        entry.kind === 'command'
          ? [{ ...entry, group: menu.label }]
          : [])),
    [menus],
  );
  const normalized = query.trim().toLocaleLowerCase();
  const matches = commands
    .filter((command) =>
      !normalized ||
      `${command.group} ${command.label} ${command.shortcut ?? ''}`
        .toLocaleLowerCase()
        .includes(normalized))
    .slice(0, 16);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  if (!open) return null;
  const run = (index: number) => {
    const command = matches[index];
    if (!command || command.disabled) return;
    onClose();
    command.action();
  };

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Find a command"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            value={query}
            placeholder="Find a tool or action…"
            aria-label="Search commands"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.min(matches.length - 1, index + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                run(activeIndex);
              }
            }}
          />
          <kbd>Ctrl K</kbd>
        </header>
        <div className="command-palette-results" role="listbox">
          {matches.map((command, index) => (
            <button
              key={`${command.group}-${command.label}-${index}`}
              type="button"
              className={index === activeIndex ? 'is-active' : ''}
              disabled={command.disabled}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => run(index)}
            >
              <span>
                <small>{command.group}</small>
                {command.label}
              </span>
              {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
            </button>
          ))}
          {!matches.length ? <p>No matching command</p> : null}
        </div>
      </section>
    </div>
  );
}
