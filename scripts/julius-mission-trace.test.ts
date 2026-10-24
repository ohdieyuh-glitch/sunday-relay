import { describe, expect, it } from 'vitest';

import { juliusMissionHexIdFromDigests, juliusMissionTraceId } from './julius-mission-trace.mjs';

describe('julius mission trace id', () => {
  it('matches the two known answers', () => {
    expect(juliusMissionTraceId('wlj_01234567-89ab-4cde-8fab-0123456789ab')).toBe('192b1fbb866790da0ba590b4a8f45144');
    expect(juliusMissionTraceId('wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d')).toBe('0ef34f0df7cf2cf89b844dcfa5fe084f');
  });

  it('returns null for a legacy run id and a preflight id', () => {
    expect(juliusMissionTraceId('run:0123456789abcdef01234567')).toBeNull();
    expect(juliusMissionTraceId('preflight:abc')).toBeNull();
  });

  it('uses the all-zero fallback', () => {
    const zeros = '0'.repeat(64);
    expect(juliusMissionHexIdFromDigests(zeros, zeros, 32)).toBe(`${'0'.repeat(31)}1`);
  });
});
