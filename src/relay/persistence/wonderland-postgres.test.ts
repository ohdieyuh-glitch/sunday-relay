import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { TransactionalWonderlandDatabase, migrationVersion, WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_001, WONDERLAND_MIGRATION_003, WONDERLAND_MIGRATION_004, WONDERLAND_MIGRATION_005, WONDERLAND_MIGRATION_006, WONDERLAND_MIGRATION_007, WONDERLAND_MIGRATION_008, WONDERLAND_MIGRATION_009, WONDERLAND_MIGRATION_010, WONDERLAND_MIGRATION_011, WONDERLAND_MIGRATION_012, WONDERLAND_MIGRATION_013, WONDERLAND_MIGRATION_014, WONDERLAND_MIGRATION_015, WONDERLAND_MIGRATION_016, WONDERLAND_MIGRATION_017, WONDERLAND_MIGRATION_018 } from './wonderland-postgres';
import type { WonderlandExecutionSession } from '../mission/wonderland/wonderland-execution';
import { WONDERLAND_EVENT_TYPES } from '../mission/wonderland/wonderland-backend';

class FakePool {
  commands: string[] = []; released = 0; ended = false; rows: unknown[] = []; topRows: unknown[] = [];
  /** Bound parameters, so a test can assert what was actually stored and not
   *  only which statement ran. */
  values: unknown[][] = [];
  async query(text: string, values?: readonly unknown[]) {
    this.commands.push(text); if (values) this.values.push([...values]);
    // the protected-store check's identity reads, answered as an ORDINARY database does (protected-store.ts throws on a nameless one)
    if (text === 'SELECT current_database() AS db') return { rows: [{ db: 'wonderland_test' }], rowCount: 1 };
    if (text.includes('pg_control_system()')) return { rows: [{ sid: '7000000000000000001' }], rowCount: 1 };
    if (text.includes('shobj_description')) return { rows: [{ c: null }], rowCount: 1 };
    return { rows: this.topRows, rowCount: text.startsWith('UPDATE') ? 1 : this.topRows.length };
  }
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
  it('defines auditable provider operations with request and local idempotency uniqueness',()=>{expect(WONDERLAND_MIGRATION_007).toContain('relay_wonderland.provider_operations');expect(WONDERLAND_MIGRATION_007).toContain('UNIQUE(execution_id,idempotency_key)');expect(WONDERLAND_MIGRATION_007).toContain('UNIQUE(provider,provider_request_id)');});
  it('defines lease-safe swarm runs and workers with recovery indexes',()=>{expect(WONDERLAND_MIGRATION_008).toContain('relay_wonderland.swarm_runs');expect(WONDERLAND_MIGRATION_008).toContain('relay_wonderland.swarm_workers');expect(WONDERLAND_MIGRATION_008).toContain('lease_generation');expect(WONDERLAND_MIGRATION_008).toContain('wonderland_swarm_worker_claim');});
  it('defines versioned GVE runs and forbids ineligible status scoring',()=>{expect(WONDERLAND_MIGRATION_009).toContain('relay_wonderland.gve_runs');expect(WONDERLAND_MIGRATION_009).toContain("NOT score_eligible OR status IN('PASSED','FAILED')");expect(WONDERLAND_MIGRATION_009).toContain('wonderland_gve_recovery');});
  it('persists only hidden-fixture metadata and an opaque server locator',()=>{expect(WONDERLAND_MIGRATION_010).toContain('relay_wonderland.hidden_test_fixtures');expect(WONDERLAND_MIGRATION_010).toContain('server_locator');expect(WONDERLAND_MIGRATION_010).not.toContain('fixture_body');});
  it('defines durable Julius runs, DAGs, leases, evidence, decisions and context metadata',()=>{for(const table of ['julius_runs','julius_tasks','julius_task_dependencies','julius_transitions','julius_evidence','julius_verification_decisions','julius_context_snapshots'])expect(WONDERLAND_MIGRATION_011).toContain(`relay_wonderland.${table}`);expect(WONDERLAND_MIGRATION_011).toContain('julius_task_claim');expect(WONDERLAND_MIGRATION_011).toContain("CHECK((state='ACTIVE')=(lease_owner IS NOT NULL))");expect(WONDERLAND_MIGRATION_011).toContain('UNIQUE(run_id,idempotency_key)');});
  it('defines replay-safe worker results and bounded repair provenance',()=>{expect(WONDERLAND_MIGRATION_012).toContain('julius_worker_results');expect(WONDERLAND_MIGRATION_012).toContain('UNIQUE(task_id,lease_generation)');expect(WONDERLAND_MIGRATION_012).toContain('julius_repair_cycles');expect(WONDERLAND_MIGRATION_012).toContain('UNIQUE(original_task_id,round)');});
  it('defines evidence-backed acceptance criteria and reviewer findings',()=>{expect(WONDERLAND_MIGRATION_013).toContain('julius_acceptance_criteria');expect(WONDERLAND_MIGRATION_013).toContain('julius_criterion_evidence');expect(WONDERLAND_MIGRATION_013).toContain('julius_reviewer_findings');expect(WONDERLAND_MIGRATION_013).toContain('jsonb_array_length(evidence_ids)>0');});
  it('extends reproducible context metadata and typed Project Brain provenance',()=>{expect(WONDERLAND_MIGRATION_014).toContain('dependency_task_ids');expect(WONDERLAND_MIGRATION_014).toContain('redaction_count');expect(WONDERLAND_MIGRATION_014).toContain('julius_brain_entries');expect(WONDERLAND_MIGRATION_014).toContain('UNIQUE(run_id,revision)');});
  it('stores versioned trajectory facts with idempotency and eval indexes',()=>{expect(WONDERLAND_MIGRATION_015).toContain('julius_trajectory_events');expect(WONDERLAND_MIGRATION_015).toContain('UNIQUE(run_id,idempotency_key)');expect(WONDERLAND_MIGRATION_015).toContain('julius_trajectory_eval');});
  it('defines durable sub-agent grants with depth, narrowed permissions and per-parent counting',()=>{expect(WONDERLAND_MIGRATION_016).toContain('julius_subagents');expect(WONDERLAND_MIGRATION_016).toContain('CHECK(depth>0)');expect(WONDERLAND_MIGRATION_016).toContain('child_task_id text NOT NULL UNIQUE');expect(WONDERLAND_MIGRATION_016).toContain('julius_subagent_parent');});
  it('persists the GAUNTLET COMMAND outside the Julius namespace, with its activator',()=>{expect(WONDERLAND_MIGRATION_017).toContain('relay_wonderland.gauntlet_runs');expect(WONDERLAND_MIGRATION_017).not.toContain('relay_wonderland.julius_gauntlet');expect(WONDERLAND_MIGRATION_017).toContain('activated_by');expect(WONDERLAND_MIGRATION_017).toContain('UNIQUE(run_id,subject_task_id)');expect(WONDERLAND_MIGRATION_017).toContain('PRIMARY KEY(gauntlet_id,round,phase)');});
  it('persists approvals with one pending request per gated operation',()=>{expect(WONDERLAND_MIGRATION_018).toContain('julius_approvals');expect(WONDERLAND_MIGRATION_018).toContain('julius_approval_one_pending');expect(WONDERLAND_MIGRATION_018).toContain("WHERE state='PENDING'");expect(WONDERLAND_MIGRATION_018).toContain('lifecycle_actor');});
  it('applies every checked-in migration to an empty database, in order', async () => {
    const pool = new FakePool(); const db = database(pool); await db.migrate();
    // the protected-store check (protected-store.ts, the founder's 035 guard) only READS the database's identity
    const identityRead = /shobj_description|SELECT current_database\(\) AS db|pg_control_system\(\)/u;
    expect(pool.commands.filter((command) => !command.includes('information_schema.tables') && !identityRead.test(command))).toEqual([...WONDERLAND_MIGRATIONS]);
    // ... and it reads BEFORE anything runs: its three reads all precede the first migration
    const first = pool.commands.indexOf(WONDERLAND_MIGRATIONS[0]);
    expect(pool.commands.slice(0, first).filter((command) => identityRead.test(command))).toHaveLength(3);
  });

  /**
   * A MIGRATED DATABASE MUST NOT BE REPLAYED, AND A PARTLY MIGRATED ONE MUST BE
   * FINISHED.
   *
   * The migrations use bare `CREATE TABLE`, so a blind replay dies with 42P07 —
   * which is why three entrypoints guarded `migrate()` with a sentinel column
   * from whichever migration was last when the guard was written. Adding 022
   * made that sentinel answer "already migrated" for a database at 021, so the
   * new column was never created. `schema_migrations` is the authority now.
   */
  it('applies only what schema_migrations does not already hold', async () => {
    const versions = WONDERLAND_MIGRATIONS.map((sql) => migrationVersion(sql));
    expect(versions.every((version) => version !== null), 'every migration stamps its own version').toBe(true);

    const current = new FakePool();
    current.topRows = versions.map((version) => ({ version }));
    await database(current).migrate();
    expect(current.commands.filter((command) => command.startsWith('BEGIN;')), 'nothing is replayed').toEqual([]);

    const atPrevious = new FakePool();
    atPrevious.topRows = versions.slice(0, -1).map((version) => ({ version }));
    await database(atPrevious).migrate();
    expect(atPrevious.commands.filter((command) => command.startsWith('BEGIN;')), 'only the missing one runs')
      .toEqual([WONDERLAND_MIGRATIONS.at(-1)]);
  });
});

describe('the outbox never stores a secret in its error', () => {
  it('redacts a credential-shaped value out of a dead-letter error', async () => {
    // A poison event's `last_error` is the one place a provider's own error
    // string is persisted verbatim, and a provider error can quote the request
    // that failed. `validateJuliusEvent` guards the PAYLOAD and guarded
    // nothing here.
    const pool = new FakePool();
    await database(pool).failOutbox('w1', 'ob-1', 'dispatch failed: Authorization: Bearer sk-abcdefghijklmnopqrst', '2026-08-27T00:00:00.000Z');
    const stored = JSON.stringify(pool.values);
    expect(stored).not.toContain('sk-abcdefghijklmnopqrst');
  });
});

describe('TransactionalWonderlandDatabase', () => {
  it('commits a successful serializable transaction and releases its client', async () => { const pool = new FakePool(); const result = await database(pool).transaction(async () => 'ok'); expect(result).toBe('ok'); expect(pool.commands).toEqual(['BEGIN ISOLATION LEVEL SERIALIZABLE','COMMIT']); expect(pool.released).toBe(1); });
  it('rolls back every failed transaction and exposes none of its effects', async () => { const pool = new FakePool(); await expect(database(pool).transaction(async () => { throw new Error('event append failed'); })).rejects.toThrow('event append failed'); expect(pool.commands).toEqual(['BEGIN ISOLATION LEVEL SERIALIZABLE','ROLLBACK']); expect(pool.released).toBe(1); });
  it('retries serialization conflicts with a new transaction', async () => { const pool = new FakePool(); let attempts = 0; const value = await database(pool).transaction(async () => { attempts += 1; if (attempts === 1) throw Object.assign(new Error('serialization'), { code: '40001' }); return 42; }); expect(value).toBe(42); expect(attempts).toBe(2); expect(pool.commands).toEqual(['BEGIN ISOLATION LEVEL SERIALIZABLE','ROLLBACK','BEGIN ISOLATION LEVEL SERIALIZABLE','COMMIT']); expect(pool.released).toBe(2); });
  it('restores execution snapshots after a new database facade/process', async () => { const pool = new FakePool(); pool.rows = [{ snapshot: JSON.stringify(session) }]; const restored = await database(pool).transaction(tx => tx.loadExecution('exec-1')); expect(restored).toEqual(session); });
  it('persists an authoritative rating snapshot and immutable battle history atomically',async()=>{const pool=new FakePool();const stored=await database(pool).transaction(tx=>tx.persistRating({agentId:'agent',mode:'GOAL',rating:1510,deviation:300,volatility:.06,period:1,battleCount:1,provisional:true,updatedAt:'2026-08-24T00:00:00Z',sourceBattleId:'battle'}));expect(stored).toBe(true);expect(pool.commands.some(command=>command.includes('INSERT INTO relay_wonderland.rating_history'))).toBe(true);expect(pool.commands.some(command=>command.includes('INSERT INTO relay_wonderland.agent_ratings'))).toBe(true);});
  it('closes the underlying production pool', async () => { const pool = new FakePool(); await database(pool).close(); expect(pool.ended).toBe(true); });
});

/**
 * THE REPLAY READS ONLY THIS WRITER'S OWN ROWS. `relay_wonderland.events` is shared with the Julius ledger
 * (`julius-event-postgres.ts`, `event_type = 'julius.…'`, a payload with no eventId/eventType/sequence), and replay()
 * selected by project alone, so a Julius row reached a browser as a malformed WonderlandEvent. It is now filtered to the
 * CLOSED vocabulary, never a `julius.` prefix: the two vocabularies overlap on `subagent.spawned`, and a prefix lets every
 * third writer through. This pins the statement and the list it binds without a database; the behaviour on rows from
 * three writers, with both weaker filters caught, is `wonderland-replay-vocabulary.real-postgres.test.ts`.
 */
describe('replay() binds the closed Wonderland vocabulary', () => {
  /** A client that records every statement and its bound values, as the transaction hands them to PostgreSQL. */
  const recording = () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    const pool = {
      async connect() {
        return {
          async query(text: string, values: readonly unknown[] = []) {
            calls.push({ text, values: [...values] });
            return { rows: text.startsWith('SELECT payload') ? [{ payload: JSON.stringify({ eventId: 'e-1', eventType: 'presence.joined', sequence: 1 }) }] : [], rowCount: 0 };
          },
          release() { /* nothing pooled */ },
        };
      },
    };
    return { calls, database: new TransactionalWonderlandDatabase(pool as unknown as Pool) };
  };
  /** Why a replay statement would hand a browser rows that are not this writer's; [] when it would not. */
  const vocabularyDefects = (text: string, values: readonly unknown[]): string[] => {
    const defects: string[] = [];
    const predicate = /\bAND event_type = ANY\(\$(\d+)\)/u.exec(text);
    if (predicate === null) defects.push('no exact `event_type = ANY($n)` predicate');
    const bound = predicate === null ? undefined : values[Number(predicate[1]) - 1];
    if (predicate !== null && JSON.stringify(bound) !== JSON.stringify([...WONDERLAND_EVENT_TYPES])) defects.push(`the bound list is not WONDERLAND_EVENT_TYPES: ${JSON.stringify(bound)}`);
    if (/\bLIKE\b/iu.test(text)) defects.push('a LIKE pattern, which matches a prefix rather than the list');
    return defects;
  };

  it('filters by `event_type = ANY($4)`, and $4 is exactly [...WONDERLAND_EVENT_TYPES]', async () => {
    const { calls, database: db } = recording();
    const replayed = await db.replayEvents('project-1', 7, 500);
    const selects = calls.filter((call) => call.text.startsWith('SELECT payload FROM relay_wonderland.events'));
    expect(selects, 'one replay statement ran').toHaveLength(1);
    const [select] = selects;
    expect(select.text).toContain(' AND event_type = ANY($4) ');
    expect(select.values).toEqual(['project-1', 7, 500, [...WONDERLAND_EVENT_TYPES]]);
    expect(vocabularyDefects(select.text, select.values)).toEqual([]);
    // THE LIST IS THE BARE ONE: `subagent.spawned` is on it unprefixed, and no `julius.` type is (the overlap is the point)
    const bound = select.values[3] as readonly string[];
    expect(bound).toContain('subagent.spawned');
    expect(bound.filter((type) => type.startsWith('julius.'))).toEqual([]);
    // the transaction around it is unchanged, and the rows still come back parsed
    expect(calls.map((call) => call.text.split(' ')[0])).toEqual(['BEGIN', 'SELECT', 'COMMIT']);
    expect(replayed).toEqual([{ eventId: 'e-1', eventType: 'presence.joined', sequence: 1 }]);
  });

  it('CONTROL: the same check refuses the unfiltered statement (the defect at 42e8c06b), a julius-prefix filter, and a wrong list', () => {
    const BEFORE = 'SELECT payload FROM relay_wonderland.events WHERE project_id=$1 AND sequence>$2 ORDER BY sequence ASC LIMIT $3';
    const PREFIX = "SELECT payload FROM relay_wonderland.events WHERE project_id=$1 AND sequence>$2 AND event_type NOT LIKE 'julius.%' ORDER BY sequence ASC LIMIT $3";
    const RIGHT = 'SELECT payload FROM relay_wonderland.events WHERE project_id=$1 AND sequence>$2 AND event_type = ANY($4) ORDER BY sequence ASC LIMIT $3';
    expect(vocabularyDefects(BEFORE, ['p', 0, 1000])).toEqual(['no exact `event_type = ANY($n)` predicate']);
    expect(vocabularyDefects(PREFIX, ['p', 0, 1000])).toEqual(['no exact `event_type = ANY($n)` predicate', 'a LIKE pattern, which matches a prefix rather than the list']);
    expect(vocabularyDefects(RIGHT, ['p', 0, 1000, [...WONDERLAND_EVENT_TYPES, 'julius.subagent.spawned']])).toHaveLength(1);
    expect(vocabularyDefects(RIGHT, ['p', 0, 1000, WONDERLAND_EVENT_TYPES.slice(1)])).toHaveLength(1);
    // ...and accepts the right one, so the refusals above are the statement's, not a check that refuses everything
    expect(vocabularyDefects(RIGHT, ['p', 0, 1000, [...WONDERLAND_EVENT_TYPES]])).toEqual([]);
  });

  it('still refuses an invalid cursor before any statement runs', async () => {
    const { calls, database: db } = recording();
    await expect(db.replayEvents('project-1', -1, 10)).rejects.toThrow('invalid_replay_cursor');
    expect(calls.filter((call) => call.text.startsWith('SELECT'))).toEqual([]);
  });
});
