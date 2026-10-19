import { describe, expect, it } from 'vitest';

import { validateMissionConfig, defaultMissionConfig } from './mission-config';

/**
 * THE MISSION CONFIG VALIDATOR. The invariants that matter: a config can never
 * request authority that does not exist (unknown permissions are dropped, not
 * honoured), a limit that is not a real number is REFUSED rather than coerced to
 * something permissive, and an unrecognised policy falls back to its most
 * conservative member — never to "no policy".
 */

describe('validateMissionConfig normalizes a well-formed config', () => {
  it('keeps known permissions, drops unknown ones, and dedupes', () => {
    const r = validateMissionConfig({
      permissions: ['read', 'commit', 'not_a_permission', 'commit', 'merge_pr'],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.permissions).toEqual(['read', 'commit', 'merge_pr']);
  });

  it('carries roles, mode, review policy and limits', () => {
    const r = validateMissionConfig({
      pspId: 'psp-1',
      roles: { architect: 'openai_architect', coding: 'claude_code', reviewer: 'hermes_local' },
      mode: 'autonomous',
      review: 'security',
      completionRule: 'balanced',
      limits: { runtimeMinutes: 30, agentCalls: 12, spendUsd: 2.5, reviewCycles: 1, repairCycles: 1 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pspId).toBe('psp-1');
    expect(r.value.roles.coding).toBe('claude_code');
    expect(r.value.mode).toBe('autonomous');
    expect(r.value.review).toBe('security');
    expect(r.value.completionRule).toBe('balanced');
    expect(r.value.limits.spendUsd).toBe(2.5);
    expect(r.value.limits.agentCalls).toBe(12);
  });
});

describe('a malformed limit is REFUSED, never coerced', () => {
  for (const [field, value] of [
    ['spendUsd', -1], ['agentCalls', Number.NaN], ['runtimeMinutes', Number.POSITIVE_INFINITY], ['repairCycles', -0.5],
  ] as const) {
    it(`refuses limits.${field} = ${String(value)}`, () => {
      const r = validateMissionConfig({ limits: { [field]: value } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toContain(field);
    });
  }

  it('treats an absent or null limit as unset (null), not zero', () => {
    const r = validateMissionConfig({ limits: { spendUsd: null } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.limits.spendUsd).toBeNull();
      expect(r.value.limits.agentCalls).toBeNull();
    }
  });
});

describe('unrecognised policy falls back to the conservative member', () => {
  it('defaults mode/review/completionRule when garbage', () => {
    const r = validateMissionConfig({ mode: 'yolo', review: 'skip', completionRule: 'whatever' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.mode).toBe('guided');
    expect(r.value.review).toBe('independent');
    expect(r.value.completionRule).toBe('strict');
  });

  it('an empty object validates to the conservative default shape', () => {
    const r = validateMissionConfig({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(defaultMissionConfig());
  });
});
