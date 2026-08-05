/**
 * SUNDAY RELAY — PROJECT BRAIN LLMOPS
 * Operations projection (PURE, deterministic, browser-safe).
 *
 * Turns a `RelayOperationalRecord` into the one view the website panel and the
 * CLI screen both render. Both surfaces call THIS function; neither computes a
 * figure of its own, which is what keeps `relay project operations` and the
 * workspace panel from disagreeing about the same run.
 *
 * The projection never invents a number. Every FIGURE that could be unknown is
 * a `RelayFigure` carrying its reason — a surface showing "—" should be able to
 * say WHY, and one that cannot say why is showing a guess.
 *
 * Wait TOTALS are the deliberate exception and are plain numbers. An interval
 * that happened but could not be measured contributes zero milliseconds and
 * still counts as an interval, because dropping it would under-report how often
 * the run blocked. So a wait total is a floor, not an estimate, and
 * `intervals` beside it is what tells a reader the difference.
 */

import type { RelaySpendCitation } from './spend-citation';
import {
  WAITING_ON_USER_REASONS,
  isIndependentEvaluation,
  type RelayErrorKind,
  type RelayLatencyPhase,
  type RelayOperationalRecord,
  type RelayWaitReason,
} from './llmops-contracts';

/* --------------------------------------------------------------- unknown */

export const RELAY_UNKNOWN_REASONS = [
  'not_observed',
  'insufficient_samples',
  'unknown_denominator',
  'stale',
  'unreadable',
] as const;
export type RelayUnknownReason = (typeof RELAY_UNKNOWN_REASONS)[number];

/**
 * A figure that is either known or explicitly not, carrying the reason. This
 * is the type that stops `null` from being rendered as `0` three layers later:
 * there is no numeric field to read without first checking `known`.
 */
export type RelayFigure =
  | { readonly known: true; readonly value: number }
  | { readonly known: false; readonly reason: RelayUnknownReason };

export const unknownFigure = (reason: RelayUnknownReason): RelayFigure => ({ known: false, reason });
export const knownFigure = (value: number): RelayFigure => ({ known: true, value });

/**
 * A p95 computed from three samples is the maximum of three samples wearing a
 * percentile's name. Below this many observations the projection refuses to
 * report a tail percentile at all rather than reporting a confident-looking
 * number that the next sample will move by 40%.
 */
export const MIN_SAMPLES_FOR_TAIL = 20;

/* ---------------------------------------------------------------- health */

export const RELAY_HEALTH_STATES = ['healthy', 'degraded', 'failing', 'unknown'] as const;
export type RelayHealthState = (typeof RELAY_HEALTH_STATES)[number];

/**
 * How old the newest signal may be before health becomes `unknown`.
 *
 * A SILENT SYSTEM IS NOT A HEALTHY ONE. The most common way a dashboard lies
 * is by showing the last good state forever after the thing feeding it stopped
 * reporting, so staleness produces `unknown` and not `healthy`.
 */
export const HEALTH_STALE_AFTER_MS = 15 * 60 * 1000;

/* ------------------------------------------------------------- the view */

export interface RelayLatencyPhaseView {
  readonly phase: RelayLatencyPhase;
  readonly samples: number;
  readonly p50Ms: RelayFigure;
  readonly p95Ms: RelayFigure;
  readonly maxMs: RelayFigure;
}

export interface RelayWaitView {
  readonly reason: RelayWaitReason;
  readonly totalMs: number;
  readonly intervals: number;
  readonly openIntervals: number;
}

export interface RelayErrorView {
  readonly kind: RelayErrorKind;
  readonly count: number;
  readonly recovered: number;
  readonly unrecovered: number;
}

export interface RelayEvaluationView {
  readonly total: number;
  readonly independent: number;
  readonly selfAssessed: number;
  readonly passed: number;
  readonly failed: number;
  readonly inconclusive: number;
  /** Share of evaluations that an independent judge performed. */
  readonly independentCoverage: RelayFigure;
}

export interface RelayRepairView {
  readonly loops: number;
  readonly converged: number;
  readonly limitReached: number;
  readonly abandoned: number;
  readonly inProgress: number;
  readonly totalCycles: number;
  /** Loops that ENDED without fixing the finding. Never folded into `loops`. */
  readonly endedUnfixed: number;
}

export interface RelayOperationsView {
  readonly projectId: string;
  /**
   * Tokens and money, as `../economics` recorded them. `null` means no
   * economics source is wired; it is never an empty total standing in for one.
   */
  readonly spend: RelaySpendCitation | null;
  /** ISO-8601 instant this view was projected for. */
  readonly asOf: string;
  readonly health: RelayHealthState;
  readonly healthReason: string;
  readonly latency: readonly RelayLatencyPhaseView[];
  /** Phases with no observation at all — named, so a surface can say which. */
  readonly missingPhases: readonly RelayLatencyPhase[];
  readonly waits: readonly RelayWaitView[];
  readonly waitingOnUserMs: number;
  readonly waitingOnUserOpen: boolean;
  readonly errors: readonly RelayErrorView[];
  readonly errorCount: number;
  readonly unrecoveredErrorCount: number;
  readonly errorRate: RelayFigure;
  readonly evaluations: RelayEvaluationView;
  readonly repairs: RelayRepairView;
  readonly newestSignalAt: string | null;
  readonly signalAgeMs: RelayFigure;
}

/* ------------------------------------------------------------ projection */

export function projectOperations(
  record: RelayOperationalRecord,
  asOf: string,
): RelayOperationsView {
  const asOfMs = Date.parse(asOf);
  const asOfKnown = Number.isFinite(asOfMs);

  /* ---- latency, per phase, from observed samples only ---- */
  const byPhase = new Map<RelayLatencyPhase, number[]>();
  for (const sample of record.latency) {
    if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) continue;
    const list = byPhase.get(sample.phase);
    if (list) list.push(sample.durationMs);
    else byPhase.set(sample.phase, [sample.durationMs]);
  }

  const latency: RelayLatencyPhaseView[] = [];
  for (const [phase, values] of byPhase) {
    const sorted = [...values].sort((a, b) => a - b);
    latency.push({
      phase,
      samples: sorted.length,
      p50Ms: knownFigure(percentile(sorted, 0.5)),
      // The tail needs a population. Below the floor it is not reported.
      p95Ms: sorted.length >= MIN_SAMPLES_FOR_TAIL
        ? knownFigure(percentile(sorted, 0.95))
        : unknownFigure('insufficient_samples'),
      maxMs: knownFigure(sorted[sorted.length - 1]),
    });
  }
  latency.sort((a, b) => a.phase.localeCompare(b.phase));

  const missingPhases = (['queue', 'first_token', 'generation', 'tool_execution',
    'verification', 'total'] as const).filter((p) => !byPhase.has(p));

  /* ---- waiting, split by reason, open intervals measured to `asOf` ---- */
  const waitAcc = new Map<RelayWaitReason, { totalMs: number; intervals: number; open: number }>();
  for (const wait of record.waits) {
    const since = Date.parse(wait.since);
    const open = wait.until === null;
    const end = open ? asOfMs : Date.parse(wait.until);
    // An interval we cannot measure still HAPPENED — it counts as an interval
    // and contributes no milliseconds, rather than being dropped entirely.
    // Dropping it would under-report how often the run blocked, which is the
    // figure a person uses to decide whether to go and do something else.
    const measurable = Number.isFinite(since) && Number.isFinite(end)
      && (!open || asOfKnown) && end >= since;
    const entry = waitAcc.get(wait.reason) ?? { totalMs: 0, intervals: 0, open: 0 };
    entry.totalMs += measurable ? end - since : 0;
    entry.intervals += 1;
    entry.open += open ? 1 : 0;
    waitAcc.set(wait.reason, entry);
  }
  const waits: RelayWaitView[] = [...waitAcc]
    .map(([reason, v]) => ({ reason, totalMs: v.totalMs, intervals: v.intervals, openIntervals: v.open }))
    .sort((a, b) => a.reason.localeCompare(b.reason));

  const userWaits = waits.filter((w) => WAITING_ON_USER_REASONS.includes(w.reason));
  const waitingOnUserMs = userWaits.reduce((sum, w) => sum + w.totalMs, 0);
  const waitingOnUserOpen = userWaits.some((w) => w.openIntervals > 0);

  /* ---- errors ---- */
  const errorAcc = new Map<RelayErrorKind, { count: number; recovered: number }>();
  for (const error of record.errors) {
    const entry = errorAcc.get(error.kind) ?? { count: 0, recovered: 0 };
    entry.count += 1;
    entry.recovered += error.recovered ? 1 : 0;
    errorAcc.set(error.kind, entry);
  }
  const errors: RelayErrorView[] = [...errorAcc]
    .map(([kind, v]) => ({
      kind, count: v.count, recovered: v.recovered, unrecovered: v.count - v.recovered,
    }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));

  const errorCount = errors.reduce((sum, e) => sum + e.count, 0);
  const unrecoveredErrorCount = errors.reduce((sum, e) => sum + e.unrecovered, 0);

  // Rule 3: a rate with an unknown denominator is unknown, not zero and not one.
  const attempts = record.attempts.attempts;
  // The denominator must be a whole number of attempts and must be at least the
  // number of errors observed; anything else produces a rate above 100%, which
  // is not a rate but a sign the base is wrong.
  const errorRate: RelayFigure =
    attempts === null || !Number.isInteger(attempts) || attempts <= 0 || attempts < errorCount
      ? unknownFigure('unknown_denominator')
      : knownFigure(errorCount / attempts);

  /* ---- evaluations ---- */
  let independent = 0, passed = 0, failed = 0, inconclusive = 0;
  for (const evaluation of record.evaluations) {
    if (isIndependentEvaluation(evaluation)) independent += 1;
    if (evaluation.verdict === 'pass') passed += 1;
    else if (evaluation.verdict === 'fail') failed += 1;
    else if (evaluation.verdict === 'inconclusive') inconclusive += 1;
  }
  const totalEvaluations = record.evaluations.length;
  const evaluations: RelayEvaluationView = {
    total: totalEvaluations,
    independent,
    selfAssessed: totalEvaluations - independent,
    passed,
    failed,
    inconclusive,
    independentCoverage: totalEvaluations === 0
      ? unknownFigure('not_observed')
      : knownFigure(independent / totalEvaluations),
  };

  /* ---- repair loops ---- */
  let converged = 0, limitReached = 0, abandoned = 0, inProgress = 0, totalCycles = 0;
  for (const loop of record.repairLoops) {
    totalCycles += loop.cycles.length;
    if (loop.outcome === 'converged') converged += 1;
    else if (loop.outcome === 'limit_reached') limitReached += 1;
    else if (loop.outcome === 'abandoned') abandoned += 1;
    else inProgress += 1;
  }
  const repairs: RelayRepairView = {
    loops: record.repairLoops.length,
    converged, limitReached, abandoned, inProgress, totalCycles,
    // A loop that ran out of budget with the finding open produced an unfixed
    // defect and a bill. It is never counted as a completed repair.
    endedUnfixed: limitReached + abandoned,
  };

  /* ---- health, derived last, from everything above ---- */
  const newestMs = record.newestSignalAt === null ? Number.NaN : Date.parse(record.newestSignalAt);
  const ageKnown = Number.isFinite(newestMs) && asOfKnown;
  const fromTheFuture = ageKnown && newestMs > asOfMs;
  const ageMs = ageKnown ? Math.max(0, asOfMs - newestMs) : Number.NaN;
  const signalAgeMs: RelayFigure = ageKnown && !fromTheFuture
    ? knownFigure(ageMs)
    // `unreadable` when a timestamp exists and cannot be parsed: reporting that
    // as `stale` told the reader the wrong thing about why the figure is absent.
    : unknownFigure(record.newestSignalAt === null ? 'not_observed'
      : fromTheFuture ? 'not_observed' : 'unreadable');

  const { health, healthReason } = deriveHealth({
    hasSignal: record.newestSignalAt !== null,
    ageKnown, ageMs, unrecoveredErrorCount, errorCount,
    endedUnfixed: repairs.endedUnfixed,
    failedEvaluations: failed,
    fromTheFuture,
  });

  return {
    projectId: record.projectId,
    spend: record.spend,
    asOf,
    health,
    healthReason,
    latency,
    missingPhases,
    waits,
    waitingOnUserMs,
    waitingOnUserOpen,
    errors,
    errorCount,
    unrecoveredErrorCount,
    errorRate,
    evaluations,
    repairs,
    newestSignalAt: record.newestSignalAt,
    signalAgeMs,
  };
}

/* ---------------------------------------------------------------- health */

function deriveHealth(input: {
  hasSignal: boolean;
  ageKnown: boolean;
  ageMs: number;
  unrecoveredErrorCount: number;
  errorCount: number;
  endedUnfixed: number;
  failedEvaluations: number;
  fromTheFuture: boolean;
}): { health: RelayHealthState; healthReason: string } {
  // Nothing has reported. That is not health, and it is not ill health either.
  if (!input.hasSignal) {
    return { health: 'unknown', healthReason: 'No operational signal has been observed for this project.' };
  }
  if (!input.ageKnown) {
    return { health: 'unknown', healthReason: 'The newest signal carries a timestamp that could not be read.' };
  }
  // A signal dated in the future cannot be used to argue the system is alive:
  // `Math.max(0, …)` would report an age of zero forever, so a skewed clock
  // would pin health at `healthy` no matter how long the feed had been silent.
  if (input.fromTheFuture) {
    return {
      health: 'unknown',
      healthReason: 'The newest signal is dated in the future, so its age cannot be trusted.',
    };
  }
  if (input.ageMs > HEALTH_STALE_AFTER_MS) {
    const minutes = Math.floor(input.ageMs / 60000);
    return {
      health: 'unknown',
      healthReason: `The newest signal is ${minutes} minutes old. A silent system is not a healthy one.`,
    };
  }
  if (input.unrecoveredErrorCount > 0) {
    return {
      health: 'failing',
      healthReason: `${input.unrecoveredErrorCount} error(s) the run did not recover from.`,
    };
  }
  if (input.endedUnfixed > 0) {
    return {
      health: 'degraded',
      healthReason: `${input.endedUnfixed} repair loop(s) ended with the finding still open.`,
    };
  }
  if (input.failedEvaluations > 0) {
    return {
      health: 'degraded',
      healthReason: `${input.failedEvaluations} evaluation(s) returned a failing verdict.`,
    };
  }
  // Gated on the COUNT, not on the rate. Gating on the rate meant recovered
  // errors were invisible whenever the denominator was unknown — which is every
  // shipped invocation today, since nothing counts attempts yet.
  if (input.errorCount > 0) {
    return {
      health: 'degraded',
      healthReason: `${input.errorCount} error(s) occurred, and every one was recovered.`,
    };
  }
  return { health: 'healthy', healthReason: 'Recent signal, no unrecovered errors, no open repair loops.' };
}

/* ------------------------------------------------------------- utilities */

/** Nearest-rank percentile over an ascending array. Never called when empty. */
function percentile(sorted: readonly number[], fraction: number): number {
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}
