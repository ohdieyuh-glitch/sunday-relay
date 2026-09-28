import { bearerMatches } from './reviewer-routes';
import {
  isValidParticipantId,
  isValidProjectId,
  NATIVE_WORLD_AUDIENCE,
  type BrowserSessionStore,
} from './browser-session/grants';
import { sessionTokenFrom } from './browser-session/routes';
import { WONDERLAND_WORLD_CAPABILITY, type WonderlandProjectMembershipSource } from './wonderland-julius-routes';
import { authorizeWonderlandProjectCapability } from '../src/relay/mission/wonderland/wonderland-authorization';

/**
 * NATIVE WONDERLAND CLIENT PAIRING.
 *
 * Founder decision, 2026-09-27: a signed-in Wonderland player authorises their
 * OWN native desktop client, with a short-lived single-use code, and the client
 * receives its own narrowly-scoped session for the Julius world stream.
 *
 *   POST /wonderland/native/pair     A SIGNED-IN PLAYER, from the website, mints a
 *                                    single-use code for their own client. The
 *                                    player is taken from THEIR session -- never
 *                                    from the request body -- and the operator
 *                                    credential is refused outright: an operator
 *                                    is not a player, and a native session must
 *                                    never be one wearing a player's name.
 *
 *   POST /wonderland/native/session  THE NATIVE CLIENT redeems the code for a
 *                                    `native_world` session. A request that
 *                                    carries a web Origin is refused, so no page
 *                                    can redeem a native code; and the client
 *                                    never has to spoof an origin, because the
 *                                    credential is bound to NATIVE_WORLD_AUDIENCE.
 *
 *   POST /wonderland/native/revoke   The native client ends its own session.
 *
 * WHAT IS REUSED, AND WHY NOTHING NEW WAS NEEDED FOR THE HARD PARTS. The code is
 * a pairing grant from the existing store: 256-bit secret, stored only as a
 * SHA-256 hash, compared in constant time, single-use and burnt before anything
 * else happens. The session is the store's session: hashed at rest, revocable,
 * in memory so a bridge restart revokes every one of them. What IS new is only
 * the scope (`native_world`), the audience and the project binding, which is why
 * the founder's "no second identity system" holds.
 *
 * LIFETIMES AND SCOPE (founder decision 2, 2026-09-27). The CODE lives 5 minutes
 * and dies on redemption; the SESSION lives 8 hours and is renewed by pairing
 * again. Both are bound to the player AND to one project: the website names the
 * project it is pairing for, the player must be a member of it, and the session
 * is refused for any other project -- on top of the membership check the world
 * routes make on every request.
 *
 * WHAT A NATIVE SESSION CAN DO. Read the Julius world stream --
 * /wonderland/julius/hydrate and /events -- for the ONE project it was paired for.
 * Nothing else: every browser route refuses it, the battle and presence routes
 * refuse it, and it can mint no grant and no session.
 *
 * WHAT IS DELIBERATELY NOT HERE. A silent refresh: after 8 hours, or a bridge
 * restart, the client pairs again. A device-code flow can replace this later
 * without touching the transport, which only ever sees a token source.
 */

export const NATIVE_PAIRING_PREFIX = '/wonderland/native/';

export interface NativePairingRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  readonly body: unknown;
  readonly now: number;
  /** The operator credential, so this route can REFUSE it by name. */
  readonly operatorToken: string | undefined;
}

export interface NativePairingResult {
  readonly status: number;
  readonly body: unknown;
}

const ok = (data: unknown): NativePairingResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): NativePairingResult =>
  ({ status, body: { error: { kind, message } } });

/** One answer for every way a code can be wrong, so a probe learns nothing. */
const PAIRING_FAILED = (): NativePairingResult => err(401, 'pairing_failed',
  'This pairing code is invalid, expired or already used. Pair again from the signed-in Wonderland website.');

export function isNativePairingRoute(path: string): boolean {
  return path.startsWith(NATIVE_PAIRING_PREFIX);
}

/** A code is `<grantId>.<secret>`; both halves are base64url, so neither contains a dot. */
function parseCode(body: unknown): { grantId: string; secret: string } | null {
  if (body === null || typeof body !== 'object') return null;
  const code = (body as Record<string, unknown>).code;
  if (typeof code !== 'string') return null;
  const match = /^([A-Za-z0-9_-]{8,32})\.([A-Za-z0-9_-]{32,128})$/.exec(code.trim());
  return match === null ? null : { grantId: match[1], secret: match[2] };
}

export interface NativePairingDeps {
  readonly store: BrowserSessionStore;
  /** Who belongs to which project -- the world routes' own source. Null when this bridge has no world database. */
  readonly membership: WonderlandProjectMembershipSource | null;
}

export async function handleNativePairingRoute(
  request: NativePairingRequest,
  deps: NativePairingDeps,
): Promise<NativePairingResult | null> {
  if (!isNativePairingRoute(request.path)) return null;
  const { store } = deps;
  const { method, path, now } = request;

  /* -------------------------------------------------- a player pairs */
  if (path === '/wonderland/native/pair') {
    if (method !== 'POST') return err(405, 'method_not_allowed', 'Pairing is a POST.');
    // THE OPERATOR IS NOT A PLAYER. The operator credential can do almost
    // anything on this bridge, which is exactly why it must not be able to
    // mint a session that acts as some player's native client.
    if (bearerMatches(request.authorization, request.operatorToken)) {
      return err(403, 'operator_is_not_a_player',
        'A native client is paired by the signed-in player it will act as. The operator credential cannot pair one.');
    }
    const token = sessionTokenFrom(request.authorization);
    if (token === null) {
      return err(401, 'sign_in_required', 'Sign in to Wonderland on the website, then pair your desktop client from there.');
    }
    // A player pairs from THE WEBSITE, which sends its Origin. An originless
    // caller here would be a native client trying to pair another native
    // client, and a native session is not allowed to mint anything.
    if (request.origin === undefined) {
      return err(401, 'sign_in_required', 'Pairing starts from the signed-in Wonderland website.');
    }
    const verified = store.verifySession({ token, origin: request.origin, now });
    if (!verified.ok || verified.scope !== 'browser_control' || !isValidParticipantId(verified.participantId)) {
      return err(401, 'sign_in_required', 'This session cannot pair a desktop client. Sign in to Wonderland first.');
    }
    // WHICH PROJECT. The body names it -- it is a request to be authorised,
    // never an authorisation: the player must be a MEMBER of it, and the code,
    // and the session it becomes, are bound to it and to nothing else.
    const projectId = request.body !== null && typeof request.body === 'object'
      ? (request.body as Record<string, unknown>).projectId : undefined;
    if (!isValidProjectId(projectId)) {
      return err(400, 'project_required', 'Pair for a project: send the projectId of the world this client will follow.');
    }
    // FAIL CLOSED: a bridge that cannot say who belongs to a project pairs no one.
    if (deps.membership === null) {
      return err(503, 'membership_unavailable', 'This bridge cannot check project membership, so it cannot pair a desktop client.');
    }
    let member: Awaited<ReturnType<WonderlandProjectMembershipSource['lookup']>> = null;
    try {
      member = await deps.membership.lookup({ playerId: verified.participantId, projectId });
    } catch {
      return err(503, 'membership_unavailable', 'Project membership could not be checked; nothing was paired.');
    }
    // THE WORLD ROUTES' OWN QUESTION, asked of the same row: may this player read this project's world? A row
    // alone is not enough -- a role this build grants nothing to would pair a client the world then refuses.
    const decision = authorizeWonderlandProjectCapability(
      { playerId: verified.participantId, projectId, capability: WONDERLAND_WORLD_CAPABILITY }, member);
    if (!decision.granted) {
      return err(403, 'not_a_project_member', 'You can pair a desktop client only for a project you belong to.');
    }
    // The participant comes from the SESSION. The request body is not read for
    // identity at all, so no one can pair a client as somebody else.
    const grant = store.createGrant({
      origin: NATIVE_WORLD_AUDIENCE,
      now,
      scope: 'native_world',
      participantId: verified.participantId,
      projectId,
    });
    return ok({
      code: `${grant.grantId}.${grant.secret}`,
      expiresAt: new Date(grant.expiresAt).toISOString(),
      audience: NATIVE_WORLD_AUDIENCE,
      participantId: verified.participantId,
      projectId,
    });
  }

  /* ------------------------------------------ the native client redeems */
  if (path === '/wonderland/native/session') {
    if (method !== 'POST') return err(405, 'method_not_allowed', 'Redeeming a code is a POST.');
    // A web page always sends its Origin, so this is the line that keeps a
    // native code out of a browser -- and the reason the client never has to
    // pretend to be one.
    if (request.origin !== undefined) {
      return err(403, 'native_client_only', 'A native pairing code is redeemed by the Wonderland desktop client, not from a web page.');
    }
    const code = parseCode(request.body);
    if (code === null) return PAIRING_FAILED();
    const result = store.consumeGrant({ grantId: code.grantId, secret: code.secret, origin: NATIVE_WORLD_AUDIENCE, now });
    if (!result.ok) return PAIRING_FAILED();
    // The grant was burnt by consumeGrant. If it somehow was not a native grant
    // (a browser grant can only be bound to a web origin, so this cannot happen
    // through any route), do not hand out whatever it produced.
    if (result.session.scope !== 'native_world' || !isValidParticipantId(result.session.participantId)
      || !isValidProjectId(result.session.projectId)) {
      store.revokeSession({ token: result.session.token, now });
      return PAIRING_FAILED();
    }
    return ok({
      token: result.session.token,
      expiresAt: new Date(result.session.expiresAt).toISOString(),
      participantId: result.session.participantId,
      projectId: result.session.projectId,
      audience: NATIVE_WORLD_AUDIENCE,
    });
  }

  /* ----------------------------------------- the native client signs out */
  if (path === '/wonderland/native/revoke') {
    if (method !== 'POST') return err(405, 'method_not_allowed', 'Revoking is a POST.');
    if (request.origin !== undefined) {
      return err(403, 'native_client_only', 'A native session is revoked by the Wonderland desktop client.');
    }
    const token = sessionTokenFrom(request.authorization);
    if (token === null || !store.verifyNativeSession({ token, now }).ok) {
      return err(401, 'not_signed_in', 'There is no native session to revoke.');
    }
    store.revokeSession({ token, now });
    return ok({ revoked: true });
  }

  return err(404, 'unknown_native_route', 'Native pairing serves /wonderland/native/pair, /session and /revoke.');
}
