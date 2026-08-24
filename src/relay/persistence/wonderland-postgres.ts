import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import type { ProviderUsageReceipt, WonderlandExecutionSession } from '../mission/wonderland/wonderland-execution';
import type { WonderlandEvent } from '../mission/wonderland/wonderland-backend';

const migration = (name: string): string => {
  const candidates = [join(__dirname, 'wonderland-migrations', name), join(process.cwd(), 'src', 'relay', 'persistence', 'wonderland-migrations', name)];
  const path = candidates.find(existsSync);
  return path === undefined ? '' : readFileSync(path, 'utf8');
};
/** Loading is fail-closed but non-eager so unrelated bundled CLI commands still run. */
export const WONDERLAND_MIGRATION_001 = migration('001_wonderland_runtime.sql');
export const WONDERLAND_MIGRATION_002 = migration('002_wonderland_outbox.sql');
export const WONDERLAND_MIGRATIONS = [WONDERLAND_MIGRATION_001, WONDERLAND_MIGRATION_002] as const;
export interface ClaimedOutbox { outboxId: string; eventId: string; projectId: string; attempts: number; }
export interface SqlQuery { query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: R[]; rowCount: number | null }> }
export interface WonderlandTransaction {
  loadExecution(executionId: string): Promise<WonderlandExecutionSession | null>;
  saveExecution(session: WonderlandExecutionSession, expectedVersion: number | null): Promise<void>;
  insertProviderReceipt(receipt: ProviderUsageReceipt): Promise<boolean>;
  appendEvent(event: Omit<WonderlandEvent, 'sequence'>, streamId: string): Promise<WonderlandEvent>;
  enqueueEvent(event: WonderlandEvent): Promise<void>;
  replay(projectId: string, afterSequence: number, limit: number): Promise<WonderlandEvent[]>;
  idempotent<T>(scope: string, commandId: string, requestHash: string, effect: () => Promise<T>): Promise<T>;
}

const json = (value: unknown): string => JSON.stringify(value);
const parsed = <T>(value: unknown): T => typeof value === 'string' ? JSON.parse(value) as T : value as T;
const codeOf = (error: unknown): string | undefined => error !== null && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined;

class PostgresWonderlandTransaction implements WonderlandTransaction {
  constructor(private readonly client: SqlQuery) {}
  async loadExecution(executionId: string): Promise<WonderlandExecutionSession | null> {
    const result = await this.client.query<{ snapshot: unknown }>('SELECT snapshot FROM relay_wonderland.execution_sessions WHERE execution_id=$1', [executionId]);
    return result.rows[0] ? parsed<WonderlandExecutionSession>(result.rows[0].snapshot) : null;
  }
  async saveExecution(session: WonderlandExecutionSession, expectedVersion: number | null): Promise<void> {
    if (expectedVersion === null) {
      await this.client.query(`INSERT INTO relay_wonderland.execution_sessions(execution_id,battle_id,mission_id,project_id,player_id,agent_id,card_version_id,state,workspace_isolation_ref,snapshot,checkpoint,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`, [session.executionId, session.battleId, session.missionId, session.projectId, session.playerId, session.agentId, session.cardSnapshot.cardVersionId, session.state, session.workspaceIsolationRef, json(session), json(session.checkpoint), session.version]);
      return;
    }
    const result = await this.client.query(`UPDATE relay_wonderland.execution_sessions SET state=$2,snapshot=$3::jsonb,checkpoint=$4::jsonb,version=$5,updated_at=now() WHERE execution_id=$1 AND version=$6`, [session.executionId, session.state, json(session), json(session.checkpoint), session.version, expectedVersion]);
    if (result.rowCount !== 1) throw Object.assign(new Error('optimistic_concurrency_conflict'), { code: '40001' });
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

export class TransactionalWonderlandDatabase {
  readonly pool: Pool;
  constructor(config: PoolConfig | Pool) { this.pool = typeof (config as Pool).connect === 'function' ? config as Pool : new Pool(config as PoolConfig); }
  async migrate(): Promise<void> {
    if (WONDERLAND_MIGRATIONS.some(sql => sql === '')) throw new Error('wonderland_migration_not_packaged');
    for (const sql of WONDERLAND_MIGRATIONS) await this.pool.query(sql);
  }
  async commitCommand<T>(input: { scope: string; commandId: string; requestHash: string; streamId: string; event: Omit<WonderlandEvent, 'sequence'> }, effect: (transaction: WonderlandTransaction) => Promise<T>): Promise<{ response: T; event: WonderlandEvent }> {
    return this.transaction(transaction => transaction.idempotent(input.scope, input.commandId, input.requestHash, async () => {
      const response = await effect(transaction);
      const event = await transaction.appendEvent(input.event, input.streamId);
      await transaction.enqueueEvent(event);
      return { response, event };
    }));
  }
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
    const result = await this.pool.query(`UPDATE relay_wonderland.outbox SET status=CASE WHEN attempts>=$5 THEN 'DEAD' ELSE 'PENDING' END,claimed_by=NULL,claimed_until=NULL,last_error=$3,next_attempt_at=$4 WHERE outbox_id=$1 AND status='CLAIMED' AND claimed_by=$2`, [outboxId, workerId, error.slice(0, 500), nextAttemptAt, maxAttempts]);
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
