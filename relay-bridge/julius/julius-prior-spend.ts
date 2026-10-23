/**
 * PRIOR RUNS OF THIS MISSION, FROM THIS JOB'S DATABASE.
 *
 * A query that throws is unreadable. Rows that come back are this database's
 * rows only. They are not the durable cross-job record, so every successful
 * read is marked `durableRecord: 'ABSENT'`.
 *
 * TODO(single-spend): replace this read, for qualifying-pair authorization,
 * with the `julius-run-spent-<id>` tag and ledger. Until that lands, an empty
 * result is absent prior-spend, not a verified zero.
 */

import {
  summarizeJuliusPriorRunSpend,
  type JuliusSettlementFact,
  type JuliusSpendLedgerRead,
} from '../../src/relay/mission/julius/julius-spend-ceiling';

export interface SqlQueryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Every other run of this mission in this project, with its `budget.settled`
 * facts folded by {@link summarizeJuliusPriorRunSpend}. The run about to be
 * created is not in the table yet; pass `excludeRunId` when one already is.
 */
export async function readJuliusPriorRunSpend(
  pool: SqlQueryable,
  input: { readonly missionId: string; readonly projectId: string; readonly excludeRunId?: string },
): Promise<JuliusSpendLedgerRead> {
  try {
    const runs = await pool.query<{ run_id: string }>(
      `SELECT run_id FROM relay_wonderland.julius_runs
        WHERE mission_id=$1 AND project_id=$2 AND run_id <> $3
        ORDER BY created_at, run_id`,
      [input.missionId, input.projectId, input.excludeRunId ?? ''],
    );
    const runIds = runs.rows.map((row) => row.run_id).filter((id) => typeof id === 'string' && id !== '');
    if (runIds.length === 0) return { readable: true, priorRuns: [], durableRecord: 'ABSENT' };
    const settled = await pool.query<{ run_id: string; task_id: string | null; facts: unknown }>(
      `SELECT stream_id AS run_id, payload->>'taskId' AS task_id, payload->'facts' AS facts
         FROM relay_wonderland.events
        WHERE project_id=$1 AND event_type='julius.budget.settled' AND stream_id = ANY($2::text[])
        ORDER BY stream_id, sequence`,
      [input.projectId, runIds],
    );
    const byRun = new Map<string, JuliusSettlementFact[]>();
    for (const runId of runIds) byRun.set(runId, []);
    for (const row of settled.rows) {
      const facts = asRecord(row.facts);
      const list = byRun.get(row.run_id);
      if (list === undefined) continue;
      list.push({
        taskId: typeof row.task_id === 'string' && row.task_id !== '' ? row.task_id : row.run_id,
        role: typeof facts.role === 'string' ? facts.role : null,
        basis: facts.costBasis,
        usdMicros: facts.usdMicros,
        estimatedUsdMicros: facts.estimatedUsdMicros,
        billingPath: facts.billingPath,
      });
    }
    const priorRuns = runIds.map((runId) => summarizeJuliusPriorRunSpend(runId, byRun.get(runId) ?? []));
    return { readable: true, priorRuns, durableRecord: 'ABSENT' };
  } catch {
    return { readable: false };
  }
}
