/**
 * THE BROWSER'S ACTIVE-MISSION POINTER.
 *
 * The server is the mission authority; this is only a convenience POINTER so a
 * browser refresh can RECONNECT to the Mission already running, instead of
 * dropping the user back on an empty Start screen while their Mission keeps
 * going server-side. It holds an opaque mission id per connected repository —
 * never any mission state, never a secret — mirrored into `sessionStorage`, so
 * it survives a reload but not the tab, exactly like the session it depends on.
 *
 * IT CANNOT LIE. A pointer here is not a claim that the Mission still exists:
 * the runner re-reads the authoritative state from the bridge on reconnect, and
 * a mission id whose record is gone simply returns nothing — the runner falls
 * back to Start. A stale pointer can only ever fail closed.
 */

const KEY = 'sunday-relay.active-mission';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | null {
  try {
    // `sessionStorage` only — a mission pointer that outlived the tab would be a
    // pointer into a session that no longer exists.
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

function readMap(): Record<string, string> {
  const store = storage();
  if (store === null) return {};
  try {
    const raw = store.getItem(KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>): void {
  const store = storage();
  if (store === null) return; // Memory-less is the safe degradation: no reconnect, mission unaffected.
  try {
    store.setItem(KEY, JSON.stringify(map));
  } catch {
    /* quota or privacy mode — reconnect-on-refresh degrades; the mission itself is untouched */
  }
}

/** Point at the Mission now running on this repository, so a refresh finds it. */
export function rememberActiveMission(repositoryKey: string, missionId: string): void {
  if (repositoryKey === '' || missionId === '') return;
  const map = readMap();
  map[repositoryKey] = missionId;
  writeMap(map);
}

/** The Mission id last started on this repository, or null. */
export function recallActiveMission(repositoryKey: string): string | null {
  const value = readMap()[repositoryKey];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Drop the pointer — the user finished with that Mission and wants a fresh one. */
export function forgetActiveMission(repositoryKey: string): void {
  const map = readMap();
  if (repositoryKey in map) {
    delete map[repositoryKey];
    writeMap(map);
  }
}

/** Forget every pointer. For tests and a full sign-out. */
export function clearActiveMissions(): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
