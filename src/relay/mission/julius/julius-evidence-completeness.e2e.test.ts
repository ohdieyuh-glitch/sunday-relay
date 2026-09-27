import { describe, expect, it } from 'vitest';

import { JuliusRunLoop } from './julius-run-loop';
import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import type { JuliusTrajectoryEvent } from './julius-trajectory';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * EVERY FIELD THE BETA BRIEF NAMES, READ BACK OUT OF THE DURABLE RECORD.
 *
 * WHY A SWEEP AND NOT MORE INDIVIDUAL CASES. Each field below is written by a
 * different part of the runtime, and the failure that keeps happening is not a
 * field computed wrongly — it is a field computed correctly and then not
 * carried. `worker-diagnostics.tsv` held ZERO rows on a paid success path
 * because its columns were emitted only on failure. `brainRetrievals` was wired
 * to `result.usage`, a channel that could never contain it, and was null
 * forever. The bundle exporter dropped `sequence` at the one line that mapped a
 * timeline entry into a report row. Three defects, one shape: nobody was asking
 * the durable record for the whole list at once.
 *
 * So this drives ONE real mission — with a repair round, so lineage exists — and
 * then reads only what survived, from the store. It asserts presence and the
 * UNKNOWN rule, not values: what each number means is its own module's proof.
 *
 * WHAT IT DELIBERATELY DOES NOT COVER. The reviewer's FINDINGS and the REPAIR
 * LINEAGE need a mission that was rejected, and those fields are already read
 * back from the durable record where a rejection actually happens — the reviewer
 * catch block in `relay-bridge/julius/julius-live-composition.test.ts`, which
 * asserts the blocking finding, the REPAIR decision that stays the subject's
 * current decision, the repair task, and the ACCEPT on the repair rather than on
 * the work it replaced. Re-deriving them here would put two authorities on one
 * fact, which is the thing this file exists to argue against.
 *
 * THE UNKNOWN RULE IS THE POINT OF HALF OF IT. A cost, a duration or a token
 * count the runtime did not observe must be `null` on the durable row. Zero is a
 * measurement, and a zero nobody measured makes the cheapest generation the one
 * that reported nothing.
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
const RUN: JuliusRunRow = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY',
  cardRevision: 'card-r1', missionContractRevision: 4, projectBrainRevision: 0, version: 1,
};
const capabilityFor = (item: { role: string }) =>
  (item.role === 'PROMPT_ARCHITECT' ? 'plan' : item.role === 'INDEPENDENT_REVIEWER' ? 'review' : 'implement');

const PLAN_OK = { kind: 'succeed' as const, evidence: [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }] };
const REVIEW_ACCEPT = { kind: 'succeed' as const, evidence: [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }] };
/** The coder reports a price; the peers do not — the shape of Live Run 3. */
const BUILD_PASSES = {
  kind: 'succeed' as const, usdMicros: 608_861,
  evidence: [{ type: 'TEST', status: 'PASSED', safeSummary: 'Suite green.' }],
};
const UNPRICED = { usdMicros: null };

function build(): JuliusHarness {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [{ ...PLAN_OK, ...UNPRICED }, { ...PLAN_OK, ...UNPRICED }] },
      { worker: CODER, script: [BUILD_PASSES, BUILD_PASSES, BUILD_PASSES] },
      { worker: REVIEWER, script: Array.from({ length: 6 }, () => ({ ...REVIEW_ACCEPT, ...UNPRICED })) },
    ],
    card: cardPolicy({
      allowedProviders: ['openai', 'anthropic', 'hermes'],
      capabilities: ['plan', 'implement', 'review'], concurrency: 1,
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
  seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
  harness.store.seedTask('run-1', task({
    taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan', requiredEvidenceTypes: ['ARTIFACT'],
  }));
  harness.store.seedTask('run-1', task({
    taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
    state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
  }));
  harness.store.seedCriteria('run-1', [
    { criterionId: 'AC-1', description: 'The migration runs before the deploy.', requiredEvidenceTypes: [] },
  ]);
  return harness;
}

async function drain(loop: JuliusRunLoop, maxTicks = 24): Promise<number> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if ((await loop.tick(scope)).claimed === 0) return tick;
  }
  return maxTicks;
}

const dispatchesIn = (events: readonly JuliusTrajectoryEvent[]) =>
  events.filter((event) => event.kind === 'DISPATCH');

/**
 * THE DISPATCHES THAT ACTUALLY HAPPENED.
 *
 * `kind: 'DISPATCH'` covers two different things and `outcome` is what separates
 * them: a dispatch that ran, and a dispatch Julius REFUSED to make — policy
 * denied, contract not locked, a review whose binding did not match the work.
 * A refusal has no worker, no provider and no measurements, correctly, because
 * nothing was asked. Asserting identity over both would have demanded a provider
 * for a call that was never placed.
 */
const completedIn = (events: readonly JuliusTrajectoryEvent[]) =>
  dispatchesIn(events).filter((event) => event.outcome === 'COMPLETED');

describe('the durable record carries every field the beta brief names', () => {
  it('ran the mission it claims to read: all three peers, to a completion', async () => {
    // Stated first, because everything below is meaningless if the mission the
    // sweep reads is not the mission it says it is.
    const harness = build();
    await drain(harness.loop);
    expect((await harness.store.loadRun('run-1', 'prj-1'))?.state).toBe('COMPLETED');
    const roles = new Set(completedIn(harness.store.trajectory())
      .map((event) => event.workerId));
    expect(roles, 'all three slots dispatched').toEqual(new Set(['architect', 'coder', 'reviewer']));
  });

  it('carries provider identity, the context it was compiled against, and its versions', async () => {
    const harness = build();
    await drain(harness.loop);
    const completed = completedIn(harness.store.trajectory());
    expect(completed.length, 'the mission dispatched something').toBeGreaterThan(2);
    for (const event of completed) {
      expect(event.workerId, `${event.taskId}: which worker`).not.toBeNull();
      expect(event.providerId, `${event.taskId}: which provider`).not.toBeNull();
      expect(event.contextId, `${event.taskId}: which compiled context`).not.toBeNull();
      expect(event.runtimeVersion, `${event.taskId}: which runtime`).toBe('julius-runtime.v1');
      expect(event.cardRevision, `${event.taskId}: which C.A.R.D.`).toBe('card-r1');
      expect(event.missionContractRevision, `${event.taskId}: which mission contract`).toBe(4);
      expect(event.idempotencyKey.length, `${event.taskId}: replayable`).toBeGreaterThan(0);
    }
  });

  it('carries latency and tokens per dispatch, and null where nothing was observed', async () => {
    const harness = build();
    await drain(harness.loop);
    const dispatches = completedIn(harness.store.trajectory());
    for (const event of dispatches) {
      for (const [field, value] of [
        ['durationMs', event.durationMs], ['inputTokens', event.inputTokens],
        ['outputTokens', event.outputTokens], ['usdMicros', event.usdMicros],
      ] as const) {
        // Either a real non-negative number, or null. Never undefined, never a
        // string, and never a zero standing in for "not observed".
        expect(value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0),
          `${event.taskId}.${field} must be a number or null, was ${String(value)}`).toBe(true);
      }
    }
    expect(dispatches.some((event) => event.durationMs !== null),
      'at least one dispatch must have reported a duration, or this case is vacuous').toBe(true);
  });

  /**
   * THE RULE THE WHOLE PRODUCT RESTS ON. Two dispatches, one priced and one
   * silent, and the durable rows must be distinguishable. If the silent one
   * carried 0 there would be no way back to the truth from the record.
   */
  it('never turns an unreported cost into a zero on the durable row', async () => {
    const harness = build();
    await drain(harness.loop);
    const dispatches = completedIn(harness.store.trajectory());
    const priced = dispatches.filter((event) => event.usdMicros !== null);
    const silent = dispatches.filter((event) => event.usdMicros === null);
    expect(priced.length, 'the coder reported a price').toBeGreaterThan(0);
    expect(silent.length, 'the architect and the reviewer did not').toBeGreaterThan(0);
    for (const event of silent) {
      expect(event.usdMicros, `${event.taskId}: unknown is null`).toBeNull();
      expect(event.usdMicros, `${event.taskId}: and emphatically not zero`).not.toBe(0);
    }
    expect(priced.some((event) => event.usdMicros === 608_861),
      'the reported figure survives verbatim').toBe(true);
  });

  it('carries the locked contract, and the same revision and digest to the work and its review', async () => {
    const harness = build();
    await drain(harness.loop);
    const contract = await harness.store.loadTaskContract({ projectId: 'prj-1', taskId: 'build-1' });
    expect(contract, 'the build has a contract').not.toBeNull();
    expect(contract!.state).toBe('LOCKED');
    expect(contract!.bindingDigest).toMatch(/^sha256:[0-9a-f]{16,}$/u);

    // Read off the CLAIM rows, which is the only thing that proves the binding
    // was carried INTO the dispatch rather than merely existing by the end.
    const bound = harness.store.events()
      .filter((event) => event.type === 'task.claimed')
      .map((event) => event.facts as Record<string, unknown>)
      .filter((facts) => facts.bindingDigest !== null && facts.bindingDigest !== undefined);
    expect(bound.length, 'the coder and at least one reviewer are bound').toBeGreaterThan(1);
    for (const facts of bound) {
      expect(facts.bindingDigest).toBe(contract!.bindingDigest);
      expect(facts.contractRevision).toBe(contract!.contractRevision);
    }
  });

  it('carries a context snapshot that can be compared, with the terms it was compiled under', async () => {
    const harness = build();
    await drain(harness.loop);
    const snapshots = harness.store.contexts();
    expect(snapshots.length, 'every dispatch records one').toBeGreaterThan(3);
    for (const snapshot of snapshots) {
      expect(snapshot.contentHash, `${snapshot.taskId}: hashed`).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(snapshot.characterCount, `${snapshot.taskId}: sized`).toBeGreaterThanOrEqual(0);
      expect(snapshot.compilerVersion, `${snapshot.taskId}: versioned`).toBe('julius-context.v1');
      expect(snapshot.integrityVersion, `${snapshot.taskId}: authority-ranked`)
        .toBe('julius-context-integrity.v1');
      expect(snapshot.workerRole, `${snapshot.taskId}: for which role`).not.toBe('');
    }
    // The coder's packet names the agreement it was compiled under; the
    // architect PRODUCES the terms and is bound by none, and null says so.
    const coder = snapshots.find((snapshot) => snapshot.workerRole === 'CODING_AGENT')!;
    expect(coder.taskContractRevision).not.toBeNull();
    expect(coder.taskContractDigest).toMatch(/^sha256:/u);
  });

  it('carries evidence, the reviewer’s findings, and the ids that link them', async () => {
    const harness = build();
    await drain(harness.loop);
    const evidence = await harness.store.evidenceForRun('run-1', 'prj-1');
    expect(new Set(evidence.map((item) => item.type)))
      .toEqual(new Set(['ARTIFACT', 'TEST', 'REVIEW_FINDING']));
    for (const item of evidence) {
      expect(item.evidenceId.length, 'every row is addressable').toBeGreaterThan(0);
      expect(item.taskId.length, 'and attributed to a task').toBeGreaterThan(0);
      expect(['PASSED', 'FAILED', 'INCONCLUSIVE']).toContain(item.status);
    }
    // A clean mission raises no finding, and that is the correct answer rather
    // than an empty row: `findingsForRun` returns nothing because the reviewer
    // found nothing. What a REJECTION records is proven where a rejection
    // happens — see the header.
    expect(await harness.store.findingsForRun('run-1', 'prj-1'),
      'a mission nobody rejected has no findings to carry').toEqual([]);
  });

  it('carries what the run itself concluded into Project Brain', async () => {
    const harness = build();
    await drain(harness.loop);
    const brain = await harness.store.brainEntriesForRun('run-1', 'prj-1');
    const authored = brain.filter((entry) => entry.entryId.startsWith('brain:decision:'));
    expect(authored.length, 'a run that concluded nothing durable is the defect this guards').toBeGreaterThan(0);
    for (const entry of authored) {
      expect(entry.kind).toBe('DECISION');
      expect(entry.provenance?.workerId, 'attributed, so a later mission can weigh it').toBeTruthy();
      expect(entry.provenance?.recordedAt, 'and dated').toBeTruthy();
    }
    // The REASON is what a later worker needs and what was missing before: an
    // entry saying a decision happened and not why would be a row nobody could
    // act on. (The text a REJECTION writes is proven by
    // `julius-brain-persistence.e2e`, which drives one.)
    expect(authored.some((entry) => entry.text.includes('TASK_VERIFIED')),
      'the accept states the reason code it accepted on').toBe(true);
    for (const entry of authored) {
      expect(entry.taskIds, 'a decision is about a task, and says which').not.toEqual([]);
    }
  });

  it('carries a completion decision, or a named reason it did not complete', async () => {
    const harness = build();
    await drain(harness.loop);
    const run = await harness.store.loadRun('run-1', 'prj-1');
    const decisions = await harness.store.decisionsForRun('run-1', 'prj-1');
    if (run?.state === 'COMPLETED') {
      expect(decisions.some((decision) => decision.action === 'ACCEPT' || decision.action === 'COMPLETE'),
        'a completed run was accepted by a recorded decision').toBe(true);
      expect(harness.store.events().some((event) => event.type === 'run.completed'),
        'and the completion is an event, not an inference').toBe(true);
    } else {
      // A run that did not complete must NAME a cause. Silence is the failure
      // mode, and a cause may legitimately live in any of four places: a failed
      // task, a failed run, a HALT decision, or a dispatch Julius refused to
      // make — the last of which carries its reason as the row's own outcome.
      const named = [
        ...harness.store.events().filter((event) => event.type === 'task.failed' || event.type === 'run.failed'),
        ...decisions.filter((decision) => decision.action === 'HALT'),
        ...dispatchesIn(harness.store.trajectory()).filter((event) => event.outcome !== 'COMPLETED'),
      ];
      expect(named.length, `state ${String(run?.state)} with no recorded cause`).toBeGreaterThan(0);
    }
  });

  /**
   * A FAILED ATTEMPT THAT BILLED IS STILL SPEND, ON THE ROW THE EVALS READ.
   *
   * The boundary's diagnostics already reached `task.failed`, so the money was
   * durable under a different name in a different place — and
   * `summariseJuliusEvals` reads `usdMicros` off trajectory rows, so a mission
   * that spent on an attempt and then failed reported only its SUCCESSFUL spend.
   * A total that looks complete and is biased low is worse than one that says it
   * is a floor.
   */
  it('carries the spend of an attempt that billed and then failed', async () => {
    const harness = createJuliusHarness({
      workers: [
        { worker: ARCHITECT, script: [{ ...PLAN_OK, ...UNPRICED }] },
        // A boundary that billed 250,000 micros before it timed out, reported it,
        // and is retried to the task ceiling.
        { worker: CODER, script: [{
          kind: 'fail', code: 'TIMEOUT', costUsdMicros: 250_000, runtimeStarted: true,
        } as never] },
        { worker: REVIEWER, script: [{ ...REVIEW_ACCEPT, ...UNPRICED }] },
      ],
      card: cardPolicy({
        allowedProviders: ['openai', 'anthropic', 'hermes'],
        capabilities: ['plan', 'implement', 'review'], concurrency: 1,
      }),
      verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 0 }),
      capabilityFor,
    });
    harness.store.seedRun(RUN);
    seedTaskContractInto(harness.store, { runId: 'run-1', projectId: 'prj-1', taskId: 'build-1' });
    harness.store.seedTask('run-1', task({
      taskId: 'plan-1', ordinal: 0, role: 'PROMPT_ARCHITECT', taskType: 'plan',
      requiredEvidenceTypes: ['ARTIFACT'],
    }));
    harness.store.seedTask('run-1', task({
      taskId: 'build-1', ordinal: 1, role: 'CODING_AGENT', taskType: 'build',
      state: 'BLOCKED', dependencyIds: ['plan-1'], requiredEvidenceTypes: ['TEST'],
    }));
    await drain(harness.loop);

    const failed = harness.store.trajectory().filter((event) =>
      (event.kind === 'DISPATCH' || event.kind === 'RETRY') && event.outcome === 'TIMEOUT');
    expect(failed.length, 'the timeout is on the trajectory').toBeGreaterThan(0);
    expect(failed.some((event) => event.usdMicros === 250_000),
      'and so is what it billed before failing').toBe(true);
    for (const event of failed) {
      // Still the UNKNOWN rule: what the boundary did not report stays null.
      for (const value of [event.inputTokens, event.outputTokens, event.durationMs]) {
        expect(value === null || (typeof value === 'number' && value >= 0)).toBe(true);
      }
    }
    // And the task really did end failed, so this is not a success in disguise.
    expect(harness.store.taskRow('build-1')!.state).toBe('FAILED');
  });

  it('gives every durable row a position the record can be replayed from', async () => {
    const harness = build();
    await drain(harness.loop);
    const page = await harness.store.timeline({ runId: 'run-1', projectId: 'prj-1', sinceSequence: 0, limit: 500 });
    expect(page.entries.length).toBeGreaterThan(10);
    // A per-run monotonic position, allocated on append. NOT `occurredAt`:
    // several events of one mission routinely share a millisecond, and a
    // wall-clock sort has no deterministic tiebreak.
    const sequences = page.entries.map((entry) => entry.sequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
    expect(new Set(sequences).size, 'and no two rows share one').toBe(sequences.length);
    for (const entry of page.entries) {
      expect(entry.type.length, 'every row names its kind').toBeGreaterThan(0);
      for (const value of Object.values(entry.facts)) {
        // Facts are scalars. A nested object here is how a transcript, a prompt
        // or a chain of thought would reach the durable record.
        expect(['string', 'number', 'boolean'].includes(typeof value) || value === null,
          `${entry.type} carries a non-scalar fact`).toBe(true);
      }
    }
  });

  it('persists no hidden reasoning anywhere a worker could have put it', async () => {
    const harness = build();
    await drain(harness.loop);
    const haystack = JSON.stringify({
      events: harness.store.events(),
      trajectory: harness.store.trajectory(),
      contexts: harness.store.contexts(),
      brain: await harness.store.brainEntriesForRun('run-1', 'prj-1'),
      evidence: await harness.store.evidenceForRun('run-1', 'prj-1'),
    }).toLowerCase();
    for (const forbidden of ['chain of thought', 'chain-of-thought', 'scratchpad',
      'internal monologue', '<thinking>', 'reasoning_content']) {
      expect(haystack.includes(forbidden), `the durable record contains "${forbidden}"`).toBe(false);
    }
  });
});
