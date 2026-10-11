import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { WonderlandJuliusReaderPostgres } from '../src/relay/persistence/wonderland-julius-reader-postgres';
import { projectJuliusTaskState } from '../src/relay/mission/wonderland/wonderland-julius-task-state';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';
import {
  WONDERLAND_JULIUS_READ_ONLY_BEGIN,
  createWonderlandJuliusWorldPool,
  withWonderlandJuliusReadOnlyTransaction,
  wonderlandJuliusWorld,
} from './wonderland-julius-world';

/**
 * A MISSION JULIUS CREATES IS VISIBLE TO THE WORLD'S OWN READER.
 *
 * The integration drill (npm run wonderland:julius:e2e) proves create -> read ->
 * Mission Contract through JULIUS'S operator routes. It cannot prove the world's
 * leg, because /wonderland/julius/* authenticates a PLAYER: an origin-bound
 * session carrying a participantId, which today only GitHub sign-in in a browser
 * can mint. There is no native identity path for an Unreal client yet, and that
 * is a product decision, not something a test should invent.
 *
 * But underneath the auth there is a DATA question that decides whether the seam
 * can work at all: does the world's reader read the rows Julius's create path
 * writes? If it did not, no session would ever make a created mission appear in
 * the world. This answers it, with no auth in the way and no spend:
 *
 *   Julius creates the run   the same composition the POST route uses
 *   the world hydrates it    WonderlandJuliusReaderPostgres, the class behind
 *                            GET /wonderland/julius/hydrate
 *   the Mission Contract     projectJuliusTaskState on what the WORLD read
 *
 * Gated like every real-PostgreSQL suite in the repository: JULIUS_TEST_DATABASE_URL,
 * which must name a throwaway database, and nothing else -- never DATABASE_URL,
 * which on the development laptop points at the persistent Julius store. Without
 * it the suite is `todo`: a proof not taken, never a pass. As a second guard it
 * still refuses anything that looks like the live `julius` database outright.
 */

const url = juliusTestDatabaseUrl();
const enabled = url !== null;

if (enabled) {
  const parsed = new URL(url as string);
  if (parsed.port === '5432' || parsed.pathname === '/julius') {
    throw new Error('refusing to run against what looks like the live julius database');
  }
}

const suite = enabled ? describe : describe.todo;

suite('a mission Julius creates is visible to the WORLD reader', () => {
  let pool: Pool;
  const nonce = randomBytes(6).toString('hex');
  const contract = {
    missionId: `mission:world-observe-${nonce}`,
    markerNamespace: `world-observe-${nonce}`,
    projectId: `prj-world-observe-${nonce}`,
    tenantId: `tenant-world-observe-${nonce}`,
    objective: `Integration probe ${nonce}: created by Julius, hydrated by the world. Never driven.`,
    requirements: ['Exists only to prove the world reader sees what Julius creates.'],
    constraints: ['Never dispatch.'],
    acceptanceCriteria: [{ id: 'criterion-visible', text: 'The world reader hydrates this run.', blocking: true }],
    testCommand: '',
    workspacePath: `/tmp/world-observe-${nonce}/ws`,
    limits: { spendUsd: 1, repairCycles: 0 },
  };
  let runId = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: url as string });
    await new TransactionalWonderlandDatabase(pool).migrate();
    const created = await handleJuliusMissionRoute(
      { method: 'POST', path: '/julius/missions', operator: true, body: JSON.stringify(contract) },
      {
        bootstrap: composeJuliusMissionBootstrap(pool),
        missingConfig: [],
        reviewerProvider: 'hermes_local',
        cardRevision: 'card:julius-live:1',
      },
    );
    expect(created?.status, JSON.stringify(created?.body)).toBe(201);
    runId = (created?.body as { data: { runId: string } }).data.runId;
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('the world reader hydrates the run Julius created, from the same store', async () => {
    const hydration = await new WonderlandJuliusReaderPostgres(pool).hydrate({
      projectId: contract.projectId,
      runId,
      worldSessionId: null,
    });
    expect(hydration, 'the world reader could not see a run Julius just created').not.toBeNull();
    expect(hydration?.run.runId).toBe(runId);
    expect(hydration?.run.missionId).toBe(contract.missionId);
    expect(hydration?.projectId).toBe(contract.projectId);
  });

  it('what the world reads is READY, and the Mission Contract shows it Queued -- never running', async () => {
    const hydration = await new WonderlandJuliusReaderPostgres(pool).hydrate({
      projectId: contract.projectId,
      runId,
      worldSessionId: null,
    });
    expect(hydration?.run.state).toBe('READY');
    expect(projectJuliusTaskState(hydration?.run.state ?? null)).toEqual({ kind: 'state', state: 'Queued' });
  });

  it('the world ledger carries the creation, oldest first by sequence (Julius client rule 4)', async () => {
    const page = await new WonderlandJuliusReaderPostgres(pool).events({
      projectId: contract.projectId,
      runId,
      afterSequence: 0,
      limit: 200,
    });
    expect(page, 'the world reader could not page a run Julius just created').not.toBeNull();
    const rows = page?.rows ?? [];
    expect(rows.length, 'creation wrote nothing the world can replay').toBeGreaterThan(0);
    const sequences = rows.map((row) => Number((row as unknown as { sequence: number | string }).sequence));
    expect(sequences.every((s) => Number.isFinite(s))).toBe(true);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it('another project cannot hydrate this run, even naming its exact runId', async () => {
    const foreign = await new WonderlandJuliusReaderPostgres(pool).hydrate({
      projectId: `prj-someone-else-${nonce}`,
      runId,
      worldSessionId: null,
    });
    expect(foreign).toBeNull();
    // ...and cannot page it either: no run row in that project is null, never an empty page.
    expect(await new WonderlandJuliusReaderPostgres(pool).events({
      projectId: `prj-someone-else-${nonce}`, runId, afterSequence: 0, limit: 10,
    })).toBeNull();
    // Control: the owning project CAN, so the null above is isolation, not a broken read.
    const owner = await new WonderlandJuliusReaderPostgres(pool).hydrate({
      projectId: contract.projectId,
      runId,
      worldSessionId: null,
    });
    expect(owner).not.toBeNull();
  });

  /* ------------------------------------------------ row 12, R1: read-only */

  it('THE WORLD\'S BEGIN MAKES POSTGRESQL REFUSE A WRITE (SQLSTATE 25006) -- the guarantee is the server\'s', async () => {
    // The unit suite proves every world read goes through this exact statement;
    // this proves, against a real server, what the statement buys. The write is
    // sent on a raw client on purpose: the world's own facade would refuse it
    // before PostgreSQL could.
    const client = await pool.connect();
    try {
      await client.query(WONDERLAND_JULIUS_READ_ONLY_BEGIN);
      const refused = await client.query(
        'INSERT INTO relay_wonderland.players(player_id) VALUES($1)', [`world-write-probe-${nonce}`],
      ).then(() => null, (error: { code?: string }) => error);
      expect(refused?.code, 'a write inside the world\'s transaction was not refused').toBe('25006');
      await client.query('ROLLBACK');
      // CONTROL: the same INSERT in an ordinary transaction is accepted (and rolled back), so the 25006 above
      // is READ ONLY's and not a broken statement.
      await client.query('BEGIN');
      await client.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1)', [`world-write-probe-${nonce}`]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const left = await pool.query('SELECT 1 FROM relay_wonderland.players WHERE player_id=$1', [`world-write-probe-${nonce}`]);
    expect(left.rows).toEqual([]);
  });

  it('the composed world reads the run, its page AND Julius\'s own result inside that transaction', async () => {
    const world = wonderlandJuliusWorld(pool);
    const read = await world.read(async (scope) => ({
      hydration: await scope.reader.hydrate({ projectId: contract.projectId, runId, worldSessionId: null }),
      page: await scope.reader.events({ projectId: contract.projectId, runId, afterSequence: 0, limit: 50 }),
      result: await scope.results.result({ projectId: contract.projectId, runId, actorId: 'world-observe-player' }),
      foreign: await scope.results.result({ projectId: `prj-someone-else-${nonce}`, runId, actorId: 'world-observe-player' }),
      inTransaction: await scope.reader.events({ projectId: contract.projectId, runId, afterSequence: 0, limit: 1 }),
    }));
    expect(read.hydration?.run.runId).toBe(runId);
    expect(read.page?.rows.length).toBeGreaterThan(0);
    expect(read.result?.runId).toBe(runId);
    expect(read.result?.state).toBe('READY');
    // Isolation through Julius's own API too: another project is not found, never somebody else's run.
    expect(read.foreign).toBeNull();
    expect(read.inTransaction).not.toBeNull();
    // A write attempted through the world never reaches the server.
    await expect(world.read((scope) => (scope.reader as unknown as { pool: { query(sql: string): Promise<unknown> } })
      .pool.query('DELETE FROM relay_wonderland.players'))).rejects.toThrow(/not a read/u);
  });

  it('THE WORLD\'S OWN POOL: read-only before any BEGIN, bounded by its timeouts, and a smuggled second command refused (review M1+M2)', async () => {
    // The unit suite proves what `pg` is told to send (the startup message); this proves what a real server
    // makes of it, and what the extended protocol buys against a real server.
    const worldPool = createWonderlandJuliusWorldPool(url as string);
    expect(worldPool, 'the throwaway database URL was refused for the world pool').not.toBeNull();
    const probe = `world-pool-probe-${nonce}`;
    try {
      const client = await (worldPool as Pool).connect();
      try {
        const settings = await client.query<{ name: string; setting: string }>(
          `SELECT name, setting FROM pg_settings
            WHERE name IN ('default_transaction_read_only', 'idle_in_transaction_session_timeout', 'statement_timeout')
            ORDER BY name`,
        );
        expect(settings.rows).toEqual([
          { name: 'default_transaction_read_only', setting: 'on' },
          { name: 'idle_in_transaction_session_timeout', setting: '10000' },
          { name: 'statement_timeout', setting: '5000' },
        ]);
        // Outside any BEGIN, a write is refused by the SESSION's default -- not by the world's BEGIN.
        const refused = await client.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1)', [probe])
          .then(() => null, (error: { code?: string }) => error);
        expect(refused?.code, 'a write on a world-pool session was not refused').toBe('25006');
      } finally {
        client.release();
      }
      // THE FACADE against the real server: one command per statement on the extended protocol, so the COMMIT
      // and the DELETE smuggled behind a SELECT never run (42601), and the connection is destroyed.
      await expect(withWonderlandJuliusReadOnlyTransaction(worldPool as Pool,
        (db) => db.query('SELECT 1; COMMIT; DELETE FROM relay_wonderland.players WHERE player_id IS NULL')))
        .rejects.toMatchObject({ code: '42601' });
    } finally {
      await worldPool?.end();
    }
    const left = await pool.query('SELECT 1 FROM relay_wonderland.players WHERE player_id=$1', [probe]);
    expect(left.rows).toEqual([]);
  });
});
