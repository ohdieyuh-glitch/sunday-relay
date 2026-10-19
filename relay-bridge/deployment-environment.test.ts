import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isProductionDeployment } from './deployment-environment';
import { loadBridgeConfig, productionConfigProblems, productionConfigWarnings } from './config';
import {
  HERMES_MODE_ENV, HERMES_SERVICE_TOKEN_ENV, HERMES_SERVICE_URL_ENV,
  selectHermesMode,
} from './reviewer-harness/hermes/hermes-transport';

/**
 * WHICH GATE ACTUALLY RUNS ON RAILWAY.
 *
 * The trusted-origin gate has two branches, and the more permissive one — dev,
 * loopback accepted with no allowlist — was selected by `NODE_ENV !==
 * 'production'` alone. Railway does not set `NODE_ENV` unless somebody
 * remembers to, so a real deployment could silently take it. Nothing would be
 * logged and no test would fail; the rule the README describes simply would not
 * be the rule running.
 */

const env = (vars: Record<string, string>): NodeJS.ProcessEnv =>
  vars as unknown as NodeJS.ProcessEnv;

describe('production is detected from the platform, not only from NODE_ENV', () => {
  it('NODE_ENV=production is production', () => {
    expect(isProductionDeployment(env({ NODE_ENV: 'production' }))).toBe(true);
  });

  it('a Railway service with NO NODE_ENV is STILL production', () => {
    // The whole point. Railway sets these on every service in every
    // environment, and cannot forget to.
    expect(isProductionDeployment(env({ RAILWAY_ENVIRONMENT: 'production' }))).toBe(true);
    expect(isProductionDeployment(env({ RAILWAY_ENVIRONMENT_NAME: 'staging' }))).toBe(true);
    expect(isProductionDeployment(env({ RAILWAY_SERVICE_ID: 'svc_abc123' }))).toBe(true);
  });

  it('a bare local shell is not production', () => {
    expect(isProductionDeployment(env({}))).toBe(false);
    expect(isProductionDeployment(env({ NODE_ENV: 'development' }))).toBe(false);
    expect(isProductionDeployment(env({ NODE_ENV: 'test' }))).toBe(false);
  });

  it('a blank platform marker is not a platform', () => {
    expect(isProductionDeployment(env({ RAILWAY_ENVIRONMENT: '' }))).toBe(false);
    expect(isProductionDeployment(env({ RAILWAY_ENVIRONMENT: '   ' }))).toBe(false);
  });

  it('NO variable can turn production OFF', () => {
    // A host that can be talked out of being a production host is not one.
    // Every signal is one-way, so adding any other variable cannot downgrade.
    expect(isProductionDeployment(env({
      NODE_ENV: 'development',
      RAILWAY_ENVIRONMENT: 'production',
      RELAY_FORCE_DEV: '1',
    }))).toBe(true);
  });
});

describe('the consequence: the strict gate runs on a Railway deploy', () => {
  it('an unallowlisted origin is refused when only RAILWAY_ENVIRONMENT says production', () => {
    const selection = selectHermesMode({
      env: env({
        [HERMES_MODE_ENV]: 'remote',
        [HERMES_SERVICE_TOKEN_ENV]: 'service-token',
        [HERMES_SERVICE_URL_ENV]: 'http://127.0.0.1:8080',
        RAILWAY_ENVIRONMENT: 'production',
      }),
      // Exactly what the route now passes.
      production: isProductionDeployment(env({ RAILWAY_ENVIRONMENT: 'production' })),
    });
    // Loopback with no allowlist is the DEV concession. On a real deployment it
    // must not apply, and before this change it would have.
    expect(selection.ok, 'the dev loopback concession must not apply on Railway').toBe(false);
  });

  it('the same URL is accepted on a developer machine', () => {
    const selection = selectHermesMode({
      env: env({
        [HERMES_MODE_ENV]: 'remote',
        [HERMES_SERVICE_TOKEN_ENV]: 'service-token',
        [HERMES_SERVICE_URL_ENV]: 'http://127.0.0.1:8080',
      }),
      production: isProductionDeployment(env({})),
    });
    expect(selection.ok).toBe(true);
  });
});

describe('the gate cannot be reached around', () => {
  it('only the transport factory constructs the remote transport', () => {
    /*
     * `createRemoteHermesTransport` is exported and performs no origin check of
     * its own — the check lives in `selectHermesMode`, which
     * `buildHermesTransport` calls first. A second construction site would be a
     * path to the credential that never passes the gate, and nothing in the
     * type system would say so.
     */
    const root = join(__dirname, '..');
    const callers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) continue;
        const source = readFileSync(full, 'utf8');
        // The definition itself and its barrel re-export are not calls.
        if (/createRemoteHermesTransport\s*\(/.test(source)
          && !full.endsWith('remote-transport.ts')) {
          callers.push(full.slice(root.length + 1));
        }
      }
    };
    for (const dir of ['relay-bridge', 'relay-hermes-service', 'src']) walk(join(root, dir));
    expect(callers).toEqual(['relay-bridge/reviewer-harness/hermes/transport-factory.ts']);
  });
});

/* ------------------------------------------- the boot gate, and its blast radius */

/**
 * A FAIL-FAST IS ARMED BY A DECLARATION, NOT BY AN INFERENCE.
 *
 * `productionConfigProblems` is fatal: `server.ts` sets a non-zero exit code
 * and stops, and on a platform that restarts the process that is a crash loop
 * rather than a message. If a Railway marker alone armed it, a service that was
 * running perfectly could start insisting on four variables nobody had been
 * asked for — and the evidence needed to rule that out is not obtainable from
 * outside the deployment. A bridge with NO token answers 401 exactly as one
 * with a token does, because `bearerMatches` refuses an empty configured
 * secret, so an external probe cannot tell the safe case from the outage case.
 *
 * So the two questions are two flags: `production` (inferred, used by
 * everything that fails closed) and `declaredProduction` (declared, and the
 * only thing that can refuse to boot).
 */
describe('the boot refusal is armed by NODE_ENV, never by a host marker', () => {
  const bridgeEnv = (vars: Record<string, string>): NodeJS.ProcessEnv =>
    ({ PORT: '8080', ...vars }) as unknown as NodeJS.ProcessEnv;

  it('a Railway deploy with no NODE_ENV and no token does NOT refuse to boot', () => {
    const raw = bridgeEnv({ RAILWAY_ENVIRONMENT: 'production' });
    const config = loadBridgeConfig(raw);
    expect(config.production, 'fail-closed gates must still see a real deployment').toBe(true);
    expect(config.declaredProduction).toBe(false);
    expect(
      productionConfigProblems(config, raw),
      'a host marker must not be able to crash-loop a running service',
    ).toEqual([]);
  });

  it('and it says so out loud, naming what is therefore not armed', () => {
    const config = loadBridgeConfig(bridgeEnv({ RAILWAY_ENVIRONMENT: 'production' }));
    const warnings = productionConfigWarnings(config);
    expect(warnings.join(' ')).toContain('NODE_ENV');
    expect(warnings.join(' ')).toContain('RELAY_BRIDGE_API_TOKEN');
  });

  it('NODE_ENV=production DOES arm it, and names the missing variable', () => {
    const raw = bridgeEnv({ NODE_ENV: 'production' });
    const problems = productionConfigProblems(loadBridgeConfig(raw), raw);
    expect(problems.join(' ')).toContain('RELAY_BRIDGE_API_TOKEN');
  });

  it('a declared production bridge with its variables set boots clean', () => {
    const raw = bridgeEnv({
      NODE_ENV: 'production',
      RELAY_BRIDGE_API_TOKEN: 'operator-secret',
      RELAY_ALLOWED_ORIGINS: 'https://sunday-relay.vercel.app',
      RELAY_DATA_DIR: '/data',
    });
    expect(productionConfigProblems(loadBridgeConfig(raw), raw)).toEqual([]);
  });

  it('a relative state path names the variable that was actually read', () => {
    const viaDataDir = bridgeEnv({
      NODE_ENV: 'production', RELAY_BRIDGE_API_TOKEN: 't', RELAY_DATA_DIR: 'relative/path',
    });
    expect(productionConfigProblems(loadBridgeConfig(viaDataDir), viaDataDir).join(' '))
      .toContain('RELAY_DATA_DIR');

    const viaStateHome = bridgeEnv({
      NODE_ENV: 'production', RELAY_BRIDGE_API_TOKEN: 't', RELAY_STATE_HOME: 'relative/path',
    });
    // Being told to fix a variable you never set is its own small outage.
    expect(productionConfigProblems(loadBridgeConfig(viaStateHome), viaStateHome).join(' '))
      .toContain('RELAY_STATE_HOME');
  });
});
