/**
 * ONE CONTRACT FOR WRITING A DECISION, RUN AGAINST EVERY STORE THAT CLAIMS IT.
 *
 * A verification decision, the tasks it releases, and the events that explain
 * both are ONE durable write. They were not: the events were appended after
 * the decision's write returned, so a process that died in between left the
 * decision and the release standing with nothing in the ledger to explain
 * either — permanently, because the resume sweep skips a task that already has
 * a decision, so nothing ever wrote them afterwards. The run's history could
 * not say a verification had been decided, or that a task had become
 * claimable, while the rows saying exactly that sat beside it.
 *
 * These cases are the contract. They are written once and run twice: against
 * the in-memory store, and against real PostgreSQL in CI. A store that passes
 * one and fails the other is the drift this file exists to stop.
 */

import type { JuliusOperationalEvent, JuliusVerificationDecision } from '../mission/julius';

export interface JuliusDecisionWriteStore {
  /** True when this call recorded the decision; false when it was already there. */
  appendDecision(input: {
    decisionId: string; runId: string; taskId: string; policyRevision: string;
    idempotencyKey: string; occurredAt: string; decision: JuliusVerificationDecision;
    releaseTaskIds?: readonly string[];
    events?: readonly JuliusOperationalEvent[];
  }): Promise<boolean>;
  /** How many decisions this run holds for that task. */
  decisionsFor(taskId: string): Promise<number>;
  /** How many event rows carry this event id. */
  rowsFor(eventId: string): Promise<number>;
  /** The state the store holds for a task. */
  stateOf(taskId: string): Promise<string | null>;
}

export interface JuliusDecisionWriteCase {
  readonly name: string;
  run(store: JuliusDecisionWriteStore, build: {
    decision: (over?: Partial<JuliusVerificationDecision>) => JuliusVerificationDecision;
    event: (over?: Partial<JuliusOperationalEvent>) => JuliusOperationalEvent;
    /** The task seeded BLOCKED, which an accepting decision may release. */
    readonly blockedTaskId: string;
    readonly subjectTaskId: string;
  }): Promise<void>;
}

const fail = (message: string): never => { throw new Error(`decision write contract: ${message}`); };
const equal = (actual: unknown, expected: unknown, message: string): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${message} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

export const JULIUS_DECISION_WRITE_CASES: readonly JuliusDecisionWriteCase[] = Object.freeze([
  {
    name: 'a decision records, and the events that explain it are there with it',
    async run(store, build) {
      const event = build.event({ eventId: 'decided:1' });
      const recorded = await store.appendDecision({
        decisionId: 'decision:1', runId: 'run-1', taskId: build.subjectTaskId, policyRevision: 'v1',
        idempotencyKey: 'key:1', occurredAt: '2099-01-01T00:00:00.000Z', decision: build.decision(),
        events: [event],
      });
      equal(recorded, true, 'the decision was not recorded');
      equal(await store.decisionsFor(build.subjectTaskId), 1, 'the decision is not readable');
      equal(await store.rowsFor('decided:1'), 1, 'the event that explains the decision is not in the ledger');
    },
  },
  {
    name: 'the release and its announcement land with the decision',
    async run(store, build) {
      await store.appendDecision({
        decisionId: 'decision:2', runId: 'run-1', taskId: build.subjectTaskId, policyRevision: 'v1',
        idempotencyKey: 'key:2', occurredAt: '2099-01-01T00:00:00.000Z', decision: build.decision(),
        releaseTaskIds: [build.blockedTaskId],
        events: [build.event({ eventId: 'runnable:1', type: 'task.runnable', taskId: build.blockedTaskId })],
      });
      equal(await store.stateOf(build.blockedTaskId), 'RUNNABLE', 'the released task did not move');
      equal(await store.rowsFor('runnable:1'), 1, 'the task became runnable and the ledger does not say so');
    },
  },
  {
    name: 'a duplicate decision writes nothing at all — not the decision, not its events',
    async run(store, build) {
      const first = build.event({ eventId: 'decided:3' });
      await store.appendDecision({
        decisionId: 'decision:3', runId: 'run-1', taskId: build.subjectTaskId, policyRevision: 'v1',
        idempotencyKey: 'key:3', occurredAt: '2099-01-01T00:00:00.000Z', decision: build.decision(), events: [first],
      });
      // The same decision, reached again by another process: a different
      // decision id, the same idempotency key, and — because the ids are
      // derived from that key — the same events.
      const again = await store.appendDecision({
        decisionId: 'decision:3b', runId: 'run-1', taskId: build.subjectTaskId, policyRevision: 'v1',
        idempotencyKey: 'key:3', occurredAt: '2099-02-02T00:00:00.000Z', decision: build.decision(), events: [first],
      });
      equal(again, false, 'a repeated decision was recorded a second time');
      equal(await store.decisionsFor(build.subjectTaskId), 1, 'a repeated decision left two decision rows');
      equal(await store.rowsFor('decided:3'), 1, 'a repeated decision left two event rows');
    },
  },
  {
    name: 'a decision that records nothing releases nothing and announces nothing',
    async run(store, build) {
      await store.appendDecision({
        decisionId: 'decision:4', runId: 'run-1', taskId: build.subjectTaskId, policyRevision: 'v1',
        idempotencyKey: 'key:4', occurredAt: '2099-01-01T00:00:00.000Z', decision: build.decision(),
      });
      const again = await store.appendDecision({
        decisionId: 'decision:4b', runId: 'run-1', taskId: build.subjectTaskId, policyRevision: 'v1',
        idempotencyKey: 'key:4', occurredAt: '2099-01-01T00:00:00.000Z', decision: build.decision(),
        releaseTaskIds: [build.blockedTaskId],
        events: [build.event({ eventId: 'runnable:4', type: 'task.runnable', taskId: build.blockedTaskId })],
      });
      equal(again, false, 'the duplicate was recorded');
      equal(await store.stateOf(build.blockedTaskId), 'BLOCKED', 'a duplicate decision released a task');
      equal(await store.rowsFor('runnable:4'), 0, 'a duplicate decision announced a release it did not make');
    },
  },
  {
    name: 'many events explain one decision, and all of them are there',
    async run(store, build) {
      await store.appendDecision({
        decisionId: 'decision:5', runId: 'run-1', taskId: build.subjectTaskId, policyRevision: 'v1',
        idempotencyKey: 'key:5', occurredAt: '2099-01-01T00:00:00.000Z', decision: build.decision(),
        events: [
          build.event({ eventId: 'decided:5' }),
          build.event({ eventId: 'runnable:5a', type: 'task.runnable', taskId: build.blockedTaskId }),
          build.event({ eventId: 'runnable:5b', type: 'task.runnable', taskId: build.subjectTaskId }),
        ],
      });
      for (const eventId of ['decided:5', 'runnable:5a', 'runnable:5b']) {
        equal(await store.rowsFor(eventId), 1, `${eventId} is missing from the ledger`);
      }
    },
  },
  {
    name: 'a decision with no events is still a decision',
    async run(store, build) {
      const recorded = await store.appendDecision({
        decisionId: 'decision:6', runId: 'run-1', taskId: build.subjectTaskId, policyRevision: 'v1',
        idempotencyKey: 'key:6', occurredAt: '2099-01-01T00:00:00.000Z', decision: build.decision(), events: [],
      });
      equal(recorded, true, 'a decision carrying no events was refused');
      equal(await store.decisionsFor(build.subjectTaskId), 1, 'the decision is not readable');
    },
  },
]);
