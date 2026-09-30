/**
 * THE JULIUS FAILURE RECOVERY DRILL — a transient provider failure that is
 * retried and succeeds, and a permanent one that is not retried at all.
 *
 * WHY IT EXISTS. The Beta Gate will report FAILURE RECOVERY as CAPABILITY
 * PROVEN only on a drill attestation, never on the fact that the coordinator's
 * source is in the tree, and a mission in which nothing failed retryably reads
 * NOT EXERCISED — correctly, because nothing did. So the capability needs
 * something that makes a failure happen on purpose, against a real database,
 * and then checks what the runtime did about it.
 *
 * WHAT IT DRIVES, all production: `JuliusExecutionCoordinator` classifies the
 * provider error and answers RETRY or FAILED; the task pipeline turns a RETRY
 * into a requeue with a next attempt time and a `julius.retry.scheduled` event,
 * and a FAILED into a terminal task; the run loop claims the requeued task
 * again on a later tick. The adapters are scripted fakes and no provider client
 * is constructed anywhere in this file.
 *
 * BOTH DIRECTIONS, IN ONE DRILL, because only the second makes the first mean
 * anything. A runtime that retried EVERYTHING would pass a positive-only drill
 * and would also retry an authentication failure forever, spending an attempt
 * per round on a credential that will never work.
 *
 *   RUN A — the architect's first dispatch fails TIMEOUT. The task must go back
 *   to RUNNABLE with a next attempt time rather than FAILED, exactly one
 *   attempt must be spent, the second dispatch must succeed, and the mission
 *   must reach COMPLETED. A retry that never retries and a retry that loops are
 *   both failures here.
 *
 *   RUN B — the architect's dispatch fails AUTH_CONFIGURATION, which is
 *   permanent. NO retry may be scheduled, the task must reach FAILED, and the
 *   run must end FAILED. A drill that only proved run A would call a runtime
 *   that retries everything a success.
 *
 *   DATABASE_URL=…/julius_failure_recovery_drill node dist-relay-bridge/julius-failure-recovery-drill.cjs [--out <dir>]
 *
 * Exit 0 when every step passes, 8 when any does not (a database holding any
 * run but its own included), 2 without a THROWAWAY database: `…/julius` and any
 * name that is not a drill's is refused before connecting.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';

import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { JuliusContractPostgresRepository } from '../src/relay/persistence/julius-contract-postgres';
import { createJuliusPostgresRuntimeStore } from '../relay-bridge/julius/postgres-store';
import { createPostgresMissionSeedStore } from '../relay-bridge/julius/mission-seed';
import { assembleLiveJuliusRuntime, driveJuliusRunToTerminal } from '../relay-bridge/julius/live-composition';
import { scriptedAdapter, seededTaskContract, worker } from '../src/relay/mission/julius';
import type { JuliusTask, ScriptedOutcome } from '../src/relay/mission/julius';
import { DrillRecord, auditProviders, drillDatabaseTarget, foreignJuliusRuns, scalarReader, writeDrillAttestation } from './julius-drill-support';
import { JULIUS_CAPABILITY_DRILLS } from './julius-drill-closure.mjs';

export const CAPABILITY = 'FAILURE RECOVERY';
/**
 * THIS DRILL'S ENTRY in the one table the Beta Gate holds every attestation to:
 * the sentence its transcript closes on (`<name> VERIFIED`, which no other drill
 * writes), the transcript file and the command. Read, never retyped.
 */
const DRILL = JULIUS_CAPABILITY_DRILLS[CAPABILITY];
const DRILL_NAME = DRILL.name;
export const TRANSCRIPT_FILE = DRILL.transcript;
export const DRILL_COMMAND = `npm run ${DRILL.script}`;
export const INFRASTRUCTURE = 'real-postgres,transient-and-permanent-failures,no-provider-call';
export const EXERCISED = [
  'src/relay/mission/julius/julius-execution-coordinator.ts',
  'src/relay/mission/julius/julius-continuation.ts',
] as const;

const PROJECT = 'project:failure-drill';
const MISSION = 'mission:failure-drill';
/** Two runs: the transient failure that recovers, and the permanent one that must not. */
const TRANSIENT = 'run:failure-drill-transient';
const PERMANENT = 'run:failure-drill-permanent';

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

const PLAN_OK: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Validated architect plan stored for this run.' }] };
const BUILD_OK: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'node --test: exit 0.' }] };
const REVIEW_OK: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'Independent review approved the change.' }] };
/** Transient: the provider took too long. The runtime's own classifier decides it is retryable. */
const TIMEOUT: ScriptedOutcome = { kind: 'fail', code: 'TIMEOUT' };
/** Permanent: the credential is wrong, and it will be just as wrong next time. */
const AUTH: ScriptedOutcome = { kind: 'fail', code: 'AUTH_CONFIGURATION' };

const task = (over: Partial<JuliusTask> & { taskId: string }): JuliusTask => ({
  missionId: MISSION, parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: [],
  taskType: 'build', role: 'CODING_AGENT', ordinal: 0, state: 'RUNNABLE', ...over,
});

/** Seeds one run exactly as the production bootstrap does, and drives it to terminal. */
async function driveRun(pool: Pool, runId: string, architectScript: readonly ScriptedOutcome[]) {
  const runs = new JuliusPostgresRepository(pool);
  const contracts = new JuliusContractPostgresRepository(pool);
  const seeds = createPostgresMissionSeedStore(pool);
  const at = new Date().toISOString();
  const plan = `${runId}:plan`;
  const build = `${runId}:build`;

  await seeds.ensureBase({
    tenantId: 'tenant', projectId: PROJECT, missionId: MISSION, executionId: `execution:${runId}`,
    cardRevision: 'card:failure-drill', missionSnapshot: { mission: MISSION }, canonicalHash: 'hash:failure-drill',
  });
  const created = await runs.createRun({
    commandId: `bootstrap:${runId}`, runId, missionId: MISSION, projectId: PROJECT,
    cardRevision: 'card:failure-drill', missionContractRevision: 1, projectBrainRevision: 0, occurredAt: at,
  });
  await seeds.insertCriteria(runId, [{ criterionId: 'AC-1', description: 'The fixture test passes.', requiredEvidenceTypes: [] }]);
  await seeds.insertBrainEntries(runId, PROJECT, [
    { entryId: `brain:${runId}`, kind: 'CONSTRAINT', text: 'OBJECTIVE: prove a transient provider failure is retried and a permanent one is not.', revision: 1 },
  ]);
  await runs.addTask({
    commandId: `task:${plan}`, runId, projectId: PROJECT,
    task: task({ taskId: plan, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'], ordinal: 0 }),
  });
  // BLOCKED, because only Julius releases work: the accepting plan review does.
  await runs.addTask({
    commandId: `task:${build}`, runId, projectId: PROJECT,
    task: task({ taskId: build, taskType: 'build', requiredEvidenceTypes: ['TEST'], ordinal: 1, state: 'BLOCKED', dependencyIds: [plan] }),
  });
  await contracts.putTaskContract({
    projectId: PROJECT, occurredAt: at, contract: seededTaskContract({ runId, taskId: build, state: 'draft' }),
  });
  let version = created.version;
  for (const step of ['PLANNING', 'READY'] as const) {
    const moved = await runs.transition({
      commandId: `bootstrap:${runId}:${step}`, runId, projectId: PROJECT, expectedVersion: version,
      to: step, reasonCode: 'BOOTSTRAP', safeSummary: `Mission bootstrap advanced the run to ${step}.`,
      evidenceIds: [], occurredAt: new Date().toISOString(),
    });
    version = moved.version;
  }

  const store = createJuliusPostgresRuntimeStore(pool);
  const architectAdapter = scriptedAdapter(architect, architectScript);
  const runtime = assembleLiveJuliusRuntime({
    store,
    entries: [
      { worker: architect, adapter: architectAdapter },
      { worker: coder, adapter: scriptedAdapter(coder, [BUILD_OK, BUILD_OK]) },
      { worker: reviewer, adapter: scriptedAdapter(reviewer, [REVIEW_OK, REVIEW_OK, REVIEW_OK, REVIEW_OK]) },
    ],
    cardRevision: 'card:failure-drill', spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 2,
    owner: 'failure-recovery-drill',
  });
  const outcome = await driveJuliusRunToTerminal({ loop: runtime.loop, store, runId, projectId: PROJECT, maxTicks: 24 });
  return { outcome, dispatches: architectAdapter.dispatches.length, plan, build };
}

/* --------------------------------------------------------- orchestration */

async function orchestrate(pool: Pool, outDir: string, repoRoot: string): Promise<number> {
  const record = new DrillRecord();
  const scalar = scalarReader(pool);
  const file = (verified: boolean) => writeDrillAttestation({
    outDir, repoRoot, record, verified,
    capability: CAPABILITY, drill: DRILL_COMMAND, exercised: EXERCISED,
    infrastructure: INFRASTRUCTURE, transcriptFile: TRANSCRIPT_FILE,
  });

  record.say(`${DRILL_NAME} DRILL (one real PostgreSQL, a transient failure and a permanent one, no provider call)`);
  record.say('');

  /**
   * A CLEAN DATABASE, OR NOTHING — and asked BEFORE the migration, which is a
   * write. A database holding anybody else's run is somebody's store whatever
   * it is called. Run twice against the same one and the second run reads the
   * first's retry rows and reports PASS about evidence it did not produce. A
   * drill whose transcript can describe a step it did not exercise is not
   * testimony.
   */
  const foreign = await foreignJuliusRuns(scalar, [TRANSIENT, PERMANENT]);
  if (foreign > 0) {
    record.step('the drill was given a throwaway database, holding no Julius run but its own', false,
      `${foreign} run(s) here are not this drill's; a drill writes only where nothing else lives`);
    file(record.seal(DRILL_NAME));
    return 8;
  }
  const prior = await scalar(
    `SELECT count(*) FROM relay_wonderland.julius_runs WHERE run_id IN ($1,$2)`, [TRANSIENT, PERMANENT]).catch(() => '0');
  if (prior !== '0' && prior !== null) {
    record.step('the drill was given a database that does not already hold its runs', false,
      "its runs are already recorded here; a drill must not read another run's evidence as its own");
    file(record.seal(DRILL_NAME));
    return 8;
  }
  await new TransactionalWonderlandDatabase(pool).migrate();

  /* ------------------------------------- RUN A: transient, and it must recover */
  record.say('RUN A — the architect times out once, and the runtime is expected to try again');
  const a = await driveRun(pool, TRANSIENT, [TIMEOUT, PLAN_OK, PLAN_OK]);

  const scheduled = await scalar(
    `SELECT e.payload->'facts'->>'code'||'/'||COALESCE(e.payload->'facts'->>'errorRetryable','?')
       FROM relay_wonderland.events e
      WHERE e.event_type='julius.retry.scheduled' AND e.payload->>'taskId'=$1 ORDER BY e.occurred_at LIMIT 1`, [a.plan]);
  record.step('the runtime classified the timeout as retryable and scheduled a retry',
    scheduled === 'TIMEOUT/true', String(scheduled));

  const failedTerminally = await scalar(
    `SELECT count(*) FROM relay_wonderland.events WHERE event_type='julius.task.failed' AND payload->>'taskId'=$1`, [a.plan]);
  record.step('and did NOT end the task — a retry is a hand-back, not a failure',
    failedTerminally === '0', `${failedTerminally} terminal failure event(s)`);

  record.step('the architect was dispatched exactly twice: the timeout, then the retry',
    a.dispatches === 2, `${a.dispatches} dispatch(es)`);

  const attempt = await scalar(`SELECT attempt FROM relay_wonderland.julius_tasks WHERE task_id=$1`, [a.plan]);
  record.step('exactly one further attempt was spent — a retry costs an attempt and not two',
    attempt === '2', `attempt ${attempt}`);

  const planState = await scalar(`SELECT state FROM relay_wonderland.julius_tasks WHERE task_id=$1`, [a.plan]);
  record.step('the retried task SUCCEEDED', planState === 'SUCCEEDED', String(planState));
  record.step('and the mission it belongs to reached COMPLETED',
    a.outcome.state === 'COMPLETED', `${a.outcome.state} after ${a.outcome.ticks} tick(s)${a.outcome.haltCause ? ` (${a.outcome.haltCause})` : ''}`);

  /* --------------------------- RUN B: permanent, and it must NOT be retried */
  record.say('');
  record.say('RUN B — the architect fails on its credential, which will be just as wrong next time');
  const b = await driveRun(pool, PERMANENT, [AUTH, AUTH, AUTH]);

  const retriedAnyway = await scalar(
    `SELECT count(*) FROM relay_wonderland.events WHERE event_type='julius.retry.scheduled' AND payload->>'taskId'=$1`, [b.plan]);
  record.step('NO retry was scheduled for a permanent failure — a runtime that retries everything proves nothing',
    retriedAnyway === '0', `${retriedAnyway} retry event(s)`);

  record.step('and the architect was dispatched exactly once', b.dispatches === 1, `${b.dispatches} dispatch(es)`);

  const permanentClass = await scalar(
    `SELECT e.payload->'facts'->>'code'||'/'||COALESCE(e.payload->'facts'->>'errorRetryable','?')
       FROM relay_wonderland.events e
      WHERE e.event_type='julius.task.failed' AND e.payload->>'taskId'=$1 ORDER BY e.occurred_at LIMIT 1`, [b.plan]);
  record.step('the durable record names the class and says it was not retryable',
    permanentClass === 'AUTH_CONFIGURATION/false', String(permanentClass));

  const bState = await scalar(`SELECT state FROM relay_wonderland.julius_tasks WHERE task_id=$1`, [b.plan]);
  record.step('the task reached FAILED rather than waiting for an attempt that could not help',
    bState === 'FAILED', String(bState));
  record.step('and the run ended FAILED rather than hanging',
    b.outcome.state === 'FAILED', `${b.outcome.state} after ${b.outcome.ticks} tick(s)`);

  /* -------------------------------------------- and it cost nothing to prove */
  const audit = await auditProviders(scalar, [TRANSIENT, PERMANENT]);
  record.step('every dispatch in BOTH runs went to the drill’s fake provider — and there WERE dispatches to check',
    audit.dispatches > 0 && audit.providers === 'drill', `${audit.dispatches} dispatch(es), providers: ${audit.providers}`);

  const verified = record.seal(DRILL_NAME);
  file(verified);
  return verified ? 0 : 8;
}

/* ------------------------------------------------------------------ entry */

export async function runFailureRecoveryDrill(input: {
  readonly argv: readonly string[];
  readonly repoRoot: string;
  readonly databaseUrl: string | undefined;
  /** The repository's declared throwaway, which a drill may also be pointed at. */
  readonly testDatabaseUrl?: string | undefined;
}): Promise<number> {
  // REFUSED BEFORE ANY CONNECTION (see `drillDatabaseTarget`).
  const target = drillDatabaseTarget({ databaseUrl: input.databaseUrl, testDatabaseUrl: input.testDatabaseUrl });
  if (!target.ok) {
    process.stderr.write(`julius_failure_recovery_drill_refused_database: ${target.code}: ${target.reason}\n`);
    return 2;
  }
  const outIndex = input.argv.indexOf('--out');
  const outDir = outIndex >= 0 && input.argv[outIndex + 1] !== undefined
    ? resolve(input.argv[outIndex + 1]!)
    : join(input.repoRoot, 'julius-capability-proofs');
  const pool = new Pool({ connectionString: target.url });
  try {
    const code = await orchestrate(pool, outDir, input.repoRoot);
    process.stdout.write(readFileSync(join(outDir, TRANSCRIPT_FILE), 'utf8'));
    return code;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
