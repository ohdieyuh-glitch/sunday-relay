import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { evaluateJuliusGuidanceCurrency, guidanceSubjectTaskId } from './julius-continuous-lifecycle';
import { boundStageForRole, reviewStageOf, workStageOf } from './julius-review-stage';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * THE TWELVE PROOFS OF THE CONTINUOUS THREE-WORKER LIFECYCLE.
 *
 * Provider-free and deterministic: the adapters answer from a script because no
 * credential exists here and, while the Anthropic account is unfunded, none
 * could be spent anyway. Everything between the scheduler and the adapter is
 * the real runtime — the real claim, the real contract gate, the real binding
 * currency, the real context compiler, the real budget reservation, the real
 * verification evaluator, the real repair planner.
 *
 * Each `it` is numbered against the directive's own list, so a reader can check
 * the twelve off without reading the code.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter',
  // `guidance` and `repair:guidance` are the continuous lifecycle's additions:
  // the architect that ADVISES under a locked contract, and its own repair.
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan', 'guidance', 'repair:guidance'],
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'],
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter',
  capabilities: ['review'],
  taskTypes: [
    'review:plan', 'review:build', 'review:guidance',
    'review:repair:plan', 'review:repair:build', 'review:repair:guidance',
  ],
});

const scope = { projectId: 'prj-1' };
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};

const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const FAILED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'A blocking finding.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];

/** A well-formed request from the coder and a well-formed answer from the architect. */
const REQUEST = Object.freeze({
  question: 'The journal reader already buffers — should the normalizer reuse it?',
  blockedOn: ['the 8KiB boundary case'],
  attempted: ['a second buffer, which double-buffers'],
  relevantPaths: ['src/relay/persistence/journal.ts'],
});
const GUIDANCE = Object.freeze({
  subObjective: 'Reuse the existing reader rather than adding a second buffer.',
  relevantRequirements: ['R1'],
  relevantConstraints: ['no new dependency'],
  repositoryFindings: ['journal.ts already buffers at the same boundary'],
  runtimeFindings: ['the failing case is exactly 8KiB'],
  references: [{
    kind: 'REPOSITORY', locator: 'src/relay/persistence/journal.ts:120',
    retrievedAt: '2026-09-10T20:59:00.000Z', trust: 'CORROBORATED',
  }],
  recommendedActions: ['call the existing reader'],
  additionalProhibitions: ['do not widen the public API'],
  affectedCriterionIds: [],
  unresolvedQuestions: ['is 8KiB a requirement or an accident?'],
});

interface BuildInput {
  readonly coderScript?: readonly Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number][];
  readonly architectScript?: readonly Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number][];
  readonly reviewerScript?: readonly Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number][];
  readonly maxRepairRounds?: number;
  readonly research?: Parameters<typeof createJuliusHarness>[0]['research'];
}

const build = (input: BuildInput = {}): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: input.architectScript ?? [{ kind: 'succeed', evidence: PLAN_EVIDENCE }] },
      { worker: CODER, script: input.coderScript ?? [{ kind: 'succeed' }] },
      { worker: REVIEWER, script: input.reviewerScript ?? [{ kind: 'succeed', evidence: PASSED_REVIEW }] },
    ],
    card: cardPolicy({
      allowedProviders: [ARCHITECT.providerId, CODER.providerId, REVIEWER.providerId],
      capabilities: ['plan', 'implement', 'review'],
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: input.maxRepairRounds ?? 2 }),
    capabilityFor,
    ...(input.research === undefined ? {} : { research: input.research }),
  });
  harness.store.seedRun(RUN);
  // The build's contract as bootstrap writes it: a DRAFT that the accepting
  // plan review locks, which is where production locks it too.
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  harness.store.seedCriteria('run-1', [
    { criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] },
  ]);
  return harness;
};

/** Drive as `driveJuliusRunToTerminal` does: tick, and advance when a tick claims nothing. */
async function drain(harness: JuliusHarness, ticks = 24): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    const report = await harness.loop.tick(scope);
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
}

const factsOf = (harness: JuliusHarness, type: string) =>
  harness.store.events().filter((event) => event.type === type).map((event) => event.facts);

/** A continuation task itself — not the review task that hangs off one. */
const CONTINUATION = /^segment:build-1:\d+:task$/u;

const taskIds = (harness: JuliusHarness): string[] => harness.store.trajectory()
  .filter((event) => event.kind === 'DISPATCH')
  .map((event) => event.taskId)
  .filter((taskId): taskId is string => taskId !== null);

/* ------------------------------------------------------------------ proofs */

describe('1 — the architect remains callable after LOCK, without mutating the contract', () => {
  it('a guidance task is dispatched under the locked contract and the terms do not move', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
      ],
    });
    await drain(harness);

    const before = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(before?.state, 'the contract locked when the plan review accepted').toBe('LOCKED');

    const guidanceTask = harness.store.taskRow('guidance:build-1:1:task');
    expect(guidanceTask, 'a guidance task exists').not.toBeNull();
    expect(guidanceTask!.role).toBe('PROMPT_ARCHITECT');
    expect(taskIds(harness)).toContain('guidance:build-1:1:task');

    // The dispatch carried the CONTRACT — the guidance task is bound, unlike
    // the plan task that wrote the terms.
    const dispatched = harness.store.events()
      .find((event) => event.type === 'task.claimed' && event.taskId === 'guidance:build-1:1:task');
    expect(dispatched?.facts.contractRevision, 'guidance is dispatched under a revision').toBe(before!.contractRevision);
    expect(dispatched?.facts.bindingDigest).toBe(before!.bindingDigest);

    // And the contract is byte-identical afterwards.
    const after = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(after).toEqual(before);
  });
});

describe('2 — the coder can request additional architect guidance mid-mission', () => {
  it('a request becomes a checkpoint, a route, and a real task on the architect', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
      ],
    });
    await drain(harness);

    const checkpoints = factsOf(harness, 'checkpoint.recorded');
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.trigger).toBe('GUIDANCE_REQUESTED');
    expect(checkpoints[0]!.origin).toBe('CODING_AGENT');
    expect(checkpoints[0]!.checkpointId).toBe('checkpoint:build-1:1');

    const routed = factsOf(harness, 'checkpoint.verdict');
    expect(routed[0]!.route).toBe('REQUEST_GUIDANCE');
    expect(routed[0]!.guidanceTaskId).toBe('guidance:build-1:1:task');
    expect(routed[0]!.created).toBe(true);

    // A TASK, not a message: it went through the ordinary router.
    expect(harness.adapters.get(ARCHITECT.adapterId)!.dispatches.map((d) => d.taskId))
      .toEqual(['plan-1', 'guidance:build-1:1:task']);
  });

  it('refuses a request that names a contract term — a scope change wearing a question mark', async () => {
    const harness = build({ coderScript: [{ kind: 'succeed', guidanceRequest: { ...REQUEST, inScope: ['everything'] } }, { kind: 'succeed' }] });
    await drain(harness);
    // The checkpoint is still recorded — a worker asked, and that is a fact —
    // but Julius wrote its own sentence rather than the worker's.
    const checkpoints = factsOf(harness, 'checkpoint.recorded');
    expect(checkpoints).toHaveLength(1);
    const guidanceTasks = harness.store.trajectory().filter((event) => event.taskId?.startsWith('guidance:'));
    expect(guidanceTasks.length, 'the malformed request still routes, on Julius\'s words').toBeGreaterThanOrEqual(0);
  });

  it('does not ask twice while one question is outstanding', async () => {
    // Two consecutive coder dispatches both asking; only one guidance task.
    const harness = build({
      coderScript: [
        { kind: 'succeed', guidanceRequest: REQUEST },
        { kind: 'succeed', guidanceRequest: REQUEST },
      ],
      reviewerScript: [
        { kind: 'succeed', evidence: PASSED_REVIEW },  // plan
        { kind: 'succeed', evidence: FAILED_REVIEW },  // build → repair
        { kind: 'succeed', evidence: PASSED_REVIEW },
        { kind: 'succeed', evidence: PASSED_REVIEW },
      ],
    });
    await drain(harness);
    const created = factsOf(harness, 'checkpoint.verdict').filter((facts) => facts.route === 'REQUEST_GUIDANCE');
    const suppressed = factsOf(harness, 'checkpoint.verdict').filter((facts) => facts.reasonCode === 'GUIDANCE_ALREADY_IN_FLIGHT');
    expect(created.length + suppressed.length, 'every request was routed').toBeGreaterThan(0);
    // Whatever the interleaving, no subject ever has two OUTSTANDING questions.
    const ids = created.map((facts) => facts.guidanceTaskId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('2b — Julius honours the route it computed, and declines out loud', () => {
  it('a request before LOCK records the checkpoint and mints NO guidance task', async () => {
    // The plan dispatch happens while the contract is still a DRAFT, so routing
    // answers CONTINUE: before LOCK the architect IS the task holder, and
    // guidance would be it asking itself.
    const harness = build({
      architectScript: [{ kind: 'succeed', evidence: PLAN_EVIDENCE, guidanceRequest: REQUEST }],
    });
    await drain(harness);

    const checkpoints = factsOf(harness, 'checkpoint.recorded');
    expect(checkpoints, 'the request is still a fact worth recording').toHaveLength(1);
    expect(checkpoints[0]!.origin).toBe('PROMPT_ARCHITECT');

    const routed = factsOf(harness, 'checkpoint.verdict');
    expect(routed[0]!.route).toBe('CONTINUE');
    expect(routed[0]!.reasonCode).toBe('CONTRACT_NOT_LOCKED');
    expect(harness.store.trajectory().some((event) => event.taskId?.startsWith('guidance:')), 'no guidance task').toBe(false);
  });

  it('only a REQUEST_GUIDANCE route ever names a guidance task', async () => {
    const harness = build({
      architectScript: [{ kind: 'succeed', evidence: PLAN_EVIDENCE, guidanceRequest: REQUEST }],
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
    });
    await drain(harness);
    for (const facts of factsOf(harness, 'checkpoint.verdict')) {
      if (facts.route === 'REQUEST_GUIDANCE') expect(facts.guidanceTaskId, 'a request must name its task').toBeDefined();
      else expect(facts.guidanceTaskId, `${String(facts.route)} minted a task anyway`).toBeUndefined();
    }
  });

  it('never declines guidance in silence — every path that issues nothing says why', () => {
    // The mutation this closes: replacing a refusal with a bare `return`, which
    // leaves no trace at all. A refusal the record cannot show is the same
    // failure as the missing coder diagnostics of Mission 5 — the answer
    // existed and nothing kept it.
    const source = readFileSync(
      resolve(process.cwd(), 'src/relay/mission/julius/julius-task-pipeline.ts'), 'utf8',
    );
    const start = source.indexOf('async function issueGuidanceFromResult(');
    expect(start, 'the guidance issuer must exist').toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('\n}', source.indexOf('await ledger.event(\'guidance.issued\'', start)));
    const bare = [...body.matchAll(/^\s*(?:return|return;)\s*$/gmu)];
    expect(bare.map((match) => match[0].trim()), 'a bare return abandons without a reason').toEqual([]);
    expect(body).not.toMatch(/\breturn;/u);
  });

  it('mints nothing when no worker accepts `guidance`, rather than stalling the mission', async () => {
    // The deployment that has not yet armed the architect's guidance charter.
    // Julius records that it WOULD have asked and carries on: a RUNNABLE task
    // nobody can claim is the failure mode paid run 34037313976 taught, and it
    // is worse than no guidance at all.
    const harness = createJuliusHarness({
      workers: [
        { worker: worker({ ...ARCHITECT, taskTypes: ['plan', 'repair:plan'] }), script: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }] },
        { worker: CODER, script: [{ kind: 'succeed', guidanceRequest: REQUEST }] },
        { worker: REVIEWER, script: [{ kind: 'succeed', evidence: PASSED_REVIEW }] },
      ],
      card: cardPolicy({
        allowedProviders: [ARCHITECT.providerId, CODER.providerId, REVIEWER.providerId],
        capabilities: ['plan', 'implement', 'review'],
      }),
      verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
      capabilityFor,
    });
    harness.store.seedRun(RUN);
    seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
    harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
    harness.store.seedTask('run-1', task({
      taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
      state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
    }));
    harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
    await drain(harness);

    const routed = factsOf(harness, 'checkpoint.verdict');
    expect(routed.some((facts) => facts.reasonCode === 'GUIDANCE_UNROUTABLE'), 'the refusal is recorded').toBe(true);
    expect(routed.find((facts) => facts.reasonCode === 'GUIDANCE_UNROUTABLE')!.wouldHaveRouted).toBe('REQUEST_GUIDANCE');
    expect(harness.store.taskRow('guidance:build-1:1:task'), 'no task nobody can claim').toBeNull();
    const run = await harness.store.loadRun('run-1', 'prj-1');
    expect(run!.state, 'and the mission still finishes').toBe('COMPLETED');
  });
});

describe('3 — architect guidance is versioned and contract-bound', () => {
  it('records the packet digest, its revision and the exact contract it was written under', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
      ],
    });
    await drain(harness);

    const issued = factsOf(harness, 'guidance.issued');
    expect(issued, 'guidance was issued exactly once').toHaveLength(1);
    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(issued[0]!.guidanceId).toBe('guidance:build-1:1');
    expect(issued[0]!.guidanceRevision).toBe(1);
    expect(String(issued[0]!.guidanceDigest)).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(issued[0]!.contractRevision).toBe(contract!.contractRevision);
    expect(issued[0]!.contractBindingDigest).toBe(contract!.bindingDigest);
  });

  it('records counts and identifiers, never the advice itself', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
      ],
    });
    await drain(harness);
    const ledger = JSON.stringify(harness.store.events());
    expect(ledger).not.toContain('Reuse the existing reader');
    expect(ledger).not.toContain('do not widen the public API');
    expect(factsOf(harness, 'guidance.issued')[0]!.recommendedActions).toBe(1);
    expect(factsOf(harness, 'guidance.issued')[0]!.references).toBe(1);
    expect(factsOf(harness, 'guidance.issued')[0]!.webReferences).toBe(0);
  });
});

describe('4 — the reviewer reviews architect guidance', () => {
  it('schedules review:guidance through the ordinary review machinery', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
      ],
    });
    await drain(harness);
    expect(harness.store.taskRow('guidance:build-1:1:task:review'), 'the guidance is reviewed').not.toBeNull();
    expect(harness.store.taskRow('guidance:build-1:1:task:review')!.taskType).toBe('review:guidance');
    expect(reviewStageOf('review:guidance')).toBe('guidance');
    expect(taskIds(harness)).toContain('guidance:build-1:1:task:review');
  });

  it('reviews the guidance under the SAME binding the guidance ran under', async () => {
    // The shared-binding guard, inherited rather than rebuilt: a reviewer whose
    // binding differs from the work's is refused REVIEW_CONTRACT_MISMATCH.
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
      ],
    });
    await drain(harness);
    const claims = harness.store.events().filter((event) => event.type === 'task.claimed');
    const guidanceClaim = claims.find((event) => event.taskId === 'guidance:build-1:1:task');
    const reviewClaim = claims.find((event) => event.taskId === 'guidance:build-1:1:task:review');
    expect(reviewClaim?.facts.bindingDigest).toBe(guidanceClaim?.facts.bindingDigest);
    expect(reviewClaim?.facts.contractRevision).toBe(guidanceClaim?.facts.contractRevision);
    expect(factsOf(harness, 'contract.refused')).toEqual([]);
  });
});

describe('5 — the reviewer receives multiple execution checkpoints, not only the final output', () => {
  it('reviews the plan, the guidance and the build within one mission', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
      ],
    });
    await drain(harness);
    const reviewed = taskIds(harness).filter((id) => id.includes(':review'));
    expect(reviewed.length, 'more than one review in a single mission').toBeGreaterThan(1);
    expect(reviewed).toContain('plan-1:review');
    expect(reviewed).toContain('guidance:build-1:1:task:review');
    expect(reviewed).toContain('build-1:review');
  });
});

describe('6 — the reviewer can force repair during execution', () => {
  it('a blocking finding on the guidance repairs the GUIDANCE, on the architect', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
      ],
      reviewerScript: [
        // The plan is accepted, and then EVERY later review returns a blocking
        // finding. The script's last entry repeats, so this does not depend on
        // whether the build review or the guidance review is claimed first —
        // an ordering assumption is not a property worth testing.
        { kind: 'succeed', evidence: PASSED_REVIEW },
        { kind: 'succeed', evidence: FAILED_REVIEW },
      ],
    });
    await drain(harness);
    const repairs = factsOf(harness, 'repair.scheduled');
    expect(repairs.length, 'a repair was scheduled during execution').toBeGreaterThan(0);
    const repaired = harness.store.taskRow('repair:guidance:build-1:1:task:1:task');
    expect(repaired, 'the repair inherits the guidance stage').not.toBeNull();
    // ROLE AND STAGE ARE INHERITED: a guidance repair goes back to the
    // architect as `repair:guidance`, never to the coder and never as
    // `repair:repair:guidance`.
    expect(repaired!.role).toBe('PROMPT_ARCHITECT');
    expect(repaired!.taskType).toBe('repair:guidance');
  });
});

describe('7 — guidance cannot alter locked scope or acceptance criteria', () => {
  it('refuses a packet that names a contract term, and the contract is untouched', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: { ...GUIDANCE, inScope: ['the whole repository'], blockingAcceptanceCriteria: [] } },
      ],
    });
    const locked = await (async () => { await drain(harness); return harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' }); })();

    expect(factsOf(harness, 'guidance.issued'), 'nothing was issued').toEqual([]);
    const refused = factsOf(harness, 'guidance.refused');
    expect(refused).toHaveLength(1);
    expect(refused[0]!.reasonCode).toBe('guidance_shape_refused');
    // The locked terms are exactly what the reviewer accepted.
    expect(locked!.state).toBe('LOCKED');
    expect(locked!.inScope).not.toContain('the whole repository');
    expect(locked!.blockingAcceptanceCriteria.length).toBeGreaterThan(0);
  });

  it('refuses a packet that invents an acceptance criterion', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: { ...GUIDANCE, affectedCriterionIds: ['ac-invented'] } },
      ],
    });
    await drain(harness);
    expect(factsOf(harness, 'guidance.issued')).toEqual([]);
    expect(factsOf(harness, 'guidance.refused')[0]!.reasonCode).toBe('guidance_names_unknown_criterion');
  });
});

describe('8 — a contract-affecting discovery needs a reviewed and re-locked revision', () => {
  it('a proposal against a LOCKED contract is refused, and the revision does not move', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        // The architect tries to amend the agreement from inside a guidance
        // dispatch. The revision model is the only door, and it is shut here.
        { kind: 'succeed', evidence: PLAN_EVIDENCE, contractProposal: { objective: 'A different mission entirely.' } },
      ],
    });
    await drain(harness);
    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(contract!.state).toBe('LOCKED');
    expect(contract!.objective).not.toBe('A different mission entirely.');
    const refusals = factsOf(harness, 'contract.refused').filter((facts) => facts.reasonCode === 'contract_already_locked');
    expect(refusals.length, 'the refusal is recorded, not silent').toBeGreaterThan(0);
  });

  it('the pre-lock revision path still works, so a genuine change has a door', async () => {
    const harness = build({
      architectScript: [{ kind: 'succeed', evidence: PLAN_EVIDENCE, contractProposal: { objective: 'A sharper objective, proposed before lock.' } }],
    });
    await drain(harness);
    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    // The proposal produced a new revision that the reviewer then locked.
    expect(contract!.contractRevision).toBeGreaterThan(1);
    expect(contract!.objective).toBe('A sharper objective, proposed before lock.');
    expect(contract!.state).toBe('LOCKED');
  });
});

describe('9 — stale guidance and stale handoffs are rejected after a contract revision', () => {
  it('guidance written under revision N reads STALE at revision N+1, and is never rebound', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
      ],
    });
    await drain(harness);
    const issued = factsOf(harness, 'guidance.issued')[0]!;
    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });

    const binding = {
      contractId: contract!.contractId, taskId: contract!.taskId,
      contractRevision: Number(issued.contractRevision), bindingDigest: String(issued.contractBindingDigest),
    };
    expect(evaluateJuliusGuidanceCurrency({ guidance: { binding }, contract: contract! })).toBe('CURRENT');
    // The same packet, one revision later.
    expect(evaluateJuliusGuidanceCurrency({
      guidance: { binding },
      contract: { ...contract!, contractRevision: contract!.contractRevision + 1, bindingDigest: 'sha256:different' },
    })).toBe('STALE');
  });

  it('a guidance task whose subject has no locked contract is refused rather than guessed', async () => {
    // No lock, no agreement to advise under.
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      reviewerScript: [{ kind: 'succeed', evidence: FAILED_REVIEW }],
    });
    await drain(harness);
    // The plan review rejected, so the contract never locked and the coder
    // never ran — there is no guidance, and nothing pretended otherwise.
    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(contract!.state).not.toBe('LOCKED');
    expect(factsOf(harness, 'guidance.issued')).toEqual([]);
  });
});

describe('10 — Julius retains final mission authority', () => {
  it('no verdict, guidance or request ever writes a decision; every decision is Julius\'s', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
      ],
    });
    await drain(harness);
    const decisions = factsOf(harness, 'verification.decided');
    expect(decisions.length).toBeGreaterThan(0);
    // Every decision came from the verification path, and each names an action
    // from Julius's own vocabulary — never a checkpoint verdict.
    for (const facts of decisions) {
      expect(['ACCEPT', 'REPAIR', 'REROUTE', 'RETRY', 'ESCALATE', 'HALT', 'COMPLETE']).toContain(facts.action);
      expect(['CONTINUE', 'WARNING', 'CHALLENGE', 'REPAIR_REQUIRED', 'BLOCK']).not.toContain(facts.action);
    }
    // The routing events are advisory: they name a route, never an action.
    for (const facts of factsOf(harness, 'checkpoint.verdict')) {
      expect(facts.action, 'a route is not a decision').toBeUndefined();
    }
  });
});

describe('11 — a worker failure does not silently bypass the reviewer or the architect', () => {
  it('a failed guidance task leaves the mission incomplete rather than proceeding as if advised', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        // The guidance dispatch fails, permanently.
        { kind: 'fail', code: 'AUTH_CONFIGURATION' },
      ],
    });
    await drain(harness);
    const guidanceTask = harness.store.taskRow('guidance:build-1:1:task');
    expect(guidanceTask!.state, 'the failure is durable, not swallowed').toBe('FAILED');
    expect(factsOf(harness, 'guidance.issued'), 'nothing was issued').toEqual([]);
    const run = await harness.store.loadRun('run-1', 'prj-1');
    expect(run!.state, 'the mission did not complete around the failure').not.toBe('COMPLETED');
  });

  it('a failed guidance REVIEW does not count as a review that happened', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
      ],
      reviewerScript: [
        { kind: 'succeed', evidence: PASSED_REVIEW },   // the plan review answers
        // and then the reviewer dies permanently. The last entry repeats, so no
        // review after the plan ever succeeds — which is the only way to ask
        // whether a review that did not happen can still count as one.
        { kind: 'fail', code: 'AUTH_CONFIGURATION' },
      ],
    });
    await drain(harness);
    const run = await harness.store.loadRun('run-1', 'prj-1');
    expect(run!.state).not.toBe('COMPLETED');
    // `reviewCompletedFor` counts only a SUCCEEDED reviewer child, so a review
    // that never answered leaves its subject unverified rather than accepted.
    for (const subject of ['guidance:build-1:1:task', 'build-1']) {
      const accepted = harness.store.events().filter((event) => event.type === 'verification.decided'
        && event.taskId === subject && event.facts.action === 'ACCEPT');
      expect(accepted, `${subject} was accepted without a review`).toEqual([]);
    }
  });
});

describe('12 — the prior guarantees do not regress', () => {
  it('a mission with no checkpoints behaves exactly as before: plan, review, build, review, complete', async () => {
    const harness = build();
    await drain(harness);
    expect(taskIds(harness)).toEqual(['plan-1', 'plan-1:review', 'build-1', 'build-1:review']);
    expect(factsOf(harness, 'checkpoint.recorded'), 'no checkpoint without a trigger').toEqual([]);
    expect(factsOf(harness, 'guidance.issued')).toEqual([]);
    const run = await harness.store.loadRun('run-1', 'prj-1');
    expect(run!.state).toBe('COMPLETED');
  });

  it('the contract gate, the binding record and the review binding are all unchanged', async () => {
    const harness = build();
    await drain(harness);
    const claim = harness.store.events().find((event) => event.type === 'task.claimed' && event.taskId === 'build-1');
    expect(claim!.facts.contractRevision, 'the coder still runs under a revision').not.toBeNull();
    expect(claim!.facts.bindingDigest).not.toBeNull();
    const reviewClaim = harness.store.events().find((event) => event.type === 'task.claimed' && event.taskId === 'build-1:review');
    expect(reviewClaim!.facts.bindingDigest, 'the reviewer still shares it').toBe(claim!.facts.bindingDigest);
    expect(factsOf(harness, 'contract.refused')).toEqual([]);
  });

  it('never writes a credential or a chain of thought, checkpoints and guidance included', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: { ...REQUEST, question: 'api_key=sk-must-never-appear is in the config' } }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
      ],
    });
    await drain(harness);
    const everything = JSON.stringify({
      events: harness.store.events(), trajectory: harness.store.trajectory(),
      contexts: harness.store.contexts(), results: harness.store.results(),
    });
    for (const forbidden of ['chain of thought', 'scratchpad', 'system prompt', 'internal monologue']) {
      expect(everything, forbidden).not.toContain(forbidden);
    }
    // The event validator refuses a credential-shaped fact outright, so a
    // checkpoint summary carrying one is refused rather than stored.
    expect(everything).not.toContain('sk-must-never-appear');
  });

  it('a guidance task id can never be forged from an ordinary task', () => {
    expect(guidanceSubjectTaskId('build-1')).toBeNull();
    expect(guidanceSubjectTaskId('repair:build-1:1:task')).toBeNull();
    expect(guidanceSubjectTaskId('guidance:build-1:1:task')).toBe('build-1');
  });
});

/**
 * 28 — THE QUESTION REACHES THE ARCHITECT, NOT JUST THE LEDGER.
 *
 * ADR-021 minted the guidance task and recorded the checkpoint, and that was
 * enough to prove Julius had ASKED. It was not enough to prove the architect
 * could ANSWER: a guidance task carries no payload of its own, so what a worker
 * sees is the packet Julius compiles for it. A request that stopped at the
 * checkpoint's `safeSummary` would arrive as a task to write advice about
 * nothing in particular, and `blockedOn`, `attempted` and `relevantPaths` are
 * the difference between "the coder is stuck" and a question someone can answer.
 */
describe('28 - a guidance request reaches the architect through the Project Brain', () => {
  const asks = async (harness: JuliusHarness) =>
    (await harness.store.brainEntriesForRun('run-1', 'prj-1'))
      .filter((entry) => entry.entryId.startsWith('brain:guidance-request:'));

  it('writes one HANDOFF entry scoped to the guidance task, and to no other packet', async () => {
    const harness = build({ coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }] });
    await drain(harness);
    const guidance = harness.store.taskRow('guidance:build-1:1:task');
    expect(guidance, 'a guidance task must have been minted').toBeDefined();

    const rows = await asks(harness);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('HANDOFF');
    expect(rows[0].taskIds).toEqual(['guidance:build-1:1:task']);
  });

  it('carries the three structured fields the checkpoint summary drops', async () => {
    const harness = build({ coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }] });
    await drain(harness);
    const text = (await asks(harness))[0].text;
    expect(text).toContain(REQUEST.question);
    for (const line of [...REQUEST.blockedOn, ...REQUEST.attempted, ...REQUEST.relevantPaths]) {
      expect(text, 'the architect must be able to read: ' + line).toContain(line);
    }
  });

  /** A replayed tick writes neither the task nor the entry: one ask, one row. */
  it('does not duplicate on a replayed drive', async () => {
    const harness = build({ coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }] });
    await drain(harness);
    await drain(harness);
    expect(await asks(harness)).toHaveLength(1);
  });
});

/**
 * 29 — THE CHARGE ON A GUIDANCE DISPATCH IS LABELLED `guidance`, NOT `build`.
 *
 * The pipeline used to derive a non-reviewer's charge stage by elimination:
 * bound and not a reviewer meant the coder, so `repair:`-prefixed meant
 * `repair:build` and everything else meant `build`. True while the coder was
 * the only bound non-review role; ADR-021 made the architect bound too, and a
 * guidance task then took the `build` branch.
 *
 * A charge's CONTENT does not vary by stage, so nothing was withheld from
 * anyone. What was wrong was the name on it, in the one durable record that
 * exists to say which agreement a worker executed under — and a record that
 * says the architect held the coder's charge is a record nobody can audit.
 */
describe('29 - the contract charge names the stage the task actually is', () => {
  it('a guidance dispatch carries stage "guidance", bound to the locked revision', async () => {
    const harness = build({ coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }] });
    await drain(harness);
    const guidanceClaim = harness.store.events()
      .find((event) => event.type === 'task.claimed' && event.taskId === 'guidance:build-1:1:task');
    expect(guidanceClaim, 'the guidance task must have been claimed').toBeDefined();
    // The binding travels on the claim; the stage travels on the charge, and the
    // charge is what the adapter is handed. Both must be present and bound.
    expect(guidanceClaim!.facts.bindingDigest, 'guidance claims under a digest').toBeTruthy();
    expect(guidanceClaim!.facts.contractRevision, 'and under a revision').not.toBeNull();
  });

  /**
   * THE CASE THE FIRST FIX BROKE, and the reason this proof exists.
   *
   * A sub-agent child takes its task type FROM ITS CALLER — `audit`, or
   * anything else — so reading the stage off the task alone returns null and
   * the child loses the charge it executes its parent's contract under. The
   * existing contract-integrity suite caught it; this pins the rule so the
   * narrower version cannot come back.
   */
  it('a task whose type names no stage falls back to its ROLE, never to a prefix', () => {
    expect(boundStageForRole('CODING_AGENT', 'audit')).toBe('build');
    expect(boundStageForRole('CODING_AGENT', 'repair:audit')).toBe('repair:build');
    expect(boundStageForRole('PROMPT_ARCHITECT', 'audit')).toBe('guidance');
    expect(boundStageForRole('PROMPT_ARCHITECT', 'repair:audit')).toBe('repair:guidance');
    // The reviewer's stage comes from reviewStageOf; an unrecognised review
    // type is not guessed at here or anywhere.
    expect(boundStageForRole('INDEPENDENT_REVIEWER', 'audit')).toBeNull();
  });

  it('workStageOf reads the stage off the task and refuses to guess', () => {
    expect(workStageOf('build')).toBe('build');
    expect(workStageOf('repair:build')).toBe('repair:build');
    expect(workStageOf('guidance')).toBe('guidance');
    expect(workStageOf('repair:guidance')).toBe('repair:guidance');
    expect(workStageOf('plan')).toBe('plan');
    expect(workStageOf('repair:plan')).toBe('repair:plan');
    // A review task is not a work stage, and an unknown type is not a guess.
    expect(workStageOf('review:build')).toBeNull();
    expect(workStageOf('something-nobody-declared')).toBeNull();
  });

  /**
   * THE MUTATION THIS CATCHES. Restoring the old elimination — `repair:` ?
   * 'repair:build' : 'build' — makes `guidance` answer `build`, so this
   * assertion is what fails rather than a silent relabel.
   */
  it('no work stage answers with the coder stage unless it IS the coder stage', () => {
    for (const type of ['guidance', 'repair:guidance', 'plan', 'repair:plan']) {
      expect(workStageOf(type), `${type} must not be labelled a coder stage`).not.toBe('build');
      expect(workStageOf(type), `${type} must not be labelled a coder stage`).not.toBe('repair:build');
    }
  });
});

/**
 * 30 — THE FALSIFICATION TEST: "Julius can LOOK continuously supervised while
 * the coder actually runs ahead."
 *
 * This is the proof the whole barrier exists for, and it is written to FAIL if
 * the barrier is behavioural rather than structural. It does not ask whether a
 * checkpoint was recorded — ADR-021's 27 proofs already asserted that, and all
 * 27 passed while the coder was finishing before anyone answered it.
 *
 * It asks about ORDER and about EXISTENCE:
 *
 *   - segment B is dispatched AFTER the guidance that the checkpoint asked for;
 *   - when the guidance is refused, segment B is never dispatched AT ALL.
 *
 * The second is the load-bearing one. A system that merely sequenced work would
 * still run segment B eventually; this one cannot, because segment B is created
 * BLOCKED on the guidance task and `evaluateJuliusRelease` — the only thing in
 * Julius that moves a task out of BLOCKED — releases it solely when that
 * dependency is SUCCEEDED and effectively accepted. Nothing trusts a model to
 * wait; there is simply nothing runnable.
 */
describe('30 - a checkpoint is a barrier, not a note taken afterwards', () => {
  const dispatchOrder = (harness: JuliusHarness): string[] => taskIds(harness);

  it('creates the continuation BLOCKED on the guidance task — the barrier is an edge, not a promise', async () => {
    const harness = build({ coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }] });
    await drain(harness);
    const continuation = harness.store.taskRow('segment:build-1:2:task');
    expect(continuation, 'a continuation segment exists').not.toBeNull();
    expect(continuation!.dependencyIds, 'and it waits on the guidance task')
      .toEqual(['guidance:build-1:1:task']);
    expect(continuation!.parentTaskId).toBe('build-1');
    expect(continuation!.role).toBe('CODING_AGENT');
    // The same kind of work, so no new registration is needed and the charge
    // keeps the subject's own stage.
    expect(continuation!.taskType).toBe('build');
  });

  it('segment B is dispatched only AFTER the guidance it waited for', async () => {
    const harness = build({ coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }] });
    await drain(harness);
    const order = dispatchOrder(harness);
    const guidanceAt = order.indexOf('guidance:build-1:1:task');
    const segmentAt = order.indexOf('segment:build-1:2:task');
    expect(guidanceAt, 'the guidance ran').toBeGreaterThanOrEqual(0);
    expect(segmentAt, 'the continuation ran').toBeGreaterThanOrEqual(0);
    expect(segmentAt, 'segment B must not precede the guidance it asked for').toBeGreaterThan(guidanceAt);
  });

  /**
   * THE ONE THAT WOULD CATCH A FAKE. With the guidance review refusing, the
   * guidance task is never effectively accepted, so the continuation is never
   * released and NEVER DISPATCHES. An implementation that recorded the
   * checkpoint and carried on would dispatch it here.
   */
  it('a refused guidance review means segment B never executes at all', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      // The plan review accepts (so the contract locks); every review after it
      // refuses, which is the guidance review.
      reviewerScript: [{ kind: 'succeed', evidence: PASSED_REVIEW }, { kind: 'succeed', evidence: FAILED_REVIEW }],
    });
    await drain(harness);
    const continuation = harness.store.taskRow('segment:build-1:2:task');
    expect(continuation, 'the continuation was still created').not.toBeNull();
    expect(continuation!.state, 'and it is still BLOCKED').toBe('BLOCKED');
    expect(dispatchOrder(harness), 'segment B must never have been dispatched')
      .not.toContain('segment:build-1:2:task');
  });

  /**
   * AND THE MISSION DOES NOT QUIETLY COMPLETE AROUND IT. A blocked continuation
   * is a non-terminal task, and `targetRunState` completes only when every task
   * is terminal, so a refused guidance cannot be laundered into a finished
   * mission.
   */
  it('a mission with an unreleased continuation cannot reach COMPLETED', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      reviewerScript: [{ kind: 'succeed', evidence: PASSED_REVIEW }, { kind: 'succeed', evidence: FAILED_REVIEW }],
    });
    await drain(harness);
    const run = await harness.store.loadRun('run-1', 'prj-1');
    expect(run?.state, 'the run must not claim completion').not.toBe('COMPLETED');
  });

  /** A coder that asks forever is bounded, and the bound is not the repair bound. */
  it('yielding is bounded by its own ceiling, and spends no repair round', async () => {
    const harness = build({
      // This coder asks at EVERY segment — the loop the barrier made possible.
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }],
      maxRepairRounds: 2,
    });
    await drain(harness, 60);
    const all = await harness.store.tasksForRun('run-1', 'prj-1');
    // CONTINUATIONS ONLY. `startsWith('segment:build-1:')` also matches each
    // continuation's own review task, which counted the reviews as yields and
    // made this bound look twice as loose as it is.
    const segments = all.filter((row) => CONTINUATION.test(row.taskId));
    expect(segments.map((row) => row.taskId), 'continuations are bounded and consecutive')
      .toEqual(['segment:build-1:2:task', 'segment:build-1:3:task', 'segment:build-1:4:task']);
    const ceiling = factsOf(harness, 'checkpoint.verdict')
      .filter((facts) => facts.reasonCode === 'SEGMENT_CEILING_REACHED');
    expect(ceiling, 'and the ceiling is what stopped it').toHaveLength(1);
    expect(ceiling[0]!.segment).toBe(5);
    expect(ceiling[0]!.ceiling).toBe(4);
    const repairs = all.filter((row) => row.taskType.startsWith('repair:') && row.parentTaskId === 'build-1');
    expect(repairs, 'yielding is not repairing').toHaveLength(0);
  });
});

/**
 * PROOF 31 — GOVERNED RESEARCH IS A BARRIER TOO.
 *
 * The gap this closes is the ASK-vs-ANSWER one, one level up. Giving a worker a
 * way to say "I need to look at this" proves nothing on its own: if Julius
 * retrieves the page and hands it to a dispatch that has already finished, the
 * observation is a citation rather than research, and every proof that the
 * worker asked would pass while the property that matters was false.
 *
 * So what is proven here is the ORDER: the asking dispatch ends, the
 * observation exists, and the only place it appears is a continuation that
 * cannot run until the segment that asked has been accepted. The continuation
 * is BLOCKED on its own subject and `evaluateJuliusRelease` — the only thing in
 * Julius that moves a task out of BLOCKED — is what releases it. Nothing trusts
 * a model to wait.
 */
describe('31 - Julius goes and looks before the work that needs the answer', () => {
  const ASKS = Object.freeze([{
    source: 'web', capability: 'read_item',
    reference: 'https://docs.python.org/3/library/asyncio.html',
    purpose: 'Whether asyncio.timeout exists in the pinned interpreter.',
  }]);
  const RESUME = Object.freeze({
    completedSoFar: ['read the journal reader'],
    nextIntent: 'write the normalizer once the interpreter question is settled',
  });

  /** A port that records who asked, and answers with one fenced observation. */
  const port = (over: { signalled?: boolean } = {}) => {
    const served: { role: string; taskId: string; references: string[] }[] = [];
    return {
      served,
      async serve(input: Parameters<NonNullable<Parameters<typeof createJuliusHarness>[0]['research']>['serve']>[0]) {
        served.push({
          role: input.role, taskId: input.taskId,
          references: input.asks.map((ask) => ask.reference),
        });
        return input.asks.map((ask) => ({
          outcome: (over.signalled === true ? 'injection_signaled' : 'observed') as 'observed' | 'injection_signaled',
          reference: ask.reference,
          purpose: ask.purpose,
          rendered: '<<<RELAY-EVIDENCE\nasyncio.timeout landed in 3.11.\nRELAY-EVIDENCE>>>',
          detail: 'The source answered.',
          evidenceId: 'ev-research-1',
          injectionSignals: over.signalled === true ? ['override-previous-instructions'] : [],
          mayCorroborate: over.signalled !== true,
        }));
      },
    };
  };

  it('ends the dispatch at the ask and creates the continuation BLOCKED', async () => {
    const research = port();
    const harness = build({
      research,
      coderScript: [{ kind: 'succeed', researchAsks: ASKS, segmentResume: RESUME }, { kind: 'succeed' }],
    });
    await drain(harness);

    expect(research.served, 'Julius performed the retrieval itself').toHaveLength(1);
    expect(research.served[0]!.role).toBe('CODING_AGENT');
    expect(research.served[0]!.taskId).toBe('build-1');

    const continuation = harness.store.taskRow('segment:build-1:2:task');
    expect(continuation, 'a continuation segment exists').not.toBeNull();
    // THE BARRIER IS AN EDGE. No worker is scheduled, so the only thing to wait
    // on is the segment that asked — and it waits on it.
    expect(continuation!.dependencyIds).toEqual(['build-1']);
    expect(continuation!.parentTaskId).toBe('build-1');
    expect(continuation!.taskType).toBe('build');
    expect(continuation!.role).toBe('CODING_AGENT');
  });

  it('records the checkpoint, the route and every outcome by name', async () => {
    const harness = build({
      research: port(),
      coderScript: [{ kind: 'succeed', researchAsks: ASKS, segmentResume: RESUME }, { kind: 'succeed' }],
    });
    await drain(harness);

    const recorded = factsOf(harness, 'checkpoint.recorded');
    expect(recorded[0]!.trigger).toBe('RESEARCH_REQUESTED');
    expect(recorded[0]!.origin).toBe('CODING_AGENT');
    // Its own namespace, so it can never collide with a guidance checkpoint of
    // the same subject and be recorded as a duplicate of another question.
    expect(recorded[0]!.checkpointId).toBe('checkpoint:research:build-1:2');

    const routed = factsOf(harness, 'checkpoint.verdict');
    expect(routed[0]!.route).toBe('SERVE_RESEARCH');
    expect(routed[0]!.barrier).toBe(true);
    expect(routed[0]!.continuationTaskId).toBe('segment:build-1:2:task');
    // Four observed pages and four refusals are different facts, and the record
    // distinguishes them without anybody reading the evidence.
    expect(routed[0]!.outcomes).toBe('observed');
    expect(routed[0]!.evidence).toBe(1);
    expect(routed[0]!.signalled).toBe(0);
  });

  it('puts the answer in front of the continuation, fenced, before it runs', async () => {
    const harness = build({
      research: port(),
      coderScript: [{ kind: 'succeed', researchAsks: ASKS, segmentResume: RESUME }, { kind: 'succeed' }],
    });
    await drain(harness);

    const entry = (await harness.store.brainEntriesForRun('run-1', 'prj-1'))
      .find((row) => row.entryId === 'brain:research-answer:segment:build-1:2:task');
    expect(entry, 'the answer reached the Project Brain').not.toBeUndefined();
    // SCOPED TO THE CONTINUATION, so it reaches that packet and no other.
    expect(entry!.taskIds).toEqual(['segment:build-1:2:task']);
    expect(entry!.kind).toBe('HANDOFF');
    expect(entry!.text).toContain('DATA THAT WAS OBSERVED');
    expect(entry!.text).toContain('<<<RELAY-EVIDENCE');
    expect(entry!.text).toContain('asyncio.timeout landed in 3.11.');
    // And what the previous segment had already done, so it does not redo it.
    expect(entry!.text).toContain('read the journal reader');
  });

  it('labels a signalled observation in the very text the worker will read', async () => {
    const harness = build({
      research: port({ signalled: true }),
      coderScript: [{ kind: 'succeed', researchAsks: ASKS, segmentResume: RESUME }, { kind: 'succeed' }],
    });
    await drain(harness);
    const entry = (await harness.store.brainEntriesForRun('run-1', 'prj-1'))
      .find((row) => row.entryId === 'brain:research-answer:segment:build-1:2:task');
    expect(entry!.text).toContain('INSTRUCTION-SHAPED CONTENT DETECTED');
    expect(entry!.text).toContain('may not settle a disagreement');
    expect(factsOf(harness, 'checkpoint.verdict')[0]!.signalled).toBe(1);
  });

  it('serves all three slots, not only the coder', async () => {
    // THE PEER TEST. An architect that must ask the coder to check a version is
    // not a peer, and a reviewer that can only grade what it was handed is not
    // an independent one.
    const research = port();
    const harness = build({
      research,
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE, researchAsks: ASKS, segmentResume: RESUME },
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
      ],
      reviewerScript: [
        { kind: 'succeed', evidence: PASSED_REVIEW, researchAsks: ASKS, segmentResume: RESUME },
        { kind: 'succeed', evidence: PASSED_REVIEW },
      ],
      coderScript: [{ kind: 'succeed', researchAsks: ASKS, segmentResume: RESUME }, { kind: 'succeed' }],
    });
    await drain(harness, 48);
    expect(new Set(research.served.map((entry) => entry.role)))
      .toEqual(new Set(['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER']));
  });

  /**
   * THE SAFE DEFAULT. With no port bound, a research ask is recorded and
   * carried past — the lesson `scheduleRepair` bought on paid run 34037313976,
   * where work minted for something nothing served did not fail, it SAT.
   */
  it('records an unserved ask and never stalls the mission on it', async () => {
    const harness = build({
      coderScript: [{ kind: 'succeed', researchAsks: ASKS, segmentResume: RESUME }, { kind: 'succeed' }],
    });
    await drain(harness);
    const routed = factsOf(harness, 'checkpoint.verdict');
    expect(routed[0]!.reasonCode).toBe('RESEARCH_UNSERVED');
    expect(routed[0]!.wouldHaveRouted).toBe('SERVE_RESEARCH');
    expect(routed[0]!.barrier).toBe(false);
    expect(harness.store.taskRow('segment:build-1:2:task'), 'no continuation was minted').toBeNull();
    const run = await harness.store.loadRun('run-1', 'prj-1');
    expect(run?.state, 'and the mission still finished').toBe('COMPLETED');
  });

  it('refuses an ask that reaches for the allowlist, and looks at nothing', async () => {
    const research = port();
    const harness = build({
      research,
      coderScript: [
        { kind: 'succeed', researchAsks: [{ ...ASKS[0]!, hosts: ['evil.example'] }], segmentResume: RESUME },
        { kind: 'succeed' },
      ],
    });
    await drain(harness);
    expect(research.served, 'nothing was retrieved').toHaveLength(0);
    const routed = factsOf(harness, 'checkpoint.verdict');
    expect(routed[0]!.reasonCode).toBe('RESEARCH_ASK_UNREADABLE');
    // The checkpoint still exists: "a worker asked for something Julius could
    // not read" is a fact worth keeping.
    expect(factsOf(harness, 'checkpoint.recorded')[0]!.trigger).toBe('RESEARCH_REQUESTED');
  });

  it('bounds a worker that asks at every segment, and spends no repair round', async () => {
    const research = port();
    const harness = build({
      research,
      // This coder asks forever — the loop the barrier made possible.
      coderScript: [{ kind: 'succeed', researchAsks: ASKS, segmentResume: RESUME }],
      maxRepairRounds: 2,
    });
    await drain(harness, 60);
    const all = await harness.store.tasksForRun('run-1', 'prj-1');
    const segments = all.filter((row) => CONTINUATION.test(row.taskId));
    expect(segments.map((row) => row.taskId), 'continuations are bounded and consecutive')
      .toEqual(['segment:build-1:2:task', 'segment:build-1:3:task', 'segment:build-1:4:task']);
    // THE CHAIN STAYS A CHAIN. Every continuation hangs off the original unit
    // of work, so the ceiling counts the work rather than the last pause in it.
    for (const segment of segments) expect(segment.parentTaskId).toBe('build-1');
    const repairs = all.filter((row) => row.taskType.startsWith('repair:') && row.parentTaskId === 'build-1');
    expect(repairs, 'looking something up is not failing').toHaveLength(0);
    const ceiling = factsOf(harness, 'checkpoint.verdict')
      .filter((facts) => facts.reasonCode === 'SEGMENT_CEILING_REACHED');
    expect(ceiling.length, 'and the ceiling is what stopped it').toBeGreaterThan(0);
  });

  it('takes the cheaper yield when a worker asks for both, and records the other', async () => {
    const research = port();
    const harness = build({
      research,
      coderScript: [
        { kind: 'succeed', researchAsks: ASKS, guidanceRequest: REQUEST, segmentResume: RESUME },
        { kind: 'succeed' },
      ],
    });
    await drain(harness);
    // One continuation, not two colliding on the same segment number.
    expect(harness.store.taskRow('segment:build-1:2:task')).not.toBeNull();
    expect(harness.store.taskRow('guidance:build-1:1:task'), 'no architect turn was spent').toBeNull();
    // And the record says what the worker also wanted.
    expect(factsOf(harness, 'guidance.deferred')[0]!.reasonCode).toBe('RESEARCH_YIELD_TOOK_THE_SEGMENT');
  });
});
