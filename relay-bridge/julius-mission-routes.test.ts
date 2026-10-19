import { beforeEach, describe, expect, it } from 'vitest';

import type { JuliusBootstrapPort } from '../src/relay/integration/julius/julius-port';
import { juliusMissionActiveError } from '../src/relay/persistence/julius-postgres';
import { createLiveJuliusBootstrapPort, buildTaskId, planTaskId } from './julius/bootstrap';
import type { MissionSeedStore } from './julius/mission-seed';
import {
  handleJuliusMissionRoute, isJuliusMissionRoute, missionWorkerRequests,
  type JuliusMissionRoutePorts, type JuliusMissionRouteRequest,
} from './julius-mission-routes';

/**
 * CREATION OVER HTTP, HELD TO WHAT IT PROMISES AND WHAT IT DISCLAIMS.
 *
 * The route is the bootstrap and nothing more, so these cases run it over the
 * REAL bootstrap port — `createLiveJuliusBootstrapPort`, the one the mission job
 * uses — with the store replaced by fakes that record every write. A route test
 * over a fake port would prove the mapping and nothing about what a client's
 * contract becomes in the store; this proves the run, the tasks, the contract
 * and the seed brain that a durable database would hold.
 *
 * The other half is what the route refuses to do. It creates nothing without an
 * operator, without a database, without a named reviewer provider, or from a
 * contract the contract file's own parser would refuse — and it never reports a
 * run as running, because it never runs one.
 */

const CONTRACT = {
  missionId: 'mission:wonderland-1', markerNamespace: 'wonderland-one', projectId: 'prj-wonderland', tenantId: 'tenant-w',
  objective: 'Write a comparison of the three candidate save-file formats.',
  requirements: ['Compare size, load time and forward compatibility.'],
  constraints: ['Touch only docs/.'],
  acceptanceCriteria: [{ id: 'AC-1', text: 'The comparison exists and covers all three.', blocking: true }],
  testCommand: '',
  workspacePath: '/workspace/wonderland',
  limits: { spendUsd: 2, repairCycles: 1 },
};

function fakeSeeds(calls: string[]): MissionSeedStore {
  return {
    async ensureBase(seed) { calls.push(`ensureBase:${seed.executionId}:${seed.tenantId}:${seed.missionId}`); },
    async insertCriteria(runId, criteria) { calls.push(`criteria:${runId}:${criteria.length}`); },
    async insertBrainEntries(runId, _projectId, entries) { calls.push(`brain:${runId}:${entries.length}`); },
  };
}

/**
 * THE ACTIVE-RUN LEDGER THE REAL STORE KEEPS, as little of it as these cases
 * need: which missions hold a non-terminal run, and under which runId. The
 * refusal is raised the way PostgreSQL raises it — thrown from inside the
 * create, with the holding run named — so the port's handling is the real one.
 */
const activeRuns = new Map<string, { readonly runId: string; readonly state: string }>();

function fakeRuns(calls: Array<Record<string, unknown>>) {
  let version = 0;
  return {
    async loadRun() { return null; },
    async createRun(input: { runId: string; missionId: string; projectId: string; refuseIfMissionActive?: boolean }) {
      const key = `${input.projectId}/${input.missionId}`;
      const held = activeRuns.get(key);
      if (input.refuseIfMissionActive === true && held !== undefined && held.runId !== input.runId) {
        throw juliusMissionActiveError(held.runId, held.state);
      }
      activeRuns.set(key, { runId: input.runId, state: 'READY' });
      version = 1; calls.push({ createRun: input }); return { runId: input.runId, state: 'CREATED', version };
    },
    async addTask(input: { task: { taskId: string; requiredEvidenceTypes: readonly string[] } }) { calls.push({ addTask: input.task }); return true; },
    async transition(input: { to: string }) { version += 1; calls.push({ transition: input.to }); return { state: input.to, version }; },
    async putTaskContract(input: { contract: { taskId: string; requiredEvidence: readonly string[] } }) {
      calls.push({ putTaskContract: input.contract }); return true;
    },
  };
}

interface Stage {
  readonly ports: JuliusMissionRoutePorts;
  readonly seedCalls: string[];
  readonly runCalls: Array<Record<string, unknown>>;
  /** The (executionId, tenantId) pairs the route asked a port for. */
  readonly composed: Array<readonly [string, string]>;
}

function stage(over: Partial<JuliusMissionRoutePorts> = {}): Stage {
  const seedCalls: string[] = [];
  const runCalls: Array<Record<string, unknown>> = [];
  const composed: Array<readonly [string, string]> = [];
  const bootstrap = (executionId: string, tenantId: string): JuliusBootstrapPort => {
    composed.push([executionId, tenantId]);
    return createLiveJuliusBootstrapPort({
      runs: fakeRuns(runCalls) as never, seeds: fakeSeeds(seedCalls), tenantId, executionId,
      now: () => '2026-09-27T12:00:00.000Z',
    });
  };
  return {
    ports: { bootstrap, missingConfig: [], reviewerProvider: 'xai', cardRevision: 'card:test:1', ...over },
    seedCalls, runCalls, composed,
  };
}

const post = (body: string | undefined, over: Partial<JuliusMissionRouteRequest> = {}): JuliusMissionRouteRequest =>
  ({ method: 'POST', path: '/julius/missions', operator: true, body, ...over });

const errorOf = (result: { body: unknown } | null) => (result?.body as { error: { kind: string; message: string } }).error;
const dataOf = <T = { runId: string; state: string; missionId: string; projectId: string; dispatched: boolean; rerun: boolean; next: string },>(
  result: { body: unknown } | null,
): T => (result?.body as { data: T }).data;

describe('POST /julius/missions', () => {
  // THE STORE IS FRESH PER CASE. `activeRuns` models a durable ledger, so one
  // case's live mission would otherwise refuse the next case's create — which is
  // the guard working, in the wrong place.
  beforeEach(() => activeRuns.clear());

  it('serves exactly one path, and answers null for every other', async () => {
    expect(isJuliusMissionRoute('/julius/missions')).toBe(true);
    expect(isJuliusMissionRoute('/julius/missions/')).toBe(false);
    expect(isJuliusMissionRoute('/julius/runs/run:1/run')).toBe(false);
    const s = stage();
    expect(await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT), { path: '/julius/runs/run:1/run' }), s.ports)).toBeNull();
    expect(s.runCalls).toEqual([]);
  });

  it('refuses every method but POST, before reading anything', async () => {
    const s = stage();
    const result = await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT), { method: 'GET' }), s.ports);
    expect(result?.status).toBe(405);
    expect(s.composed).toEqual([]);
  });

  it('refuses a caller that is not the operator, and creates nothing', async () => {
    const s = stage();
    const result = await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT), { operator: false }), s.ports);
    expect(result?.status).toBe(401);
    expect(errorOf(result).kind).toBe('operator_required');
    expect(s.composed, 'no port was even composed').toEqual([]);
    expect(s.runCalls).toEqual([]);
  });

  it('answers 503 naming the variable when this process has no database, and creates nothing', async () => {
    const s = stage({ bootstrap: null, missingConfig: ['DATABASE_URL'] });
    const result = await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT)), s.ports);
    expect(result?.status).toBe(503);
    expect(errorOf(result).kind).toBe('julius_state_unavailable');
    expect(errorOf(result).message).toContain('DATABASE_URL');
    expect(errorOf(result).message).toContain('No run was created');
  });

  it('refuses when the reviewer’s independence group is not configured, rather than guessing one', async () => {
    const s = stage({ reviewerProvider: null });
    const result = await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT)), s.ports);
    expect(result?.status).toBe(503);
    expect(errorOf(result).kind).toBe('reviewer_provider_unknown');
    expect(errorOf(result).message).toContain('RELAY_HERMES_PROVIDER');
    expect(s.composed).toEqual([]);
  });

  it('requires a body', async () => {
    const s = stage();
    for (const body of [undefined, '', '   ']) {
      const result = await handleJuliusMissionRoute(post(body), s.ports);
      expect(result?.status).toBe(400);
      expect(errorOf(result).kind).toBe('contract_required');
    }
    expect(s.composed).toEqual([]);
  });

  it('refuses a contract the contract file’s own parser refuses, in the parser’s words', async () => {
    const s = stage();
    const { testCommand: _omitted, ...withoutCheck } = CONTRACT;
    const cases: Array<[string, string]> = [
      ['not json', 'not valid JSON'],
      [JSON.stringify(withoutCheck), '"testCommand"'],
      [JSON.stringify({ ...CONTRACT, acceptanceCriteria: [] }), 'acceptanceCriteria'],
      [JSON.stringify({ ...CONTRACT, markerNamespace: 'Not Valid!' }), '"markerNamespace"'],
    ];
    for (const [body, words] of cases) {
      const result = await handleJuliusMissionRoute(post(body), s.ports);
      expect(result?.status, body).toBe(400);
      expect(errorOf(result).kind).toBe('malformed_mission_contract');
      expect(errorOf(result).message, body).toContain(words);
    }
    expect(s.composed, 'a refused contract never reaches the store').toEqual([]);
  });

  it('maps a refusal from the bootstrap port itself to the caller, with the port’s own reason', async () => {
    const s = stage();
    const body = JSON.stringify({ ...CONTRACT, acceptanceCriteria: [{ id: 'AC-1', text: 'Advisory only.', blocking: false }] });
    const result = await handleJuliusMissionRoute(post(body), s.ports);
    expect(result?.status).toBe(400);
    expect(errorOf(result).kind).toBe('blocking_acceptance_criterion_missing');
    expect(s.runCalls, 'the port refused before writing').toEqual([]);
  });

  it('creates the run through the real bootstrap: run, criteria, brain, plan→build tasks, task contract, READY', async () => {
    const s = stage();
    const result = await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT)), s.ports);
    expect(result?.status).toBe(201);
    const data = dataOf(result);
    expect(data.state).toBe('READY');
    expect(data.missionId).toBe(CONTRACT.missionId);
    expect(data.projectId).toBe(CONTRACT.projectId);
    expect(data.runId.startsWith('run:')).toBe(true);

    // THE SAME EXECUTION IDENTITY THE JOB DERIVES, so a mission created here
    // and then driven by the job is one execution, and the same tenant.
    expect(s.composed).toEqual([[`execution:julius-live:${CONTRACT.missionId}`, CONTRACT.tenantId]]);
    expect(s.seedCalls[0]).toBe(`ensureBase:execution:julius-live:${CONTRACT.missionId}:${CONTRACT.tenantId}:${CONTRACT.missionId}`);
    expect(s.seedCalls).toContain(`criteria:${data.runId}:1`);
    // objective + 1 requirement + 1 constraint + the criteria digest
    expect(s.seedCalls).toContain(`brain:${data.runId}:4`);

    const created = s.runCalls.find((call) => 'createRun' in call)?.createRun as { missionId: string; projectId: string };
    expect(created.missionId).toBe(CONTRACT.missionId);
    expect(created.projectId).toBe(CONTRACT.projectId);
    const tasks = s.runCalls.filter((call) => 'addTask' in call).map((call) => call.addTask as { taskId: string; requiredEvidenceTypes: readonly string[] });
    expect(tasks.map((task) => task.taskId)).toEqual([planTaskId(data.runId), buildTaskId(data.runId)]);
    expect(s.runCalls.filter((call) => 'transition' in call).map((call) => call.transition)).toEqual(['PLANNING', 'READY']);
    const contract = s.runCalls.find((call) => 'putTaskContract' in call)?.putTaskContract as { taskId: string };
    expect(contract.taskId).toBe(buildTaskId(data.runId));
  });

  it('carries the no-check declaration through: a mission with an empty testCommand is held to its DIFF', async () => {
    // The same derivation the job's bootstrap makes, reached over HTTP — so a
    // report mission created by a client is not parked in VERIFYING for
    // lacking a test it never declared.
    const s = stage();
    const result = await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT)), s.ports);
    const build = s.runCalls.map((call) => call.addTask as { taskId: string; requiredEvidenceTypes: readonly string[] } | undefined)
      .find((task) => task?.taskId === buildTaskId(dataOf(result).runId))!;
    expect(build.requiredEvidenceTypes).toEqual(['DIFF']);

    const checked = stage();
    // A DISTINCT MISSION, because this case is about the TEST/DIFF derivation and
    // not about mission identity: the same missionId with a changed contract is
    // now refused while the first run is alive, which is a different case below.
    const withCheck = await handleJuliusMissionRoute(
      post(JSON.stringify({ ...CONTRACT, missionId: 'mission:wonderland-checked', markerNamespace: 'wonderland-checked', testCommand: 'npm test' })),
      checked.ports,
    );
    const checkedBuild = checked.runCalls.map((call) => call.addTask as { taskId: string; requiredEvidenceTypes: readonly string[] } | undefined)
      .find((task) => task?.taskId === buildTaskId(dataOf(withCheck).runId))!;
    expect(checkedBuild.requiredEvidenceTypes).toEqual(['TEST']);
  });

  it('says on the wire that nothing was dispatched, and reports the port’s state rather than asserting READY', async () => {
    const s = stage();
    const data = dataOf(await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT)), s.ports));
    expect(data.dispatched).toBe(false);
    expect(data.next).toContain('driven by the Julius mission job');

    // A REPLAYED CONTRACT is answered with the run that already exists, in the
    // state it has really reached — here the port reports what the store
    // holds, and the route repeats it rather than saying READY.
    const replay: JuliusBootstrapPort = {
      portVersion: 'test',
      async submit() { return { accepted: true, runId: 'run:existing', acceptedAt: 'now', state: 'COMPLETED' }; },
    } as unknown as JuliusBootstrapPort;
    const replayed = dataOf(await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT)), { ...s.ports, bootstrap: () => replay }));
    expect(replayed.runId).toBe('run:existing');
    expect(replayed.state).toBe('COMPLETED');
    expect(replayed.next).toContain('COMPLETED');
    expect(replayed.next).not.toContain('READY');
  });

  it('refuses a SECOND, different run of a mission that is still in flight, and names the run that holds it', async () => {
    // The accident this exists for: an operator edits a draft and posts again
    // while the first run is alive. Two paid executions of one mission is never
    // what that meant, so it is refused — with the live runId in the message,
    // because the client's next move is to follow that run.
    const s = stage();
    const first = dataOf(await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT)), s.ports));
    expect(first.state).toBe('READY');

    const edited = { ...CONTRACT, objective: 'Compare only the two formats we actually ship.' };
    const refused = await handleJuliusMissionRoute(post(JSON.stringify(edited)), s.ports);
    expect(refused?.status).toBe(409);
    expect(errorOf(refused).kind).toBe('mission_run_already_active');
    expect(errorOf(refused).message).toContain(first.runId);
    expect(errorOf(refused).message).toContain('explicit rerun');
  });

  it('allows an EXPLICIT rerun, and says on the wire that it was one', async () => {
    // The founder's other half: a deliberate second run stays possible. The
    // header is the only way to ask, and the response says it was honoured, so
    // a client that did not ask can never be told it got one.
    const s = stage();
    const first = dataOf(await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT)), s.ports));
    const edited = { ...CONTRACT, objective: 'Compare only the two formats we actually ship.' };
    const rerun = await handleJuliusMissionRoute(post(JSON.stringify(edited), { rerun: 'explicit', rerunKey: 'token-1' }), s.ports);
    expect(rerun?.status).toBe(201);
    const data = dataOf<{ runId: string; rerun: boolean }>(rerun);
    expect(data.runId).not.toBe(first.runId);
    expect(data.rerun).toBe(true);
    expect(dataOf<{ rerun: boolean }>(await handleJuliusMissionRoute(post(JSON.stringify({ ...CONTRACT, missionId: 'mission:other' }), {}), s.ports)).rerun).toBe(false);
  });

  it('is not an intent unless it says the word: any other header value is refused like no header at all', async () => {
    const s = stage();
    await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT)), s.ports);
    const edited = JSON.stringify({ ...CONTRACT, objective: 'Something else entirely.' });
    for (const value of ['true', '1', 'yes', 'EXPLICIT rerun please', '']) {
      const result = await handleJuliusMissionRoute(post(edited, { rerun: value, rerunKey: 'token-1' }), s.ports);
      expect(result?.status, value).toBe(409);
    }
    // The exact word, in any case, IS the intent — with a key of its own.
    expect((await handleJuliusMissionRoute(post(edited, { rerun: ' Explicit ', rerunKey: 'token-1' }), s.ports))?.status).toBe(201);
  });

  it('an explicit rerun with no key of its own is refused by name, and creates nothing', async () => {
    const s = stage();
    await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT)), s.ports);
    const refused = await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT), { rerun: 'explicit' }), s.ports);
    expect(refused?.status).toBe(400);
    expect(errorOf(refused).kind).toBe('rerun_key_required');
    expect(s.runCalls.filter((call) => 'createRun' in call), 'the first create only').toHaveLength(1);
  });

  it('a duplicate of the SAME request is not a second run: it resumes the first, and bills nothing twice', async () => {
    // The distinction the guard rests on. A retry — a lost response, a flaky
    // client, a queue redelivery — sends the SAME bytes, whose idempotency key
    // is those bytes; it resumes the one run. Only a CHANGED request is a
    // second intent, and only that is refused.
    const s = stage();
    const first = dataOf(await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT)), s.ports));
    const again = await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT)), s.ports);
    expect(again?.status).toBe(201);
    expect(dataOf(again).runId).toBe(first.runId);
    // One run created, ever — the second call reached the store and was absorbed
    // by the run it already held rather than minting another.
    expect(s.runCalls.filter((call) => 'createRun' in call)).toHaveLength(2);
    expect(new Set(s.runCalls.filter((call) => 'createRun' in call)
      .map((call) => (call.createRun as { runId: string }).runId)).size).toBe(1);
  });

  it('a mission whose run ENDED is not locked, and two missions are independent', async () => {
    // Terminality is what releases a mission: a FAILED or COMPLETED run holds
    // nothing. And the guard is per mission — one mission's live run never
    // blocks another's.
    const s = stage();
    const first = dataOf(await handleJuliusMissionRoute(post(JSON.stringify(CONTRACT)), s.ports));
    // Another mission, while the first is live: allowed, and a distinct run.
    const other = await handleJuliusMissionRoute(post(JSON.stringify({ ...CONTRACT, missionId: 'mission:wonderland-2', markerNamespace: 'wonderland-two' })), s.ports);
    expect(other?.status).toBe(201);
    expect(dataOf(other).runId).not.toBe(first.runId);

    // The first mission's run reaches a terminal state; a new run of it is then
    // ordinary work, with no rerun intent required.
    activeRuns.set(`${CONTRACT.projectId}/${CONTRACT.missionId}`, { runId: first.runId, state: 'COMPLETED' });
    activeRuns.delete(`${CONTRACT.projectId}/${CONTRACT.missionId}`);
    const next = await handleJuliusMissionRoute(post(JSON.stringify({ ...CONTRACT, objective: 'Now compare the fourth format too.' })), s.ports);
    expect(next?.status).toBe(201);
    expect(dataOf(next).runId).not.toBe(first.runId);
  });

  it('builds its three worker requests from the live composition’s own definitions, with the reviewer in the named group', () => {
    const workers = missionWorkerRequests('xai');
    expect(workers.map((worker) => worker.role)).toEqual(['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER']);
    expect(workers.map((worker) => worker.adapterId)).toEqual(['openai-architect-live', 'claude-agent-sdk-hosted-live', 'hermes-local-live']);
    expect(workers.map((worker) => worker.independenceGroup)).toEqual(['openai', 'anthropic', 'xai']);
    // INDEPENDENCE IS A FACT OF THE RECORD: the reviewer's group is whatever was
    // configured, and a reviewer in the coder's group would be recorded as such
    // for the lifecycle's independence check to refuse — not silently relabelled.
    expect(missionWorkerRequests('anthropic')[2]!.independenceGroup).toBe('anthropic');
  });
});
