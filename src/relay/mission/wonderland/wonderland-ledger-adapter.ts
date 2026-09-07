/**
 * READING THE LEDGER AS IT IS ACTUALLY WRITTEN.
 *
 * `relay_wonderland.events` holds rows from more than one writer, in more than
 * one payload shape, and a consumer that assumed one of them gets a silently
 * degraded world rather than an error. This adapter is the boundary described
 * in `integration/terminal/julius-event-port.ts` — "an adapter maps it into
 * JuliusOperationalEvent and nothing in the projection changes" — and it is the
 * only place that knows the writers' field names.
 *
 * THE TWO SHAPES, both verified against the persistence code.
 *
 *  FLAT, from `JuliusEventPostgresRepository.append`. The payload is the
 *  operational event itself: `{schemaVersion, runId, projectId, type, taskId,
 *  workerId, correlationId, causationId, occurredAt, facts}`. `facts` is
 *  present and scalar-only. This is the shape the normalizer already handles.
 *
 *  NESTED, from `JuliusPostgresRepository.event`. The payload is
 *  `{schemaVersion, eventId, projectId, streamId, type, occurredAt, payload}`
 *  where the inner `payload` is a whole `JuliusTransition` — and there is NO
 *  `facts` key anywhere. `run.created` and `run.transitioned` are written ONLY
 *  this way.
 *
 * WHY THAT MATTERS MORE THAN IT LOOKS. `juliusTransitionState` reads
 * `facts.to`, so against the nested shape it finds nothing and the reading
 * degrades from `julius_run_state` precision to `event_type` precision — for
 * exactly the two event types that carry the run's actual state machine. The
 * development fixture carries `facts.to` and therefore passes, so the seam
 * looks correct in the suite and loses precision in production. That is the
 * worst shape a defect can have, and it is why this adapter is tested against
 * both persisted shapes rather than against the fixture.
 *
 * IT ALSO FILTERS. Julius rows carry `event_type` prefixed `julius.`; the
 * Wonderland replay query does not filter on it, so a project-wide read returns
 * both worlds' rows interleaved. A consumer cannot fix that SQL from here, but
 * it can refuse what does not belong to it, and refusing is this function's
 * default rather than an option.
 */

import { exactKeys } from './wonderland-contracts';
import {
  JULIUS_OPERATIONAL_EVENT_TYPES,
  type JuliusOperationalEvent,
  type JuliusOperationalEventType,
} from '../julius/julius-events';
import { isJuliusMissionState } from './wonderland-julius-state';

/** The prefix every Julius row's `event_type` column carries. */
export const JULIUS_LEDGER_TYPE_PREFIX = 'julius.' as const;

const EVENT_TYPE_MEMBERS: ReadonlySet<string> = new Set<string>(JULIUS_OPERATIONAL_EVENT_TYPES);

/** One row of `relay_wonderland.events`, as a reader receives it. */
export interface WonderlandLedgerRow {
  readonly eventId: string;
  readonly streamId: string;
  readonly projectId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly payload: unknown;
}

export const WONDERLAND_LEDGER_ROW_FIELDS = exactKeys<WonderlandLedgerRow>()([
  'eventId',
  'streamId',
  'projectId',
  'sequence',
  'eventType',
  'occurredAt',
  'payload',
]);

/** Why a row produced nothing. Every refusal is nameable. */
export const WONDERLAND_LEDGER_REFUSALS = [
  /** `event_type` does not carry the Julius prefix. Another writer's row. */
  'not_julius',
  /** Prefixed, but names a type the operational catalogue does not have. */
  'unknown_type',
  /** No object payload at all, so there is nothing to read. */
  'unreadable_payload',
  /** Identity the reader needs is missing or blank. */
  'identity_missing',
] as const;
export type WonderlandLedgerRefusal = (typeof WONDERLAND_LEDGER_REFUSALS)[number];

export type WonderlandLedgerReading =
  | { readonly ok: true; readonly event: JuliusOperationalEvent; readonly shape: 'flat' | 'nested' }
  | { readonly ok: false; readonly refusal: WonderlandLedgerRefusal };

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const scalarFacts = (raw: unknown): Record<string, string | number | boolean | null> => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
    // Anything else is not a fact the operational event may carry, by its own
    // validator's rule. Dropping matches `validateJuliusEvent`'s refusal.
  }
  return out;
};

/**
 * Read one ledger row as an operational event, or say why not.
 *
 * THE NESTED SHAPE IS FLATTENED INTO `facts`, which is the whole point: a
 * transition's `from`, `to` and `reasonCode` become facts, so
 * `juliusTransitionState` finds `to` where it already looks and the reading
 * keeps `julius_run_state` precision instead of falling back to the event's
 * name. Nothing downstream changes, which is what an adapter is for.
 */
export function readWonderlandLedgerRow(row: WonderlandLedgerRow): WonderlandLedgerReading {
  if (!row.eventType.startsWith(JULIUS_LEDGER_TYPE_PREFIX)) {
    return { ok: false, refusal: 'not_julius' };
  }
  const type = row.eventType.slice(JULIUS_LEDGER_TYPE_PREFIX.length);
  if (!EVENT_TYPE_MEMBERS.has(type)) return { ok: false, refusal: 'unknown_type' };

  const payload = row.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, refusal: 'unreadable_payload' };
  }
  const body = payload as Record<string, unknown>;

  const projectId = text(body.projectId) ?? text(row.projectId);
  if (projectId === null) return { ok: false, refusal: 'identity_missing' };

  // FLAT: the operational event was written whole, `facts` and all.
  if ('facts' in body) {
    const runId = text(body.runId) ?? text(row.streamId);
    if (runId === null) return { ok: false, refusal: 'identity_missing' };
    return {
      ok: true,
      shape: 'flat',
      event: Object.freeze({
        eventId: text(body.eventId) ?? row.eventId,
        runId,
        projectId,
        type: type as JuliusOperationalEventType,
        taskId: text(body.taskId),
        workerId: text(body.workerId),
        correlationId: text(body.correlationId) ?? row.eventId,
        causationId: text(body.causationId),
        occurredAt: text(body.occurredAt) ?? row.occurredAt,
        facts: Object.freeze(scalarFacts(body.facts)),
      }),
    };
  }

  // NESTED: the inner `payload` is a transition or a run record, and the facts
  // this seam needs have to be lifted out of it.
  const inner = body.payload;
  const innerBody =
    typeof inner === 'object' && inner !== null && !Array.isArray(inner)
      ? (inner as Record<string, unknown>)
      : {};

  const runId = text(body.runId) ?? text(innerBody.runId) ?? text(row.streamId);
  if (runId === null) return { ok: false, refusal: 'identity_missing' };

  const facts: Record<string, string | number | boolean | null> = scalarFacts(innerBody);
  // `run.created` records the state it starts in as `state`; a transition
  // records `to`. Normalising the first onto the second means one downstream
  // reader instead of two, and `juliusTransitionState` already looks for `to`.
  if (facts.to === undefined && isJuliusMissionState(innerBody.state)) {
    facts.to = innerBody.state;
  }

  return {
    ok: true,
    shape: 'nested',
    event: Object.freeze({
      eventId: text(body.eventId) ?? row.eventId,
      runId,
      projectId,
      type: type as JuliusOperationalEventType,
      taskId: text(innerBody.taskId),
      workerId: text(innerBody.workerId),
      correlationId: text(body.eventId) ?? row.eventId,
      causationId: null,
      occurredAt: text(body.occurredAt) ?? row.occurredAt,
      facts: Object.freeze(facts),
    }),
  };
}

export interface WonderlandLedgerBatch {
  readonly events: readonly JuliusOperationalEvent[];
  /** Row sequences, aligned with `events`, so a cursor can be advanced. */
  readonly sequences: readonly number[];
  readonly refused: Readonly<Record<WonderlandLedgerRefusal, number>>;
  readonly flat: number;
  readonly nested: number;
}

/**
 * Read a page of rows, keeping only what belongs to this seam.
 *
 * Refusals are COUNTED BY KIND rather than summed. A page that is 90 per cent
 * `not_julius` is a project sharing a table and is entirely normal; a page with
 * one `unknown_type` is Julius having shipped an event this build does not
 * model, which is a real thing to go and look at.
 */
export function readWonderlandLedgerBatch(
  rows: readonly WonderlandLedgerRow[],
): WonderlandLedgerBatch {
  const events: JuliusOperationalEvent[] = [];
  const sequences: number[] = [];
  const refused: Record<WonderlandLedgerRefusal, number> = {
    not_julius: 0,
    unknown_type: 0,
    unreadable_payload: 0,
    identity_missing: 0,
  };
  let flat = 0;
  let nested = 0;

  for (const row of rows) {
    const reading = readWonderlandLedgerRow(row);
    if (!reading.ok) {
      refused[reading.refusal] += 1;
      continue;
    }
    events.push(reading.event);
    sequences.push(row.sequence);
    if (reading.shape === 'flat') flat += 1;
    else nested += 1;
  }

  return Object.freeze({
    events: Object.freeze(events),
    sequences: Object.freeze(sequences),
    refused: Object.freeze(refused),
    flat,
    nested,
  });
}
