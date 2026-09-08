/**
 * JOINING A MISSION ALREADY IN PROGRESS.
 *
 * A world is not usually opened at the moment a mission starts. A founder
 * arrives during CODING, closes the tab through INDEPENDENT_REVIEW, and comes
 * back after it finished — and in all three cases the world has to show what is
 * true now, not the beginning of a story.
 *
 * TWO SOURCES, AND THEY ANSWER DIFFERENT QUESTIONS.
 *
 *   the SNAPSHOT   `JuliusRuntimeApi.inspectRun` — the run's state and its
 *                  `julius_runs.version`. Authoritative about NOW. Carries no
 *                  sequence, because a state is not an event.
 *
 *   the TIMELINE   `JuliusRuntimeApi.timeline(sinceSequence)` — the events
 *                  after a cursor. Authoritative about WHAT HAPPENED.
 *
 * A SNAPSHOT SETS THE STATE; IT NEVER REPLAYS ONE. Recovering CODING means
 * showing CODING, not walking a dog through ATTENTION and PROMPT_ARCHITECT
 * first at animation speed. Those transitions did happen, and they happened
 * while nobody was watching; performing them now would be theatre presented as
 * observation.
 *
 * THE PART THAT MAKES A FULL REPLAY SAFE. A snapshot has no sequence, so after
 * taking one there is no cursor to resume from and the only honest ask is
 * "everything". That would be a disaster on the sequence axis alone — the
 * replay starts at CREATED and would walk the world backwards through the whole
 * mission. It is safe here because every replayed event carries the run
 * revision it belongs to, and anything below the snapshot's revision is refused
 * as stale. The world holds COMPLETE and watches the entire history arrive
 * without moving. That is the revision axis earning its place: without it,
 * snapshot-then-replay could not be done at all.
 */

import { exactKeys } from './wonderland-contracts';
import {
  JULIUS_MISSION_STATES,
  type JuliusMissionState,
} from '../julius/julius-runtime';
import { transitionIsLegal } from '../julius/julius-state-path';
import { JULIUS_RUN_STATE_VISUAL_STATE } from './wonderland-julius-state';
import type { JuliusVisualState } from './wonderland-julius-state';
import { applyWonderlandOrdering, openWonderlandCursor } from './wonderland-ordering';
import type {
  WonderlandCursor,
  WonderlandOrderingVerdict,
  WonderlandResumeRequest,
} from './wonderland-ordering';
import type { WonderlandEnvelope } from './wonderland-envelope';

/* ------------------------------------------------------------ versioning */

export const WONDERLAND_SNAPSHOT_SCHEMA_V1 = 'relay-wonderland-snapshot.v1' as const;
export type WonderlandSnapshotSchemaVersion = typeof WONDERLAND_SNAPSHOT_SCHEMA_V1;

/* -------------------------------------------------------- terminal states */

/**
 * WHICH KERNEL STATES END A RUN — DERIVED FROM THE KERNEL'S OWN GUARD.
 *
 * `transitionMission`'s table is module-private and `julius-state-path.ts`
 * exists precisely so nobody copies it. A state is terminal exactly when no
 * legal move leaves it, so this probes rather than restates: if Julius ever
 * makes FAILED recoverable, this follows without an edit, and if it adds a
 * fourth ending this finds it.
 */
export const JULIUS_TERMINAL_MISSION_STATES: readonly JuliusMissionState[] = Object.freeze(
  JULIUS_MISSION_STATES.filter((from) =>
    JULIUS_MISSION_STATES.every((to) => !transitionIsLegal(from, to)),
  ),
);

const TERMINAL_MEMBERS: ReadonlySet<string> = new Set<string>(JULIUS_TERMINAL_MISSION_STATES);

/** True when the kernel says this run is over. Never inferred from a visual state. */
export const juliusMissionStateIsTerminal = (state: JuliusMissionState): boolean =>
  TERMINAL_MEMBERS.has(state);

/* --------------------------------------------------------- the snapshot */

/**
 * THE RUN AS IT IS NOW, in the shape `JuliusRuntimeApi.inspectRun` returns.
 *
 * Deliberately a SUBSET. `JuliusRunView` also carries card, contract and brain
 * revisions and a full task-state histogram; none of that changes what a world
 * draws, and a field mirrored here that nothing reads is a migration cost with
 * no reader. `activeTasks` and `pendingApprovals` are kept because "is anything
 * running" and "is a human being waited on" are questions a world answers
 * visually.
 */
export interface WonderlandRunSnapshot {
  readonly schemaVersion: WonderlandSnapshotSchemaVersion;
  readonly projectId: string;
  readonly juliusInstanceId: string | null;
  readonly runId: string;
  readonly missionId: string | null;
  /** The kernel's own word for the run's state. */
  readonly state: JuliusMissionState;
  /** `julius_runs.version`. The authority on which snapshot is newer. */
  readonly revision: number;
  /**
   * The ledger sequence this snapshot is consistent with, when the reader can
   * say — `MAX(sequence)` for the run, read in the same pass as the row.
   *
   * WHY IT HAD TO EXIST, and the failure it closes. Only a state TRANSITION
   * bumps `julius_runs.version`; `review.started`, `finding.recorded` and both
   * subagent events do not. So after adopting a snapshot at revision 10, every
   * genuinely new event of those kinds also arrives at revision 10 and the
   * revision tie-break refused all of them — the world went DEAF until the run
   * happened to change state. Reproduced end to end before this field existed.
   *
   * Null when the reader genuinely cannot supply it, and the conservative
   * tie-break still applies in that case. What is never done is GUESSING one:
   * a guess too high skips events and a guess too low claims to have applied
   * events nobody saw.
   */
  readonly atSequence: number | null;
  /** When the snapshot was taken, not when the run last changed. */
  readonly observedAtIso: string;
  /** Null when the reader could not supply it. Never a guessed zero. */
  readonly activeTasks: number | null;
  readonly pendingApprovals: number | null;
}

export const WONDERLAND_RUN_SNAPSHOT_FIELDS = exactKeys<WonderlandRunSnapshot>()([
  'schemaVersion',
  'projectId',
  'juliusInstanceId',
  'runId',
  'missionId',
  'state',
  'revision',
  'atSequence',
  'observedAtIso',
  'activeTasks',
  'pendingApprovals',
]);

export function wonderlandRunSnapshot(input: {
  readonly projectId: string;
  readonly runId: string;
  readonly state: JuliusMissionState;
  readonly revision: number;
  readonly atSequence?: number | null;
  readonly observedAtIso: string;
  readonly juliusInstanceId?: string | null;
  readonly missionId?: string | null;
  readonly activeTasks?: number | null;
  readonly pendingApprovals?: number | null;
}): WonderlandRunSnapshot {
  return Object.freeze({
    schemaVersion: WONDERLAND_SNAPSHOT_SCHEMA_V1,
    projectId: input.projectId,
    juliusInstanceId: input.juliusInstanceId ?? null,
    runId: input.runId,
    missionId: input.missionId ?? null,
    state: input.state,
    revision: input.revision,
    // A position or nothing. A negative or fractional sequence is a reader
    // fault, and carrying it would put a cursor somewhere no event can be.
    atSequence:
      typeof input.atSequence === 'number' &&
      Number.isSafeInteger(input.atSequence) &&
      input.atSequence >= 0
        ? input.atSequence
        : null,
    observedAtIso: input.observedAtIso,
    activeTasks: input.activeTasks ?? null,
    pendingApprovals: input.pendingApprovals ?? null,
  });
}

/* --------------------------------------------------------- the recovery */

export const WONDERLAND_SNAPSHOT_VERDICTS = [
  'adopted',
  /** Its revision is at or below what we hold. Not newer, so not news. */
  'stale_revision',
  'foreign_project',
  'foreign_julius',
  'foreign_run',
  'malformed',
] as const;
export type WonderlandSnapshotVerdict = (typeof WONDERLAND_SNAPSHOT_VERDICTS)[number];

/**
 * Judge a snapshot against a cursor.
 *
 * `stale_revision` uses `<=` where the event check uses `<`, and the difference
 * is real: two events can share a revision legitimately, but re-adopting a
 * snapshot at the revision already held is pure churn — it re-renders the same
 * state and, if the caller is not careful, restarts an animation.
 */
export function wonderlandSnapshotVerdict(
  cursor: WonderlandCursor,
  snapshot: WonderlandRunSnapshot,
): WonderlandSnapshotVerdict {
  if (snapshot.projectId !== cursor.projectId) return 'foreign_project';
  if (
    cursor.juliusInstanceId !== null &&
    snapshot.juliusInstanceId !== null &&
    snapshot.juliusInstanceId !== cursor.juliusInstanceId
  ) {
    return 'foreign_julius';
  }
  if (cursor.runId !== null && snapshot.runId !== cursor.runId) return 'foreign_run';
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) return 'malformed';
  if (snapshot.runId.length === 0) return 'malformed';
  if (cursor.applied > 0 && snapshot.revision <= cursor.revision) return 'stale_revision';
  return 'adopted';
}

/** What a world holds after recovering. */
export interface WonderlandRecovery {
  readonly cursor: WonderlandCursor;
  readonly verdict: WonderlandSnapshotVerdict;
  /** What to draw. Null only when nothing has been adopted. */
  readonly visualState: JuliusVisualState | null;
  /** Set only when the KERNEL says the run is over. */
  readonly terminal: boolean;
  /** The kernel state behind the visual one, so the collapse loses nothing. */
  readonly sourceState: JuliusMissionState | null;
  /** A sentence whenever nothing was adopted. */
  readonly reason: string | null;
}

/**
 * Adopt a snapshot. THE STATE IS SET, NOT REPLAYED.
 *
 * TWO MODES, AND THE DIFFERENCE IS THE READER'S HONESTY ABOUT ITS OWN POSITION.
 *
 * WITH `atSequence` — the reader read `MAX(sequence)` for the run alongside the
 * row, so the snapshot's place in the stream is KNOWN. The cursor moves to it,
 * and everything at or before it is refused on SEQUENCE, which is precise: a
 * pre-snapshot replay is behind, and genuinely new work is ahead, whatever the
 * revision happens to be. `revisionFromSnapshot` is then left off, because the
 * blunt tie-break it drives is not only unnecessary but WRONG — only a state
 * transition bumps `julius_runs.version`, so new review, finding and subagent
 * events all arrive at the snapshot's own revision and the tie-break refused
 * every one of them. The world went deaf until the run changed state.
 *
 * WITHOUT it — the reader could not say, so the conservative tie-break stands:
 * anything AT the snapshot's revision is treated as already absorbed. That
 * refuses some genuinely new events, which is the safer of the two errors when
 * position is unknown: showing stale work is worse than showing less of it.
 *
 * What is never done is GUESSING a sequence. Too high skips events; too low
 * claims to have applied events nobody saw.
 */
export function adoptWonderlandSnapshot(
  cursor: WonderlandCursor,
  snapshot: WonderlandRunSnapshot,
): WonderlandRecovery {
  const verdict = wonderlandSnapshotVerdict(cursor, snapshot);
  if (verdict !== 'adopted') {
    return Object.freeze({
      cursor,
      verdict,
      visualState: null,
      terminal: false,
      sourceState: null,
      reason: SNAPSHOT_REFUSALS[verdict],
    });
  }
  const positioned = snapshot.atSequence !== null;
  return Object.freeze({
    cursor: Object.freeze({
      ...cursor,
      juliusInstanceId: snapshot.juliusInstanceId ?? cursor.juliusInstanceId,
      runId: snapshot.runId,
      revision: Math.max(cursor.revision, snapshot.revision),
      // Never backwards. A snapshot that named an older position than one we
      // have already passed would otherwise re-open events we applied.
      sequence: positioned
        ? Math.max(cursor.sequence, snapshot.atSequence as number)
        : cursor.sequence,
      // Only the unpositioned snapshot needs the blunt instrument. See above.
      revisionFromSnapshot: !positioned,
      lastAppliedAtIso: snapshot.observedAtIso,
    }),
    verdict,
    visualState: JULIUS_RUN_STATE_VISUAL_STATE[snapshot.state],
    terminal: juliusMissionStateIsTerminal(snapshot.state),
    sourceState: snapshot.state,
    reason: null,
  });
}

const SNAPSHOT_REFUSALS: Readonly<Record<Exclude<WonderlandSnapshotVerdict, 'adopted'>, string>> =
  Object.freeze({
    stale_revision: 'This snapshot is not newer than the state already held.',
    foreign_project: 'This snapshot belongs to another world.',
    foreign_julius: 'This snapshot belongs to a different Julius instance.',
    foreign_run: 'This snapshot belongs to a run this world is not following.',
    malformed: 'This snapshot is missing the identity or revision it needs to be used.',
  });

/**
 * What to ask the timeline for after adopting a snapshot.
 *
 * `afterSequence: 0` — everything. Not a fallback and not laziness: a snapshot
 * genuinely has no sequence, and asking from a guessed one would silently skip
 * events. The full replay is safe because `heldRevision` refuses every event
 * from before the snapshot, so the world watches its own history arrive and
 * does not move. See the module comment.
 */
export const wonderlandResumeAfterSnapshot = (
  snapshot: WonderlandRunSnapshot,
): WonderlandResumeRequest =>
  Object.freeze({
    projectId: snapshot.projectId,
    runId: snapshot.runId,
    afterSequence: 0,
    heldRevision: snapshot.revision,
  });

/**
 * THE WHOLE RECOVERY, as one fold: snapshot first, then the replay.
 *
 * Ordered on purpose. Taking the snapshot first is what makes the replay
 * harmless; replaying first and snapshotting after would animate the entire
 * mission before correcting itself, which is the exact behaviour a founder
 * reads as the product being confused about what it is doing.
 */
export function rehydrateWonderland(input: {
  readonly projectId: string;
  readonly snapshot: WonderlandRunSnapshot | null;
  readonly replay: readonly WonderlandEnvelope[];
}): {
  readonly cursor: WonderlandCursor;
  readonly recovery: WonderlandRecovery | null;
  readonly applied: readonly WonderlandEnvelope[];
  readonly verdicts: readonly WonderlandOrderingVerdict[];
} {
  let cursor = openWonderlandCursor({ projectId: input.projectId });
  let recovery: WonderlandRecovery | null = null;

  if (input.snapshot !== null) {
    recovery = adoptWonderlandSnapshot(cursor, input.snapshot);
    cursor = recovery.cursor;
  }

  const applied: WonderlandEnvelope[] = [];
  const verdicts: WonderlandOrderingVerdict[] = [];
  for (const envelope of input.replay) {
    const step = applyWonderlandOrdering(cursor, envelope);
    cursor = step.cursor;
    verdicts.push(step.verdict);
    if (step.verdict === 'applied') applied.push(envelope);
  }

  return {
    cursor,
    recovery,
    applied: Object.freeze(applied),
    verdicts: Object.freeze(verdicts),
  };
}
