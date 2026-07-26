/**
 * Safe numeric parser for modal transforms.
 * Supports ±, decimals, optional units (m, cm, mm, deg). No eval / JS expressions.
 */

export type ParsedNumber =
  | { ok: true; value: number; unit: 'none' | 'm' | 'cm' | 'mm' | 'deg' }
  | { ok: false; error: string };

const UNIT_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))(m|cm|mm|deg)?$/i;

/**
 * Convert typed input to a dimensionless value for the active transform.
 * Length units convert to project meters (1 unit = 1m). Degrees stay as degrees
 * for rotation (caller converts to radians if needed).
 */
export function parseTransformNumber(input: string, projectUnitScale = 1): ParsedNumber {
  const trimmed = input.trim().replace(/\s+/g, '');
  if (!trimmed || trimmed === '-' || trimmed === '+' || trimmed === '.' || trimmed === '-.' || trimmed === '+.') {
    return { ok: false, error: 'incomplete' };
  }
  const match = UNIT_RE.exec(trimmed);
  if (!match) return { ok: false, error: 'invalid' };
  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return { ok: false, error: 'invalid' };
  const u = (match[2]?.toLowerCase() ?? 'none') as 'none' | 'm' | 'cm' | 'mm' | 'deg';
  let value = raw;
  if (u === 'm') value = raw * projectUnitScale;
  else if (u === 'cm') value = (raw / 100) * projectUnitScale;
  else if (u === 'mm') value = (raw / 1000) * projectUnitScale;
  return { ok: true, value, unit: u };
}

export function isNumericInputChar(key: string): boolean {
  return key.length === 1 && /[0-9.+-]/.test(key);
}
