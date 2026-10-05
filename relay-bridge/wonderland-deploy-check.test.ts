import { describe, expect, it } from 'vitest';

import {
  DEPLOY_CHECK_FOREIGN_ORIGIN, DEPLOY_CHECKS, judgeDeploy, readDeployFacts, type DeployFacts,
} from '../scripts/wonderland-deploy-check.mjs';
import type { R16Backend } from '../scripts/wonderland-r16-harness.mjs';

/**
 * THE DEPLOY CHECK, JUDGED AND READ. Pure cases: the judge is held by a table,
 * one hosted, ready baseline, then one fact changed per row, failing exactly
 * its own check. The reader is held to GET alone. The real bridge process is
 * checked in `wonderland-hosted-store.real-postgres.test.ts`.
 */

const SHA = 'c'.repeat(40);
const ORIGIN = 'https://sunday-relay.vercel.app';
type ReadableBackend = Extract<R16Backend, { readonly readable: true }>;
const BACKEND: ReadableBackend = {
  readable: true, commit: SHA, attestedBy: 'RAILWAY_GIT_COMMIT_SHA', production: true, bootId: '9'.repeat(32), startedAt: '2026-10-05T01:00:00.000Z',
  database: 'CONNECTED', ledger: { through: '033_wonderland_social', pending: [], gapFree: true, unknown: [] }, social: 'READY',
};
const READY: DeployFacts = {
  origin: ORIGIN,
  health: { status: 200, body: { status: 'ok' }, allowOrigin: null },
  unauthenticated: { status: 401, body: { error: {} }, allowOrigin: null },
  foreign: { status: 403, body: { error: 'origin not allowed' }, allowOrigin: null },
  allowed: { status: 200, body: { status: 'ok' }, allowOrigin: ORIGIN },
  backend: BACKEND,
  host: { https: true, kind: 'NAME', resolves: 'PUBLIC' },
  reported: { voiceSchema: 'NOT_APPLIED', eosClientConfig: 'NOT_CONFIGURED', eosTrustedServer: 'NOT_CONFIGURED' },
};
const failing = (facts: DeployFacts, expectCommit = SHA) => judgeDeploy(facts, expectCommit).filter((row) => row.result === 'FAIL').map((row) => row.name);

describe('the deploy check, one fact at a time', () => {
  it('a hosted, ready, closed bridge on the expected build passes every check, in the closed list\'s order', () => {
    const rows = judgeDeploy(READY, SHA);
    expect(rows.map((row) => row.name)).toEqual([...DEPLOY_CHECKS]);
    expect(rows.every((row) => row.result === 'PASS' && row.detail === '')).toBe(true);
  });

  const [HEALTH, HOSTED, OPERATOR_ONLY, CORS, BUILD, PRODUCTION, STORE, SOCIAL] = DEPLOY_CHECKS;
  const ROWS: ReadonlyArray<readonly [string, DeployFacts, readonly (string | undefined)[], string?]> = [
    ['a liveness probe that says more than ok', { ...READY, health: { ...READY.health, body: { status: 'ok', commit: SHA } } }, [HEALTH]],
    ['a liveness probe that is down', { ...READY, health: { status: 503, body: null, allowOrigin: null } }, [HEALTH]],
    ['plain HTTP', { ...READY, host: { ...READY.host, https: false } }, [HOSTED]],
    ['a loopback host', { ...READY, host: { https: true, kind: 'LOOPBACK', resolves: 'NOT_PUBLIC' } }, [HOSTED]],
    ['a name resolving to a private address', { ...READY, host: { ...READY.host, resolves: 'NOT_PUBLIC' } }, [HOSTED]],
    ['a name that does not resolve', { ...READY, host: { ...READY.host, resolves: 'UNRESOLVED' } }, [HOSTED]],
    ['a readiness report anyone can read', { ...READY, unauthenticated: { status: 200, body: {}, allowOrigin: null } }, [OPERATOR_ONLY]],
    ['a foreign origin let through', { ...READY, foreign: { status: 200, body: { status: 'ok' }, allowOrigin: null } }, [CORS]],
    ['a foreign origin echoed', { ...READY, foreign: { ...READY.foreign, allowOrigin: DEPLOY_CHECK_FOREIGN_ORIGIN } }, [CORS]],
    ['the allowed origin refused', { ...READY, allowed: { status: 403, body: null, allowOrigin: null } }, [CORS]],
    ['a wildcard answered for the allowed origin', { ...READY, allowed: { ...READY.allowed, allowOrigin: '*' } }, [CORS]],
    ['no attested commit', { ...READY, backend: { ...BACKEND, commit: null, attestedBy: null } }, [BUILD]],
    ['another commit', { ...READY, backend: { ...BACKEND, commit: 'd'.repeat(40) } }, [BUILD]],
    ['the development branch', { ...READY, backend: { ...BACKEND, production: false } }, [PRODUCTION]],
    ['no database', { ...READY, backend: { ...BACKEND, database: 'NOT_CONFIGURED', ledger: null } }, [STORE]],
    ['a pending stamp', { ...READY, backend: { ...BACKEND, ledger: { ...BACKEND.ledger!, pending: ['033_wonderland_social'] } } }, [STORE]],
    ['a gap', { ...READY, backend: { ...BACKEND, ledger: { ...BACKEND.ledger!, gapFree: false } } }, [STORE]],
    ['a stamp from a later build', { ...READY, backend: { ...BACKEND, ledger: { ...BACKEND.ledger!, unknown: ['099_future'] } } }, [STORE]],
    ['social not applied', { ...READY, backend: { ...BACKEND, social: 'NOT_APPLIED' } }, [SOCIAL]],
    ['the report unread', { ...READY, backend: { readable: false, reason: 'REFUSED_401' } }, [BUILD, PRODUCTION, STORE, SOCIAL]],
  ];
  for (const [label, facts, checks] of ROWS) {
    it(`${label} fails exactly ${checks.map((name) => String(name).split(':')[0]).join(', ')}`, () => {
      expect(failing(facts)).toEqual(checks);
    });
  }

  it('the expected commit is the one judged, not whichever the bridge reports', () => {
    expect(failing(READY, 'd'.repeat(40))).toEqual([BUILD]);
  });

  it('every check in the closed list can fail, and each row says what it saw', () => {
    expect(new Set(ROWS.flatMap(([, , checks]) => checks))).toEqual(new Set(DEPLOY_CHECKS));
    for (const [, facts] of ROWS) {
      for (const row of judgeDeploy(facts, SHA)) expect(row.result === 'PASS' || row.detail.length > 10).toBe(true);
    }
  });
});

describe('the reader sends GETs only, and the probes it says it sends', () => {
  it('reads the root liveness probe, the report with and without the token, and the probe from a foreign and an allowed origin', async () => {
    const seen: Array<{ url: string; method: string; origin: string | null; authorization: string | null }> = [];
    const fake = (async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      const headers = init?.headers ?? {};
      seen.push({ url: String(url), method: init?.method ?? 'GET', origin: headers.origin ?? null, authorization: headers.authorization ?? null });
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/wonderland/readiness')) {
        return headers.authorization === 'Bearer operator'
          ? Response.json({ data: { database: { state: 'CONNECTED' }, ledger: BACKEND.ledger, surfaces: { social: 'READY', voiceSchema: 'NOT_APPLIED', eosClientConfig: 'CONFIGURED', eosTrustedServer: 'NOT_CONFIGURED' }, bridge: { commit: SHA, attestedBy: 'RAILWAY_GIT_COMMIT_SHA', production: true, bootId: BACKEND.bootId, startedAt: BACKEND.startedAt } } })
          : Response.json({ error: {} }, { status: 401 });
      }
      if (headers.origin === DEPLOY_CHECK_FOREIGN_ORIGIN) return Response.json({ error: 'origin not allowed' }, { status: 403 });
      return Response.json({ status: 'ok' }, { headers: headers.origin === undefined ? {} : { 'access-control-allow-origin': headers.origin } });
    }) as unknown as typeof fetch;
    const facts = await readDeployFacts({
      bridge: 'https://bridge.relay.example.org/relay-api', origin: ORIGIN, operatorToken: 'operator', fetch: fake, resolve: async () => ['104.16.1.1'],
    });
    expect(seen.every((call) => call.method === 'GET'), 'nothing but GET').toBe(true);
    expect(seen.map((call) => [call.url, call.origin, call.authorization === null ? null : 'Bearer'])).toEqual([
      ['https://bridge.relay.example.org/health', null, null],
      ['https://bridge.relay.example.org/relay-api/wonderland/readiness', null, null],
      ['https://bridge.relay.example.org/health', DEPLOY_CHECK_FOREIGN_ORIGIN, null],
      ['https://bridge.relay.example.org/health', ORIGIN, null],
      ['https://bridge.relay.example.org/relay-api/wonderland/readiness', null, 'Bearer'],
      ['https://bridge.relay.example.org/relay-api/wonderland/readiness', null, 'Bearer'],
    ]);
    expect(judgeDeploy(facts, SHA).every((row) => row.result === 'PASS')).toBe(true);
    expect(facts.reported).toEqual({ voiceSchema: 'NOT_APPLIED', eosClientConfig: 'CONFIGURED', eosTrustedServer: 'NOT_CONFIGURED' });
  });

  it('a bridge that cannot be reached is a status of 0 everywhere, never an exception', async () => {
    const down = (async () => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch;
    const facts = await readDeployFacts({ bridge: 'https://bridge.relay.example.org', origin: ORIGIN, operatorToken: 'operator', fetch: down, resolve: async () => ['104.16.1.1'] });
    expect([facts.health.status, facts.unauthenticated.status, facts.foreign.status, facts.allowed.status]).toEqual([0, 0, 0, 0]);
    expect(facts.backend).toEqual({ readable: false, reason: 'UNREACHABLE' });
    expect(facts.reported).toEqual({ voiceSchema: 'UNKNOWN', eosClientConfig: 'UNKNOWN', eosTrustedServer: 'UNKNOWN' });
  });
});
