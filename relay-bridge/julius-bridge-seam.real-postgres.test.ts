import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { JuliusClaimPostgresRepository } from '../src/relay/persistence/julius-claim-postgres';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { composeJuliusMissionBootstrap, handleJuliusMissionRoute } from './julius-mission-routes';
import { composeJuliusStateApi, handleJuliusStateRoute, type JuliusStateRoutePorts } from './julius-state-routes';

/**
 * THE WONDERLAND SEAM, AGAINST A REAL POSTGRESQL.
 *
 * `julius-mission-routes.test.ts` proves creation over a recording store and
 * `julius-state-routes.test.ts` proves observation over the in-memory API. Both
 * leave one sentence unproven: that the PRODUCTION compositions — the two
 * repositories the create route binds and the runtime store the read routes
 * bind — agree about a run in a real database. That is the sentence Wonderland
 * depends on: what a client creates is what a client then watches, and both are
 * what the database holds. This suite says it against PostgreSQL itself.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database — the same
 * gate as the other real-postgres suites, and deliberately NOT `DATABASE_URL`,
 * which on a developer machine points at the persistent store — and is `todo`
 * everywhere else, so an absent database is a skipped proof rather than a
 * passing one. Every mission it creates carries a random identity, so it can be
 * re-run against a database that already holds its earlier runs.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;

const nonce = () => randomBytes(4).toString('hex');

function contractFor(id: string, testCommand = '') {
  return {
    missionId: `mission:seam-${id}`, markerNamespace: `seam-${id}`, projectId: `prj-seam-${id}`, tenantId: `tenant-seam-${id}`,
    objective: 'Write a comparison of the three candidate save-file formats.',
    requirements: ['Compare size, load time and forward compatibility.'],
    constraints: ['Touch only docs/.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
    testCommand,
    workspacePath: '/workspace/seam',
    limits: { spendUsd: 2, repairCycles: 1 },
  };
}

type Envelope = { data?: unknown; error?: { kind: string; message: string } };
const dataOf = <T,>(result: { body: unknown } | null): T => {
  const body = result?.body as Envelope;
  expect(body.error, `expected data, got ${JSON.stringify(body.error)}`).toBeUndefined();
  return body.data as T;
};

suite('the Wonderland seam over a real PostgreSQL', () => {
  let pool: Pool;
  let statePorts: JuliusStateRoutePorts;
  let create: (body: string) => Promise<{ status: number; body: unknown } | null>;
  let createRerun: (body: string, rerunKey?: string) => Promise<{ status: number; body: unknown } | null>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    // THE PRODUCTION COMPOSITIONS, exactly as the server builds them.
    const bootstrap = composeJuliusMissionBootstrap(pool);
    statePorts = { api: composeJuliusStateApi(pool), missingConfig: [] };
    const ports = { bootstrap, missingConfig: [], reviewerProvider: 'xai', cardRevision: 'card:seam:1' };
    create = (body) => handleJuliusMissionRoute({ method: 'POST', path: '/julius/missions', operator: true, body }, ports);
    createRerun = (body, rerunKey) => handleJuliusMissionRoute(
      { method: 'POST', path: '/julius/missions', operator: true, body, rerun: 'explicit', ...(rerunKey === undefined ? {} : { rerunKey }) }, ports);
  });
  afterAll(async () => pool?.end());

  const read = (path: string, contract: { projectId: string; tenantId: string }) =>
    handleJuliusStateRoute({ method: 'GET', path, operator: true, projectId: contract.projectId, tenantId: contract.tenantId }, statePorts);

  it('what a client creates is what a client then watches, and both are what the database holds', async () => {
    const contract = contractFor(nonce());
    const created = dataOf<{ runId: string; state: string; dispatched: boolean }>(await create(JSON.stringify(contract)));
    expect(created.state).toBe('READY');
    expect(created.dispatched).toBe(false);

    // THE DATABASE, asked directly: one run, in the state the route reported.
    const rows = await pool.query<{ state: string; mission_id: string; project_id: string }>(
      'SELECT state, mission_id, project_id FROM relay_wonderland.julius_runs WHERE run_id = $1', [created.runId]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toEqual({ state: 'READY', mission_id: contract.missionId, project_id: contract.projectId });
    const contracts = await pool.query('SELECT 1 FROM relay_wonderland.julius_task_contracts WHERE run_id = $1', [created.runId]);
    expect(contracts.rowCount, 'the build’s task contract is durable before the run is READY').toBeGreaterThanOrEqual(1);

    // THE READ ROUTES, through the runtime store: the same run, the same state.
    const run = dataOf<{ runId: string; state: string; missionId: string }>(await read(`/julius/runs/${created.runId}/run`, contract));
    expect(run.runId).toBe(created.runId);
    expect(run.state).toBe('READY');
    expect(run.missionId).toBe(contract.missionId);

    const tasks = dataOf<ReadonlyArray<{ taskType: string; state: string; role: string }>>(await read(`/julius/runs/${created.runId}/tasks`, contract));
    expect(tasks.map((task) => [task.taskType, task.state])).toEqual([['plan', 'RUNNABLE'], ['build', 'BLOCKED']]);

    // THE VIEW WONDERLAND EXISTS FOR: three peers, none of them dispatched, and
    // a cost that is not pretended to be zero.
    const slots = dataOf<ReadonlyArray<{ role: string; state: string; dispatches: number; servedModel: string | null; costComplete: boolean }>>(
      await read(`/julius/runs/${created.runId}/slots`, contract));
    expect(slots.map((slot) => slot.role)).toEqual(['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER']);
    for (const slot of slots) {
      expect(slot.state, 'nobody has been driven yet').toBe('NEVER_DISPATCHED');
      expect(slot.dispatches).toBe(0);
      expect(slot.servedModel, 'no model has answered, so none may be shown').toBeNull();
    }

    // THE RESULT OF A RUN NOBODY HAS DRIVEN, which must not look like a result.
    // This is the state Wonderland sees between creating a mission and the job
    // picking it up, and it is exactly where a client could be misled.
    const result = dataOf<{
      verified: boolean; terminal: boolean; deliverables: unknown[];
      criteria: ReadonlyArray<{ satisfied: boolean }>; failure: unknown;
      cost: { knownUsdMicros: number; unknownComponents: number; complete: boolean };
    }>(await read(`/julius/runs/${created.runId}/result`, contract));
    expect(result.verified, 'a READY run is not a verified result').toBe(false);
    expect(result.terminal, 'and it is not finished either').toBe(false);
    expect(result.deliverables, 'nothing has been produced yet').toEqual([]);
    expect(result.criteria.length, 'the mission’s criteria are already known').toBeGreaterThan(0);
    expect(result.criteria.every((criterion) => !criterion.satisfied), 'and none is satisfied yet').toBe(true);
    expect(result.failure, 'an undriven run has not failed').toBeNull();
    expect(result.cost.knownUsdMicros, 'and has cost nothing').toBe(0);
    expect(result.cost.complete, 'a run with no dispatch has a complete cost of zero, which is true').toBe(true);

    const page = dataOf<{ entries: ReadonlyArray<{ sequence: number }>; hasMore: boolean }>(await read(`/julius/runs/${created.runId}/timeline`, contract));
    expect(page.entries.length, 'the bootstrap transitions are on the durable timeline').toBeGreaterThanOrEqual(1);
    // ORDERED BY SEQUENCE, the client rule the contract states — never by time.
    for (let i = 1; i < page.entries.length; i += 1) expect(page.entries[i]!.sequence).toBeGreaterThan(page.entries[i - 1]!.sequence);
  });

  it('re-posting the same contract resumes the same run instead of creating a second one', async () => {
    const contract = contractFor(nonce());
    const first = dataOf<{ runId: string }>(await create(JSON.stringify(contract)));
    const second = dataOf<{ runId: string; state: string }>(await create(JSON.stringify(contract)));
    expect(second.runId).toBe(first.runId);
    expect(second.state, 'the state the store holds, not an asserted READY').toBe('READY');
    const count = await pool.query('SELECT count(*)::int AS n FROM relay_wonderland.julius_runs WHERE mission_id = $1', [contract.missionId]);
    expect(count.rows[0].n).toBe(1);
  });

  it('refuses a second, DIFFERENT run of a mission that is still in flight — and an explicit rerun is allowed', async () => {
    // The guard where it actually has to hold: inside the run-creating
    // transaction, on the real table, with the real terminal-state list.
    const contract = contractFor(nonce());
    const first = dataOf<{ runId: string }>(await create(JSON.stringify(contract)));
    const edited = JSON.stringify({ ...contract, objective: 'Compare only the two formats we ship.' });

    const refused = await create(edited);
    expect(refused?.status).toBe(409);
    expect((refused?.body as { error: { kind: string; message: string } }).error.kind).toBe('mission_run_already_active');
    expect((refused?.body as { error: { message: string } }).error.message).toContain(first.runId);
    // NOTHING WAS WRITTEN: one run for this mission, still.
    const afterRefusal = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_runs WHERE mission_id = $1', [contract.missionId]);
    expect(afterRefusal.rows[0]!.n).toBe(1);

    const rerun = dataOf<{ runId: string; rerun: boolean }>(await createRerun(edited, 'rerun-edited-1'));
    expect(rerun.runId).not.toBe(first.runId);
    expect(rerun.rerun).toBe(true);
    const afterRerun = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_runs WHERE mission_id = $1', [contract.missionId]);
    expect(afterRerun.rows[0]!.n, 'two runs, because two were asked for').toBe(2);
  });

  it('an explicit rerun of an UNCHANGED contract runs it again — the case a content-derived identity could not express', async () => {
    // The integration lane's D09: run identity is the contract's digest, so "do
    // that again, exactly" named the run that had already finished and the client
    // was handed a terminal run and told it was created. An explicit rerun now
    // folds a discriminator into that identity.
    const contract = contractFor(nonce());
    const body = JSON.stringify(contract);
    const first = dataOf<{ runId: string; rerun: boolean }>(await create(body));
    expect(first.rerun).toBe(false);

    // A plain re-POST still resumes: the same bytes, the same run, and it says so.
    const resumed = dataOf<{ runId: string; rerun: boolean }>(await create(body));
    expect(resumed.runId).toBe(first.runId);
    expect(resumed.rerun, 'no second run was made, so none is reported').toBe(false);

    // The run ends. An explicit rerun of the SAME bytes now makes a new run.
    await pool.query("UPDATE relay_wonderland.julius_runs SET state = 'CANCELLED' WHERE run_id = $1", [first.runId]);
    const rerun = dataOf<{ runId: string; rerun: boolean; state: string; next: string }>(await createRerun(body, 'rerun-after-cancel'));
    expect(rerun.runId, 'a distinct run, from the same contract').not.toBe(first.runId);
    expect(rerun.rerun).toBe(true);
    expect(rerun.state).toBe('READY');

    // AND ITS RETRIES ARE SAFE, because the KEY identifies the rerun: the same
    // request again lands on the same run rather than minting a third.
    const retried = dataOf<{ runId: string; rerun: boolean }>(await createRerun(body, 'rerun-after-cancel'));
    expect(retried.runId).toBe(rerun.runId);
    expect(retried.rerun, 'a retry made nothing, so it reports nothing').toBe(false);
    const rows = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_runs WHERE mission_id = $1', [contract.missionId]);
    expect(rows.rows[0]!.n, 'two runs: the original and the one rerun').toBe(2);
  });

  it('an explicit rerun without a key of its own is refused, rather than served unsafely', async () => {
    // Nothing derived from durable state can identify a rerun: the rerun changes
    // that state as it lands, so the retry would compute a different identity and
    // buy a third execution. The caller holds the only stable value.
    const contract = contractFor(nonce());
    const body = JSON.stringify(contract);
    await create(body);
    const refused = await createRerun(body);
    expect(refused?.status).toBe(400);
    expect((refused?.body as { error: { kind: string; message: string } }).error.kind).toBe('rerun_key_required');
    expect((refused?.body as { error: { message: string } }).error.message).toContain('one stable token');
    const rows = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_runs WHERE mission_id = $1', [contract.missionId]);
    expect(rows.rows[0]!.n, 'and nothing was created').toBe(1);
  });

  it('a terminal run is never described as being driven', async () => {
    // A 201 that says "it is driven by the mission job" over a run that has
    // already ended reads as "created and going".
    const contract = contractFor(nonce());
    const body = JSON.stringify(contract);
    const first = dataOf<{ runId: string }>(await create(body));
    await pool.query("UPDATE relay_wonderland.julius_runs SET state = 'COMPLETED' WHERE run_id = $1", [first.runId]);
    const again = dataOf<{ state: string; next: string; rerun: boolean }>(await create(body));
    expect(again.state).toBe('COMPLETED');
    expect(again.next).toContain('already ended');
    expect(again.next).not.toContain('driven by');
  });

  it('a caller’s own rerun key makes its retries idempotent, and a new key makes a new run', async () => {
    const contract = contractFor(nonce());
    const body = JSON.stringify(contract);
    const first = dataOf<{ runId: string }>(await create(body));
    const one = dataOf<{ runId: string; rerun: boolean }>(await createRerun(body, 'rerun-token-1'));
    expect(one.runId).not.toBe(first.runId);
    expect(one.rerun).toBe(true);
    // The same token again: the same run, nothing made.
    expect(dataOf<{ runId: string; rerun: boolean }>(await createRerun(body, 'rerun-token-1')).runId).toBe(one.runId);
    // A different token: a deliberate third run. (Allowed because an explicit
    // rerun is exactly the case where the active-run guard steps aside.)
    const two = dataOf<{ runId: string; rerun: boolean }>(await createRerun(body, 'rerun-token-2'));
    expect(two.runId).not.toBe(one.runId);
    expect(two.rerun).toBe(true);
  });

  it('a mission whose run reached a TERMINAL state is not locked, and the guard is per mission', async () => {
    const contract = contractFor(nonce());
    const first = dataOf<{ runId: string }>(await create(JSON.stringify(contract)));
    // Another mission is unaffected while this one is live.
    const other = contractFor(nonce());
    expect(dataOf<{ runId: string }>(await create(JSON.stringify(other))).runId).not.toBe(first.runId);

    // The first run ends. A new, different run of that mission is then ordinary
    // work: no rerun intent required, because nothing is in flight.
    await pool.query("UPDATE relay_wonderland.julius_runs SET state = 'COMPLETED' WHERE run_id = $1", [first.runId]);
    const next = dataOf<{ runId: string }>(await create(JSON.stringify({ ...contract, objective: 'Now compare the fourth format too.' })));
    expect(next.runId).not.toBe(first.runId);
  });

  it('two identical requests racing produce exactly one run — the loser is told to retry, never given a second', async () => {
    // A duplicate is the SAME bytes, and its idempotency key is those bytes, so
    // there is one run to be had. What the LOSER of the race is told is the
    // honest part: a whole bootstrap is many writes (the mission's base rows,
    // criteria, brain, two tasks, the task contract, two transitions), all of
    // them SERIALIZABLE, so a concurrent twin loses one of them and is answered
    // `bootstrap_persistence_failure`, retryable — not a second run, and not a
    // pretence that it created one. Its retry then finds the run and succeeds.
    const contract = contractFor(nonce());
    const body = JSON.stringify(contract);
    const [a, b] = await Promise.all([create(body), create(body)]);

    const answers = [a, b].map((result) => result?.body as Envelope);
    const created = answers.filter((answer) => answer.data !== undefined);
    expect(created.length, 'at least one caller was answered with the run').toBeGreaterThanOrEqual(1);
    for (const answer of answers) {
      if (answer.data !== undefined) continue;
      // The only failure a duplicate may be told, and it must say try again.
      expect(answer.error?.kind).toBe('bootstrap_persistence_failure');
    }
    const runIds = new Set(created.map((answer) => (answer.data as { runId: string }).runId));
    expect(runIds.size, 'one run id, whichever callers saw it').toBe(1);

    // THE DATABASE IS THE ARBITER: one run, one plan, one build. No second
    // execution exists to be dispatched, so nothing can be billed twice.
    const rows = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_runs WHERE mission_id = $1', [contract.missionId]);
    expect(rows.rows[0]!.n).toBe(1);
    const runId = [...runIds][0]!;
    const tasks = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM relay_wonderland.julius_tasks WHERE run_id = $1', [runId]);
    expect(tasks.rows[0]!.n).toBe(2);

    // AND THE RETRY PATH WORKS: posting the same bytes again is answered with
    // the one run, so a client that lost the race recovers by doing nothing
    // cleverer than trying again.
    expect(dataOf<{ runId: string }>(await create(body)).runId).toBe(runId);
  });

  it('what mission A VERIFIED is inherited by mission B — and what A only asserted is not', async () => {
    // The founder's item: verified useful information from mission A must improve
    // a later relevant mission. This is the durable half — that B's Project Brain
    // really holds A's verified fact, with A's author and A's standing, and holds
    // nothing A merely asserted. The packet half (that B's worker is HANDED it,
    // and that unrelated residue is excluded) is `julius-learning-loop.e2e`.
    const id = nonce();
    const missionA = contractFor(id);
    const runA = dataOf<{ runId: string }>(await create(JSON.stringify(missionA))).runId;

    // MISSION A LEARNS TWO THINGS. One a reviewer verifies; one stays an
    // assertion. Written the way the runtime writes them: a brain row authored
    // by a worker, and a claim standing recorded for it.
    const claims = new JuliusClaimPostgresRepository(pool);
    const facts = [
      { entryId: `${runA}:verified`, text: 'The save format must be written little-endian; the loader rejects big-endian.', trust: 'VERIFIED' as const },
      { entryId: `${runA}:asserted`, text: 'The loader is probably fine with either byte order.', trust: 'UNVERIFIED' as const },
    ];
    for (const [index, fact] of facts.entries()) {
      await pool.query(
        `INSERT INTO relay_wonderland.julius_brain_entries
           (entry_id,run_id,project_id,task_id,worker_id,entry_kind,safe_content,evidence_ids,revision,created_at)
         VALUES($1,$2,$3,NULL,'coder','FINDING',$4,'["evidence:a-1"]',$5,now())`,
        [fact.entryId, runA, missionA.projectId, fact.text, 50 + index],
      );
      await claims.recordClaimStanding({
        runId: runA, projectId: missionA.projectId,
        claim: {
          claimId: `claim:${fact.entryId}`, entryId: fact.entryId, provenance: 'tool_observed',
          trust: fact.trust, assertedBy: 'coder', assertedAt: '2026-09-27T09:00:00.000Z',
          evidence: [{ kind: 'REVIEW', id: 'evidence:review-a' }], supersedes: null, contradicts: [],
        },
        reason: fact.trust === 'VERIFIED' ? 'REVIEW_ACCEPTED' : 'ADMITTED',
        occurredAt: '2026-09-27T09:00:00.000Z',
      });
    }

    // MISSION B, a different mission in the same project, created the ordinary way.
    const missionB = { ...contractFor(nonce()), projectId: missionA.projectId, tenantId: missionA.tenantId };
    const runB = dataOf<{ runId: string }>(await create(JSON.stringify(missionB))).runId;

    const inherited = await pool.query<{ entry_id: string; safe_content: string; worker_id: string }>(
      'SELECT entry_id, safe_content, worker_id FROM relay_wonderland.julius_brain_entries WHERE run_id = $1 AND entry_id LIKE $2',
      [runB, 'carried:%']);
    expect(inherited.rows.map((row) => row.safe_content), 'the verified fact, and only it').toEqual([facts[0]!.text]);
    // THE COPY KEEPS ITS AUTHOR: attributing it to the bootstrap would both
    // slander the worker and let B's reviewer "verify" Julius's own words.
    expect(inherited.rows[0]!.worker_id).toBe('coder');
    expect(inherited.rows[0]!.entry_id).toBe(`carried:${runA}:${facts[0]!.entryId}`);

    // AND THE STANDING TRAVELLED, so B ranks a verified fact as verified.
    const carriedClaims = await claims.claimsForRun(runB, missionB.projectId);
    const carried = carriedClaims.find((claim) => claim.entryId.startsWith('carried:'));
    expect(carried?.trust).toBe('VERIFIED');
    expect(carried?.assertedBy, 'A’s asserter, so B’s reviewer cannot self-verify it').toBe('coder');
    const history = await claims.claimStandingHistory(carried!.claimId, missionB.projectId);
    expect(history, 'one standing, recorded once').toHaveLength(1);

    // A REPLAY INHERITS NOTHING TWICE.
    await create(JSON.stringify(missionB));
    const again = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM relay_wonderland.julius_brain_entries WHERE run_id = $1 AND entry_id LIKE $2', [runB, 'carried:%']);
    expect(again.rows[0]!.n).toBe(1);
  });

  it('knowledge does not cross projects', async () => {
    const id = nonce();
    const missionA = contractFor(id);
    const runA = dataOf<{ runId: string }>(await create(JSON.stringify(missionA))).runId;
    const claims = new JuliusClaimPostgresRepository(pool);
    await pool.query(
      `INSERT INTO relay_wonderland.julius_brain_entries
         (entry_id,run_id,project_id,task_id,worker_id,entry_kind,safe_content,evidence_ids,revision,created_at)
       VALUES($1,$2,$3,NULL,'coder','FINDING','A fact that belongs to one project.','[]',60,now())`,
      [`${runA}:private`, runA, missionA.projectId]);
    await claims.recordClaimStanding({
      runId: runA, projectId: missionA.projectId,
      claim: {
        claimId: `claim:${runA}:private`, entryId: `${runA}:private`, provenance: 'tool_observed',
        trust: 'VERIFIED', assertedBy: 'coder', assertedAt: '2026-09-27T09:00:00.000Z',
        evidence: [{ kind: 'REVIEW', id: 'evidence:review-a' }], supersedes: null, contradicts: [],
      },
      reason: 'REVIEW_ACCEPTED', occurredAt: '2026-09-27T09:00:00.000Z',
    });

    // A mission in ANOTHER project inherits nothing of it.
    const elsewhere = contractFor(nonce());
    const runElsewhere = dataOf<{ runId: string }>(await create(JSON.stringify(elsewhere))).runId;
    const rows = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM relay_wonderland.julius_brain_entries WHERE run_id = $1 AND entry_id LIKE $2', [runElsewhere, 'carried:%']);
    expect(rows.rows[0]!.n).toBe(0);
  });

  it('a created run is invisible under another project, and a no-check mission is held to its DIFF', async () => {
    const contract = contractFor(nonce());
    const created = dataOf<{ runId: string }>(await create(JSON.stringify(contract)));
    const foreign = await read(`/julius/runs/${created.runId}/run`, { projectId: 'prj-someone-else', tenantId: contract.tenantId });
    expect(foreign?.status, 'scope is enforced by the store, not by the route').toBe(404);

    const build = await pool.query<{ required_evidence_types: unknown }>(
      "SELECT required_evidence_types FROM relay_wonderland.julius_tasks WHERE run_id = $1 AND task_type = 'build'", [created.runId]);
    expect(build.rows[0]?.required_evidence_types).toEqual(['DIFF']);

    const checked = contractFor(nonce(), 'npm test');
    const createdChecked = dataOf<{ runId: string }>(await create(JSON.stringify(checked)));
    const checkedBuild = await pool.query<{ required_evidence_types: unknown }>(
      "SELECT required_evidence_types FROM relay_wonderland.julius_tasks WHERE run_id = $1 AND task_type = 'build'", [createdChecked.runId]);
    expect(checkedBuild.rows[0]?.required_evidence_types).toEqual(['TEST']);
  });
});
