/**
 * SUNDAY RELAY — ONE CRON TICK.
 *
 * The composition CRON_LOOPS.md's pieces were built for: evaluate the window
 * (`dueCronOccurrences`), decide what an offline gap owes
 * (`decideMissedRuns`), decide what may run beside what is live
 * (`decideOverlap`), claim before effect (`claimOccurrence`), and only then
 * create a run through the injected port. PURE: the clock, the zone, the
 * disk and the run store all arrive as arguments; a tick is a bounded pass a
 * test can hold in one hand, exactly like the worker's.
 *
 * EVERY OCCURRENCE THE WINDOW OWES LANDS IN THE REPORT WITH ITS OUTCOME —
 * the worker's no-silent-skips rule, one level up. Three claiming rules:
 *
 * - **Dispatch claims first.** The marker is written before the run exists;
 *   a run-creation failure AFTER the claim is `claimed_but_run_not_created`,
 *   loud, because the marker will (rightly) refuse a replay and a human must
 *   decide — a retry that silently re-created the run would spend twice.
 * - **A HANDLED overlap skip claims too.** The `skip` policy means
 *   handled-without-a-run; an unclaimed skip returns next tick and eventually
 *   runs, which is queue semantics wearing skip's name.
 * - **Queue, replace-pending, refused and CAPACITY skips do NOT claim.**
 *   They are not handled; the next tick re-decides them against fresh state.
 *   The queue depth this pass counts is a LOCAL MODEL of what the caller is
 *   expected to enqueue — nothing here writes a queue — so an occurrence
 *   overflowing it must never be marked handled against a queue that may not
 *   exist.
 */

import { readIsoInstantWithOffset } from '../runtime/loop-scheduler';
import { dueCronOccurrences, type CronEvaluationInput, type CronOccurrence } from './cron-occurrences';
import { decideMissedRuns, type MissedRunInput } from './cron-missed';
import { decideOverlap, type OverlapState } from './cron-overlap';
import { claimOccurrence, type OccurrenceClaimPort } from './cron-claim';
import type { TimezonePort } from './timezone-port';

export interface CronRunCreationPort {
  /** Create the run for a CLAIMED occurrence. The bridge wires
   *  `confirmLoopRun` with `creationSource: 'schedule'` and a run id derived
   *  from the occurrence id — derived, never minted, so its own idempotency
   *  holds if this port is ever reached twice. */
  createRun(occurrence: CronOccurrence):
    | { readonly ok: true; readonly runId: string; readonly duplicate: boolean }
    | { readonly ok: false; readonly problem: string };
}

export interface CronTickInput {
  readonly tz: TimezonePort;
  /**
   * When this tick is actually running, ISO-8601 with an explicit offset.
   * A REAL clock, supplied by the caller: the first version silently reused
   * the window's end as the evaluation instant, so a tick running hours late
   * measured every age cap from the window end and under-skipped stale work —
   * a clock the header claimed was an argument while substituting one.
   */
  readonly evaluatedAt: string;
  readonly evaluation: Omit<CronEvaluationInput, 'digest'>;
  readonly missed: Omit<MissedRunInput, 'occurrences' | 'evaluatedAt'>;
  readonly overlap: { readonly policy: string; readonly state: OverlapState };
  readonly digest: (value: string) => string;
}

export type CronOccurrenceOutcome =
  | 'run_created' | 'duplicate_run' | 'claimed_but_run_not_created'
  | 'skipped_by_overlap_claimed' | 'skipped_by_capacity_unclaimed'
  | 'queued_unclaimed' | 'replace_pending_unclaimed'
  | 'overlap_refused' | 'awaiting_confirmation' | 'skipped_by_missed_policy'
  | 'already_handled' | 'lock_unavailable' | 'lock_blocked' | 'claim_failed';

export interface CronTickOccurrenceReport {
  readonly occurrenceId: string;
  readonly outcome: CronOccurrenceOutcome;
  readonly detail?: string;
  /**
   * Present whenever this occurrence was CLAIMED: false means the marker
   * holds but the trigger journal event is missing. A structured field, not
   * a phrase inside `detail` — the first version concatenated the warning
   * onto the run id, so a caller had to substring-match for a gap in the
   * operations record and the run id itself became unparseable.
   */
  readonly journalRecorded?: boolean;
}

export type CronTickReport =
  | { readonly ok: false; readonly refusal: string; readonly problem: string }
  | {
      readonly ok: true;
      readonly occurrences: readonly CronTickOccurrenceReport[];
      /** The evaluator cut the window short; the next tick owes the rest. */
      readonly truncated: boolean;
    };

/** One bounded tick. Total: every failure is an outcome, never a throw. */
export function runCronTick(
  claim: OccurrenceClaimPort,
  runs: CronRunCreationPort,
  input: CronTickInput,
): CronTickReport {
  const nowMs = readIsoInstantWithOffset(input.evaluatedAt);
  if (nowMs === null) {
    return {
      ok: false,
      refusal: 'invalid_clock',
      problem: 'evaluatedAt must be an ISO-8601 instant carrying an explicit UTC offset.',
    };
  }
  const untilMs = readIsoInstantWithOffset(input.evaluation.untilInclusive);
  if (untilMs !== null && untilMs > nowMs) {
    // A window ending in the FUTURE would dispatch occurrences that have not
    // happened yet — probed in review, nine runs created for a window whose
    // end had not arrived. The window may only ever reach the present.
    return {
      ok: false,
      refusal: 'future_window',
      problem: `The window ends at ${input.evaluation.untilInclusive}, after the evaluation instant `
        + `${input.evaluatedAt}. An occurrence that has not happened cannot be due.`,
    };
  }

  const evaluated = dueCronOccurrences(input.tz, { ...input.evaluation, digest: input.digest });
  if (!evaluated.ok) return { ok: false, refusal: evaluated.refusal, problem: evaluated.problem };

  if (evaluated.truncated && input.missed.policy === 'run_latest') {
    // `run_latest` promises ONE run: the newest. A truncated window's last
    // occurrence is not the newest, so honouring the policy here would run
    // an occurrence AND leave a newer one for the next tick — two runs from
    // a policy that promised one. Refused rather than quietly broken.
    return {
      ok: false,
      refusal: 'truncated_window_under_run_latest',
      problem: 'The evaluator truncated the window, so its last occurrence is not the latest one. '
        + 'run_latest cannot keep its promise here: raise maxOccurrences or narrow the window.',
    };
  }

  const decision = decideMissedRuns({
    ...input.missed,
    occurrences: evaluated.occurrences,
    evaluatedAt: input.evaluatedAt,
  });

  const report: CronTickOccurrenceReport[] = [];
  for (const skipped of decision.skipped) {
    report.push({
      occurrenceId: skipped.occurrenceId,
      outcome: 'skipped_by_missed_policy',
      detail: skipped.reason,
    });
  }
  for (const held of decision.awaitingConfirmation) {
    report.push({ occurrenceId: held.occurrenceId, outcome: 'awaiting_confirmation' });
  }

  // Overlap state evolves WITHIN the tick: a run created here is live for
  // the next occurrence's decision, or a limit of one would admit a stampede
  // one occurrence at a time.
  let activeRuns = input.overlap.state.activeRuns;
  let queuedRuns = input.overlap.state.queuedRuns;

  for (const occurrence of decision.dispatch) {
    const overlap = decideOverlap(input.overlap.policy, {
      ...input.overlap.state, activeRuns, queuedRuns,
    });

    if (overlap.action === 'refused') {
      report.push({ occurrenceId: occurrence.occurrenceId, outcome: 'overlap_refused', detail: overlap.reason });
      continue;
    }
    if (overlap.action === 'queue') {
      queuedRuns += 1;
      report.push({ occurrenceId: occurrence.occurrenceId, outcome: 'queued_unclaimed', detail: overlap.reason });
      continue;
    }
    if (overlap.action === 'replace_after_safe_stop') {
      report.push({
        occurrenceId: occurrence.occurrenceId, outcome: 'replace_pending_unclaimed', detail: overlap.reason,
      });
      continue;
    }
    if (overlap.action === 'skip' && !overlap.handled) {
      // CAPACITY, not handling. The queue this tick counted is a local
      // model — nothing here enqueues — so claiming an overflow would drop
      // an occurrence permanently for a shortage that clears, against a
      // queue that was never written. Review probed exactly that: two
      // occurrences claimed forever, zero runs, no queue anywhere.
      report.push({
        occurrenceId: occurrence.occurrenceId,
        outcome: 'skipped_by_capacity_unclaimed',
        detail: overlap.reason,
      });
      continue;
    }

    // A dispatch and a HANDLED skip both claim — the difference is whether a
    // run follows.
    const claimed = claimOccurrence(claim, occurrence);
    if (claimed.kind !== 'claimed') {
      report.push({
        occurrenceId: occurrence.occurrenceId,
        outcome: claimed.kind,
        ...(('problem' in claimed) ? { detail: claimed.problem } : {}),
      });
      continue;
    }
    const journalRecorded = claimed.journalRecorded;

    if (overlap.action === 'skip') {
      report.push({
        occurrenceId: occurrence.occurrenceId,
        outcome: 'skipped_by_overlap_claimed',
        detail: overlap.reason,
        journalRecorded,
      });
      continue;
    }

    let created: ReturnType<CronRunCreationPort['createRun']>;
    try {
      created = runs.createRun(occurrence);
    } catch (error) {
      created = {
        ok: false,
        problem: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      };
    }
    if (!created.ok) {
      // The marker holds; a replay is rightly refused; a human decides.
      report.push({
        occurrenceId: occurrence.occurrenceId,
        outcome: 'claimed_but_run_not_created',
        detail: created.problem,
        journalRecorded,
      });
      continue;
    }
    // A DUPLICATE counts as live too. It means a run for this occurrence
    // already exists, and whether it is still running is unknown — assuming
    // it finished is the fail-open guess that let a limit of one admit two,
    // found by review.
    activeRuns += 1;
    report.push({
      occurrenceId: occurrence.occurrenceId,
      outcome: created.duplicate ? 'duplicate_run' : 'run_created',
      detail: created.runId,
      journalRecorded,
    });
  }

  return { ok: true, occurrences: report, truncated: evaluated.truncated };
}
