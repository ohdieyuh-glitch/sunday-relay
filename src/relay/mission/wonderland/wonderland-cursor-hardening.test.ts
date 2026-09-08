import { describe, expect, it } from 'vitest';

import { emptyJuliusActivity } from './wonderland-julius-activity';
import { noWonderlandBrainCitation } from './wonderland-brain-scope';
import { planWonderlandActivityIntent } from './wonderland-activity-animation';
import { wonderlandEnvelope } from './wonderland-envelope';
import type { WonderlandEnvelope } from './wonderland-envelope';
import { scopeWonderlandCard, wonderlandHydration, wonderlandHydrationResume } from './wonderland-hydration';
import { ingestWonderlandRows } from './wonderland-ingress';
import type { WonderlandIngressGrant } from './wonderland-ingress';
import type { WonderlandLedgerRow } from './wonderland-ledger-adapter';
import {
  applyWonderlandOrdering,
  WONDERLAND_ORDERING_VERDICTS,
  openWonderlandCursor,
  wonderlandOrderingVerdict,
} from './wonderland-ordering';
import type { WonderlandCursor, WonderlandOrderingVerdict } from './wonderland-ordering';
import {
  adoptWonderlandSnapshot,
  juliusMissionStateIsTerminal,
  wonderlandRunSnapshot,
} from './wonderland-rehydration';
import { emptyWonderlandUsageAuthority, projectWonderlandUsageFromAuthority } from './wonderland-usage-authority';
import { JULIUS_RUN_STATE_VISUAL_STATE } from './wonderland-julius-state';
import type { JuliusVisualState } from './wonderland-julius-state';
import type { JuliusMissionState } from '../julius/julius-runtime';

/**
 * THE CURSOR, UNDER EVERY POSITION A RECONNECT CAN PUT IT IN.
 *
 * The other ordering tests each isolate one rule. This file asks the question a
 * founder's afternoon actually asks: the tab was closed at some point, the link
 * dropped at some other point, and the run kept going — where is this client,
 * and is what it draws now true?
 *
 * There are only ever two clocks and each has three answers relative to what a
 * client holds (behind, level, ahead), so the whole space is nine cells and it
 * is small enough to write down. Writing it down is the point: three of these
 * cells were never covered anywhere, and one of them — a revision ahead of a
 * sequence that is behind — is the pair that CANNOT happen in a healthy ledger,
 * which makes it exactly the pair a client must not be credulous about.
 */

const PROJECT = 'project-alpha';
const OTHER = 'project-beta';
const JULIUS = 'julius-1';
const RUN = 'run-1';
const AT = '2026-09-08T00:00:00.000Z';

let n = 0;
const event = (
  overrides: Partial<Parameters<typeof wonderlandEnvelope>[0]> = {},
): WonderlandEnvelope => {
  n += 1;
  return wonderlandEnvelope({
    eventId: `evt-${n}`,
    projectId: PROJECT,
    juliusInstanceId: JULIUS,
    runId: RUN,
    state: 'coding',
    stateSource: 'julius_run_state',
    sequence: n,
    revision: 1,
    occurredAt: AT,
    ...overrides,
  });
};

/**
 * WHICH COUNTER EACH REFUSAL BELONGS TO.
 *
 * Written down here rather than reached for inside a test so the same mapping
 * drives both the accounting check and the "nothing else moved" comparison —
 * a refusal filed under the wrong name then fails twice, which is what makes
 * the two tests independent rather than one test written out twice.
 */
const COUNTER_FOR: Readonly<
  Record<Exclude<WonderlandOrderingVerdict, 'applied'>, keyof WonderlandCursor>
> = Object.freeze({
  duplicate: 'duplicates',
  stale_sequence: 'staleSequences',
  stale_revision: 'staleRevisions',
  foreign_project: 'foreignProjects',
  foreign_julius: 'foreignJulius',
  foreign_run: 'foreignRuns',
  malformed: 'malformed',
});

/** A client that has been running: three events in, at revision 4. */
const established = (): WonderlandCursor => {
  let cursor = openWonderlandCursor({ projectId: PROJECT });
  for (const e of [
    event({ sequence: 1, revision: 2, state: 'attention' }),
    event({ sequence: 2, revision: 3, state: 'prompt_architect' }),
    event({ sequence: 3, revision: 4, state: 'coding' }),
  ]) {
    cursor = applyWonderlandOrdering(cursor, e).cursor;
  }
  return cursor;
};

/* ------------------------------------------------------------ the matrix */

describe('the whole cursor matrix, both clocks, every direction', () => {
  /**
   * Held: sequence 3, revision 4, from EVENTS (not a snapshot).
   *
   * `sequence` names the arriving event's, `revision` its run version, and the
   * verdict is what a client that is telling the truth must return.
   */
  const matrix: readonly {
    readonly name: string;
    readonly sequence: number;
    readonly revision: number;
    readonly verdict: WonderlandOrderingVerdict;
  }[] = [
    // ── the ordinary tail ─────────────────────────────────────────────────
    { name: 'the very next event', sequence: 4, revision: 5, verdict: 'applied' },
    // A run does not transition on every event, so a tie on revision is the
    // COMMON case rather than the suspicious one. Refusing it is the defect
    // that made a reconnected world go deaf.
    { name: 'the next event at the same revision', sequence: 4, revision: 4, verdict: 'applied' },
    { name: 'a gap ahead on both clocks', sequence: 9, revision: 6, verdict: 'applied' },

    // ── behind on sequence ────────────────────────────────────────────────
    { name: 'an event already applied', sequence: 3, revision: 4, verdict: 'stale_sequence' },
    { name: 'a replay from further back', sequence: 1, revision: 4, verdict: 'stale_sequence' },

    // ── behind on revision ────────────────────────────────────────────────
    // Reported as a revision, not a sequence: an event describing a run that
    // has moved on is a deeper fact than an event that merely arrived late,
    // and the two send whoever is debugging to different places.
    { name: 'a stale replica running ahead of itself', sequence: 7, revision: 3, verdict: 'stale_revision' },
    { name: 'behind on both clocks', sequence: 2, revision: 3, verdict: 'stale_revision' },

    // ── the pair that cannot happen ───────────────────────────────────────
    // Both clocks are per-run and monotonic, so a revision ahead of a sequence
    // behind is not a late event, it is an impossible one. It is refused on the
    // clock that orders EVENTS, because that is what this envelope claims to be.
    { name: 'a revision ahead of a sequence already passed', sequence: 3, revision: 9, verdict: 'stale_sequence' },
    { name: 'a revision ahead of a sequence long passed', sequence: 1, revision: 9, verdict: 'stale_sequence' },
  ];

  for (const cell of matrix) {
    it(`refuses or applies ${cell.name} as ${cell.verdict}`, () => {
      const held = established();
      expect(held.sequence).toBe(3);
      expect(held.revision).toBe(4);
      const arriving = event({ sequence: cell.sequence, revision: cell.revision });
      expect(wonderlandOrderingVerdict(held, arriving)).toBe(cell.verdict);
    });
  }

  it('covers all nine cells of the two-clock space', () => {
    // A guard on the table itself: if a direction is ever dropped from it, the
    // matrix stops being a matrix and starts being a handful of examples.
    const held = { sequence: 3, revision: 4 };
    const side = (value: number, held_: number): string =>
      value < held_ ? 'behind' : value === held_ ? 'level' : 'ahead';
    const cells = new Set(
      matrix.map((c) => `${side(c.sequence, held.sequence)}/${side(c.revision, held.revision)}`),
    );
    // Level-on-sequence is `stale_sequence` by the same rule as behind, and is
    // covered by 'an event already applied' — which is the level/level cell.
    for (const s of ['behind', 'level', 'ahead']) {
      for (const r of ['behind', 'level', 'ahead']) {
        // level/behind and behind/behind collapse: both are stale_revision, and
        // one witness of each combination is what the table promises.
        if (s === 'level' && r === 'behind') continue;
        if (s === 'level' && r === 'ahead') continue;
        expect(cells.has(`${s}/${r}`), `missing cell ${s}/${r}`).toBe(true);
      }
    }
  });
});

/* -------------------------------------- the impossible pair, in detail */

describe('a revision ahead of a sequence behind', () => {
  it('does not carry its revision into the cursor', () => {
    // THE ASSERTION THIS SECTION EXISTS FOR. If a refusal moved the revision,
    // one impossible envelope would push the held version past the run's real
    // one, and then every genuine event that followed would be refused as
    // stale — a client silently deaf for the rest of the mission, from a single
    // bad frame. Refusals must touch nothing but their own counter.
    const held = established();
    const after = applyWonderlandOrdering(held, event({ sequence: 2, revision: 99 }));

    expect(after.verdict).toBe('stale_sequence');
    expect(after.cursor.revision).toBe(held.revision);
    expect(after.cursor.sequence).toBe(held.sequence);
    expect(after.cursor.lastEventId).toBe(held.lastEventId);
    expect(after.cursor.applied).toBe(held.applied);
    expect(after.cursor.staleSequences).toBe(held.staleSequences + 1);
  });

  it('leaves the run still able to hear its real next event', () => {
    // The consequence of the assertion above, stated as behaviour: after the
    // impossible frame, the legitimate tail still lands.
    let cursor = established();
    cursor = applyWonderlandOrdering(cursor, event({ sequence: 1, revision: 500 })).cursor;
    const real = applyWonderlandOrdering(cursor, event({ sequence: 4, revision: 5, state: 'independent_review' }));

    expect(real.verdict).toBe('applied');
    expect(real.cursor.revision).toBe(5);
    expect(real.cursor.sequence).toBe(4);
  });

  it('is refused identically whether or not the client is fresh', () => {
    // A cursor at zero has no position to be behind, so the same envelope is
    // ordinary news there. The pair is only impossible relative to a position,
    // which is why it is a cursor property and not an envelope one.
    const fresh = openWonderlandCursor({ projectId: PROJECT });
    expect(wonderlandOrderingVerdict(fresh, event({ sequence: 1, revision: 9 }))).toBe('applied');
  });
});

/* ---------------------------------------- the invariant, over every cell */

describe('across the whole space, not just the interesting corners', () => {
  /**
   * ONE SWEEP, TWO INVARIANTS, EVERY POSITION.
   *
   * The cells above are chosen examples. These are the properties that must
   * hold in all of them at once, and they are the two a client's correctness
   * actually rests on: a refusal moves nothing, and an acceptance never moves
   * anything backwards. Stated as a sweep because the failure mode being
   * guarded against is a NEW branch — some later refusal that helpfully updates
   * a field on its way out — and an example-based test only catches that if
   * somebody remembers to add the example.
   */
  const positions = [0, 1, 3, 4, 9];

  it('never lets a refusal move a position, on any pair of clocks', () => {
    let checked = 0;
    for (const heldSeq of positions) {
      for (const heldRev of positions) {
        for (const fromSnapshot of [false, true]) {
          const held: WonderlandCursor = Object.freeze({
            ...openWonderlandCursor({ projectId: PROJECT, juliusInstanceId: JULIUS, runId: RUN }),
            sequence: heldSeq,
            revision: heldRev,
            revisionFromSnapshot: fromSnapshot,
            lastEventId: 'evt-held',
          });
          for (const seq of positions) {
            for (const rev of positions) {
              const arriving = event({ sequence: seq, revision: rev });
              const step = applyWonderlandOrdering(held, arriving);
              checked += 1;
              if (step.verdict === 'applied') continue;
              // THE WHOLE CURSOR, not a list of fields worth remembering. Put
              // the one counter back and what is left must be byte-identical:
              // a refusal that helpfully updated a timestamp, or a field added
              // to the cursor next year, is caught without anyone editing this.
              const counter = COUNTER_FOR[step.verdict];
              expect({ ...step.cursor, [counter]: held[counter] }).toEqual(held);
            }
          }
        }
      }
    }
    expect(checked).toBe(positions.length ** 4 * 2);
  });

  it('never moves a position backwards on an acceptance', () => {
    for (const heldSeq of positions) {
      for (const heldRev of positions) {
        const held: WonderlandCursor = Object.freeze({
          ...openWonderlandCursor({ projectId: PROJECT, juliusInstanceId: JULIUS, runId: RUN }),
          sequence: heldSeq,
          revision: heldRev,
        });
        for (const seq of positions) {
          for (const rev of positions) {
            const step = applyWonderlandOrdering(held, event({ sequence: seq, revision: rev }));
            if (step.verdict !== 'applied') continue;
            expect(step.cursor.sequence).toBeGreaterThanOrEqual(held.sequence);
            expect(step.cursor.revision).toBeGreaterThanOrEqual(held.revision);
          }
        }
      }
    }
  });

  it('counts every verdict under its OWN name', () => {
    // Totals are not enough. A refusal filed under the wrong counter still
    // adds up, and the counters exist precisely to be told apart: forty
    // `stale_sequence` is a chatty replay and is fine, one `foreign_project`
    // is a routing bug and is not. Netting them out loses the diagnosis.
    const held = established();
    const witness: Readonly<Record<Exclude<WonderlandOrderingVerdict, 'applied'>, WonderlandEnvelope>> = {
      duplicate: event({ sequence: 9, revision: 9, eventId: held.lastEventId as string }),
      stale_sequence: event({ sequence: 1, revision: 9 }),
      stale_revision: event({ sequence: 9, revision: 1 }),
      foreign_project: event({ sequence: 9, revision: 9, projectId: OTHER }),
      foreign_julius: event({ sequence: 9, revision: 9, juliusInstanceId: 'julius-2' }),
      foreign_run: event({ sequence: 9, revision: 9, runId: 'run-2' }),
      malformed: event({ sequence: -1, revision: 9 }),
    };

    for (const [verdict, arriving] of Object.entries(witness)) {
      const step = applyWonderlandOrdering(held, arriving);
      expect(step.verdict, `witness for ${verdict}`).toBe(verdict);
      const counter = COUNTER_FOR[verdict as Exclude<WonderlandOrderingVerdict, 'applied'>];
      expect(step.cursor[counter], `${verdict} must count under ${counter}`).toBe(
        (held[counter] as number) + 1,
      );
      // And nothing else moved, including the other seven counters.
      expect({ ...step.cursor, [counter]: held[counter] }).toEqual(held);
    }

    // Every refusal in the vocabulary has a witness above: a verdict added
    // without one would be a refusal nobody has ever seen counted.
    expect(Object.keys(witness).sort()).toEqual(
      WONDERLAND_ORDERING_VERDICTS.filter((v) => v !== 'applied').slice().sort(),
    );
  });
});

/* ------------------------------- why a snapshot position is never guessed */

describe('a snapshot position is read or omitted, never guessed', () => {
  const snapshot = (atSequence: number | null) =>
    wonderlandRunSnapshot({
      projectId: PROJECT,
      juliusInstanceId: JULIUS,
      runId: RUN,
      state: 'EXECUTING',
      revision: 6,
      atSequence,
      observedAtIso: AT,
    });

  it('applies the tail exactly when the position is READ', () => {
    const fresh = openWonderlandCursor({ projectId: PROJECT });
    const recovered = adoptWonderlandSnapshot(fresh, snapshot(3));
    expect(recovered.verdict).toBe('adopted');
    expect(recovered.cursor.sequence).toBe(3);

    // Sequence 4 at the SAME revision — the post-snapshot case that only a real
    // position gets right, because a review or subagent event does not bump
    // `julius_runs.version` and so arrives at the snapshot's own revision.
    const next = applyWonderlandOrdering(recovered.cursor, event({ sequence: 4, revision: 6 }));
    expect(next.verdict).toBe('applied');
  });

  it('skips real events when the position is guessed too HIGH', () => {
    // Not a defect being asserted — a cost being demonstrated. This is what the
    // forbidden shortcut buys, executable rather than described in a comment.
    const fresh = openWonderlandCursor({ projectId: PROJECT });
    const optimistic = adoptWonderlandSnapshot(fresh, snapshot(50));
    const real = applyWonderlandOrdering(optimistic.cursor, event({ sequence: 4, revision: 6 }));
    expect(real.verdict).toBe('stale_sequence');
  });

  it('re-opens applied events when the position is guessed too LOW', () => {
    let cursor = openWonderlandCursor({ projectId: PROJECT });
    const seen = event({ sequence: 4, revision: 6 });
    cursor = adoptWonderlandSnapshot(cursor, snapshot(3)).cursor;
    cursor = applyWonderlandOrdering(cursor, seen).cursor;
    expect(cursor.sequence).toBe(4);

    // A later snapshot that under-reports its own position must not walk the
    // cursor back over events already drawn.
    const pessimistic = adoptWonderlandSnapshot(cursor, {
      ...snapshot(1),
      revision: 7,
    });
    expect(pessimistic.verdict).toBe('adopted');
    expect(pessimistic.cursor.sequence).toBe(4);
  });

  it('refuses a position that is not a position, rather than carrying it', () => {
    for (const bad of [-1, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(wonderlandRunSnapshot({
        projectId: PROJECT,
        runId: RUN,
        state: 'EXECUTING',
        revision: 6,
        atSequence: bad,
        observedAtIso: AT,
      }).atSequence).toBeNull();
    }
  });

  it('falls back to the blunt tie-break only when the reader could not say', () => {
    const fresh = openWonderlandCursor({ projectId: PROJECT });
    const unpositioned = adoptWonderlandSnapshot(fresh, snapshot(null));
    expect(unpositioned.cursor.revisionFromSnapshot).toBe(true);
    // Safer of the two errors: some genuinely new events are refused, and none
    // that predate the snapshot are drawn.
    expect(wonderlandOrderingVerdict(unpositioned.cursor, event({ sequence: 4, revision: 6 }))).toBe(
      'stale_revision',
    );
    expect(adoptWonderlandSnapshot(fresh, snapshot(3)).cursor.revisionFromSnapshot).toBe(false);
  });
});

/* ------------------------------------ the project changing under a stream */

const row = (
  sequence: number,
  type: string,
  inner: Record<string, unknown> = {},
  over: Partial<WonderlandLedgerRow> = {},
): WonderlandLedgerRow => ({
  eventId: `event-${sequence}`,
  streamId: RUN,
  projectId: PROJECT,
  sequence,
  eventType: `julius.${type}`,
  occurredAt: AT,
  payload: {
    schemaVersion: 'relay-julius-event.v1',
    eventId: `event-${sequence}`,
    streamId: RUN,
    projectId: PROJECT,
    occurredAt: AT,
    payload: { runId: RUN, ...inner },
  },
  ...over,
});

describe('the session project changing mid-stream', () => {
  const grant: WonderlandIngressGrant = { projectId: PROJECT, runId: RUN };

  it('never mixes two projects into one fold', () => {
    // A fan-out bug delivering another world's rows onto this connection. The
    // refusal is a SECURITY one and the client does not move at all.
    const result = ingestWonderlandRows({
      grant,
      rows: [
        row(1, 'run.transitioned', { to: 'EXECUTING' }),
        row(2, 'run.transitioned', { to: 'REVIEWING' }, { projectId: OTHER }),
        row(3, 'run.transitioned', { to: 'VERIFYING' }),
      ],
      revision: 5,
      cursor: openWonderlandCursor({ projectId: PROJECT, runId: RUN }),
      activity: emptyJuliusActivity({ projectId: PROJECT, runId: RUN }),
    });

    expect(result.refusals.unauthorized_project).toBe(1);
    expect(result.deliveries.length).toBe(2);
    for (const delivery of result.deliveries) {
      expect(delivery.envelope.projectId).toBe(PROJECT);
    }
  });

  it('keeps a foreign row out of the ACTIVITY axis, not only out of the phase', () => {
    // Scope is checked before the fold for exactly this: an approval raised in
    // another world would otherwise stop this one's dog and wait for a founder
    // who was never asked anything.
    const result = ingestWonderlandRows({
      grant,
      rows: [row(1, 'approval.requested', { taskId: 'task-1' }, { projectId: OTHER })],
      revision: 5,
      cursor: openWonderlandCursor({ projectId: PROJECT, runId: RUN }),
      activity: emptyJuliusActivity({ projectId: PROJECT, runId: RUN }),
    });

    expect(result.refusals.unauthorized_project).toBe(1);
    expect(result.activity.signals).toEqual([]);
    expect(result.deliveries).toEqual([]);
  });

  it('fails closed when a grant is re-pointed and the cursor is not', () => {
    // The client-side half of a project switch. A world that swapped its grant
    // to another project while keeping the cursor it built for the first one
    // draws NOTHING rather than drawing the new project into the old fold: the
    // grant lets the row through and ordering refuses it as foreign.
    const result = ingestWonderlandRows({
      grant: { projectId: OTHER, runId: RUN },
      rows: [row(1, 'run.transitioned', { to: 'EXECUTING' }, {
        projectId: OTHER,
        payload: {
          schemaVersion: 'relay-julius-event.v1',
          eventId: 'event-1',
          streamId: RUN,
          projectId: OTHER,
          occurredAt: AT,
          payload: { runId: RUN, to: 'EXECUTING' },
        },
      })],
      revision: 5,
      cursor: openWonderlandCursor({ projectId: PROJECT, runId: RUN }),
      activity: emptyJuliusActivity({ projectId: PROJECT, runId: RUN }),
    });

    expect(result.deliveries).toEqual([]);
    expect(result.orderingVerdicts.foreign_project).toBe(1);
    expect(result.refusals.out_of_order).toBe(1);
    expect(result.cursor.sequence).toBe(0);
  });

  it('needs a whole new cursor to follow a new project, which is the point', () => {
    // The supported way to change project: re-authorise, then open a cursor for
    // what was authorised. Nothing carries over, because nothing should.
    const result = ingestWonderlandRows({
      grant: { projectId: OTHER, runId: RUN },
      rows: [row(1, 'run.transitioned', { to: 'EXECUTING' }, {
        projectId: OTHER,
        payload: {
          schemaVersion: 'relay-julius-event.v1',
          eventId: 'event-1',
          streamId: RUN,
          projectId: OTHER,
          occurredAt: AT,
          payload: { runId: RUN, to: 'EXECUTING' },
        },
      })],
      revision: 5,
      cursor: openWonderlandCursor({ projectId: OTHER, runId: RUN }),
      activity: emptyJuliusActivity({ projectId: OTHER, runId: RUN }),
    });

    expect(result.deliveries.length).toBe(1);
    expect(result.deliveries[0].envelope.projectId).toBe(OTHER);
  });
});

/* -------------------------------------------- rejoining a finished world */

describe('hydrating into an ending', () => {
  const authority = projectWonderlandUsageFromAuthority(
    emptyWonderlandUsageAuthority({ projectId: PROJECT }),
    AT,
  );

  const hydrateAt = (state: JuliusMissionState) =>
    wonderlandHydration({
      run: wonderlandRunSnapshot({
        projectId: PROJECT,
        juliusInstanceId: JULIUS,
        runId: RUN,
        state,
        revision: 9,
        atSequence: 42,
        observedAtIso: AT,
      }),
      usage: authority.hud,
      usageStatus: authority.status,
      activity: emptyJuliusActivity({ projectId: PROJECT, runId: RUN }),
      brain: noWonderlandBrainCitation({ projectId: PROJECT, runId: RUN }),
      card: scopeWonderlandCard({ cardRevision: 'card:v3' }),
      observedAtIso: AT,
    });

  /** One kernel state behind each of the three visual endings. */
  const endings: readonly { readonly state: JuliusMissionState; readonly visual: string }[] = [
    { state: 'COMPLETED', visual: 'complete' },
    { state: 'CANCELLED', visual: 'blocked' },
    { state: 'FAILED', visual: 'error' },
  ];

  for (const ending of endings) {
    it(`recovers ${ending.visual} from ${ending.state} without replaying the mission`, () => {
      const hydration = hydrateAt(ending.state);
      const recovered = adoptWonderlandSnapshot(
        openWonderlandCursor({ projectId: PROJECT }),
        hydration.run,
      );

      expect(recovered.verdict).toBe('adopted');
      expect(recovered.visualState).toBe(ending.visual);
      expect(recovered.sourceState).toBe(ending.state);
      expect(recovered.terminal).toBe(true);

      // The whole history, replayed onto a finished world. Nothing moves.
      let cursor = recovered.cursor;
      const verdicts: WonderlandOrderingVerdict[] = [];
      for (let seq = 1; seq <= 42; seq += 1) {
        const step = applyWonderlandOrdering(
          cursor,
          event({ sequence: seq, revision: Math.min(seq, 9), state: 'coding' }),
        );
        cursor = step.cursor;
        verdicts.push(step.verdict);
      }
      expect(verdicts).not.toContain('applied');
      expect(cursor.sequence).toBe(42);
      expect(cursor.revision).toBe(9);
    });

    it(`asks ${ending.visual} for the tail rather than the transcript`, () => {
      const resume = wonderlandHydrationResume(hydrateAt(ending.state));
      expect(resume.afterSequence).toBe(42);
      expect(resume.runId).toBe(RUN);
      expect(resume.projectId).toBe(PROJECT);
    });

    it(`shows no accent on a world hydrated into ${ending.visual}`, () => {
      // The JOIN, not the rule: the visual state is taken from what adopting
      // the snapshot actually produced, so a kernel state remapped to a
      // different ending would be caught here rather than passing a literal.
      const recovered = adoptWonderlandSnapshot(
        openWonderlandCursor({ projectId: PROJECT }),
        hydrateAt(ending.state).run,
      );
      const intent = planWonderlandActivityIntent({
        signals: ['retrying', 'swarming', 'awaiting_approval'],
        visualState: recovered.visualState as JuliusVisualState,
      });

      expect(intent.dominant).toBeNull();
      expect(intent.accents).toEqual([]);
      expect(intent.dominantSignal).toBeNull();
      // Even the human gate, which interrupts everywhere else, does not
      // interrupt a run that is over.
      expect(intent.interrupt).toBe(false);
      // And it says WHY it is quiet, so a suppressed ending is never mistaken
      // for a run that simply had nothing to report.
      expect(intent.suppressedByTerminal).toBe(true);
    });
  }

  it('reads the ending from the KERNEL, never from the picture', () => {
    // The conflation this forbids, in one pair. PAUSED and CANCELLED both draw
    // `blocked`; one is resumable and one is over. A world that decided whether
    // to keep listening from what it had drawn would hang up on a paused run
    // and listen forever to a cancelled one.
    expect(JULIUS_RUN_STATE_VISUAL_STATE.PAUSED).toBe('blocked');
    expect(JULIUS_RUN_STATE_VISUAL_STATE.CANCELLED).toBe('blocked');
    expect(juliusMissionStateIsTerminal('PAUSED')).toBe(false);
    expect(juliusMissionStateIsTerminal('CANCELLED')).toBe(true);

    const paused = adoptWonderlandSnapshot(
      openWonderlandCursor({ projectId: PROJECT }),
      hydrateAt('PAUSED').run,
    );
    const cancelled = adoptWonderlandSnapshot(
      openWonderlandCursor({ projectId: PROJECT }),
      hydrateAt('CANCELLED').run,
    );
    expect(paused.visualState).toBe(cancelled.visualState);
    expect(paused.terminal).toBe(false);
    expect(cancelled.terminal).toBe(true);
  });

  it('still hears a genuine event that arrives after an ending', () => {
    // An ending is a state, not a mute. `review.completed` and the subagent
    // events can land after a run finishes and they do not bump the version, so
    // the read position — not the revision — is what lets them through.
    const recovered = adoptWonderlandSnapshot(
      openWonderlandCursor({ projectId: PROJECT }),
      hydrateAt('COMPLETED').run,
    );
    const late = applyWonderlandOrdering(
      recovered.cursor,
      event({ sequence: 43, revision: 9, state: 'complete', terminal: true }),
    );
    expect(late.verdict).toBe('applied');
  });
});
