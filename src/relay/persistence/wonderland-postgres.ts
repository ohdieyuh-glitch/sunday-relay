import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import type { ProviderUsageReceipt, WonderlandExecutionSession } from '../mission/wonderland/wonderland-execution';
import type { WonderlandEvent } from '../mission/wonderland/wonderland-backend';

export const WONDERLAND_MIGRATION_001 = readFileSync(join(__dirname, 'wonderland-migrations', '001_wonderland_runtime.sql'), 'utf8');
export interface SqlQuery { query<R extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: R[]; rowCount: number | null }> }
export interface WonderlandTransaction {
  loadExecution(executionId: string): Promise<WonderlandExecutionSession | null>;
  saveExecution(session: WonderlandExecutionSession, expectedVersion: number | null): Promise<void>;
  insertProviderReceipt(receipt: ProviderUsageReceipt): Promise<boolean>;
  appendEvent(event: Omit<WonderlandEvent, 'sequence'>, streamId: string): Promise<WonderlandEvent>;
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
  async migrate(): Promise<void> { await this.pool.query(WONDERLAND_MIGRATION_001); }
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
