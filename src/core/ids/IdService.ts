/** Stable unique identity generator. Never reuse array indices as permanent IDs. */

export type IdKind =
  | 'obj'
  | 'mesh'
  | 'v'
  | 'e'
  | 'he'
  | 'f'
  | 'fc'
  | 'uv'
  | 'mat'
  | 'tex'
  | 'img'
  | 'cmd'
  | 'doc'
  | 'island';

export type ElementId = string;

let nextCounter = 1;

/** Deterministic counter IDs for tests; switchable to UUID-style later. */
export function createId(kind: IdKind): ElementId {
  const id = `${kind}_${nextCounter.toString(36)}`;
  nextCounter += 1;
  return id;
}

export function resetIdCounter(value = 1): void {
  nextCounter = value;
}

export function peekIdCounter(): number {
  return nextCounter;
}

/** Ensure subsequently generated IDs cannot collide with deserialised counter IDs. */
export function reserveExistingIds(ids: Iterable<string>): void {
  for (const id of ids) {
    const suffix = id.slice(id.lastIndexOf('_') + 1);
    const value = Number.parseInt(suffix, 36);
    if (Number.isFinite(value)) nextCounter = Math.max(nextCounter, value + 1);
  }
}
