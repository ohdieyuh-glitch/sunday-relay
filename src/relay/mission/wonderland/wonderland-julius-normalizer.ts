/**
 * THE NORMALIZER — a real Julius runtime event becomes a Wonderland event.
 *
 * This is the adapter `integration/terminal/julius-event-port.ts` says has to
 * exist ("will need to know the runtime's field names") and did not. Without it
 * the world can only learn about missions that happen to be BATTLES:
 * `WonderlandBackend.observeRelayTransition` looks a battle up by mission id and
 * returns nothing when there is none, so an ordinary Julius run — which is what
 * a founder actually runs — produced no world events at all.
 *
 * WHAT IT REFUSES TO DO, which is most of what it does:
 *
 *  - IT DOES NOT INVENT A SEQUENCE. `sequence` is allocated by the ledger
 *    (`stream_sequences.next_sequence`, one row per run, serializable), never by
 *    an emitter, so it is an INPUT here. A normalizer that numbered its own
 *    output would produce two disagreeing orderings for the same stream.
 *
 *  - IT DOES NOT INVENT A WONDERLAND TYPE. Twenty-three of the kernel's
 *    thirty-four event types have no truthful counterpart in the world's closed
 *    vocabulary. Those return `null`. A `mission.stage_changed` standing in for
 *    `budget.settled` would be a world event asserting a stage change that did
 *    not happen.
 *
 *  - IT DOES NOT INVENT AN AGENT OR A PLAYER. `agentId`, `playerId`,
 *    `sessionId` and `battleId` come from the caller's identity or travel as
 *    null. The kernel's `workerId` is NOT an `agentId`: a worker is a dispatch
 *    slot and an agent is a thing a person owns.
 *
 *  - IT DOES NOT FORWARD FACTS WHOLESALE. Only the facts the world reads are
 *    carried, and `WonderlandBackend.redact` is applied to whatever is carried,
 *    so a fact the kernel's own validator let through cannot reach a browser
 *    unredacted.
 *
 * WHAT IT DOES CARRY, and this is the load-bearing part: when the kernel
 * reports a run transition, the DESTINATION STATE travels in the payload under
 * `juliusRunState`. That is what lets `readJuliusState` reach the kernel's own
 * thirteen-state model instead of guessing from an event name — the difference
 * between the world knowing Julius is REPAIRING and the world knowing something
 * happened.
 *
 * PURE. No clock, no ids generated here — `eventId` and `sequence` are injected,
 * exactly like `observedAtIso` everywhere else in this module.
 */

import type {
  JuliusOperationalEvent,
  JuliusOperationalEventType,
} from '../julius/julius-events';
import type { JuliusMissionState } from '../julius/julius-runtime';
import {
  WONDERLAND_EVENT_SCHEMA_VERSION,
  redact,
  type WonderlandEvent,
  type WonderlandEventType,
  type WonderlandVisibility,
} from './wonderland-backend';
import {
  JULIUS_RUN_STATE_PAYLOAD_KEY,
  isJuliusMissionState,
} from './wonderland-julius-state';

/**
 * KERNEL EVENT TYPE -> WORLD EVENT TYPE. Partial, and the gaps are the design.
 *
 * Eleven of thirty-four. Every absence is a kernel event whose meaning has no
 * home in `WONDERLAND_EVENT_TYPES` without a claim the event does not make —
 * see the same reasoning laid out beside
 * `JULIUS_OPERATIONAL_EVENT_VISUAL_STATE`, which this table deliberately
 * agrees with in shape: an event that cannot name a world type also cannot
 * name a visual state, because both would be the same guess.
 *
 * The four `run.*` transitions all become `mission.stage_changed` and are told
 * apart by the payload, not by the type. That is on purpose: the world's
 * vocabulary has one "something moved" event and the kernel has a guarded
 * thirteen-state machine, so the precision belongs in the payload where a
 * reader can use it, rather than in a type name a closed union cannot grow.
 */
export const JULIUS_TO_WONDERLAND_EVENT_TYPE: Readonly<
  Partial<Record<JuliusOperationalEventType, WonderlandEventType>>
> = Object.freeze({
  'run.created': 'mission.created',
  'run.transitioned': 'mission.stage_changed',
  'run.paused': 'mission.stage_changed',
  'run.resumed': 'mission.stage_changed',
  'run.cancelled': 'mission.stage_changed',
  'run.completed': 'mission.completed',
  'run.failed': 'mission.failed',
  'review.started': 'agent.reviewing',
  'finding.recorded': 'verification.finding',
  'subagent.spawned': 'subagent.spawned',
  'subagent.completed': 'subagent.completed',
});

/**
 * The fact keys the kernel uses for a transition's destination state.
 *
 * Two, because `run.transitioned` is emitted by more than one code path and the
 * catalogue does not fix a fact schema. Both are checked and the value must be
 * a real `JuliusMissionState` — an unrecognised string is dropped rather than
 * carried, so a renamed fact key degrades the reading to `event_type`
 * precision instead of putting a state Julius cannot hold into the world.
 */
export const JULIUS_TRANSITION_FACT_KEYS = ['to', 'toState'] as const;

/** The destination state a transition event carries, or `null`. */
export function juliusTransitionState(
  event: JuliusOperationalEvent,
): JuliusMissionState | null {
  for (const key of JULIUS_TRANSITION_FACT_KEYS) {
    const value = event.facts[key];
    if (isJuliusMissionState(value)) return value;
  }
  return null;
}

/**
 * The facts a world event carries. A short allowlist, not the whole record.
 *
 * The kernel's validator already rejects credential-shaped facts and caps the
 * payload, and that is the wrong place to rely on for a browser-facing wire:
 * it protects the LEDGER. This allowlist protects the WORLD, and the two are
 * different trust boundaries — the ledger is operator-visible and the world is
 * whatever the SSE route's visibility rules let a player see.
 *
 * THREE OF THEM ARE CODES (row 12, internal review M3): `reasonCode`, `severity`
 * and `outcome` reach a world only in the code shape, and any value holding a
 * host path is dropped whatever its key -- both enforced where the envelope's
 * metadata is sanitised (`WONDERLAND_CODE_METADATA_KEYS`, wonderland-envelope.ts),
 * so every drop is counted in `metadataDropped`.
 */
export const WONDERLAND_CARRIED_FACT_KEYS = [
  'reasonCode',
  'severity',
  'outcome',
  'role',
  'attempt',
] as const;

/** How a normalized Julius event is replicated. Owner-only, always. */
export const JULIUS_EVENT_VISIBILITY: WonderlandVisibility = 'OWNER';

export interface JuliusNormalizationIdentity {
  /**
   * The mission this run belongs to. Null when the caller cannot say — the
   * kernel's `runId` is a stream key and is NOT a mission id.
   */
  readonly missionId?: string | null;
  /** The agent a person owns. Never derived from `workerId`. */
  readonly agentId?: string | null;
  readonly playerId?: string | null;
  readonly sessionId?: string | null;
  readonly battleId?: string | null;
}

export interface JuliusNormalizationInput {
  readonly event: JuliusOperationalEvent;
  /** Allocated by the ledger. Must be a positive safe integer. */
  readonly sequence: number;
  /** The world event's own id. Injected so this stays pure. */
  readonly eventId: string;
  readonly identity?: JuliusNormalizationIdentity;
}

/**
 * One kernel event as one world event, or `null` when the world has nothing
 * truthful to say about it.
 *
 * `null` is a real answer here and callers must count it rather than treat it
 * as a failure: twenty-three of thirty-four kernel types are legitimately
 * silent in the world, and a bridge that logged each one as a dropped event
 * would drown the signal it exists to carry.
 */
export function normalizeJuliusOperationalEvent(
  input: JuliusNormalizationInput,
): WonderlandEvent | null {
  const { event, sequence, eventId } = input;
  const eventType = JULIUS_TO_WONDERLAND_EVENT_TYPE[event.type];
  if (eventType === undefined) return null;
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  if (eventId.trim() === '' || event.projectId.trim() === '') return null;

  const identity = input.identity ?? {};
  const carried: Record<string, unknown> = { juliusEventType: event.type, runId: event.runId };
  for (const key of WONDERLAND_CARRIED_FACT_KEYS) {
    const value = event.facts[key];
    if (value !== undefined) carried[key] = value;
  }
  const runState = juliusTransitionState(event);
  if (runState !== null) carried[JULIUS_RUN_STATE_PAYLOAD_KEY] = runState;

  return Object.freeze({
    eventId,
    schemaVersion: WONDERLAND_EVENT_SCHEMA_VERSION,
    timestamp: event.occurredAt,
    projectId: event.projectId,
    sessionId: identity.sessionId ?? null,
    playerId: identity.playerId ?? null,
    agentId: identity.agentId ?? null,
    missionId: identity.missionId ?? null,
    battleId: identity.battleId ?? null,
    eventType,
    payload: redact(carried) as Readonly<Record<string, unknown>>,
    visibility: JULIUS_EVENT_VISIBILITY,
    correlationId: event.correlationId,
    causationId: event.causationId,
    sequence,
  });
}

export interface JuliusNormalizationResult {
  readonly events: readonly WonderlandEvent[];
  /** Kernel events the world has no truthful type for. Counted, never faked. */
  readonly silentEvents: number;
}

/**
 * Normalize a run of kernel events, allocating world sequences from a base.
 *
 * The base is the caller's last known world sequence and the allocation is
 * dense over the events that PRODUCE a world event — a silent kernel event
 * consumes no world sequence, because a consumer reconnecting at cursor N must
 * receive every sequence above N and a number nothing was written under would
 * read as a permanent gap.
 */
export function normalizeJuliusOperationalEvents(
  events: readonly JuliusOperationalEvent[],
  input: {
    readonly baseSequence: number;
    readonly nextEventId: (event: JuliusOperationalEvent, index: number) => string;
    readonly identity?: JuliusNormalizationIdentity;
  },
): JuliusNormalizationResult {
  const normalized: WonderlandEvent[] = [];
  let silent = 0;
  let sequence = input.baseSequence;
  events.forEach((event, index) => {
    const candidate = normalizeJuliusOperationalEvent({
      event,
      sequence: sequence + 1,
      eventId: input.nextEventId(event, index),
      identity: input.identity,
    });
    if (candidate === null) {
      silent += 1;
      return;
    }
    sequence += 1;
    normalized.push(candidate);
  });
  return { events: Object.freeze(normalized), silentEvents: silent };
}
