import { describe, expect, it } from 'vitest';

import type { JuliusOperationalEvent, JuliusOperationalEventType } from '../julius/julius-events';
import { applyWonderlandOrdering, openWonderlandCursor } from './wonderland-ordering';
import { adoptWonderlandSnapshot, wonderlandRunSnapshot } from './wonderland-rehydration';
import {
  WONDERLAND_TERMINAL_VISUAL_STATES,
  produceWonderlandEnvelope,
  produceWonderlandEnvelopes,
} from './wonderland-envelope-producer';
import type { WonderlandLedgerRow } from './wonderland-ledger-adapter';

const PROJECT = 'project-alpha';
const RUN = 'run-1';

const event = (
  overrides: Partial<JuliusOperationalEvent> & { readonly type: JuliusOperationalEventType },
): JuliusOperationalEvent => ({
  eventId: 'event-1',
  runId: RUN,
  projectId: PROJECT,
  taskId: 'task-7',
  workerId: 'worker-3',
  correlationId: 'corr-1',
  causationId: null,
  occurredAt: '2026-09-08T00:00:00.000Z',
  facts: {},
  ...overrides,
});

const produce = (
  e: JuliusOperationalEvent,
  sequence = 5,
  revision = 3,
  identity?: Parameters<typeof produceWonderlandEnvelope>[0]['identity'],
) => produceWonderlandEnvelope({ event: e, sequence, revision, identity });

/* ------------------------------------------------------ the missing link */

describe('a real Julius event becomes an envelope', () => {
  it('reads the kernel state at its strongest precision', () => {
    // `run.transitioned` carries the kernel's own guarded state in `facts.to`,
    // which is the strongest of the three links.
    const produced = produce(event({ type: 'run.transitioned', facts: { to: 'EXECUTING' } }));
    expect(produced.ok).toBe(true);
    if (!produced.ok) return;
    expect(produced.envelope.state).toBe('coding');
    expect(produced.envelope.stateSource).toBe('julius_run_state');
    expect(produced.envelope.sourceState).toBe('EXECUTING');
  });

  it('falls back to the event name only when no finer link travelled', () => {
    const produced = produce(event({ type: 'review.started' }));
    expect(produced.ok).toBe(true);
    if (!produced.ok) return;
    expect(produced.envelope.state).toBe('independent_review');
    expect(produced.envelope.stateSource).toBe('event_type');
  });

  it('keeps the kernel event id, so a replay is still a duplicate', () => {
    // Minting a fresh id per delivery would make every retransmission look new
    // and defeat the duplicate check on the one path that needs it.
    const produced = produce(event({ type: 'run.completed', eventId: 'kernel-abc' }));
    expect(produced.ok).toBe(true);
    if (!produced.ok) return;
    expect(produced.envelope.eventId).toBe('kernel-abc');
  });

  it('carries identity the caller supplied and invents none', () => {
    const produced = produce(event({ type: 'run.created' }), 1, 1, {
      missionId: 'mission-9',
      juliusInstanceId: 'julius-1',
      worldSessionId: 'world-session-4',
    });
    expect(produced.ok).toBe(true);
    if (!produced.ok) return;
    expect(produced.envelope.missionId).toBe('mission-9');
    expect(produced.envelope.juliusInstanceId).toBe('julius-1');
    expect(produced.envelope.worldSessionId).toBe('world-session-4');
    expect(produced.envelope.runId).toBe(RUN);
    expect(produced.envelope.taskId).toBe('task-7');

    // Nothing was guessed for what the caller did not say.
    const bare = produce(event({ type: 'run.created' }), 1, 1);
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(bare.envelope.missionId).toBeNull();
    expect(bare.envelope.juliusInstanceId).toBeNull();
    expect(bare.envelope.worldSessionId).toBeNull();
  });

  it('takes the worker ROLE from a fact and never from a worker id', () => {
    // A worker id names which process ran; the role names which function acted.
    // Guessing the second from the first puts work on the wrong instrument the
    // moment Julius reuses a worker across roles.
    const withRole = produce(
      event({ type: 'review.started', facts: { role: 'INDEPENDENT_REVIEWER' } }),
    );
    expect(withRole.ok).toBe(true);
    if (!withRole.ok) return;
    expect(withRole.envelope.workerRole).toBe('INDEPENDENT_REVIEWER');

    const withoutRole = produce(event({ type: 'review.started', workerId: 'worker-3' }));
    expect(withoutRole.ok).toBe(true);
    if (!withoutRole.ok) return;
    // Null, not a token. No role travelled, and a worker id is not one.
    expect(withoutRole.envelope.workerRole).toBeNull();
  });
});

/* ---------------------------------------------------------- the refusals */

describe('a producer that says nothing says WHY', () => {
  it('calls a kernel event the world cannot draw SILENT, not failed', () => {
    // Twenty-three of thirty-four types are legitimately silent. A bridge that
    // logged each as a dropped event would drown the signal it carries.
    for (const type of ['budget.reserved', 'context.compiled', 'worker.dispatched'] as const) {
      const produced = produce(event({ type }));
      expect(produced.ok).toBe(false);
      if (produced.ok) return;
      expect(produced.refusal).toBe('silent');
    }
  });

  it('distinguishes an event with no readable state from a silent one', () => {
    // `finding.recorded` reaches the world as an event and still says nothing
    // about which PHASE the run is in. That is the activity axis's business,
    // and the producer refuses to invent a phase for it.
    const produced = produce(event({ type: 'finding.recorded' }));
    expect(produced.ok).toBe(false);
    if (produced.ok) return;
    expect(produced.refusal).toBe('no_state');
  });

  it('refuses a position that is not one', () => {
    for (const [sequence, revision] of [
      [-1, 3],
      [3, -1],
      [1.5, 3],
      [Number.NaN, 3],
    ] as const) {
      const produced = produce(event({ type: 'run.completed' }), sequence, revision);
      expect(produced.ok).toBe(false);
      if (produced.ok) return;
      expect(produced.refusal).toBe('bad_position');
    }
  });
});

/* --------------------------------------------------------- the endings */

describe('an ending is an ending, and only completion is success', () => {
  it('marks the three stopping states terminal', () => {
    expect([...WONDERLAND_TERMINAL_VISUAL_STATES].sort()).toEqual([
      'blocked',
      'complete',
      'error',
    ]);
  });

  it('never marks work in progress terminal', () => {
    for (const to of ['EXECUTING', 'PLANNING', 'REVIEWING', 'REPAIRING'] as const) {
      const produced = produce(event({ type: 'run.transitioned', facts: { to } }));
      expect(produced.ok).toBe(true);
      if (!produced.ok) return;
      expect(produced.envelope.terminal).toBe(false);
    }
  });

  it('holds BLOCKED and ERROR apart from COMPLETE while calling all three terminal', () => {
    const seen = new Map<string, boolean>();
    for (const to of ['COMPLETED', 'BLOCKED', 'FAILED'] as const) {
      const produced = produce(event({ type: 'run.transitioned', facts: { to } }));
      expect(produced.ok).toBe(true);
      if (!produced.ok) return;
      expect(produced.envelope.terminal).toBe(true);
      seen.set(produced.envelope.state, true);
    }
    // Three different states. A world that collapsed them would report a
    // budget ceiling as a success.
    expect([...seen.keys()].sort()).toEqual(['blocked', 'complete', 'error']);
  });
});

/* ----------------------------------------------------------- the batch */

describe('a page of ledger rows', () => {
  /**
   * A row shaped the way the writer really shapes it.
   *
   * `julius-postgres.ts` persists `json({schemaVersion, ...input})` where the
   * input's own `payload` is the transition record — so the state lives at
   * `payload.payload.to`, not at the top level. Building these rows from a
   * guess is exactly how the earlier `run.transitioned` defect got through:
   * green against a fixture, degraded against the database.
   */
  const row = (
    sequence: number,
    eventType: string,
    inner: Record<string, unknown>,
  ): WonderlandLedgerRow => ({
    eventId: `event-${sequence}`,
    streamId: RUN,
    projectId: PROJECT,
    sequence,
    eventType,
    occurredAt: '2026-09-08T00:00:00.000Z',
    payload: {
      schemaVersion: 'relay-julius-event.v1',
      eventId: `event-${sequence}`,
      streamId: RUN,
      projectId: PROJECT,
      occurredAt: '2026-09-08T00:00:00.000Z',
      payload: inner,
    },
  });

  it('keeps the LEDGER sequence rather than allocating its own', () => {
    // A consumer resumes with the cursor it was given. Re-numbering would make
    // the cursor it sends back mean something else.
    const batch = produceWonderlandEnvelopes({
      rows: [
        row(11, 'julius.run.transitioned', { runId: RUN, to: 'PLANNING' }),
        row(14, 'julius.run.transitioned', { runId: RUN, to: 'EXECUTING' }),
      ],
      revision: 4,
    });
    expect(batch.envelopes.map((e) => e.sequence)).toEqual([11, 14]);
  });

  it('counts the four refusals apart, because they are four situations', () => {
    const batch = produceWonderlandEnvelopes({
      rows: [
        row(1, 'julius.run.transitioned', { runId: RUN, to: 'EXECUTING' }),
        row(2, 'julius.budget.reserved', { runId: RUN }),
        row(3, 'julius.finding.recorded', { runId: RUN }),
        row(4, 'battle.something', {}),
      ],
      revision: 4,
    });
    expect(batch.envelopes.length).toBe(1);
    expect(batch.silent).toBe(1);
    expect(batch.withoutState).toBe(1);
    expect(batch.unreadable).toBe(1);
  });
});

/* ------------------------------------------------- the reconnect, end to end */

describe('a client that disconnects and comes back', () => {
  /**
   * THE DEFECT THIS SUITE EXISTS FOR.
   *
   * Only a state TRANSITION bumps `julius_runs.version`. `review.started`,
   * `finding.recorded` and both subagent events do not. So a snapshot taken at
   * revision 10 and a burst of genuinely new review activity — also at revision
   * 10, because the run's state had not moved — collided: the revision
   * tie-break refused every one of them and the world went deaf until the run
   * happened to change state.
   */
  const newActivityAfter = (cursorIn: ReturnType<typeof openWonderlandCursor>) => {
    let cursor = cursorIn;
    const verdicts: string[] = [];
    for (const [index, e] of [
      event({ type: 'review.started', eventId: 'after-1' }),
      event({ type: 'run.transitioned', eventId: 'after-2', facts: { to: 'VERIFYING' } }),
    ].entries()) {
      const produced = produceWonderlandEnvelope({
        event: e,
        sequence: 50 + index,
        // The run's version has NOT moved: no transition has happened yet.
        revision: 10,
      });
      expect(produced.ok).toBe(true);
      if (!produced.ok) return { cursor, verdicts };
      const outcome = applyWonderlandOrdering(cursor, produced.envelope);
      cursor = outcome.cursor;
      verdicts.push(outcome.verdict);
    }
    return { cursor, verdicts };
  };

  it('hears new work after a POSITIONED snapshot', () => {
    const opened = openWonderlandCursor({ projectId: PROJECT, runId: RUN });
    const recovered = adoptWonderlandSnapshot(
      opened,
      wonderlandRunSnapshot({
        projectId: PROJECT,
        runId: RUN,
        state: 'EXECUTING',
        revision: 10,
        atSequence: 40,
        observedAtIso: '2026-09-08T00:01:00.000Z',
      }),
    );
    expect(recovered.verdict).toBe('adopted');
    expect(recovered.cursor.sequence).toBe(40);
    expect(recovered.cursor.revisionFromSnapshot).toBe(false);

    const { verdicts } = newActivityAfter(recovered.cursor);
    expect(verdicts).toEqual(['applied', 'applied']);
  });

  it('refuses the tail the snapshot already absorbed, on SEQUENCE', () => {
    const opened = openWonderlandCursor({ projectId: PROJECT, runId: RUN });
    const recovered = adoptWonderlandSnapshot(
      opened,
      wonderlandRunSnapshot({
        projectId: PROJECT,
        runId: RUN,
        state: 'EXECUTING',
        revision: 10,
        atSequence: 40,
        observedAtIso: '2026-09-08T00:01:00.000Z',
      }),
    );
    // AT THE SNAPSHOT'S OWN REVISION, which is the case that matters: an older
    // revision would be refused by the revision check first, and that check was
    // never the problem. This is a replayed event the snapshot already absorbed,
    // and only its POSITION says so.
    const replayed = produceWonderlandEnvelope({
      event: event({ type: 'review.started', eventId: 'old' }),
      sequence: 12,
      revision: 10,
    });
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    const outcome = applyWonderlandOrdering(recovered.cursor, replayed.envelope);
    expect(outcome.verdict).toBe('stale_sequence');
    expect(outcome.cursor.sequence).toBe(40);

    // And an older revision is still refused on revision, which is checked
    // first on purpose: a stale replica can be ahead on its own stream.
    const older = produceWonderlandEnvelope({
      event: event({ type: 'review.started', eventId: 'older' }),
      sequence: 99,
      revision: 4,
    });
    expect(older.ok).toBe(true);
    if (!older.ok) return;
    expect(applyWonderlandOrdering(recovered.cursor, older.envelope).verdict).toBe(
      'stale_revision',
    );
  });

  it('stays conservative when the reader could not say where it was', () => {
    // The degraded mode, kept deliberately: refusing some genuinely new events
    // is the safer error when position is unknown, because showing stale work
    // is worse than showing less of it.
    const opened = openWonderlandCursor({ projectId: PROJECT, runId: RUN });
    const recovered = adoptWonderlandSnapshot(
      opened,
      wonderlandRunSnapshot({
        projectId: PROJECT,
        runId: RUN,
        state: 'EXECUTING',
        revision: 10,
        observedAtIso: '2026-09-08T00:01:00.000Z',
      }),
    );
    // `atSequence` belongs to the SNAPSHOT, not the cursor: it is what the
    // reader knew, and the cursor records only what it did with it.
    expect(recovered.cursor.revisionFromSnapshot).toBe(true);
    expect(recovered.cursor.sequence).toBe(0);

    const { verdicts } = newActivityAfter(recovered.cursor);
    expect(verdicts[0]).toBe('stale_revision');
  });

  it('never moves the cursor backwards, however old the snapshot says it is', () => {
    let cursor = openWonderlandCursor({ projectId: PROJECT, runId: RUN });
    const first = produceWonderlandEnvelope({
      event: event({ type: 'run.transitioned', eventId: 'e1', facts: { to: 'EXECUTING' } }),
      sequence: 90,
      revision: 5,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    cursor = applyWonderlandOrdering(cursor, first.envelope).cursor;
    expect(cursor.sequence).toBe(90);

    const recovered = adoptWonderlandSnapshot(
      cursor,
      wonderlandRunSnapshot({
        projectId: PROJECT,
        runId: RUN,
        state: 'VERIFYING',
        revision: 9,
        atSequence: 12,
        observedAtIso: '2026-09-08T00:02:00.000Z',
      }),
    );
    expect(recovered.verdict).toBe('adopted');
    expect(recovered.cursor.sequence).toBe(90);
  });

  it('does not need the whole transcript replayed to catch up', () => {
    // The founder's rule: a reconnect must not require replaying an entire
    // session. One snapshot plus the tail after it is the whole cost.
    const opened = openWonderlandCursor({ projectId: PROJECT, runId: RUN });
    const recovered = adoptWonderlandSnapshot(
      opened,
      wonderlandRunSnapshot({
        projectId: PROJECT,
        runId: RUN,
        state: 'EXECUTING',
        revision: 10,
        atSequence: 4_000,
        observedAtIso: '2026-09-08T00:01:00.000Z',
      }),
    );
    expect(recovered.visualState).toBe('coding');
    // Four thousand events happened and none of them had to be sent.
    expect(recovered.cursor.applied).toBe(0);
    expect(recovered.cursor.sequence).toBe(4_000);
  });
});
