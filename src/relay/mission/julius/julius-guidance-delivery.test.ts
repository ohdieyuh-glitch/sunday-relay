import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import {
  JULIUS_GUIDANCE_HANDOFF_CHARS,
  isJuliusGuidanceHandoffEntryId,
  juliusGuidanceHandoffEntryId,
  renderJuliusGuidanceHandoff,
  type JuliusGuidancePacket,
} from './julius-continuous-lifecycle';
import { pendingSegmentFor } from './julius-segment-lineage';
import type { JuliusRunRow } from './julius-runtime-ports';
import type { JuliusTask } from './julius-runtime';

/**
 * THE ADVICE REACHES THE WORKER IT WAS WRITTEN FOR.
 *
 * IT DID NOT. A guidance packet was stored as an artifact whose only consumer
 * in the repository is the Independent Reviewer — so a mission could buy an
 * architect dispatch, buy a review of its output, and hand the Coding Agent
 * that asked the question nothing but `brain:segment-resume`, which is what the
 * coder itself said before it paused. The packet's own type calls its
 * `taskId` "the task the guidance is FOR — the coder's task"; that task never
 * saw it.
 *
 * Research already closed the same loop: `brain:research-answer:<continuation>`
 * puts the observations on the continuation's own Project Brain channel, under
 * a comment saying the answer travels "exactly as the architect's question
 * does". The architect's question had that channel. Its ANSWER did not.
 *
 * AND THAT IS WHY `guidanceConsumed` WAS UNKNOWN. Not because the dimension was
 * unmeasurable — because nothing consumed guidance. The number here is a
 * consequence of the delivery, never a column filled in to look complete.
 */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter',
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
const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];

const REQUEST = Object.freeze({
  question: 'The journal reader already buffers — should the normalizer reuse it?',
  blockedOn: ['the 8KiB boundary case'],
  attempted: ['a second buffer, which double-buffers'],
  relevantPaths: ['src/relay/persistence/journal.ts'],
});
const GUIDANCE = Object.freeze({
  subObjective: 'Reuse the existing reader rather than adding a second buffer.',
  relevantRequirements: ['R1 — the normalizer reads whole records'],
  relevantConstraints: ['no new dependency'],
  repositoryFindings: ['journal.ts already buffers at the same boundary'],
  runtimeFindings: ['the failing case is exactly 8KiB'],
  references: [{
    kind: 'REPOSITORY', locator: 'src/relay/persistence/journal.ts:120',
    retrievedAt: '2026-09-10T20:59:00.000Z', trust: 'CORROBORATED',
  }],
  recommendedActions: ['call the existing reader instead of allocating a second buffer'],
  additionalProhibitions: ['do not widen the public API'],
  affectedCriterionIds: [],
  unresolvedQuestions: ['is 8KiB a requirement or an accident?'],
});

const build = (input: {
  coderScript?: readonly Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number][];
  architectScript?: readonly Parameters<typeof createJuliusHarness>[0]['workers'][number]['script'][number][];
  maxCoderSegments?: number;
} = {}): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: input.architectScript ?? [{ kind: 'succeed', evidence: PLAN_EVIDENCE }] },
      { worker: CODER, script: input.coderScript ?? [{ kind: 'succeed' }] },
      { worker: REVIEWER, script: [{ kind: 'succeed', evidence: PASSED_REVIEW }] },
    ],
    card: cardPolicy({
      allowedProviders: [ARCHITECT.providerId, CODER.providerId, REVIEWER.providerId],
      capabilities: ['plan', 'implement', 'review'],
    }),
    verification: verificationPolicy({
      reviewerRequired: true, maxRepairRounds: 2,
      ...(input.maxCoderSegments === undefined ? {} : { maxCoderSegments: input.maxCoderSegments }),
    }),
    capabilityFor,
  });
  harness.store.seedRun(RUN);
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

/** A guidance round: the coder asks, the architect answers. */
const guidanceRound = (): JuliusHarness => build({
  coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
  architectScript: [
    { kind: 'succeed', evidence: PLAN_EVIDENCE },
    { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
  ],
});

/* ================================================== A the delivery itself */

describe('A — issued guidance lands on the continuation that is waiting for it', () => {
  it('1. THE GAP, CLOSED: the continuation carries a guidance handoff entry', async () => {
    const harness = guidanceRound();
    await drain(harness);

    const entries = (await harness.store.brainEntriesForRun('run-1', 'prj-1'))
      .filter((entry) => isJuliusGuidanceHandoffEntryId(entry.entryId));
    expect(entries, 'the advice reached a worker at all').toHaveLength(1);
    // THE CODER'S OWN CONTINUATION, not the architect's task and not the review.
    expect(entries[0]!.taskIds, 'scoped to the coder\'s own continuation').toEqual(['segment:build-1:2:task']);
    expect(entries[0]!.kind).toBe('HANDOFF');
  });

  it('2. and it carries the advice, not a reference to it', async () => {
    const harness = guidanceRound();
    await drain(harness);
    const text = (await harness.store.brainEntriesForRun('run-1', 'prj-1'))
      .find((entry) => isJuliusGuidanceHandoffEntryId(entry.entryId))!.text;
    expect(text).toContain('call the existing reader instead of allocating a second buffer');
    expect(text).toContain('do not widen the public API');
    expect(text).toContain('is 8KiB a requirement or an accident?');
  });

  it('3. the row says who the advice is FOR, and a second row says when it reached them', async () => {
    // A packet is issued as a PROPOSAL and delivered only when Julius accepts
    // its review, so "who it is for" and "who read it" are two facts on two
    // rows. They were one, and a packet the reviewer went on to reject had
    // already been handed over.
    const harness = guidanceRound();
    await drain(harness);
    const issued = factsOf(harness, 'guidance.issued');
    expect(issued).toHaveLength(1);
    expect(issued[0]!.proposedTo).toBe('segment:build-1:2:task');
    const delivered = factsOf(harness, 'guidance.delivered');
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.deliveredTo).toBe('segment:build-1:2:task');
  });

  it('4. and says so as NULL rather than absent when nothing was waiting', async () => {
    /**
     * THE GUIDANCE TASK EXISTS AND ITS CONTINUATION DOES NOT. A pause is several
     * writes; a process that dies after the guidance task is written and before
     * the continuation is leaves the architect answering a question no worker is
     * waiting on — advice nobody can read, which is a fact about the run. A
     * MISSING field would be a third state a reader cannot tell from either.
     *
     * (This used to be reached through the segment ceiling, which minted the
     * guidance task before checking it. The ceiling is now checked before
     * anything is bought, so the crash is the honest way to reach the state.)
     */
    const harness = build({
      coderScript: [{ kind: 'succeed', guidanceRequest: REQUEST }, { kind: 'succeed' }],
      architectScript: [
        { kind: 'succeed', evidence: PLAN_EVIDENCE },
        { kind: 'succeed', evidence: PLAN_EVIDENCE, guidance: GUIDANCE },
      ],
    });
    const addTask = harness.store.addTask.bind(harness.store);
    let crashed = false;
    (harness.store as { addTask: typeof addTask }).addTask = async (input) => {
      if (!crashed && input.commandId.startsWith('segment:')) {
        crashed = true;
        throw new Error('process died between the guidance task and its continuation');
      }
      return addTask(input);
    };
    for (let index = 0; index < 24; index += 1) {
      let report;
      try { report = await harness.loop.tick(scope); } catch { continue; }
      if (report.claimed === 0) {
        const advance = await harness.loop.advanceRun('run-1', 'prj-1');
        if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
      }
    }
    expect(crashed, 'the crash window was reached').toBe(true);

    const issued = factsOf(harness, 'guidance.issued');
    // NOT VACUOUS. A loop over no rows would pass whatever the field did.
    expect(issued, 'the architect did issue guidance').toHaveLength(1);
    expect(Object.hasOwn(issued[0]!, 'proposedTo'), 'the field is always present').toBe(true);
    expect(issued[0]!.proposedTo, 'and it was for nobody').toBeNull();
    expect(factsOf(harness, 'guidance.delivered'), 'so nothing was delivered').toEqual([]);
    expect((await harness.store.brainEntriesForRun('run-1', 'prj-1'))
      .filter((entry) => isJuliusGuidanceHandoffEntryId(entry.entryId)), 'nothing was handed over').toHaveLength(0);
  });

  it('5. the entry id carries the revision, so a second packet is a second entry', () => {
    // `appendBrainEntry` is idempotent per id. Without the revision, a revised
    // packet would be silently dropped and the coder would read the first
    // advice forever while the record said a second was issued.
    expect(juliusGuidanceHandoffEntryId('segment:build-1:2:task', 1))
      .not.toBe(juliusGuidanceHandoffEntryId('segment:build-1:2:task', 2));
    expect(isJuliusGuidanceHandoffEntryId(juliusGuidanceHandoffEntryId('segment:build-1:2:task', 2))).toBe(true);
    expect(isJuliusGuidanceHandoffEntryId('brain:segment-resume:segment:build-1:2:task')).toBe(false);
    expect(isJuliusGuidanceHandoffEntryId('brain:research-answer:segment:build-1:2:task')).toBe(false);
  });
});

/* ============================================= B the waiting segment lookup */

describe('B — which segment is waiting is read, never computed', () => {
  const segment = (over: Partial<JuliusTask> & Pick<JuliusTask, 'taskId'>): JuliusTask => ({
    missionId: 'msn-1', parentTaskId: 'build-1', dependencyIds: ['build-1'],
    requiredEvidenceTypes: [], taskType: 'build', role: 'CODING_AGENT', ordinal: 3,
    state: 'BLOCKED', ...over,
  });

  it('6. the one BLOCKED segment depending on the subject', () => {
    const tasks = [segment({ taskId: 'segment:build-1:2:task' })];
    expect(pendingSegmentFor('build-1', tasks)?.taskId).toBe('segment:build-1:2:task');
  });

  it('7. nothing waiting is null, not a guess', () => {
    expect(pendingSegmentFor('build-1', [])).toBeNull();
    expect(pendingSegmentFor('build-1', [segment({ taskId: 'segment:build-1:2:task', state: 'SUCCEEDED' })])).toBeNull();
  });

  it('8. a segment of another subject is not this subject\'s', () => {
    expect(pendingSegmentFor('build-2', [segment({ taskId: 'segment:build-1:2:task' })])).toBeNull();
  });

  it('9. two waiting segments is a shape nobody built, and is not resolved by guessing', () => {
    // Picking the likelier one would be Julius deciding which pause an answer
    // belonged to. Null, and the caller records that nothing was delivered.
    const tasks = [
      segment({ taskId: 'segment:build-1:2:task' }),
      segment({ taskId: 'segment:build-1:2:task' }),
    ];
    expect(pendingSegmentFor('build-1', tasks)).toBeNull();
  });

  it('10. a BLOCKED task that is not a segment is not a continuation', () => {
    const review: JuliusTask = {
      taskId: 'review:build-1', missionId: 'msn-1', parentTaskId: 'build-1',
      dependencyIds: ['build-1'], requiredEvidenceTypes: [], taskType: 'review:build',
      role: 'INDEPENDENT_REVIEWER', ordinal: 2, state: 'BLOCKED',
    };
    expect(pendingSegmentFor('build-1', [review])).toBeNull();
  });
});

/* ================================================== C the rendered handoff */

describe('C — the advice is rendered bounded, and truncation says so', () => {
  const packet = (over: Partial<JuliusGuidancePacket> = {}): JuliusGuidancePacket => ({
    version: 'julius-guidance-packet.v1',
    guidanceId: 'guidance:build-1:1', runId: 'run-1', taskId: 'build-1',
    binding: { contractRevision: 1, bindingDigest: 'sha256:abc' },
    revision: 1, triggeringCheckpointId: 'checkpoint:build-1:1',
    subObjective: 'Reuse the reader.',
    relevantRequirements: ['R1'], relevantConstraints: ['no new dependency'],
    repositoryFindings: ['it already buffers'], runtimeFindings: ['8KiB exactly'],
    references: [{ kind: 'REPOSITORY', locator: 'journal.ts:120', retrievedAt: '2026-09-10T20:59:00.000Z', trust: 'CORROBORATED' }],
    recommendedActions: ['call the reader'], additionalProhibitions: ['do not widen the API'],
    affectedCriterionIds: [], unresolvedQuestions: ['is 8KiB a requirement?'],
    packetDigest: 'sha256:def',
    ...over,
  } as JuliusGuidancePacket);

  it('11. it says the contract is unchanged, in the text the coder reads', () => {
    const text = renderJuliusGuidanceHandoff(packet());
    expect(text).toContain('It is ADVICE');
    expect(text).toContain('The Mission Contract is unchanged');
    expect(text).toContain('narrows');
  });

  it('12. every populated section appears, and an empty one does not', () => {
    const text = renderJuliusGuidanceHandoff(packet({ runtimeFindings: [], references: [] }));
    expect(text).toContain('RECOMMENDED ACTIONS');
    expect(text).toContain('STILL UNRESOLVED');
    expect(text).not.toContain('WHAT THE ARCHITECT FOUND AT RUNTIME');
    expect(text).not.toContain('REFERENCES');
  });

  it('13. it is bounded', () => {
    const huge = Array.from({ length: 40 }, (_, index) => `action ${String(index)} ${'x'.repeat(500)}`);
    const text = renderJuliusGuidanceHandoff(packet({ recommendedActions: huge }));
    expect(text.length).toBeLessThanOrEqual(JULIUS_GUIDANCE_HANDOFF_CHARS + 400);
  });

  it('14. and a cut SAYS SO rather than leaving a coder to believe it read everything', () => {
    const huge = Array.from({ length: 40 }, (_, index) => `action ${String(index)} ${'x'.repeat(500)}`);
    const text = renderJuliusGuidanceHandoff(packet({ recommendedActions: huge }));
    expect(text).toContain('did not fit this packet and were not included');
    expect(text).toContain('in the durable record');
  });

  it('15. the revision and the checkpoint it answers are in the header', () => {
    const text = renderJuliusGuidanceHandoff(packet({ revision: 3 }));
    expect(text).toContain('revision 3');
    expect(text).toContain('checkpoint:build-1:1');
  });
});

/* ============================================== D the number it makes true */

describe('D — guidanceConsumed is a measurement now, and only because of the above', () => {
  it('16. the continuation that was handed guidance reports consuming it', async () => {
    const harness = guidanceRound();
    await drain(harness);
    const rows = factsOf(harness, 'worker.effort')
      .filter((facts) => facts.taskType === 'build');
    const continuation = harness.store.events()
      .filter((event) => event.type === 'worker.effort' && event.taskId === 'segment:build-1:2:task')
      .map((event) => event.facts);
    expect(rows.length, 'the coder dispatched more than once').toBeGreaterThan(1);
    expect(continuation, 'the continuation ran').toHaveLength(1);
    expect(continuation[0]!.guidanceConsumed, 'and it was shown the advice').toBe(1);
  });

  it('17. the dispatch that asked reports consuming none, because it had not been answered yet', async () => {
    const harness = guidanceRound();
    await drain(harness);
    const asking = harness.store.events()
      .filter((event) => event.type === 'worker.effort' && event.taskId === 'build-1')
      .map((event) => event.facts);
    expect(asking).toHaveLength(1);
    expect(asking[0]!.guidanceConsumed).toBe(0);
  });

  it('18. a run with no guidance round measures zero, never unknown', async () => {
    const harness = build();
    await drain(harness);
    for (const facts of factsOf(harness, 'worker.effort')) {
      expect(typeof facts.guidanceConsumed).toBe('number');
      expect(facts.guidanceConsumed).toBe(0);
    }
  });

  it('19. it counts what the packet ADMITTED, not what existed', async () => {
    // Counted off `sourceEntryIds` — the entries the compiler admitted — so a
    // packet whose character budget dropped the advice reports that it carried
    // none. That is the truth about what the worker was shown.
    const source = readFileSync(resolve(import.meta.dirname, 'julius-task-pipeline.ts'), 'utf8');
    const handed = source.slice(source.indexOf('handed = {'), source.indexOf('guidanceConsumed: snapshot'));
    expect(handed).toContain('snapshot.sourceEntryIds');
    expect(source).toContain('guidanceConsumed: snapshot.sourceEntryIds.filter(isJuliusGuidanceHandoffEntryId).length');
  });

  it('20a. and both new facts reach the exported bundle', () => {
    // The third hop, and the one that has been missed before: a fact the
    // ledger writes and the dump never selects lives for the length of one
    // paid run and is then destroyed with the database.
    const dump = readFileSync(resolve(import.meta.dirname, '../../../../.github/julius-live-evidence-dump.sh'), 'utf8');
    expect(dump, 'the effort row exports what a worker was shown').toContain("'facts'->>'guidanceConsumed'");
    expect(dump, 'the guidance row exports who it reached').toContain("'facts'->>'deliveredTo'");
    expect(dump, 'and who it was proposed for before acceptance').toContain("'facts'->>'proposedTo'");
    expect(dump, 'and the delivery itself is selected').toContain("'julius.guidance.delivered'");
  });

  it('20. and it is a consequence of delivery, not a column filled in', () => {
    // If the delivery is ever removed, this number must go back to zero rather
    // than staying plausible. The one place it comes from is the entry id the
    // delivery writes.
    const source = readFileSync(resolve(import.meta.dirname, 'julius-task-pipeline.ts'), 'utf8');
    // The delivery moved to the accepting decision, and the count still comes
    // from the entry id that delivery writes.
    expect(source).toContain('juliusGuidanceHandoffEntryId(waiting.taskId, revision)');
    expect(source).toContain('renderJuliusGuidanceHandoff(packet)');
    expect(source).toContain('deliverAcceptedGuidance');
  });
});
