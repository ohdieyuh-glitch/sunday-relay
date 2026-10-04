import { existsSync, readFileSync } from 'node:fs';
import { sanitizeText } from './redaction';
import { join } from 'node:path';
import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import type { ProviderUsageReceipt, WonderlandExecutionSession } from '../mission/wonderland/wonderland-execution';
import type { Battle, WonderlandEvent } from '../mission/wonderland/wonderland-backend';
import type { WonderlandRating } from '../mission/wonderland/wonderland-ratings';

const migration = (name: string): string => {
  const candidates = [join(__dirname, 'wonderland-migrations', name), join(process.cwd(), 'src', 'relay', 'persistence', 'wonderland-migrations', name)];
  const path = candidates.find(existsSync);
  return path === undefined ? '' : readFileSync(path, 'utf8');
};
/** Loading is fail-closed but non-eager so unrelated bundled CLI commands still run. */
export const WONDERLAND_MIGRATION_001 = migration('001_wonderland_runtime.sql');
export const WONDERLAND_MIGRATION_002 = migration('002_wonderland_outbox.sql');
export const WONDERLAND_MIGRATION_003 = migration('003_wonderland_budget_reservations.sql');
export const WONDERLAND_MIGRATION_004 = migration('004_wonderland_ratings.sql');
export const WONDERLAND_MIGRATION_005 = migration('005_wonderland_inventory.sql');
export const WONDERLAND_MIGRATION_006 = migration('006_wonderland_eval_runtime.sql');
export const WONDERLAND_MIGRATION_007 = migration('007_wonderland_provider_operations.sql');
export const WONDERLAND_MIGRATION_008 = migration('008_wonderland_swarm_scheduler.sql');
export const WONDERLAND_MIGRATION_009 = migration('009_wonderland_gve_runs.sql');
export const WONDERLAND_MIGRATION_010 = migration('010_wonderland_hidden_fixtures.sql');
export const WONDERLAND_MIGRATION_011 = migration('011_julius_runtime.sql');
export const WONDERLAND_MIGRATION_012 = migration('012_julius_recovery.sql');
export const WONDERLAND_MIGRATION_013 = migration('013_julius_verification.sql');
export const WONDERLAND_MIGRATION_014 = migration('014_julius_context_brain.sql');
export const WONDERLAND_MIGRATION_015 = migration('015_julius_trajectories.sql');
export const WONDERLAND_MIGRATION_016 = migration('016_julius_subagents.sql');
export const WONDERLAND_MIGRATION_017 = migration('017_gauntlet_command.sql');
export const WONDERLAND_MIGRATION_018 = migration('018_julius_lifecycle.sql');
export const WONDERLAND_MIGRATION_019 = migration('019_julius_tools.sql');
export const WONDERLAND_MIGRATION_020 = migration('020_julius_tool_recovery.sql');
export const WONDERLAND_MIGRATION_021 = migration('021_julius_tool_settlement.sql');
export const WONDERLAND_MIGRATION_022 = migration('022_julius_execution_attempts.sql');
export const WONDERLAND_MIGRATION_023 = migration('023_julius_task_contracts.sql');
export const WONDERLAND_MIGRATION_024 = migration('024_julius_work_artifacts.sql');
export const WONDERLAND_MIGRATION_025 = migration('025_julius_context_integrity.sql');
export const WONDERLAND_MIGRATION_026 = migration('026_julius_claim_standings.sql');
// 027 is the integration lane's (`project_execution_profiles`, `player_mission_contracts`);
// reserved by agreement so the two branches cannot collide on a number.
export const WONDERLAND_MIGRATION_028 = migration('028_julius_criteria_per_run.sql');
// The Project Brain's human-authored records, versions, links and mutation log,
// beside Julius's own Brain rows; see `project-brain-postgres.ts`.
export const WONDERLAND_MIGRATION_029 = migration('029_julius_project_brain.sql');
// Row 13 (i): the outbox stops re-reading its event (a foreign-key check is a predicate read under
// SERIALIZABLE); triggers that read no relation keep the guarantee. 030 by agreement with the social
// backend, which takes the next number at its own PR.
export const WONDERLAND_MIGRATION_030 = migration('030_julius_outbox_event_no_reread.sql');
export const WONDERLAND_MIGRATIONS = [WONDERLAND_MIGRATION_001, WONDERLAND_MIGRATION_002, WONDERLAND_MIGRATION_003, WONDERLAND_MIGRATION_004, WONDERLAND_MIGRATION_005, WONDERLAND_MIGRATION_006, WONDERLAND_MIGRATION_007, WONDERLAND_MIGRATION_008, WONDERLAND_MIGRATION_009, WONDERLAND_MIGRATION_010, WONDERLAND_MIGRATION_011, WONDERLAND_MIGRATION_012, WONDERLAND_MIGRATION_013, WONDERLAND_MIGRATION_014, WONDERLAND_MIGRATION_015, WONDERLAND_MIGRATION_016, WONDERLAND_MIGRATION_017, WONDERLAND_MIGRATION_018, WONDERLAND_MIGRATION_019, WONDERLAND_MIGRATION_020, WONDERLAND_MIGRATION_021, WONDERLAND_MIGRATION_022, WONDERLAND_MIGRATION_023, WONDERLAND_MIGRATION_024, WONDERLAND_MIGRATION_025, WONDERLAND_MIGRATION_026, WONDERLAND_MIGRATION_028, WONDERLAND_MIGRATION_029, WONDERLAND_MIGRATION_030] as const;
export interface ClaimedOutbox { outboxId: string; eventId: string; projectId: string; attempts: number; }
export interface BudgetAmounts { inputTokens: number; cachedTokens: number; outputTokens: number; usdMicros: number; toolCalls: number; computeMs: number; runtimeMs: number; swarmWorkers: number; }
export interface BudgetReservation { reservationId: string; executionId: string; state: 'RESERVED' | 'COMMITTED' | 'RELEASED' | 'EXPIRED' | 'DENIED'; requested: BudgetAmounts; committed: BudgetAmounts | null; expiresAt: string; receiptId: string | null; denialReason: string | null; }
export interface DurableEvalRuntime { battleId: string; projectId: string; state: string; representationVersion: string; rebuttalDeadline: string | null; snapshot: unknown; version: number; }
export interface ClaimedSwarmWorker { workerId:string;swarmId:string;role:string;leaseGeneration:number;attempt:number; }
export interface CreateSwarmRun { swarmId:string;battleId:string;parentExecutionId:string;parentAgentId:string;cardVersionId:string;mode:'GOAL'|'EVAL';requestedRoles:readonly string[];authorizedRoles:readonly string[];concurrencyCeiling:number;budget:unknown;activatedAt:string;deadline:string;workers:readonly {workerId:string;role:string}[]; }
export interface SqlQuery { query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: R[]; rowCount: number | null }> }
export interface WonderlandTransaction {
  loadExecution(executionId: string): Promise<WonderlandExecutionSession | null>;
  loadBattleVersion(battleId: string): Promise<number | null>;
  saveExecution(session: WonderlandExecutionSession, expectedVersion: number | null): Promise<void>;
  saveBattle(battle: Battle, expectedVersion: number): Promise<void>;
  saveEntity(input: { kind: 'GOAL_RESULT' | 'GVE_EVIDENCE' | 'CARD_RECOMMENDATION' | 'PROJECT_BRAIN' | 'PROJECT_AVATAR'; recordId: string; projectId: string; battleId: string | null; ownerId: string | null; data: unknown }): Promise<void>;
  grantReward(input: { grantId: string; rewardKey: string; battleId: string; playerId: string; data: unknown }): Promise<boolean>;
  reserveBudget(input: { reservationId: string; executionId: string; workerId?: string; operationKey: string; idempotencyKey: string; requested: BudgetAmounts; expiresAt: string; now: string }): Promise<BudgetReservation>;
  commitBudget(reservationId: string, actual: BudgetAmounts, receiptId: string | null, now: string): Promise<BudgetReservation>;
  releaseBudget(reservationId: string, now: string): Promise<BudgetReservation>;
  persistRating(rating: WonderlandRating): Promise<boolean>;
  loadEvalRuntime(battleId: string): Promise<DurableEvalRuntime | null>;
  saveEvalRuntime(runtime: DurableEvalRuntime, expectedVersion: number | null): Promise<void>;
  recordEvalEffect(input: { battleId: string; kind: 'EVALUATOR_EXECUTION'|'FINDING'|'REBUTTAL'|'ADJUDICATION'|'RESULT'|'RATING'|'STATISTICS'|'RECOMMENDATION'|'REWARD'; effectKey: string; data: unknown }): Promise<boolean>;
  insertProviderReceipt(receipt: ProviderUsageReceipt): Promise<boolean>;
  appendEvent(event: Omit<WonderlandEvent, 'sequence'>, streamId: string): Promise<WonderlandEvent>;
  enqueueEvent(event: WonderlandEvent): Promise<void>;
  replay(projectId: string, afterSequence: number, limit: number): Promise<WonderlandEvent[]>;
  idempotent<T>(scope: string, commandId: string, requestHash: string, effect: () => Promise<T>): Promise<T>;
}

const json = (value: unknown): string => JSON.stringify(value);
const parsed = <T>(value: unknown): T => typeof value === 'string' ? JSON.parse(value) as T : value as T;
const codeOf = (error: unknown): string | undefined => error !== null && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined;
const budgetKeys = ['inputTokens','cachedTokens','outputTokens','usdMicros','toolCalls','computeMs','runtimeMs','swarmWorkers'] as const;
const budgetColumns = ['input_tokens','cached_tokens','output_tokens','usd_micros','tool_calls','compute_ms','runtime_ms','swarm_workers'] as const;
const validAmounts = (amounts: BudgetAmounts): void => { for (const key of budgetKeys) if (!Number.isSafeInteger(amounts[key]) || amounts[key] < 0) throw new Error(`invalid_budget_${key}`); };

class PostgresWonderlandTransaction implements WonderlandTransaction {
  constructor(private readonly client: SqlQuery) {}
  async loadExecution(executionId: string): Promise<WonderlandExecutionSession | null> {
    const result = await this.client.query<{ snapshot: unknown }>('SELECT snapshot FROM relay_wonderland.execution_sessions WHERE execution_id=$1', [executionId]);
    return result.rows[0] ? parsed<WonderlandExecutionSession>(result.rows[0].snapshot) : null;
  }
  async loadBattleVersion(battleId: string): Promise<number | null> {
    const result = await this.client.query<{ version: string }>('SELECT version FROM relay_wonderland.battles WHERE battle_id=$1 FOR UPDATE', [battleId]);
    return result.rows[0] ? Number(result.rows[0].version) : null;
  }
  async saveExecution(session: WonderlandExecutionSession, expectedVersion: number | null): Promise<void> {
    if (expectedVersion === null) {
      await this.client.query(`INSERT INTO relay_wonderland.execution_sessions(execution_id,battle_id,mission_id,project_id,player_id,agent_id,card_version_id,state,workspace_isolation_ref,snapshot,checkpoint,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`, [session.executionId, session.battleId, session.missionId, session.projectId, session.playerId, session.agentId, session.cardSnapshot.cardVersionId, session.state, session.workspaceIsolationRef, json(session), json(session.checkpoint), session.version]);
      return;
    }
    const result = await this.client.query(`UPDATE relay_wonderland.execution_sessions SET state=$2,snapshot=$3::jsonb,checkpoint=$4::jsonb,version=$5,updated_at=now() WHERE execution_id=$1 AND version=$6`, [session.executionId, session.state, json(session), json(session.checkpoint), session.version, expectedVersion]);
    if (result.rowCount !== 1) throw Object.assign(new Error('optimistic_concurrency_conflict'), { code: '40001' });
  }
  async saveBattle(battle: Battle, expectedVersion: number): Promise<void> {
    const result = await this.client.query(`UPDATE relay_wonderland.battles SET state=$2,snapshot=$3::jsonb,result=$4::jsonb,version=version+1,updated_at=now() WHERE battle_id=$1 AND version=$5`, [battle.battleId, battle.state, json(battle), battle.result === null ? null : json(battle.result), expectedVersion]);
    if (result.rowCount !== 1) throw Object.assign(new Error('optimistic_concurrency_conflict'), { code: '40001' });
  }
  async saveEntity(input: { kind: 'GOAL_RESULT' | 'GVE_EVIDENCE' | 'CARD_RECOMMENDATION' | 'PROJECT_BRAIN' | 'PROJECT_AVATAR'; recordId: string; projectId: string; battleId: string | null; ownerId: string | null; data: unknown }): Promise<void> {
    await this.client.query(`INSERT INTO relay_wonderland.entity_records(kind,record_id,project_id,battle_id,owner_id,data) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(kind,record_id) DO UPDATE SET data=EXCLUDED.data,version=relay_wonderland.entity_records.version+1,updated_at=now()`, [input.kind, input.recordId, input.projectId, input.battleId, input.ownerId, json(input.data)]);
  }
  async grantReward(input: { grantId: string; rewardKey: string; battleId: string; playerId: string; data: unknown }): Promise<boolean> {
    const result = await this.client.query(`INSERT INTO relay_wonderland.rewards(grant_id,reward_key,battle_id,player_id,data) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(reward_key) DO NOTHING`, [input.grantId, input.rewardKey, input.battleId, input.playerId, json(input.data)]);
    return result.rowCount === 1;
  }
  async reserveBudget(input: { reservationId: string; executionId: string; workerId?: string; operationKey: string; idempotencyKey: string; requested: BudgetAmounts; expiresAt: string; now: string }): Promise<BudgetReservation> {
    validAmounts(input.requested);
    const locked = await this.client.query<{ snapshot: unknown }>('SELECT snapshot FROM relay_wonderland.execution_sessions WHERE execution_id=$1 FOR UPDATE', [input.executionId]);
    if (!locked.rows[0]) throw new Error('execution_not_found');
    const session = parsed<WonderlandExecutionSession>(locked.rows[0].snapshot);
    const existing = await this.client.query<Record<string, unknown>>('SELECT * FROM relay_wonderland.budget_reservations WHERE execution_id=$1 AND idempotency_key=$2', [input.executionId,input.idempotencyKey]);
    if (existing.rows[0]) return this.mapReservation(existing.rows[0]);
    await this.client.query(`UPDATE relay_wonderland.budget_reservations SET state='EXPIRED',updated_at=$2 WHERE execution_id=$1 AND state='RESERVED' AND expires_at<=$2`, [input.executionId,input.now]);
    const active = await this.client.query<Record<string, string>>(`SELECT ${budgetColumns.map(column => `COALESCE(sum(${column}),0)::text AS ${column}`).join(',')} FROM relay_wonderland.budget_reservations WHERE execution_id=$1 AND state='RESERVED' AND expires_at>$2`, [input.executionId,input.now]);
    const limits: BudgetAmounts = { ...session.budget, swarmWorkers: session.budget.swarmConcurrency };
    const used: BudgetAmounts = { inputTokens:session.usage.inputTokens,cachedTokens:session.usage.cachedTokens,outputTokens:session.usage.outputTokens,usdMicros:session.usage.usdMicros,toolCalls:session.usage.toolCalls,computeMs:session.usage.sandboxComputeMs,runtimeMs:session.usage.durationMs,swarmWorkers:0 };
    const row = active.rows[0] ?? {};
    const exceeded = budgetKeys.find((key,index) => used[key] + Number(row[budgetColumns[index]] ?? 0) + input.requested[key] > limits[key]);
    const state = exceeded ? 'DENIED' : 'RESERVED'; const reason = exceeded ? `${exceeded}_budget_exhausted` : null;
    const values = budgetKeys.map(key => input.requested[key]);
    const inserted = await this.client.query<Record<string, unknown>>(`INSERT INTO relay_wonderland.budget_reservations(reservation_id,execution_id,worker_id,operation_key,idempotency_key,state,${budgetColumns.join(',')},expires_at,denial_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [input.reservationId,input.executionId,input.workerId??null,input.operationKey,input.idempotencyKey,state,...values,input.expiresAt,reason]);
    return this.mapReservation(inserted.rows[0]);
  }
  async commitBudget(reservationId: string, actual: BudgetAmounts, receiptId: string | null, now: string): Promise<BudgetReservation> {
    validAmounts(actual);
    const current = await this.client.query<Record<string, unknown>>('SELECT r.* FROM relay_wonderland.budget_reservations r JOIN relay_wonderland.execution_sessions e ON e.execution_id=r.execution_id WHERE r.reservation_id=$1 FOR UPDATE OF r,e', [reservationId]);
    if (!current.rows[0]) throw new Error('budget_reservation_not_found');
    const reservation = this.mapReservation(current.rows[0]);
    if (reservation.state === 'COMMITTED') { if (receiptId !== reservation.receiptId || JSON.stringify(actual) !== JSON.stringify(reservation.committed)) throw new Error('budget_commit_conflict'); return reservation; }
    if (reservation.state !== 'RESERVED') throw new Error(`budget_reservation_not_committable:${reservation.state}`);
    const updated = await this.client.query<Record<string, unknown>>(`UPDATE relay_wonderland.budget_reservations SET state='COMMITTED',committed_amounts=$4::jsonb,receipt_id=$2,updated_at=$3 WHERE reservation_id=$1 RETURNING *`, [reservationId,receiptId,now,json(actual)]);
    return this.mapReservation(updated.rows[0]);
  }
  async releaseBudget(reservationId: string, now: string): Promise<BudgetReservation> {
    const current = await this.client.query<Record<string, unknown>>('SELECT * FROM relay_wonderland.budget_reservations WHERE reservation_id=$1 FOR UPDATE', [reservationId]);
    if (!current.rows[0]) throw new Error('budget_reservation_not_found');
    const reservation = this.mapReservation(current.rows[0]);
    if (reservation.state === 'RELEASED' || reservation.state === 'EXPIRED') return reservation;
    if (reservation.state !== 'RESERVED') throw new Error(`budget_reservation_not_releasable:${reservation.state}`);
    const updated = await this.client.query<Record<string, unknown>>(`UPDATE relay_wonderland.budget_reservations SET state='RELEASED',updated_at=$2 WHERE reservation_id=$1 RETURNING *`, [reservationId,now]);
    return this.mapReservation(updated.rows[0]);
  }
  async persistRating(rating: WonderlandRating): Promise<boolean> {
    if (rating.sourceBattleId === null) throw new Error('rating_source_battle_required');
    const history = await this.client.query(`INSERT INTO relay_wonderland.rating_history(battle_id,agent_id,mode,snapshot) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`, [rating.sourceBattleId,rating.agentId,rating.mode,json(rating)]);
    if (history.rowCount !== 1) return false;
    await this.client.query(`INSERT INTO relay_wonderland.agent_ratings(agent_id,mode,rating,deviation,volatility,period,battle_count,provisional,source_battle_id,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(agent_id,mode) DO UPDATE SET rating=EXCLUDED.rating,deviation=EXCLUDED.deviation,volatility=EXCLUDED.volatility,period=EXCLUDED.period,battle_count=EXCLUDED.battle_count,provisional=EXCLUDED.provisional,source_battle_id=EXCLUDED.source_battle_id,updated_at=EXCLUDED.updated_at,version=relay_wonderland.agent_ratings.version+1 WHERE relay_wonderland.agent_ratings.period<EXCLUDED.period`, [rating.agentId,rating.mode,rating.rating,rating.deviation,rating.volatility,rating.period,rating.battleCount,rating.provisional,rating.sourceBattleId,rating.updatedAt]);
    return true;
  }
  async loadEvalRuntime(battleId: string): Promise<DurableEvalRuntime | null> {
    const result = await this.client.query<{ battle_id:string;project_id:string;state:string;representation_version:string;rebuttal_deadline:string|null;snapshot:unknown;version:string }>('SELECT battle_id,project_id,state,representation_version,rebuttal_deadline,snapshot,version FROM relay_wonderland.eval_runtimes WHERE battle_id=$1 FOR UPDATE',[battleId]);
    const row=result.rows[0];return row?{battleId:row.battle_id,projectId:row.project_id,state:row.state,representationVersion:row.representation_version,rebuttalDeadline:row.rebuttal_deadline,snapshot:parsed(row.snapshot),version:Number(row.version)}:null;
  }
  async saveEvalRuntime(runtime: DurableEvalRuntime, expectedVersion: number | null): Promise<void> {
    if(expectedVersion===null){await this.client.query('INSERT INTO relay_wonderland.eval_runtimes(battle_id,project_id,state,representation_version,rebuttal_deadline,snapshot,version) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',[runtime.battleId,runtime.projectId,runtime.state,runtime.representationVersion,runtime.rebuttalDeadline,json(runtime.snapshot),runtime.version]);return;}
    const result=await this.client.query('UPDATE relay_wonderland.eval_runtimes SET state=$2,representation_version=$3,rebuttal_deadline=$4,snapshot=$5::jsonb,version=$6,updated_at=now() WHERE battle_id=$1 AND version=$7',[runtime.battleId,runtime.state,runtime.representationVersion,runtime.rebuttalDeadline,json(runtime.snapshot),runtime.version,expectedVersion]);if(result.rowCount!==1)throw Object.assign(new Error('optimistic_concurrency_conflict'),{code:'40001'});
  }
  async recordEvalEffect(input: { battleId:string;kind:'EVALUATOR_EXECUTION'|'FINDING'|'REBUTTAL'|'ADJUDICATION'|'RESULT'|'RATING'|'STATISTICS'|'RECOMMENDATION'|'REWARD';effectKey:string;data:unknown }): Promise<boolean> { const result=await this.client.query('INSERT INTO relay_wonderland.eval_effects(battle_id,effect_kind,effect_key,data) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',[input.battleId,input.kind,input.effectKey,json(input.data)]);return result.rowCount===1; }
  private mapReservation(row: Record<string, unknown>): BudgetReservation {
    const requested = Object.fromEntries(budgetKeys.map((key,index)=>[key,Number(row[budgetColumns[index]] ?? 0)])) as unknown as BudgetAmounts;
    return { reservationId:String(row.reservation_id),executionId:String(row.execution_id),state:String(row.state) as BudgetReservation['state'],requested,committed:row.committed_amounts?parsed<BudgetAmounts>(row.committed_amounts):null,expiresAt:String(row.expires_at),receiptId:row.receipt_id?String(row.receipt_id):null,denialReason:row.denial_reason?String(row.denial_reason):null };
  }
  async insertProviderReceipt(receipt: ProviderUsageReceipt): Promise<boolean> {
    const result = await this.client.query(`INSERT INTO relay_wonderland.provider_receipts(receipt_id,execution_id,provider_request_id,receipt,occurred_at) VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(receipt_id) DO NOTHING`, [receipt.receiptId, receipt.executionId, receipt.receiptId, json(receipt), receipt.occurredAt]);
    return result.rowCount === 1;
  }
  async appendEvent(event: Omit<WonderlandEvent, 'sequence'>, streamId: string): Promise<WonderlandEvent> {
    const allocated = await this.client.query<{ sequence: string }>(`INSERT INTO relay_wonderland.stream_sequences(stream_id,next_sequence) VALUES($1,2) ON CONFLICT(stream_id) DO UPDATE SET next_sequence=relay_wonderland.stream_sequences.next_sequence+1 RETURNING next_sequence-1 AS sequence`, [streamId]);
    const sequence = Number(allocated.rows[0].sequence);
    const complete = { ...event, sequence } as WonderlandEvent;
    await this.client.query(`INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,battle_id,payload,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`, [event.eventId, streamId, event.projectId, sequence, event.eventType, event.visibility, event.battleId, json(complete), event.timestamp]);
    return complete;
  }
  async enqueueEvent(event: WonderlandEvent): Promise<void> {
    await this.client.query(`INSERT INTO relay_wonderland.outbox(outbox_id,event_id,project_id) VALUES($1,$2,$3)`, [`outbox:${event.eventId}`, event.eventId, event.projectId]);
  }
  async replay(projectId: string, afterSequence: number, limit: number): Promise<WonderlandEvent[]> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('invalid_replay_cursor');
    const result = await this.client.query<{ payload: unknown }>(`SELECT payload FROM relay_wonderland.events WHERE project_id=$1 AND sequence>$2 ORDER BY sequence ASC LIMIT $3`, [projectId, afterSequence, limit]);
    return result.rows.map(row => parsed<WonderlandEvent>(row.payload));
  }
  async idempotent<T>(scope: string, commandId: string, requestHash: string, effect: () => Promise<T>): Promise<T> {
    const existing = await this.client.query<{ request_hash: string; response: unknown }>('SELECT request_hash,response FROM relay_wonderland.idempotency WHERE scope=$1 AND command_id=$2 FOR UPDATE', [scope, commandId]);
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) throw new Error('idempotency_payload_conflict');
      return parsed<T>(existing.rows[0].response);
    }
    const value = await effect();
    await this.client.query('INSERT INTO relay_wonderland.idempotency(scope,command_id,request_hash,response) VALUES($1,$2,$3,$4::jsonb)', [scope, commandId, requestHash, json(value)]);
    return value;
  }
}

/**
 * The version a migration stamps into `schema_migrations`, read from the file
 * itself so the two can never disagree. `julius-migration-chain.test.ts`
 * requires every migration to carry exactly this statement with its own
 * filename version.
 */
export function migrationVersion(sql: string): string | null {
  // THE LAST MATCH, ANCHORED TO A STATEMENT. `exec` takes the first occurrence
  // anywhere, including inside a comment — and these files carry long
  // explanatory headers. A header quoting another migration's stamp would
  // return that version, `migrate()` would find it already applied, and the new
  // migration would be skipped SILENTLY on every migrated database: precisely
  // the failure the version ledger replaced, with no test going red. A missing
  // or malformed stamp yields null, which always applies and fails loudly.
  const matches = [...sql.matchAll(/^INSERT INTO relay_wonderland\.schema_migrations\(version\) VALUES\('([^']+)'\)/gmu)];
  return matches.at(-1)?.[1] ?? null;
}

export class TransactionalWonderlandDatabase {
  readonly pool: Pool;
  constructor(config: PoolConfig | Pool) { this.pool = typeof (config as Pool).connect === 'function' ? config as Pool : new Pool(config as PoolConfig); }
  /**
   * APPLY WHAT IS MISSING, NOT EVERYTHING.
   *
   * This replayed the whole array unconditionally, and the migrations use bare
   * `CREATE TABLE`, so a second call against a migrated database died with
   * 42P07. Three entrypoints therefore guarded it with a sentinel — "does
   * `julius_sandboxes.sandbox_policy` exist" — which named the artefact of
   * whichever migration happened to be last when the guard was written.
   *
   * That guard answers a question with only two answers, and the real question
   * has as many answers as there are migrations. Adding one made the sentinel
   * lie in the worst direction: a database at 021 reported "already migrated",
   * so 022 was never applied, `julius_tasks.recoveries` never existed, and the
   * recovery sweep — the only bound on a task that crashes before admission —
   * would have failed with 42703 on every pass. CI could not catch it, because
   * every workflow migrates a container that starts empty.
   *
   * So the version each migration stamps into `schema_migrations` is the
   * authority, which is what that table is for. An unmigrated database has no
   * such table and gets everything; a database at 021 gets 022 alone. The
   * chain test guarantees every migration stamps its own filename version, so
   * the version read here is the one the file writes.
   */
  async migrate(): Promise<void> {
    if (WONDERLAND_MIGRATIONS.some(sql => sql === '')) throw new Error('wonderland_migration_not_packaged');
    const applied = await this.appliedMigrationVersions();
    for (const sql of WONDERLAND_MIGRATIONS) {
      const version = migrationVersion(sql);
      if (version !== null && applied.has(version)) continue;
      await this.pool.query(sql);
    }
  }

  /** Empty when the schema — or the ledger table itself — does not exist yet. */
  async appliedMigrationVersions(): Promise<ReadonlySet<string>> {
    const present = await this.pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='relay_wonderland' AND table_name='schema_migrations'",
    );
    if (present.rowCount === 0) return new Set();
    const rows = await this.pool.query<{ version: string }>('SELECT version FROM relay_wonderland.schema_migrations');
    return new Set(rows.rows.map((row) => String(row.version)));
  }
  async commitCommand<T>(input: { scope: string; commandId: string; requestHash: string; streamId: string; event: Omit<WonderlandEvent, 'sequence'> }, effect: (transaction: WonderlandTransaction) => Promise<T>): Promise<{ response: T; event: WonderlandEvent }> {
    return this.transaction(transaction => transaction.idempotent(input.scope, input.commandId, input.requestHash, async () => {
      const response = await effect(transaction);
      const event = await transaction.appendEvent(input.event, input.streamId);
      await transaction.enqueueEvent(event);
      return { response, event };
    }));
  }
  async replayEvents(projectId: string, afterSequence: number, limit = 1000): Promise<WonderlandEvent[]> {
    return this.transaction(transaction => transaction.replay(projectId, afterSequence, limit));
  }
  async reserveBudget(input: { reservationId: string; executionId: string; workerId?: string; operationKey: string; idempotencyKey: string; requested: BudgetAmounts; expiresAt: string; now: string }): Promise<BudgetReservation> {
    return this.transaction(transaction => transaction.reserveBudget(input));
  }
  async commitBudget(reservationId: string, actual: BudgetAmounts, receiptId: string | null, now: string): Promise<BudgetReservation> {
    return this.transaction(transaction => transaction.commitBudget(reservationId, actual, receiptId, now));
  }
  async releaseBudget(reservationId: string, now: string): Promise<BudgetReservation> {
    return this.transaction(transaction => transaction.releaseBudget(reservationId, now));
  }
  async expireBudgetReservations(now: string, executionId?: string): Promise<number> {
    const result = await this.pool.query(`UPDATE relay_wonderland.budget_reservations SET state='EXPIRED',updated_at=$1 WHERE state='RESERVED' AND expires_at<=$1 AND ($2::text IS NULL OR execution_id=$2)`, [now,executionId??null]);
    return result.rowCount ?? 0;
  }
  async claimSwarmWorkers(workerOwner:string,now:string,leaseExpiresAt:string,limit=10):Promise<ClaimedSwarmWorker[]>{
    if(!workerOwner.trim()||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('invalid_swarm_claim');
    const result=await this.pool.query<{worker_id:string;swarm_id:string;role:string;lease_generation:string;attempt:number}>(`WITH candidates AS (SELECT picked.worker_id FROM relay_wonderland.swarm_runs s CROSS JOIN LATERAL (SELECT w.worker_id FROM relay_wonderland.swarm_workers w WHERE w.swarm_id=s.swarm_id AND (w.state='PENDING' OR (w.state IN('CLAIMED','STARTING','RUNNING') AND w.lease_expires_at<=$2)) ORDER BY w.created_at FOR UPDATE SKIP LOCKED LIMIT GREATEST(0,s.concurrency_ceiling-(SELECT count(*) FROM relay_wonderland.swarm_workers active WHERE active.swarm_id=s.swarm_id AND active.state IN('CLAIMED','STARTING','RUNNING') AND active.lease_expires_at>$2))) picked WHERE s.state IN('PENDING','RUNNING') AND s.deadline>$2 LIMIT $4) UPDATE relay_wonderland.swarm_workers w SET state='CLAIMED',lease_owner=$1,lease_generation=w.lease_generation+1,lease_expires_at=$3,last_heartbeat=$2,attempt=w.attempt+1,updated_at=$2 FROM candidates c WHERE w.worker_id=c.worker_id RETURNING w.worker_id,w.swarm_id,w.role,w.lease_generation,w.attempt`,[workerOwner,now,leaseExpiresAt,limit]);
    return result.rows.map(row=>({workerId:row.worker_id,swarmId:row.swarm_id,role:row.role,leaseGeneration:Number(row.lease_generation),attempt:row.attempt}));
  }
  async createSwarmRun(input:CreateSwarmRun):Promise<boolean>{if(!input.swarmId.trim()||!Number.isSafeInteger(input.concurrencyCeiling)||input.concurrencyCeiling<1||input.workers.length<1||input.workers.some(worker=>!input.authorizedRoles.includes(worker.role)))throw new Error('invalid_swarm_run');const client=await this.pool.connect();try{await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');const inserted=await client.query(`INSERT INTO relay_wonderland.swarm_runs(swarm_id,battle_id,parent_execution_id,parent_agent_id,card_version_id,mode,requested_roles,authorized_roles,concurrency_ceiling,budget,state,activated_at,deadline) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,'PENDING',$11,$12) ON CONFLICT(swarm_id) DO NOTHING`,[input.swarmId,input.battleId,input.parentExecutionId,input.parentAgentId,input.cardVersionId,input.mode,json(input.requestedRoles),json(input.authorizedRoles),input.concurrencyCeiling,json(input.budget),input.activatedAt,input.deadline]);if(inserted.rowCount!==1){await client.query('ROLLBACK');return false;}for(const worker of input.workers)await client.query(`INSERT INTO relay_wonderland.swarm_workers(worker_id,swarm_id,role,state) VALUES($1,$2,$3,'PENDING')`,[worker.workerId,input.swarmId,worker.role]);await client.query('COMMIT');return true;}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}}
  async heartbeatSwarmWorker(input:{workerId:string;workerOwner:string;leaseGeneration:number;now:string;leaseExpiresAt:string;state:'STARTING'|'RUNNING'}):Promise<boolean>{const result=await this.pool.query(`UPDATE relay_wonderland.swarm_workers SET state=$4,last_heartbeat=$5,lease_expires_at=$6,updated_at=$5 WHERE worker_id=$1 AND lease_owner=$2 AND lease_generation=$3 AND state IN('CLAIMED','STARTING','RUNNING')`,[input.workerId,input.workerOwner,input.leaseGeneration,input.state,input.now,input.leaseExpiresAt]);return result.rowCount===1;}
  async completeSwarmWorker(input:{workerId:string;workerOwner:string;leaseGeneration:number;now:string;state:'COMPLETE'|'FAILED'|'CANCELLED'|'TIMED_OUT'|'BUDGET_EXHAUSTED';result?:unknown;evidenceIds?:readonly string[];artifactIds?:readonly string[];safeError?:string}):Promise<boolean>{const result=await this.pool.query(`UPDATE relay_wonderland.swarm_workers SET state=$4,result=$5::jsonb,evidence_ids=$6::jsonb,artifact_ids=$7::jsonb,safe_error=$8,lease_owner=NULL,lease_expires_at=NULL,updated_at=$9 WHERE worker_id=$1 AND lease_owner=$2 AND lease_generation=$3 AND state IN('CLAIMED','STARTING','RUNNING')`,[input.workerId,input.workerOwner,input.leaseGeneration,input.state,json(input.result??null),json(input.evidenceIds??[]),json(input.artifactIds??[]),(input.safeError??null)?.slice(0,500),input.now]);return result.rowCount===1;}
  async claimOutbox(workerId: string, now: string, claimedUntil: string, limit = 100): Promise<ClaimedOutbox[]> {
    if (!workerId.trim() || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('invalid_outbox_claim');
    const result = await this.pool.query<{ outbox_id: string; event_id: string; project_id: string; attempts: number }>(`WITH candidates AS (SELECT outbox_id FROM relay_wonderland.outbox WHERE (status='PENDING' OR (status='CLAIMED' AND claimed_until<$2)) AND next_attempt_at<=$2 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $4) UPDATE relay_wonderland.outbox o SET status='CLAIMED',claimed_by=$1,claimed_until=$3,attempts=o.attempts+1 FROM candidates c WHERE o.outbox_id=c.outbox_id RETURNING o.outbox_id,o.event_id,o.project_id,o.attempts`, [workerId, now, claimedUntil, limit]);
    return result.rows.map(row => ({ outboxId: row.outbox_id, eventId: row.event_id, projectId: row.project_id, attempts: row.attempts }));
  }
  async completeOutbox(workerId: string, outboxId: string, deliveredAt: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE relay_wonderland.outbox SET status='DELIVERED',claimed_by=NULL,claimed_until=NULL,delivered_at=$3 WHERE outbox_id=$1 AND status='CLAIMED' AND claimed_by=$2`, [outboxId, workerId, deliveredAt]);
    return result.rowCount === 1;
  }
  async failOutbox(workerId: string, outboxId: string, error: string, nextAttemptAt: string, maxAttempts = 8): Promise<boolean> {
    const result = await this.pool.query(`UPDATE relay_wonderland.outbox SET status=CASE WHEN attempts>=$5 THEN 'DEAD' ELSE 'PENDING' END,claimed_by=NULL,claimed_until=NULL,last_error=$3,next_attempt_at=$4 WHERE outbox_id=$1 AND status='CLAIMED' AND claimed_by=$2`, [outboxId, workerId, sanitizeText(error, 500), nextAttemptAt, maxAttempts]);
    return result.rowCount === 1;
  }
  async transaction<T>(effect: (transaction: WonderlandTransaction) => Promise<T>, maxAttempts = 3): Promise<T> {
    let attempt = 0;
    while (true) {
      attempt += 1; const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const value = await effect(new PostgresWonderlandTransaction(client));
        await client.query('COMMIT'); return value;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        if ((codeOf(error) === '40001' || codeOf(error) === '40P01') && attempt < maxAttempts) continue;
        throw error;
      } finally { client.release(); }
    }
  }
  async close(): Promise<void> { await this.pool.end(); }
}

export function postgresWonderlandDatabaseFromEnv(env: NodeJS.ProcessEnv): TransactionalWonderlandDatabase | null {
  const connectionString = env.RELAY_WONDERLAND_DATABASE_URL?.trim();
  if (!connectionString) return null;
  return new TransactionalWonderlandDatabase({ connectionString, ssl: env.RELAY_WONDERLAND_DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: true }, max: 10, application_name: 'relay-wonderland' });
}
