import { useEffect, useRef, useState } from 'react';

type Props = {
  value: number;
  ariaLabel: string;
  onValueChange: (value: number) => void;
};

/**
 * Coordinate editor that keeps partially typed decimals intact while sending
 * every complete numeric value to the live procedural model.
 */
export function ExactCoordinateInput({ value, ariaLabel, onValueChange }: Props) {
  const [draft, setDraft] = useState(() => formatCoordinate(value));
  const focused = useRef(false);
  const lastEmitted = useRef<number | null>(null);

  useEffect(() => {
    const isEcho =
      lastEmitted.current != null &&
      Math.abs(lastEmitted.current - value) <= Number.EPSILON * Math.max(1, Math.abs(value));
    if (!focused.current || !isEcho) setDraft(formatCoordinate(value));
    if (isEcho) lastEmitted.current = null;
  }, [value]);

  const emitIfComplete = (raw: string) => {
    if (raw.trim() === '' || raw === '-' || raw === '+' || raw.endsWith('.') || /[eE][+-]?$/.test(raw)) {
      return;
    }
    const next = Number(raw);
    if (!Number.isFinite(next)) return;
    lastEmitted.current = next;
    onValueChange(next);
  };

  return (
    <input
      className="uv-text"
      aria-label={ariaLabel}
      type="number"
      inputMode="decimal"
      step={0.001}
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        emitIfComplete(raw);
      }}
      onBlur={() => {
        focused.current = false;
        const parsed = Number(draft);
        if (draft.trim() !== '' && Number.isFinite(parsed)) {
          lastEmitted.current = parsed;
          onValueChange(parsed);
          setDraft(formatCoordinate(parsed));
        } else {
          setDraft(formatCoordinate(value));
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(10));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}
