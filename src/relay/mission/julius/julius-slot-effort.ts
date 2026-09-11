/**
 * PER-SLOT MISSION EFFORT — the telemetry that answers whether three peer
 * intelligence slots actually worked at comparable intensity, or whether two of
 * them were merely invoked.
 *
 * Paid Mission 5 could say that all three roles ran. It could not say what any
 * of them DID relative to the others, and the one number it did carry — money —
 * said the coder spent $5.177120 while the architect and the reviewer settled
 * UNKNOWN. A mission whose only comparable measure is cost will always report
 * the slot that reports cost as the one doing the work.
 *
 * EFFORT IS NOT ONE NUMBER, so this does not invent one and call it truth. Each
 * component is carried separately and each may be UNKNOWN, because that is what
 * the providers actually report: the hosted coder reports cost and tokens, the
 * architect reports tokens and no cost, the local reviewer reports tokens,
 * runtime and no cost. A component nobody measured is `null` and stays null
 * through every total — it is never zero, and a slot is never called shallow
 * because its provider is quiet.
 *
 * THE RATIO IS A DIAGNOSTIC, NOT A QUOTA. The founder's healthy band is
 * 0.8x-1.2x of the coder on complex missions "when the work justifies it", and
 * an explicit instruction that this must never cause synthetic work. So nothing
 * here gates a dispatch, nothing here is enforced, and the verdict for a slot
 * that legitimately needed less is not a failure. It is a number to look at
 * after a paid run, next to what the mission actually required.
 *
 * Pure: no I/O, no clock.
 */

import type { JuliusWorkerRole } from './julius-runtime';

export const JULIUS_SLOT_EFFORT_VERSION = 'julius-slot-effort.v1' as const;

/**
 * One dispatch's observable effort, exactly as the diagnostics carry it.
 *
 * EVERY DIMENSION IS SEPARATE AND EVERY ONE IS AUTHORITATIVE. The single
 * `effectiveEffort` figure below is a DERIVED reading for one diagnostic
 * question; it is not what a reader should reason from about what a worker did.
 * A slot that made three research calls, read eleven evidence artifacts and
 * answered two checkpoints did work that no token count describes, and
 * collapsing that into one number would hide precisely the thing the paid proof
 * needs to answer.
 *
 * `null` MEANS NOBODY MEASURED IT. Not zero. A provider that reports no
 * reasoning tokens has not told us it used none.
 */
export interface JuliusSlotEffortObservation {
  readonly role: JuliusWorkerRole;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly activeMs: number | null;
  /** Calls made to the provider for this one dispatch, corrections included. */
  readonly providerCalls: number | null;
  readonly toolCalls: number | null;
  /** Governed research requests this dispatch made. */
  readonly researchCalls: number | null;
  /** Project Brain entries compiled into this dispatch's packet, where countable. */
  readonly brainRetrievals: number | null;
  readonly costUsdMicros: number | null;
  /** What Julius reserved for this dispatch. */
  readonly allocatedUsdMicros: number | null;
  /** What settled, and on whose authority. `null` amount with a basis of UNKNOWN. */
  readonly settledUsdMicros: number | null;
  readonly settlementBasis: string | null;
  /** Checkpoints this dispatch took part in — asked, answered or judged. */
  readonly checkpoints: number | null;
  /** Guidance packets this dispatch WROTE. */
  readonly guidanceGenerated: number | null;
  /** Guidance packets this dispatch READ. */
  readonly guidanceConsumed: number | null;
  /** Verdicts a reviewer recorded. Zero for the other two slots. */
  readonly reviewerVerdicts: number | null;
  /** Repair rounds entered, or challenges raised. */
  readonly challenges: number | null;
  /** Repair-shaped dispatches this slot performed. */
  readonly repairRounds: number | null;
  /** Evidence this dispatch PRODUCED. */
  readonly evidenceGenerated: number | null;
  /** Evidence this dispatch was SHOWN. */
  readonly evidenceInspected: number | null;
  readonly retries: number | null;
}

/** A total that knows the difference between zero and unmeasured. */
export interface JuliusMeasuredTotal {
  readonly total: number;
  /** Dispatches that reported this component. */
  readonly measured: number;
  /** Dispatches that did not. `total` says nothing about these. */
  readonly unknown: number;
}

export interface JuliusSlotEffort {
  readonly slot: JuliusWorkerRole;
  readonly dispatches: number;
  readonly inputTokens: JuliusMeasuredTotal;
  readonly outputTokens: JuliusMeasuredTotal;
  readonly reasoningTokens: JuliusMeasuredTotal;
  readonly activeMs: JuliusMeasuredTotal;
  readonly providerCalls: JuliusMeasuredTotal;
  readonly toolCalls: JuliusMeasuredTotal;
  readonly researchCalls: JuliusMeasuredTotal;
  readonly brainRetrievals: JuliusMeasuredTotal;
  readonly costUsdMicros: JuliusMeasuredTotal;
  readonly allocatedUsdMicros: JuliusMeasuredTotal;
  readonly settledUsdMicros: JuliusMeasuredTotal;
  /** How many dispatches settled on each basis. An UNKNOWN count is a finding. */
  readonly settlementBases: Readonly<Record<string, number>>;
  /**
   * PARTICIPATION, MEASURED THE SAME WAY MONEY IS.
   *
   * These were plain counters, which made "nobody recorded it" and "it did not
   * happen" the same number — the exact confusion this module exists to end,
   * one axis over. A slot whose guidance consumption is not instrumented must
   * not read as a slot that consumed no guidance.
   */
  readonly checkpoints: JuliusMeasuredTotal;
  readonly guidanceGenerated: JuliusMeasuredTotal;
  readonly guidanceConsumed: JuliusMeasuredTotal;
  readonly reviewerVerdicts: JuliusMeasuredTotal;
  readonly challenges: JuliusMeasuredTotal;
  readonly repairRounds: JuliusMeasuredTotal;
  readonly evidenceGenerated: JuliusMeasuredTotal;
  readonly evidenceInspected: JuliusMeasuredTotal;
  readonly retries: JuliusMeasuredTotal;
  /**
   * A single comparable figure, built ONLY from components this slot actually
   * reported. Tokens dominate because they are the one thing every provider
   * reports; tool and research calls count because a worker that reads the
   * repository ten times did work its token count understates.
   *
   * Null when the slot reported no token counts at all — in which case the
   * honest answer about its intensity is that nobody measured it.
   */
  readonly effectiveEffort: number | null;
}

/**
 * WHAT THE RATIO OBSERVES — and it observes, it does not judge.
 *
 * These are deliberately not GOOD and BAD. The band is a DIAGNOSTIC target and
 * nothing reads these verdicts to gate a mission, so a state that sounded like
 * a grade would invite exactly the behaviour the founder forbade: extra model
 * calls, manufactured research, or reasoning extended to burn tokens.
 *
 * `ABOVE_OBSERVED_RANGE` exists because calling it PEER would hide it and
 * calling it a fault would be wrong. A worker above 1.2x is not inefficient; it
 * is a worker the mission asked more of, and whether that is right is a
 * question for whoever reads the raw dimensions beside it.
 *
 * `BELOW_OBSERVED_RANGE` says what was measured, not that the worker
 * underperformed. A slot that finished legitimate work efficiently lands here
 * too, and the raw dimensions are what tell the two apart.
 */
export type JuliusEffortVerdict =
  | 'PEER'
  | 'ABOVE_OBSERVED_RANGE'
  | 'BELOW_OBSERVED_RANGE'
  /** Not enough was measured to say. Never reported as healthy. */
  | 'INDETERMINATE';

export interface JuliusSlotEffortReport {
  readonly version: typeof JULIUS_SLOT_EFFORT_VERSION;
  readonly bySlot: Readonly<Record<string, JuliusSlotEffort>>;
  /** effectiveEffort(slot) / effectiveEffort(CODING_AGENT), null when unmeasurable. */
  readonly ratioToCoder: Readonly<Record<string, number | null>>;
  readonly verdict: Readonly<Record<string, JuliusEffortVerdict>>;
}

/** The founder's initial diagnostic target. Not a gate and not enforced. */
export const JULIUS_EFFORT_BAND = Object.freeze({ min: 0.8, max: 1.2 });

const EMPTY: JuliusMeasuredTotal = Object.freeze({ total: 0, measured: 0, unknown: 0 });

const add = (acc: JuliusMeasuredTotal, value: number | null): JuliusMeasuredTotal =>
  value === null || !Number.isFinite(value)
    ? { total: acc.total, measured: acc.measured, unknown: acc.unknown + 1 }
    : { total: acc.total + value, measured: acc.measured + 1, unknown: acc.unknown };

/**
 * Weights chosen so one tool call counts like a few hundred tokens of work and
 * one research operation like rather more — a worker that fetched and judged a
 * specification did something a token count alone understates. They are a
 * DIAGNOSTIC scale, not an accounting one, and they are here rather than spread
 * through the caller so a change to them is one reviewable line.
 */
const WEIGHTS = Object.freeze({ inputToken: 1, outputToken: 3, reasoningToken: 3, toolCall: 400, researchCall: 1_200 });

function effectiveEffortOf(slot: Omit<JuliusSlotEffort, 'effectiveEffort'>): number | null {
  const tokensMeasured = slot.inputTokens.measured + slot.outputTokens.measured + slot.reasoningTokens.measured;
  if (tokensMeasured === 0) return null;
  return slot.inputTokens.total * WEIGHTS.inputToken
    + slot.outputTokens.total * WEIGHTS.outputToken
    + slot.reasoningTokens.total * WEIGHTS.reasoningToken
    + slot.toolCalls.total * WEIGHTS.toolCall
    + slot.researchCalls.total * WEIGHTS.researchCall;
}

/**
 * READ AN OBSERVATION OUT OF A LEDGER ROW.
 *
 * One mapping, used by the pipeline that WRITES `worker.effort` and by whoever
 * later summarises it. Two copies of this would drift, and the drift would be
 * invisible: a field the writer names `toolCalls` and the reader looks for as
 * `tool_calls` produces a report that is confidently wrong rather than absent.
 *
 * ABSENT IS NULL, NEVER ZERO. `measured` and `unknown` exist precisely so a
 * slot that reported nothing is not indistinguishable from one that did nothing.
 */
export function juliusSlotEffortObservation(
  facts: Readonly<Record<string, unknown>>,
): JuliusSlotEffortObservation | null {
  const role = facts.role;
  if (typeof role !== 'string') return null;
  const nullable = (key: string): number | null => {
    const value = facts[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const basis = facts.settlementBasis;
  return {
    role: role as JuliusWorkerRole,
    inputTokens: nullable('inputTokens'),
    outputTokens: nullable('outputTokens'),
    reasoningTokens: nullable('reasoningTokens'),
    activeMs: nullable('activeMs'),
    providerCalls: nullable('providerCalls'),
    toolCalls: nullable('toolCalls'),
    researchCalls: nullable('researchCalls'),
    brainRetrievals: nullable('brainRetrievals'),
    costUsdMicros: nullable('usdMicros'),
    allocatedUsdMicros: nullable('allocatedUsdMicros'),
    settledUsdMicros: nullable('settledUsdMicros'),
    settlementBasis: typeof basis === 'string' && basis.length > 0 ? basis : null,
    checkpoints: nullable('checkpoints'),
    guidanceGenerated: nullable('guidanceGenerated'),
    guidanceConsumed: nullable('guidanceConsumed'),
    reviewerVerdicts: nullable('reviewerVerdicts'),
    challenges: nullable('challenges'),
    repairRounds: nullable('repairRounds'),
    evidenceGenerated: nullable('evidenceGenerated'),
    evidenceInspected: nullable('evidenceInspected'),
    retries: nullable('retries'),
  };
}

export function summarizeJuliusSlotEffort(
  observations: readonly JuliusSlotEffortObservation[],
): JuliusSlotEffortReport {
  const slots = new Map<string, Omit<JuliusSlotEffort, 'effectiveEffort'>>();
  for (const observation of observations) {
    const current = slots.get(observation.role) ?? {
      slot: observation.role, dispatches: 0,
      inputTokens: EMPTY, outputTokens: EMPTY, reasoningTokens: EMPTY, activeMs: EMPTY,
      providerCalls: EMPTY, toolCalls: EMPTY, researchCalls: EMPTY, brainRetrievals: EMPTY,
      costUsdMicros: EMPTY, allocatedUsdMicros: EMPTY, settledUsdMicros: EMPTY,
      settlementBases: {} as Readonly<Record<string, number>>,
      checkpoints: EMPTY, guidanceGenerated: EMPTY, guidanceConsumed: EMPTY, reviewerVerdicts: EMPTY,
      challenges: EMPTY, repairRounds: EMPTY, evidenceGenerated: EMPTY, evidenceInspected: EMPTY,
      retries: EMPTY,
    };
    const bases: Record<string, number> = { ...current.settlementBases };
    // A dispatch whose settlement basis nobody recorded is counted as UNKNOWN
    // rather than skipped: a bundle that silently omitted it would report a
    // mission whose costs were better understood than they were.
    const basisKey = observation.settlementBasis ?? 'UNKNOWN';
    bases[basisKey] = (bases[basisKey] ?? 0) + 1;
    slots.set(observation.role, {
      slot: observation.role,
      dispatches: current.dispatches + 1,
      inputTokens: add(current.inputTokens, observation.inputTokens),
      outputTokens: add(current.outputTokens, observation.outputTokens),
      reasoningTokens: add(current.reasoningTokens, observation.reasoningTokens),
      activeMs: add(current.activeMs, observation.activeMs),
      providerCalls: add(current.providerCalls, observation.providerCalls),
      toolCalls: add(current.toolCalls, observation.toolCalls),
      researchCalls: add(current.researchCalls, observation.researchCalls),
      brainRetrievals: add(current.brainRetrievals, observation.brainRetrievals),
      costUsdMicros: add(current.costUsdMicros, observation.costUsdMicros),
      allocatedUsdMicros: add(current.allocatedUsdMicros, observation.allocatedUsdMicros),
      settledUsdMicros: add(current.settledUsdMicros, observation.settledUsdMicros),
      settlementBases: bases,
      checkpoints: add(current.checkpoints, observation.checkpoints),
      guidanceGenerated: add(current.guidanceGenerated, observation.guidanceGenerated),
      guidanceConsumed: add(current.guidanceConsumed, observation.guidanceConsumed),
      reviewerVerdicts: add(current.reviewerVerdicts, observation.reviewerVerdicts),
      challenges: add(current.challenges, observation.challenges),
      repairRounds: add(current.repairRounds, observation.repairRounds),
      evidenceGenerated: add(current.evidenceGenerated, observation.evidenceGenerated),
      evidenceInspected: add(current.evidenceInspected, observation.evidenceInspected),
      retries: add(current.retries, observation.retries),
    });
  }

  const bySlot: Record<string, JuliusSlotEffort> = {};
  for (const [role, partial] of slots) {
    bySlot[role] = Object.freeze({ ...partial, effectiveEffort: effectiveEffortOf(partial) });
  }

  const coder = bySlot.CODING_AGENT?.effectiveEffort ?? null;
  const ratioToCoder: Record<string, number | null> = {};
  const verdict: Record<string, JuliusEffortVerdict> = {};
  for (const [role, slot] of Object.entries(bySlot)) {
    // UNKNOWN IS NOT A RATIO. A slot nobody measured, or a coder nobody
    // measured, leaves this null rather than producing a confident number from
    // a missing one.
    const ratio = coder === null || coder === 0 || slot.effectiveEffort === null
      ? null
      : slot.effectiveEffort / coder;
    ratioToCoder[role] = ratio;
    verdict[role] = role === 'CODING_AGENT'
      ? 'PEER'
      : ratio === null
        ? 'INDETERMINATE'
        : ratio < JULIUS_EFFORT_BAND.min
          ? 'BELOW_OBSERVED_RANGE'
          // ABOVE IS NOT A FAULT. A worker the mission asked more of lands here,
          // and nothing reads this to penalise it — the raw dimensions beside
          // it are what say whether the extra work was warranted.
          : ratio > JULIUS_EFFORT_BAND.max ? 'ABOVE_OBSERVED_RANGE' : 'PEER';
  }

  return Object.freeze({
    version: JULIUS_SLOT_EFFORT_VERSION,
    bySlot: Object.freeze(bySlot),
    ratioToCoder: Object.freeze(ratioToCoder),
    verdict: Object.freeze(verdict),
  });
}
