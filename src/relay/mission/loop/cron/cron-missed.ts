/**
 * SUNDAY RELAY — WHAT A SCHEDULE OWES AFTER BEING OFFLINE.
 *
 * CRON_LOOPS.md's missed-run policies as one pure decision, with the rule
 * that outranks every policy first: **external-write, deployment and
 * financial work is never auto-caught-up**. Relay must not run days of stale
 * high-risk operations because a worker was offline — such occurrences wait
 * for a human, whatever the policy says, and the decision says so by name.
 *
 * Every missed occurrence lands in exactly one bucket: dispatched, awaiting
 * confirmation, or skipped with a reason. "The pass will get to it" is how
 * starvation hides; a catch-up that silently drops is how staleness does.
 */

import { readIsoInstantWithOffset } from '../runtime/loop-scheduler';
import type { CronOccurrence } from './cron-occurrences';

export const RELAY_MISSED_RUN_POLICIES =
  ['skip_missed', 'run_latest', 'run_all_with_limit', 'require_confirmation'] as const;
export type RelayMissedRunPolicy = (typeof RELAY_MISSED_RUN_POLICIES)[number];

export const RELAY_CRON_WORK_CLASSES =
  ['read_only', 'external_write', 'deployment', 'financial'] as const;
export type RelayCronWorkClass = (typeof RELAY_CRON_WORK_CLASSES)[number];

const HIGH_RISK: readonly RelayCronWorkClass[] = ['external_write', 'deployment', 'financial'];

export interface MissedRunInput {
  readonly policy: string;
  readonly workClass: string;
  /** Missed occurrences, ascending by resolved instant. */
  readonly occurrences: readonly CronOccurrence[];
  /** The instant the decision is made, ISO-8601 with explicit offset. */
  readonly evaluatedAt: string;
  /** Occurrences older than this are stale beyond catching up. */
  readonly maxCatchUpAgeMinutes?: number;
  /** Required by `run_all_with_limit`. */
  readonly maxCatchUpRuns?: number;
}

export interface MissedRunDecision {
  readonly dispatch: readonly CronOccurrence[];
  readonly awaitingConfirmation: readonly CronOccurrence[];
  readonly skipped: readonly {
    readonly occurrenceId: string;
    readonly reason: string;
  }[];
}

const allSkipped = (
  occurrences: readonly CronOccurrence[],
  reason: string,
): MissedRunDecision => ({
  dispatch: [],
  awaitingConfirmation: [],
  skipped: occurrences.map((o) => ({ occurrenceId: o.occurrenceId, reason })),
});

/** One offline gap, one decision, every occurrence accounted for. */
export function decideMissedRuns(input: MissedRunInput): MissedRunDecision {
  const evaluatedMs = readIsoInstantWithOffset(input.evaluatedAt);
  if (evaluatedMs === null) {
    return allSkipped(input.occurrences,
      'evaluatedAt must be an ISO-8601 instant with an explicit offset; nothing was decided.');
  }

  // Configuration errors surface for EVERY work class — review found an
  // unknown class masking an invalid age cap the known classes reported.
  if (input.maxCatchUpAgeMinutes !== undefined
    && (!Number.isInteger(input.maxCatchUpAgeMinutes) || input.maxCatchUpAgeMinutes < 1)) {
    return allSkipped(input.occurrences,
      `maxCatchUpAgeMinutes must be a positive integer; got ${String(input.maxCatchUpAgeMinutes)}. Nothing was decided.`);
  }

  // Every occurrence instant must READ before it can be compared. Date.parse
  // NaN compares false against every age bound, so a garbage instant sailed
  // through the age gate as "fresh" — unknown guessed as new, found in
  // review. The scheduler's own instant rule, applied to the one field this
  // module compares.
  let eligible: CronOccurrence[] = [];
  const skipped: { occurrenceId: string; reason: string }[] = [];
  for (const occurrence of input.occurrences) {
    if (readIsoInstantWithOffset(occurrence.resolvedUtcInstant) === null) {
      skipped.push({
        occurrenceId: occurrence.occurrenceId,
        reason: 'Its resolved instant cannot be read as an offset-carrying ISO-8601 instant; unreadable is not fresh.',
      });
    } else {
      eligible.push(occurrence);
    }
  }

  // Age next: an occurrence stale beyond the catch-up age is skipped BY
  // NAME whatever the policy — including run_latest, whose latest may
  // itself be too old to be worth pretending is fresh.
  if (input.maxCatchUpAgeMinutes !== undefined) {
    const oldestAllowedMs = evaluatedMs - input.maxCatchUpAgeMinutes * 60_000;
    const kept: CronOccurrence[] = [];
    for (const occurrence of eligible) {
      if (Date.parse(occurrence.resolvedUtcInstant) < oldestAllowedMs) {
        skipped.push({
          occurrenceId: occurrence.occurrenceId,
          reason: `Older than the ${input.maxCatchUpAgeMinutes}-minute catch-up age; stale work is named, not run.`,
        });
      } else {
        kept.push(occurrence);
      }
    }
    eligible = kept;
  }

  // skip_missed dispatches NOTHING, so the high-risk gate has nothing to
  // guard: honoring the never-replay policy for every class keeps high-risk
  // work from being MORE replayable than low-risk under the same policy —
  // the inverted posture review caught in the first version, which held
  // skip_missed high-risk work for a confirmation that could run it.
  if (input.policy === 'skip_missed') {
    return {
      dispatch: [],
      awaitingConfirmation: [],
      skipped: [
        ...skipped,
        ...eligible.map((o) => ({
          occurrenceId: o.occurrenceId,
          reason: 'The skip_missed policy: a missed occurrence is recorded, never replayed.',
        })),
      ],
    };
  }

  if (!RELAY_CRON_WORK_CLASSES.includes(input.workClass as RelayCronWorkClass)) {
    // An unknown work class cannot prove it is low-risk, so it is treated
    // exactly as high-risk work is: held for a human.
    return { dispatch: [], awaitingConfirmation: eligible, skipped };
  }

  // The rule that outranks every DISPATCHING policy: high-risk work is NEVER
  // auto-caught-up. It waits for renewed human approval.
  if (HIGH_RISK.includes(input.workClass as RelayCronWorkClass)) {
    return { dispatch: [], awaitingConfirmation: eligible, skipped };
  }

  switch (input.policy as RelayMissedRunPolicy) {
    case 'run_latest': {
      const latest = eligible[eligible.length - 1];
      return {
        dispatch: latest === undefined ? [] : [latest],
        awaitingConfirmation: [],
        skipped: [
          ...skipped,
          ...eligible.slice(0, -1).map((o) => ({
            occurrenceId: o.occurrenceId,
            reason: 'Superseded by the latest missed occurrence under run_latest.',
          })),
        ],
      };
    }

    case 'run_all_with_limit': {
      if (!Number.isInteger(input.maxCatchUpRuns) || (input.maxCatchUpRuns as number) < 1) {
        return allSkipped(input.occurrences,
          'run_all_with_limit IS its bound: a positive integer maxCatchUpRuns is required, not defaulted.');
      }
      const limit = input.maxCatchUpRuns as number;
      // The NEWEST occurrences are the ones still worth running; dropping
      // them to run older ones would catch up on staleness itself.
      const cut = Math.max(0, eligible.length - limit);
      return {
        dispatch: eligible.slice(cut),
        awaitingConfirmation: [],
        skipped: [
          ...skipped,
          ...eligible.slice(0, cut).map((o) => ({
            occurrenceId: o.occurrenceId,
            reason: `The catch-up limit of ${limit} keeps the newest; this older occurrence is dropped by name.`,
          })),
        ],
      };
    }

    case 'require_confirmation':
      return { dispatch: [], awaitingConfirmation: eligible, skipped };

    default:
      // An unknown policy fails closed — but a HOLD, not a silent drop:
      // the occurrences wait for a human, and nothing dispatches.
      return { dispatch: [], awaitingConfirmation: eligible, skipped };
  }
}
