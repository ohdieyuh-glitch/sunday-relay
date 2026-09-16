import type { JuliusBrainJwk } from './julius-brain-access';

/**
 * THE ISSUER'S SIGNING KEYS: RESOLVED, CACHED AND ROTATED. PROVIDER-NEUTRAL.
 *
 * The access contract verifies what a token says. This is how the service comes
 * to hold the key that proves it, without ever trusting the token to tell it:
 *
 *   BY ISSUER AND KEY ID     keys are cached per issuer; a token names a key id
 *                            in its header, and only a key published by ITS
 *                            issuer under THAT id can verify it
 *   BOUNDED FRESHNESS        a cache older than `cacheTtlMs` is refreshed before
 *                            it is used
 *   CONTROLLED REFRESH       an unknown key id refreshes once, no more often
 *                            than `minRefreshIntervalMs`, so a flood of forged
 *                            key ids cannot turn into a flood of fetches
 *   NEVER INDEFINITELY STALE when refreshes keep failing, cached keys serve only
 *                            until `staleLimitMs`; after that every exchange is
 *                            refused. A rotated-out key cannot validate forever
 *   RS256 ONLY               a key of another type or algorithm is dropped as it
 *                            is parsed, so an `oct` key published under an RSA
 *                            key's id can never be reached
 *   AMBIGUITY IS A REFUSAL   two keys under one id resolve to neither
 *   FAIL CLOSED              a malformed document leaves the previous cache in
 *                            place and refuses; an unreachable issuer is
 *                            OIDC_UNAVAILABLE, never an accepted token
 *
 * Only parsed public keys are kept, in memory. The response body is not stored,
 * and nothing here reads, logs or returns a token.
 */

export interface JuliusBrainJwksResponse { readonly status: number; readonly body: string }
export interface JuliusBrainJwksFetch { (url: string): Promise<JuliusBrainJwksResponse> }

export type JuliusBrainKeyRefusal =
  | 'issuer_unknown' | 'key_unknown' | 'key_ambiguous' | 'jwks_unavailable' | 'jwks_malformed' | 'jwks_stale_beyond_limit';

export type JuliusBrainKeyResolution =
  | { readonly ok: true; readonly key: JuliusBrainJwk; readonly fetchedAt: string; readonly refreshed: boolean; readonly servedStale: boolean }
  | { readonly ok: false; readonly reasonCode: JuliusBrainKeyRefusal; readonly detail: string };

export interface JuliusBrainOidcKeyStore {
  /** The key this issuer publishes under this id, refreshing when the cache is old or the id is unknown. */
  resolve(issuer: string, kid: string): Promise<JuliusBrainKeyResolution>;
  /** What the store holds, for a health endpoint: never a key's material. */
  status(): readonly { readonly issuer: string; readonly kids: readonly string[]; readonly ambiguousKids: readonly string[]; readonly fetchedAt: string | null; readonly lastAttemptAt: string | null; readonly lastFailure: JuliusBrainKeyRefusal | null }[];
}

/** Only what can verify an RS256 signature. Anything else is dropped where it is read. */
function usableKeys(document: unknown): { readonly keys: readonly JuliusBrainJwk[]; readonly ambiguous: readonly string[] } | null {
  if (typeof document !== 'object' || document === null) return null;
  const list = (document as { keys?: unknown }).keys;
  if (!Array.isArray(list)) return null;
  const byKid = new Map<string, JuliusBrainJwk[]>();
  for (const candidate of list) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const { kty, kid, n, e, alg, use } = candidate as Record<string, unknown>;
    if (kty !== 'RSA' || typeof kid !== 'string' || kid.length === 0 || kid.length > 256) continue;
    if (typeof n !== 'string' || typeof e !== 'string' || n.length === 0 || e.length === 0) continue;
    if (alg !== undefined && alg !== 'RS256') continue;
    if (use !== undefined && use !== 'sig') continue;
    byKid.set(kid, [...(byKid.get(kid) ?? []), { kty, kid, n, e, alg: 'RS256', use: 'sig' }]);
  }
  const keys: JuliusBrainJwk[] = [];
  const ambiguous: string[] = [];
  for (const [kid, found] of byKid) {
    // Two different keys under one id: neither is the key, because nothing says which.
    if (found.length > 1 && found.some((key) => key.n !== found[0]!.n || key.e !== found[0]!.e)) ambiguous.push(kid);
    else keys.push(found[0]!);
  }
  return { keys, ambiguous: ambiguous.sort() };
}

export function createJuliusBrainOidcKeyStore(deps: {
  /** Issuer → its JWKS URL. An issuer not listed is unknown, whatever a token claims. */
  readonly issuers: Readonly<Record<string, string>>;
  readonly fetch: JuliusBrainJwksFetch;
  readonly clock: { now(): string };
  /** How long a fetched document is used without refreshing. */
  readonly cacheTtlMs?: number;
  /** How long cached keys may still serve while refreshes fail. Past it, every exchange is refused. */
  readonly staleLimitMs?: number;
  /** The floor between two fetches of one issuer, so unknown key ids cannot drive traffic. */
  readonly minRefreshIntervalMs?: number;
  /** Bytes of JWKS document accepted. */
  readonly maxBytes?: number;
}): JuliusBrainOidcKeyStore {
  const cacheTtlMs = deps.cacheTtlMs ?? 10 * 60 * 1000;
  const staleLimitMs = deps.staleLimitMs ?? 6 * 60 * 60 * 1000;
  const minRefreshIntervalMs = deps.minRefreshIntervalMs ?? 30 * 1000;
  const maxBytes = deps.maxBytes ?? 256 * 1024;
  interface Entry {
    keys: readonly JuliusBrainJwk[];
    ambiguous: readonly string[];
    fetchedAt: number | null;
    lastAttemptAt: number | null;
    lastFailure: JuliusBrainKeyRefusal | null;
  }
  const cache = new Map<string, Entry>();
  const at = () => Date.parse(deps.clock.now());
  const iso = (value: number | null) => (value === null ? null : new Date(value).toISOString());

  const entryFor = (issuer: string): Entry => {
    const held = cache.get(issuer);
    if (held !== undefined) return held;
    const fresh: Entry = { keys: [], ambiguous: [], fetchedAt: null, lastAttemptAt: null, lastFailure: null };
    cache.set(issuer, fresh);
    return fresh;
  };

  /** One fetch, whatever it finds. Never throws: the entry records what happened. */
  const fetchOnce = async (issuer: string, url: string): Promise<JuliusBrainKeyRefusal | null> => {
    const entry = entryFor(issuer);
    entry.lastAttemptAt = at();
    let response: JuliusBrainJwksResponse;
    try {
      response = await deps.fetch(url);
    } catch {
      entry.lastFailure = 'jwks_unavailable';
      return 'jwks_unavailable';
    }
    if (response.status !== 200) { entry.lastFailure = 'jwks_unavailable'; return 'jwks_unavailable'; }
    if (typeof response.body !== 'string' || response.body.length > maxBytes) { entry.lastFailure = 'jwks_malformed'; return 'jwks_malformed'; }
    let parsed: unknown;
    try { parsed = JSON.parse(response.body); } catch { entry.lastFailure = 'jwks_malformed'; return 'jwks_malformed'; }
    const usable = usableKeys(parsed);
    // A document that is not a key set at all leaves what we had; one with no usable key is still an answer (every key may have rotated out).
    if (usable === null) { entry.lastFailure = 'jwks_malformed'; return 'jwks_malformed'; }
    entry.keys = usable.keys;
    entry.ambiguous = usable.ambiguous;
    entry.fetchedAt = entry.lastAttemptAt;
    entry.lastFailure = null;
    return null;
  };

  return {
    async resolve(issuer, kid) {
      const url = deps.issuers[issuer];
      if (url === undefined) return { ok: false, reasonCode: 'issuer_unknown', detail: `no keys are configured for ${issuer.slice(0, 120)}` };
      const entry = entryFor(issuer);
      const now = at();
      const expired = entry.fetchedAt === null || now - entry.fetchedAt >= cacheTtlMs;
      const mayFetch = entry.lastAttemptAt === null || now - entry.lastAttemptAt >= minRefreshIntervalMs;
      let refreshed = false;
      let failure: JuliusBrainKeyRefusal | null = null;
      const known = () => entry.keys.find((key) => key.kid === kid);

      if ((expired || (known() === undefined && !entry.ambiguous.includes(kid))) && mayFetch) {
        failure = await fetchOnce(issuer, url);
        refreshed = failure === null;
      }
      const age = entry.fetchedAt === null ? null : at() - entry.fetchedAt;
      // Nothing was ever fetched, or the last good fetch is older than the stale limit: refuse rather than verify with what may be revoked.
      if (entry.fetchedAt === null) {
        return { ok: false, reasonCode: failure ?? 'jwks_unavailable', detail: `no keys for ${issuer.slice(0, 120)} have been fetched` };
      }
      if (age !== null && age > staleLimitMs) {
        return { ok: false, reasonCode: 'jwks_stale_beyond_limit', detail: `the last successful fetch for ${issuer.slice(0, 120)} was ${Math.round(age / 1000)}s ago` };
      }
      if (entry.ambiguous.includes(kid)) return { ok: false, reasonCode: 'key_ambiguous', detail: `two keys are published under ${kid.slice(0, 120)}` };
      const key = known();
      if (key === undefined) {
        return failure === null
          ? { ok: false, reasonCode: 'key_unknown', detail: `${issuer.slice(0, 120)} does not publish ${kid.slice(0, 120)}` }
          : { ok: false, reasonCode: failure, detail: `${kid.slice(0, 120)} is not cached and the key set could not be refreshed` };
      }
      return { ok: true, key, fetchedAt: iso(entry.fetchedAt)!, refreshed, servedStale: age !== null && age >= cacheTtlMs };
    },

    status() {
      return [...cache.entries()].map(([issuer, entry]) => ({
        issuer, kids: entry.keys.map((key) => key.kid!).sort(), ambiguousKids: entry.ambiguous,
        fetchedAt: iso(entry.fetchedAt), lastAttemptAt: iso(entry.lastAttemptAt), lastFailure: entry.lastFailure,
      }));
    },
  };
}
