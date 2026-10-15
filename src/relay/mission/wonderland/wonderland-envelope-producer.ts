/**
 * THE STEP THAT WAS MISSING: A REAL JULIUS EVENT BECOMES AN ENVELOPE.
 *
 * Everything on both sides of this file already existed. `readWonderlandLedgerRow`
 * turns a `relay_wonderland.events` row into a `JuliusOperationalEvent`;
 * `normalizeJuliusOperationalEvent` turns that into a `WonderlandEvent`;
 * `readJuliusState` reads a visual state out of it; the envelope is the shape a
 * world receives; ordering, rehydration and the Unreal subsystems all consume
 * envelopes. And `wonderlandEnvelope()` had NO PRODUCTION CALLER — the chain
 * was built from both ends and never joined, so every layer downstream was
 * waiting for events that nothing produced.
 *
 * This is the join, and it is deliberately thin: it composes the three existing
 * functions and decides nothing they already decide. A producer that re-derived
 * a visual state would be a second answer to the question the state module
 * exists to answer.
 *
 * WHY IT CAN REFUSE, and why the refusals are named rather than logged. Most
 * kernel events say nothing a world can draw — twenty-three of thirty-four
 * types normalize to `null` on purpose — so "produced nothing" is the common
 * case and must not read as a failure. An operator asking "why is the world
 * quiet" needs to know whether events are arriving and saying nothing, or not
 * arriving at all, and one counter cannot answer both.
 *
 * WHERE THE REVISION COMES FROM, and it is the subtle part. `julius_runs.version`
 * is the run's optimistic-concurrency version and the authority on which STATE
 * is newer. It is NOT on the event: `run.transitioned` persists a
 * `transitionMission` result carrying `from`, `to` and `reasonCode`, and
 * `run.created` persists the runtime version — neither carries the row version.
 * So the caller supplies it, having read the run row, and the caller is the
 * ingress that reads both in one pass.
 *
 * That has a consequence worth stating where somebody will find it: ONLY A
 * TRANSITION BUMPS THE VERSION. A burst of `worker.dispatched`,
 * `evidence.recorded` and `approval.requested` events all carry the same
 * revision, because the run's state did not move. Revision therefore orders
 * STATES and sequence orders EVENTS, exactly as `wonderland-ordering.ts` says —
 * and a consumer that tried to order events by revision would find most of them
 * tied.
 */

import { readWonderlandLedgerRow } from './wonderland-ledger-adapter';
import type { WonderlandLedgerRow } from './wonderland-ledger-adapter';
import { normalizeJuliusOperationalEvent } from './wonderland-julius-normalizer';
import type { JuliusNormalizationIdentity } from './wonderland-julius-normalizer';
import { readJuliusState } from './wonderland-julius-state';
import { wonderlandEnvelope } from './wonderland-envelope';
import type { WonderlandEnvelope } from './wonderland-envelope';
import type { JuliusOperationalEvent } from '../julius/julius-events';

/**
 * Why one event produced no envelope. Every reason is nameable, and the first
 * two are NOT errors.
 */
export const WONDERLAND_PRODUCER_REFUSALS = [
  /**
   * The world has no truthful event type for this kernel event. The common
   * case, and the healthy one: a budget reservation is real and there is
   * nothing honest for a world to draw about it.
   */
  'silent',
  /**
   * Normalized, and no link — run state, phase or type — said anything about
   * what Julius is DOING. Distinct from `silent`: the world knows the event
   * happened and still cannot place it on the state machine.
   */
  'no_state',
  /** The row is not a Julius row, or its payload is unreadable. */
  'unreadable',
  /** The caller supplied a sequence or revision that is not a position. */
  'bad_position',
] as const;
export type WonderlandProducerRefusal = (typeof WONDERLAND_PRODUCER_REFUSALS)[number];

export type WonderlandProduction =
  | { readonly ok: true; readonly envelope: WonderlandEnvelope }
  | { readonly ok: false; readonly refusal: WonderlandProducerRefusal };

export interface WonderlandProducerIdentity extends JuliusNormalizationIdentity {
  /**
   * The world session this envelope is being produced for.
   *
   * Carried so a world can tell its own stream from another tab's replay of the
   * same run. Null when the producer is not serving a particular session.
   */
  readonly worldSessionId?: string | null;
  /** The Julius deployment. Refused by the cursor when it conflicts. */
  readonly juliusInstanceId?: string | null;
}

export interface WonderlandProducerInput {
  readonly event: JuliusOperationalEvent;
  /** The ledger's own sequence for this event, within its run. */
  readonly sequence: number;
  /** `julius_runs.version` as the caller read it. See the header. */
  readonly revision: number;
  readonly identity?: WonderlandProducerIdentity;
}

const isPosition = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

/**
 * Produce one envelope, or say why not.
 *
 * THE EVENT ID IS THE KERNEL'S, NOT A NEW ONE. Ordering refuses a repeat by
 * event id, so minting a fresh id per delivery would make every retransmission
 * look like a new event and defeat the duplicate check on the one path — a
 * reconnect replaying a tail — where it matters most.
 */
export function produceWonderlandEnvelope(
  input: WonderlandProducerInput,
): WonderlandProduction {
  if (!isPosition(input.sequence) || !isPosition(input.revision)) {
    return { ok: false, refusal: 'bad_position' };
  }

  // The normalizer wants a sequence of at least 1 and would refuse 0. A run's
  // first ledger sequence is 1, so this only bites on a caller error, and
  // `bad_position` above has already taken the negative case.
  const worldEvent = normalizeJuliusOperationalEvent({
    event: input.event,
    sequence: Math.max(input.sequence, 1),
    eventId: input.event.eventId,
    identity: input.identity,
  });
  if (worldEvent === null) return { ok: false, refusal: 'silent' };

  const reading = readJuliusState(worldEvent);
  if (reading === null) return { ok: false, refusal: 'no_state' };

  const identity = input.identity ?? {};
  return {
    ok: true,
    envelope: wonderlandEnvelope({
      eventId: input.event.eventId,
      projectId: input.event.projectId,
      worldSessionId: identity.worldSessionId ?? null,
      juliusInstanceId: identity.juliusInstanceId ?? null,
      missionId: identity.missionId ?? null,
      runId: input.event.runId,
      taskId: input.event.taskId,
      // The role a fact CARRIED, never one inferred from a worker id. A worker
      // id names which process ran; the role names which function acted, and
      // guessing the second from the first would put work on the wrong
      // instrument the moment Julius reuses a worker across roles.
      workerRole: typeof input.event.facts.role === 'string' ? input.event.facts.role : null,
      state: reading.visualState,
      stateSource: reading.source,
      sourceState: reading.sourceState,
      // TERMINAL IS THE READING'S, NOT THE PRODUCER'S. A disconnection is never
      // a completion, and neither is a producer's opinion: only a state the
      // kernel's own vocabulary calls an ending sets this.
      terminal: WONDERLAND_TERMINAL_VISUAL_STATES.has(reading.visualState),
      sequence: input.sequence,
      revision: input.revision,
      occurredAt: input.event.occurredAt,
      metadata: worldEvent.payload,
    }),
  };
}

/**
 * The visual states that report a run ENDING.
 *
 * `blocked` is here and it is worth saying why, because it is the one that
 * looks wrong: a run stopped at a ceiling or a gate has ended its own
 * progression, and a world that kept animating work would be claiming activity
 * nobody reported. What `terminal` never means is SUCCESS — `complete` is the
 * only member of the vocabulary that claims that, and BLOCKED and ERROR are
 * held apart from it everywhere they are read.
 */
export const WONDERLAND_TERMINAL_VISUAL_STATES: ReadonlySet<string> = new Set([
  'complete',
  'blocked',
  'error',
]);

export interface WonderlandProductionBatch {
  readonly envelopes: readonly WonderlandEnvelope[];
  /** Counted separately, because they are four different situations. */
  readonly silent: number;
  readonly withoutState: number;
  readonly unreadable: number;
  readonly badPosition: number;
}

/**
 * Produce envelopes for a page of ledger rows.
 *
 * SEQUENCES ARE THE LEDGER'S, NOT ALLOCATED HERE. `normalizeJuliusOperationalEvents`
 * allocates dense world sequences from a base, which is right when the world
 * stream is its own stream; this is serving the LEDGER's stream, where a
 * consumer resumes with the ledger's own cursor. Re-numbering would make the
 * cursor a client sent back mean something different from the cursor it was
 * given.
 */
export function produceWonderlandEnvelopes(input: {
  readonly rows: readonly WonderlandLedgerRow[];
  readonly revision: number;
  readonly identity?: WonderlandProducerIdentity;
}): WonderlandProductionBatch {
  const envelopes: WonderlandEnvelope[] = [];
  let silent = 0;
  let withoutState = 0;
  let unreadable = 0;
  let badPosition = 0;

  for (const row of input.rows) {
    const reading = readWonderlandLedgerRow(row);
    if (!reading.ok) {
      unreadable += 1;
      continue;
    }
    const produced = produceWonderlandEnvelope({
      event: reading.event,
      sequence: row.sequence,
      revision: input.revision,
      identity: input.identity,
    });
    if (produced.ok) {
      envelopes.push(produced.envelope);
      continue;
    }
    if (produced.refusal === 'silent') silent += 1;
    else if (produced.refusal === 'no_state') withoutState += 1;
    else if (produced.refusal === 'bad_position') badPosition += 1;
    else unreadable += 1;
  }

  return Object.freeze({
    envelopes: Object.freeze(envelopes),
    silent,
    withoutState,
    unreadable,
    badPosition,
  });
}
