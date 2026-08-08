import { parseCronExpression, planSchedulerPass } from '../src/relay/mission/loop/cron';
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
 *   depends on the Loop engine. A timer with no flag is a background process
 *   nobody chose.
 *
 * ONE PASS AT A TIME. A pass that overran its interval would otherwise start
 * again beside itself, and two passes ticking one schedule race for the same
 * occurrence claim — which the marker would settle correctly, at the cost of
 * doing the work twice. The timer skips a beat instead, and says it did.
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

export interface SchedulerPassReport {
  readonly at: string;
  readonly ticked: number;
  /** Durable run RECORDS created. Nothing advances them. */
  readonly runsCreated: number;
  readonly skipped: number;
  readonly truncated: boolean;
  /** Ticks the service refused, by schedule. Named, never counted as done. */
  readonly refused: readonly string[];
  /** Set when the pass could not be planned at all. */
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

export function createCronScheduler(options: {
  readonly ticks: CronTickService;
  readonly now: () => string;
  readonly binding: { readonly workClass: string; readonly overlapPolicy: string };
  readonly intervalSeconds: number;
  readonly lookbackMinutes?: number;
  readonly maxPerPass?: number;
  readonly onPass?: (report: SchedulerPassReport) => void;
}): CronScheduler {
  let running = false;
  let stopped = false;

  const runOnce = (): SchedulerPassReport => {
    const at = options.now();
    // ONE PASS AT A TIME, and the skip is reported rather than silent.
    if (running) {
      return {
        at, ticked: 0, runsCreated: 0, skipped: 0, truncated: false, refused: [],
        refusal: 'pass_in_flight',
      };
    }
    running = true;
    try {
      const listing = options.ticks.listSchedules();
      const planned = planSchedulerPass({
        candidates: listing.schedules,
        now: at,
        lookbackMinutes: options.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES,
        maxPerPass: options.maxPerPass ?? DEFAULT_MAX_PER_PASS,
      });
      if (!planned.ok) {
        return {
          at, ticked: 0, runsCreated: 0, skipped: 0, truncated: false, refused: [],
          refusal: planned.refusal,
        };
      }
      const refused: string[] = [];
      let ticked = 0;
      let created = 0;
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
        const head = [...inspected.record.history]
          .sort((a, b) => a.version - b.version)[inspected.record.history.length - 1];
        if (head === undefined) { refused.push(tick.scheduleId); continue; }
        const parsed = parseCronExpression(head.cronExpression);
        // A stored expression that no longer parses is refused, not guessed at.
        if (!parsed.ok) { refused.push(tick.scheduleId); continue; }

        // THE SAME CLAMP THE OPERATOR TICK APPLIES. A version cannot own a
        // moment that predates it, so a lookback reaching past the authoring
        // instant is cut back to it rather than replaying a handled window.
        const authoredMs = Date.parse(head.authoredAt);
        const requestedMs = Date.parse(tick.afterExclusive);
        const afterExclusive = Number.isNaN(authoredMs) || requestedMs >= authoredMs
          ? tick.afterExclusive
          : head.authoredAt;

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
              activeRuns: options.ticks.activeRunsFor(head.loopId),
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
        created += report.occurrences.filter((o) => o.outcome === 'run_created').length;
      }
      const report: SchedulerPassReport = {
        at,
        ticked,
        runsCreated: created,
        skipped: planned.pass.skipped.length,
        truncated: planned.pass.truncated,
        refused,
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
    } catch {
      // A pass that throws must not kill the timer, and must not take the
      // bridge with it. The next pass tries again.
    }
  }, Math.max(1, options.intervalSeconds) * 1000);
  timer.unref?.();

  return {
    runOnce,
    stop: () => { stopped = true; clearInterval(timer); },
  };
}
