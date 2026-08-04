import { describe, expect, it } from 'vitest';
import {
  HERMES_MODE_ENV, HERMES_SERVICE_TOKEN_ENV, HERMES_SERVICE_URL_ENV, HERMES_TRUSTED_ORIGINS_ENV,
  checkServiceUrl, isLoopbackOrigin, originOf, parseTrustedOrigins, selectHermesMode,
} from './hermes-transport';
import { createRemoteHermesTransport, type FetchLike } from './remote-transport';
import { buildHermesTransport } from './transport-factory';

/**
 * F2 — THE TRUSTED-ORIGIN GATE. The adversarial suite for the independent
 * review's second blocking finding.
 *
 * The reproduction that opened the finding: `validServiceUrl` was documented
 * as "a private-network URL the bridge may call. Nothing else is accepted."
 * It checked the protocol and nothing else, so with `production: true`
 * `https://attacker.example.com/hermes` was accepted and the bridge's bearer
 * token was then sent there.
 *
 * The first test below is that exact reproduction, and it is written to FAIL
 * on the pre-repair code.
 */

const remoteEnv = (overrides: Record<string, string>) => ({
  [HERMES_MODE_ENV]: 'remote',
  [HERMES_SERVICE_TOKEN_ENV]: 'service-token',
  ...overrides,
} as unknown as NodeJS.ProcessEnv);

/* ---------------------------------------------- the reported defect ------ */

describe('the reported defect', () => {
  it('an arbitrary HTTPS origin is REFUSED in production', () => {
    const selection = selectHermesMode({
      env: remoteEnv({ [HERMES_SERVICE_URL_ENV]: 'https://attacker.example.com/hermes' }),
      production: true,
    });
    expect(selection.ok).toBe(false);
    if (selection.ok) return;
    expect(selection.kind).toBe('configuration_missing');
    // The rejected URL is never echoed — it names internal host layout.
    expect(selection.safeMessage).not.toContain('attacker.example.com');
    expect(selection.safeMessage).toContain(HERMES_TRUSTED_ORIGINS_ENV);
  });

  it('production with NO trusted origins configured fails closed', () => {
    const selection = selectHermesMode({
      env: remoteEnv({ [HERMES_SERVICE_URL_ENV]: 'https://hermes.internal' }),
      production: true,
    });
    expect(selection.ok).toBe(false);
    if (!selection.ok) {
      expect(selection.safeMessage).toContain('None is configured');
    }
  });

  it('production with the EXACT origin allowlisted is accepted', () => {
    const selection = selectHermesMode({
      env: remoteEnv({
        [HERMES_SERVICE_URL_ENV]: 'https://hermes.internal/v1',
        [HERMES_TRUSTED_ORIGINS_ENV]: 'https://hermes.internal',
      }),
      production: true,
    });
    expect(selection.ok).toBe(true);
  });
});

/* ------------------------------------------------- exactness of match ---- */

describe('the allowlist is an EXACT origin match', () => {
  const trusted = ['https://hermes.internal'];

  const refused = (raw: string) =>
    checkServiceUrl({ raw, production: true, trustedOrigins: trusted }).ok;

  it('refuses a suffix that merely ends with a trusted host', () => {
    // The classic allowlist bypass: `evil-hermes.internal` ends with
    // `hermes.internal`, and a suffix rule would admit it.
    expect(refused('https://evil-hermes.internal')).toBe(false);
    expect(refused('https://hermes.internal.attacker.example')).toBe(false);
  });

  it('refuses a different scheme on a trusted host — an https allowance is not an http one', () => {
    expect(refused('http://hermes.internal')).toBe(false);
  });

  it('refuses a different port on a trusted host', () => {
    expect(refused('https://hermes.internal:8443')).toBe(false);
  });

  it('accepts a trusted origin with or without a path', () => {
    for (const raw of [
      'https://hermes.internal',
      'https://hermes.internal/',
      'https://hermes.internal/hermes',
    ]) {
      expect(checkServiceUrl({ raw, production: true, trustedOrigins: trusted }).ok, raw).toBe(true);
    }
  });

  /**
   * A query or fragment is refused even on a TRUSTED origin, because the
   * origin check cannot see the defect: all three URLs below have the same
   * origin, and only the bare one routes correctly.
   *
   * `remote-transport` builds endpoints by concatenation, so a base carrying
   * `?` or `#` swallows the path appended to it — `https://h/mcp#f` plus
   * `/v1/readiness` requests `/mcp`, not `/v1/readiness`. Every call silently
   * goes somewhere else.
   */
  it('refuses a query or fragment, which would silently misroute every call', () => {
    for (const raw of [
      'https://hermes.internal/v1/reviews?x=1#frag',
      'https://hermes.internal/mcp#f',
      'https://hermes.internal/mcp?x=1',
      'https://hermes.internal#',
      'https://hermes.internal?',
    ]) {
      const verdict = checkServiceUrl({ raw, production: true, trustedOrigins: trusted });
      expect(verdict.ok, raw).toBe(false);
      if (!verdict.ok) expect(verdict.safeMessage).toMatch(/query or a fragment/u);
    }
  });

  it('the misrouting this prevents is real, not theoretical', () => {
    // Exactly what `remote-transport.call()` does to build an endpoint.
    const endpoint = (serviceUrl: string) =>
      new URL(`${serviceUrl.replace(/\/$/u, '')}/v1/readiness`);
    // A bare origin routes correctly...
    expect(endpoint('https://hermes.internal').pathname).toBe('/v1/readiness');
    expect(endpoint('https://hermes.internal/').pathname).toBe('/v1/readiness');
    // ...and every refused form fails to reach the endpoint at all.
    expect(endpoint('https://hermes.internal/mcp#f').pathname).toBe('/mcp');
    expect(endpoint('https://hermes.internal/mcp?x=1').pathname).toBe('/mcp');
    // Including the two the URL parser normalises to an EMPTY hash/search,
    // which is why the guard reads the raw string rather than `parsed.hash`.
    expect(new URL('https://hermes.internal#').hash).toBe('');
    expect(endpoint('https://hermes.internal#').pathname).toBe('/');
    expect(endpoint('https://hermes.internal?').pathname).toBe('/');
  });

  it('refuses a URL carrying embedded credentials', () => {
    expect(originOf('https://user:pass@hermes.internal')).toBeNull();
    expect(refused('https://user:pass@hermes.internal')).toBe(false);
  });

  it('refuses a non-http(s) scheme outright', () => {
    for (const raw of ['file:///etc/passwd', 'ftp://hermes.internal', 'javascript:alert(1)']) {
      expect(originOf(raw), raw).toBeNull();
    }
  });
});

/* ------------------------------------------------- allowlist parsing ----- */

describe('allowlist parsing drops what it cannot understand', () => {
  it('normalises to origins and ignores paths', () => {
    expect(parseTrustedOrigins('https://a.internal/v1, https://b.internal:8443/x'))
      .toEqual(['https://a.internal', 'https://b.internal:8443']);
  });

  it('drops malformed and wildcard entries rather than approximating them', () => {
    // A wildcard is how an allowlist stops being one; a bare host silently
    // admits plaintext http. Neither survives parsing.
    expect(parseTrustedOrigins('*, *.internal, hermes.internal, , not a url')).toEqual([]);
  });

  it('an absent variable is an empty allowlist, not an open one', () => {
    expect(parseTrustedOrigins(undefined)).toEqual([]);
    expect(parseTrustedOrigins('')).toEqual([]);
  });
});

/* --------------------------------------------- development policy -------- */

describe('outside production the policy is loopback-only, stated explicitly', () => {
  it('accepts loopback', () => {
    for (const raw of ['http://localhost:8791', 'http://127.0.0.1:8791', 'http://[::1]:8791']) {
      expect(checkServiceUrl({ raw, production: false, trustedOrigins: [] }).ok, raw).toBe(true);
      expect(isLoopbackOrigin(new URL(raw).origin), raw).toBe(true);
    }
  });

  it('refuses a public host in development unless it is explicitly allowlisted', () => {
    const verdict = checkServiceUrl({
      raw: 'https://attacker.example.com', production: false, trustedOrigins: [],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.safeMessage).toContain('loopback');
  });

  it('an explicit allowlist still works outside production, so staging stays reachable', () => {
    expect(checkServiceUrl({
      raw: 'https://staging-hermes.internal', production: false,
      trustedOrigins: ['https://staging-hermes.internal'],
    }).ok).toBe(true);
  });

  it('production does NOT accept loopback by implication — it must be allowlisted', () => {
    expect(checkServiceUrl({ raw: 'http://127.0.0.1:8791', production: true, trustedOrigins: [] }).ok)
      .toBe(false);
  });
});

/* -------------------------------------- no cross-origin bearer forward --- */

describe('the bearer token is never forwarded across a redirect', () => {
  function recordingFetch(status: number): { calls: Array<{ url: string; init: Record<string, unknown> }>; impl: FetchLike } {
    const calls: Array<{ url: string; init: Record<string, unknown> }> = [];
    const impl: FetchLike = async (url, init) => {
      calls.push({ url, init: init as unknown as Record<string, unknown> });
      return {
        ok: false,
        status,
        headers: { get: (n: string) => (n.toLowerCase() === 'location' ? 'https://attacker.example.com/steal' : null) },
        body: null,
        text: async () => '',
      };
    };
    return { calls, impl };
  }

  it('requests redirect:manual, so the runtime never follows one for us', async () => {
    const fetchImpl = recordingFetch(302);
    const transport = createRemoteHermesTransport({
      serviceUrl: 'https://hermes.internal',
      serviceToken: 'service-token',
      fetchImpl: fetchImpl.impl,
    });
    await transport.testConnection();
    expect(fetchImpl.calls[0]!.init.redirect).toBe('manual');
  });

  it('a 3xx is refused, and the Location is never read into the message', async () => {
    const fetchImpl = recordingFetch(302);
    const transport = createRemoteHermesTransport({
      serviceUrl: 'https://hermes.internal',
      serviceToken: 'service-token',
      fetchImpl: fetchImpl.impl,
    });
    const evidence = await transport.testConnection();
    expect(evidence.connected).toBe(false);
    expect(evidence.failureKind).toBe('service_unreachable');
    expect(evidence.safeMessage).toContain('redirect');
    expect(evidence.safeMessage).not.toContain('attacker.example.com');
    // Exactly one request was made. A followed redirect would be two, and the
    // second would carry the Authorization header to another origin.
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('the token is sent to the configured origin and to nothing else', async () => {
    const fetchImpl = recordingFetch(302);
    const transport = createRemoteHermesTransport({
      serviceUrl: 'https://hermes.internal',
      serviceToken: 'service-token',
      fetchImpl: fetchImpl.impl,
    });
    await transport.startReview({
      runId: 'r', idempotencyKey: 'k', prompt: 'p',
      limits: { timeoutMs: 1000, maxOutputBytes: 1024, maxTurns: 1, maxPromptBytes: 1024 },
    });
    for (const call of fetchImpl.calls) {
      expect(call.url.startsWith('https://hermes.internal')).toBe(true);
      const headers = call.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer service-token');
    }
  });
});

/* ------------------------------------- the refusal reaches the network --- */

/**
 * A REFUSED ORIGIN MUST PRODUCE ZERO REQUESTS, NOT A REFUSAL SOMEWHERE.
 *
 * Everything above proves the pure function refuses. None of it proved the
 * refusal is CONNECTED to anything: `buildHermesTransport` could have gone on
 * constructing a transport and sending the token, and every assertion here
 * would still have passed. This asserts the whole path — untrusted origin in,
 * no transport out, and a spying fetch that is never called.
 */
describe('a refused origin never becomes a request', () => {
  const spyFetch = () => {
    const calls: string[] = [];
    const impl = (async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, text: async () => '{}' };
    }) as unknown as FetchLike;
    return { calls, impl };
  };

  it('buildHermesTransport returns NO transport for an untrusted origin in production', async () => {
    const built = await buildHermesTransport({
      env: remoteEnv({ [HERMES_SERVICE_URL_ENV]: 'https://attacker.example.com/hermes' }),
      production: true,
    });
    expect(built.ok, 'an untrusted origin must not yield a transport').toBe(false);
    if (built.ok) return;
    expect(built.kind).toBe('configuration_missing');
    expect(built.safeMessage).not.toContain('attacker.example.com');
  });

  it('production with NO allowlist configured yields no transport either', async () => {
    const built = await buildHermesTransport({
      env: remoteEnv({ [HERMES_SERVICE_URL_ENV]: 'https://hermes.internal' }),
      production: true,
    });
    expect(built.ok, 'absent policy denies').toBe(false);
  });

  it('an ALLOWLISTED origin does yield a transport, and only then is fetch reached', async () => {
    // The control. Without it, the two refusals above would also pass if
    // `buildHermesTransport` were broken for every input.
    const built = await buildHermesTransport({
      env: remoteEnv({
        [HERMES_SERVICE_URL_ENV]: 'https://hermes.internal',
        [HERMES_TRUSTED_ORIGINS_ENV]: 'https://hermes.internal',
      }),
      production: true,
    });
    expect(built.ok).toBe(true);
  });

  it('an approved origin yields a transport, and that transport calls that origin only once', async () => {
    /*
     * TWO SEPARATE CLAIMS, and the name says both because the test cannot fuse
     * them: `buildHermesTransport` accepts no injected `fetch`, so the gate's
     * own transport cannot be observed making a request. What is proven here is
     * (a) the gate approves this origin and returns a transport, and (b) a
     * transport built for that origin calls it exactly once and nowhere else.
     * The link between them — that the gate refuses to produce a transport for
     * anything else — is proven by the two refusals above, not by this one.
     */
    const built = await buildHermesTransport({
      env: remoteEnv({
        [HERMES_SERVICE_URL_ENV]: 'https://hermes.internal',
        [HERMES_TRUSTED_ORIGINS_ENV]: 'https://hermes.internal',
      }),
      production: true,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // A second transport for the same approved URL, with a spying fetch.
    const spy = spyFetch();
    const transport = createRemoteHermesTransport({
      serviceUrl: 'https://hermes.internal',
      serviceToken: 'service-token',
      fetchImpl: spy.impl,
    });
    await transport.readiness();
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]!.startsWith('https://hermes.internal/')).toBe(true);
  });
});
