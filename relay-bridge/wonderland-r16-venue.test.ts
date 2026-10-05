import { describe, expect, it } from 'vitest';

import {
  classifyR16Host, inspectR16Host, judgeR16Venue, R16_RESTART_CHECK, R16_VENUE_REASONS, r16RestartCheck, readR16Backend, resolveR16Host,
  type R16Backend, type R16Host, type R16VenueReason,
} from '../scripts/wonderland-r16-harness.mjs';

/**
 * R16'S VENUE, JUDGED APART FROM ITS CHECKS. Pure cases: the harness judges
 * facts it is handed. `wonderland-hosted-store.real-postgres.test.ts` runs the
 * same judgement against the real bridge process.
 *
 * The judge is held by a table: one HOSTED_FINAL baseline, then one fact
 * changed per row, each producing exactly its own reason. A reason whose
 * condition were dropped or widened fails its row or the baseline.
 */

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const BRIDGE = 'https://wonderland.relay.example.org';
const PUBLIC_HOST: R16Host = { https: true, kind: 'NAME', resolves: 'PUBLIC' };
type ReadableBackend = Extract<R16Backend, { readonly readable: true }>;
const BACKEND: ReadableBackend = {
  readable: true, commit: SHA, attestedBy: 'RAILWAY_GIT_COMMIT_SHA', production: true, bootId: '1'.repeat(32), startedAt: '2026-10-04T10:00:00.000Z',
  database: 'CONNECTED', ledger: { through: '033_wonderland_social', pending: [], gapFree: true, unknown: [] }, social: 'READY',
};
const SIGNED_IN = { source: 'SIGNED_IN' as const, names: { r16a: 'ada', r16b: 'ben', r16c: 'cy' } };
const scenario = (change: Partial<Parameters<typeof judgeR16Venue>[0]> = {}) => judgeR16Venue({
  phase: 'scenario', bridge: BRIDGE, host: PUBLIC_HOST, identities: SIGNED_IN, backend: BACKEND, expectCommit: SHA, ...change,
});
const RECORDED = { bridge: BRIDGE, backend: BACKEND, venue: { venue: 'HOSTED_FINAL' } };
const RESTARTED: ReadableBackend = { ...BACKEND, bootId: '2'.repeat(32), startedAt: '2026-10-04T10:05:00.000Z' };
const verify = (change: Partial<Parameters<typeof judgeR16Venue>[0]> = {}) => judgeR16Venue({
  phase: 'verify', bridge: BRIDGE, host: PUBLIC_HOST, identities: { source: 'SIGNED_IN', names: null }, backend: RESTARTED, expectCommit: SHA,
  recorded: RECORDED, ...change,
});

describe('the host, as it names itself', () => {
  it('loopback, private, link-local, unspecified and local names are machines; a public address or a name to resolve may be hosted', () => {
    const cases: Record<string, string> = {
      '127.0.0.1': 'LOOPBACK', '127.8.9.10': 'LOOPBACK', '[::1]': 'LOOPBACK', '::ffff:127.0.0.1': 'LOOPBACK',
      '10.1.2.3': 'PRIVATE', '172.16.0.1': 'PRIVATE', '172.31.255.255': 'PRIVATE', '192.168.1.20': 'PRIVATE', '100.64.0.1': 'PRIVATE', 'fd12::1': 'PRIVATE', '[fc00::5]': 'PRIVATE',
      '169.254.10.10': 'LINK_LOCAL', 'fe80::1': 'LINK_LOCAL',
      '0.0.0.0': 'UNSPECIFIED', '::': 'UNSPECIFIED',
      localhost: 'LOCAL_NAME', 'LOCALHOST': 'LOCAL_NAME', 'bridge.localhost': 'LOCAL_NAME', 'founder-laptop': 'LOCAL_NAME', 'nas.local': 'LOCAL_NAME',
      'bridge.internal': 'LOCAL_NAME', 'router.lan': 'LOCAL_NAME', 'box.home.arpa': 'LOCAL_NAME', 'relay.test': 'LOCAL_NAME',
      '172.15.0.1': 'PUBLIC_ADDRESS', '172.32.0.1': 'PUBLIC_ADDRESS', '100.128.0.1': 'PUBLIC_ADDRESS', '8.8.8.8': 'PUBLIC_ADDRESS', '2606:4700::1111': 'PUBLIC_ADDRESS',
      'sunday-relay-production-7d60.up.railway.app': 'NAME', 'wonderland.relay.example.org.': 'NAME',
    };
    for (const [host, kind] of Object.entries(cases)) expect({ host, kind: classifyR16Host(host) }).toEqual({ host, kind });
  });

  it('a name is public only when everything it resolves to is; a name that does not resolve is not shown to be public', async () => {
    const resolvingTo = (addresses: readonly string[]) => async () => addresses;
    expect(await inspectR16Host(BRIDGE, resolvingTo(['104.16.1.1', '2606:4700::6810']))).toEqual({ https: true, kind: 'NAME', resolves: 'PUBLIC' });
    expect(await inspectR16Host(BRIDGE, resolvingTo(['104.16.1.1', '10.0.0.7']))).toEqual({ https: true, kind: 'NAME', resolves: 'NOT_PUBLIC' });
    expect(await inspectR16Host(BRIDGE, resolvingTo(['127.0.0.1']))).toMatchObject({ resolves: 'NOT_PUBLIC' });
    expect(await inspectR16Host(BRIDGE, resolvingTo([]))).toMatchObject({ resolves: 'UNRESOLVED' });
    expect(await inspectR16Host(BRIDGE, async () => { throw new Error('ENOTFOUND'); })).toMatchObject({ resolves: 'UNRESOLVED' });
    let asked = 0;
    const counting = async () => { asked += 1; return ['104.16.1.1']; };
    expect(await inspectR16Host('http://127.0.0.1:8787', counting)).toEqual({ https: false, kind: 'LOOPBACK', resolves: 'NOT_PUBLIC' });
    expect(await inspectR16Host('https://8.8.8.8', counting)).toEqual({ https: true, kind: 'PUBLIC_ADDRESS', resolves: 'PUBLIC' });
    expect(asked, 'an address is never looked up').toBe(0);
  });

  it('the CLI\'s resolver answers every address of a name, and this machine\'s own name is loopback through it', async () => {
    const addresses = await resolveR16Host('localhost');
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.map((address) => classifyR16Host(address))).toEqual(addresses.map(() => 'LOOPBACK'));
    expect(await inspectR16Host('https://localhost.', resolveR16Host)).toEqual({ https: true, kind: 'LOCAL_NAME', resolves: 'NOT_PUBLIC' });
  });
});

describe('the venue, one fact at a time', () => {
  it('every fact final is HOSTED_FINAL, with no reason', () => {
    expect(scenario()).toEqual({ venue: 'HOSTED_FINAL', reasons: [] });
    expect(verify()).toEqual({ venue: 'HOSTED_FINAL', reasons: [] });
  });

  const SCENARIO_ROWS: ReadonlyArray<readonly [string, Partial<Parameters<typeof judgeR16Venue>[0]>, readonly R16VenueReason[]]> = [
    ['plain HTTP', { host: { ...PUBLIC_HOST, https: false } }, ['NOT_HTTPS']],
    ['a loopback host', { host: { https: true, kind: 'LOOPBACK', resolves: 'NOT_PUBLIC' } }, ['HOST_NOT_PUBLIC']],
    ['a local name', { host: { https: true, kind: 'LOCAL_NAME', resolves: 'NOT_PUBLIC' } }, ['HOST_NOT_PUBLIC']],
    ['a name resolving to a private address', { host: { ...PUBLIC_HOST, resolves: 'NOT_PUBLIC' } }, ['HOST_RESOLVES_PRIVATE']],
    ['a name that did not resolve', { host: { ...PUBLIC_HOST, resolves: 'UNRESOLVED' } }, ['HOST_UNRESOLVED']],
    ['players paired by the operator, though named', { identities: { ...SIGNED_IN, source: 'SCRIPTED' } }, ['SCRIPTED_PLAYERS']],
    ['a player with no verified sign-in', { identities: { source: 'SIGNED_IN', names: { ...SIGNED_IN.names, r16b: null } } }, ['PLAYERS_NOT_VERIFIED']],
    ['a blank name', { identities: { source: 'SIGNED_IN', names: { ...SIGNED_IN.names, r16c: ' ' } } }, ['PLAYERS_NOT_VERIFIED']],
    ['two players under one sign-in', { identities: { source: 'SIGNED_IN', names: { ...SIGNED_IN.names, r16c: 'ada' } } }, ['PLAYERS_NOT_VERIFIED']],
    ['no names at all', { identities: { source: 'SIGNED_IN', names: null } }, ['PLAYERS_NOT_VERIFIED']],
    ['the backend\'s report unread', { backend: { readable: false, reason: 'NO_OPERATOR_TOKEN' } }, ['READINESS_UNREAD']],
    ['not the production branch', { backend: { ...BACKEND, production: false } }, ['NOT_PRODUCTION']],
    ['the store unreachable', { backend: { ...BACKEND, database: 'UNREACHABLE', ledger: null } }, ['STORE_NOT_CONNECTED']],
    ['a pending stamp', { backend: { ...BACKEND, ledger: { ...BACKEND.ledger!, pending: ['033_wonderland_social'] } } }, ['STORE_NOT_CURRENT']],
    ['a gap', { backend: { ...BACKEND, ledger: { ...BACKEND.ledger!, gapFree: false } } }, ['STORE_NOT_CURRENT']],
    ['a stamp this build does not know', { backend: { ...BACKEND, ledger: { ...BACKEND.ledger!, unknown: ['099_future'] } } }, ['STORE_NOT_CURRENT']],
    ['no ledger read', { backend: { ...BACKEND, ledger: null } }, ['STORE_NOT_CURRENT']],
    ['social not ready', { backend: { ...BACKEND, social: 'NOT_APPLIED' } }, ['SOCIAL_NOT_READY']],
    ['no attested commit', { backend: { ...BACKEND, commit: null, attestedBy: null } }, ['COMMIT_UNKNOWN']],
    ['another commit than expected', { expectCommit: OTHER }, ['COMMIT_NOT_EXPECTED']],
    ['no expected commit', { expectCommit: null }, ['NO_EXPECTED_COMMIT']],
  ];
  for (const [label, change, reasons] of SCENARIO_ROWS) {
    it(`scenario: ${label} is a REHEARSAL for exactly ${reasons.join(', ')}`, () => {
      expect(scenario(change)).toEqual({ venue: 'REHEARSAL', reasons });
    });
  }

  const VERIFY_ROWS: ReadonlyArray<readonly [string, Partial<Parameters<typeof judgeR16Venue>[0]>, readonly R16VenueReason[]]> = [
    ['a scenario that was a rehearsal', { recorded: { ...RECORDED, venue: { venue: 'REHEARSAL' } } }, ['SCENARIO_NOT_FINAL']],
    ['a state file with no venue', { recorded: { bridge: BRIDGE, backend: BACKEND } }, ['SCENARIO_NOT_FINAL']],
    ['the same boot as the scenario', { backend: BACKEND }, ['NOT_RESTARTED']],
    ['no boot recorded', { recorded: { ...RECORDED, backend: { commit: SHA } } }, ['RESTART_UNPROVEN']],
    ['the report unread after the restart', { backend: { readable: false, reason: 'REFUSED_401' } }, ['READINESS_UNREAD', 'RESTART_UNPROVEN']],
    ['another build after the restart', { backend: { ...RESTARTED, commit: OTHER }, expectCommit: OTHER }, ['BUILD_CHANGED']],
    ['another bridge', { recorded: { ...RECORDED, bridge: 'https://other.relay.example.org' } }, ['BACKEND_CHANGED']],
    ['a state file with no bridge', { recorded: { backend: BACKEND, venue: { venue: 'HOSTED_FINAL' } } }, ['BACKEND_CHANGED']],
    ['paired players after a signed-in scenario', { identities: { source: 'SCRIPTED', names: null } }, ['SCRIPTED_PLAYERS']],
  ];
  for (const [label, change, reasons] of VERIFY_ROWS) {
    it(`verify: ${label} is a REHEARSAL for exactly ${reasons.join(', ')}`, () => {
      expect(verify(change)).toEqual({ venue: 'REHEARSAL', reasons });
    });
  }

  it('the same bridge is the same origin, whatever path the operator typed', () => {
    expect(verify({ bridge: `${BRIDGE}/relay-api` })).toEqual({ venue: 'HOSTED_FINAL', reasons: [] });
  });

  it('every reason the judge can give is in the closed list, with words a reader can act on', () => {
    const named = new Set([...SCENARIO_ROWS, ...VERIFY_ROWS].flatMap(([, , reasons]) => reasons));
    expect([...named].sort()).toEqual(Object.keys(R16_VENUE_REASONS).sort());
    for (const words of Object.values(R16_VENUE_REASONS)) expect(words.length).toBeGreaterThan(20);
  });
});

describe('the restart, as a check', () => {
  it('passes only on a new boot, and says why it fails otherwise', () => {
    expect(r16RestartCheck(BACKEND, RESTARTED)).toEqual({ name: R16_RESTART_CHECK, result: 'PASS', detail: '' });
    expect(r16RestartCheck(BACKEND, BACKEND)).toMatchObject({ result: 'FAIL', detail: expect.stringContaining('did not restart') });
    expect(r16RestartCheck(BACKEND, { readable: false, reason: 'NO_OPERATOR_TOKEN' })).toMatchObject({
      result: 'FAIL', detail: expect.stringContaining('NO_OPERATOR_TOKEN'),
    });
    expect(r16RestartCheck(undefined, RESTARTED)).toMatchObject({ result: 'FAIL', detail: expect.stringContaining('the scenario recorded none') });
  });
});

describe('the backend\'s own report', () => {
  const answering = (status: number, body: unknown) => {
    const seen: Array<{ url: string; authorization: string | null }> = [];
    const fake = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url: String(url), authorization: init?.headers?.authorization ?? null });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { fake, seen };
  };

  it('is read as the operator from the readiness route, and kept to what the venue judges', async () => {
    const { fake, seen } = answering(200, {
      data: {
        version: 'wonderland-store-readiness.v1', database: { state: 'CONNECTED' },
        ledger: { applied: 32, expected: 32, through: '033_wonderland_social', pending: [], gapFree: true, unknown: [] },
        surfaces: { social: 'READY', voiceSchema: 'NOT_APPLIED', eosClientConfig: 'NOT_CONFIGURED', eosTrustedServer: 'NOT_CONFIGURED' },
        sessions: 'IN_MEMORY_REVOKED_ON_RESTART',
        bridge: { commit: SHA, attestedBy: 'RAILWAY_GIT_COMMIT_SHA', production: true, bootId: '1'.repeat(32), startedAt: '2026-10-04T10:00:00.000Z' },
      },
    });
    expect(await readR16Backend({ bridge: BRIDGE, operatorToken: 'operator-token', fetch: fake })).toEqual(BACKEND);
    expect(seen).toEqual([{ url: `${BRIDGE}/wonderland/readiness`, authorization: 'Bearer operator-token' }]);
  });

  it('unreadable is a reason, never a guess; with no token nothing is asked', async () => {
    const quiet = answering(200, {});
    expect(await readR16Backend({ bridge: BRIDGE, operatorToken: undefined, fetch: quiet.fake })).toEqual({ readable: false, reason: 'NO_OPERATOR_TOKEN' });
    expect(quiet.seen).toEqual([]);
    expect(await readR16Backend({ bridge: BRIDGE, operatorToken: 'x', fetch: answering(401, { error: {} }).fake })).toEqual({ readable: false, reason: 'REFUSED_401' });
    expect(await readR16Backend({ bridge: BRIDGE, operatorToken: 'x', fetch: answering(200, { data: { database: { state: 'CONNECTED' } } }).fake }))
      .toEqual({ readable: false, reason: 'NO_BRIDGE_IDENTITY' });
    const down = (async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:443'); }) as unknown as typeof fetch;
    expect(await readR16Backend({ bridge: BRIDGE, operatorToken: 'x', fetch: down })).toEqual({ readable: false, reason: 'UNREACHABLE' });
  });
});
