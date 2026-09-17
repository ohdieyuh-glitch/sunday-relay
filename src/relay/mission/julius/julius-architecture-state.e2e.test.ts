import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { foldJuliusArchitecture, juliusArchitectureEntryId } from './julius-architecture-state';
import { seedJuliusTaskContract } from './julius-task-contract';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * THE ARCHITECTURE AS STATE, THROUGH THE REAL PIPELINE.
 *
 * The architect used to hold its picture of the system in its own head: prose
 * in a plan, gone the moment the dispatch ended. Nothing later could ask which
 * boundary a change crossed, what had been assumed, or what was rejected and
 * why, so drift could only be argued about and never detected.
 *
 * So the picture is a bounded, typed REVISION on the ledger. It is advisory:
 * recording it releases nothing and decides nothing, a proposal that reaches
 * for a mission-owned term is refused by name, and where it disagrees with the
 * Mission Contract the disagreement is RECORDED while the contract stands.
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
const FAILED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: 'The plan does not name the boundary case.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const BUILD_EVIDENCE = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];
const PASS: Step = { kind: 'succeed', evidence: PASSED_REVIEW };
const REJECT: Step = { kind: 'succeed', evidence: FAILED_REVIEW };

const ARCHITECTURE = (responsibility: string) => ({
  components: [{ name: 'normalizer', responsibility }],
  boundaries: [{
    name: 'JournalReader', kind: 'INTERFACE', contract: 'peek() may return fewer bytes than asked.',
    locator: 'src/relay/persistence/journal.ts',
  }],
  dependencies: [{ name: 'pg', assumption: 'Postgres 16 renders NULL as an empty field.', locator: 'package.json' }],
  decisions: [{
    decisionId: 'D-1', decision: 'Reuse the journal reader.', reason: 'A second buffer double-buffers the same page.',
    rejectedAlternatives: ['Add a second buffer'], evidenceRefs: ['src/relay/persistence/journal.ts:120'],
  }],
  assumptions: [{ assumptionId: 'A-1', claim: 'The 8KiB boundary is a requirement.', state: 'UNVERIFIED', evidenceRefs: [] }],
  openQuestions: [{ questionId: 'Q-1', question: 'Is 8KiB a requirement or an accident?', owner: 'PROMPT_ARCHITECT', blocking: false }],
  risks: [{ riskId: 'R-1', risk: 'A partial read is read as EOF.', impact: 'HIGH', mitigation: 'Assert the byte count.' }],
});
const FIRST = ARCHITECTURE('Turns a journal page into rows.');
const SECOND = ARCHITECTURE('Streams the page instead of buffering it.');

/** A contract with a real scope, so a disagreement with it is expressible. */
const scopedContract = (taskId: string, constraints: readonly string[], filesInScope: readonly string[]) => {
  const seeded = seedJuliusTaskContract({
    runId: 'run-1', taskId, missionContractRevision: 1,
    objective: 'The seeded mission objective.',
    requirements: ['the seeded requirement'], constraints: [...constraints],
    acceptanceCriteria: [{ id: 'criterion-1', text: 'the seeded blocking criterion', blocking: true }],
    filesInScope: [...filesInScope], filesOutOfScope: [],
    spendUsd: 20, repairCycles: 3, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  return seeded.contract;
};

const build = (input: {
  architect: readonly Step[];
  reviewer: readonly Step[];
  constraints?: readonly string[];
  filesInScope?: readonly string[];
}): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      {
        worker: worker({
          workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter',
          capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'],
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
          taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
        }),
        script: input.reviewer,
      },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  void harness.store.putTaskContract({
    projectId: 'prj-1',
    contract: scopedContract('build-1', input.constraints ?? ['the seeded constraint'], input.filesInScope ?? []),
    occurredAt: '2026-08-27T00:00:00.000Z',
  });
  harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
  harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
  harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The suite passes.', requiredEvidenceTypes: ['TEST'] }]);
  return harness;
};

async function drain(harness: JuliusHarness, ticks = 48): Promise<void> {
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
/** Exactly what a worker was SHOWN: the compiled packet it was dispatched with. */
const packetsFor = (harness: JuliusHarness, taskId: string): string =>
  harness.store.contexts().filter((snapshot) => snapshot.taskId === taskId)
    .map((snapshot) => snapshot.packet.blocks.map((block) => block.text).join('\n')).join('\n');
const entriesOf = async (harness: JuliusHarness) =>
  (await harness.store.brainEntriesForRun('run-1', 'prj-1')).filter((entry) => entry.entryId.startsWith('brain:architecture:'));

const PLAN_WITH = (architecture: unknown): Step => ({ kind: 'succeed', evidence: PLAN_EVIDENCE, architecture });

describe('P14 — the architecture the architect holds becomes state every worker reads', () => {
  it('one revision, on the ledger and in the packets of the coder and the reviewer that come after', async () => {
    const harness = build({ architect: [PLAN_WITH(FIRST)], reviewer: [PASS, PASS] });
    await drain(harness);

    const recorded = factsOf(harness, 'architecture.recorded');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      revision: 1, proposedByTaskId: 'plan-1',
      components: 1, boundaries: 1, dependencies: 1, decisions: 1, assumptions: 1, openQuestions: 1, risks: 1,
    });

    const entries = await entriesOf(harness);
    expect(entries.map((entry) => entry.entryId)).toEqual([juliusArchitectureEntryId(1)]);
    expect(entries[0]!.taskIds, 'run-wide, not scoped to a single task').toEqual([]);

    // The coder building against it and the reviewer judging against it saw the
    // same revision, and both were told it is advisory.
    for (const taskId of ['build-1', 'build-1:review']) {
      const packet = packetsFor(harness, taskId);
      expect(packet, taskId).toContain('[INTERFACE] JournalReader');
      expect(packet, taskId).toContain('The Mission Contract remains authoritative');
      expect(packet, taskId).toContain('D-1');
    }
    // And the plan that WROTE it was not shown it: it did not exist yet.
    expect(packetsFor(harness, 'plan-1')).not.toContain('JournalReader');
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });

  it('a second revision is what is in force, and the first stays on the record', async () => {
    // The plan is sent back; the architect repairs it and its picture changes.
    const harness = build({
      architect: [PLAN_WITH(FIRST), PLAN_WITH(SECOND)],
      reviewer: [REJECT, PASS, PASS],
    });
    await drain(harness);

    const recorded = factsOf(harness, 'architecture.recorded');
    expect(recorded.map((facts) => facts.revision)).toEqual([1, 2]);
    expect(recorded[1]!.proposedByTaskId, 'the repair proposed it').toBe('repair:plan-1:1:task');
    expect((await entriesOf(harness)).map((entry) => entry.entryId))
      .toEqual([juliusArchitectureEntryId(1), juliusArchitectureEntryId(2)]);

    const inForce = foldJuliusArchitecture(rows(harness));
    expect(inForce!.revision).toBe(2);
    expect(inForce!.components[0]!.responsibility).toBe('Streams the page instead of buffering it.');
    // The coder, which ran after both, was shown both revisions: nothing is
    // erased, and the record says which is current.
    const packet = packetsFor(harness, 'build-1');
    expect(packet).toContain('ARCHITECTURE (revision 2)');
    expect(packet).toContain('ARCHITECTURE (revision 1)');
  });
});

describe('P15 — the architecture survives a restart: the rows alone rebuild it', () => {
  it('a reader with nothing but the exported ledger reaches the identical state', async () => {
    const harness = build({ architect: [PLAN_WITH(FIRST), PLAN_WITH(SECOND)], reviewer: [REJECT, PASS, PASS] });
    await drain(harness);
    const live = foldJuliusArchitecture(rows(harness));

    // Exactly what a restart has: rows that went through JSON, in order, with
    // no in-memory object surviving alongside them.
    const exported = JSON.parse(JSON.stringify(rows(harness))) as ReturnType<typeof rows>;
    expect(foldJuliusArchitecture(exported)).toEqual(live);
    // And a ledger holding ONLY the architecture rows reconstructs the same
    // thing: no other row is load-bearing for it.
    const only = exported.filter((row) => row.type.startsWith('architecture.'));
    expect(foldJuliusArchitecture(only)).toEqual(live);
    expect(live!.revision).toBe(2);
  });
});

describe('P16 — an architect cannot legislate through a diagram', () => {
  it('a proposal that reaches for a mission-owned term is refused by name and reaches nobody', async () => {
    const harness = build({
      architect: [PLAN_WITH({ ...FIRST, acceptanceCriteria: [{ id: 'ac-9', text: 'mine now' }] })],
      reviewer: [PASS, PASS],
    });
    await drain(harness);

    expect(factsOf(harness, 'architecture.refused')).toEqual([{ reasonCode: 'peer_response_mutates_protected_term', owner: 'worker-a' }]);
    expect(factsOf(harness, 'architecture.recorded'), 'nothing partial was kept').toEqual([]);
    expect(await entriesOf(harness), 'and nothing reached a packet').toEqual([]);
    expect(packetsFor(harness, 'build-1')).not.toContain('JournalReader');
    // The refusal is not a failure of the task: the plan still stands on its evidence.
    expect((await harness.store.loadRun('run-1', 'prj-1'))!.state).toBe('COMPLETED');
  });

  it('a proposal that mints a verdict is refused too, under its own name', async () => {
    const harness = build({
      architect: [PLAN_WITH({ ...FIRST, status: 'VERIFIED' })],
      reviewer: [PASS, PASS],
    });
    await drain(harness);
    expect(factsOf(harness, 'architecture.refused'))
      .toEqual([{ reasonCode: 'peer_response_mints_julius_only_outcome', owner: 'worker-a' }]);
  });
});

describe('P17 — where the design and the agreement disagree, the agreement stands', () => {
  it('a boundary outside the permitted paths and a prohibited dependency are recorded, and the contract is untouched', async () => {
    const harness = build({
      architect: [PLAN_WITH(FIRST)], reviewer: [PASS, PASS],
      filesInScope: ['src/relay/mission/'], constraints: ['no new pg dependency'],
    });
    await drain(harness);

    const conflicts = factsOf(harness, 'architecture.conflicted');
    expect(conflicts).toEqual([
      {
        revision: 1, kind: 'BOUNDARY_OUTSIDE_PERMITTED_PATHS', name: 'JournalReader',
        detail: 'src/relay/persistence/journal.ts', contractTaskId: 'build-1', resolvedBy: 'CONTRACT', owner: 'worker-a',
      },
      {
        revision: 1, kind: 'DEPENDENCY_PROHIBITED', name: 'pg',
        detail: 'violating the mission constraint: no new pg dependency', contractTaskId: 'build-1', resolvedBy: 'CONTRACT', owner: 'worker-a',
      },
    ]);

    // RECORDED, NOT RESOLVED. The contract says exactly what it said before,
    // and the architecture was kept as written rather than trimmed to fit.
    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(contract!.permittedPaths).toEqual(['src/relay/mission/']);
    expect(contract!.prohibitedActions).toEqual(['violating the mission constraint: no new pg dependency']);
    const state = foldJuliusArchitecture(rows(harness));
    expect(state!.boundaries[0]!.locator).toBe('src/relay/persistence/journal.ts');
  });

  it('a design inside the agreement reports no disagreement at all', async () => {
    const harness = build({
      architect: [PLAN_WITH(FIRST)], reviewer: [PASS, PASS],
      filesInScope: ['src/relay/'], constraints: ['no new dependency at all'],
    });
    await drain(harness);
    expect(factsOf(harness, 'architecture.conflicted')).toEqual([]);
    expect(factsOf(harness, 'architecture.recorded')).toHaveLength(1);
  });
});
