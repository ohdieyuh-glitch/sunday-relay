/**
 * `/gauntletloop` — THE COMMAND CONTROLLER.
 *
 * A user-activated review command that runs an iterative Gauntlet process
 * through the Independent Reviewer Harness. Activation is the only way in;
 * nothing else in the product starts one.
 *
 * THE FLOW, and every arrow is a real call in this file:
 *
 *   user ── /gauntletloop ──▶ activateGauntlet
 *                                  │
 *                                  ▼
 *                        Independent Reviewer Harness   (GauntletReviewPort)
 *                                  │  findings
 *                                  ▼
 *                        repair work through the ordinary boundary
 *                                  │                    (GauntletWorkPort)
 *                                  ▼
 *                        review again, until a stopping rule ends it
 *
 * NOT A LOOP IN CODE. `advanceGauntletCommand` handles exactly one settled
 * step and schedules at most one successor; whatever drives work brings the
 * controller back. A gauntlet that runs ten rounds does so across ten calls,
 * and a process that dies between any two of them loses nothing.
 *
 * NOTHING HERE IMPORTS JULIUS. Not a type, not a constant, not a function.
 * `gauntlet-boundary.test.ts` walks both directories and fails on any import
 * in either direction.
 */

import {
  advanceGauntlet, type GauntletLimits, type GauntletRun, type GauntletState,
} from './gauntlet-machine';
import type {
  GauntletClock, GauntletIds, GauntletPolicy, GauntletReviewPort,
  GauntletUsage, GauntletWorkPort,
} from './gauntlet-ports';

/* ------------------------------------------------------------- activation */

/**
 * WHETHER A GAUNTLET IS RUNNING, AND HOW IT STARTED.
 *
 * `INACTIVE` is the default and the resting state, and there is no code path
 * that leaves it except {@link activateGauntlet}. The transition a person sees
 * is: inactive → active → complete | cancelled | halted → inactive.
 */
export const GAUNTLET_ACTIVATIONS = ['INACTIVE', 'ACTIVE', 'CLEARED', 'HALTED', 'CANCELLED'] as const;
export type GauntletActivation = (typeof GAUNTLET_ACTIVATIONS)[number];

export const GAUNTLET_PHASES = ['REVIEW', 'REPAIR'] as const;
export type GauntletPhase = (typeof GAUNTLET_PHASES)[number];

/**
 * ONE ACTIVATED GAUNTLET.
 *
 * `activatedBy` and `activatedAt` are stored, not derived: a gauntlet that
 * cannot say who started it is one nobody can be accountable for, and the
 * whole architecture rests on this being a thing a person chose.
 */
export interface GauntletCommandRecord extends GauntletRun {
  readonly projectId: string;
  /** The work this gauntlet reviews. Opaque here — the gauntlet never reads it. */
  readonly subjectId: string;
  readonly activation: GauntletActivation;
  /** The person who typed the command. Never a credential, never a token. */
  readonly activatedBy: string;
  readonly activatedAt: string;
}

export interface GauntletRoundRecord {
  readonly gauntletId: string;
  readonly round: number;
  readonly phase: GauntletPhase;
  readonly workId: string;
  readonly outcome: 'PASSED' | 'FAILED' | 'HALTED' | 'CANCELLED' | null;
  readonly durationMs: number | null;
  readonly usdMicros: number | null;
  readonly findingIds: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface GauntletStore {
  /** Idempotent by `(runId, subjectId)`: a second /gauntletloop RESUMES. */
  create(record: GauntletCommandRecord): Promise<{ readonly created: boolean; readonly record: GauntletCommandRecord }>;
  load(runId: string, gauntletId: string): Promise<GauntletCommandRecord | null>;
  forSubject(runId: string, subjectId: string): Promise<GauntletCommandRecord | null>;
  /** Compare-and-set on `version`, mirroring the machine's own guard. */
  save(record: GauntletCommandRecord, expectedVersion: number): Promise<boolean>;
  recordRound(round: GauntletRoundRecord): Promise<{ readonly recorded: boolean; readonly duplicate: boolean }>;
  settleRound(input: {
    gauntletId: string; round: number; phase: GauntletPhase;
    outcome: NonNullable<GauntletRoundRecord['outcome']>;
    durationMs: number; usdMicros: number; findingIds: readonly string[]; completedAt: string;
  }): Promise<boolean>;
  roundsFor(gauntletId: string): Promise<readonly GauntletRoundRecord[]>;
}

export interface GauntletDependencies {
  readonly store: GauntletStore;
  readonly work: GauntletWorkPort;
  readonly reviewer: GauntletReviewPort;
  readonly clock: GauntletClock;
  readonly ids: GauntletIds;
}

/* -------------------------------------------------------------- outcomes */

export type GauntletActivationOutcome =
  | { readonly activated: true; readonly record: GauntletCommandRecord; readonly resumed: boolean; readonly firstWorkId: string }
  | { readonly activated: false; readonly reasonCode: string; readonly safeMessage: string };

export type GauntletAdvanceOutcome =
  | {
    readonly advanced: true; readonly state: GauntletState; readonly activation: GauntletActivation;
    readonly round: number; readonly nextWorkId: string | null; readonly haltReason: string | null;
  }
  | { readonly advanced: false; readonly reasonCode: string; readonly safeMessage: string };

/* ---------------------------------------------------------------- naming */

/**
 * DETERMINISTIC WORK IDS ARE THE IDEMPOTENCY.
 *
 * Two callers that both decide to start round 2 compose the SAME id, so the
 * second request is a no-op before the store's uniqueness has to refuse it.
 */
export const gauntletWorkId = (gauntletId: string, round: number, phase: GauntletPhase): string =>
  `gauntlet:${gauntletId}:${round}:${phase.toLowerCase()}`;

/* ------------------------------------------------------------ activation */

export interface GauntletActivationCommand {
  readonly runId: string;
  readonly projectId: string;
  readonly gauntletId: string;
  readonly subjectId: string;
  /** The person who typed `/gauntletloop`. Blank is refused. */
  readonly activatedBy: string;
  readonly limits: GauntletLimits;
  readonly policy: GauntletPolicy;
}

/**
 * THE ONLY WAY A GAUNTLET STARTS.
 *
 * Called from the command layer when a person invokes `/gauntletloop`. There
 * is deliberately no other exported function that can move a gauntlet out of
 * INACTIVE, and `gauntlet-boundary.test.ts` asserts that no mission start, no
 * reviewer invocation and no verification failure reaches this.
 */
export async function activateGauntlet(
  command: GauntletActivationCommand,
  deps: GauntletDependencies,
): Promise<GauntletActivationOutcome> {
  if (command.activatedBy.trim() === '') {
    return {
      activated: false, reasonCode: 'ACTIVATOR_REQUIRED',
      safeMessage: 'A gauntlet records who activated it. An unattributed activation is refused.',
    };
  }

  const existing = await deps.store.forSubject(command.runId, command.subjectId);
  if (existing !== null) {
    // `/gauntletloop` typed twice is an ordinary thing for a person to do, and
    // the second one RESUMES rather than forking.
    return {
      activated: true, resumed: true, record: existing,
      firstWorkId: gauntletWorkId(existing.gauntletId, Math.max(existing.round, 1), 'REVIEW'),
    };
  }

  if (!command.policy.allowed) {
    return {
      activated: false, reasonCode: 'ITERATIVE_REVIEW_NOT_PERMITTED',
      safeMessage: 'This deployment does not permit iterative review.',
    };
  }
  if (command.policy.requiresApproval) {
    return {
      activated: false, reasonCode: 'GAUNTLET_APPROVAL_REQUIRED',
      safeMessage: 'Activating a gauntlet requires an authorized approval first.',
    };
  }

  // THE POLICY CEILING WINS OVER THE REQUEST, WITHOUT REFUSING IT.
  // `/gauntletloop --rounds 50` under a ceiling of 3 runs three. Asking for
  // more than a deployment allows is not a violation, so it is not an error.
  const maxRounds = Math.min(command.limits.maxRounds, command.policy.maxRounds);
  if (maxRounds < 1) {
    return {
      activated: false, reasonCode: 'ITERATIVE_REVIEW_LIMIT',
      safeMessage: 'This deployment permits no iterative review rounds.',
    };
  }

  const now = deps.clock.now();
  const initial: GauntletCommandRecord = {
    gauntletId: command.gauntletId, runId: command.runId, projectId: command.projectId,
    subjectId: command.subjectId, taskId: command.subjectId,
    limits: { ...command.limits, maxRounds },
    state: 'READY', round: 0, retries: 0, usedDurationMs: 0, usedUsdMicros: 0,
    haltReason: null, version: 1,
    activation: 'ACTIVE', activatedBy: command.activatedBy, activatedAt: now,
  };
  const created = await deps.store.create(initial);
  if (!created.created) {
    return {
      activated: true, resumed: true, record: created.record,
      firstWorkId: gauntletWorkId(created.record.gauntletId, Math.max(created.record.round, 1), 'REVIEW'),
    };
  }

  const started = advance(created.record, { expectedVersion: created.record.version, action: 'START', durationMs: 0, usdMicros: 0 });
  if (started.state === 'HALTED') {
    await deps.store.save({ ...started, activation: 'HALTED' }, created.record.version);
    return {
      activated: false, reasonCode: started.haltReason ?? 'gauntlet_halted',
      safeMessage: 'The gauntlet halted before its first round.',
    };
  }
  await deps.store.save(started, created.record.version);

  // THE FIRST STEP IS A REVIEW, always. A gauntlet is an intensified review,
  // so it begins by looking at the work rather than by changing it.
  const workId = gauntletWorkId(started.gauntletId, started.round, 'REVIEW');
  await deps.work.requestWork({
    workId, subjectId: command.subjectId, kind: 'REVIEW', ordinal: started.round,
  });
  await deps.store.recordRound({
    gauntletId: started.gauntletId, round: started.round, phase: 'REVIEW', workId,
    outcome: null, durationMs: null, usdMicros: null, findingIds: [],
    startedAt: now, completedAt: null,
  });
  return { activated: true, resumed: false, record: started, firstWorkId: workId };
}

/* -------------------------------------------------------------- the step */

export interface GauntletStepInput {
  readonly runId: string;
  readonly gauntletId: string;
  readonly phase: GauntletPhase;
  readonly usage: GauntletUsage;
  /** Findings the reviewer produced, when the settled phase was a REVIEW. */
  readonly review?: { readonly blockingFindings: number; readonly findingIds: readonly string[] };
}

/**
 * Settle one phase and schedule at most one successor.
 *
 * A REVIEW with no blocking findings CLEARS. A REVIEW with blocking findings
 * schedules a REPAIR through the ordinary work boundary. A completed REPAIR
 * opens the next round's REVIEW — because a repair nobody looked at again is
 * not an iterative review.
 */
export async function advanceGauntletCommand(
  input: GauntletStepInput,
  deps: GauntletDependencies,
): Promise<GauntletAdvanceOutcome> {
  const current = await deps.store.load(input.runId, input.gauntletId);
  if (current === null) {
    return { advanced: false, reasonCode: 'GAUNTLET_NOT_FOUND', safeMessage: 'No gauntlet is active for this run.' };
  }
  if (current.activation !== 'ACTIVE') {
    // A late settlement for a finished gauntlet is absorbed. The worker that
    // produced it could not have known, and treating an ordinary race as a
    // failure turns a normal event into an alarm.
    return {
      advanced: true, state: current.state, activation: current.activation,
      round: current.round, nextWorkId: null, haltReason: current.haltReason,
    };
  }

  const outcome = input.phase === 'REVIEW'
    ? ((input.review?.blockingFindings ?? 0) === 0 ? 'PASSED' : 'FAILED')
    : 'PASSED';

  await deps.store.settleRound({
    gauntletId: current.gauntletId, round: current.round, phase: input.phase, outcome,
    durationMs: input.usage.durationMs, usdMicros: input.usage.usdMicros,
    findingIds: input.review?.findingIds ?? [], completedAt: deps.clock.now(),
  });

  // The ceilings see the ROUND'S total — every phase that settled in it —
  // rather than only the last phase's, so a round whose review exhausted the
  // budget cannot continue because its repair was cheap.
  const settled = (await deps.store.roundsFor(current.gauntletId))
    .filter((record) => record.round === current.round && record.completedAt !== null);
  const roundDurationMs = settled.reduce((total, record) => total + (record.durationMs ?? 0), 0);
  const roundUsdMicros = settled.reduce((total, record) => total + (record.usdMicros ?? 0), 0);

  let next: GauntletCommandRecord;
  try {
    next = advance(current, {
      expectedVersion: current.version,
      action: input.phase === 'REPAIR' ? 'REPAIR_COMPLETE' : outcome === 'PASSED' ? 'VERIFY_PASS' : 'VERIFY_FAIL',
      durationMs: roundDurationMs, usdMicros: roundUsdMicros,
    });
  } catch (error) {
    return {
      advanced: false,
      reasonCode: error instanceof Error ? error.message : 'gauntlet_transition_refused',
      safeMessage: 'The gauntlet could not take that transition.',
    };
  }
  next = { ...next, activation: activationFor(next.state) };

  const saved = await deps.store.save(next, current.version);
  if (!saved) {
    const reloaded = await deps.store.load(input.runId, input.gauntletId);
    return {
      advanced: true, state: reloaded?.state ?? current.state,
      activation: reloaded?.activation ?? current.activation,
      round: reloaded?.round ?? current.round, nextWorkId: null,
      haltReason: reloaded?.haltReason ?? null,
    };
  }

  const nextWorkId = next.state === 'REPAIRING'
    ? await schedule(next, 'REPAIR', deps)
    : null;
  return {
    advanced: true, state: next.state, activation: next.activation,
    round: next.round, nextWorkId, haltReason: next.haltReason,
  };
}

/**
 * A COMPLETED REPAIR OPENS THE NEXT ROUND'S REVIEW.
 *
 * The machine moves REPAIRING → READY, and READY has no work of its own. This
 * is the one place a round begins after the first, so a round can never be
 * started from two directions.
 */
export async function openNextGauntletRound(
  input: { runId: string; gauntletId: string },
  deps: GauntletDependencies,
): Promise<GauntletAdvanceOutcome> {
  const current = await deps.store.load(input.runId, input.gauntletId);
  if (current === null) {
    return { advanced: false, reasonCode: 'GAUNTLET_NOT_FOUND', safeMessage: 'No gauntlet is active for this run.' };
  }
  if (current.activation !== 'ACTIVE' || current.state !== 'READY') {
    return {
      advanced: true, state: current.state, activation: current.activation,
      round: current.round, nextWorkId: null, haltReason: current.haltReason,
    };
  }
  const opened = advance(current, { expectedVersion: current.version, action: 'START', durationMs: 0, usdMicros: 0 });
  const next: GauntletCommandRecord = { ...opened, activation: activationFor(opened.state) };
  if (!(await deps.store.save(next, current.version))) {
    const reloaded = await deps.store.load(input.runId, input.gauntletId);
    return {
      advanced: true, state: reloaded?.state ?? current.state,
      activation: reloaded?.activation ?? current.activation,
      round: reloaded?.round ?? current.round, nextWorkId: null, haltReason: reloaded?.haltReason ?? null,
    };
  }
  if (next.state !== 'RUNNING') {
    return {
      advanced: true, state: next.state, activation: next.activation,
      round: next.round, nextWorkId: null, haltReason: next.haltReason,
    };
  }
  return {
    advanced: true, state: next.state, activation: next.activation, round: next.round,
    nextWorkId: await schedule(next, 'REVIEW', deps), haltReason: next.haltReason,
  };
}

/* ---------------------------------------------------------- cancellation */

/**
 * Stop an active gauntlet WITHOUT damaging the work it was reviewing.
 *
 * Only the gauntlet's own outstanding work is cancelled. The mission, the
 * task, the run and everything else the gauntlet was looking AT are untouched
 * — a person ending an intensified review has not asked to end the work.
 */
export async function cancelGauntlet(
  input: { runId: string; gauntletId: string; actor: string; reason: string },
  deps: GauntletDependencies,
): Promise<GauntletAdvanceOutcome> {
  const current = await deps.store.load(input.runId, input.gauntletId);
  if (current === null) {
    return { advanced: false, reasonCode: 'GAUNTLET_NOT_FOUND', safeMessage: 'No gauntlet is active for this run.' };
  }
  if (input.actor.trim() === '' || input.reason.trim() === '') {
    return {
      advanced: false, reasonCode: 'ACTOR_AND_REASON_REQUIRED',
      safeMessage: 'Cancelling a gauntlet records who asked and why. Neither may be blank.',
    };
  }
  if (current.activation !== 'ACTIVE') {
    return {
      advanced: true, state: current.state, activation: current.activation,
      round: current.round, nextWorkId: null, haltReason: current.haltReason,
    };
  }

  const cancelled = advance(current, { expectedVersion: current.version, action: 'CANCEL', durationMs: 0, usdMicros: 0 });
  const next: GauntletCommandRecord = { ...cancelled, activation: 'CANCELLED' };
  await deps.store.save(next, current.version);

  for (const round of await deps.store.roundsFor(current.gauntletId)) {
    if (round.completedAt !== null) continue;
    await deps.work.cancelWork(round.workId);
  }
  return {
    advanced: true, state: next.state, activation: 'CANCELLED',
    round: next.round, nextWorkId: null, haltReason: next.haltReason,
  };
}

/* -------------------------------------------------------------- reviewing */

/**
 * Run one review through the Independent Reviewer Harness.
 *
 * The harness is called exactly as a NORMAL review calls it — same port, same
 * shape. Repetition is the only thing the gauntlet adds, which is why a normal
 * review needs nothing from this module.
 */
export async function runGauntletReview(
  input: { runId: string; gauntletId: string },
  deps: GauntletDependencies,
): Promise<GauntletAdvanceOutcome> {
  const current = await deps.store.load(input.runId, input.gauntletId);
  if (current === null) {
    return { advanced: false, reasonCode: 'GAUNTLET_NOT_FOUND', safeMessage: 'No gauntlet is active for this run.' };
  }
  if (current.activation !== 'ACTIVE') {
    return {
      advanced: true, state: current.state, activation: current.activation,
      round: current.round, nextWorkId: null, haltReason: current.haltReason,
    };
  }
  const verdict = await deps.reviewer.review({
    reviewId: deps.ids.next('gauntlet-review'),
    subjectId: current.subjectId,
    round: current.round,
  });
  if (!verdict.completed) {
    return {
      advanced: false, reasonCode: 'REVIEW_DID_NOT_COMPLETE',
      safeMessage: 'The Independent Reviewer Harness did not return a verdict.',
    };
  }
  return advanceGauntletCommand({
    runId: input.runId, gauntletId: input.gauntletId, phase: 'REVIEW',
    usage: { durationMs: 0, usdMicros: 0 },
    review: { blockingFindings: verdict.blockingFindings, findingIds: verdict.findingIds },
  }, deps);
}

/* ------------------------------------------------------------- internals */

/** The activation a machine state implies. Total, so no state is silent. */
function activationFor(state: GauntletState): GauntletActivation {
  switch (state) {
    case 'CLEARED': return 'CLEARED';
    case 'HALTED': return 'HALTED';
    case 'CANCELLED': return 'CANCELLED';
    default: return 'ACTIVE';
  }
}

async function schedule(
  record: GauntletCommandRecord,
  phase: GauntletPhase,
  deps: GauntletDependencies,
): Promise<string> {
  const workId = gauntletWorkId(record.gauntletId, record.round, phase);
  await deps.work.requestWork({
    workId, subjectId: record.subjectId, kind: phase === 'REVIEW' ? 'REVIEW' : 'REPAIR',
    ordinal: record.round,
  });
  await deps.store.recordRound({
    gauntletId: record.gauntletId, round: record.round, phase, workId,
    outcome: null, durationMs: null, usdMicros: null, findingIds: [],
    startedAt: deps.clock.now(), completedAt: null,
  });
  return workId;
}

/** The machine mutates a clone; the command's own fields ride along. */
function advance(
  record: GauntletCommandRecord,
  input: Parameters<typeof advanceGauntlet>[1],
): GauntletCommandRecord {
  return {
    ...advanceGauntlet(record, input),
    projectId: record.projectId, subjectId: record.subjectId,
    activation: record.activation, activatedBy: record.activatedBy, activatedAt: record.activatedAt,
  };
}
