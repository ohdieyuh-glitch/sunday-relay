import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JuliusEventPostgresRepository } from './julius-event-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import { JULIUS_EVENT_APPEND_CASES, type JuliusEventAppendStore } from './julius-event-append-conformance';
import { JuliusEventIdConflict, type JuliusOperationalEvent } from '../mission/julius';

/**
 * THE SAME EVENT APPEND CONTRACT, ON REAL PostgreSQL.
 *
 * These are the cases the in-memory store runs
 * (`julius-event-append.test.ts`), against the SQL production writes to. The
 * divergence this suite exists for was found by a proof in #279: `jsonb` does
 * not preserve key order, so comparing `JSON.stringify` of a stored payload
 * with the one just built refused genuine replays, while the in-memory store
 * compared the id alone and silently dropped a different event under a used id.
 *
 * Runs wherever JULIUS_REAL_POSTGRES=1 (or JULIUS_REAL_INFRA=1) and DATABASE_URL
 * point at a PostgreSQL — the `first-live-topology` job — and is `todo`
 * elsewhere. No provider is involved.
 */

const enabled = process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1';
const suite = enabled ? describe : describe.todo;

suite('the event append contract on real PostgreSQL', () => {
  const nonce = randomBytes(6).toString('hex');
  const project = `prj-append-${nonce}`;
  const mission = `mission-append-${nonce}`;
  const run = `run:append-${nonce}`;
  let pool: Pool;
  let events: JuliusEventPostgresRepository;

  const store = (prefix: string): { store: JuliusEventAppendStore; event: (over?: Partial<JuliusOperationalEvent>) => JuliusOperationalEvent } => {
    const event = (over: Partial<JuliusOperationalEvent> = {}): JuliusOperationalEvent => ({
      eventId: `${prefix}:event:1`, runId: run, projectId: project, type: 'task.created',
      taskId: 'task-1', workerId: null, correlationId: `corr-${nonce}`, causationId: null,
      occurredAt: '2099-01-01T00:00:00.000Z', facts: { outcome: 'SUCCEEDED' },
      ...over,
      // Every case names its own id; the prefix keeps the cases apart in one database.
      ...(over.eventId === undefined ? {} : { eventId: `${prefix}:${over.eventId}` }),
    });
    const rowsFor = async (eventId: string): Promise<number> => {
      const result = await pool.query('SELECT count(*)::int AS rows FROM relay_wonderland.events WHERE event_id=$1', [`${prefix}:${eventId}`]);
      return (result.rows[0] as { rows: number }).rows;
    };
    return {
      event,
      store: {
        append: async (value) => (await events.append(value)).recorded,
        rowsFor,
        factsFor: async (eventId) => {
          const result = await pool.query('SELECT payload FROM relay_wonderland.events WHERE event_id=$1', [`${prefix}:${eventId}`]);
          const row = result.rows[0] as { payload: unknown } | undefined;
          if (row === undefined) return null;
          const payload = (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) as { facts?: Record<string, unknown> };
          return payload.facts ?? null;
        },
      },
    };
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await new TransactionalWonderlandDatabase(pool).migrate();
    events = new JuliusEventPostgresRepository(pool);
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [project]);
    await pool.query(
      "INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb)",
      [mission, project, `append:${nonce}`],
    );
    await pool.query(
      "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','append','card',1,0)",
      [run, mission, project],
    );
  });

  afterAll(async () => {
    const statements = pool === undefined ? [] : [
      'DELETE FROM relay_wonderland.outbox o USING relay_wonderland.events e WHERE o.event_id=e.event_id AND e.project_id=$1',
      'DELETE FROM relay_wonderland.events WHERE project_id=$1',
      'DELETE FROM relay_wonderland.stream_sequences WHERE stream_id IN (SELECT run_id FROM relay_wonderland.julius_runs WHERE project_id=$1)',
      'DELETE FROM relay_wonderland.julius_runs WHERE project_id=$1',
      'DELETE FROM relay_wonderland.mission_contracts WHERE project_id=$1',
      'DELETE FROM relay_wonderland.projects WHERE project_id=$1',
    ];
    for (const sql of statements) {
      await pool.query(sql, [project]).catch(() => undefined);
    }
    await pool?.end().catch(() => undefined);
  });

  for (const [index, contractCase] of JULIUS_EVENT_APPEND_CASES.entries()) {
    it(contractCase.name, async () => {
      const bound = store(`case-${String(index)}`);
      await expect(contractCase.run(bound.store, bound.event)).resolves.toBeUndefined();
    });
  }

  it('the conflict it raises is the typed one, naming the event', async () => {
    const bound = store('typed');
    await bound.store.append(bound.event({ eventId: 'event:typed', facts: { a: 1 } }));
    const error = await bound.store.append(bound.event({ eventId: 'event:typed', facts: { a: 2 } }))
      .then(() => null, (raised: unknown) => raised);
    expect(error).toBeInstanceOf(JuliusEventIdConflict);
    expect((error as JuliusEventIdConflict).eventId).toBe('typed:event:typed');
  });

  it('a replay through a NEW repository — a restarted process — is still idempotent', async () => {
    const bound = store('restart');
    const row = bound.event({ eventId: 'event:restart' });
    expect(await bound.store.append(row)).toBe(true);
    // A fresh repository over the same rows: nothing of the first write is in memory.
    events = new JuliusEventPostgresRepository(pool);
    expect(await bound.store.append(row), 'the restarted process records nothing twice').toBe(false);
    expect(await bound.store.rowsFor('event:restart')).toBe(1);
  });

  it('the stored payload really has been reordered by jsonb — the divergence was not hypothetical', async () => {
    const bound = store('order');
    await bound.store.append(bound.event({ eventId: 'event:jsonb', facts: { zebra: 1, alpha: 2 } }));
    const result = await pool.query('SELECT payload FROM relay_wonderland.events WHERE event_id=$1', ['order:event:jsonb']);
    const payload = (result.rows[0] as { payload: unknown }).payload;
    const keys = Object.keys((typeof payload === 'string' ? JSON.parse(payload) : payload) as Record<string, unknown>);
    // The writer builds `schemaVersion` first; jsonb hands the keys back in its own order.
    expect(keys[0]).not.toBe('schemaVersion');
  });
});
