import type { Pool } from 'pg';

import type { JuliusBrainAppend } from '../mission/julius/julius-runtime-ports';
import { brainKindFromStored, brainKindToStored } from './julius-brain-kinds';

/**
 * v1 BRAIN ENTRIES AS THE APPENDS THAT WROTE THEM — what a Project Brain v2
 * backfill re-drives.
 *
 * ONE ENTRY, ONE SHAPE, WHICHEVER PATH SEES IT. The mirror sees an append on
 * its way into `julius_brain_entries`; the backfill sees the row that came back
 * out. They must build the same Brain draft, because both commit under the key
 * `legacy:<entryId>` and a second, different body under one key is refused as a
 * conflict. Two things do not survive the table unchanged:
 *
 *   kind       the domain has OBJECTIVE, REQUIREMENT and EVIDENCE; the table
 *              stores CONSTRAINT, ACCEPTANCE_UPDATE and ARTIFACT
 *              (`julius-brain-kinds.ts`)
 *   occurredAt a `timestamptz` returns millisecond ISO in UTC, whatever
 *              precision or offset was written
 *
 * `juliusLegacyAppendAsStored` puts an append into the shape the table would
 * give back; the mirror applies it before committing, and the reader's rows are
 * already in it.
 */
export function juliusLegacyAppendAsStored(append: JuliusBrainAppend): JuliusBrainAppend {
  const at = new Date(append.occurredAt);
  return {
    ...append,
    kind: brainKindFromStored(brainKindToStored(append.kind)),
    occurredAt: Number.isNaN(at.getTime()) ? append.occurredAt : at.toISOString(),
  };
}

export async function readJuliusLegacyBrainAppends(pool: Pool, runId: string, projectId: string): Promise<JuliusBrainAppend[]> {
  const result = await pool.query<Record<string, unknown>>(
    `SELECT entry_id, run_id, project_id, task_id, worker_id, entry_kind, safe_content, evidence_ids, created_at
       FROM relay_wonderland.julius_brain_entries
      WHERE run_id = $1 AND project_id = $2
      ORDER BY revision`,
    [runId, projectId],
  );
  return result.rows.map((row) => ({
    runId: String(row.run_id),
    projectId: String(row.project_id),
    taskId: row.task_id === null ? null : String(row.task_id),
    workerId: String(row.worker_id),
    entryId: String(row.entry_id),
    kind: brainKindFromStored(String(row.entry_kind)),
    safeText: String(row.safe_content),
    evidenceIds: Array.isArray(row.evidence_ids) ? row.evidence_ids.map(String) : [],
    occurredAt: (row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at))).toISOString(),
  }));
}
