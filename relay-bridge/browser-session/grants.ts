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
 * WHAT A BROWSER SESSION MAY DO depends on its SCOPE, decided at mint by the
 * operator and never widenable afterwards. A read-only session observes:
 * reviewer readiness and run state, one mission. A CONTROL session may also
 * start, cancel and retry a mission — the founder's decision that the website
 * is a real control surface — acting as the participant bound into it at
 * mint. Neither scope may test a connection, reach any other spending route,
 * or mint another grant or session. A stolen read-only session is an
 * information leak to the approved origin's user; a stolen control session is
 * bounded by the mission family, the beta seat it was bound to, its origin,
 * its TTL and revocation — never by trust in the browser.
 */

/** Short by design: a grant is carried by hand, immediately. */
export const GRANT_TTL_MS = 120_000;
/** Long enough to verify a deployment, short enough to be forgettable. */
export const SESSION_TTL_MS = 30 * 60_000;

/**
 * THE NATIVE CLIENT'S TWO LIFETIMES, split by the founder (decision 2, 2026-09-27):
 *
 *   PAIRING CODE    5 minutes, single use, invalid the moment it is redeemed, bound to the player, the project
 *                   and the native-client purpose -- long enough to paste into Wonderland, short enough that no
 *                   long-lived credential is left lying around.
 *   NATIVE SESSION  8 hours for the private beta, revocable, player- and project-scoped, renewed by pairing
 *                   again. The browser's 30 minutes would have signed a player out of the world mid-mission.
 *
 * Browser grants and sessions keep their own lifetimes above; nothing here widens them.
 */
export const NATIVE_PAIRING_TTL_MS = 5 * 60_000;
export const NATIVE_SESSION_TTL_MS = 8 * 60 * 60_000;

/** A project id a native grant may be bound to. Conservative on purpose: it travels into every world query. */
export const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function isValidProjectId(value: unknown): value is string {
  return typeof value === 'string' && PROJECT_ID_PATTERN.test(value);
}

export type GrantFailure =
  | 'not_found'
  | 'expired'
  | 'already_consumed'
  | 'origin_mismatch'
  | 'invalid_secret';

/**
 * WHAT A SESSION MAY BE.
 *
 * `browser_read_only` is the original scope and the DEFAULT: observation only.
 *
 * `browser_control` exists because the founder decided the website must be a
 * real control surface — able to start a Mission — without the operator
 * credential ever entering a browser. A control session is still minted only
 * by the operator's own CLI, still origin-bound, still short-lived, still
 * revocable, still stored as a hash; what changes is the allowlist below and
 * one more fact bound AT MINT TIME: who the browser acts as. The participant
 * travels in the session, never in the browser's request body, so a browser
 * cannot claim to be anyone the operator did not name.
 *
 * `native_world` is the NATIVE Wonderland desktop client's scope (founder
 * decision, 2026-09-27). It exists because the world's Julius stream needs a
 * PLAYER identity and the only scope that carried one, `browser_control`, can
 * also start, cancel and retry paid missions -- far more than a client that only
 * watches the world needs. So `native_world` carries the participant and may do
 * almost nothing: it is refused by every browser route (`browserSessionMayCall`
 * answers false for it everywhere), and the only routes that accept it -- the
 * world stream -- authorise it themselves through `verifyNativeSession`.
 *
 * It is minted only by a SIGNED-IN PLAYER pairing their OWN client, bound to
 * that player at mint, and bound to `NATIVE_WORLD_AUDIENCE` instead of a web
 * origin, so a browser page can neither redeem one nor present one.
 *
 * `native_social` is the desktop client's SOCIAL scope (founder decision A,
 * 2026-10-01: least privilege, no second identity system). It carries the
 * player and NO project, because friends, messages and parties are a player's,
 * not a project's. It is minted in exactly one way -- `mintNativeSocialSession`,
 * called only after the bridge itself has verified the GitHub identity (the
 * device-flow sign-in, wonderland-native-signin-routes.ts) -- and bound to
 * `NATIVE_SOCIAL_AUDIENCE`. It is invisible to `verifySession` (so no browser
 * route ever sees it) and refused by `verifyNativeSession` (so it can never read
 * the Julius world stream); only `verifyNativeSocialSession` accepts it.
 */
export type BrowserSessionScope = 'browser_read_only' | 'browser_control' | 'native_world' | 'native_social';

/**
 * The audience a native grant and session are bound to, in the place a browser
 * origin would be. It is not an origin any browser can send, which is the
 * point: a web page can never redeem or present a native credential, and a
 * native client never has to spoof a web origin to hold one.
 */
export const NATIVE_WORLD_AUDIENCE = 'wonderland-native://desktop';

/**
 * The audience a NATIVE SOCIAL session is bound to. Distinct from the world
 * audience, so neither native credential can ever be taken for the other.
 */
export const NATIVE_SOCIAL_AUDIENCE = 'wonderland-native://social';

export interface PairingGrantIssue {
  readonly grantId: string;
  /** Returned EXACTLY once, at creation. Never stored, never re-derivable. */
  readonly secret: string;
  readonly origin: string;
  readonly expiresAt: number;
  readonly scope: BrowserSessionScope;
  /** The project a NATIVE grant is bound to; null for every browser grant. */
  readonly projectId: string | null;
}

export interface BrowserSessionIssue {
  readonly sessionId: string;
  /** Returned EXACTLY once, at exchange. */
  readonly token: string;
  readonly origin: string;
  readonly expiresAt: number;
  readonly scope: BrowserSessionScope;
  /** Who a CONTROL session acts as, bound at mint. Null for read-only. */
  readonly participantId: string | null;
  /** The project a NATIVE session is bound to, inherited from its grant. Null for every browser session. */
  readonly projectId: string | null;
}

interface StoredGrant {
  readonly grantId: string;
  readonly secretHash: Buffer;
  readonly origin: string;
  readonly expiresAt: number;
  readonly scope: BrowserSessionScope;
  readonly participantId: string | null;
  readonly projectId: string | null;
  consumedAt: number | null;
}

interface StoredSession {
  readonly sessionId: string;
  readonly tokenHash: Buffer;
  readonly origin: string;
  /** When it was minted (ms since the epoch): the voice re-bind's "newest session wins" (m3) reads it. */
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly scope: BrowserSessionScope;
  readonly participantId: string | null;
  readonly projectId: string | null;
  revokedAt: number | null;
}

/**
 * WHO A CONTROL SESSION MAY ACT AS. One definition, shared by the operator
 * pairing route and the identity sign-in path, so the two can never drift into
 * accepting different participant shapes. A GitHub identity is encoded into this
 * shape upstream (e.g. `ghu-<numericId>`), never a raw `login` that can change.
 */
export const PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export function isValidParticipantId(value: unknown): value is string {
  return typeof value === 'string' && PARTICIPANT_ID_PATTERN.test(value);
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
  /**
   * Scope and participant default to read-only and nobody: a caller that says
   * nothing gets the least. A control grant REQUIRES a participant — a control
   * session with no identity would have to fall back to the request body,
   * which is the thing this design removes.
   */
  createGrant(input: {
    origin: string; now: number; scope?: BrowserSessionScope; participantId?: string | null;
    /** REQUIRED for a native grant: the project the player is pairing their client for. */
    projectId?: string | null;
  }): PairingGrantIssue;
  /** Single-use: a second call with the same grant always fails. */
  consumeGrant(input: {
    grantId: string; secret: string; origin: string; now: number;
  }): { ok: true; session: BrowserSessionIssue } | { ok: false; reason: GrantFailure };
  /**
   * Mint a session directly from an ALREADY-VERIFIED identity — the "Sign in
   * with GitHub" path. This is the ONE place a control session comes into being
   * without the operator token, and it is safe for exactly one reason: the
   * caller has proven WHO this is out of band (a GitHub OAuth code exchanged for
   * an identity), so the participant is a fact GitHub attested, not a claim the
   * browser made. It must therefore be called ONLY after that exchange succeeds
   * — never from a request body. Everything else about the session is identical
   * to a paired one: hashed at rest, origin-bound, short-lived, revocable, and
   * scope-gated. A control session minted here still spends nothing until the
   * beta gate admits its participant and an installation it owns backs the repo.
   */
  mintIdentitySession(input: {
    origin: string; now: number; participantId: string; scope?: BrowserSessionScope;
  }): { ok: true; session: BrowserSessionIssue } | { ok: false; reason: 'invalid_participant' };
  verifySession(input: {
    token: string; origin: string | undefined; now: number;
  }): { ok: true; sessionId: string; scope: BrowserSessionScope; participantId: string | null }
    | { ok: false; reason: GrantFailure };
  /**
   * Verify a NATIVE client's session, and nothing else.
   *
   * `verifySession` deliberately skips the origin check when a request carries
   * no Origin header -- and a native client never sends one. So a BROWSER
   * session token copied into a native client would pass `verifySession`. That
   * copy is exactly what the founder ruled out ("no browser cookie copying"), so
   * an originless caller is verified HERE instead, and this accepts only a
   * `native_world` session bound to `NATIVE_WORLD_AUDIENCE`. A browser session,
   * control or read-only, is refused however valid it is.
   */
  verifyNativeSession(input: {
    token: string; now: number;
  }): { ok: true; sessionId: string; participantId: string; projectId: string }
    | { ok: false; reason: GrantFailure | 'not_native' };
  /**
   * Mint the desktop client's SOCIAL session for a player whose identity the
   * BRIDGE ITSELF has just verified with GitHub (the device-flow sign-in). Like
   * `mintIdentitySession`, it must never be called with a participant taken
   * from a request body. Bound to NATIVE_SOCIAL_AUDIENCE, no project, the native
   * lifetime; hashed at rest and revocable like every other session.
   */
  mintNativeSocialSession(input: {
    now: number; participantId: string;
  }): { ok: true; session: BrowserSessionIssue } | { ok: false; reason: 'invalid_participant' };
  /**
   * Verify a native SOCIAL session, and nothing else: a browser session, a
   * native world session or anything not bound to NATIVE_SOCIAL_AUDIENCE is
   * refused however valid it is (the copy guard, both ways).
   */
  verifyNativeSocialSession(input: {
    token: string; now: number;
  }): { ok: true; sessionId: string; participantId: string; issuedAt: number }
    | { ok: false; reason: GrantFailure | 'not_native_social' };
  /**
   * When a LIVE native social session was issued (ms since the epoch), looked up by its id -- or null: gone (expired, revoked,
   * or never known to this process, since a restart ends every session) or not a native social session. A read: it never sweeps.
   * The voice re-bind's "newest session wins" (MAIN's internal review af2eb058, m-d) asks it about the session that made a binding.
   */
  nativeSocialSessionIssuedAt(input: { sessionId: string; now: number }): number | null;
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
    createGrant({ origin, now, scope = 'browser_read_only', participantId = null, projectId = null }) {
      sweep(now);
      // A SOCIAL session has no grant: it is minted only after the bridge has
      // verified the player with GitHub itself (mintNativeSocialSession).
      if (scope === 'native_social') {
        throw new Error('A native social session is minted only from a bridge-verified identity, never through a grant.');
      }
      // A NATIVE grant is the player authorising their own client, so it must
      // name a real participant, the project it is for, and be bound to the
      // native audience. All three are enforced in the store, not only at the
      // route, for the reason below.
      if (scope === 'native_world') {
        if (!isValidParticipantId(participantId)) {
          throw new Error('A native grant requires the verified participant it acts as.');
        }
        if (!isValidProjectId(projectId)) {
          throw new Error('A native grant is bound to the project it was paired for.');
        }
        if (origin !== NATIVE_WORLD_AUDIENCE) {
          throw new Error('A native grant is bound to the native audience, never to a web origin.');
        }
      }
      // Enforced here as well as at the route, because the store is the last
      // thing standing between "forgot to validate" and a control session
      // that acts as nobody.
      if (scope === 'browser_control' && (participantId === null || participantId.trim() === '')) {
        throw new Error('A control grant requires the participant it acts as.');
      }
      const grantId = randomBytes(9).toString('base64url');
      const secret = randomSecret();
      const expiresAt = now + (scope === 'native_world' ? NATIVE_PAIRING_TTL_MS : GRANT_TTL_MS);
      const boundProject = scope === 'native_world' ? projectId : null;
      grants.set(grantId, {
        grantId, secretHash: sha256(secret), origin, expiresAt,
        scope,
        // Only the two scopes that ACT AS someone keep a participant; a
        // read-only grant never carries one, whatever the caller passed.
        participantId: scope === 'browser_control' || scope === 'native_world' ? participantId : null,
        // Only a native grant is bound to a project; a browser grant never is.
        projectId: boundProject,
        consumedAt: null,
      });
      return { grantId, secret, origin, expiresAt, scope, projectId: boundProject };
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
      const expiresAt = now + (grant.scope === 'native_world' ? NATIVE_SESSION_TTL_MS : SESSION_TTL_MS);
      sessions.set(sessionId, {
        sessionId, tokenHash: sha256(token), origin, expiresAt, issuedAt: now,
        // The session inherits the grant's scope, identity and project EXACTLY.
        // The exchange can never widen what was minted.
        scope: grant.scope,
        participantId: grant.participantId,
        projectId: grant.projectId,
        revokedAt: null,
      });
      return {
        ok: true,
        session: {
          sessionId, token, origin, expiresAt,
          scope: grant.scope, participantId: grant.participantId, projectId: grant.projectId,
        },
      };
    },

    mintIdentitySession({ origin, now, participantId, scope = 'browser_control' }) {
      sweep(now);
      // A NATIVE session comes into being in exactly one way: a signed-in player
      // pairs their own client and the client redeems the grant (consumeGrant).
      // Minting one here would skip the pairing entirely and bind it to a WEB
      // origin, so this is a programming error, refused the way createGrant
      // refuses an ownerless control grant.
      if (scope === 'native_world') {
        throw new Error('A native session is created only by redeeming a native pairing grant.');
      }
      // Nor a SOCIAL one: that is bound to the native social audience, never to
      // a web origin, and has its own mint.
      if (scope === 'native_social') {
        throw new Error('A native social session is minted only by mintNativeSocialSession.');
      }
      // The store is the last thing standing between "forgot to validate" and a
      // session that acts as nobody or as an unbounded string. A control
      // session with no verified participant is exactly what this path exists
      // to prevent, so it is refused here as well as at the route.
      if (scope === 'browser_control' && !isValidParticipantId(participantId)) {
        return { ok: false, reason: 'invalid_participant' };
      }
      const sessionId = randomBytes(9).toString('base64url');
      const token = randomSecret();
      const expiresAt = now + SESSION_TTL_MS;
      sessions.set(sessionId, {
        sessionId, tokenHash: sha256(token), origin, expiresAt, issuedAt: now,
        scope,
        participantId: scope === 'browser_control' ? participantId : null,
        projectId: null,
        revokedAt: null,
      });
      return {
        ok: true,
        session: {
          sessionId, token, origin, expiresAt,
          scope, participantId: scope === 'browser_control' ? participantId : null, projectId: null,
        },
      };
    },

    verifySession({ token, origin, now }) {
      for (const session of sessions.values()) {
        if (!hashMatches(token, session.tokenHash)) continue;
        if (session.revokedAt !== null) return { ok: false, reason: 'already_consumed' };
        if (session.expiresAt <= now) return { ok: false, reason: 'expired' };
        // A NATIVE SOCIAL session reaches no route that verifies here -- not even
        // an originless call, which this method otherwise admits. Its own
        // verifier is the only door it has.
        if (session.scope === 'native_social') return { ok: false, reason: 'origin_mismatch' };
        // A session is bound to the origin it was paired for. A browser that
        // presents it from anywhere else is refused.
        if (origin !== undefined && session.origin !== origin) {
          return { ok: false, reason: 'origin_mismatch' };
        }
        return {
          ok: true,
          sessionId: session.sessionId,
          scope: session.scope,
          participantId: session.participantId,
        };
      }
      return { ok: false, reason: 'not_found' };
    },

    verifyNativeSession({ token, now }) {
      for (const session of sessions.values()) {
        if (!hashMatches(token, session.tokenHash)) continue;
        if (session.revokedAt !== null) return { ok: false, reason: 'already_consumed' };
        if (session.expiresAt <= now) return { ok: false, reason: 'expired' };
        // THE COPY GUARD. Everything else about this token is valid; what it is
        // not is a native credential. A browser session carried into a native
        // client -- the cookie copy the founder ruled out -- stops here.
        if (session.scope !== 'native_world' || session.origin !== NATIVE_WORLD_AUDIENCE) {
          return { ok: false, reason: 'not_native' };
        }
        // A native session with no participant or no project cannot exist
        // (createGrant refuses to mint its grant), but a type is not a proof, so
        // both are checked.
        if (!isValidParticipantId(session.participantId)) return { ok: false, reason: 'not_native' };
        if (!isValidProjectId(session.projectId)) return { ok: false, reason: 'not_native' };
        return { ok: true, sessionId: session.sessionId, participantId: session.participantId, projectId: session.projectId };
      }
      return { ok: false, reason: 'not_found' };
    },

    mintNativeSocialSession({ now, participantId }) {
      sweep(now);
      if (!isValidParticipantId(participantId)) return { ok: false, reason: 'invalid_participant' };
      const sessionId = randomBytes(9).toString('base64url');
      const token = randomSecret();
      const expiresAt = now + NATIVE_SESSION_TTL_MS;
      sessions.set(sessionId, {
        sessionId, tokenHash: sha256(token), origin: NATIVE_SOCIAL_AUDIENCE, expiresAt, issuedAt: now,
        scope: 'native_social', participantId, projectId: null, revokedAt: null,
      });
      return {
        ok: true,
        session: { sessionId, token, origin: NATIVE_SOCIAL_AUDIENCE, expiresAt, scope: 'native_social', participantId, projectId: null },
      };
    },

    verifyNativeSocialSession({ token, now }) {
      for (const session of sessions.values()) {
        if (!hashMatches(token, session.tokenHash)) continue;
        if (session.revokedAt !== null) return { ok: false, reason: 'already_consumed' };
        if (session.expiresAt <= now) return { ok: false, reason: 'expired' };
        // THE COPY GUARD, both ways: a browser session, or a native WORLD
        // session, carried into the social routes stops here.
        if (session.scope !== 'native_social' || session.origin !== NATIVE_SOCIAL_AUDIENCE) {
          return { ok: false, reason: 'not_native_social' };
        }
        if (!isValidParticipantId(session.participantId)) return { ok: false, reason: 'not_native_social' };
        return { ok: true, sessionId: session.sessionId, participantId: session.participantId, issuedAt: session.issuedAt };
      }
      return { ok: false, reason: 'not_found' };
    },

    nativeSocialSessionIssuedAt({ sessionId, now }) {
      const session = sessions.get(sessionId);
      if (session === undefined || session.revokedAt !== null || session.expiresAt <= now) return null;
      if (session.scope !== 'native_social' || session.origin !== NATIVE_SOCIAL_AUDIENCE) return null;
      return session.issuedAt;
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
  // Reading one mission's state. Starting, cancelling and retrying a mission
  // are NOT here: they run real work and belong to an operator.
  /^\/mission\/[^/]+$/,
  // The caller's own mission history — a read that spends nothing and the
  // server scopes to the session's participant, so a browser only ever lists
  // its own. Plural, so it does not overlap the single-mission read above.
  /^\/missions$/,
  // Hosted Coding Agent, read-only. Readiness is free and offline; status and
  // inspect describe a run that already happened. Starting, stopping and
  // retrying a hosted run are deliberately absent — each either spends a
  // provider credential or changes a run in flight, so each needs an operator.
  /^\/hosted-coding\/readiness$/,
  /^\/hosted-coding\/status\/[^/]+$/,
  /^\/hosted-coding\/inspect\/[^/]+$/,
] as const;

/**
 * The routes a CONTROL session may additionally reach — the mission family's
 * spending verbs, and ONLY those. Deliberately absent: reviewer verify (a paid
 * probe outside any mission), hosted-coding start/stop (reachable only inside
 * a mission's own pipeline), cron, beta administration, and minting grants or
 * sessions — a session that could mint sessions would be a key that copies
 * itself.
 */
const BROWSER_CONTROL_WRITABLE = [
  /^\/mission\/start$/,
  /^\/mission\/[^/]+\/cancel$/,
  /^\/mission\/[^/]+\/retry$/,
] as const;

export function browserSessionMayCall(
  method: string,
  path: string,
  scope: BrowserSessionScope = 'browser_read_only',
): boolean {
  // A native session is not a browser session and reaches NO browser route --
  // not even the read-only ones, because it acts as a player and none of those
  // routes were written expecting one from outside a browser. The world stream,
  // the only thing it exists for, authorises it separately (verifyNativeSession).
  if (scope === 'native_world' || scope === 'native_social') return false;
  if (method === 'GET') return BROWSER_READABLE.some((pattern) => pattern.test(path));
  if (method === 'POST' && scope === 'browser_control') {
    return BROWSER_CONTROL_WRITABLE.some((pattern) => pattern.test(path));
  }
  return false;
}
