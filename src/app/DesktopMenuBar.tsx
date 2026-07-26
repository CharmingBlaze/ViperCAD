import { useEffect, useRef, useState, type ReactNode } from 'react';

export type DesktopMenuEntry =
  | {
      kind: 'command';
      label: string;
      shortcut?: string;
      disabled?: boolean;
      checked?: boolean;
      action: () => void;
    }
  | { kind: 'separator' }
  | { kind: 'custom'; content: ReactNode };

export type DesktopMenuDefinition = {
  label: string;
  entries: DesktopMenuEntry[];
};

export function DesktopMenuBar({
  menus,
  align = 'start',
}: {
  menus: DesktopMenuDefinition[];
  align?: 'start' | 'end';
}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeEscape);
    };
  }, []);

  return (
    <nav
      className={`desktop-menu-bar${align === 'end' ? ' is-end' : ''}`}
      aria-label="Application menu"
      ref={rootRef}
    >
      {menus.map((menu) => {
        const open = openMenu === menu.label;
        return (
          <div
            className="desktop-menu"
            key={menu.label}
            onPointerEnter={() => {
              if (openMenu) setOpenMenu(menu.label);
            }}
          >
            <button
              type="button"
              className={`desktop-menu-trigger${open ? ' is-open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpenMenu(open ? null : menu.label)}
            >
              {menu.label}
            </button>
            {open && (
              <div className="desktop-menu-popup" role="menu" aria-label={`${menu.label} menu`}>
                {menu.entries.map((entry, index) => {
                  if (entry.kind === 'separator') {
                    return <div className="desktop-menu-separator" role="separator" key={index} />;
                  }
                  if (entry.kind === 'custom') {
                    return <div className="desktop-menu-custom" key={index}>{entry.content}</div>;
                  }
                  return (
                    <button
                      type="button"
                      role="menuitem"
                      className="desktop-menu-item"
                      disabled={entry.disabled}
                      key={`${entry.label}-${index}`}
                      onClick={() => {
                        setOpenMenu(null);
                        entry.action();
                      }}
                    >
                      <span className="desktop-menu-check">{entry.checked ? '✓' : ''}</span>
                      <span>{entry.label}</span>
                      {entry.shortcut && (
                        <kbd className="desktop-menu-shortcut">{entry.shortcut}</kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
