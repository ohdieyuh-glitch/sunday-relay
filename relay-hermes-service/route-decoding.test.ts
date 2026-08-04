import { describe, expect, it, vi } from 'vitest';
import { decodeSegment, handleServiceRoute, SERVICE_TOKEN_ENV } from './service';

/**
 * MALFORMED PATH ENCODING — the non-blocking review finding that
 * `GET /v1/reviews/%ZZ` answered **500**.
 *
 * `decodeURIComponent` throws a `URIError` on a malformed escape. The throw
 * escaped the route handler and was caught by the server's generic catch,
 * which reports an internal fault. A client sending a bad path is not an
 * internal fault: it tells an operator the service is broken when nothing
 * about it is, and it is the kind of 500 that gets escalated at 3am.
 */

const env = { [SERVICE_TOKEN_ENV]: 'secret' } as unknown as NodeJS.ProcessEnv;

const engine = {
  mode: 'local' as const,
  readiness: vi.fn(),
  testConnection: vi.fn(),
  startReview: vi.fn(),
  getReview: vi.fn(async (runId: string) => ({
    runId, status: 'completed' as const, protocol: null, reviewText: null,
    usage: { inputTokens: null, outputTokens: null, source: 'unavailable' as const },
    failureKind: null, safeMessage: null,
  })),
  cancelReview: vi.fn(async () => ({ requested: true, terminationConfirmed: false, safeMessage: null })),
};

const get = (path: string) => handleServiceRoute(
  { method: 'GET', path, authorization: 'Bearer secret', body: undefined, env },
  engine as never,
);

const post = (path: string) => handleServiceRoute(
  { method: 'POST', path, authorization: 'Bearer secret', body: {}, env },
  engine as never,
);

/** Every shape `decodeURIComponent` is known to throw on. */
const MALFORMED = ['%ZZ', '%', '%E0%A4%A', '%C0%80', '%F0%9F', 'a%', '%%'];

describe('a malformed path is a client error, never an internal fault', () => {
  it.each(MALFORMED)('GET /v1/reviews/%s is 404, not 500', async (segment) => {
    const result = await get(`/v1/reviews/${segment}`);
    expect(result.status).toBe(404);
    expect(result.body.kind).toBe('not_found');
    expect(engine.getReview).not.toHaveBeenCalledWith(expect.stringContaining('%'));
  });

  it.each(MALFORMED)('POST /v1/reviews/%s/cancel is 404, not 500', async (segment) => {
    const result = await post(`/v1/reviews/${segment}/cancel`);
    expect(result.status).toBe(404);
    expect(result.body.kind).toBe('not_found');
  });

  it('a well-formed encoded id still reaches the engine, decoded', async () => {
    engine.getReview.mockClear();
    const result = await get('/v1/reviews/run%20one');
    expect(result.status).toBe(200);
    expect(engine.getReview).toHaveBeenCalledWith('run one');
  });

  it('an id that decodes to whitespace is a 404, not a lookup for ""', async () => {
    const result = await get('/v1/reviews/%20');
    expect(result.status).toBe(404);
  });
});

describe('decodeSegment itself', () => {
  it('returns null rather than throwing, for every malformed escape', () => {
    for (const segment of MALFORMED) {
      expect(() => decodeSegment(segment)).not.toThrow();
      expect(decodeSegment(segment), segment).toBeNull();
    }
  });

  it('decodes what it can', () => {
    expect(decodeSegment('run-1')).toBe('run-1');
    expect(decodeSegment('run%2F1')).toBe('run/1');
  });

  it('treats a blank result as absent', () => {
    expect(decodeSegment('')).toBeNull();
    expect(decodeSegment('%09')).toBeNull();
  });
});
