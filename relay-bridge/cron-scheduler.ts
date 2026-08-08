import {
  MAX_CRON_WINDOW_MINUTES, parseCronExpression, planSchedulerPass,
} from '../src/relay/mission/loop/cron';
import { readIsoInstantWithOffset } from '../src/relay/mission/loop/runtime/loop-scheduler';
import { refuseStoredZone } from './cron-tickability';
import { safeText } from './redact';
import type { CronTickService } from './cron-service';

/**
 * SUNDAY RELAY — THE IN-BRIDGE SCHEDULER.
 *
 * The timer that makes a Cron Loop recurring. `planSchedulerPass` decides what
 * a pass covers; this owns the clock, the interval and the effects, and nothing
 * else. It is the seam CRON_LOOPS.md approved: the platform's own cron may WAKE
 * this bridge, but the bridge decides what is due.
 *
 * WHAT IT STILL DOES NOT DO, because a surface would guess generously:
 *
 * - **It dispatches nothing.** A pass creates durable Loop run RECORDS exactly
 *   as an operator tick does, and the engine refuses a cron trigger. Automatic
 *   creation is not automatic execution.
 * - **It is OFF unless switched on**, and it depends on Cron being on, which
 *   depends on the Loop engine, which depends on a mounted state root. A timer
 *   with no flag is a background process nobody chose.
 *
 * THE TIMER REFUSES WHAT THE OPERATOR TICK REFUSES. `refuseStoredZone` is the
 * one gate both callers use. Review found them disagreeing: three schedules the
 * endpoint answers 422 for — a fixed offset, a `SystemV/*` zone and a
 * single-word IANA name — produced nine runs under the timer, at instants that
 * drift an hour twice a year. A schedule an operator is told will not run must
 * not run because nobody was watching.
 *
 * THE PASS IS BOUNDED IN THE DIRECTION THAT COSTS. It walks at most a stated
 * number of schedules, ROTATING so the ones it defers are reached next time
 * rather than never; it reads each Loop's execution count at most once; and it
 * stops ticking a Loop whose undispatched backlog has reached the ceiling,
 * because that count is what every overlap policy needs and its cost grows with
 * the records this build creates and never advances.
 */

export const CRON_SCHEDULER_ENABLED_ENV = 'RELAY_LOOP_CRON_SCHEDULER_ENABLED';
export const CRON_SCHEDULER_INTERVAL_ENV = 'RELAY_LOOP_CRON_SCHEDULER_INTERVAL_SECONDS';

/** Deliberately conservative: the bridge answers requests on this event loop. */
const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_LOOKBACK_MINUTES = 15;
const DEFAULT_MAX_PER_PASS = 25;
/** Per schedule, per pass. The lookback bounds how many can be due at once. */
const MAX_OCCURRENCES_PER_PASS = 20;
const PARALLEL_LIMIT_PER_PASS = 5;

/**
 * How many run records a Loop may hold before the timer stops adding to it.
 *
 * NOT A POLICY, A BOUND ON THIS BUILD'S OWN COST. Every overlap policy needs to
 * know how many of a Loop's runs are executing, and answering that walks the
 * Loop's run records and replays each journal. Nothing in this build advances a
 * scheduled run and nothing prunes one, so unchecked the walk grows forever on
 * the same event loop that answers `/health` — review measured 115 ms at 100
 * records, 390 ms at 700, paid every pass whether or not anything was due.
 *
 * A Loop at the ceiling is REFUSED BY NAME rather than quietly skipped, because
 * "your schedule stopped running" and "your schedule has 500 runs nothing will
 * ever start" are the same silence and very different facts.
 */
const MAX_UNDISPATCHED_RUNS_PER_LOOP = 200;

export interface SchedulerPassReport {
  readonly at: string;
  readonly ticked: number;
  /** Durable run RECORDS created. Nothing advances them. */
  readonly runsCreated: number;
  readonly skipped: number;
  readonly truncated: boolean;
  /** Ticks the service refused, by schedule. Named, never counted as done. */
  readonly refused: readonly string[];
  /** Schedules deferred to the next pass by the pass limit, by id. */
  readonly deferred: readonly string[];
  /**
   * Occurrences durably claimed with no run behind them. The domain calls this
   * outcome loud: the marker will rightly refuse the replay, so a human has to
   * decide. On the automatic path nobody is watching, which is exactly why it
   * has to reach the log.
   */
  readonly claimedWithoutRun: number;
  /** Occurrences the overlap limit dropped without claiming them. */
  readonly capacitySkipped: number;
  /** Occurrences a tick truncated: more were due than one pass may take. */
  readonly occurrencesTruncated: boolean;
  /** True when the STORE's own listing cap hid schedules from this pass. */
  readonly listingTruncated: boolean;
  /** Set when the pass could not be planned, or could not run at all. */
  readonly refusal: string | null;
}

export interface CronScheduler {
  /** Run one pass now. Exposed so a test drives it without a timer. */
  runOnce(): SchedulerPassReport;
  stop(): void;
}

export function cronSchedulerEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[CRON_SCHEDULER_ENABLED_ENV] === '1';
}

export function schedulerIntervalSeconds(env: NodeJS.ProcessEnv): number {
  const raw = Number(env[CRON_SCHEDULER_INTERVAL_ENV]);
  // A malformed interval falls back to the default rather than to zero, which
  // would spin the loop, or to NaN, which would never fire.
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_SECONDS;
}

/**
 * The catch-up window for a given interval.
 *
 * THE LOOKBACK MUST COVER THE INTERVAL, or the gap between passes is simply
 * lost. Review set the interval to 600 s against the fixed 15-minute lookback
 * and measured a per-minute schedule producing 50 runs where 100 occurrences
 * were due — the backlog aged out of the window between passes, and the report
 * had no field that said so. Two intervals of headroom absorbs one missed beat;
 * the evaluator's own limit is still the ceiling, because a wider window is
 * refused per schedule and would report work it never had a chance to do.
 */
export function schedulerLookbackMinutes(intervalSeconds: number, windowLimitMinutes: number): number {
  const twoIntervals = Math.ceil((intervalSeconds * 2) / 60);
  return Math.min(Math.max(DEFAULT_LOOKBACK_MINUTES, twoIntervals), windowLimitMinutes);
}

export function createCronScheduler(options: {
  readonly ticks: CronTickService;
  readonly now: () => string;
  readonly intervalSeconds: number;
  readonly lookbackMinutes?: number;
  readonly maxPerPass?: number;
  readonly onPass?: (report: SchedulerPassReport) => void;
  /** Where a caught failure is reported. Defaults to the deployment log. */
  readonly onError?: (message: string) => void;
  /** The backlog ceiling. Injectable so a test can reach it in a second. */
  readonly maxUndispatchedRunsPerLoop?: number;
}): CronScheduler {
  let running = false;
  let stopped = false;
  /** Where the next pass resumes, so the pass limit defers rather than starves. */
  let cursor: string | null = null;

  const empty = (at: string, refusal: string | null): SchedulerPassReport => ({
    at,
    ticked: 0,
    runsCreated: 0,
    skipped: 0,
    truncated: false,
    refused: [],
    deferred: [],
    claimedWithoutRun: 0,
    capacitySkipped: 0,
    occurrencesTruncated: false,
    listingTruncated: false,
    refusal,
  });

  const runOnce = (): SchedulerPassReport => {
    const at = options.now();
    /**
     * ONE PASS AT A TIME — for a RE-ENTRANT CALLER, which is the only shape
     * that can reach it. A pass is fully synchronous, so a `setInterval`
     * callback cannot begin while one is executing; Node fires the timer late
     * instead. This guard therefore protects a host that calls `runOnce()` from
     * inside `onPass`, and it is stated that way rather than advertised as
     * protection against an overrunning timer, which cannot happen here.
     */
    //
    // IT DOES NOT NOTIFY `onPass`, and that is not an oversight. The only
    // caller that can reach this branch is one already inside `onPass`; telling
    // the observer about the observer's own call recurses until the stack ends,
    // which is exactly what happened the first time this reported through the
    // same channel as every other path. The re-entrant caller receives the
    // refusal as the return value, where it asked for it.
    if (running) return empty(at, 'pass_in_flight');
    running = true;
    try {
      const listing = options.ticks.listSchedules();
      const planned = planSchedulerPass({
        candidates: listing.schedules,
        now: at,
        lookbackMinutes: options.lookbackMinutes
          ?? schedulerLookbackMinutes(options.intervalSeconds, MAX_CRON_WINDOW_MINUTES),
        maxPerPass: options.maxPerPass ?? DEFAULT_MAX_PER_PASS,
        resumeAfterId: cursor,
      });
      if (!planned.ok) {
        const report = { ...empty(at, planned.refusal), listingTruncated: listing.truncated };
        options.onPass?.(report);
        return report;
      }
      cursor = planned.pass.nextCursor;

      const refused: string[] = [];
      let ticked = 0;
      let created = 0;
      let claimedWithoutRun = 0;
      let capacitySkipped = 0;
      let occurrencesTruncated = false;

      /**
       * ONE EXECUTION COUNT PER LOOP PER PASS. Two schedules bound to the same
       * Loop asked the same expensive question twice; the answer cannot change
       * mid-pass, because a pass is synchronous and nothing here starts a run.
       */
      const activeByLoop = new Map<string, number>();
      const activeRuns = (loopId: string): number => {
        const memo = activeByLoop.get(loopId);
        if (memo !== undefined) return memo;
        const value = options.ticks.activeRunsFor(loopId);
        activeByLoop.set(loopId, value);
        return value;
      };

      for (const tick of planned.pass.ticks) {
        const inspected = options.ticks.inspectSchedule(tick.scheduleId);
        // The listing and this read are two moments; a schedule can change in
        // between. The tick's own refusals are the authority, so a schedule
        // that stopped being tickable is refused here rather than assumed.
        //
        // NO TEST REACHES THIS BRANCH, and it is stated rather than pretended:
        // both moments happen inside one synchronous pass, so only another
        // process sharing the volume can change a schedule between them. A test
        // that faked the change would prove the fake works.
        if (inspected.kind !== 'found' || inspected.record.paused) {
          refused.push(tick.scheduleId);
          continue;
        }
        const head = [...inspected.record.history].sort((a, b) => a.version - b.version).at(-1);
        if (head === undefined) { refused.push(tick.scheduleId); continue; }

        // THE SHARED GATE, so this agrees with the operator tick by
        // construction rather than by two lists staying in step.
        if (refuseStoredZone(head.timeZone, options.ticks) !== null) {
          refused.push(tick.scheduleId);
          continue;
        }

        const parsed = parseCronExpression(head.cronExpression);
        // A stored expression that no longer parses is refused, not guessed at.
        if (!parsed.ok) { refused.push(tick.scheduleId); continue; }

        // THE BOUND ON THIS BUILD'S OWN COST. A Loop already holding a backlog
        // of runs nothing will advance is refused rather than grown: the
        // execution count every overlap policy needs is read by walking those
        // records, so an unbounded backlog is an unbounded stall on the loop
        // that answers HTTP.
        const backlog = options.ticks.runCountFor(head.loopId);
        if (backlog >= (options.maxUndispatchedRunsPerLoop ?? MAX_UNDISPATCHED_RUNS_PER_LOOP)) {
          refused.push(tick.scheduleId);
          continue;
        }

        // THE SAME CLAMP THE OPERATOR TICK APPLIES, and it FAILS CLOSED the
        // same way. `Date.parse` would have accepted an offset-less string and
        // read it as host-local, then opened the window on `NaN` instead of
        // refusing it — the opposite direction from the route this comment
        // claims to match.
        const authoredMs = readIsoInstantWithOffset(head.authoredAt);
        if (authoredMs === null) { refused.push(tick.scheduleId); continue; }
        const requestedMs = readIsoInstantWithOffset(tick.afterExclusive);
        if (requestedMs === null) { refused.push(tick.scheduleId); continue; }
        const afterExclusive = requestedMs >= authoredMs ? tick.afterExclusive : head.authoredAt;

        const report = options.ticks.tick({
          evaluatedAt: at,
          evaluation: {
            schedule: parsed.schedule,
            timeZone: head.timeZone,
            scheduleId: tick.scheduleId,
            contractVersion: head.version,
            afterExclusive,
            untilInclusive: tick.untilInclusive,
            maxOccurrences: MAX_OCCURRENCES_PER_PASS,
          },
          // THE PASS'S OWN POLICIES, fixed rather than configurable. There is
          // no request to carry them and nobody to ask, so they are the most
          // conservative the tick will serve: work that consumes an occurrence
          // without running it is refused outright by the tick, and a
          // catch-up bound keeps an outage from becoming a burst.
          missed: {
            policy: 'run_all_with_limit',
            workClass: 'read_only',
            maxCatchUpRuns: MAX_OCCURRENCES_PER_PASS,
          },
          overlap: {
            policy: 'parallel_with_limit',
            state: {
              // DERIVED from the journal, exactly as the operator tick does it.
              activeRuns: activeRuns(head.loopId),
              queuedRuns: 0,
              parallelLimit: PARALLEL_LIMIT_PER_PASS,
            },
          },
          binding: {
            projectId: head.projectId,
            workspaceId: head.workspaceId,
            loopId: head.loopId,
            contractRef: head.contractRef,
            contractBindingDigest: head.contractBindingDigest,
          },
        });
        // A REFUSED TICK IS NOT A TICK. The report says what the evaluator
        // decided; counting it as done would report work that never happened.
        if (!report.ok) { refused.push(tick.scheduleId); continue; }
        ticked += 1;
        occurrencesTruncated = occurrencesTruncated || report.truncated;
        for (const occurrence of report.occurrences) {
          if (occurrence.outcome === 'run_created') created += 1;
          else if (occurrence.outcome === 'claimed_but_run_not_created') claimedWithoutRun += 1;
          else if (occurrence.outcome === 'skipped_by_capacity_unclaimed') capacitySkipped += 1;
        }
      }
      const report: SchedulerPassReport = {
        at,
        ticked,
        runsCreated: created,
        skipped: planned.pass.skipped.length,
        truncated: planned.pass.truncated,
        refused,
        deferred: planned.pass.skipped
          .filter((s) => s.reason === 'over_pass_limit')
          .map((s) => s.scheduleId),
        claimedWithoutRun,
        capacitySkipped,
        occurrencesTruncated,
        listingTruncated: listing.truncated,
        refusal: null,
      };
      options.onPass?.(report);
      return report;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    if (stopped) return;
    try {
      runOnce();
    } catch (error) {
      // A pass that throws must not kill the timer, and must not take the
      // bridge with it. It must also not be SILENT: swallowing this made a
      // scheduler whose every pass failed — an unmounted volume, changed
      // permissions — log exactly what a healthy idle bridge logs.
      const message = error instanceof Error ? error.message : String(error);
      (options.onError ?? ((m: string) => console.error(m)))(
        `Relay cron pass failed: ${safeText(message)}`,
      );
    }
  }, Math.max(1, options.intervalSeconds) * 1000);
  timer.unref?.();

  return {
    runOnce,
    stop: () => { stopped = true; clearInterval(timer); },
  };
}
