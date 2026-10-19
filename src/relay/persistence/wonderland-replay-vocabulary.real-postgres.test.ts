import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WONDERLAND_EVENT_SCHEMA_VERSION, WONDERLAND_EVENT_TYPES, type WonderlandEvent } from '../mission/wonderland/wonderland-backend';
import { JuliusEventPostgresRepository } from './julius-event-postgres';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';

/**
 * THE WONDERLAND REPLAY AND THE JULIUS LEDGER SHARE ONE TABLE, ON REAL POSTGRESQL.
 *
 * `relay_wonderland.events` is written by two writers. `appendEvent` (wonderland-postgres.ts) stores a whole
 * WonderlandEvent; `julius-event-postgres.ts` stores `event_type = 'julius.…'` with a payload of an entirely different
 * shape — `{schemaVersion:'relay-julius-event.v1', …}`, no eventId, no eventType, no sequence. replay() selected by project
 * alone, so a Julius ledger row reached a browser (relay-bridge/wonderland-realtime.ts) as a malformed WonderlandEvent.
 * The fix filters replay() to the CLOSED vocabulary, WONDERLAND_EVENT_TYPES (first proven on 50b439d9, 2026-09-10, on a
 * branch that never reached main; re-landed here against main 42e8c06b).
 *
 * ONE PROJECT, THREE WRITERS, each through its own path:
 *   - this writer, through `appendEvent` itself, as `subagent.spawned` — BARE;
 *   - the Julius ledger, through `JuliusEventPostgresRepository.append`, as `julius.subagent.spawned` — the same name
 *     PREFIXED: the two vocabularies overlap, so only an exact match tells them apart;
 *   - a third shape in neither vocabulary (`battle.round.resolved`, payload `{"round":1}`), which is what proves the
 *     filter refuses every writer that is not this one rather than merely Julius.
 * replay() must hand back the first and nothing else.
 *
 * TWO MUTATIONS, each run through the real replay() with its statement rewritten on the way to PostgreSQL (and the
 * rewrite counted, so a mutation that no longer applies fails rather than silently testing the fixed code):
 *   - the filter removed — the defect at 42e8c06b: the Julius row reaches the browser;
 *   - the weaker `NOT LIKE 'julius.%'`: Julius is refused, and the third writer is not.
 *
 * Its OWN database, created from JULIUS_TEST_DATABASE_URL and dropped after (every pool ended first); `todo` where no
 * throwaway database is stated. No provider is involved.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;

/** The fragment the fix added. A mutation rewrites exactly this, and refuses when it is no longer there. */
const FILTER = ' AND event_type = ANY($4)';
const REPLAY_STATEMENT = 'SELECT payload FROM relay_wonderland.events';

/** What replay() handed back that is NOT one of this writer's events; [] when a browser would get only its own. */
const strangers = (replayed: readonly unknown[]): Array<Record<string, unknown>> =>
  (replayed as Array<Record<string, unknown>>).filter((event) => typeof event.eventId !== 'string'
    || event.schemaVersion !== WONDERLAND_EVENT_SCHEMA_VERSION
    || !(WONDERLAND_EVENT_TYPES as readonly unknown[]).includes(event.eventType));

suite('replay() on real PostgreSQL hands a browser only the Wonderland writer\'s own rows', () => {
  const nonce = randomBytes(5).toString('hex');
  const database = `wonderland_replay_vocab_${nonce}`;
  const project = `prj-replay-${nonce}`;
  const mission = `mission-replay-${nonce}`;
  const run = `run:replay-${nonce}`;
  const AT = '2026-10-13T00:00:00.000Z';
  let admin: Pool;
  let pool: Pool;
  let world: WonderlandEvent;

  const urlOf = (): string => {
    const url = new URL(databaseUrl!);
    url.pathname = `/${database}`;
    return url.toString();
  };

  /**
   * The REAL replay(), over a pool whose clients rewrite its one statement: FILTER becomes `replacement` and the vocabulary
   * parameter is dropped with it. Every other statement (the transaction around it) passes through untouched. Clients are
   * borrowed from `pool` and released to it, so ending `pool` ends them.
   */
  const mutated = (replacement: string): { replay: () => Promise<WonderlandEvent[]>; rewrites: () => number } => {
    let rewrites = 0;
    const rewriting = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (text: string, values?: readonly unknown[]) => {
            if (!text.startsWith(REPLAY_STATEMENT)) return client.query(text, values as unknown[] | undefined);
            if (!text.includes(FILTER)) throw new Error(`mutation_target_missing: the replay statement no longer carries "${FILTER.trim()}"`);
            rewrites += 1;
            return client.query(text.replace(FILTER, replacement), (values ?? []).slice(0, 3) as unknown[]);
          },
          release: () => client.release(),
        };
      },
    };
    const db = new TransactionalWonderlandDatabase(rewriting as unknown as Pool);
    return { replay: () => db.replayEvents(project, 0, 1000), rewrites: () => rewrites };
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl!, max: 1 });
    await admin.query(`CREATE DATABASE ${database}`);
    pool = new Pool({ connectionString: urlOf(), max: 4 });
    const wonderland = new TransactionalWonderlandDatabase(pool);
    await wonderland.migrate();
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1)', [project]);
    await pool.query(
      "INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,'{}'::jsonb)",
      [mission, project, `replay:${nonce}`],
    );
    await pool.query(
      "INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision) VALUES($1,$2,$3,'EXECUTING','replay','card',1,0)",
      [run, mission, project],
    );

    // 1. THIS WRITER, through appendEvent: it allocates the stream's sequence and stores the whole event.
    world = await wonderland.transaction((transaction) => transaction.appendEvent({
      eventId: `world-${nonce}`, schemaVersion: WONDERLAND_EVENT_SCHEMA_VERSION, timestamp: AT, projectId: project,
      sessionId: null, playerId: null, agentId: null, missionId: null, battleId: null,
      eventType: 'subagent.spawned', payload: { subagentId: 'sub-1', role: 'coder' }, visibility: 'PARTICIPANTS',
      correlationId: `world-${nonce}`, causationId: null,
    }, `world-${nonce}`));

    // 2. THE JULIUS LEDGER, through its own writer: the same project and table, `julius.subagent.spawned`.
    await new JuliusEventPostgresRepository(pool).append({
      eventId: `julius-${nonce}`, runId: run, projectId: project, type: 'subagent.spawned', taskId: 'task-1', workerId: null,
      correlationId: `corr-${nonce}`, causationId: null, occurredAt: AT, facts: { subagentId: 'sub-1' },
    });

    // 3. A THIRD SHAPE, in neither vocabulary, on a stream of its own.
    await pool.query(
      `INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at)
       VALUES($1,$2,$3,1,'battle.round.resolved','PROJECT','{"round":1}'::jsonb,$4)`,
      [`third-${nonce}`, `third-${nonce}`, project, AT],
    );
  }, 120_000);

  afterAll(async () => {
    // pool.end() resolves before its idle clients have closed, so the terminate below can reach a client that is still
    // closing, and pg-pool re-emits that 57P01 as the pool's 'error' (julius-plan-pin's teardown, CI 2026-10-03). The
    // terminate is this suite's own teardown, so its echo is expected here and nowhere else.
    pool?.on('error', () => undefined);
    await pool?.end().catch(() => undefined);
    if (admin !== undefined) {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [database]).catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${database}`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  }, 60_000);

  it('the fixture is real: the project\'s rows come from all three writers, each in its own shape', async () => {
    const rows = await pool.query<{ event_type: string; schema: string | null; event_id_in_payload: boolean }>(
      `SELECT event_type, payload->>'schemaVersion' AS schema, payload ? 'eventId' AS event_id_in_payload
         FROM relay_wonderland.events WHERE project_id=$1 ORDER BY event_type COLLATE "C"`,
      [project],
    );
    expect(rows.rows).toEqual([
      { event_type: 'battle.round.resolved', schema: null, event_id_in_payload: false },
      { event_type: 'julius.subagent.spawned', schema: 'relay-julius-event.v1', event_id_in_payload: false },
      { event_type: 'subagent.spawned', schema: WONDERLAND_EVENT_SCHEMA_VERSION, event_id_in_payload: true },
    ]);
  });

  it('replay() hands back the Wonderland event and nothing else — not the Julius row, not the third shape', async () => {
    const replayed = await new TransactionalWonderlandDatabase(pool).replayEvents(project, 0, 1000);
    expect(strangers(replayed), 'a row that is not a WonderlandEvent reached a browser').toEqual([]);
    expect(replayed).toEqual([world]);
  });

  it('MUTATION, the filter removed (the defect at 42e8c06b): the Julius ledger row reaches a browser with no id', async () => {
    const mutation = mutated('');
    const replayed = await mutation.replay();
    expect(mutation.rewrites(), 'the mutation reached the replay statement').toBe(1);
    const caught = strangers(replayed);
    expect(caught.map((event) => event.schemaVersion ?? null).sort(), 'both foreign rows got through').toEqual([null, 'relay-julius-event.v1']);
    expect(caught.find((event) => event.schemaVersion === 'relay-julius-event.v1')?.eventId, 'the Julius row carries no WonderlandEvent id').toBeUndefined();
  });

  it('MUTATION, the weaker `NOT LIKE \'julius.%\'`: Julius is refused, and the third writer is not', async () => {
    const mutation = mutated(" AND event_type NOT LIKE 'julius.%'");
    const replayed = await mutation.replay();
    expect(mutation.rewrites(), 'the mutation reached the replay statement').toBe(1);
    expect(strangers(replayed), 'the prefix lets every writer but Julius through').toEqual([{ round: 1 }]);
  });
});
