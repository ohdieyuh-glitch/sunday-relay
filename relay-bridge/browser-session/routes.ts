import { bearerMatches, BRIDGE_TOKEN_ENV, type ReviewerRouteResult } from '../reviewer-routes';
import {
  browserSessionMayCall, type BrowserSessionStore,
} from './grants';

/**
 * THE BROWSER PAIRING ROUTES.
 *
 * Three endpoints, and the asymmetry between them is the whole design:
 *
 *   POST /browser/pair     OPERATOR only. Mints a single-use grant. This is
 *                          the one place a browser credential is created, and
 *                          it costs the operator token to reach.
 *   POST /browser/session  PUBLIC, but useless without a valid grant AND the
 *                          matching Origin. Exchanges a grant for a session.
 *   POST /browser/revoke   Presents the session it wants to destroy.
 *
 * Nothing here ever returns the operator token, and no response repeats a
 * secret that was sent to it.
 */

export const BROWSER_PREFIX = '/browser/';

const ok = (data: unknown): ReviewerRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): ReviewerRouteResult =>
  ({ status, body: { kind, error: message } });

export function isBrowserSessionRoute(path: string): boolean {
  return path.startsWith(BROWSER_PREFIX);
}

function stringField(body: unknown, field: string): string | null {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** `Authorization: Relay-Session <token>` — deliberately not `Bearer`, so a
    browser session can never be mistaken for the operator credential. */
export function sessionTokenFrom(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Relay-Session\s+(.+)$/i.exec(header.trim());
  return match === null ? null : match[1];
}

export interface BrowserRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  readonly body: unknown;
  readonly env: NodeJS.ProcessEnv;
  readonly now: number;
  /** The exact origins this bridge admits. A grant may target only these. */
  readonly allowedOrigins: readonly string[];
}

export function handleBrowserSessionRoute(
  request: BrowserRouteRequest,
  store: BrowserSessionStore,
): ReviewerRouteResult | null {
  const { method, path, env, now } = request;
  if (!isBrowserSessionRoute(path)) return null;

  /* ------------------------------------------------- mint a grant (op) --- */
  if (method === 'POST' && path === '/browser/pair') {
    // Operator credential required. This is the only way a browser credential
    // comes into existence, so it is the one gate that matters most.
    if (!bearerMatches(request.authorization, env[BRIDGE_TOKEN_ENV])) {
      return err(401, 'authentication_failed', 'Pairing requires operator authentication.');
    }
    const requested = stringField(request.body, 'origin');
    if (requested === null) {
      return err(422, 'validation_failed', 'pair requires the exact browser origin.');
    }
    // A grant may only ever target an origin this bridge already admits, so
    // pairing cannot widen the CORS policy by the back door.
    if (!request.allowedOrigins.includes(requested)) {
      return err(422, 'validation_failed', 'That origin is not allowed by this bridge.');
    }
    const grant = store.createGrant({ origin: requested, now });
    return ok({
      grantId: grant.grantId,
      // Returned once, and never recoverable afterwards.
      grantSecret: grant.secret,
      origin: grant.origin,
      expiresAt: new Date(grant.expiresAt).toISOString(),
      expiresInSeconds: Math.round((grant.expiresAt - now) / 1000),
    });
  }

  /* ------------------------------------------ exchange a grant (browser) -- */
  if (method === 'POST' && path === '/browser/session') {
    const grantId = stringField(request.body, 'grantId');
    const grantSecret = stringField(request.body, 'grantSecret');
    if (grantId === null || grantSecret === null) {
      return err(422, 'validation_failed', 'session requires grantId and grantSecret.');
    }
    if (request.origin === undefined) {
      // A grant is origin-bound, so an originless caller can never redeem one.
      return err(403, 'authorization_required', 'Pairing must be completed from the approved origin.');
    }
    const result = store.consumeGrant({
      grantId, secret: grantSecret, origin: request.origin, now,
    });
    if (!result.ok) {
      // ONE message for every failure mode. Distinguishing "expired" from
      // "already used" from "wrong secret" would tell an attacker which half
      // of a guess was right.
      return err(401, 'authentication_failed', 'That pairing grant is not usable.');
    }
    return ok({
      sessionToken: result.session.token,
      scope: result.session.scope,
      origin: result.session.origin,
      expiresAt: new Date(result.session.expiresAt).toISOString(),
      expiresInSeconds: Math.round((result.session.expiresAt - now) / 1000),
    });
  }

  /* -------------------------------------------------------- revoke ------- */
  if (method === 'POST' && path === '/browser/revoke') {
    const token = sessionTokenFrom(request.authorization);
    if (token === null) {
      return err(401, 'authentication_failed', 'Revocation requires the session it destroys.');
    }
    // Idempotent: revoking an unknown or already-revoked session still
    // succeeds, so a client can always reach a known-clean state.
    store.revokeSession({ token, now });
    return ok({ revoked: true });
  }

  return err(422, 'validation_failed', 'Unknown browser session operation.');
}

/**
 * Who may call a reviewer route.
 *
 * The operator may call anything. A browser session may call only the
 * read-only subset, and only from the origin it was paired for.
 */
export type CallerDecision =
  | { readonly kind: 'operator' }
  | { readonly kind: 'browser'; readonly sessionId: string }
  | { readonly kind: 'rejected'; readonly status: number; readonly message: string };

export function authorizeReviewerCall(input: {
  method: string;
  path: string;
  authorization: string | undefined;
  origin: string | undefined;
  env: NodeJS.ProcessEnv;
  now: number;
  store: BrowserSessionStore;
}): CallerDecision {
  if (bearerMatches(input.authorization, input.env[BRIDGE_TOKEN_ENV])) {
    return { kind: 'operator' };
  }

  const token = sessionTokenFrom(input.authorization);
  if (token === null) {
    return { kind: 'rejected', status: 401, message: 'Authentication is required for Reviewer operations.' };
  }

  const verified = input.store.verifySession({ token, origin: input.origin, now: input.now });
  if (!verified.ok) {
    // An expired, revoked, unknown or wrong-origin session are one answer.
    return { kind: 'rejected', status: 401, message: 'This browser session is no longer valid.' };
  }
  if (!browserSessionMayCall(input.method, input.path)) {
    // Authenticated, but not permitted — and the reply says which, because a
    // browser legitimately needs to know it must ask an operator.
    return {
      kind: 'rejected',
      status: 403,
      message: 'A browser session may only read Reviewer state. This action requires an operator.',
    };
  }
  return { kind: 'browser', sessionId: verified.sessionId };
}
