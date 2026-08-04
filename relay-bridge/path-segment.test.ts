import { describe, expect, it, vi } from 'vitest';

import { decodeSegment } from './path-segment';
import { handleReviewerRoute, BRIDGE_TOKEN_ENV, type ReviewerRunPort } from './reviewer-routes';
import { handleHostedCodingRoute } from './hosted-coding-agent/hosted-routes';

/**
 * A MALFORMED PATH IS A CLIENT ERROR ON EVERY SURFACE, NOT JUST ONE.
 *
 * The first independent review of PR #26 found `GET /v1/reviews/%ZZ` answering
 * **500** on the Hermes service, and the repair fixed it there. It did not fix
 * the four identical bare `decodeURIComponent` calls on the BRIDGE, where the
 * generic catch in `server.ts` whitelists exactly two message strings
 * (`request body too large`, `invalid JSON body`) and maps everything else —
 * including `URIError: URI malformed` — to `500 internal error`.
 *
 * So the same defect the review reported was live on four more routes after it
 * was "repaired". These tests hold every surface to the decoder, which is why
 * the decoder is one function rather than five copies.
 */

/** A sample of shapes `decodeURIComponent` throws on. Not an enumeration. */
const MALFORMED = ['%ZZ', '%', '%E0%A4%A', '%C0%80', '%F0%9F', 'a%', '%%'];

const TOKEN = 'operator-secret';
const env = { [BRIDGE_TOKEN_ENV]: TOKEN } as unknown as NodeJS.ProcessEnv;

describe('decodeSegment is the one decoder', () => {
  it('returns null rather than throwing, for every malformed escape', () => {
    for (const segment of MALFORMED) {
      expect(() => decodeSegment(segment), segment).not.toThrow();
      expect(decodeSegment(segment), segment).toBeNull();
    }
  });

  it('decodes what it can, and treats a blank result as absent', () => {
    expect(decodeSegment('mission-1')).toBe('mission-1');
    expect(decodeSegment('mission%2F1')).toBe('mission/1');
    expect(decodeSegment('')).toBeNull();
    expect(decodeSegment('%20')).toBeNull();
    expect(decodeSegment('%09')).toBeNull();
  });
});

describe('the Reviewer routes refuse a malformed mission id without throwing', () => {
  const runs: ReviewerRunPort = {
    start: vi.fn(),
    status: vi.fn(async () => ({ status: 200, body: { data: 'status' } })),
    inspect: vi.fn(async () => ({ status: 200, body: { data: 'inspect' } })),
    stop: vi.fn(async () => ({ status: 200, body: { data: 'stop' } })),
    retry: vi.fn(),
  } as unknown as ReviewerRunPort;

  it.each(MALFORMED)('GET /reviewer/status/%s is a 4xx, and never throws', async (segment) => {
    // The assertion that matters is that this RESOLVES. Before the repair it
    // rejected with a URIError, which `server.ts` reported as 500.
    const result = await handleReviewerRoute({
      method: 'GET', path: `/reviewer/status/${segment}`,
      authorization: `Bearer ${TOKEN}`, body: undefined, env,
    }, runs);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(422);
    expect(runs.status).not.toHaveBeenCalled();
  });

  it('a well-formed encoded mission id still reaches the port, decoded', async () => {
    const result = await handleReviewerRoute({
      method: 'GET', path: '/reviewer/status/mission%20one',
      authorization: `Bearer ${TOKEN}`, body: undefined, env,
    }, runs);
    expect(result?.status).toBe(200);
    expect(runs.status).toHaveBeenCalledWith('mission one');
  });
});

describe('the hosted Coding Agent routes refuse a malformed run id without throwing', () => {
  const port = {
    get: vi.fn(async () => null),
    inspect: vi.fn(async () => null),
    start: vi.fn(),
    stop: vi.fn(async () => ({ ok: false, status: 404, kind: 'not_found', message: 'no' })),
    retry: vi.fn(),
  };

  const call = (method: string, path: string) => handleHostedCodingRoute({
    method, path, authorization: `Bearer ${TOKEN}`, body: {}, env,
  } as never, port as never);

  it.each(MALFORMED)('GET /hosted-coding/status/%s is 404, and never throws', async (segment) => {
    const result = await call('GET', `/hosted-coding/status/${segment}`);
    expect(result?.status).toBe(404);
    expect(port.get).not.toHaveBeenCalled();
  });

  it.each(MALFORMED)('POST /hosted-coding/stop/%s is 404, and never throws', async (segment) => {
    const result = await call('POST', `/hosted-coding/stop/${segment}`);
    expect(result?.status).toBe(404);
    expect(port.stop).not.toHaveBeenCalled();
  });
});
