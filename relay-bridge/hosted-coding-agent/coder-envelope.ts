import { JOB_BUDGET_MS } from '../reviewer-deadline';

/**
 * THE ONE PLACE THAT DECIDES HOW MUCH WORK A CODING AGENT MAY DO.
 *
 * Paid Mission 5 (run 34485676189) reached the Coding Agent with everything
 * upstream verified — architect accepted, plan independently reviewed, contract
 * LOCKED — and then died on capacity twice:
 *
 *   attempt 1  timed_out=true, 12 tool calls   -> aborted at ~363 s
 *   attempt 2  result_subtype=error_max_turns, num_turns=13, 16 tool calls
 *
 * It had already implemented the whole mission across all three real modules.
 * The envelope stopped it, not the work. $2.936176 bought a diff nobody could
 * verify.
 *
 * THREE NUMBERS, AND ONLY TWO OF THEM BOUND ANYTHING. `HostedLimits` declares
 * `maxTurns`, `maxRuntimeMs` and `maxCostCents`. `hosted-runner.ts` enforces
 * runtime (its abort timer) and cost (`maxBudgetUsd`), but the SDK's turn
 * ceiling comes from `HostedEnvelope.maxTurns`, and `compileHostedEnvelope` was
 * never handed the limits — it read `DEFAULT_HOSTED_LIMITS.maxTurns` directly.
 * So `HostedLimits.maxTurns` was decorative: a caller could raise it to forty
 * and the run would still stop at twelve. That is the third time this shape has
 * appeared (`JuliusWorker.timeoutMs`, the coder's declared 600000, this), and
 * it is why the fix is a canonical source rather than a bigger constant.
 *
 * WHAT THIS DOES NOT TOUCH. Cost. `maxCostCents` stays exactly what Julius
 * reserved for the dispatch, and a bigger turn or runtime allowance can never
 * raise it: the money is an INDEPENDENT hard bound, and it is what makes a
 * generous turn allowance safe rather than reckless.
 */

export const CODER_ENVELOPE_POLICY_VERSION = 'julius-coder-envelope.v1' as const;

/**
 * WHAT A CODING AGENT WAS ACTUALLY WATCHED DOING, with its run.
 *
 * `outcome` carries the honesty. `COMPLETED` is a measurement. The other two
 * are CENSORED: Relay or the SDK stopped the agent, so the work it still had to
 * do was never observed and cannot be recovered. A censored sample bounds from
 * BELOW and nothing more.
 */
export interface CoderRunObservation {
  readonly runId: string;
  readonly taskId: string;
  readonly turns: number | null;
  readonly toolCalls: number;
  readonly elapsedMs: number;
  readonly outcome: 'COMPLETED' | 'TURNS_EXHAUSTED' | 'RUNTIME_CUT_OFF';
  /** Micro-dollars the runtime reported, or null when it reported nothing. */
  readonly costUsdMicros: number | null;
}

/**
 * EVERY CODING AGENT DISPATCH THIS REPOSITORY HAS PAID FOR.
 *
 * Appended to, never edited. Each row's run and task id are in the durable
 * evidence bundle that produced it and can be read back.
 */
export const RECORDED_CODER_OBSERVATIONS: readonly CoderRunObservation[] = [
  // Paid Mission 4. Completed the whole mission in 11 turns of a 12-turn
  // ceiling: ONE turn of margin, which nobody could see until Mission 5 spent
  // it. A measurement.
  {
    runId: '34470535718', taskId: 'run:c8910d0afb5608e0ea68aa72:build',
    turns: 11, toolCalls: 10, elapsedMs: 134_000, outcome: 'COMPLETED', costUsdMicros: 1_390_954,
  },
  // Paid Mission 5 attempt 1. Relay's own abort timer fired at the 360000 ms
  // runtime ceiling, and its COST is UNKNOWN: the runtime reports what it
  // charged only in the terminal result message, which an aborted run never
  // reaches, so this row stays null and always will.
  //
  // Its token usage was a different matter, and this row is the reason that is
  // now past tense. Every assistant turn had reported its own usage the whole
  // time and Relay read none of it, so the record said the run reported
  // nothing when what it had was a parser that asked only the last message.
  // `HostedStreamUsage` now folds the turns as they arrive, and a run cut off
  // like this one carries a FLOOR — tokens, never dollars, never a cost basis.
  // This row keeps its null because the instrumentation postdates it; there is
  // no bundle to read the floor back out of.
  {
    runId: '34485676189', taskId: 'run:cecba99c779c967f128dd58c:build',
    turns: null, toolCalls: 12, elapsedMs: 363_000, outcome: 'RUNTIME_CUT_OFF', costUsdMicros: null,
  },
  // Paid Mission 5 attempt 2. Hit the SDK's turn ceiling: error_max_turns at 13
  // turns with 16 tool calls and implementation_present=false. The true turn
  // requirement is ABOVE 13 and was never observed.
  {
    runId: '34485676189', taskId: 'run:cecba99c779c967f128dd58c:build',
    turns: 13, toolCalls: 16, elapsedMs: 306_000, outcome: 'TURNS_EXHAUSTED', costUsdMicros: 2_936_176,
  },
  // Paid Mission 5, the rerun that COMPLETED. 21 turns and 20 tool calls, and
  // the build was accepted: the first measured answer to how many turns that
  // mission really needed, which attempt 2 could only bound from below. It was
  // never recorded here, so the envelope went on deriving 26 turns from 13 and
  // Mission 5's own success sat at 81% of it. The elapsed time is read off the
  // executor receipts that bracket the session — `build:base` at 21:18:26.74
  // and `build:diff` at 21:27:35.45 in the run's trajectory — so it slightly
  // OVERSTATES the session, which is the safe direction for a floor.
  {
    runId: '34529874100', taskId: 'run:cecba99c779c967f128dd58c:build',
    turns: 21, toolCalls: 20, elapsedMs: 548_710, outcome: 'COMPLETED', costUsdMicros: 5_177_120,
  },
];

/**
 * THE JOB IS THE CEILING FOR TIME, and the shares have to add up.
 *
 * `JOB_BUDGET_MS` is imported rather than restated — it is the reviewer
 * policy's, and there is one job. `julius-first-live-mission.yml` is pinned to
 * it by a test, and a second test proves the reviewer and coder shares fit
 * inside it with room for the architect, the image builds and the evidence dump.
 */
/**
 * 30 -> 45 minutes when Mission 5's completed 21-turn build was recorded: the
 * derived attempt grew to 1 186 316 ms and two attempts no longer fit 30.
 */
export const CODER_JOB_SHARE_MS = 45 * 60_000;
/** `CODER_WORKER.maxRetries` is 1, so a dispatch may burn two attempts. */
export const MAX_CODER_ATTEMPTS = 2;

/**
 * TURNS ARE BOUNDED ABSOLUTELY, NOT BY MONEY.
 *
 * A turn ceiling derived from spend would make the money the only stop, and one
 * run's cost per turn is not a law. This is a flat backstop against a
 * pathological loop that turns FASTER than it costs — many cheap turns that the
 * runtime clock would not catch quickly enough. At the pace Mission 5 attempt 2
 * actually ran, the clock binds first (see `observedMsPerTurn` below), so this
 * is a guard for the case observation has not shown us, which is exactly what a
 * hard bound is for.
 */
/**
 * 32 -> 64 for long-horizon missions. The founder's beta-readiness policy gives
 * the Coding Agent extended turns, and Mission 6 edits a 3 300-line pipeline plus
 * five other files. Still a backstop, never the operative number: the
 * observations derive the ceiling, and the clock binds before this does.
 */
export const CODER_TURN_HARD_CEILING = 64;

/**
 * A CENSORED TURN OBSERVATION EARNS MORE HEADROOM THAN A MEASURED ONE.
 *
 * Mission 5 told us the coder needed MORE than 13 turns and nothing about how
 * many more. Doubling is deliberate slack over a lower bound, and it is
 * affordable precisely because `maxCostCents` is untouched by it: turns cannot
 * spend money the reservation did not already allow.
 */
export const CODER_TURN_HEADROOM_RATIO = 1.0;
export const CODER_RUNTIME_HEADROOM_RATIO = 0.2;

export type CoderEnvelopeBasis = 'OBSERVED_COMPLETED' | 'OBSERVED_CENSORED';

export interface CoderEnvelope {
  readonly policyVersion: typeof CODER_ENVELOPE_POLICY_VERSION;
  readonly maxTurns: number;
  readonly maxRuntimeMs: number;
  /** Largest turn count ever observed, or null when none was recorded. */
  readonly observedTurnsHighWater: number | null;
  readonly observedTurnsCensored: boolean;
  readonly observedRuntimeHighWaterMs: number | null;
  readonly observedRuntimeCensored: boolean;
  readonly turnsFloor: number;
  readonly runtimeFloorMs: number;
  readonly turnsHardCeiling: number;
  readonly runtimeHardCeilingMs: number;
  readonly basis: CoderEnvelopeBasis;
  /**
   * ONE RUN'S PACE, reported because the two limits must not silently defeat
   * each other — a turn ceiling the clock can never reach is not a ceiling.
   * EVIDENCE, NOT A LAW: it is a single observation, it is never used to bound
   * spend, and it only ever RAISES the runtime floor.
   */
  readonly observedMsPerTurn: number | null;
  readonly worstCaseRuntimeSpendMs: number;
}

/**
 * Refused rather than clamped. Somebody has to decide whether to widen the job,
 * spend fewer attempts, or accept that a mission of this size is not affordable
 * here — and none of those is a default.
 */
export class CoderEnvelopeUnsatisfiable extends Error {
  readonly requiredMs: number;
  readonly hardCeilingMs: number;
  constructor(requiredMs: number, hardCeilingMs: number) {
    super(
      `coder_envelope_unsatisfiable: ${requiredMs} ms is required by the floor plus headroom `
      + `but the job allows at most ${hardCeilingMs} ms per attempt `
      + `(${CODER_JOB_SHARE_MS} ms of coder share / ${MAX_CODER_ATTEMPTS} attempts). `
      + `Widen CODER_JOB_SHARE_MS and JOB_BUDGET_MS together, or lower MAX_CODER_ATTEMPTS.`,
    );
    this.name = 'CoderEnvelopeUnsatisfiable';
    this.requiredMs = requiredMs;
    this.hardCeilingMs = hardCeilingMs;
  }
}

export const coderRuntimeHardCeilingMs = (): number =>
  Math.floor(CODER_JOB_SHARE_MS / MAX_CODER_ATTEMPTS);

/** DERIVE THE ENVELOPE. Pure, total, and a function of its inputs alone. */
export function resolveCoderEnvelope(input: {
  readonly observations?: readonly CoderRunObservation[];
  readonly turnHeadroomRatio?: number;
  readonly runtimeHeadroomRatio?: number;
} = {}): CoderEnvelope {
  const observations = input.observations ?? RECORDED_CODER_OBSERVATIONS;
  const turnHeadroom = input.turnHeadroomRatio ?? CODER_TURN_HEADROOM_RATIO;
  const runtimeHeadroom = input.runtimeHeadroomRatio ?? CODER_RUNTIME_HEADROOM_RATIO;
  for (const [name, value] of [['turn', turnHeadroom], ['runtime', runtimeHeadroom]] as const) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`invalid_${name}_headroom_ratio`);
  }

  let turnsBest: CoderRunObservation | null = null;
  let runtimeBest: CoderRunObservation | null = null;
  for (const observation of observations) {
    if (observation.turns !== null && (turnsBest === null || observation.turns > (turnsBest.turns ?? 0))) {
      turnsBest = observation;
    }
    if (runtimeBest === null || observation.elapsedMs > runtimeBest.elapsedMs) runtimeBest = observation;
  }

  const observedTurnsHighWater = turnsBest?.turns ?? null;
  const observedTurnsCensored = turnsBest !== null && turnsBest.outcome !== 'COMPLETED';
  const observedRuntimeHighWaterMs = runtimeBest?.elapsedMs ?? null;
  const observedRuntimeCensored = runtimeBest !== null && runtimeBest.outcome !== 'COMPLETED';

  // A single run's pace, used ONLY to keep the turn ceiling reachable within
  // the clock. Taken from the run that exhausted its turns, because that is the
  // one that tells us what a turn costs in seconds when the agent is working.
  const paceSource = observations.find((item) => item.outcome === 'TURNS_EXHAUSTED' && item.turns)
    ?? observations.find((item) => item.outcome === 'COMPLETED' && item.turns) ?? null;
  const observedMsPerTurn = paceSource && paceSource.turns
    ? Math.round(paceSource.elapsedMs / paceSource.turns)
    : null;

  const turnsFloor = observedTurnsHighWater ?? 0;
  const maxTurns = Math.min(Math.ceil(turnsFloor * (1 + turnHeadroom)), CODER_TURN_HARD_CEILING);

  // The runtime floor is the worse of what was observed and what the granted
  // turns would take at the observed pace. Without the second term a raised
  // turn ceiling would be silently unreachable — the same class of defect this
  // module exists to end.
  const paceImpliedMs = observedMsPerTurn === null ? 0 : maxTurns * observedMsPerTurn;
  const runtimeFloorMs = Math.max(observedRuntimeHighWaterMs ?? 0, paceImpliedMs);
  const maxRuntimeMs = Math.ceil(runtimeFloorMs * (1 + runtimeHeadroom));
  const runtimeHardCeilingMs = coderRuntimeHardCeilingMs();
  if (maxRuntimeMs > runtimeHardCeilingMs) throw new CoderEnvelopeUnsatisfiable(maxRuntimeMs, runtimeHardCeilingMs);

  return {
    policyVersion: CODER_ENVELOPE_POLICY_VERSION,
    maxTurns,
    maxRuntimeMs,
    observedTurnsHighWater,
    observedTurnsCensored,
    observedRuntimeHighWaterMs,
    observedRuntimeCensored,
    turnsFloor,
    runtimeFloorMs,
    turnsHardCeiling: CODER_TURN_HARD_CEILING,
    runtimeHardCeilingMs,
    basis: (observedTurnsCensored || observedRuntimeCensored) ? 'OBSERVED_CENSORED' : 'OBSERVED_COMPLETED',
    observedMsPerTurn,
    worstCaseRuntimeSpendMs: maxRuntimeMs * MAX_CODER_ATTEMPTS,
  };
}

/** The two operative numbers, for callers that want nothing else. */
export const coderMaxTurns = (): number => resolveCoderEnvelope().maxTurns;
export const coderMaxRuntimeMs = (): number => resolveCoderEnvelope().maxRuntimeMs;

/** Exported so a structural test can prove the shares fit the one job budget. */
export const JOB_BUDGET_MS_FOR_SHARES = JOB_BUDGET_MS;
