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
/**
 * A string planted in every Project Brain entry's `safe_content`.
 *
 * The citation's narrowness is claimed by the shape of a SELECT. This is how it
 * is PROVEN: the text is really in the database, on rows the citation really
 * reads, and the assertion is that no part of it reaches the hydration. A
 * reader that grew a `summary` for the best of reasons fails here rather than
 * in front of a player.
 */
const CANARY = 'PROJECT-BRAIN-CANARY-8f3a';

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
      -- THE OPERATIONS ARE THE KERNEL'S OWN, not fixture words. The column is
      -- free text, so a seed can hold anything; but a gate whose operation
      -- JuliusPolicyOperation cannot produce proves nothing about the
      -- projection, which narrows to that vocabulary. These are real members.
      INSERT INTO relay_wonderland.julius_approvals
        (approval_id, run_id, project_id, task_id, operation, policy_revision, reason_code, safe_rationale, state, requested_at, idempotency_key)
        VALUES ('appr-a1','${RUN_A}','${A}','task-a1','MUTATE_FILESYSTEM','card:rev-7','CARD_APPROVAL_REQUIRED','A person is being waited on.','PENDING', now(), 'idem-a1');
      -- A DECIDED one beside it, so 'PENDING' in the count is load-bearing.
      -- Without this the filter can be deleted with every test still green,
      -- and a world would show a gate that a person already answered. The
      -- schema's own CHECK((state='PENDING')=(decided_at IS NULL)) pair forces
      -- both decided columns to be present here, which is the constraint
      -- saying an approval nobody can be named for is not an approval.
      INSERT INTO relay_wonderland.julius_approvals
        (approval_id, run_id, project_id, task_id, operation, policy_revision, reason_code, safe_rationale, state, requested_at, decided_at, decided_by, idempotency_key)
        VALUES ('appr-a0','${RUN_A}','${A}','task-a1','ACCESS_NETWORK','card:rev-7','CARD_APPROVAL_REQUIRED','Already answered.','APPROVED', now() - interval '1 hour', now() - interval '55 minutes', '${PLAYER_A}', 'idem-a0');
      -- PENDING approvals on OTHER runs, one in this project and one in the
      -- foreign one, so the run scope on the count is load-bearing too. A world
      -- watching run-a must not be told a person is being waited on because
      -- somebody is being waited on somewhere else.
      INSERT INTO relay_wonderland.julius_approvals
        (approval_id, run_id, project_id, task_id, operation, policy_revision, reason_code, safe_rationale, state, requested_at, idempotency_key)
        VALUES ('appr-a2-1','${RUN_A2}','${A}',NULL,'SPAWN_SUBAGENT','card:rev-7','CARD_APPROVAL_REQUIRED','A sibling run is waiting.','PENDING', now(), 'idem-a2-1'),
               ('appr-b1','${RUN_B}','${B}',NULL,'ACCESS_NETWORK','card:rev-9','CARD_APPROVAL_REQUIRED','Another project is waiting.','PENDING', now(), 'idem-b1');

      -- ------------------------------------------------- the Project Brain
      --
      -- Entries first, then the compilations that CITED them. Every one of
      -- these carries safe_content, which is the substance of somebody's
      -- work and must never leave this table: the citation reads entry_kind
      -- and nothing else, and the canary below is how that is proven rather
      -- than asserted.
      --
      -- THE KINDS ARE THE KERNEL'S, NOT THE CITATION'S, and that is the point.
      -- RESEARCH_NOTE and ACCEPTANCE_UPDATE have no bucket in
      -- WONDERLAND_BRAIN_KINDS; they must be counted in the total and nowhere
      -- else, and a fixture with only mappable kinds could not tell a reader
      -- that does that from one that silently drops them.
      INSERT INTO relay_wonderland.julius_brain_entries
        (entry_id, run_id, project_id, task_id, worker_id, entry_kind, safe_content, revision, created_at)
        VALUES ('brain-a1','${RUN_A}','${A}','task-a1','worker-1','DECISION','${CANARY} decision',1, now() - interval '9 minutes'),
               ('brain-a2','${RUN_A}','${A}','task-a1','worker-1','FINDING','${CANARY} finding',2, now() - interval '8 minutes'),
               ('brain-a3','${RUN_A}','${A}','task-a1','worker-1','DECISION','${CANARY} again',3, now() - interval '7 minutes'),
               ('brain-a4','${RUN_A}','${A}','task-a1','worker-1','RESEARCH_NOTE','${CANARY} note',4, now() - interval '6 minutes'),
               ('brain-a5','${RUN_A}','${A}','task-a1','worker-1','ACCEPTANCE_UPDATE','${CANARY} update',5, now() - interval '5 minutes'),
               ('brain-b1','${RUN_B}','${B}','task-b1','worker-b','DECISION','${CANARY} foreign',1, now() - interval '5 minutes');

      -- TWO compilations on run A, so "the last one" is a real choice rather
      -- than the only row. The earlier one cites fewer entries; a reader that
      -- ordered the wrong way round would report a retrieval that has been
      -- superseded, with counts that all look plausible.
      INSERT INTO relay_wonderland.julius_context_snapshots
        (context_id, run_id, task_id, worker_id, compiler_version, mission_contract_revision,
         card_revision, project_brain_revision, source_entry_ids, content_hash,
         character_count, truncated, created_at, worker_role, redaction_count)
        VALUES ('ctx-a-old','${RUN_A}','task-a1','worker-1','julius-context.v1',1,'card:rev-7',2,
                '["brain-a1"]','sha256:old',100,false, now() - interval '8 minutes','CODING_AGENT',0),
               -- The current one: three mappable kinds, two the citation
               -- vocabulary cannot name, and one id whose entry no longer
               -- exists — which must still be counted, not dropped.
               ('ctx-a-new','${RUN_A}','task-a1','worker-1','julius-context.v1',1,'card:rev-7',4,
                '["brain-a1","brain-a2","brain-a3","brain-a4","brain-a5","brain-gone"]','sha256:new',4096,true,
                now() - interval '4 minutes','CODING_AGENT',2),
               -- A compilation in the FOREIGN project, on the foreign run. The
               -- project scope on the citation read is what keeps it there.
               ('ctx-b','${RUN_B}','task-b1','worker-b','julius-context.v1',1,'card:rev-9',2,
                '["brain-b1"]','sha256:foreign',50,false, now() - interval '3 minutes','CODING_AGENT',0);
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
    //
    // TWO SHAPES ON PURPOSE. `battle-1` carries a type in NEITHER vocabulary
    // and a payload no writer would produce — a third writer, in effect, which
    // is what proves a filter refuses everything that is not this writer rather
    // than merely refusing Julius. `battle-2` is a REAL WonderlandEvent, spelled
    // the way `appendEvent` really writes one: it was a bare `{playerId}` blob,
    // which no path in this repository can produce, and a test reading it as an
    // event was reading something the product cannot create.
    await pool.query(
      `INSERT INTO relay_wonderland.events
         (event_id, stream_id, project_id, sequence, event_type, visibility, payload, occurred_at)
       VALUES ('battle-1',$1,$2,200,'battle.round.resolved','PROJECT','{"round":1}'::jsonb,$3),
              ('battle-2',$1,$2,201,'presence.joined','PROJECT',$4::jsonb,$3)`,
      [RUN_A, A, AT, JSON.stringify({
        eventId: 'battle-2', schemaVersion: 'relay-wonderland-event.v1', timestamp: AT,
        projectId: A, sessionId: null, playerId: PLAYER_A, agentId: null, missionId: null,
        battleId: null, eventType: 'presence.joined', payload: {}, visibility: 'PUBLIC',
        correlationId: 'battle-2', causationId: null, sequence: 201,
      })],
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

  it('G: usage stays UNKNOWN, because no authority reports into it', async () => {
    const hydration = await reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null });
    for (const meter of [hydration!.usage.compoundAgent, hydration!.usage.singleAgent]) {
      expect(meter.capacityUnits.known).toBe(false);
      expect(meter.usedUnits.known).toBe(false);
      expect(meter.remainingUnits.known).toBe(false);
    }
    // THE BRAIN NO LONGER BELONGS IN THIS SENTENCE. It used to: the citation
    // was withheld and this asserted the withholding. It is now read from
    // `julius_context_snapshots`, so "uncited" is a fact about a run that has
    // not compiled one rather than about every run — see the citation suite
    // below, and this, which pins the honest half of the old assertion.
    const uncompiled = await reader.hydrate({ projectId: A, runId: RUN_A2, worldSessionId: null });
    expect(uncompiled?.brain.contentHash).toBe('');
    expect(hydration?.brain.contentHash).not.toBe('');
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

  /* -------------------------------------- the Project Brain, on real rows */

  describe('the Project Brain citation', () => {
    it('cites the LAST compilation, not the first one it finds', async () => {
      // Two compilations exist on this run. Ordered the wrong way round a
      // reader reports a retrieval that has been superseded, and every count
      // on it looks perfectly plausible.
      const hydration = await reader.hydrate({
        projectId: A, runId: RUN_A, worldSessionId: null,
      });
      expect(hydration!.brain.contentHash).toBe('sha256:new');
      expect(hydration!.brain.brainRevision).toBe(4);
      expect(hydration!.brain.characterCount).toBe(4096);
      expect(hydration!.brain.redactionCount).toBe(2);
      expect(hydration!.brain.truncated).toBe(true);
      expect(hydration!.brain.taskId).toBe('task-a1');
    });

    it('counts every cited entry in the total, and only mappable ones in buckets', async () => {
      // Six ids were cited: three of kinds this vocabulary names, two of kernel
      // kinds it does not, and one whose entry row does not exist at all. All
      // six are the retrieval that happened; three of them have a bucket.
      const hydration = await reader.hydrate({
        projectId: A, runId: RUN_A, worldSessionId: null,
      });
      const counts = hydration!.brain.kindCounts;
      expect(hydration!.brain.entryCount).toBe(6);
      expect(counts.DECISION).toBe(2);
      expect(counts.FINDING).toBe(1);
      expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(3);
      // THE GAP IS THE SIGNAL. Six cited, three bucketed: that difference is
      // what says the kernel's vocabulary and the citation's have moved apart,
      // and it is visible without a debugger.
      expect(hydration!.brain.entryCount).toBeGreaterThan(3);
    });

    it('reports a REPORTED ZERO for the kinds this build cannot produce', async () => {
      // `OBJECTIVE`, `REQUIREMENT` and `EVIDENCE` have no source in
      // `julius_brain_entries` at all. Zero is true for them — no entry of
      // that kind reached the packet, because none can exist — and the key
      // being present is what makes it a report rather than an absence.
      const hydration = await reader.hydrate({
        projectId: A, runId: RUN_A, worldSessionId: null,
      });
      for (const kind of ['OBJECTIVE', 'REQUIREMENT', 'EVIDENCE'] as const) {
        expect(Object.keys(hydration!.brain.kindCounts)).toContain(kind);
        expect(hydration!.brain.kindCounts[kind]).toBe(0);
      }
    });

    it('carries no entry text, proven against text that is really in the table', async () => {
      // The canary is on every row this citation read. Its absence here is the
      // SELECT's narrowness working on real data, not a fixture that politely
      // omitted the column.
      const planted = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM relay_wonderland.julius_brain_entries
          WHERE safe_content LIKE $1`, [`%${CANARY}%`]);
      expect(Number(planted.rows[0].n), 'the canary is not actually in the database').toBeGreaterThan(0);

      const hydration = await reader.hydrate({
        projectId: A, runId: RUN_A, worldSessionId: null,
      });
      expect(JSON.stringify(hydration!.brain)).not.toContain(CANARY);
      // And nowhere else in the payload either — a citation is not the only
      // field that could have grown a place to put it.
      expect(JSON.stringify(hydration)).not.toContain(CANARY);
    });

    it('cannot reach another project\'s compilation', async () => {
      // `julius_context_snapshots` has no project_id of its own. The join to
      // `julius_runs` is the only thing scoping this read, and project B has a
      // more recent compilation than project A does.
      const hydration = await reader.hydrate({
        projectId: B, runId: RUN_B, worldSessionId: null,
      });
      expect(hydration!.brain.contentHash).toBe('sha256:foreign');

      // And asking for B's run under A's project returns nothing at all rather
      // than a citation — the run read refuses first, as it must.
      expect(await reader.hydrate({ projectId: A, runId: RUN_B, worldSessionId: null })).toBeNull();
    });

    it('says NOBODY COMPILED for a run that has never compiled one', async () => {
      // Different from "compiled and retrieved nothing", and told apart by the
      // empty hash rather than by the zeroes they share.
      const hydration = await reader.hydrate({
        projectId: A, runId: RUN_A2, worldSessionId: null,
      });
      expect(hydration!.brain.entryCount).toBe(0);
      expect(hydration!.brain.contentHash).toBe('');
      expect(hydration!.brain.observedAtIso).toBe('');
    });

    it('will not cite a compilation made after the snapshot was cut', async () => {
      // A citation from after the hydration's instant describes a retrieval the
      // rest of the payload knows nothing about. The bound is the database's
      // own clock, read in the statement that read the run.
      await pool.query(
        `INSERT INTO relay_wonderland.julius_context_snapshots
           (context_id, run_id, task_id, worker_id, compiler_version, mission_contract_revision,
            card_revision, project_brain_revision, source_entry_ids, content_hash,
            character_count, truncated, created_at, worker_role, redaction_count)
         VALUES ('ctx-a-future','${RUN_A}','task-a1','worker-1','julius-context.v1',1,'card:rev-7',9,
                 '["brain-a1"]','sha256:future',10,false, now() + interval '1 hour','CODING_AGENT',0)`);
      try {
        const hydration = await reader.hydrate({
          projectId: A, runId: RUN_A, worldSessionId: null,
        });
        expect(hydration!.brain.contentHash).toBe('sha256:new');
      } finally {
        await pool.query(
          `DELETE FROM relay_wonderland.julius_context_snapshots WHERE context_id='ctx-a-future'`);
      }
    });
  });

  /* ------------------- the OTHER writer, reading the shared table */

  describe('the battle replay and the Julius ledger share one table', () => {
    it('hands a browser only rows of its OWN vocabulary', async () => {
      // THE DEFECT. `relay_wonderland.events` is shared, and `replay()` selected
      // by project alone. A Julius payload is
      // `{schemaVersion:'relay-julius-event.v1', …}` — no `eventId`, no
      // `eventType`, no `sequence` — and it was cast straight to a
      // WonderlandEvent, so every field a browser surface reads came back
      // undefined. Project A's stream carries rows from both writers, which is
      // what makes this a real read rather than a fixture that agreed.
      const database = new TransactionalWonderlandDatabase(pool);

      // ONE PROPERLY-SHAPED ROW, spelled the way this writer really writes one.
      await pool.query(
        `INSERT INTO relay_wonderland.events
           (event_id, stream_id, project_id, sequence, event_type, visibility, payload, occurred_at)
         VALUES ('world-1',$1,$2,300,'presence.joined','PUBLIC',$3::jsonb,$4)`,
        [RUN_A, A, JSON.stringify({
          eventId: 'world-1', schemaVersion: 'relay-wonderland-event.v1', timestamp: AT,
          projectId: A, sessionId: null, playerId: PLAYER_A, agentId: null, missionId: null,
          battleId: null, eventType: 'presence.joined', payload: {}, visibility: 'PUBLIC',
          correlationId: 'world-1', causationId: null, sequence: 300,
        }), AT],
      );
      try {
        const replayed = await database.replayEvents(A, 0, 1000);

        // NOTHING WITHOUT AN IDENTITY. This is the assertion the defect fails:
        // a Julius payload has no `eventId`, so before the filter this list
        // held objects whose every field was undefined.
        for (const event of replayed) {
          expect(event.eventId, 'a replayed event with no id reached a browser').toBeTruthy();
          expect(event.eventType, 'a replayed event with no type reached a browser').toBeTruthy();
        }
        // Both of this writer's own rows, and neither of the other two shapes.
        expect(replayed.map((e) => e.eventId)).toEqual(['battle-2', 'world-1']);

        // AND THE JULIUS ROWS ARE REALLY THERE, so the filter is doing the work
        // rather than the fixture being empty.
        const julius = await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM relay_wonderland.events
            WHERE project_id=$1 AND event_type LIKE 'julius.%'`, [A]);
        expect(Number(julius.rows[0].n)).toBeGreaterThan(0);
      } finally {
        await pool.query(`DELETE FROM relay_wonderland.events WHERE event_id='world-1'`);
      }
    });

    it('refuses a row from ANY writer that is not this one, not merely Julius', async () => {
      // `battle.round.resolved` is in neither vocabulary — it is a third shape
      // on the shared table, seeded above, and its payload is `{"round":1}`.
      // A `NOT LIKE 'julius.%'` filter would have handed it over; the closed
      // list refuses it. The two vocabularies also OVERLAP — `subagent.spawned`
      // is a member of both, bare here and prefixed there — so any match looser
      // than an exact one has to get that distinction right by accident.
      const database = new TransactionalWonderlandDatabase(pool);
      const replayed = await database.replayEvents(A, 0, 1000);
      expect(replayed.map((e) => e.eventId)).not.toContain('battle-1');

      const present = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM relay_wonderland.events
          WHERE event_id='battle-1'`);
      expect(Number(present.rows[0].n), 'the third-shape row is not actually seeded').toBe(1);
    });
  });

  /* ------------------------- what a person is being waited on for */

  describe('the open human gates', () => {
    it('describes the gates that produced the count, from one statement', () => {
      // Read separately, the number and the list would be two views of a run
      // that answered a gate between them: "2 waiting" beside one gate, with
      // nothing saying which is right.
      return reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null })
        .then((hydration) => {
          expect(hydration!.run.pendingApprovals).toBe(1);
          expect(hydration!.humanGates.length).toBe(1);
          expect(hydration!.humanGates[0].gateId).toBe('appr-a1');
          expect(hydration!.humanGates[0].taskId).toBe('task-a1');
          expect(hydration!.humanGates[0].projectId).toBe(A);
          expect(hydration!.humanGates[0].runId).toBe(RUN_A);
        });
    });

    it('leaves out the approval a person already answered', () => {
      // `appr-a0` is APPROVED on this same run. A world drawn from it would say
      // somebody is being waited on for a decision that has been made.
      return reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null })
        .then((hydration) => {
          expect(hydration!.humanGates.map((g) => g.gateId)).not.toContain('appr-a0');
        });
    });

    it('leaves out gates open on other runs and other projects', () => {
      // `appr-a2-1` is PENDING on a sibling run in the same project, and
      // `appr-b1` is PENDING in the foreign one. Either would tell a world
      // watching run-a that a person is being waited on for something it
      // cannot see.
      return reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null })
        .then((hydration) => {
          const ids = hydration!.humanGates.map((g) => g.gateId);
          expect(ids).not.toContain('appr-a2-1');
          expect(ids).not.toContain('appr-b1');
          expect(ids).toEqual(['appr-a1']);
        });
    });

    it('carries the operation and no sentence from the approval row', () => {
      // `safe_rationale` is a real column on every seeded approval. Its absence
      // here is the SELECT's narrowness working on real data.
      return reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null })
        .then(async (hydration) => {
          const planted = await pool.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM relay_wonderland.julius_approvals
              WHERE run_id=$1 AND safe_rationale <> ''`, [RUN_A]);
          expect(Number(planted.rows[0].n)).toBeGreaterThan(0);

          const gate = hydration!.humanGates[0];
          expect(gate.operation).toBe('MUTATE_FILESYSTEM');
          expect(JSON.stringify(hydration!.humanGates)).not.toContain('waited on');
          expect(JSON.stringify(hydration!.humanGates)).not.toContain(PLAYER_A);
        });
    });

    it('says nothing is gated for a run with no pending approval', () => {
      // RUN_B has one PENDING approval of its own; RUN_A2 has one too. The
      // honest empty case is proven by decidng A2's gate and reading again.
      return pool.query(
        `UPDATE relay_wonderland.julius_approvals
            SET state='APPROVED', decided_at=now(), decided_by=$1, decision_reason='answered'
          WHERE approval_id='appr-a2-1'`, [PLAYER_A],
      ).then(() => reader.hydrate({ projectId: A, runId: RUN_A2, worldSessionId: null }))
        .then(async (hydration) => {
          try {
            expect(hydration!.humanGates).toEqual([]);
            // AND THE COUNT AGREES, because both came from one statement.
            expect(hydration!.run.pendingApprovals).toBe(0);
          } finally {
            await pool.query(
              `UPDATE relay_wonderland.julius_approvals
                  SET state='PENDING', decided_at=NULL, decided_by=NULL, decision_reason=NULL
                WHERE approval_id='appr-a2-1'`);
          }
        });
    });

    it('counts a gate whose operation this build cannot name, and does not draw it', () => {
      // `operation` is free text in the schema. A kernel that grows a
      // fourteenth gated operation must not make a world show one gate fewer —
      // that reads as a run which is merely slower, and a person would never
      // be told they are being waited on.
      return pool.query(
        `INSERT INTO relay_wonderland.julius_approvals
           (approval_id, run_id, project_id, task_id, operation, policy_revision,
            reason_code, safe_rationale, state, requested_at, idempotency_key)
         VALUES ('appr-a-future','${RUN_A}','${A}','task-a2','SUMMON_THE_FOUNDER','card:rev-7',
                 'GATE','A gate from a later kernel.','PENDING', now(), 'idem-a-future')`,
      ).then(() => reader.hydrate({ projectId: A, runId: RUN_A, worldSessionId: null }))
        .then(async (hydration) => {
          try {
            // THE COUNT SEES IT; the list cannot describe it. The difference
            // between them is the report.
            expect(hydration!.run.pendingApprovals).toBe(2);
            expect(hydration!.humanGates.length).toBe(1);
          } finally {
            await pool.query(
              `DELETE FROM relay_wonderland.julius_approvals WHERE approval_id='appr-a-future'`);
          }
        });
    });
  });

  describe('what the reader refuses to claim about a C.A.R.D., on a real row', () => {
    it('carries the revision and nothing derived from it', async () => {
      // `julius_runs.card_revision` is free text with no foreign key, and
      // C.A.R.D. policy is not persisted anywhere. The handle is real; every
      // judgement about the record is null, swarm eligibility included.
      const hydration = await reader.hydrate({
        projectId: A, runId: RUN_A, worldSessionId: null,
      });
      expect(hydration!.card.cardRevision).toBe('card:rev-7');
      expect(hydration!.card.hasPromptArchitect).toBeNull();
      expect(hydration!.card.hasCodingAgent).toBeNull();
      expect(hydration!.card.hasIndependentReviewer).toBeNull();
      expect(hydration!.card.swarmEligible).toBeNull();
      expect(hydration!.card.autonomy).toBeNull();
    });

    it('does not infer a filled slot from the tasks that happen to exist', async () => {
      // run-a HAS a CODING_AGENT task and an INDEPENDENT_REVIEWER task. That is
      // "work of this kind was scheduled", not "the C.A.R.D. fills this slot",
      // and a reader that read the first as the second would be a second
      // authority for a record it has never opened.
      const tasks = await pool.query<{ role: string }>(
        `SELECT role FROM relay_wonderland.julius_tasks WHERE run_id=$1`, [RUN_A]);
      expect(tasks.rows.map((r) => r.role)).toContain('CODING_AGENT');

      const hydration = await reader.hydrate({
        projectId: A, runId: RUN_A, worldSessionId: null,
      });
      expect(hydration!.card.hasCodingAgent).toBeNull();
      expect(hydration!.card.hasIndependentReviewer).toBeNull();
    });
  });
});
