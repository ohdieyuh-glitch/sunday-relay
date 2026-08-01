import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBridgeServer, prepareStateRoot } from './server';
import {
  loadBridgeConfig, parseAllowedOrigins, productionConfigProblems, productionConfigWarnings,
} from './config';

/**
 * THE BRIDGE AS A HOSTED SERVICE.
 *
 * These tests cover the four ways a managed deployment goes wrong: it binds
 * the wrong port, it answers health checks with things it should not disclose,
 * it accepts browser calls from anywhere, and it boots without the credentials
 * that make its authenticated routes mean anything.
 *
 * Every request below is real HTTP against a real server. Nothing here needs
 * or reaches a provider.
 */

const ORIGIN = 'https://sunday-relay.vercel.app';
const TOKEN = 'test-only-bridge-token-not-production';

const servers: Server[] = [];
const dirs: string[] = [];
afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    if (s === undefined) continue;
    // undici keeps connections alive, so `close()` alone would never resolve.
    s.closeAllConnections?.();
    await new Promise<void>((r) => s.close(() => r()));
  }
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const workdir = () => {
  const d = mkdtempSync(join(tmpdir(), 'relay-bridge-host-'));
  dirs.push(d);
  return d;
};

/**
 * Boots the real server on an ephemeral port and returns its base URL.
 *
 * Reviewer readiness genuinely probes the installed harness, which is slow and
 * machine-dependent. These tests are about PORT, health, auth and CORS, so the
 * probe is pointed at a path that cannot exist: discovery returns "not
 * installed" immediately and the route's auth behaviour is what gets measured.
 */
async function boot(env: Record<string, string> = {}): Promise<string> {
  vi.stubEnv('RELAY_HERMES_EXECUTABLE', '/nonexistent/relay-hermes-probe');
  // Routes read the LIVE process environment, so the fixture must set it there
  // too — not only in the config object.
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const config = { ...loadBridgeConfig({ ...env } as NodeJS.ProcessEnv), port: 0 };
  const server = createBridgeServer(config, {
    start: () => ({}) as never, get: () => undefined, cancel: () => undefined, retry: () => undefined,
  } as never);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

/* --------------------------------------------------------------- PORT --- */

describe('the bridge binds where a managed host expects', () => {
  it('uses the injected PORT when no Relay-specific port is set', () => {
    expect(loadBridgeConfig({ PORT: '8080' } as NodeJS.ProcessEnv).port).toBe(8080);
  });

  it('lets the Relay-specific port win locally, and keeps the old default', () => {
    expect(loadBridgeConfig({ PORT: '8080', RELAY_BRIDGE_PORT: '9001' } as NodeJS.ProcessEnv).port)
      .toBe(9001);
    expect(loadBridgeConfig({} as NodeJS.ProcessEnv).port).toBe(8790);
  });

  it('binds every interface by default, not loopback', () => {
    expect(loadBridgeConfig({} as NodeJS.ProcessEnv).host).toBe('0.0.0.0');
    expect(loadBridgeConfig({ RELAY_BRIDGE_HOST: '127.0.0.1' } as NodeJS.ProcessEnv).host)
      .toBe('127.0.0.1');
  });
});

/* ------------------------------------------------------------- /health --- */

describe('the public liveness probe discloses nothing', () => {
  it('returns exactly {status:"ok"} with HTTP 200, unauthenticated', async () => {
    const base = await boot({ RELAY_ALLOWED_ORIGINS: ORIGIN, RELAY_BRIDGE_API_TOKEN: TOKEN });
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // The WHOLE body. A new field here is a disclosure decision, not a detail.
    expect(body).toEqual({ status: 'ok' });
  }, 30_000);

  it('leaks no mode, backend URL, host path, token or mission detail', async () => {
    const base = await boot({
      RELAY_ALLOWED_ORIGINS: ORIGIN,
      RELAY_BRIDGE_API_TOKEN: TOKEN,
      RELAY_DATA_DIR: '/data',
      FUSION_BASE_URL: 'https://internal.fusion.example',
    });
    const text = await (await fetch(`${base}/health`)).text();
    for (const secret of [TOKEN, '/data', 'fusion', 'claude', 'sundayMode', 'confirmLive', 'grok']) {
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  }, 30_000);

  it('makes no provider call', async () => {
    const fetchSpy = vi.fn();
    const base = await boot({ RELAY_ALLOWED_ORIGINS: ORIGIN, RELAY_BRIDGE_API_TOKEN: TOKEN });
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (u: string, i?: unknown) => {
      if (!String(u).includes('127.0.0.1')) fetchSpy(u);
      return real(u as never, i as never);
    });
    await fetch(`${base}/health`);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  }, 30_000);
});

/* ------------------------------------------------------- authentication --- */

describe('protected routes stay authenticated in production', () => {
  const readiness = (base: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/relay-api/reviewer/readiness`, { headers });

  it('rejects a missing credential', async () => {
    const base = await boot({ RELAY_ALLOWED_ORIGINS: ORIGIN, RELAY_BRIDGE_API_TOKEN: TOKEN });
    const res = await readiness(base);
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
  }, 30_000);

  it('rejects an invalid credential without saying why', async () => {
    const base = await boot({ RELAY_ALLOWED_ORIGINS: ORIGIN, RELAY_BRIDGE_API_TOKEN: TOKEN });
    const res = await readiness(base, { Authorization: 'Bearer wrong-token-entirely' });
    expect(res.status).toBe(401);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain(TOKEN);
    expect(body).not.toMatch(/length|expired|prefix/i);
  }, 30_000);

  it('accepts a valid credential and answers with sanitized readiness', async () => {
    const base = await boot({ RELAY_ALLOWED_ORIGINS: ORIGIN, RELAY_BRIDGE_API_TOKEN: TOKEN });
    const res = await readiness(base, { Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { harness: string; evidence: Record<string, unknown> } };
    expect(body.data.harness).toBe('hermes');
    // The host's layout never leaves the process, and a local probe can never
    // conclude a model was verified.
    expect(body.data.evidence.binaryPath).toBeNull();
    expect(body.data.evidence.modelVerified).toBe(false);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  }, 30_000);

  it('an authenticated call with NO Origin still works — that is the CLI', async () => {
    const base = await boot({ RELAY_ALLOWED_ORIGINS: ORIGIN, RELAY_BRIDGE_API_TOKEN: TOKEN });
    const res = await readiness(base, { Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
    // No Origin was sent, so no CORS grant is made either.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  }, 30_000);
});

/* ------------------------------------------------------------------ CORS -- */

describe('CORS admits exactly one origin', () => {
  it('parses an allowlist and normalises trailing slashes', () => {
    expect(parseAllowedOrigins('https://a.example, https://b.example/')).toEqual([
      'https://a.example', 'https://b.example',
    ]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('   ')).toEqual([]);
  });

  it('lets the approved origin preflight', async () => {
    const base = await boot({ RELAY_ALLOWED_ORIGINS: ORIGIN, RELAY_BRIDGE_API_TOKEN: TOKEN });
    const res = await fetch(`${base}/relay-api/reviewer/readiness`, {
      method: 'OPTIONS', headers: { Origin: ORIGIN },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    // The Authorization header must be permitted or the CLI/browser cannot authenticate.
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
  }, 30_000);

  it('refuses an unapproved origin, and grants it nothing', async () => {
    const base = await boot({ RELAY_ALLOWED_ORIGINS: ORIGIN, RELAY_BRIDGE_API_TOKEN: TOKEN });
    const pre = await fetch(`${base}/relay-api/reviewer/readiness`, {
      method: 'OPTIONS', headers: { Origin: 'https://evil.example' },
    });
    expect(pre.status).toBe(403);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();

    // And an actual request from that origin never reaches a route, even with
    // a valid credential.
    const res = await fetch(`${base}/relay-api/reviewer/readiness`, {
      headers: { Origin: 'https://evil.example', Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
  }, 30_000);

  it('never echoes a wildcard origin', async () => {
    const base = await boot({ RELAY_ALLOWED_ORIGINS: ORIGIN, RELAY_BRIDGE_API_TOKEN: TOKEN });
    for (const origin of [ORIGIN, 'https://evil.example']) {
      const res = await fetch(`${base}/health`, { headers: { Origin: origin } });
      expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
    }
  }, 30_000);
});

/* ------------------------------------------------- production validation --- */

describe('a production bridge refuses to boot unsafely', () => {
  const prod = (extra: Record<string, string> = {}) => {
    const env = { NODE_ENV: 'production', ...extra } as NodeJS.ProcessEnv;
    return productionConfigProblems(loadBridgeConfig(env), env);
  };

  it('refuses to start without a bridge token — protected routes would be unreachable', () => {
    expect(prod().join(' ')).toContain('RELAY_BRIDGE_API_TOKEN');
  });

  it('starts WITHOUT an origin allowlist or a volume — those are warnings, not crashes', () => {
    // A crash-looping bridge helps nobody. An empty allowlist already means
    // "no browser may call this", which is the safe direction, and a CLI-only
    // deployment is legitimate.
    const env = { NODE_ENV: 'production', RELAY_BRIDGE_API_TOKEN: TOKEN } as NodeJS.ProcessEnv;
    expect(productionConfigProblems(loadBridgeConfig(env), env)).toEqual([]);
    const warnings = productionConfigWarnings(loadBridgeConfig(env)).join(' ');
    expect(warnings).toContain('RELAY_ALLOWED_ORIGINS');
    expect(warnings).toContain('RELAY_DATA_DIR');
  });

  it('reads the hosted volume from RELAY_DATA_DIR, and still honours RELAY_STATE_HOME', () => {
    expect(loadBridgeConfig({ RELAY_DATA_DIR: '/data' } as NodeJS.ProcessEnv).stateRoot).toBe('/data');
    expect(loadBridgeConfig({ RELAY_STATE_HOME: '/legacy' } as NodeJS.ProcessEnv).stateRoot).toBe('/legacy');
    // The hosted variable wins when both are present.
    expect(loadBridgeConfig({ RELAY_DATA_DIR: '/data', RELAY_STATE_HOME: '/legacy' } as NodeJS.ProcessEnv)
      .stateRoot).toBe('/data');
  });

  it('refuses a wildcard origin outright', () => {
    expect(prod({
      RELAY_BRIDGE_API_TOKEN: TOKEN, RELAY_ALLOWED_ORIGINS: '*', RELAY_STATE_HOME: '/data',
    }).join(' ')).toContain('never permitted');
  });

  it('requires an absolute state root', () => {
    expect(prod({
      RELAY_BRIDGE_API_TOKEN: TOKEN, RELAY_ALLOWED_ORIGINS: ORIGIN, RELAY_DATA_DIR: 'data',
    }).join(' ')).toContain('absolute');
  });

  it('is satisfied by a complete production configuration', () => {
    expect(prod({
      RELAY_BRIDGE_API_TOKEN: TOKEN, RELAY_ALLOWED_ORIGINS: ORIGIN,
      RELAY_DATA_DIR: '/data', PORT: '8080',
    })).toEqual([]);
  });

  it('names variables only — a problem list never carries a value', () => {
    const problems = prod({ RELAY_ALLOWED_ORIGINS: ORIGIN, RELAY_DATA_DIR: '/data' }).join(' ');
    expect(problems).not.toContain(TOKEN);
  });

  it('leaves development alone', () => {
    expect(productionConfigProblems(loadBridgeConfig({} as NodeJS.ProcessEnv), {} as NodeJS.ProcessEnv))
      .toEqual([]);
  });
});

/* ------------------------------------------------------- durable storage --- */

describe('the mounted volume is proven usable at startup', () => {
  it('creates the directory owner-only and confirms it is writable', () => {
    const root = join(workdir(), 'data');
    expect(prepareStateRoot(root)).toEqual({ ok: true });
    expect(existsSync(root)).toBe(true);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    // The write probe cleans up after itself.
    expect(existsSync(join(root, '.relay-write-probe'))).toBe(false);
  });

  it('survives a restart — an existing directory is reused, not replaced', () => {
    const root = join(workdir(), 'data');
    expect(prepareStateRoot(root)).toEqual({ ok: true });
    const marker = join(root, 'mission-state.json');
    writeFileSync(marker, '{"kept":true}');
    // Second boot, same volume: the directory is reused and state survives.
    expect(prepareStateRoot(root)).toEqual({ ok: true });
    expect(readFileSync(marker, 'utf8')).toBe('{"kept":true}');
  });

  it('blocks startup when the volume is unusable, without naming the path', () => {
    // A regular FILE where the directory should be: mkdir fails immediately
    // with ENOTDIR, which is the fast, portable way to prove the guard.
    const blocker = join(workdir(), 'not-a-directory');
    writeFileSync(blocker, 'x');
    const root = join(blocker, 'data');
    const result = prepareStateRoot(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).not.toContain(root);
    expect(result.reason).toContain('not writable');
  });

  it('is a no-op when no volume is configured', () => {
    expect(prepareStateRoot(null)).toEqual({ ok: true });
  });
});

/* ------------------------------------------------------------- no secrets -- */

describe('nothing leaks into the deployment log', () => {
  it('the startup line names no token, origin content or state path', () => {
    const source = readFileSync(join(process.cwd(), 'relay-bridge/server.ts'), 'utf8');
    const startup = source.slice(source.indexOf('Relay bridge listening on'), source.indexOf('Relay bridge listening on') + 700);
    expect(startup).toContain('allowedOrigins.length');
    expect(startup).not.toMatch(/RELAY_BRIDGE_API_TOKEN\s*\}/);
    expect(startup).not.toContain('stateRoot}');
    expect(startup).not.toContain('fusionBaseUrl');
  });

  it('the bridge requires no provider credential to start', () => {
    const env = {
      NODE_ENV: 'production', RELAY_BRIDGE_API_TOKEN: TOKEN,
      RELAY_ALLOWED_ORIGINS: ORIGIN, RELAY_DATA_DIR: '/data',
    } as NodeJS.ProcessEnv;
    expect(productionConfigProblems(loadBridgeConfig(env), env)).toEqual([]);
    // No provider key is named anywhere in the requirement list.
    for (const key of ['XAI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROK_API_KEY']) {
      expect(productionConfigProblems(loadBridgeConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
        { NODE_ENV: 'production' } as NodeJS.ProcessEnv).join(' ')).not.toContain(key);
    }
  });
});
