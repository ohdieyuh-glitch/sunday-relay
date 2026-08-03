/**
 * SUNDAY RELAY — THE LOOP RUNTIME STATE MACHINE.
 *
 * ONE TABLE. Every legal move a Loop run can make is declared here, and
 * `transitionLoopRun` is the only way to change a run's state. There is
 * deliberately no boolean anywhere in the runtime that means "is running" or
 * "is paused" — scattered booleans are how a system ends up simultaneously
 * paused and running, and no test catches it because no single value was wrong.
 *
 * FAIL CLOSED. An illegal transition is REFUSED and RECORDED. It never throws,
 * never silently no-ops, and never lands the run somewhere adjacent that seemed
 * reasonable. The caller gets a rejection carrying both states and must decide;
 * the runtime persists it as a `RelayLoopRuntimeFailure` so an operator can see
 * that something tried.
 *
 * TERMINAL MEANS TERMINAL. From a terminal state there is no edge back to
 * `running` — not for a retry, not for a resume, not for a recovery. Continuing
 * finished work requires a NEW run against the same contract, which is a
 * different, auditable act. `recovery_required` is the one non-terminal
 * interruption: an unconfirmable run is unfinished, not finished, and it may
 * return to service only through `resuming`, which re-checks authorization,
 * limits and contract binding first.
 *
 * PURE. No clock, no I/O.
 */

import {
  EXHAUSTION_LOOP_STATES,
  TERMINAL_LOOP_STATES,
  type RelayLoopState,
} from '../loop-contract';
import {
  RELAY_LOOP_RUNTIME_STATES,
  type RelayLoopRuntimeState,
} from './loop-runtime-types';

/* --------------------------------------------------------------- table */

/**
 * The legal edges, as `from -> to[]`.
 *
 * Read it as the life of a run: a draft is validated and confirmed, queued,
 * started, and then cycles `running -> observing -> completion_check` until
 * something ends it. Every wait state returns to `running` because waiting is
 * not progress; every limit lands on its own exhaustion state because the five
 * limits are fixed differently.
 */
export const RELAY_LOOP_TRANSITIONS: Readonly<
  Record<RelayLoopRuntimeState, readonly RelayLoopRuntimeState[]>
> = Object.freeze({
  /* ---- authoring: no work, no spend ---- */
  draft: ['validating', 'stopped', 'failed'],
  // Validation either admits the run (`queued`) or hands it back to the user.
  // `awaiting_confirmation` is where a DRAFT waits for a human; a run whose
  // confirmation already arrived passes straight to admission.
  validating: ['queued', 'awaiting_confirmation', 'draft', 'failed'],
  // Confirmation is the boundary. Nothing before it may dispatch an agent.
  awaiting_confirmation: ['validating', 'queued', 'draft', 'stopped'],

  /* ---- admission ---- */
  queued: ['starting', 'waiting_budget', 'waiting_dependency', 'waiting_approval', 'stopping', 'stopped', 'failed'],
  starting: ['planning', 'running', 'failed', 'stopping', 'recovery_required'],
  planning: ['running', 'stopping', 'failed', 'recovery_required'],

  /* ---- the iteration cycle ---- */
  running: [
    'observing',
    'pausing',
    'stopping',
    'rate_limited',
    'backing_off',
    'waiting_approval',
    'waiting_budget',
    'waiting_dependency',
    'timed_out',
    'failed',
    'recovery_required',
  ],
  observing: ['completion_check', 'pausing', 'stopping', 'failed', 'timed_out', 'recovery_required'],
  completion_check: [
    // Completion is the ONLY edge to `completed`, and it is reachable only
    // from here — so every completion passes the policy evaluation.
    'completed',
    // Continue the loop.
    'running',
    // Or stop, because a bound was reached. Each limit has its own landing.
    'iteration_exhausted',
    'duration_exhausted',
    'budget_exhausted',
    'token_exhausted',
    'provider_call_exhausted',
    'waiting_approval',
    'waiting_budget',
    'waiting_dependency',
    'pausing',
    'stopping',
    'failed',
    'recovery_required',
  ],

  /* ---- waiting: not progress, and never completion ---- */
  waiting_approval: ['running', 'pausing', 'stopping', 'stopped', 'timed_out', 'failed', 'recovery_required'],
  waiting_budget: ['running', 'budget_exhausted', 'stopping', 'stopped', 'failed', 'recovery_required'],
  waiting_dependency: ['running', 'stopping', 'stopped', 'timed_out', 'failed', 'recovery_required'],
  rate_limited: ['backing_off', 'running', 'stopping', 'stopped', 'timed_out', 'failed'],
  backing_off: ['running', 'rate_limited', 'stopping', 'stopped', 'timed_out', 'failed'],

  /* ---- pause / resume ---- */
  // `pausing` is a REQUEST, not a state of rest: the run stays here until the
  // active work reaches a safe checkpoint. Going straight to `paused` would be
  // claiming a safe boundary that was never reached.
  pausing: ['paused', 'running', 'stopping', 'failed', 'recovery_required'],
  paused: ['resuming', 'stopping', 'stopped', 'failed', 'recovery_required'],
  // Resume re-validates before it runs. It may discover the contract moved, the
  // budget is gone, or authorization lapsed — so it can land anywhere honest.
  resuming: [
    'running',
    'paused',
    'waiting_budget',
    'waiting_approval',
    'waiting_dependency',
    'budget_exhausted',
    'stopping',
    'failed',
    'recovery_required',
  ],

  /* ---- stop ---- */
  stopping: ['stopped', 'failed', 'recovery_required'],

  /* ---- recovery: the only non-terminal interruption ---- */
  recovery_required: ['resuming', 'stopping', 'stopped', 'failed'],

  /* ---- terminal: no edges out, ever ---- */
  completed: [],
  stopped: [],
  iteration_exhausted: [],
  duration_exhausted: [],
  budget_exhausted: [],
  token_exhausted: [],
  provider_call_exhausted: [],
  timed_out: [],
  failed: [],
});

/* ------------------------------------------------------ classification */

/**
 * WHAT KIND OF THING EACH STATE IS.
 *
 * Every runtime state belongs to exactly one class, and the exhaustiveness is
 * proved rather than assumed. The point is not tidiness — it is that four of
 * these classes are routinely conflated by systems that then lie about it:
 *
 *   `exhausted` is not `successful_terminal`. Running out of iterations is not
 *   finishing. Both stop the run; only one of them did the work.
 *
 *   `stopping` is not `unsuccessful_terminal`. A stop that was REQUESTED has
 *   not yet happened, and reporting it as done is how a surface shows "stopped"
 *   while an agent is still mid-call.
 *
 *   `waiting` is not `active`. A run blocked on approval is making no progress,
 *   and a progress indicator that cannot tell the difference is a lie told once
 *   a second.
 *
 *   `recovery` is neither active nor terminal. It is the state of not knowing,
 *   and it must not be collapsed into either neighbour.
 */
export const RELAY_LOOP_STATE_CLASSES = [
  /** Authoring and admission. No agent has been dispatched, nothing was spent. */
  'initial',
  /** The run is doing work right now. */
  'active',
  /** The run is blocked on something external. Not progress, not failure. */
  'waiting',
  /** At rest and continuable by an explicit human act. */
  'resumable',
  /** A halt was requested and has not completed. Still running, briefly. */
  'stopping',
  /** A bound was consumed. Terminal, and NOT completion. */
  'exhausted',
  /** The work was done and verified. The only class that means success. */
  'successful_terminal',
  /** Ended without the work being done. */
  'unsuccessful_terminal',
  /** The truth is uncertain and a human must look. Neither over nor running. */
  'recovery',
] as const;
export type RelayLoopStateClass = (typeof RELAY_LOOP_STATE_CLASSES)[number];

export const RELAY_LOOP_STATE_CLASS: Readonly<
  Record<RelayLoopRuntimeState, RelayLoopStateClass>
> = Object.freeze({
  draft: 'initial',
  validating: 'initial',
  awaiting_confirmation: 'initial',
  queued: 'initial',

  starting: 'active',
  planning: 'active',
  running: 'active',
  observing: 'active',
  completion_check: 'active',
  // Resuming is ACTIVE, not resumable: the run is re-checking authorization,
  // limits and contract binding. Work is happening. Calling it "resumable"
  // would invite a second resume on top of the one in flight.
  resuming: 'active',

  waiting_approval: 'waiting',
  waiting_budget: 'waiting',
  waiting_dependency: 'waiting',
  rate_limited: 'waiting',
  backing_off: 'waiting',

  paused: 'resumable',

  // Both are intents in progress. `pausing` is grouped with `stopping` and not
  // with `active` because what a surface must show for either is the same
  // sentence: something was asked for and has not finished happening yet.
  pausing: 'stopping',
  stopping: 'stopping',

  iteration_exhausted: 'exhausted',
  duration_exhausted: 'exhausted',
  budget_exhausted: 'exhausted',
  token_exhausted: 'exhausted',
  provider_call_exhausted: 'exhausted',

  completed: 'successful_terminal',

  stopped: 'unsuccessful_terminal',
  timed_out: 'unsuccessful_terminal',
  failed: 'unsuccessful_terminal',

  recovery_required: 'recovery',
});

export function classifyLoopState(state: RelayLoopRuntimeState): RelayLoopStateClass {
  return RELAY_LOOP_STATE_CLASS[state];
}

/** Every state in one class. Declared as a function so a surface can ask
 *  "what counts as waiting" without hard-coding a list that drifts. */
export function loopStatesInClass(
  stateClass: RelayLoopStateClass,
): readonly RelayLoopRuntimeState[] {
  return RELAY_LOOP_RUNTIME_STATES.filter((state) => RELAY_LOOP_STATE_CLASS[state] === stateClass);
}

/* ---------------------------------------------------------- predicates */

const TERMINAL = new Set<string>(TERMINAL_LOOP_STATES);
const EXHAUSTION = new Set<string>(EXHAUSTION_LOOP_STATES);

export function isTerminalLoopState(state: RelayLoopRuntimeState): boolean {
  return TERMINAL.has(state);
}

export function isExhaustionLoopState(state: RelayLoopRuntimeState): boolean {
  return EXHAUSTION.has(state);
}

/** Doing work right now. Deliberately excludes every wait state. */
export function isActiveLoopState(state: RelayLoopRuntimeState): boolean {
  return RELAY_LOOP_STATE_CLASS[state] === 'active';
}

/** Blocked on something external. Not progress — a surface must not animate it
 *  as though it were. */
export function isWaitingLoopState(state: RelayLoopRuntimeState): boolean {
  return RELAY_LOOP_STATE_CLASS[state] === 'waiting';
}

/** A halt was requested and has not landed yet. */
export function isStoppingLoopState(state: RelayLoopRuntimeState): boolean {
  return RELAY_LOOP_STATE_CLASS[state] === 'stopping';
}

/** The truth is uncertain. Neither finished nor safely continuable. */
export function isRecoveryLoopState(state: RelayLoopRuntimeState): boolean {
  return RELAY_LOOP_STATE_CLASS[state] === 'recovery';
}

/**
 * Did this run SUCCEED? The single question a surface, a notification and an
 * exit code all need, and the single place it is answered.
 *
 * Exactly one state says yes. Every exhaustion, every stop, every timeout and
 * every failure says no — which is the whole reason this function exists rather
 * than a scattered `state !== 'failed'`.
 */
export function loopRunSucceeded(state: RelayLoopRuntimeState): boolean {
  return RELAY_LOOP_STATE_CLASS[state] === 'successful_terminal';
}

/**
 * States in which an agent may be dispatched.
 *
 * Exactly one. Dispatching from `observing` would mean two agents on one
 * iteration; dispatching from a wait state would mean the wait meant nothing.
 */
export function mayDispatchAgent(state: RelayLoopRuntimeState): boolean {
  return state === 'running';
}

/** States a run may be resumed from. An unconfirmable run is not resumable
 *  without inspection, so `recovery_required` qualifies only via `resuming`,
 *  which re-checks everything. */
export function mayResumeFrom(state: RelayLoopRuntimeState): boolean {
  return state === 'paused' || state === 'recovery_required';
}

/* --------------------------------------------------------- transitions */

export type LoopTransitionResult =
  | { readonly ok: true; readonly state: RelayLoopRuntimeState }
  | {
      readonly ok: false;
      readonly from: RelayLoopRuntimeState;
      readonly to: RelayLoopRuntimeState;
      readonly reason: string;
    };

/**
 * Move a run from one state to another, or refuse.
 *
 * The refusal messages distinguish the three ways a move can be wrong, because
 * they call for different responses: a terminal run needs a NEW run, an
 * unknown state means a corrupt or newer record, and a merely-illegal edge is a
 * bug in the caller.
 */
export function transitionLoopRun(
  from: RelayLoopRuntimeState,
  to: RelayLoopRuntimeState,
): LoopTransitionResult {
  if (!(from in RELAY_LOOP_TRANSITIONS)) {
    return { ok: false, from, to, reason: `"${from}" is not a Loop runtime state this build knows.` };
  }
  if (!(to in RELAY_LOOP_TRANSITIONS)) {
    return { ok: false, from, to, reason: `"${to}" is not a Loop runtime state this build knows.` };
  }
  if (from === to) {
    // Idempotent re-entry is not a transition. Saying so explicitly keeps a
    // retried request from appending a second identical event.
    return { ok: false, from, to, reason: `The run is already ${from}; that is not a transition.` };
  }
  if (isTerminalLoopState(from)) {
    return {
      ok: false,
      from,
      to,
      reason:
        `${from} is terminal. A finished run is never restarted — continuing this work `
        + 'requires a new run against the same contract.',
    };
  }
  if (!RELAY_LOOP_TRANSITIONS[from].includes(to)) {
    return { ok: false, from, to, reason: `A Loop run cannot move from ${from} to ${to}.` };
  }
  return { ok: true, state: to };
}

/* ------------------------------------------------------- limit landings */

/** Which bound was hit, and therefore where the run lands. One place, so a
 *  caller cannot pair "tokens ran out" with `budget_exhausted`. */
export const RELAY_LOOP_LIMIT_LANDINGS = Object.freeze({
  iterations: 'iteration_exhausted',
  duration: 'duration_exhausted',
  spend: 'budget_exhausted',
  tokens: 'token_exhausted',
  provider_calls: 'provider_call_exhausted',
} as const satisfies Record<string, RelayLoopRuntimeState>);

export type RelayLoopLimitKind = keyof typeof RELAY_LOOP_LIMIT_LANDINGS;

export function landingForLimit(limit: RelayLoopLimitKind): RelayLoopRuntimeState {
  return RELAY_LOOP_LIMIT_LANDINGS[limit];
}

/* ------------------------------------------------------------- guards */

/** Every runtime state is a member of the canonical Loop vocabulary. Declared
 *  as a value so a test can assert it rather than trusting the type. */
export const RUNTIME_STATES_ARE_LOOP_STATES: readonly RelayLoopState[] =
  RELAY_LOOP_RUNTIME_STATES;
