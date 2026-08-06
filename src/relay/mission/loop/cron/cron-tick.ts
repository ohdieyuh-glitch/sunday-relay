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
 * - **An overlap SKIP claims too.** Skip means handled-without-a-run; an
 *   unclaimed skip returns next tick and eventually runs, which is queue
 *   semantics wearing skip's name.
 * - **Queue, replace-pending and refused do NOT claim.** They are not
 *   handled; the next tick re-decides them against fresh state.
 */

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
  readonly evaluation: Omit<CronEvaluationInput, 'digest'>;
  readonly missed: Omit<MissedRunInput, 'occurrences' | 'evaluatedAt'>;
  readonly overlap: { readonly policy: string; readonly state: OverlapState };
  readonly digest: (value: string) => string;
}

export type CronOccurrenceOutcome =
  | 'run_created' | 'duplicate_run' | 'claimed_but_run_not_created'
  | 'skipped_by_overlap_claimed' | 'queued_unclaimed' | 'replace_pending_unclaimed'
  | 'overlap_refused' | 'awaiting_confirmation' | 'skipped_by_missed_policy'
  | 'already_handled' | 'lock_unavailable' | 'lock_blocked' | 'claim_failed';

export interface CronTickOccurrenceReport {
  readonly occurrenceId: string;
  readonly outcome: CronOccurrenceOutcome;
  readonly detail?: string;
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
  const evaluated = dueCronOccurrences(input.tz, { ...input.evaluation, digest: input.digest });
  if (!evaluated.ok) return { ok: false, refusal: evaluated.refusal, problem: evaluated.problem };

  const decision = decideMissedRuns({
    ...input.missed,
    occurrences: evaluated.occurrences,
    evaluatedAt: input.evaluation.untilInclusive,
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

    // dispatch and skip both CLAIM — the difference is whether a run follows.
    const claimed = claimOccurrence(claim, occurrence);
    if (claimed.kind !== 'claimed') {
      report.push({
        occurrenceId: occurrence.occurrenceId,
        outcome: claimed.kind,
        ...(('problem' in claimed) ? { detail: claimed.problem } : {}),
      });
      continue;
    }
    const journalNote = claimed.journalRecorded ? '' : ' (trigger journal event NOT recorded)';

    if (overlap.action === 'skip') {
      report.push({
        occurrenceId: occurrence.occurrenceId,
        outcome: 'skipped_by_overlap_claimed',
        detail: overlap.reason + journalNote,
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
        detail: created.problem + journalNote,
      });
      continue;
    }
    if (!created.duplicate) activeRuns += 1;
    report.push({
      occurrenceId: occurrence.occurrenceId,
      outcome: created.duplicate ? 'duplicate_run' : 'run_created',
      detail: created.runId + journalNote,
    });
  }

  return { ok: true, occurrences: report, truncated: evaluated.truncated };
}
