import { type ReviewerRouteResult } from './reviewer-routes';
import { LOOP_ENGINE_ENV, loopEngineEnabled } from './loop-routes';
import { safeText } from './redact';
import { featureEffectivelyEnabled } from '../src/relay/mission/loop/loop-availability';
import { parseCronExpression } from '../src/relay/mission/loop/cron';
import { readIsoInstantWithOffset } from '../src/relay/mission/loop/runtime/loop-scheduler';
import type { CronSchedule, CronTickReport } from '../src/relay/mission/loop/cron';
import type { CronRunBinding } from './cron-service';
import type { ScheduleReadResult } from '../src/relay/persistence/cron-schedule-node';

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
 * - **Not a scheduler still, but no longer schedule-less.** The schedule is
 *   READ from the durable store: a request says which schedule and over what
 *   window, and the expression, timezone, contract and version are the
 *   schedule's own. (This block previously said the opposite — that no store
 *   existed and every field arrived in the request — for one commit after the
 *   store landed. A header describing the behaviour a file used to have is
 *   the defect this repository keeps finding.)
 *
 * THE CLOCK IS THE SERVER'S. `evaluatedAt` and the window's end come from the
 * server, never the body: CRON_LOOPS.md says a client-supplied time field
 * must never influence due-ness, and that is a test, not a convention. The
 * window's START is still client-supplied — a named deviation, bounded by the
 * server-clocked end, the eight-day evaluation limit, the claim marker that
 * makes a replay free, and now by the governing version's own authoring
 * instant: a version cannot own a moment that predates it.
 *
 * THAT LAST BOUND EXISTS BECAUSE AN EDIT WOULD OTHERWISE REPLAY THE PAST.
 * The occurrence identity digests the contract version, so a new version gave
 * every occurrence in an already-handled window a fresh identity and a fresh
 * claim — review measured six runs for the same three hours. Clamping the
 * window's start to the version's `authoredAt` means a new version owns only
 * moments after it existed, which is what "a trigger creates at most one Cron
 * Loop Run" has to mean across an edit. A durable per-schedule watermark
 * would bound it further and does not exist yet.
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
  /** What the durable store says about this schedule. */
  inspectSchedule(scheduleId: string): ScheduleReadResult;
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

  // A caller sending a field the SCHEDULE owns has the wrong model of this
  // endpoint, and silently ignoring it lets them believe it took effect.
  const storeOwned = ['cronExpression', 'timeZone', 'contractVersion']
    .filter((f) => body !== null && typeof body === 'object'
      && (body as Record<string, unknown>)[f] !== undefined);
  const bindingOwned = ['contractRef', 'contractBindingDigest']
    .filter((f) => (body as Record<string, unknown>).binding !== null
      && typeof (body as Record<string, unknown>).binding === 'object'
      && ((body as Record<string, unknown>).binding as Record<string, unknown>)[f] !== undefined);
  if (storeOwned.length + bindingOwned.length > 0) {
    return err(
      422, 'field_owned_by_the_schedule',
      `These belong to the stored schedule, not the request: `
      + `${[...storeOwned, ...bindingOwned.map((f) => `binding.${f}`)].join(', ')}. `
      + 'Edit the schedule to change them; sending them here would let a caller believe a value '
      + 'took effect that never did.',
    );
  }

  const scheduleId = trimmed(body, 'scheduleId');
  const afterExclusive = trimmed(body, 'afterExclusive');
  const missedPolicy = trimmed(body, 'missedPolicy');
  const workClass = trimmed(body, 'workClass');
  const overlapPolicy = trimmed(body, 'overlapPolicy');
  const maxOccurrences = positiveInteger(body, 'maxOccurrences');

  const missing = Object.entries({
    scheduleId, afterExclusive, missedPolicy, workClass, overlapPolicy, maxOccurrences,
  }).filter(([, value]) => value === null).map(([field]) => field);
  if (missing.length > 0) {
    return err(422, 'validation_failed', `Missing or invalid fields: ${missing.join(', ')}.`);
  }

  // WHAT RUNS COMES FROM THE STORE, NOT THE REQUEST. A caller says WHICH
  // schedule to tick and over what window; the expression, the timezone, the
  // contract and the version are the schedule's own, so a request cannot run
  // one schedule's window under another's rules.
  const inspected = ticks.inspectSchedule(scheduleId as string);
  if (inspected.kind === 'missing') {
    return err(404, 'schedule_not_found',
      `No schedule named ${safeText(scheduleId)} exists. A tick runs a stored schedule; it does not `
      + 'accept one in the request.');
  }
  if (inspected.kind === 'corrupt') {
    return err(409, 'schedule_corrupt', safeText(inspected.problem));
  }
  if (inspected.record.paused) {
    return err(409, 'schedule_paused',
      `${safeText(scheduleId)} is paused. A paused schedule is not evaluated, and nothing was `
      + 'claimed or created.');
  }
  // THE HIGHEST VERSION, not the last element — the same rule
  // `planScheduleEdit` uses, and for its reason: gaps are permitted, so
  // position does not imply order. Two modules disagreeing about what "head"
  // means would run an older schedule while reporting a newer version.
  const head = [...inspected.record.history]
    .sort((a, b) => a.version - b.version)[inspected.record.history.length - 1] as
    (typeof inspected.record.history)[number];

  const binding = (body as Record<string, unknown>).binding;
  const projectId = trimmed(binding, 'projectId');
  const loopId = trimmed(binding, 'loopId');
  const workspaceIdRaw = binding !== null && typeof binding === 'object'
    ? (binding as Record<string, unknown>).workspaceId : undefined;
  const workspaceId = typeof workspaceIdRaw === 'string' && workspaceIdRaw.trim() !== ''
    ? workspaceIdRaw.trim() : null;
  const missingBinding = Object.entries({ projectId, loopId })
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

  const timeZone = head.timeZone;
  const cronExpression = head.cronExpression;
  if (!IANA_ZONE.test(timeZone)) {
    return err(
      422, 'validation_failed',
      `"${safeText(timeZone)}" is not an IANA timezone name. A recurring schedule needs a zone `
      + '(for example "America/Los_Angeles"), not a fixed offset: an offset cannot express '
      + 'daylight saving, so the schedule would drift an hour against the wall clock twice a year.',
    );
  }

  const parsed = parseCronExpression(cronExpression);
  if (!parsed.ok) return err(422, 'validation_failed', safeText(parsed.problem));

  // A VERSION CANNOT OWN A MOMENT THAT PREDATES IT. Without this an edit
  // re-ran every occurrence of an already-handled window under new
  // identities.
  const authoredMs = readIsoInstantWithOffset(head.authoredAt);
  if (authoredMs === null) {
    return err(422, 'validation_failed',
      'The governing version records an authoring instant that is not ISO-8601 with an explicit '
      + 'offset, so the window cannot be bounded by it.');
  }
  const requestedStartMs = readIsoInstantWithOffset(afterExclusive as string);
  if (requestedStartMs === null) {
    return err(422, 'invalid_window',
      'afterExclusive must be an ISO-8601 instant carrying an explicit UTC offset.');
  }
  const effectiveAfter = requestedStartMs >= authoredMs
    ? (afterExclusive as string)
    : head.authoredAt;

  // THE WINDOW MAY ONLY REACH THE PRESENT. Clamping to the server clock is
  // what makes the tick's own `future_window` refusal structurally
  // unreachable from this route rather than merely unlikely.
  const untilInclusive = request.now;

  const report = ticks.tick({
    evaluatedAt: request.now,
    evaluation: {
      schedule: parsed.schedule,
      timeZone,
      scheduleId: scheduleId as string,
      contractVersion: head.version,
      afterExclusive: effectiveAfter,
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
      contractRef: head.contractRef,
      contractBindingDigest: head.contractBindingDigest,
    },
  });

  if (!report.ok) {
    return err(422, report.refusal, safeText(report.problem));
  }

  const counted = (outcome: string): number =>
    report.occurrences.filter((o) => o.outcome === outcome).length;

  return ok({
    scheduleId,
    contractVersion: head.version,
    evaluatedAt: request.now,
    window: { afterExclusive: effectiveAfter, untilInclusive },
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
