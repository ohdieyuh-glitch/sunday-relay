import type { Pool } from 'pg';

import type {
  GauntletPhase, JuliusGauntletRecord, JuliusGauntletRoundRecord, JuliusGauntletStore,
} from '../mission/julius';
import type { GauntletState } from '../mission/julius';

/**
 * DURABLE GAUNTLETS.
 *
 * #172 modelled a gauntlet as a mutable object. Persisting it is what makes a
 * round survive a restart, makes "two schedulers both start round 2" a primary
 * key violation rather than a race, and gives a cleared gauntlet a record of
 * what cleared it.
 *
 * THE COMPARE-AND-SET IS THE SAME GUARD TWICE. `advanceGauntlet` refuses a
 * stale `expectedVersion` in memory; `saveGauntlet` refuses the same stale
 * version in the `WHERE` clause. Neither is redundant: the first stops a
 * caller computing from stale state, the second stops two callers that both
 * computed from fresh state from both writing.
 */

const json = (value: unknown) => JSON.stringify(value);
const parsed = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') { try { return JSON.parse(value) as T; } catch { return fallback; } }
  return value as T;
};

export class JuliusGauntletPostgresRepository implements JuliusGauntletStore {
  constructor(private readonly pool: Pool) {}

  async createGauntlet(record: JuliusGauntletRecord): Promise<{ created: boolean; record: JuliusGauntletRecord }> {
    const inserted = await this.pool.query(
      `INSERT INTO relay_wonderland.julius_gauntlets
         (gauntlet_id,run_id,project_id,task_id,state,round,retries,max_rounds,max_retries,max_duration_ms,max_usd_micros,used_duration_ms,used_usd_micros,halt_reason,version)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
        WHERE EXISTS(SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$2 AND project_id=$3)
       ON CONFLICT DO NOTHING`,
      [record.gauntletId, record.runId, record.projectId, record.taskId, record.state, record.round,
        record.retries, record.limits.maxRounds, record.limits.maxRetries, record.limits.maxDurationMs,
        record.limits.maxUsdMicros, record.usedDurationMs, record.usedUsdMicros, record.haltReason, record.version],
    );
    if (inserted.rowCount === 1) return { created: true, record };
    // `ON CONFLICT DO NOTHING` covers BOTH uniqueness rules — the primary key
    // and `UNIQUE(run_id, task_id)` — so the existing row is looked up by TASK
    // rather than by id: a second /gauntletloop with a fresh gauntlet id must
    // still find the one already running for that task.
    const existing = await this.gauntletForTask(record.runId, record.taskId);
    return { created: false, record: existing ?? record };
  }

  async loadGauntlet(runId: string, gauntletId: string): Promise<JuliusGauntletRecord | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM relay_wonderland.julius_gauntlets WHERE run_id=$1 AND gauntlet_id=$2',
      [runId, gauntletId],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async gauntletForTask(runId: string, taskId: string): Promise<JuliusGauntletRecord | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM relay_wonderland.julius_gauntlets WHERE run_id=$1 AND task_id=$2',
      [runId, taskId],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async saveGauntlet(record: JuliusGauntletRecord, expectedVersion: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE relay_wonderland.julius_gauntlets
          SET state=$3,round=$4,retries=$5,used_duration_ms=$6,used_usd_micros=$7,halt_reason=$8,version=$9,updated_at=now()
        WHERE gauntlet_id=$1 AND version=$2`,
      [record.gauntletId, expectedVersion, record.state, record.round, record.retries,
        record.usedDurationMs, record.usedUsdMicros, record.haltReason, record.version],
    );
    return result.rowCount === 1;
  }

  async recordRound(round: JuliusGauntletRoundRecord): Promise<{ recorded: boolean; duplicate: boolean }> {
    const result = await this.pool.query(
      `INSERT INTO relay_wonderland.julius_gauntlet_rounds
         (gauntlet_id,round,phase,task_id,outcome,duration_ms,usd_micros,evidence_ids,started_at,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
       ON CONFLICT(gauntlet_id,round,phase) DO NOTHING`,
      [round.gauntletId, round.round, round.phase, round.taskId, round.outcome,
        round.durationMs, round.usdMicros, json(round.evidenceIds), round.startedAt, round.completedAt],
    );
    const recorded = result.rowCount === 1;
    return { recorded, duplicate: !recorded };
  }

  /**
   * A SETTLED ROUND STAYS SETTLED. `completed_at IS NULL` in the WHERE clause
   * is what makes a late second callback for one phase a no-op instead of an
   * overwrite — the same shape as `result_after_cancellation` on the task side.
   */
  async settleRound(input: {
    gauntletId: string; round: number; phase: GauntletPhase;
    outcome: NonNullable<JuliusGauntletRoundRecord['outcome']>;
    durationMs: number; usdMicros: number; evidenceIds: readonly string[]; completedAt: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE relay_wonderland.julius_gauntlet_rounds
          SET outcome=$4,duration_ms=$5,usd_micros=$6,evidence_ids=$7::jsonb,completed_at=$8
        WHERE gauntlet_id=$1 AND round=$2 AND phase=$3 AND completed_at IS NULL`,
      [input.gauntletId, input.round, input.phase, input.outcome,
        input.durationMs, input.usdMicros, json(input.evidenceIds), input.completedAt],
    );
    return result.rowCount === 1;
  }

  async roundsFor(gauntletId: string): Promise<readonly JuliusGauntletRoundRecord[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM relay_wonderland.julius_gauntlet_rounds
        WHERE gauntlet_id=$1 ORDER BY round,phase LIMIT 1000`,
      [gauntletId],
    );
    return result.rows.map((row) => ({
      gauntletId: String(row.gauntlet_id),
      round: Number(row.round),
      phase: String(row.phase) as GauntletPhase,
      taskId: String(row.task_id),
      outcome: row.outcome === null ? null : String(row.outcome) as JuliusGauntletRoundRecord['outcome'],
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      usdMicros: row.usd_micros === null ? null : Number(row.usd_micros),
      evidenceIds: parsed<string[]>(row.evidence_ids, []),
      startedAt: new Date(String(row.started_at)).toISOString(),
      completedAt: row.completed_at === null ? null : new Date(String(row.completed_at)).toISOString(),
    }));
  }

  private map(row: Record<string, unknown>): JuliusGauntletRecord {
    return {
      gauntletId: String(row.gauntlet_id),
      runId: String(row.run_id),
      projectId: String(row.project_id),
      taskId: String(row.task_id),
      state: String(row.state) as GauntletState,
      round: Number(row.round),
      retries: Number(row.retries),
      limits: {
        maxRounds: Number(row.max_rounds),
        maxRetries: Number(row.max_retries),
        maxDurationMs: Number(row.max_duration_ms),
        maxUsdMicros: Number(row.max_usd_micros),
      },
      usedDurationMs: Number(row.used_duration_ms),
      usedUsdMicros: Number(row.used_usd_micros),
      haltReason: row.halt_reason === null ? null : String(row.halt_reason),
      version: Number(row.version),
    };
  }
}
