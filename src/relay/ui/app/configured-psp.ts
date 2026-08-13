/**
 * THE BROWSER'S PRE-CONFIGURED PSP POINTER.
 *
 * The Compound PSP Agent (Prompt Architect / Coding Agent / independent Reviewer
 * / Relay) is configured BEFORE the participant connects any repository — before
 * Start Building, before GitHub. But connecting a repository is a full
 * `window.location.href` navigation to GitHub and back: the return is a fresh
 * document load, so React state is destroyed on the round-trip. Only
 * `sessionStorage` survives it.
 *
 * This holds that pre-configured request so it can be REHYDRATED on the fresh
 * mount after the OAuth/install redirect and carried into the Mission unchanged —
 * exactly as the connected-repository pointer beside it survives a reload. It is
 * a REQUEST, not a claim: what the Mission actually runs UNDER (authority held,
 * served model) still comes from the bridge's authoritative view, never from
 * here. A malformed or absent value fails closed to `null`, and nothing here ever
 * throws.
 */

const KEY = 'sunday-relay.configured-psp';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): StorageLike | null {
  try {
    // `sessionStorage` only — a configured PSP that outlived the tab would carry
    // a stale request past the session it was configured for.
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

/** Remember the pre-configured PSP so a redirect round-trip rehydrates it. */
export function saveConfiguredPsp(config: unknown): void {
  // A config that is not an object cannot resolve to a request — never store one.
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return;
  const store = storage();
  if (store === null) return; // Memory-less is the safe degradation: falls back to the default config.
  try {
    store.setItem(KEY, JSON.stringify(config));
  } catch {
    /* quota or privacy mode — the flow falls back to the default beta config, unharmed */
  }
}

/** The pre-configured PSP this browser last saved, or null. */
export function loadConfiguredPsp(): unknown {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    // Only a plain object is a config; a primitive, an array or null is not —
    // fail closed rather than carry a request that cannot be honoured.
    return (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch {
    // A malformed stored value is not a configuration — fail closed.
    return null;
  }
}

/** Drop the pointer — the participant is starting over or signing out. */
export function clearConfiguredPsp(): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
