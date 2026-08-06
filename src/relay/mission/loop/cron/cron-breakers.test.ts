import { describe, expect, it } from 'vitest';

import {
  BREAKER_CONDITIONS, SECURITY_CLASS_CONDITIONS,
  evaluateCircuitBreakers, mayResumeAfterBreaker,
  type BreakerCondition, type BreakerReading, type BreakerSignals,
} from './cron-breakers';

/**
 * CIRCUIT BREAKERS. The trip logic is the easy half; what is tested hardest
 * is the disclosure — specifically that "whether any external effect
 * occurred" is three-valued and that UNKNOWN is never rendered as "no",
 * because a confident "no external effect" the code cannot support is what
 * ends an investigation that should have happened.
 */

const allClear = (): Record<BreakerCondition, BreakerReading> =>
  Object.fromEntries(BREAKER_CONDITIONS.map((c) => [c, 'clear'])) as
    Record<BreakerCondition, BreakerReading>;

const signals = (over: Partial<BreakerSignals> = {}): BreakerSignals => ({
  readings: allClear(),
  externalEffectOccurred: false,
  lastSafeRunId: 'lpr_safe',
  lastFailureRunId: null,
  ...over,
});

const withReading = (
  condition: BreakerCondition, reading: BreakerReading,
): Record<BreakerCondition, BreakerReading> => ({ ...allClear(), [condition]: reading });

describe('every specified condition pauses the schedule', () => {
  it.each([...BREAKER_CONDITIONS])('%s trips it', (condition) => {
    // Mutation check: dropping any condition from the loop lets that one
    // trip silently and the schedule keep spending.
    const verdict = evaluateCircuitBreakers(signals({ readings: withReading(condition, 'tripped') }));
    expect(verdict.state).toBe('paused');
    expect(verdict.disclosure.trippedBy).toEqual([condition]);
  });

  it('all clear keeps it running', () => {
    const verdict = evaluateCircuitBreakers(signals());
    expect(verdict.state).toBe('running');
    expect(verdict.disclosure.trippedBy).toEqual([]);
    expect(verdict.disclosure.requiredAction).toContain('None');
  });

  it('reports EVERY tripped condition, not the first', () => {
    const readings = { ...allClear(), mcp_revoked: 'tripped', external_rate_limited: 'tripped' } as
      Record<BreakerCondition, BreakerReading>;
    const verdict = evaluateCircuitBreakers(signals({ readings }));
    expect([...verdict.disclosure.trippedBy].sort())
      .toEqual(['external_rate_limited', 'mcp_revoked']);
  });
});

describe('unknown external effect is never rendered as no', () => {
  it('carries null through the disclosure untouched', () => {
    // Mutation check: defaulting a null external effect to false fails here
    // and in the manual-review test below.
    const verdict = evaluateCircuitBreakers(signals({
      readings: withReading('provider_unavailable', 'tripped'),
      externalEffectOccurred: null,
    }));
    expect(verdict.disclosure.externalEffectOccurred).toBeNull();
    expect(verdict.disclosure.requiredAction).toContain('UNKNOWN');
    expect(verdict.disclosure.requiredAction).toContain('not the same as no');
  });

  it('requires manual review when the external effect is UNKNOWN', () => {
    const verdict = evaluateCircuitBreakers(signals({
      readings: withReading('provider_unavailable', 'tripped'),
      externalEffectOccurred: null,
    }));
    expect(verdict.disclosure.manualReviewRequired).toBe(true);
  });

  it('requires manual review when an external effect DID occur', () => {
    const verdict = evaluateCircuitBreakers(signals({
      readings: withReading('repeated_consecutive_failures', 'tripped'),
      externalEffectOccurred: true,
    }));
    expect(verdict.disclosure.manualReviewRequired).toBe(true);
    expect(verdict.disclosure.requiredAction).toContain('DID reach outside');
  });

  it('does not require manual review for a purely internal, non-security pause', () => {
    // The one case where a schedule may resume itself: nothing left Relay and
    // no access or policy changed.
    const verdict = evaluateCircuitBreakers(signals({
      readings: withReading('repeated_consecutive_failures', 'tripped'),
      externalEffectOccurred: false,
    }));
    expect(verdict.disclosure.manualReviewRequired).toBe(false);
    expect(verdict.disclosure.requiredAction).toContain('re-evaluates clean');
  });
});

describe('access and policy changes always need a human', () => {
  it.each([...SECURITY_CLASS_CONDITIONS])(
    '%s requires manual review even with no external effect',
    (condition) => {
      // Mutation check: dropping the security class lets a revoked credential
      // or a changed policy be resumed automatically.
      const verdict = evaluateCircuitBreakers(signals({
        readings: withReading(condition, 'tripped'),
        externalEffectOccurred: false,
      }));
      expect(verdict.disclosure.manualReviewRequired).toBe(true);
    },
  );

  it('the security class is a subset of the specified conditions', () => {
    for (const condition of SECURITY_CLASS_CONDITIONS) {
      expect(BREAKER_CONDITIONS).toContain(condition);
    }
  });
});

describe('the disclosure carries what the spec requires', () => {
  it('shows why it paused, the last safe run, the last failure and the action', () => {
    const verdict = evaluateCircuitBreakers(signals({
      readings: withReading('cost_threshold_or_spike', 'tripped'),
      lastSafeRunId: 'lpr_good',
      lastFailureRunId: 'lpr_bad',
      externalEffectOccurred: true,
    }));
    const d = verdict.disclosure;
    expect(d.trippedBy).toEqual(['cost_threshold_or_spike']);
    expect(d.lastSafeRunId).toBe('lpr_good');
    expect(d.lastFailureRunId).toBe('lpr_bad');
    expect(d.externalEffectOccurred).toBe(true);
    expect(d.manualReviewRequired).toBe(true);
    expect(d.requiredAction).toContain('cost_threshold_or_spike');
  });

  it('a schedule with no safe run yet says null, which is not unknown', () => {
    const verdict = evaluateCircuitBreakers(signals({ lastSafeRunId: null }));
    expect(verdict.disclosure.lastSafeRunId).toBeNull();
  });

  it('names conditions it could not read, separately from tripped ones', () => {
    const readings = { ...allClear(), mcp_revoked: 'unknown', provider_unavailable: 'tripped' } as
      Record<BreakerCondition, BreakerReading>;
    const verdict = evaluateCircuitBreakers(signals({ readings }));
    expect(verdict.disclosure.trippedBy).toEqual(['provider_unavailable']);
    expect(verdict.disclosure.unreadable).toEqual(['mcp_revoked']);
  });

  it('an UNREADABLE condition alone does not pause — but it is disclosed', () => {
    // Unreadable is not tripped. It blocks a RESUME, which is a different
    // decision, tested below.
    const verdict = evaluateCircuitBreakers(signals({
      readings: withReading('mcp_revoked', 'unknown'),
    }));
    expect(verdict.state).toBe('running');
    expect(verdict.disclosure.unreadable).toEqual(['mcp_revoked']);
    expect(verdict.disclosure.requiredAction).toContain('could not be read');
  });
});

describe('resuming requires the condition to re-evaluate clean', () => {
  it('permits a resume only when every condition reads clear', () => {
    expect(mayResumeAfterBreaker(signals())).toEqual({ ok: true });
  });

  it('refuses while a condition still reads tripped', () => {
    const decision = mayResumeAfterBreaker(signals({
      readings: withReading('external_rate_limited', 'tripped'),
    }));
    expect(decision).toMatchObject({ ok: false, refusal: 'still_tripped' });
    if (!decision.ok) expect(decision.conditions).toEqual(['external_rate_limited']);
  });

  it('refuses when a condition cannot be READ — unobserved is not clean', () => {
    // Mutation check: treating an unknown reading as clear resumes a schedule
    // on silence rather than on evidence, which is the permissive failure the
    // resume rule exists to prevent.
    const decision = mayResumeAfterBreaker(signals({
      readings: withReading('credential_scopes_reduced', 'unknown'),
    }));
    expect(decision).toMatchObject({ ok: false, refusal: 'not_re_evaluated' });
    if (!decision.ok) {
      expect(decision.conditions).toEqual(['credential_scopes_reduced']);
      expect(decision.problem).toContain('Unobserved is not');
    }
  });

  it('a still-tripped condition outranks an unreadable one in the refusal', () => {
    const readings = {
      ...allClear(), mcp_revoked: 'unknown', provider_unavailable: 'tripped',
    } as Record<BreakerCondition, BreakerReading>;
    const decision = mayResumeAfterBreaker(signals({ readings }));
    expect(decision).toMatchObject({ ok: false, refusal: 'still_tripped' });
  });

  it('a resume is not permitted by the external effect being known', () => {
    // Knowing nothing left Relay says nothing about whether the condition
    // cleared. Mutation check: letting externalEffectOccurred === false
    // short-circuit the resume check fails this.
    const decision = mayResumeAfterBreaker(signals({
      readings: withReading('security_policy_changed', 'tripped'),
      externalEffectOccurred: false,
    }));
    expect(decision.ok).toBe(false);
  });
});
