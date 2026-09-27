import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { WonderlandJuliusReaderPostgres } from '../src/relay/persistence/wonderland-julius-reader-postgres';
import { projectJuliusTaskState } from '../src/relay/mission/wonderland/wonderland-julius-task-state';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';

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
 * Gated like its siblings: JULIUS_REAL_POSTGRES=1 and WONDERLAND_TEST_DATABASE_URL.
 * It refuses the live `julius` database outright -- on the development laptop the
 * inherited DATABASE_URL points there, and this suite migrates and writes rows.
 */

const url = process.env.WONDERLAND_TEST_DATABASE_URL;
const enabled = process.env.JULIUS_REAL_POSTGRES === '1' && Boolean(url);

if (enabled) {
  const parsed = new URL(url as string);
  if (parsed.port === '5432' || parsed.pathname === '/julius') {
    throw new Error('refusing to run against what looks like the live julius database');
  }
}

describe.runIf(enabled)('a mission Julius creates is visible to the WORLD reader', () => {
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
    pool = new Pool({ connectionString: url });
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
    const { rows } = await new WonderlandJuliusReaderPostgres(pool).events({
      projectId: contract.projectId,
      runId,
      afterSequence: 0,
      limit: 200,
    });
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
    // Control: the owning project CAN, so the null above is isolation, not a broken read.
    const owner = await new WonderlandJuliusReaderPostgres(pool).hydrate({
      projectId: contract.projectId,
      runId,
      worldSessionId: null,
    });
    expect(owner).not.toBeNull();
  });
});
