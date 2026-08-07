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
  /**
   * WHAT THIS SCHEDULE'S RUNS BELONG TO, and part of the version because a
   * rebinding is an edit like any other — it changes what the schedule does
   * without changing when it does it, and the runs already created under the
   * old binding must keep explaining themselves.
   *
   * It lives HERE rather than in the tick request for the reason every stored
   * field does: what a schedule does must not be something the request that
   * wakes it gets to choose. While the binding came from the caller, the same
   * window ticked under three bindings produced nine runs where three were
   * intended — six of them in one Loop for the same three hours, each carrying
   * the stored schedule's contract.
   *
   * It lives in the VERSION rather than on the record because changing it is an
   * edit: it must be attributable, and a run created before the change has to
   * go on explaining itself. `governingVersionFor` resolves a run to the
   * version it started under, so its Loop is the one it was made for, not the
   * one the schedule points at now.
   */
  readonly projectId: string;
  readonly workspaceId: string | null;
  readonly loopId: string;
  /** Who made this version, and when. Both are evidence, never derived. */
  readonly authoredBy: string;
  readonly authoredAt: string;
}

/**
 * The fields a version is COMPARED on — what "changed" means for an edit.
 *
 * Exported because the bridge diffs the two newest versions to report what an
 * edit did, and a second copy of this list drifts silently: a field added here
 * and not there would be changed by an edit the response says changed nothing.
 * `version`, `authoredBy` and `authoredAt` are excluded — every edit changes
 * them, so they say nothing about what the edit DID.
 */
export const VERSIONED_CONTRACT_FIELDS = [
  'cronExpression', 'timeZone', 'contractRef', 'contractBindingDigest',
  'projectId', 'workspaceId', 'loopId',
] as const;

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
  | 'duplicate_version_in_history'
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
   * The runs still IN PROGRESS, each with the version it stays on. Returned
   * rather than left to inference, because "an in-progress run continues
   * under the version it started with" is a promise somebody has to keep and
   * cannot keep from a list it was never given.
   *
   * Named for what it is: review found this called `runsUnaffected`, which
   * was true of every run and so said nothing.
   */
  readonly activeRuns: readonly VersionedRun[];
  /**
   * EVERY run and the version it came from, active or not. The spec requires
   * an edit to preserve "which runs came from which version", and a plan that
   * carried only the active ones dropped completed runs' attribution for any
   * caller that persisted the plan.
   */
  readonly runAttribution: readonly VersionedRun[];
  /** What actually changed, named — a version whose diff nobody can state is
   *  a version nobody can review. */
  readonly changed: readonly (
    'cronExpression' | 'timeZone' | 'contractRef' | 'contractBindingDigest'
    | 'projectId' | 'workspaceId' | 'loopId'
  )[];
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

  // ONLY REPEATS ARE AMBIGUOUS. An earlier version also refused GAPS, on the
  // stated grounds that they "cannot say which version a run came from" —
  // which is false: a run citing v4 in [1, 2, 4] resolves unambiguously. The
  // spec's four sentences never require contiguity, so refusing it was an
  // invented constraint defended by an untrue reason. Review caught both.
  const seen = new Set<number>();
  for (const version of input.history) {
    if (seen.has(version.version)) {
      return {
        ok: false,
        refusal: 'duplicate_version_in_history',
        problem: `Version ${version.version} appears more than once. Two versions sharing a number `
          + 'genuinely cannot say which one a run citing it came from.',
      };
    }
    seen.add(version.version);
  }

  // The head is the HIGHEST version, not merely the last element: with gaps
  // permitted, position no longer implies order.
  const head = [...input.history].sort((a, b) => a.version - b.version)[input.history.length - 1] as
    CronContractVersion;

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

  const changed = VERSIONED_CONTRACT_FIELDS
    .filter((field) => input.proposed[field] !== head[field]);
  if (changed.length === 0) {
    // A version that changes nothing still splits the run history in two for
    // no reason, and later readers would look for a difference there is none
    // of.
    return {
      ok: false,
      refusal: 'no_change',
      problem: 'The proposed version changes no schedule or contract field. Appending it would '
        + 'split the run history at a point where nothing about the schedule changed. (Re-authoring '
        + 'alone is not a schedule change: the versioned unit is the schedule and contract.)',
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
      // edit does to the future. Copied, not passed through: L3 found the
      // caller's own objects handed back for anything to mutate.
      activeRuns: input.runs.filter((r) => r.active).map((r) => ({ ...r })),
      runAttribution: input.runs.map((r) => ({ ...r })),
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
  const matches = history.filter((v) => v.version === run.contractVersion);
  // A duplicated version number is ambiguous, and answering the FIRST match
  // would pick one silently — review found the two exports disagreeing about
  // exactly the history `planScheduleEdit` refuses.
  return matches.length === 1 ? (matches[0] as CronContractVersion) : null;
}
