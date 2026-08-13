/**
 * THE BROWSER'S CONNECTED-REPOSITORY POINTER.
 *
 * The bridge is the authority on which repositories a participant has
 * connected; this is only a convenience POINTER so a browser refresh can
 * RECONNECT to the repository whose Mission is already running, instead of
 * dropping the signed-in user back on the "Connect a repository" screen while
 * their Mission keeps going server-side. It holds one opaque repository key —
 * never any repository contents, never a secret — mirrored into
 * `sessionStorage`, so it survives a reload but not the tab, exactly like the
 * session and the active-mission pointer it sits beside.
 *
 * IT CANNOT LIE. A pointer here is not a claim that the repository is still
 * connected: the gate only shows the Mission surface once the session is real,
 * and the runner re-reads the authoritative state from the bridge on
 * reconnect. A stale key can only ever fail closed — the bridge rejects work
 * for a repository the participant no longer owns.
 */

const KEY = 'sunday-relay.connected-repository';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | null {
  try {
    // `sessionStorage` only — a connected-repository pointer that outlived the
    // tab would point past the session it depends on.
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

/** Remember the repository this browser is connected to, so a refresh returns to it. */
export function saveConnectedRepository(repositoryKey: string): void {
  if (repositoryKey === '') return;
  const store = storage();
  if (store === null) return; // Memory-less is the safe degradation: no reconnect, mission unaffected.
  try {
    store.setItem(KEY, JSON.stringify(repositoryKey));
  } catch {
    /* quota or privacy mode — reconnect-on-refresh degrades; the mission itself is untouched */
  }
}

/** The repository key this browser last connected to, or null. */
export function loadConnectedRepository(): string | null {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' && parsed !== '' ? parsed : null;
  } catch {
    // A malformed stored value is not evidence of a connection — fail closed.
    return null;
  }
}

/** Drop the pointer — the user disconnected or is choosing another repository. */
export function clearConnectedRepository(): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
