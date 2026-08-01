import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * BROWSER PAIRING GRANTS AND SESSIONS.
 *
 * The bridge has exactly one operator credential — `RELAY_BRIDGE_API_TOKEN` —
 * and it must never reach a browser. A bundle is public, and a long-lived
 * operator token in one would let anybody who reads the JavaScript spend a
 * founder's money forever.
 *
 * So the browser never receives that token. Instead:
 *
 *   1. The authenticated CLI asks the bridge for a PAIRING GRANT — a short,
 *      single-use secret bound to one exact origin.
 *   2. The founder carries that grant to the browser once, by hand.
 *   3. The browser exchanges it for a BROWSER SESSION: a separate, opaque,
 *      short-lived, origin-bound, revocable credential with a smaller scope.
 *
 * WHAT IS STORED. Only SHA-256 hashes of the secrets, never the secrets
 * themselves — so a memory dump, a log or a future durable snapshot cannot
 * replay anything. Comparison is constant-time.
 *
 * WHERE IT IS STORED. In memory only. A restart therefore revokes every grant
 * and session, which is the fail-closed direction, and means no browser
 * credential is ever written to the mounted volume.
 *
 * WHAT A BROWSER SESSION MAY DO. Read. It may observe reviewer readiness and
 * run state; it may not test a connection (which contacts a paid provider),
 * start, retry or stop a run, and it may not mint another grant or session.
 * A stolen session is therefore an information leak to the approved origin's
 * user, not a spending capability.
 */

/** Short by design: a grant is carried by hand, immediately. */
export const GRANT_TTL_MS = 120_000;
/** Long enough to verify a deployment, short enough to be forgettable. */
export const SESSION_TTL_MS = 30 * 60_000;

export type GrantFailure =
  | 'not_found'
  | 'expired'
  | 'already_consumed'
  | 'origin_mismatch'
  | 'invalid_secret';

export interface PairingGrantIssue {
  readonly grantId: string;
  /** Returned EXACTLY once, at creation. Never stored, never re-derivable. */
  readonly secret: string;
  readonly origin: string;
  readonly expiresAt: number;
}

export interface BrowserSessionIssue {
  readonly sessionId: string;
  /** Returned EXACTLY once, at exchange. */
  readonly token: string;
  readonly origin: string;
  readonly expiresAt: number;
  readonly scope: 'browser_read_only';
}

interface StoredGrant {
  readonly grantId: string;
  readonly secretHash: Buffer;
  readonly origin: string;
  readonly expiresAt: number;
  consumedAt: number | null;
}

interface StoredSession {
  readonly sessionId: string;
  readonly tokenHash: Buffer;
  readonly origin: string;
  readonly expiresAt: number;
  revokedAt: number | null;
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** Equal-length digests, so this is genuinely constant time. */
function hashMatches(presented: string, stored: Buffer): boolean {
  return timingSafeEqual(sha256(presented), stored);
}

/** URL-safe, 256 bits. Never a counter, never derived from anything. */
function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

export interface BrowserSessionStore {
  createGrant(input: { origin: string; now: number }): PairingGrantIssue;
  /** Single-use: a second call with the same grant always fails. */
  consumeGrant(input: {
    grantId: string; secret: string; origin: string; now: number;
  }): { ok: true; session: BrowserSessionIssue } | { ok: false; reason: GrantFailure };
  verifySession(input: {
    token: string; origin: string | undefined; now: number;
  }): { ok: true; sessionId: string } | { ok: false; reason: GrantFailure };
  revokeSession(input: { token: string; now: number }): boolean;
  /**
   * Drops expired records. Called on the WRITE path only — a read must never
   * mutate, or an expired record would be reported as unknown and a live one
   * could be swept out from under a later call.
   */
  sweep(now: number): void;
  readonly size: { grants: number; sessions: number };
}

export function createBrowserSessionStore(): BrowserSessionStore {
  const grants = new Map<string, StoredGrant>();
  const sessions = new Map<string, StoredSession>();

  const sweep = (now: number): void => {
    for (const [id, g] of grants) if (g.expiresAt <= now) grants.delete(id);
    for (const [id, s] of sessions) if (s.expiresAt <= now) sessions.delete(id);
  };

  return {
    createGrant({ origin, now }) {
      sweep(now);
      const grantId = randomBytes(9).toString('base64url');
      const secret = randomSecret();
      const expiresAt = now + GRANT_TTL_MS;
      grants.set(grantId, {
        grantId, secretHash: sha256(secret), origin, expiresAt, consumedAt: null,
      });
      return { grantId, secret, origin, expiresAt };
    },

    consumeGrant({ grantId, secret, origin, now }) {
      const grant = grants.get(grantId);
      // An unknown id and a wrong secret are reported the same way by the
      // route above; the distinction here exists only for tests.
      if (grant === undefined) return { ok: false, reason: 'not_found' };
      if (grant.expiresAt <= now) return { ok: false, reason: 'expired' };
      if (grant.consumedAt !== null) return { ok: false, reason: 'already_consumed' };
      // Origin is checked BEFORE the secret so a grant minted for one site can
      // never be redeemed from another, even with the right secret.
      if (grant.origin !== origin) return { ok: false, reason: 'origin_mismatch' };
      if (!hashMatches(secret, grant.secretHash)) return { ok: false, reason: 'invalid_secret' };

      // Burn it FIRST. A failure after this point must not leave a replayable
      // grant behind.
      grant.consumedAt = now;

      const sessionId = randomBytes(9).toString('base64url');
      const token = randomSecret();
      const expiresAt = now + SESSION_TTL_MS;
      sessions.set(sessionId, {
        sessionId, tokenHash: sha256(token), origin, expiresAt, revokedAt: null,
      });
      return {
        ok: true,
        session: { sessionId, token, origin, expiresAt, scope: 'browser_read_only' },
      };
    },

    verifySession({ token, origin, now }) {
      for (const session of sessions.values()) {
        if (!hashMatches(token, session.tokenHash)) continue;
        if (session.revokedAt !== null) return { ok: false, reason: 'already_consumed' };
        if (session.expiresAt <= now) return { ok: false, reason: 'expired' };
        // A session is bound to the origin it was paired for. A browser that
        // presents it from anywhere else is refused.
        if (origin !== undefined && session.origin !== origin) {
          return { ok: false, reason: 'origin_mismatch' };
        }
        return { ok: true, sessionId: session.sessionId };
      }
      return { ok: false, reason: 'not_found' };
    },

    revokeSession({ token, now }) {
      for (const session of sessions.values()) {
        if (!hashMatches(token, session.tokenHash)) continue;
        session.revokedAt = now;
        sessions.delete(session.sessionId);
        return true;
      }
      return false;
    },

    sweep,
    get size() {
      return { grants: grants.size, sessions: sessions.size };
    },
  };
}

/* --------------------------------------------------------------- scope --- */

/**
 * The routes a BROWSER session may reach. Everything absent from this list is
 * operator-only — in particular anything that contacts a paid provider or
 * changes a run.
 */
const BROWSER_READABLE = [
  /^\/reviewer\/readiness$/,
  /^\/reviewer\/status\/[^/]+$/,
  /^\/reviewer\/inspect\/[^/]+$/,
] as const;

export function browserSessionMayCall(method: string, path: string): boolean {
  if (method !== 'GET') return false;
  return BROWSER_READABLE.some((pattern) => pattern.test(path));
}
