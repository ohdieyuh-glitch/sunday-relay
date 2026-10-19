import { describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_TOKEN_ENV, bearerMatches, handleReviewerRoute, isReviewerRoute,
  type ReviewerRouteResult, type ReviewerRunPort,
} from './reviewer-routes';

/**
 * THE REVIEWER HTTP BOUNDARY.
 *
 * Two properties matter most and are asserted directly: every route is
 * authenticated (including the read-only ones, because run state and host
 * contents are both operational disclosure), and the read-only routes really
 * do nothing — no process, no provider request, no usage.
 */

const TOKEN = 'bridge-token-abcdefghijklmnop';
/**
 * The harness probe is pointed at a path that cannot exist. These tests are
 * about authentication, validation and disclosure — not about whichever Hermes
 * happens to be installed on the machine running them. Probing a real binary
 * costs tens of seconds and makes the result machine-dependent.
 */
const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv =>
  ({
    [BRIDGE_TOKEN_ENV]: TOKEN,
    PATH: process.env.PATH,
    RELAY_HERMES_EXECUTABLE: '/nonexistent/relay-hermes-probe',
    ...extra,
  }) as NodeJS.ProcessEnv;

const call = (
  path: string,
  opts: {
    method?: string; token?: string | null; body?: unknown;
    runs?: ReviewerRunPort | null; env?: NodeJS.ProcessEnv;
  } = {},
): Promise<ReviewerRouteResult | null> => handleReviewerRoute({
  method: opts.method ?? 'GET',
  path,
  authorization: opts.token === null ? undefined : `Bearer ${opts.token ?? TOKEN}`,
  body: opts.body,
  env: opts.env ?? env(),
}, opts.runs ?? null);

const runPort = (): { port: ReviewerRunPort; calls: string[] } => {
  const calls: string[] = [];
  const answer = async (name: string): Promise<ReviewerRouteResult> => {
    calls.push(name);
    return { status: 200, body: { data: { called: name } } };
  };
  return {
    calls,
    port: {
      start: () => answer('start'),
      status: () => answer('status'),
      inspect: () => answer('inspect'),
      stop: () => answer('stop'),
      retry: () => answer('retry'),
    },
  };
};

describe('route matching stays inside the reviewer family', () => {
  it('claims only reviewer paths', () => {
    expect(isReviewerRoute('/reviewer/readiness')).toBe(true);
    expect(isReviewerRoute('/reviewer/start')).toBe(true);
    expect(isReviewerRoute('/mission/start')).toBe(false);
    expect(isReviewerRoute('/health')).toBe(false);
  });

  it('returns null for a path it does not own, so the bridge falls through', async () => {
    expect(await call('/mission/start')).toBeNull();
  });
});

describe('every reviewer route is authenticated', () => {
  it('refuses a missing, malformed or wrong credential identically', async () => {
    for (const token of [null, 'wrong-token-value-here', '']) {
      const r = await call('/reviewer/readiness', { token });
      expect(r?.status, String(token)).toBe(401);
      expect(r?.body.kind).toBe('authentication_failed');
      // Never says which part was wrong.
      expect(JSON.stringify(r?.body)).not.toContain(TOKEN);
    }
  });

  it('refuses when the server has no token configured at all', async () => {
    const r = await call('/reviewer/readiness', { env: { PATH: process.env.PATH } as NodeJS.ProcessEnv });
    expect(r?.status).toBe(401);
  });

  it('compares bearers without a length or prefix oracle', () => {
    expect(bearerMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerMatches(`bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(bearerMatches(`Bearer ${TOKEN.slice(0, -1)}`, TOKEN)).toBe(false);
    expect(bearerMatches(TOKEN, TOKEN)).toBe(false);   // missing scheme
    expect(bearerMatches(undefined, TOKEN)).toBe(false);
    expect(bearerMatches(`Bearer ${TOKEN}`, undefined)).toBe(false);
    expect(bearerMatches(`Bearer ${TOKEN}`, '')).toBe(false);
  });
});

describe('read-only routes do nothing expensive', () => {
  it('readiness makes no provider request and hides the host path', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await call('/reviewer/readiness');
    expect(r?.status).toBe(200);
    const data = (r?.body.data ?? {}) as { harness: string; evidence: Record<string, unknown> };
    expect(data.harness).toBe('hermes');
    // A local probe can never conclude a model is verified.
    expect(data.evidence.modelVerified).toBe(false);
    expect(data.evidence.verifiedModelId).toBeNull();
    // The host's layout never leaves the process.
    expect(data.evidence.binaryPath).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(r?.body)).not.toMatch(/xai-|Bearer|apiKey/);
    vi.unstubAllGlobals();
  }, 30_000);

  it('status and inspect reach the run port without mutating anything', async () => {
    const { port, calls } = runPort();
    expect((await call('/reviewer/status/m1', { runs: port }))?.status).toBe(200);
    expect((await call('/reviewer/inspect/m1', { runs: port }))?.status).toBe(200);
    expect(calls).toEqual(['status', 'inspect']);
  });

  it('answers reviewer_not_ready rather than inventing a run when no engine exists', async () => {
    for (const [path, method] of [['/reviewer/status/m1', 'GET'], ['/reviewer/start', 'POST']] as const) {
      const r = await call(path, { method, runs: null, body: {} });
      expect(r?.status).toBe(503);
      expect(r?.body.kind).toBe('reviewer_not_ready');
    }
  });

  /**
   * THE REFUSAL MUST NOT DESCRIBE A SETTING THAT DOES NOT EXIST.
   *
   * It used to read "has no Reviewer run engine configured", which is the same
   * class of untruth as publishing a `fusionBaseUrl` nobody set: it names a
   * configuration step, so an operator goes looking for the variable. There is
   * none — reviews run inside the mission leg — and an hour spent searching for
   * a flag is the cost of that sentence.
   */
  it('does not send an operator hunting for a variable that does not exist', async () => {
    const r = await call('/reviewer/start', { method: 'POST', runs: null, body: {} });
    const message = String(r?.body.error ?? '');
    expect(message).toContain('No configuration enables this route');
    // And it names the path that DOES work, so the answer is actionable.
    expect(message).toMatch(/mission/i);
    expect(message).not.toMatch(/not configured/i);
  });
});

describe('mutating routes validate and require authorization', () => {
  const validStart = {
    missionId: 'm1', reviewGeneration: 'rev-1', requestedHarness: 'hermes',
    requestedModel: null, idempotencyKey: 'idem-1', authorized: true,
    limits: { timeoutMs: 1000, maxOutputBytes: 100, maxTurns: 1, maxPromptBytes: 100 },
  };

  it('start rejects an unauthorized request before touching the engine', async () => {
    const { port, calls } = runPort();
    const r = await call('/reviewer/start', {
      method: 'POST', runs: port, body: { ...validStart, authorized: false },
    });
    expect(r?.status).toBe(403);
    expect(r?.body.kind).toBe('authorization_required');
    expect(calls).toEqual([]);
  });

  it('start rejects an incomplete request', async () => {
    const { port, calls } = runPort();
    for (const field of ['missionId', 'reviewGeneration', 'requestedHarness', 'idempotencyKey', 'limits']) {
      const body: Record<string, unknown> = { ...validStart };
      delete body[field];
      const r = await call('/reviewer/start', { method: 'POST', runs: port, body });
      expect(r?.status, field).toBe(422);
      expect(r?.body.kind, field).toBe('validation_failed');
    }
    expect(calls).toEqual([]);
  });

  it('start accepts a complete authorized request', async () => {
    const { port, calls } = runPort();
    const r = await call('/reviewer/start', { method: 'POST', runs: port, body: validStart });
    expect(r?.status).toBe(200);
    expect(calls).toEqual(['start']);
  });

  it('retry demands fresh authorization and a prior run', async () => {
    const { port, calls } = runPort();
    const noAuth = await call('/reviewer/retry', {
      method: 'POST', runs: port,
      body: { missionId: 'm1', priorRunId: 'run-1', idempotencyKey: 'idem-2' },
    });
    expect(noAuth?.status).toBe(403);
    expect(String(noAuth?.body.error)).toContain('fresh explicit authorization');

    const incomplete = await call('/reviewer/retry', {
      method: 'POST', runs: port, body: { missionId: 'm1', authorized: true },
    });
    expect(incomplete?.status).toBe(422);
    expect(calls).toEqual([]);

    const good = await call('/reviewer/retry', {
      method: 'POST', runs: port,
      body: { missionId: 'm1', priorRunId: 'run-1', idempotencyKey: 'idem-2', authorized: true },
    });
    expect(good?.status).toBe(200);
    expect(calls).toEqual(['retry']);
  });

  it('stop needs no authorization flag and reaches the canonical stop', async () => {
    const { port, calls } = runPort();
    const r = await call('/reviewer/stop/m1', { method: 'POST', runs: port, body: {} });
    expect(r?.status).toBe(200);
    expect(calls).toEqual(['stop']);
  });

  it('rejects a wrong method on a reviewer path rather than guessing', async () => {
    const { port } = runPort();
    const r = await call('/reviewer/status/m1', { method: 'POST', runs: port });
    expect(r?.status).toBe(422);
  });
});

describe('the route module leaks nothing', () => {
  it('never returns a credential, an environment or a raw provider body', async () => {
    const r = await call('/reviewer/readiness', {
      // Provider identity is now explicit: the bridge no longer assumes xAI,
      // so a readiness call must be told which provider it is reporting on.
      env: env({
        RELAY_HERMES_PROVIDER: 'xai',
        RELAY_HERMES_MODEL: 'grok-4',
        XAI_API_KEY: 'xai-super-secret-value',
        SOME_OTHER_SECRET: 'nope',
      }),
    });
    const serialized = JSON.stringify(r?.body);
    expect(serialized).not.toContain('xai-super-secret-value');
    expect(serialized).not.toContain('SOME_OTHER_SECRET');
    expect(serialized).not.toContain(TOKEN);
    // Credential presence is a boolean, never a value.
    const evidence = (r?.body.data as { evidence: Record<string, unknown> }).evidence;
    expect(typeof evidence.credentialPresent).toBe('boolean');
    expect(evidence.credentialPresent).toBe(true);
  }, 30_000);
});
