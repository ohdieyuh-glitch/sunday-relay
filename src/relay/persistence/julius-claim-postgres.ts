import type { Pool } from 'pg';

import type { JuliusCarriedKnowledge } from '../mission/julius/julius-claim-ledger';
import { juliusClaimStandingKey } from '../mission/julius/julius-claim-ledger';
import type { JuliusMemoryClaim } from '../mission/julius/julius-memory-trust';
import type { JuliusClaimStandingAppend, JuliusClaimStore } from '../mission/julius/julius-runtime-ports';

/**
 * THE CLAIM STORE ON POSTGRESQL — `julius_claim_standings`, append-only.
 *
 * A claim's current standing is its highest `standing_revision`; the rows below
 * it are the history. A replayed append whose content equals the latest row
 * writes nothing and reports false, exactly as the memory store does, so a
 * replayed tick cannot manufacture a promotion history that never happened.
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

  /**
   * WHAT THIS PROJECT HAS VERIFIED, AND MAY THEREFORE REUSE.
   *
   * The current standing per claim, kept only where a REVIEWER's evidence (or a
   * decision) put it at VERIFIED or APPROVED, joined to the brain row that is
   * the claim's subject so the carry has something to say. Excludes the run
   * doing the carrying, so a mission never reuses itself, and excludes rows
   * whose sensitivity or scope the context layer would refuse anyway — the
   * carry moves no SECRET material because the table cannot hold any: every
   * stored row reads back INTERNAL (`julius-read-postgres` says so), and the
   * scope and sensitivity filters at compile time are what govern the entries a
   * process holds in memory.
   *
   * ORDERED NEWEST FIRST AND CAPPED, because a project accumulates knowledge
   * without bound and a mission's packet does not. This is the whole of
   * "truthful reuse": no inference, no graph, no ranking beyond recency — the
   * context integrity layer ranks what arrives.
   */
  async verifiedProjectKnowledge(input: {
    readonly projectId: string;
    readonly excludeRunId: string;
    readonly limit: number;
  }): Promise<readonly JuliusCarriedKnowledge[]> {
    const result = await this.pool.query<{
      claim_id: string; entry_id: string; provenance: string; trust: string;
      asserted_by: string; asserted_at: Date | string; evidence: unknown;
      entry_kind: string; safe_content: string; evidence_ids: unknown; run_id: string;
    }>(
      `WITH current AS (
         SELECT DISTINCT ON (claim_id) claim_id, entry_id, provenance, trust, asserted_by, asserted_at, evidence, run_id
           FROM relay_wonderland.julius_claim_standings
          WHERE project_id = $1 AND run_id <> $2
          ORDER BY claim_id, standing_revision DESC
       )
       SELECT c.claim_id, c.entry_id, c.provenance, c.trust, c.asserted_by, c.asserted_at, c.evidence, c.run_id,
              b.entry_kind, b.safe_content, b.evidence_ids
         FROM current c
         JOIN relay_wonderland.julius_brain_entries b
           ON b.entry_id = c.entry_id AND b.project_id = $1
        WHERE c.trust IN ('VERIFIED','APPROVED')
        ORDER BY b.created_at DESC, c.entry_id
        LIMIT $3`,
      [input.projectId, input.excludeRunId, input.limit],
    );
    return result.rows.map((row) => ({
      sourceRunId: row.run_id,
      claim: claimOf({
        claim_id: row.claim_id, standing_revision: 0, entry_id: row.entry_id,
        provenance: row.provenance, trust: row.trust, asserted_by: row.asserted_by,
        asserted_at: row.asserted_at, evidence: row.evidence, supersedes: null, contradicts: [],
      }),
      entry: {
        entryId: row.entry_id,
        kind: row.entry_kind as JuliusCarriedKnowledge['entry']['kind'],
        text: row.safe_content,
        evidenceIds: Array.isArray(row.evidence_ids) ? (row.evidence_ids as readonly string[]).map(String) : [],
      },
    }));
  }

  async recordClaimStanding(input: JuliusClaimStandingAppend): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // The run must exist in this project; a claim about a run nowhere holds is
      // refused rather than written, the same guard the brain append applies.
      const run = await client.query('SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id = $1 AND project_id = $2', [input.runId, input.projectId]);
      if (run.rowCount === 0) { await client.query('ROLLBACK'); return false; }
      const latest = await client.query<StandingRow>(
        `SELECT claim_id, standing_revision, entry_id, provenance, trust, asserted_by, asserted_at, evidence, supersedes, contradicts
           FROM relay_wonderland.julius_claim_standings
          WHERE claim_id = $1 AND project_id = $2
          ORDER BY standing_revision DESC LIMIT 1 FOR UPDATE`,
        [input.claim.claimId, input.projectId],
      );
      const current = latest.rows[0];
      if (current !== undefined && juliusClaimStandingKey(claimOf(current)) === juliusClaimStandingKey(input.claim)) {
        await client.query('ROLLBACK');
        return false;
      }
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
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
