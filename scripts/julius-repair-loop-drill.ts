/**
 * THE JULIUS REPAIR LOOP DRILL — a review that rejects, a repair that is
 * created only because it was proven routable, and a re-review that accepts.
 *
 * WHY IT EXISTS. A mission whose reviewer approves the build first time is the
 * best outcome the product has, and it creates no repair — so the Beta Gate
 * reports REPAIR LOOP as NOT EXERCISED there, correctly, and will call the
 * capability proven only on a drill attestation. Demanding that a healthy paid
 * mission be rejected on purpose to score the row is the thing the two-axis
 * model exists to avoid.
 *
 * WHAT IT DRIVES, all production: `planJuliusRepair` derives the repair's id,
 * round, findings and — the part paid run 34037313976 got wrong — its TASK
 * TYPE and ROLE, which are its subject's stage on its subject's role. That run
 * minted a `repair:plan` on the Coding Agent and nobody could route it; the
 * pipeline now proves a repair routable BEFORE creating it and halts with
 * REPAIR_UNROUTABLE otherwise. The adapters are scripted fakes and no provider
 * client is constructed anywhere in this file.
 *
 * WHAT IT REFUSES TO CALL SUCCESS. A repair loop that merely produces a task is
 * not a repair loop. The drill fails unless the repair inherits its subject's
 * role and stage (never `repair:repair:*`), carries the blocking finding that
 * caused it, is re-reviewed, and the run then COMPLETES — and unless the round
 * bound holds: a second rejection of the repaired work must not mint an
 * unbounded third round.
 *
 *   DATABASE_URL=… node dist-relay-bridge/julius-repair-loop-drill.cjs [--out <dir>]
 *
 * Exit 0 when every step passes, 8 when any does not, 2 with no database.
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
import { DrillRecord, auditProviders, scalarReader, writeAttestation } from './julius-drill-support';

export const CAPABILITY = 'REPAIR LOOP';
/** The transcript's closing sentence; the gate requires an all-capitals VERIFIED line. */
const DRILL_NAME = 'JULIUS REPAIR LOOP';
export const TRANSCRIPT_FILE = 'julius-repair-loop-drill.transcript.txt';
export const DRILL_COMMAND = 'npm run julius:repair-loop-drill';
export const INFRASTRUCTURE = 'real-postgres,rejected-review,bounded-rounds,no-provider-call';
export const EXERCISED = ['src/relay/mission/julius/julius-repair-runtime.ts'] as const;

const RUN_ID = 'run:repair-drill';
const PROJECT = 'project:repair-drill';
const MISSION = 'mission:repair-drill';
const PLAN = `${RUN_ID}:plan`;
const BUILD = `${RUN_ID}:build`;

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
const REVIEW_ACCEPT: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'Independent review approved the change.' }] };
/** The rejection the whole loop hangs on: one blocking finding against the build. */
const REVIEW_REJECT: ScriptedOutcome = { kind: 'succeed', evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The change is untested.' }] };

const task = (over: Partial<JuliusTask> & { taskId: string }): JuliusTask => ({
  missionId: MISSION, parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: [],
  taskType: 'build', role: 'CODING_AGENT', ordinal: 0, state: 'RUNNABLE', ...over,
});

/* --------------------------------------------------------- orchestration */

async function orchestrate(pool: Pool, outDir: string, repoRoot: string): Promise<number> {
  const record = new DrillRecord();
  const scalar = scalarReader(pool);
  const file = (verified: boolean) => writeAttestation({
    outDir, repoRoot, record, verified,
    capability: CAPABILITY, drill: DRILL_COMMAND, exercised: EXERCISED,
    infrastructure: INFRASTRUCTURE, transcriptFile: TRANSCRIPT_FILE,
  });

  record.say(`${DRILL_NAME} DRILL (one real PostgreSQL, a rejecting review, a bounded repair round, no provider call)`);
  record.say('');

  await new TransactionalWonderlandDatabase(pool).migrate();
  const prior = await scalar(`SELECT count(*) FROM relay_wonderland.julius_runs WHERE run_id=$1`, [RUN_ID]).catch(() => '0');
  if (prior !== '0' && prior !== null) {
    record.step('the drill was given a database that does not already hold its run', false,
      `${RUN_ID} is already recorded here; a drill must not read another run's evidence as its own`);
    file(record.seal(DRILL_NAME));
    return 8;
  }

  /* --------------------------------------- the mission, as production seeds it */
  const runs = new JuliusPostgresRepository(pool);
  const contracts = new JuliusContractPostgresRepository(pool);
  const seeds = createPostgresMissionSeedStore(pool);
  const at = new Date().toISOString();
  await seeds.ensureBase({
    tenantId: 'tenant', projectId: PROJECT, missionId: MISSION, executionId: 'execution:repair-drill',
    cardRevision: 'card:repair-drill', missionSnapshot: { mission: MISSION }, canonicalHash: 'hash:repair-drill',
  });
  const created = await runs.createRun({
    commandId: `bootstrap:${RUN_ID}`, runId: RUN_ID, missionId: MISSION, projectId: PROJECT,
    cardRevision: 'card:repair-drill', missionContractRevision: 1, projectBrainRevision: 0, occurredAt: at,
  });
  await seeds.insertCriteria(RUN_ID, [{ criterionId: 'AC-1', description: 'The fixture test passes.', requiredEvidenceTypes: [] }]);
  await seeds.insertBrainEntries(RUN_ID, PROJECT, [
    { entryId: 'brain:seed', kind: 'CONSTRAINT', text: 'OBJECTIVE: prove a rejected build is repaired and re-reviewed.', revision: 1 },
  ]);
  await runs.addTask({
    commandId: `task:${PLAN}`, runId: RUN_ID, projectId: PROJECT,
    task: task({ taskId: PLAN, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'], ordinal: 0 }),
  });
  await runs.addTask({
    commandId: `task:${BUILD}`, runId: RUN_ID, projectId: PROJECT,
    task: task({ taskId: BUILD, taskType: 'build', requiredEvidenceTypes: ['TEST'], ordinal: 1, state: 'BLOCKED', dependencyIds: [PLAN] }),
  });
  await contracts.putTaskContract({
    projectId: PROJECT, occurredAt: at, contract: seededTaskContract({ runId: RUN_ID, taskId: BUILD, state: 'draft' }),
  });
  let version = created.version;
  for (const step of ['PLANNING', 'READY'] as const) {
    const moved = await runs.transition({
      commandId: `bootstrap:${RUN_ID}:${step}`, runId: RUN_ID, projectId: PROJECT, expectedVersion: version,
      to: step, reasonCode: 'BOOTSTRAP', safeSummary: `Mission bootstrap advanced the run to ${step}.`,
      evidenceIds: [], occurredAt: new Date().toISOString(),
    });
    version = moved.version;
  }

  /* ------------------------------------------------------- the run, provider-free */
  record.say('THE RUN — the plan is accepted, the build is REJECTED once, and the repair is re-reviewed');
  const store = createJuliusPostgresRuntimeStore(pool);
  const coderAdapter = scriptedAdapter(coder, [BUILD_OK, BUILD_OK, BUILD_OK]);
  const runtime = assembleLiveJuliusRuntime({
    store,
    entries: [
      { worker: architect, adapter: scriptedAdapter(architect, [PLAN_OK, PLAN_OK]) },
      { worker: coder, adapter: coderAdapter },
      // accept the plan, REJECT the build, then accept the repair.
      { worker: reviewer, adapter: scriptedAdapter(reviewer, [REVIEW_ACCEPT, REVIEW_REJECT, REVIEW_ACCEPT, REVIEW_ACCEPT]) },
    ],
    cardRevision: 'card:repair-drill', spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 2,
    owner: 'repair-loop-drill',
  });
  const outcome = await driveJuliusRunToTerminal({ loop: runtime.loop, store, runId: RUN_ID, projectId: PROJECT, maxTicks: 32 });

  /* ------------------------------------------------------------ what it produced */
  const rejection = await scalar(
    `SELECT action||'/'||reason_code FROM relay_wonderland.julius_verification_decisions
      WHERE task_id=$1 AND action='REPAIR' ORDER BY occurred_at LIMIT 1`, [BUILD]);
  record.step('the reviewer’s blocking finding became a REPAIR decision, not a failure',
    rejection === 'REPAIR/BLOCKING_FINDINGS', String(rejection));

  const repair = await scalar(
    `SELECT task_id||' '||task_type||' '||role||' '||state||' parent='||COALESCE(parent_task_id,'-')
       FROM relay_wonderland.julius_tasks WHERE parent_task_id=$1 AND task_type LIKE 'repair:%' ORDER BY ordinal LIMIT 1`, [BUILD]);
  record.step('a repair task exists, and it is the build’s own child', repair !== null, String(repair));
  record.step('it inherited its subject’s STAGE — `repair:build`, never `repair:repair:build`',
    repair !== null && repair.includes(' repair:build ') && !repair.includes('repair:repair'), String(repair));
  record.step('and its subject’s ROLE — the Coding Agent, which is what paid run 34037313976 got wrong',
    repair !== null && repair.includes(' CODING_AGENT '), String(repair));
  record.step('the repair reached SUCCEEDED', repair !== null && repair.includes(' SUCCEEDED '), String(repair));

  /**
   * ASKED SO IT CAN FAIL. Counting REPAIR_UNROUTABLE alone passes on an empty
   * result whatever the reason — including a predicate that never matched a
   * row. The run's whole event count comes back in the same query, so a
   * predicate that has stopped seeing this run reads as `0/0` and fails
   * instead of reading as innocence.
   */
  const unroutable = await scalar(
    `SELECT count(*) FILTER (WHERE payload->'facts'->>'reasonCode'='REPAIR_UNROUTABLE')::text
            ||'/'||count(*)::text
       FROM relay_wonderland.events WHERE payload->>'runId'=$1`, [RUN_ID]);
  const [refusals, seen] = (unroutable ?? '0/0').split('/');
  record.step('no repair was minted that nothing could route — REPAIR_UNROUTABLE never fired',
    refusals === '0' && Number(seen) > 0, `${refusals} refusal(s) among ${seen} event(s) for this run`);

  const rounds = await scalar(
    `SELECT count(*) FROM relay_wonderland.julius_tasks WHERE parent_task_id=$1 AND task_type LIKE 'repair:%'`, [BUILD]);
  record.step('exactly ONE repair round was created — the loop is bounded, not a loop',
    rounds === '1', `${rounds} round(s), ceiling 2`);

  const reReview = await scalar(
    `SELECT t.task_id||' '||t.state FROM relay_wonderland.julius_tasks t
      WHERE t.role='INDEPENDENT_REVIEWER' AND t.parent_task_id IN
        (SELECT task_id FROM relay_wonderland.julius_tasks WHERE parent_task_id=$1 AND task_type LIKE 'repair:%')
      ORDER BY t.ordinal LIMIT 1`, [BUILD]);
  record.step('the repaired work was REVIEWED AGAIN rather than merged on the coder’s word',
    reReview !== null && reReview.endsWith(' SUCCEEDED'), String(reReview));

  const accepted = await scalar(
    `SELECT count(*) FROM relay_wonderland.julius_verification_decisions
      WHERE action='ACCEPT' AND task_id IN
        (SELECT task_id FROM relay_wonderland.julius_tasks WHERE parent_task_id=$1 AND task_type LIKE 'repair:%')`, [BUILD]);
  record.step('and that re-review ACCEPTED it', accepted !== null && Number(accepted) > 0, `${accepted} accepting decision(s)`);

  record.step('the coder was dispatched twice: the rejected build and its one repair',
    coderAdapter.dispatches.length === 2, `${coderAdapter.dispatches.length} dispatch(es)`);
  record.step('and the mission reached COMPLETED through the repair, not around it',
    outcome.state === 'COMPLETED', `${outcome.state} after ${outcome.ticks} tick(s)${outcome.haltCause ? ` (${outcome.haltCause})` : ''}`);

  const audit = await auditProviders(scalar, [RUN_ID]);
  record.step('every dispatch went to the drill’s fake provider — and there WERE dispatches to check',
    audit.dispatches > 0 && audit.providers === 'drill', `${audit.dispatches} dispatch(es), providers: ${audit.providers}`);

  const verified = record.seal(DRILL_NAME);
  file(verified);
  return verified ? 0 : 8;
}

/* ------------------------------------------------------------------ entry */

export async function runRepairLoopDrill(input: {
  readonly argv: readonly string[];
  readonly repoRoot: string;
  readonly databaseUrl: string | undefined;
}): Promise<number> {
  if (input.databaseUrl === undefined || input.databaseUrl.trim() === '') {
    process.stderr.write('julius_repair_loop_drill_requires_database_url: set DATABASE_URL to a PostgreSQL this drill may destroy\n');
    return 2;
  }
  const outIndex = input.argv.indexOf('--out');
  const outDir = outIndex >= 0 && input.argv[outIndex + 1] !== undefined
    ? resolve(input.argv[outIndex + 1]!)
    : join(input.repoRoot, 'julius-capability-proofs');
  const pool = new Pool({ connectionString: input.databaseUrl });
  try {
    const code = await orchestrate(pool, outDir, input.repoRoot);
    process.stdout.write(readFileSync(join(outDir, TRANSCRIPT_FILE), 'utf8'));
    return code;
  } finally {
    await pool.end().catch(() => undefined);
  }
}
