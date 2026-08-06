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

/** Narrow past the `refused` state so a disclosure can be read. */
const disclosureOf = (verdict: ReturnType<typeof evaluateCircuitBreakers>) => {
  if (verdict.state === 'refused') throw new Error(`${verdict.refusal}: ${verdict.problem}`);
  return verdict.disclosure;
};

describe('the specified conditions are pinned, literally', () => {
  it('is exactly the twelve CRON_LOOPS.md names, in one list', () => {
    // Review PROVED the old tests were self-referential: deleting a condition
    // from the constant kept the suite green, because every assertion derived
    // its expectations from the constant it was meant to check.
    expect([...BREAKER_CONDITIONS]).toEqual([
      'repeated_consecutive_failures',
      'repeated_authentication_failures',
      'mcp_revoked',
      'provider_unavailable',
      'cost_threshold_or_spike',
      'repeated_reviewer_rejection',
      'external_rate_limited',
      'repeated_duplicate_external_actions',
      'repository_or_workspace_disappeared',
      'organization_membership_changed',
      'security_policy_changed',
      'credential_scopes_reduced',
    ]);
  });

  it('the security class is exactly these six, literally', () => {
    expect([...SECURITY_CLASS_CONDITIONS].sort()).toEqual([
      'credential_scopes_reduced',
      'mcp_revoked',
      'organization_membership_changed',
      'repeated_authentication_failures',
      'repository_or_workspace_disappeared',
      'security_policy_changed',
    ]);
  });
});

describe('what it refuses to answer', () => {
  it('a malformed reading is refused, never downgraded to unknown', () => {
    // Review: a producer's typo 'TRIPPED' fell into the !== 'clear' branch,
    // became unreadable, and unreadable did not pause — a real trip silently
    // downgraded into carrying on.
    const readings = { ...allClear(), mcp_revoked: 'TRIPPED' } as unknown as
      Record<BreakerCondition, BreakerReading>;
    const verdict = evaluateCircuitBreakers(signals({ readings }));
    expect(verdict).toMatchObject({ state: 'refused', refusal: 'malformed_reading' });
  });

  it('a missing reading is refused too', () => {
    const readings = { ...allClear() } as Record<BreakerCondition, BreakerReading>;
    delete (readings as Partial<Record<BreakerCondition, BreakerReading>>).provider_unavailable;
    expect(evaluateCircuitBreakers(signals({ readings })))
      .toMatchObject({ state: 'refused', refusal: 'malformed_reading' });
  });

  it('an external-by-definition trip with NO external effect is a contradiction, not a state', () => {
    // Mutation check: answering this emits exactly the confident 'no external
    // effect' the header calls worse than saying nothing.
    for (const condition of ['repeated_duplicate_external_actions', 'external_rate_limited'] as const) {
      const verdict = evaluateCircuitBreakers(signals({
        readings: withReading(condition, 'tripped'),
        externalEffectOccurred: false,
      }));
      expect(verdict, condition)
        .toMatchObject({ state: 'refused', refusal: 'contradictory_external_effect' });
    }
  });

  it('the same trips are answerable when the external effect is true or unknown', () => {
    for (const externalEffectOccurred of [true, null]) {
      const verdict = evaluateCircuitBreakers(signals({
        readings: withReading('external_rate_limited', 'tripped'),
        externalEffectOccurred,
      }));
      expect(verdict.state).toBe('paused');
    }
  });
});

describe('total unobservability is its own answer', () => {
  it('is neither running nor paused when NOTHING could be read', () => {
    // The spec settles tripping and resuming; it says nothing about total
    // unobservability. The first version answered 'running' and wrote that
    // answer into the spec in the same commit. The caller decides now.
    const readings = Object.fromEntries(BREAKER_CONDITIONS.map((c) => [c, 'unknown'])) as
      Record<BreakerCondition, BreakerReading>;
    const verdict = evaluateCircuitBreakers(signals({ readings }));
    expect(verdict.state).toBe('unobserved');
    expect(disclosureOf(verdict).unreadable).toHaveLength(BREAKER_CONDITIONS.length);
  });

  it('one readable condition is enough to be running rather than unobserved', () => {
    const readings = Object.fromEntries(BREAKER_CONDITIONS.map((c) => [c, 'unknown'])) as
      Record<BreakerCondition, BreakerReading>;
    readings.provider_unavailable = 'clear';
    expect(evaluateCircuitBreakers(signals({ readings })).state).toBe('running');
  });

  it('a trip still pauses even when everything else is unreadable', () => {
    const readings = Object.fromEntries(BREAKER_CONDITIONS.map((c) => [c, 'unknown'])) as
      Record<BreakerCondition, BreakerReading>;
    readings.repeated_consecutive_failures = 'tripped';
    const verdict = evaluateCircuitBreakers(signals({ readings }));
    expect(verdict.state).toBe('paused');
    // …and the paused sentence SAYS the resume also waits on observability.
    expect(disclosureOf(verdict).requiredAction).toContain('could not be read');
  });
});

describe('every specified condition pauses the schedule', () => {
  it.each([...BREAKER_CONDITIONS])('%s trips it', (condition) => {
    // Mutation check: dropping any condition from the loop lets that one trip
    // silently and the schedule keep spending. The external effect is left
    // UNKNOWN so the external-by-definition conditions are answerable here
    // rather than refused as contradictory.
    const verdict = evaluateCircuitBreakers(signals({
      readings: withReading(condition, 'tripped'),
      externalEffectOccurred: null,
    }));
    expect(verdict.state).toBe('paused');
    expect(disclosureOf(verdict).trippedBy).toEqual([condition]);
  });

  it('all clear keeps it running', () => {
    const verdict = evaluateCircuitBreakers(signals());
    expect(verdict.state).toBe('running');
    expect(disclosureOf(verdict).trippedBy).toEqual([]);
    expect(disclosureOf(verdict).requiredAction).toContain('None');
  });

  it('reports EVERY tripped condition, not the first', () => {
    const readings = { ...allClear(), mcp_revoked: 'tripped', external_rate_limited: 'tripped' } as
      Record<BreakerCondition, BreakerReading>;
    // external_rate_limited is external BY DEFINITION, so 'no external
    // effect' would be a contradiction and is refused; Unknown is answerable.
    const verdict = evaluateCircuitBreakers(signals({ readings, externalEffectOccurred: null }));
    expect([...disclosureOf(verdict).trippedBy].sort())
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
    expect(disclosureOf(verdict).externalEffectOccurred).toBeNull();
    expect(disclosureOf(verdict).requiredAction).toContain('UNKNOWN');
    expect(disclosureOf(verdict).requiredAction).toContain('not the same as no');
  });

  it('requires manual review when the external effect is UNKNOWN', () => {
    const verdict = evaluateCircuitBreakers(signals({
      readings: withReading('provider_unavailable', 'tripped'),
      externalEffectOccurred: null,
    }));
    expect(disclosureOf(verdict).manualReviewRequired).toBe(true);
  });

  it('requires manual review when an external effect DID occur', () => {
    const verdict = evaluateCircuitBreakers(signals({
      readings: withReading('repeated_consecutive_failures', 'tripped'),
      externalEffectOccurred: true,
    }));
    expect(disclosureOf(verdict).manualReviewRequired).toBe(true);
    // Wording corrected after review: reaching outside is not the same claim
    // as an EFFECT occurring, and the spec asks about effects.
    expect(disclosureOf(verdict).requiredAction).toContain('An external EFFECT occurred');
  });

  it('does not require manual review for a purely internal, non-security pause', () => {
    // The one case where a schedule may resume itself: nothing left Relay and
    // no access or policy changed.
    const verdict = evaluateCircuitBreakers(signals({
      readings: withReading('repeated_consecutive_failures', 'tripped'),
      externalEffectOccurred: false,
    }));
    expect(disclosureOf(verdict).manualReviewRequired).toBe(false);
    expect(disclosureOf(verdict).requiredAction).toContain('re-evaluates clean');
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
      expect(disclosureOf(verdict).manualReviewRequired).toBe(true);
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
    const d = disclosureOf(verdict);
    expect(d.trippedBy).toEqual(['cost_threshold_or_spike']);
    expect(d.lastSafeRunId).toBe('lpr_good');
    expect(d.lastFailureRunId).toBe('lpr_bad');
    expect(d.externalEffectOccurred).toBe(true);
    expect(d.manualReviewRequired).toBe(true);
    expect(d.requiredAction).toContain('cost_threshold_or_spike');
  });

  it('a schedule with no safe run yet says null, which is not unknown', () => {
    const verdict = evaluateCircuitBreakers(signals({ lastSafeRunId: null }));
    expect(disclosureOf(verdict).lastSafeRunId).toBeNull();
  });

  it('names conditions it could not read, separately from tripped ones', () => {
    const readings = { ...allClear(), mcp_revoked: 'unknown', provider_unavailable: 'tripped' } as
      Record<BreakerCondition, BreakerReading>;
    const verdict = evaluateCircuitBreakers(signals({ readings }));
    expect(disclosureOf(verdict).trippedBy).toEqual(['provider_unavailable']);
    expect(disclosureOf(verdict).unreadable).toEqual(['mcp_revoked']);
  });

  it('an UNREADABLE condition alone does not pause — but it is disclosed', () => {
    // Unreadable is not tripped. It blocks a RESUME, which is a different
    // decision, tested below.
    const verdict = evaluateCircuitBreakers(signals({
      readings: withReading('mcp_revoked', 'unknown'),
    }));
    expect(verdict.state).toBe('running');
    expect(disclosureOf(verdict).unreadable).toEqual(['mcp_revoked']);
    expect(disclosureOf(verdict).requiredAction).toContain('could not be read');
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
