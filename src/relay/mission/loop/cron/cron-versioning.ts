/**
 * SUNDAY RELAY — EDITING A SCHEDULE WITHOUT REWRITING ITS PAST.
 *
 * CRON_LOOPS.md: "Editing a Cron Loop creates a new contract version,
 * preserving the previous schedule and contract, the change author and time,
 * and which runs came from which version. An in-progress run continues under
 * the version it started with. Changing the future schedule never mutates an
 * active run."
 *
 * Every clause is a refusal of the obvious implementation, which is to edit
 * the schedule in place:
 *
 * - **An edit APPENDS.** The previous version keeps its own schedule, its own
 *   contract and its own identity, because the runs that came from it are
 *   evidence of what was actually asked for. A schedule whose history is
 *   overwritten cannot answer "why did it run then?", and that question is
 *   the entire reason the occurrence identity carries `contractVersion`.
 * - **An in-progress run keeps ITS version.** Not the newest. A run that
 *   started under version 3 is a version-3 run until it ends, however many
 *   edits land while it is running.
 * - **A future-schedule change never touches an active run**, so this returns
 *   the runs it must NOT disturb rather than leaving a caller to infer them.
 *
 * WHAT IT REFUSES TO INVENT. Nothing here allocates a version number from a
 * clock or a counter it owns: the caller supplies the current head, and this
 * says what the next one is and what must be preserved. There is no schedule
 * store in this repository (CRON_LOOPS.md says so), so a module that minted
 * identities would be inventing the storage it does not have.
 */

import { readIsoInstantWithOffset } from '../runtime/loop-scheduler';

export interface CronContractVersion {
  readonly version: number;
  /** The cron expression this version schedules, verbatim. */
  readonly cronExpression: string;
  /** Its IANA timezone. A change here is an edit like any other — and it is
   *  the one CRON_LOOPS.md calls out, because rewriting historical triggers
   *  after a zone change would relabel when work actually happened. */
  readonly timeZone: string;
  readonly contractRef: string;
  readonly contractBindingDigest: string;
  /** Who made this version, and when. Both are evidence, never derived. */
  readonly authoredBy: string;
  readonly authoredAt: string;
}

/** A run, and the version it started under. */
export interface VersionedRun {
  readonly runId: string;
  readonly contractVersion: number;
  readonly active: boolean;
}

export interface ScheduleEditInput {
  /** Every version so far, oldest first. Never rewritten. */
  readonly history: readonly CronContractVersion[];
  /** The proposed change. Its `version` is ignored — this module derives it. */
  readonly proposed: Omit<CronContractVersion, 'version'>;
  readonly runs: readonly VersionedRun[];
}

export type ScheduleEditRefusal =
  | 'empty_history'
  | 'non_contiguous_history'
  | 'unauthored_edit'
  | 'unreadable_authored_at'
  | 'no_change'
  | 'run_cites_unknown_version';

export interface ScheduleEditPlan {
  /** The version to append. Derived from the head, never minted freely. */
  readonly nextVersion: CronContractVersion;
  /** The full history AFTER the edit: every previous version, unchanged. */
  readonly history: readonly CronContractVersion[];
  /**
   * Runs that must not be disturbed by this edit, each with the version it
   * stays on. Returned rather than left to inference, because "an in-progress
   * run continues under the version it started with" is a promise somebody
   * has to keep and cannot keep from a list it was never given.
   */
  readonly runsUnaffected: readonly VersionedRun[];
  /** What actually changed, named — a version whose diff nobody can state is
   *  a version nobody can review. */
  readonly changed: readonly ('cronExpression' | 'timeZone' | 'contractRef' | 'contractBindingDigest')[];
}

export type ScheduleEditDecision =
  | { readonly ok: true; readonly plan: ScheduleEditPlan }
  | { readonly ok: false; readonly refusal: ScheduleEditRefusal; readonly problem: string };

/**
 * Plan one edit.
 *
 * Pure and total. The history it returns CONTAINS the history it was given,
 * unchanged and in order — an edit that rewrote a previous version would
 * destroy the evidence of what past runs were actually asked to do.
 */
export function planScheduleEdit(input: ScheduleEditInput): ScheduleEditDecision {
  if (input.history.length === 0) {
    return {
      ok: false,
      refusal: 'empty_history',
      problem: 'A schedule with no versions cannot be edited; it can only be created. Nothing was '
        + 'appended.',
    };
  }

  // A history with gaps or repeats cannot say which version a run came from,
  // and that mapping is the thing versioning exists to preserve.
  for (const [index, version] of input.history.entries()) {
    if (version.version !== index + 1) {
      return {
        ok: false,
        refusal: 'non_contiguous_history',
        problem: `Version ${version.version} appears at position ${index + 1}. A history with gaps `
          + 'or repeats cannot say which version a run came from.',
      };
    }
  }

  const head = input.history[input.history.length - 1] as CronContractVersion;

  const known = new Set(input.history.map((v) => v.version));
  const orphaned = input.runs.filter((r) => !known.has(r.contractVersion));
  if (orphaned.length > 0) {
    return {
      ok: false,
      refusal: 'run_cites_unknown_version',
      problem: `These runs cite versions this history does not contain: `
        + `${orphaned.map((r) => `${r.runId}@v${r.contractVersion}`).join(', ')}. Appending would `
        + 'leave them permanently unexplainable.',
    };
  }

  if (input.proposed.authoredBy.trim() === '') {
    return {
      ok: false,
      refusal: 'unauthored_edit',
      problem: 'An edit must record who made it. "The change author and time" is evidence a later '
        + 'reader needs, and an unattributed version cannot provide it.',
    };
  }
  if (readIsoInstantWithOffset(input.proposed.authoredAt) === null) {
    return {
      ok: false,
      refusal: 'unreadable_authored_at',
      problem: 'authoredAt must be an ISO-8601 instant carrying an explicit UTC offset, so the '
        + 'moment of the change means the same thing to every reader.',
    };
  }

  const changed = ([
    'cronExpression', 'timeZone', 'contractRef', 'contractBindingDigest',
  ] as const).filter((field) => input.proposed[field] !== head[field]);
  if (changed.length === 0) {
    // A version that changes nothing still splits the run history in two for
    // no reason, and later readers would look for a difference there is none
    // of.
    return {
      ok: false,
      refusal: 'no_change',
      problem: 'The proposed version is identical to the current one. Appending it would split the '
        + 'run history at a point where nothing changed.',
    };
  }

  const nextVersion: CronContractVersion = { ...input.proposed, version: head.version + 1 };

  return {
    ok: true,
    plan: {
      nextVersion,
      // APPEND. Every previous version rides through untouched — including
      // the one being superseded, whose schedule explains its own runs.
      history: [...input.history, nextVersion],
      // An in-progress run keeps the version it started under, whatever the
      // edit does to the future.
      runsUnaffected: input.runs.filter((r) => r.active),
      changed,
    },
  };
}

/**
 * Which version a run is governed by, now.
 *
 * Deliberately NOT "the newest": a run that started under version 3 is a
 * version-3 run until it ends. `null` when the run cites a version the
 * history does not contain — unknown, rather than the head as a guess.
 */
export function governingVersionFor(
  run: VersionedRun,
  history: readonly CronContractVersion[],
): CronContractVersion | null {
  return history.find((v) => v.version === run.contractVersion) ?? null;
}
