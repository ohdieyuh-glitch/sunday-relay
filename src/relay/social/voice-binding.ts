/**
 * WONDERLAND PARTY VOICE -- WHICH EOS PRODUCT USER ID BELONGS TO WHICH SIGNED-IN PLAYER (R16, EOS voice backend, 10-04).
 *
 * The desktop client signs in to EOS Connect with a device id and gets a ProductUserId (PUID): a TRANSPORT identity only. Who may
 * talk to whom is decided here, from the GitHub-authenticated session -- so a PUID is bound to exactly one player:
 *   - the first /voice/join BINDS the caller's PUID to them;
 *   - a PUID already bound to ANOTHER player is refused (the route answers it exactly like a party that does not exist);
 *   - a player's own, DIFFERENT PUID re-binds only from a NEW session (a fresh sign-in), never mid-session;
 *   - the voice audience a client is shown carries only server-bound PUID -> player pairs.
 * One pure decision (decideVoiceBinding) for both stores: the in-memory one here, and PostgreSQL
 * (src/relay/persistence/voice-binding-postgres.ts, table relay_wonderland.voice_puid_binding, migration 034).
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
 * THE ONE RULE. `mine` is the caller's current binding (if any), `owner` whoever holds the PUID now (if anyone).
 *   refused  the PUID is another player's; or the caller asks for a different PUID within the session that bound the old one
 *   same     the caller's own PUID again (nothing changes)
 *   bound    the caller's first binding
 *   rebound  the caller's new PUID, from a new session
 */
export function decideVoiceBinding(input: { readonly userId: string; readonly puid: string; readonly sessionId: string; readonly mine: VoiceBindingRow | null; readonly owner: string | null }): VoiceBindingOutcome {
  if (input.owner !== null && input.owner !== input.userId) return 'refused';
  if (input.mine === null) return 'bound';
  if (input.mine.puid === input.puid) return 'same';
  return input.mine.sessionId === input.sessionId ? 'refused' : 'rebound';
}

export interface VoiceBindingStore {
  /** Bind (or confirm, or re-bind) the caller's PUID by decideVoiceBinding. The PUID must already be normalised. */
  bind(input: { readonly userId: string; readonly puid: string; readonly sessionId: string; readonly nowIso: string }): Promise<VoiceBindingOutcome>;
  /** The bound PUID of each player who has one. */
  puidsOf(userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
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
  return {
    bind: ({ userId, puid, sessionId, nowIso }) =>
      serial(() => {
        const owner = [...byUser.values()].find((r) => r.puid === puid)?.userId ?? null;
        const outcome = decideVoiceBinding({ userId, puid, sessionId, mine: byUser.get(userId) ?? null, owner });
        if (outcome === 'bound' || outcome === 'rebound') byUser.set(userId, { userId, puid, sessionId, boundAtIso: nowIso });
        return outcome;
      }),
    puidsOf: (userIds) =>
      serial(() => new Map(userIds.flatMap((id) => (byUser.has(id) ? [[id, byUser.get(id)!.puid] as const] : [])))),
    rows: () => [...byUser.values()],
  };
}
