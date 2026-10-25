import { describe, expect, it } from 'vitest';

import { WLJ_RUN_ID_PATTERN } from './julius-admission-run-id.mjs';
import {
  JULIUS_TRACE_ROLES,
  JULIUS_TRACE_STAGES,
  JULIUS_TRACE_WLJ_RUN_ID,
  juliusMissionHexIdFromDigests,
  juliusMissionSpanId,
  juliusMissionTraceId,
  juliusMissionTraceparent,
  juliusMissionTraceWindow,
} from './julius-mission-trace.mjs';

const WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
const ROUTE_WLJ = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';

const VECTORS = [
  {
    wljRunId: WLJ,
    traceId: '192b1fbb866790da0ba590b4a8f45144',
    role: 'CODING_AGENT' as const,
    stage: 'build' as const,
    attempt: 1,
    spanId: '3e314a67b8845836',
  },
  {
    wljRunId: ROUTE_WLJ,
    traceId: '0ef34f0df7cf2cf89b844dcfa5fe084f',
    role: 'PROMPT_ARCHITECT' as const,
    stage: 'plan' as const,
    attempt: 1,
    spanId: '20d74ea3e2204340',
  },
] as const;

describe('julius mission trace ids', () => {
  it('uses the same wlj grammar as the admission run id', () => {
    expect(JULIUS_TRACE_WLJ_RUN_ID).toBe(WLJ_RUN_ID_PATTERN);
  });

  it('matches the known-answer vectors', () => {
    for (const vector of VECTORS) {
      const traceId = juliusMissionTraceId(vector.wljRunId);
      const spanId = juliusMissionSpanId(vector.wljRunId, vector.role, vector.stage, vector.attempt);
      expect(traceId, vector.wljRunId).toBe(vector.traceId);
      expect(spanId, vector.wljRunId).toBe(vector.spanId);
      expect(juliusMissionTraceparent(traceId, spanId)).toBe(`00-${vector.traceId}-${vector.spanId}-01`);
      expect(juliusMissionTraceId(vector.wljRunId)).toBe(traceId);
      expect(juliusMissionSpanId(vector.wljRunId, vector.role, vector.stage, vector.attempt)).toBe(spanId);
    }
  });

  it('gives a legacy run id and a preflight id no trace id', () => {
    expect(juliusMissionTraceId('run:0123456789abcdef01234567')).toBeNull();
    expect(juliusMissionTraceId('preflight:abc')).toBeNull();
    expect(juliusMissionTraceId('preflight:wlj_01234567-89ab-4cde-8fab-0123456789ab')).toBeNull();
    expect(juliusMissionTraceId('')).toBeNull();
    expect(juliusMissionTraceId(WLJ.toUpperCase())).toBeNull();
    expect(juliusMissionSpanId('run:0123456789abcdef01234567', 'CODING_AGENT', 'build', 1)).toBeNull();
    expect(juliusMissionSpanId('preflight:abc', 'CODING_AGENT', 'build', 1)).toBeNull();
  });

  it('keeps span ids stable and distinct for each phase and attempt', () => {
    const expected = [
      { role: 'PROMPT_ARCHITECT', stage: 'plan', attempt: 1, spanId: '20d74ea3e2204340' },
      { role: 'CODING_AGENT', stage: 'build', attempt: 1, spanId: '6bc1bfe65ed9e64b' },
      { role: 'CODING_AGENT', stage: 'build', attempt: 2, spanId: '2bb96ae1748df063' },
      { role: 'INDEPENDENT_REVIEWER', stage: 'repair:plan', attempt: 1, spanId: '4d4c5030f6bc2dbc' },
    ] as const;
    const seen = new Set<string>();
    for (const vector of expected) {
      const spanId = juliusMissionSpanId(ROUTE_WLJ, vector.role, vector.stage, vector.attempt);
      expect(spanId, `${vector.role}:${vector.stage}:${String(vector.attempt)}`).toBe(vector.spanId);
      expect(juliusMissionSpanId(ROUTE_WLJ, vector.role, vector.stage, vector.attempt)).toBe(spanId);
      seen.add(vector.spanId);
    }
    expect(seen.size).toBe(expected.length);
    const matrix = new Set<string>();
    for (const role of JULIUS_TRACE_ROLES) {
      for (const stage of JULIUS_TRACE_STAGES) {
        for (const attempt of [0, 1, 2]) {
          const spanId = juliusMissionSpanId(WLJ, role, stage, attempt);
          expect(spanId, `${role}:${stage}:${String(attempt)}`).toMatch(/^[0-9a-f]{16}$/);
          matrix.add(spanId ?? '');
        }
      }
    }
    expect(matrix.size).toBe(JULIUS_TRACE_ROLES.length * JULIUS_TRACE_STAGES.length * 3);
  });

  it('refuses a role, a stage, or an attempt outside the closed sets', () => {
    expect(juliusMissionSpanId(WLJ, 'REPAIR', 'build', 1)).toBeNull();
    expect(juliusMissionSpanId(WLJ, 'CODING_AGENT', 'repair', 1)).toBeNull();
    expect(juliusMissionSpanId(WLJ, 'CODING_AGENT', 'build', -1)).toBeNull();
    expect(juliusMissionSpanId(WLJ, 'CODING_AGENT', 'build', 1.5)).toBeNull();
    expect(juliusMissionSpanId(WLJ, 'CODING_AGENT', 'build', '1')).toBeNull();
  });

  it('walks past an all-zero window and still returns a non-zero id', () => {
    const zeros = '0'.repeat(64);
    const second = `${'0'.repeat(32)}${'ab'.repeat(16)}`;
    expect(juliusMissionTraceWindow(zeros, 32)).toBeNull();
    expect(juliusMissionTraceWindow(second, 32)).toBe('ab'.repeat(16));
    expect(juliusMissionHexIdFromDigests(zeros, second, 32)).toBe('ab'.repeat(16));
    expect(juliusMissionHexIdFromDigests(zeros, zeros, 32)).toBe(`${'0'.repeat(31)}1`);
    expect(juliusMissionHexIdFromDigests(zeros, zeros, 16)).toBe(`${'0'.repeat(15)}1`);
    const spanZeros = `${'0'.repeat(16)}${'cd'.repeat(8)}${'0'.repeat(32)}`;
    expect(juliusMissionTraceWindow(spanZeros, 16)).toBe('cd'.repeat(8));
  });

  it('builds a sampled traceparent and refuses an all-zero id', () => {
    expect(juliusMissionTraceparent('192b1fbb866790da0ba590b4a8f45144', '3e314a67b8845836'))
      .toBe('00-192b1fbb866790da0ba590b4a8f45144-3e314a67b8845836-01');
    expect(juliusMissionTraceparent('0'.repeat(32), '3e314a67b8845836')).toBeNull();
    expect(juliusMissionTraceparent('192b1fbb866790da0ba590b4a8f45144', '0'.repeat(16))).toBeNull();
    expect(juliusMissionTraceparent('192b1fbb866790da0ba590b4a8f45144', '3e314a67b8845836'.toUpperCase())).toBeNull();
  });
});
