import type { Pool } from 'pg';

import type {
  GauntletActivation, GauntletCommandRecord, GauntletPhase, GauntletRoundRecord,
  GauntletState, GauntletStore,
} from '../mission/gauntlet';

/**
 * DURABLE STORAGE FOR THE GAUNTLET LOOP COMMAND.
 *
 * The gauntlet's own tables, outside the Julius namespace. The foreign keys
 * point AT Julius — the gauntlet depends on the work it reviews, which is the
 * allowed direction — and nothing in Julius reads or writes anything here.
 *
 * WHAT MAKES A SECOND `/gauntletloop` A RESUME: `UNIQUE(run_id,
 * subject_task_id)`. A person typing the command twice is ordinary, and the
 * schema is what makes the second one continue the first rather than fork it.
 *
 * WHAT MAKES A DUPLICATE ROUND IMPOSSIBLE: `PRIMARY KEY(gauntlet_id, round,
 * phase)`, together with the deterministic work id the command composes. Two
 * callers that both decide to start round 2 produce one row.
 *
 * A SETTLED ROUND STAYS SETTLED: `completed_at IS NULL` in the WHERE clause of
 * `settleRound`, so a late second callback for one phase is a no-op rather
 * than an overwrite.
 */

const json = (value: unknown) => JSON.stringify(value);
const parsed = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') { try { return JSON.parse(value) as T; } catch { return fallback; } }
  return value as T;
};

export class GauntletPostgresRepository implements GauntletStore {
  constructor(private readonly pool: Pool) {}

  async create(record: GauntletCommandRecord): Promise<{ created: boolean; record: GauntletCommandRecord }> {
    const inserted = await this.pool.query(
      `INSERT INTO relay_wonderland.gauntlet_runs
         (gauntlet_id,run_id,project_id,subject_task_id,activated_by,activated_at,activation,
          state,round,retries,max_rounds,max_retries,max_duration_ms,max_usd_micros,
          used_duration_ms,used_usd_micros,halt_reason,version)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
        WHERE EXISTS(SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$2 AND project_id=$3)
       ON CONFLICT DO NOTHING`,
      [record.gauntletId, record.runId, record.projectId, record.subjectId,
        record.activatedBy, record.activatedAt, record.activation,
        record.state, record.round, record.retries, record.limits.maxRounds, record.limits.maxRetries,
        record.limits.maxDurationMs, record.limits.maxUsdMicros,
        record.usedDurationMs, record.usedUsdMicros, record.haltReason, record.version],
    );
    if (inserted.rowCount === 1) return { created: true, record };
    // `ON CONFLICT DO NOTHING` covers the primary key AND the per-subject
    // uniqueness, so the existing row is found by SUBJECT: a second
    // `/gauntletloop` with a fresh id must still resume the one already active.
    const existing = await this.forSubject(record.runId, record.subjectId);
    return { created: false, record: existing ?? record };
  }

  async load(runId: string, gauntletId: string): Promise<GauntletCommandRecord | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM relay_wonderland.gauntlet_runs WHERE run_id=$1 AND gauntlet_id=$2',
      [runId, gauntletId],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async forSubject(runId: string, subjectId: string): Promise<GauntletCommandRecord | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM relay_wonderland.gauntlet_runs WHERE run_id=$1 AND subject_task_id=$2',
      [runId, subjectId],
    );
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }

  async save(record: GauntletCommandRecord, expectedVersion: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE relay_wonderland.gauntlet_runs
          SET activation=$3,state=$4,round=$5,retries=$6,used_duration_ms=$7,
              used_usd_micros=$8,halt_reason=$9,version=$10,updated_at=now()
        WHERE gauntlet_id=$1 AND version=$2`,
      [record.gauntletId, expectedVersion, record.activation, record.state, record.round,
        record.retries, record.usedDurationMs, record.usedUsdMicros, record.haltReason, record.version],
    );
    return result.rowCount === 1;
  }

  async recordRound(round: GauntletRoundRecord): Promise<{ recorded: boolean; duplicate: boolean }> {
    const result = await this.pool.query(
      `INSERT INTO relay_wonderland.gauntlet_rounds
         (gauntlet_id,round,phase,work_id,outcome,duration_ms,usd_micros,finding_ids,started_at,completed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
       ON CONFLICT(gauntlet_id,round,phase) DO NOTHING`,
      [round.gauntletId, round.round, round.phase, round.workId, round.outcome,
        round.durationMs, round.usdMicros, json(round.findingIds), round.startedAt, round.completedAt],
    );
    const recorded = result.rowCount === 1;
    return { recorded, duplicate: !recorded };
  }

  async settleRound(input: {
    gauntletId: string; round: number; phase: GauntletPhase;
    outcome: NonNullable<GauntletRoundRecord['outcome']>;
    durationMs: number; usdMicros: number; findingIds: readonly string[]; completedAt: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE relay_wonderland.gauntlet_rounds
          SET outcome=$4,duration_ms=$5,usd_micros=$6,finding_ids=$7::jsonb,completed_at=$8
        WHERE gauntlet_id=$1 AND round=$2 AND phase=$3 AND completed_at IS NULL`,
      [input.gauntletId, input.round, input.phase, input.outcome,
        input.durationMs, input.usdMicros, json(input.findingIds), input.completedAt],
    );
    return result.rowCount === 1;
  }

  async roundsFor(gauntletId: string): Promise<readonly GauntletRoundRecord[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      'SELECT * FROM relay_wonderland.gauntlet_rounds WHERE gauntlet_id=$1 ORDER BY round,phase LIMIT 1000',
      [gauntletId],
    );
    return result.rows.map((row) => ({
      gauntletId: String(row.gauntlet_id),
      round: Number(row.round),
      phase: String(row.phase) as GauntletPhase,
      workId: String(row.work_id),
      outcome: row.outcome === null ? null : String(row.outcome) as GauntletRoundRecord['outcome'],
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      usdMicros: row.usd_micros === null ? null : Number(row.usd_micros),
      findingIds: parsed<string[]>(row.finding_ids, []),
      startedAt: new Date(String(row.started_at)).toISOString(),
      completedAt: row.completed_at === null ? null : new Date(String(row.completed_at)).toISOString(),
    }));
  }

  private map(row: Record<string, unknown>): GauntletCommandRecord {
    return {
      gauntletId: String(row.gauntlet_id),
      runId: String(row.run_id),
      projectId: String(row.project_id),
      subjectId: String(row.subject_task_id),
      taskId: String(row.subject_task_id),
      activation: String(row.activation) as GauntletActivation,
      activatedBy: String(row.activated_by),
      activatedAt: new Date(String(row.activated_at)).toISOString(),
      state: String(row.state) as GauntletState,
      round: Number(row.round),
      retries: Number(row.retries),
      limits: {
        maxRounds: Number(row.max_rounds), maxRetries: Number(row.max_retries),
        maxDurationMs: Number(row.max_duration_ms), maxUsdMicros: Number(row.max_usd_micros),
      },
      usedDurationMs: Number(row.used_duration_ms),
      usedUsdMicros: Number(row.used_usd_micros),
      haltReason: row.halt_reason === null ? null : String(row.halt_reason),
      version: Number(row.version),
    };
  }
}
