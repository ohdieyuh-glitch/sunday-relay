import { describe, expect, it } from 'vitest';

import { WONDERLAND_PRESENCE_TTL_SECONDS } from '../src/relay/mission/wonderland-social';
import {
  R16_CHECKS,
  R16_VOICE_CHECKS,
  r16Players,
  r16VoiceRestartCheck,
  readR16VoiceRooms,
  readR16Views,
  runR16Scenario,
  summarizeR16,
  verifyR16Restart,
  verifyR16Voice,
  type R16Players,
} from '../scripts/wonderland-r16-harness.mjs';
import { createMemoryWonderlandVoiceIdentityStore } from '../src/relay/mission/wonderland-voice';
import { createR16VoiceBackend, r16IdToken, r16ProductUserIdOf, type R16VoiceBackendOptions } from './wonderland-r16-voice.fixture';

/**
 * WONDERLAND R16: THE VOICE WALL, CHECKED OVER HTTP.
 *
 * The harness joins voice as a client does, at five points of the same
 * three-player scenario, and judges the wall the way it is defined: by which
 * rooms two players are BOTH given. The backend here is the social and voice
 * routes composed as `server.ts` composes them, in process, because the shipped
 * bridge reaches Epic and nothing else, by design. Epic's trusted server is a
 * fake that keeps who each room admits, and after EVERY request of the run the
 * suite reads it against the wall's own definition (`wallBreaches`).
 *
 * The harness has to be able to fail, and to fail for the right reason: a
 * backend that takes nothing back, one that takes back only the actor's rooms,
 * one that hands a stranger the friends' room, one with no voice, and a forged
 * identity are each reported as exactly the voice rules they break.
 */

const ORIGIN = 'https://r16-voice.inprocess.test';
const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);
const TTL_MS = WONDERLAND_PRESENCE_TTL_SECONDS * 1000;

function stage(nonce: string, options: Partial<R16VoiceBackendOptions> = {}) {
  const backend = createR16VoiceBackend({ origin: ORIGIN, t0: T0, stepMs: 2_000, ...options });
  const players = r16Players(nonce);
  const sessions = backend.signIn([players.a, players.b, players.c]);
  return { backend, players, sessions };
}

/** The backend's fetch, with the wall read on the trusted server after every request, and every voice path counted. */
function watched(backend: ReturnType<typeof createR16VoiceBackend>) {
  const breaches: string[] = [];
  let voiceRequests = 0;
  let requests = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests += 1;
    if (/\/wonderland\/(voice|eos)\//u.test(new URL(String(input)).pathname)) voiceRequests += 1;
    const response = await backend.fetch(input, init);
    for (const breach of await backend.wallBreaches()) breaches.push(`after request ${String(requests)}: ${breach}`);
    return response;
  };
  return { fetch, breaches, voiceRequests: () => voiceRequests };
}

const failedNames = (results: readonly { name: string; result: string }[]) => results.filter((row) => row.result === 'FAIL').map((row) => row.name);

describe('the voice wall over HTTP', () => {
  it('every one of the 24 and every voice check passes, and after every request the trusted server admits nothing the wall forbids', async () => {
    const { backend, players, sessions } = stage('wall');
    const seen = watched(backend);
    const outcome = await runR16Scenario({
      bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'wall', fetch: seen.fetch, clock: backend.clock,
      voice: { idTokens: backend.idTokens([players.a, players.b, players.c]) },
    });
    expect(outcome.results.filter((row) => row.result === 'FAIL'), 'no check failed').toEqual([]);
    expect(summarizeR16(outcome.results, { voice: true })).toEqual({
      passed: R16_CHECKS.length + R16_VOICE_CHECKS.length, failed: 0, missing: [], of: R16_CHECKS.length + R16_VOICE_CHECKS.length,
    });
    expect(outcome.voice).toEqual({ admitted: true, joins: expect.any(Number) });
    expect(seen.breaches, 'the trusted server never admitted what the wall forbids').toEqual([]);
    // The identities the harness bound are the ones the tokens proved, each player's own.
    for (const player of [players.a, players.b, players.c]) {
      expect(await backend.stores().identities.productUserIdOf(player)).toBe(r16ProductUserIdOf(player));
    }
    // The run was long enough for leases to matter, and the heartbeats kept every player present among the joins.
    expect(backend.clock() - T0).toBeGreaterThan(2 * TTL_MS);
    expect(outcome.heartbeats).toBeGreaterThan(0);
    // The wall moved, and the trusted server was told: rooms were taken back, never only issued.
    expect(backend.trusted.calls.filter((call) => call.op === 'remove').length).toBeGreaterThan(0);
  }, 60_000);

  it('passes as well where each player\'s own game client bound their identity: no ID token is needed', async () => {
    const { backend, players, sessions } = stage('client-bound');
    for (const player of [players.a, players.b, players.c]) {
      await backend.stores().identities.bind({ playerId: player, productUserId: r16ProductUserIdOf(player), at: new Date(T0).toISOString() });
    }
    const outcome = await runR16Scenario({ bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'client-bound', fetch: backend.fetch, clock: backend.clock, voice: {} });
    expect(failedNames(outcome.results)).toEqual([]);
    expect(summarizeR16(outcome.results).of, 'voice results present: the voice checks are counted').toBe(R16_CHECKS.length + R16_VOICE_CHECKS.length);
  }, 60_000);

  it('without voice, nothing about voice is sent, and only the 24 are counted', async () => {
    const { backend, players, sessions } = stage('silent');
    const seen = watched(backend);
    const outcome = await runR16Scenario({ bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'silent', fetch: seen.fetch, clock: backend.clock });
    expect(failedNames(outcome.results)).toEqual([]);
    expect(seen.voiceRequests()).toBe(0);
    expect(outcome.voice).toBeNull();
    expect(summarizeR16(outcome.results)).toEqual({ passed: R16_CHECKS.length, failed: 0, missing: [], of: R16_CHECKS.length });
    // Asked to count voice, a run that checked none is missing every voice check.
    expect(summarizeR16(outcome.results, { voice: true })).toMatchObject({ failed: R16_VOICE_CHECKS.length, missing: R16_VOICE_CHECKS });
  }, 60_000);
});

describe('the harness fails a backend that breaks the voice wall, as exactly the rules it breaks', () => {
  it('a backend that takes nothing back when the wall moves: the two "at once" checks, and the trusted server shows why', async () => {
    const { backend, players, sessions } = stage('keeps', { reconcile: false });
    const seen = watched(backend);
    const outcome = await runR16Scenario({
      bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'keeps', fetch: seen.fetch, clock: backend.clock,
      voice: { idTokens: backend.idTokens([players.a, players.b, players.c]) },
    });
    expect(failedNames(outcome.results)).toEqual([R16_VOICE_CHECKS[3], R16_VOICE_CHECKS[6]]);
    expect(outcome.results.find((row) => row.name === R16_VOICE_CHECKS[3])?.detail).toContain('the hide took back null');
    // What the harness saw over HTTP is what happened on the trusted server: a hidden player and a stranger in one room.
    expect(seen.breaches.some((breach) => breach.includes(`${players.a} and ${players.c}, who are not mutually visible`))).toBe(true);
  }, 60_000);

  it('a backend that takes back only the actor\'s rooms: the other side keeps the room until their own next join, and the same two checks say so', async () => {
    const { backend, players, sessions } = stage('actor-only', { reconcile: 'actor-only' });
    const outcome = await runR16Scenario({
      bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'actor-only', fetch: backend.fetch, clock: backend.clock,
      voice: { idTokens: backend.idTokens([players.a, players.b, players.c]) },
    });
    expect(failedNames(outcome.results)).toEqual([R16_VOICE_CHECKS[3], R16_VOICE_CHECKS[6]]);
    // The actor's own rooms were taken back at once; the stranger's and the blocked player's only when they next joined.
    expect(outcome.results.find((row) => row.name === R16_VOICE_CHECKS[3])?.detail)
      .toContain('the hide took back {"revoked":1,"revocationFailures":0} of A\'s own rooms; after it, C\'s join took back 1');
    expect(outcome.results.find((row) => row.name === R16_VOICE_CHECKS[6])?.detail)
      .toContain('the block took back {"revoked":3,"revocationFailures":0} of C\'s own rooms, and B\'s next join 2 more');
  }, 60_000);

  it('a backend that hands the stranger the rooms of the player who hides from them: the wall checks that see it fail, and no other', async () => {
    const { backend, players, sessions } = stage('leak');
    const aRooms = new Set<string>();
    const leaky: typeof globalThis.fetch = async (input, init) => {
      const response = await backend.fetch(input, init);
      if (!new URL(String(input)).pathname.endsWith('/wonderland/voice/join') || response.status !== 200) return response;
      const authorization = ((init?.headers ?? {}) as Record<string, string>).authorization ?? '';
      const body = await response.json() as { data: { rooms: Array<{ roomId: string; token: string }> } };
      if (authorization.endsWith(sessions[players.a]!)) for (const room of body.data.rooms) aRooms.add(room.roomId);
      if (authorization.endsWith(sessions[players.c]!)) {
        for (const roomId of aRooms) {
          if (!body.data.rooms.some((room) => room.roomId === roomId)) body.data.rooms.push({ roomId, token: 'leaked' });
        }
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const outcome = await runR16Scenario({
      bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'leak', fetch: leaky, clock: backend.clock,
      voice: { idTokens: backend.idTokens([players.a, players.b, players.c]) },
    });
    const failed = failedNames(outcome.results);
    expect(failed).toEqual(expect.arrayContaining([R16_VOICE_CHECKS[1], R16_VOICE_CHECKS[2], R16_VOICE_CHECKS[6]]));
    expect(failed.every((name) => R16_VOICE_CHECKS.includes(name)), 'a voice leak is reported as voice rules, never as noise').toBe(true);
    expect(outcome.results.find((row) => row.name === R16_VOICE_CHECKS[2])?.detail).toMatch(/C \[[^\]]*AB/u);
  }, 60_000);

  it('a backend that does not serve voice: the identity check names why, every other voice check is "not run", and the 24 still pass', async () => {
    const { backend, players, sessions } = stage('mute', { serveVoice: false });
    const outcome = await runR16Scenario({
      bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'mute', fetch: backend.fetch, clock: backend.clock,
      voice: { idTokens: backend.idTokens([players.a, players.b, players.c]) },
    });
    expect(failedNames(outcome.results)).toEqual(R16_VOICE_CHECKS);
    const rows = outcome.results.filter((row) => R16_VOICE_CHECKS.includes(row.name));
    expect(rows[0]!.detail).toContain('503 eos_not_configured');
    for (const row of rows.slice(1)) expect(row.detail).toMatch(/^not run: voice was not available to every player \(A 503 eos_not_configured/u);
    expect(summarizeR16(outcome.results, { voice: true })).toEqual({
      passed: R16_CHECKS.length, failed: R16_VOICE_CHECKS.length, missing: [], of: R16_CHECKS.length + R16_VOICE_CHECKS.length,
    });
    expect(outcome.voice).toEqual({ admitted: false, joins: 3 });
  }, 60_000);

  it('a forged ID token binds nothing: that player is not admitted, and the identity check says so', async () => {
    const { backend, players, sessions } = stage('forged');
    const tokens = backend.idTokens([players.a, players.b, players.c]);
    // B's token, its signature broken: what a client that never signed in to EOS might send.
    tokens[players.b] = `${tokens[players.b]!.slice(0, -8)}AAAAAAAA`;
    const outcome = await runR16Scenario({ bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'forged', fetch: backend.fetch, clock: backend.clock, voice: { idTokens: tokens } });
    const identity = outcome.results.find((row) => row.name === R16_VOICE_CHECKS[0])!;
    expect(identity.result).toBe('FAIL');
    expect(identity.detail).toContain('refused 401 id_token_refused');
    expect(identity.detail).toContain('B 409 voice_identity_required');
    expect(await backend.stores().identities.productUserIdOf(players.b)).toBeNull();
  }, 60_000);

  it('two players proving one EOS identity: the second is refused, and the check counts the identities as fewer than three', async () => {
    const { backend, players, sessions } = stage('shared');
    const tokens = backend.idTokens([players.a, players.b, players.c]);
    tokens[players.c] = r16IdToken(r16ProductUserIdOf(players.a), backend.clock());
    const outcome = await runR16Scenario({ bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'shared', fetch: backend.fetch, clock: backend.clock, voice: { idTokens: tokens } });
    const identity = outcome.results.find((row) => row.name === R16_VOICE_CHECKS[0])!;
    expect(identity.result).toBe('FAIL');
    expect(identity.detail).toContain('refused 409 puid_bound_to_another_player');
  }, 60_000);
});

describe('the voice half of the restart check', () => {
  async function recorded(nonce: string, backend: ReturnType<typeof createR16VoiceBackend>, players: R16Players, sessions: Record<string, string>) {
    const outcome = await runR16Scenario({
      bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce, fetch: backend.fetch, clock: backend.clock,
      voice: { idTokens: backend.idTokens([players.a, players.b, players.c]) },
    });
    expect(failedNames(outcome.results)).toEqual([]);
    return {
      views: await readR16Views({ bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce, fetch: backend.fetch }),
      voice: { rooms: await readR16VoiceRooms({ bridge: ORIGIN, origin: ORIGIN, sessions, players, fetch: backend.fetch }) },
    };
  }

  it('a restart longer than a lease: identities survive, every player re-enters, and each is given exactly the rooms they were given before', async () => {
    const { backend, players, sessions } = stage('restart', { stepMs: 500 });
    const before = await recorded('restart', backend, players, sessions);
    // What was recorded has substance: B and C share the one room the end of the scenario leaves, and A, hidden, has none.
    const rooms = before.voice.rooms as Record<string, { INSTANCE: { rooms?: string[] }; PARTY: { rooms?: string[]; refused?: string } }>;
    expect(rooms[players.b]!.INSTANCE.rooms).toHaveLength(1);
    expect(rooms[players.b]!.INSTANCE.rooms).toEqual(rooms[players.c]!.INSTANCE.rooms);
    expect(rooms[players.a]!.INSTANCE.rooms).toEqual([]);
    expect(rooms[players.b]!.PARTY).toEqual({ refused: 'not_in_party' });
    backend.advance(TTL_MS + 30_000);
    backend.restart();
    const again = backend.signIn([players.a, players.b, players.c]);
    const verified = await verifyR16Restart({ bridge: ORIGIN, origin: ORIGIN, sessions: again, players, nonce: 'restart', recorded: before, fetch: backend.fetch });
    expect(verified.reconnect).toEqual({ [players.a]: 'REENTERED', [players.b]: 'REENTERED', [players.c]: 'REENTERED' });
    const heard = await verifyR16Voice({ bridge: ORIGIN, origin: ORIGIN, sessions: again, players, recorded: before, fetch: backend.fetch });
    expect(heard).toEqual([players.a, players.b, players.c].map((player) => ({ name: r16VoiceRestartCheck(player), result: 'PASS', detail: '' })));
    expect(await backend.wallBreaches()).toEqual([]);
  }, 60_000);

  it('a backend that loses the identities in its restart: every player is refused voice, and the check fails for each of them', async () => {
    let identities = createMemoryWonderlandVoiceIdentityStore();
    const { createMemoryWonderlandSocialStore } = await import('../src/relay/mission/wonderland-social');
    const social = createMemoryWonderlandSocialStore();
    const { backend, players, sessions } = stage('amnesia', { stepMs: 500, stores: () => ({ social, identities }) });
    const before = await recorded('amnesia', backend, players, sessions);
    // The fault: its identity store does not survive the start.
    identities = createMemoryWonderlandVoiceIdentityStore();
    backend.restart();
    const again = backend.signIn([players.a, players.b, players.c]);
    await verifyR16Restart({ bridge: ORIGIN, origin: ORIGIN, sessions: again, players, nonce: 'amnesia', recorded: before, fetch: backend.fetch });
    const heard = await verifyR16Voice({ bridge: ORIGIN, origin: ORIGIN, sessions: again, players, recorded: before, fetch: backend.fetch });
    expect(heard.map((row) => row.result)).toEqual(['FAIL', 'FAIL', 'FAIL']);
    expect(heard[1]!.detail).toContain('/INSTANCE/refused');
  }, 60_000);

  it('a scenario that recorded no voice rooms cannot pass the voice half', async () => {
    const { backend, players, sessions } = stage('unrecorded', { stepMs: 500 });
    const heard = await verifyR16Voice({ bridge: ORIGIN, origin: ORIGIN, sessions, players, recorded: { voice: null }, fetch: backend.fetch });
    expect(heard.map((row) => `${row.result} ${row.detail}`)).toEqual(Array(3).fill('FAIL the scenario recorded no voice rooms: run it with --voice and --state'));
  });
});
