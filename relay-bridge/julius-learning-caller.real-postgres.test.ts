import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  JULIUS_RUNTIME_VERSION,
  compareJuliusLearningPair,
  juliusLearningArmEventId,
  readJuliusLearningArmRecord,
  scriptedAdapter,
  type JuliusLearningDimension,
  type ScriptedOutcome,
} from '../src/relay/mission/julius';
import type { JuliusBootstrapRequest } from '../src/relay/integration/julius/julius-port';
import { JuliusContractPostgresRepository } from '../src/relay/persistence/julius-contract-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { createLiveJuliusBootstrapPort } from './julius/bootstrap';
import {
  CODER_WORKER, architectWorker, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal,
  recordJuliusLearningOutcome, reviewerWorker,
} from './julius/live-composition';
import { compileBootstrapRequest, parseLiveMissionContract } from './julius/mission-contract';
import { createPostgresMissionKnowledgeStore } from './julius/mission-knowledge';
import { createPostgresMissionSeedStore } from './julius/mission-seed';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * THE LEARNING LOOP'S RUNTIME CALLER, AGAINST A REAL POSTGRESQL (E9-a).
 *
 * `julius/learning-outcome.test.ts` proves the caller over the memory store. This says it against the
 * database itself, through the PRODUCTION compositions the live mission uses: each arm's contract goes
 * through the real parser and request compiler, `createLiveJuliusBootstrapPort` over the PostgreSQL
 * repositories bootstraps it through the explicit-rerun path, a run loop assembled over
 * `createJuliusPostgresRuntimeStore(pool)` drives it to its end, and `recordJuliusLearningOutcome`
 * measures it from the durable trajectory `trajectoryForRun` reads back. What it pins:
 *
 *   - TWO RUNS IN ONE STORE: the arms share one objective digest and get distinct run ids, so arm WITH
 *     is never served as arm WITHOUT's idempotent replay (MATCHED_PAIR_PREREG §6);
 *   - THE RECORD: one `julius.learning.arm.recorded` row per run in `relay_wonderland.events`, arm
 *     WITH's citing arm WITHOUT's, carrying the comparison and the decision;
 *   - THE COMPARISON is the real loop's, on both runs' rows as PostgreSQL returns them, with arm
 *     WITHOUT's pairing read off its own record;
 *   - NEVER A PROMOTION: on PROMOTE the record proposes; the trust core is not called by the caller and
 *     no claim standing is written by it;
 *   - ONE RECORD PER RUN: a retried job finds its record and writes nothing.
 *
 * Only the providers are scripted. Arm WITHOUT's coder fails its first test, so the real verification
 * repairs it; arm WITH's passes first time. That difference is the fixture's premise, and everything
 * between it and the recorded decision is production code.
 *
 * Gated on JULIUS_TEST_DATABASE_URL like every other real-postgres suite, and `todo` without it, so an
 * absent database is a skipped proof rather than a passing one. Every mission carries a random identity.
 */

/** Every call the trust core's promotion receives, counted while still performed. */
const promotions = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../src/relay/mission/julius/julius-memory-trust', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/relay/mission/julius/julius-memory-trust')>();
  return {
    ...actual,
    promoteJuliusMemoryClaim: (...args: Parameters<typeof actual.promoteJuliusMemoryClaim>) => {
      promotions.calls += 1;
      return actual.promoteJuliusMemoryClaim(...args);
    },
  };
});

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;
const CARD = 'card:learning-caller:1';
const nonce = () => randomBytes(4).toString('hex');

const PLAN = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }, { type: 'DIFF', status: 'PASSED', safeSummary: 'The change set.' }];
const BUILD_FAILED = [{ type: 'TEST', status: 'FAILED', safeSummary: 'Deploy ran before the migration.' }, BUILD[1]!];
const REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const POLICY = { dimensions: ['dispatches', 'repairs'] as JuliusLearningDimension[], minimumRelativeImprovement: 0.1, minimumImprovedDimensions: 1 };

type Recorded = { stream_id: string; event_id: string; payload: { causationId: string | null; facts: Record<string, string | number | boolean | null> } };

suite('the Learning Loop’s runtime caller over a real PostgreSQL (E9-a)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
  });
  afterAll(async () => pool?.end());

  it('TWO ARMS, ONE STORE: distinct runs, both measured off the durable trajectory, arm WITH compared and gated on the record, nothing promoted', async () => {
    const id = nonce();
    const projectId = `prj-learning-${id}`;
    const digest = createHash('sha256').update(`julius.learning-registration.v1 ${id}`).digest('hex');
    const base = {
      missionId: `mission:learning-${id}`, markerNamespace: `learning-${id}`, projectId, tenantId: `tenant-learning-${id}`,
      objective: 'Add the deploy step to the release script.', requirements: ['Run the migration first.'],
      constraints: ['Touch only scripts/.'],
      acceptanceCriteria: [{ id: 'AC-1', text: 'The release script deploys after migrating.', blocking: true }],
      testCommand: 'npm test', workspacePath: '/workspace/learning', limits: { spendUsd: 2, repairCycles: 1 },
    };
    const store = createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(pool)).store;
    const standings = async (): Promise<number> => Number((await pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM relay_wonderland.julius_claim_standings WHERE project_id=$1', [projectId])).rows[0]!.n);

    /** One arm, exactly as the live mission runs it, with only the providers scripted. */
    const arm = async (clause: Record<string, unknown>, coder: readonly ScriptedOutcome[]) => {
      const parsed = parseLiveMissionContract(JSON.stringify({ ...base, learningPair: clause }));
      if (!parsed.ok) throw new Error(parsed.problem);
      const entries = [
        { worker: architectWorker({}), adapter: scriptedAdapter(architectWorker({}), [{ kind: 'succeed', evidence: PLAN, usdMicros: null }]) },
        { worker: CODER_WORKER, adapter: scriptedAdapter(CODER_WORKER, coder) },
        { worker: reviewerWorker('hermes'), adapter: scriptedAdapter(reviewerWorker('hermes'), [{ kind: 'succeed', evidence: REVIEW, usdMicros: null }]) },
      ];
      const request = compileBootstrapRequest(parsed.contract, entries.map((entry) => ({
        role: entry.worker.role as JuliusBootstrapRequest['workers'][number]['role'],
        integrationId: entry.worker.workerId, adapterId: entry.worker.adapterId,
        independenceGroup: entry.worker.providerId, requiredCapabilities: entry.worker.capabilities,
      })), CARD);
      expect(request.rerunIntent, 'each arm takes its own identity').toBe('EXPLICIT');
      const runs = new JuliusPostgresRepository(pool);
      const contracts = new JuliusContractPostgresRepository(pool);
      const submitted = await createLiveJuliusBootstrapPort({
        runs: {
          loadRun: runs.loadRun.bind(runs), createRun: runs.createRun.bind(runs), addTask: runs.addTask.bind(runs),
          transition: runs.transition.bind(runs), putTaskContract: contracts.putTaskContract.bind(contracts),
        },
        seeds: createPostgresMissionSeedStore(pool),
        knowledge: createPostgresMissionKnowledgeStore(pool),
        tenantId: base.tenantId, executionId: `execution:julius-live:${base.missionId}`,
      }).submit(request);
      if (!submitted.accepted) throw new Error(`${submitted.reasonCode}: ${submitted.safeMessage}`);
      const runtime = assembleLiveJuliusRuntime({
        store, entries, cardRevision: CARD, spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1,
      });
      const outcome = await driveJuliusRunToTerminal({
        loop: runtime.loop, store, runId: submitted.runId, projectId, verification: runtime.verification,
      });
      // WHAT THE CALLER ITSELF TOUCHES: the trust core is not asked, and no standing is written.
      const promotionsBefore = promotions.calls;
      const standingsBefore = await standings();
      const learning = await recordJuliusLearningOutcome({
        store, runId: submitted.runId, projectId, registration: parsed.contract.learningPair!,
        objectiveDigest: request.missionBindingDigest, roles: entries.map((entry) => entry.worker.role),
      });
      expect(promotions.calls - promotionsBefore, 'the caller never promotes').toBe(0);
      expect(await standings(), 'the caller writes no claim standing').toBe(standingsBefore);
      return { request, runId: submitted.runId, outcome, learning, roles: entries.map((entry) => entry.worker.role) };
    };

    const without = await arm({ registrationDigest: digest, arm: 'WITHOUT', rerunKey: `without-${id}`, policy: POLICY }, [
      { kind: 'succeed', evidence: BUILD_FAILED, usdMicros: 1_000 },
      { kind: 'succeed', evidence: BUILD, usdMicros: 1_000 },
    ]);
    const withLearning = await arm(
      { registrationDigest: digest, arm: 'WITH', rerunKey: `with-${id}`, withoutRunId: without.runId, policy: POLICY },
      [{ kind: 'succeed', evidence: BUILD, usdMicros: 1_000 }],
    );

    // TWO RUNS, ONE OBJECTIVE, ONE STORE.
    expect(without.outcome.state, `arm WITHOUT: ${String(without.outcome.haltCause)}`).toBe('COMPLETED');
    expect(withLearning.outcome.state, `arm WITH: ${String(withLearning.outcome.haltCause)}`).toBe('COMPLETED');
    expect(withLearning.runId, 'arm WITH is not arm WITHOUT’s replay').not.toBe(without.runId);
    expect(withLearning.request.missionBindingDigest).toBe(without.request.missionBindingDigest);
    expect(without.learning.record).toBe('RECORDED');
    expect(withLearning.learning.record).toBe('RECORDED');
    expect(without.learning.metrics?.repairs, 'arm WITHOUT was repaired by the real verification').toBe(1);
    expect(withLearning.learning.metrics?.repairs).toBe(0);

    // THE READ IS THE TABLE: every row of the run, and nothing across a project.
    const pg = createJuliusPostgresRuntimeStore(pool);
    for (const runId of [without.runId, withLearning.runId]) {
      const count = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM relay_wonderland.julius_trajectory_events WHERE run_id=$1', [runId]);
      expect((await pg.trajectoryForRun(runId, projectId)).length, runId).toBe(Number(count.rows[0]!.n));
      expect(await pg.trajectoryForRun(runId, `${projectId}-elsewhere`)).toEqual([]);
    }

    // THE RECORD, ONE ROW PER ARM, ARM WITH CITING ARM WITHOUT.
    const recorded = await pool.query<Recorded>(
      `SELECT stream_id,event_id,payload FROM relay_wonderland.events
        WHERE event_type='julius.learning.arm.recorded' AND stream_id = ANY($1) ORDER BY stream_id`,
      [[without.runId, withLearning.runId]],
    );
    expect(recorded.rows).toHaveLength(2);
    const rowOf = (runId: string): Recorded => recorded.rows.find((row) => row.stream_id === runId)!;
    expect(rowOf(without.runId).event_id).toBe(juliusLearningArmEventId(without.runId));
    expect(rowOf(without.runId).payload.facts).toMatchObject({ arm: 'WITHOUT', registrationDigest: digest, runState: 'COMPLETED', repairs: 1 });
    expect(rowOf(withLearning.runId).payload.causationId).toBe(rowOf(without.runId).event_id);
    expect(rowOf(withLearning.runId).payload.facts).toMatchObject({
      arm: 'WITH', registrationDigest: digest, withoutRunId: without.runId, comparison: 'COMPARED',
      decision: 'PROMOTE', improved: 'dispatches,repairs', proposal: 'PROMOTION_PROPOSED',
    });

    // THE COMPARISON IS THE REAL LOOP'S, on both runs' rows as PostgreSQL returns them, with arm WITHOUT's
    // pairing read off its own record.
    const withoutRecord = readJuliusLearningArmRecord(rowOf(without.runId).payload.facts);
    if (!withoutRecord.ok) throw new Error(withoutRecord.reasonCode);
    const direct = compareJuliusLearningPair({
      without: { events: await pg.trajectoryForRun(without.runId, projectId), pairing: withoutRecord.record.pairing },
      with: {
        events: await pg.trajectoryForRun(withLearning.runId, projectId),
        pairing: { objectiveDigest: withLearning.request.missionBindingDigest, roles: [...withLearning.roles].sort(), runtimeVersion: JULIUS_RUNTIME_VERSION },
      },
      dimensions: POLICY.dimensions,
    });
    expect(direct.outcome).toBe('COMPARED');
    expect(withLearning.learning.pair?.comparison).toEqual(direct);
    expect(withLearning.learning.pair?.decision).toMatchObject({ outcome: 'PROMOTE', improved: ['dispatches', 'repairs'] });

    // ONE RECORD PER RUN: the retried job finds it standing and writes nothing.
    const retried = await recordJuliusLearningOutcome({
      store, runId: withLearning.runId, projectId, registration: { registrationDigest: digest, arm: 'WITH', withoutRunId: without.runId, policy: POLICY },
      objectiveDigest: withLearning.request.missionBindingDigest, roles: withLearning.roles,
    });
    expect(retried.record).toBe('DUPLICATE');
    const after = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM relay_wonderland.events WHERE event_type='julius.learning.arm.recorded' AND stream_id = ANY($1)`,
      [[without.runId, withLearning.runId]],
    );
    expect(Number(after.rows[0]!.n)).toBe(2);
  });
});
