import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  JULIUS_LEARNING_ARM_EVENT_TYPE,
  JULIUS_LEARNING_DIMENSIONS,
  JULIUS_RUNTIME_VERSION,
  validateJuliusEvent,
  compareJuliusLearningPair,
  createJuliusMemoryStore,
  decideJuliusLearningPromotion,
  juliusLearningArmEventId,
  promoteJuliusMemoryClaim,
  scriptedAdapter,
  type JuliusBrainEntry,
  type JuliusLearningDimension,
  type JuliusLearningPolicy,
  type JuliusLearningRegistration,
  type JuliusMemoryStore,
  type JuliusMissionState,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
  type JuliusTrajectoryEvent,
  type JuliusTrajectoryKind,
} from '../../src/relay/mission/julius';
import type { JuliusBootstrapRequest } from '../../src/relay/integration/julius/julius-port';
import { createLiveJuliusBootstrapPort, type RunCreationStore } from './bootstrap';
import {
  CODER_WORKER, architectWorker, assembleLiveJuliusRuntime, createContextAndClaimHandoffs, driveJuliusRunToTerminal,
  recordJuliusLearningOutcome, reviewerWorker,
} from './live-composition';
import { liveLearningLines } from './live-report-lines';
import { compileBootstrapRequest, parseLiveMissionContract } from './mission-contract';
import type { MissionSeedStore } from './mission-seed';
import { createJuliusPostgresRuntimeStore } from './postgres-store';

/**
 * THE LEARNING LOOP'S RUNTIME CALLER (E9-a), PROVEN WITHOUT A DATABASE.
 *
 * `recordJuliusLearningOutcome` is the first production caller the Learning Loop has had. These
 * cases hold it to the pre-registration (MATCHED_PAIR_PREREG.md, E9-a):
 *
 *   A  the trajectory read it measures from is bound in the live store and served in order;
 *   B  arm WITHOUT records its measurement, and nothing that looks like a verdict;
 *   C  arm WITH reads arm WITHOUT's RECORD and TRAJECTORY from the same store, calls the REAL loop
 *      with arm WITHOUT's own pairing, records the comparison and the decision as ONE event, and on
 *      PROMOTE records a proposal while `promoteJuliusMemoryClaim` is never called;
 *   D  every refusal is recorded by name, and what would make a record false is thrown;
 *   E  the live entrypoint calls it after the drive, before the RESULT, only under the clause;
 *   F  two arms of one contract, bootstrapped through the explicit-rerun path, driven by the real
 *      run loop and recorded in one store.
 *
 * The same composition against real PostgreSQL is `relay-bridge/julius-learning-caller.real-postgres.test.ts`.
 */

/** Every call the trust core's promotion receives, counted while still performed. Promotion is never the caller's. */
const promotions = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../src/relay/mission/julius/julius-memory-trust', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/relay/mission/julius/julius-memory-trust')>();
  return {
    ...actual,
    promoteJuliusMemoryClaim: (...args: Parameters<typeof actual.promoteJuliusMemoryClaim>) => {
      promotions.calls += 1;
      return actual.promoteJuliusMemoryClaim(...args);
    },
  };
});

const ROOT = process.cwd();
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const PROJECT = 'prj-learning';
const RUN_WITHOUT = `run:${'0a'.repeat(12)}`;
const RUN_WITH = `run:${'0b'.repeat(12)}`;
const DIGEST = createHash('sha256').update('julius.learning-registration.v1 fixture').digest('hex');
const OBJECTIVE = `sha256:${createHash('sha256').update('the one objective both arms run').digest('hex')}`;
const ROLES = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'];
const POLICY: JuliusLearningPolicy = { dimensions: ['dispatches', 'repairs'], minimumRelativeImprovement: 0.1, minimumImprovedDimensions: 1 };

const registration = (arm: 'WITHOUT' | 'WITH', over: Partial<JuliusLearningRegistration> = {}): JuliusLearningRegistration => ({
  registrationDigest: DIGEST, arm, policy: POLICY, ...(arm === 'WITH' ? { withoutRunId: RUN_WITHOUT } : {}), ...over,
});

let rows = 0;
/** One trajectory row as the runtime appends it: a provider dispatch names its provider and its time. */
const row = (runId: string, kind: JuliusTrajectoryKind): JuliusTrajectoryEvent => {
  rows += 1;
  return {
    trajectoryEventId: `trajectory:${runId}:${String(rows)}`, runId, projectId: PROJECT, kind, taskId: null, workerId: null,
    providerId: kind === 'DISPATCH' ? 'anthropic' : null, contextId: null, runtimeVersion: JULIUS_RUNTIME_VERSION,
    policyVersion: 'policy:1', cardRevision: 'card:1', missionContractRevision: 1, projectBrainRevision: 0,
    durationMs: kind === 'DISPATCH' ? 1_000 : null, usdMicros: null, inputTokens: null, outputTokens: null,
    outcome: kind === 'COMPLETION' ? 'VERIFIED' : null, safeFacts: {}, idempotencyKey: `${kind}:${String(rows)}`,
    occurredAt: new Date(Date.UTC(2026, 9, 3, 12) + rows * 1_000).toISOString(),
  };
};

/** A finished mission: `dispatches` provider attempts, `repairs` repair rounds, one verified completion. */
async function mission(
  store: JuliusMemoryStore, runId: string,
  shape: { readonly dispatches: number; readonly repairs: number; readonly state?: JuliusMissionState },
): Promise<void> {
  store.seedRun({
    runId, missionId: 'mission:learning', projectId: PROJECT, state: shape.state ?? 'COMPLETED',
    cardRevision: 'card:1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  for (let index = 0; index < shape.dispatches; index += 1) await store.appendTrajectory(row(runId, 'DISPATCH'));
  for (let index = 0; index < shape.repairs; index += 1) await store.appendTrajectory(row(runId, 'REPAIR'));
  await store.appendTrajectory(row(runId, 'COMPLETION'));
}

const record = (
  store: JuliusMemoryStore, runId: string, arm: JuliusLearningRegistration,
  over: { readonly objectiveDigest?: string; readonly roles?: readonly string[]; readonly projectId?: string } = {},
) => recordJuliusLearningOutcome({
  store, runId, projectId: over.projectId ?? PROJECT, registration: arm,
  objectiveDigest: over.objectiveDigest ?? OBJECTIVE, roles: over.roles ?? ROLES, now: () => '2026-10-03T13:00:00.000Z',
});

const learningEvents = (store: JuliusMemoryStore, runId?: string) =>
  store.events().filter((event) => event.type === JULIUS_LEARNING_ARM_EVENT_TYPE && (runId === undefined || event.runId === runId));

/** Arm WITHOUT recorded, arm WITH's run finished: the state every arm-WITH case starts from. */
async function pairReady(withShape: { readonly dispatches: number; readonly repairs: number } = { dispatches: 4, repairs: 0 }) {
  const store = createJuliusMemoryStore();
  await mission(store, RUN_WITHOUT, { dispatches: 5, repairs: 1 });
  await mission(store, RUN_WITH, withShape);
  return store;
}

/* ------------------------------------------------------------------ A */

describe('A — the trajectory read the caller measures from', () => {
  /** A pool that answers one row per query, as the driver returns it. */
  const pool = (answer: Record<string, unknown>[]) => {
    const seen: string[] = [];
    return { seen, pool: { query: async (sql: string) => { seen.push(sql); return { rows: answer, rowCount: answer.length }; } } as never };
  };

  it('1. the live store binds it to the real repository, in its RETURN TYPE, and the handoff wrapper keeps it', async () => {
    const { pool: stub, seen } = pool([]);
    const store = createJuliusPostgresRuntimeStore(stub);
    expect(await store.trajectoryForRun(RUN_WITH, PROJECT)).toEqual([]);
    expect(seen[0], 'the repository read, scoped by run and project').toContain('FROM relay_wonderland.julius_trajectory_events WHERE run_id=$1 AND project_id=$2');
    const source = read('relay-bridge/julius/postgres-store.ts');
    const signature = source.slice(source.indexOf('export function createJuliusPostgresRuntimeStore'));
    expect(signature.slice(0, signature.indexOf('{')), 'a declared capability fails at the type when it is dropped').toContain('JuliusTrajectoryReader');
    expect(source).toContain('trajectoryForRun: (runId, projectId) => trajectories.forRun(runId, projectId)');
    expect(typeof createContextAndClaimHandoffs(createJuliusPostgresRuntimeStore(stub)).store.trajectoryForRun).toBe('function');
  });

  it('2. the memory store serves one run, in the ledger order, and nothing across a project', async () => {
    const store = createJuliusMemoryStore();
    await mission(store, RUN_WITHOUT, { dispatches: 2, repairs: 0 });
    await mission(store, RUN_WITH, { dispatches: 1, repairs: 0 });
    // Appended out of order: the read sorts by the instant, then the row's id, as the SQL does.
    const early = { ...row(RUN_WITH, 'RETRY'), occurredAt: '2026-10-03T11:00:00.000Z' };
    await store.appendTrajectory(early);
    const read = await store.trajectoryForRun(RUN_WITH, PROJECT);
    expect(read.map((event) => event.kind)).toEqual(['RETRY', 'DISPATCH', 'COMPLETION']);
    expect(read[0]).toEqual(early);
    expect(read.every((event) => event.runId === RUN_WITH)).toBe(true);
    expect(await store.trajectoryForRun(RUN_WITH, 'prj-other')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ B */

describe('B — arm WITHOUT records its measurement and nothing else', () => {
  it('3. one event, named by its run, carrying the registration, the pairing, the policy and the metrics', async () => {
    const store = await pairReady();
    const outcome = await record(store, RUN_WITHOUT, registration('WITHOUT'));
    expect(outcome.record).toBe('RECORDED');
    expect(outcome.pair).toBeNull();
    const events = learningEvents(store);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event!.eventId).toBe(juliusLearningArmEventId(RUN_WITHOUT));
    expect(event!.runId).toBe(RUN_WITHOUT);
    expect(event!.correlationId).toBe(`learning-pair:${DIGEST}`);
    expect(event!.causationId).toBeNull();
    expect(event!.facts).toMatchObject({
      recordVersion: 'julius-learning-record.v1', loopVersion: 'julius-learning-loop.v1', registrationDigest: DIGEST,
      arm: 'WITHOUT', runState: 'COMPLETED', objectiveDigest: OBJECTIVE,
      roles: 'CODING_AGENT,INDEPENDENT_REVIEWER,PROMPT_ARCHITECT', runtimeVersion: JULIUS_RUNTIME_VERSION,
      policyDimensions: 'dispatches,repairs', policyMinimumRelativeImprovement: 0.1, policyMinimumImprovedDimensions: 1,
      trajectoryRows: 7, runs: 1, dispatches: 5, repairs: 1, verifiedCompletions: 1, averageDurationMs: 1_000,
    });
    for (const verdict of ['comparison', 'deltas', 'decision', 'proposal', 'withoutRunId']) {
      expect(Object.keys(event!.facts), `a WITHOUT record carries no ${verdict}`).not.toContain(verdict);
    }
    expect(outcome.lines).toEqual([
      `LEARNING: arm=WITHOUT run=${RUN_WITHOUT} registration=${DIGEST} state=COMPLETED record=RECORDED`,
      `LEARNING: metrics run=${RUN_WITHOUT} trajectory_rows=7 dispatches=5 retries=0 repairs=1 recoveries=0 fallbacks=0 findings=0 verified_completions=1 known_usd_micros=0 cost_complete=no average_duration_ms=1000 known_input_tokens=unknown known_output_tokens=unknown unknown_usage_components=5`,
    ]);
  });
});

/* ------------------------------------------------------------------ C */

describe('C — arm WITH compares, gates and records, and never promotes', () => {
  it('3a. THE INSTRUMENT CAN FAIL: a promotion reached through the barrel the caller imports from is counted', () => {
    // Without this, "zero promotions" below could be a counter that sees nothing.
    const before = promotions.calls;
    promoteJuliusMemoryClaim({ claimId: 'claim-1', assertedBy: 'coder', trust: 'UNVERIFIED' } as never, { to: 'VERIFIED', by: 'reviewer', evidence: [], at: 'not-a-time' });
    expect(promotions.calls - before).toBe(1);
  });

  it('4. reads arm WITHOUT from the same store, runs the REAL loop on its recorded pairing, records a PROPOSAL', async () => {
    const store = await pairReady();
    await record(store, RUN_WITHOUT, registration('WITHOUT'));
    const before = promotions.calls;
    const outcome = await record(store, RUN_WITH, registration('WITH'));

    // THE REAL LOOP, on both trajectories as the store holds them.
    const pairing = { objectiveDigest: OBJECTIVE, roles: [...ROLES].sort(), runtimeVersion: JULIUS_RUNTIME_VERSION };
    const direct = compareJuliusLearningPair({
      without: { events: await store.trajectoryForRun(RUN_WITHOUT, PROJECT), pairing },
      with: { events: await store.trajectoryForRun(RUN_WITH, PROJECT), pairing },
      dimensions: POLICY.dimensions,
    });
    expect(direct.outcome).toBe('COMPARED');
    expect(outcome.pair?.comparison).toEqual(direct);
    expect(outcome.pair?.decision).toEqual(decideJuliusLearningPromotion(direct, POLICY));
    expect(outcome.pair?.decision).toEqual({ outcome: 'PROMOTE', improved: ['dispatches', 'repairs'], marginalValue: 0.2 });

    const events = learningEvents(store, RUN_WITH);
    expect(events).toHaveLength(1);
    expect(events[0]!.causationId, 'the WITH record cites the WITHOUT record it was compared with').toBe(juliusLearningArmEventId(RUN_WITHOUT));
    expect(events[0]!.facts).toMatchObject({
      arm: 'WITH', withoutRunId: RUN_WITHOUT, withoutRunState: 'COMPLETED', withoutTrajectoryRows: 7, trajectoryRows: 5,
      dispatches: 4, repairs: 0, comparison: 'COMPARED', comparisonReason: null,
      deltas: 'dispatches:IMPROVED:5:4:total,repairs:IMPROVED:1:0:total',
      decision: 'PROMOTE', decisionReason: null, improved: 'dispatches,repairs', regressed: '', marginalValue: 0.2,
      proposal: 'PROMOTION_PROPOSED',
    });
    // A PROPOSAL, NEVER A PROMOTION: the trust core was not asked, and no standing moved.
    expect(promotions.calls - before).toBe(0);
    expect(await store.claimsForRun(RUN_WITH, PROJECT)).toEqual([]);

    expect(outcome.lines).toEqual(liveLearningLines(outcome));
    expect(outcome.lines).toContain(`LEARNING: comparison=COMPARED without=${RUN_WITHOUT} without_state=COMPLETED without_trajectory_rows=7`);
    expect(outcome.lines).toContain('LEARNING: delta dimension=dispatches verdict=IMPROVED without=5 with=4 bounded=no');
    expect(outcome.lines.at(-1)).toBe('LEARNING: decision=PROMOTE improved=dispatches,repairs regressed=none marginal_value=0.2 proposal=PROMOTION_PROPOSED');
  });

  it('4a. a policy declaring EVERY dimension still makes a record the PostgreSQL ledger accepts', async () => {
    // `validateJuliusEvent` refuses `token:`/`token=` and anything over 8 KiB: the token dimensions'
    // names and ten delta tokens must pass it, or the paid run's record would be refused at the database.
    const everything: JuliusLearningPolicy = { dimensions: [...JULIUS_LEARNING_DIMENSIONS], minimumRelativeImprovement: 0.1, minimumImprovedDimensions: 1 };
    const store = await pairReady();
    await record(store, RUN_WITHOUT, registration('WITHOUT', { policy: everything }));
    const outcome = await record(store, RUN_WITH, registration('WITH', { policy: everything }));
    const [event] = learningEvents(store, RUN_WITH);
    expect(() => validateJuliusEvent(event!)).not.toThrow();
    expect(String(event!.facts.deltas).split(',')).toHaveLength(JULIUS_LEARNING_DIMENSIONS.length);
    expect(JSON.stringify(event!.facts).length).toBeLessThan(8192);
    expect(outcome.lines.filter((line) => line.startsWith('LEARNING: delta '))).toHaveLength(JULIUS_LEARNING_DIMENSIONS.length);
  });

  it('5. nothing on the record or in the caller can reach the trust core', () => {
    const record = read('src/relay/mission/julius/julius-learning-record.ts');
    for (const module of ['julius-memory-trust', 'julius-claim-ledger']) {
      expect(record, `the record module imports ${module}`).not.toMatch(new RegExp(`from '\\./${module}'`, 'u'));
    }
    const composition = read('relay-bridge/julius/live-composition.ts');
    const caller = composition.slice(composition.indexOf('export async function recordJuliusLearningOutcome'));
    expect(caller.length).toBeGreaterThan(1_000);
    for (const writer of ['promoteJuliusMemoryClaim(', 'recordClaimStanding(', 'appendBrainEntry(']) {
      expect(caller.includes(writer), `the caller calls ${writer}`).toBe(false);
    }
  });

  it('6. ONE record per run: a retried job reports DUPLICATE, and a record that would say something else is refused', async () => {
    const store = await pairReady();
    await record(store, RUN_WITHOUT, registration('WITHOUT'));
    const first = await record(store, RUN_WITH, registration('WITH'));
    const again = await record(store, RUN_WITH, registration('WITH'));
    expect(again.record).toBe('DUPLICATE');
    expect(again.lines[0]).toContain('record=DUPLICATE');
    expect(learningEvents(store, RUN_WITH)).toHaveLength(1);
    expect((await record(store, RUN_WITHOUT, registration('WITHOUT'))).record).toBe('DUPLICATE');

    // The WITHOUT run's trajectory grew after the comparison: the same id would now say something else.
    await store.appendTrajectory(row(RUN_WITHOUT, 'RETRY'));
    await expect(record(store, RUN_WITH, registration('WITH'))).rejects.toThrow('julius_event_id_conflict');
    expect(learningEvents(store, RUN_WITH)).toHaveLength(1);
    expect(learningEvents(store, RUN_WITH)[0]!.facts, 'the first record stands').toEqual(first.event!.facts);
  });
});

/* ------------------------------------------------------------------ D */

describe('D — a pair that cannot be scored is refused ON the record; a record that would be false is thrown', () => {
  /** Arm WITH recorded against an arm WITHOUT prepared by `prepare`; the refusal is read off the durable record. */
  async function refusal(prepare: (store: JuliusMemoryStore) => Promise<unknown>, withShape?: { dispatches: number; repairs: number }) {
    const store = await pairReady(withShape);
    await prepare(store);
    const outcome = await record(store, RUN_WITH, registration('WITH'));
    const [event] = learningEvents(store, RUN_WITH);
    expect(event, 'the refusal is on the record').toBeDefined();
    expect(event!.facts.decision).toBe('REFUSE');
    expect(event!.facts.proposal).toBe('NONE');
    expect(outcome.lines.at(-1)).toContain('LEARNING: decision=REFUSE reason=');
    return { outcome, facts: event!.facts };
  }

  it('7. arm WITHOUT left no record', async () => {
    const { facts } = await refusal(async () => undefined);
    expect(facts).toMatchObject({
      comparison: 'UNCOMPARABLE', comparisonReason: 'learning_pair_without_unrecorded', decisionReason: 'learning_pair_without_unrecorded',
      withoutRunState: null, withoutTrajectoryRows: null, deltas: null,
    });
  });

  it('8. arm WITHOUT was registered under another digest, or declared another policy', async () => {
    const other = createHash('sha256').update('another registration').digest('hex');
    const digest = await refusal((store) => record(store, RUN_WITHOUT, registration('WITHOUT', { registrationDigest: other })));
    expect(digest.facts.comparisonReason).toBe('learning_pair_registration_differs');
    const policy = await refusal((store) => record(store, RUN_WITHOUT, registration('WITHOUT', { policy: { ...POLICY, minimumRelativeImprovement: 0.2 } })));
    expect(policy.facts.comparisonReason).toBe('learning_pair_policy_differs');
  });

  it('9. the run named as arm WITHOUT recorded itself as an arm WITH', async () => {
    const { facts } = await refusal((store) => record(store, RUN_WITHOUT, registration('WITH', { withoutRunId: `run:${'0c'.repeat(12)}` })));
    expect(facts.comparisonReason).toBe('learning_pair_without_arm_mismatch');
  });

  it('10. THE CONTROL CAN FAIL: arm WITHOUT ran another objective or other roles, read off its OWN record', async () => {
    // Were arm WITHOUT's pairing recomputed from arm WITH's contract, both of these would compare as matched.
    const objective = await refusal((store) => record(store, RUN_WITHOUT, registration('WITHOUT'), { objectiveDigest: `sha256:${'9'.repeat(64)}` }));
    expect(objective.facts.comparisonReason).toBe('learning_pair_objective_differs');
    const roles = await refusal((store) => record(store, RUN_WITHOUT, registration('WITHOUT'), { roles: ['PROMPT_ARCHITECT', 'CODING_AGENT'] }));
    expect(roles.facts.comparisonReason).toBe('learning_pair_roles_differ');
  });

  it('11. a regression refuses whatever else improved', async () => {
    const { facts } = await refusal((store) => record(store, RUN_WITHOUT, registration('WITHOUT')), { dispatches: 6, repairs: 0 });
    expect(facts).toMatchObject({
      comparison: 'COMPARED', decisionReason: 'learning_regressed', regressed: 'dispatches', improved: '', marginalValue: null,
      deltas: 'dispatches:REGRESSED:5:6:total,repairs:IMPROVED:1:0:total',
    });
  });

  it('12. arm WITH resolving to its own WITHOUT run, or a run outside the project, is thrown and writes nothing', async () => {
    const store = await pairReady();
    await expect(record(store, RUN_WITH, registration('WITH', { withoutRunId: RUN_WITH }))).rejects.toThrow('learning_pair_same_run');
    await expect(record(store, RUN_WITH, registration('WITH'), { projectId: 'prj-other' })).rejects.toThrow('learning_run_not_found');
    expect(learningEvents(store)).toEqual([]);
  });

  it('13. a run that has not finished has no outcome: nothing is written, and the line says so', async () => {
    const store = createJuliusMemoryStore();
    await mission(store, RUN_WITH, { dispatches: 1, repairs: 0, state: 'VERIFYING' });
    const outcome = await record(store, RUN_WITH, registration('WITH'));
    expect(outcome.record).toBe('NOT_TERMINAL');
    expect(learningEvents(store)).toEqual([]);
    expect(outcome.lines).toEqual([`LEARNING: arm=WITH run=${RUN_WITH} registration=${DIGEST} state=VERIFYING record=NOT_TERMINAL`]);
  });
});

/* ------------------------------------------------------------------ E */

describe('E — the live entrypoint is the caller', () => {
  it('14. calls it after the drive and before the RESULT, only under the clause, and fails the job when it cannot record', () => {
    const entry = read('relay-bridge/julius-live-mission.ts');
    const flat = entry.replace(/\s+/gu, ' ');
    const drive = entry.indexOf('const outcome = await driveJuliusRunToTerminal(');
    const call = entry.indexOf('await recordJuliusLearningOutcome(');
    const result = entry.indexOf('out(`RESULT: ${outcome.state}');
    expect(drive).toBeGreaterThan(0);
    expect(call, 'after the run reached its end').toBeGreaterThan(drive);
    expect(result, 'and before the RESULT, so `run:` stays directly under it').toBeGreaterThan(call);
    expect(entry.split('recordJuliusLearningOutcome(').length - 1, 'one call site').toBe(1);
    expect(entry.lastIndexOf('if (contract.learningPair !== undefined) {', call), 'only for a registered arm').toBeGreaterThan(drive);
    expect(flat).toContain('registration: contract.learningPair, objectiveDigest: request.missionBindingDigest, roles: resolution.entries.map((entry) => entry.worker.role),');
    expect(flat).toContain("return outcome.state === 'COMPLETED' && !learningUnrecorded ? 0 : 1;");
  });
});

/* ------------------------------------------------------------------ F */

const ALL_ROLES: JuliusBrainEntry['allowedRoles'] = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'];

/** The bootstrap's run writer over the memory store: the same five calls the PostgreSQL repositories answer. */
const runsOn = (memory: JuliusMemoryStore): RunCreationStore => ({
  loadRun: (runId, projectId) => memory.loadRun(runId, projectId),
  async createRun(input) {
    const existing = await memory.loadRun(input.runId, input.projectId);
    if (existing !== null) return existing;
    memory.seedRun({
      runId: input.runId, missionId: input.missionId, projectId: input.projectId, state: 'CREATED',
      cardRevision: input.cardRevision, missionContractRevision: input.missionContractRevision,
      projectBrainRevision: input.projectBrainRevision, version: 1,
    });
    return { runId: input.runId, state: 'CREATED', version: 1 };
  },
  addTask: (input) => memory.addTask(input),
  transition: (input) => memory.transition(input),
  putTaskContract: (input) => memory.putTaskContract(input),
});
const seedsOn = (memory: JuliusMemoryStore): MissionSeedStore => ({
  ensureBase: async () => undefined,
  insertCriteria: async (runId, criteria) => {
    memory.seedCriteria(runId, criteria.map((criterion) => ({
      criterionId: criterion.criterionId, description: criterion.description, requiredEvidenceTypes: [],
    })));
  },
  insertBrainEntries: async (runId, _projectId, entries) => {
    memory.seedBrain(runId, entries.map((entry) => ({
      entryId: entry.entryId, kind: entry.kind === 'ACCEPTANCE_UPDATE' ? 'REQUIREMENT' : entry.kind, text: entry.text,
      taskIds: [], allowedRoles: ALL_ROLES, sensitivity: 'INTERNAL',
    })));
  },
});

const PLAN = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }, { type: 'DIFF', status: 'PASSED', safeSummary: 'The change set.' }];
const REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];

/**
 * THE WHOLE CHAIN, WITH ONLY THE PROVIDERS SCRIPTED. Each arm's contract goes through the real parser, the
 * real request compiler (explicit rerun, its own key) and the real bootstrap; the live composition drives
 * it to its end; the recorder measures it. Arm WITHOUT's coder fails its first test, so the real
 * verification repairs it; arm WITH's passes first time. That difference is the fixture's premise, as in
 * `julius-learning-loop.e2e.test.ts`: everything between it and the recorded decision is production code.
 */
describe('F — two arms of one contract, through the real bootstrap and the real run loop, in one store', () => {
  it('15. distinct runs, one objective, both measured, arm WITH compared and gated on the record', async () => {
    const memory = createJuliusMemoryStore();
    const base = {
      missionId: 'mission:learning-pair', markerNamespace: 'learning-pair', projectId: PROJECT, tenantId: 'tenant-learning',
      objective: 'Add the deploy step to the release script.', requirements: ['Run the migration first.'],
      constraints: ['Touch only scripts/.'],
      acceptanceCriteria: [{ id: 'AC-1', text: 'The release script deploys after migrating.', blocking: true }],
      testCommand: 'npm test', workspacePath: '/workspace/learning', limits: { spendUsd: 2, repairCycles: 1 },
    };
    const policy = { dimensions: ['dispatches', 'repairs'] as JuliusLearningDimension[], minimumRelativeImprovement: 0.1, minimumImprovedDimensions: 1 };

    const arm = async (clause: Record<string, unknown>, coder: Parameters<typeof scriptedAdapter>[1] = [{ kind: 'succeed', evidence: BUILD, usdMicros: 1_000 }]) => {
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
      })), 'card:learning:1');
      expect(request.rerunIntent).toBe('EXPLICIT');
      const submitted = await createLiveJuliusBootstrapPort({
        runs: runsOn(memory), seeds: seedsOn(memory), tenantId: base.tenantId, executionId: 'execution:learning',
      }).submit(request);
      if (!submitted.accepted) throw new Error(`${submitted.reasonCode}: ${submitted.safeMessage}`);
      const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
      const runtime = assembleLiveJuliusRuntime({
        store: handoffs.store, entries, cardRevision: 'card:learning:1', spendCeilingUsdMicros: 20_000_000, maxRepairRounds: 1,
      });
      const outcome = await driveJuliusRunToTerminal({
        loop: runtime.loop, store: handoffs.store, runId: submitted.runId, projectId: PROJECT, verification: runtime.verification,
      });
      const before = promotions.calls;
      const learning = await recordJuliusLearningOutcome({
        store: memory, runId: submitted.runId, projectId: PROJECT, registration: parsed.contract.learningPair!,
        objectiveDigest: request.missionBindingDigest, roles: entries.map((entry) => entry.worker.role),
      });
      return { request, runId: submitted.runId, outcome, learning, promotedByTheCaller: promotions.calls - before };
    };

    const without = await arm({ registrationDigest: DIGEST, arm: 'WITHOUT', rerunKey: 'pair-1-without', policy }, [
      { kind: 'succeed', evidence: [{ type: 'TEST', status: 'FAILED', safeSummary: 'Deploy ran before the migration.' }, BUILD[1]!], usdMicros: 1_000 },
      { kind: 'succeed', evidence: BUILD, usdMicros: 1_000 },
    ]);
    const withLearning = await arm({ registrationDigest: DIGEST, arm: 'WITH', rerunKey: 'pair-1-with', withoutRunId: without.runId, policy });

    expect(without.outcome.state, `arm WITHOUT: ${String(without.outcome.haltCause)}`).toBe('COMPLETED');
    expect(withLearning.outcome.state, `arm WITH: ${String(withLearning.outcome.haltCause)}`).toBe('COMPLETED');
    expect(withLearning.runId, 'two runs in one store, not a replay').not.toBe(without.runId);
    expect(withLearning.request.missionBindingDigest, 'one objective').toBe(without.request.missionBindingDigest);
    expect(without.learning.record).toBe('RECORDED');
    expect(withLearning.learning.record).toBe('RECORDED');
    expect(without.learning.metrics?.dispatches, 'arm WITHOUT was measured off a real trajectory').toBeGreaterThan(0);

    // ARM WITHOUT'S FIRST BUILD FAILED ITS TEST, so the real verification repaired it: a repair round and
    // more dispatches, measured off the trajectory the run loop itself wrote.
    expect(without.learning.metrics?.repairs).toBe(1);
    expect(withLearning.learning.metrics?.repairs).toBe(0);
    const comparison = withLearning.learning.pair?.comparison;
    expect(comparison?.outcome, JSON.stringify(comparison)).toBe('COMPARED');
    expect(withLearning.learning.pair?.decision).toMatchObject({ outcome: 'PROMOTE', improved: ['dispatches', 'repairs'] });
    const [event] = learningEvents(memory, withLearning.runId);
    expect(event?.causationId).toBe(juliusLearningArmEventId(without.runId));
    expect(event?.facts).toMatchObject({ comparison: 'COMPARED', decision: 'PROMOTE', proposal: 'PROMOTION_PROPOSED', withoutRunId: without.runId });
    // THE PROMOTE IS A PROPOSAL: the recorder asked the trust core nothing.
    expect(without.promotedByTheCaller + withLearning.promotedByTheCaller, 'the caller never promotes').toBe(0);
  });
});
