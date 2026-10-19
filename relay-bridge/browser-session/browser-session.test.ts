import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBridgeServer } from '../server';
import { loadBridgeConfig } from '../config';
import {
  GRANT_TTL_MS, SESSION_TTL_MS, browserSessionMayCall, createBrowserSessionStore,
} from './grants';
import { authorizeReviewerCall, sessionTokenFrom } from './routes';

/**
 * THE BROWSER CONNECTION, ATTACKED.
 *
 * The single thing this milestone must guarantee is that a public JavaScript
 * bundle never carries a credential that can spend money. Everything below is
 * written from that angle: what a stolen grant buys, what a stolen session
 * buys, and whether either can be replayed, widened or moved to another site.
 *
 * Nothing here contacts a provider.
 */

const ORIGIN = 'https://sunday-relay.vercel.app';
const EVIL = 'https://evil.example';
const OPERATOR = 'operator-token-for-tests-only';

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    if (s === undefined) continue;
    s.closeAllConnections?.();
    await new Promise<void>((r) => s.close(() => r()));
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const env = () => ({ RELAY_BRIDGE_API_TOKEN: OPERATOR }) as NodeJS.ProcessEnv;
const store = () => createBrowserSessionStore();

/** A real bridge, with pairing wired exactly as production wires it. */
async function boot(): Promise<string> {
  vi.stubEnv('RELAY_BRIDGE_API_TOKEN', OPERATOR);
  vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
  vi.stubEnv('RELAY_HERMES_EXECUTABLE', '/nonexistent/relay-hermes-probe');
  const config = loadBridgeConfig(process.env);
  const server = createBridgeServer(config, {
    start: () => ({}) as never, get: () => undefined, cancel: () => undefined, retry: () => undefined,
  } as never);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

/** Operator mints a grant, browser redeems it. The whole happy path. */
async function pair(base: string): Promise<{ token: string; grantId: string; grantSecret: string }> {
  const minted = await post(base, '/relay-api/browser/pair', { origin: ORIGIN }, {
    Authorization: `Bearer ${OPERATOR}`,
  });
  const grant = (await minted.json()).data as { grantId: string; grantSecret: string };
  const exchanged = await post(base, '/relay-api/browser/session', grant, { Origin: ORIGIN });
  const session = (await exchanged.json()).data as { sessionToken: string };
  return { token: session.sessionToken, ...grant };
}

/* ------------------------------------------------ the operator token ----- */

describe('the operator token never reaches the browser', () => {
  const REPO = join(__dirname, '..', '..');

  it('appears in no browser-reachable source', () => {
    const walk = (dir: string): string[] => {
      const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
      return readdirSync(dir).flatMap((name: string) => {
        if (name === 'node_modules') return [];
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    };
    const browserFiles = walk(join(REPO, 'src', 'relay', 'ui'))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
    const offenders = browserFiles.filter((f) =>
      /RELAY_BRIDGE_API_TOKEN|RELAY_BRIDGE_TOKEN/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('is never a VITE variable in any tracked source', () => {
    const walk = (dir: string): string[] => {
      const { readdirSync, statSync, existsSync } = require('node:fs') as typeof import('node:fs');
      if (!existsSync(dir)) return [];
      return readdirSync(dir).flatMap((name: string) => {
        if (name === 'node_modules') return [];
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    };
    const offenders = [...walk(join(REPO, 'src')), ...walk(join(REPO, 'relay-bridge'))]
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /VITE_[A-Z_]*(TOKEN|SECRET|KEY)/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
    // An explicit budget, because this rule WALKS THE TREE and reads every
    // matching file: its cost grows with the repository. The Hermes Reviewer
    // milestone added 31 files under `relay-bridge/reviewer-harness/hermes`
    // and elsewhere, which pushed this past vitest's 5s default when the suite
    // runs files in parallel on a 2-core host. It failed for taking too long,
    // not for finding anything. The rule is byte-identical and still fails on
    // the first offending file; only the clock changed.
  }, 30_000);

  it('a browser session token is a DIFFERENT scheme, so the two cannot be confused', () => {
    expect(sessionTokenFrom(`Bearer ${OPERATOR}`)).toBeNull();
    expect(sessionTokenFrom('Relay-Session abc123')).toBe('abc123');
    expect(sessionTokenFrom(undefined)).toBeNull();
  });
});

/* ------------------------------------------------------------- grants ---- */

describe('pairing grants are random, short-lived and single-use', () => {
  it('mints unguessable, non-repeating secrets', () => {
    const s = store();
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const g = s.createGrant({ origin: ORIGIN, now: 0 });
      expect(g.secret.length).toBeGreaterThanOrEqual(43);
      expect(seen.has(g.secret)).toBe(false);
      seen.add(g.secret);
    }
  });

  it('expires quickly and fails closed afterwards', () => {
    const s = store();
    const g = s.createGrant({ origin: ORIGIN, now: 0 });
    expect(g.expiresAt).toBe(GRANT_TTL_MS);
    const late = s.consumeGrant({
      grantId: g.grantId, secret: g.secret, origin: ORIGIN, now: GRANT_TTL_MS + 1,
    });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.reason).toBe('expired');
  });

  it('cannot be replayed once consumed', () => {
    const s = store();
    const g = s.createGrant({ origin: ORIGIN, now: 0 });
    expect(s.consumeGrant({ grantId: g.grantId, secret: g.secret, origin: ORIGIN, now: 1 }).ok).toBe(true);
    const replay = s.consumeGrant({ grantId: g.grantId, secret: g.secret, origin: ORIGIN, now: 2 });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe('already_consumed');
  });

  it('cannot be redeemed from another origin, even with the right secret', () => {
    const s = store();
    const g = s.createGrant({ origin: ORIGIN, now: 0 });
    const moved = s.consumeGrant({ grantId: g.grantId, secret: g.secret, origin: EVIL, now: 1 });
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.reason).toBe('origin_mismatch');
    // And the grant is still unburned for its rightful origin.
    expect(s.consumeGrant({ grantId: g.grantId, secret: g.secret, origin: ORIGIN, now: 2 }).ok).toBe(true);
  });

  it('rejects a wrong secret', () => {
    const s = store();
    const g = s.createGrant({ origin: ORIGIN, now: 0 });
    const bad = s.consumeGrant({ grantId: g.grantId, secret: 'not-it', origin: ORIGIN, now: 1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('invalid_secret');
  });

  it('stores no plaintext secret anywhere in the store', () => {
    const s = store();
    const g = s.createGrant({ origin: ORIGIN, now: 0 });
    // Nothing reachable from the store serialises back to the secret.
    expect(JSON.stringify(s.size)).not.toContain(g.secret);
    const dumped = JSON.stringify(s, (_k, v) => (v instanceof Map ? [...v] : v));
    expect(dumped).not.toContain(g.secret);
  });
});

/* ----------------------------------------------------------- sessions ---- */

describe('browser sessions are scoped, bound and revocable', () => {
  const paired = () => {
    const s = store();
    const g = s.createGrant({ origin: ORIGIN, now: 0 });
    const r = s.consumeGrant({ grantId: g.grantId, secret: g.secret, origin: ORIGIN, now: 1 });
    if (!r.ok) throw new Error('pairing failed');
    return { s, token: r.session.token, session: r.session };
  };

  it('expires automatically', () => {
    const { s, token, session } = paired();
    expect(session.expiresAt).toBe(1 + SESSION_TTL_MS);
    expect(s.verifySession({ token, origin: ORIGIN, now: 2 }).ok).toBe(true);
    const late = s.verifySession({ token, origin: ORIGIN, now: session.expiresAt + 1 });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.reason).toBe('expired');
  });

  it('is bound to the origin it was paired for', () => {
    const { s, token } = paired();
    const moved = s.verifySession({ token, origin: EVIL, now: 2 });
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.reason).toBe('origin_mismatch');
  });

  it('is revocable, and revocation is immediate', () => {
    const { s, token } = paired();
    expect(s.revokeSession({ token, now: 2 })).toBe(true);
    expect(s.verifySession({ token, origin: ORIGIN, now: 3 }).ok).toBe(false);
  });

  it('may READ reviewer state and nothing else', () => {
    expect(browserSessionMayCall('GET', '/reviewer/readiness')).toBe(true);
    expect(browserSessionMayCall('GET', '/reviewer/status/m1')).toBe(true);
    expect(browserSessionMayCall('GET', '/reviewer/inspect/m1')).toBe(true);
    // Everything that spends money or changes a run is operator-only.
    for (const [method, path] of [
      ['POST', '/reviewer/test-connection'], ['POST', '/reviewer/start'],
      ['POST', '/reviewer/retry'], ['POST', '/reviewer/stop/m1'],
      ['POST', '/browser/pair'],
    ] as const) {
      expect(browserSessionMayCall(method, path), `${method} ${path}`).toBe(false);
    }
  });

  it('cannot mint another grant or session', () => {
    const { s, token } = paired();
    const decision = authorizeReviewerCall({
      method: 'POST', path: '/browser/pair', authorization: `Relay-Session ${token}`,
      origin: ORIGIN, env: env(), now: 2, store: s,
    });
    expect(decision.kind).toBe('rejected');
  });
});

/* ------------------------------------------------- authorization gate ---- */

describe('the authorization gate separates operator from browser', () => {
  const s = store();

  it('lets the operator do anything', () => {
    const decision = authorizeReviewerCall({
      method: 'POST', path: '/reviewer/start', authorization: `Bearer ${OPERATOR}`,
      origin: undefined, env: env(), now: 0, store: s,
    });
    expect(decision.kind).toBe('operator');
  });

  it('rejects no credential at all', () => {
    const decision = authorizeReviewerCall({
      method: 'GET', path: '/reviewer/readiness', authorization: undefined,
      origin: ORIGIN, env: env(), now: 0, store: s,
    });
    expect(decision.kind).toBe('rejected');
    if (decision.kind !== 'rejected') return;
    expect(decision.status).toBe(401);
  });

  it('gives an expired session 401, and a scope violation 403', () => {
    const local = store();
    const g = local.createGrant({ origin: ORIGIN, now: 0 });
    const r = local.consumeGrant({ grantId: g.grantId, secret: g.secret, origin: ORIGIN, now: 1 });
    if (!r.ok) throw new Error('pairing failed');
    const auth = `Relay-Session ${r.session.token}`;

    const expired = authorizeReviewerCall({
      method: 'GET', path: '/reviewer/readiness', authorization: auth,
      origin: ORIGIN, env: env(), now: r.session.expiresAt + 1, store: local,
    });
    expect(expired.kind === 'rejected' && expired.status).toBe(401);

    const forbidden = authorizeReviewerCall({
      method: 'POST', path: '/reviewer/start', authorization: auth,
      origin: ORIGIN, env: env(), now: 2, store: local,
    });
    expect(forbidden.kind === 'rejected' && forbidden.status).toBe(403);
  });
});

/* --------------------------------------------------- over real HTTP ------ */

describe('end to end, over a real bridge', () => {
  it('operator pairs, browser reads, browser cannot spend', async () => {
    const base = await boot();
    const { token } = await pair(base);

    // The browser can READ.
    const readable = await fetch(`${base}/relay-api/reviewer/readiness`, {
      headers: { Authorization: `Relay-Session ${token}`, Origin: ORIGIN },
    });
    expect(readable.status).toBe(200);
    const body = await readable.json();
    expect(JSON.stringify(body)).not.toContain(OPERATOR);

    // The browser cannot START a run — that spends money.
    const start = await post(base, '/relay-api/reviewer/start', {
      missionId: 'm1', reviewGeneration: 'r1', requestedHarness: 'hermes',
      idempotencyKey: 'k1', authorized: true,
      limits: { timeoutMs: 1, maxOutputBytes: 1, maxTurns: 1, maxPromptBytes: 1 },
    }, { Authorization: `Relay-Session ${token}`, Origin: ORIGIN });
    expect(start.status).toBe(403);

    // Nor test a connection, which contacts a paid provider.
    const test = await post(base, '/relay-api/reviewer/test-connection', {}, {
      Authorization: `Relay-Session ${token}`, Origin: ORIGIN,
    });
    expect(test.status).toBe(403);
  }, 30_000);

  it('pairing itself requires the operator token', async () => {
    const base = await boot();
    const unauth = await post(base, '/relay-api/browser/pair', { origin: ORIGIN }, { Origin: ORIGIN });
    expect(unauth.status).toBe(401);
    expect(JSON.stringify(await unauth.json())).not.toContain(OPERATOR);
  }, 30_000);

  it('a grant may not target an origin the bridge does not admit', async () => {
    const base = await boot();
    const res = await post(base, '/relay-api/browser/pair', { origin: EVIL }, {
      Authorization: `Bearer ${OPERATOR}`,
    });
    expect(res.status).toBe(422);
  }, 30_000);

  it('a consumed grant cannot be replayed over HTTP', async () => {
    const base = await boot();
    const minted = await post(base, '/relay-api/browser/pair', { origin: ORIGIN }, {
      Authorization: `Bearer ${OPERATOR}`,
    });
    const grant = (await minted.json()).data as { grantId: string; grantSecret: string };
    expect((await post(base, '/relay-api/browser/session', grant, { Origin: ORIGIN })).status).toBe(200);
    const replay = await post(base, '/relay-api/browser/session', grant, { Origin: ORIGIN });
    expect(replay.status).toBe(401);
  }, 30_000);

  it('every pairing failure reads identically — no oracle', async () => {
    const base = await boot();
    const bodies: string[] = [];
    for (const payload of [
      { grantId: 'nope', grantSecret: 'nope' },
      { grantId: 'nope2', grantSecret: 'other' },
    ]) {
      const res = await post(base, '/relay-api/browser/session', payload, { Origin: ORIGIN });
      expect(res.status).toBe(401);
      bodies.push(JSON.stringify(await res.json()));
    }
    expect(new Set(bodies).size).toBe(1);
  }, 30_000);

  it('the CLI operator path is untouched', async () => {
    const base = await boot();
    // No Origin, Bearer operator token — exactly how the CLI calls.
    const res = await fetch(`${base}/relay-api/reviewer/readiness`, {
      headers: { Authorization: `Bearer ${OPERATOR}` },
    });
    expect(res.status).toBe(200);
  }, 30_000);

  it('an unapproved origin is refused before any pairing logic runs', async () => {
    const base = await boot();
    const res = await post(base, '/relay-api/browser/session', { grantId: 'a', grantSecret: 'b' }, {
      Origin: EVIL,
    });
    expect(res.status).toBe(403);
  }, 30_000);

  it('no secret is echoed back in any response', async () => {
    const base = await boot();
    const { token, grantSecret } = await pair(base);
    const res = await fetch(`${base}/relay-api/reviewer/readiness`, {
      headers: { Authorization: `Relay-Session ${token}`, Origin: ORIGIN },
    });
    const text = await res.text();
    expect(text).not.toContain(OPERATOR);
    expect(text).not.toContain(grantSecret);
    expect(text).not.toContain(token);
  }, 30_000);
});
