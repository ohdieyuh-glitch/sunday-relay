import { describe, expect, it } from 'vitest';

import { WONDERLAND_PRESENCE_TTL_SECONDS, createMemoryWonderlandSocialStore } from '../src/relay/mission/wonderland-social';
import {
  R16_CHECKS,
  R16_HEARTBEAT_MS,
  compareR16Views,
  r16Players,
  readR16Views,
  runR16Scenario,
  summarizeR16,
  verifyR16Restart,
  type R16Players,
} from '../scripts/wonderland-r16-harness.mjs';
import { createBrowserSessionStore, NATIVE_WORLD_AUDIENCE } from './browser-session/grants';
import { handleWonderlandSocialRoute } from './wonderland-social-routes';

/**
 * WONDERLAND R16 AGAINST A BACKEND WHOSE CLOCK THE TEST HOLDS.
 *
 * The real-process suite proves the harness against the shipped bridge, but in
 * real time, where a presence lease (120 s) never runs out. Here the same
 * harness talks to the same social routes in process, and the backend's clock
 * moves the way a slow hosted backend's does: every request costs seconds. So
 * the cases that need a lease to run out — in the middle of the scenario, and
 * across a restart — actually happen.
 */

const ORIGIN = 'https://r16.inprocess.test';
const T0 = Date.UTC(2026, 9, 4, 12, 0, 0);
const TTL_MS = WONDERLAND_PRESENCE_TTL_SECONDS * 1000;

/** The social routes in process, behind a fetch. Each request moves the backend's clock by `stepMs`. */
function backend(stepMs: number, options: { readonly allowNative?: boolean } = {}) {
  const sessions = createBrowserSessionStore();
  const store = createMemoryWonderlandSocialStore();
  let now = T0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    now += stepMs;
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const result = await handleWonderlandSocialRoute({
      method: init?.method ?? 'GET',
      path: url.pathname,
      url: `${url.pathname}${url.search}`,
      origin: headers.origin,
      authorization: headers.authorization,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined,
      now,
    }, { store, sessions, allowNative: options.allowNative ?? false });
    return new Response(JSON.stringify(result?.body ?? { error: { kind: 'not_found' } }), {
      status: result?.status ?? 404, headers: { 'content-type': 'application/json' },
    });
  };
  /** Sign the players in, as pairing does: a fresh session each, bound to the origin. */
  const signIn = (players: R16Players): Record<string, string> => Object.fromEntries([players.a, players.b, players.c].map((player) => {
    const minted = sessions.mintIdentitySession({ origin: ORIGIN, now, participantId: player, scope: 'browser_control' });
    if (!minted.ok) throw new Error('mint');
    return [player, minted.session.token];
  }));
  /**
   * The players' NATIVE clients, paired the store's own way: a `native_world` grant bound to the native audience and a
   * project, redeemed by the client. Exactly what `/wonderland/native/pair` and `/session` do over HTTP.
   */
  const signInNative = (players: R16Players): Record<string, string> => Object.fromEntries([players.a, players.b, players.c].map((player) => {
    const grant = sessions.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now, scope: 'native_world', participantId: player, projectId: 'r16-world' });
    const redeemed = sessions.consumeGrant({ grantId: grant.grantId, secret: grant.secret, origin: NATIVE_WORLD_AUDIENCE, now });
    if (!redeemed.ok) throw new Error(`native: ${redeemed.reason}`);
    return [player, redeemed.session.token];
  }));
  return { store, fetch, signIn, signInNative, clock: () => now, advance: (ms: number) => { now += ms; } };
}

/** The paths a view derives from the presence lease, and only those. */
const LEASE_PATH = /^\/[^/]+\/(roster|listing|presence)(\/|$)|^\/[^/]+\/me\/(friends|party\/members)\/\d+\/presence(\/|$)/u;

async function scenario(stepMs: number, nonce: string) {
  const b = backend(stepMs);
  const players = r16Players(nonce);
  const sessions = b.signIn(players);
  const outcome = await runR16Scenario({ bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce, fetch: b.fetch, clock: b.clock });
  return { b, players, sessions, outcome };
}

describe('the scenario keeps the client\'s half of the lease', () => {
  it('on a backend slow enough to outlast a lease several times, every standing player is refreshed and every check passes', async () => {
    const { b, outcome } = await scenario(2_000, 'slow');
    expect(outcome.results.filter((row) => row.result === 'FAIL'), 'no check failed').toEqual([]);
    expect(summarizeR16(outcome.results)).toEqual({ passed: R16_CHECKS.length, failed: 0, missing: [], of: R16_CHECKS.length });
    expect(b.clock() - T0, 'the run outlasted a lease twice over').toBeGreaterThan(2 * TTL_MS);
    expect(outcome.heartbeats).toBeGreaterThanOrEqual(Math.floor((b.clock() - T0) / (TTL_MS / 4)));
    expect(R16_HEARTBEAT_MS).toBeLessThan(TTL_MS / 4);
  }, 30_000);

  it('a client whose heartbeat never fires loses its presence mid-scenario, and the LEASE check fails on it', async () => {
    const b = backend(2_000);
    const players = r16Players('frozen');
    const sessions = b.signIn(players);
    // The harness believes no time passes, so it never refreshes; the backend's clock runs on regardless.
    const outcome = await runR16Scenario({ bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'frozen', fetch: b.fetch, clock: () => T0 });
    expect(outcome.heartbeats).toBe(0);
    const failed = outcome.results.filter((row) => row.result === 'FAIL').map((row) => row.name);
    expect(failed).toContain(R16_CHECKS[R16_CHECKS.length - 1]);
    expect(summarizeR16(outcome.results).failed).toBeGreaterThan(0);
  }, 30_000);
});

describe('the restart check judges what is stored as stored, and what the lease derives after a reconnect', () => {
  it('a restart that outlasts the lease: nothing stored is lost, each player enters again, and the world comes back the same', async () => {
    const { b, players, sessions, outcome } = await scenario(500, 'outlast');
    expect(outcome.results.filter((row) => row.result === 'FAIL')).toEqual([]);
    const before = await readR16Views({ bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'outlast', fetch: b.fetch });
    // The backend is down for longer than a lease, and every session dies with it.
    b.advance(TTL_MS + 30_000);
    const again = b.signIn(players);
    // A restart check that compared everything would now report the ended presences as lost state, and only them.
    const naive = compareR16Views(before, await readR16Views({ bridge: ORIGIN, origin: ORIGIN, sessions: again, players, nonce: 'outlast', fetch: b.fetch }));
    expect(naive.length).toBeGreaterThan(0);
    expect(naive.filter((path) => !LEASE_PATH.test(path)), 'every difference is a lease-derived path').toEqual([]);
    const verified = await verifyR16Restart({ bridge: ORIGIN, origin: ORIGIN, sessions: again, players, nonce: 'outlast', recorded: { views: before }, fetch: b.fetch });
    expect(verified.reconnect).toEqual({ [players.a]: 'REENTERED', [players.b]: 'REENTERED', [players.c]: 'REENTERED' });
    expect(verified.results.map((row) => `${row.result} ${row.name.split(':')[0]!}`)).toEqual([
      'PASS DURABLE', 'PASS DURABLE', 'PASS DURABLE', 'PASS PRESENCE', 'PASS PRESENCE', 'PASS PRESENCE',
    ]);
    // The views are the substance, not empty answers that would trivially match: A's server, A's letter to B, and a roster.
    const viewOfA = verified.views[players.a] as { me: { servers: unknown[] }; conversations: Record<string, unknown[]>; roster: { players: unknown[] } };
    expect(viewOfA.me.servers).toHaveLength(1);
    expect(viewOfA.conversations[players.b]).toHaveLength(1);
    expect(viewOfA.roster.players.length).toBeGreaterThan(1);
  }, 30_000);

  it('a restart inside the lease: each player\'s refresh holds, and nothing is re-entered', async () => {
    const { b, players, sessions } = await scenario(500, 'inside');
    const before = await readR16Views({ bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'inside', fetch: b.fetch });
    b.advance(10_000);
    const verified = await verifyR16Restart({ bridge: ORIGIN, origin: ORIGIN, sessions: b.signIn(players), players, nonce: 'inside', recorded: { views: before }, fetch: b.fetch });
    expect(verified.reconnect).toEqual({ [players.a]: 'HELD', [players.b]: 'HELD', [players.c]: 'HELD' });
    expect(verified.results.filter((row) => row.result === 'FAIL')).toEqual([]);
  }, 30_000);

  it('stored state that changed across the restart is a DURABLE failure for exactly the player it changed for', async () => {
    const { b, players, sessions } = await scenario(500, 'lost');
    const before = await readR16Views({ bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'lost', fetch: b.fetch });
    // What a broken backend might do across a restart: C now belongs to a server C never created or joined.
    const at = new Date(b.clock()).toISOString();
    expect(await b.store.execute({ actorId: players.c, commandId: 'not-stored-before', command: { kind: 'SERVER_CREATE', serverId: 'srv-never', name: 'Never' }, at }))
      .toEqual({ ok: true, code: 'DONE' });
    const verified = await verifyR16Restart({ bridge: ORIGIN, origin: ORIGIN, sessions: b.signIn(players), players, nonce: 'lost', recorded: { views: before }, fetch: b.fetch });
    const durable = verified.results.filter((row) => row.name.startsWith('DURABLE'));
    expect(durable.map((row) => row.result)).toEqual(['PASS', 'PASS', 'FAIL']);
    expect(durable[2]!.detail).toContain('/me/servers');
  }, 30_000);
});

describe('the native client, as the shipped RC speaks: no Origin, native sessions only', () => {
  it('with native social allowed, every check passes over native sessions, and so does the restart check', async () => {
    const b = backend(500, { allowNative: true });
    const players = r16Players('native');
    const sessions = b.signInNative(players);
    const outcome = await runR16Scenario({ bridge: ORIGIN, origin: null, sessions, players, nonce: 'native', fetch: b.fetch, clock: b.clock });
    expect(outcome.results.filter((row) => row.result === 'FAIL'), 'no check failed').toEqual([]);
    expect(summarizeR16(outcome.results)).toEqual({ passed: R16_CHECKS.length, failed: 0, missing: [], of: R16_CHECKS.length });
    const before = await readR16Views({ bridge: ORIGIN, origin: null, sessions, players, nonce: 'native', fetch: b.fetch });
    b.advance(TTL_MS + 30_000);
    const again = b.signInNative(players);
    const verified = await verifyR16Restart({ bridge: ORIGIN, origin: null, sessions: again, players, nonce: 'native', recorded: { views: before }, fetch: b.fetch });
    expect(verified.results.filter((row) => row.result === 'FAIL')).toEqual([]);
    expect(verified.results).toHaveLength(6);
  }, 30_000);

  it('the wall does not depend on the kind of session: a native client is shown exactly what a browser client is shown', async () => {
    const run = async (kind: 'browser' | 'native') => {
      const b = backend(250, { allowNative: true });
      const players = r16Players('same');
      const sessions = kind === 'native' ? b.signInNative(players) : b.signIn(players);
      const origin = kind === 'native' ? null : ORIGIN;
      const outcome = await runR16Scenario({ bridge: ORIGIN, origin, sessions, players, nonce: 'same', fetch: b.fetch, clock: b.clock });
      return { outcome, views: await readR16Views({ bridge: ORIGIN, origin, sessions, players, nonce: 'same', fetch: b.fetch }) };
    };
    const [browser, native] = [await run('browser'), await run('native')];
    expect(native.outcome.results.map((row) => `${row.result} ${row.name}`)).toEqual(browser.outcome.results.map((row) => `${row.result} ${row.name}`));
    expect(compareR16Views(browser.views, native.views), 'every view, path for path').toEqual([]);
  }, 30_000);

  it('the copy guard holds both ways: a native token from a web page, and a browser token with no Origin, are refused', async () => {
    const b = backend(0, { allowNative: true });
    const players = r16Players('guard');
    const native = b.signInNative(players);
    const browser = b.signIn(players);
    const me = (token: string, origin: string | undefined) => b.fetch(`${ORIGIN}/wonderland/social/me`, {
      headers: { authorization: `Relay-Session ${token}`, ...(origin === undefined ? {} : { origin }) },
    });
    expect((await me(native[players.a]!, ORIGIN)).status, 'a native token presented from a web page').toBe(401);
    expect((await me(browser[players.a]!, undefined)).status, 'a browser token copied into a native client').toBe(401);
    expect((await me(native[players.a]!, undefined)).status).toBe(200);
    expect((await me(browser[players.a]!, ORIGIN)).status).toBe(200);
  });

  it('with native social off, as the bridge ships today, a native client is answered nothing but the decision', async () => {
    const b = backend(0);
    const players = r16Players('off');
    const sessions = b.signInNative(players);
    const answers: Array<{ status: number; kind: unknown }> = [];
    const recording: typeof globalThis.fetch = async (input, init) => {
      const response = await b.fetch(input, init);
      const body = await response.clone().json() as { error?: { kind?: unknown } };
      answers.push({ status: response.status, kind: body.error?.kind ?? null });
      return response;
    };
    const outcome = await runR16Scenario({ bridge: ORIGIN, origin: null, sessions, players, nonce: 'off', fetch: recording, clock: b.clock });
    expect(answers.length).toBeGreaterThan(50);
    expect(answers.every((answer) => answer.status === 403 && answer.kind === 'native_social_not_enabled'), 'every answer is the decision').toBe(true);
    expect(outcome.results.find((row) => row.name === R16_CHECKS[0])?.result, 'and SESSIONS fails, so the run cannot pass').toBe('FAIL');
  }, 30_000);
});
