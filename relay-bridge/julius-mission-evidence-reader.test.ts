import { describe, expect, it } from 'vitest';

import { createJuliusMissionEvidenceReader } from './julius-mission-evidence-reader';

const WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
const ROUTE_WLJ = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';

describe('JuliusMissionEvidenceReader', () => {
  it('returns the known coder trace and does not keep a trace id the source tried to supply', async () => {
    const reader = createJuliusMissionEvidenceReader({
      async phases() {
        const hostile = {
          role: 'CODING_AGENT',
          stage: 'build',
          attempt: 1,
          state: 'SUCCEEDED',
          traceId: 'ffffffffffffffffffffffffffffffff',
          spanId: 'aaaaaaaaaaaaaaaa',
          traceparent: '00-ffffffffffffffffffffffffffffffff-aaaaaaaaaaaaaaaa-01',
        };
        return [hostile];
      },
    });
    const reading = await reader.read(WLJ);
    expect(reading.traceId).toBe('192b1fbb866790da0ba590b4a8f45144');
    expect(reading.traceparent).toBeNull();
    expect(reading.phases).toEqual([{
      role: 'CODING_AGENT',
      state: 'SUCCEEDED',
      stage: 'build',
      attempt: 1,
      spanId: '3e314a67b8845836',
      traceparent: '00-192b1fbb866790da0ba590b4a8f45144-3e314a67b8845836-01',
    }]);
  });

  it('returns the known architect span for the route run id', async () => {
    const reader = createJuliusMissionEvidenceReader({
      async phases() {
        return [{ role: 'PROMPT_ARCHITECT', stage: 'plan', attempt: 1, state: 'SUCCEEDED' }];
      },
    });
    const reading = await reader.read(ROUTE_WLJ);
    expect(reading.traceId).toBe('0ef34f0df7cf2cf89b844dcfa5fe084f');
    expect(reading.phases?.[0]?.spanId).toBe('20d74ea3e2204340');
  });

  it('returns null for a legacy run id and a preflight id', async () => {
    const reader = createJuliusMissionEvidenceReader({
      async phases() {
        return [{ role: 'CODING_AGENT', stage: 'build', attempt: 1, state: 'SUCCEEDED' }];
      },
    });
    expect(await reader.read('run:0123456789abcdef01234567')).toMatchObject({
      traceId: null,
      traceparent: null,
      phases: [{ spanId: null, traceparent: null }],
    });
    expect((await reader.read('preflight:abc')).traceId).toBeNull();
  });

  it('returns a null phase list when the source has no phases, which is not an empty list', async () => {
    const reader = createJuliusMissionEvidenceReader({ async phases() { return null; } });
    expect(await reader.read(WLJ)).toEqual({
      traceId: '192b1fbb866790da0ba590b4a8f45144',
      traceparent: null,
      phases: null,
    });
  });
});
