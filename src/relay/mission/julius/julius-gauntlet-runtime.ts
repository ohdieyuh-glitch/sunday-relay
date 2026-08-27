/**
 * /gauntletloop, AS A DURABLE RUNTIME RATHER THAN A STATE MACHINE.
 *
 * #172 built `advanceGauntlet`: a pure transition function over a mutable
 * `GauntletRun` object. Nothing persisted that object, so a round could not
 * survive a restart, two schedulers could both decide to start "round 2", and
 * a cleared gauntlet left no record of what cleared it. The state machine was
 * complete and the gauntlet was not.
 *
 * THE CANONICAL SHAPE, and how each part is reached:
 *
 *   PLAN      the caller's task graph — a gauntlet runs FOR an existing task
 *   EXECUTE   an ordinary task, claimed by the ordinary scheduler
 *   TEST      the evidence that task produces
 *   REVIEW    an ordinary INDEPENDENT_REVIEWER task, when policy requires one
 *   FIND      reviewer findings, through the ordinary findings table
 *   REPAIR    an ordinary repair task, planned by `planJuliusRepair`
 *   RETEST    the next round's EXECUTE phase
 *   VERIFY    `evaluateJuliusVerification`, unchanged
 *
 * Every phase is a row in `julius_tasks`. There is NO recursion and no loop in
 * this file: `advanceGauntletRound` handles exactly one settled phase and
 * schedules at most one successor, and the scheduler is what comes back for
 * it. A gauntlet that runs ten rounds does so across ten ticks, and a process
 * that dies between any two of them loses nothing.
 *
 * THE BOUNDS ARE #172'S. Round limit, retry limit, duration ceiling and spend
 * ceiling are all decided by `advanceGauntlet`, which this file calls. What is
 * added is the durable state it decides against and the real usage numbers it
 * decides with — the inherited caller passed usage in as arguments nobody
 * measured.
 */

import { advanceGauntlet, type GauntletLimits, type GauntletRun, type GauntletState } from './julius-bounded-runtime';
import { evaluateJuliusPolicy, type JuliusCardPolicy } from './julius-policy';
import type { JuliusTask } from './julius-runtime';
import type { JuliusClock, JuliusEventWriter, JuliusIdFactory, JuliusRunRow } from './julius-runtime-ports';
import { validateJuliusEvent, type JuliusOperationalEventType } from './julius-events';

/* -------------------------------------------------------------- records */

export const GAUNTLET_PHASES = ['EXECUTE', 'REVIEW', 'REPAIR'] as const;
export type GauntletPhase = (typeof GAUNTLET_PHASES)[number];

export interface JuliusGauntletRecord extends GauntletRun {
  readonly projectId: string;
}

export interface JuliusGauntletRoundRecord {
  readonly gauntletId: string;
  readonly round: number;
  readonly phase: GauntletPhase;
  readonly taskId: string;
  readonly outcome: 'PASSED' | 'FAILED' | 'HALTED' | 'CANCELLED' | null;
  readonly durationMs: number | null;
  readonly usdMicros: number | null;
  readonly evidenceIds: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string | null;
}

export interface JuliusGauntletStore {
  /** Idempotent by `(runId, taskId)`: a second /gauntletloop RESUMES. */
  createGauntlet(record: JuliusGauntletRecord): Promise<{ readonly created: boolean; readonly record: JuliusGauntletRecord }>;
  loadGauntlet(runId: string, gauntletId: string): Promise<JuliusGauntletRecord | null>;
  gauntletForTask(runId: string, taskId: string): Promise<JuliusGauntletRecord | null>;
  /** Compare-and-set on `version`, mirroring `advanceGauntlet`'s own guard. */
  saveGauntlet(record: JuliusGauntletRecord, expectedVersion: number): Promise<boolean>;
  /** Idempotent by `(gauntletId, round, phase)`. */
  recordRound(round: JuliusGauntletRoundRecord): Promise<{ readonly recorded: boolean; readonly duplicate: boolean }>;
  settleRound(input: {
    gauntletId: string; round: number; phase: GauntletPhase;
    outcome: NonNullable<JuliusGauntletRoundRecord['outcome']>;
    durationMs: number; usdMicros: number; evidenceIds: readonly string[]; completedAt: string;
  }): Promise<boolean>;
  roundsFor(gauntletId: string): Promise<readonly JuliusGauntletRoundRecord[]>;
}

/* ------------------------------------------------------------- outcomes */

export type JuliusGauntletStart =
  | { readonly started: true; readonly record: JuliusGauntletRecord; readonly roundTask: JuliusTask; readonly resumed: boolean }
  | { readonly started: false; readonly reasonCode: string; readonly safeMessage: string };

export type JuliusGauntletAdvance =
  | { readonly advanced: true; readonly state: GauntletState; readonly round: number; readonly nextTask: JuliusTask | null; readonly haltReason: string | null }
  | { readonly advanced: false; readonly reasonCode: string; readonly safeMessage: string };

export interface JuliusGauntletDependencies {
  readonly store: JuliusGauntletStore & {
    addTask(input: { commandId: string; runId: string; projectId: string; task: JuliusTask }): Promise<boolean>;
  };
  readonly clock: JuliusClock;
  /** Optional, and its absence is visible: no ledger, no events. */
  readonly events?: JuliusEventWriter;
  readonly ids?: JuliusIdFactory;
}

type GauntletEventType = Extract<JuliusOperationalEventType,
  'gauntlet.started' | 'gauntlet.round.started' | 'gauntlet.round.completed' | 'gauntlet.cleared' | 'gauntlet.halted'>;

async function emit(
  deps: JuliusGauntletDependencies,
  run: { runId: string; projectId: string },
  type: GauntletEventType,
  facts: Record<string, string | number | boolean | null>,
): Promise<void> {
  if (deps.events === undefined || deps.ids === undefined) return;
  const event = {
    eventId: deps.ids.next(`event:${type}`), runId: run.runId, projectId: run.projectId,
    type, taskId: typeof facts.taskId === 'string' ? facts.taskId : null, workerId: null,
    correlationId: String(facts.gauntletId ?? run.runId), causationId: null,
    occurredAt: deps.clock.now(), facts,
  } as const;
  validateJuliusEvent(event);
  await deps.events.appendEvent(event);
}

/* --------------------------------------------------------------- naming */

/**
 * DETERMINISTIC IDS ARE THE IDEMPOTENCY.
 *
 * A round's task id is a pure function of the gauntlet, the round and the
 * phase, so two schedulers that both decide to start round 2 compose the SAME
 * id and the second insert is a no-op — before the primary key on
 * `(gauntlet_id, round, phase)` even has to refuse it. Two guards for one
 * fact, on purpose: the id makes the mistake harmless and the key makes it
 * impossible.
 */
export const gauntletRoundTaskId = (gauntletId: string, round: number, phase: GauntletPhase): string =>
  `gauntlet:${gauntletId}:${round}:${phase.toLowerCase()}`;

const roundTask = (input: {
  run: JuliusRunRow; anchor: JuliusTask; gauntletId: string; round: number; phase: GauntletPhase;
}): JuliusTask => ({
  taskId: gauntletRoundTaskId(input.gauntletId, input.round, input.phase),
  missionId: input.run.missionId,
  parentTaskId: input.anchor.taskId,
  // NO DEPENDENCY EDGE between rounds. Round N+1 is only ever created after
  // round N settled, so an edge would encode an ordering the creation order
  // already guarantees — and a dangling edge to a round that was never created
  // would block the graph permanently.
  dependencyIds: [],
  requiredEvidenceTypes: input.phase === 'REVIEW' ? ['REVIEW_FINDING'] : input.anchor.requiredEvidenceTypes,
  taskType: input.phase === 'REVIEW'
    ? `review:${input.anchor.taskType}`
    : input.phase === 'REPAIR' ? `repair:${input.anchor.taskType}` : input.anchor.taskType,
  role: input.phase === 'REVIEW' ? 'INDEPENDENT_REVIEWER' : 'CODING_AGENT',
  ordinal: input.anchor.ordinal + input.round,
  state: 'RUNNABLE',
});

/* --------------------------------------------------------------- start */

export interface JuliusGauntletStartInput {
  readonly run: JuliusRunRow;
  readonly policy: JuliusCardPolicy;
  readonly gauntletId: string;
  readonly anchor: JuliusTask;
  readonly limits: GauntletLimits;
}

/**
 * Start a gauntlet, or resume the one already running for this task.
 *
 * `/gauntletloop` typed twice is an ordinary thing for a person to do. The
 * uniqueness on `(run_id, task_id)` makes the second one a resume rather than
 * a fork, and the caller is told which happened rather than being left to
 * guess from a silent success.
 */
export async function startJuliusGauntlet(
  input: JuliusGauntletStartInput,
  deps: JuliusGauntletDependencies,
): Promise<JuliusGauntletStart> {
  const existing = await deps.store.gauntletForTask(input.run.runId, input.anchor.taskId);
  if (existing !== null) {
    return {
      started: true, resumed: true, record: existing,
      roundTask: roundTask({
        run: input.run, anchor: input.anchor, gauntletId: existing.gauntletId,
        round: Math.max(existing.round, 1), phase: 'EXECUTE',
      }),
    };
  }

  const gate = evaluateJuliusPolicy(input.policy, { operation: 'CONTINUE_GAUNTLET', round: 0 });
  if (gate.effect === 'DENY') {
    return { started: false, reasonCode: gate.reasonCode, safeMessage: gate.safeRationale };
  }
  if (gate.effect === 'REQUIRE_APPROVAL') {
    return { started: false, reasonCode: 'GAUNTLET_APPROVAL_REQUIRED', safeMessage: gate.safeRationale };
  }

  // THE C.A.R.D. CEILING WINS OVER THE REQUEST. A caller may ask for fewer
  // rounds than policy allows and never more, so `/gauntletloop --rounds 50`
  // under a C.A.R.D. of 3 runs three — and the request is not refused for
  // asking, because asking is not a violation.
  const limits: GauntletLimits = {
    ...input.limits,
    maxRounds: Math.min(input.limits.maxRounds, input.policy.gauntlet.maxRounds),
  };
  if (limits.maxRounds < 1) {
    return { started: false, reasonCode: 'CARD_GAUNTLET_LIMIT', safeMessage: 'C.A.R.D. permits no gauntlet rounds.' };
  }

  const initial: JuliusGauntletRecord = {
    gauntletId: input.gauntletId, runId: input.run.runId, projectId: input.run.projectId,
    taskId: input.anchor.taskId, limits, state: 'READY', round: 0, retries: 0,
    usedDurationMs: 0, usedUsdMicros: 0, haltReason: null, version: 1,
  };
  const created = await deps.store.createGauntlet(initial);
  if (!created.created) {
    return {
      started: true, resumed: true, record: created.record,
      roundTask: roundTask({
        run: input.run, anchor: input.anchor, gauntletId: created.record.gauntletId,
        round: Math.max(created.record.round, 1), phase: 'EXECUTE',
      }),
    };
  }

  // START moves READY -> RUNNING and increments the round, using #172's rule.
  const started = advance(created.record, { expectedVersion: created.record.version, action: 'START', durationMs: 0, usdMicros: 0 });
  if (started.state === 'HALTED') {
    await deps.store.saveGauntlet(started, created.record.version);
    return { started: false, reasonCode: started.haltReason ?? 'gauntlet_halted', safeMessage: 'The gauntlet halted before its first round.' };
  }
  await deps.store.saveGauntlet(started, created.record.version);

  const task = roundTask({ run: input.run, anchor: input.anchor, gauntletId: started.gauntletId, round: started.round, phase: 'EXECUTE' });
  await deps.store.addTask({ commandId: `gauntlet:${started.gauntletId}:${started.round}:execute`, runId: input.run.runId, projectId: input.run.projectId, task });
  await deps.store.recordRound({
    gauntletId: started.gauntletId, round: started.round, phase: 'EXECUTE', taskId: task.taskId,
    outcome: null, durationMs: null, usdMicros: null, evidenceIds: [],
    startedAt: deps.clock.now(), completedAt: null,
  });
  await emit(deps, input.run, 'gauntlet.started', {
    gauntletId: started.gauntletId, taskId: input.anchor.taskId,
    maxRounds: started.limits.maxRounds, maxRetries: started.limits.maxRetries,
  });
  await emit(deps, input.run, 'gauntlet.round.started', {
    gauntletId: started.gauntletId, round: started.round, phase: 'EXECUTE', taskId: task.taskId,
  });
  return { started: true, resumed: false, record: started, roundTask: task };
}

/* ------------------------------------------------------------- advance */

export interface JuliusGauntletSettleInput {
  readonly run: JuliusRunRow;
  readonly policy: JuliusCardPolicy;
  readonly anchor: JuliusTask;
  readonly gauntletId: string;
  readonly phase: GauntletPhase;
  /** What the settled phase actually produced. */
  readonly outcome: 'PASSED' | 'FAILED' | 'CANCELLED';
  /** MEASURED, not estimated. `advanceGauntlet` halts on these ceilings, and
   *  feeding it a guess would halt a gauntlet for spend that never happened. */
  readonly durationMs: number;
  readonly usdMicros: number;
  readonly evidenceIds: readonly string[];
  /** True when policy requires an independent review of each round. */
  readonly reviewerRequired: boolean;
}

/**
 * Settle one phase and schedule at most one successor.
 *
 * This is the whole loop, and it is not a loop. Called once per settled phase
 * by whatever observed the settlement, it advances #172's state machine, saves
 * under a compare-and-set, and — if the new state calls for work — creates
 * exactly one task. The scheduler brings the runtime back.
 */
export async function advanceJuliusGauntletRound(
  input: JuliusGauntletSettleInput,
  deps: JuliusGauntletDependencies,
): Promise<JuliusGauntletAdvance> {
  const current = await deps.store.loadGauntlet(input.run.runId, input.gauntletId);
  if (current === null) {
    return { advanced: false, reasonCode: 'GAUNTLET_NOT_FOUND', safeMessage: 'No gauntlet is running for this run.' };
  }
  if (['CLEARED', 'HALTED', 'CANCELLED'].includes(current.state)) {
    // A late settlement for a finished gauntlet is absorbed, not an error: the
    // worker that produced it could not have known, and treating it as a
    // failure would turn an ordinary race into an alarm.
    return { advanced: true, state: current.state, round: current.round, nextTask: null, haltReason: current.haltReason };
  }

  await deps.store.settleRound({
    gauntletId: current.gauntletId, round: current.round, phase: input.phase,
    outcome: input.outcome === 'CANCELLED' ? 'CANCELLED' : input.outcome,
    durationMs: input.durationMs, usdMicros: input.usdMicros,
    evidenceIds: input.evidenceIds, completedAt: deps.clock.now(),
  });

  /* ------------------------------- a passing EXECUTE is not a verdict ---- */
  /**
   * When policy requires an independent review, a passing EXECUTE means the
   * REVIEWER runs — not that the round passed. Advancing here would clear a
   * gauntlet on the implementer's own word, which is the one thing an
   * independent review exists to prevent. So no transition is taken: the round
   * stays open, the reviewer is scheduled, and the verdict is the reviewer's.
   */
  if (input.phase === 'EXECUTE' && input.outcome === 'PASSED' && input.reviewerRequired) {
    const review = roundTask({
      run: input.run, anchor: input.anchor, gauntletId: current.gauntletId,
      round: current.round, phase: 'REVIEW',
    });
    await deps.store.addTask({
      commandId: `gauntlet:${current.gauntletId}:${current.round}:review`,
      runId: input.run.runId, projectId: input.run.projectId, task: review,
    });
    await deps.store.recordRound({
      gauntletId: current.gauntletId, round: current.round, phase: 'REVIEW', taskId: review.taskId,
      outcome: null, durationMs: null, usdMicros: null, evidenceIds: [],
      startedAt: deps.clock.now(), completedAt: null,
    });
    return { advanced: true, state: current.state, round: current.round, nextTask: review, haltReason: null };
  }

  /* ------------------------------------------- the round's real usage ---- */
  /**
   * `advanceGauntlet` enforces the duration and spend ceilings against the
   * usage it is handed, so it is handed the ROUND'S TOTAL — every phase that
   * has settled in this round — rather than only the last phase's. Passing one
   * phase would let a gauntlet whose execute leg exhausted the budget continue
   * because its review leg was cheap.
   */
  const settled = (await deps.store.roundsFor(current.gauntletId))
    .filter((record) => record.round === current.round && record.completedAt !== null);
  const roundDurationMs = settled.reduce((total, record) => total + (record.durationMs ?? 0), 0);
  const roundUsdMicros = settled.reduce((total, record) => total + (record.usdMicros ?? 0), 0);

  const action = actionFor(input);
  let next: JuliusGauntletRecord;
  try {
    next = advance(current, {
      expectedVersion: current.version, action,
      durationMs: roundDurationMs, usdMicros: roundUsdMicros,
    });
  } catch (error) {
    return {
      advanced: false,
      reasonCode: error instanceof Error ? error.message : 'gauntlet_transition_refused',
      safeMessage: 'The gauntlet could not take that transition.',
    };
  }

  const saved = await deps.store.saveGauntlet(next, current.version);
  if (!saved) {
    // Another writer advanced it first. Ordinary, and the durable record is
    // the authority — so report what is stored rather than what was computed.
    const reloaded = await deps.store.loadGauntlet(input.run.runId, input.gauntletId);
    return {
      advanced: true, state: reloaded?.state ?? current.state, round: reloaded?.round ?? current.round,
      nextTask: null, haltReason: reloaded?.haltReason ?? null,
    };
  }

  await emit(deps, input.run, 'gauntlet.round.completed', {
    gauntletId: next.gauntletId, round: current.round, phase: input.phase,
    outcome: input.outcome, state: next.state,
  });
  if (next.state === 'CLEARED') {
    await emit(deps, input.run, 'gauntlet.cleared', {
      gauntletId: next.gauntletId, rounds: next.round, retries: next.retries,
      usedUsdMicros: next.usedUsdMicros, usedDurationMs: next.usedDurationMs,
    });
  }
  if (next.state === 'HALTED') {
    await emit(deps, input.run, 'gauntlet.halted', {
      gauntletId: next.gauntletId, rounds: next.round, haltReason: next.haltReason,
    });
  }

  const successor = await scheduleSuccessor(input, next, deps);
  return { advanced: true, state: next.state, round: next.round, nextTask: successor, haltReason: next.haltReason };
}

/**
 * WHICH TRANSITION A SETTLED PHASE MEANS.
 *
 * Only three of the state machine's five actions are ever produced here.
 * START belongs to `startJuliusGauntlet` and `openNextGauntletRound`, which
 * are the two places a round BEGINS; the settle path only ever ends one.
 */
function actionFor(input: JuliusGauntletSettleInput): Parameters<typeof advanceGauntlet>[1]['action'] {
  if (input.outcome === 'CANCELLED') return 'CANCEL';
  if (input.phase === 'REPAIR') return 'REPAIR_COMPLETE';
  return input.outcome === 'PASSED' ? 'VERIFY_PASS' : 'VERIFY_FAIL';
}

async function scheduleSuccessor(
  input: JuliusGauntletSettleInput,
  next: JuliusGauntletRecord,
  deps: JuliusGauntletDependencies,
): Promise<JuliusTask | null> {
  // A settle only ever ends a round, so the one state that still has work is
  // REPAIRING. CLEARED, HALTED and CANCELLED are terminal, and READY's next
  // EXECUTE is opened by `openNextGauntletRound` — the one place a round
  // begins, so a round can never be started from two directions.
  if (next.state !== 'REPAIRING') return null;
  const phase: GauntletPhase = 'REPAIR';

  const task = roundTask({
    run: input.run, anchor: input.anchor, gauntletId: next.gauntletId, round: next.round, phase,
  });
  await deps.store.addTask({
    commandId: `gauntlet:${next.gauntletId}:${next.round}:${phase.toLowerCase()}`,
    runId: input.run.runId, projectId: input.run.projectId, task,
  });
  await deps.store.recordRound({
    gauntletId: next.gauntletId, round: next.round, phase, taskId: task.taskId,
    outcome: null, durationMs: null, usdMicros: null, evidenceIds: [],
    startedAt: deps.clock.now(), completedAt: null,
  });
  return task;
}

/**
 * A REPAIR THAT COMPLETES OPENS THE NEXT ROUND.
 *
 * `advanceGauntlet` moves REPAIRING → READY on REPAIR_COMPLETE, and READY has
 * no work of its own. The next EXECUTE only exists once START runs again, so
 * this drives that step rather than leaving a gauntlet parked in READY with
 * nothing scheduled — which is what a naive wiring produces and what makes a
 * gauntlet look "stuck" while every component reports healthy.
 */
export async function openNextGauntletRound(
  input: { run: JuliusRunRow; anchor: JuliusTask; gauntletId: string },
  deps: JuliusGauntletDependencies,
): Promise<JuliusGauntletAdvance> {
  const current = await deps.store.loadGauntlet(input.run.runId, input.gauntletId);
  if (current === null) {
    return { advanced: false, reasonCode: 'GAUNTLET_NOT_FOUND', safeMessage: 'No gauntlet is running for this run.' };
  }
  if (current.state !== 'READY') {
    return { advanced: true, state: current.state, round: current.round, nextTask: null, haltReason: current.haltReason };
  }
  const next = advance(current, { expectedVersion: current.version, action: 'START', durationMs: 0, usdMicros: 0 });
  const saved = await deps.store.saveGauntlet(next, current.version);
  if (!saved) {
    const reloaded = await deps.store.loadGauntlet(input.run.runId, input.gauntletId);
    return { advanced: true, state: reloaded?.state ?? current.state, round: reloaded?.round ?? current.round, nextTask: null, haltReason: reloaded?.haltReason ?? null };
  }
  if (next.state !== 'RUNNING') {
    return { advanced: true, state: next.state, round: next.round, nextTask: null, haltReason: next.haltReason };
  }
  const task = roundTask({ run: input.run, anchor: input.anchor, gauntletId: next.gauntletId, round: next.round, phase: 'EXECUTE' });
  await deps.store.addTask({ commandId: `gauntlet:${next.gauntletId}:${next.round}:execute`, runId: input.run.runId, projectId: input.run.projectId, task });
  await deps.store.recordRound({
    gauntletId: next.gauntletId, round: next.round, phase: 'EXECUTE', taskId: task.taskId,
    outcome: null, durationMs: null, usdMicros: null, evidenceIds: [],
    startedAt: deps.clock.now(), completedAt: null,
  });
  await emit(deps, input.run, 'gauntlet.round.started', {
    gauntletId: next.gauntletId, round: next.round, phase: 'EXECUTE', taskId: task.taskId,
  });
  return { advanced: true, state: next.state, round: next.round, nextTask: task, haltReason: next.haltReason };
}

/** `advanceGauntlet` mutates a clone; the projectId rides along untouched. */
function advance(
  record: JuliusGauntletRecord,
  input: Parameters<typeof advanceGauntlet>[1],
): JuliusGauntletRecord {
  return { ...advanceGauntlet(record, input), projectId: record.projectId };
}
