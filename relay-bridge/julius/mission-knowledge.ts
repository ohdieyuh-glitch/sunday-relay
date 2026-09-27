import type { Pool } from 'pg';

import { juliusCarriedClaim, juliusCarriedEntryId, type JuliusCarriedKnowledge } from '../../src/relay/mission/julius/julius-claim-ledger';
import { brainKindToStored } from '../../src/relay/persistence/julius-brain-kinds';
import { JuliusClaimPostgresRepository } from '../../src/relay/persistence/julius-claim-postgres';

/**
 * WHAT ONE MISSION VERIFIED, HANDED TO THE NEXT — the minimum that makes reuse
 * truthful, and nothing beyond it.
 *
 * THE GAP THIS CLOSES. A context packet is compiled from the brain entries of
 * ONE RUN, so everything a mission learned died with it: the matched-pair
 * learning proof had to SEED the prior fact itself, and the readiness page said
 * plainly that the improvement rested on the fixture's premise. Nothing in
 * production carried a verified fact from mission A into mission B.
 *
 * WHAT IS CARRIED, AND WHAT IS NOT. Only claims a REVIEWER's evidence (or a
 * decision) put at VERIFIED or APPROVED — never an assertion, never a worker's
 * own note about itself, never a contradicted or superseded standing. Only from
 * the same project. Never from the run doing the carrying. Newest first, capped,
 * because a project's knowledge grows without bound and a packet does not.
 *
 * WHAT THE CARRY DOES NOT DECIDE. Relevance. It hands mission B a small set of
 * verified facts with their provenance intact; the context integrity layer
 * ranks them against B's own material, applies B's role and task scope, and
 * evicts what does not fit B's budget. That is deliberate: a carry that tried
 * to judge relevance would be a second, dumber ranker in front of the real one.
 *
 * WHY THE STANDING TRAVELS WITH IT. The copy's claim keeps A's trust, A's
 * asserter and the evidence it was verified on (see `juliusCarriedClaim`).
 * Re-deriving it would demote a reviewer-verified fact to an assertion, and B
 * would rank a fact as a guess. It is not a promotion: nobody verifies anything
 * here, and because `assertedBy` still names A's asserter, B's reviewer cannot
 * self-verify it either.
 */

export interface MissionKnowledgeStore {
  /** What this project has verified, excluding the run that is about to carry it. */
  verifiedProjectKnowledge(input: {
    readonly projectId: string;
    readonly excludeRunId: string;
    readonly limit: number;
  }): Promise<readonly JuliusCarriedKnowledge[]>;
  /**
   * Write the carried copies and their standings. Returns how many rows are new,
   * so a replayed bootstrap reports 0 rather than pretending to have learned
   * something twice.
   */
  carryKnowledge(input: {
    readonly runId: string;
    readonly projectId: string;
    readonly carried: readonly JuliusCarriedKnowledge[];
    readonly firstRevision: number;
    readonly occurredAt: string;
  }): Promise<number>;
}

/** How many verified facts one mission may inherit. A packet, not an archive. */
export const JULIUS_CARRIED_KNOWLEDGE_LIMIT = 12;

export function createPostgresMissionKnowledgeStore(pool: Pool): MissionKnowledgeStore {
  const claims = new JuliusClaimPostgresRepository(pool);
  return {
    verifiedProjectKnowledge: (input) => claims.verifiedProjectKnowledge(input),
    async carryKnowledge(input) {
      let written = 0;
      let revision = input.firstRevision;
      for (const carried of input.carried) {
        const entryId = juliusCarriedEntryId(carried.sourceRunId, carried.entry.entryId);
        /**
         * THE COPY KEEPS ITS AUTHOR. `worker_id` is A's asserter, not
         * `relay-bootstrap`: the claim ledger reads authorship to refuse
         * self-verification, and a carried fact attributed to the bootstrap
         * would let any reviewer "verify" it in B while telling a reader that
         * Julius asserted something a model did.
         */
        const inserted = await pool.query(
          `INSERT INTO relay_wonderland.julius_brain_entries
             (entry_id,run_id,project_id,task_id,worker_id,entry_kind,safe_content,evidence_ids,revision,created_at)
           VALUES($1,$2,$3,NULL,$4,$5,$6,$7::jsonb,$8,$9) ON CONFLICT DO NOTHING`,
          [
            entryId, input.runId, input.projectId, carried.claim.assertedBy,
            brainKindToStored(carried.entry.kind), carried.entry.text,
            JSON.stringify(carried.entry.evidenceIds), revision, input.occurredAt,
          ],
        );
        if ((inserted.rowCount ?? 0) === 0) continue;
        revision += 1;
        written += 1;
        // The standing, about the copy, unchanged — and the reason names where
        // it came from, so the history answers "why is this VERIFIED here".
        await claims.recordClaimStanding({
          runId: input.runId, projectId: input.projectId,
          claim: juliusCarriedClaim(carried),
          reason: `CARRIED_FROM:${carried.sourceRunId}`,
          occurredAt: input.occurredAt,
        });
      }
      return written;
    },
  };
}
