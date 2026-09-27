import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { lockJuliusTaskContract, seedJuliusTaskContract } from './julius-task-contract';
import { foldJuliusArchitecture } from './julius-architecture-state';
import { juliusArchitectureCheckTaskId, juliusArchitectureTriggerId } from './julius-architecture-drift';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * THE ARCHITECT AS A PEER FOR THE WHOLE MISSION.
 *
 * Julius goes back to it when the record says the design moved, and once before
 * a run may call itself complete. The consultation is an ASSESSMENT, never a
 * verdict: it cannot accept a task and cannot verify a mission. What it can do
 * is refuse to let a completion happen while what was built does not match what
 * was designed — and a design changed after the terms locked waits for the
 * reviewer, exactly as rejected guidance never reaches the coder.
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
const FAILED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The proposed design contradicts the plan.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
/** A reviewer that answers, by id, every finding its packet shows it — silence is not resolution. */
const PASS: Step = { kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' };
const REJECT: Step = { kind: 'succeed', evidence: FAILED_REVIEW };

const ARCHITECTURE = (overrides: Record<string, unknown> = {}) => ({
  components: [{ name: 'normalizer', responsibility: 'Turns a journal page into rows.' }],
  boundaries: [{ name: 'JournalReader', kind: 'INTERFACE', contract: 'peek() may return fewer bytes.', locator: 'src/relay/journal.ts' }],
  dependencies: [], decisions: [],
  assumptions: [{ assumptionId: 'A-1', claim: 'The 8KiB boundary is a requirement.', state: 'UNVERIFIED', evidenceRefs: [] }],
  openQuestions: [], risks: [],
  ...overrides,
});
/** A revision that moves a boundary: material by the rule, not by assertion. */
const MOVED = ARCHITECTURE({
  boundaries: [{ name: 'JournalReader', kind: 'SCHEMA', contract: 'rows are fixed width now', locator: 'src/relay/journal.ts' }],
});
/** A revision that reaches outside the permitted paths: a re-plan the terms do not allow. */
const OUTSIDE = ARCHITECTURE({
  boundaries: [{ name: 'JournalReader', kind: 'SCHEMA', contract: 'rows are fixed width now', locator: 'src/relay/persistence/journal.ts' }],
});

const ALIGNED = { assessment: 'ALIGNED', claim: 'What was built matches the design.', drift: [], driftingTaskIds: [], evidenceRefs: [] };
const DRIFTED = {
  assessment: 'DRIFT_REQUIRES_REPAIR', claim: 'The reader still assumes variable-width rows.',
  drift: [{ kind: 'SCHEMA', name: 'JournalRow', claim: 'Fixed width was built; the design says variable.' }],
  driftingTaskIds: ['build-1'], evidenceRefs: ['src/relay/journal.ts:120'],
};
const COSMETIC = {
  assessment: 'DRIFT_REQUIRES_REPAIR', claim: 'It was renamed.',
  drift: [{ kind: 'NAMING', name: 'reader', claim: 'Renamed from JournalReader.' }],
  driftingTaskIds: ['build-1'], evidenceRefs: ['src/relay/journal.ts:1'],
};

/** A LOCKED contract with a real scope, so a re-plan outside it is expressible. */
const scopedContract = (filesInScope: readonly string[]) => {
  const seeded = seedJuliusTaskContract({
    runId: 'run-1', taskId: 'build-1', missionContractRevision: 1,
    objective: 'The seeded mission objective.',
    requirements: ['the seeded requirement'], constraints: ['the seeded constraint'],
    acceptanceCriteria: [{ id: 'criterion-1', text: 'the seeded blocking criterion', blocking: true }],
    filesInScope: [...filesInScope], filesOutOfScope: [],
    spendUsd: 20, repairCycles: 3, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  const locked = lockJuliusTaskContract({
    contract: seeded.contract, verdict: { verdict: 'ACCEPT', evaluatorId: 'fixture-evaluator' },
    lockedAt: '2026-08-27T00:00:00.000Z',
  });
  if (locked.outcome !== 'LOCKED') throw new Error(`fixture contract not lockable: ${JSON.stringify(locked)}`);
  return locked.contract;
};

const build = (input: {
  architect: readonly Step[];
  reviewer: readonly Step[];
  /** Whether the architect is registered for architecture consultations at all. */
  consults?: boolean;
  contract?: 'draft' | 'locked' | 'none';
  filesInScope?: readonly string[];
}): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      {
        worker: worker({
          workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter',
          capabilities: ['plan'],
          taskTypes: input.consults === false ? ['plan', 'repair:plan'] : ['plan', 'repair:plan', 'architecture'],
        }),
        script: input.architect,
      },
      {
        worker: worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] }),
        script: [{ kind: 'succeed', evidence: BUILD_EVIDENCE }, { kind: 'succeed', evidence: BUILD_EVIDENCE }],
      },
      {
        worker: worker({
          workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter', capabilities: ['review'],
          taskTypes: ['review:plan', 'review:build', 'review:architecture', 'review:repair:plan', 'review:repair:build'],
        }),
        script: input.reviewer,
      },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  if (input.filesInScope === undefined) {
    seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1', state: input.contract ?? 'draft' });
  } else {
    void harness.store.putTaskContract({
      projectId: 'prj-1', contract: scopedContract(input.filesInScope), occurredAt: '2026-08-27T00:00:00.000Z',
    });
  }
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
  return harness;
};

async function drain(harness: JuliusHarness, ticks = 64): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    const report = await harness.loop.tick({ projectId: 'prj-1' });
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
}

const rows = (harness: JuliusHarness) => harness.store.events().map((event) => ({ type: event.type, facts: event.facts, taskId: event.taskId }));
const factsOf = (harness: JuliusHarness, type: string) => rows(harness).filter((row) => row.type === type).map((row) => row.facts);
const stateOf = async (harness: JuliusHarness) => (await harness.store.loadRun('run-1', 'prj-1'))!.state;
const packetsFor = (harness: JuliusHarness, taskId: string): string =>
  harness.store.contexts().filter((snapshot) => snapshot.taskId === taskId)
    .map((snapshot) => snapshot.packet.blocks.map((block) => block.text).join('\n')).join('\n');

const PLAN_WITH = (architecture: unknown): Step => ({ kind: 'succeed', evidence: PLAN_EVIDENCE, architecture });
const CONSULT = (architecture: unknown, consistency: unknown): Step =>
  ({ kind: 'succeed', evidence: PLAN_EVIDENCE, architecture, consistency });
const CHECK_TASK = juliusArchitectureCheckTaskId('run-1', juliusArchitectureTriggerId('PRE_COMPLETION_CHECK', 1, null));

describe('P23 — before a run may complete, the architect is asked whether it matches the design', () => {
  it('the consultation is minted, answered ALIGNED, and the run completes', async () => {
    const harness = build({
      architect: [PLAN_WITH(ARCHITECTURE()), CONSULT(ARCHITECTURE(), ALIGNED)],
      reviewer: [PASS, PASS, PASS],
    });
    await drain(harness);

    const raised = factsOf(harness, 'architecture.trigger.raised');
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      trigger: 'PRE_COMPLETION_CHECK', revision: 1, served: true, servedByTaskId: CHECK_TASK, unroutable: false,
    });
    expect(factsOf(harness, 'architecture.assessed')[0]).toMatchObject({
      assessment: 'ALIGNED', route: 'PROCEED', revision: 1, holdsCompletion: false, assessedByTaskId: CHECK_TASK,
    });
    expect(await stateOf(harness)).toBe('COMPLETED');
    // The consultation was told WHY it was asked, and shown the design in force.
    const packet = packetsFor(harness, CHECK_TASK);
    expect(packet).toContain('JournalReader');
  });

  it('DRIFT_REQUIRES_REPAIR holds the completion, and the record says which work and why', async () => {
    const harness = build({
      architect: [PLAN_WITH(ARCHITECTURE()), CONSULT(ARCHITECTURE(), DRIFTED)],
      reviewer: [PASS, PASS, PASS],
    });
    await drain(harness);

    expect(factsOf(harness, 'architecture.assessed')[0]).toMatchObject({
      assessment: 'DRIFT_REQUIRES_REPAIR', route: 'REPAIR', driftingTaskIds: 'build-1',
      materialDrift: 1, holdsCompletion: true,
    });
    expect(await stateOf(harness), 'not completed, and not falsely failed either').toBe('VERIFYING');
    // The hold is a STATED one: the run's own transition says the reason.
    const advance = await harness.loop.advanceRun('run-1', 'prj-1');
    expect(advance!.reasonCode).toBe('ARCHITECTURE_DRIFT_REQUIRES_REPAIR');
  });

  it('a repair demanded for a rename is refused, and the run is not held by it', async () => {
    const harness = build({
      architect: [PLAN_WITH(ARCHITECTURE()), CONSULT(ARCHITECTURE(), COSMETIC)],
      reviewer: [PASS, PASS, PASS],
    });
    await drain(harness);
    expect(factsOf(harness, 'architecture.assessment.refused')[0])
      .toMatchObject({ reasonCode: 'consistency_drift_immaterial', revision: 1 });
    expect(factsOf(harness, 'architecture.assessed'), 'nothing was recorded from a refused answer').toEqual([]);
    // The consultation produced no answer, so the gate still owes one: held, not completed.
    expect(await stateOf(harness)).toBe('VERIFYING');
  });

  it('an assessment about work this run does not hold is refused', async () => {
    const harness = build({
      architect: [PLAN_WITH(ARCHITECTURE()), CONSULT(ARCHITECTURE(), { ...DRIFTED, driftingTaskIds: ['build-99'] })],
      reviewer: [PASS, PASS, PASS],
    });
    await drain(harness);
    expect(factsOf(harness, 'architecture.assessment.refused')[0])
      .toMatchObject({ reasonCode: 'consistency_names_foreign_work', foreign: 'build-99' });
  });

  it('a run that recorded no architecture is never held, and consults nobody', async () => {
    const harness = build({ architect: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }], reviewer: [PASS, PASS] });
    await drain(harness);
    expect(factsOf(harness, 'architecture.trigger.raised')).toEqual([]);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it('a consultation no worker accepts is recorded and not waited for', async () => {
    const harness = build({
      architect: [PLAN_WITH(ARCHITECTURE())], reviewer: [PASS, PASS], consults: false,
    });
    await drain(harness);
    expect(factsOf(harness, 'architecture.trigger.raised')[0])
      .toMatchObject({ trigger: 'PRE_COMPLETION_CHECK', served: false, servedByTaskId: null, unroutable: true });
    expect(await stateOf(harness), 'a feature nothing opted into cannot strand a mission').toBe('COMPLETED');
  });
});

describe('P24 — a design changed after the terms lock waits for the reviewer', () => {
  it('a material revision is PROPOSED, reaches only its own review, and becomes the design in force when accepted', async () => {
    const harness = build({
      architect: [PLAN_WITH(ARCHITECTURE()), CONSULT(MOVED, ALIGNED)],
      reviewer: [PASS, PASS, PASS],
      filesInScope: ['src/relay/'],
    });
    await drain(harness);

    const recorded = factsOf(harness, 'architecture.recorded');
    expect(recorded.map((facts) => [facts.revision, facts.status])).toEqual([[1, 'IN_FORCE'], [2, 'PROPOSED']]);
    expect(factsOf(harness, 'architecture.proposed')[0])
      .toMatchObject({ revision: 2, proposedByTaskId: CHECK_TASK, reasonCode: 'material_change_after_lock', changeKinds: 'SCHEMA:CHANGED' });
    expect(factsOf(harness, 'architecture.accepted')[0])
      .toMatchObject({ revision: 2, proposedByTaskId: CHECK_TASK, acceptedByTaskId: `${CHECK_TASK}:review` });
    expect(foldJuliusArchitecture(rows(harness))!.revision).toBe(2);
    expect(await stateOf(harness)).toBe('COMPLETED');
  });

  it('a revision the reviewer sent back is never the design in force, and never reaches the coder', async () => {
    const harness = build({
      architect: [PLAN_WITH(ARCHITECTURE()), CONSULT(MOVED, ALIGNED)],
      // plan, build, then the consultation: REJECTED.
      reviewer: [PASS, PASS, REJECT, PASS],
      filesInScope: ['src/relay/'],
    });
    await drain(harness);

    expect(factsOf(harness, 'architecture.proposed')).toHaveLength(1);
    expect(factsOf(harness, 'architecture.accepted'), 'nothing accepted it').toEqual([]);
    const inForce = foldJuliusArchitecture(rows(harness));
    expect(inForce!.revision, 'the design in force is still the one that was agreed').toBe(1);
    expect(inForce!.boundaries[0]!.kind).toBe('INTERFACE');
    // The proposal is kept as provenance, scoped to the consultation that wrote it.
    const entries = await harness.store.brainEntriesForRun('run-1', 'prj-1');
    const proposal = entries.find((entry) => entry.entryId === `brain:architecture:proposal:${CHECK_TASK}`);
    expect(proposal, 'kept, and labelled').not.toBeUndefined();
    expect(proposal!.text).toContain('NOT IN FORCE');
    expect(proposal!.taskIds).toEqual([CHECK_TASK]);
    expect(entries.some((entry) => entry.entryId === 'brain:architecture:run-1:r2'), 'and it is not run-wide').toBe(false);
    expect(packetsFor(harness, 'build-1')).not.toContain('fixed width');
  });

  it('a re-plan that would need the terms to move is escalated, and changes nothing', async () => {
    const harness = build({
      architect: [PLAN_WITH(ARCHITECTURE()), CONSULT(OUTSIDE, ALIGNED)],
      reviewer: [PASS, PASS, PASS],
      filesInScope: ['src/relay/journal.ts'],
    });
    await drain(harness);

    const escalated = factsOf(harness, 'architecture.replan.escalated');
    expect(escalated).toHaveLength(1);
    expect(escalated[0]).toMatchObject({
      revision: 2, reasonCode: 'replan_requires_contract_revision', contractTaskId: 'build-1',
      conflictKinds: 'BOUNDARY_OUTSIDE_PERMITTED_PATHS',
    });
    expect(factsOf(harness, 'architecture.recorded').map((facts) => facts.revision), 'no second revision exists').toEqual([1]);
    expect(foldJuliusArchitecture(rows(harness))!.revision).toBe(1);
    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(contract!.state, 'and the agreement is exactly as it was').toBe('LOCKED');
  });
});

describe('P25 — a mid-mission trigger reaches the architect before the end of the run', () => {
  it('a finding that says the work drifted consults the architect, once', async () => {
    const harness = build({
      architect: [PLAN_WITH(ARCHITECTURE()), CONSULT(ARCHITECTURE(), ALIGNED), CONSULT(ARCHITECTURE(), ALIGNED)],
      // The build review raises a contract-drift finding; the repair then passes.
      reviewer: [
        PASS,
        {
          kind: 'succeed',
          evidence: PASSED_REVIEW,
          reviewVerdict: { verdict: 'REPAIR_REQUIRED', category: 'contract_drift', claim: 'The declared interface moved.' },
        },
        PASS, PASS, PASS,
      ],
    });
    await drain(harness);

    const triggers = factsOf(harness, 'architecture.trigger.raised');
    const kinds = triggers.map((facts) => facts.trigger);
    expect(kinds, 'the drift was noticed while the mission was still running').toContain('IMPLEMENTATION_DRIFT');
    expect(kinds).toContain('PRE_COMPLETION_CHECK');
    // Cause-once: the same finding is read on every later advance and consults nobody twice.
    expect(triggers.filter((facts) => facts.trigger === 'IMPLEMENTATION_DRIFT')).toHaveLength(1);
    expect(new Set(triggers.map((facts) => facts.triggerId)).size).toBe(triggers.length);
  });
});
