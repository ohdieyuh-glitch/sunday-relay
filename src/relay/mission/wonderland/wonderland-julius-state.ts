/**
 * JULIUS, EMBODIED — the middle of the integration, and the only place where
 * "what Julius is actually doing" becomes "what the world shows".
 *
 * THE CHAIN THIS FILE COMPLETES
 *
 *   real runtime phase / Wonderland event
 *     -> JuliusVisualState        (this file: FUNCTION, never a vendor)
 *     -> OfficialRelayDogActivity (the shared identity module)
 *     -> OfficialRelayDogMotion   (what the body does)
 *     -> WonderlandDogAnimation   (the clip Unreal plays)
 *
 * Only the FIRST arrow is new. The other three already existed and are shared
 * with the 2-D website dog, which is the point: a second animation vocabulary
 * would let the browser and the world show different behaviour for the same
 * Relay state, and the whole Wonderland contract exists to make that
 * impossible. So this module adds a state layer and reuses everything below it.
 *
 * WHY A SEPARATE VOCABULARY AT ALL, THEN. `OfficialRelayDogActivity` says what
 * the animal is doing (`researching`, `reviewing`); it does not say which part
 * of Relay's pipeline is running. A viewer needs the second: "the independent
 * reviewer is running" is a product fact, "the dog is asleep" is its
 * presentation. The two are a BIJECTION here — eleven states, eleven
 * activities, proved in the test — so the layer costs nothing and cannot drift.
 *
 * PROVIDER NAMES ARE ABSENT BY CONSTRUCTION. No member of `JULIUS_VISUAL_STATES`
 * names a model, a vendor or an SDK, and a test asserts it. The user is shown
 * Julius's FUNCTION; which provider occupies a role slot is Relay's business and
 * changes nothing about what the world renders.
 *
 * THE HONESTY RULES, and where each one lives here:
 *
 *  1. UNKNOWN IS NEVER IDLE. `visualState` is `JuliusVisualState | null` and
 *     `null` means Relay has said nothing. It renders as `dormant`, never as
 *     `idle` — idle is an observed state and dormant is the absence of one.
 *     `unobservedReason` carries a sentence whenever the state is null.
 *
 *  2. A DISCONNECTION IS NEVER A COMPLETION. `terminal` is set ONLY by an event
 *     that reports a real ending. Nothing about transport — a dropped stream, a
 *     gap in the sequence, a reconnect — can produce `complete`.
 *
 *  3. BLOCKED AND ERROR ARE NOT COMPLETE, AND CANCELLED IS NEITHER OF THE
 *     THREE. A budget ceiling and a safe cancellation are stops, not faults and
 *     not successes; a failed reviewer launch is a fault. Three different
 *     facts, three different states, tested as such.
 *
 *  4. THE PHASE OUTRANKS THE EVENT TYPE. `MissionPhase` is the backend's own
 *     persisted authority and carries 28 members; `WonderlandEventType` is a
 *     lossy projection of it with nine phases mapped onto seven agent events.
 *     When an event carries `relayPhase` in its payload the phase decides, and
 *     `stateSource` records which link was used, so a surface can tell a
 *     precise reading from an inferred one.
 *
 * PURE. No Node, no network, no clock — every instant is an injected ISO string
 * and every fold is a pure function, exactly like the rest of `mission/`.
 */

import {
  OFFICIAL_RELAY_DOG_ACTIVITIES,
  OFFICIAL_RELAY_DOG_ACTIVITY_MOTION,
  OFFICIAL_RELAY_DOG_ACTIVITY_PRIORITY,
  officialRelayDogView,
} from '../../shared/official-relay-dog-states';
import type {
  OfficialRelayDogActivity,
  OfficialRelayDogMotion,
} from '../../shared/official-relay-dog-states';
import { JULIUS_MISSION_STATES } from '../julius/julius-runtime';
import type { JuliusMissionState } from '../julius/julius-runtime';
import type { JuliusOperationalEventType } from '../julius/julius-events';
import type { MissionPhase, RelayMissionState } from '../wire-contracts';
import { exactKeys, wonderlandAnimationFor } from './wonderland-contracts';
import type { WonderlandDogAnimation } from './wonderland-contracts';
import type { WonderlandEvent, WonderlandEventType } from './wonderland-backend';

/* ------------------------------------------------------------ versioning */

export const JULIUS_EMBODIMENT_SCHEMA_V1 = 'relay-julius-embodiment.v1' as const;
export type JuliusEmbodimentSchemaVersion = typeof JULIUS_EMBODIMENT_SCHEMA_V1;

/* --------------------------------------------------------- visual states */

/**
 * WHAT JULIUS IS DOING, in the product's own words.
 *
 * Eleven, and each one is a distinct thing a viewer can act on:
 *
 *   idle                nothing is running and nothing is pending
 *   attention           intent received; a role is engaged but not yet working
 *   prompt_architect    the Prompt Architect is producing the handoff
 *   coding              the Coding Agent is writing
 *   handoff             work product is moving between roles; none is running
 *   independent_review  the independent reviewer is judging the work
 *   repair              a repair pass is running against review findings
 *   verifying           Relay itself is checking a claim or adjudicating
 *   complete            a real ending with a validated outcome
 *   blocked             stopped without a fault: a ceiling, a gate, a cancel
 *   error               stopped by a fault
 *
 * `handoff` is a state and not a gap, deliberately. `handoff_ready`,
 * `coding_agent_assigned`, `coding_agent_starting`, `claim_submitted`,
 * `reviewer_assigned` and `reviewer_starting` are six phases in which NO role is
 * executing and work is being carried between two of them. Rendering any of
 * them as `coding` or `independent_review` would announce an intention as a
 * fact — "Connected only after a verified launch" is the same rule — and
 * rendering them as `idle` would hide a running mission. So the carry is its
 * own state, and the Dog carries.
 */
export const JULIUS_VISUAL_STATES = [
  'idle',
  'attention',
  'prompt_architect',
  'coding',
  'handoff',
  'independent_review',
  'repair',
  'verifying',
  'complete',
  'blocked',
  'error',
] as const;
export type JuliusVisualState = (typeof JULIUS_VISUAL_STATES)[number];

/**
 * VISUAL STATE -> DOG ACTIVITY. Total, and a bijection.
 *
 * Total in both directions is what makes this layer free: a new Relay function
 * has nowhere to go until the shared identity module has an activity for it,
 * and a new activity leaves a state unclaimed. The bijection is asserted in the
 * test rather than assumed here, because "eleven and eleven" is a coincidence
 * until something checks that the eleven are distinct.
 *
 * `blocked -> waiting_for_user` is the load-bearing entry. A blocked mission
 * needs a human, and `waiting_for_user` is the one activity whose behaviour
 * sets `attentionRequired` without claiming a fault. A budget ceiling animated
 * as `error` would tell a founder their agent broke.
 */
export const JULIUS_VISUAL_STATE_ACTIVITY: Readonly<
  Record<JuliusVisualState, OfficialRelayDogActivity>
> = Object.freeze({
  idle: 'idle',
  attention: 'thinking',
  prompt_architect: 'researching',
  coding: 'implementing',
  handoff: 'handoff',
  independent_review: 'reviewing',
  repair: 'repairing',
  verifying: 'verifying',
  complete: 'complete',
  blocked: 'waiting_for_user',
  error: 'error',
});

/**
 * DETERMINISTIC INTERRUPT ORDER, DERIVED rather than restated.
 *
 * Two signals must never animate at once, and the shared identity module
 * already decided which wins: a failure outranks everything, a blocked human
 * outranks any machine work, review and verification outrank the work they
 * judge, idle is always last. Restating that table here would be a second
 * opinion that could disagree with the website's; deriving it through the
 * bijection means it cannot.
 *
 * Lower wins. Ties are impossible because the activity map is injective.
 */
export const JULIUS_VISUAL_STATE_PRIORITY: Readonly<Record<JuliusVisualState, number>> =
  Object.freeze(
    Object.fromEntries(
      JULIUS_VISUAL_STATES.map((state) => [
        state,
        OFFICIAL_RELAY_DOG_ACTIVITY_PRIORITY[JULIUS_VISUAL_STATE_ACTIVITY[state]],
      ]),
    ) as Record<JuliusVisualState, number>,
  );

/** The single highest-priority state among candidates, or `null` for none. */
export function resolveJuliusVisualState(
  candidates: readonly JuliusVisualState[],
): JuliusVisualState | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort(
    (a, b) => JULIUS_VISUAL_STATE_PRIORITY[a] - JULIUS_VISUAL_STATE_PRIORITY[b],
  )[0];
}

/**
 * States that assert an ENDING, and must never be reached by inference.
 *
 * Kept as data so the reducer's terminal rule and the test that forbids a
 * disconnection from producing one read the same list.
 */
export const JULIUS_ENDING_STATES: readonly JuliusVisualState[] = Object.freeze([
  'complete',
  'blocked',
  'error',
]);

/** True for the one state that claims a validated, successful ending. */
export const isJuliusSuccessState = (state: JuliusVisualState | null): boolean =>
  state === 'complete';

/* ------------------------------------------------- phase -> visual state */

/**
 * THE AUTHORITATIVE DERIVATION: the backend's persisted phase.
 *
 * `MissionPhase` is written before the next role is allowed to begin, which is
 * exactly the guarantee a world needs — the phase is never a prediction. Total
 * over all 28 members, so a phase added to the live runtime fails `tsc` here
 * rather than silently rendering as whatever ordinal 0 happens to be.
 *
 * THE THREE JUDGEMENT CALLS, stated rather than buried:
 *
 *  - `prompt_architect_queued` is `attention`, NOT `prompt_architect`. Queued
 *    is not working. The coarse `PHASE_STATE` table in the live runtime maps it
 *    to `architect_working` because the browser's union has no finer state;
 *    this one does, and copying the coarser claim would import an over-claim.
 *
 *  - `claim_submitted` is `handoff`. The Coding Agent has stopped and Relay has
 *    not started: the claim is in transit, and a claim is not a verification.
 *
 *  - `cancelled` is `blocked`, not `complete` and not `error`. A safe stop is
 *    an ending with no outcome. The shared dog table maps its `stopped_safely`
 *    to the `complete` ACTIVITY, which is right for a resting pose and wrong as
 *    a product claim, so the two part company here on purpose.
 *
 * `verification_failed` is `error` rather than `repair`: in this build there is
 * no repair iteration (`NO_REPAIR_RULE` in the live runtime), so a repair
 * animation would show work nothing performs.
 */
export const JULIUS_PHASE_VISUAL_STATE: Readonly<Record<MissionPhase, JuliusVisualState>> =
  Object.freeze({
    ready: 'idle',
    preflight_checking: 'attention',
    prompt_architect_queued: 'attention',
    prompt_architect_working: 'prompt_architect',
    handoff_ready: 'handoff',
    coding_agent_assigned: 'handoff',
    coding_agent_starting: 'handoff',
    coding: 'coding',
    claim_submitted: 'handoff',
    relay_verifying: 'verifying',
    reviewer_assigned: 'handoff',
    reviewer_starting: 'handoff',
    reviewer_working: 'independent_review',
    review_received: 'verifying',
    completion_deciding: 'verifying',
    verified_complete: 'complete',
    // stops without a fault
    preflight_blocked: 'blocked',
    review_blocked: 'blocked',
    budget_exhausted: 'blocked',
    cancelled: 'blocked',
    // faults
    prompt_architect_failed: 'error',
    prompt_architect_output_invalid: 'error',
    dispatch_status_uncertain: 'error',
    coding_agent_failed: 'error',
    verification_failed: 'error',
    reviewer_launch_failed: 'error',
    review_incomplete: 'error',
    timed_out: 'error',
  });

/**
 * Phases that END a mission. Total, so a new phase must declare its finality.
 *
 * This mirrors the live runtime's `TERMINAL_FAILURE` set plus the two
 * non-failure endings, and the test pins the two lists against each other by
 * shape: every phase whose visual state is an ending state and which is not
 * itself a transient must appear here. Terminality is a property of the PHASE,
 * not of the visual state — `error` is reachable mid-run from a failed
 * verification event and recovers into `repair`.
 */
export const JULIUS_PHASE_TERMINAL: Readonly<Record<MissionPhase, boolean>> = Object.freeze({
  ready: false,
  preflight_checking: false,
  prompt_architect_queued: false,
  prompt_architect_working: false,
  handoff_ready: false,
  coding_agent_assigned: false,
  coding_agent_starting: false,
  coding: false,
  claim_submitted: false,
  relay_verifying: false,
  reviewer_assigned: false,
  reviewer_starting: false,
  reviewer_working: false,
  review_received: false,
  completion_deciding: false,
  verified_complete: true,
  preflight_blocked: true,
  prompt_architect_failed: true,
  prompt_architect_output_invalid: true,
  dispatch_status_uncertain: true,
  coding_agent_failed: true,
  verification_failed: true,
  reviewer_launch_failed: true,
  review_incomplete: true,
  review_blocked: true,
  cancelled: true,
  timed_out: true,
  budget_exhausted: true,
});

/** Every `MissionPhase`, DERIVED from the total map so it cannot under-report. */
export const JULIUS_MISSION_PHASES = Object.keys(
  JULIUS_PHASE_VISUAL_STATE,
) as readonly MissionPhase[];

const PHASE_MEMBERS: ReadonlySet<string> = new Set<string>(JULIUS_MISSION_PHASES);

/** True when `value` is a phase the live runtime can actually report. */
export const isMissionPhase = (value: unknown): value is MissionPhase =>
  typeof value === 'string' && PHASE_MEMBERS.has(value);

/* --------------------------------------------- run state -> visual state */

/**
 * THE KERNEL'S OWN STATE MACHINE — the most direct authority there is.
 *
 * `JuliusMissionState` is the orchestration kernel's thirteen-state model, with
 * a guarded `TRANSITIONS` table beside it: the kernel refuses an illegal move
 * rather than recording one. Reading it means the world's state cannot be a
 * state Julius could not have been in.
 *
 * It is also the only vocabulary that names `REPAIRING` natively, which is why
 * `repair` is a first-class state here and not an aspiration.
 *
 * WAITING AND BLOCKED BOTH RENDER AS `blocked`, and the distinction is not
 * lost: the raw kernel state travels on the embodiment as `sourceState`, the
 * same way `WonderlandAgent` keeps `workspaceState` "for traceability". The
 * world shows one behaviour for both because there is one thing to show — the
 * mission is not progressing and something outside it must move — and
 * inventing a second animation to distinguish two flavours of not-progressing
 * would be motion the product does not perform.
 *
 * `PAUSED` and `CANCELLED` are `blocked` for the same reason `cancelled` is in
 * the phase table: a stop is not a fault and it is not a success.
 */
export const JULIUS_RUN_STATE_VISUAL_STATE: Readonly<
  Record<JuliusMissionState, JuliusVisualState>
> = Object.freeze({
  CREATED: 'attention',
  PLANNING: 'prompt_architect',
  READY: 'handoff',
  EXECUTING: 'coding',
  WAITING: 'blocked',
  REVIEWING: 'independent_review',
  REPAIRING: 'repair',
  VERIFYING: 'verifying',
  BLOCKED: 'blocked',
  PAUSED: 'blocked',
  FAILED: 'error',
  COMPLETED: 'complete',
  CANCELLED: 'blocked',
});

const RUN_STATE_MEMBERS: ReadonlySet<string> = new Set<string>(JULIUS_MISSION_STATES);

/** True when `value` is a state the Julius kernel can actually hold. */
export const isJuliusMissionState = (value: unknown): value is JuliusMissionState =>
  typeof value === 'string' && RUN_STATE_MEMBERS.has(value);

/* ------------------------------------------ coarse state -> visual state */

/**
 * THE BROWSER'S COARSE UNION, for a surface that holds nothing finer.
 *
 * `RelayMissionState` is what the website renders. It is the least precise of
 * the three derivations and is kept because a caller holding only this must
 * still get a truthful answer rather than reaching for a default.
 *
 * `approved` is `verifying`, not `complete`. An approval is a reviewer's
 * verdict; completion is Relay's, and the mission status model exists because
 * those are different facts.
 */
export const RELAY_MISSION_STATE_VISUAL_STATE: Readonly<
  Record<RelayMissionState, JuliusVisualState>
> = Object.freeze({
  configured: 'idle',
  ready: 'idle',
  architect_working: 'prompt_architect',
  handoff_ready: 'handoff',
  coding: 'coding',
  claim_submitted: 'handoff',
  relay_verifying: 'verifying',
  reviewer_reviewing: 'independent_review',
  repair_required: 'blocked',
  repair_in_progress: 'repair',
  re_verifying: 'verifying',
  approved: 'verifying',
  verified_complete: 'complete',
  failed: 'error',
  cancelled: 'blocked',
});

/* ------------------------------------------- event type -> visual state */

/**
 * THE LOSSY FALLBACK, used only when an event carries no `relayPhase`.
 *
 * Partial on purpose. `mission.stage_changed` names no stage in its type and
 * its payload shape is not a contract, so it maps to nothing rather than to a
 * guess; every `battle.*`, `presence.*`, `subagent.*` and `project_avatar.*`
 * event is somebody else's subject and moves the cursor without touching what
 * Julius is doing. An event absent from this table is IGNORED and counted, and
 * that count is part of the state so a surface can see the world is receiving
 * traffic it does not model.
 *
 * `verification.failed` is `error` and NOT terminal: a failed verification is a
 * real negative result that a repair can follow, and this table says what is
 * happening, never whether the mission is over. Only `mission.completed` and
 * `mission.failed` end things, and they do it through `JULIUS_TERMINAL_EVENTS`.
 */
export const JULIUS_EVENT_VISUAL_STATE: Readonly<
  Partial<Record<WonderlandEventType, JuliusVisualState>>
> = Object.freeze({
  'mission.created': 'attention',
  'mission.started': 'attention',
  'mission.completed': 'complete',
  'mission.failed': 'error',
  'agent.planning': 'prompt_architect',
  'agent.implementing': 'coding',
  'agent.reviewing': 'independent_review',
  'agent.verifying': 'verifying',
  'agent.repairing': 'repair',
  'agent.complete': 'complete',
  'agent.error': 'error',
  'verification.started': 'verifying',
  'verification.finding': 'verifying',
  'verification.failed': 'error',
  'verification.passed': 'verifying',
});

/**
 * The only events that may assert an ENDING.
 *
 * Kept apart from the state table because "what is happening" and "is it over"
 * are different questions, and the second is the one a disconnection must never
 * be able to answer. Nothing in the reducer sets `terminal` from anything else.
 */
export const JULIUS_TERMINAL_EVENTS: readonly WonderlandEventType[] = Object.freeze([
  'mission.completed',
  'mission.failed',
]);

const TERMINAL_EVENT_MEMBERS: ReadonlySet<string> = new Set<string>(JULIUS_TERMINAL_EVENTS);

/* ------------------------------------------------------- reading a state */

/**
 * Where a visual state came from, ORDERED MOST PRECISE FIRST.
 *
 * Provenance travels with the reading because a surface must be able to tell a
 * state the kernel asserted from one inferred out of an event's name. The order
 * is the precedence the reader applies, and it is declared as data so the test
 * that checks the reader cannot restate it differently.
 */
export const JULIUS_STATE_SOURCES = ['julius_run_state', 'relay_phase', 'event_type'] as const;
export type JuliusStateSource = (typeof JULIUS_STATE_SOURCES)[number];

/** The payload key the normalizer writes the kernel's own state under. */
export const JULIUS_RUN_STATE_PAYLOAD_KEY = 'juliusRunState' as const;
/** The payload key the live runtime's phase hook already writes. */
export const JULIUS_RELAY_PHASE_PAYLOAD_KEY = 'relayPhase' as const;

export interface JuliusStateReading {
  readonly visualState: JuliusVisualState;
  readonly source: JuliusStateSource;
  /** The phase, when one was carried. Kept for traceability, never re-derived. */
  readonly relayPhase: MissionPhase | null;
  /**
   * The raw upstream state string, whatever vocabulary produced it.
   *
   * The same role `workspaceState` plays on `WonderlandAgent`: the visual layer
   * collapses distinctions the world has no separate behaviour for, and this
   * field means nothing is destroyed by the collapse.
   */
  readonly sourceState: string | null;
}

/**
 * Read a visual state out of one event. `null` when the event says nothing
 * about Julius — which is not the same as saying Julius is idle.
 *
 * THREE LINKS, MOST PRECISE FIRST, and the order is the whole point:
 *
 *  1. `juliusRunState` — the orchestration kernel's own guarded state. Thirteen
 *     members, and the kernel refuses an illegal transition rather than
 *     recording one, so this is the strongest claim available.
 *  2. `relayPhase` — the live runtime's persisted phase, written before the
 *     next role is allowed to begin. Twenty-eight members.
 *  3. the event type — a name, and a lossy one: nine phases already collapse
 *     onto seven `agent.*` types before they reach here.
 *
 * Reading a coarser field when a finer one is present would throw away
 * precision Relay already paid for, which is why this is a precedence and not
 * a fallback chain that stops at the first key that exists.
 */
export function readJuliusState(event: WonderlandEvent): JuliusStateReading | null {
  const payload = event.payload as Readonly<Record<string, unknown>>;

  const runState = payload[JULIUS_RUN_STATE_PAYLOAD_KEY];
  if (isJuliusMissionState(runState)) {
    return {
      visualState: JULIUS_RUN_STATE_VISUAL_STATE[runState],
      source: 'julius_run_state',
      relayPhase: null,
      sourceState: runState,
    };
  }

  const phase = payload[JULIUS_RELAY_PHASE_PAYLOAD_KEY];
  if (isMissionPhase(phase)) {
    return {
      visualState: JULIUS_PHASE_VISUAL_STATE[phase],
      source: 'relay_phase',
      relayPhase: phase,
      sourceState: phase,
    };
  }

  const inferred = JULIUS_EVENT_VISUAL_STATE[event.eventType];
  if (inferred === undefined) return null;
  return {
    visualState: inferred,
    source: 'event_type',
    relayPhase: null,
    sourceState: event.eventType,
  };
}

/* ------------------------------- operational event -> normalized subject */

/**
 * THE KERNEL'S EVENT CATALOGUE, AS FAR AS THE WORLD CAN TRUTHFULLY READ IT.
 *
 * `JuliusOperationalEventType` has 34 members and this table claims eleven.
 * The twenty-three absences are the point, so each class is named:
 *
 *  - `task.*` says a TASK moved. Without the task's role — which the event does
 *    not carry — a claimed task could be the architect, the coder or the
 *    reviewer, and picking one would be a guess rendered as a fact.
 *  - `worker.*`, `reroute.selected`, `fallback.selected`, `retry.scheduled`,
 *    `provider.failure` are dispatch mechanics. A provider failing is not a run
 *    failing; a reroute exists precisely so it is not.
 *  - `repair.scheduled` is an INTENTION. "Announce facts, not intentions" is
 *    the rule, and the fact arrives as `run.transitioned` to `REPAIRING`.
 *  - `evidence.recorded`, `context.compiled`, `budget.reserved/settled`,
 *    `subagent.*`, `recovery.action`, `approval.decided` describe work about
 *    the mission rather than a change in what Julius is doing.
 *
 * Everything absent still advances the cursor and is counted. Nothing is
 * invented to fill it.
 *
 * `approval.requested` and `budget.denied` ARE claimed, and both are `blocked`:
 * a run waiting on a human and a run refused its spend are both stopped and
 * both need a person, which is exactly what `blocked` means.
 */
export const JULIUS_OPERATIONAL_EVENT_VISUAL_STATE: Readonly<
  Partial<Record<JuliusOperationalEventType, JuliusVisualState>>
> = Object.freeze({
  'run.created': 'attention',
  'run.paused': 'blocked',
  'run.resumed': 'attention',
  'run.cancelled': 'blocked',
  'run.completed': 'complete',
  'run.failed': 'error',
  'review.started': 'independent_review',
  'finding.recorded': 'independent_review',
  'verification.decided': 'verifying',
  'approval.requested': 'blocked',
  'budget.denied': 'blocked',
});

/* --------------------------------------------------------- the embodiment */

/**
 * ONE JULIUS INSTANCE, AS THE WORLD HOLDS IT.
 *
 * A fold over the event stream, and nothing else: no timers, no heuristics, no
 * "it has been quiet so it must be idle". Every field is either something an
 * event asserted or an explicit absence.
 *
 * The three rejection counters are part of the state rather than a log because
 * they are the transport's honesty: a surface that has rejected forty stale
 * events and observed two sequence gaps is in a different situation from one
 * that has received a clean stream, and a world that could not tell them apart
 * would animate both identically.
 */
export interface JuliusEmbodiment {
  readonly schemaVersion: JuliusEmbodimentSchemaVersion;
  /** The world this Julius belongs to. Events from another are not ours. */
  readonly projectId: string;
  /** Null until an event names one. Never invented. */
  readonly missionId: string | null;
  readonly agentId: string | null;
  /** Null means Relay has said nothing. It is not `idle`. */
  readonly visualState: JuliusVisualState | null;
  readonly stateSource: JuliusStateSource | null;
  /** The phase behind the state, when one travelled. */
  readonly relayPhase: MissionPhase | null;
  /** The raw upstream state string, kept so the visual collapse loses nothing. */
  readonly sourceState: string | null;
  readonly activity: OfficialRelayDogActivity | null;
  readonly motion: OfficialRelayDogMotion | null;
  /** `dormant` whenever the state is unobserved. Never `patrol_walk`. */
  readonly animation: WonderlandDogAnimation;
  /** Null when unobserved — an unknown state neither asks nor rests. */
  readonly attentionRequired: boolean | null;
  /** Set ONLY by a real ending event. No transport condition can set it. */
  readonly terminal: boolean;
  /** A sentence whenever `visualState` is null. Never a bare flag. */
  readonly unobservedReason: string | null;
  /** Highest applied project sequence. Resume a stream from exactly this. */
  readonly sequence: number;
  /** The event timestamp that produced the current state. */
  readonly observedAtIso: string | null;
  readonly staleEventsRejected: number;
  readonly foreignProjectEventsRejected: number;
  readonly foreignMissionEventsSkipped: number;
  readonly unmodelledEventsIgnored: number;
  /** Times the sequence jumped by more than one. Replay is how it is repaired. */
  readonly sequenceGapsObserved: number;
}

export const JULIUS_EMBODIMENT_FIELDS = exactKeys<JuliusEmbodiment>()([
  'schemaVersion',
  'projectId',
  'missionId',
  'agentId',
  'visualState',
  'stateSource',
  'relayPhase',
  'sourceState',
  'activity',
  'motion',
  'animation',
  'attentionRequired',
  'terminal',
  'unobservedReason',
  'sequence',
  'observedAtIso',
  'staleEventsRejected',
  'foreignProjectEventsRejected',
  'foreignMissionEventsSkipped',
  'unmodelledEventsIgnored',
  'sequenceGapsObserved',
] as const);

/** The sentence an unobserved Julius carries. One wording, one place. */
export const JULIUS_UNOBSERVED_REASON =
  'Relay has reported no state for this Julius instance yet.';

/**
 * A Julius nothing has been said about.
 *
 * `sequence: 0` is the correct resume cursor for "replay everything", which is
 * what the events route means by `cursor=0`, so a fresh embodiment and a
 * reconnect use the same call.
 */
export function emptyJuliusEmbodiment(input: {
  readonly projectId: string;
  readonly missionId?: string | null;
  readonly agentId?: string | null;
}): JuliusEmbodiment {
  return Object.freeze({
    schemaVersion: JULIUS_EMBODIMENT_SCHEMA_V1,
    projectId: input.projectId,
    missionId: input.missionId ?? null,
    agentId: input.agentId ?? null,
    visualState: null,
    stateSource: null,
    relayPhase: null,
    sourceState: null,
    activity: null,
    motion: null,
    animation: wonderlandAnimationFor(null),
    attentionRequired: null,
    terminal: false,
    unobservedReason: JULIUS_UNOBSERVED_REASON,
    sequence: 0,
    observedAtIso: null,
    staleEventsRejected: 0,
    foreignProjectEventsRejected: 0,
    foreignMissionEventsSkipped: 0,
    unmodelledEventsIgnored: 0,
    sequenceGapsObserved: 0,
  });
}

/** Apply the presentation layers for one observed state. */
function present(state: JuliusVisualState): {
  activity: OfficialRelayDogActivity;
  motion: OfficialRelayDogMotion;
  animation: WonderlandDogAnimation;
  attentionRequired: boolean;
} {
  const activity = JULIUS_VISUAL_STATE_ACTIVITY[state];
  const motion = OFFICIAL_RELAY_DOG_ACTIVITY_MOTION[activity];
  return {
    activity,
    motion,
    animation: wonderlandAnimationFor(motion),
    attentionRequired: officialRelayDogView(activity).attentionRequired,
  };
}

/**
 * FOLD ONE EVENT INTO ONE JULIUS. The whole ordering policy is here.
 *
 *  - A DIFFERENT PROJECT is not ours. Rejected, and the cursor does NOT move:
 *    advancing on somebody else's world would skip our own replay.
 *
 *  - A SEQUENCE AT OR BELOW THE CURSOR is stale or a duplicate. Rejected. This
 *    is the rule that makes reconnect-and-replay safe: the events route replays
 *    from a cursor and the live subscription overlaps it deliberately, so
 *    duplicates are expected traffic rather than an error.
 *
 *  - A GAP is accepted and COUNTED. Refusing it would strand the world on a
 *    stale state forever after one dropped delivery; hiding it would make a
 *    lossy stream indistinguishable from a clean one. Replaying from
 *    `sequence` is the repair, and it is the caller's to perform.
 *
 *  - A DIFFERENT MISSION inside our project advances the cursor and changes
 *    nothing. It was delivered in order and it is not about this Julius.
 *
 *  - AN EVENT THIS MODEL DOES NOT MAP advances the cursor and changes nothing.
 *    Presence, battles, avatars and subagent traffic are all legitimate world
 *    events that say nothing about the mission pipeline.
 *
 * `terminal` LATCHES. Once a real ending has been reported, a later event may
 * still refine what is displayed, but nothing un-ends a mission — and a
 * `terminal` that could be cleared by a stray event is a completion that can be
 * taken back, which is the same untruth in the other direction.
 */
export function applyJuliusEvent(
  current: JuliusEmbodiment,
  event: WonderlandEvent,
): JuliusEmbodiment {
  if (event.projectId !== current.projectId) {
    return Object.freeze({
      ...current,
      foreignProjectEventsRejected: current.foreignProjectEventsRejected + 1,
    });
  }
  if (!Number.isSafeInteger(event.sequence) || event.sequence <= current.sequence) {
    return Object.freeze({ ...current, staleEventsRejected: current.staleEventsRejected + 1 });
  }

  const gaps =
    current.sequenceGapsObserved +
    (current.sequence > 0 && event.sequence > current.sequence + 1 ? 1 : 0);
  const advanced = { ...current, sequence: event.sequence, sequenceGapsObserved: gaps };

  // A mission we are not watching. In order, not ours, cursor moves on.
  if (
    current.missionId !== null &&
    event.missionId !== null &&
    event.missionId !== current.missionId
  ) {
    return Object.freeze({
      ...advanced,
      foreignMissionEventsSkipped: current.foreignMissionEventsSkipped + 1,
    });
  }

  const reading = readJuliusState(event);
  if (reading === null) {
    return Object.freeze({
      ...advanced,
      unmodelledEventsIgnored: current.unmodelledEventsIgnored + 1,
    });
  }

  return Object.freeze({
    ...advanced,
    // Identity is LEARNED, never overwritten with null by a broader event.
    missionId: event.missionId ?? current.missionId,
    agentId: event.agentId ?? current.agentId,
    visualState: reading.visualState,
    stateSource: reading.source,
    relayPhase: reading.relayPhase,
    sourceState: reading.sourceState,
    ...present(reading.visualState),
    terminal: current.terminal || TERMINAL_EVENT_MEMBERS.has(event.eventType),
    unobservedReason: null,
    observedAtIso: event.timestamp,
  });
}

/**
 * REHYDRATION — the reconnect path, as one pure fold.
 *
 * This is the whole recovery design and it is deliberately not a special case:
 * a client that lost its stream asks the events route for everything after
 * `sequence`, folds the replay through the same reducer, and arrives at the
 * same state it would have reached had it never disconnected. Nothing here
 * treats a reconnect as an event, because it is not one — the world did not
 * change when the socket did.
 */
export function rehydrateJuliusEmbodiment(
  input: {
    readonly projectId: string;
    readonly missionId?: string | null;
    readonly agentId?: string | null;
  },
  events: readonly WonderlandEvent[],
): JuliusEmbodiment {
  return events.reduce(applyJuliusEvent, emptyJuliusEmbodiment(input));
}

/** The cursor to resume a stream from. Exactly the highest applied sequence. */
export const juliusReplayCursor = (state: JuliusEmbodiment): number => state.sequence;

/* --------------------------------------------------------------- parity */

/**
 * Every dog activity, derived from the bijection so the C++ enum and this
 * module cannot disagree about how many there are.
 */
export const JULIUS_VISUAL_STATE_ACTIVITIES = OFFICIAL_RELAY_DOG_ACTIVITIES;
