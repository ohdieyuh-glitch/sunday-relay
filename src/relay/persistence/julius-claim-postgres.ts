import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import { foldJuliusArchitecture, juliusArchitectureEntryId } from '../mission/julius/julius-architecture-state';
import {
  JULIUS_CARRY_CANDIDATE_LIMIT, JULIUS_CARRY_SOURCE_RUN_LIMIT, JULIUS_KNOWLEDGE_CARRY_VERSION,
  juliusCarryFindingCandidate, juliusClaimStandingKey, juliusKnowledgeCarriedEvent, juliusKnowledgeCarryFacts, juliusKnowledgeCarryFailureFacts,
  planJuliusKnowledgeCarry,
  type JuliusCarryArchitectureFact, type JuliusCarryBrainCandidate, type JuliusCarryFailure, type JuliusCarryFindingCandidate,
  type JuliusCarryPlan, type JuliusCarryScope, type JuliusCarrySourceRun, type JuliusKnowledgeCarryOutcome,
} from '../mission/julius/julius-claim-ledger';
import { foldJuliusFindings } from '../mission/julius/julius-finding-lifecycle';
import type { JuliusMemoryClaim } from '../mission/julius/julius-memory-trust';
import type { JuliusPeerLedgerEntry } from '../mission/julius/julius-peer-channel';
import type { JuliusClaimStandingAppend, JuliusClaimStore } from '../mission/julius/julius-runtime-ports';
import { brainKindFromStored, brainKindToStored } from './julius-brain-kinds';
import { appendJuliusEventWithin } from './julius-event-postgres';
import { JuliusReadPostgresRepository } from './julius-read-postgres';
import { juliusSerializable } from './julius-serializable';
import { checkoutJuliusHeld } from './julius-pg-held';
import { JuliusTimelinePostgresRepository } from './julius-timeline-postgres';

/**
 * THE CLAIM STORE ON POSTGRESQL — `julius_claim_standings`, append-only.
 *
 * A claim's current standing is its highest `standing_revision`; the rows below
 * it are the history. A replayed append whose content equals the latest row
 * writes nothing and reports false, exactly as the memory store does, so a
 * replayed tick cannot manufacture a promotion history that never happened.
 *
 * AND THE CARRY (founder ruling 2026-10-04): what a new run inherits from the
 * earlier runs of its mission, decided from durable state by the pure rule in
 * `julius-claim-ledger.ts` ("THE CARRY, CORRECTED"), written with its standings
 * and its one `knowledge.carried` ledger row in ONE transaction, so the record
 * can never disagree with the rows it describes. A carry that cannot be decided
 * or written is recorded as FAILED, by a closed reason, and returned — never
 * swallowed, and never thrown at a bootstrap that must still start.
 */

interface StandingRow {
  readonly claim_id: string;
  readonly standing_revision: number;
  readonly entry_id: string;
  readonly provenance: string;
  readonly trust: string;
  readonly asserted_by: string;
  readonly asserted_at: Date | string;
  readonly evidence: unknown;
  readonly supersedes: string | null;
  readonly contradicts: unknown;
}

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

const claimOf = (row: StandingRow): JuliusMemoryClaim => ({
  claimId: row.claim_id,
  entryId: row.entry_id,
  provenance: row.provenance as JuliusMemoryClaim['provenance'],
  trust: row.trust as JuliusMemoryClaim['trust'],
  assertedBy: row.asserted_by,
  assertedAt: iso(row.asserted_at),
  evidence: Array.isArray(row.evidence) ? (row.evidence as JuliusMemoryClaim['evidence']) : [],
  supersedes: row.supersedes,
  contradicts: Array.isArray(row.contradicts) ? (row.contradicts as readonly string[]) : [],
});

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Flat facts in a key order nothing can disturb, so the same carry names the same event id. */
const canonicalFacts = (facts: Readonly<Record<string, string | number | boolean | null>>): string =>
  JSON.stringify(Object.keys(facts).sort().map((key) => [key, facts[key] ?? null]));

/**
 * ONE STANDING, INSIDE SOMEONE ELSE'S TRANSACTION. The append's whole rule —
 * the run must be this project's, a standing equal to the latest one writes
 * nothing — so the claim store's own append and the carry's are one definition.
 */
async function recordStandingWithin(client: PoolClient, input: JuliusClaimStandingAppend): Promise<boolean> {
  // The run must exist in this project; a claim about a run nowhere holds is
  // refused rather than written, the same guard the brain append applies.
  const run = await client.query('SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id = $1 AND project_id = $2', [input.runId, input.projectId]);
  if (run.rowCount === 0) return false;
  const latest = await client.query<StandingRow>(
    `SELECT claim_id, standing_revision, entry_id, provenance, trust, asserted_by, asserted_at, evidence, supersedes, contradicts
       FROM relay_wonderland.julius_claim_standings
      WHERE claim_id = $1 AND project_id = $2
      ORDER BY standing_revision DESC LIMIT 1 FOR UPDATE`,
    [input.claim.claimId, input.projectId],
  );
  const current = latest.rows[0];
  if (current !== undefined && juliusClaimStandingKey(claimOf(current)) === juliusClaimStandingKey(input.claim)) return false;
  const revision = current === undefined ? 1 : current.standing_revision + 1;
  await client.query(
    `INSERT INTO relay_wonderland.julius_claim_standings
       (claim_id, standing_revision, project_id, run_id, entry_id, provenance, trust, asserted_by, asserted_at, evidence, supersedes, contradicts, reason, recorded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14)`,
    [
      input.claim.claimId, revision, input.projectId, input.runId, input.claim.entryId,
      input.claim.provenance, input.claim.trust, input.claim.assertedBy, input.claim.assertedAt,
      JSON.stringify(input.claim.evidence), input.claim.supersedes, JSON.stringify(input.claim.contradicts),
      input.reason, input.occurredAt,
    ],
  );
  return true;
}

/** The input of one carry, as the bootstrap states it. */
export interface JuliusKnowledgeCarryRequest {
  readonly runId: string;
  readonly projectId: string;
  readonly missionId: string;
  /** The inheriting run's plan task: every carried row is scoped to it. */
  readonly scopeTaskId: string;
  readonly limit: number;
  readonly occurredAt: string;
  /** Carry only from these runs (a learning arm WITH names its arm WITHOUT). Still this project and mission only. */
  readonly fromRunIds?: readonly string[];
}

export class JuliusClaimPostgresRepository implements JuliusClaimStore {
  constructor(private readonly pool: Pool) {}

  async claimsForRun(runId: string, projectId: string): Promise<readonly JuliusMemoryClaim[]> {
    const result = await this.pool.query<StandingRow>(
      `SELECT DISTINCT ON (claim_id) claim_id, standing_revision, entry_id, provenance, trust, asserted_by, asserted_at, evidence, supersedes, contradicts
         FROM relay_wonderland.julius_claim_standings
        WHERE run_id = $1 AND project_id = $2
        ORDER BY claim_id, standing_revision DESC`,
      [runId, projectId],
    );
    return result.rows.map(claimOf);
  }

  async claimStandingHistory(claimId: string, projectId: string): Promise<readonly JuliusMemoryClaim[]> {
    const result = await this.pool.query<StandingRow>(
      `SELECT claim_id, standing_revision, entry_id, provenance, trust, asserted_by, asserted_at, evidence, supersedes, contradicts
         FROM relay_wonderland.julius_claim_standings
        WHERE claim_id = $1 AND project_id = $2
        ORDER BY standing_revision ASC`,
      [claimId, projectId],
    );
    return result.rows.map(claimOf);
  }

  async recordClaimStanding(input: JuliusClaimStandingAppend): Promise<boolean> {
    const { client, release } = await checkoutJuliusHeld(this.pool, 'julius claim store');
    try {
      await client.query('BEGIN');
      const recorded = await recordStandingWithin(client, input);
      await client.query(recorded ? 'COMMIT' : 'ROLLBACK');
      return recorded;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      release();
    }
  }

  /**
   * WHAT A NEW RUN MAY INHERIT, READ FROM DURABLE STATE AND DECIDED BY THE PURE RULE.
   *
   * The sources are the earlier runs of the SAME project AND the SAME mission
   * (`julius_runs.mission_id` — an explicit rerun keeps its mission, so a
   * learning arm WITH finds its arm WITHOUT), never the run doing the carrying,
   * newest first and bounded. For each: its finding rows with the life its own
   * ledger gives them (`foldJuliusFindings`, the one lifecycle definition), the
   * design its ledger says was in force (`foldJuliusArchitecture`; named on the
   * record, never carried), and the work each finding judged. Then every brain row of those runs whose CURRENT
   * standing is VERIFIED or APPROVED — what the first carry copied — so each one
   * the corrected rule leaves behind is named on the record, not just absent.
   *
   * Read through the runtime's own readers (`JuliusReadPostgresRepository`,
   * `JuliusTimelinePostgresRepository`), so a finding row, a stored kind and a
   * ledger fact mean here exactly what they mean to the run loop.
   */
  async knowledgeCarryPlan(input: JuliusKnowledgeCarryRequest & { readonly scope: JuliusCarryScope }): Promise<JuliusCarryPlan> {
    const runs = await this.pool.query<{ run_id: string; state: string }>(
      `SELECT run_id, state FROM relay_wonderland.julius_runs
        WHERE project_id = $1 AND mission_id = $2 AND run_id <> $3
          AND ($4::text[] IS NULL OR run_id = ANY($4::text[]))
        ORDER BY created_at DESC, run_id DESC
        LIMIT $5`,
      [input.projectId, input.missionId, input.runId, input.fromRunIds === undefined ? null : [...input.fromRunIds], JULIUS_CARRY_SOURCE_RUN_LIMIT],
    );
    const sourceRuns: JuliusCarrySourceRun[] = runs.rows.map((row) => ({ runId: String(row.run_id), state: String(row.state) }));
    const reads = new JuliusReadPostgresRepository(this.pool);
    const timeline = new JuliusTimelinePostgresRepository(this.pool);
    const findings: JuliusCarryFindingCandidate[] = [];
    const architectures: JuliusCarryArchitectureFact[] = [];
    for (const run of sourceRuns) {
      const [rows, tasks, ledger] = await Promise.all([
        reads.findingsForRun(run.runId, input.projectId),
        reads.tasksForRun(run.runId, input.projectId),
        ledgerOf(timeline, run.runId, input.projectId),
      ]);
      const lives = new Map(foldJuliusFindings(rows, ledger).map((life) => [life.findingId, life] as const));
      const taskOf = new Map(tasks.map((task) => [task.taskId, task] as const));
      for (const finding of rows) {
        findings.push(juliusCarryFindingCandidate({ runId: run.runId, finding, life: lives.get(finding.findingId), taskOf: (taskId) => taskOf.get(taskId) }));
      }
      const design = foldJuliusArchitecture(ledger);
      architectures.push({
        runId: run.runId,
        inForceEntryId: design === null ? null : juliusArchitectureEntryId(run.runId, design.revision),
        revision: design === null ? null : design.revision,
        proposedByTaskId: design === null ? null : design.proposedByTaskId,
      });
    }
    const brain = sourceRuns.length === 0 ? [] : await this.verifiedBrainRowsOf(input.projectId, sourceRuns.map((run) => run.runId));
    return planJuliusKnowledgeCarry({
      runId: input.runId, projectId: input.projectId, missionId: input.missionId, scope: input.scope,
      sourceRuns, findings, architectures,
      brain: brain.slice(0, JULIUS_CARRY_CANDIDATE_LIMIT),
      brainTruncated: brain.length > JULIUS_CARRY_CANDIDATE_LIMIT,
      limit: input.limit,
    });
  }

  /**
   * CARRY, WRITE, RECORD — or record why not.
   *
   * One `juliusSerializable` transaction (THE APPEND DISCIPLINE, below)
   * writes every carried row (scoped to the plan
   * task, under its own `carried:…:into:<run>` id, at the next revisions of
   * the run's brain), the standing each copy is recorded at (reason
   * `CARRIED_FROM:<sourceRun>`), and the `knowledge.carried` event. A replay
   * that carries the same thing writes no row and no standing again, and the
   * event — whose id is derived from its facts — is the same event, so it is
   * not written twice either.
   *
   * `ON CONFLICT (entry_id)` and nothing wider: a copy that already exists is a
   * replay; a revision that is already taken is a defect, and it fails the
   * transaction loudly instead of being skipped the way an untargeted
   * `ON CONFLICT DO NOTHING` skipped it.
   */
  async carryProjectKnowledge(input: JuliusKnowledgeCarryRequest): Promise<JuliusKnowledgeCarryOutcome> {
    const scope: JuliusCarryScope = { taskId: input.scopeTaskId, taskType: 'plan', role: 'PROMPT_ARCHITECT' };
    let plan: JuliusCarryPlan;
    try {
      plan = await this.knowledgeCarryPlan({ ...input, scope });
    } catch {
      return this.recordCarryFailure(input, 'carry_sources_unreadable');
    }
    // THE FULL sha256 of each copy's text: the off-host verifier (`julius-carry-verify.ts`) binds the copy to it (C-7).
    const digests = Object.fromEntries(plan.carried.map((item) => [item.entryId, `sha256:${sha256(item.text)}`] as const));
    const facts = juliusKnowledgeCarryFacts(plan, digests);
    const event = juliusKnowledgeCarriedEvent({
      runId: input.runId, projectId: input.projectId, occurredAt: input.occurredAt, facts,
      eventId: `${JULIUS_KNOWLEDGE_CARRY_VERSION}:${input.runId}:${sha256(canonicalFacts(facts)).slice(0, 24)}`,
    });
    let written: number;
    try {
      written = await juliusSerializable(this.pool, async (client) => {
        const run = await client.query('SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id = $1 AND project_id = $2 FOR UPDATE', [input.runId, input.projectId]);
        if (run.rowCount === 0) throw new Error('julius_run_not_found');
        const top = await client.query<{ revision: string }>(
          'SELECT COALESCE(max(revision), 0)::text AS revision FROM relay_wonderland.julius_brain_entries WHERE run_id = $1',
          [input.runId],
        );
        let revision = Number(top.rows[0]?.revision ?? '0');
        let count = 0;
        for (const item of plan.carried) {
          const inserted = await client.query(
            `INSERT INTO relay_wonderland.julius_brain_entries
               (entry_id,run_id,project_id,task_id,worker_id,entry_kind,safe_content,evidence_ids,revision,created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) ON CONFLICT (entry_id) DO NOTHING`,
            [
              item.entryId, input.runId, input.projectId, item.scope.taskId, item.workerId, brainKindToStored(item.kind),
              item.text, JSON.stringify(item.evidenceIds), revision + 1, input.occurredAt,
            ],
          );
          if ((inserted.rowCount ?? 0) === 0) continue;
          revision += 1;
          count += 1;
          await recordStandingWithin(client, {
            runId: input.runId, projectId: input.projectId, claim: item.claim,
            reason: `CARRIED_FROM:${item.sourceRunId}`, occurredAt: input.occurredAt,
          });
        }
        await appendJuliusEventWithin(client, event);
        return count;
      });
    } catch {
      return this.recordCarryFailure(input, 'carry_write_failed');
    }
    const findings = plan.carried.filter((item) => item.source === 'VERIFIED_REPAIR_FINDING');
    return {
      outcome: plan.carried.length === 0 ? 'EMPTY' : 'CARRIED',
      carried: plan.carried.length, carriedFindings: findings.length,
      findingSourceRunIds: [...new Set(findings.map((item) => item.sourceRunId))],
      written, excluded: plan.excluded.length,
      reasonCode: null, eventId: event.eventId,
    };
  }

  /**
   * THE FAILURE, ON THE RECORD. Its own small transaction, after the one that
   * failed rolled back, so the ledger says the carry was attempted and why it
   * did not happen. Each attempt is its own row. Only when even this write
   * fails — the store is gone — is the outcome unrecorded, and the caller is
   * told so (`eventId: null`).
   */
  private async recordCarryFailure(input: JuliusKnowledgeCarryRequest, reasonCode: JuliusCarryFailure): Promise<JuliusKnowledgeCarryOutcome> {
    const facts = juliusKnowledgeCarryFailureFacts({ missionId: input.missionId, scopeTaskId: input.scopeTaskId, reasonCode });
    const event = juliusKnowledgeCarriedEvent({
      runId: input.runId, projectId: input.projectId, occurredAt: input.occurredAt, facts,
      eventId: `${JULIUS_KNOWLEDGE_CARRY_VERSION}:${input.runId}:failed:${sha256(`${input.occurredAt}:${reasonCode}`).slice(0, 24)}`,
    });
    const recorded = await juliusSerializable(this.pool, (client) => appendJuliusEventWithin(client, event)).then(() => true, () => false);
    return {
      outcome: 'FAILED', carried: 0, carriedFindings: 0, findingSourceRunIds: [], written: 0, excluded: 0,
      reasonCode, eventId: recorded ? event.eventId : null,
    };
  }

  /*
   * THE APPEND DISCIPLINE (Decision C, C-12; SECOND's carry rulings 1ee86fc5).
   *
   * The carry is a Julius writer like every other: its rows, their standings and
   * its `knowledge.carried` event (and a FAILED record) go through
   * `juliusSerializable`, the path every event append takes. With row 13 (i)'s
   * H3 (#321) that path takes the Julius writer lock BEFORE `BEGIN`, so the
   * carry never runs beside another writer and cannot join a read/write cycle,
   * which is what row 13 (i) holds to zero and C-12 re-checks at C's head.
   * Draft r1 used READ COMMITTED serialised by the run row, to keep the carry out
   * of SERIALIZABLE's predicate locks before H3 existed. H3 serialises writers,
   * so that exception is no longer needed, and an append outside the writer
   * discipline was a risk to it. A 40001 is retried by `juliusSerializable`;
   * every write here is idempotent (`ON CONFLICT (entry_id)`, a fact-derived
   * event id), so a retry writes the same thing once.
   */

  /**
   * Every brain row of these runs whose CURRENT standing is VERIFIED or
   * APPROVED, with that standing. One more than the bound is read, so the plan
   * can say its count is a lower bound instead of guessing. The stored kind is
   * read back through `brainKindFromStored`: the first carry cast the raw
   * column to the domain type, and an `ACCEPTANCE_UPDATE` or `RESEARCH_NOTE`
   * row would have reached `brainKindToStored` as a kind it has no case for.
   */
  private async verifiedBrainRowsOf(projectId: string, runIds: readonly string[]): Promise<readonly JuliusCarryBrainCandidate[]> {
    const result = await this.pool.query<{
      claim_id: string; entry_id: string; provenance: string; trust: string; asserted_by: string; asserted_at: Date | string;
      evidence: unknown; run_id: string; entry_kind: string; safe_content: string; evidence_ids: unknown; task_id: string | null; worker_id: string;
    }>(
      `WITH current AS (
         SELECT DISTINCT ON (claim_id) claim_id, entry_id, provenance, trust, asserted_by, asserted_at, evidence, run_id
           FROM relay_wonderland.julius_claim_standings
          WHERE project_id = $1 AND run_id = ANY($2::text[])
          ORDER BY claim_id, standing_revision DESC
       )
       SELECT c.claim_id, c.entry_id, c.provenance, c.trust, c.asserted_by, c.asserted_at, c.evidence, c.run_id,
              b.entry_kind, b.safe_content, b.evidence_ids, b.task_id, b.worker_id
         FROM current c
         JOIN relay_wonderland.julius_brain_entries b
           ON b.entry_id = c.entry_id AND b.project_id = $1 AND b.run_id = c.run_id
        WHERE c.trust IN ('VERIFIED','APPROVED')
        ORDER BY b.created_at DESC, c.entry_id
        LIMIT $3`,
      [projectId, [...runIds], JULIUS_CARRY_CANDIDATE_LIMIT + 1],
    );
    return result.rows.map((row) => ({
      runId: String(row.run_id),
      entryId: String(row.entry_id),
      kind: brainKindFromStored(String(row.entry_kind)),
      taskId: row.task_id === null ? null : String(row.task_id),
      workerId: String(row.worker_id),
      text: String(row.safe_content),
      evidenceIds: Array.isArray(row.evidence_ids) ? (row.evidence_ids as readonly unknown[]).map(String) : [],
      claim: claimOf({
        claim_id: row.claim_id, standing_revision: 0, entry_id: row.entry_id, provenance: row.provenance, trust: row.trust,
        asserted_by: row.asserted_by, asserted_at: row.asserted_at, evidence: row.evidence, supersedes: null, contradicts: [],
      }),
    }));
  }
}

/**
 * A SOURCE RUN'S FINDING AND ARCHITECTURE LEDGER, paged to its end, filtered
 * exactly as the run loop's own verdict ledger is (`readVerdictLedger` in
 * `julius-task-pipeline.ts`), so the lifecycle and the design fold here to the
 * state they folded to there.
 */
async function ledgerOf(timeline: JuliusTimelinePostgresRepository, runId: string, projectId: string): Promise<readonly JuliusPeerLedgerEntry[]> {
  const rows: JuliusPeerLedgerEntry[] = [];
  let sinceSequence = 0;
  for (;;) {
    const page = await timeline.timeline({ runId, projectId, sinceSequence, limit: 500 });
    for (const entry of page.entries) {
      sinceSequence = Math.max(sinceSequence, entry.sequence);
      if (entry.type.startsWith('finding.') || entry.type.startsWith('architecture.')) {
        rows.push({ type: entry.type, facts: entry.facts, taskId: entry.taskId });
      }
    }
    if (!page.hasMore || page.entries.length === 0) break;
  }
  return rows;
}
