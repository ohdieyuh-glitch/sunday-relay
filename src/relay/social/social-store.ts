/**
 * WONDERLAND SOCIAL — where the one social state lives on the server, and how a change reaches the people it concerns.
 *
 * A STORE is three things:
 *   - `apply`: one operation, ATOMIC. Commands run one at a time against the current state (social-commands.ts); a refusal
 *     changes nothing; a change is kept and an EVENT is written for exactly its audience.
 *   - `eventsFor`: a player's events after a sequence number. An event says only WHICH operation changed something that
 *     concerns them and when -- never its content. The client refreshes its view (snapshot.read), so what it then sees is
 *     what the presence authority lets it see, not what an event carried. A gap (events older than the log keeps) says
 *     `reset`, and the client refreshes from scratch.
 *   - `ensureUser`: a signed-in player's social record, created on first contact with the defaults every new player gets
 *     (Relay OG, rank and level PENDING, the default privacy, offline until their client reports presence).
 *
 * `createInMemorySocialStore` is the development and test store: correct, atomic within one process, gone on restart.
 * Persistence (032_wonderland_social.sql) implements the same interface.
 */

import { relayError, type RelayResult } from '../protocol/errors';
import {
  PENDING_PROGRESSION,
  defaultPrivacySettings,
  type SocialOperationId,
  type SocialUserId,
  type UserPresence,
  type UserProfile,
} from './social-contracts';
import { applySocialOperation, type SocialCommandInput } from './social-commands';
import { emptySocialState, type SocialState, type SocialUserRecord } from './social-state';
import { emptyWorldState, type WorldState } from './world-presence';

/** What a change says to the people it concerns: which operation, and when. Nothing of its content. */
export interface SocialEvent {
  readonly seq: number;
  readonly op: SocialOperationId;
  readonly atIso: string;
}

export interface SocialEventPage {
  readonly events: readonly SocialEvent[];
  /**
   * Where THIS viewer's cursor now stands; ask again with `after` = this. It is the viewer's own: the last event of a page cut
   * short, else the newest event addressed to them -- never the log's global newest, which moved whenever ANYBODY acted and so
   * told a walled player that the person behind the wall was busy (Second's R16 run, 10-04). Never below `after`, and never
   * below the log's retention edge (oldest - 1), so a quiet viewer is not told to reset forever.
   */
  readonly latest: number;
  /** True when events after `after` have already left the log: refresh the whole view. */
  readonly reset: boolean;
}

/** The viewer's cursor after a page (see SocialEventPage.latest). */
export function viewerCursor(input: { after: number; page: readonly SocialEvent[]; truncated: boolean; viewerNewest: number | null; oldest: number | null }): number {
  if (input.truncated && input.page.length > 0) return input.page[input.page.length - 1].seq;
  return Math.max(input.after, input.viewerNewest ?? 0, input.oldest === null ? 0 : input.oldest - 1);
}

/** Who a signed-in player is, from the account they paired with: enough to make their social record on first contact. */
export interface SocialPlayerIdentity {
  readonly userId: SocialUserId;
  readonly displayName: string;
  readonly handle: string;
}

export interface SocialStore {
  read(): Promise<SocialState>;
  ensureUser(identity: SocialPlayerIdentity, nowIso: string): Promise<void>;
  apply(op: SocialOperationId, actorId: SocialUserId, input: SocialCommandInput, nowIso: string): Promise<RelayResult<unknown>>;
  eventsFor(userId: SocialUserId, after: number, limit: number): Promise<SocialEventPage>;
}

const DISPLAY_NAME_MAX = 40;

/** THE NEW PLAYER'S RECORD. Everything public starts minimal: no agent, no companion, nothing shown until the player chooses. */
export function newSocialUser(identity: SocialPlayerIdentity, nowIso: string): SocialUserRecord {
  const displayName = identity.displayName.trim().slice(0, DISPLAY_NAME_MAX) || 'Player';
  const profile: UserProfile = {
    userId: identity.userId,
    displayName,
    handle: identity.handle.trim() || `@${identity.userId}`,
    avatarRef: `generated:${identity.userId}`,
    nationId: null,
    clanName: null,
    progression: PENDING_PROGRESSION,
    primaryAgent: null,
    relayDog: { skinId: 'relay_og', primary: null, secondary: null, flame: null, appearanceTier: null },
    activeCompanion: null,
    showcaseAgents: [],
    showcaseCompanions: [],
    stats: [],
    memberSinceIso: nowIso,
  };
  const presence: UserPresence = {
    userId: identity.userId,
    connected: false,
    availability: 'AVAILABLE',
    activity: 'IDLE',
    activityDetail: null,
    location: null,
    partyId: null,
    lastSeenAtIso: nowIso,
    updatedAtIso: nowIso,
  };
  return { profile, privacy: defaultPrivacySettings(identity.userId), presence };
}

/** The state with this player in it (unchanged if they already are). */
export function ensureSocialUser(state: SocialState, identity: SocialPlayerIdentity, nowIso: string): SocialState {
  if (state.users[identity.userId] !== undefined) return state;
  return { ...state, users: { ...state.users, [identity.userId]: newSocialUser(identity, nowIso) } };
}

interface StoredEvent extends SocialEvent {
  readonly audience: ReadonlySet<SocialUserId>;
}

export interface InMemorySocialStoreOptions {
  /** How many events the log keeps before the oldest go (a client further behind is told to refresh). */
  readonly maxEvents?: number;
}

/** The development and test store: one process, atomic, nothing survives a restart. */
export function createInMemorySocialStore(initial: SocialState = emptySocialState(), options: InMemorySocialStoreOptions = {}): SocialStore {
  const maxEvents = Math.max(1, options.maxEvents ?? 10_000);
  let state = initial;
  // THE SHARED PRESENCE LAYER: real-time, in memory only (world-presence.ts).
  let world: WorldState = emptyWorldState();
  let seq = 0;
  const log: StoredEvent[] = [];
  // ONE AT A TIME: every command waits for the one before it, so no two read the same state and both write.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => T): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };

  return {
    read: () => serial(() => state),
    ensureUser: (identity, nowIso) =>
      serial(() => {
        state = ensureSocialUser(state, identity, nowIso);
      }),
    apply: (op, actorId, input, nowIso) =>
      serial((): RelayResult<unknown> => {
        if (state.users[actorId] === undefined) return { ok: false, error: relayError('not-found', 'no social record for this player') };
        const outcome = applySocialOperation(state, op, actorId, input, nowIso, world);
        if (!outcome.ok) return outcome;
        if (outcome.value.world !== undefined) world = outcome.value.world;
        if (outcome.value.state !== state || (outcome.value.audience.length > 0 && op.startsWith('world.'))) {
          state = outcome.value.state;
          if (outcome.value.audience.length > 0) {
            seq += 1;
            log.push({ seq, op: outcome.value.eventOp ?? op, atIso: nowIso, audience: new Set(outcome.value.audience) });
            if (log.length > maxEvents) log.splice(0, log.length - maxEvents);
          }
        }
        return { ok: true, value: outcome.value.data };
      }),
    eventsFor: (userId, after, limit) =>
      serial((): SocialEventPage => {
        const oldest = log.length > 0 ? log[0].seq : null;
        const reset = after > 0 && oldest !== null && after < oldest - 1;
        const mine = log.filter((e) => e.audience.has(userId));
        const cap = Math.max(1, Math.min(limit, 500));
        const pending = mine.filter((e) => e.seq > after);
        const events = pending.slice(0, cap).map(({ seq: s, op, atIso }) => ({ seq: s, op, atIso }));
        const latest = viewerCursor({ after, page: events, truncated: pending.length > cap, viewerNewest: mine.length > 0 ? mine[mine.length - 1].seq : null, oldest });
        return { events, latest, reset };
      }),
  };
}
