import { describe, expect, it } from 'vitest';

import {
  JULIUS_EFFORT_BAND, summarizeJuliusSlotEffort, type JuliusSlotEffortObservation,
} from './julius-slot-effort';

const obs = (over: Partial<JuliusSlotEffortObservation> & { role: JuliusSlotEffortObservation['role'] }): JuliusSlotEffortObservation => ({
  inputTokens: null, outputTokens: null, reasoningTokens: null, activeMs: null,
  providerCalls: null, toolCalls: null, researchCalls: null, brainRetrievals: null,
  costUsdMicros: null, allocatedUsdMicros: null, settledUsdMicros: null, settlementBasis: null,
  checkpoints: 0, guidanceGenerated: 0, guidanceConsumed: 0, reviewerVerdicts: 0,
  challenges: 0, repairRounds: 0, evidenceGenerated: 0, evidenceInspected: 0, retries: 0, ...over,
});

describe('per-slot effort separates what was measured from what was zero', () => {
  it('a component nobody reported is unknown, never zero', () => {
    const report = summarizeJuliusSlotEffort([
      obs({ role: 'PROMPT_ARCHITECT', inputTokens: 2_742, outputTokens: 4_915 }),
    ]);
    const architect = report.bySlot.PROMPT_ARCHITECT;
    expect(architect.inputTokens).toEqual({ total: 2_742, measured: 1, unknown: 0 });
    // The architect reports no cost at all. That is unknown, and a zero here
    // would say it worked for free.
    expect(architect.costUsdMicros).toEqual({ total: 0, measured: 0, unknown: 1 });
  });

  it('a slot that reported no tokens at all has no effective effort, and no ratio', () => {
    const report = summarizeJuliusSlotEffort([
      obs({ role: 'CODING_AGENT', inputTokens: 32, outputTokens: 48_499 }),
      obs({ role: 'INDEPENDENT_REVIEWER' }),
    ]);
    expect(report.bySlot.INDEPENDENT_REVIEWER.effectiveEffort).toBeNull();
    expect(report.ratioToCoder.INDEPENDENT_REVIEWER).toBeNull();
    expect(report.verdict.INDEPENDENT_REVIEWER, 'unmeasured is never reported as healthy').toBe('INDETERMINATE');
  });

  it('an unmeasured coder makes every ratio indeterminate rather than confident', () => {
    const report = summarizeJuliusSlotEffort([
      obs({ role: 'CODING_AGENT' }),
      obs({ role: 'PROMPT_ARCHITECT', inputTokens: 1_000, outputTokens: 1_000 }),
    ]);
    expect(report.ratioToCoder.PROMPT_ARCHITECT).toBeNull();
    expect(report.verdict.PROMPT_ARCHITECT).toBe('INDETERMINATE');
  });
});

describe('the report answers the question Mission 5 could not', () => {
  /**
   * MISSION 5's ACTUAL NUMBERS, from its own worker-diagnostics rows. The coder
   * ran one dispatch at 32 in / 48,499 out. The architect ran twice (2,742 +
   * 7,652 in, 4,915 + 7,106 out) and the reviewer four times (42,030 + 43,616 +
   * 46,077 in, 23,725 + 18,449 + 19,900 out, one dispatch producing nothing).
   *
   * The bundle could say all three ran. This says what they did.
   */
  const MISSION_5 = [
    obs({ role: 'CODING_AGENT', inputTokens: 32, outputTokens: 48_499, toolCalls: 20, costUsdMicros: 5_177_120, evidenceGenerated: 2 }),
    obs({ role: 'PROMPT_ARCHITECT', inputTokens: 2_742, outputTokens: 4_915, evidenceGenerated: 1 }),
    obs({ role: 'PROMPT_ARCHITECT', inputTokens: 7_652, outputTokens: 7_106, evidenceGenerated: 1 }),
    obs({ role: 'INDEPENDENT_REVIEWER', inputTokens: 42_030, outputTokens: 23_725, activeMs: 449_140, challenges: 3, evidenceGenerated: 3 }),
    obs({ role: 'INDEPENDENT_REVIEWER', inputTokens: 43_616, outputTokens: 18_449, activeMs: 213_323, evidenceGenerated: 1 }),
    obs({ role: 'INDEPENDENT_REVIEWER', activeMs: 94_160, retries: 1 }),
    obs({ role: 'INDEPENDENT_REVIEWER', inputTokens: 46_077, outputTokens: 19_900, activeMs: 208_407, evidenceGenerated: 1 }),
  ];

  it('detects the architect as the least-engaged slot, which money alone could not', () => {
    // MISSION 5 IS A CONTROL, NOT A FAILURE. It was valid under the
    // architecture it ran beneath: the architect planned once, the coder built,
    // the reviewer judged. What this proves is that the telemetry SEES that
    // historical shape — which is the evidence that continuous architect
    // participation is worth building, not a verdict on a mission that did what
    // it was designed to do.
    const report = summarizeJuliusSlotEffort(MISSION_5);
    // Money said the coder did everything: it is the only slot reporting cost.
    expect(report.bySlot.CODING_AGENT.costUsdMicros.measured).toBe(1);
    expect(report.bySlot.PROMPT_ARCHITECT.costUsdMicros.measured).toBe(0);
    expect(report.bySlot.INDEPENDENT_REVIEWER.costUsdMicros.measured).toBe(0);

    // Effort says something different, and more useful. The state names what
    // was OBSERVED — two short plans against a 48k-token build — and does not
    // call the worker deficient.
    expect(report.verdict.PROMPT_ARCHITECT).toBe('BELOW_OBSERVED_RANGE');
    expect(report.ratioToCoder.PROMPT_ARCHITECT!).toBeLessThan(JULIUS_EFFORT_BAND.min);
  });

  it('shows the reviewer was already at least peer-level, which money also could not', () => {
    const report = summarizeJuliusSlotEffort(MISSION_5);
    // At or above the band, never below it. Which side of 1.2x it lands on is
    // an artefact of how the weights price a reviewer's large context reads,
    // and is not the finding; the finding is that the reviewer was NOT the
    // shallow slot while the money record made it look like one.
    expect(report.verdict.INDEPENDENT_REVIEWER).not.toBe('BELOW_OBSERVED_RANGE');
    expect(report.verdict.INDEPENDENT_REVIEWER).not.toBe('INDETERMINATE');
    expect(report.ratioToCoder.INDEPENDENT_REVIEWER!).toBeGreaterThan(JULIUS_EFFORT_BAND.min);
  });

  it('counts participation the token stream does not carry', () => {
    const report = summarizeJuliusSlotEffort(MISSION_5);
    expect(report.bySlot.INDEPENDENT_REVIEWER.dispatches).toBe(4);
    // These four dispatches DID record their participation — three challenges
    // on one, none on the others — so all four are measured and a total of
    // three is a fact rather than a floor.
    expect(report.bySlot.INDEPENDENT_REVIEWER.challenges)
      .toEqual({ total: 3, measured: 4, unknown: 0 });
    expect(report.bySlot.INDEPENDENT_REVIEWER.retries)
      .toEqual({ total: 1, measured: 4, unknown: 0 });
    // The failed reviewer dispatch reported runtime and no tokens: runtime is
    // measured four times, tokens three.
    expect(report.bySlot.INDEPENDENT_REVIEWER.activeMs.measured).toBe(4);
    expect(report.bySlot.INDEPENDENT_REVIEWER.inputTokens.measured).toBe(3);
    expect(report.bySlot.INDEPENDENT_REVIEWER.inputTokens.unknown).toBe(1);
  });

  it('keeps an UNINSTRUMENTED participation dimension unknown, not zero', () => {
    // PARTICIPATION IS MEASURED, NOT COUNTED — the same rule money follows, one
    // axis over. A plain counter makes "nobody recorded it" and "it did not
    // happen" the same number, and a slot whose guidance consumption is not yet
    // instrumented would read as a slot that consumed no guidance.
    const report = summarizeJuliusSlotEffort([
      obs({ role: 'PROMPT_ARCHITECT', inputTokens: 10, guidanceGenerated: 2, guidanceConsumed: null }),
      obs({ role: 'PROMPT_ARCHITECT', inputTokens: 10, guidanceGenerated: null, guidanceConsumed: null }),
    ]);
    expect(report.bySlot.PROMPT_ARCHITECT.guidanceGenerated)
      .toEqual({ total: 2, measured: 1, unknown: 1 });
    expect(report.bySlot.PROMPT_ARCHITECT.guidanceConsumed)
      .toEqual({ total: 0, measured: 0, unknown: 2 });
  });

  it('names a slot above the band rather than hiding it or faulting it', () => {
    // Calling it PEER would hide it; calling it a fault would be wrong. A
    // worker above 1.2x is one the mission asked more of, and whether that was
    // warranted is a question for the raw dimensions beside it — which is why
    // nothing reads this state to penalise anybody.
    const report = summarizeJuliusSlotEffort([
      obs({ role: 'CODING_AGENT', inputTokens: 1_000, outputTokens: 1_000 }),
      obs({ role: 'PROMPT_ARCHITECT', inputTokens: 50_000, outputTokens: 20_000, researchCalls: 12 }),
    ]);
    expect(report.ratioToCoder.PROMPT_ARCHITECT!).toBeGreaterThan(JULIUS_EFFORT_BAND.max);
    expect(report.verdict.PROMPT_ARCHITECT).toBe('ABOVE_OBSERVED_RANGE');
    expect(report.verdict.PROMPT_ARCHITECT).not.toBe('BELOW_OBSERVED_RANGE');
    // The raw dimensions remain authoritative and are not collapsed away.
    expect(report.bySlot.PROMPT_ARCHITECT.researchCalls).toEqual({ total: 12, measured: 1, unknown: 0 });
  });

  /** Research counts for more than its token footprint, deliberately. */
  it('research operations count as work a token count understates', () => {
    const without = summarizeJuliusSlotEffort([obs({ role: 'PROMPT_ARCHITECT', inputTokens: 1_000, outputTokens: 0 })]);
    const with_ = summarizeJuliusSlotEffort([obs({ role: 'PROMPT_ARCHITECT', inputTokens: 1_000, outputTokens: 0, researchCalls: 5 })]);
    expect(with_.bySlot.PROMPT_ARCHITECT.effectiveEffort!)
      .toBeGreaterThan(without.bySlot.PROMPT_ARCHITECT.effectiveEffort!);
  });
});
