/**
 * WONDERLAND PARTY VOICE -- WHICH EOS PRODUCT USER ID BELONGS TO WHICH SIGNED-IN PLAYER (R16, EOS voice backend, 10-04).
 *
 * The desktop client signs in to EOS Connect with a device id and gets a ProductUserId (PUID): a TRANSPORT identity only. Who may
 * talk to whom is decided here, from the GitHub-authenticated session -- so a PUID is bound to exactly one player:
 *   - the first /voice/join BINDS the caller's PUID to them;
 *   - a PUID already bound to ANOTHER player is refused (the route answers it exactly like a party that does not exist);
 *   - a player's own, DIFFERENT PUID re-binds only from ANOTHER session than the one that bound it (a fresh sign-in), never
 *     mid-session. "Another", not "newer": the session facts carry no issue time (browser-session/grants.ts), so an older
 *     session still signed in can take the binding back (MAIN's internal review a6d5842c, m3: open);
 *   - the voice audience a client is shown carries only server-bound PUID -> player pairs.
 * A re-bind takes the replaced PUID out of the party's room before it binds (relay-bridge/wonderland-social-routes.ts, B1).
 * One pure decision (decideVoiceBinding) for both stores: the in-memory one here, and PostgreSQL
 * (src/relay/persistence/voice-binding-postgres.ts, table relay_wonderland.voice_puid_binding, migration 035).
 */

/** An EOS ProductUserId as the store keeps it: 32 lowercase hex characters (EOS issues hex; case is normalised). */
const PUID_SHAPE = /^[0-9a-f]{32}$/i;

/** The canonical PUID, or null when the text is not one. */
export function normalizePuid(raw: unknown): string | null {
  return typeof raw === 'string' && PUID_SHAPE.test(raw.trim()) ? raw.trim().toLowerCase() : null;
}

export interface VoiceBindingRow {
  readonly userId: string;
  readonly puid: string;
  readonly sessionId: string;
  readonly boundAtIso: string;
}

export type VoiceBindingOutcome = 'bound' | 'same' | 'rebound' | 'refused';

/**
 * The session store's answer about one session, by its id: when it was issued (ms since the epoch) while it is live, or null once
 * it is gone (expired, revoked, or never known to this process -- a restart ends every session).
 */
export type SessionIssuedAtLookup = (sessionId: string) => number | null;

/** Who asks to bind, and when their session was issued. Both REQUIRED (no hop may drop them silently; a null says so out loud). */
export interface VoiceBindingCaller {
  readonly userId: string;
  readonly puid: string;
  readonly sessionId: string;
  /** When the caller's session was issued (ISO), or null when unknown (the dev server): another session then suffices. */
  readonly sessionIssuedAtIso: string | null;
  /** The session store's lookup, for the session that made the caller's binding; null when the store cannot answer (bound_at stands in). */
  readonly sessionIssuedAtOf: SessionIssuedAtLookup | null;
}

/**
 * THE ONE RULE. `mine` is the caller's current binding (if any), `owner` whoever holds the PUID now (if anyone).
 *   refused  the PUID is another player's; or the caller asks for a different PUID within the session that bound the old one; or
 *            from a session not newer than the one that bound it, while that one is still live
 *   same     the caller's own PUID again (nothing changes)
 *   bound    the caller's first binding
 *   rebound  the caller's new PUID: the NEWEST SESSION WINS (m3; MAIN's internal review af2eb058, m-d). The session that bound the
 *            old one is gone, or the caller's session was issued after it. Two live clients of one player therefore cannot flip
 *            the binding on every join, and a newer session that signed in before the older one's first join still wins (it was
 *            refused when this compared with bound_at). bound_at stands in only when the session store cannot answer; an unknown
 *            caller issue time (the dev server) falls back to "another session".
 */
export function decideVoiceBinding(input: VoiceBindingCaller & { readonly mine: VoiceBindingRow | null; readonly owner: string | null }): VoiceBindingOutcome {
  if (input.owner !== null && input.owner !== input.userId) return 'refused';
  if (input.mine === null) return 'bound';
  if (input.mine.puid === input.puid) return 'same';
  if (input.mine.sessionId === input.sessionId) return 'refused';
  const bindingSessionMs = input.sessionIssuedAtOf === null ? undefined : input.sessionIssuedAtOf(input.mine.sessionId);
  // the session that bound it is gone: no live session older than the caller's holds it any more
  if (bindingSessionMs === null) return 'rebound';
  if (input.sessionIssuedAtIso === null) return 'rebound';
  // newer than the binding's (live) session, or -- the store cannot answer -- than the binding itself; NaN either side: refused
  return Date.parse(input.sessionIssuedAtIso) > (bindingSessionMs ?? Date.parse(input.mine.boundAtIso)) ? 'rebound' : 'refused';
}

export interface VoiceBindingStore {
  /** Bind (or confirm, or re-bind) the caller's PUID by decideVoiceBinding. The PUID must already be normalised. */
  bind(input: VoiceBindingCaller & { readonly nowIso: string }): Promise<VoiceBindingOutcome>;
  /** The caller's binding now (PUID, the session that bound it, when), or null: decideVoiceBinding's `mine`, read before a bind. */
  bindingOf(userId: string): Promise<VoiceBindingRow | null>;
  /** Who holds this PUID now, or null: decideVoiceBinding's `owner`. The PUID must already be normalised. */
  ownerOf(puid: string): Promise<string | null>;
  /** The bound PUID of each player who has one. */
  puidsOf(userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/**
 * ONE VOICE CHANGE AT A TIME PER PLAYER, in this process, in the order queued: the player's voice joins
 * (relay-bridge/wonderland-social-routes.ts, MAIN's internal review a6d5842c B1) AND their departures' removals
 * (relay-bridge/eos-voice.ts createVoiceRemovals, MAIN's internal review af2eb058 m-b).
 *   - B1: a re-bind's removal is decided from the binding read BEFORE the bind; another join of the same player running in between
 *     (a second fresh sign-in) would bind past that read, and the PUID it replaced would never leave the room.
 *   - m-b: a departure's removal reads the binding when it RUNS. Queued behind nothing, a join that re-binds in ANOTHER party could
 *     run first (P leaves A, joins B and re-binds), and A's removal would then read the new PUID and leave the old one in A's
 *     room. Queued here, synchronously when the departure commits, it runs before any later join of that player.
 * Keyed by the binding store, which the bridge builds once (each test builds its own). An entry is dropped once its last work
 * settles; a failed work never blocks the next. One bridge process holds this, as it holds presence.
 */
const voiceChangeTails = new WeakMap<VoiceBindingStore, Map<string, Promise<void>>>();

export function oneVoiceJoinAtATime<T>(bindings: VoiceBindingStore, userId: string, work: () => Promise<T>): Promise<T> {
  const tails = voiceChangeTails.get(bindings) ?? new Map<string, Promise<void>>();
  voiceChangeTails.set(bindings, tails);
  const run = (tails.get(userId) ?? Promise.resolve()).then(work);
  const tail = run.then(() => undefined, () => undefined);
  tails.set(userId, tail);
  void tail.then(() => {
    if (tails.get(userId) === tail) tails.delete(userId);
  });
  return run;
}

/** The development and test store: the same rule, in one process. */
export function createInMemoryVoiceBindings(): VoiceBindingStore & { readonly rows: () => readonly VoiceBindingRow[] } {
  const byUser = new Map<string, VoiceBindingRow>();
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => T): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };
  const ownerNow = (puid: string): string | null => [...byUser.values()].find((r) => r.puid === puid)?.userId ?? null;
  return {
    bind: ({ userId, puid, sessionId, sessionIssuedAtIso, sessionIssuedAtOf, nowIso }) =>
      serial(() => {
        const outcome = decideVoiceBinding({ userId, puid, sessionId, sessionIssuedAtIso, sessionIssuedAtOf, mine: byUser.get(userId) ?? null, owner: ownerNow(puid) });
        if (outcome === 'bound' || outcome === 'rebound') byUser.set(userId, { userId, puid, sessionId, boundAtIso: nowIso });
        return outcome;
      }),
    bindingOf: (userId) => serial(() => byUser.get(userId) ?? null),
    ownerOf: (puid) => serial(() => ownerNow(puid)),
    puidsOf: (userIds) =>
      serial(() => new Map(userIds.flatMap((id) => (byUser.has(id) ? [[id, byUser.get(id)!.puid] as const] : [])))),
    rows: () => [...byUser.values()],
  };
}
