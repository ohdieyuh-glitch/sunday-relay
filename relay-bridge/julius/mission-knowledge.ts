import type { Pool } from 'pg';

import {
  selectJuliusCarry,
  type JuliusCarryArm, type JuliusCarrySelection,
} from '../../src/relay/mission/julius/julius-carry';
import { JuliusCarryPostgresRepository } from '../../src/relay/persistence/julius-carry-postgres';

/**
 * WHAT ONE MISSION VERIFIED, HANDED TO THE NEXT — THE CORRECTED CARRY
 * (`julius-carry.v2`, Decision C).
 *
 * The rules live in `src/relay/mission/julius/julius-carry.ts`; read its header
 * for the defect this replaces. In one paragraph: the first carry took every
 * VERIFIED or APPROVED claim of any kind and made it run-wide in the next
 * mission, which carried a reviewed task's own HANDOFF notes and a "NOT IN
 * FORCE" architecture proposal, and could never carry the thing a learning pair
 * exists to move, because reviewer findings are not brain entries. The carry
 * now moves only an Independent Reviewer's findings that a reviewer resolved
 * (after a repair, for the repair class) and adopted, run-wide decisions, keeps
 * each one's source run, work, reviews and repairs, and writes one manifest of
 * what it selected and what it refused, by code.
 *
 * TWO STEPS, AND THE ORDER IS THE POINT. `select` only READS and runs before the
 * bootstrap creates anything, so a WITH arm whose carry is empty, design-only or
 * unreadable is refused before a run exists, and so before any paid dispatch.
 * `restore` WRITES, once per run, after the seed.
 *
 * WHAT THE CARRY DOES NOT DECIDE. Relevance. The context integrity layer ranks
 * what arrives against the receiving mission's own material and budget.
 */
export interface MissionKnowledgeStore {
  /** What earlier missions of this project hold that may travel, and everything that may not, by code. */
  select(input: { readonly projectId: string; readonly targetRunId: string }): Promise<JuliusCarrySelection>;
  /**
   * Write the selected copies, their standings and the manifest, once. Returns
   * how many of the selected copies the run HOLDS with their standing, which is
   * what the manifest records: a replay writes nothing and returns the same
   * count, and an interrupted restore is finished by its replay, never taken
   * for done.
   */
  restore(input: {
    readonly runId: string;
    readonly projectId: string;
    readonly arm: JuliusCarryArm | null;
    readonly selection: JuliusCarrySelection;
    readonly firstRevision: number;
    readonly occurredAt: string;
  }): Promise<number>;
}

export function createPostgresMissionKnowledgeStore(pool: Pool): MissionKnowledgeStore {
  const carry = new JuliusCarryPostgresRepository(pool);
  return {
    async select(input) {
      const [sources, claims] = await Promise.all([
        carry.carrySources({ projectId: input.projectId, excludeRunId: input.targetRunId }),
        carry.carryClaimCandidates({ projectId: input.projectId, excludeRunId: input.targetRunId }),
      ]);
      return selectJuliusCarry({ targetRunId: input.targetRunId, sources, claims });
    },
    restore: (input) => carry.restore(input),
  };
}
