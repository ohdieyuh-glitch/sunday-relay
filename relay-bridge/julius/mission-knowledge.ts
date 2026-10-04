import type { Pool } from 'pg';

import {
  selectJuliusCarry,
  type JuliusCarryArchiveOrigin, type JuliusCarryArm, type JuliusCarrySelection, type JuliusCarrySourceRun,
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
   * Write the selected copies and the manifest. Returns how many copies this
   * call wrote, so a replayed bootstrap reports 0 rather than pretending to have
   * learned something twice.
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

/**
 * THE PAID VENUE'S CARRY: SOURCES FROM A PAIRED ARM'S VERIFIED BUNDLE.
 *
 * A paid job's database is fresh, so the paired WITHOUT arm's findings are not
 * in it. They arrive as ONE source run read from that arm's evidence bundle and
 * verified before this store exists (`readJuliusCarryArchive`). Selection reads
 * that source and ONLY that source: a WITH arm learns from its pair, never from
 * whatever else a database happens to hold, and the claims path stays empty
 * because the bundle carries findings, not standings. Everything after
 * selection is the store path's own: the same `selectJuliusCarry`, the same
 * pair gate in the bootstrap, the same restore into this run, with the manifest
 * naming the bundle it learned from.
 */
export function createArchivedMissionKnowledgeStore(input: {
  readonly pool: Pool;
  readonly archive: { readonly source: JuliusCarrySourceRun; readonly origin: JuliusCarryArchiveOrigin };
}): MissionKnowledgeStore {
  const carry = new JuliusCarryPostgresRepository(input.pool);
  const { source, origin } = input.archive;
  return {
    async select(request) {
      // Verified against the contract's project when the bundle was read; a
      // store composed for one project must never answer for another.
      if (request.projectId !== origin.sourceProjectId) throw new Error('carry_archive_project_mismatch');
      return selectJuliusCarry({ targetRunId: request.targetRunId, sources: [source], claims: [] });
    },
    restore: (request) => carry.restore({ ...request, origin }),
  };
}
