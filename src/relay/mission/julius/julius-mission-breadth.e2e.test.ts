import { describe, expect, it } from 'vitest';

import { reviewChargeFor } from './julius-review-stage';
import { JuliusRunLoop } from './julius-run-loop';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import type { JuliusBrainEntry } from './julius-runtime';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * JULIUS IS NOT A CODING-ONLY AGENT, AND THIS IS WHERE THAT IS TRUE OR FALSE.
 *
 * The MVP asks for breadth: software development, game development, professional
 * work, and ordinary multi-step digital tasks. Every existing end-to-end proof in
 * this repository drives a CODE mission — a diff, a test command, a suite that
 * goes green — so "the mission lifecycle is general" was an architectural claim
 * with no mission behind it.
 *
 * WHAT THE AUDIT FOUND, and it is smaller than it looked. A non-code mission does
 * not need a new stage, a new role or a new evidence vocabulary: its deliverable
 * is a FILE, so it produces a real diff of real bytes and travels the ordinary
 * `build` path. `requiredChecks` may be empty — the contract's own comment says
 * empty is honest for a task with no commands — and `requiredEvidence` is
 * mission-supplied, so a research mission requires `ARTIFACT` where a code
 * mission requires `TEST`.
 *
 * ONE THING WAS GENUINELY IN THE WAY. The implementation rubric's fourth judge
 * read "Is the test evidence sufficient to prove the criteria?", which would have
 * had a reviewer reject a correct report for lacking something its contract never
 * asked for. It now asks about the evidence THE CONTRACT requires, which is
 * rendered into the review prompt verbatim.
 *
 * So these cases are the breadth evidence: a professional-work mission and a
 * game-development mission, each carried to verified completion through the real
 * run loop, with no tests in one of them and no code in either.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'], providerId: 'openai', adapterId: 'architect-adapter',
});
const WORKER_SLOT = worker({
  workerId: 'worker', role: 'CODING_AGENT',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], providerId: 'anthropic', adapterId: 'worker-adapter',
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER',
  capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
  providerId: 'hermes', adapterId: 'reviewer-adapter',
});

const scope = { projectId: 'prj-1' };
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const ALL_ROLES: JuliusBrainEntry['allowedRoles'] = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'];
const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] };
const REVIEW_ACCEPT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] };

interface Mission {
  readonly objective: string;
  /** What the worker produces, and the evidence type that proves it exists. */
  readonly deliverable: { readonly evidence: string; readonly summary: string };
  /** What the mission requires before it may be accepted. NOT necessarily TEST. */
  readonly requiredEvidence: readonly string[];
  readonly criterion: string;
}

/**
 * ONE MISSION, ANY DOMAIN. Nothing below is parameterised by "code" or "not
 * code": the difference between the two missions is the objective text, the
 * evidence type the contract requires, and what the worker says it produced.
 */
function build(mission: Mission, reviewer = [REVIEW_ACCEPT, REVIEW_ACCEPT, REVIEW_ACCEPT]): JuliusHarness {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [PLAN_OK, PLAN_OK] },
      { worker: WORKER_SLOT, script: [{
        kind: 'succeed',
        evidence: [{ type: mission.deliverable.evidence, status: 'PASSED', safeSummary: mission.deliverable.summary }],
      }] },
      { worker: REVIEWER, script: reviewer },
    ],
    card: cardPolicy({
      allowedProviders: ['openai', 'anthropic', 'hermes'],
      capabilities: ['plan', 'implement', 'review'], concurrency: 1,
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'work-1' });
  harness.store.seedTask('run-1', task({
    taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'],
  }));
  harness.store.seedTask('run-1', task({
    taskId: 'work-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: ['plan-1'],
    // THE MISSION DECIDES WHAT PROVES IT. A report mission requires ARTIFACT
    // where a code mission requires TEST, and the runtime demands neither.
    requiredEvidenceTypes: mission.requiredEvidence as never,
  }));
  harness.store.seedCriteria('run-1', [
    { criterionId: 'AC-1', description: mission.criterion, requiredEvidenceTypes: [] },
  ]);
  harness.store.seedBrain('run-1', [{
    entryId: 'brain:objective', kind: 'OBJECTIVE', text: mission.objective,
    taskIds: [], allowedRoles: ALL_ROLES, sensitivity: 'INTERNAL',
    provenance: { workerId: 'founder', recordedAt: '2026-09-27T09:00:00.000Z', evidenceIds: [] },
  }]);
  return harness;
}

async function drain(loop: JuliusRunLoop, maxTicks = 24): Promise<number> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if ((await loop.tick(scope)).claimed === 0) return tick;
  }
  return maxTicks;
}

/** CATEGORY C — professional work. No code, no tests, a document as the result. */
const RESEARCH: Mission = {
  objective: 'Compare the three deployment options for the beta and recommend one, with the reasoning written down.',
  deliverable: { evidence: 'ARTIFACT', summary: 'recommendation.md written: three options compared, one recommended.' },
  requiredEvidence: ['ARTIFACT'],
  criterion: 'A written recommendation exists and states why the other two options were rejected.',
};

/** CATEGORY B — game development. Code-adjacent, but the deliverable is a data file. */
const GAME_TOOLING: Mission = {
  objective: 'Retune the Relay Dog idle animation blend so the transition no longer pops, and record the values used.',
  deliverable: { evidence: 'ARTIFACT', summary: 'blend values updated in the animation data and recorded.' },
  requiredEvidence: ['ARTIFACT'],
  criterion: 'The blend transition values are changed and the chosen values are written down.',
};

/**
 * CATEGORY E — A USEFUL EVERYDAY TASK, of the kind the founder named fourth:
 * "useful everyday / basic-necessity tasks that available tools can actually
 * perform safely".
 *
 * THE SAFETY CLAUSE IS THE INTERESTING PART, and it is why this mission's
 * deliverable is a DOCUMENT rather than an action. Julius's tools today read and
 * write files through an executor; nothing in this repository can place an order,
 * send a message or move money, and a mission whose acceptance depended on one of
 * those would be a mission Julius cannot honestly complete. So the everyday task
 * Julius can do NOW is the preparation: the plan, the list, the comparison a
 * person then acts on. That is a real deliverable, and pretending otherwise —
 * scripting a fake "order placed" — is exactly the laundering this suite exists
 * to refuse.
 */
const EVERYDAY: Mission = {
  objective: 'Plan the week’s meals for two people under £60, using what is already in the cupboard, and write the shopping list that follows from it.',
  deliverable: { evidence: 'ARTIFACT', summary: 'meal-plan.md and shopping-list.md written: seven dinners, £57.40, cupboard items excluded.' },
  requiredEvidence: ['ARTIFACT'],
  criterion: 'A seven-day plan and a shopping list exist, the list totals under the stated budget, and nothing already in the cupboard is on it.',
};

describe('the mission lifecycle carries work that is not code', () => {
  it('completes a professional-work mission with no tests and no test evidence', async () => {
    const harness = build(RESEARCH);
    await drain(harness.loop);

    const run = await harness.store.loadRun('run-1', 'prj-1');
    expect(run?.state, 'a research mission must be able to reach verified completion').toBe('COMPLETED');

    // THE EVIDENCE IS THE MISSION'S OWN, and there is no TEST row anywhere.
    const evidence = await harness.store.evidenceForRun('run-1', 'prj-1');
    expect(evidence.some((item) => item.type === 'ARTIFACT' && item.taskId === 'work-1'),
      'the deliverable is recorded as the mission asked').toBe(true);
    expect(evidence.filter((item) => item.type === 'TEST'),
      'and nothing invented a test to satisfy a rubric').toEqual([]);

    // Julius accepted it: the completion is a recorded decision, not an absence.
    const decisions = await harness.store.decisionsForRun('run-1', 'prj-1');
    expect(decisions.some((decision) => decision.action === 'ACCEPT' && decision.taskId === 'work-1')).toBe(true);
  });

  it('completes a game-development mission through the same lifecycle, unchanged', async () => {
    const harness = build(GAME_TOOLING);
    await drain(harness.loop);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');
    // The same three slots, the same stages, the same contract machinery. The
    // domain changed and the runtime did not.
    const dispatched = new Set(harness.store.trajectory()
      .filter((event) => event.kind === 'DISPATCH' && event.outcome === 'COMPLETED')
      .map((event) => event.workerId));
    expect(dispatched).toEqual(new Set(['architect', 'worker', 'reviewer']));
  });

  it('completes an everyday practical mission — the fourth class, and no code anywhere in it', async () => {
    // The founder's four mission classes are software, game, professional and
    // everyday. Three had rows; this is the fourth, and it exercises the same
    // lifecycle with the same rules: a plan, a deliverable, an independent
    // review, a verified completion. Nothing about the runtime knows or cares
    // that the artifact is a shopping list.
    const harness = build(EVERYDAY);
    await drain(harness.loop);
    const run = await harness.store.loadRun('run-1', 'prj-1');
    expect(run!.state, 'a household task completes through the same loop as a refactor').toBe('COMPLETED');
    const evidence = await harness.store.evidenceForRun('run-1', 'prj-1');
    expect(evidence.filter((item) => item.type === 'TEST'), 'no test was invented for a task that has none').toEqual([]);
    expect(evidence.some((item) => item.type === 'ARTIFACT' && item.safeSummary.includes('shopping-list.md')),
      'the deliverable itself is the evidence').toBe(true);
    // AND THE REVIEWER JUDGED IT: a completion without an independent review is
    // the failure mode this whole lane exists to prevent, in every class.
    expect(evidence.some((item) => item.type === 'REVIEW_FINDING' && item.status === 'PASSED')).toBe(true);
  });

  it('refuses to complete an everyday mission whose acceptance needs an action no tool can take', async () => {
    // THE HONEST LIMIT, ASSERTED RATHER THAN DESCRIBED. "Order the groceries" is
    // not a deliverable Julius can produce: no tool in this repository places an
    // order, so the criterion can never be satisfied by any evidence a worker
    // could bring. The mission must park unverified rather than complete on a
    // document that claims the order was placed — which is what a laundered
    // completion would look like.
    const ORDERING: Mission = {
      objective: 'Order the week’s groceries from the shop and confirm the delivery slot.',
      deliverable: { evidence: 'ARTIFACT', summary: 'order-draft.md written: basket contents and the slot to choose.' },
      // The contract demands proof of an ACTION — a tool receipt — and no tool here produces one.
      requiredEvidence: ['TOOL_RESULT'],
      criterion: 'The groceries are ordered and a delivery slot is confirmed by the shop.',
    };
    const harness = build(ORDERING);
    await drain(harness.loop);
    const run = await harness.store.loadRun('run-1', 'prj-1');
    expect(run!.state, 'a mission whose evidence cannot exist must not complete').not.toBe('COMPLETED');
    const evidence = await harness.store.evidenceForRun('run-1', 'prj-1');
    expect(evidence.some((item) => item.type === 'TOOL_RESULT'), 'and no worker invented the receipt').toBe(false);
  });

  it('still repairs a non-code mission when the reviewer rejects it', async () => {
    // THE LOOP THAT MATTERS MOST, in a domain with no tests: a rejected report
    // must come back as repair work rather than as a completion.
    const REJECT = {
      kind: 'succeed' as const,
      evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The recommendation gives no reason for rejecting option two.' }],
    };
    const harness = build(RESEARCH, [REJECT, REVIEW_ACCEPT, REVIEW_ACCEPT, REVIEW_ACCEPT]);
    await drain(harness.loop);

    const findings = await harness.store.findingsForRun('run-1', 'prj-1');
    expect(findings.filter((finding) => finding.blocking).length,
      'a rejected document is a blocking finding like any other').toBeGreaterThan(0);
    const decisions = await harness.store.decisionsForRun('run-1', 'prj-1');
    expect(decisions.some((decision) => decision.action === 'REPAIR'),
      'and it produces repair work, not a false completion').toBe(true);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state,
      'a mission whose finding was never answered must not read as completed')
      .not.toBe('COMPLETED');
  });

  /**
   * THE RUBRIC ITSELF, held to the generality the MVP requires. This is the
   * structural half of the case above: the implementation review must not demand
   * a TEST by name, or a correct report is rejected for lacking one.
   */
  it('judges an implementation on the evidence its contract requires, not on tests', () => {
    for (const stage of ['build', 'repair:build'] as const) {
      const judges = reviewChargeFor(stage).judges.join(' ').toLowerCase();
      expect(judges, `${stage} must ask about the contract's required evidence`)
        .toContain('the evidence the contract requires');
      expect(judges, `${stage} must not demand a test by name`).not.toContain('test evidence');
    }
    // And the demand is not softened away: the rubric still insists the evidence
    // be sufficient to prove the criteria.
    expect(reviewChargeFor('build').judges.join(' ')).toContain('sufficient to prove the criteria');
  });

  /**
   * WHAT IS STILL CODE-SHAPED, recorded rather than papered over. An
   * implementation review requires a `diff`, which a file-producing mission
   * satisfies because its deliverable IS a file. A mission whose result is not a
   * file at all — a message sent, a form submitted, a booking made — has no diff
   * to show, and nothing in this repository can carry one yet. That is a real
   * limit on the fourth MVP category and it is named here rather than implied.
   */
  it('names the limit: an implementation review still requires a diff', () => {
    expect([...reviewChargeFor('build').requires]).toEqual(['plan', 'diff']);
    expect([...reviewChargeFor('plan').requires],
      'a planning review needs no diff, which is why research missions plan freely')
      .toEqual(['plan']);
  });
});
