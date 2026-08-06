/**
 * SUNDAY RELAY — MULTI-AGENT SCHEDULING
 *
 * The worker executes ONE bounded pass and was built so that deciding when
 * passes run and which runs they claim is somebody else's decision. This is
 * that somebody: a pure planner that takes a snapshot of runs and emits a
 * PLAN — which runs, in what order, with what per-run iteration
 * budget — for a caller to feed to `runLoopWorkerPass`.
 *
 * PURE on purpose. No clock read, no filesystem, no dispatch — and no LOCALE:
 * a plan is an argument about fairness, and an argument you cannot test
 * without waiting, or that two hosts can disagree about, is one nobody will
 * ever check.
 *
 * THE DEFECT CLASS HERE IS STARVATION. A run that never gets a turn is a
 * silent skip at the scheduling layer — the same lie as a worker that skips
 * without naming, one level up. So:
 *
 * - **Least-recently-advanced goes FIRST.** Recency of attention, not recency
 *   of creation: a noisy new run must not shoulder past a quiet old one.
 * - **A run that was never advanced sorts as OLDEST**, not newest — the freshly
 *   created run has had zero attention, which is the least attention.
 * - **A timestamp that does not parse — or that names no explicit UTC
 *   offset — is refused BY NAME**, not guessed at. Mapping an unparseable one
 *   to "oldest" would hand a corrupt journal permanent first place — corrupt
 *   data monopolizing capacity is starvation with extra steps — and an
 *   offset-less timestamp parses as HOST-LOCAL time, which lets two hosts
 *   order one snapshot differently. The worker refuses an unreadable lock for
 *   the same reason.
 * - **A budget that is not a budget is refused as `invalid_budget`**, kept
 *   apart from `no_remaining_budget`: "this run spent its budget" and "this
 *   run's budget is corrupt" are different facts, and folding the second into
 *   the first masks journal corruption as routine exhaustion.
 * - **Capacity is split, never implied.** The plan says exactly which runs did
 *   not fit and why, because "the pass will get to it" is how starvation hides.
 * - **A paused or terminal run is excluded BY REASON**, not silently dropped.
 * - **The plan is deterministic.** Same snapshot, same plan. Ties break on
 *   runId, so two schedulers given one snapshot cannot argue.
 */

/** What the planner knows about one runnable run. All facts, no guesses. */
export interface SchedulableRun {
  readonly runId: string;
  /** ISO-8601 of the last recorded advance, or null when never advanced. */
  readonly lastAdvancedAt: string | null;
  /** The run's own state, as the journal reports it. */
  readonly state: 'runnable' | 'paused' | 'terminal' | 'recovery_required';
  /**
   * Iterations this run may still spend, from its own budget. The planner
   * never allocates past it — a schedule is not permission to overspend.
   */
  readonly remainingIterations: number;
}

export type ScheduleExclusionReason =
  | 'paused'
  | 'terminal'
  | 'recovery_required'
  | 'no_remaining_budget'
  | 'invalid_budget'
  | 'unreadable_timestamp'
  | 'invalid_options'
  | 'capacity_reached';

export interface SchedulePlanEntry {
  readonly runId: string;
  /** Iterations granted this pass: min(perRunIterations, remainingIterations). */
  readonly grantedIterations: number;
}

export interface SchedulePlan {
  /** Claim in exactly this order. Deterministic for one snapshot. */
  readonly claim: readonly SchedulePlanEntry[];
  /** Every run NOT in the plan, each with the reason it is not. */
  readonly excluded: readonly {
    readonly runId: string;
    readonly reason: ScheduleExclusionReason;
  }[];
  /**
   * True when RUNNABLE work was left behind by capacity — and only then. The
   * next pass must start from the runs excluded here, or they starve politely
   * forever. Invalid options do NOT set this: "the planner refused to plan" and
   * "the plan was too small for the work" are different outages.
   */
  readonly capacityReached: boolean;
}

export interface ScheduleOptions {
  /** Runs claimed per pass. The worker's own maxRuns should equal this. */
  readonly maxRuns: number;
  /** Iteration budget granted per claimed run this pass. */
  readonly perRunIterations: number;
}

/**
 * ISO-8601 with an EXPLICIT UTC offset. `Date.parse` alone is not the
 * contract: it accepts locale formats with V8 semantics, and it reads an
 * offset-less ISO string as HOST-LOCAL time — either way, two hosts could
 * order one snapshot differently, which breaks the promise this module is
 * named for.
 */
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

const parseAdvancedAt = (value: string | null): number => {
  if (value === null) return Number.NEGATIVE_INFINITY;
  if (!ISO_WITH_OFFSET.test(value)) return Number.NaN;
  return Date.parse(value);
};

/**
 * Plan one pass.
 *
 * Total and pure: invalid options produce an empty plan with every run
 * excluded as `invalid_options` — a planner that throws mid-schedule schedules
 * nothing, and a caller that cannot tell "no plan" from "no work" repeats the
 * silent starvation this module exists to prevent. The bound rule is the
 * repair loop's: a bound that is not a bound is refused, not defaulted.
 */
export function planLoopPass(
  runs: readonly SchedulableRun[],
  options: ScheduleOptions,
): SchedulePlan {
  const bounded = Number.isInteger(options.maxRuns) && options.maxRuns >= 1
    && Number.isInteger(options.perRunIterations) && options.perRunIterations >= 1;
  if (!bounded) {
    return {
      claim: [],
      excluded: runs.map((run) => ({ runId: run.runId, reason: 'invalid_options' as const })),
      capacityReached: false,
    };
  }

  const excluded: { runId: string; reason: ScheduleExclusionReason }[] = [];
  const eligible: { run: SchedulableRun; advancedAt: number }[] = [];
  for (const run of runs) {
    if (run.state !== 'runnable') {
      excluded.push({ runId: run.runId, reason: run.state });
      continue;
    }
    if (!Number.isInteger(run.remainingIterations)) {
      // "This run's budget is corrupt" is a different fact from "this run
      // spent its budget" — Infinity, NaN and fractions name an upstream
      // defect, and folding them into normal exhaustion would mask it.
      excluded.push({ runId: run.runId, reason: 'invalid_budget' });
      continue;
    }
    if (run.remainingIterations < 1) {
      // A schedule is not permission to overspend: a run with no budget left
      // is excluded HERE, visibly, rather than claimed and refused later.
      excluded.push({ runId: run.runId, reason: 'no_remaining_budget' });
      continue;
    }
    // Parse ONCE, here, so a corrupt timestamp is a named exclusion and not a
    // NaN inside the comparator, where it would poison the sort's transitivity
    // and make the "deterministic plan" promise silently false.
    const advancedAt = parseAdvancedAt(run.lastAdvancedAt);
    if (Number.isNaN(advancedAt)) {
      excluded.push({ runId: run.runId, reason: 'unreadable_timestamp' });
      continue;
    }
    eligible.push({ run, advancedAt });
  }

  // Least-recently-advanced first. A run never advanced has had the least
  // attention of all and sorts oldest; ties break on runId so two planners
  // given one snapshot cannot argue.
  const sorted = [...eligible].sort((a, b) => {
    if (a.advancedAt !== b.advancedAt) return a.advancedAt - b.advancedAt;
    // Codepoint order, NOT localeCompare: locale is a hidden input a pure
    // planner must not have, and ICU can return 0 for DISTINCT strings —
    // either breaks "two planners given one snapshot cannot argue".
    return a.run.runId < b.run.runId ? -1 : a.run.runId > b.run.runId ? 1 : 0;
  });

  const claim = sorted.slice(0, options.maxRuns).map(({ run }) => ({
    runId: run.runId,
    grantedIterations: Math.min(options.perRunIterations, run.remainingIterations),
  }));
  for (const { run } of sorted.slice(options.maxRuns)) {
    excluded.push({ runId: run.runId, reason: 'capacity_reached' });
  }

  return {
    claim,
    excluded,
    capacityReached: sorted.length > options.maxRuns,
  };
}
