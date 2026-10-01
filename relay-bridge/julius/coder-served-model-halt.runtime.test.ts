import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { createJuliusMemoryStore, type JuliusOperationalEvent, type JuliusWorker } from '../../src/relay/mission/julius';
import { JULIUS_RUN_HALTING_FAILURE_CLASSES } from '../../src/relay/mission/julius/julius-coding-agent';
import type { JuliusRunLoop } from '../../src/relay/mission/julius/julius-run-loop';
import { JuliusRuntimeApi } from '../../src/relay/mission/julius/julius-runtime-api';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
} from '../../src/relay/mission/julius/julius-runtime-fixtures';
import type { JuliusRunRow } from '../../src/relay/mission/julius/julius-runtime-ports';
import { juliusSharedCeilingPolicy } from '../../src/relay/mission/julius/julius-shared-ceiling';
import { JuliusReadPostgresRepository } from '../../src/relay/persistence/julius-read-postgres';
import { runHostedCodingAgent, type HostedQueryFn } from '../hosted-coding-agent/hosted-runner';
import { createClaudeCodeCodingAgentProvider } from './claude-code-coding-provider';
import { createFakeExecutorShell } from './coding-agent-fixtures';
import { createJuliusCodingAgentAdapter, createLiveArtifactExchange, planRef } from './live-workers';
import { createJuliusPostgresRuntimeStore } from './postgres-store';

/**
 * A CODER ANSWERED BY A MODEL IT DID NOT ASK FOR ENDS THE RUN, AND SAYS SO.
 *
 * Founder decision, 2026-09-30: the paid coder is claude-opus-5-5, with no automatic downgrade and
 * a STOP rather than a substitute. The provider already ends such a session FAILED
 * (`coder-served-model-guard.test.ts`). This follows the stop through the kernel, because ending
 * the TASK was not a stop:
 *   - the run's own reason was the generic TASK_FAILED, and /result named only
 *     WORKER_EXECUTION_FAILURE;
 *   - a sibling that never depended on the failed task stayed claimable, and would have been sent to
 *     the same path;
 *   - a second eligible coder would have been rerouted to, which is the substitute itself.
 *
 * What runs here is REAL: the Claude Code provider and the hosted runner, fed a fake SDK that yields
 * the SDK's own message shapes; the live Coding Agent adapter; and the kernel (scheduler, coordinator,
 * pipeline, run loop and memory store). The architect and the reviewer are scripted. NO PROVIDER IS
 * CONTACTED, and every fixture value is fake.
 */

const REQUESTED = 'claude-opus-5-5';
const WS = '/workspace/mission';
const DIFF_TEXT = [
  'diff --git a/src/slug.ts b/src/slug.ts',
  '--- a/src/slug.ts',
  '+++ b/src/slug.ts',
  '@@ -1 +1 @@',
  '-export const slug = (s: string) => s;',
  '+export const slug = (s: string) => s.trim().toLowerCase();',
  '',
].join('\n');

/* ------------------------------------------------------------ the sessions */

// The init ANNOUNCES the requested model on every session. An announcement is not an attestation.
const init = { type: 'system', subtype: 'init', model: REQUESTED, claude_code_version: '2.1.220', apiKeySource: 'none', cwd: WS, tools: ['Read', 'Glob', 'Grep', 'Edit'], session_id: 'sess-1' };
const turn = (model: string, output: number) => ({
  type: 'assistant', parent_tool_use_id: null, session_id: 'sess-1',
  message: { model, content: [{ type: 'text', text: 'Implemented.' }], usage: { input_tokens: 500, output_tokens: output } },
});
const result = (usage: Record<string, number>, over: Record<string, unknown> = {}) => ({
  type: 'result', subtype: 'success', is_error: false, result: 'Implemented the slug.', num_turns: 3, duration_ms: 1_200,
  total_cost_usd: 0.42, usage: { input_tokens: 500, output_tokens: 60 }, permission_denials: [], session_id: 'sess-1',
  modelUsage: Object.fromEntries(Object.entries(usage).map(([key, out]) => [key, { inputTokens: 500, outputTokens: out }])),
  ...over,
});

const EXACT = [init, turn(REQUESTED, 60), result({ [REQUESTED]: 60 })];
const DATED = [init, turn(`${REQUESTED}-20260915`, 60), result({ [`${REQUESTED}-20260915`]: 60 })];
const HELPER = [init, turn(REQUESTED, 60), result({ [REQUESTED]: 60, 'claude-haiku-4-5-20251001': 300 })];
const ANOTHER = [init, turn('claude-sonnet-5', 60), result({ 'claude-sonnet-5': 60 })];
const SWITCHED = [init, turn(REQUESTED, 60), turn('claude-sonnet-5', 40), result({ [REQUESTED]: 60, 'claude-sonnet-5': 40 })];
/** An ORDINARY failure, which must keep ending the ordinary way. */
const MAX_TURNS = [init, { ...result({}), subtype: 'error_max_turns', is_error: true, total_cost_usd: 0.3 }];

/**
 * The fake SDK: every call yields the next script in `sessions`, the last repeating. It keeps the
 * OPTIONS each session was launched with, which is where a fallback model would have to be named.
 */
const fakeSdk = (sessions: readonly (readonly unknown[])[]): {
  queryFn: HostedQueryFn; calls: { count: number; options: Record<string, unknown>[] };
} => {
  const calls = { count: 0, options: [] as Record<string, unknown>[] };
  const queryFn: HostedQueryFn = (params) => {
    const session = sessions[Math.min(calls.count, sessions.length - 1)]!;
    calls.count += 1;
    calls.options.push(params.options);
    return (async function* () {
      for (const message of session) yield message;
    })();
  };
  return { queryFn, calls };
};

/* ------------------------------------------------------------- the mission */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'], providerId: 'openai', adapterId: 'architect-adapter',
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'anthropic', adapterId: 'coder-adapter',
});
/** A second eligible coder, SCRIPTED to succeed: rerouting to it would be the automatic substitute. */
const SUBSTITUTE: JuliusWorker = worker({
  workerId: 'coder-substitute', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'openai', adapterId: 'coder-substitute-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
  providerId: 'hermes', adapterId: 'reviewer-adapter',
});
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const scope = { projectId: 'prj-1' };
const IDENTITY = { tenantId: 'tenant', projectId: 'prj-1', actorId: 'operator', scopes: ['run:read'] as const };
const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] };
const BUILD_OK = { kind: 'succeed' as const, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'The slug test passes.' }] };
const REVIEW_ACCEPT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }], answerFindings: 'RESOLVED' as const };
const CEILING = 5_000_000;

async function drain(loop: JuliusRunLoop, maxTicks = 16): Promise<number> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if ((await loop.tick(scope)).claimed === 0) return tick;
  }
  return maxTicks;
}

/**
 * plan-1, then build-1 and (with `sibling`) build-2: two coder tasks that each depend on the plan
 * alone, so neither depends on the other. `concurrency` is the C.A.R.D. width: at 2 both builds are
 * admitted in ONE tick (the dispatch boundary is what stands between them); at 1 the second is handed
 * back, and the next tick's claim is what must not happen.
 */
async function runMission(input: {
  readonly sessions: readonly (readonly unknown[])[];
  readonly sibling?: boolean;
  readonly concurrency?: number;
  readonly substitute?: boolean;
}) {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [PLAN_OK, PLAN_OK] },
      { worker: CODER, script: [] },
      ...(input.substitute === true ? [{ worker: SUBSTITUTE, script: [BUILD_OK, BUILD_OK] }] : []),
      { worker: REVIEWER, script: [REVIEW_ACCEPT, REVIEW_ACCEPT, REVIEW_ACCEPT, REVIEW_ACCEPT] },
    ],
    card: cardPolicy({
      allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'],
      concurrency: input.concurrency ?? 1,
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 1 }),
    capabilityFor: (item) => (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement'),
    allocation: juliusSharedCeilingPolicy({ ceilingUsdMicros: CEILING, authorizedRepairRounds: 1 }),
    budgetUsdMicros: CEILING,
  });
  harness.store.seedRun(RUN);
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  const builds = input.sibling === true ? ['build-1', 'build-2'] : ['build-1'];
  for (const [index, taskId] of builds.entries()) {
    harness.store.seedTask('run-1', task({
      taskId, ordinal: index + 1, role: 'CODING_AGENT', taskType: 'build',
      state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
    }));
    seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId });
  }
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The slug is normalized.', requiredEvidenceTypes: [] }]);
  harness.store.seedBrain('run-1', [
    { entryId: 'brain-1', kind: 'OBJECTIVE', text: 'Normalize the slug.', taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL' },
  ]);

  const artifacts = createLiveArtifactExchange();
  artifacts.put(planRef('run-1'), JSON.stringify({ objectiveSummary: 'Normalize the slug.', steps: ['edit src/slug.ts'] }));
  const sdk = fakeSdk(input.sessions);
  const live = createJuliusCodingAgentAdapter({
    worker: CODER,
    contexts: { snapshotFor: (contextId: string) => harness.store.contexts().filter((item) => item.contextId === contextId).at(-1) ?? null } as never,
    artifacts, projectId: 'prj-1', workspacePath: WS, testCommand: 'npm test',
    shell: createFakeExecutorShell({ diff: DIFF_TEXT, status: [' M src/slug.ts'], testExitCode: 0 }),
    provider: createClaudeCodeCodingAgentProvider({
      apiKey: '', authMode: 'CLAUDE_SUBSCRIPTION', requestedModel: REQUESTED,
      run: runHostedCodingAgent, queryLoader: async () => sdk.queryFn,
    }),
  });
  harness.adapters.set(CODER.adapterId, live as never);
  const ticks = await drain(harness.loop);

  const events = harness.store.events();
  const api = new JuliusRuntimeApi({
    store: harness.store as never, timeline: harness.store as never,
    approvers: { mayApprove: async () => false }, clock: harness.clock,
  });
  const view = await api.inspectResult(IDENTITY, 'run-1');
  if (!view.ok) throw new Error(view.reason);
  const tasks = await harness.store.tasksForRun('run-1', 'prj-1');
  return {
    harness, ticks, events, tasks, result: view.value,
    run: (await harness.store.loadRun('run-1', 'prj-1'))!,
    coderSessions: sdk.calls.count,
    sessionOptions: sdk.calls.options,
    substituteDispatches: harness.adapters.get(SUBSTITUTE.adapterId)?.dispatches.length ?? 0,
    runFailed: events.filter((event) => event.type === 'run.failed'),
    dispatchedTo: (taskId: string) => events.filter((event) => event.type === 'worker.dispatched' && event.taskId === taskId).length,
    retries: events.filter((event) => event.type === 'retry.scheduled').length,
    repairs: tasks.filter((item) => item.taskType.startsWith('repair:')).length,
  };
}

/* ---------------------------------------------------------------- the stop */

describe.each([
  ['another model answered', ANOTHER, 'coder_served_model_mismatch'],
  ['the model could not be attested (a mid-session switch)', SWITCHED, 'coder_served_model_unattested'],
] as const)('%s: the RUN ends, legibly, and nothing else is sent to that path', (_label, session, failureClass) => {
  it('FAILED, with the class as the run\'s own reason, in run.failed and in /result; no retry, no repair', async () => {
    const run = await runMission({ sessions: [session] });
    expect(run.coderSessions, 'the live coder really ran, once').toBe(1);
    expect(run.run.state).toBe('FAILED');
    expect(run.runFailed, 'announced once').toHaveLength(1);
    expect(run.runFailed[0]!.facts.reasonCode, 'the run\'s OWN reason, not TASK_FAILED').toBe(failureClass);
    expect(run.result.failure, '/result names the class, as the reason and as the class').toEqual({ reasonCode: failureClass, failureClass });
    expect(run.result.verified).toBe(false);
    expect(run.retries, 'never retried').toBe(0);
    expect(run.repairs, 'never repaired: there is no work to repair, only a model to refuse').toBe(0);
    expect(run.harness.store.taskRow('build-1')).toMatchObject({ state: 'FAILED', attempt: 1 });
  });

  it('A SIBLING ADMITTED IN THE SAME TICK is refused at the dispatch boundary, never dispatched', async () => {
    const run = await runMission({ sessions: [session, EXACT], sibling: true, concurrency: 2 });
    expect(run.coderSessions, 'one coder session: the sibling never reached the provider').toBe(1);
    expect(run.dispatchedTo('build-1')).toBe(1);
    expect(run.dispatchedTo('build-2'), 'the sibling is never dispatched').toBe(0);
    expect(run.harness.store.taskRow('build-2'), 'ended before an attempt was spent').toMatchObject({ state: 'FAILED', attempt: 0 });
    // TOLD APART FROM A CODER FAILURE by every row a reader counts: no reservation, no settlement, no
    // failure row of its own (so /result keeps reading the coder's), no worker chosen.
    expect(run.events.filter((event) => event.taskId === 'build-2' && [
      'worker.selected', 'budget.reserved', 'budget.settled', 'budget.denied', 'task.failed', 'retry.scheduled',
    ].includes(event.type))).toEqual([]);
    const held = run.harness.store.trajectory().find((row) => row.taskId === 'build-2' && row.outcome === 'GOVERNANCE_HELD');
    expect(held?.safeFacts).toMatchObject({
      reasonCode: `RUN_${failureClass.toUpperCase()}`, haltingFailureClass: failureClass, handedBack: false,
    });
    expect(run.run.state).toBe('FAILED');
    expect(run.runFailed[0]!.facts.reasonCode).toBe(failureClass);
    expect(run.result.failure).toEqual({ reasonCode: failureClass, failureClass });
  });

  it('A SIBLING HANDED BACK for concurrency is never claimed again: the run is FAILED before the next claim', async () => {
    const run = await runMission({ sessions: [session, EXACT], sibling: true, concurrency: 1 });
    expect(run.coderSessions).toBe(1);
    expect(run.dispatchedTo('build-2')).toBe(0);
    expect(run.harness.store.taskRow('build-2'), 'still waiting, in a run that has ended').toMatchObject({ state: 'RUNNABLE', attempt: 0 });
    expect(run.run.state).toBe('FAILED');
    expect(run.runFailed).toHaveLength(1);
    expect(run.runFailed[0]!.facts.reasonCode).toBe(failureClass);
    expect(run.result.failure).toEqual({ reasonCode: failureClass, failureClass });
  });

  it('A SECOND ELIGIBLE CODER is not rerouted to: that would be the substitute the founder ruled out', async () => {
    const run = await runMission({ sessions: [session], substitute: true });
    expect(run.coderSessions).toBe(1);
    expect(run.substituteDispatches, 'the substitute is never dispatched').toBe(0);
    expect(run.events.filter((event) => ['provider.failure', 'reroute.selected', 'fallback.selected'].includes(event.type)),
      'nothing is written on the way to a reroute either').toEqual([]);
    expect(run.harness.store.trajectory().filter((row) => row.kind === 'FALLBACK')).toEqual([]);
    expect(run.run.state).toBe('FAILED');
    expect(run.runFailed[0]!.facts.reasonCode).toBe(failureClass);
  });
});

/* ------------------------------------------------ no downgrade, by construction */

describe('no session can be launched with a model to fall back to', () => {
  it('the SDK is asked for the requested model, with no fallbackModel, no model in the child env, and no settings file', async () => {
    // Detection above STOPS a substitute after it answered. This is the half that keeps the runtime
    // from choosing one: a `fallbackModel` option, an ANTHROPIC_MODEL-style variable or a settings
    // file could each name another model before any turn is taken.
    const run = await runMission({ sessions: [EXACT] });
    expect(run.sessionOptions).toHaveLength(1);
    const options = run.sessionOptions[0]!;
    expect(options.model).toBe(REQUESTED);
    expect('fallbackModel' in options, 'no fallback model is ever named').toBe(false);
    expect(Object.keys(options.env as Record<string, string>).filter((key) => /MODEL/iu.test(key))).toEqual([]);
    expect(options.settingSources, 'no settings file may name one either').toEqual([]);
  });
});

/* -------------------------------------------------------- what passes through */

describe('the requested model, and only it, passes through', () => {
  it.each([
    ['exactly', EXACT],
    ['its dated build', DATED],
    ['with a helper model beside the matching turn', HELPER],
  ] as const)('%s: both coder tasks run and the mission completes', async (_label, session) => {
    const run = await runMission({ sessions: [session], sibling: true, concurrency: 2 });
    expect(run.coderSessions, 'both builds were sent').toBe(2);
    expect(run.harness.store.taskRow('build-1')?.state).toBe('SUCCEEDED');
    expect(run.harness.store.taskRow('build-2')?.state).toBe('SUCCEEDED');
    expect(run.run.state).toBe('COMPLETED');
    expect(run.runFailed).toEqual([]);
    expect(run.result.failure).toBeNull();
  });

  it('an ORDINARY coder failure keeps the ordinary ending: TASK_FAILED, and /result reads the code', async () => {
    const run = await runMission({ sessions: [MAX_TURNS] });
    expect(run.coderSessions).toBe(1);
    const failed = run.events.filter((event) => event.type === 'task.failed' && event.taskId === 'build-1');
    expect(failed, 'the task failed once').toHaveLength(1);
    const ordinaryClass = failed[0]!.facts.failureClass;
    expect(typeof ordinaryClass).toBe('string');
    expect(ordinaryClass).not.toMatch(/^coder_served_model_/u);
    expect('reasonCode' in failed[0]!.facts, 'only a run-ending class becomes the row\'s reason').toBe(false);
    expect(run.run.state).toBe('FAILED');
    expect(run.runFailed[0]!.facts.reasonCode).toBe('TASK_FAILED');
    expect(run.result.failure).toEqual({ reasonCode: failed[0]!.facts.code, failureClass: ordinaryClass });
  });
});

/* ------------------------------------------------------ the read, planted */

describe('the memory store reads what PostgreSQL reads', () => {
  const MISMATCH = 'coder_served_model_mismatch';
  const UNATTESTED = 'coder_served_model_unattested';
  let serial = 0;
  const row = (runId: string, failureClass: string, over: Partial<JuliusOperationalEvent> = {}): JuliusOperationalEvent => ({
    eventId: `event:planted:${String(++serial)}`, runId, projectId: 'prj-1', type: 'task.failed', taskId: 'build-x', workerId: 'coder',
    correlationId: 'build-x', causationId: null, occurredAt: '2026-09-30T00:00:00.000Z',
    facts: { code: 'WORKER_EXECUTION_FAILURE', errorRetryable: false, failureClass }, ...over,
  });

  it('the closed set, off task.failed rows of this run and project only, each once, first recorded first', async () => {
    const store = createJuliusMemoryStore();
    for (const runId of ['run-a', 'run-b', 'run-c']) store.seedRun({ ...RUN, runId, missionId: `msn-${runId}` });
    for (const event of [
      row('run-a', 'coder_result_untrusted'),
      row('run-a', UNATTESTED),
      // The class on a row that did not end a task, and on a row whose project is not its run's.
      row('run-a', MISMATCH, { type: 'retry.scheduled' }),
      row('run-a', MISMATCH, { projectId: 'prj-other' }),
      row('run-b', MISMATCH), row('run-b', UNATTESTED), row('run-b', MISMATCH),
    ]) expect(await store.appendEvent(event)).toBe(true);

    expect(await store.haltingFailureClasses('run-a', 'prj-1')).toEqual([UNATTESTED]);
    expect(await store.haltingFailureClasses('run-b', 'prj-1'), 'each once, first recorded first').toEqual([MISMATCH, UNATTESTED]);
    expect(await store.haltingFailureClasses('run-c', 'prj-1'), 'a clean run beside them').toEqual([]);
    expect(await store.haltingFailureClasses('run-b', 'prj-other'), 'never across a project').toEqual([]);
  });
});

/* ------------------------------------------- the production store serves it */

describe('the PostgreSQL store serves the read the kernel enacts', () => {
  it('PRODUCTION COMPOSITION: bound to the reader\'s own read, not merely present', () => {
    // Unbound, the run would fail as TASK_FAILED and a sibling would be dispatched; only the
    // real-PostgreSQL suite could see it. No connection is made to construct the store.
    const store = createJuliusPostgresRuntimeStore(new Pool({ connectionString: 'postgres://nobody@127.0.0.1:1/none' }));
    expect(store.haltingFailureClasses.name).toBe('bound haltingFailureClasses');
  });

  it('THE QUERY is handed the run, the project and the closed list, and a row outside the list is never believed', async () => {
    const seen: { sql: string; values: readonly unknown[] }[] = [];
    const pool = {
      query: async (sql: string, values: readonly unknown[]) => {
        seen.push({ sql, values });
        return { rows: [{ failure_class: 'coder_timed_out' }, { failure_class: 'coder_served_model_mismatch' }] };
      },
    };
    const reader = new JuliusReadPostgresRepository(pool as never);
    expect(await reader.haltingFailureClasses('run-9', 'prj-9')).toEqual(['coder_served_model_mismatch']);
    expect(seen[0]!.values.slice(0, 3)).toEqual(['run-9', 'prj-9', [...JULIUS_RUN_HALTING_FAILURE_CLASSES]]);
    expect(seen[0]!.sql).toContain("e.event_type='julius.task.failed'");
  });
});
