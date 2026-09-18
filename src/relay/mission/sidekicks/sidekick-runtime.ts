import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import {
  authorityOf,
  chooseAuth,
  isLegalSidekickTransition,
  isSidekickAuthority,
  looksLikeSecret,
  mascotStateFor,
  type MascotState,
  type SidekickAuditRow,
  type SidekickFailure,
  type SidekickKind,
  type SidekickSession,
  type SidekickState,
  type SidekickTurn,
  type TurnState,
} from './sidekick-contracts';
import { developmentProviderFor, findProvider } from './sidekick-registry';
import type { SidekickProvider } from './sidekick-contracts';

/**
 * THE SIDEKICK STATE MACHINE — pure, and the only place that decides what a companion is doing.
 *
 * Everything a surface shows about the LLM Companion or Jhinn comes from here: which provider is behind it, whether that
 * is real, what its body should be doing, and what went wrong when something did. The runtime that talks to providers
 * (relay-bridge) owns sockets and clocks; it owns no rules.
 *
 * THE RULES IT KEEPS:
 *   - A turn is only possible while CONNECTED. Nothing is ever asked of a provider that is not there.
 *   - An answer is marked real only when a real provider produced it, and that mark is written once and never edited.
 *   - A sidekick never holds mission authority. Julius is the compound agent; connecting a provider changes nothing
 *     about that, and the attempt is refused rather than quietly allowed.
 *   - Nothing that looks like a credential is accepted as conversation. The founder is never to paste secrets into a
 *     chat, so a chat that is handed one refuses it instead of forwarding it to a provider.
 */

export interface SidekickPresence {
  readonly sidekickId: string;
  readonly kind: SidekickKind;
  readonly state: SidekickState;
  readonly providerId: string;
  readonly modelId: string;
  readonly mode: 'SIMULATED' | 'REAL';
  readonly session: SidekickSession | null;
  /** The turn in flight, if any. One at a time: a companion is not a queue. */
  readonly liveTurnId: string | null;
  readonly failure: SidekickFailure | null;
  /** Plain words for the surface, always matching the state. */
  readonly note: string;
  /** A reference, never material. Null for a provider that holds its own credential, or for a fixture. */
  readonly credentialRef: string | null;
  readonly connectedAt: string | null;
}

export interface SidekickWorld {
  readonly sequence: number;
  readonly sidekicks: readonly SidekickPresence[];
  readonly audit: readonly SidekickAuditRow[];
}

export interface SidekickClock {
  readonly at: string;
  readonly registry?: readonly SidekickProvider[];
}

export const LLM_COMPANION = 'llm-companion';
export const JHINN = 'jhinn';

/** The two sidekicks Wonderland has bodies for, each starting as what it honestly is: simulated. */
export function emptySidekickWorld(clock: SidekickClock): SidekickWorld {
  const make = (sidekickId: string, kind: SidekickKind): SidekickPresence => {
    const provider = developmentProviderFor(kind, clock.registry);
    return {
      sidekickId,
      kind,
      state: 'SIMULATED',
      providerId: provider.providerId,
      modelId: provider.models[0].modelId,
      mode: 'SIMULATED',
      session: null,
      liveTurnId: null,
      failure: null,
      note: 'No account is connected. Answers come from a fixture and are marked SIMULATED.',
      credentialRef: null,
      connectedAt: null,
    };
  };
  return {
    sequence: 0,
    sidekicks: [make(LLM_COMPANION, 'llm_companion'), make(JHINN, 'single_agent')],
    audit: [],
  };
}

export function findSidekick(world: SidekickWorld, sidekickId: string): SidekickPresence | null {
  return world.sidekicks.find((sidekick) => sidekick.sidekickId === sidekickId) ?? null;
}

/** What the body should be doing, from the connection and the turn in flight -- never from a timer. */
export function mascotOf(world: SidekickWorld, sidekickId: string): MascotState {
  const sidekick = findSidekick(world, sidekickId);
  if (sidekick === null) {
    return 'DISCONNECTED';
  }
  const turn = liveTurn(sidekick);
  return mascotStateFor(sidekick.state, turn === null ? null : turn.state, sidekick.kind);
}

export function liveTurn(sidekick: SidekickPresence): SidekickTurn | null {
  if (sidekick.session === null || sidekick.liveTurnId === null) {
    return null;
  }
  return sidekick.session.turns.find((turn) => turn.turnId === sidekick.liveTurnId) ?? null;
}

/* ==================================================================== moving between states */

function audit(world: SidekickWorld, row: Omit<SidekickAuditRow, 'eventId' | 'at'>, clock: SidekickClock): SidekickWorld {
  const sequence = world.sequence + 1;
  // A DETAIL THAT LOOKS LIKE A SECRET IS NOT RECORDED. Nothing in this system needs one, so nothing in it keeps one.
  const detail = looksLikeSecret(row.detail) ? 'withheld: this looked like credential material and was not recorded' : row.detail;
  return {
    ...world,
    sequence,
    audit: [{ ...row, detail, eventId: `saud_${String(sequence).padStart(4, '0')}`, at: clock.at }, ...world.audit].slice(0, 200),
  };
}

function put(world: SidekickWorld, next: SidekickPresence): SidekickWorld {
  return { ...world, sidekicks: world.sidekicks.map((sidekick) => (sidekick.sidekickId === next.sidekickId ? next : sidekick)) };
}

function move(sidekick: SidekickPresence, to: SidekickState, note: string, failure: SidekickFailure | null = null): SidekickPresence {
  if (!isLegalSidekickTransition(sidekick.state, to)) {
    // A move that does not exist is a bug in the caller; the state is left alone rather than forced.
    return sidekick;
  }
  return { ...sidekick, state: to, note, failure };
}

/* ==================================================================== connecting */

/**
 * ASK FOR A PROVIDER TO BE PUT BEHIND A SIDEKICK. A development provider connects at once, because there is nothing to
 * sign in to and nothing to pay. A real one goes to AUTH_REQUIRED and stays there until the founder has completed the
 * provider's own flow: this build will not pretend an account exists.
 */
export function connectSidekick(
  world: SidekickWorld,
  input: { sidekickId: string; providerId: string; modelId?: string },
  clock: SidekickClock,
): RelayResult<SidekickWorld> {
  const sidekick = findSidekick(world, input.sidekickId);
  if (sidekick === null) {
    return fail(relayError('not-found', `There is no sidekick called ${input.sidekickId}.`));
  }
  const provider = findProvider(input.providerId, clock.registry);
  if (provider === null) {
    return fail(relayError('not-found', `There is no provider called ${input.providerId}.`));
  }
  if (provider.backs !== sidekick.kind) {
    return fail(
      relayError(
        'validation-failed',
        `${provider.displayName} backs a ${provider.backs.replace('_', ' ')}, and ${sidekick.sidekickId} is a ${sidekick.kind.replace('_', ' ')}. They are different jobs.`,
      ),
    );
  }
  const modelId = input.modelId ?? provider.models[0].modelId;
  if (!provider.models.some((model) => model.modelId === modelId)) {
    return fail(relayError('validation-failed', `${provider.displayName} has no model called ${modelId}.`));
  }
  const route = chooseAuth(provider);
  if (!provider.development && route === null) {
    const why = provider.auth.map((option) => `${option.mechanism}: ${option.unavailableReason ?? 'not available'}`).join(' · ');
    const waiting = move(
      { ...sidekick, providerId: provider.providerId, modelId, mode: 'REAL', session: null, liveTurnId: null, credentialRef: null },
      'AUTH_REQUIRED',
      `${provider.displayName} needs an account of yours before anything can be asked of it. ${why}`,
      'AUTH_REQUIRED',
    );
    return ok(
      audit(
        put(world, waiting),
        {
          sidekickId: sidekick.sidekickId,
          action: 'auth.required',
          providerId: provider.providerId,
          modelId,
          mode: 'REAL',
          outcome: 'pending',
          detail: `${provider.displayName} is waiting for the founder's own connection. Nothing was contacted.`,
        },
        clock,
      ),
    );
  }
  const connecting = move(
    { ...sidekick, providerId: provider.providerId, modelId, mode: provider.development ? 'SIMULATED' : 'REAL', credentialRef: null },
    'CONNECTING',
    `Connecting ${provider.displayName}…`,
  );
  const world2 = audit(
    put(world, connecting),
    {
      sidekickId: sidekick.sidekickId,
      action: 'auth.completed',
      providerId: provider.providerId,
      modelId,
      mode: connecting.mode,
      outcome: 'pending',
      detail: provider.development ? 'A development stand-in: nothing is contacted.' : `Opening ${provider.displayName}.`,
    },
    clock,
  );
  // A development provider is up immediately: there is nothing to wait for, and pretending to wait would be theatre.
  return provider.development ? completeConnection(world2, { sidekickId: sidekick.sidekickId, credentialRef: null }, clock) : ok(world2);
}

/**
 * THE CONNECTION IS REALLY UP. Called by the runtime once the provider has actually answered -- for a real provider that
 * means its own tool or its own API said yes, not that a form was filled in.
 */
export function completeConnection(
  world: SidekickWorld,
  input: { sidekickId: string; credentialRef: string | null },
  clock: SidekickClock,
): RelayResult<SidekickWorld> {
  const sidekick = findSidekick(world, input.sidekickId);
  if (sidekick === null) {
    return fail(relayError('not-found', `There is no sidekick called ${input.sidekickId}.`));
  }
  if (input.credentialRef !== null && looksLikeSecret(input.credentialRef)) {
    // A REFERENCE, NOT A SECRET. Handed the material itself, this refuses rather than storing it.
    return fail(relayError('validation-failed', 'That is credential material, not a reference to one. It was not stored.'));
  }
  const provider = findProvider(sidekick.providerId, clock.registry);
  const session: SidekickSession = {
    sessionId: `ses_${String(world.sequence + 1).padStart(4, '0')}`,
    kind: sidekick.kind,
    providerId: sidekick.providerId,
    modelId: sidekick.modelId,
    startedAt: clock.at,
    mode: sidekick.mode,
    turns: [],
  };
  const connected = move(
    { ...sidekick, session, liveTurnId: null, credentialRef: input.credentialRef, connectedAt: clock.at },
    'CONNECTED',
    sidekick.mode === 'REAL'
      ? `${provider?.displayName ?? sidekick.providerId} is connected. Answers are real.`
      : `${provider?.displayName ?? sidekick.providerId} is a development stand-in. Answers are SIMULATED.`,
  );
  return ok(
    audit(
      put(world, connected),
      {
        sidekickId: sidekick.sidekickId,
        action: 'connected',
        providerId: sidekick.providerId,
        modelId: sidekick.modelId,
        mode: sidekick.mode,
        outcome: 'success',
        detail: `Connected as a ${sidekick.kind.replace('_', ' ')} with ${authorityOf(sidekick.kind)} authority. Mission authority is Julius's and was not granted.`,
      },
      clock,
    ),
  );
}

export function disconnectSidekick(world: SidekickWorld, input: { sidekickId: string; reason?: string }, clock: SidekickClock): RelayResult<SidekickWorld> {
  const sidekick = findSidekick(world, input.sidekickId);
  if (sidekick === null) {
    return fail(relayError('not-found', `There is no sidekick called ${input.sidekickId}.`));
  }
  // A TURN IN FLIGHT ENDS WITH THE CONNECTION, and says so rather than hanging for ever.
  const session = sidekick.session === null ? null : endLiveTurn(sidekick, 'DISCONNECTED');
  const gone: SidekickPresence = {
    ...sidekick,
    state: 'DISCONNECTED',
    session,
    liveTurnId: null,
    credentialRef: null,
    connectedAt: null,
    failure: null,
    note: input.reason ?? 'Disconnected. Nothing is behind this companion now.',
  };
  return ok(
    audit(
      put(world, gone),
      {
        sidekickId: sidekick.sidekickId,
        action: 'disconnected',
        providerId: sidekick.providerId,
        modelId: sidekick.modelId,
        mode: sidekick.mode,
        outcome: 'success',
        detail: input.reason ?? 'Disconnected by the user.',
      },
      clock,
    ),
  );
}

/* ==================================================================== a turn */

function endLiveTurn(sidekick: SidekickPresence, failure: SidekickFailure): SidekickSession | null {
  if (sidekick.session === null || sidekick.liveTurnId === null) {
    return sidekick.session;
  }
  return {
    ...sidekick.session,
    turns: sidekick.session.turns.map((turn) =>
      turn.turnId === sidekick.liveTurnId && (turn.state === 'ASKED' || turn.state === 'THINKING' || turn.state === 'STREAMING')
        ? { ...turn, state: failure === 'CANCELLED' ? ('CANCELLED' as TurnState) : ('FAILED' as TurnState), failure, ms: null }
        : turn,
    ),
  };
}

/**
 * ASK THE COMPANION SOMETHING. Refused unless a provider is really there, so no ask is ever quietly dropped or quietly
 * answered by nothing.
 */
export function askSidekick(
  world: SidekickWorld,
  input: { sidekickId: string; ask: string },
  clock: SidekickClock,
): RelayResult<SidekickWorld> {
  const sidekick = findSidekick(world, input.sidekickId);
  if (sidekick === null) {
    return fail(relayError('not-found', `There is no sidekick called ${input.sidekickId}.`));
  }
  if (sidekick.state !== 'CONNECTED') {
    return fail(
      relayError(
        'illegal-transition',
        sidekick.state === 'AUTH_REQUIRED'
          ? 'This companion has no account connected yet, so it was asked nothing.'
          : `This companion is ${sidekick.state.toLowerCase().replace('_', ' ')}, so it was asked nothing.`,
      ),
    );
  }
  if (sidekick.liveTurnId !== null) {
    return fail(relayError('illegal-transition', 'This companion is already working on something. One turn at a time.'));
  }
  const ask = input.ask.trim();
  if (ask.length === 0) {
    return fail(relayError('validation-failed', 'Nothing was said.'));
  }
  if (looksLikeSecret(ask)) {
    // THE FOUNDER IS NEVER TO PASTE A SECRET INTO A CHAT, so a chat handed one refuses it rather than sending it on.
    return ok(
      audit(
        put(world, { ...sidekick, note: 'That looked like credential material, so it was not sent anywhere. Connect credentials through Julius Connect instead.' }),
        {
          sidekickId: sidekick.sidekickId,
          action: 'refused',
          providerId: sidekick.providerId,
          modelId: sidekick.modelId,
          mode: sidekick.mode,
          outcome: 'failed',
          detail: 'An ask that looked like credential material was refused and not sent to any provider.',
        },
        clock,
      ),
    );
  }
  const session = sidekick.session;
  if (session === null) {
    return fail(relayError('illegal-transition', 'This companion has no session.'));
  }
  const turn: SidekickTurn = {
    turnId: `turn_${String(world.sequence + 1).padStart(4, '0')}`,
    sessionId: session.sessionId,
    askedAt: clock.at,
    state: 'ASKED',
    ask,
    answer: '',
    failure: null,
    modelId: sidekick.modelId,
    ms: null,
    real: sidekick.mode === 'REAL',
  };
  const working = move(
    { ...sidekick, session: { ...session, turns: [...session.turns, turn] }, liveTurnId: turn.turnId },
    'WORKING',
    sidekick.kind === 'single_agent' ? 'Working on the task.' : 'Thinking.',
  );
  return ok(
    audit(
      put(world, working),
      {
        sidekickId: sidekick.sidekickId,
        action: sidekick.kind === 'single_agent' ? 'work.started' : 'turn.asked',
        providerId: sidekick.providerId,
        modelId: sidekick.modelId,
        mode: sidekick.mode,
        outcome: 'pending',
        detail: `${ask.length} characters asked of ${sidekick.modelId}.`,
      },
      clock,
    ),
  );
}

/** The provider has begun: thinking, then streaming as words actually arrive. Drives the body, and nothing else does. */
export function markTurn(world: SidekickWorld, input: { sidekickId: string; state: TurnState; answer?: string }): RelayResult<SidekickWorld> {
  const sidekick = findSidekick(world, input.sidekickId);
  if (sidekick === null || sidekick.session === null || sidekick.liveTurnId === null) {
    return fail(relayError('illegal-transition', 'There is no turn in flight.'));
  }
  const session: SidekickSession = {
    ...sidekick.session,
    turns: sidekick.session.turns.map((turn) =>
      turn.turnId === sidekick.liveTurnId ? { ...turn, state: input.state, answer: input.answer ?? turn.answer } : turn,
    ),
  };
  return ok(put(world, { ...sidekick, session }));
}

/** The provider finished. The answer is recorded with the model that produced it and whether it was real. */
export function finishTurn(
  world: SidekickWorld,
  input: { sidekickId: string; answer: string; ms: number },
  clock: SidekickClock,
): RelayResult<SidekickWorld> {
  const sidekick = findSidekick(world, input.sidekickId);
  if (sidekick === null || sidekick.session === null || sidekick.liveTurnId === null) {
    return fail(relayError('illegal-transition', 'There is no turn in flight.'));
  }
  const turnId = sidekick.liveTurnId;
  const session: SidekickSession = {
    ...sidekick.session,
    turns: sidekick.session.turns.map((turn) => (turn.turnId === turnId ? { ...turn, state: 'DONE' as TurnState, answer: input.answer, ms: input.ms } : turn)),
  };
  const done = move({ ...sidekick, session, liveTurnId: null }, 'CONNECTED', sidekick.mode === 'REAL' ? 'Answered.' : 'Answered (SIMULATED).');
  return ok(
    audit(
      put(world, done),
      {
        sidekickId: sidekick.sidekickId,
        action: sidekick.kind === 'single_agent' ? 'work.finished' : 'turn.answered',
        providerId: sidekick.providerId,
        modelId: sidekick.modelId,
        mode: sidekick.mode,
        outcome: 'success',
        detail: `${input.answer.length} characters in ${input.ms} ms from ${sidekick.modelId}${sidekick.mode === 'REAL' ? '' : ' (SIMULATED)'}.`,
      },
      clock,
    ),
  );
}

/** The turn ended badly, and the state says which way. RATE_LIMITED is a waiting state, not a failure to hide. */
export function failTurn(world: SidekickWorld, input: { sidekickId: string; failure: SidekickFailure; detail?: string }, clock: SidekickClock): RelayResult<SidekickWorld> {
  const sidekick = findSidekick(world, input.sidekickId);
  if (sidekick === null) {
    return fail(relayError('not-found', `There is no sidekick called ${input.sidekickId}.`));
  }
  const session = endLiveTurn(sidekick, input.failure);
  const to: SidekickState =
    input.failure === 'RATE_LIMITED' ? 'RATE_LIMITED' : input.failure === 'DISCONNECTED' ? 'DISCONNECTED' : input.failure === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : input.failure === 'CANCELLED' ? 'CONNECTED' : 'FAILED';
  const next = move({ ...sidekick, session, liveTurnId: null }, to, input.detail ?? '', input.failure === 'CANCELLED' ? null : input.failure);
  return ok(
    audit(
      put(world, next),
      {
        sidekickId: sidekick.sidekickId,
        action: input.failure === 'CANCELLED' ? 'turn.cancelled' : 'turn.failed',
        providerId: sidekick.providerId,
        modelId: sidekick.modelId,
        mode: sidekick.mode,
        outcome: 'failed',
        detail: input.detail ?? input.failure,
      },
      clock,
    ),
  );
}

/**
 * THE RUNTIME CAME BACK AND A TURN WAS STILL IN FLIGHT. Nothing is resumed and nothing is invented: the turn is closed
 * as lost, so a companion never comes up mid-thought about something nobody remembers asking.
 */
export function recoverInterruptedTurns(world: SidekickWorld, clock: SidekickClock): SidekickWorld {
  let next = world;
  for (const sidekick of world.sidekicks) {
    if (sidekick.liveTurnId !== null) {
      const result = failTurn(next, { sidekickId: sidekick.sidekickId, failure: 'DISCONNECTED', detail: 'The runtime restarted while this turn was in flight, so it was lost rather than resumed.' }, clock);
      if (result.ok) {
        next = result.value;
      }
    }
  }
  return next;
}

/** Change the model behind a companion. A new model is a new session: it is not the same mind carrying on. */
export function changeModel(world: SidekickWorld, input: { sidekickId: string; modelId: string }, clock: SidekickClock): RelayResult<SidekickWorld> {
  const sidekick = findSidekick(world, input.sidekickId);
  if (sidekick === null) {
    return fail(relayError('not-found', `There is no sidekick called ${input.sidekickId}.`));
  }
  const provider = findProvider(sidekick.providerId, clock.registry);
  if (provider === null || !provider.models.some((model) => model.modelId === input.modelId)) {
    return fail(relayError('validation-failed', `${sidekick.providerId} has no model called ${input.modelId}.`));
  }
  if (sidekick.liveTurnId !== null) {
    return fail(relayError('illegal-transition', 'Not while it is working on something.'));
  }
  const changed: SidekickPresence = {
    ...sidekick,
    modelId: input.modelId,
    session:
      sidekick.session === null
        ? null
        : { ...sidekick.session, sessionId: `ses_${String(world.sequence + 1).padStart(4, '0')}`, modelId: input.modelId, startedAt: clock.at, turns: [] },
    note: `Now ${input.modelId}. A new model is a new conversation.`,
  };
  return ok(
    audit(
      put(world, changed),
      {
        sidekickId: sidekick.sidekickId,
        action: 'model.changed',
        providerId: sidekick.providerId,
        modelId: input.modelId,
        mode: sidekick.mode,
        outcome: 'success',
        detail: `Model changed to ${input.modelId}; the conversation starts again.`,
      },
      clock,
    ),
  );
}

/**
 * THE SEPARATION, ENFORCED RATHER THAN REMEMBERED. Anything asking a sidekick to take mission authority is refused here,
 * so the rule survives whoever writes the next surface.
 */
export function grantAuthority(world: SidekickWorld, input: { sidekickId: string; authority: string }): RelayResult<SidekickWorld> {
  const sidekick = findSidekick(world, input.sidekickId);
  if (sidekick === null) {
    return fail(relayError('not-found', `There is no sidekick called ${input.sidekickId}.`));
  }
  if (!isSidekickAuthority(input.authority as never) || input.authority !== authorityOf(sidekick.kind)) {
    return fail(
      relayError(
        'permission-denied',
        `${sidekick.sidekickId} is a ${sidekick.kind.replace('_', ' ')} and holds ${authorityOf(sidekick.kind)} authority. Mission authority belongs to Julius, the compound agent, and is not granted to sidekicks.`,
      ),
    );
  }
  return ok(world);
}
