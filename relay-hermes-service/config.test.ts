import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeStartup, loadServiceConfig, DEFAULT_HOST } from './config';
import {
  handleServiceRoute, lifecycleState, setLifecycleState, parseReviewBody, bearerMatches,
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
