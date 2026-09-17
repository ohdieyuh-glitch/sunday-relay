import { describe, expect, it } from 'vitest';

import {
  cardPolicy, createJuliusHarness, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { lockJuliusTaskContract, seedJuliusTaskContract } from './julius-task-contract';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * JULIUS NEVER ATTRIBUTES ATTEMPT 1'S CHANGES TO ATTEMPT 2.
 *
 * One workspace serves the whole mission and is never reset. Before this, an
 * attempt's change set was `git status` — the sum of everything anybody had
 * left there — so a retry was credited with the work of the attempt that failed
 * before it, and an attempt that failed early left edits no record mentioned at
 * all. Every proof here drives the real pipeline with scripted workers.
 */

type Step = Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number];

const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 7, projectBrainRevision: 3, version: 1,
};
const TREE = (seed: string): string => seed.repeat(40).slice(0, 40);
const BASE = TREE('b');
const AFTER_ONE = TREE('1');
const AFTER_TWO = TREE('2');
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');
const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const TEST_PASSED = [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }];

const lockedContract = () => {
  const seeded = seedJuliusTaskContract({
    runId: 'run-1', taskId: 'build-1', missionContractRevision: 1,
    objective: 'Normalize the mission label.', requirements: ['slug'], constraints: [],
    acceptanceCriteria: [{ id: 'criterion-1', text: 'the slug test passes', blocking: true }],
    filesInScope: ['src/a.ts', 'src/b.ts', 'src/c.ts'], filesOutOfScope: ['src/persistence/'],
    spendUsd: 20, repairCycles: 3, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(seeded.reasonCode);
  const locked = lockJuliusTaskContract({ contract: seeded.contract, verdict: { verdict: 'ACCEPT', evaluatorId: 'fixture' }, lockedAt: '2026-09-16T00:00:00.000Z' });
  if (locked.outcome !== 'LOCKED') throw new Error('not lockable');
  return locked.contract;
};

/** One attempt's record, exactly as the live adapter builds it from the executor's snapshots. */
const attemptRecord = (input: {
  readonly startTree: string | null;
  readonly endTree: string | null;
  readonly own: readonly string[];
  readonly inherited?: readonly string[];
  readonly cumulative?: readonly string[];
  readonly restore?: Record<string, unknown>;
}) => ({
  baseTree: BASE, startTree: input.startTree, endTree: input.endTree,
  own: input.own.map((path) => ({ path, change: 'MODIFIED' })),
  inherited: (input.inherited ?? []).map((path) => ({ path, change: 'MODIFIED' })),
  cumulative: (input.cumulative ?? [...(input.inherited ?? []), ...input.own]).map((path) => ({ path, change: 'MODIFIED' })),
  ...(input.restore === undefined ? {} : { restore: input.restore }),
});

const implementation = (input: Parameters<typeof attemptRecord>[0] & { readonly captured?: boolean; readonly uncapturedReason?: string }) => ({
  providerKind: 'generic-scripted',
  workspace: {
    captured: input.captured ?? true,
    truncated: false,
    changes: (input.captured ?? true)
      ? (input.cumulative ?? [...(input.inherited ?? []), ...input.own]).map((path) => ({ path, change: 'MODIFIED' }))
      : [],
  },
  attempt: attemptRecord(input),
  ...(input.uncapturedReason === undefined ? {} : { uncapturedReason: input.uncapturedReason }),
});

const SUCCEEDS = (record: ReturnType<typeof implementation>): Step =>
  ({ kind: 'succeed', evidence: TEST_PASSED, implementation: { ...record, attemptOutcome: 'SUCCEEDED' } });
const FAILS = (record: ReturnType<typeof implementation>): Step =>
  ({ kind: 'fail', code: 'RATE_LIMIT', runtimeStarted: true, implementation: { ...record, attemptOutcome: 'FAILED' } });

const build = (coder: readonly Step[], store?: JuliusHarness['store']): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      { worker: worker({ workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter', capabilities: ['plan'], taskTypes: ['plan'] }), script: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }] },
      { worker: worker({ workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter', capabilities: ['implement'], taskTypes: ['build', 'repair:build'] }), script: coder },
      { worker: worker({ workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter', capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:build'] }), script: [{ kind: 'succeed', evidence: PASSED_REVIEW, answerFindings: 'RESOLVED' }] },
    ],
    card: cardPolicy({ allowedProviders: ['openai', 'anthropic', 'hermes'], capabilities: ['plan', 'implement', 'review'] }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
    ...(store === undefined ? {} : { store }),
  });
  if (store === undefined) {
    harness.store.seedRun(RUN);
    void harness.store.putTaskContract({ projectId: 'prj-1', contract: lockedContract(), occurredAt: '2026-09-16T00:00:00.000Z' });
    harness.store.seedTask('run-1', task({ taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'] }));
    harness.store.seedTask('run-1', task({ taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build', state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'] }));
    harness.store.seedCriteria('run-1', [{ criterionId: 'ac-1', description: 'The slug test passes.', requiredEvidenceTypes: ['TEST'] }]);
  }
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

const factsOf = (harness: JuliusHarness, type: string): Record<string, unknown>[] =>
  harness.store.events().filter((event) => event.type === type).map((event) => ({ taskId: event.taskId, ...event.facts }));
const dispatchesOf = (harness: JuliusHarness) => harness.adapters.get('coder-adapter')!.dispatches;

/* ------------------------------------------------------------ attribution */

describe('W1 — a retry owns its delta, never the attempt before it', () => {
  const retrySequence = () => [
    FAILS(implementation({ startTree: BASE, endTree: AFTER_ONE, own: ['src/a.ts', 'src/b.ts'] })),
    SUCCEEDS(implementation({
      startTree: AFTER_ONE, endTree: AFTER_TWO,
      own: ['src/b.ts', 'src/c.ts'], inherited: ['src/a.ts', 'src/b.ts'],
      cumulative: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    })),
  ];

  it('attempt 1 fails having changed A and B, and the record says so under attempt 1', async () => {
    const harness = build(retrySequence());
    await drain(harness);
    const attempts = factsOf(harness, 'coder.attempt.workspace').filter((facts) => facts.taskId === 'build-1');
    expect(attempts[0]).toMatchObject({
      attemptOutcome: 'FAILED', attempt: 1, captured: true,
      startTree: BASE, endTree: AFTER_ONE,
      ownPaths: 2, inheritedPaths: 0, own: 'src/a.ts src/b.ts',
    });
  });

  it('attempt 2 owns only B and C, and reports A and B as inherited', async () => {
    const harness = build(retrySequence());
    await drain(harness);
    const attempts = factsOf(harness, 'coder.attempt.workspace').filter((facts) => facts.taskId === 'build-1');
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toMatchObject({
      attemptOutcome: 'SUCCEEDED', attempt: 2, captured: true,
      startTree: AFTER_ONE, endTree: AFTER_TWO,
      ownPaths: 2, own: 'src/b.ts src/c.ts',
      inheritedPaths: 2, inherited: 'src/a.ts src/b.ts',
      cumulativePaths: 3,
    });
    // THE INVARIANT: attempt 2 never claims attempt 1's original work as its own.
    expect(String(attempts[1]!.own)).not.toContain('src/a.ts');
    expect(attempts[0]!.leaseGeneration).not.toBe(attempts[1]!.leaseGeneration);
  });

  it('every attempt record carries the identity that makes it reconstructable', async () => {
    const harness = build(retrySequence());
    await drain(harness);
    for (const facts of factsOf(harness, 'coder.attempt.workspace').filter((item) => item.taskId === 'build-1')) {
      expect(facts.taskId).toBe('build-1');
      expect(typeof facts.attempt).toBe('number');
      expect(typeof facts.leaseGeneration).toBe('number');
      expect(facts.cleanliness).toBe('OBSERVED_CHANGED');
    }
  });
});

/* ------------------------------------------------- failed-attempt scope */

describe('W2 — a failed attempt is scope-checked, and its stray edits are named under it', () => {
  const strayThenClean = () => [
    FAILS(implementation({ startTree: BASE, endTree: AFTER_ONE, own: ['src/a.ts', 'src/persistence/ledger.ts'] })),
    SUCCEEDS(implementation({
      startTree: BASE, endTree: AFTER_TWO, own: ['src/a.ts'], inherited: [], cumulative: ['src/a.ts'],
      restore: { outcome: 'RESTORED', toTree: BASE, expectedTree: AFTER_ONE, observedTree: BASE, removed: 1, restored: 1 },
    })),
  ];

  it('the out-of-scope path is recorded against the attempt that made it', async () => {
    const harness = build(strayThenClean());
    await drain(harness);
    expect(factsOf(harness, 'coder.scope.violated').filter((facts) => facts.attributedTo === 'ATTEMPT')).toEqual([
      expect.objectContaining({ taskId: 'build-1', path: 'src/persistence/ledger.ts', rule: 'OUT_OF_SCOPE', attempt: 1 }),
    ]);
    const attempts = factsOf(harness, 'coder.attempt.workspace');
    expect(attempts[0]).toMatchObject({ attemptOutcome: 'FAILED', ownScopeViolations: 1 });
  });

  it('Julius then authorises exactly one undo, naming both trees, and the executor reports what it did', async () => {
    const harness = build(strayThenClean());
    await drain(harness);
    const dispatches = dispatchesOf(harness).filter((item) => item.taskId === 'build-1');
    expect(dispatches[0]!.workspace, 'the first attempt has nothing to undo').toBeUndefined();
    expect(dispatches[1]!.workspace).toEqual({ restoreToTree: BASE, expectedTree: AFTER_ONE });
    expect(factsOf(harness, 'coder.workspace.restored')).toEqual([
      expect.objectContaining({ taskId: 'build-1', outcome: 'RESTORED', toTree: BASE, expectedTree: AFTER_ONE, removed: 1, restored: 1 }),
    ]);
  });

  it('a failed attempt that stayed in scope is left alone: nothing is undone', async () => {
    const harness = build([
      FAILS(implementation({ startTree: BASE, endTree: AFTER_ONE, own: ['src/a.ts'] })),
      SUCCEEDS(implementation({ startTree: AFTER_ONE, endTree: AFTER_TWO, own: ['src/b.ts'], inherited: ['src/a.ts'] })),
    ]);
    await drain(harness);
    expect(dispatchesOf(harness).filter((item) => item.taskId === 'build-1').map((item) => item.workspace)).toEqual([undefined, undefined]);
    expect(factsOf(harness, 'coder.workspace.restored')).toEqual([]);
  });

  it('an attempt that left the workspace as it found it has nothing to undo either', async () => {
    const harness = build([
      FAILS(implementation({ startTree: BASE, endTree: BASE, own: ['src/persistence/ledger.ts'] })),
      SUCCEEDS(implementation({ startTree: BASE, endTree: AFTER_TWO, own: ['src/a.ts'] })),
    ]);
    await drain(harness);
    expect(dispatchesOf(harness)[1]!.workspace).toBeUndefined();
  });

  it('the undo is refused when the workspace moved, and the attempt still runs and is attributed', async () => {
    const harness = build([
      FAILS(implementation({ startTree: BASE, endTree: AFTER_ONE, own: ['src/persistence/ledger.ts'] })),
      SUCCEEDS(implementation({
        startTree: TREE('9'), endTree: AFTER_TWO, own: ['src/a.ts'], inherited: ['src/persistence/ledger.ts'],
        restore: { outcome: 'REFUSED_TREE_MOVED', toTree: BASE, expectedTree: AFTER_ONE, observedTree: TREE('9'), removed: 0, restored: 0 },
      })),
    ]);
    await drain(harness);
    expect(factsOf(harness, 'coder.workspace.restored').filter((facts) => facts.taskId === 'build-1')).toEqual([
      expect.objectContaining({ outcome: 'REFUSED_TREE_MOVED', observedTree: TREE('9') }),
    ]);
    const attempts = factsOf(harness, 'coder.attempt.workspace').filter((facts) => facts.taskId === 'build-1');
    expect(attempts[1]).toMatchObject({ attemptOutcome: 'SUCCEEDED', ownPaths: 1, inheritedPaths: 1 });
  });
});

/* --------------------------------------------------------- persistence */

describe('W3 — the attribution survives the process that wrote it', () => {
  it('a fresh runtime over the same store reaches the same undo decision, from the ledger alone', async () => {
    const first = build([FAILS(implementation({ startTree: BASE, endTree: AFTER_ONE, own: ['src/persistence/ledger.ts'] }))]);
    // Only as far as the first coder attempt: the process dies there.
    for (let tick = 0; tick < 12 && factsOf(first, 'coder.attempt.workspace').length === 0; tick += 1) {
      const report = await first.loop.tick({ projectId: 'prj-1' });
      if (report.claimed === 0) await first.loop.advanceRun('run-1', 'prj-1');
    }
    expect(factsOf(first, 'coder.attempt.workspace')).toHaveLength(1);

    // A new process: new adapters, new in-memory state, the same durable rows.
    const resumed = build([SUCCEEDS(implementation({ startTree: BASE, endTree: AFTER_TWO, own: ['src/a.ts'] }))], first.store);
    // The new process starts its own clock; the retry the old one scheduled is due.
    resumed.clock.advance(120_000);
    await drain(resumed);
    const dispatches = dispatchesOf(resumed).filter((item) => item.taskId === 'build-1');
    expect(dispatches[0]!.workspace).toEqual({ restoreToTree: BASE, expectedTree: AFTER_ONE });
  });

  it('replaying the same attempt writes the record once, not twice', async () => {
    const harness = build([
      FAILS(implementation({ startTree: BASE, endTree: AFTER_ONE, own: ['src/a.ts'] })),
      SUCCEEDS(implementation({ startTree: AFTER_ONE, endTree: AFTER_TWO, own: ['src/b.ts'], inherited: ['src/a.ts'] })),
    ]);
    await drain(harness);
    const before = factsOf(harness, 'coder.attempt.workspace').length;
    await drain(harness, 4);
    expect(factsOf(harness, 'coder.attempt.workspace')).toHaveLength(before);
  });
});

/* ------------------------------------------------------ unknown is not clean */

describe('W4 — a workspace nobody could read is never a clean one', () => {
  it('an uncaptured change set is UNKNOWN, and Julius writes its own failed evidence rather than accepting it', async () => {
    const harness = build([
      SUCCEEDS(implementation({ startTree: null, endTree: null, own: [], captured: false })),
      SUCCEEDS(implementation({ startTree: BASE, endTree: AFTER_TWO, own: ['src/a.ts'] })),
    ]);
    await drain(harness);
    expect(factsOf(harness, 'coder.attempt.workspace')[0]).toMatchObject({ captured: false, cleanliness: 'UNKNOWN', ownPaths: 0 });
    const evidence = (await harness.store.evidenceForRun('run-1', 'prj-1')).filter((item) => item.evidenceId.endsWith(':workspace'));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ taskId: 'build-1', type: 'DIFF', status: 'FAILED' });
    expect(evidence[0]!.safeSummary).toContain('UNKNOWN');
  });

  it('a cancelled attempt says why it is unknown, and no undo is authorised from it', async () => {
    const harness = build([
      FAILS(implementation({ startTree: null, endTree: null, own: [], captured: false, uncapturedReason: 'DISPATCH_CANCELLED' })),
      SUCCEEDS(implementation({ startTree: BASE, endTree: AFTER_TWO, own: ['src/a.ts'] })),
    ]);
    await drain(harness);
    expect(factsOf(harness, 'coder.attempt.workspace')[0]).toMatchObject({
      attemptOutcome: 'FAILED', captured: false, cleanliness: 'UNKNOWN', uncapturedReason: 'DISPATCH_CANCELLED',
    });
    // Nothing is undone on the strength of a snapshot nobody took.
    expect(dispatchesOf(harness).filter((item) => item.taskId === 'build-1')[1]!.workspace).toBeUndefined();
  });
});
