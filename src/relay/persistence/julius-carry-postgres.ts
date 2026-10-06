import type { Pool } from 'pg';

import type { JuliusBrainEntry } from '../mission/julius';
import {
  juliusCarryManifestFacts,
  type JuliusCarryArchiveOrigin, type JuliusCarryArm, type JuliusCarryClaimCandidate, type JuliusCarrySelection,
  type JuliusCarrySourceRun,
} from '../mission/julius/julius-carry';
import type { JuliusPeerLedgerEntry } from '../mission/julius/julius-peer-channel';
import { brainKindFromStored } from './julius-brain-kinds';
import { JuliusClaimPostgresRepository } from './julius-claim-postgres';
import { JuliusEventPostgresRepository } from './julius-event-postgres';
import { JuliusReadPostgresRepository } from './julius-read-postgres';
import { JuliusTimelinePostgresRepository } from './julius-timeline-postgres';

/**
 * THE CORRECTED CARRY ON POSTGRESQL (`julius-carry.v2`).
 *
 * READS what earlier runs of the project hold: each run's reviewer findings with
 * the ledger rows that give them their lives, and every claim standing at
 * VERIFIED or APPROVED together with its brain row's own scope (`task_id`). The
 * domain (`selectJuliusCarry`) decides; this file only reads and writes.
 *
 * WRITES, once per run: the selected copies as brain entries, each with its
 * standing (reason `CARRIED_FROM:<run>:<source ref>`), and ONE
 * `knowledge.carried` event holding the manifest: counts, the selected ids and
 * every exclusion by code. That event is point 2 of the four-point proof and the
 * entries are point 3; `context.compiled` on the planner's task is point 4.
 *
 * ONCE, AND WHOLE. The manifest's event id is the run's, and it is written
 * last, only when every selected copy and its standing are in the store. A
 * replayed bootstrap that finds it writes nothing, so a replay can neither
 * inherit twice nor inherit something the manifest does not list. A restore
 * that failed partway left no manifest, so its replay finishes the carry: each
 * copy is written if it is not there yet (at the run's next revision, never
 * one an earlier attempt took), and each standing is recorded if it is not.
 *
 * NOTE FOR ROW 13 (i). The manifest append goes through
 * `JuliusEventPostgresRepository.append`, i.e. the serializable event path the
 * concurrency work governs. That is the "database write on a path relevant to
 * 13 (i)" Decision C's compatibility gate exists for.
 */

/** How many earlier runs the carry reads findings from, newest first. Bounded: a project's history is not. */
export const JULIUS_CARRY_SOURCE_RUNS = 20;

/** How many claim candidates are read, VERIFIED and APPROVED, before the domain filters. */
export const JULIUS_CARRY_CLAIM_CANDIDATES = 200;

export const juliusCarryManifestEventId = (runId: string): string => `julius:knowledge.carried:${runId}`;

export class JuliusCarryPostgresRepository {
  private readonly read: JuliusReadPostgresRepository;
  private readonly timeline: JuliusTimelinePostgresRepository;
  private readonly claims: JuliusClaimPostgresRepository;
  private readonly events: JuliusEventPostgresRepository;

  constructor(private readonly pool: Pool) {
    this.read = new JuliusReadPostgresRepository(pool);
    this.timeline = new JuliusTimelinePostgresRepository(pool);
    this.claims = new JuliusClaimPostgresRepository(pool);
    this.events = new JuliusEventPostgresRepository(pool);
  }

  /** Point 1: what earlier runs wrote. Findings and their finding.* ledger rows, per run. */
  async carrySources(input: {
    readonly projectId: string;
    readonly excludeRunId: string;
    readonly maxRuns?: number;
  }): Promise<readonly JuliusCarrySourceRun[]> {
    const runs = await this.pool.query<{ run_id: string }>(
      `SELECT run_id FROM relay_wonderland.julius_runs
        WHERE project_id=$1 AND run_id<>$2
        ORDER BY created_at DESC, run_id
        LIMIT $3`,
      [input.projectId, input.excludeRunId, input.maxRuns ?? JULIUS_CARRY_SOURCE_RUNS],
    );
    const sources: JuliusCarrySourceRun[] = [];
    for (const { run_id: runId } of runs.rows) {
      const findings = await this.read.findingsForRun(runId, input.projectId);
      if (findings.length === 0) continue;
      sources.push({ runId, findings, ledger: await this.findingLedger(runId, input.projectId) });
    }
    return sources;
  }

  private async findingLedger(runId: string, projectId: string): Promise<readonly JuliusPeerLedgerEntry[]> {
    const rows: JuliusPeerLedgerEntry[] = [];
    let sinceSequence = 0;
    for (;;) {
      const page = await this.timeline.timeline({ runId, projectId, sinceSequence, limit: 500 });
      for (const entry of page.entries) {
        sinceSequence = Math.max(sinceSequence, entry.sequence);
        if (entry.type === 'finding.recorded' || entry.type === 'finding.transitioned') {
          rows.push({ type: entry.type, facts: entry.facts, taskId: entry.taskId });
        }
      }
      if (!page.hasMore || page.entries.length === 0) break;
    }
    return rows;
  }

  /**
   * Every current claim of the project standing VERIFIED or APPROVED, with its
   * row's scope. The domain refuses most of them by name; reading them all is
   * what lets the manifest prove it did.
   */
  async carryClaimCandidates(input: {
    readonly projectId: string;
    readonly excludeRunId: string;
    readonly limit?: number;
  }): Promise<readonly JuliusCarryClaimCandidate[]> {
    const result = await this.pool.query<{
      claim_id: string; entry_id: string; provenance: string; trust: string; asserted_by: string;
      asserted_at: Date | string; evidence: unknown; supersedes: string | null; contradicts: unknown;
      run_id: string; entry_kind: string; safe_content: string; evidence_ids: unknown; task_id: string | null;
    }>(
      `WITH current AS (
         SELECT DISTINCT ON (claim_id) claim_id, entry_id, provenance, trust, asserted_by, asserted_at, evidence,
                supersedes, contradicts, run_id
           FROM relay_wonderland.julius_claim_standings
          WHERE project_id = $1 AND run_id <> $2
          ORDER BY claim_id, standing_revision DESC
       )
       SELECT c.*, b.entry_kind, b.safe_content, b.evidence_ids, b.task_id
         FROM current c
         JOIN relay_wonderland.julius_brain_entries b
           ON b.entry_id = c.entry_id AND b.project_id = $1
        WHERE c.trust IN ('VERIFIED','APPROVED')
        ORDER BY b.created_at DESC, c.entry_id
        LIMIT $3`,
      [input.projectId, input.excludeRunId, input.limit ?? JULIUS_CARRY_CLAIM_CANDIDATES],
    );
    return result.rows.map((row) => ({
      sourceRunId: row.run_id,
      taskId: row.task_id,
      claim: {
        claimId: row.claim_id,
        entryId: row.entry_id,
        provenance: row.provenance as JuliusCarryClaimCandidate['claim']['provenance'],
        trust: row.trust as JuliusCarryClaimCandidate['claim']['trust'],
        assertedBy: row.asserted_by,
        assertedAt: new Date(row.asserted_at).toISOString(),
        evidence: Array.isArray(row.evidence) ? (row.evidence as JuliusCarryClaimCandidate['claim']['evidence']) : [],
        supersedes: row.supersedes,
        contradicts: Array.isArray(row.contradicts) ? (row.contradicts as unknown[]).map(String) : [],
      },
      entry: {
        entryId: row.entry_id,
        kind: brainKindFromStored(row.entry_kind) as JuliusBrainEntry['kind'],
        text: row.safe_content,
        evidenceIds: Array.isArray(row.evidence_ids) ? (row.evidence_ids as unknown[]).map(String) : [],
      },
    }));
  }

  /** Whether this run's manifest is already on the ledger. */
  async manifestRecorded(runId: string): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM relay_wonderland.events WHERE event_id=$1', [juliusCarryManifestEventId(runId)]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * How many of `entryIds` this run holds as copies WITH their standing: a copy whose standing was never
   * recorded is not knowledge the run can be said to hold.
   */
  async heldCopies(runId: string, entryIds: readonly string[]): Promise<number> {
    if (entryIds.length === 0) return 0;
    const result = await this.pool.query<{ held: number }>(
      `SELECT count(*)::int AS held FROM relay_wonderland.julius_brain_entries b
        WHERE b.run_id=$1 AND b.entry_id = ANY($2::text[])
          AND EXISTS (SELECT 1 FROM relay_wonderland.julius_claim_standings s WHERE s.run_id=$1 AND s.entry_id=b.entry_id)`,
      [runId, entryIds],
    );
    return result.rows[0]?.held ?? 0;
  }

  /**
   * Points 2 and 3: write the selected copies, their standings and the manifest, once.
   * Returns how many selected copies the run holds with their standing. The manifest records the same number,
   * so a carry that is less than its selection says so; a replay writes nothing and returns the same count.
   * `origin` names a paired arm's verified bundle when the sources were read
   * from one rather than from this database; absent, the manifest says STORE.
   */
  async restore(input: {
    readonly runId: string;
    readonly projectId: string;
    readonly arm: JuliusCarryArm | null;
    readonly selection: JuliusCarrySelection;
    readonly firstRevision: number;
    readonly occurredAt: string;
    readonly origin?: JuliusCarryArchiveOrigin | null;
  }): Promise<number> {
    const entryIds = input.selection.selected.map((item) => item.entryId);
    if (await this.manifestRecorded(input.runId)) return this.heldCopies(input.runId, entryIds);
    for (const item of input.selection.selected) {
      // The id names this run, so a row already holding it is this carry's own, written by an attempt that did not
      // finish. Any OTHER unique violation (a revision already taken) is an error, never a silent skip.
      await this.pool.query(
        `INSERT INTO relay_wonderland.julius_brain_entries
           (entry_id,run_id,project_id,task_id,worker_id,entry_kind,safe_content,evidence_ids,revision,created_at)
         SELECT $1,$2,$3,NULL,$4,$5,$6,$7::jsonb,
                GREATEST($8::bigint, COALESCE((SELECT max(revision) FROM relay_wonderland.julius_brain_entries WHERE run_id=$2), 0) + 1),
                $9
         ON CONFLICT (entry_id) DO NOTHING`,
        [
          item.entryId, input.runId, input.projectId, item.claim.assertedBy, item.storedKind, item.text,
          JSON.stringify(item.evidenceIds), input.firstRevision, input.occurredAt,
        ],
      );
      // Recorded whether or not this call wrote the copy: the same standing is written once (`recordClaimStanding`
      // compares it with the latest), so a replay records exactly the standings an interrupted attempt did not.
      await this.claims.recordClaimStanding({
        runId: input.runId, projectId: input.projectId, claim: item.claim,
        reason: `CARRIED_FROM:${item.scope.sourceRunId}:${item.scope.sourceRef}`,
        occurredAt: input.occurredAt,
      });
    }
    const written = await this.heldCopies(input.runId, entryIds);
    await this.events.append({
      eventId: juliusCarryManifestEventId(input.runId),
      runId: input.runId,
      projectId: input.projectId,
      type: 'knowledge.carried',
      taskId: null,
      workerId: null,
      correlationId: input.runId,
      causationId: null,
      occurredAt: input.occurredAt,
      facts: juliusCarryManifestFacts({ arm: input.arm, selection: input.selection, written, origin: input.origin ?? null }),
    });
    return written;
  }
}
