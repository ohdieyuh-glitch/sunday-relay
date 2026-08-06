import { type ReviewerRouteResult } from './reviewer-routes';
import { LOOP_ENGINE_ENV, loopEngineEnabled } from './loop-routes';
import { safeText } from './redact';
import { featureEffectivelyEnabled } from '../src/relay/mission/loop/loop-availability';
import { parseCronExpression } from '../src/relay/mission/loop/cron';
import type { CronSchedule, CronTickReport } from '../src/relay/mission/loop/cron';
import type { CronRunBinding } from './cron-service';

/**
 * SUNDAY RELAY — THE CRON TICK ENDPOINT.
 *
 * CRON_LOOPS.md approved an in-bridge scheduler woken by an authenticated
 * tick, with the platform's own cron as a WAKER that "must never define
 * occurrences, hold state, or be required for correctness". This is that
 * seam — and only that seam. What it is NOT, stated here because a surface
 * that guesses would guess generously:
 *
 * - **Not a scheduler.** Nothing calls this on a schedule. No timer exists.
 * - **Not a dispatcher.** A tick creates durable Loop run RECORDS and
 *   advances none of them; the engine refuses cron-triggered dispatch.
 * - **Not a schedule store.** Every schedule field arrives in the request.
 *   There is no `RelayLoopSchedule` anywhere in this repository, and
 *   inventing storage to make this endpoint look finished would be the
 *   larger lie.
 *
 * THE CLOCK IS THE SERVER'S. `evaluatedAt` and the window's end come from the
 * server, never the body: CRON_LOOPS.md says a client-supplied time field
 * must never influence due-ness, and that is a test, not a convention. The
 * window's START is still client-supplied — a named deviation, bounded by the
 * server-clocked end, the eight-day evaluation limit, and the claim marker
 * that makes a replay free. The durable watermark that would close it belongs
 * to the schedule store that does not exist.
 */

export const CRON_PREFIX = '/cron/';
export const CRON_ENABLED_ENV = 'RELAY_LOOP_CRON_ENABLED';

export function isCronRoute(path: string): boolean {
  return path.startsWith(CRON_PREFIX);
}

/**
 * Is Cron on?
 *
 * FAIL-CLOSED BY CONSTRUCTION, and through the ONE existing evaluator rather
 * than a second copy of the dependency chain: `loop_cron` depends on
 * `loop_scheduler`, which depends on `loop_engine`. There is no separate
 * scheduler switch because there is no scheduler surface to gate — a control
 * with nothing behind it is worse than an absent one.
 */
export function cronEnabled(env: NodeJS.ProcessEnv): boolean {
  const engine = env[LOOP_ENGINE_ENV] === '1';
  const cron = env[CRON_ENABLED_ENV] === '1';
  return featureEffectivelyEnabled(
    { loop_engine: engine, loop_scheduler: engine && cron, loop_cron: engine && cron },
    'loop_cron',
  );
}

/** What the route needs done. Injected, so this module orchestrates nothing. */
export interface CronTickPort {
  tick(input: {
    readonly evaluatedAt: string;
    readonly evaluation: {
      readonly schedule: CronSchedule;
      readonly timeZone: string;
      readonly scheduleId: string;
      readonly contractVersion: number;
      readonly afterExclusive: string;
      readonly untilInclusive: string;
      readonly maxOccurrences: number;
    };
    readonly missed: {
      readonly policy: string;
      readonly workClass: string;
      readonly maxCatchUpAgeMinutes?: number;
      readonly maxCatchUpRuns?: number;
    };
    readonly overlap: {
      readonly policy: string;
      readonly state: {
        readonly activeRuns: number;
        readonly queuedRuns: number;
        readonly queueLimit?: number;
        readonly parallelLimit?: number;
      };
    };
    readonly binding: CronRunBinding;
  }): CronTickReport;
  activeRunsFor(loopId: string): number;
}

export interface CronRouteRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization?: string | undefined;
  readonly body?: unknown;
  readonly env: NodeJS.ProcessEnv;
  /** The SERVER's clock. Never a body field. */
  readonly now: string;
  authorize(): { readonly kind: 'operator' | 'browser' | 'none'; readonly principal: string };
}

const ok = (data: unknown): ReviewerRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): ReviewerRouteResult =>
  ({ status, body: { error: { kind, message } } });

const trimmed = (body: unknown, field: string): string | null => {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

const positiveInteger = (body: unknown, field: string): number | null => {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
};

/**
 * Overlap policies this build can serve HONESTLY.
 *
 * The rule is narrow and load-bearing: **no policy may durably CONSUME an
 * occurrence on the strength of a run that is not actually working.** A
 * scheduled run is created and never advanced here, so a decision of the form
 * "a run is live, therefore drop this occurrence" is made against an inert
 * record — and the drop is irreversible, because the claim marker exists
 * precisely to refuse the replay.
 *
 * That excludes `skip`, whose whole meaning is that deliberate drop, and it
 * excludes `queue_one` and `queue_all`, which would promise an enqueue no
 * queue performs. What remains never consumes an occurrence it did not run:
 * `parallel_with_limit` answers capacity (unclaimed, re-decided next tick)
 * and `replace` answers replace-pending (unclaimed, and it never claims the
 * safe stop happened).
 *
 * Review found the first version serving `skip` and steering callers to it:
 * across ticks it silently and permanently ate every occurrence after the
 * first, with one run to show for it.
 */
const SERVABLE_OVERLAP = ['replace', 'parallel_with_limit'];

/**
 * An IANA zone name, or UTC.
 *
 * CRON_LOOPS.md: "Every Cron Loop carries an explicit IANA timezone. A bare
 * numeric UTC offset is a validation failure for recurring schedules." That
 * rule needs its own check, because `Intl.DateTimeFormat` ACCEPTS `+05:30`
 * and would have let one through — a doc rule the code did not enforce until
 * a test asked it to. The reason the rule exists: a fixed offset cannot
 * express daylight saving, so a schedule written with one silently drifts an
 * hour twice a year against the wall clock its author meant.
 */
const IANA_ZONE = /^(UTC|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/;

export async function handleCronRoute(
  request: CronRouteRequest,
  ticks: CronTickPort | null,
): Promise<ReviewerRouteResult | null> {
  if (!isCronRoute(request.path)) return null;

  const decision = request.authorize();
  if (decision.kind === 'none') {
    return err(401, 'authentication_failed', 'Authentication is required for Cron operations.');
  }
  if (decision.kind !== 'operator') {
    return err(
      403, 'authorization_required',
      'Cron operations are operator-only. No occurrence was evaluated, claimed or created.',
    );
  }

  if (!loopEngineEnabled(request.env)) {
    return err(
      403, 'loop_engine_disabled',
      'The Loop engine is not enabled on this server. No occurrence was evaluated, claimed or created.',
    );
  }
  // BEFORE any body field is read, before the timezone port is built, and
  // before anything can touch the state root: a refused tick must leave no
  // occurrence directory behind.
  if (!cronEnabled(request.env)) {
    return err(
      403, 'cron_disabled',
      'Cron Loops are not enabled on this server. No occurrence was evaluated, claimed or created.',
    );
  }

  if (request.method !== 'POST' || request.path !== `${CRON_PREFIX}tick`) {
    return err(422, 'validation_failed', 'Unknown Cron operation.');
  }
  if (ticks === null) {
    return err(
      503, 'cron_not_ready',
      'This Relay Bridge has no mounted state root, so no occurrence can be claimed durably.',
    );
  }

  const body = request.body;
  const authorized = body !== null && typeof body === 'object'
    && (body as Record<string, unknown>).authorized === true;
  if (!authorized) {
    return err(
      403, 'authorization_required',
      'A cron tick creates Loop runs and requires explicit authorization.',
    );
  }

  const scheduleId = trimmed(body, 'scheduleId');
  const cronExpression = trimmed(body, 'cronExpression');
  const timeZone = trimmed(body, 'timeZone');
  const afterExclusive = trimmed(body, 'afterExclusive');
  const missedPolicy = trimmed(body, 'missedPolicy');
  const workClass = trimmed(body, 'workClass');
  const overlapPolicy = trimmed(body, 'overlapPolicy');
  const contractVersion = positiveInteger(body, 'contractVersion');
  const maxOccurrences = positiveInteger(body, 'maxOccurrences');

  const missing = Object.entries({
    scheduleId, cronExpression, timeZone, afterExclusive, missedPolicy,
    workClass, overlapPolicy, contractVersion, maxOccurrences,
  }).filter(([, value]) => value === null).map(([field]) => field);
  if (missing.length > 0) {
    return err(422, 'validation_failed', `Missing or invalid fields: ${missing.join(', ')}.`);
  }

  const binding = (body as Record<string, unknown>).binding;
  const projectId = trimmed(binding, 'projectId');
  const loopId = trimmed(binding, 'loopId');
  const contractRef = trimmed(binding, 'contractRef');
  const contractBindingDigest = trimmed(binding, 'contractBindingDigest');
  const workspaceIdRaw = binding !== null && typeof binding === 'object'
    ? (binding as Record<string, unknown>).workspaceId : undefined;
  const workspaceId = typeof workspaceIdRaw === 'string' && workspaceIdRaw.trim() !== ''
    ? workspaceIdRaw.trim() : null;
  const missingBinding = Object.entries({ projectId, loopId, contractRef, contractBindingDigest })
    .filter(([, value]) => value === null).map(([field]) => `binding.${field}`);
  if (missingBinding.length > 0) {
    return err(422, 'validation_failed', `Missing or invalid fields: ${missingBinding.join(', ')}.`);
  }

  // A QUEUE POLICY CANNOT BE SERVED HONESTLY: no occurrence queue exists in
  // this build, so a `queued` outcome would promise an enqueue nothing
  // performs. Refused by name rather than degraded into a different policy
  // wearing the requested one's label — and `queue_one` being the documented
  // default is the cost, stated where a caller will read it.
  if (!SERVABLE_OVERLAP.includes(overlapPolicy as string)) {
    return err(
      422, 'overlap_policy_unservable',
      `"${safeText(overlapPolicy)}" cannot be served honestly by this build. Nothing advances a `
      + 'scheduled run, so a policy that drops an occurrence because "a run is live" would consume '
      + 'it irreversibly against a record that never works; and no occurrence queue exists, so a '
      + `queued outcome would promise an enqueue nothing performs. Use ${SERVABLE_OVERLAP.join(' or ')}, `
      + 'which never consume an occurrence they did not run.',
    );
  }

  if (!IANA_ZONE.test(timeZone as string)) {
    return err(
      422, 'validation_failed',
      `"${safeText(timeZone)}" is not an IANA timezone name. A recurring schedule needs a zone `
      + '(for example "America/Los_Angeles"), not a fixed offset: an offset cannot express '
      + 'daylight saving, so the schedule would drift an hour against the wall clock twice a year.',
    );
  }

  const parsed = parseCronExpression(cronExpression as string);
  if (!parsed.ok) return err(422, 'validation_failed', safeText(parsed.problem));

  // THE WINDOW MAY ONLY REACH THE PRESENT. Clamping to the server clock is
  // what makes the tick's own `future_window` refusal structurally
  // unreachable from this route rather than merely unlikely.
  const untilInclusive = request.now;

  const report = ticks.tick({
    evaluatedAt: request.now,
    evaluation: {
      schedule: parsed.schedule,
      timeZone: timeZone as string,
      scheduleId: scheduleId as string,
      contractVersion: contractVersion as number,
      afterExclusive: afterExclusive as string,
      untilInclusive,
      maxOccurrences: maxOccurrences as number,
    },
    missed: {
      policy: missedPolicy as string,
      workClass: workClass as string,
      ...(positiveInteger(body, 'maxCatchUpAgeMinutes') === null
        ? {} : { maxCatchUpAgeMinutes: positiveInteger(body, 'maxCatchUpAgeMinutes') as number }),
      ...(positiveInteger(body, 'maxCatchUpRuns') === null
        ? {} : { maxCatchUpRuns: positiveInteger(body, 'maxCatchUpRuns') as number }),
    },
    overlap: {
      policy: overlapPolicy as string,
      state: {
        // DERIVED from the journal, never accepted from the caller: a
        // client-supplied count would let the request that wants a run decide
        // whether the limit stopping it applies.
        activeRuns: ticks.activeRunsFor(loopId as string),
        // There is no queue. Zero is the only truthful value.
        queuedRuns: 0,
        ...(positiveInteger(body, 'parallelLimit') === null
          ? {} : { parallelLimit: positiveInteger(body, 'parallelLimit') as number }),
      },
    },
    binding: {
      projectId: projectId as string,
      workspaceId,
      loopId: loopId as string,
      contractRef: contractRef as string,
      contractBindingDigest: contractBindingDigest as string,
    },
  });

  if (!report.ok) {
    return err(422, report.refusal, safeText(report.problem));
  }

  const counted = (outcome: string): number =>
    report.occurrences.filter((o) => o.outcome === outcome).length;

  return ok({
    scheduleId,
    evaluatedAt: request.now,
    window: { afterExclusive, untilInclusive },
    truncated: report.truncated,
    occurrences: report.occurrences.map((o) => ({
      occurrenceId: o.occurrenceId,
      outcome: o.outcome,
      ...(o.detail === undefined ? {} : { detail: safeText(o.detail) }),
      ...(o.journalRecorded === undefined ? {} : { journalRecorded: o.journalRecorded }),
    })),
    runsCreated: counted('run_created'),
    duplicates: counted('duplicate_run'),
    claimedWithoutRun: counted('claimed_but_run_not_created'),
    // A LITERAL, not a count: it is a claim about the code path. A scheduled
    // run is created durably and never advanced, so no agent was reached and
    // no provider was called.
    dispatched: 0,
    note: 'A scheduled Loop run is created durably and is NOT advanced. '
      + 'Nothing here dispatched an agent or contacted a provider.',
  });
}
