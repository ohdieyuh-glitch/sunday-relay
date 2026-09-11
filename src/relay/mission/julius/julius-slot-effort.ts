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

/** One dispatch's observable effort, exactly as the diagnostics carry it. */
export interface JuliusSlotEffortObservation {
  readonly role: JuliusWorkerRole;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly toolCalls: number | null;
  readonly researchCalls: number | null;
  readonly activeMs: number | null;
  readonly costUsdMicros: number | null;
  /** Checkpoints this dispatch took part in — asked, answered or judged. */
  readonly checkpoints: number;
  /** Repair rounds entered, or challenges raised. */
  readonly challenges: number;
  readonly evidenceCount: number;
  readonly retries: number;
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
  readonly toolCalls: JuliusMeasuredTotal;
  readonly researchCalls: JuliusMeasuredTotal;
  readonly activeMs: JuliusMeasuredTotal;
  readonly costUsdMicros: JuliusMeasuredTotal;
  readonly checkpoints: number;
  readonly challenges: number;
  readonly evidenceCount: number;
  readonly retries: number;
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

export type JuliusEffortVerdict =
  /** Both non-coder slots sit inside the band, or above it. */
  | 'PEER'
  /** A slot is below the band and the mission was complex enough to notice. */
  | 'SHALLOW'
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

export function summarizeJuliusSlotEffort(
  observations: readonly JuliusSlotEffortObservation[],
): JuliusSlotEffortReport {
  const slots = new Map<string, Omit<JuliusSlotEffort, 'effectiveEffort'>>();
  for (const observation of observations) {
    const current = slots.get(observation.role) ?? {
      slot: observation.role, dispatches: 0,
      inputTokens: EMPTY, outputTokens: EMPTY, reasoningTokens: EMPTY, toolCalls: EMPTY,
      researchCalls: EMPTY, activeMs: EMPTY, costUsdMicros: EMPTY,
      checkpoints: 0, challenges: 0, evidenceCount: 0, retries: 0,
    };
    slots.set(observation.role, {
      slot: observation.role,
      dispatches: current.dispatches + 1,
      inputTokens: add(current.inputTokens, observation.inputTokens),
      outputTokens: add(current.outputTokens, observation.outputTokens),
      reasoningTokens: add(current.reasoningTokens, observation.reasoningTokens),
      toolCalls: add(current.toolCalls, observation.toolCalls),
      researchCalls: add(current.researchCalls, observation.researchCalls),
      activeMs: add(current.activeMs, observation.activeMs),
      costUsdMicros: add(current.costUsdMicros, observation.costUsdMicros),
      checkpoints: current.checkpoints + observation.checkpoints,
      challenges: current.challenges + observation.challenges,
      evidenceCount: current.evidenceCount + observation.evidenceCount,
      retries: current.retries + observation.retries,
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
      : ratio === null ? 'INDETERMINATE' : ratio < JULIUS_EFFORT_BAND.min ? 'SHALLOW' : 'PEER';
  }

  return Object.freeze({
    version: JULIUS_SLOT_EFFORT_VERSION,
    bySlot: Object.freeze(bySlot),
    ratioToCoder: Object.freeze(ratioToCoder),
    verdict: Object.freeze(verdict),
  });
}
