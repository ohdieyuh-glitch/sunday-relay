/**
 * THE OPERATOR LIFECYCLE CHANNEL, HELD TO WHAT IT PROMISES — THROUGH THE LOOP.
 *
 * A route test that only checked the run row after a POST would prove the
 * mapping and nothing about Julius: the claim that matters is that the RUN
 * LOOP honours what the channel records. So every case here drives the run the
 * way the mission job does — `assembleLiveJuliusRuntime` with the production
 * registrations and `driveJuliusRunToTerminal` with the derived allowance —
 * and counts what the provider adapters were actually handed. Only the
 * adapters are scripted, and the store is the in-memory twin of the one
 * `composeJuliusStateApi` binds (the real-PostgreSQL twin of this file is
 * `julius-lifecycle-routes.real-postgres.test.ts`).
 *
 * The API is composed the way `composeJuliusStateApi` composes it: the store,
 * its timeline, an approver authority that refuses everything, and the event
 * ledger plus an id factory for the control operations' announcements.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createJuliusMemoryStore,
  JuliusRuntimeApi,
  juliusPacketTextIn,
  scriptedAdapter,
  seedJuliusTaskContract,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
} from '../src/relay/mission/julius';
import {
  architectWorker,
  CODER_WORKER,
  assembleLiveJuliusRuntime,
  createContextAndClaimHandoffs,
  driveJuliusRunToTerminal,
  reviewerWorker,
} from './julius/live-composition';
import {
  handleJuliusLifecycleRoute,
  isJuliusLifecycleRoute,
  juliusLifecycleNextStep,
  type JuliusLifecycleRoutePorts,
  type JuliusLifecycleRouteRequest,
} from './julius-lifecycle-routes';
import { handleJuliusStateRoute, isJuliusStateRoute } from './julius-state-routes';

const RUN = 'run:lifecycle-1';
const PROJECT = 'prj-lifecycle';
const TENANT = 'tenant-lifecycle';
const MISSION = 'mission-lifecycle';
const REVIEWER_WORKER = reviewerWorker('hermes');

const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];

type Memory = ReturnType<typeof createJuliusMemoryStore>;

function seed(store: Memory): void {
  store.seedRun({
    runId: RUN, missionId: MISSION, projectId: PROJECT, state: 'READY',
    cardRevision: 'card-lifecycle', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  store.seedTask(RUN, {
    taskId: 'plan-1', missionId: MISSION, parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: ['ARTIFACT'], taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'RUNNABLE',
  });
  store.seedTask(RUN, {
    taskId: 'build-1', missionId: MISSION, parentTaskId: null, dependencyIds: ['plan-1'],
    requiredEvidenceTypes: ['TEST'], taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED',
  });
  const seeded = seedJuliusTaskContract({
    runId: RUN, taskId: 'build-1', missionContractRevision: 1,
    objective: 'Finish a small mission an operator may pause, resume or cancel.',
    requirements: ['Do the work.'], constraints: ['Touch only the module.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The suite passes.', blocking: true }],
    filesInScope: [], filesOutOfScope: [], spendUsd: 10, repairCycles: 1, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  void store.putTaskContract({ projectId: PROJECT, contract: seeded.contract, occurredAt: '2026-09-29T00:00:00.000Z' });
  store.seedCriteria(RUN, [{ criterionId: 'AC-1', description: 'The suite passes.', requiredEvidenceTypes: [] }]);
  store.seedBrain(RUN, [{
    entryId: 'brain-objective', kind: 'OBJECTIVE', text: 'OBJECTIVE: finish a small mission.',
    taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  }]);
}

/** The API exactly as `composeJuliusStateApi` shapes it, over the memory store. */
function apiOver(memory: Memory): JuliusRuntimeApi {
  let n = 0;
  return new JuliusRuntimeApi({
    store: memory as never,
    timeline: memory,
    approvers: { mayApprove: async () => false },
    clock: { now: () => new Date().toISOString() },
    events: memory,
    ids: { next: (kind) => `${kind}:${String(++n)}` },
  });
}

interface Stage {
  readonly memory: Memory;
  readonly ports: JuliusLifecycleRoutePorts;
  /** Drive the run the way the mission job does; `maxTicks` stops early without failing it. */
  drive(maxTicks?: number): ReturnType<typeof driveJuliusRunToTerminal>;
  /** Every dispatch any provider adapter has been handed, so far. */
  dispatches(): number;
}

/**
 * A FRESH RUNTIME OVER A STORE — a new job process, as a re-run of the mission
 * job is. Pass an existing store to model the job being run again over the same
 * durable rows (what an operator does after a resume).
 */
function stage(existing?: Memory): Stage {
  const memory = existing ?? createJuliusMemoryStore();
  if (existing === undefined) seed(memory);
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
  const architect = scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null }]);
  const coder = scriptedAdapter(CODER_WORKER, [{ kind: 'succeed', evidence: BUILD_EVIDENCE, usdMicros: 1_000_000 }]);
  const reviewer = scriptedAdapter(REVIEWER_WORKER,
    [{ kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null, answerFindings: 'RESOLVED' }],
    { packetFor: juliusPacketTextIn(memory) });
  const runtime = assembleLiveJuliusRuntime({
    store: handoffs.store,
    entries: [
      { worker: architectWorker({}), adapter: architect },
      { worker: CODER_WORKER, adapter: coder },
      { worker: REVIEWER_WORKER, adapter: reviewer },
    ],
    cardRevision: 'card-lifecycle', spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1,
  });
  return {
    memory,
    ports: { api: apiOver(memory), missingConfig: [] },
    // The job's drive, under the derived allowance. A `maxTicks` here is the
    // BARE bound (no verification policy), which stops the drive without
    // failing the run — the way to leave work part-done for an operator to act
    // on. Under the derived allowance an override that runs out FAILS the run.
    drive: (maxTicks) => driveJuliusRunToTerminal({
      loop: runtime.loop, store: handoffs.store, runId: RUN, projectId: PROJECT,
      ...(maxTicks === undefined ? { verification: runtime.verification } : { maxTicks }),
    }),
    dispatches: () => architect.dispatches.length + coder.dispatches.length + reviewer.dispatches.length,
  };
}

const post = (body: unknown, over: Partial<JuliusLifecycleRouteRequest> = {}): JuliusLifecycleRouteRequest => ({
  method: 'POST', path: `/julius/runs/${RUN}/lifecycle`, operator: true,
  projectId: PROJECT, tenantId: TENANT,
  body: typeof body === 'string' ? body : JSON.stringify(body),
  ...over,
});

type Envelope = { data?: Record<string, unknown>; error?: { kind: string; message: string } };
const envelope = (result: { body: unknown } | null): Envelope => result?.body as Envelope;

async function stateOf(memory: Memory): Promise<string | undefined> {
  return (await memory.loadRun(RUN, PROJECT))?.state;
}

/* ---------------------------------------------------------------- refusals */

describe('POST /julius/runs/<id>/lifecycle — what it refuses, before it changes anything', () => {
  it('claims exactly its own path, and the read family would have answered the same POST 405', async () => {
    expect(isJuliusLifecycleRoute(`/julius/runs/${RUN}/lifecycle`)).toBe(true);
    expect(isJuliusLifecycleRoute('/julius/runs/run:x/run')).toBe(false);
    expect(isJuliusLifecycleRoute('/julius/missions')).toBe(false);
    expect(await handleJuliusLifecycleRoute(post({}, { path: '/julius/runs/run:x/tasks' }), stage().ports)).toBeNull();
    // WHY THE SERVER MUST ASK THIS FAMILY FIRST: the read family claims every
    // /julius/ path and refuses any method but GET.
    expect(isJuliusStateRoute(`/julius/runs/${RUN}/lifecycle`)).toBe(true);
    const shadowed = await handleJuliusStateRoute(
      { method: 'POST', path: `/julius/runs/${RUN}/lifecycle`, operator: true, projectId: PROJECT, tenantId: TENANT },
      { api: null, missingConfig: [] });
    expect(shadowed?.status).toBe(405);
  });

  it('the server dispatches the lifecycle family before the read family', () => {
    const server = readFileSync(resolve(__dirname, 'server.ts'), 'utf8');
    const lifecycleAt = server.indexOf("if (isJuliusLifecycleRoute(path.replace('/relay-api', '')))");
    const readAt = server.indexOf("if (isJuliusStateRoute(path.replace('/relay-api', '')))");
    expect(lifecycleAt, 'the lifecycle family is mounted').toBeGreaterThan(0);
    expect(readAt).toBeGreaterThan(0);
    expect(lifecycleAt, 'and ahead of the read family').toBeLessThan(readAt);
    // Over the SAME ports object the reads use: one composed API, one store.
    expect(server.slice(lifecycleAt, readAt)).toContain('juliusStatePorts()');
  });

  it('refuses a caller without the operator Bearer, and the run is untouched', async () => {
    const s = stage();
    const result = await handleJuliusLifecycleRoute(post({ action: 'pause', reason: 'hold' }, { operator: false }), s.ports);
    expect(result?.status).toBe(401);
    expect(envelope(result).error?.kind).toBe('operator_required');
    expect(await stateOf(s.memory)).toBe('READY');
    expect(s.memory.lifecycleOf(RUN)).toBeNull();
  });

  it('refuses every method but POST', async () => {
    const result = await handleJuliusLifecycleRoute(post({ action: 'pause', reason: 'x' }, { method: 'GET' }), stage().ports);
    expect(result?.status).toBe(405);
  });

  it('answers 503 naming the variable when the process has no database, and changes nothing', async () => {
    const result = await handleJuliusLifecycleRoute(post({ action: 'cancel', reason: 'x' }),
      { api: null, missingConfig: ['JULIUS_DATABASE_URL', 'DATABASE_URL'] });
    expect(result?.status).toBe(503);
    expect(envelope(result).error?.message).toContain('JULIUS_DATABASE_URL');
    expect(envelope(result).error?.message).toContain('Nothing was changed');
  });

  it('requires the tenant and project headers', async () => {
    const result = await handleJuliusLifecycleRoute(post({ action: 'pause', reason: 'x' }, { projectId: undefined }), stage().ports);
    expect(result?.status).toBe(400);
    expect(envelope(result).error?.kind).toBe('project_required');
  });

  it('refuses an unknown run by name — and another project’s run with the same answer', async () => {
    const s = stage();
    const unknown = await handleJuliusLifecycleRoute(post({ action: 'pause', reason: 'x' }, { path: '/julius/runs/run:nope/lifecycle' }), s.ports);
    expect(unknown?.status).toBe(404);
    expect(envelope(unknown).error?.kind).toBe('run_not_found');
    const foreign = await handleJuliusLifecycleRoute(post({ action: 'cancel', reason: 'x' }, { projectId: 'prj-other' }), s.ports);
    expect(foreign?.status).toBe(404);
    expect(envelope(foreign).error?.kind).toBe('run_not_found');
    expect(await stateOf(s.memory), 'another tenant cannot cancel this run').toBe('READY');
  });

  it('refuses a malformed body, an unknown action and a missing reason, each by name', async () => {
    const s = stage();
    const cases: Array<[unknown, string]> = [
      ['not json', 'malformed_lifecycle_request'],
      [[], 'malformed_lifecycle_request'],
      [{ action: 'kill', reason: 'x' }, 'unknown_lifecycle_action'],
      [{ reason: 'x' }, 'unknown_lifecycle_action'],
      [{ action: 'pause' }, 'reason_required'],
      [{ action: 'cancel', reason: '   ' }, 'reason_required'],
      [{ action: 'pause', reason: 'x'.repeat(501) }, 'reason_too_long'],
    ];
    for (const [body, kind] of cases) {
      const result = await handleJuliusLifecycleRoute(post(body), s.ports);
      expect(result?.status, JSON.stringify(body).slice(0, 60)).toBe(400);
      expect(envelope(result).error?.kind, JSON.stringify(body).slice(0, 60)).toBe(kind);
    }
    expect(await stateOf(s.memory)).toBe('READY');
    expect(s.memory.events().filter((event) => event.type.startsWith('run.')), 'nothing announced').toEqual([]);
  });
});

/* ------------------------------------------------------ pause, through the loop */

describe('pause is honoured by the run loop, not merely recorded', () => {
  it('CONTROL: an unpaused twin is driven to COMPLETED and dispatches', async () => {
    const twin = stage();
    const outcome = await twin.drive();
    expect(outcome.state).toBe('COMPLETED');
    expect(twin.dispatches()).toBeGreaterThanOrEqual(3);
  });

  it('a paused run is driven and dispatches NOTHING, stops PAUSED, and names the pause as the cause', async () => {
    const s = stage();
    const paused = await handleJuliusLifecycleRoute(post({ action: 'pause', reason: 'Founder review of the plan.' }), s.ports);
    expect(paused?.status).toBe(200);
    expect(envelope(paused).data).toMatchObject({ runId: RUN, action: 'pause', from: 'READY', state: 'PAUSED', duplicate: false, dispatched: false });

    const outcome = await s.drive();
    expect(s.dispatches(), 'not one provider was asked').toBe(0);
    expect(outcome.state, 'the loop did not un-pause it').toBe('PAUSED');
    expect(outcome.stalled).toBe(true);
    expect(outcome.haltCause).toMatch(/^run_paused_by_operator: /u);
    expect(await stateOf(s.memory)).toBe('PAUSED');
    // A second job run over the same rows is no different.
    const again = await stage(s.memory).drive();
    expect(again.state).toBe('PAUSED');
  });

  it('a pause landing mid-run stops new work: what was in flight finished, nothing further starts', async () => {
    const s = stage();
    await s.drive(1);
    const before = s.dispatches();
    expect(before, 'the plan was dispatched before the pause').toBe(1);
    expect((await handleJuliusLifecycleRoute(post({ action: 'pause', reason: 'hold after the plan' }), s.ports))?.status).toBe(200);
    const outcome = await s.drive();
    expect(outcome.state).toBe('PAUSED');
    expect(s.dispatches(), 'no review, no build — nothing after the pause').toBe(before);
  });

  it('pause is idempotent: a second pause changes nothing and announces nothing', async () => {
    const s = stage();
    await handleJuliusLifecycleRoute(post({ action: 'pause', reason: 'once' }), s.ports);
    const second = await handleJuliusLifecycleRoute(post({ action: 'pause', reason: 'twice' }), s.ports);
    expect(second?.status).toBe(200);
    expect(envelope(second).data).toMatchObject({ state: 'PAUSED', duplicate: true });
    expect(s.memory.events().filter((event) => event.type === 'run.paused')).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- resume */

describe('resume', () => {
  it('a resumed run continues to COMPLETED when the job drives it again, and dispatches what its twin did', async () => {
    const twin = stage();
    await twin.drive();

    const s = stage();
    await handleJuliusLifecycleRoute(post({ action: 'pause', reason: 'hold' }), s.ports);
    await s.drive();
    expect(s.dispatches()).toBe(0);

    const resumed = await handleJuliusLifecycleRoute(post({ action: 'resume', reason: 'Plan reviewed; carry on.' }), s.ports);
    expect(resumed?.status).toBe(200);
    expect(envelope(resumed).data).toMatchObject({ action: 'resume', from: 'PAUSED', state: 'READY', dispatched: false });
    expect(s.dispatches(), 'resume itself dispatches nothing').toBe(0);

    const outcome = await s.drive();
    expect(outcome.state).toBe('COMPLETED');
    expect(s.dispatches()).toBe(twin.dispatches());
  });

  it('refuses to resume a run that is not paused', async () => {
    const s = stage();
    const result = await handleJuliusLifecycleRoute(post({ action: 'resume', reason: 'go' }), s.ports);
    expect(result?.status).toBe(409);
    expect(envelope(result).error?.kind).toBe('run_not_paused');
    expect(await stateOf(s.memory)).toBe('READY');
  });
});

/* ---------------------------------------------------------------- cancel */

describe('cancel', () => {
  it('ends the run CANCELLED with the reason on the record, and nothing after it dispatches', async () => {
    const s = stage();
    await s.drive(1);
    const before = s.dispatches();

    const cancelled = await handleJuliusLifecycleRoute(post({ action: 'cancel', reason: 'Wrong repository targeted.' }), s.ports);
    expect(cancelled?.status).toBe(200);
    const data = envelope(cancelled).data!;
    expect(data).toMatchObject({ action: 'cancel', state: 'CANCELLED', duplicate: false, dispatched: false });
    expect(data.cancelledTasks as number, 'the unfinished tasks were cancelled with it').toBeGreaterThanOrEqual(1);

    const outcome = await s.drive();
    expect(outcome).toMatchObject({ state: 'CANCELLED', stalled: false });
    expect(s.dispatches(), 'nothing after the cancel').toBe(before);

    // THE RECORD: who and why on the run row, and the announcement on the ledger.
    expect(s.memory.lifecycleOf(RUN)).toMatchObject({ actor: 'operator', reason: 'Wrong repository targeted.' });
    const announced = s.memory.events().filter((event) => event.type === 'run.cancelled');
    expect(announced).toHaveLength(1);
    expect(announced[0]!.facts).toMatchObject({ actor: 'operator', reason: 'Wrong repository targeted.' });
    const tasks = await s.memory.tasksForRun(RUN, PROJECT);
    expect(tasks.filter((task) => task.state === 'RUNNABLE' || task.state === 'BLOCKED' || task.state === 'ACTIVE'),
      'no task is left for any driver to claim').toEqual([]);
  });

  it('a paused run can be cancelled, and ends CANCELLED', async () => {
    const s = stage();
    await handleJuliusLifecycleRoute(post({ action: 'pause', reason: 'hold' }), s.ports);
    const cancelled = await handleJuliusLifecycleRoute(post({ action: 'cancel', reason: 'Abandoned.' }), s.ports);
    expect(envelope(cancelled).data).toMatchObject({ from: 'PAUSED', state: 'CANCELLED' });
    expect((await s.drive()).state).toBe('CANCELLED');
    expect(s.dispatches()).toBe(0);
  });

  it('is idempotent: a second cancel reports duplicate and announces nothing new', async () => {
    const s = stage();
    await handleJuliusLifecycleRoute(post({ action: 'cancel', reason: 'first' }), s.ports);
    const second = await handleJuliusLifecycleRoute(post({ action: 'cancel', reason: 'second' }), s.ports);
    expect(second?.status).toBe(200);
    expect(envelope(second).data).toMatchObject({ state: 'CANCELLED', duplicate: true });
    expect(s.memory.events().filter((event) => event.type === 'run.cancelled')).toHaveLength(1);
    expect(s.memory.lifecycleOf(RUN)?.reason, 'the first reason stands').toBe('first');
  });

  it('resume after cancel is refused, and so is pause — a cancelled run stays cancelled', async () => {
    const s = stage();
    await handleJuliusLifecycleRoute(post({ action: 'cancel', reason: 'done with it' }), s.ports);
    const resume = await handleJuliusLifecycleRoute(post({ action: 'resume', reason: 'changed my mind' }), s.ports);
    expect(resume?.status).toBe(409);
    expect(envelope(resume).error?.kind).toBe('run_not_paused');
    const pause = await handleJuliusLifecycleRoute(post({ action: 'pause', reason: 'hold' }), s.ports);
    expect(pause?.status).toBe(409);
    expect(envelope(pause).error?.kind).toBe('transition_not_legal');
    expect(await stateOf(s.memory)).toBe('CANCELLED');
    expect((await s.drive()).state).toBe('CANCELLED');
    expect(s.dispatches()).toBe(0);
  });

  it('a completed run cannot be cancelled into a different ending', async () => {
    const s = stage();
    expect((await s.drive()).state).toBe('COMPLETED');
    const result = await handleJuliusLifecycleRoute(post({ action: 'cancel', reason: 'too late' }), s.ports);
    expect(result?.status).toBe(409);
    expect(envelope(result).error?.kind).toBe('transition_not_legal');
    expect(await stateOf(s.memory)).toBe('COMPLETED');
  });
});

/* ---------------------------------------------------------- the durable record */

describe('the record survives a restart and is served by the read family', () => {
  it('a new API over the same rows reads the pause, its reason on the timeline', async () => {
    const s = stage();
    await handleJuliusLifecycleRoute(post({ action: 'pause', reason: 'Awaiting the founder.' }), s.ports);

    // A NEW PROCESS: fresh API, fresh runtime, the same durable rows.
    const restarted = stage(s.memory);
    const read = (view: string) => handleJuliusStateRoute(
      { method: 'GET', path: `/julius/runs/${RUN}/${view}`, operator: true, projectId: PROJECT, tenantId: TENANT },
      { api: restarted.ports.api, missingConfig: [] });
    expect((envelope(await read('run')).data as { state: string }).state).toBe('PAUSED');
    const timeline = envelope(await read('timeline')).data as { entries: Array<{ type: string; facts: Record<string, unknown> }> };
    const paused = timeline.entries.filter((entry) => entry.type === 'run.paused');
    expect(paused).toHaveLength(1);
    expect(paused[0]!.facts).toMatchObject({ actor: 'operator', reason: 'Awaiting the founder.', from: 'READY' });
  });
});

/**
 * WHAT THE OPERATOR IS TOLD, per state. A resume can land in BLOCKED (an
 * approval still pending), and a BLOCKED run does not "continue when the
 * mission job drives it": nothing is dispatched until the approval is decided.
 */
describe('the next-step sentence names what each state will actually do', () => {
  it('BLOCKED waits on its approval; it is never told it continues when driven', () => {
    const blocked = juliusLifecycleNextStep('BLOCKED');
    expect(blocked).toContain('pending approval');
    expect(blocked).toContain('A denial ends the run');
    expect(blocked).not.toContain('continues when');
  });

  it('READY continues when driven; PAUSED claims nothing; terminal states are final', () => {
    expect(juliusLifecycleNextStep('READY')).toContain('continues when the Julius mission job drives it');
    expect(juliusLifecycleNextStep('PAUSED')).toContain('claims no new work');
    for (const state of ['COMPLETED', 'FAILED', 'CANCELLED']) {
      expect(juliusLifecycleNextStep(state)).toContain('its state is final');
    }
  });

  it('every sentence says the route itself dispatched nothing, except where the state is final or paused', () => {
    for (const state of ['READY', 'BLOCKED']) {
      expect(juliusLifecycleNextStep(state)).toContain('dispatches nothing');
    }
  });
});
