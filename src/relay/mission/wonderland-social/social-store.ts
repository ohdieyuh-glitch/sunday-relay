import {
  WONDERLAND_EMPTY_SOCIAL_STATE,
  isWonderlandEntityId,
  isWonderlandPlayerId,
  type WonderlandSocialCommand,
  type WonderlandSocialOutcome,
  type WonderlandSocialState,
} from './social-contracts';
import { applyWonderlandSocialMutations, decideWonderlandSocialCommand } from './social-commands';

/**
 * WHERE THE SOCIAL STATE LIVES — the port, and the in-memory store.
 *
 * `execute` runs one command AS ONE ACTOR, once: a command id names one write,
 * and repeating it returns the first outcome without deciding again (the
 * backend contract's "every mutating request carries a commandId"). A command id
 * another actor already used is refused rather than replayed to them.
 *
 * `stateFor` returns a state from which EVERY projection a viewer may ask for
 * is computed correctly. The PostgreSQL store returns only the viewer's
 * neighbourhood; the memory store returns everything. Projections are written
 * so that both answer identically — the store contract suite holds them to it.
 *
 * `voiceStateFor` returns enough to route one voice channel: the relations
 * among exactly its participants.
 */
export interface WonderlandSocialStore {
  execute(input: {
    readonly actorId: string;
    readonly commandId: string;
    readonly command: WonderlandSocialCommand;
    readonly at: string;
  }): Promise<WonderlandSocialOutcome>;
  /** Server-side only: the account's display name, never a client's claim. */
  upsertProfile(input: { readonly playerId: string; readonly displayName: string | null }): Promise<void>;
  /**
   * The player EXISTS socially, without touching a name the account already
   * gave them. A request that knows no name must never erase one: `null` here
   * would be "Unknown" written over a verified name.
   */
  ensureProfile(playerId: string): Promise<void>;
  /** `publicInstanceIds`: the instances a listing will count, so their occupants are read too. */
  stateFor(input: { readonly viewerId: string; readonly publicInstanceIds?: readonly string[] }): Promise<WonderlandSocialState>;
  voiceStateFor(input: { readonly participantIds: readonly string[] }): Promise<WonderlandSocialState>;
}

export function createMemoryWonderlandSocialStore(initial: WonderlandSocialState = WONDERLAND_EMPTY_SOCIAL_STATE): WonderlandSocialStore & {
  /** For tests: the whole state, as the store holds it. */
  snapshot(): WonderlandSocialState;
} {
  let state = initial;
  const commands = new Map<string, { readonly actorId: string; readonly outcome: WonderlandSocialOutcome }>();
  return {
    async execute({ actorId, commandId, command, at }) {
      if (!isWonderlandPlayerId(actorId) || !isWonderlandEntityId(commandId)) return { ok: false, code: 'INVALID' };
      const previous = commands.get(commandId);
      if (previous !== undefined) return previous.actorId === actorId ? previous.outcome : { ok: false, code: 'ID_TAKEN' };
      const decided = decideWonderlandSocialCommand(state, actorId, command, at);
      state = applyWonderlandSocialMutations(state, decided.mutations);
      commands.set(commandId, { actorId, outcome: decided.outcome });
      return decided.outcome;
    },
    async upsertProfile({ playerId, displayName }) {
      if (!isWonderlandPlayerId(playerId)) throw new Error('wonderland_social_player_invalid');
      state = { ...state, profiles: { ...state.profiles, [playerId]: { displayName } } };
    },
    async ensureProfile(playerId) {
      if (!isWonderlandPlayerId(playerId)) throw new Error('wonderland_social_player_invalid');
      if (state.profiles[playerId] === undefined) state = { ...state, profiles: { ...state.profiles, [playerId]: { displayName: null } } };
    },
    async stateFor() { return state; },
    async voiceStateFor() { return state; },
    snapshot: () => state,
  };
}
