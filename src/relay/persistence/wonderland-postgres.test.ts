import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { TransactionalWonderlandDatabase, WONDERLAND_MIGRATION_001, WONDERLAND_MIGRATION_002, WONDERLAND_MIGRATION_003, WONDERLAND_MIGRATION_004, WONDERLAND_MIGRATION_005, WONDERLAND_MIGRATION_006 } from './wonderland-postgres';
import type { WonderlandExecutionSession } from '../mission/wonderland/wonderland-execution';

class FakePool {
  commands: string[] = []; released = 0; ended = false; rows: unknown[] = []; topRows: unknown[] = [];
  async query(text: string) { this.commands.push(text); return { rows: this.topRows, rowCount: text.startsWith('UPDATE') ? 1 : this.topRows.length }; }
  async connect() { const pool = this; return { async query(text: string) { pool.commands.push(text); if (text.startsWith('SELECT snapshot')) return { rows: pool.rows, rowCount: pool.rows.length }; if (text.includes('RETURNING next_sequence-1')) return { rows: [{ sequence: '1' }], rowCount: 1 }; return { rows: [], rowCount: text.startsWith('UPDATE') || text.startsWith('INSERT') ? 1 : 0 }; }, release() { pool.released += 1; } }; }
  async end() { this.ended = true; }
}
const database = (pool: FakePool) => new TransactionalWonderlandDatabase(pool as unknown as Pool);
const session = { executionId: 'exec-1', state: 'RUNNING', version: 3 } as WonderlandExecutionSession;

describe('Wonderland PostgreSQL migration', () => {
  it('defines the production records and database-enforced uniqueness/isolation invariants', () => {
    for (const table of ['players','projects','project_members','agents','card_versions','mission_contracts','presence','challenges','battles','battle_participants','execution_sessions','provider_receipts','execution_usage','entity_records','rewards','inventory_grants','artifacts','stream_sequences','events','idempotency']) expect(WONDERLAND_MIGRATION_001).toContain(`relay_wonderland.${table}`);
    expect(WONDERLAND_MIGRATION_001).toContain('PRIMARY KEY(scope,command_id)');
    expect(WONDERLAND_MIGRATION_001).toContain('UNIQUE(stream_id,sequence)');
    expect(WONDERLAND_MIGRATION_001).toContain('UNIQUE(battle_id,side)');
    expect(WONDERLAND_MIGRATION_001).toContain('reward_key text NOT NULL UNIQUE');
    expect(WONDERLAND_MIGRATION_001).toContain('receipt_id text PRIMARY KEY');
    expect(WONDERLAND_MIGRATION_001).toMatch(/BEGIN;[\s\S]*COMMIT;/);
  });
  it('defines a concurrent reservation ledger with durable idempotency and nonnegative dimensions',()=>{expect(WONDERLAND_MIGRATION_003).toContain('relay_wonderland.budget_reservations');expect(WONDERLAND_MIGRATION_003).toContain('UNIQUE(execution_id,idempotency_key)');expect(WONDERLAND_MIGRATION_003).toContain("state IN('RESERVED','COMMITTED','RELEASED','EXPIRED','DENIED')");expect(WONDERLAND_MIGRATION_003).toContain('CHECK(usd_micros>=0)');expect(WONDERLAND_MIGRATION_003).toContain('committed_amounts jsonb');});
  it('enforces separate durable Goal/Eval rating history once per battle and Agent',()=>{expect(WONDERLAND_MIGRATION_004).toContain('relay_wonderland.agent_ratings');expect(WONDERLAND_MIGRATION_004).toContain('relay_wonderland.rating_history');expect(WONDERLAND_MIGRATION_004).toContain('PRIMARY KEY(battle_id,agent_id,mode)');});
  it('defines versioned inventory catalog, equipment, and active unique ownership constraints',()=>{expect(WONDERLAND_MIGRATION_005).toContain('relay_wonderland.inventory_definitions');expect(WONDERLAND_MIGRATION_005).toContain('relay_wonderland.inventory_equipment');expect(WONDERLAND_MIGRATION_005).toContain('wonderland_inventory_unique_active');});
  it('defines durable Eval checkpoints and exactly-once effect linkage',()=>{expect(WONDERLAND_MIGRATION_006).toContain('relay_wonderland.eval_runtimes');expect(WONDERLAND_MIGRATION_006).toContain('relay_wonderland.eval_effects');expect(WONDERLAND_MIGRATION_006).toContain('PRIMARY KEY(battle_id,effect_kind,effect_key)');});
  it('runs every checked-in migration through the configured PostgreSQL pool', async () => { const pool = new FakePool(); const db = database(pool); await db.migrate(); expect(pool.commands).toEqual([WONDERLAND_MIGRATION_001, WONDERLAND_MIGRATION_002, WONDERLAND_MIGRATION_003, WONDERLAND_MIGRATION_004, WONDERLAND_MIGRATION_005, WONDERLAND_MIGRATION_006]); });
});

describe('TransactionalWonderlandDatabase', () => {
  it('commits a successful serializable transaction and releases its client', async () => { const pool = new FakePool(); const result = await database(pool).transaction(async () => 'ok'); expect(result).toBe('ok'); expect(pool.commands).toEqual(['BEGIN ISOLATION LEVEL SERIALIZABLE','COMMIT']); expect(pool.released).toBe(1); });
  it('rolls back every failed transaction and exposes none of its effects', async () => { const pool = new FakePool(); await expect(database(pool).transaction(async () => { throw new Error('event append failed'); })).rejects.toThrow('event append failed'); expect(pool.commands).toEqual(['BEGIN ISOLATION LEVEL SERIALIZABLE','ROLLBACK']); expect(pool.released).toBe(1); });
  it('retries serialization conflicts with a new transaction', async () => { const pool = new FakePool(); let attempts = 0; const value = await database(pool).transaction(async () => { attempts += 1; if (attempts === 1) throw Object.assign(new Error('serialization'), { code: '40001' }); return 42; }); expect(value).toBe(42); expect(attempts).toBe(2); expect(pool.commands).toEqual(['BEGIN ISOLATION LEVEL SERIALIZABLE','ROLLBACK','BEGIN ISOLATION LEVEL SERIALIZABLE','COMMIT']); expect(pool.released).toBe(2); });
  it('restores execution snapshots after a new database facade/process', async () => { const pool = new FakePool(); pool.rows = [{ snapshot: JSON.stringify(session) }]; const restored = await database(pool).transaction(tx => tx.loadExecution('exec-1')); expect(restored).toEqual(session); });
  it('persists an authoritative rating snapshot and immutable battle history atomically',async()=>{const pool=new FakePool();const stored=await database(pool).transaction(tx=>tx.persistRating({agentId:'agent',mode:'GOAL',rating:1510,deviation:300,volatility:.06,period:1,battleCount:1,provisional:true,updatedAt:'2026-08-24T00:00:00Z',sourceBattleId:'battle'}));expect(stored).toBe(true);expect(pool.commands.some(command=>command.includes('INSERT INTO relay_wonderland.rating_history'))).toBe(true);expect(pool.commands.some(command=>command.includes('INSERT INTO relay_wonderland.agent_ratings'))).toBe(true);});
  it('closes the underlying production pool', async () => { const pool = new FakePool(); await database(pool).close(); expect(pool.ended).toBe(true); });
});
