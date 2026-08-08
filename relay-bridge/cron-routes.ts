import { type ReviewerRouteResult } from './reviewer-routes';
import { LOOP_ENGINE_ENV, loopEngineEnabled } from './loop-routes';
import { safeText } from './redact';
import { decodeSegment } from './path-segment';
import { isUsableScheduleId } from '../src/relay/persistence/cron-schedule-node';
import { featureEffectivelyEnabled } from '../src/relay/mission/loop/loop-availability';
import { parseCronExpression } from '../src/relay/mission/loop/cron';
import { readIsoInstantWithOffset } from '../src/relay/mission/loop/runtime/loop-scheduler';
import type { CronSchedule, CronTickReport } from '../src/relay/mission/loop/cron';
import type { CronRunBinding, CronScheduleListingPage } from './cron-service';
import type { ZonePlaceVerdict } from '../src/relay/mission/loop/cron';
import type { ScheduleReadResult } from '../src/relay/persistence/cron-schedule-node';
import type {
  CronContractVersion, VersionedRun,
} from '../src/relay/mission/loop/cron/cron-versioning';

/**
 * SUNDAY RELAY — THE CRON ENDPOINTS.
 *
 * FOUR OPERATIONS, all operator-only and flag-gated: the tick, and the schedule
 * family (create, list, pause). CRON_LOOPS.md approved an in-bridge scheduler
 * woken by an authenticated tick, with the platform's own cron as a WAKER that
 * "must never define occurrences, hold state, or be required for correctness".
 * This is that seam plus the operations that make a schedule reachable by an
 * operator at all. What it is NOT, stated because a surface that guesses would
 * guess generously:
 *
 * - **Not a scheduler.** Nothing calls the tick on a schedule. No timer exists.
 * - **Not a dispatcher.** A tick creates durable Loop run RECORDS and advances
 *   none of them; the engine refuses cron-triggered dispatch.
 * - **Not schedule-less.** The schedule is READ from the durable store: a
 *   request says which schedule and over what window, and the expression,
 *   timezone, contract and version are the schedule's own.
 * - **Not rebindable.** A schedule pins the project and Loop its runs belong
 *   to, given at creation and carried in the contract version, so the
 *   occurrence claim protects the schedule rather than a (schedule, binding)
 *   pair. Changing it is an EDIT, and no endpoint exposes editing.
 *
 * THE CLOCK IS THE SERVER'S. `evaluatedAt` and the window's end come from the
 * server, never the body: CRON_LOOPS.md says a client-supplied time field must
 * never influence due-ness, and that is a test, not a convention. The window's
 * START is still client-supplied — a named deviation, bounded by the
 * server-clocked end, the eight-day evaluation limit, the claim marker that
 * makes a replay free, and by the governing version's own authoring instant.
 *
 * THAT LAST BOUND EXISTS BECAUSE AN EDIT WOULD OTHERWISE REPLAY THE PAST. The
 * occurrence identity digests the contract version, so a new version gave every
 * occurrence in an already-handled window a fresh identity and a fresh claim —
 * review measured six runs for the same three hours. Clamping the window's
 * start to the version's `authoredAt` means a new version owns only moments
 * after it existed, which is what "a trigger creates at most one Cron Loop Run"
 * has to mean across an edit. A durable per-schedule watermark would bound it
 * further and does not exist yet.
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
  listSchedules(): CronScheduleListingPage;
  /** What ICU resolves this zone to, or null when nothing can. */
  resolveZone(timeZone: string): string | null;
  /** Whether the zone names a place, does not, or cannot be verified. */
  zoneNamesAPlace(timeZone: string): ZonePlaceVerdict;
  createSchedule(
    scheduleId: string, first: CronContractVersion,
  ): { readonly ok: true } | { readonly ok: false; readonly problem: string };
  setSchedulePaused(
    scheduleId: string, paused: boolean, at: string,
  ): { readonly ok: true } | { readonly ok: false; readonly problem: string };
  scheduleRunsFor(loopIds: readonly string[], scheduleId: string): {
    readonly runs: readonly VersionedRun[];
    readonly unattributed: number;
  };
  removeSchedule(
    scheduleId: string, at: string,
  ): { readonly ok: true; readonly claimsPurged: number; readonly claimsLeft: number }
    | { readonly ok: false; readonly problem: string };
  editSchedule(
    scheduleId: string,
    proposed: Omit<CronContractVersion, 'version'>,
    runs: readonly VersionedRun[],
  ): { readonly ok: true; readonly version: number; readonly changed: readonly string[] }
    | { readonly ok: false; readonly problem: string };
}

/**
 * A zone this server will not schedule against, refused wherever it appears.
 *
 * Named for what it does: it refuses THREE things, not one. A fixed offset
 * (`Etc/GMT±N`), a frozen legacy zone (`SystemV/*`, six of whose thirteen
 * members do observe daylight saving, on a ruleset frozen in 1987), and a zone
 * this server cannot check at all. The rule is not a pattern — two attempts to
 * enumerate these families by regex were each a step behind reality — it is
 * ICU's own list of real locations.
 *
 * IT STATES ITS OWN PRECONDITION rather than trusting callers. An unresolvable
 * zone gets the unresolvable message here, so a third call site added without
 * the caller-side guard cannot tell an operator `America/Atlantis` is a fixed
 * offset.
 *
 * Applied at CREATION and at the TICK: a schedule written straight into the
 * store would otherwise run under a zone the tick's own refusal says it will
 * not run.
 */
function refuseZoneThatNamesNoPlace(
  ticks: CronTickPort, asWritten: string,
): ReviewerRouteResult | null {
  const verdict = ticks.zoneNamesAPlace(asWritten);
  if (verdict === 'place') return null;
  const resolved = ticks.resolveZone(asWritten);
  const named = resolved === null || resolved === asWritten
    ? `"${safeText(asWritten)}"`
    : `"${safeText(asWritten)}" (${safeText(resolved)})`;
  if (resolved === null) {
    return err(422, 'validation_failed',
      `${named} is IANA-shaped but this server's timezone evaluator cannot resolve it. A schedule `
      + 'that could never be evaluated is not stored.');
  }
  if (verdict === 'cannot_verify') {
    // NO CLAIM ABOUT THE ZONE. Saying "this is a server fault, not a bad zone"
    // asserted the very thing the sentence before it says cannot be checked —
    // and was plainly false when the zone was `Etc/GMT+5`.
    return err(422, 'validation_failed',
      `${named} cannot be checked against this server's list of real locations, so it is refused `
      + 'rather than scheduled unverified.');
  }
  return err(422, 'validation_failed',
    `${named} does not name a place this server can schedule against — it is a fixed offset `
    + '(Etc/GMT±N) or a frozen legacy zone (SystemV/*) whose daylight-saving rules no longer '
    + 'follow the location it appears to name. A recurring schedule needs a zone whose rules '
    + 'change with its place.');
}

/** Creating or pausing a schedule changes what Relay will do unattended, so
 *  both require the same explicit consent a tick does. */
function requireAuthorization(body: unknown, what: string): ReviewerRouteResult | null {
  const authorized = body !== null && typeof body === 'object'
    && (body as Record<string, unknown>).authorized === true;
  return authorized ? null : err(
    403, 'authorization_required',
    `${what} changes what this server will do unattended and requires explicit authorization.`,
  );
}

/**
 * The contract fields a create or an EDIT proposes, validated once.
 *
 * ONE READER FOR BOTH SURFACES. Every divergence this file has shipped came
 * from a rule that lived on one path: the binding required at create and
 * ignored at the tick, `contractRef` refused in one place and swallowed in
 * another, a workspace rule the store enforced and the route did not. An edit
 * that validated separately would be the fourth.
 *
 * `version` and `authoredAt` are NOT here: the store derives the first and the
 * server clocks the second, on both paths.
 */
interface ProposedContract {
  readonly scheduleId: string;
  readonly projectId: string;
  readonly workspaceId: string | null;
  readonly loopId: string;
  readonly cronExpression: string;
  readonly timeZone: string;
  readonly contractRef: string;
  readonly contractBindingDigest: string;
  readonly authoredBy: string;
}

function readProposedContract(
  request: CronRouteRequest, ticks: CronTickPort, what: 'create' | 'edit',
): ProposedContract | ReviewerRouteResult {
  const body = request.body;
  const scheduleId = trimmed(body, 'scheduleId');
  const cronExpression = trimmed(body, 'cronExpression');
  const timeZone = trimmed(body, 'timeZone');
  const contractRef = trimmed(body, 'contractRef');
  const contractBindingDigest = trimmed(body, 'contractBindingDigest');
  const authoredBy = trimmed(body, 'authoredBy');
  const missing = Object.entries({
    scheduleId, cronExpression, timeZone, contractRef, contractBindingDigest, authoredBy,
  }).filter(([, v]) => v === null).map(([f]) => f);
  if (missing.length > 0) {
    return err(422, 'validation_failed', `Missing or invalid fields: ${missing.join(', ')}.`);
  }
  // AN UNUSABLE ID IS A VALIDATION FAILURE, NOT A CONFLICT. Reserving 409 for
  // the genuine already-exists case is what lets a caller tell "pick another
  // name" apart from "fix this field".
  if (!isUsableScheduleId(scheduleId as string)) {
    return err(422, 'validation_failed',
      `"${safeText(scheduleId)}" cannot name a schedule: 1-64 characters, letters, digits, `
      + 'underscore and hyphen, starting with a letter or digit.');
  }
  if (!IANA_ZONE.test(timeZone as string)) {
    return err(422, 'validation_failed',
      `"${safeText(timeZone)}" is not an Area/Location timezone name. A recurring schedule needs a `
      + 'zone naming a place, such as "America/Los_Angeles" — not a fixed offset, which cannot '
      + 'express daylight saving.');
  }
  // SHAPE IS NOT EXISTENCE. `America/Atlantis` satisfies the pattern and no
  // evaluator can resolve it, so accepting it stored a schedule whose every
  // future tick fails `unknown_timezone`. Resolvability is asked FIRST so a
  // string naming nothing is told it names nothing, rather than being handed
  // the diagnosis for a different problem.
  const zoneRefusal = refuseZoneThatNamesNoPlace(ticks, timeZone as string);
  if (zoneRefusal !== null) return zoneRefusal;
  const parsed = parseCronExpression(cronExpression as string);
  if (!parsed.ok) return err(422, 'validation_failed', safeText(parsed.problem));

  // THE SAME RULE THE TICK APPLIES, FOR THE SAME REASON. A caller sending a
  // field this route decides has the wrong model of it, and ignoring the field
  // silently lets them believe it took effect: `paused: true` was accepted,
  // discarded, and answered with a success for an ACTIVE schedule.
  // `contractVersion` is the name the tick uses for `version`.
  const decided = ['version', 'contractVersion', 'authoredAt', 'paused']
    .filter((f) => (body as Record<string, unknown>)[f] !== undefined);
  if (decided.length > 0) {
    return err(422, 'field_not_accepted',
      `${decided.join(', ')} ${decided.length === 1 ? 'is' : 'are'} decided by this server, not by `
      + `the request. ${what === 'create'
        ? 'A new schedule is version 1, authored now, and active.'
        : 'An edit appends the next version, authored now, and never changes whether the '
          + 'schedule is paused.'}`);
  }

  // THE BINDING IS REQUIRED, because it is what the runs are attributed
  // through. A schedule without one could be ticked into any project and Loop
  // a caller named, which is the hole it closes.
  const bindingBody = (body as Record<string, unknown>).binding;
  const projectId = trimmed(bindingBody, 'projectId');
  const loopId = trimmed(bindingBody, 'loopId');
  const workspaceRaw = bindingBody !== null && typeof bindingBody === 'object'
    ? (bindingBody as Record<string, unknown>).workspaceId : undefined;
  const missingBinding = Object.entries({ projectId, loopId })
    .filter(([, value]) => value === null).map(([field]) => `binding.${field}`);
  if (missingBinding.length > 0) {
    return err(422, 'validation_failed', `Missing or invalid fields: ${missingBinding.join(', ')}.`);
  }
  // `contractRef` and `contractBindingDigest` are given at the top level, so
  // ones sent INSIDE `binding` were read by nobody and answered with a success.
  // BY NAME, NOT BY CATEGORY, on both surfaces: an unrecognised key inside
  // `binding` is still discarded silently here and at the tick. The two agree;
  // neither is exhaustive.
  const contractInBinding = ['contractRef', 'contractBindingDigest']
    .filter((f) => bindingBody !== null && typeof bindingBody === 'object'
      && (bindingBody as Record<string, unknown>)[f] !== undefined);
  if (contractInBinding.length > 0) {
    return err(422, 'field_not_accepted',
      `${contractInBinding.map((f) => `binding.${f}`).join(', ')} belongs at the top level of the `
      + 'request, not inside binding. Sent here it would be stored by nobody.');
  }

  // STATED EXPLICITLY MEANS STATED. A project-level schedule has no workspace,
  // and `null` is how it says so — absent is not, and a blank string is not.
  // Each shape is told what IT did, not what some other caller might have done.
  if (workspaceRaw === undefined) {
    return err(422, 'validation_failed',
      'binding.workspaceId must name a workspace or be null, stated explicitly. Leaving it out is '
      + 'not a way to say there is none.');
  }
  if (workspaceRaw !== null && typeof workspaceRaw !== 'string') {
    return err(422, 'validation_failed',
      'binding.workspaceId must be a string naming a workspace, or null. It is neither.');
  }
  if (typeof workspaceRaw === 'string' && workspaceRaw.trim() === '') {
    return err(422, 'validation_failed',
      'binding.workspaceId must name a workspace or be null, stated explicitly. A blank string '
      + 'names no workspace and is not a way to say there is none.');
  }

  return {
    scheduleId: scheduleId as string,
    projectId: projectId as string,
    workspaceId: typeof workspaceRaw === 'string' ? workspaceRaw.trim() : null,
    loopId: loopId as string,
    cronExpression: cronExpression as string,
    timeZone: timeZone as string,
    contractRef: contractRef as string,
    contractBindingDigest: contractBindingDigest as string,
    authoredBy: authoredBy as string,
  };
}

const isRefusal = (v: ProposedContract | ReviewerRouteResult): v is ReviewerRouteResult =>
  'status' in v;

function createSchedule(request: CronRouteRequest, ticks: CronTickPort): ReviewerRouteResult {
  const refusal = requireAuthorization(request.body, 'Creating a schedule');
  if (refusal !== null) return refusal;
  const proposed = readProposedContract(request, ticks, 'create');
  if (isRefusal(proposed)) return proposed;
  const { scheduleId } = proposed;
  const { scheduleId: _id, ...contract } = proposed;
  const created = ticks.createSchedule(scheduleId, {
    version: 1,
    ...contract,
    // `authoredBy` is A CALLER-DECLARED LABEL, not an authenticated identity.
    // There is one operator credential, so binding it to the principal would
    // say less than the label does — but a later reader of
    // `history[0].authoredBy` must not mistake it for proof of who acted.
    //
    // THE AUTHORING INSTANT IS THE SERVER'S. A caller does not get to say when
    // it authored something: that instant bounds which moments a version may
    // own, so accepting it from the body would hand back the replay the tick
    // clamps against.
    authoredAt: request.now,
  });
  if (!created.ok) return err(409, 'schedule_not_created', safeText(created.problem));
  return ok({
    scheduleId,
    version: 1,
    authoredAt: request.now,
    note: 'The schedule is stored and active. Nothing runs it: there is no timer, and a tick must '
      + 'be requested by an operator. A tick window is clamped to this authoring instant, so no '
      + 'occurrence before it can ever run.',
  });
}

/**
 * An EDIT appends a version; it never rewrites one and never runs anything.
 *
 * The whole decision is `planScheduleEdit`, which this route does not
 * reimplement: it refuses an edit that changes nothing, one that would orphan
 * a run citing a version the history lacks, and it reports the ACTIVE runs the
 * change must not disturb. What the route adds is the same validation a create
 * gets — from the same reader, so the two cannot drift — plus the server's
 * clock for the authoring instant.
 *
 * PAUSING IS NOT AN EDIT and cannot be reached through here: `paused` is on the
 * refused-field list, so an operator who wants a schedule stopped uses the
 * control that stops it rather than one that appends a version.
 */
function editSchedule(
  request: CronRouteRequest, ticks: CronTickPort, rawId: string,
): ReviewerRouteResult {
  const refusal = requireAuthorization(request.body, 'Editing a schedule');
  if (refusal !== null) return refusal;
  const scheduleId = decodeSegment(rawId);
  if (scheduleId === null) {
    return err(422, 'validation_failed', 'The schedule id is not a usable path segment.');
  }
  if (!isUsableScheduleId(scheduleId)) {
    return err(422, 'validation_failed',
      `"${safeText(scheduleId)}" cannot name a schedule: 1-64 characters, letters, digits, `
      + 'underscore and hyphen, starting with a letter or digit.');
  }
  const proposed = readProposedContract(request, ticks, 'edit');
  if (isRefusal(proposed)) return proposed;
  // THE PATH NAMES THE SCHEDULE. A body that names a different one is refused
  // rather than silently ignored or silently obeyed — either would edit a
  // schedule the caller did not address.
  if (proposed.scheduleId !== scheduleId) {
    return err(422, 'validation_failed',
      `The path names ${safeText(scheduleId)} and the body names ${safeText(proposed.scheduleId)}. `
      + 'An edit changes the schedule in the path.');
  }

  // INSPECT BEFORE WRITING, exactly as the tick and pause do: missing is 404,
  // corrupt is 409, and neither is a lock problem.
  const inspected = ticks.inspectSchedule(scheduleId);
  if (inspected.kind === 'missing') {
    return err(404, 'schedule_not_found',
      `No schedule named ${safeText(scheduleId)} exists. Nothing was edited.`);
  }
  if (inspected.kind === 'corrupt') {
    return err(409, 'schedule_corrupt', safeText(inspected.problem));
  }

  // THE RUNS THIS SCHEDULE ACTUALLY MADE. A run now records the schedule that
  // created it, so the planner gets the right list rather than every run in the
  // Loop — which reported another schedule's runs as this one's, and made every
  // future edit refuse as orphaning once that schedule moved to a new version.
  //
  // WHAT CANNOT BE ATTRIBUTED IS COUNTED, not dropped: a schedule-created run
  // written before runs recorded their schedule carries `null`, and calling
  // those "not ours" would report a clean list of this schedule's own unfinished work over runs that may be.
  // EVERY LOOP THE SCHEDULE HAS NAMED, not just the one its head names. A
  // rebinding is an edit like any other, so runs made before one live in the
  // Loop that version named; scanning only the head's made them invisible in
  // both outputs.
  const scheduleRuns = ticks.scheduleRunsFor(
    inspected.record.history.map((v) => v.loopId), scheduleId,
  );

  // WHY THE LIST IS THIS ONE, since it has been three different lists.
  //
  // `planScheduleEdit` uses it for two things. Refusing an edit that would
  // ORPHAN a run is inert here: an append only grows the set of known versions,
  // so nothing explainable before the edit is unexplainable after it. Reporting
  // the runs a change must not disturb is the half that matters, and it needs
  // those runs to be THIS schedule's.
  //
  // The Loop-wide list was wrong in both directions — two schedules may bind
  // one Loop, so it reported another schedule's runs as this one's, and once
  // that schedule moved to a new version its runs cited a version this history
  // lacked and every future edit was refused as orphaning. Passing none was
  // honest but silent. A run names its schedule now, so the list is exact and
  // what cannot be attributed is counted rather than dropped.
  const { scheduleId: _id, ...contract } = proposed;
  const edited = ticks.editSchedule(
    scheduleId, { ...contract, authoredAt: request.now }, scheduleRuns.runs,
  );
  if (!edited.ok) return err(409, 'schedule_not_edited', safeText(edited.problem));
  return ok({
    scheduleId,
    version: edited.version,
    authoredAt: request.now,
    // NAMED, not left to inference: a version whose diff nobody can state is a
    // version nobody can review. Diffed from the history the store returned, so
    // it describes the version that actually landed.
    changed: edited.changed,
    // THIS SCHEDULE'S UNFINISHED RUNS, which keep the version they started
    // under. NOT "in flight": nothing in this build advances a scheduled run,
    // so an unfinished one has not been DISPATCHED — it is normally `queued`,
    // though an operator stop can move it out of that state, which is why the
    // claim here is about dispatch and not about the state. `activeRunsFor`
    // twenty lines away deliberately excludes `queued` for that reason, and one
    // file using the same word for two different things is how the next reader
    // learns the wrong one.
    unfinishedRunsUndisturbed: scheduleRuns.runs.filter((r) => r.active).map((r) => r.runId),
    // Runs in those Loops that could not be attributed to any schedule.
    // Unknown, reported as Unknown.
    unattributedRuns: scheduleRuns.unattributed,
    note: 'The edit appended a version. Every earlier version is kept, and a run created under one '
      + 'still resolves to the version it started under. A tick window is clamped to this '
      + 'authoring instant, so the new version owns no moment that predates it. Nothing in this '
      + 'build advances a scheduled run, so the unfinished runs named here have not been '
      + 'dispatched.',
  });
}

/**
 * Deletion, which frees the id.
 *
 * IT READS ONLY TO TELL MISSING FROM PRESENT, and a read that FAILS does not
 * refuse the request. The case that motivates deletion is a schedule too
 * CORRUPT to read — a journal written before a required field existed, a zone
 * no evaluator resolves — and an inspect whose failure refused would block
 * exactly the removal this exists to perform. Such a read used to reach the
 * server's catch-all and answer 500; present-and-unreadable is treated as
 * present now. Until this existed, the answer was to edit the volume by hand.
 *
 * WHAT IT STILL CANNOT REMOVE, said plainly: a journal the filesystem will not
 * let go of — a directory in its place, an immutable file — is refused with
 * what the unlink said, not deleted. That refusal is truthful and destroys
 * nothing, which is the part worth having; the record still needs a hand.
 *
 * THE ID COMES BACK. An earlier version of this left a tombstone so a reused id
 * could not inherit the deleted schedule's occurrence claims — and review
 * showed the hazard it guarded cannot occur: a recreated schedule is authored
 * NOW, and the tick clamps its window to its own authoring instant, so it can
 * only own moments that postdate its creation. Permanent id exhaustion for an
 * unreachable collision is a worse trade than the dead end it replaced. The
 * store purges the claims anyway, so nothing is left to reason about.
 *
 * WHAT IT DOES NOT CHECK: whether runs this schedule created are still
 * unfinished. A run records its schedule now, so the question COULD be
 * answered — deletion simply does not ask. Deleting a schedule does not touch
 * its runs, which keep their own records and their attribution to the version
 * they started under.
 */
function deleteSchedule(
  request: CronRouteRequest, ticks: CronTickPort, rawId: string,
): ReviewerRouteResult {
  const refusal = requireAuthorization(request.body, 'Deleting a schedule');
  if (refusal !== null) return refusal;
  const scheduleId = decodeSegment(rawId);
  if (scheduleId === null) {
    return err(422, 'validation_failed', 'The schedule id is not a usable path segment.');
  }
  if (!isUsableScheduleId(scheduleId)) {
    return err(422, 'validation_failed',
      `"${safeText(scheduleId)}" cannot name a schedule: 1-64 characters, letters, digits, `
      + 'underscore and hyphen, starting with a letter or digit.');
  }
  // MISSING IS 404 HERE TOO. Every sibling answers 404 for a schedule that is
  // not there; answering 409 would tell an operator retrying a timed-out delete
  // that they conflicted with something, when what happened is that it worked.
  let present = true;
  try {
    present = ticks.inspectSchedule(scheduleId).kind !== 'missing';
  } catch {
    // A record too damaged to inspect is still a record to delete.
    present = true;
  }
  if (!present) {
    return err(404, 'schedule_not_found',
      `No schedule named ${safeText(scheduleId)} exists. Nothing was deleted.`);
  }
  // WRAPPED FOR THE SAME REASON THE INSPECT IS. A throw from inside the purge —
  // an unreadable occurrences root, a file where that directory should be —
  // reached the catch-all as a 500, and since the schedule is removed BEFORE
  // the purge, that 500 would follow a deletion that had already happened. An
  // unknown answer about a completed delete is worse than a named one.
  let removed: ReturnType<CronTickPort['removeSchedule']>;
  try {
    removed = ticks.removeSchedule(scheduleId, request.now);
  } catch (error) {
    return err(500, 'schedule_delete_incomplete',
      'The schedule was removed, but purging its occurrence claims failed: '
      + `${safeText(error instanceof Error ? error.message : 'unknown error')}. The claims that `
      + 'remain cannot be inherited — a schedule created under this name is authored now — but '
      + 'they were not cleaned up. DO NOT RETRY: the schedule is already gone, and a second '
      + 'attempt answers 404.');
  }
  if (!removed.ok) return err(409, 'schedule_not_deleted', safeText(removed.problem));
  return ok({
    scheduleId,
    deletedAt: request.now,
    // NAMED, because a purge nobody can count is a purge nobody can check.
    claimsPurged: removed.claimsPurged,
    // Markers this could not remove. The deletion still happened — an orphan
    // cannot be inherited — but the count is reported rather than rounded to
    // zero, because a purge nobody can check is a purge nobody should trust.
    claimsLeft: removed.claimsLeft,
    note: [
      'The schedule is gone and its id is free.',
      removed.claimsLeft === 0
        ? 'The occurrence claims it made were purged.'
        : `${String(removed.claimsLeft)} occurrence marker(s) could not be purged or attributed.`,
      'A schedule created under this name is authored now, so its ticks can only own moments '
      + 'after it exists. Runs it created are untouched and keep the version they started under.',
    ].join(' '),
  });
}

function pauseSchedule(
  request: CronRouteRequest, ticks: CronTickPort, rawId: string,
): ReviewerRouteResult {
  const refusal = requireAuthorization(request.body, 'Pausing or resuming a schedule');
  if (refusal !== null) return refusal;
  const body = request.body as Record<string, unknown> | null;
  const paused = body === null ? undefined : body.paused;
  if (typeof paused !== 'boolean') {
    return err(422, 'validation_failed', 'paused must be true or false, stated explicitly.');
  }
  // The repository's ONE segment decoder. A private copy here is how a decoding
  // defect comes back after the shared one is fixed.
  const scheduleId = decodeSegment(rawId);
  // TWO DIFFERENT FAILURES, TWO DIFFERENT SENTENCES. `_leading` IS a usable
  // path segment and is not a usable schedule id; one message for both named
  // the wrong rule and sent an operator to check their URL encoding.
  if (scheduleId === null) {
    return err(422, 'validation_failed', 'The schedule id is not a usable path segment.');
  }
  if (!isUsableScheduleId(scheduleId)) {
    return err(422, 'validation_failed',
      `"${safeText(scheduleId)}" cannot name a schedule: 1-64 characters, letters, digits, `
      + 'underscore and hyphen, starting with a letter or digit.');
  }
  // INSPECT BEFORE WRITING, exactly as the tick does. `setPaused` takes the
  // write lock BEFORE it replays, and acquiring a lock inside a directory that
  // does not exist fails ENOENT — which the store can only report as "another
  // process holds the lock, or it cannot be read". Pausing a schedule that was
  // never created therefore blamed contention, sending an operator to
  // investigate a writer that does not exist. Missing is 404 here for the same
  // reason it is 404 in the tick.
  const inspected = ticks.inspectSchedule(scheduleId);
  if (inspected.kind === 'missing') {
    return err(404, 'schedule_not_found',
      `No schedule named ${safeText(scheduleId)} exists. Nothing was paused or resumed.`);
  }
  if (inspected.kind === 'corrupt') {
    return err(409, 'schedule_corrupt', safeText(inspected.problem));
  }
  const result = ticks.setSchedulePaused(scheduleId, paused, request.now);
  // NOT a claim that this is contention. `underLock` returns one string for
  // every lock failure it can meet, so this path narrows to "the schedule was
  // there a moment ago and the write did not happen" — a racing writer, or the
  // directory removed out-of-band between the inspect above and here. The
  // store's own text is passed through rather than reinterpreted.
  if (!result.ok) return err(409, 'schedule_not_changed', safeText(result.problem));
  return ok({ scheduleId, paused });
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

  // WHICH OPERATION THIS IS, decided before readiness. Answering 503 for a
  // path that names no operation tells a caller the operation exists and the
  // server is merely unready — two different things, and only one of them
  // becomes true later.
  const pauseMatch = /^\/cron\/schedules\/([^/]+)\/pause$/u.exec(request.path);
  const editMatch = /^\/cron\/schedules\/([^/]+)\/edit$/u.exec(request.path);
  const deleteMatch = /^\/cron\/schedules\/([^/]+)\/delete$/u.exec(request.path);
  const isSchedules = request.path === `${CRON_PREFIX}schedules`;
  const isTick = request.path === `${CRON_PREFIX}tick`;
  const recognized =
    (isSchedules && (request.method === 'GET' || request.method === 'POST'))
    || (pauseMatch !== null && request.method === 'POST')
    || (editMatch !== null && request.method === 'POST')
    || (deleteMatch !== null && request.method === 'POST')
    || (isTick && request.method === 'POST');
  if (!recognized) {
    return err(422, 'validation_failed', 'Unknown Cron operation.');
  }

  if (ticks === null) {
    return err(
      503, 'cron_not_ready',
      'This Relay Bridge has no mounted state root, so no schedule can be stored durably and no '
      + 'occurrence can be claimed.',
    );
  }

  // The schedule family. A schedule could previously only be made from a
  // test, which meant the whole Cron path was unreachable by an operator.
  if (isSchedules) {
    if (request.method === 'GET') return ok(ticks.listSchedules());
    return createSchedule(request, ticks);
  }
  if (pauseMatch !== null) {
    return pauseSchedule(request, ticks, pauseMatch[1] as string);
  }
  if (editMatch !== null) {
    return editSchedule(request, ticks, editMatch[1] as string);
  }
  if (deleteMatch !== null) {
    return deleteSchedule(request, ticks, deleteMatch[1] as string);
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
  // The WHOLE binding is the schedule's now, not just the contract fields
  // inside it. A caller sending one has the wrong model of this endpoint, and
  // accepting it silently is how a run gets attributed somewhere the schedule
  // never named.
  const bindingOwned = ['projectId', 'workspaceId', 'loopId', 'contractRef', 'contractBindingDigest']
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

  // WHAT THE RUNS BELONG TO IS THE SCHEDULE'S, NOT THE REQUEST'S. While these
  // arrived in the body they were also part of the occurrence claim key, so the
  // durable marker protected a (schedule, binding) PAIR: the same window ticked
  // under three bindings produced nine runs where three were intended, six of
  // them in one Loop for the same three hours. The key is the schedule id alone
  // now, and the binding is read from the governing version — so a tick creates
  // at most one run per occurrence, which is what that rule has always claimed
  // to mean.
  const projectId = head.projectId;
  const loopId = head.loopId;
  const workspaceId = head.workspaceId;

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
      `"${safeText(timeZone)}" is not an Area/Location timezone name. A recurring schedule needs `
      + 'a zone naming a place (for example "America/Los_Angeles"), not a fixed offset: an offset '
      + 'cannot express daylight saving, so the schedule would drift an hour against the wall '
      + 'clock twice a year.',
    );
  }
  // AND THE REFUSAL ABOVE IS NOW TRUE. It promised that a fixed offset is not
  // run, while `Etc/GMT+5` — a real zone — sailed past it. A schedule stored
  // before creation learned to refuse these, or written straight into the
  // store, is refused HERE rather than drifting an hour twice a year under a
  // rule the same message claims to enforce.
  // The `!== null` guard is deliberate HERE and not at creation: a stored zone
  // nothing can resolve is left to the evaluator, whose `unknown_timezone` is
  // the answer this endpoint has always given for it.
  if (ticks.resolveZone(timeZone) !== null) {
    const zoneRefusal = refuseZoneThatNamesNoPlace(ticks, timeZone);
    if (zoneRefusal !== null) return zoneRefusal;
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
