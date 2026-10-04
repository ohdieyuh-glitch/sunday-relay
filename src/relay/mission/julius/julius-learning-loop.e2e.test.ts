import { describe, expect, it } from 'vitest';

import {
  JULIUS_LEARNING_LOOP_VERSION,
  compareJuliusLearningPair,
  decideJuliusLearningPromotion,
  juliusLearningMetrics,
  type JuliusLearningDimension,
  type JuliusLearningPairing,
  type JuliusLearningPolicy,
} from './julius-learning-loop';
import { juliusCarriedEntryId, juliusClaimIdFor } from './julius-claim-ledger';
import { promoteJuliusMemoryClaim, admitJuliusMemoryCandidate, type JuliusMemoryClaim } from './julius-memory-trust';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { JULIUS_RUNTIME_VERSION, type JuliusBrainEntry } from './julius-runtime';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * THE MATCHED-PAIR EXPERIMENT. Does prior learning make the next mission better?
 *
 * WHAT IS PROVEN HERE, exactly:
 *
 *   Julius persists a learning artifact, the artifact reaches the NEXT mission's
 *   context through the ordinary retrieval path, the next mission's measured
 *   outcome differs, the difference is measured off the DURABLE TRAJECTORY rather
 *   than asserted, and the promotion gate refuses the artifact when the
 *   difference is absent, negative or unmeasured.
 *
 * WHAT IS PREMISED, and stated rather than hidden:
 *
 *   That a worker which lacks a needed fact does worse than one which has it.
 *   The scripted Coding Agent below reads its own context packet and fails its
 *   first attempt when the packet does not contain the constraint it needs. That
 *   is the fixture's premise, not a finding — a real model's version of it is
 *   noisier and is what a paid run would measure. Everything BETWEEN that premise
 *   and the verdict is Julius's own machinery, and that is what is under test.
 *
 * WHY THAT PREMISE IS LEGITIMATE. The alternative is to stipulate the metrics and
 * compare two numbers nobody produced, which proves the arithmetic of
 * `compareJuliusLearningPair` and nothing about the loop. Here the retry really
 * happens, in the real run loop, because the real context compiler did not carry
 * a fact that was never stored — and the repair really happens, and both land in
 * the trajectory the comparison reads.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'], providerId: 'openai', adapterId: 'architect-adapter',
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'anthropic', adapterId: 'coder-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
  providerId: 'hermes', adapterId: 'reviewer-adapter',
});

const scope = { projectId: 'prj-1' };
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const OBJECTIVE = 'Add the deploy step to the release script.';
/**
 * THE LEARNED FACT. A previous mission discovered it the hard way; without it the
 * coder ships a deploy that runs before the migration and the build fails.
 */
const LEARNED = 'The migration must run before the deploy, or the deploy fails.';

/** The mission that learned it. Its id is part of every carried entry's own id. */
const PRIOR_RUN_ID = 'run:prior-mission';

const ALL_ROLES: JuliusBrainEntry['allowedRoles'] = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'];

const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] };
const REVIEW_ACCEPT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] };

/**
 * THE CODER'S PREMISE, IN ONE STEP. `readsPacket` receives the compiled packet
 * this dispatch was handed — the real one, out of the durable snapshot.
 */
const BUILD_AFTER_LEARNING = {
  kind: 'succeed' as const,
  evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green, migration first.' }],
};

const CODER_NEEDS_THE_FACT = {
  kind: 'readsPacket' as const,
  decide: (packet: string | null) => (packet !== null && packet.includes('migration must run before the deploy')
    ? { kind: 'succeed' as const, evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }] }
    : { kind: 'succeed' as const, evidence: [{ type: 'TEST', status: 'FAILED', safeSummary: 'Deploy ran before the migration.' }] }),
};

interface MissionOutcome {
  readonly harness: JuliusHarness;
  readonly pairing: JuliusLearningPairing;
}

/**
 * ONE MISSION. `learned` seeds the artifact a previous mission would have left
 * behind; everything else about the two missions is identical by construction —
 * same objective entry, same tasks, same workers, same policies, same budget.
 */
/**
 * WHAT ELSE A PREVIOUS MISSION LEAVES IN THE BRAIN.
 *
 * A real Project Brain does not contain one tidy finding. It contains everything
 * the last mission concluded, most of which is about work this mission is not
 * doing — and the founder's requirement is explicit: prior durable findings must
 * improve the later mission WITHOUT leaking irrelevant task context.
 *
 * So `learned` seeds three pieces of genuine prior-mission residue beside the one
 * relevant finding, each irrelevant for a different structural reason:
 *
 *   - scoped to a task that does not exist in this mission (another task's work);
 *   - readable only by the Independent Reviewer (another role's material);
 *   - SECRET (nobody's).
 *
 * All three are plausible, all three mention the deploy, and a compiler that
 * retrieved on relevance would hand every one of them to the coder.
 */
const PRIOR_RESIDUE = (runId: string) => [
  {
    entryId: `${runId}:prior-other-task`, kind: 'FINDING' as const,
    text: 'The deploy step in the OTHER task must retry three times before failing.',
    taskIds: ['prior-mission-task-9'], allowedRoles: ALL_ROLES, sensitivity: 'INTERNAL' as const,
    provenance: {
      workerId: 'reviewer', recordedAt: '2026-09-10T02:00:00.000Z',
      evidenceIds: ['evidence:prior-other-task'],
    },
  },
  {
    entryId: `${runId}:prior-reviewer-only`, kind: 'FINDING' as const,
    text: 'Reviewer rubric for deploy changes: reject any unproven retry claim.',
    taskIds: [], allowedRoles: ['INDEPENDENT_REVIEWER'] as const, sensitivity: 'INTERNAL' as const,
    provenance: {
      workerId: 'reviewer', recordedAt: '2026-09-10T02:00:00.000Z',
      evidenceIds: ['evidence:prior-rubric'],
    },
  },
  {
    entryId: `${runId}:prior-secret`, kind: 'ARTIFACT' as const,
    text: 'deploy token: hunter2',
    taskIds: [], allowedRoles: ALL_ROLES, sensitivity: 'SECRET' as const,
    provenance: { workerId: 'julius', recordedAt: '2026-09-10T02:00:00.000Z', evidenceIds: [] },
  },
];

async function runMission(learned: boolean, runId: string, priceless = false): Promise<MissionOutcome> {
  const priced = <T extends { kind: 'succeed' }>(step: T) =>
    (priceless ? { ...step, usdMicros: null } : step);
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [priced(PLAN_OK), priced(PLAN_OK)] },
      /**
       * THE SAME SCRIPT IN BOTH MISSIONS, and this is the load-bearing detail.
       * The first attempt reads its packet; the attempts after it succeed,
       * because a coder that has just been told its deploy ran before the
       * migration has learned that WITHIN the mission. So the pair differs in
       * exactly one thing — whether the brain already held the fact — and
       * everything downstream of that is the runtime's own behaviour.
       */
      { worker: CODER, script: [CODER_NEEDS_THE_FACT, priced(BUILD_AFTER_LEARNING), priced(BUILD_AFTER_LEARNING)] },
      { worker: REVIEWER, script: Array.from({ length: 4 }, () => priced(REVIEW_ACCEPT)) },
    ],
    card: cardPolicy({
      allowedProviders: ['openai', 'anthropic', 'hermes'],
      capabilities: ['plan', 'implement', 'review'], concurrency: 1,
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 3 }),
    capabilityFor,
  });
  const run: JuliusRunRow = {
    // The mission id must match the one the seeded tasks carry, or `addTask`
    // refuses the repair task Julius mints mid-mission as `julius_run_not_found`.
    runId, missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
    cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  };
  harness.store.seedRun(run);
  seedTaskContractInto(harness.store, { runId, projectId: 'prj-1', taskId: `${runId}-build` });
  harness.store.seedTask(runId, task({
    taskId: `${runId}-plan`, ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan',
    requiredEvidenceTypes: ['ARTIFACT'],
  }));
  harness.store.seedTask(runId, task({
    taskId: `${runId}-build`, ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: [`${runId}-plan`], requiredEvidenceTypes: ['TEST'],
  }));
  harness.store.seedBrain(runId, [
    {
      entryId: `${runId}:objective`, kind: 'OBJECTIVE', text: OBJECTIVE,
      taskIds: [], allowedRoles: ALL_ROLES, sensitivity: 'INTERNAL',
      provenance: { workerId: 'founder', recordedAt: '2026-09-10T01:00:00.000Z', evidenceIds: [] },
    },
    /**
     * THE ONLY DIFFERENCE BETWEEN THE TWO MISSIONS — written as production writes
     * it.
     *
     * `juliusCarriedEntryId` is the id the BOOTSTRAP gives an inherited fact
     * (`relay-bridge/julius/mission-knowledge.ts`), and the claim standing below
     * is the one it records for it. This matters for the honesty of the whole
     * proof: before the carry existed, this seed was the fixture asserting that a
     * prior mission's fact would somehow be present, and the readiness page said
     * so. Now the shape here IS the shape a real mission B inherits, and the
     * real-PostgreSQL seam suite proves the bootstrap produces it.
     */
    ...(learned ? [{
      entryId: juliusCarriedEntryId(PRIOR_RUN_ID, 'prior:learned'), kind: 'FINDING' as const, text: LEARNED,
      taskIds: [], allowedRoles: ALL_ROLES, sensitivity: 'INTERNAL' as const,
      provenance: {
        workerId: 'reviewer', recordedAt: '2026-09-10T02:00:00.000Z',
        evidenceIds: ['evidence:prior-mission-failure'],
      },
    }] : []),
    // The residue travels with the learning, because a mission that inherits a
    // finding inherits the brain it was written into.
    ...(learned ? PRIOR_RESIDUE(runId) : []),
  ]);
  /**
   * AND THE STANDING THE CARRY RECORDS, so the packet ranks a reviewer-verified
   * fact as VERIFIED rather than re-deriving it as an assertion. Recorded before
   * the run ticks, because that is when the bootstrap records it.
   */
  if (learned) {
    await harness.store.recordClaimStanding({
      runId, projectId: 'prj-1',
      claim: {
        claimId: juliusClaimIdFor(juliusCarriedEntryId(PRIOR_RUN_ID, 'prior:learned')),
        entryId: juliusCarriedEntryId(PRIOR_RUN_ID, 'prior:learned'),
        provenance: 'reviewer_verified', trust: 'VERIFIED', assertedBy: 'reviewer',
        assertedAt: '2026-09-10T02:00:00.000Z',
        evidence: [{ kind: 'REVIEW', id: 'evidence:prior-mission-failure' }],
        supersedes: null, contradicts: [],
      },
      reason: `CARRIED_FROM:${PRIOR_RUN_ID}`, occurredAt: '2026-09-10T02:00:00.000Z',
    });
  }
  for (let tick = 0; tick < 24; tick += 1) {
    if ((await harness.loop.tick(scope)).claimed === 0) break;
  }
  return {
    harness,
    pairing: {
      objectiveDigest: OBJECTIVE, roles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'],
      runtimeVersion: JULIUS_RUNTIME_VERSION,
    },
  };
}

const eventsOf = (outcome: MissionOutcome) => outcome.harness.store.trajectory();

const POLICY: JuliusLearningPolicy = {
  dimensions: ['dispatches', 'repairs', 'verifiedCompletions'],
  minimumRelativeImprovement: 0.1,
  minimumImprovedDimensions: 1,
};

describe('the Julius Learning Loop, measured rather than asserted', () => {
  it('runs the pair, and the mission without the learning really does worse', async () => {
    const without = await runMission(false, 'run-a');
    const withLearning = await runMission(true, 'run-b');

    const a = juliusLearningMetrics(eventsOf(without), JULIUS_RUNTIME_VERSION);
    const b = juliusLearningMetrics(eventsOf(withLearning), JULIUS_RUNTIME_VERSION);

    // THE PREMISE ACTUALLY FIRED. Without the fact the coder's evidence FAILED,
    // Julius admitted a repair round, and the mission paid for it.
    expect(a.repairs, 'mission A must have been sent back, or there is nothing to improve on')
      .toBeGreaterThan(0);
    expect(b.repairs, 'mission B had the fact and needed no repair').toBe(0);
    expect(b.dispatches).toBeLessThan(a.dispatches);
    // AND BOTH COMPLETED. An "improvement" where one side failed is not one.
    expect(a.verifiedCompletions).toBe(1);
    expect(b.verifiedCompletions).toBe(1);
  });

  it('compares the pair dimension by dimension, and never as one score', async () => {
    const without = await runMission(false, 'run-a');
    const withLearning = await runMission(true, 'run-b');
    const comparison = compareJuliusLearningPair({
      without: { events: eventsOf(without), pairing: without.pairing },
      with: { events: eventsOf(withLearning), pairing: withLearning.pairing },
      dimensions: POLICY.dimensions,
    });
    expect(comparison.outcome).toBe('COMPARED');
    if (comparison.outcome !== 'COMPARED') throw new Error('unreachable');
    expect(comparison.version).toBe(JULIUS_LEARNING_LOOP_VERSION);
    const verdicts = new Map(comparison.deltas.map((delta) => [delta.dimension, delta.verdict]));
    expect(verdicts.get('repairs')).toBe('IMPROVED');
    expect(verdicts.get('dispatches')).toBe('IMPROVED');
    expect(verdicts.get('verifiedCompletions'), 'both missions completed: no effect, not an improvement')
      .toBe('NO_EFFECT');
    // Each delta carries both sides, so a reader never has to trust the verdict.
    for (const delta of comparison.deltas) {
      expect(delta.without).not.toBeNull();
      expect(delta.with).not.toBeNull();
    }
  });

  it('promotes the artifact, and reports the WEAKEST improvement as its value', async () => {
    const without = await runMission(false, 'run-a');
    const withLearning = await runMission(true, 'run-b');
    const comparison = compareJuliusLearningPair({
      without: { events: eventsOf(without), pairing: without.pairing },
      with: { events: eventsOf(withLearning), pairing: withLearning.pairing },
      dimensions: POLICY.dimensions,
    });
    const decision = decideJuliusLearningPromotion(comparison, POLICY);
    expect(decision.outcome).toBe('PROMOTE');
    if (decision.outcome !== 'PROMOTE') throw new Error('unreachable');
    expect(decision.improved).toContain('repairs');
    expect(decision.improved).toContain('dispatches');
    expect(decision.marginalValue).toBeGreaterThan(0);
    expect(decision.marginalValue, 'the weakest link, not the best headline')
      .toBeLessThanOrEqual(1);
  });

  /**
   * THE PART A STORE ALONE CANNOT DO. A promotion decision is not a promotion:
   * the artifact still has to climb the trust ladder, on the comparison as its
   * evidence, from an authority that is not the claim's asserter.
   */
  it('cannot promote its own memory: the trust core still gates the write', async () => {
    const candidate = admitJuliusMemoryCandidate({
      claimId: 'claim:learned', entryId: 'run-a:learned', provenance: 'run_observed',
      assertedBy: 'coder', assertedAt: '2026-09-10T02:00:00.000Z',
    });
    expect(candidate.outcome).toBe('OK');
    if (candidate.outcome !== 'OK') throw new Error('unreachable');
    const claim: JuliusMemoryClaim = candidate.claim;

    // THE LOOP CANNOT VOUCH FOR ITS OWN ARTIFACT. `by` is the asserter.
    expect(promoteJuliusMemoryClaim(claim, {
      to: 'VERIFIED', by: 'coder',
      evidence: [{ kind: 'REVIEW', id: 'review:learning-comparison' }], at: '2026-09-10T04:00:00.000Z',
    }).outcome).toBe('REFUSED');

    // A measurement is an observation, so it can corroborate — SUPPORTED — and
    // that is all a matched pair on its own is worth.
    const supported = promoteJuliusMemoryClaim(claim, {
      to: 'SUPPORTED', by: 'julius-learning-loop',
      evidence: [{ kind: 'RUN', id: 'run-b' }, { kind: 'EVIDENCE', id: 'evidence:learning-comparison' }],
      at: '2026-09-10T04:00:00.000Z',
    });
    expect(supported.outcome).toBe('OK');
    if (supported.outcome !== 'OK') throw new Error('unreachable');
    expect(supported.claim.trust).toBe('SUPPORTED');
  });

  it('refuses an artifact that changed nothing', async () => {
    // The same mission twice, both WITH the learning: the comparison is honest
    // and the answer is that the second copy bought nothing.
    const first = await runMission(true, 'run-a');
    const second = await runMission(true, 'run-b');
    const comparison = compareJuliusLearningPair({
      without: { events: eventsOf(first), pairing: first.pairing },
      with: { events: eventsOf(second), pairing: second.pairing },
      dimensions: POLICY.dimensions,
    });
    const decision = decideJuliusLearningPromotion(comparison, POLICY);
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome !== 'REFUSE') throw new Error('unreachable');
    expect(decision.reasonCode).toBe('learning_no_measurable_value');
  });

  it('refuses an artifact that made anything worse, whatever else improved', async () => {
    // The pair, INVERTED: the learning-free mission is presented as the one with
    // the artifact. Repairs and dispatches then regress, and no improvement
    // elsewhere may pay for that.
    const without = await runMission(true, 'run-a');
    const withLearning = await runMission(false, 'run-b');
    const decision = decideJuliusLearningPromotion(compareJuliusLearningPair({
      without: { events: eventsOf(without), pairing: without.pairing },
      with: { events: eventsOf(withLearning), pairing: withLearning.pairing },
      dimensions: POLICY.dimensions,
    }), POLICY);
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome !== 'REFUSE') throw new Error('unreachable');
    expect(decision.reasonCode).toBe('learning_regressed');
    expect(decision.regressed).toContain('repairs');
  });

  it('refuses to score a pair that is not matched', async () => {
    const without = await runMission(false, 'run-a');
    const withLearning = await runMission(true, 'run-b');
    const events = { without: eventsOf(without), with: eventsOf(withLearning) };
    const cases: readonly { readonly pairing: JuliusLearningPairing; readonly reasonCode: string }[] = [
      { pairing: { ...withLearning.pairing, objectiveDigest: 'Something else entirely.' },
        reasonCode: 'learning_pair_objective_differs' },
      { pairing: { ...withLearning.pairing, runtimeVersion: 'julius-runtime.v0' },
        reasonCode: 'learning_pair_runtime_differs' },
      { pairing: { ...withLearning.pairing, roles: ['CODING_AGENT'] },
        reasonCode: 'learning_pair_roles_differ' },
    ];
    for (const item of cases) {
      const comparison = compareJuliusLearningPair({
        without: { events: events.without, pairing: without.pairing },
        with: { events: events.with, pairing: item.pairing },
        dimensions: POLICY.dimensions,
      });
      expect(comparison.outcome).toBe('UNCOMPARABLE');
      if (comparison.outcome !== 'UNCOMPARABLE') throw new Error('unreachable');
      expect(comparison.reasonCode).toBe(item.reasonCode);
      expect(decideJuliusLearningPromotion(comparison, POLICY).outcome).toBe('REFUSE');
    }
  });

  /**
   * UNKNOWN IS NOT AN IMPROVEMENT. This is the case that stops a Learning Loop
   * being trivially satisfiable by a provider that reports nothing: an
   * unmeasured cost on either side makes the cost dimension UNMEASURABLE, and an
   * UNMEASURABLE dimension can never be the improvement that promotes.
   */
  it('never promotes on a dimension nobody measured', async () => {
    // BOTH MISSIONS PRICELESS: the coder, architect and reviewer all report no
    // cost, which is exactly the shape of Live Run 3 — one component priced and
    // three silent — except more honest, because here nothing is priced at all.
    const without = await runMission(false, 'run-a', true);
    const withLearning = await runMission(true, 'run-b', true);
    const costOnly: readonly JuliusLearningDimension[] = ['knownUsdMicros'];
    const comparison = compareJuliusLearningPair({
      without: { events: eventsOf(without), pairing: without.pairing },
      with: { events: eventsOf(withLearning), pairing: withLearning.pairing },
      dimensions: costOnly,
    });
    expect(comparison.outcome).toBe('COMPARED');
    if (comparison.outcome !== 'COMPARED') throw new Error('unreachable');
    for (const delta of comparison.deltas) {
      expect(delta.verdict, `${delta.dimension} must be UNMEASURABLE, not 0 vs 0`).toBe('UNMEASURABLE');
    }
    const decision = decideJuliusLearningPromotion(comparison, {
      ...POLICY, dimensions: costOnly,
    });
    expect(decision.outcome).toBe('REFUSE');
    if (decision.outcome !== 'REFUSE') throw new Error('unreachable');
    expect(decision.reasonCode).toBe('learning_no_measurable_value');
  });

  /**
   * THE COUNTERPART TO THE CASE ABOVE, AND THE REASON IT IS NOT VACUOUS.
   *
   * "Never promotes on a dimension nobody measured" would have passed even if the
   * runtime NEVER recorded a cost — and until the trajectory's four measurement
   * columns were filled, that is exactly what it was doing: `usdMicros`,
   * `inputTokens`, `outputTokens` and `durationMs` were null on every successful
   * dispatch, so every cost and token dimension was permanently UNMEASURABLE and
   * the refusal was free.
   *
   * So this asserts the other half: on a PRICED pair the same dimensions are
   * measured, and the comparison reaches a real verdict about them. One case
   * proving absence and one proving presence; neither is worth much alone.
   */
  it('measures the cost and token dimensions when the provider does report them', async () => {
    const without = await runMission(false, 'run-a');
    const withLearning = await runMission(true, 'run-b');
    const comparison = compareJuliusLearningPair({
      without: { events: eventsOf(without), pairing: without.pairing },
      with: { events: eventsOf(withLearning), pairing: withLearning.pairing },
      dimensions: ['knownUsdMicros', 'knownInputTokens', 'knownOutputTokens'],
    });
    expect(comparison.outcome).toBe('COMPARED');
    if (comparison.outcome !== 'COMPARED') throw new Error('unreachable');
    for (const delta of comparison.deltas) {
      expect(delta.verdict, `${delta.dimension} must be measured, not UNMEASURABLE`)
        .not.toBe('UNMEASURABLE');
      expect(delta.without, `${delta.dimension} has a figure for mission A`).not.toBeNull();
      expect(delta.with, `${delta.dimension} has a figure for mission B`).not.toBeNull();
    }
    // Mission A paid for a repair round, so it spent more on the same objective.
    expect(comparison.without.knownUsdMicros).toBeGreaterThan(comparison.with.knownUsdMicros);
    expect(comparison.without.costComplete, 'and every component reported').toBe(true);
  });

  it('refuses a policy that could not refuse anything', async () => {
    const without = await runMission(false, 'run-a');
    const withLearning = await runMission(true, 'run-b');
    const comparison = compareJuliusLearningPair({
      without: { events: eventsOf(without), pairing: without.pairing },
      with: { events: eventsOf(withLearning), pairing: withLearning.pairing },
      dimensions: POLICY.dimensions,
    });
    expect(decideJuliusLearningPromotion(comparison, { ...POLICY, minimumImprovedDimensions: 0 }))
      .toMatchObject({ outcome: 'REFUSE', reasonCode: 'learning_policy_requires_no_improvement' });
    expect(decideJuliusLearningPromotion(comparison, { ...POLICY, minimumRelativeImprovement: 0 }))
      .toMatchObject({ outcome: 'REFUSE', reasonCode: 'learning_policy_threshold_required' });
    expect(decideJuliusLearningPromotion(comparison, { ...POLICY, dimensions: ['recoveries'] }))
      .toMatchObject({ outcome: 'REFUSE', reasonCode: 'learning_policy_dimension_not_compared' });
  });
});

/**
 * THE LEARNING ARRIVES AND THE REST OF THE PRIOR MISSION DOES NOT.
 *
 * The matched pair above proves the improvement is real and measured. This proves
 * the other half of the founder's requirement, which a matched pair alone cannot:
 * that what improved the mission was the RELEVANT finding, and that the rest of
 * the previous mission's brain — another task's finding, another role's rubric, a
 * secret — never reached the worker.
 *
 * It reads the packet out of the durable snapshot the coder's dispatch was
 * recorded against, so it is asserting what the worker was actually handed rather
 * than what the store contained.
 */
describe('prior learning reaches the next mission without leaking the last one', () => {
  const coderSnapshot = (outcome: MissionOutcome) => {
    const dispatch = outcome.harness.adapters.get('coder-adapter')!.dispatches.at(0);
    expect(dispatch, 'the Coding Agent must have been dispatched').toBeTruthy();
    const snapshot = outcome.harness.store.contexts()
      .filter((item) => item.contextId === dispatch!.contextId && item.taskId === dispatch!.taskId).at(-1);
    expect(snapshot, 'every dispatch records a durable context snapshot').toBeTruthy();
    return snapshot!;
  };

  it('hands the coder the relevant finding and none of the residue', async () => {
    const withLearning = await runMission(true, 'run-b');
    const snapshot = coderSnapshot(withLearning);
    const text = snapshot.packet.blocks.map((block) => block.text).join('\n');

    // THE INHERITED ENTRY ID IS THE CARRY'S OWN, so this case also pins that the
    // packet carries what the bootstrap actually writes — `carried:<run>:<entry>`
    // — rather than an id only this fixture would produce.
    const inheritedId = juliusCarriedEntryId(PRIOR_RUN_ID, 'prior:learned');
    expect(snapshot.sourceEntryIds, 'the finding the task needs arrived').toContain(inheritedId);
    expect(text).toContain('migration must run before the deploy');

    // AND IT ARRIVED AS VERIFIED, from the recorded standing the carry wrote —
    // not re-derived from its kind, which would have ranked a reviewer-verified
    // fact as an assertion in every later mission.
    const claim = (await withLearning.harness.store.claimsForRun('run-b', 'prj-1'))
      .find((row) => row.entryId === inheritedId);
    expect(claim?.trust, 'the standing travelled with the fact').toBe('VERIFIED');
    expect(claim?.assertedBy, 'and so did its author, so a reviewer here cannot self-verify it').toBe('reviewer');

    // POINT 4 OF DECISION C's PROOF, ON THE RECORD: the compile that built this
    // packet names the inherited entry it holds, read off the snapshot's own
    // source ids, beside the context id the dispatch was recorded against.
    const compiled = withLearning.harness.store.events()
      .filter((event) => event.type === 'context.compiled' && event.facts.contextId === snapshot.contextId);
    expect(compiled.length, 'the compile behind this packet is on the ledger').toBeGreaterThan(0);
    expect(compiled.at(-1)!.facts).toMatchObject({ carriedReceived: 1, carriedReceivedIds: inheritedId });
    // And a mission that inherited nothing records that it received nothing.
    const without = await runMission(false, 'run-a');
    const plain = without.harness.store.events().filter((event) => event.type === 'context.compiled');
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.every((event) => event.facts.carriedReceived === 0 && event.facts.carriedReceivedIds === null)).toBe(true);

    for (const leaked of ['run-b:prior-other-task', 'run-b:prior-reviewer-only', 'run-b:prior-secret']) {
      expect(snapshot.sourceEntryIds, `${leaked} leaked into the coder's packet`).not.toContain(leaked);
      expect(snapshot.integrityExcludedEntryIds, `${leaked} must be reported as excluded, not silently dropped`)
        .toContain(leaked);
    }
    // And not by text either: an exclusion that dropped the id and kept the prose
    // would be the same leak with the evidence removed.
    expect(text).not.toContain('OTHER task');
    expect(text).not.toContain('Reviewer rubric');
    expect(text).not.toContain('hunter2');
  });

  it('still measures the improvement with the residue present', async () => {
    // THE CONTROL FOR THE CONTROL. If the residue changed the measured outcome,
    // the no-leak case above would be proving that exclusion works and quietly
    // invalidating the matched pair it sits beside.
    const without = await runMission(false, 'run-a');
    const withLearning = await runMission(true, 'run-b');
    const decision = decideJuliusLearningPromotion(compareJuliusLearningPair({
      without: { events: eventsOf(without), pairing: without.pairing },
      with: { events: eventsOf(withLearning), pairing: withLearning.pairing },
      dimensions: POLICY.dimensions,
    }), POLICY);
    expect(decision.outcome).toBe('PROMOTE');
    if (decision.outcome !== 'PROMOTE') throw new Error('unreachable');
    expect(decision.improved).toContain('repairs');
  });

  it('gives the reviewer its own rubric, which is what makes the coder\u2019s exclusion a scope and not a filter', async () => {
    // The residue is not globally suppressed: the entry the coder may not read is
    // read by the role it was written for. A guard that hid it from everyone would
    // pass the case above while destroying the reviewer's own context.
    const withLearning = await runMission(true, 'run-b');
    const dispatch = withLearning.harness.adapters.get('reviewer-adapter')!.dispatches.at(0);
    expect(dispatch, 'the reviewer must have been dispatched').toBeTruthy();
    const snapshot = withLearning.harness.store.contexts()
      .filter((item) => item.contextId === dispatch!.contextId).at(-1)!;
    expect(snapshot.sourceEntryIds).toContain('run-b:prior-reviewer-only');
    expect(snapshot.integrityExcludedEntryIds, 'and the secret is still nobody\u2019s')
      .toContain('run-b:prior-secret');
  });
});
