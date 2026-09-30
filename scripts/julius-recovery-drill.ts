/**
 * THE JULIUS RESTART / RECOVERY DRILL — two real processes per phase, one real
 * database, real expiries, zero provider calls.
 *
 * WHY IT EXISTS. A flawless mission never crashes, so it never exercises
 * recovery, and the Beta Gate refuses to infer a capability from the fact that
 * its source is in the tree. Something has to actually drive the production
 * recovery path, and a unit test with a stubbed pool is not that: it proves the
 * SQL string this repository types, not that PostgreSQL executes it, not that a
 * lease expires against a wall clock, and not that a process which has never
 * seen the run can pick it up from durable state alone.
 *
 * WHAT IT DRIVES, and every part of it is production. Two phases, one run each,
 * because a crash means two different things depending on WHEN it happens:
 *
 *   PHASE 1, RECOVERY. PROCESS A bootstraps a mission through the production
 *   seed store and the production run repository, then ticks the production
 *   run loop. It dies (`process.exit(87)`) after admitting the plan task and
 *   BEFORE handing it to any worker, at the instant it would record the
 *   handoff: the task is ACTIVE, the lease is held, the generation is recorded,
 *   and nothing was handed, so nothing can have been paid for. That is a crash,
 *   not a cancellation: no handler runs, no lease is released, nothing is
 *   written back.
 *
 *   THE LEASE THEN REALLY EXPIRES. The lease is short (the drill's one
 *   parameter) and the orchestrator WAITS for `lease_expires_at <= now()` by
 *   asking the database, rather than injecting a future `now` into the sweep.
 *   A sweep proven against a fabricated clock is proven against a clock nobody
 *   runs.
 *
 *   PROCESS B is a fresh Node process which has never seen the run. It opens
 *   the same database, assembles the SAME production runtime, and ticks. The
 *   run loop's own sweep — `JuliusRecoveryPostgresRepository.recoverExpired`,
 *   deciding through `planJuliusRecovery` — reclaims the expired lease, bumps
 *   the generation, requeues the task and records `julius.recovery.action`.
 *   In the same transaction it RELEASES the reservation process A made and
 *   never settled ((a2) step 2: nothing was handed, so nothing was spent), so
 *   the run does not go on paying for a dead attempt's hold. The run then
 *   finishes with no reservation left open.
 *
 *   PHASE 2, NEVER PAID TWICE. The same, on a second run, except process A dies
 *   INSIDE the worker's dispatch: the work WAS handed, and a real provider
 *   would have been paid for an answer nobody recorded. The sweep must not buy
 *   it again. It ends the task HANDED_OUTCOME_UNKNOWN (the live lane's decision
 *   C), the run fails truthfully, and the worker was dispatched exactly once.
 *   The sweep CLOSES the reservation as an unknown outcome
 *   (`RECOVERED_HANDED_OUTCOME_UNKNOWN`, not released), so the evidence reads
 *   that spend as unknown, charged at what it held, and never as $0. Before
 *   (a2) step 2 it was left open for ever, which read the same way and never
 *   ended.
 *
 * WHAT IS NOT PRODUCTION, stated rather than implied: the three C.A.R.D. role
 * adapters are fakes, exactly as the Relay recovery drill's are. This drill
 * proves the RECOVERY path, and a provider call proves nothing about it while
 * costing money the founder has not been asked for. No provider client is
 * constructed anywhere in this file.
 *
 * WHAT IT REFUSES TO CALL SUCCESS. A recovery that replays a HANDED dispatch
 * is not a recovery, it is a double spend: an earlier form of this drill
 * crashed inside the dispatch and counted the requeue that bought the answer
 * again as the success. So the drill fails unless phase 1's crashed attempt
 * handed nothing and the reclaimed task was handed exactly once afterwards,
 * and unless phase 2's handed task was never handed again. A run that
 * completes without the sweep having acted is not a recovery either, and
 * fails the same way.
 *
 * WHAT IT LEAVES BEHIND. A transcript, and a `capability-proofs.tsv` row per
 * production file it drove, carrying that file's content digest at the moment
 * it ran. The Beta Gate reads them, recomputes the digests, and refuses the
 * attestation the moment the code it describes changes — which is the whole
 * point: a capability proof that cannot expire becomes folklore.
 *
 *   DATABASE_URL=… node dist-relay-bridge/julius-recovery-drill.cjs [--out <dir>]
 *
 * Exit 0 when every step passes, 8 when any does not, 2 when it was not given
 * a database to drive.
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';

import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { JuliusContractPostgresRepository } from '../src/relay/persistence/julius-contract-postgres';
import { createJuliusPostgresRuntimeStore } from '../relay-bridge/julius/postgres-store';
import { createPostgresMissionSeedStore } from '../relay-bridge/julius/mission-seed';
import { assembleLiveJuliusRuntime, driveJuliusRunToTerminal } from '../relay-bridge/julius/live-composition';
import { scriptedAdapter, seededTaskContract, worker } from '../src/relay/mission/julius';
import { DrillRecord, auditProviders, scalarReader, writeAttestation } from './julius-drill-support';
import type { JuliusProviderAdapter, JuliusTask } from '../src/relay/mission/julius';


const runProcess = promisify(execFile);

/* ------------------------------------------------------------- the mission */

const RUN_ID = 'run:recovery-drill';
const PROJECT = 'project:recovery-drill';
const MISSION = 'mission:recovery-drill';
const PLAN = `${RUN_ID}:plan`;
/** Phase 2: the same mission shape on a run of its own, crashed INSIDE the dispatch. */
const HANDED_RUN = 'run:recovery-drill-handed';
const HANDED_MISSION = 'mission:recovery-drill-handed';
const HANDED_PLAN = `${HANDED_RUN}:plan`;

interface DrillRun { readonly runId: string; readonly missionId: string; readonly plan: string; readonly build: string }
const RECOVERED: DrillRun = { runId: RUN_ID, missionId: MISSION, plan: PLAN, build: `${RUN_ID}:build` };
const HANDED: DrillRun = { runId: HANDED_RUN, missionId: HANDED_MISSION, plan: HANDED_PLAN, build: `${HANDED_RUN}:build` };
/** The crash exit code, chosen so an ordinary failure cannot be mistaken for one. */
const CRASH_EXIT = 87;
/**
 * Short enough that a drill can watch it expire, long enough that process A
 * reaches its dispatch first. The orchestrator waits on the DATABASE for the
 * expiry rather than assuming this number elapsed.
 */
const LEASE_MS = 2_000;

/**
 * THE CAPABILITY THIS DRILL CLAIMS, and the production files it drives. The
 * Beta Gate re-derives every digest and refuses the attestation unless these
 * files cover the row's own probe — so this list is a claim the gate checks,
 * not a label it trusts.
 */
export const CAPABILITY = 'RESTART / RECOVERY';
/** The transcript's closing sentence; the gate requires an all-capitals VERIFIED line. */
const DRILL_NAME = 'JULIUS RESTART RECOVERY';
export const EXERCISED = [
  'src/relay/mission/julius/julius-recovery.ts',
  'src/relay/persistence/julius-recovery-postgres.ts',
] as const;

const task = (over: Partial<JuliusTask> & { taskId: string }): JuliusTask => ({
  missionId: MISSION, parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: [],
  taskType: 'build', role: 'CODING_AGENT', ordinal: 0, state: 'RUNNABLE', ...over,
});

const architect = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'drill', adapterId: 'architect-adapter',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'],
});
const coder = worker({
  workerId: 'coder', role: 'CODING_AGENT', providerId: 'drill', adapterId: 'coder-adapter',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'],
});
const reviewer = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'drill', adapterId: 'reviewer-adapter',
  capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:build'],
});

const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Validated architect plan stored for this run.' }] };
const BUILD_OK = { kind: 'succeed' as const, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'node --test: exit 0.' }] };
const REVIEW_OK = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'Independent review approved the change.' }] };

/**
 * THE CRASH, IN TWO PLACES. Not a thrown error, which the pipeline would catch,
 * record and retry — a process that stops existing while holding the lease,
 * which is what a killed container, an OOM and a lost runner all look like
 * from the database.
 *
 * INSIDE THE DISPATCH (phase 2): the worker has the work, so a real provider
 * may already be answering, and charging for it.
 */
const crashingAdapter = (adapterId: string): JuliusProviderAdapter => ({
  adapterId,
  async dispatch() {
    process.stdout.write(`${JSON.stringify({ crashing: true, at: 'dispatch', adapterId })}\n`);
    process.exit(CRASH_EXIT);
  },
});

/**
 * AT THE HANDOFF (phase 1): the process dies at the instant it would record
 * that the work is being handed, which is the last thing Julius writes before
 * the worker is called. Everything else the store does is the store's own.
 *
 * The handoff reaches the store by ONE OF TWO WRITES: the lease-fenced
 * `appendHandoffEvent` ((a2) step 1), which the production store has, or
 * `appendEvent` on a store without it. The process dies at either. Watching
 * `appendEvent` alone stopped this crash from happening at all once the fence
 * landed: process A ran its task to completion, and phase 1 failed.
 */
const dieAtHandoff = (): never => {
  process.stdout.write(`${JSON.stringify({ crashing: true, at: 'handoff' })}\n`);
  process.exit(CRASH_EXIT);
};
const dyingAtHandoff = <S extends object>(store: S): S => new Proxy(store, {
  get(target, key) {
    const value: unknown = Reflect.get(target, key, target);
    if (typeof value !== 'function') return value;
    if (key === 'appendHandoffEvent') {
      return async (input: { readonly event: { readonly type: string } }) => {
        if (input.event.type === 'worker.dispatched') dieAtHandoff();
        return (value as (input: unknown) => Promise<unknown>).call(target, input);
      };
    }
    if (key !== 'appendEvent') return value.bind(target);
    return async (event: { readonly type: string }) => {
      if (event.type === 'worker.dispatched') dieAtHandoff();
      return (value as (event: unknown) => Promise<unknown>).call(target, event);
    };
  },
});

type Crash = 'at-handoff' | 'inside-dispatch' | null;

function runtimeFor(pool: Pool, crashAt: Crash) {
  const store = createJuliusPostgresRuntimeStore(pool);
  const runtime = assembleLiveJuliusRuntime({
    store: crashAt === 'at-handoff' ? dyingAtHandoff(store) : store,
    entries: [
      {
        worker: architect,
        adapter: crashAt === 'inside-dispatch'
          ? crashingAdapter(architect.adapterId)
          : scriptedAdapter(architect, [PLAN_OK, PLAN_OK]),
      },
      { worker: coder, adapter: scriptedAdapter(coder, [BUILD_OK, BUILD_OK]) },
      { worker: reviewer, adapter: scriptedAdapter(reviewer, [REVIEW_OK, REVIEW_OK, REVIEW_OK, REVIEW_OK]) },
    ],
    cardRevision: 'card:recovery-drill', spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 2,
    owner: crashAt === null ? 'recovery-drill-process-b' : 'recovery-drill-process-a',
    leaseMs: LEASE_MS,
  });
  return { store, runtime };
}

/* -------------------------------------------------------------- process A */

/** Bootstraps one drill run through the production seed store and run repository. */
async function bootstrap(pool: Pool, drill: DrillRun): Promise<void> {
  const runs = new JuliusPostgresRepository(pool);
  const contracts = new JuliusContractPostgresRepository(pool);
  const seeds = createPostgresMissionSeedStore(pool);
  const at = new Date().toISOString();
  const { runId, missionId, plan, build } = drill;

  await new TransactionalWonderlandDatabase(pool).migrate();
  await seeds.ensureBase({
    tenantId: 'tenant', projectId: PROJECT, missionId, executionId: `execution:${runId}`,
    cardRevision: 'card:recovery-drill', missionSnapshot: { mission: missionId }, canonicalHash: `hash:${runId}`,
  });
  const created = await runs.createRun({
    commandId: `bootstrap:${runId}`, runId, missionId, projectId: PROJECT,
    cardRevision: 'card:recovery-drill', missionContractRevision: 1, projectBrainRevision: 0, occurredAt: at,
  });
  await seeds.insertCriteria(runId, [{ criterionId: 'AC-1', description: 'The fixture test passes.', requiredEvidenceTypes: [] }]);
  await seeds.insertBrainEntries(runId, PROJECT, [
    { entryId: `brain:seed:${runId}`, kind: 'CONSTRAINT', text: 'OBJECTIVE: prove a Julius run survives losing the process that was running it.', revision: 1 },
  ]);
  await runs.addTask({
    commandId: `task:${plan}`, runId, projectId: PROJECT,
    task: task({ taskId: plan, missionId, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'], ordinal: 0 }),
  });
  // BLOCKED, because only Julius releases work: the accepting plan review does.
  await runs.addTask({
    commandId: `task:${build}`, runId, projectId: PROJECT,
    task: task({ taskId: build, missionId, taskType: 'build', requiredEvidenceTypes: ['TEST'], ordinal: 1, state: 'BLOCKED', dependencyIds: [plan] }),
  });
  await contracts.putTaskContract({
    projectId: PROJECT, occurredAt: at, contract: seededTaskContract({ runId, taskId: build, state: 'draft' }),
  });
  // CREATED → PLANNING → READY: the transition table refuses the shortcut and
  // the production bootstrap port walks it the same way.
  let version = created.version;
  for (const step of ['PLANNING', 'READY'] as const) {
    const moved = await runs.transition({
      commandId: `bootstrap:${runId}:${step}`, runId, projectId: PROJECT, expectedVersion: version,
      to: step, reasonCode: 'BOOTSTRAP', safeSummary: `Mission bootstrap advanced the run to ${step}.`,
      evidenceIds: [], occurredAt: new Date().toISOString(),
    });
    version = moved.version;
  }
}

/** Bootstraps the run and ticks until the planned crash kills the process. */
async function crash(pool: Pool, drill: DrillRun, crashAt: Exclude<Crash, null>): Promise<never> {
  await bootstrap(pool, drill);
  const { runtime } = runtimeFor(pool, crashAt);
  await runtime.loop.tick({ projectId: PROJECT });
  // Only reached if the crash did not happen, which is itself a drill failure.
  process.stdout.write(`${JSON.stringify({ crashing: false })}\n`);
  process.exit(0);
}

/* -------------------------------------------------------------- process B */

/** A process that has never seen the run, recovering it from durable state alone. */
async function resume(pool: Pool, drill: DrillRun): Promise<void> {
  const { store, runtime } = runtimeFor(pool, null);
  const outcome = await driveJuliusRunToTerminal({
    loop: runtime.loop, store, runId: drill.runId, projectId: PROJECT, maxTicks: 24,
  });
  process.stdout.write(`${JSON.stringify({ outcome })}\n`);
}

/* --------------------------------------------------------- orchestration */

async function orchestrate(pool: Pool, outDir: string, repoRoot: string): Promise<number> {
  const record = new DrillRecord();
  const emit = (line: string) => record.say(line);
  const step = (name: string, ok: boolean, detail = '') => record.step(name, ok, detail);
  const self = process.argv[1] ?? '';
  const child = async (mode: string): Promise<{ code: number; stdout: string }> => {
    try {
      const { stdout } = await runProcess(process.execPath, [self, mode], { encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
      return { code: 0, stdout };
    } catch (error) {
      const e = error as { code?: number; stdout?: string };
      return { code: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '' };
    }
  };
  const scalar = scalarReader(pool);

  emit('JULIUS RESTART / RECOVERY DRILL (two processes per phase, one real PostgreSQL, real lease expiries, no provider call)');
  emit('');

  const taskLease = (taskId: string) => scalar(
    `SELECT state||' '||COALESCE(lease_owner,'-')||' g'||lease_generation FROM relay_wonderland.julius_tasks WHERE task_id=$1`, [taskId]);
  const resultsFor = (taskId: string) => scalar(`SELECT count(*) FROM relay_wonderland.julius_worker_results WHERE task_id=$1`, [taskId]);
  /** How often the task was HANDED to a worker: the record Julius writes on the line before the worker is called. */
  const handoffsFor = (taskId: string) => scalar(
    `SELECT count(*) FROM relay_wonderland.events WHERE event_type='julius.worker.dispatched' AND payload->>'taskId'=$1`, [taskId]);
  /** Reservations with no settlement: the arithmetic `cost-accounting.tsv` reads as UNKNOWN spend. */
  const unsettledFor = (runId: string) => scalar(
    `SELECT count(*) FROM relay_wonderland.events r
      WHERE r.event_type='julius.budget.reserved' AND r.stream_id=$1
        AND NOT EXISTS (SELECT 1 FROM relay_wonderland.events s
                         WHERE s.event_type='julius.budget.settled' AND s.stream_id=r.stream_id
                           AND s.payload->'facts'->>'reservationId'=r.payload->'facts'->>'reservationId')`, [runId]);
  /** Reservations the recovery sweep closed ((a2) step 2), by the reason it gave and whether it released them. */
  const closedBySweep = (runId: string, reason: string, released: boolean) => scalar(
    `SELECT count(*) FROM relay_wonderland.events
      WHERE event_type='julius.budget.settled' AND stream_id=$1
        AND payload->'facts'->>'reason'=$2 AND payload->'facts'->>'released'=$3`, [runId, reason, String(released)]);
  const firstSweep = (taskId: string) => scalar(
    `SELECT payload->'facts'->>'action'||'/'||COALESCE(payload->'facts'->>'reasonCode','-')
       FROM relay_wonderland.events
      WHERE event_type='julius.recovery.action' AND payload->>'taskId'=$1 ORDER BY occurred_at LIMIT 1`, [taskId]);
  const stateOf = (table: 'julius_runs' | 'julius_tasks', key: 'run_id' | 'task_id', id: string) =>
    scalar(`SELECT state FROM relay_wonderland.${table} WHERE ${key}=$1`, [id]);
  const leaseExpires = async (taskId: string): Promise<boolean> => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (await scalar(`SELECT lease_expires_at<=now() FROM relay_wonderland.julius_tasks WHERE task_id=$1`, [taskId]) === 'true') return true;
      await new Promise((done) => { setTimeout(done, 250); });
    }
    return false;
  };

  /**
   * A CLEAN DATABASE, OR NOTHING.
   *
   * Run twice against the same database and the second run reads the first
   * one's rows: the sweep already happened, the run already completed, and
   * seven steps report PASS about evidence they did not produce. The verdict
   * would still be FAILED — the crash steps cannot pass twice — but a drill
   * that can report a step it did not exercise is a drill whose transcript is
   * not testimony. So the first thing it does is refuse a database that
   * already holds either of its runs.
   */
  const priorRun = await scalar(`SELECT count(*) FROM relay_wonderland.julius_runs WHERE run_id = ANY($1)`, [[RUN_ID, HANDED_RUN]])
    .catch(() => '0');
  if (priorRun !== '0' && priorRun !== null) {
    step('the drill was given a database that does not already hold its runs', false,
      `${RUN_ID} or ${HANDED_RUN} is already recorded here; a drill must not read another run's evidence as its own`);
    fileAttestation(outDir, repoRoot, record, record.seal(DRILL_NAME));
    return 8;
  }

  /* ---------------------------------------------- phase 1: recovery */
  emit('PHASE 1 — RECOVERY: process A claims the plan task and dies at the handoff, before any worker is called');

  const a = await child('crash');
  step('process A exited by crashing, not by returning', a.code === CRASH_EXIT, `exit ${a.code}`);
  step('the crash happened where the drill aimed it — at the handoff, before the worker', a.stdout.includes('"at":"handoff"'));
  const claimed = await taskLease(PLAN);
  step('the task is durably ACTIVE with the dead process still recorded as its lease holder',
    claimed === 'ACTIVE recovery-drill-process-a g1', String(claimed));
  const handedBefore = await handoffsFor(PLAN);
  step('nothing was handed: no worker ever had this attempt, so nothing can have been paid for', handedBefore === '0', `${handedBefore} handoff(s)`);
  const results = await resultsFor(PLAN);
  step('and the crash left NO worker result behind, so nothing about it was ever banked', results === '0', `${results} result(s)`);

  emit('THE LEASE EXPIRES FOR REAL — the drill waits on the database clock rather than injecting one');
  step('the held lease reached its expiry against the database’s own clock', await leaseExpires(PLAN));

  emit('PROCESS B — a fresh Node process that has never seen this run recovers it from durable state');
  const b = await child('resume');
  step('process B completed its drive without dying', b.code === 0, `exit ${b.code}`);
  const sweep = await firstSweep(PLAN);
  step('the production sweep reclaimed the expired lease and said why', sweep === 'REQUEUE/LEASE_EXPIRED', String(sweep));
  const generation = await scalar(`SELECT lease_generation FROM relay_wonderland.julius_tasks WHERE task_id=$1`, [PLAN]);
  step('the lease generation advanced, so the dead process could never have written back',
    generation !== null && Number(generation) > 1, `generation ${generation}`);
  const state = await stateOf('julius_runs', 'run_id', RUN_ID);
  step('the run picked up where it left off and reached COMPLETED', state === 'COMPLETED', String(state));
  const planState = await stateOf('julius_tasks', 'task_id', PLAN);
  step('the task that was interrupted SUCCEEDED after the requeue', planState === 'SUCCEEDED', String(planState));
  const planResults = await resultsFor(PLAN);
  step('and it ran exactly ONCE after recovery', planResults === '1', `${planResults} result(s)`);
  const handedAfter = await handoffsFor(PLAN);
  step('and it was handed to a worker exactly once in all: process B’s', handedAfter === '1', `${handedAfter} handoff(s)`);
  const releasedBySweep = await closedBySweep(RUN_ID, 'RECOVERED_BEFORE_HANDOFF', true);
  step('the dead attempt’s reservation was RELEASED by the sweep: nothing was handed, so nothing was spent',
    releasedBySweep === '1', `${releasedBySweep} released reservation(s)`);
  const openAfter = await unsettledFor(RUN_ID);
  step('and the run ends with no reservation left open', openAfter === '0', `${openAfter} unsettled reservation(s)`);

  /* ------------------------------------- phase 2: never paid twice */
  emit('');
  emit('PHASE 2 — NEVER PAID TWICE: process A claims the plan task and dies INSIDE the worker’s dispatch');

  const a2 = await child('crash-handed');
  step('process A exited by crashing, not by returning', a2.code === CRASH_EXIT, `exit ${a2.code}`);
  step('the crash happened where the drill aimed it — inside the architect’s dispatch, after the handoff',
    a2.stdout.includes('"at":"dispatch"'));
  const claimed2 = await taskLease(HANDED_PLAN);
  step('the task is durably ACTIVE with the dead process still recorded as its lease holder',
    claimed2 === 'ACTIVE recovery-drill-process-a g1', String(claimed2));
  const handedAttempt = await scalar(
    `SELECT count(*) FROM relay_wonderland.events e JOIN relay_wonderland.julius_tasks t ON t.task_id=e.payload->>'taskId'
      WHERE e.event_type='julius.worker.dispatched' AND t.task_id=$1 AND e.payload->'facts'->>'attempt'=t.attempt::text`, [HANDED_PLAN]);
  step('the handoff was recorded before the worker was called, for the attempt the task is on', handedAttempt === '1', `${handedAttempt} handoff(s)`);
  const heldBefore = await unsettledFor(HANDED_RUN);
  step('and the reservation behind it is held, unsettled', heldBefore === '1', `${heldBefore} unsettled reservation(s)`);

  emit('THE LEASE EXPIRES FOR REAL');
  step('the held lease reached its expiry against the database’s own clock', await leaseExpires(HANDED_PLAN));

  emit('PROCESS B — a fresh Node process that has never seen this run finds it from durable state');
  const b2 = await child('resume-handed');
  step('process B completed its drive without dying', b2.code === 0, `exit ${b2.code}`);
  const sweep2 = await firstSweep(HANDED_PLAN);
  step('the production sweep ended the handed task instead of buying it again, and said why',
    sweep2 === 'FAIL_TASK/HANDED_OUTCOME_UNKNOWN', String(sweep2));
  const state2 = await stateOf('julius_runs', 'run_id', HANDED_RUN);
  step('the run ended FAILED: truthfully, and never re-bought', state2 === 'FAILED', String(state2));
  const planState2 = await stateOf('julius_tasks', 'task_id', HANDED_PLAN);
  step('the handed task is FAILED', planState2 === 'FAILED', String(planState2));
  const handedAfter2 = await handoffsFor(HANDED_PLAN);
  step('and it was never handed again: exactly one handoff in all', handedAfter2 === '1', `${handedAfter2} handoff(s)`);
  const results2 = await resultsFor(HANDED_PLAN);
  step('no result was recorded for it', results2 === '0', `${results2} result(s)`);
  const heldAfter = await unsettledFor(HANDED_RUN);
  const closedUnknown = await closedBySweep(HANDED_RUN, 'RECOVERED_HANDED_OUTCOME_UNKNOWN', false);
  step('and the sweep CLOSED its reservation as an unknown outcome, charged at what it held: never released, never $0',
    closedUnknown === '1' && heldAfter === '0', `${closedUnknown} closed unknown, ${heldAfter} still open`);

  const audit = await auditProviders(scalar, [RUN_ID, HANDED_RUN]);
  step('every dispatch went to the drill’s fake provider — and there WERE dispatches to check',
    audit.dispatches > 0 && audit.providers === 'drill', `${audit.dispatches} dispatch(es), providers: ${audit.providers}`);

  const verified = record.seal(DRILL_NAME);
  fileAttestation(outDir, repoRoot, record, verified);
  return verified ? 0 : 8;
}

/* ------------------------------------------------------------ attestation */

export const TRANSCRIPT_FILE = 'julius-recovery-drill.transcript.txt';
export const DRILL_COMMAND = 'npm run julius:recovery-drill';
export const INFRASTRUCTURE = 'real-postgres,two-processes,real-lease-expiry,no-provider-call';

const fileAttestation = (outDir: string, repoRoot: string, record: DrillRecord, verified: boolean): void =>
  writeAttestation({
    outDir, repoRoot, record, verified,
    capability: CAPABILITY, drill: DRILL_COMMAND, exercised: EXERCISED,
    infrastructure: INFRASTRUCTURE, transcriptFile: TRANSCRIPT_FILE,
  });

/* ------------------------------------------------------------------ entry */

/**
 * The whole drill as a function, so the thin `-main` entry beside it owns the
 * only knowledge of where this file sits on disk and nothing here has to ask.
 */
export async function runRecoveryDrill(input: {
  readonly argv: readonly string[];
  readonly repoRoot: string;
  readonly databaseUrl: string | undefined;
}): Promise<number> {
  if (input.databaseUrl === undefined || input.databaseUrl.trim() === '') {
    process.stderr.write('julius_recovery_drill_requires_database_url: set DATABASE_URL to a PostgreSQL this drill may destroy\n');
    return 2;
  }
  const modes = ['crash', 'resume', 'crash-handed', 'resume-handed'] as const;
  const mode = modes.find((known) => known === input.argv[0]) ?? 'orchestrate';
  const outIndex = input.argv.indexOf('--out');
  const outDir = outIndex >= 0 && input.argv[outIndex + 1] !== undefined
    ? resolve(input.argv[outIndex + 1]!)
    : join(input.repoRoot, 'julius-capability-proofs');
  const pool = new Pool({ connectionString: input.databaseUrl });
  try {
    if (mode === 'crash') { await crash(pool, RECOVERED, 'at-handoff'); return 0; }
    if (mode === 'resume') { await resume(pool, RECOVERED); return 0; }
    if (mode === 'crash-handed') { await crash(pool, HANDED, 'inside-dispatch'); return 0; }
    if (mode === 'resume-handed') { await resume(pool, HANDED); return 0; }
    const code = await orchestrate(pool, outDir, input.repoRoot);
    process.stdout.write(readFileSync(join(outDir, TRANSCRIPT_FILE), 'utf8'));
    return code;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
