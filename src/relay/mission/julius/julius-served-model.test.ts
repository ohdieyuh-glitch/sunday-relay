import { describe, expect, it } from 'vitest';

import { juliusRunHaltingFailureClass, juliusServedModelVerdict } from './julius-coding-agent';

/**
 * THE SERVED-MODEL RULE, SHARED BY THE THREE PEERS.
 *
 * Exact requested id, or a dated build `<requested>-YYYYMMDD`. A dashed
 * snapshot is a different string. Silence is unattested, never a copy of
 * the request.
 */
describe('juliusServedModelVerdict', () => {
  it('matches the requested id and a dated build, including an extra attested name', () => {
    expect(juliusServedModelVerdict('claude-opus-5-5', 'claude-opus-5-5')).toBe('MATCH');
    expect(juliusServedModelVerdict('gpt-5.6-sol', 'gpt-5.6-sol-20260801')).toBe('MATCH');
    expect(juliusServedModelVerdict('grok-build-0.1', 'other', ['grok-build-0.1'])).toBe('MATCH');
    expect(juliusServedModelVerdict('grok-build-0.1', 'other', ['grok-build-0.1-20260801'])).toBe('MATCH');
  });

  it('a substitute and a dashed snapshot are mismatches', () => {
    expect(juliusServedModelVerdict('gpt-5.6-sol', 'gpt-4o')).toBe('MISMATCH');
    expect(juliusServedModelVerdict('gpt-5.6-sol', 'gpt-5.6-sol-2026-08-01')).toBe('MISMATCH');
    expect(juliusServedModelVerdict('gpt-5.6-sol', 'gpt-5.6-sol-2026-04')).toBe('MISMATCH');
    expect(juliusServedModelVerdict('grok-build-0.1', 'grok-build-0.1-2026-08-01')).toBe('MISMATCH');
    expect(juliusServedModelVerdict(null, 'gpt-5.6-sol')).toBe('MISMATCH');
  });

  it('no served name is unattested, and a blank request with no name is unattested', () => {
    expect(juliusServedModelVerdict('gpt-5.6-sol', null)).toBe('UNATTESTED');
    expect(juliusServedModelVerdict('gpt-5.6-sol', '')).toBe('UNATTESTED');
    expect(juliusServedModelVerdict('gpt-5.6-sol', null, ['gpt-5.6-sol'])).toBe('UNATTESTED');
  });

  it('the architect and reviewer classes halt a run, beside the coder classes', () => {
    for (const failureClass of [
      'architect_served_model_mismatch', 'architect_served_model_unattested',
      'reviewer_served_model_mismatch', 'reviewer_served_model_unattested',
      'coder_served_model_mismatch',
    ]) {
      expect(juliusRunHaltingFailureClass(failureClass)).toBe(failureClass);
    }
    expect(juliusRunHaltingFailureClass('plan_validation_failed')).toBeNull();
    expect(juliusRunHaltingFailureClass('review_timeout')).toBeNull();
  });
});
