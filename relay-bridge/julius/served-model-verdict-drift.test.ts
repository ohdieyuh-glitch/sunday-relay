import { describe, expect, it } from 'vitest';

import { hostedServedModelVerdict, type HostedResultModelUsage } from '../hosted-coding-agent/hosted-observation';
import { juliusServedModelVerdict } from '../../src/relay/mission/julius/julius-coding-agent';

/**
 * The hosted coder verdict and the default Julius verdict share the YYYYMMDD
 * dated-build grammar. The architect's dashed OpenAI form is not part of that
 * default, so a drift here is a second rule, not a dated build.
 */
const credit = (model: string): HostedResultModelUsage => ({
  model, canonicalModel: model, inputTokens: 1, outputTokens: 1,
});

function both(requested: string, served: string | null): ['MATCH' | 'MISMATCH' | 'UNATTESTED', 'MATCH' | 'MISMATCH' | 'UNATTESTED'] {
  const hosted = hostedServedModelVerdict(
    served === null
      ? { servedModel: null, basis: 'no_output_turns', credit: null }
      : { servedModel: served, basis: 'attested', credit: credit(served) },
    requested,
  );
  return [hosted, juliusServedModelVerdict(requested, served)];
}

describe('juliusServedModelVerdict stays tied to hostedServedModelVerdict', () => {
  it('agrees on an exact id, a YYYYMMDD build, a dashed snapshot, and silence', () => {
    expect(both('claude-opus-5-5', 'claude-opus-5-5')).toEqual(['MATCH', 'MATCH']);
    expect(both('gpt-5.6-sol', 'gpt-5.6-sol-20260801')).toEqual(['MATCH', 'MATCH']);
    expect(both('gpt-5.6-sol', 'gpt-5.6-sol-20261345')).toEqual(['MATCH', 'MATCH']);
    expect(both('gpt-5.6-sol', 'gpt-5.6-sol-2026-08-01')).toEqual(['MISMATCH', 'MISMATCH']);
    expect(both('gpt-5.6-sol', 'gpt-4o')).toEqual(['MISMATCH', 'MISMATCH']);
    expect(both('gpt-5.6-sol', null)).toEqual(['UNATTESTED', 'UNATTESTED']);
  });
});
