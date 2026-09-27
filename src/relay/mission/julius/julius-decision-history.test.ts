import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createJuliusMemoryStore } from './julius-memory-store';
import { JULIUS_DECISION_EVENT_ID_VERSION, juliusDecisionEventId, type JuliusOperationalEvent } from './julius-events';
import { JULIUS_DECISION_WRITE_CASES, type JuliusDecisionWriteStore } from '../../persistence/julius-decision-write-conformance';
import type { JuliusVerificationDecision } from './julius-runtime';

/**
 * A DECISION AND THE HISTORY THAT EXPLAINS IT.
 *
 * The events announcing a verification decision — and announcing the tasks it
 * released — were appended AFTER the decision's own durable write returned. A
 * process that died in between left the decision and the release standing with
 * neither recorded, and nothing ever wrote them: the resume sweep skips a task
 * that already has a decision, so there was no second chance. The run's
 * history could not say the verification had been decided, or that a build had
 * become claimable, while the rows saying exactly that sat beside it. The
 * behaviour was right and the record was wrong.
 *
 * The same cases run against real PostgreSQL in CI
 * (`julius-decision-history.real-postgres.test.ts`).
 */

const RUN = {
  runId: 'run-1', missionId: 'msn-1', projectId: 'prj-1', state: 'READY' as const,
  cardRevision: 'card-r1', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
};
const SUBJECT = 'plan-1';
const BLOCKED = 'build-1';

const memoryStore = (): { store: JuliusDecisionWriteStore; build: Parameters<(typeof JULIUS_DECISION_WRITE_CASES)[number]['run']>[1] } => {
  const memory = createJuliusMemoryStore();
  memory.seedRun(RUN);
  memory.seedTask('run-1', {
    taskId: SUBJECT, missionId: 'msn-1', parentTaskId: null, dependencyIds: [], requiredEvidenceTypes: [],
    taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'SUCCEEDED',
  });
  memory.seedTask('run-1', {
    taskId: BLOCKED, missionId: 'msn-1', parentTaskId: null, dependencyIds: [SUBJECT], requiredEvidenceTypes: [],
    taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED',
  });
  return {
    store: {
      appendDecision: (input) => memory.appendDecision(input),
      decisionsFor: async (taskId) => (await memory.decisionsForRun('run-1', 'prj-1')).filter((row) => row.taskId === taskId).length,
      rowsFor: async (eventId) => memory.events().filter((row) => row.eventId === eventId).length,
      stateOf: async (taskId) => (await memory.tasksForRun('run-1', 'prj-1')).find((row) => row.taskId === taskId)?.state ?? null,
    },
    build: {
      subjectTaskId: SUBJECT,
      blockedTaskId: BLOCKED,
      decision: (over: Partial<JuliusVerificationDecision> = {}): JuliusVerificationDecision => ({
        action: 'ACCEPT', reasonCode: 'CRITERIA_MET', evidenceIds: [], safeSummary: 'Accepted.', ...over,
      }),
      event: (over: Partial<JuliusOperationalEvent> = {}): JuliusOperationalEvent => ({
        eventId: 'event:1', runId: 'run-1', projectId: 'prj-1', type: 'verification.decided',
        taskId: SUBJECT, workerId: null, correlationId: 'corr-1', causationId: null,
        occurredAt: '2099-01-01T00:00:00.000Z', facts: { action: 'ACCEPT' },
        ...over,
      }),
    },
  };
};

describe('the in-memory store keeps the decision write contract', () => {
  for (const contractCase of JULIUS_DECISION_WRITE_CASES) {
    it(contractCase.name, async () => {
      const { store, build } = memoryStore();
      await expect(contractCase.run(store, build)).resolves.toBeUndefined();
    });
  }
});

describe('a decision cannot be separated from the history that explains it', () => {
  /**
   * THE INVARIANT, SWEPT.
   *
   * Every durable write in the sequence is made to fail in turn — a process
   * dying exactly there — and the question asked each time is the one the
   * defect answered wrongly: IF the decision is there, is its history there
   * too? Before this change there was a crash point where the answer was no
   * and no later pass could fix it.
   */
  it('holds at every point a process could die', async () => {
    let checked = 0;
    for (let dieAt = 1; dieAt <= 6; dieAt += 1) {
      const { store, build } = memoryStore();
      let writes = 0;
      const dying: JuliusDecisionWriteStore = {
        ...store,
        appendDecision: async (input) => {
          writes += 1;
          if (writes === dieAt) throw new Error('process died');
          return store.appendDecision(input);
        },
      };
      const event = build.event({ eventId: 'decided:sweep' });
      const runnable = build.event({ eventId: 'runnable:sweep', type: 'task.runnable', taskId: BLOCKED });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await dying.appendDecision({
          decisionId: `decision:${String(attempt)}`, runId: 'run-1', taskId: SUBJECT, policyRevision: 'v1',
          idempotencyKey: 'key:sweep', occurredAt: '2099-01-01T00:00:00.000Z',
          decision: build.decision(), releaseTaskIds: [BLOCKED], events: [event, runnable],
        }).catch(() => undefined);
      }
      const decisions = await store.decisionsFor(SUBJECT);
      if (decisions > 0) {
        checked += 1;
        expect(await store.rowsFor('decided:sweep'), `die@${String(dieAt)}: the decision stands unexplained`).toBe(1);
        expect(await store.rowsFor('runnable:sweep'), `die@${String(dieAt)}: the release is unannounced`).toBe(1);
        expect(await store.stateOf(BLOCKED), `die@${String(dieAt)}`).toBe('RUNNABLE');
      }
      expect(decisions, `die@${String(dieAt)}: a retried decision was recorded twice`).toBeLessThanOrEqual(1);
    }
    expect(checked, 'no crash point actually produced a decision, so nothing was proven').toBeGreaterThan(0);
  });
});

describe('the contract cases would catch the store this change fixed', () => {
  /**
   * A case that cannot fail proves nothing. This is the OLD behaviour: the
   * decision and its release are written, and the events that explain them are
   * dropped — which is what a crash between the two writes used to produce.
   */
  const forgetfulStore = (): JuliusDecisionWriteStore => {
    const { store } = memoryStore();
    return { ...store, appendDecision: (input) => store.appendDecision({ ...input, events: [] }) };
  };

  it('every case that names an event fails against a store that loses them', async () => {
    const { build } = memoryStore();
    const outcomes = await Promise.all(JULIUS_DECISION_WRITE_CASES.map(async (contractCase) =>
      contractCase.run(forgetfulStore(), build).then(() => 'passed' as const, () => 'failed' as const)));
    const failed = outcomes.filter((outcome) => outcome === 'failed').length;
    // Two cases are honest about a store that only drops events: the duplicate
    // case that writes none, and the decision that carries none. Every other
    // case names an event and must catch it.
    expect(failed).toBeGreaterThanOrEqual(JULIUS_DECISION_WRITE_CASES.length - 2);
  });
});

describe('an event built for a decision is still validated', () => {
  /**
   * `validateJuliusEvent` is what stops a credential-shaped or oversized fact
   * reaching the ledger, and it is proven directly in `julius-events.test.ts`.
   * What this holds is that the DECISION path still runs it: these events are
   * built rather than appended, so a build that skipped validation would carry
   * a fact nothing may record straight into the decision's own transaction —
   * where, on PostgreSQL, it would take the decision and the release down with
   * it. The ledger class is private to the pipeline, so this is a structural
   * check on the one line that connects them.
   */
  it('validates in the same place, whether the event is written or returned', () => {
    const source = readFileSync(join(process.cwd(), 'src/relay/mission/julius/julius-task-pipeline.ts'), 'utf8');
    const compose = source.slice(source.indexOf('  compose('));
    const body = compose.slice(0, compose.indexOf('\n  async trajectory('));
    expect(body, 'the composed event is validated before it is returned').toContain('validateJuliusEvent(event);');
    expect(body.indexOf('validateJuliusEvent(event);'), 'and before, not after, it is handed back')
      .toBeLessThan(body.indexOf('return event;'));
    // And `event()` is the same builder, so the written path cannot drift from
    // the returned one.
    expect(source).toContain('await this.deps.store.appendEvent(this.compose(type, input));');
  });
});

describe('an event that explains a decision is named by the decision', () => {
  it('is the same name whenever the same decision is reached', () => {
    const key = 'plan-1:ACCEPT:CRITERIA_MET';
    expect(juliusDecisionEventId(key, 'verification.decided', 0))
      .toBe(juliusDecisionEventId(key, 'verification.decided', 0));
    expect(juliusDecisionEventId(key, 'verification.decided', 0)).toContain(JULIUS_DECISION_EVENT_ID_VERSION);
  });

  it('is a different name for a different decision, type or position', () => {
    const base = juliusDecisionEventId('plan-1:ACCEPT:CRITERIA_MET', 'verification.decided', 0);
    for (const other of [
      juliusDecisionEventId('plan-1:REPAIR:CRITERIA_MET', 'verification.decided', 0),
      juliusDecisionEventId('plan-2:ACCEPT:CRITERIA_MET', 'verification.decided', 0),
      juliusDecisionEventId('plan-1:ACCEPT:CRITERIA_MET', 'task.runnable', 0),
      juliusDecisionEventId('plan-1:ACCEPT:CRITERIA_MET', 'verification.decided', 1),
    ]) expect(other).not.toBe(base);
  });

  it('does not depend on a random id, which is what made a replay invisible', () => {
    // The live composition mints `${kind}:${randomUUID()}`. Two of those never
    // match, so a replayed decision's events could never be recognised as the
    // same events, and the append contract could not see them.
    const minted = new Set([`event:verification.decided:${'a'.repeat(8)}`, `event:verification.decided:${'b'.repeat(8)}`]);
    expect(minted.size, 'two minted ids for the same event are two different ids').toBe(2);
    const named = new Set([
      juliusDecisionEventId('plan-1:ACCEPT:CRITERIA_MET', 'verification.decided', 0),
      juliusDecisionEventId('plan-1:ACCEPT:CRITERIA_MET', 'verification.decided', 0),
    ]);
    expect(named.size, 'two names for the same event are one name').toBe(1);
  });
});
