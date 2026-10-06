import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { WONDERLAND_PRESENCE_HEARTBEAT_SECONDS, WONDERLAND_PRESENCE_TTL_SECONDS, createMemoryWonderlandSocialStore } from '../src/relay/mission/wonderland-social';
import { createMemoryWonderlandVoiceIdentityStore, type WonderlandVoiceIdentityStore } from '../src/relay/mission/wonderland-voice';
import { createBrowserSessionStore } from './browser-session/grants';
import {
  WONDERLAND_EOS_ENV,
  WONDERLAND_EOS_TRUSTED_ENV,
  createWonderlandEosVoicePort,
  readWonderlandEosClientConfig,
  verifyWonderlandEosIdToken,
  wonderlandEosExpectation,
  type WonderlandFetch,
  type WonderlandJwk,
} from './wonderland-voice/eos';
import { handleWonderlandSocialRoute } from './wonderland-social-routes';
import {
  handleWonderlandVoiceRoute,
  reconcileWonderlandVoice,
  reconcileWonderlandVoiceAfterCommand,
  settleWonderlandVoice,
  wonderlandVoiceAffected,
  type WonderlandVoiceRoutePorts,
} from './wonderland-voice-routes';

/**
 * WONDERLAND EOS AND VOICE, HELD TO THE WALL AND TO THE SECRET.
 *
 * Real cryptography (an RSA key pair made here, real RS256 signatures), real
 * session credentials, the real social store and the real room planner; only
 * Epic is a fake, and the fake records every call so the cases can say exactly
 * what the trusted server was asked to do.
 */

const ORIGIN = 'https://wonderland.example';
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const NOW_S = Math.floor(NOW / 1000);
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const ENV = {
  [WONDERLAND_EOS_ENV.productId]: 'prod-1', [WONDERLAND_EOS_ENV.sandboxId]: 'sbx-1', [WONDERLAND_EOS_ENV.deploymentId]: 'dep-1',
  [WONDERLAND_EOS_ENV.clientId]: 'client-1', [WONDERLAND_EOS_ENV.clientSecret]: 'game-client-secret',
  [WONDERLAND_EOS_TRUSTED_ENV.clientId]: 'TRUSTED-ID-MARKER', [WONDERLAND_EOS_TRUSTED_ENV.clientSecret]: 'TRUSTED-SECRET-MARKER',
};

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...(publicKey.export({ format: 'jwk' }) as WonderlandJwk), kid: 'k1', alg: 'RS256', use: 'sig' } as WonderlandJwk;
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
function idToken(puid: string, over: Record<string, unknown> = {}, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1', typ: 'JWT' }): string {
  const payload = {
    iss: 'https://api.epicgames.dev/auth/v1/oauth', sub: puid, pfpid: 'prod-1', pfsid: 'sbx-1', pfdid: 'dep-1',
    aud: 'client-1', exp: NOW_S + 600, iat: NOW_S - 5, ...over,
  };
  const signing = `${b64(header)}.${b64(payload)}`;
  return `${signing}.${sign('RSA-SHA256', Buffer.from(signing), privateKey).toString('base64url')}`;
}
const PUID = (n: number): string => String(n).repeat(32).slice(0, 32).replace(/[^0-9a-f]/gu, 'a');

/** A gate held open until released, and a promise for the moment it is reached. */
function gate() {
  let release!: () => void;
  let reach!: () => void;
  const open = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { reach = resolve; });
  return { open, reached, release, reach };
}

function fakeEos() {
  const calls: Array<{ op: 'token' | 'remove'; roomId: string; productUserId: string }> = [];
  /** Who each room admits now: a token admits its identity at once (its client connects), and a removal takes it out. */
  const members = new Map<string, Set<string>>();
  const held: Array<{ match: (roomId: string, productUserId: string) => boolean; gate: ReturnType<typeof gate> }> = [];
  let failRemovals = false;
  let failTokens = false;
  return {
    calls,
    members,
    failRemovals: (value: boolean) => { failRemovals = value; },
    failTokens: (value: boolean) => { failTokens = value; },
    /** Epic makes the next matching removal, and its answer comes back only on release. */
    holdRemoval(match: (roomId: string, productUserId: string) => boolean) {
      const g = gate();
      held.push({ match, gate: g });
      return { reached: g.reached, release: g.release };
    },
    port: {
      async roomToken({ roomId, productUserId }: { roomId: string; productUserId: string }) {
        calls.push({ op: 'token', roomId, productUserId });
        if (failTokens) throw new Error('epic unavailable');
        if (!members.has(roomId)) members.set(roomId, new Set());
        members.get(roomId)!.add(productUserId);
        return { token: `token:${roomId}:${productUserId}`, clientBaseUrl: 'https://rtc.example' };
      },
      async removeParticipant({ roomId, productUserId }: { roomId: string; productUserId: string }) {
        calls.push({ op: 'remove', roomId, productUserId });
        if (failRemovals) throw new Error('epic unavailable');
        members.get(roomId)?.delete(productUserId);
        const at = held.findIndex((row) => row.match(roomId, productUserId));
        if (at >= 0) {
          const [row] = held.splice(at, 1);
          row!.gate.reach();
          await row!.gate.open;
        }
      },
    },
  };
}

/** The identity store, with one read held open on request: to place another step exactly inside a join. */
function holdable(inner: WonderlandVoiceIdentityStore) {
  let hold: { at: 'productUserIdsOf' | 'openIssuancesOf'; gate: ReturnType<typeof gate> } | null = null;
  const calls: string[] = [];
  const wait = async (at: 'productUserIdsOf' | 'openIssuancesOf'): Promise<void> => {
    if (hold?.at !== at) return;
    const { gate: g } = hold;
    hold = null;
    g.reach();
    await g.open;
  };
  const store: WonderlandVoiceIdentityStore = {
    bind: (input) => inner.bind(input),
    productUserIdOf: (playerId) => inner.productUserIdOf(playerId),
    async productUserIdsOf(playerIds) { await wait('productUserIdsOf'); return inner.productUserIdsOf(playerIds); },
    recordIssuance: (input) => inner.recordIssuance(input),
    openRoomsOf: (playerId) => inner.openRoomsOf(playerId),
    async openIssuancesOf(playerId) { calls.push(playerId); await wait('openIssuancesOf'); return inner.openIssuancesOf(playerId); },
    recordRevocation: (input) => inner.recordRevocation(input),
  };
  return {
    store,
    /** Whose open issuances were read, in order: whose voice anything was reconciled for. */
    calls,
    hold(at: 'productUserIdsOf' | 'openIssuancesOf') {
      const g = gate();
      hold = { at, gate: g };
      return { reached: g.reached, release: g.release };
    },
  };
}

function stage(over: Partial<WonderlandVoiceRoutePorts> = {}) {
  const sessions = createBrowserSessionStore();
  const social = createMemoryWonderlandSocialStore();
  const identities = createMemoryWonderlandVoiceIdentityStore();
  const eos = fakeEos();
  const config = readWonderlandEosClientConfig(ENV);
  if (!config.ok) throw new Error('config');
  const ports: WonderlandVoiceRoutePorts = {
    sessions, allowNative: false, social, identities, eos: config,
    verifyIdToken: (token) => verifyWonderlandEosIdToken({ token, expect: wonderlandEosExpectation(config.config, ENV), nowSeconds: NOW_S, keys: async () => [JWK] }),
    voice: eos.port, digest: sha, ...over,
  };
  const tokens = new Map<string, string>();
  const player = async (id: string): Promise<string> => {
    const minted = sessions.mintIdentitySession({ origin: ORIGIN, now: NOW, participantId: id, scope: 'browser_control' });
    if (!minted.ok) throw new Error('mint');
    tokens.set(id, minted.session.token);
    await social.upsertProfile({ playerId: id, displayName: id });
    return minted.session.token;
  };
  const voice = (id: string, method: string, path: string, body?: unknown, now: number = NOW) =>
    handleWonderlandVoiceRoute({ method, path, origin: ORIGIN, body, now, authorization: `Relay-Session ${tokens.get(id)!}` }, ports);
  let n = 0;
  /** Removals after a command that failed where nobody could be told: the bridge logs their count. */
  const laterFailures: number[] = [];
  /** A social command as the bridge composes it, answered: what it left for after its answer may still be running. */
  const socialNow$ = (id: string, command: unknown, now: number = NOW) => handleWonderlandSocialRoute({
    method: 'POST', path: '/wonderland/social/commands', url: '/wonderland/social/commands', origin: ORIGIN, now,
    authorization: `Relay-Session ${tokens.get(id)!}`, body: { commandId: `c-${String(++n)}`, command },
  }, {
    store: social, sessions, allowNative: false,
    afterCommand: async ({ actorId, command: done, before, after, at }) => reconcileWonderlandVoiceAfterCommand(
      ports, actorId, wonderlandVoiceAffected(before, after, actorId, done), at, (failures) => { laterFailures.push(failures); }),
  });
  const settle = () => settleWonderlandVoice(ports);
  /** The same command, and everything it left for after its answer, done. */
  const social$ = async (id: string, command: unknown, now: number = NOW) => {
    const answered = await socialNow$(id, command, now);
    await settle();
    return answered;
  };
  return { ports, social, identities, eos, player, voice, social$, socialNow$, settle, laterFailures };
}

describe('the client configuration', () => {
  it('is served to a player at runtime, not stored, and never carries the trusted server\'s credentials', async () => {
    const { player, voice } = stage();
    await player('ann');
    const result = await voice('ann', 'GET', '/wonderland/eos/client-config');
    expect(result?.status).toBe(200);
    expect(result?.headers).toMatchObject({ 'cache-control': 'no-store' });
    expect((result?.body as { data: unknown }).data).toEqual({
      productId: 'prod-1', sandboxId: 'sbx-1', deploymentId: 'dep-1', clientId: 'client-1', clientSecret: 'game-client-secret',
    });
    expect(JSON.stringify(result)).not.toMatch(/TRUSTED-ID-MARKER|TRUSTED-SECRET-MARKER/u);
  });

  it('is never partial: an unconfigured backend names what is missing and serves nothing', async () => {
    const missing = readWonderlandEosClientConfig({ ...ENV, [WONDERLAND_EOS_ENV.clientSecret]: '' });
    expect(missing).toEqual({ ok: false, missing: ['WONDERLAND_EOS_CLIENT_SECRET'] });
    const { player, voice } = stage({ eos: missing as never });
    await player('ann');
    expect((await voice('ann', 'GET', '/wonderland/eos/client-config'))?.status).toBe(503);
  });

  it('is refused to anyone who is not a player', async () => {
    const { ports } = stage();
    expect((await handleWonderlandVoiceRoute({ method: 'GET', path: '/wonderland/eos/client-config', origin: ORIGIN, body: undefined, now: NOW, authorization: undefined }, ports))?.status).toBe(401);
  });
});

describe('the EOS identity', () => {
  it('a token our EOS issued binds the player to its PUID; a second player cannot take that PUID', async () => {
    const { player, voice } = stage();
    await player('ann'); await player('ben');
    const bound = await voice('ann', 'POST', '/wonderland/voice/identity', { idToken: idToken(PUID(1)) });
    expect(bound).toMatchObject({ status: 200, body: { data: { productUserId: PUID(1), outcome: 'BIND' } } });
    expect((await voice('ben', 'POST', '/wonderland/voice/identity', { idToken: idToken(PUID(1)) }))?.status).toBe(409);
  });

  it.each([
    ['a forged signature', (): string => `${idToken(PUID(2)).slice(0, -6)}AAAAAA`, 'signature_invalid'],
    ['alg none', (): string => { const t = idToken(PUID(2)).split('.'); return `${b64({ alg: 'none', kid: 'k1' })}.${t[1]}.${t[2]}`; }, 'header_alg_not_rs256'],
    ['an unknown key id', (): string => idToken(PUID(2), {}, { alg: 'RS256', kid: 'other' }), 'key_unknown'],
    ['another deployment', (): string => idToken(PUID(2), { pfdid: 'dep-2' }), 'deployment_mismatch'],
    ['an expired token', (): string => idToken(PUID(2), { exp: NOW_S - 1 }), 'expired'],
    ['garbage', (): string => 'not.a.token!', 'token_malformed'],
  ] as const)('refuses %s', async (_name, token, reason) => {
    const { player, voice, identities } = stage();
    await player('ann');
    const result = await voice('ann', 'POST', '/wonderland/voice/identity', { idToken: token() });
    expect(result?.status).toBe(401);
    expect(JSON.stringify(result?.body)).toContain(reason);
    expect(await identities.productUserIdOf('ann')).toBeNull();
  });

  it('keys that cannot be fetched are a refusal, never a pass', async () => {
    const result = await verifyWonderlandEosIdToken({
      token: idToken(PUID(3)), nowSeconds: NOW_S, keys: async () => { throw new Error('down'); },
      expect: { issuers: ['https://api.epicgames.dev/auth/v1/oauth'], productId: 'prod-1', sandboxId: 'sbx-1', deploymentId: 'dep-1', clientId: 'client-1' },
    });
    expect(result).toEqual({ ok: false, reason: 'keys_unavailable' });
  });
});

async function hub(names: readonly string[]) {
  const s = stage();
  for (const [i, name] of names.entries()) {
    await s.player(name);
    await s.voice(name, 'POST', '/wonderland/voice/identity', { idToken: idToken(PUID(i + 1)) });
    await s.social$(name, { kind: 'ENTER_INSTANCE', instanceId: 'public:hub', location: null, activity: 'IDLE', dogId: null });
  }
  return s;
}
const roomsOf = (result: Awaited<ReturnType<typeof handleWonderlandVoiceRoute>>) =>
  ((result?.body as { data: { rooms: Array<{ roomId: string; token: string }> } }).data.rooms);
const HEARTBEAT = { kind: 'UPDATE_PRESENCE', location: null, activity: 'IDLE' } as const;

describe('joining voice', () => {
  it('needs a proven identity and a channel', async () => {
    const s = stage();
    await s.player('ann');
    expect((await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }))?.status).toBe(409);
    await s.voice('ann', 'POST', '/wonderland/voice/identity', { idToken: idToken(PUID(1)) });
    expect((await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }))?.body).toMatchObject({ error: { kind: 'not_in_instance' } });
  });

  it('everyone visible to everyone: a room for each pair, and tokens only for the joiner\'s own', async () => {
    const s = await hub(['ann', 'ben', 'cal']);
    const rooms = roomsOf(await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }));
    expect(rooms, 'one per channel mate').toHaveLength(2);
    expect(s.eos.calls).toEqual(rooms.map((room) => ({ op: 'token', roomId: room.roomId, productUserId: PUID(1) })));
  });

  it('a hidden player is never issued a token to the strangers\' room, nor they to hers', async () => {
    const s = await hub(['hana', 'sam', 'tom']);
    await s.social$('hana', { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } });
    const samRooms = roomsOf(await s.voice('sam', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }));
    const hanaRooms = roomsOf(await s.voice('hana', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }));
    expect(samRooms).toHaveLength(1);
    expect(hanaRooms, 'Hana shares voice with nobody here: no friend is present').toEqual([]);
  });
  it('a player whose presence has expired stands in no instance, and is planned into no room', async () => {
    const s = await hub(['ann', 'ben', 'cal']);
    const held = roomsOf(await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }))[0]!.roomId;
    // Ben and Cal keep their heartbeat; Ann's client is gone and says nothing.
    for (const id of ['ben', 'cal']) await s.social$(id, HEARTBEAT, NOW + 60_000);
    const gone = NOW + (WONDERLAND_PRESENCE_TTL_SECONDS + 1) * 1000;
    s.eos.calls.length = 0;
    expect((await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }, gone))?.body).toMatchObject({ error: { kind: 'not_in_instance' } });
    expect(s.eos.calls, 'no token was asked for on her behalf').toEqual([]);
    const benRooms = roomsOf(await s.voice('ben', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }, gone));
    expect(benRooms).toHaveLength(1);
    expect(benRooms[0]!.roomId, 'the room planned without her is not the room she held').not.toBe(held);
  });
});

describe('the wall moves, and the trusted server takes back what it no longer allows', () => {
  it('a block mid-session ends the blocked pair\'s room on the trusted server, and nobody else\'s', async () => {
    const s = await hub(['ann', 'ben', 'cal']);
    const annBefore = roomsOf(await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' })).map((room) => room.roomId);
    const benBefore = roomsOf(await s.voice('ben', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' })).map((room) => room.roomId);
    await s.voice('cal', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    const pair = annBefore.find((room) => benBefore.includes(room))!;
    s.eos.calls.length = 0;
    const blocked = await s.social$('ann', { kind: 'BLOCK', targetId: 'ben' });
    expect((blocked?.body as { voice: unknown }).voice, 'Ann is told about her own room').toEqual({ revoked: 1, revocationFailures: 0 });
    expect(s.eos.calls.filter((call) => call.op === 'remove').map((call) => [call.roomId, call.productUserId]).sort())
      .toEqual([[pair, PUID(1)], [pair, PUID(2)]].sort());
    expect(await s.identities.openRoomsOf('ann'), 'Ann keeps her room with Cal').toEqual(annBefore.filter((room) => room !== pair));
    // Rejoining issues the new plan: Ann and Ben never share a room again.
    const annRooms = roomsOf(await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' })).map((room) => room.roomId);
    const benRooms = roomsOf(await s.voice('ben', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' })).map((room) => room.roomId);
    expect(annRooms.filter((room) => benRooms.includes(room))).toEqual([]);
  });

  it('a removal Epic refuses is reported to the player it concerns, the issuance stays open, and the next reconcile retries it', async () => {
    const s = await hub(['ann', 'ben']);
    await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    await s.voice('ben', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    s.eos.failRemovals(true);
    const blocked = await s.social$('ben', { kind: 'BLOCK', targetId: 'ann' });
    expect((blocked?.body as { voice: unknown }).voice, 'Ben\'s own removal failed; Ann\'s is not his to be told').toEqual({ revoked: 0, revocationFailures: 1 });
    expect(s.laterFailures, 'Ann\'s failed after the answer, and the bridge logged it').toEqual([1]);
    expect(await s.identities.openRoomsOf('ann'), 'still open: not pretended revoked').toHaveLength(1);
    s.eos.failRemovals(false);
    const retried = await reconcileWonderlandVoice(s.ports, ['ann'], '2026-10-04T12:05:00.000Z');
    expect(retried.removed).toHaveLength(1);
    expect(await s.identities.openRoomsOf('ann')).toEqual([]);
  });

  it('a command\'s answer counts only the actor\'s own rooms: removing a member whose hidden friend is present tells the owner nothing more (P1)', async () => {
    const answerTo = async (withHidden: boolean) => {
      const s = stage();
      const names = withHidden ? ['owen', 'mia', 'hid'] : ['owen', 'mia'];
      for (const [i, name] of names.entries()) {
        await s.player(name);
        await s.voice(name, 'POST', '/wonderland/voice/identity', { idToken: idToken(PUID(i + 1)) });
      }
      await s.social$('owen', { kind: 'SERVER_CREATE', serverId: 'srv', name: 'Owen' });
      for (const member of names.slice(1)) {
        await s.social$('owen', { kind: 'SERVER_INVITE', serverId: 'srv', inviteeId: member });
        await s.social$(member, { kind: 'SERVER_JOIN', serverId: 'srv' });
      }
      if (withHidden) {
        // Hid is hidden from strangers, the owner included, and is Mia's friend: they share a room Owen cannot see.
        await s.social$('hid', { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } });
        await s.social$('hid', { kind: 'FRIEND_REQUEST', toId: 'mia' });
        await s.social$('mia', { kind: 'FRIEND_ACCEPT', fromId: 'hid' });
      }
      for (const name of names) await s.social$(name, { kind: 'ENTER_INSTANCE', instanceId: 'server:srv', location: null, activity: 'IDLE', dogId: null });
      for (const name of names) await s.voice(name, 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
      s.eos.calls.length = 0;
      const removed = await s.social$('owen', { kind: 'SERVER_REMOVE_MEMBER', serverId: 'srv', memberId: 'mia' });
      return { voice: (removed?.body as { voice: unknown }).voice, removals: s.eos.calls.filter((call) => call.op === 'remove').length };
    };
    const without = await answerTo(false);
    const withHidden = await answerTo(true);
    expect(withHidden.removals, 'the hidden friend\'s room with Mia is taken back too').toBeGreaterThan(without.removals);
    expect(withHidden.voice, 'and Owen is told exactly what he is told without her').toEqual(without.voice);
    expect(withHidden.voice).toEqual({ revoked: 1, revocationFailures: 0 });
  });

  it('a re-bind takes the former identity out of every room it held; later removals take out the identity each token admitted', async () => {
    const s = await hub(['amy', 'xan']);
    const room = roomsOf(await s.voice('amy', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }))[0]!.roomId;
    await s.voice('xan', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    s.eos.calls.length = 0;
    const rebound = await s.voice('amy', 'POST', '/wonderland/voice/identity', { idToken: idToken(PUID(9)) });
    expect((rebound?.body as { data: { outcome: string } }).data.outcome).toBe('REBIND');
    expect(s.eos.calls, 'the former identity is removed from the room it held').toEqual([{ op: 'remove', roomId: room, productUserId: PUID(1) }]);
    expect(await s.identities.openRoomsOf('amy')).toEqual([]);
    // Amy joins again as her new identity; when the wall moves, the identity her token admitted is the one removed.
    await s.voice('amy', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    s.eos.calls.length = 0;
    await s.social$('xan', { kind: 'BLOCK', targetId: 'amy' });
    expect(s.eos.calls.filter((call) => call.op === 'remove').map((call) => call.productUserId).sort()).toEqual([PUID(2), PUID(9)].sort());
  });

  it('a former identity Epic would not remove stays on the record, is never overwritten by a new token, and is removed on the retry', async () => {
    const s = await hub(['amy', 'xan']);
    const room = roomsOf(await s.voice('amy', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }))[0]!.roomId;
    s.eos.failRemovals(true);
    await s.voice('amy', 'POST', '/wonderland/voice/identity', { idToken: idToken(PUID(9)) });
    expect(await s.identities.openRoomsOf('amy'), 'not pretended removed').toEqual([room]);
    const joined = roomsOf(await s.voice('amy', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }));
    expect(joined, 'no token for a room the former identity still holds').toEqual([]);
    s.eos.failRemovals(false);
    s.eos.calls.length = 0;
    const again = roomsOf(await s.voice('amy', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }));
    expect(s.eos.calls[0], 'the former identity is removed first').toEqual({ op: 'remove', roomId: room, productUserId: PUID(1) });
    expect(again.map((row) => row.roomId)).toEqual([room]);
    expect(s.eos.calls.filter((call) => call.op === 'token')).toEqual([{ op: 'token', roomId: room, productUserId: PUID(9) }]);
  });

  it('an issuance is on the record before its token is asked for, so no token Epic issues is missing from it', async () => {
    const s = await hub(['amy', 'xan']);
    s.eos.failTokens(true);
    await expect(s.voice('amy', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' })).rejects.toThrow('epic unavailable');
    const asked = s.eos.calls.filter((call) => call.op === 'token').map((call) => call.roomId);
    expect(asked).toHaveLength(1);
    expect(await s.identities.openRoomsOf('amy'), 'the room Epic was asked about is on the record').toEqual(asked);
  });

  it('hiding mid-session takes the hidden player out of the strangers\' room', async () => {
    const s = await hub(['hana', 'sam']);
    const shared = roomsOf(await s.voice('hana', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }))[0]!.roomId;
    s.eos.calls.length = 0;
    await s.social$('hana', { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } });
    expect(s.eos.calls).toContainEqual({ op: 'remove', roomId: shared, productUserId: PUID(1) });
  });
  it('a player who has gone without a word is left alone in her rooms: the next heartbeat moves everyone live out of them', async () => {
    const s = await hub(['ann', 'ben', 'cal']);
    const annRooms = roomsOf(await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' })).map((room) => room.roomId);
    const benRooms = roomsOf(await s.voice('ben', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' })).map((room) => room.roomId);
    const calRooms = roomsOf(await s.voice('cal', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' })).map((room) => room.roomId);
    const withBen = annRooms.find((room) => benRooms.includes(room))!;
    const withCal = annRooms.find((room) => calRooms.includes(room))!;
    const benCal = benRooms.find((room) => calRooms.includes(room))!;
    // Ann's client is gone. Ben and Cal keep their heartbeat; while Ann's presence lives, her rooms stand.
    const beat = (k: number): number => NOW + k * WONDERLAND_PRESENCE_HEARTBEAT_SECONDS * 1000;
    for (const k of [1, 2, 3, 4]) {
      for (const id of ['ben', 'cal']) {
        expect((await s.social$(id, HEARTBEAT, beat(k)))?.body).toMatchObject({ data: { ok: true, code: 'DONE' }, voice: { revoked: 0, revocationFailures: 0 } });
      }
    }
    expect(s.eos.calls.filter((call) => call.op === 'remove')).toEqual([]);
    // One second past her time to live, Ben's next heartbeat takes both live players out of the rooms they shared with her.
    const gone = NOW + (WONDERLAND_PRESENCE_TTL_SECONDS + 1) * 1000;
    const moved = await s.social$('ben', HEARTBEAT, gone);
    expect((moved?.body as { voice: unknown }).voice, 'Ben is told about his own room').toEqual({ revoked: 1, revocationFailures: 0 });
    expect(s.eos.calls.filter((call) => call.op === 'remove').map((call) => [call.roomId, call.productUserId]).sort())
      .toEqual([[withBen, PUID(2)], [withCal, PUID(3)]].sort());
    expect(await s.identities.openRoomsOf('ben')).toEqual([benCal]);
    expect(await s.identities.openRoomsOf('cal')).toEqual([benCal]);
    // Her own issuances are not pretended revoked (nobody took them back), but nobody live shares those rooms any more.
    expect(await s.identities.openRoomsOf('ann')).toEqual([...annRooms].sort());
    // When she enters again she is reconciled like anyone who enters.
    await s.social$('ann', { kind: 'ENTER_INSTANCE', instanceId: 'public:hub', location: null, activity: 'IDLE', dogId: null }, gone);
    const back = roomsOf(await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }, gone));
    expect(back.map((room) => room.roomId).sort()).toEqual([...annRooms].sort());
  });
});

describe('one player\'s voice, one step at a time (review findings, 2026-10-05)', () => {
  const HIDE = { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } } as const;
  const SHOW = { kind: 'SET_SETTINGS', settings: { visibility: 'EVERYONE' } } as const;
  /** Long enough for every step that is not waiting on another to run to its end (the stores answer at once). */
  const moment = () => new Promise<void>((resolve) => { setTimeout(resolve, 25); });
  /** Every admission Epic holds that the record does not show as open for that identity: what no reconcile would ever take back. */
  const unrecorded = async (s: ReturnType<typeof stage>, players: Readonly<Record<string, string>>) => {
    const hidden: string[] = [];
    for (const [roomId, admitted] of s.eos.members) {
      for (const productUserId of admitted) {
        const playerId = Object.entries(players).find(([, puid]) => puid === productUserId)?.[0];
        const open = playerId === undefined ? [] : await s.identities.openIssuancesOf(playerId);
        if (!open.some((row) => row.roomId === roomId && row.productUserId === productUserId)) hidden.push(`${playerId ?? '?'} in ${roomId.slice(0, 9)}`);
      }
    }
    return hidden;
  };

  it('a re-issue racing the removal before it never leaves a token the record calls revoked, so a later block still separates the pair', async () => {
    const s = await hub(['amy', 'xan']);
    const pair = roomsOf(await s.voice('amy', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }))[0]!.roomId;
    await s.voice('xan', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    // Amy hides; while Epic's answer to a removal is in flight, she shows herself again and the removed player rejoins. First her own, then Xan's.
    for (const [rejoins, puid] of [['amy', PUID(1)], ['xan', PUID(2)]] as const) {
      const held = s.eos.holdRemoval((roomId, productUserId) => roomId === pair && productUserId === puid);
      const hide = s.socialNow$('amy', HIDE);
      await held.reached;
      const steps = [hide, s.socialNow$('amy', SHOW), s.voice(rejoins, 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' })];
      // Whatever can run while Epic's answer is out, runs: unserialized, the rejoin is issued before the removal is recorded.
      await moment();
      held.release();
      await Promise.all(steps);
      await s.settle();
      expect(await unrecorded(s, { amy: PUID(1), xan: PUID(2) }), `after ${rejoins}'s race: every admission is on the record`).toEqual([]);
    }
    await s.social$('xan', { kind: 'BLOCK', targetId: 'amy' });
    expect([...(s.eos.members.get(pair) ?? [])], 'a blocked pair shares no room').toEqual([]);
  });

  it('a re-bind landing inside a join: once both are done, the former identity is in no room and holds no token', async () => {
    const held = holdable(createMemoryWonderlandVoiceIdentityStore());
    const s = stage({ identities: held.store });
    for (const [i, name] of ['amy', 'xan'].entries()) {
      await s.player(name);
      await s.voice(name, 'POST', '/wonderland/voice/identity', { idToken: idToken(PUID(i + 1)) });
      await s.social$(name, { kind: 'ENTER_INSTANCE', instanceId: 'public:hub', location: null, activity: 'IDLE', dogId: null });
    }
    // The join has read Amy's identity and is planning when her re-bind arrives.
    const planning = held.hold('productUserIdsOf');
    const join = s.voice('amy', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    await planning.reached;
    const rebind = s.voice('amy', 'POST', '/wonderland/voice/identity', { idToken: idToken(PUID(9)) });
    // Unserialized, the re-bind would finish here, before the join mints for the identity it read.
    await moment();
    planning.release();
    const answers = await Promise.all([join, rebind]);
    await s.settle();
    expect(answers.map((answer) => answer?.status), 'both answered; neither threw').toEqual([200, 200]);
    expect([...s.eos.members.values()].some((admitted) => admitted.has(PUID(1))), 'the former identity is in no room').toBe(false);
    expect((await held.store.openIssuancesOf('amy')).filter((row) => row.productUserId === PUID(1))).toEqual([]);
  });

  it('a block committed inside a join: once the bridge settles, the joiner holds no room the block ended', async () => {
    const held = holdable(createMemoryWonderlandVoiceIdentityStore());
    const s = stage({ identities: held.store });
    for (const [i, name] of ['amy', 'xan'].entries()) {
      await s.player(name);
      await s.voice(name, 'POST', '/wonderland/voice/identity', { idToken: idToken(PUID(i + 1)) });
      await s.social$(name, { kind: 'ENTER_INSTANCE', instanceId: 'public:hub', location: null, activity: 'IDLE', dogId: null });
    }
    // The join has planned (Amy and Xan see each other) and is about to take back and issue when Xan blocks her.
    const planned = held.hold('openIssuancesOf');
    const join = s.voice('amy', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    await planned.reached;
    const block = s.socialNow$('xan', { kind: 'BLOCK', targetId: 'amy' });
    // The block is answered, and its reconcile of Amy would run here, before the join issues from its older plan.
    await block;
    await moment();
    planned.release();
    await Promise.all([join, block]);
    await s.settle();
    expect(await held.store.openIssuancesOf('amy'), 'nothing the block ended stays open').toEqual([]);
    expect([...s.eos.members.values()].some((admitted) => admitted.has(PUID(1))), 'Amy is in no room').toBe(false);
  });

  it('the actor\'s answer never waits for another player\'s removal: an owner is answered while the hidden friend\'s removal is still in flight (P1)', async () => {
    const s = stage();
    const names = ['owen', 'mia', 'hid'];
    for (const [i, name] of names.entries()) {
      await s.player(name);
      await s.voice(name, 'POST', '/wonderland/voice/identity', { idToken: idToken(PUID(i + 1)) });
    }
    await s.social$('owen', { kind: 'SERVER_CREATE', serverId: 'srv', name: 'Owen' });
    for (const member of ['mia', 'hid']) {
      await s.social$('owen', { kind: 'SERVER_INVITE', serverId: 'srv', inviteeId: member });
      await s.social$(member, { kind: 'SERVER_JOIN', serverId: 'srv' });
    }
    await s.social$('hid', HIDE);
    await s.social$('hid', { kind: 'FRIEND_REQUEST', toId: 'mia' });
    await s.social$('mia', { kind: 'FRIEND_ACCEPT', fromId: 'hid' });
    for (const name of names) await s.social$(name, { kind: 'ENTER_INSTANCE', instanceId: 'server:srv', location: null, activity: 'IDLE', dogId: null });
    for (const name of names) await s.voice(name, 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    // Epic makes the hidden friend's removal and does not answer it until released: an answer that waited for it would still be pending.
    const inFlight = s.eos.holdRemoval((_roomId, productUserId) => productUserId === PUID(3));
    let answered = false;
    const removal = s.socialNow$('owen', { kind: 'SERVER_REMOVE_MEMBER', serverId: 'srv', memberId: 'mia' }).then((answer) => { answered = true; return answer; });
    await inFlight.reached;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(answered, 'Owen has his answer while Hid\'s removal is still in flight').toBe(true);
    inFlight.release();
    expect(((await removal)?.body as { voice: unknown }).voice).toEqual({ revoked: 1, revocationFailures: 0 });
    await s.settle();
    expect([...s.eos.members.values()].filter((admitted) => admitted.has(PUID(2)) && admitted.has(PUID(3))), 'the hidden friend\'s room with Mia is still taken back').toEqual([]);
  });

  it('a command by a player nobody else can see reconciles nobody else: the work would be the only trace that they acted', async () => {
    const held = holdable(createMemoryWonderlandVoiceIdentityStore());
    const s = stage({ identities: held.store });
    for (const [i, name] of ['hana', 'sam', 'tom'].entries()) {
      await s.player(name);
      await s.voice(name, 'POST', '/wonderland/voice/identity', { idToken: idToken(PUID(i + 1)) });
    }
    await s.social$('hana', HIDE);
    for (const name of ['sam', 'tom', 'hana']) await s.social$(name, { kind: 'ENTER_INSTANCE', instanceId: 'public:hub', location: null, activity: 'IDLE', dogId: null });
    for (const name of ['sam', 'tom']) await s.voice(name, 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    held.calls.length = 0;
    await s.social$('hana', { kind: 'UPDATE_PRESENCE', location: null, activity: 'EXPLORING' });
    await s.social$('hana', { kind: 'LEAVE_INSTANCE' });
    expect(held.calls, 'only Hana\'s own voice was looked at').toEqual(['hana', 'hana']);
    // A visible player's command does reach the strangers who can see them.
    held.calls.length = 0;
    await s.social$('sam', { kind: 'LEAVE_INSTANCE' });
    expect([...new Set(held.calls)].sort()).toEqual(['sam', 'tom']);
  });
});

describe('the trusted server port, against a fake Epic', () => {
  it('asks Epic with the trusted credentials only in the Authorization header, and returns the participant\'s token', async () => {
    const requests: Array<{ url: string; method?: string; headers?: Record<string, string>; body?: string }> = [];
    const fetcher: WonderlandFetch = async (url, init) => {
      requests.push({ url, ...init });
      if (url.endsWith('/auth/v1/oauth/token')) return { status: 200, json: async () => ({ access_token: 'access-1', expires_in: 3600 }) };
      if (init?.method === 'DELETE') return { status: 204, json: async () => ({}) };
      return { status: 200, json: async () => ({ clientBaseUrl: 'https://rtc.example', participants: [{ puid: PUID(1), token: 'room-token-1' }] }) };
    };
    const port = createWonderlandEosVoicePort({ fetcher, deploymentId: 'dep-1', trustedClientId: 'TRUSTED-ID-MARKER', trustedClientSecret: 'TRUSTED-SECRET-MARKER', now: () => NOW });
    expect(await port.roomToken({ roomId: 'wl_' + 'a'.repeat(32), productUserId: PUID(1) })).toEqual({ token: 'room-token-1', clientBaseUrl: 'https://rtc.example' });
    await port.removeParticipant({ roomId: 'wl_' + 'a'.repeat(32), productUserId: PUID(1) });
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['POST', 'https://api.epicgames.dev/auth/v1/oauth/token'],
      ['POST', `https://api.epicgames.dev/rtc/v1/dep-1/room/wl_${'a'.repeat(32)}`],
      ['DELETE', `https://api.epicgames.dev/rtc/v1/dep-1/room/wl_${'a'.repeat(32)}/participants/${PUID(1)}`],
    ]);
    expect(requests[0]!.headers!.authorization).toBe(`Basic ${Buffer.from('TRUSTED-ID-MARKER:TRUSTED-SECRET-MARKER').toString('base64')}`);
    expect(requests[0]!.body).toBe('grant_type=client_credentials&deployment_id=dep-1');
    for (const request of requests.slice(1)) {
      expect(request.headers!.authorization).toBe('Bearer access-1');
      expect(JSON.stringify(request)).not.toMatch(/TRUSTED-SECRET-MARKER/u);
    }
  });
});
