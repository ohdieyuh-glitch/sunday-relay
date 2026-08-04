import { describe, expect, it, vi } from 'vitest';
import { createHermesService, decodeSegment, handleServiceRoute, SERVICE_TOKEN_ENV } from './service';

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

/**
 * A SAMPLE of shapes `decodeURIComponent` throws on — not an enumeration, and
 * the earlier comment claimed one. The guard is written to catch every throw
 * rather than these seven, and `decodeSegment` is the thing that must hold.
 */
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

/* ------------------------------------------------- through the real server */

/**
 * THE LAYER THE FINDING WAS ACTUALLY ABOUT.
 *
 * Every test above calls `handleServiceRoute` directly — which is one layer
 * BELOW the generic `catch` that turned the URIError into a 500. Proving the
 * route returns 404 in isolation does not prove the deployed server does, and
 * it cannot show the other half of the claim: that we did not "fix" the 500 by
 * converting genuine server faults into 4xx.
 *
 * These go over real loopback HTTP against `createHermesService`.
 */
describe('the real server answers a malformed path as 404 and a real fault as 500', () => {
  const TOKEN = 'signal-secret';

  async function withService(
    engineOverride: Record<string, unknown>,
    run: (base: string) => Promise<void>,
  ): Promise<void> {
    // `createHermesService` reads the token from `process.env`, so the token
    // is set here and restored afterwards rather than injected.
    const previous = process.env[SERVICE_TOKEN_ENV];
    process.env[SERVICE_TOKEN_ENV] = TOKEN;
    const service = createHermesService({ ...engine, ...engineOverride } as never);
    await new Promise<void>((resolve) => { service.listen(0, '127.0.0.1', () => resolve()); });
    const address = service.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    try {
      await run(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise<void>((resolve) => { service.close(() => resolve()); });
      if (previous === undefined) delete process.env[SERVICE_TOKEN_ENV];
      else process.env[SERVICE_TOKEN_ENV] = previous;
    }
  }

  it('GET /v1/reviews/%ZZ is 404 over real HTTP', async () => {
    await withService({}, async (base) => {
      const res = await fetch(`${base}/v1/reviews/%ZZ`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(404);
      const body = await res.json() as { kind: string; error: string };
      expect(body.kind).toBe('not_found');
      // And it does NOT reuse the unknown-route sentence: the operation was
      // known, the run id was not.
      expect(body.error).not.toBe('Unknown Hermes Reviewer operation.');
    });
  }, 30_000);

  it('a genuine engine fault is STILL 500 — the repair did not convert faults into 4xx', async () => {
    await withService({
      getReview: async () => { throw new Error('the engine really broke'); },
    }, async (base) => {
      const res = await fetch(`${base}/v1/reviews/run-1`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(500);
      const body = await res.json() as { kind: string; error: string };
      expect(body.kind).toBe('internal_error');
      // The cause is never reflected: it can carry a prompt, a path or a key.
      expect(body.error).not.toContain('really broke');
    });
  }, 30_000);
});
