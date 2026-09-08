/**
 * THE TRANSPORT BOUNDARY, AS A FUNCTION.
 *
 * Between a `relay_wonderland.events` row and a world's runtime state there are
 * five decisions, and each one refuses a different thing:
 *
 *   DECODE     is this row readable as a Julius event at all?
 *   SCOPE      is this session ALLOWED to see this project's run?
 *   VALIDATE   does it produce something a world can draw?
 *   ORDER      is it newer than what this client already holds?
 *   FOLD       what does the client hold once it is applied?
 *
 * They are here as one pure function rather than spread through a route
 * handler because a route cannot be tested against a reconnect, a mis-routed
 * fan-out or a replayed tail without a server, a socket and a database — and
 * those are exactly the cases that matter. The route above this is a thin
 * adapter: it reads rows, calls this, and writes the result to a stream.
 *
 * SCOPE IS SEPARATE FROM ORDERING, AND THAT IS THE POINT. Ordering already
 * refuses another project's envelope, but it refuses it as a CURSOR mismatch —
 * an answer about what this world is following. Scope is an answer about what
 * this session is permitted to see, and it is checked FIRST, because a session
 * reading a project it was never granted is a security failure and a session
 * receiving a stale event is a routing one. Collapsing them would report the
 * first as the second.
 *
 * FOREIGN EVENTS NEVER MUTATE THE CLIENT. Every refusal returns the cursor it
 * was given, unchanged except for the counter that names the refusal. There is
 * no path through this function on which a refused row moves a position, a
 * state or a signal.
 */

import { produceWonderlandEnvelope } from './wonderland-envelope-producer';
import type { WonderlandProducerIdentity } from './wonderland-envelope-producer';
import { readWonderlandLedgerRow } from './wonderland-ledger-adapter';
import type { WonderlandLedgerRow } from './wonderland-ledger-adapter';
import { applyWonderlandOrdering } from './wonderland-ordering';
import type { WonderlandCursor, WonderlandOrderingVerdict } from './wonderland-ordering';
import { wonderlandJuliusActivity } from './wonderland-julius-activity';
import type { JuliusActivityReading } from './wonderland-julius-activity';
import type { WonderlandEnvelope } from './wonderland-envelope';

export const WONDERLAND_INGRESS_SCHEMA_V1 = 'relay-wonderland-ingress.v1' as const;

/**
 * What a session is permitted to see.
 *
 * A GRANT NAMES ONE PROJECT, and optionally one run. It comes from the browser
 * session the Bridge already verifies — origin-bound, expiring, revocable — and
 * this module never widens it. `runId: null` means the whole project's stream,
 * which is what a world watching a project rather than a mission wants.
 */
export interface WonderlandIngressGrant {
  readonly projectId: string;
  readonly runId: string | null;
}

/** Why a row produced no delivery. Each names a different situation. */
export const WONDERLAND_INGRESS_REFUSALS = [
  /** The session was never granted this project. A SECURITY refusal. */
  'unauthorized_project',
  /** Granted the project, not this run. Also a security refusal. */
  'unauthorized_run',
  /** Not a Julius row, or its payload cannot be read. */
  'unreadable',
  /** Readable, and the world has nothing truthful to draw about it. */
  'silent',
  /** Reaches the world, and says nothing about which PHASE the run is in. */
  'no_state',
  /** Older than, or the same as, what this client already holds. */
  'out_of_order',
] as const;
export type WonderlandIngressRefusal = (typeof WONDERLAND_INGRESS_REFUSALS)[number];

/** One thing to hand a world: the envelope, and the activity as of it. */
export interface WonderlandDelivery {
  readonly envelope: WonderlandEnvelope;
  /**
   * The activity fold AFTER this envelope, not a delta.
   *
   * Shipped whole because the Unreal subsystem replaces its held reading
   * wholesale, and because a delta would need the receiver to have applied
   * every previous one — which a client that just reconnected has not.
   */
  readonly activity: JuliusActivityReading;
}

export interface WonderlandIngressResult {
  readonly deliveries: readonly WonderlandDelivery[];
  /** Where the client is after this batch. Advanced only by applied rows. */
  readonly cursor: WonderlandCursor;
  /** The activity fold after this batch. */
  readonly activity: JuliusActivityReading;
  /** Counted per refusal, because six situations are not one. */
  readonly refusals: Readonly<Record<WonderlandIngressRefusal, number>>;
  /** The ordering verdicts seen, so an operator can tell which axis refused. */
  readonly orderingVerdicts: Readonly<Partial<Record<WonderlandOrderingVerdict, number>>>;
}

const emptyRefusals = (): Record<WonderlandIngressRefusal, number> => ({
  unauthorized_project: 0,
  unauthorized_run: 0,
  unreadable: 0,
  silent: 0,
  no_state: 0,
  out_of_order: 0,
});

/**
 * Whether a grant covers a row, before anything else is read.
 *
 * ROW IDENTITY, NOT PAYLOAD IDENTITY. The row's own `project_id` column is what
 * the database indexed and what a query filtered on; the payload is content. A
 * scope check that trusted the payload could be told anything by whoever wrote
 * the payload, which on this seam is a different subsystem.
 */
export function wonderlandIngressScope(
  grant: WonderlandIngressGrant,
  row: WonderlandLedgerRow,
): 'granted' | 'unauthorized_project' | 'unauthorized_run' {
  if (grant.projectId.trim() === '' || row.projectId !== grant.projectId) {
    return 'unauthorized_project';
  }
  // `stream_id` is the run id on every Julius write path.
  if (grant.runId !== null && row.streamId !== grant.runId) return 'unauthorized_run';
  return 'granted';
}

/**
 * Run one batch of ledger rows through the boundary.
 *
 * THE REVISION IS THE CALLER'S, read alongside the rows. Only a state
 * transition bumps `julius_runs.version`, so a batch legitimately shares one —
 * revision orders STATES and sequence orders EVENTS, and a caller that tried to
 * order events by revision would find most of them tied.
 */
export function ingestWonderlandRows(input: {
  readonly grant: WonderlandIngressGrant;
  readonly rows: readonly WonderlandLedgerRow[];
  readonly revision: number;
  readonly cursor: WonderlandCursor;
  readonly activity: JuliusActivityReading;
  readonly identity?: WonderlandProducerIdentity;
}): WonderlandIngressResult {
  const deliveries: WonderlandDelivery[] = [];
  const refusals = emptyRefusals();
  const orderingVerdicts: Partial<Record<WonderlandOrderingVerdict, number>> = {};
  let cursor = input.cursor;
  let activity = input.activity;

  for (const row of input.rows) {
    // SCOPE FIRST. A session reading a project it was never granted is a
    // security failure; a session receiving a stale event is a routing one.
    const scoped = wonderlandIngressScope(input.grant, row);
    if (scoped !== 'granted') {
      refusals[scoped] += 1;
      continue;
    }

    const decoded = readWonderlandLedgerRow(row);
    if (!decoded.ok) {
      refusals.unreadable += 1;
      continue;
    }

    // THE ACTIVITY FOLD SEES EVERY DECODED EVENT, including the ones that
    // produce no envelope. `finding.recorded` and both subagent events say
    // nothing about the PHASE and everything about what is going on, and a
    // pipeline that only folded what it could draw would drop exactly the
    // signals the second axis exists to carry.
    activity = wonderlandJuliusActivity(activity, [decoded.event]);

    const produced = produceWonderlandEnvelope({
      event: decoded.event,
      sequence: row.sequence,
      revision: input.revision,
      identity: input.identity,
    });
    if (!produced.ok) {
      if (produced.refusal === 'silent') refusals.silent += 1;
      else if (produced.refusal === 'no_state') refusals.no_state += 1;
      else refusals.unreadable += 1;
      continue;
    }

    const outcome = applyWonderlandOrdering(cursor, produced.envelope);
    cursor = outcome.cursor;
    orderingVerdicts[outcome.verdict] = (orderingVerdicts[outcome.verdict] ?? 0) + 1;
    if (outcome.verdict !== 'applied') {
      refusals.out_of_order += 1;
      continue;
    }

    deliveries.push(Object.freeze({ envelope: produced.envelope, activity }));
  }

  return Object.freeze({
    deliveries: Object.freeze(deliveries),
    cursor,
    activity,
    refusals: Object.freeze(refusals),
    orderingVerdicts: Object.freeze(orderingVerdicts),
  });
}

/**
 * A one-line summary an operator can read, with nothing in it a payload wrote.
 *
 * Every value is a count or a name from a closed vocabulary. There is no path
 * by which a project's own text reaches a log line through this.
 */
export function summarizeWonderlandIngress(result: WonderlandIngressResult): string {
  const parts = [`applied=${result.deliveries.length}`];
  for (const refusal of WONDERLAND_INGRESS_REFUSALS) {
    const count = result.refusals[refusal];
    if (count > 0) parts.push(`${refusal}=${count}`);
  }
  if (result.cursor.gaps > 0) parts.push(`gaps=${result.cursor.gaps}`);
  return parts.join(' ');
}
