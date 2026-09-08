import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import { WonderlandJuliusReaderPostgres } from './wonderland-julius-reader-postgres';
import { WonderlandMembershipPostgres } from './wonderland-membership-postgres';
import { openWonderlandCursor } from '../mission/wonderland/wonderland-ordering';
import { ingestWonderlandRows } from '../mission/wonderland/wonderland-ingress';
import { emptyJuliusActivity } from '../mission/wonderland/wonderland-julius-activity';
import { adoptWonderlandSnapshot } from '../mission/wonderland/wonderland-rehydration';
import { wonderlandHydrationResume, wonderlandHydrationVerdict } from '../mission/wonderland/wonderland-hydration';
import { authorizeWonderlandProjectCapability } from '../mission/wonderland/wonderland-authorization';

/**
 * THE READER, AGAINST A REAL POSTGRESQL.
 *
 * Every other test of this class drives a stub that answers the shapes `pg`
 * returns. That proves the TypeScript. It cannot prove the SQL: a column that
 * does not exist, a join that does not resolve, a `bigint` that arrives in a
 * form the reader does not expect, or a LATERAL that Postgres reads differently
 * from how it was written are all invisible to a stub, and all of them would
 * surface as a broken world rather than as a failing test.
 *
 * So this runs the PRODUCTION CLASS — not a re-spelling of its query — against
 * a cluster built by the REAL migration chain from empty, seeded with two
 * projects so isolation is a fact about data rather than about a fixture that
 * agreed to be foreign.
 *
 * GATED, like `real-infra-julius.test.ts` beside it, and gated the same way so
 * there is one switch rather than two. Without `JULIUS_REAL_POSTGRES=1` and a
 * `WONDERLAND_TEST_DATABASE_URL` these report as `todo` — VISIBLY not run,
 * rather than passing on nothing.
 */

const enabled = process.env.JULIUS_REAL_POSTGRES === '1' && Boolean(process.env.WONDERLAND_TEST_DATABASE_URL);
const suite = enabled ? describe : describe.todo;

const A = 'project-a';
const B = 'project-b';
const RUN_A = 'run-a';
const RUN_B = 'run-b';
const RUN_A2 = 'run-a2';
const PLAYER_A = 'player-a';
const PLAYER_B = 'player-b';
const AT = '2026-09-08T00:00:00.000Z';

let pool: Pool;
let reader: WonderlandJuliusReaderPostgres;
let membership: WonderlandMembershipPostgres;

/** One Julius event, written the way `julius-postgres.ts` really writes one. */
async function writeEvent(input: {
  runId: string; projectId: string; sequence: number; type: string;
  facts?: Record<string, unknown>; occurredAt?: string;
}): Promise<void> {
  const eventId = `${input.runId}:${input.type}:${input.sequence}`;
  await pool.query(
    `INSERT INTO relay_wonderland.events
       (event_id, stream_id, project_id, sequence, event_type, visibility, payload, occurred_at)
     VALUES ($1,$2,$3,$4,$5,'PROJECT',$6::jsonb,$7)`,
    [
      eventId, input.runId, input.projectId, input.sequence, `julius.${input.type}`,
      JSON.stringify({
        schemaVersion: 'relay-julius-event.v1',
        eventId,
        streamId: input.runId,
        projectId: input.projectId,
        occurredAt: input.occurredAt ?? AT,
        payload: { runId: input.runId, ...(input.facts ?? {}) },
      }),
      input.occurredAt ?? AT,
    ],
  );
}

suite('the Wonderland reader against a real PostgreSQL', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.WONDERLAND_TEST_DATABASE_URL });
    // THE REAL CHAIN, FROM EMPTY. Not a hand-written subset of the schema —
    // a subset is a second schema, and the one thing this file exists to catch
    // is the production query meeting the production tables.
    await new TransactionalWonderlandDatabase(pool).migrate();

    await pool.query(`
      INSERT INTO relay_wonderland.players(player_id) VALUES ('${PLAYER_A}'), ('${PLAYER_B}');
      INSERT INTO relay_wonderland.projects(project_id) VALUES ('${A}'), ('${B}');
      -- Each player is a member of exactly one project. Isolation is then a
      -- fact about the data rather than about a fixture that agreed to refuse.
      INSERT INTO relay_wonderland.project_members(project_id, player_id, role)
        VALUES ('${A}','${PLAYER_A}','OWNER'), ('${B}','${PLAYER_B}','OWNER');
      INSERT INTO relay_wonderland.mission_contracts(mission_id, project_id, stage, canonical_hash, snapshot)
        VALUES ('mission-a','${A}','READY','hash-a','{}'),
               ('mission-a2','${A}','READY','hash-a2','{}'),
               ('mission-b','${B}','READY','hash-b','{}');
      INSERT INTO relay_wonderland.julius_runs
        (run_id, mission_id, project_id, state, runtime_version, card_revision,
         mission_contract_revision, project_brain_revision, version)
        VALUES ('${RUN_A}','mission-a','${A}','EXECUTING','1','card:rev-7',1,4,7),
               ('${RUN_A2}','mission-a2','${A}','PLANNING','1','card:rev-7',1,0,2),
               ('${RUN_B}','mission-b','${B}','REVIEWING','1','card:rev-9',1,2,3);
      INSERT INTO relay_wonderland.julius_tasks(task_id, run_id, role, task_type, state, ordinal, worker_id, lease_owner, lease_generation, lease_expires_at)
        VALUES ('task-a1','${RUN_A}','CODING_AGENT','code','ACTIVE',1,'worker-1','scheduler',1, now() + interval '10 minutes'),
               ('task-a2','${RUN_A}','INDEPENDENT_REVIEWER','review','ACTIVE',2,'worker-2','scheduler',1, now() + interval '10 minutes');
      -- SUCCEEDED with no lease: the schema's own
      -- CHECK((state='ACTIVE')=(lease_owner IS NOT NULL)) rejected a seed that
      -- had these the other way round, which is the kind of thing only a real
      -- cluster says out loud.
      INSERT INTO relay_wonderland.julius_tasks(task_id, run_id, role, task_type, state, ordinal)
        VALUES ('task-a3','${RUN_A}','CODING_AGENT','code','SUCCEEDED',3);
      INSERT INTO relay_wonderland.julius_tasks(task_id, run_id, role, task_type, state, ordinal, worker_id, lease_owner, lease_generation, lease_expires_at)
        VALUES ('task-b1','${RUN_B}','CODING_AGENT','code','ACTIVE',1,'worker-b','scheduler',1, now() + interval '10 minutes');
      INSERT INTO relay_wonderland.julius_approvals
        (approval_id, run_id, project_id, task_id, operation, policy_revision, reason_code, safe_rationale, state, requested_at, idempotency_key)
        VALUES ('appr-a1','${RUN_A}','${A}','task-a1','tool.run','card:rev-7','GATE','A person is being waited on.','PENDING', now(), 'idem-a1');
      -- A DECIDED one beside it, so 'PENDING' in the count is load-bearing.
      -- Without this the filter can be deleted with every test still green,
      -- and a world would show a gate that a person already answered. The
      -- schema's own CHECK((state='PENDING')=(decided_at IS NULL)) pair forces
      -- both decided columns to be present here, which is the constraint
      -- saying an approval nobody can be named for is not an approval.
      INSERT INTO relay_wonderland.julius_approvals
        (approval_id, run_id, project_id, task_id, operation, policy_revision, reason_code, safe_rationale, state, requested_at, decided_at, decided_by, idempotency_key)
        VALUES ('appr-a0','${RUN_A}','${A}','task-a1','tool.run','card:rev-7','GATE','Already answered.','APPROVED', now() - interval '1 hour', now() - interval '55 minutes', '${PLAYER_A}', 'idem-a0');
      -- PENDING approvals on OTHER runs, one in this project and one in the
      -- foreign one, so the run scope on the count is load-bearing too. A world
      -- watching run-a must not be told a person is being waited on because
      -- somebody is being waited on somewhere else.
      INSERT INTO relay_wonderland.julius_approvals
        (approval_id, run_id, project_id, task_id, operation, policy_revision, reason_code, safe_rationale, state, requested_at, idempotency_key)
        VALUES ('appr-a2-1','${RUN_A2}','${A}',NULL,'run.start','card:rev-7','GATE','A sibling run is waiting.','PENDING', now(), 'idem-a2-1'),
               ('appr-b1','${RUN_B}','${B}',NULL,'run.start','card:rev-9','GATE','Another project is waiting.','PENDING', now(), 'idem-b1');
    `);

    // PROJECT A's timeline: a transition, then activity that does NOT bump
    // `julius_runs.version` — the case that made a reconnected world go deaf.
    await writeEvent({ runId: RUN_A, projectId: A, sequence: 1, type: 'run.created', facts: { missionId: 'mission-a' } });
    await writeEvent({ runId: RUN_A, projectId: A, sequence: 2, type: 'run.transitioned', facts: { to: 'PLANNING' } });
    await writeEvent({ runId: RUN_A, projectId: A, sequence: 3, type: 'run.transitioned', facts: { to: 'EXECUTING' } });
    await writeEvent({ runId: RUN_A, projectId: A, sequence: 4, type: 'approval.requested', facts: { approvalId: 'appr-a1', taskId: 'task-a1' } });
    await writeEvent({ runId: RUN_A, projectId: A, sequence: 5, type: 'subagent.spawned', facts: { subagentId: 'sub-1', taskId: 'task-a1' } });

    // PROJECT B: a separate run with its own sequence space, deliberately
    // overlapping A's numbers so a leak would be visible rather than plausible.
    await writeEvent({ runId: RUN_B, projectId: B, sequence: 1, type: 'run.created', facts: { missionId: 'mission-b' } });
    await writeEvent({ runId: RUN_B, projectId: B, sequence: 2, type: 'run.transitioned', facts: { to: 'REVIEWING' } });

    // A SECOND RUN INSIDE PROJECT A, at much higher sequences. This is what
    // makes the RUN scope load-bearing on its own: without it, A's other run
    // raises `run-a`'s MAX(sequence) and the snapshot claims a position no
    // event of that run ever had.
    await writeEvent({ runId: RUN_A2, projectId: A, sequence: 50, type: 'run.created', facts: { missionId: 'mission-a2' } });
    await writeEvent({ runId: RUN_A2, projectId: A, sequence: 51, type: 'run.transitioned', facts: { to: 'PLANNING' } });

    // AND HOSTILE ROWS: project B's, written onto project A's STREAM ID.
    // `relay_wonderland.events.stream_id` is free text with no foreign key —
    // only `UNIQUE(stream_id, sequence)` constrains it — so nothing in the
    // schema stops a second tenant, or a bug, from appending to a stream id it
    // does not own. This is what makes the PROJECT scope load-bearing on its
    // own, and without rows like these the two scopes are redundant and either
    // can be deleted with every test still green. They were.
    await writeEvent({ runId: RUN_A, projectId: B, sequence: 90, type: 'run.transitioned', facts: { to: 'COMPLETED' } });
    await writeEvent({ runId: RUN_A, projectId: B, sequence: 91, type: 'run.completed', facts: { outcome: 'SUCCEEDED' } });

    // AND THE OTHER WRITER. `relay_wonderland.events` is shared: Wonderland's
    // own battle path writes here too, in a different payload shape. These sit
    // on project A's own run stream, which is what makes the `julius.%` filter
    // load-bearing rather than decorative — see the two assertions on it below.
    //
    // WORTH KNOWING, found by putting them at 20 and 21 first: the sequence
    // space is per STREAM and shared across writers —
    // `UNIQUE(stream_id, sequence)` rejected a later Julius append that landed
    // on a battle row's number. Julius allocates from
    // `relay_wonderland.stream_sequences`; anything else writing to the same
    // stream_id without that allocator can collide with it. These sit far out
    // of the way at 200 and 201 so this file tests the filter rather than that.
    await pool.query(
      `INSERT INTO relay_wonderland.events
         (event_id, stream_id, project_id, sequence, event_type, visibility, payload, occurred_at)
       VALUES ('battle-1',$1,$2,200,'battle.round.resolved','PROJECT','{"round":1}'::jsonb,$3),
              ('battle-2',$1,$2,201,'presence.joined','PROJECT','{"playerId":"someone"}'::jsonb,$3)`,
      [RUN_A, A, AT],
    );

    reader = new WonderlandJuliusReaderPostgres(pool);
    membership = new WonderlandMembershipPostgres(pool);
  }, 60_000);

  afterAll(async () => { await pool?.end(); });

  /* ------------------------------------------------------ A. the snapshot */

  it('A: reads the run it was asked for, and only in the project it was asked for', async () => {
    const a = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: 'world-1' });
    expect(a?.projectId).toBe(A);
    expect(a?.run.runId).toBe(RUN_A);
    expect(a?.run.state).toBe('EXECUTING');
    expect(a?.run.missionId).toBe('mission-a');
    // From the real `julius_runs.version` column, as a number.
    expect(a?.run.revision).toBe(7);
    expect(typeof a?.run.revision).toBe('number');
    // Two ACTIVE tasks, one PENDING approval — counted by the sub-selects
    // against the real tables, not supplied by a fixture.
    expect(a?.run.activeTasks).toBe(2);
    expect(a?.run.pendingApprovals).toBe(1);

    const b = await reader.hydrate({ projectId: B, runId: RUN_B, worldSessionId: null });
    expect(b?.run.state).toBe('REVIEWING');
    expect(b?.run.revision).toBe(3);
  });

  it('A: only the PENDING approval is counted, not the one already answered', async () => {
    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    const all = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM relay_wonderland.julius_approvals WHERE run_id=$1`, [RUN_A]);
    // Two approvals on the run, one of them decided. A world showing "2" would
    // be waiting on a person who has already answered.
    expect(Number(all.rows[0].n)).toBe(2);
    // And three PENDING ones exist across the database, on three different
    // runs in two projects. Only this run's may be counted.
    const pending = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM relay_wonderland.julius_approvals WHERE state='PENDING'`);
    expect(Number(pending.rows[0].n)).toBe(3);
    expect(hydration?.run.pendingApprovals).toBe(1);
  });

  it('A: the observation time comes from the database, at read time', async () => {
    // The reader takes `now()` inside its own statement rather than a Date() in
    // this process, so the timestamp names the instant of the consistent read.
    // A clock that had drifted, or a value taken somewhere else entirely, shows
    // up as a gap against the database's own clock.
    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    const dbNow = await pool.query<{ now: string }>(`SELECT now() AS now`);
    const observed = Date.parse(hydration!.observedAtIso);
    expect(Number.isNaN(observed)).toBe(false);
    expect(Math.abs(Date.parse(String(dbNow.rows[0].now)) - observed)).toBeLessThan(5_000);
    // And the run and the hydration were cut at the same instant.
    expect(hydration!.run.observedAtIso).toBe(hydration!.observedAtIso);
  });

  /* ------------------------------------------- I, J. the sequence source */

  it('I+J: the snapshot position is the run stream\'s real MAX(sequence)', async () => {
    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    const truth = await pool.query<{ max: string | null }>(
      `SELECT MAX(sequence) AS max FROM relay_wonderland.events
        WHERE stream_id=$1 AND project_id=$2 AND event_type LIKE 'julius.%'`,
      [RUN_A, A],
    );
    // Not "some plausible number": the same value the ledger holds, read from
    // the ledger a second time by a different statement.
    expect(hydration?.run.atSequence).toBe(Number(truth.rows[0].max));
    expect(hydration?.run.atSequence).toBe(5);
    // And the resume asks for exactly the tail after it.
    expect(wonderlandHydrationResume(hydration!).afterSequence).toBe(5);
  });

  it('J: the boundary is per RUN, so B\'s overlapping sequences do not raise it', async () => {
    const b = await reader.hydrate({ projectId: B, runId: RUN_B, worldSessionId: null });
    // B has sequences 1..2 of its own. A's 5 must not appear here, and B's 2
    // must not have moved A's boundary either.
    expect(b?.run.atSequence).toBe(2);
    const a = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    expect(a?.run.atSequence).toBe(5);
  });

  /* --------------------------------------------- B, C. the incremental read */

  it('B: the tail starts strictly after the cursor', async () => {
    const page = await reader.events({ projectId: A, runId: RUN_A, afterSequence: 3, limit: 100 });
    expect(page.rows.map((r) => r.sequence)).toEqual([4, 5]);
    // Strictly after: 3 itself is not re-delivered.
    expect(page.rows.some((r) => r.sequence === 3)).toBe(false);
    expect(page.revision).toBe(7);
  });

  it('B: a cursor at the end returns nothing and still reports the revision', async () => {
    const page = await reader.events({ projectId: A, runId: RUN_A, afterSequence: 5, limit: 100 });
    expect(page.rows).toEqual([]);
    // The reason the query is anchored on the RUN: an events-anchored one
    // returns no rows here and leaves the caller inventing a revision.
    expect(page.revision).toBe(7);
  });

  it('C: ordering is deterministic and ascending across repeated reads', async () => {
    const seen: number[][] = [];
    for (let i = 0; i < 5; i += 1) {
      const page = await reader.events({ projectId: A, runId: RUN_A, afterSequence: 0, limit: 100 });
      seen.push(page.rows.map((r) => r.sequence));
    }
    for (const run of seen) {
      expect(run).toEqual([1, 2, 3, 4, 5]);
      expect(run).toEqual([...run].sort((x, y) => x - y));
    }
  });

  it('C: the page limit takes the OLDEST rows, so paging cannot skip', async () => {
    const first = await reader.events({ projectId: A, runId: RUN_A, afterSequence: 0, limit: 2 });
    expect(first.rows.map((r) => r.sequence)).toEqual([1, 2]);
    const second = await reader.events({
      projectId: A, runId: RUN_A,
      afterSequence: first.rows[first.rows.length - 1].sequence, limit: 2,
    });
    expect(second.rows.map((r) => r.sequence)).toEqual([3, 4]);
  });

  /* ------------------------------------------------- E, F. isolation */

  it('E: a real run id from another project reads as nothing', async () => {
    // THE ATTACK. `run-b` exists, and player A is a genuine member of A. Asking
    // for it under A's project must not resolve — nothing here resolves a
    // project FROM a run id.
    expect(await reader.hydrate({ projectId: A, runId: RUN_B, worldSessionId: null })).toBeNull();
    const page = await reader.events({ projectId: A, runId: RUN_B, afterSequence: 0, limit: 100 });
    expect(page.rows).toEqual([]);
  });

  it('E: no event of the other project appears in either direction', async () => {
    for (const [project, run, foreign] of [[A, RUN_A, B], [B, RUN_B, A]] as const) {
      const page = await reader.events({ projectId: project, runId: run, afterSequence: 0, limit: 100 });
      for (const row of page.rows) {
        expect(row.projectId).toBe(project);
        expect(row.projectId).not.toBe(foreign);
        expect(row.streamId).toBe(run);
      }
      expect(JSON.stringify(page.rows)).not.toContain(foreign);
    }
  });

  it('E: the other writer\'s rows on this same stream never reach the client', async () => {
    // `relay_wonderland.events` is shared, and these two rows are on project
    // A's own run stream at sequences 20 and 21 — legitimately A's, and not
    // Julius's. Without the `julius.%` filter they would consume the page limit
    // while producing nothing a world can draw, and a client paging forward
    // would advance its cursor past them having been shown an empty stream.
    const battles = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM relay_wonderland.events
        WHERE stream_id=$1 AND project_id=$2 AND event_type NOT LIKE 'julius.%'`, [RUN_A, A]);
    expect(Number(battles.rows[0].n)).toBe(2);

    const page = await reader.events({ projectId: A, runId: RUN_A, afterSequence: 0, limit: 500 });
    expect(page.rows.every((r) => r.eventType.startsWith('julius.'))).toBe(true);
    expect(page.rows.some((r) => r.sequence === 200 || r.sequence === 201)).toBe(false);
  });

  it('E: the snapshot position ignores the other writer too', async () => {
    // The same filter on the other statement. A battle event at sequence 21
    // would otherwise put the snapshot's position past every Julius event, and
    // the tail after it would be permanently empty.
    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    const juliusMax = await pool.query<{ max: string }>(
      `SELECT MAX(sequence) AS max FROM relay_wonderland.events
        WHERE stream_id=$1 AND project_id=$2 AND event_type LIKE 'julius.%'`, [RUN_A, A]);
    expect(hydration!.run.atSequence).toBe(Number(juliusMax.rows[0].max));
    expect(hydration!.run.atSequence).toBeLessThan(200);
  });

  it('E: hostile rows on the same stream id under another project are invisible', async () => {
    // The rows exist. `stream_id` has no foreign key, so project B's writer put
    // `run.completed` on project A's stream at sequences 90 and 91. If the
    // project scope were dropped, A's world would be told its run had COMPLETED
    // — a terminal state, from another tenant, that nothing later un-does.
    const hostile = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM relay_wonderland.events WHERE stream_id=$1 AND project_id=$2`,
      [RUN_A, B]);
    expect(Number(hostile.rows[0].n)).toBe(2);

    const page = await reader.events({ projectId: A, runId: RUN_A, afterSequence: 0, limit: 500 });
    expect(page.rows.every((r) => r.projectId === A)).toBe(true);
    expect(page.rows.some((r) => r.sequence === 90 || r.sequence === 91)).toBe(false);
    expect(JSON.stringify(page.rows)).not.toContain('run.completed');

    // And the snapshot's position is not dragged to 91 either.
    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    expect(hydration!.run.atSequence).toBeLessThan(90);
  });

  it('E: another RUN inside the SAME project does not move this run\'s position', async () => {
    // The other half. `run-a2` is legitimately project A's and its events sit
    // at sequences 50 and 51. Only the run scope keeps them out of `run-a`'s
    // MAX(sequence); without it the snapshot would claim a position no event of
    // this run ever had, and every real event after it would be refused as
    // stale — a world deaf for the rest of the mission.
    const sibling = await reader.hydrate({ projectId: A, runId: RUN_A2, worldSessionId: null });
    expect(sibling?.run.atSequence).toBe(51);
    expect(sibling?.run.state).toBe('PLANNING');

    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    expect(hydration!.run.atSequence).toBeLessThan(50);

    const page = await reader.events({ projectId: A, runId: RUN_A, afterSequence: 0, limit: 500 });
    expect(page.rows.every((r) => r.streamId === RUN_A)).toBe(true);
    expect(page.rows.some((r) => r.sequence >= 50)).toBe(false);
  });

  it('E: membership is per project, against the real project_members table', async () => {
    expect(await membership.lookup({ playerId: PLAYER_A, projectId: A })).toMatchObject({ role: 'OWNER' });
    // A genuine player, a genuine project, and no row joining them.
    expect(await membership.lookup({ playerId: PLAYER_A, projectId: B })).toBeNull();
    expect(await membership.lookup({ playerId: PLAYER_B, projectId: A })).toBeNull();
  });

  it('F: an unknown run and an unknown project both read as nothing, identically', async () => {
    const answers = await Promise.all([
      reader.hydrate({ projectId: A, runId: 'run-that-never-existed', worldSessionId: null }),
      reader.hydrate({ projectId: 'project-that-never-existed', runId: RUN_A, worldSessionId: null }),
      reader.hydrate({ projectId: A, runId: RUN_B, worldSessionId: null }),
    ]);
    // All three null: the reader distinguishes nothing that the route could
    // turn into a disclosure. A membership oracle would need these to differ.
    expect(answers).toEqual([null, null, null]);
    expect(await membership.lookup({ playerId: PLAYER_A, projectId: 'project-that-never-existed' })).toBeNull();
  });

  it('F: an unknown player against a real project is a denial, not a grant', async () => {
    const decision = authorizeWonderlandProjectCapability(
      { playerId: 'nobody', projectId: A, capability: 'read_world_state' },
      await membership.lookup({ playerId: 'nobody', projectId: A }),
    );
    expect(decision.granted).toBe(false);
    expect(decision.verdict).toBe('not_a_member');
  });

  /* ---------------------------------------------- G, H. what it will not claim */

  it('G: role slots stay NULL, because persistence cannot prove them', async () => {
    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    expect(hydration?.card.hasPromptArchitect).toBeNull();
    expect(hydration?.card.hasCodingAgent).toBeNull();
    expect(hydration?.card.hasIndependentReviewer).toBeNull();
    // NOT false. The run genuinely HAS a CODING_AGENT task and an
    // INDEPENDENT_REVIEWER task in `julius_tasks` — so `false` would be wrong
    // as well as unprovable, and `true` would be a different authority's claim.
    const roles = await pool.query<{ role: string }>(
      `SELECT DISTINCT role FROM relay_wonderland.julius_tasks WHERE run_id=$1`, [RUN_A]);
    expect(roles.rows.map((r) => r.role).sort()).toEqual(['CODING_AGENT', 'INDEPENDENT_REVIEWER']);
  });

  it('G: usage stays UNKNOWN and the Brain stays uncited', async () => {
    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    for (const meter of [hydration!.usage.compoundAgent, hydration!.usage.singleAgent]) {
      expect(meter.capacityUnits.known).toBe(false);
      expect(meter.usedUnits.known).toBe(false);
      expect(meter.remainingUnits.known).toBe(false);
    }
    expect(hydration?.brain.contentHash).toBe('');
  });

  it('H: card_revision is carried verbatim and joined to nothing', async () => {
    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    // The column holds free text with no foreign key. `card:rev-7` matches no
    // `card_versions.card_version_id` — there are none at all here — and the
    // read still succeeds, which is the proof that nothing joins on it.
    expect(hydration?.card.cardRevision).toBe('card:rev-7');
    const cards = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM relay_wonderland.card_versions`);
    expect(Number(cards.rows[0].n)).toBe(0);
  });

  /* --------------------------------- D, K. same-revision activity and reconnect */

  it('D: activity at the SAME revision survives the snapshot', async () => {
    // THE DEFECT THIS CLOSES, against the real ledger. `review.started` maps to
    // a phase AND does not bump `julius_runs.version` — so it arrives carrying
    // the revision the snapshot already holds, and a revision tie-break alone
    // would refuse it. The world would stay on CODING until the run happened to
    // transition.
    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    const recovered = adoptWonderlandSnapshot(openWonderlandCursor({ projectId: A }), hydration!.run);
    expect(recovered.verdict).toBe('adopted');
    expect(recovered.cursor.sequence).toBe(5);
    // Positioned, so the blunt tie-break is off. That is what makes the below
    // possible at all.
    expect(recovered.cursor.revisionFromSnapshot).toBe(false);

    await writeEvent({ runId: RUN_A, projectId: A, sequence: 6, type: 'review.started', facts: { taskId: 'task-a2', reviewerId: 'worker-2' } });

    const after = await pool.query<{ version: string }>(
      `SELECT version FROM relay_wonderland.julius_runs WHERE run_id=$1`, [RUN_A]);
    // PROVEN, not assumed: appending that event did not move the run's version.
    // The whole premise of the defect rests on this being true of real Julius
    // write paths, and here it is the real table saying so.
    expect(Number(after.rows[0].version)).toBe(7);

    const page = await reader.events({ projectId: A, runId: RUN_A, afterSequence: 5, limit: 100 });
    expect(page.rows.map((r) => r.sequence)).toEqual([6]);
    expect(page.revision).toBe(7);

    const ingested = ingestWonderlandRows({
      grant: { projectId: A, runId: RUN_A },
      rows: page.rows,
      revision: page.revision,
      cursor: recovered.cursor,
      activity: emptyJuliusActivity({ projectId: A, runId: RUN_A }),
    });

    // APPLIED, at the snapshot's own revision. Refused, this would be 0
    // deliveries and a world that had gone deaf.
    expect(ingested.refusals.out_of_order).toBe(0);
    expect(ingested.deliveries.length).toBe(1);
    expect(ingested.deliveries[0].envelope.state).toBe('independent_review');
    expect(ingested.deliveries[0].envelope.revision).toBe(7);
    expect(ingested.cursor.sequence).toBe(6);
  });

  it('D: an event with no phase still reaches the ACTIVITY fold', async () => {
    // The second half of the same rule. `finding.recorded` says nothing about
    // which PHASE a run is in and everything about what is going on, so it
    // produces no envelope and must still be seen — a pipeline that only folded
    // what it could draw would drop exactly the signals the second axis carries.
    await writeEvent({ runId: RUN_A, projectId: A, sequence: 7, type: 'finding.recorded', facts: { findingId: 'f-1', taskId: 'task-a2', severity: 'BLOCKING' } });

    const page = await reader.events({ projectId: A, runId: RUN_A, afterSequence: 6, limit: 100 });
    expect(page.rows.map((r) => r.sequence)).toEqual([7]);

    const ingested = ingestWonderlandRows({
      grant: { projectId: A, runId: RUN_A },
      rows: page.rows,
      revision: page.revision,
      cursor: openWonderlandCursor({ projectId: A, runId: RUN_A }),
      activity: emptyJuliusActivity({ projectId: A, runId: RUN_A }),
    });
    // No envelope — refused by NAME as saying nothing about the phase, not
    // quietly dropped and not miscounted as out of order.
    expect(ingested.deliveries).toEqual([]);
    expect(ingested.refusals.no_state).toBe(1);
    expect(ingested.refusals.out_of_order).toBe(0);
    // And the fold SAW it, which is the half that matters. `finding.recorded`
    // raises no signal and clears none, so the reading counts it as seen-and-
    // unused rather than moving `observedAtIso` — the fold does not claim to
    // have observed something it took nothing from. A pipeline that had
    // dropped the row before the fold would leave this at zero.
    expect(ingested.activity.unusedEvents).toBe(1);
  });

  /* ------------------------------- K. the two positions, and what converges */

  it('K: the snapshot position is the LEDGER max, not the last drawable event', async () => {
    // A DISTINCTION THE MEMORY MODEL NEVER FORCED. `atSequence` is
    // MAX(sequence) over the run's events; an ordering cursor's `sequence` is
    // the last APPLIED envelope. Silent events move the first and not the
    // second, so the two legitimately differ — and the snapshot's is never
    // BEHIND, which is the direction that matters: resuming from it skips
    // nothing a world could have drawn.
    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    const ledgerMax = await pool.query<{ max: string }>(
      `SELECT MAX(sequence) AS max FROM relay_wonderland.events
        WHERE stream_id=$1 AND project_id=$2 AND event_type LIKE 'julius.%'`, [RUN_A, A]);
    expect(hydration!.run.atSequence).toBe(Number(ledgerMax.rows[0].max));

    const all = await reader.events({ projectId: A, runId: RUN_A, afterSequence: 0, limit: 500 });
    const folded = ingestWonderlandRows({
      grant: { projectId: A, runId: RUN_A },
      rows: all.rows,
      revision: all.revision,
      cursor: openWonderlandCursor({ projectId: A, runId: RUN_A }),
      activity: emptyJuliusActivity({ projectId: A, runId: RUN_A }),
    });

    // The last event is `finding.recorded`, which draws nothing — so the event
    // cursor sits behind the ledger. That is correct, and it is the case a
    // stub would never have produced.
    expect(folded.cursor.sequence).toBeLessThan(hydration!.run.atSequence!);
    expect(hydration!.run.atSequence).toBeGreaterThanOrEqual(folded.cursor.sequence);
    // Neither position loses an event: resuming from either re-reads the gap
    // and ordering refuses what it has already seen.
    expect(folded.refusals.no_state).toBeGreaterThan(0);
  });

  it('K: both routes into the world converge on the same STATE', async () => {
    // What must actually agree is what a world DRAWS. A client that joined
    // early and folded every event, and a client that hydrated cold, must hold
    // the same phase and the same revision — otherwise a reconnect quietly
    // produces a different world from a first connect.
    const all = await reader.events({ projectId: A, runId: RUN_A, afterSequence: 0, limit: 500 });
    const folded = ingestWonderlandRows({
      grant: { projectId: A, runId: RUN_A },
      rows: all.rows,
      revision: all.revision,
      cursor: openWonderlandCursor({ projectId: A, runId: RUN_A }),
      activity: emptyJuliusActivity({ projectId: A, runId: RUN_A }),
    });
    const drawn = folded.deliveries[folded.deliveries.length - 1].envelope.state;

    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    const cold = adoptWonderlandSnapshot(openWonderlandCursor({ projectId: A }), hydration!.run);

    // The kernel says EXECUTING, which draws `coding`; the event stream's last
    // drawable event is `review.started`, which draws `independent_review`.
    // THEY DISAGREE, and the disagreement is real rather than a bug: the run
    // row is the authority on the phase, and a review starting under an
    // EXECUTING run is exactly what the second axis exists to show.
    expect(cold.visualState).toBe('coding');
    expect(drawn).toBe('independent_review');
    expect(cold.sourceState).toBe('EXECUTING');
    // What DOES converge is the revision, and neither route invents one.
    expect(folded.cursor.revision).toBe(cold.cursor.revision);
    expect(cold.cursor.revision).toBe(7);
  });

  it('K: replaying the whole stream onto a hydrated cursor moves nothing', async () => {
    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    const cold = adoptWonderlandSnapshot(openWonderlandCursor({ projectId: A }), hydration!.run);
    const all = await reader.events({ projectId: A, runId: RUN_A, afterSequence: 0, limit: 500 });
    const replayed = ingestWonderlandRows({
      grant: { projectId: A, runId: RUN_A },
      rows: all.rows,
      revision: all.revision,
      cursor: cold.cursor,
      activity: emptyJuliusActivity({ projectId: A, runId: RUN_A }),
    });
    // The whole history, against a world that already knows where it is.
    expect(replayed.deliveries).toEqual([]);
    expect(replayed.cursor.sequence).toBe(cold.cursor.sequence);
    expect(replayed.cursor.revision).toBe(cold.cursor.revision);
  });

  it('L: a state the kernel cannot hold is refused, even by a database that lost its CHECK', async () => {
    // The schema is the first line: `julius_runs.state` has a CHECK naming the
    // thirteen kernel states, and it refuses anything else outright. The
    // reader's own guard is the second, for a database that has been restored,
    // migrated by an older build, or edited by hand — so proving it needs a
    // cluster that has genuinely lost the constraint.
    await pool.query(`ALTER TABLE relay_wonderland.julius_runs DROP CONSTRAINT julius_runs_state_check`);
    try {
      await pool.query(`UPDATE relay_wonderland.julius_runs SET state='ASCENDED' WHERE run_id=$1`, [RUN_A2]);
      // Null rather than a coerced phase. The visual mapping is total over the
      // kernel's vocabulary and nothing else, and pushing an unknown word
      // through it would draw a world from a state nobody defined.
      expect(await reader.hydrate({ projectId: A, runId: RUN_A2, worldSessionId: null })).toBeNull();
      // The events of that run are still readable — one unreadable run row does
      // not take the stream down with it.
      const page = await reader.events({ projectId: A, runId: RUN_A2, afterSequence: 0, limit: 10 });
      expect(page.rows.length).toBeGreaterThan(0);
    } finally {
      await pool.query(`UPDATE relay_wonderland.julius_runs SET state='PLANNING' WHERE run_id=$1`, [RUN_A2]);
      await pool.query(
        `ALTER TABLE relay_wonderland.julius_runs ADD CONSTRAINT julius_runs_state_check
           CHECK(state IN('CREATED','PLANNING','READY','EXECUTING','WAITING','REVIEWING','REPAIRING','VERIFYING','BLOCKED','PAUSED','FAILED','COMPLETED','CANCELLED'))`);
    }
  });

  /* ---------------------------------------------- L. schema and transaction */

  it('L: the hydration the reader assembles is one the route will accept', async () => {
    // The route re-verifies a hydration before serving it. A reader whose parts
    // disagreed about the run or the project would be refused there; this
    // proves the real one assembles consistently from real rows.
    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: 'world-1' });
    expect(wonderlandHydrationVerdict(A, hydration!)).toBe('accepted');
    expect(wonderlandHydrationVerdict(B, hydration!)).toBe('foreign_project');
  });

  it('L: the run row and its position come from ONE statement, so they cannot tear', async () => {
    // A concurrency case the in-memory model cannot express. Twenty hydrations
    // race twenty appends. Every result must be internally consistent: a
    // position at or below the ledger's max AT THAT MOMENT, never a version
    // from one instant paired with a sequence from another.
    const before = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    const base = before!.run.atSequence!;

    const writes = Array.from({ length: 20 }, (_, i) =>
      writeEvent({ runId: RUN_A, projectId: A, sequence: base + 1 + i, type: 'subagent.completed', facts: { subagentId: `sub-${i}`, taskId: 'task-a1' } }));
    const reads = Array.from({ length: 20 }, () =>
      reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null }));
    const [, ...results] = await Promise.all([Promise.all(writes), ...reads]);

    const finalMax = await pool.query<{ max: string }>(
      `SELECT MAX(sequence) AS max FROM relay_wonderland.events WHERE stream_id=$1 AND project_id=$2`, [RUN_A, A]);
    for (const hydration of results) {
      expect(hydration).not.toBeNull();
      const at = (hydration as NonNullable<typeof hydration>).run.atSequence!;
      expect(at).toBeGreaterThanOrEqual(base);
      expect(at).toBeLessThanOrEqual(Number(finalMax.rows[0].max));
      // The run never transitioned during this, so every read must agree.
      expect((hydration as NonNullable<typeof hydration>).run.revision).toBe(7);
    }
  }, 30_000);

  it('L: a run that transitions mid-flight is never read half-transitioned', async () => {
    // Postgres behaviour the memory model cannot show: the sub-selects hang off
    // the run row inside one statement, so a concurrent UPDATE either is or is
    // not visible to a given read — never partly.
    const hydrations: (Awaited<ReturnType<typeof reader.hydrate>>)[] = [];
    const flip = pool.query(
      `UPDATE relay_wonderland.julius_runs SET state='VERIFYING', version=version+1 WHERE run_id=$1`, [RUN_A]);
    for (let i = 0; i < 15; i += 1) {
      hydrations.push(await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null }));
    }
    await flip;
    hydrations.push(await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null }));

    for (const hydration of hydrations) {
      const run = hydration!.run;
      // The pairing is the invariant: EXECUTING belongs to version 7 and
      // VERIFYING to version 8. A torn read would show one with the other.
      if (run.state === 'EXECUTING') expect(run.revision).toBe(7);
      else expect([run.state, run.revision]).toEqual(['VERIFYING', 8]);
    }
    expect(hydrations[hydrations.length - 1]!.run.state).toBe('VERIFYING');
  }, 30_000);
});
