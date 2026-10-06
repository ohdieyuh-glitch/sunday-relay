import type { Pool } from 'pg';

import type { JuliusKnowledgeCarryOutcome } from '../../src/relay/mission/julius/julius-claim-ledger';
import { JuliusClaimPostgresRepository, type JuliusKnowledgeCarryRequest } from '../../src/relay/persistence/julius-claim-postgres';

/**
 * WHAT AN EARLIER RUN OF A MISSION VERIFIED, HANDED TO THE NEXT RUN'S PLANNER —
 * the minimum that makes reuse truthful, and nothing beyond it.
 *
 * THE GAP THIS CLOSED. A context packet is compiled from the brain entries of
 * ONE RUN, so everything a mission learned died with it: the matched-pair
 * learning proof had to SEED the prior fact itself. The first carry closed that
 * gap and opened a worse one (founder ruling 2026-10-04): it copied every claim
 * that READ verified or approved, and a DECISION entry is approved by its kind,
 * so verification verdicts about another run's tasks and an architecture
 * nobody accepted arrived as approved instructions, run-wide, for every role,
 * from any mission of the project — while the reviewer's actual finding never
 * travelled at all.
 *
 * WHAT IS CARRIED NOW is decided by one pure rule in the claim ledger
 * (`planJuliusKnowledgeCarry`, "THE CARRY, CORRECTED"): a blocking reviewer
 * finding a repair answered and an independent re-review RESOLVED, from an
 * earlier run of the SAME mission, and nothing else: not even the design in
 * force (Decision C). Every carried row is scoped to the new run's plan task
 * and keeps where it came from. Everything else is excluded by name.
 *
 * WHAT IS RECORDED. The whole decision — what travelled, from which run and
 * task, under which scope, and every candidate left behind with its reason — is
 * ONE `knowledge.carried` event, written in the same transaction as the rows. A
 * carry that cannot be decided or written is a FAILED event with a closed
 * reason. The bootstrap is told the outcome and decides whether it may start;
 * nothing here is swallowed.
 *
 * WHAT THE CARRY DOES NOT DECIDE. Ranking. The context integrity layer still
 * ranks what arrives against the plan's own material and spends the budget —
 * and the dispatch records, per packet, which carried rows arrived
 * (`knowledge.consumed`).
 */

export interface MissionKnowledgeStore {
  /**
   * Decide, write and record what this run inherits. Never throws: a failure is
   * an outcome (`FAILED`, with its reason) and is on the ledger when the store
   * can still write at all.
   */
  carryKnowledge(input: JuliusKnowledgeCarryRequest): Promise<JuliusKnowledgeCarryOutcome>;
}

/** How many rows one run may inherit. A packet, not an archive. */
export const JULIUS_CARRIED_KNOWLEDGE_LIMIT = 12;

export function createPostgresMissionKnowledgeStore(pool: Pool): MissionKnowledgeStore {
  const claims = new JuliusClaimPostgresRepository(pool);
  return {
    carryKnowledge: (input) => claims.carryProjectKnowledge(input),
  };
}
