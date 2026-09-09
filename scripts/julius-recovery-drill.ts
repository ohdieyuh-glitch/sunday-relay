/**
 * THE JULIUS RESTART / RECOVERY DRILL — two real processes, one real database,
 * one real expiry, zero provider calls.
 *
 * WHY IT EXISTS. A flawless mission never crashes, so it never exercises
 * recovery, and the Beta Gate refuses to infer a capability from the fact that
 * its source is in the tree. Something has to actually drive the production
 * recovery path, and a unit test with a stubbed pool is not that: it proves the
 * SQL string this repository types, not that PostgreSQL executes it, not that a
 * lease expires against a wall clock, and not that a process which has never
 * seen the run can pick it up from durable state alone.
 *
 * WHAT IT DRIVES, and every part of it is production:
 *
 *   PROCESS A bootstraps a mission through the production seed store and the
 *   production run repository, then ticks the production run loop. Its worker
 *   adapter calls `process.exit(87)` in the middle of a dispatch — the task is
 *   ACTIVE, the lease is held, the generation is recorded, and NOTHING has been
 *   written back. That is a crash, not a cancellation: no handler runs, no
 *   lease is released, no result is recorded.
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
 *   The run then finishes.
 *
 * WHAT IS NOT PRODUCTION, stated rather than implied: the three C.A.R.D. role
 * adapters are fakes, exactly as the Relay recovery drill's are. This drill
 * proves the RECOVERY path, and a provider call proves nothing about it while
 * costing money the founder has not been asked for. No provider client is
 * constructed anywhere in this file.
 *
 * WHAT IT REFUSES TO CALL SUCCESS. A recovery that replays the crashed
 * dispatch is not a recovery, it is a double spend; the drill fails unless the
 * crashed attempt left no result behind and the reclaimed task ran exactly
 * once afterwards. A run that completes without the sweep having acted is not
 * a recovery either, and fails the same way.
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
import { DrillRecord, scalarReader, writeAttestation } from './julius-drill-support';
import type { JuliusProviderAdapter, JuliusTask } from '../src/relay/mission/julius';


const runProcess = promisify(execFile);

/* ------------------------------------------------------------- the mission */

const RUN_ID = 'run:recovery-drill';
const PROJECT = 'project:recovery-drill';
const MISSION = 'mission:recovery-drill';
const PLAN = `${RUN_ID}:plan`;
const BUILD = `${RUN_ID}:build`;
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
 * THE CRASH. Not a thrown error, which the pipeline would catch, record and
 * retry — a process that stops existing while holding the lease, which is what
 * a killed container, an OOM and a lost runner all look like from the database.
 */
const crashingAdapter = (adapterId: string): JuliusProviderAdapter => ({
  adapterId,
  async dispatch() {
    process.stdout.write(`${JSON.stringify({ crashing: true, adapterId })}\n`);
    process.exit(CRASH_EXIT);
  },
});

function runtimeFor(pool: Pool, crashRole: 'PROMPT_ARCHITECT' | null) {
  const store = createJuliusPostgresRuntimeStore(pool);
  const runtime = assembleLiveJuliusRuntime({
    store,
    entries: [
      {
        worker: architect,
        adapter: crashRole === 'PROMPT_ARCHITECT'
          ? crashingAdapter(architect.adapterId)
          : scriptedAdapter(architect, [PLAN_OK, PLAN_OK]),
      },
      { worker: coder, adapter: scriptedAdapter(coder, [BUILD_OK, BUILD_OK]) },
      { worker: reviewer, adapter: scriptedAdapter(reviewer, [REVIEW_OK, REVIEW_OK, REVIEW_OK, REVIEW_OK]) },
    ],
    cardRevision: 'card:recovery-drill', spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 2,
    owner: crashRole === null ? 'recovery-drill-process-b' : 'recovery-drill-process-a',
    leaseMs: LEASE_MS,
  });
  return { store, runtime };
}

/* -------------------------------------------------------------- process A */

/** Bootstraps the mission and ticks until the architect dispatch kills the process. */
async function crash(pool: Pool): Promise<never> {
  const runs = new JuliusPostgresRepository(pool);
  const contracts = new JuliusContractPostgresRepository(pool);
  const seeds = createPostgresMissionSeedStore(pool);
  const at = new Date().toISOString();

  await new TransactionalWonderlandDatabase(pool).migrate();
  await seeds.ensureBase({
    tenantId: 'tenant', projectId: PROJECT, missionId: MISSION, executionId: 'execution:recovery-drill',
    cardRevision: 'card:recovery-drill', missionSnapshot: { mission: MISSION }, canonicalHash: 'hash:recovery-drill',
  });
  const created = await runs.createRun({
    commandId: `bootstrap:${RUN_ID}`, runId: RUN_ID, missionId: MISSION, projectId: PROJECT,
    cardRevision: 'card:recovery-drill', missionContractRevision: 1, projectBrainRevision: 0, occurredAt: at,
  });
  await seeds.insertCriteria(RUN_ID, [{ criterionId: 'AC-1', description: 'The fixture test passes.', requiredEvidenceTypes: [] }]);
  await seeds.insertBrainEntries(RUN_ID, PROJECT, [
    { entryId: 'brain:seed', kind: 'CONSTRAINT', text: 'OBJECTIVE: prove a Julius run survives losing the process that was running it.', revision: 1 },
  ]);
  await runs.addTask({
    commandId: `task:${PLAN}`, runId: RUN_ID, projectId: PROJECT,
    task: task({ taskId: PLAN, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'], ordinal: 0 }),
  });
  // BLOCKED, because only Julius releases work: the accepting plan review does.
  await runs.addTask({
    commandId: `task:${BUILD}`, runId: RUN_ID, projectId: PROJECT,
    task: task({ taskId: BUILD, taskType: 'build', requiredEvidenceTypes: ['TEST'], ordinal: 1, state: 'BLOCKED', dependencyIds: [PLAN] }),
  });
  await contracts.putTaskContract({
    projectId: PROJECT, occurredAt: at, contract: seededTaskContract({ runId: RUN_ID, taskId: BUILD, state: 'draft' }),
  });
  // CREATED → PLANNING → READY: the transition table refuses the shortcut and
  // the production bootstrap port walks it the same way.
  let version = created.version;
  for (const step of ['PLANNING', 'READY'] as const) {
    const moved = await runs.transition({
      commandId: `bootstrap:${RUN_ID}:${step}`, runId: RUN_ID, projectId: PROJECT, expectedVersion: version,
      to: step, reasonCode: 'BOOTSTRAP', safeSummary: `Mission bootstrap advanced the run to ${step}.`,
      evidenceIds: [], occurredAt: new Date().toISOString(),
    });
    version = moved.version;
  }

  const { runtime } = runtimeFor(pool, 'PROMPT_ARCHITECT');
  await runtime.loop.tick({ projectId: PROJECT });
  // Only reached if the adapter did not crash, which is itself a drill failure.
  process.stdout.write(`${JSON.stringify({ crashing: false })}\n`);
  process.exit(0);
}

/* -------------------------------------------------------------- process B */

/** A process that has never seen the run, recovering it from durable state alone. */
async function resume(pool: Pool): Promise<void> {
  const { store, runtime } = runtimeFor(pool, null);
  const outcome = await driveJuliusRunToTerminal({
    loop: runtime.loop, store, runId: RUN_ID, projectId: PROJECT, maxTicks: 24,
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

  emit('JULIUS RESTART / RECOVERY DRILL (two processes, one real PostgreSQL, one real lease expiry, no provider call)');
  emit('');

  /**
   * A CLEAN DATABASE, OR NOTHING.
   *
   * Run twice against the same database and the second run reads the first
   * one's rows: the sweep already happened, the run already completed, and
   * seven steps report PASS about evidence they did not produce. The verdict
   * would still be FAILED — the crash steps cannot pass twice — but a drill
   * that can report a step it did not exercise is a drill whose transcript is
   * not testimony. So the first thing it does is refuse a database that
   * already holds its run.
   */
  const priorRun = await scalar(`SELECT count(*) FROM relay_wonderland.julius_runs WHERE run_id=$1`, [RUN_ID])
    .catch(() => '0');
  if (priorRun !== '0' && priorRun !== null) {
    step('the drill was given a database that does not already hold its run', false,
      `${RUN_ID} is already recorded here; a drill must not read another run's evidence as its own`);
    fileAttestation(outDir, repoRoot, record, record.seal(DRILL_NAME));
    return 8;
  }

  emit('PROCESS A — bootstraps the mission, claims the plan task, and dies mid-dispatch with the lease held');

  const a = await child('crash');
  step('process A exited by crashing inside a dispatch, not by returning', a.code === CRASH_EXIT, `exit ${a.code}`);
  step('the crash happened where the drill aimed it — inside the architect adapter', a.stdout.includes('"crashing":true'));

  const claimed = await scalar(
    `SELECT state||' '||COALESCE(lease_owner,'-')||' g'||lease_generation FROM relay_wonderland.julius_tasks WHERE task_id=$1`, [PLAN]);
  step('the task is durably ACTIVE with the dead process still recorded as its lease holder',
    claimed === 'ACTIVE recovery-drill-process-a g1', String(claimed));
  const results = await scalar(`SELECT count(*) FROM relay_wonderland.julius_worker_results WHERE task_id=$1`, [PLAN]);
  step('and the crash left NO worker result behind, so nothing about it was ever banked', results === '0', `${results} result(s)`);

  emit('');
  emit('THE LEASE EXPIRES FOR REAL — the drill waits on the database clock rather than injecting one');
  const deadline = Date.now() + 60_000;
  let expired = false;
  while (Date.now() < deadline && !expired) {
    expired = await scalar(`SELECT lease_expires_at<=now() FROM relay_wonderland.julius_tasks WHERE task_id=$1`, [PLAN]) === 'true';
    if (!expired) await new Promise((done) => { setTimeout(done, 250); });
  }
  step('the held lease reached its expiry against the database’s own clock', expired);

  emit('');
  emit('PROCESS B — a fresh Node process that has never seen this run recovers it from durable state');
  const b = await child('resume');
  step('process B completed its drive without dying', b.code === 0, `exit ${b.code}`);

  const sweep = await scalar(
    `SELECT payload->'facts'->>'action'||'/'||COALESCE(payload->'facts'->>'reasonCode','-')
       FROM relay_wonderland.events
      WHERE event_type='julius.recovery.action' AND payload->>'taskId'=$1 ORDER BY occurred_at LIMIT 1`, [PLAN]);
  step('the production sweep reclaimed the expired lease and said why',
    sweep === 'REQUEUE/LEASE_EXPIRED', String(sweep));
  const generation = await scalar(`SELECT lease_generation FROM relay_wonderland.julius_tasks WHERE task_id=$1`, [PLAN]);
  step('the lease generation advanced, so the dead process could never have written back',
    generation !== null && Number(generation) > 1, `generation ${generation}`);

  const state = await scalar(`SELECT state FROM relay_wonderland.julius_runs WHERE run_id=$1`, [RUN_ID]);
  step('the run picked up where it left off and reached COMPLETED', state === 'COMPLETED', String(state));
  const planState = await scalar(`SELECT state FROM relay_wonderland.julius_tasks WHERE task_id=$1`, [PLAN]);
  step('the task that was interrupted SUCCEEDED after the requeue', planState === 'SUCCEEDED', String(planState));
  const planResults = await scalar(`SELECT count(*) FROM relay_wonderland.julius_worker_results WHERE task_id=$1`, [PLAN]);
  step('and it ran exactly ONCE after recovery — a replayed dispatch is a double spend, not a recovery',
    planResults === '1', `${planResults} result(s)`);
  const receipts = await scalar(
    `SELECT count(*) FROM relay_wonderland.events WHERE event_type='julius.provider.call' AND payload->>'taskId'=$1`, [PLAN]);
  step('zero provider calls were made by either process (fake adapters only)', receipts === '0' || receipts === null);

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
  const mode = input.argv[0] === 'crash' || input.argv[0] === 'resume' ? input.argv[0] : 'orchestrate';
  const outIndex = input.argv.indexOf('--out');
  const outDir = outIndex >= 0 && input.argv[outIndex + 1] !== undefined
    ? resolve(input.argv[outIndex + 1]!)
    : join(input.repoRoot, 'julius-capability-proofs');
  const pool = new Pool({ connectionString: input.databaseUrl });
  try {
    if (mode === 'crash') { await crash(pool); return 0; }
    if (mode === 'resume') { await resume(pool); return 0; }
    const code = await orchestrate(pool, outDir, input.repoRoot);
    process.stdout.write(readFileSync(join(outDir, TRANSCRIPT_FILE), 'utf8'));
    return code;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
