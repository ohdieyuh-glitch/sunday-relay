import type { Pool } from 'pg';

import { noWonderlandBrainCitation } from '../mission/wonderland/wonderland-brain-scope';
import {
  scopeWonderlandCard,
  wonderlandHydration,
} from '../mission/wonderland/wonderland-hydration';
import type { WonderlandHydration } from '../mission/wonderland/wonderland-hydration';
import {
  emptyJuliusActivity,
  wonderlandJuliusActivity,
} from '../mission/wonderland/wonderland-julius-activity';
import { readWonderlandLedgerRow } from '../mission/wonderland/wonderland-ledger-adapter';
import type { WonderlandLedgerRow } from '../mission/wonderland/wonderland-ledger-adapter';
import { wonderlandRunSnapshot } from '../mission/wonderland/wonderland-rehydration';
import {
  emptyWonderlandUsageAuthority,
  projectWonderlandUsageFromAuthority,
} from '../mission/wonderland/wonderland-usage-authority';
import { isJuliusMissionState } from '../mission/wonderland/wonderland-julius-state';

/**
 * WHAT A WORLD READS OUT OF JULIUS.
 *
 * The Bridge's `/wonderland/julius/*` routes have been written, authorised and
 * tested for three sessions against a fake. This is the real one: two reads,
 * both scoped by project as well as by run, neither of which writes anything.
 *
 * THE PORT IS NOT IMPORTED, DELIBERATELY. `WonderlandJuliusReader` is declared
 * in `relay-bridge/wonderland-julius-routes.ts`, and persistence importing the
 * Bridge would put a transport's shape underneath a database adapter. This
 * class satisfies the port structurally and the composition root — `server.ts`
 * — is where the two meet. That is the same inversion the connectors use.
 *
 * ONE STATEMENT PER ANSWER, WHICH IS THE WHOLE DESIGN.
 *
 * A hydration carries a run's STATE, its REVISION and the ledger POSITION that
 * state includes. Read in three statements those describe a run that never
 * existed: the version from one moment, the sequence from another, the task
 * counts from a third. So each method issues exactly one query and lets
 * Postgres take one consistent view, with the sub-selects hanging off the run
 * row rather than being fetched beside it.
 *
 * The activity fold is the one thing that cannot be folded in SQL, and it is
 * bounded by the position the same statement returned — `sequence <=
 * atSequence` — so the fold covers exactly the events the snapshot claims to
 * include. Without that bound a second query could see events written since,
 * the client would be told about them here AND receive them again in the tail,
 * and the subagent counters (which move up and down, unlike the signals) would
 * double-count.
 *
 * WHAT IT DOES NOT CLAIM. Three parts of a hydration have no authority behind
 * them today, and this reader reports them as unknown rather than filling them
 * in:
 *
 *   USAGE   no authority attributes spend into the usage contract yet, so the
 *           meters project from an empty authority and draw UNKNOWN. That is
 *           the true reading, not a placeholder.
 *
 *   BRAIN   `relay_wonderland.julius_context_snapshots` holds almost exactly
 *           what a citation wants — revision, character count, redaction count,
 *           truncation, content hash — but its entry kinds come from
 *           `julius_brain_entries.entry_kind`, whose vocabulary is NOT the
 *           citation's: `RESEARCH_NOTE` and `ACCEPTANCE_UPDATE` have no
 *           counterpart, and `OBJECTIVE`, `REQUIREMENT` and `EVIDENCE` have no
 *           source. Citing with the overlap alone would report a smaller
 *           retrieval than happened, as a fact. Reconciling the two
 *           vocabularies is a contract decision and is recorded in the handoff
 *           rather than guessed at here.
 *
 *   C.A.R.D. SLOTS  `julius_runs.card_revision` is free text with no foreign
 *           key, and nothing in this layer reads `relay_wonderland.card_versions`.
 *           So the revision is carried — it is a real opaque handle — and the
 *           three slots are NULL, which the contract now expresses. Reporting
 *           them `false` would draw three unfilled roles as an observation.
 */
export class WonderlandJuliusReaderPostgres {
  constructor(private readonly pool: Pool) {}

  /**
   * The run as it stands, and the position that state includes.
   *
   * Null when this project has no such run — which is also the answer for a run
   * that belongs to somebody else, because `project_id` is in the WHERE clause
   * rather than checked afterwards. The route turns null into a 404 with the
   * same body it uses for a refusal, so the two are indistinguishable from
   * outside.
   */
  async hydrate(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly worldSessionId: string | null;
  }): Promise<WonderlandHydration | null> {
    const run = await this.pool.query<{
      state: string;
      version: string;
      mission_id: string;
      card_revision: string;
      at_sequence: string | null;
      active_tasks: string;
      pending_approvals: string;
      observed_at: string;
    }>(
      `SELECT r.state, r.version, r.mission_id, r.card_revision,
              (SELECT MAX(e.sequence) FROM relay_wonderland.events e
                WHERE e.stream_id=r.run_id AND e.project_id=r.project_id
                  AND e.event_type LIKE 'julius.%') AS at_sequence,
              (SELECT count(*) FROM relay_wonderland.julius_tasks t
                WHERE t.run_id=r.run_id AND t.state='ACTIVE') AS active_tasks,
              (SELECT count(*) FROM relay_wonderland.julius_approvals a
                WHERE a.run_id=r.run_id AND a.state='PENDING') AS pending_approvals,
              now() AS observed_at
         FROM relay_wonderland.julius_runs r
        WHERE r.run_id=$1 AND r.project_id=$2`,
      [input.runId, input.projectId],
    );
    const row = run.rows[0];
    if (row === undefined) return null;

    // A state the kernel cannot hold is a row this reader will not interpret.
    // Coercing it would put an unknown word through the visual mapping, which
    // is total over the kernel's vocabulary and nothing else.
    if (!isJuliusMissionState(row.state)) return null;

    const atSequence = row.at_sequence === null ? null : Number(row.at_sequence);
    const observedAtIso = new Date(String(row.observed_at)).toISOString();

    const snapshot = wonderlandRunSnapshot({
      projectId: input.projectId,
      runId: input.runId,
      missionId: row.mission_id,
      state: row.state,
      revision: Number(row.version),
      // Read in the SAME statement as the version. See the header.
      atSequence,
      observedAtIso,
      activeTasks: Number(row.active_tasks),
      pendingApprovals: Number(row.pending_approvals),
    });

    const usage = projectWonderlandUsageFromAuthority(
      emptyWonderlandUsageAuthority({ projectId: input.projectId }),
      observedAtIso,
    );

    return wonderlandHydration({
      run: snapshot,
      usage: usage.hud,
      usageStatus: usage.status,
      activity: await this.foldActivity(input.projectId, input.runId, atSequence),
      brain: noWonderlandBrainCitation({ projectId: input.projectId, runId: input.runId }),
      // The revision is a real opaque handle; the slots are null because
      // nothing here can resolve the record behind it. See the header.
      card: scopeWonderlandCard({ cardRevision: row.card_revision }),
      observedAtIso,
      worldSessionId: input.worldSessionId,
    });
  }

  /**
   * The events after a cursor, plus the run's current revision.
   *
   * BOTH FROM ONE STATEMENT, and the run drives it rather than the events: a
   * LEFT JOIN LATERAL means the revision comes back even when the page is
   * empty, where a query anchored on the events table would return no rows and
   * leave the caller inventing one.
   *
   * The rows are RAW. Decoding belongs to `readWonderlandLedgerRow`, which the
   * ingress pipeline already runs and which refuses a type the operational
   * catalogue does not model — a second decoder here would be a second place
   * for that vocabulary to drift.
   */
  async events(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly afterSequence: number;
    readonly limit: number;
  }): Promise<{ readonly rows: readonly WonderlandLedgerRow[]; readonly revision: number }> {
    const result = await this.pool.query<{
      revision: string;
      event_id: string | null;
      stream_id: string | null;
      project_id: string | null;
      sequence: string | null;
      event_type: string | null;
      payload: unknown;
      occurred_at: string | null;
    }>(
      `SELECT r.version AS revision,
              e.event_id, e.stream_id, e.project_id, e.sequence,
              e.event_type, e.payload, e.occurred_at
         FROM relay_wonderland.julius_runs r
         LEFT JOIN LATERAL (
              SELECT event_id, stream_id, project_id, sequence, event_type, payload, occurred_at
                FROM relay_wonderland.events
               WHERE stream_id=r.run_id AND project_id=r.project_id
                 AND sequence>$3 AND event_type LIKE 'julius.%'
               ORDER BY sequence
               LIMIT $4
         ) e ON true
        WHERE r.run_id=$1 AND r.project_id=$2
        ORDER BY e.sequence`,
      [input.runId, input.projectId, input.afterSequence, input.limit],
    );

    const first = result.rows[0];
    // No run row at all. The route has already established the run belongs to
    // this project, so this is a run deleted between two requests: an empty
    // page is the correct answer, and the revision it is paired with reaches
    // nothing because there are no rows for it to be attached to.
    if (first === undefined) return { rows: [], revision: 0 };

    return {
      revision: Number(first.revision),
      rows: result.rows.filter(hasEvent).map((row) => ({
        eventId: row.event_id,
        streamId: row.stream_id,
        projectId: row.project_id,
        sequence: Number(row.sequence),
        eventType: row.event_type,
        occurredAt: new Date(String(row.occurred_at)).toISOString(),
        payload: parsePayload(row.payload),
      })),
    };
  }

  /**
   * What the run is DOING as of the snapshot's position.
   *
   * Bounded by `atSequence` rather than open-ended, so the fold and the state
   * describe the same instant. Unbounded, a client would be handed signals for
   * events it is about to receive again in the tail, and the subagent counters
   * would be applied twice.
   *
   * THE WHOLE RUN, not a recent window. Signals are raised and CLEARED —
   * `context.compiled` raises `retrieving_context` and `worker.dispatched`
   * clears it — so a partial fold can report a signal that stopped being true
   * an hour ago. Folding server-side is exactly how the client is spared the
   * transcript; it is not a contradiction of the reconnect rule, which is about
   * what crosses the wire.
   */
  private async foldActivity(projectId: string, runId: string, atSequence: number | null) {
    const empty = emptyJuliusActivity({ projectId, runId });
    if (atSequence === null) return empty;

    const result = await this.pool.query<{
      event_id: string;
      stream_id: string;
      project_id: string;
      sequence: string;
      event_type: string;
      payload: unknown;
      occurred_at: string;
    }>(
      `SELECT event_id, stream_id, project_id, sequence, event_type, payload, occurred_at
         FROM relay_wonderland.events
        WHERE stream_id=$1 AND project_id=$2 AND sequence<=$3
          AND event_type LIKE 'julius.%'
        ORDER BY sequence`,
      [runId, projectId, atSequence],
    );

    let reading = empty;
    for (const row of result.rows) {
      const decoded = readWonderlandLedgerRow({
        eventId: row.event_id,
        streamId: row.stream_id,
        projectId: row.project_id,
        sequence: Number(row.sequence),
        eventType: row.event_type,
        occurredAt: new Date(String(row.occurred_at)).toISOString(),
        payload: parsePayload(row.payload),
      });
      // A row the catalogue does not model contributes nothing and stops
      // nothing. The reading's own counters record that it was passed over.
      if (!decoded.ok) continue;
      reading = wonderlandJuliusActivity(reading, [decoded.event]);
    }
    return reading;
  }
}

/** The event columns of a LATERAL join row, all null when the page was empty. */
interface JoinedEventRow {
  event_id: string | null;
  stream_id: string | null;
  project_id: string | null;
  sequence: string | null;
  event_type: string | null;
  payload: unknown;
  occurred_at: string | null;
}

type PresentEventRow = { [K in keyof JoinedEventRow]: NonNullable<JoinedEventRow[K]> };

/**
 * A LATERAL join row that actually carried an event.
 *
 * Every column is checked rather than just `event_id`, so the narrowed type is
 * earned rather than asserted: a schema change that made one of them nullable
 * would fail here instead of producing a row with a null where the ledger
 * adapter expects an identifier.
 */
const hasEvent = <T extends JoinedEventRow>(row: T): row is T & PresentEventRow =>
  row.event_id !== null && row.stream_id !== null && row.project_id !== null &&
  row.sequence !== null && row.event_type !== null && row.occurred_at !== null;

/**
 * `jsonb` arrives parsed from `pg` and as text from some drivers and backups.
 *
 * A payload that will not parse becomes an empty object rather than throwing:
 * one unreadable row must not take down a page, and the ledger adapter refuses
 * an empty payload by name anyway.
 */
function parsePayload(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}
