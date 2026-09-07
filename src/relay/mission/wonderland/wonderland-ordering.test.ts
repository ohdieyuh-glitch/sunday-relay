import { describe, expect, it } from 'vitest';

import { wonderlandEnvelope } from './wonderland-envelope';
import type { WonderlandEnvelope } from './wonderland-envelope';
import {
  WONDERLAND_APPLIED_VERDICTS,
  WONDERLAND_CURSOR_FIELDS,
  WONDERLAND_ORDERING_VERDICTS,
  applyWonderlandOrdering,
  openWonderlandCursor,
  wonderlandCursorNeedsReplay,
  wonderlandOrderingVerdict,
  wonderlandResumeRequest,
} from './wonderland-ordering';
import type { WonderlandCursor } from './wonderland-ordering';

/**
 * ORDERING, WHICH IS THE PART A NETWORK CANNOT BE TRUSTED WITH.
 *
 * The single most important assertion in this file is that a stale CODING
 * event cannot overwrite COMPLETE. Everything else is the machinery that makes
 * that true across the ways a wire actually misbehaves.
 */

const PROJECT = 'project-1';
const JULIUS = 'julius-1';
const RUN = 'run-1';

let n = 0;
const event = (overrides: Partial<Parameters<typeof wonderlandEnvelope>[0]> = {}): WonderlandEnvelope => {
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
    occurredAt: '2026-09-07T10:00:00.000Z',
    ...overrides,
  });
};

const cursor = (): WonderlandCursor => openWonderlandCursor({ projectId: PROJECT });

/** Fold a list and hand back the final cursor. */
const fold = (start: WonderlandCursor, events: readonly WonderlandEnvelope[]): WonderlandCursor =>
  events.reduce((c, e) => applyWonderlandOrdering(c, e).cursor, start);

describe('the cursor', () => {
  it('starts having accepted nothing, and says so', () => {
    const c = cursor();
    expect(c.sequence).toBe(0);
    expect(c.revision).toBe(0);
    expect(c.runId).toBeNull();
    expect(c.lastEventId).toBeNull();
    expect(c.accepted).toBe(0);
    expect(Object.keys(c).sort()).toEqual([...WONDERLAND_CURSOR_FIELDS].sort());
  });

  it('binds to a run on first acceptance and holds that binding', () => {
    const { cursor: bound } = applyWonderlandOrdering(cursor(), event({ sequence: 1 }));
    expect(bound.runId).toBe(RUN);
    expect(bound.juliusInstanceId).toBe(JULIUS);
  });

  it('learns identity without ever unlearning it', () => {
    // A later envelope that happens not to name the run must not blank it.
    let c = applyWonderlandOrdering(cursor(), event({ sequence: 1 })).cursor;
    c = applyWonderlandOrdering(c, event({ sequence: 2, runId: null, juliusInstanceId: null })).cursor;
    expect(c.runId).toBe(RUN);
    expect(c.juliusInstanceId).toBe(JULIUS);
  });

  it('names exactly one verdict that changes what a world shows', () => {
    expect([...WONDERLAND_APPLIED_VERDICTS]).toEqual(['accepted']);
    expect(new Set(WONDERLAND_ORDERING_VERDICTS).size).toBe(WONDERLAND_ORDERING_VERDICTS.length);
  });
});

/* ------------------------------------------------------------- identity */

describe('identity is checked before order', () => {
  it('refuses another project, and does not call it stale', () => {
    // Not late — misrouted. Reporting it as stale would send whoever is
    // debugging to look at the wire instead of the router.
    const { verdict, cursor: after } = applyWonderlandOrdering(
      cursor(),
      event({ projectId: 'project-2', sequence: 99 }),
    );
    expect(verdict).toBe('foreign_project');
    expect(after.foreignProjects).toBe(1);
    expect(after.staleSequences).toBe(0);
    expect(after.sequence).toBe(0);
  });

  it('refuses a second Julius instance, however well ordered', () => {
    const bound = applyWonderlandOrdering(cursor(), event({ sequence: 1 })).cursor;
    const { verdict, cursor: after } = applyWonderlandOrdering(
      bound,
      event({ sequence: 2, juliusInstanceId: 'julius-2' }),
    );
    expect(verdict).toBe('foreign_julius');
    expect(after.foreignJulius).toBe(1);
    expect(after.sequence).toBe(1);
  });

  it('refuses another run in the SAME project, which is the per-run trap', () => {
    // `stream_id` is the run id on every Julius write path, so two runs in one
    // project both count 1, 2, 3. A project-wide cursor would refuse run B's
    // third event as stale; this refuses it as foreign, which is the truth.
    const bound = applyWonderlandOrdering(cursor(), event({ sequence: 3 })).cursor;
    const { verdict, cursor: after } = applyWonderlandOrdering(
      bound,
      event({ sequence: 3, runId: 'run-2', eventId: 'other-3' }),
    );
    expect(verdict).toBe('foreign_run');
    expect(after.foreignRuns).toBe(1);
    expect(after.staleSequences).toBe(0);
  });

  it('lets two runs be followed by two cursors without interference', () => {
    const a = fold(openWonderlandCursor({ projectId: PROJECT, runId: 'run-a' }), [
      event({ runId: 'run-a', sequence: 1, eventId: 'a1' }),
      event({ runId: 'run-a', sequence: 2, eventId: 'a2' }),
      event({ runId: 'run-a', sequence: 3, eventId: 'a3' }),
    ]);
    const b = fold(openWonderlandCursor({ projectId: PROJECT, runId: 'run-b' }), [
      event({ runId: 'run-b', sequence: 1, eventId: 'b1' }),
    ]);
    expect(a.sequence).toBe(3);
    expect(a.accepted).toBe(3);
    // Run B's sequence 1 is accepted even though run A has reached 3.
    expect(b.sequence).toBe(1);
    expect(b.accepted).toBe(1);
    expect(b.staleSequences).toBe(0);
  });
});

/* -------------------------------------------------------------- staleness */

describe('staleness, on both axes', () => {
  it('refuses a duplicate delivery of the same event', () => {
    const first = event({ sequence: 1, eventId: 'evt-same' });
    let c = applyWonderlandOrdering(cursor(), first).cursor;
    const { verdict, cursor: after } = applyWonderlandOrdering(c, first);
    expect(verdict).toBe('duplicate');
    expect(after.duplicates).toBe(1);
    expect(after.accepted).toBe(1);
  });

  it('refuses a sequence at or behind the cursor', () => {
    const c = fold(cursor(), [event({ sequence: 5 })]);
    expect(wonderlandOrderingVerdict(c, event({ sequence: 5, eventId: 'x' }))).toBe('stale_sequence');
    expect(wonderlandOrderingVerdict(c, event({ sequence: 4, eventId: 'y' }))).toBe('stale_sequence');
    expect(wonderlandOrderingVerdict(c, event({ sequence: 6, eventId: 'z' }))).toBe('accepted');
  });

  it('refuses an older REVISION even when its sequence runs ahead', () => {
    // The case a sequence check alone cannot catch: a stale replica delivers an
    // event whose sequence is genuinely ahead on ITS stream, while the run has
    // already moved on. The revision is the run's own version and cannot lie.
    const c = fold(cursor(), [event({ sequence: 2, revision: 9 })]);
    const stale = event({ sequence: 50, revision: 8, eventId: 'stale' });
    expect(wonderlandOrderingVerdict(c, stale)).toBe('stale_revision');
    const applied = applyWonderlandOrdering(c, stale);
    expect(applied.cursor.staleRevisions).toBe(1);
    expect(applied.cursor.sequence).toBe(2);
  });

  it('never lets the revision go backwards on an accepted event', () => {
    const c = fold(cursor(), [
      event({ sequence: 1, revision: 5 }),
      event({ sequence: 2, revision: 5 }),
    ]);
    expect(c.revision).toBe(5);
  });

  it('refuses a structurally unusable envelope', () => {
    const c = cursor();
    for (const broken of [
      event({ sequence: -1 }),
      event({ sequence: 1.5 }),
      event({ sequence: Number.NaN }),
      event({ sequence: 1, revision: -2 }),
      event({ sequence: 1, eventId: '' }),
    ]) {
      expect(wonderlandOrderingVerdict(c, broken)).toBe('malformed');
    }
  });

  it('counts a gap without filling it', () => {
    const c = fold(cursor(), [event({ sequence: 1 }), event({ sequence: 7 })]);
    expect(c.sequence).toBe(7);
    expect(c.gaps).toBe(1);
    expect(wonderlandCursorNeedsReplay(c)).toBe(true);
  });

  it('does not call the first event a gap', () => {
    const c = fold(cursor(), [event({ sequence: 42 })]);
    expect(c.gaps).toBe(0);
    expect(wonderlandCursorNeedsReplay(c)).toBe(false);
  });
});

/* ------------------------------------------- the assertion this exists for */

describe('a stale CODING event cannot overwrite COMPLETE', () => {
  const completed = () =>
    fold(cursor(), [
      event({ sequence: 1, state: 'coding', revision: 1 }),
      event({ sequence: 2, state: 'verifying', revision: 2 }),
      event({ sequence: 3, state: 'complete', revision: 3, terminal: true }),
    ]);

  it('refuses it on sequence when the wire simply retried late', () => {
    // Same revision, older sequence: the run has not moved on, this delivery
    // is just behind. That is the sequence axis on its own.
    const c = completed();
    const late = event({ sequence: 2, state: 'coding', revision: 3, eventId: 'late' });
    expect(wonderlandOrderingVerdict(c, late)).toBe('stale_sequence');
  });

  it('reports the REVISION when both axes are stale, because it is the deeper fact', () => {
    // Order of checks is deliberate: "the run has moved past this state" is a
    // more useful diagnosis than "this arrived late", and a late event from a
    // superseded revision is both.
    const c = completed();
    const bothStale = event({ sequence: 2, state: 'coding', revision: 2, eventId: 'both' });
    expect(wonderlandOrderingVerdict(c, bothStale)).toBe('stale_revision');
  });

  it('refuses it on revision when its sequence is ahead', () => {
    const c = completed();
    const fromAStaleReplica = event({
      sequence: 900,
      state: 'coding',
      revision: 2,
      eventId: 'replica',
    });
    expect(wonderlandOrderingVerdict(c, fromAStaleReplica)).toBe('stale_revision');
  });

  it('leaves the cursor exactly where the completion left it', () => {
    const finishing = event({ sequence: 3, state: 'complete', revision: 3, terminal: true });
    let c = fold(cursor(), [
      event({ sequence: 1, state: 'coding', revision: 1 }),
      event({ sequence: 2, state: 'verifying', revision: 2 }),
      finishing,
    ]);
    for (const attack of [
      event({ sequence: 2, state: 'coding', revision: 2, eventId: 'a' }),
      event({ sequence: 900, state: 'coding', revision: 1, eventId: 'b' }),
      event({ sequence: 3, state: 'coding', revision: 3, eventId: 'c' }),
    ]) {
      c = applyWonderlandOrdering(c, attack).cursor;
    }
    expect(c.sequence).toBe(3);
    expect(c.revision).toBe(3);
    expect(c.lastEventId).toBe(finishing.eventId);
    expect(c.accepted).toBe(3);
  });
});

/* ------------------------------------------------------------- resuming */

describe('resuming', () => {
  it('asks for everything after the highest APPLIED sequence, for this run', () => {
    // Applied, not received: an envelope the reducer refused must be sent again
    // if the reason it was refused has since changed.
    const c = fold(cursor(), [event({ sequence: 1 }), event({ sequence: 2 })]);
    const resume = wonderlandResumeRequest(c);
    expect(resume).toEqual({
      projectId: PROJECT,
      runId: RUN,
      afterSequence: 2,
      heldRevision: 1,
    });
  });

  it('asks from the beginning when nothing has been accepted', () => {
    expect(wonderlandResumeRequest(cursor()).afterSequence).toBe(0);
  });

  it('replays without double-counting: the same stream twice lands identically', () => {
    const stream = [
      event({ sequence: 1, revision: 1 }),
      event({ sequence: 2, revision: 2 }),
      event({ sequence: 3, revision: 3 }),
    ];
    const once = fold(cursor(), stream);
    const twice = fold(once, stream);
    expect(twice.sequence).toBe(once.sequence);
    expect(twice.revision).toBe(once.revision);
    expect(twice.accepted).toBe(once.accepted);
    // Every event of the second pass is refused, and visibly so. They land in
    // different buckets on purpose: the earlier two are behind the run's
    // revision, the last one merely repeats a sequence already applied.
    const refusedOnReplay =
      twice.duplicates +
      twice.staleSequences +
      twice.staleRevisions -
      (once.duplicates + once.staleSequences + once.staleRevisions);
    expect(refusedOnReplay).toBe(stream.length);
    expect(twice.staleRevisions).toBeGreaterThan(0);
  });
});

describe('across every verdict', () => {
  it('counts every refusal somewhere, so a dropped stream is never invisible', () => {
    const c = fold(openWonderlandCursor({ projectId: PROJECT }), [
      event({ sequence: 1 }),
      event({ projectId: 'other', sequence: 2 }),
      event({ sequence: 2, juliusInstanceId: 'julius-9' }),
      event({ sequence: 2, runId: 'run-9' }),
      event({ sequence: 1, eventId: 'old' }),
      event({ sequence: -3 }),
    ]);
    expect(c.accepted).toBe(1);
    const refused =
      c.duplicates +
      c.staleSequences +
      c.staleRevisions +
      c.foreignProjects +
      c.foreignJulius +
      c.foreignRuns +
      c.malformed;
    expect(refused).toBe(5);
  });

  it('is a pure function of cursor and envelope', () => {
    const c = fold(cursor(), [event({ sequence: 1 })]);
    const probe = event({ sequence: 2, eventId: 'probe' });
    expect(wonderlandOrderingVerdict(c, probe)).toBe(wonderlandOrderingVerdict(c, probe));
  });

  it('keeps every cursor frozen', () => {
    const c = fold(cursor(), [event({ sequence: 1 }), event({ projectId: 'x', sequence: 2 })]);
    expect(Object.isFrozen(c)).toBe(true);
  });
});
