import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { foldJuliusArchitecture } from './julius-architecture-state';
import { juliusArchitectureCheckTaskId, juliusArchitectureTriggerId } from './julius-architecture-drift';
import { createJuliusMemoryStore } from './julius-memory-store';
import { readJuliusPeerChannel } from './julius-peer-runtime';
import { prepareClaimedTask, runClaimedTask, type JuliusPipelineRequest } from './julius-task-pipeline';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * THE CODING AGENT AS A SUSTAINED PEER.
 *
 * Two things the implementation slot lacked beside the architect and the
 * reviewer: a state a durable fact can establish, and a way to say the design
 * failed under real code without being able to change the design. Both are
 * proven here through the real pipeline, reading only the rows the run wrote.
 *
 * Provider-free: every worker answers from a script.
 */

type Step = Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number];

const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const FAILED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'NULL renders as the literal word.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
const PASS: Step = { kind: 'succeed', evidence: PASSED_REVIEW };
const PASSES = (count: number): readonly Step[] => Array.from({ length: count }, () => PASS);

const ARCHITECTURE = {
  components: [{ name: 'normalizer', responsibility: 'Turns a journal page into rows.' }],
  boundaries: [{ name: 'JournalReader', kind: 'INTERFACE', contract: 'peek() may return fewer bytes.', locator: 'src/relay/journal.ts' }],
  dependencies: [], decisions: [],
  assumptions: [{ assumptionId: 'A-1', claim: 'The 8KiB boundary is a requirement.', state: 'UNVERIFIED', evidenceRefs: [] }],
  openQuestions: [], risks: [],
};
const MOVED = {
  ...ARCHITECTURE,
  boundaries: [{ name: 'JournalReader', kind: 'SCHEMA', contract: 'rows are fixed width now', locator: 'src/relay/journal.ts' }],
};
const ALIGNED = { assessment: 'ALIGNED', claim: 'What was built matches the design.', drift: [], driftingTaskIds: [], evidenceRefs: [] };
const DRIFTED = {
  assessment: 'DRIFT_REQUIRES_REPAIR', claim: 'The reader still assumes variable-width rows.',
  drift: [{ kind: 'SCHEMA', name: 'JournalRow', claim: 'Fixed width was built; the design says variable.' }],
  driftingTaskIds: ['build-1'], evidenceRefs: ['src/relay/journal.ts:120'],
};
const PLAN_WITH_ARCHITECTURE: Step = { kind: 'succeed', evidence: PLAN_EVIDENCE, architecture: ARCHITECTURE };
const CONSULT_ALIGNED: Step = { kind: 'succeed', evidence: PLAN_EVIDENCE, architecture: ARCHITECTURE, consistency: ALIGNED };

const INVALIDATED = Object.freeze({
  kind: 'ASSUMPTION_INVALIDATED', subject: 'A-1',
  claim: 'peek() returned a full page on every read; the boundary is not a requirement.',
  evidenceRefs: ['src/relay/journal.ts:40', 'test output: journal.test.ts > reads a full page'],
});

const REQUEST = Object.freeze({
  question: 'The journal reader already buffers — should the normalizer reuse it?',
  blockedOn: ['the 8KiB boundary case'], attempted: ['a second buffer'], relevantPaths: ['src/relay/persistence/journal.ts'],
});
const GUIDANCE = Object.freeze({
  subObjective: 'Reuse the existing reader rather than adding a second buffer.',
  relevantRequirements: ['R1'], relevantConstraints: ['no new dependency'],
  repositoryFindings: ['journal.ts already buffers at the same boundary'], runtimeFindings: [],
  references: [{ kind: 'REPOSITORY', locator: 'src/relay/persistence/journal.ts:120', retrievedAt: '2026-09-10T20:59:00.000Z', trust: 'CORROBORATED' }],
  recommendedActions: ['call the existing reader'], additionalProhibitions: [], affectedCriterionIds: [], unresolvedQuestions: [],
});

const build = (scripts: { architect: readonly Step[]; coder: readonly Step[]; reviewer: readonly Step[] }): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      {
        worker: worker({
          workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter', capabilities: ['plan'],
          taskTypes: ['plan', 'repair:plan', 'architecture', 'guidance', 'repair:guidance'],
        }),
        script: scripts.architect,
      },
      {
        worker: worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] }),
        script: scripts.coder,
      },
      {
        worker: worker({
          workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter', capabilities: ['review'],
          taskTypes: ['review:plan', 'review:build', 'review:architecture', 'review:guidance', 'review:repair:plan', 'review:repair:build', 'review:repair:guidance'],
        }),
        script: scripts.reviewer,
      },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
  return harness;
};

async function step(harness: JuliusHarness): Promise<boolean> {
  const report = await harness.loop.tick({ projectId: 'prj-1' });
  if (report.claimed > 0) return true;
  const advance = await harness.loop.advanceRun('run-1', 'prj-1');
  return advance !== null && (advance.changed || advance.resumedVerifications > 0);
}
async function drain(harness: JuliusHarness, ticks = 64): Promise<void> {
  for (let index = 0; index < ticks; index += 1) if (!(await step(harness))) break;
}

const rows = (harness: JuliusHarness) => harness.store.events().map((event) => ({ type: event.type, facts: event.facts, taskId: event.taskId }));
const rowsOf = (harness: JuliusHarness, type: string) => rows(harness).filter((row) => row.type === type);
const factsOf = (harness: JuliusHarness, type: string) => rowsOf(harness, type).map((row) => row.facts);
const stateOf = async (harness: JuliusHarness) => (await harness.store.loadRun('run-1', 'prj-1'))!.state;
const view = async (harness: JuliusHarness) => readJuliusPeerChannel({
  timeline: harness.store, tasks: await harness.store.tasksForRun('run-1', 'prj-1'), runId: 'run-1', projectId: 'prj-1',
});
const coderTaskIds = async (harness: JuliusHarness) =>
  new Set((await harness.store.tasksForRun('run-1', 'prj-1')).filter((item) => item.role === 'CODING_AGENT').map((item) => item.taskId));

/* ------------------------------------------------------------------ observations */

describe('P27 — a coder that sees the design fail under real code says so, and Julius decides', () => {
  it('an evidenced invalidated assumption consults the architect mid-mission, about the work that saw it', async () => {
    const harness = build({
      architect: [PLAN_WITH_ARCHITECTURE, CONSULT_ALIGNED, CONSULT_ALIGNED],
      coder: [{ kind: 'succeed', evidence: BUILD_EVIDENCE, architectureObservations: [INVALIDATED] }],
      reviewer: PASSES(6),
    });
    await drain(harness);

    const observed = rowsOf(harness, 'architecture.observed');
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      taskId: 'build-1',
      facts: {
        revision: 1, kind: 'ASSUMPTION_INVALIDATED', subject: 'A-1', claim: INVALIDATED.claim,
        evidenceRefs: INVALIDATED.evidenceRefs.join('\n'), evidenceRefCount: 2, observedByRole: 'CODING_AGENT',
      },
    });
    const triggerId = juliusArchitectureTriggerId('CONTRADICTING_EVIDENCE', 1, 'build-1');
    const raised = factsOf(harness, 'architecture.trigger.raised');
    expect(raised.find((facts) => facts.trigger === 'CONTRADICTING_EVIDENCE')).toMatchObject({
      triggerId, subjectTaskId: 'build-1', reasonCode: 'coder_observed_assumption_invalidated', served: true,
      servedByTaskId: juliusArchitectureCheckTaskId('run-1', triggerId),
    });
    // Julius, not the coder, minted the consultation — and it is the architect's.
    const check = harness.store.taskRow(juliusArchitectureCheckTaskId('run-1', triggerId))!;
    expect(check).toMatchObject({ role: 'PROMPT_ARCHITECT', taskType: 'architecture', parentTaskId: 'build-1', state: 'SUCCEEDED' });
    // Consulted before the end of the run: the mid-mission check was assessed before the completion check was raised.
    const log = rows(harness);
    const midAssessed = log.findIndex((row) => row.type === 'architecture.assessed' && row.facts.assessedByTaskId === check.taskId);
    const completionRaised = log.findIndex((row) => row.type === 'architecture.trigger.raised' && row.facts.trigger === 'PRE_COMPLETION_CHECK');
    expect(midAssessed).toBeGreaterThan(-1);
    expect(completionRaised).toBeGreaterThan(midAssessed);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it('the observation changes no architecture: every revision on the record was the architect\'s', async () => {
    const harness = build({
      architect: [PLAN_WITH_ARCHITECTURE, CONSULT_ALIGNED, CONSULT_ALIGNED],
      coder: [{
        kind: 'succeed', evidence: BUILD_EVIDENCE,
        architectureObservations: [INVALIDATED, { kind: 'REPLAN_SUGGESTED', subject: 'normalizer', claim: 'Split the reader out.', evidenceRefs: ['src/relay/journal.ts:1'] }],
      }],
      reviewer: PASSES(6),
    });
    await drain(harness);

    const coders = await coderTaskIds(harness);
    for (const type of ['architecture.recorded', 'architecture.proposed', 'architecture.accepted', 'architecture.assessed']) {
      for (const row of rowsOf(harness, type)) {
        expect(coders.has(String(row.taskId)), `${type} from ${String(row.taskId)}`).toBe(false);
        for (const key of ['proposedByTaskId', 'assessedByTaskId']) {
          if (row.facts[key] !== undefined) expect(coders.has(String(row.facts[key])), `${type}.${key}`).toBe(false);
        }
      }
    }
    const design = foldJuliusArchitecture(rows(harness))!;
    expect(design.revision).toBe(1);
    expect(design.proposedByTaskId).toBe('plan-1');
    expect(design.assumptions.map((assumption) => `${assumption.assumptionId}:${assumption.state}`)).toEqual(['A-1:UNVERIFIED']);
    expect(factsOf(harness, 'architecture.trigger.raised').map((facts) => facts.trigger).sort())
      .toEqual(['CONTRADICTING_EVIDENCE', 'JULIUS_REPLAN_REQUEST', 'PRE_COMPLETION_CHECK']);
  });

  it('a coder carrying a revision or an assessment is refused both by name, and the design in force does not move', async () => {
    const harness = build({
      architect: [PLAN_WITH_ARCHITECTURE, CONSULT_ALIGNED],
      coder: [{ kind: 'succeed', evidence: BUILD_EVIDENCE, architecture: MOVED, consistency: DRIFTED }],
      reviewer: PASSES(4),
    });
    await drain(harness);

    expect(factsOf(harness, 'worker.channel.refused').filter((facts) => facts.role === 'CODING_AGENT').map((facts) => facts.channel).sort())
      .toEqual(['architecture', 'consistency']);
    expect(rowsOf(harness, 'architecture.proposed')).toEqual([]);
    expect(rowsOf(harness, 'architecture.recorded').map((row) => row.taskId)).toEqual(['plan-1']);
    expect(foldJuliusArchitecture(rows(harness))!.boundaries[0]!.kind).toBe('INTERFACE');
    expect(factsOf(harness, 'architecture.assessed').every((facts) => facts.assessment === 'ALIGNED')).toBe(true);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it.each([
    ['no evidence', [{ ...INVALIDATED, evidenceRefs: [] }], 'coder_observation_unevidenced'],
    ['an assumption the design never made', [{ ...INVALIDATED, subject: 'A-9' }], 'coder_observation_names_unknown_assumption'],
    ['a Julius-only outcome', [{ ...INVALIDATED, status: 'VERIFIED' }], 'peer_response_mints_julius_only_outcome'],
    ['a widened scope', [{ ...INVALIDATED, permittedPaths: ['src/'] }], 'peer_response_mutates_protected_term'],
  ])('an observation with %s is refused by name, consults nobody, and completes nothing', async (_label, value, reasonCode) => {
    const harness = build({
      architect: [PLAN_WITH_ARCHITECTURE, CONSULT_ALIGNED],
      coder: [{ kind: 'succeed', evidence: BUILD_EVIDENCE, architectureObservations: value }],
      reviewer: PASSES(4),
    });
    await drain(harness);

    expect(rowsOf(harness, 'architecture.observation.refused')).toEqual([
      expect.objectContaining({ taskId: 'build-1', facts: expect.objectContaining({ reasonCode }) }),
    ]);
    expect(rowsOf(harness, 'architecture.observed')).toEqual([]);
    expect(factsOf(harness, 'architecture.trigger.raised').map((facts) => facts.trigger)).toEqual(['PRE_COMPLETION_CHECK']);
    // The mission still ends, and ends by Julius's decision on the reviewed work — not by what the coder said.
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it('with no design in force there is nothing to observe: refused, and nobody is consulted', async () => {
    const harness = build({
      architect: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }],
      coder: [{ kind: 'succeed', evidence: BUILD_EVIDENCE, architectureObservations: [INVALIDATED] }],
      reviewer: PASSES(3),
    });
    await drain(harness);
    expect(factsOf(harness, 'architecture.observation.refused').map((facts) => facts.reasonCode)).toEqual(['coder_observations_without_architecture']);
    expect(rowsOf(harness, 'architecture.trigger.raised')).toEqual([]);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it('only the implementation peer has the channel: an architect or a reviewer using it is refused, and nothing is observed', async () => {
    const harness = build({
      architect: [{ ...PLAN_WITH_ARCHITECTURE, architectureObservations: [INVALIDATED] } as Step, CONSULT_ALIGNED],
      coder: [{ kind: 'succeed', evidence: BUILD_EVIDENCE }],
      reviewer: [PASS, { ...PASS, architectureObservations: [INVALIDATED] } as Step, PASS, PASS],
    });
    await drain(harness);

    expect(factsOf(harness, 'worker.channel.refused').filter((facts) => facts.channel === 'architectureObservations').map((facts) => facts.role).sort())
      .toEqual(['INDEPENDENT_REVIEWER', 'PROMPT_ARCHITECT']);
    expect(rowsOf(harness, 'architecture.observed')).toEqual([]);
    expect(rowsOf(harness, 'architecture.observation.refused')).toEqual([]);
    expect(factsOf(harness, 'architecture.trigger.raised').map((facts) => facts.trigger)).toEqual(['PRE_COMPLETION_CHECK']);
  });

  it('read again on every later advance, and after a restart, an observation consults the architect once', async () => {
    const harness = build({
      architect: [PLAN_WITH_ARCHITECTURE, CONSULT_ALIGNED, CONSULT_ALIGNED],
      coder: [{ kind: 'succeed', evidence: BUILD_EVIDENCE, architectureObservations: [INVALIDATED, { ...INVALIDATED, claim: 'Said again, differently.' }] }],
      reviewer: PASSES(6),
    });
    await drain(harness);
    harness.store.restart();
    for (let index = 0; index < 4; index += 1) await harness.loop.advanceRun('run-1', 'prj-1');

    expect(rowsOf(harness, 'architecture.observed')).toHaveLength(2);
    const contradicting = factsOf(harness, 'architecture.trigger.raised').filter((facts) => facts.trigger === 'CONTRADICTING_EVIDENCE');
    expect(contradicting).toHaveLength(1);
    expect((await harness.store.tasksForRun('run-1', 'prj-1')).filter((item) => item.taskType === 'architecture')).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ derived state */

describe('P28 — what the Coding Agent is doing is derived from the record, at every tick', () => {
  const walk = async (harness: JuliusHarness): Promise<readonly string[]> => {
    const states: string[] = [];
    for (let index = 0; index < 64; index += 1) {
      const live = await view(harness);
      const rebuilt = createJuliusMemoryStore();
      rebuilt.seedRun(RUN);
      for (const row of JSON.parse(JSON.stringify(await harness.store.tasksForRun('run-1', 'prj-1')))) rebuilt.seedTask('run-1', row);
      for (const event of JSON.parse(JSON.stringify(harness.store.events()))) await rebuilt.appendEvent(event);
      const reconstructed = await readJuliusPeerChannel({ timeline: rebuilt, tasks: await rebuilt.tasksForRun('run-1', 'prj-1'), runId: 'run-1', projectId: 'prj-1' });
      expect(reconstructed!.codingAgent, `tick ${String(index)}: rebuilt from exported rows`).toBe(live!.codingAgent);
      if (states.at(-1) !== live!.codingAgent) states.push(live!.codingAgent);
      if (!(await step(harness))) break;
    }
    return states;
  };

  it('a guided mission: waits on its dependency, implements, waits on guidance, implements again, hands off, stands by', async () => {
    const harness = build({
      architect: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }, { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE }],
      coder: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed', evidence: BUILD_EVIDENCE }],
      reviewer: PASSES(4),
    });
    const states = await walk(harness);
    const order = (state: string) => states.indexOf(state);
    expect(states[0]).toBe('WAITING_ON_DEPENDENCY');
    expect(order('IMPLEMENTING')).toBeGreaterThan(order('WAITING_ON_DEPENDENCY'));
    expect(order('WAITING_ON_GUIDANCE')).toBeGreaterThan(order('IMPLEMENTING'));
    expect(states.lastIndexOf('IMPLEMENTING'), 'resumed with its answer').toBeGreaterThan(order('WAITING_ON_GUIDANCE'));
    expect(states.lastIndexOf('HANDING_OFF')).toBeGreaterThan(states.lastIndexOf('IMPLEMENTING'));
    expect(states.at(-1)).toBe('STANDBY');
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it('a repaired mission: repairs between two hand-offs', async () => {
    const harness = build({
      architect: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }],
      coder: [{ kind: 'succeed', evidence: BUILD_EVIDENCE }, { kind: 'succeed', evidence: BUILD_EVIDENCE }],
      reviewer: [PASS, { kind: 'succeed', evidence: FAILED_REVIEW }, PASS],
    });
    const states = await walk(harness);
    const repairing = states.indexOf('REPAIRING');
    expect(repairing).toBeGreaterThan(-1);
    expect(states.indexOf('HANDING_OFF')).toBeLessThan(repairing);
    expect(states.lastIndexOf('HANDING_OFF')).toBeGreaterThan(repairing);
    expect(states.at(-1)).toBe('STANDBY');
  });

  it('a coder whose work failed with nothing to replace it is BLOCKED, not standing by', async () => {
    const harness = build({
      architect: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }],
      coder: [{ kind: 'fail', code: 'WORKER_EXECUTION_FAILURE', runtimeStarted: true }],
      reviewer: PASSES(2),
    });
    const states = await walk(harness);
    expect(states.at(-1)).toBe('BLOCKED');
    expect(harness.store.taskRow('build-1')!.state).toBe('FAILED');
  });
});

/* ------------------------------------------------------------------ duplicate replay */

describe('P27b — the same result delivered twice is read once', () => {
  it('a replayed attempt records its implementation and its observations exactly once', async () => {
    const implementation = {
      providerKind: 'generic-scripted',
      workspace: { captured: true, truncated: false, changes: [{ path: 'src/relay/journal.ts', change: 'MODIFIED' }] },
    };
    const harness = build({
      architect: [PLAN_WITH_ARCHITECTURE, CONSULT_ALIGNED, CONSULT_ALIGNED],
      coder: [{ kind: 'succeed', evidence: BUILD_EVIDENCE, implementation, architectureObservations: [INVALIDATED] }],
      reviewer: PASSES(6),
    });
    // Drive until the build is released and nothing else is waiting to be claimed.
    for (let index = 0; index < 32 && harness.store.taskRow('build-1')!.state !== 'RUNNABLE'; index += 1) {
      const report = await harness.loop.tick({ projectId: 'prj-1' });
      if (report.claimed === 0) await harness.loop.advanceRun('run-1', 'prj-1');
    }
    expect(harness.store.taskRow('build-1')!.state).toBe('RUNNABLE');

    const now = harness.clock.now();
    const [claim] = await harness.store.claimRunnable({
      owner: harness.deps.owner, now, leaseExpiresAt: new Date(Date.parse(now) + 60_000).toISOString(), limit: 1, projectId: 'prj-1',
    });
    expect(claim!.taskId).toBe('build-1');
    const run = (await harness.store.loadRun('run-1', 'prj-1'))!;
    const policy = (await harness.policies.policyFor(run))!;
    const request: JuliusPipelineRequest = {
      claim: claim!, policy: policy.card, verification: policy.verification,
      capability: harness.policies.capabilityFor(claim!), capabilityFor: (value) => harness.policies.capabilityFor(value),
    };
    const preflight = await prepareClaimedTask(request, harness.deps, { projectId: 'prj-1' });
    if (preflight.kind !== 'ELIGIBLE') throw new Error(`not eligible: ${preflight.kind}`);
    const attempt = await harness.store.admitTask({ taskId: 'build-1', owner: harness.deps.owner, leaseGeneration: claim!.leaseGeneration, now: harness.clock.now() });
    if (typeof attempt !== 'number') throw new Error('not admitted');
    const admitted = { ...request, claim: { ...request.claim, attempt } };

    await runClaimedTask(admitted, harness.deps, preflight);
    // The process delivers the same attempt again — a redelivery after a crash, a retried handler.
    await runClaimedTask(admitted, harness.deps, preflight).catch(() => undefined);

    // THE REPLAY STOPS AT THE HANDOFF ((a2)). It used to reach the provider a second time and have its
    // answer read as a duplicate; the lease-fenced handoff now refuses it, because the attempt it
    // redelivers no longer owns an ACTIVE task. One provider call, one handoff, and still one record.
    const coder = harness.adapters.get('coder-adapter') as unknown as { dispatches: readonly { taskId: string }[] };
    expect(coder.dispatches.filter((dispatch) => dispatch.taskId === 'build-1'), 'the replay called no provider').toHaveLength(1);
    expect(harness.store.events().filter((event) => event.type === 'worker.dispatched' && event.taskId === 'build-1'), 'and handed nothing').toHaveLength(1);
    expect(rowsOf(harness, 'coder.implementation.recorded').filter((row) => row.taskId === 'build-1')).toHaveLength(1);
    expect(rowsOf(harness, 'architecture.observed').filter((row) => row.taskId === 'build-1')).toHaveLength(1);
  });
});
