import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  cardPolicy, createJuliusHarness, seedTaskContractInto, task, verificationPolicy, worker,
  type JuliusHarness,
} from './julius-runtime-fixtures';
import { JULIUS_OPERATIONAL_EVENT_TYPES } from './julius-events';
import type { JuliusRunRow } from './julius-runtime-ports';

/**
 * THE RETRIEVAL THAT WAS PAID FOR AND LEFT NO TRACE.
 *
 * `driveResearchCheckpoint` awaits `deps.research.serve()` and only afterwards
 * appends its `research.retrieved` rows; the mediator's own settlement is an
 * in-process Map that writes nothing durable. So there was a window — between
 * the retrieval returning and its first row landing — in which a process that
 * died had SPENT with nothing at all on the record.
 *
 * WHAT THAT ACTUALLY COSTS, which is not what it looks like. The obvious guess
 * is a double charge: the restart asks again and pays twice. It does not, and
 * case 12 is the proof. The checkpoint is driven from `driveContinuousLifecycle`
 * on a result that is NOT a duplicate, once, after the dispatch that asked has
 * already ended and its task is SUCCEEDED. Nothing re-enters it. So the
 * retrieval is simply LOST: bought, unrecorded, its answer never delivered, the
 * continuation never minted, and the mission carrying on as though it had never
 * asked. The durable ledger — rebuilt from rows, and the only budget that
 * survives a restart — then counts one retrieval fewer than were bought. A
 * budget that over-counts is pessimistic. One that UNDER-counts can be
 * exceeded.
 *
 * AND NOTHING SAID SO. That is the part these cases repair. `research.attempted`
 * is written before a socket can exist, so the pair — an attempt with no
 * retrieval beside it — is the loss, visible in the bundle instead of inferred
 * from a gap nobody can see.
 *
 * WHAT IS DELIBERATELY NOT HERE. No re-entry guard. An earlier guard in this
 * place compared the CONTINUATION's id against the durable task rows and was
 * removed because it could never fire — `nextSegmentNumber` is the highest
 * existing segment plus one, so that id is new by construction. A guard against
 * a second serve would be the same mistake in a new place: case 12 shows there
 * is no second serve to guard. What was broken was the silence, and the silence
 * is what is fixed.
 */

/* ------------------------------------------------------------- the rig */

const ARCHITECT = worker({
  workerId: 'architect', role: 'PROMPT_ARCHITECT', providerId: 'openai', adapterId: 'architect-adapter',
  capabilities: ['plan'], taskTypes: ['plan', 'repair:plan'],
});
const CODER = worker({
  workerId: 'coder', role: 'CODING_AGENT', providerId: 'anthropic', adapterId: 'coder-adapter',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'],
});
const REVIEWER = worker({
  workerId: 'reviewer', role: 'INDEPENDENT_REVIEWER', providerId: 'hermes', adapterId: 'reviewer-adapter',
  capabilities: ['review'], taskTypes: ['review:plan', 'review:build', 'review:repair:plan', 'review:repair:build'],
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

const ASKS = Object.freeze([{
  source: 'web', capability: 'read_item',
  reference: 'https://docs.python.org/3/library/asyncio-task.html',
  purpose: 'Confirm when asyncio.timeout landed.',
}]);
const RESUME = Object.freeze({
  completedSoFar: ['read the journal reader'],
  nextIntent: 'write the normalizer',
});

type ServePort = Parameters<typeof createJuliusHarness>[0]['research'];

/** A port that counts what it was actually asked to retrieve. */
const countingPort = (over: { throwAfterServing?: boolean } = {}) => {
  const served: string[] = [];
  return {
    served,
    async serve(input: Parameters<NonNullable<ServePort>['serve']>[0]) {
      served.push(input.taskId);
      if (over.throwAfterServing === true) {
        // THE RETRIEVAL HAPPENED AND THE ANSWER NEVER ARRIVED. Indistinguishable
        // from a crash in the same place, which is the point: the guard cannot
        // tell them apart and must not try.
        throw new Error('the transport died holding the answer');
      }
      return input.asks.map((ask) => ({
        outcome: 'observed' as const,
        reference: ask.reference, purpose: ask.purpose,
        rendered: '<<<RELAY-EVIDENCE\nasyncio.timeout landed in 3.11.\nRELAY-EVIDENCE>>>',
        detail: 'The source answered.',
        evidenceId: 'ev-research-1',
        injectionSignals: [],
        mayCorroborate: true,
      }));
    },
  };
};

/** The coder asks once and, answered, finishes. */
const ASK_ONCE = [
  { kind: 'succeed' as const, researchAsks: ASKS, segmentResume: RESUME },
  { kind: 'succeed' as const },
];
/**
 * THE SAME QUESTION TWICE, because a coder that never got an answer asks again
 * — which is exactly the behaviour that used to buy the answer twice.
 */
const ASK_TWICE = [
  { kind: 'succeed' as const, researchAsks: ASKS, segmentResume: RESUME },
  { kind: 'succeed' as const, researchAsks: ASKS, segmentResume: RESUME },
  { kind: 'succeed' as const },
];

const build = (input: {
  research?: ServePort;
  asksTwice?: boolean;
} = {}): JuliusHarness => {
  const harness = createJuliusHarness({
    workers: [
      { worker: ARCHITECT, script: [{ kind: 'succeed', evidence: PLAN_EVIDENCE }] },
      { worker: CODER, script: input.asksTwice === true ? ASK_TWICE : ASK_ONCE },
      { worker: REVIEWER, script: [{ kind: 'succeed', evidence: PASSED_REVIEW }] },
    ],
    card: cardPolicy({
      allowedProviders: [ARCHITECT.providerId, CODER.providerId, REVIEWER.providerId],
      capabilities: ['plan', 'implement', 'review'],
    }),
    verification: verificationPolicy({ reviewerRequired: true, maxRepairRounds: 2 }),
    capabilityFor,
    ...(input.research === undefined ? {} : { research: input.research }),
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
    let report;
    try {
      report = await harness.loop.tick(scope);
    } catch {
      // A dispatch that threw. The durable rows are what these cases read, and
      // a thrown tick is exactly the shape a crashed process leaves behind.
      return;
    }
    if (report.claimed === 0) {
      const advance = await harness.loop.advanceRun('run-1', 'prj-1');
      if (advance === null || (!advance.changed && advance.resumedVerifications === 0)) break;
    }
  }
}

/**
 * THE RESTART. The lost process held a lease; nothing can re-claim the task
 * until it expires, which in production is a clock and here is one call.
 * `tick` runs the recovery sweep before it claims, so the next drain picks the
 * task back up exactly as a restarted bridge does.
 */
const restart = (harness: JuliusHarness): void => { harness.clock.advance(120_000); };

const factsOf = (harness: JuliusHarness, type: string) =>
  harness.store.events().filter((event) => event.type === type).map((event) => event.facts);

/* ================================================== A the loss, end to end */

describe('A — a retrieval that vanished leaves the record saying so', () => {
  it('1. THE WINDOW: serve() is paid for and its rows never land', async () => {
    const research = countingPort();
    const harness = build({ research });
    // A store write that fails and a process that dies before issuing it leave
    // the same thing behind: nothing.
    const appendEvent = harness.store.appendEvent.bind(harness.store);
    harness.store.appendEvent = async (event: Parameters<typeof appendEvent>[0]) => {
      if (event.type === 'research.retrieved') throw new Error('the process died here');
      return appendEvent(event);
    };
    await drain(harness);

    expect(research.served, 'the retrieval happened and was paid for').toHaveLength(1);
    expect(factsOf(harness, 'research.retrieved'), 'and the charge never landed').toHaveLength(0);
  });

  it('2. and the attempt stands alone, which is what makes the loss visible', async () => {
    const harness = build({ research: countingPort() });
    const appendEvent = harness.store.appendEvent.bind(harness.store);
    harness.store.appendEvent = async (event: Parameters<typeof appendEvent>[0]) => {
      if (event.type === 'research.retrieved') throw new Error('the process died here');
      return appendEvent(event);
    };
    await drain(harness);

    const attempted = factsOf(harness, 'research.attempted');
    expect(attempted, 'the attempt is on the record').toHaveLength(1);
    expect(attempted[0]!.attemptKey).toBe('checkpoint:research:build-1:2');
    expect(attempted[0]!.askCount).toBe(1);
    expect(attempted[0]!.role).toBe('CODING_AGENT');
    // THE PAIR IS THE FINDING. One attempt, no charge: a retrieval nobody can
    // account for, which before this row was indistinguishable from a mission
    // that never asked.
    expect(factsOf(harness, 'research.retrieved')).toHaveLength(0);
  });

  it('3. the answer is lost too — no continuation is minted', async () => {
    const harness = build({ research: countingPort() });
    const appendEvent = harness.store.appendEvent.bind(harness.store);
    harness.store.appendEvent = async (event: Parameters<typeof appendEvent>[0]) => {
      if (event.type === 'research.retrieved') throw new Error('the process died here');
      return appendEvent(event);
    };
    await drain(harness);
    expect(harness.store.taskRow('segment:build-1:2:task'), 'the segment that would carry the answer').toBeNull();
  });

  it('4. a transport that dies holding the answer leaves the same record', async () => {
    const research = countingPort({ throwAfterServing: true });
    const harness = build({ research });
    await drain(harness);
    expect(research.served).toHaveLength(1);
    expect(factsOf(harness, 'research.attempted')).toHaveLength(1);
    expect(factsOf(harness, 'research.retrieved')).toHaveLength(0);
  });

  it('5. a healthy run pairs its attempt with the charges it produced', async () => {
    const research = countingPort();
    const harness = build({ research });
    await drain(harness);

    expect(research.served).toHaveLength(1);
    const attempted = factsOf(harness, 'research.attempted');
    const retrieved = factsOf(harness, 'research.retrieved');
    expect(attempted).toHaveLength(1);
    expect(retrieved).toHaveLength(1);
    // THE KEY IS THE JOIN. One string on both rows, so a reader pairs a charge
    // with the attempt that authorised it without parsing anything.
    expect(retrieved[0]!.attemptKey).toBe(attempted[0]!.attemptKey);
    expect(harness.store.taskRow('segment:build-1:2:task')).not.toBeNull();
  });

  it('6. the attempt is written BEFORE the retrieval, or it could not be the scar', async () => {
    const harness = build({ research: countingPort() });
    await drain(harness);
    const types = harness.store.events().map((event) => event.type);
    expect(types.indexOf('research.attempted')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('research.attempted')).toBeLessThan(types.indexOf('research.retrieved'));
  });

  it('7. the attempt key IS the checkpoint id, not a second identifier to keep in step', async () => {
    const harness = build({ research: countingPort() });
    await drain(harness);
    const recorded = factsOf(harness, 'checkpoint.recorded')
      .filter((facts) => facts.trigger === 'RESEARCH_REQUESTED');
    expect(factsOf(harness, 'research.attempted')[0]!.attemptKey).toBe(recorded[0]!.checkpointId);
  });

  it('8. one attempt per serve, whatever the segment number is', async () => {
    // The continuation may ask again; each ask is its own attempt under its own
    // key, so the pairs never blur into one another.
    const research = countingPort();
    const harness = build({ research, asksTwice: true });
    await drain(harness);
    const keys = factsOf(harness, 'research.attempted').map((facts) => facts.attemptKey);
    expect(research.served.length).toBe(keys.length);
    expect(new Set(keys).size, 'every attempt has its own key').toBe(keys.length);
  });
});

/* ================================================= B there is no second spend */

describe('B — the loss is not a double charge, and the record must not imply one', () => {
  it('9. the task that asked is already SUCCEEDED when the retrieval is made', async () => {
    // Which is why nothing re-asks: the dispatch has ended. Stated as a fact
    // about the rig rather than an assumption behind the cases above.
    const harness = build({ research: countingPort() });
    const appendEvent = harness.store.appendEvent.bind(harness.store);
    harness.store.appendEvent = async (event: Parameters<typeof appendEvent>[0]) => {
      if (event.type === 'research.retrieved') throw new Error('the process died here');
      return appendEvent(event);
    };
    await drain(harness);
    expect(harness.store.taskRow('build-1')!.state).toBe('SUCCEEDED');
  });

  it('10. a recovery sweep does not buy the lost retrieval again', async () => {
    const first = countingPort();
    const harness = build({ research: first, asksTwice: true });
    const appendEvent = harness.store.appendEvent.bind(harness.store);
    harness.store.appendEvent = async (event: Parameters<typeof appendEvent>[0]) => {
      if (event.type === 'research.retrieved') throw new Error('the process died here');
      return appendEvent(event);
    };
    await drain(harness);
    expect(first.served).toHaveLength(1);

    // The process comes back: same store, same rows, a working transport, and
    // enough clock for any lease to have expired.
    harness.store.appendEvent = appendEvent;
    const second = countingPort();
    harness.deps.research!.serve = second.serve;
    restart(harness);
    await drain(harness);

    expect(second.served, 'nothing re-entered the checkpoint').toHaveLength(0);
  });

  it('11. and the run does not stall waiting for an answer that is never coming', async () => {
    // The loss is a loss, not a deadlock. A mission is never stalled on a
    // question Julius has no way to answer — the same rule `RESEARCH_UNSERVED`
    // holds — so the record must show the run reaching an ending.
    const harness = build({ research: countingPort() });
    const appendEvent = harness.store.appendEvent.bind(harness.store);
    harness.store.appendEvent = async (event: Parameters<typeof appendEvent>[0]) => {
      if (event.type === 'research.retrieved') throw new Error('the process died here');
      return appendEvent(event);
    };
    await drain(harness);
    harness.store.appendEvent = appendEvent;
    restart(harness);
    await drain(harness);
    expect(harness.store.events().some((event) => event.type === 'run.completed')).toBe(true);
  });

  it('12. THE PREMISE, CHECKED IN THE SOURCE: the checkpoint runs once per result', () => {
    // The whole reason no re-entry guard is here. If this gate ever goes, a
    // replayed result would drive the checkpoint again and a second retrieval
    // WOULD be bought — and this case is what says so.
    const pipeline = readFileSync(resolve(import.meta.dirname, 'julius-task-pipeline.ts'), 'utf8');
    const call = pipeline.slice(
      pipeline.indexOf('3b. the continuous three-worker lifecycle'),
      pipeline.indexOf('await driveContinuousLifecycle({'),
    );
    expect(call).toContain('!outcome.duplicate');
  });
});

/* ==================================================== D reaching the record */

describe('D — the attempt reaches the bundle', () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const read = (relative: string): string => readFileSync(resolve(root, relative), 'utf8');

  it('13. research.attempted is a registered operational event', () => {
    expect(JULIUS_OPERATIONAL_EVENT_TYPES).toContain('research.attempted');
  });

  it('14. the evidence dump selects the attempt, its key and its size', () => {
    const dump = read('.github/julius-live-evidence-dump.sh');
    const query = dump.split('\n').find((line) => line.startsWith('dump "SELECT') && line.includes('research.tsv')) ?? '';
    expect(query, 'the research dump must exist').not.toBe('');
    expect(query).toContain("'julius.research.attempted'");
    for (const fact of ['attemptKey', 'askCount']) {
      expect(query, `${fact} must reach research.tsv`).toContain(`'facts'->>'${fact}'`);
    }
  });

  it('15. the passage claims no protection it does not provide', () => {
    // The two claims this change is most likely to grow into, and cannot
    // support: that the retrieval is exactly-once, and that something guards
    // against a second one. It records a loss; it prevents nothing.
    const pipeline = readFileSync(resolve(import.meta.dirname, 'julius-task-pipeline.ts'), 'utf8');
    const passage = pipeline.slice(
      pipeline.indexOf('THE ATTEMPT, WRITTEN BEFORE THE SPEND'),
      pipeline.indexOf('const observations = await deps.research.serve('),
    );
    expect(passage.length, 'the passage must be found').toBeGreaterThan(400);
    expect(passage.toLowerCase()).not.toContain('exactly once');
    expect(passage.toLowerCase()).not.toContain('exactly-once');
    // And it says what it is not, in its own words, so the limit survives an
    // edit by someone who only reads this one comment.
    expect(passage).toContain('does not make the retrieval recoverable');
    expect(passage).toContain('CANNOT re-enter');
  });

  it('16. no re-entry guard was left behind for a re-entry that cannot happen', () => {
    // The failure mode this file exists to avoid repeating: a guard whose
    // branch can never be taken, with a comment claiming it protects something.
    const pipeline = readFileSync(resolve(import.meta.dirname, 'julius-task-pipeline.ts'), 'utf8');
    expect(pipeline).not.toContain('RESEARCH_ATTEMPT_UNCONFIRMED');
    expect(pipeline).not.toContain('researchAttemptUnconfirmed');
  });
});

/* ================================================ E why a refusal was refused */

/**
 * PAID RUN 34757974058 wrote four `research.retrieved` rows reading
 * `policy_refused` with an empty `reason_code` and no target. The mediator knew
 * which wall each ask hit; the row did not carry it. These cases hold the row
 * to what the port said, and to null where the port said nothing.
 */
describe('E — a refused ask\'s row says why and at what', () => {
  const refusingPort = (record: Record<string, unknown>) => ({
    async serve(input: Parameters<NonNullable<ServePort>['serve']>[0]) {
      return input.asks.map((ask) => ({
        outcome: 'policy_refused' as const,
        reference: ask.reference, purpose: ask.purpose,
        rendered: null,
        detail: 'This mission does not authorize that retrieval.',
        evidenceId: null,
        injectionSignals: [],
        mayCorroborate: false,
        ...record,
      }));
    },
  });

  it('17. the row carries the refusal, Live Reach\'s own reason and the ask\'s class and host', async () => {
    const harness = build({
      research: refusingPort({
        refusal: 'capability_unavailable',
        reachRefusal: 'not_ready',
        requested: { source: 'web', capability: 'read_item', host: 'docs.python.org' },
      }),
    });
    await drain(harness);
    const retrieved = factsOf(harness, 'research.retrieved');
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]).toMatchObject({
      outcome: 'policy_refused',
      counted: false,
      reasonCode: 'capability_unavailable',
      reachRefusal: 'not_ready',
      requestedSource: 'web',
      requestedCapability: 'read_item',
      requestedHost: 'docs.python.org',
    });
  });

  it('18. a port that does not say leaves every one of them null, never a guessed reason', async () => {
    const harness = build({ research: refusingPort({}) });
    await drain(harness);
    const retrieved = factsOf(harness, 'research.retrieved');
    expect(retrieved).toHaveLength(1);
    for (const fact of ['reasonCode', 'reachRefusal', 'requestedSource', 'requestedCapability', 'requestedHost']) {
      expect(retrieved[0]![fact], fact).toBeNull();
    }
  });

  /**
   * THE PATH IS RECORDED SINCE QUALIFICATION ATTEMPT 4 (run 34774471909), whose
   * one served read could not be identified from its host alone. The row carries
   * the path the port reduced (no query, no fragment, token-shaped segments
   * scrubbed), and still never the reference as written or the purpose.
   */
  it('19. the row carries the port\'s reduced path, and never the reference as written or its purpose', async () => {
    const harness = build({
      research: refusingPort({
        refusal: 'host_not_allowed', reachRefusal: null,
        requested: { source: 'web', capability: 'read_item', host: 'docs.python.org', path: '/3/library/asyncio-task.html' },
      }),
    });
    await drain(harness);
    const rows = factsOf(harness, 'research.retrieved');
    expect(rows[0]?.resourcePath).toBe('/3/library/asyncio-task.html');
    const row = JSON.stringify(rows);
    expect(row).not.toContain(ASKS[0]!.reference);
    expect(row).not.toContain(ASKS[0]!.purpose);
  });

  it('20. the evidence dump exports all five', () => {
    const dump = readFileSync(resolve(import.meta.dirname, '../../../..', '.github/julius-live-evidence-dump.sh'), 'utf8');
    const query = dump.split('\n').find((line) => line.startsWith('dump "SELECT') && line.includes('research.tsv')) ?? '';
    for (const [fact, column] of [
      ['reasonCode', 'reason_code'], ['reachRefusal', 'reach_refusal'], ['requestedSource', 'requested_source'],
      ['requestedCapability', 'requested_capability'], ['requestedHost', 'requested_host'],
      // The bytes the ledger was charged, and that they were recorded: the research budget is rebuilt from these.
      ['bytes', 'bytes'], ['bytesRecorded', 'bytes_recorded'],
      // Which page, what came back and where it went: the delivery provenance.
      ['askOrdinal', 'ask_ordinal'], ['resourcePath', 'resource_path'], ['mechanism', 'mechanism'],
      ['contentDigest', 'content_digest'], ['readableChars', 'readable_chars'], ['deliveredFrom', 'delivered_from'],
      ['deliveredChars', 'delivered_chars'], ['deliveryCut', 'delivery_cut'], ['deliveryAnchor', 'delivery_anchor'],
      ['handoffTaskId', 'handoff_task_id'], ['handoffEntryId', 'handoff_entry_id'],
    ] as const) {
      expect(query, `${fact} must reach research.tsv as ${column}`).toContain(`'facts'->>'${fact}' AS ${column},`);
    }
  });
});

/**
 * THE LAST LINK, AND ITS NEGATIVE. Qualification attempt 4 (run 34774471909)
 * served a page, and nothing on the record could say whether the continuation's
 * packet held it — it did not. `context.compiled` now answers for a research
 * continuation: true when the answer entry is in the packet, false when the
 * compiler had to leave it out, and null for a task that is not one.
 */
describe('F — the record says whether the answer reached the continuation packet', () => {
  const answering = (rendered: string) => ({
    async serve(input: Parameters<NonNullable<ServePort>['serve']>[0]) {
      return input.asks.map((ask) => ({
        outcome: 'observed' as const, reference: ask.reference, purpose: ask.purpose,
        rendered, detail: 'The source answered.', evidenceId: 'ev-research-1', injectionSignals: [], mayCorroborate: true,
      }));
    },
  });
  const compiledFor = (harness: JuliusHarness) => harness.store.events()
    .filter((event) => event.type === 'context.compiled')
    .map((event) => ({ taskId: String(event.taskId), included: event.facts.researchAnswerIncluded, truncated: event.facts.truncated }));

  it('21. an answer that fits is recorded as included; tasks that are not continuations record null', async () => {
    const harness = build({ research: answering('<<<RELAY-EVIDENCE\nshort.\nRELAY-EVIDENCE>>>') });
    await drain(harness);
    const rows = compiledFor(harness);
    expect(rows.filter((row) => /^segment:.+:[0-9]+:task$/u.test(row.taskId)).map((row) => row.included)).toEqual([true]);
    expect(rows.filter((row) => !/^segment:.+:[0-9]+:task$/u.test(row.taskId)).every((row) => row.included === null)).toBe(true);
  });

  it('22. an answer the compiler could not fit is recorded as NOT included, never assumed delivered', async () => {
    // The rig compiles 4,000 characters; this answer alone is 6,000.
    const harness = build({ research: answering(`<<<RELAY-EVIDENCE\n${'x'.repeat(6_000)}\nRELAY-EVIDENCE>>>`) });
    await drain(harness);
    const continuation = compiledFor(harness).filter((row) => /^segment:.+:[0-9]+:task$/u.test(row.taskId));
    expect(continuation.map((row) => [row.included, row.truncated])).toEqual([[false, true]]);
  });
});
