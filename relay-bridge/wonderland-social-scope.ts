/**
 * THE WONDERLAND DESKTOP CLIENT'S SOCIAL CAPABILITY -- least privilege, designed before it is granted.
 *
 * FOUNDER DECISION A (2026-10-01): "Widen the Wonderland desktop session architecture so the Unreal client can use the
 * authenticated SOCIAL routes. Do NOT turn this into unrestricted Relay Bridge/backend access. Use least privilege …
 * Preserve the existing authenticated player identity. Do not create a second identity system. Design the permission
 * boundary now. Do not deploy or widen production permissions during the RC8 critical path."
 *
 * WHAT EXISTS. A NATIVE session (browser-session/grants.ts, scope `native_world`) is minted only by a signed-in player
 * pairing their OWN desktop client, bound to that player at mint and to NATIVE_WORLD_AUDIENCE, and it reaches nothing but the
 * Julius world stream: `browserSessionMayCall` refuses it every route, and the Wonderland write routes refuse it by name.
 *
 * WHAT THIS ADDS -- AS A DESIGN, NOT WIRED. The same native session, the same player, plus ONE capability, `social`, that the
 * player grants at pairing. The capability admits exactly the operations in SOCIAL_OPERATIONS below -- method and path, one
 * table, every line a reviewer can read -- and nothing else under any prefix. The actor of every operation is the session's
 * own player: a body that names somebody else as the actor is refused (`bindSocialActor`), so the capability can only ever
 * act as the person who paired the client.
 *
 * WHAT IT NEVER REACHES: the project event stream and project presence (/wonderland/events, /wonderland/presence/*),
 * challenges, battles, the Project Brain, missions, the architect and reviewer routes, Julius, MCP, the executor, and every
 * other bridge capability. Credentials, prompts, Brain data, provider secrets and mission state are not in any social view
 * (src/relay/social/social-contracts.ts NEVER_SOCIAL_CONCERNS), so even an admitted call cannot return them.
 *
 * To deploy (after RC8, with the founder's OK): add `capabilities` to the native grant/session records, ask the player at
 * pairing, route `/wonderland/social/*` through `nativeSocialMayCall` + `bindSocialActor`, and serve them from the social
 * domain. Until then this module changes no production behaviour.
 */

export const NATIVE_SOCIAL_CAPABILITY = 'social' as const;

export type { SocialOperationId } from '../src/relay/social/social-contracts';
import type { SocialOperationId } from '../src/relay/social/social-contracts';

export interface SocialOperation {
  readonly id: SocialOperationId;
  readonly method: 'GET' | 'POST';
  /** Anchored, segment-safe: ids are [A-Za-z0-9_-]{1,80}; nothing else matches. */
  readonly pattern: RegExp;
  /** The path as written in the table ("/parties/:id/members/:id/remove"): where each id sits. */
  readonly template: string;
  readonly writes: boolean;
}

const ID = '[A-Za-z0-9_-]{1,80}';
const p = (path: string) => new RegExp(`^/wonderland/social${path.replace(/:id/g, ID)}$`);

/** THE TABLE. The founder's list, one operation per line; anything not here is refused. */
export const SOCIAL_OPERATIONS: readonly SocialOperation[] = Object.freeze([
  // ONE READ OF EVERYTHING THE READS BELOW RETURN, for this viewer, as one view: the client's whole social screen in one call.
  // Adds nothing a viewer could not already read operation by operation.
  { id: 'snapshot.read', method: 'GET', pattern: p('/snapshot'), template: '/snapshot', writes: false },
  { id: 'profile.read', method: 'GET', pattern: p('/profiles/:id'), template: '/profiles/:id', writes: false },
  { id: 'presence.read', method: 'GET', pattern: p('/presence'), template: '/presence', writes: false },
  { id: 'presence.update_self', method: 'POST', pattern: p('/presence'), template: '/presence', writes: true },
  { id: 'privacy.read_self', method: 'GET', pattern: p('/privacy'), template: '/privacy', writes: false },
  { id: 'privacy.update_self', method: 'POST', pattern: p('/privacy'), template: '/privacy', writes: true },
  { id: 'friends.list', method: 'GET', pattern: p('/friends'), template: '/friends', writes: false },
  { id: 'friends.remove', method: 'POST', pattern: p('/friends/:id/remove'), template: '/friends/:id/remove', writes: true },
  { id: 'requests.list', method: 'GET', pattern: p('/requests'), template: '/requests', writes: false },
  { id: 'requests.send', method: 'POST', pattern: p('/requests'), template: '/requests', writes: true },
  { id: 'requests.accept', method: 'POST', pattern: p('/requests/:id/accept'), template: '/requests/:id/accept', writes: true },
  { id: 'requests.decline', method: 'POST', pattern: p('/requests/:id/decline'), template: '/requests/:id/decline', writes: true },
  { id: 'requests.cancel', method: 'POST', pattern: p('/requests/:id/cancel'), template: '/requests/:id/cancel', writes: true },
  { id: 'blocks.add', method: 'POST', pattern: p('/blocks'), template: '/blocks', writes: true },
  { id: 'blocks.remove', method: 'POST', pattern: p('/blocks/:id/remove'), template: '/blocks/:id/remove', writes: true },
  { id: 'mutes.set', method: 'POST', pattern: p('/mutes'), template: '/mutes', writes: true },
  { id: 'reports.file', method: 'POST', pattern: p('/reports'), template: '/reports', writes: true },
  { id: 'recent.list', method: 'GET', pattern: p('/recent-players'), template: '/recent-players', writes: false },
  { id: 'conversations.list', method: 'GET', pattern: p('/conversations'), template: '/conversations', writes: false },
  { id: 'conversations.open', method: 'POST', pattern: p('/conversations'), template: '/conversations', writes: true },
  { id: 'messages.list', method: 'GET', pattern: p('/conversations/:id/messages'), template: '/conversations/:id/messages', writes: false },
  { id: 'messages.send', method: 'POST', pattern: p('/conversations/:id/messages'), template: '/conversations/:id/messages', writes: true },
  { id: 'messages.read', method: 'POST', pattern: p('/conversations/:id/read'), template: '/conversations/:id/read', writes: true },
  { id: 'parties.read', method: 'GET', pattern: p('/parties/:id'), template: '/parties/:id', writes: false },
  { id: 'parties.create', method: 'POST', pattern: p('/parties'), template: '/parties', writes: true },
  { id: 'parties.join', method: 'POST', pattern: p('/parties/:id/join'), template: '/parties/:id/join', writes: true },
  { id: 'parties.leave', method: 'POST', pattern: p('/parties/:id/leave'), template: '/parties/:id/leave', writes: true },
  { id: 'parties.invite', method: 'POST', pattern: p('/parties/:id/invites'), template: '/parties/:id/invites', writes: true },
  { id: 'parties.remove_member', method: 'POST', pattern: p('/parties/:id/members/:id/remove'), template: '/parties/:id/members/:id/remove', writes: true },
  { id: 'parties.promote', method: 'POST', pattern: p('/parties/:id/leader'), template: '/parties/:id/leader', writes: true },
  { id: 'parties.rules', method: 'POST', pattern: p('/parties/:id/rules'), template: '/parties/:id/rules', writes: true },
  { id: 'parties.self_mute', method: 'POST', pattern: p('/parties/:id/self-mute'), template: '/parties/:id/self-mute', writes: true },
  { id: 'party_invites.list', method: 'GET', pattern: p('/party-invites'), template: '/party-invites', writes: false },
  { id: 'party_invites.accept', method: 'POST', pattern: p('/party-invites/:id/accept'), template: '/party-invites/:id/accept', writes: true },
  { id: 'party_invites.decline', method: 'POST', pattern: p('/party-invites/:id/decline'), template: '/party-invites/:id/decline', writes: true },
  { id: 'showcase.read', method: 'GET', pattern: p('/profiles/:id/showcase'), template: '/profiles/:id/showcase', writes: false },
  { id: 'events.stream', method: 'GET', pattern: p('/events'), template: '/events', writes: false },
]);

/** What the authorisation needs of a verified session; the same fields grants.ts already holds, plus the capability list. */
export interface NativeSocialSessionFacts {
  readonly scope: 'browser_read_only' | 'browser_control' | 'native_world';
  /** The player the session was minted for. The ONLY actor it can ever be. */
  readonly participantId: string | null;
  /** Granted at pairing. Absent today: no production session carries `social`. */
  readonly capabilities: readonly string[];
}

/**
 * MAY THIS SESSION CALL THIS? The operation it is, or null. Refused unless: a native session, bound to a player, holding the
 * `social` capability, with a path that is exactly one operation's (no query-string or encoded-segment tricks: the path is
 * matched as given and must contain no '..', '%' or '//').
 */
export function nativeSocialMayCall(method: string, path: string, session: NativeSocialSessionFacts): SocialOperation | null {
  if (session.scope !== 'native_world' || session.participantId === null) return null;
  if (!session.capabilities.includes(NATIVE_SOCIAL_CAPABILITY)) return null;
  if (path.includes('..') || path.includes('%') || path.includes('//')) return null;
  return SOCIAL_OPERATIONS.find((op) => op.method === method && op.pattern.test(path)) ?? null;
}

/** Body fields that name an ACTOR. The actor is the session's player; a body may not choose another. */
const ACTOR_FIELDS = ['actorId', 'fromUserId', 'senderId', 'muterId', 'blockerId', 'reporterId', 'ownerId', 'inviterId'] as const;

/**
 * BIND THE ACTOR. Returns the session's player as the actor, or an error if the body tries to name a different one. Subject
 * fields (who is being messaged, invited, blocked …) are the operation's business and are checked by the domain rules.
 */
export function bindSocialActor(session: NativeSocialSessionFacts, body: unknown): { ok: true; actorId: string } | { ok: false; error: string } {
  if (session.participantId === null) return { ok: false, error: 'no player bound to this session' };
  if (body !== null && typeof body === 'object') {
    for (const field of ACTOR_FIELDS) {
      const value = (body as Record<string, unknown>)[field];
      if (value !== undefined && value !== session.participantId) return { ok: false, error: `${field} must be the session's own player` };
    }
  }
  return { ok: true, actorId: session.participantId };
}
