import { describe, expect, it } from 'vitest';

import { JULIUS_MISSION_STATES } from '../julius/julius-runtime';
import type { JuliusMissionState } from '../julius/julius-runtime';
import { wonderlandEnvelope } from './wonderland-envelope';
import type { WonderlandEnvelope } from './wonderland-envelope';
import { applyWonderlandOrdering, openWonderlandCursor } from './wonderland-ordering';
import {
  JULIUS_TERMINAL_MISSION_STATES,
  WONDERLAND_RUN_SNAPSHOT_FIELDS,
  WONDERLAND_SNAPSHOT_SCHEMA_V1,
  adoptWonderlandSnapshot,
  juliusMissionStateIsTerminal,
  rehydrateWonderland,
  wonderlandResumeAfterSnapshot,
  wonderlandRunSnapshot,
  wonderlandSnapshotVerdict,
} from './wonderland-rehydration';

/**
 * REJOINING A MISSION ALREADY UNDER WAY.
 *
 * The requirement in one sentence: a client that reconnects after a mission
 * finished must show COMPLETE, and must not perform the mission again on its
 * way there. The test that proves it replays the entire history against a
 * COMPLETE snapshot and asserts the world never moves.
 */

const PROJECT = 'project-1';
const JULIUS = 'julius-1';
const RUN = 'run-1';
const AT = '2026-09-07T10:00:00.000Z';

const snapshot = (
  state: JuliusMissionState,
  revision: number,
  overrides: Partial<Parameters<typeof wonderlandRunSnapshot>[0]> = {},
) =>
  wonderlandRunSnapshot({
    projectId: PROJECT,
    juliusInstanceId: JULIUS,
    runId: RUN,
    state,
    revision,
    observedAtIso: AT,
    ...overrides,
  });

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

/** The whole mission, as the timeline would replay it. */
const wholeHistory = (): readonly WonderlandEnvelope[] => [
  event({ sequence: 1, revision: 1, state: 'attention' }),
  event({ sequence: 2, revision: 2, state: 'prompt_architect' }),
  event({ sequence: 3, revision: 3, state: 'coding' }),
  event({ sequence: 4, revision: 4, state: 'independent_review' }),
  event({ sequence: 5, revision: 5, state: 'verifying' }),
  event({ sequence: 6, revision: 6, state: 'complete', terminal: true }),
];

/* ------------------------------------------------------- terminal states */

describe('which kernel states end a run', () => {
  it('is derived from the kernel guard, not restated', () => {
    expect([...JULIUS_TERMINAL_MISSION_STATES].sort()).toEqual(
      ['CANCELLED', 'COMPLETED', 'FAILED'].sort(),
    );
  });

  it('agrees with the guard for every state', () => {
    for (const state of JULIUS_MISSION_STATES) {
      const isEnding = JULIUS_TERMINAL_MISSION_STATES.includes(state);
      expect(juliusMissionStateIsTerminal(state)).toBe(isEnding);
    }
  });

  it('treats PAUSED and BLOCKED as still running, because the kernel does', () => {
    // A paused run can resume. Calling it terminal would make a pause
    // indistinguishable from a cancellation on screen.
    expect(juliusMissionStateIsTerminal('PAUSED')).toBe(false);
    expect(juliusMissionStateIsTerminal('BLOCKED')).toBe(false);
  });
});

/* ---------------------------------------------------------- the snapshot */

describe('the snapshot', () => {
  it('is frozen, versioned and exactly as declared', () => {
    const s = snapshot('EXECUTING', 4);
    expect(s.schemaVersion).toBe(WONDERLAND_SNAPSHOT_SCHEMA_V1);
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.keys(s).sort()).toEqual([...WONDERLAND_RUN_SNAPSHOT_FIELDS].sort());
  });

  it('leaves counts null rather than guessing zero', () => {
    const s = snapshot('EXECUTING', 4);
    expect(s.activeTasks).toBeNull();
    expect(s.pendingApprovals).toBeNull();
    expect(snapshot('EXECUTING', 4, { activeTasks: 0 }).activeTasks).toBe(0);
  });
});

describe('adopting a snapshot', () => {
  const fresh = () => openWonderlandCursor({ projectId: PROJECT });

  it('recovers CODING for a client joining during CODING', () => {
    const recovery = adoptWonderlandSnapshot(fresh(), snapshot('EXECUTING', 7));
    expect(recovery.verdict).toBe('adopted');
    expect(recovery.visualState).toBe('coding');
    expect(recovery.sourceState).toBe('EXECUTING');
    expect(recovery.terminal).toBe(false);
    expect(recovery.cursor.revision).toBe(7);
  });

  it('recovers review state for a reconnect during INDEPENDENT_REVIEW', () => {
    const recovery = adoptWonderlandSnapshot(fresh(), snapshot('REVIEWING', 9));
    expect(recovery.visualState).toBe('independent_review');
    expect(recovery.terminal).toBe(false);
  });

  it('recovers COMPLETE, and marks it terminal from the KERNEL state', () => {
    const recovery = adoptWonderlandSnapshot(fresh(), snapshot('COMPLETED', 12));
    expect(recovery.visualState).toBe('complete');
    expect(recovery.terminal).toBe(true);
  });

  it('does NOT move the event cursor, because a snapshot has no sequence', () => {
    // Guessing one would either skip events or claim to have applied events
    // that were never seen.
    const recovery = adoptWonderlandSnapshot(fresh(), snapshot('EXECUTING', 7));
    expect(recovery.cursor.sequence).toBe(0);
    expect(recovery.cursor.accepted).toBe(0);
  });

  it('binds the run and instance it names', () => {
    const recovery = adoptWonderlandSnapshot(fresh(), snapshot('EXECUTING', 7));
    expect(recovery.cursor.runId).toBe(RUN);
    expect(recovery.cursor.juliusInstanceId).toBe(JULIUS);
  });

  it('refuses a snapshot for another world, run or Julius, with a sentence', () => {
    const bound = adoptWonderlandSnapshot(fresh(), snapshot('EXECUTING', 3)).cursor;
    const cases: ReadonlyArray<readonly [ReturnType<typeof snapshot>, string]> = [
      [snapshot('EXECUTING', 9, { projectId: 'other' }), 'foreign_project'],
      [snapshot('EXECUTING', 9, { juliusInstanceId: 'julius-2' }), 'foreign_julius'],
      [snapshot('EXECUTING', 9, { runId: 'run-2' }), 'foreign_run'],
    ];
    for (const [s, expected] of cases) {
      const recovery = adoptWonderlandSnapshot(bound, s);
      expect(recovery.verdict).toBe(expected);
      expect(recovery.visualState).toBeNull();
      expect((recovery.reason ?? '').length).toBeGreaterThan(10);
    }
  });

  it('refuses a snapshot that is not newer than what is held', () => {
    // `<=` rather than `<`: re-adopting the revision already held is churn that
    // re-renders the same state and can restart an animation.
    let cursor = openWonderlandCursor({ projectId: PROJECT });
    cursor = applyWonderlandOrdering(cursor, event({ sequence: 1, revision: 5 })).cursor;
    expect(wonderlandSnapshotVerdict(cursor, snapshot('EXECUTING', 5))).toBe('stale_revision');
    expect(wonderlandSnapshotVerdict(cursor, snapshot('EXECUTING', 4))).toBe('stale_revision');
    expect(wonderlandSnapshotVerdict(cursor, snapshot('EXECUTING', 6))).toBe('adopted');
  });

  it('adopts the first snapshot even at revision 0, since nothing is held', () => {
    expect(wonderlandSnapshotVerdict(fresh(), snapshot('CREATED', 0))).toBe('adopted');
  });

  it('maps every kernel state to something drawable', () => {
    for (const state of JULIUS_MISSION_STATES) {
      const recovery = adoptWonderlandSnapshot(fresh(), snapshot(state, 1));
      expect(recovery.visualState).not.toBeNull();
      expect(recovery.terminal).toBe(juliusMissionStateIsTerminal(state));
    }
  });
});

/* ------------------------------------------- the requirement, end to end */

describe('reconnecting after the mission finished', () => {
  it('recovers COMPLETE and replays the whole history without moving', () => {
    // The requirement in one test. Every event of the mission arrives after the
    // snapshot and every one is refused, because each carries a revision from
    // before the snapshot. The world watches its own history and does not act.
    const { cursor, recovery, applied, verdicts } = rehydrateWonderland({
      projectId: PROJECT,
      snapshot: snapshot('COMPLETED', 6),
      replay: wholeHistory(),
    });

    expect(recovery?.visualState).toBe('complete');
    expect(recovery?.terminal).toBe(true);
    expect(applied).toEqual([]);
    expect(verdicts.every((v) => v === 'stale_revision')).toBe(true);
    expect(cursor.revision).toBe(6);
    expect(cursor.staleRevisions).toBe(wholeHistory().length);
  });

  it('is the revision axis that makes the full replay safe', () => {
    // Without a snapshot the same replay walks the entire mission, which is
    // exactly what must NOT happen on a reconnect. Stating the contrast makes
    // the mechanism explicit rather than incidental.
    const cold = rehydrateWonderland({
      projectId: PROJECT,
      snapshot: null,
      replay: wholeHistory(),
    });
    expect(cold.applied.length).toBe(wholeHistory().length);
    expect(cold.cursor.revision).toBe(6);
  });

  it('applies only what happened AFTER the snapshot', () => {
    // Joining at CODING (revision 3): the two events before it are refused and
    // the three after it are applied, so the world resumes rather than restarts.
    const { applied, cursor } = rehydrateWonderland({
      projectId: PROJECT,
      snapshot: snapshot('EXECUTING', 3),
      replay: wholeHistory(),
    });
    expect(applied.map((e) => e.state)).toEqual([
      'independent_review',
      'verifying',
      'complete',
    ]);
    // Three refused, not two: the event AT the snapshot's revision is refused
    // as well, because the run's own row is newer than any event of its
    // generation. See `revisionFromSnapshot`.
    expect(cursor.staleRevisions).toBe(3);
    expect(cursor.sequence).toBe(6);
  });

  it('refuses an event at the SNAPSHOT`s revision, because the row is newer', () => {
    // A snapshot is the run's own row at that revision, so it is strictly newer
    // than any event of the same generation. This is the clause that makes
    // "recover COMPLETE without replaying false transitions" literally true:
    // without it the replayed revision-6 CODING event would be accepted and the
    // world would walk backwards.
    const { applied } = rehydrateWonderland({
      projectId: PROJECT,
      snapshot: snapshot('EXECUTING', 3),
      replay: [event({ sequence: 9, revision: 3, state: 'attention' })],
    });
    expect(applied).toEqual([]);
  });

  it('treats two EVENTS at one revision as peers, which a snapshot is not', () => {
    // The other half of the same rule. A run does not transition on every
    // event, so events legitimately share a revision and must not refuse each
    // other — only a snapshot outranks its own generation.
    const { applied } = rehydrateWonderland({
      projectId: PROJECT,
      snapshot: null,
      replay: [
        event({ sequence: 1, revision: 4, state: 'coding' }),
        event({ sequence: 2, revision: 4, state: 'handoff' }),
      ],
    });
    expect(applied.length).toBe(2);
  });

  it('lets an accepted event re-open the generation a snapshot had closed', () => {
    // Once an event is accepted the revision is event-established again, so its
    // peers are peers once more. A snapshot's tie-break must not outlive the
    // snapshot itself.
    const { applied } = rehydrateWonderland({
      projectId: PROJECT,
      snapshot: snapshot('EXECUTING', 3),
      replay: [
        event({ sequence: 8, revision: 4, state: 'independent_review' }),
        event({ sequence: 9, revision: 4, state: 'verifying' }),
      ],
    });
    expect(applied.length).toBe(2);
  });

  it('asks the timeline for everything, and says why that is safe', () => {
    const resume = wonderlandResumeAfterSnapshot(snapshot('COMPLETED', 6));
    expect(resume.afterSequence).toBe(0);
    expect(resume.heldRevision).toBe(6);
    expect(resume.runId).toBe(RUN);
  });

  it('survives a cold start with neither snapshot nor replay', () => {
    const { cursor, recovery, applied } = rehydrateWonderland({
      projectId: PROJECT,
      snapshot: null,
      replay: [],
    });
    expect(recovery).toBeNull();
    expect(applied).toEqual([]);
    expect(cursor.sequence).toBe(0);
    expect(cursor.revision).toBe(0);
  });

  it('never lets a foreign run`s replay reach a recovered world', () => {
    const { applied, cursor } = rehydrateWonderland({
      projectId: PROJECT,
      snapshot: snapshot('EXECUTING', 3),
      replay: [
        event({ sequence: 10, revision: 9, runId: 'run-2', state: 'complete' }),
        event({ sequence: 11, revision: 9, projectId: 'project-2', state: 'complete' }),
      ],
    });
    expect(applied).toEqual([]);
    expect(cursor.foreignRuns).toBe(1);
    expect(cursor.foreignProjects).toBe(1);
  });
});
