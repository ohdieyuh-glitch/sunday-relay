import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeStartup, loadServiceConfig, DEFAULT_HOST } from './config';
import {
  handleServiceRoute, lifecycleState, setLifecycleState, parseReviewBody, bearerMatches,
  SERVICE_LIMIT_CEILINGS, SERVICE_MAX_TURNS,
} from './service';

/**
 * Service configuration and boundaries. Everything offline; no provider, no
 * network, no spawn.
 */

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

const FULL_XAI = {
  RELAY_HERMES_SERVICE_TOKEN: 'svc-token',
  RELAY_HERMES_PROVIDER: 'xai',
  RELAY_HERMES_MODEL: 'grok-4',
  XAI_API_KEY: 'xai-secret',
};
const FULL_ANTHROPIC = {
  RELAY_HERMES_SERVICE_TOKEN: 'svc-token',
  RELAY_HERMES_PROVIDER: 'anthropic',
  RELAY_HERMES_MODEL: 'claude-sonnet-5',
  ANTHROPIC_API_KEY: 'sk-ant-secret',
};

const without = (base: Record<string, string>, key: string) => {
  const copy = { ...base };
  delete copy[key];
  return copy;
};

describe('the service refuses to start on incomplete configuration', () => {
  it('accepts a complete xAI configuration', () => {
    const r = loadServiceConfig(env(FULL_XAI));
    expect(r.ok).toBe(true);
    expect(r.ok && r.config.provider.provider).toBe('xai');
    expect(r.ok && r.config.host).toBe(DEFAULT_HOST);
  });

  it('accepts a complete Anthropic configuration', () => {
    const r = loadServiceConfig(env(FULL_ANTHROPIC));
    expect(r.ok && r.config.provider.provider).toBe('anthropic');
  });

  it('requires a service token, and will not start unauthenticated', () => {
    for (const token of ['', '   ']) {
      const r = loadServiceConfig(env({ ...FULL_XAI, RELAY_HERMES_SERVICE_TOKEN: token }));
      expect(r.ok, JSON.stringify(token)).toBe(false);
      expect(r.ok === false && r.problems.join(' ')).toContain('RELAY_HERMES_SERVICE_TOKEN');
    }
    expect(loadServiceConfig(env(without(FULL_XAI, 'RELAY_HERMES_SERVICE_TOKEN'))).ok).toBe(false);
  });

  it('requires an explicit provider and model', () => {
    expect(loadServiceConfig(env(without(FULL_XAI, 'RELAY_HERMES_PROVIDER'))).ok).toBe(false);
    expect(loadServiceConfig(env(without(FULL_XAI, 'RELAY_HERMES_MODEL'))).ok).toBe(false);
  });

  it('rejects a malformed provider without echoing it', () => {
    const r = loadServiceConfig(env({ ...FULL_XAI, RELAY_HERMES_PROVIDER: 'google' }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.problems.join(' ')).not.toContain('google');
  });

  it('never infers the provider from whichever credential happens to be set', () => {
    // The whole point: an xAI key present does not make xAI the provider.
    const onlyKey = loadServiceConfig(env({
      RELAY_HERMES_SERVICE_TOKEN: 't', RELAY_HERMES_MODEL: 'm', XAI_API_KEY: 'xai-secret',
    }));
    expect(onlyKey.ok).toBe(false);
    const onlyAnthropic = loadServiceConfig(env({
      RELAY_HERMES_SERVICE_TOKEN: 't', RELAY_HERMES_MODEL: 'm', ANTHROPIC_API_KEY: 'sk-ant',
    }));
    expect(onlyAnthropic.ok).toBe(false);
  });

  it('requires the credential matching the configured provider, and no other', () => {
    // An Anthropic key does not satisfy an xAI service.
    const crossed = loadServiceConfig(env({
      ...without(FULL_XAI, 'XAI_API_KEY'), ANTHROPIC_API_KEY: 'sk-ant-secret',
    }));
    expect(crossed.ok).toBe(false);
    expect(crossed.ok === false && crossed.problems.join(' ')).toContain('XAI_API_KEY');

    // And an xAI key does not satisfy an Anthropic service.
    const other = loadServiceConfig(env({
      ...without(FULL_ANTHROPIC, 'ANTHROPIC_API_KEY'), XAI_API_KEY: 'xai-secret',
    }));
    expect(other.ok).toBe(false);
    expect(other.ok === false && other.problems.join(' ')).toContain('ANTHROPIC_API_KEY');
  });

  it('rejects an unusable PORT', () => {
    for (const port of ['0', '-1', 'abc', '70000', '8.5']) {
      expect(loadServiceConfig(env({ ...FULL_XAI, PORT: port })).ok, port).toBe(false);
    }
    expect(loadServiceConfig(env({ ...FULL_XAI, PORT: '8080' })).ok).toBe(true);
  });

  it('reports every problem at once rather than one per restart', () => {
    const r = loadServiceConfig(env({}));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.problems.length).toBeGreaterThan(1);
  });
});

describe('the startup line is safe to put in a platform log', () => {
  const config = () => {
    const r = loadServiceConfig(env(FULL_ANTHROPIC));
    if (!r.ok) throw new Error('expected config');
    return r.config;
  };

  it('names the provider and model but no credential', () => {
    const line = describeStartup(config());
    expect(line).toContain('anthropic');
    expect(line).toContain('claude-sonnet-5');
    expect(line).not.toContain('sk-ant');
    expect(line).not.toContain('svc-token');
  });

  it('reports credential and auth as states, never as values or lengths', () => {
    const line = describeStartup(config());
    expect(line).toContain('credential: configured');
    expect(line).toContain('auth: required');
    expect(line).not.toMatch(/length|hash|sha/i);
  });

  it('suppresses the executable path in production', () => {
    const r = loadServiceConfig(env({ ...FULL_ANTHROPIC, RELAY_HERMES_EXECUTABLE: '/opt/secret/hermes', NODE_ENV: 'production' }));
    if (!r.ok) throw new Error('expected config');
    // Host layout does not belong in a production log.
    expect(describeStartup(r.config)).not.toContain('/opt/secret/hermes');
  });
});

describe('health reports lifecycle without disclosing anything else', () => {
  const health = async () => handleServiceRoute({
    method: 'GET', path: '/healthz', authorization: undefined, body: undefined, env: env({}),
  }, {} as never);

  it('is unhealthy before startup completes', async () => {
    setLifecycleState('starting');
    const r = await health();
    expect(r.status).toBe(503);
    expect(r.body.status).toBe('starting');
  });

  it('is healthy once ready, and needs no credential to answer', async () => {
    setLifecycleState('ready');
    const r = await health();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('reports a distinct state while shutting down', async () => {
    setLifecycleState('shutting_down');
    const r = await health();
    expect(r.status).toBe(503);
    expect(r.body.status).toBe('shutting_down');
    setLifecycleState('ready');
  });

  it('discloses no model, credential state, version or path in any state', async () => {
    for (const state of ['starting', 'ready', 'shutting_down'] as const) {
      setLifecycleState(state);
      const s = JSON.stringify((await health()).body);
      expect(s, state).not.toMatch(/model|credential|version|hermes|path|token/i);
    }
    setLifecycleState('ready');
  });
});

describe('draining refuses new work rather than queueing it', () => {
  it('refuses review creation while shutting down', async () => {
    setLifecycleState('shutting_down');
    const r = await handleServiceRoute({
      method: 'POST', path: '/v1/reviews',
      authorization: 'Bearer svc-token', env: env({ RELAY_HERMES_SERVICE_TOKEN: 'svc-token' }),
      body: {
        runId: 'r', idempotencyKey: 'k', prompt: 'p',
        limits: { timeoutMs: 1000, maxOutputBytes: 1000, maxTurns: 1, maxPromptBytes: 1000 },
      },
    }, {} as never);
    expect(r.status).toBe(503);
    expect(r.body.kind).toBe('shutting_down');
    setLifecycleState('ready');
  });

  it('exposes the lifecycle for observability', () => {
    setLifecycleState('ready');
    expect(lifecycleState()).toBe('ready');
  });
});

describe('authentication and schemas', () => {
  it('compares tokens in constant time and rejects near misses', () => {
    expect(bearerMatches('Bearer secret', 'secret')).toBe(true);
    expect(bearerMatches('Bearer secre', 'secret')).toBe(false);
    expect(bearerMatches('Bearer secrets', 'secret')).toBe(false);
    expect(bearerMatches('secret', 'secret')).toBe(false);
    expect(bearerMatches(undefined, 'secret')).toBe(false);
    // A blank expected secret never authenticates anything.
    expect(bearerMatches('Bearer ', '')).toBe(false);
  });

  it('rejects unknown fields instead of ignoring them', () => {
    const r = parseReviewBody({
      runId: 'r', idempotencyKey: 'k', prompt: 'p',
      limits: { timeoutMs: 1, maxOutputBytes: 1, maxTurns: 1, maxPromptBytes: 1 },
      apiKey: 'sk-ant-INJECTED',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects unknown limit fields', () => {
    const r = parseReviewBody({
      runId: 'r', idempotencyKey: 'k', prompt: 'p',
      limits: { timeoutMs: 1, maxOutputBytes: 1, maxTurns: 1, maxPromptBytes: 1, extra: 1 },
    });
    expect(r.ok).toBe(false);
  });
});

/* ------------------------------------------------ browser/server boundary --- */

const REPO = join(__dirname, '..');
/**
 * Shipped source only. Test files are excluded deliberately: a test that
 * asserts `XAI_API_KEY` is absent must itself contain the string, so scanning
 * them would flag the very guards being written here — including an existing
 * UI test that already checks the same thing.
 */
const readAll = (dir: string): string[] => {
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...readAll(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
};

describe('server-only code cannot enter the browser graph', () => {
  const frontend = readAll(join(REPO, 'src', 'relay', 'ui'));

  it('finds frontend modules to check', () => {
    expect(frontend.length).toBeGreaterThan(0);
  });

  it('no frontend module imports the Hermes service, transports or process code', () => {
    for (const file of frontend) {
      const src = readFileSync(file, 'utf8');
      for (const forbidden of [
        'relay-hermes-service', 'local-transport', 'remote-transport',
        'reviewer-harness/hermes', 'node:child_process',
      ]) {
        expect(src.includes(forbidden), `${file} references ${forbidden}`).toBe(false);
      }
    }
  });

  it('no frontend module names a provider or service credential', () => {
    for (const file of frontend) {
      const src = readFileSync(file, 'utf8');
      for (const secret of ['XAI_API_KEY', 'ANTHROPIC_API_KEY', 'RELAY_HERMES_SERVICE_TOKEN']) {
        expect(src.includes(secret), `${file} names ${secret}`).toBe(false);
      }
    }
  });

  it('no VITE_ variable exposes a provider key or the service token', () => {
    for (const file of [...frontend, ...readAll(join(REPO, 'relay-hermes-service'))]) {
      const src = readFileSync(file, 'utf8');
      for (const banned of ['VITE_XAI_API_KEY', 'VITE_ANTHROPIC_API_KEY', 'VITE_RELAY_HERMES_SERVICE_TOKEN']) {
        expect(src.includes(banned), `${file} declares ${banned}`).toBe(false);
      }
    }
  });

  it('keeps the remote transport lazily separated from local process code', () => {
    // A static import would pull child_process into every bundle, including
    // remote-mode production ones that must never be able to spawn.
    const factory = readFileSync(
      join(REPO, 'relay-bridge', 'reviewer-harness', 'hermes', 'transport-factory.ts'), 'utf8',
    );
    expect(factory).toContain("await import('./local-transport')");
    expect(/^import .*local-transport/m.test(factory), 'local transport must not be statically imported').toBe(false);
  });
});

/**
 * SERVER-AUTHORITATIVE RUN CEILINGS.
 *
 * The service owns the provider credential and pays for every run, so it is
 * the trust boundary — not the bridge. Limits used to be accepted with only a
 * `> 0` check and then merged OVER the runner's defaults, so an authenticated
 * caller could ask for a 24-hour wall clock and a 1 GB output cap and get it.
 */
describe('the service clamps run limits to its own ceilings', () => {
  const body = (limits: Record<string, unknown>) => ({
    runId: 'r1', idempotencyKey: 'k1', prompt: 'review', limits,
  });
  const sane = {
    timeoutMs: 1_000, maxOutputBytes: 1_000, maxTurns: 1, maxPromptBytes: 1_000,
  };

  it('clamps a 24-hour timeout to the service ceiling', () => {
    const r = parseReviewBody(body({ ...sane, timeoutMs: 86_400_000 }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('should parse');
    expect(r.value.limits.timeoutMs).toBe(SERVICE_LIMIT_CEILINGS.timeoutMs);
    expect(r.value.limits.timeoutMs).toBeLessThan(86_400_000);
  });

  it('clamps a 1 GB output request to the service ceiling', () => {
    const r = parseReviewBody(body({ ...sane, maxOutputBytes: 1_073_741_824 }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('should parse');
    expect(r.value.limits.maxOutputBytes).toBe(SERVICE_LIMIT_CEILINGS.maxOutputBytes);
  });

  it('clamps an oversized prompt ceiling', () => {
    const r = parseReviewBody(body({ ...sane, maxPromptBytes: 50_000_000 }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('should parse');
    expect(r.value.limits.maxPromptBytes).toBe(SERVICE_LIMIT_CEILINGS.maxPromptBytes);
  });

  it('leaves a modest request exactly as asked', () => {
    const r = parseReviewBody(body(sane));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('should parse');
    expect(r.value.limits).toEqual(sane);
  });

  it('rejects zero, negative, fractional, NaN and overflowing values', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1e308 * 10, Number.MAX_SAFE_INTEGER + 2]) {
      const r = parseReviewBody(body({ ...sane, timeoutMs: bad }));
      expect(r.ok, `timeoutMs ${String(bad)} must be rejected`).toBe(false);
    }
  });

  it('rejects a numeric string rather than coercing it into a bound', () => {
    expect(parseReviewBody(body({ ...sane, timeoutMs: '1000' })).ok).toBe(false);
  });

  /**
   * The adapter runs Hermes with `-z/--oneshot`: one prompt, one final
   * response. There is no turn-limit flag, and the isolated profile pins
   * `agent.max_turns: 1`. Accepting 50 and silently running one turn would be
   * a control that exists only in the request.
   */
  it('refuses any turn count other than the one-shot contract', () => {
    for (const turns of [2, 5, 50, 10_000]) {
      const r = parseReviewBody(body({ ...sane, maxTurns: turns }));
      expect(r.ok, `maxTurns ${turns} must be refused, not silently ignored`).toBe(false);
      if (!r.ok) expect(r.message).toContain('one-shot');
    }
    expect(parseReviewBody(body({ ...sane, maxTurns: SERVICE_MAX_TURNS })).ok).toBe(true);
  });

  it('reports the EFFECTIVE limits back, so a caller never assumes it got what it asked for', async () => {
    setLifecycleState('ready');
    const seen: { limits?: unknown } = {};
    const engine = {
      mode: 'local' as const,
      readiness: async () => { throw new Error('unused'); },
      testConnection: async () => { throw new Error('unused'); },
      startReview: async (input: { limits: unknown }) => {
        seen.limits = input.limits;
        return { accepted: true, runId: 'r1', duplicate: false, failureKind: null, safeMessage: null };
      },
      getReview: async () => { throw new Error('unused'); },
      cancelReview: async () => { throw new Error('unused'); },
    };
    const res = await handleServiceRoute({
      method: 'POST', path: '/v1/reviews', authorization: 'Bearer t',
      body: body({ ...sane, timeoutMs: 86_400_000 }),
      env: { RELAY_HERMES_SERVICE_TOKEN: 't' } as NodeJS.ProcessEnv,
    }, engine as never);
    expect(res.status).toBe(200);
    const returned = (res.body as { limits: { timeoutMs: number } }).limits;
    expect(returned.timeoutMs).toBe(SERVICE_LIMIT_CEILINGS.timeoutMs);
    // And the RUNNER received the clamped value, not the requested one.
    expect((seen.limits as { timeoutMs: number }).timeoutMs).toBe(SERVICE_LIMIT_CEILINGS.timeoutMs);
  });
});
