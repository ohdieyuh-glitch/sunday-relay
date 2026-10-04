import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { WONDERLAND_PRESENCE_HEARTBEAT_SECONDS, WONDERLAND_PRESENCE_TTL_SECONDS, createMemoryWonderlandSocialStore } from '../src/relay/mission/wonderland-social';
import { createMemoryWonderlandVoiceIdentityStore } from '../src/relay/mission/wonderland-voice';
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

function fakeEos() {
  const calls: Array<{ op: 'token' | 'remove'; roomId: string; productUserId: string }> = [];
  let failRemovals = false;
  return {
    calls,
    failRemovals: (value: boolean) => { failRemovals = value; },
    port: {
      async roomToken({ roomId, productUserId }: { roomId: string; productUserId: string }) {
        calls.push({ op: 'token', roomId, productUserId });
        return { token: `token:${roomId}:${productUserId}`, clientBaseUrl: 'https://rtc.example' };
      },
      async removeParticipant({ roomId, productUserId }: { roomId: string; productUserId: string }) {
        calls.push({ op: 'remove', roomId, productUserId });
        if (failRemovals) throw new Error('epic unavailable');
      },
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
  const social$ = (id: string, command: unknown, now: number = NOW) => handleWonderlandSocialRoute({
    method: 'POST', path: '/wonderland/social/commands', url: '/wonderland/social/commands', origin: ORIGIN, now,
    authorization: `Relay-Session ${tokens.get(id)!}`, body: { commandId: `c-${String(++n)}`, command },
  }, {
    store: social, sessions, allowNative: false,
    afterCommand: async ({ actorId, command: done, before, after, at }) =>
      reconcileWonderlandVoice(ports, wonderlandVoiceAffected(before, after, actorId, done), at),
  });
  return { ports, social, identities, eos, player, voice, social$ };
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

  it('everyone visible to everyone: one room, and tokens only for it', async () => {
    const s = await hub(['ann', 'ben', 'cal']);
    const rooms = roomsOf(await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }));
    expect(rooms).toHaveLength(1);
    expect(s.eos.calls).toEqual([{ op: 'token', roomId: rooms[0]!.roomId, productUserId: PUID(1) }]);
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
  it('a block mid-session removes both from the shared room on the trusted server', async () => {
    const s = await hub(['ann', 'ben', 'cal']);
    const shared = roomsOf(await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }))[0]!.roomId;
    await s.voice('ben', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    await s.voice('cal', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    s.eos.calls.length = 0;
    const blocked = await s.social$('ann', { kind: 'BLOCK', targetId: 'ben' });
    expect((blocked?.body as { voice: unknown }).voice).toEqual({ revoked: 3, revocationFailures: 0 });
    expect(s.eos.calls.filter((call) => call.op === 'remove').map((call) => [call.roomId, call.productUserId]).sort())
      .toEqual([[shared, PUID(1)], [shared, PUID(2)], [shared, PUID(3)]].sort());
    expect(await s.identities.openRoomsOf('ann')).toEqual([]);
    // Rejoining issues the new plan: Ann and Ben never share a room again.
    const annRooms = roomsOf(await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' })).map((room) => room.roomId);
    const benRooms = roomsOf(await s.voice('ben', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' })).map((room) => room.roomId);
    expect(annRooms.filter((room) => benRooms.includes(room))).toEqual([]);
  });

  it('a removal Epic refuses is reported, the issuance stays open, and the next reconcile retries it', async () => {
    const s = await hub(['ann', 'ben']);
    await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    s.eos.failRemovals(true);
    const blocked = await s.social$('ben', { kind: 'BLOCK', targetId: 'ann' });
    expect((blocked?.body as { voice: { revocationFailures: number } }).voice.revocationFailures).toBe(1);
    expect(await s.identities.openRoomsOf('ann'), 'still open: not pretended revoked').toHaveLength(1);
    s.eos.failRemovals(false);
    const retried = await reconcileWonderlandVoice(s.ports, ['ann'], '2026-10-04T12:05:00.000Z');
    expect(retried.removed).toHaveLength(1);
    expect(await s.identities.openRoomsOf('ann')).toEqual([]);
  });

  it('hiding mid-session takes the hidden player out of the strangers\' room', async () => {
    const s = await hub(['hana', 'sam']);
    const shared = roomsOf(await s.voice('hana', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }))[0]!.roomId;
    s.eos.calls.length = 0;
    await s.social$('hana', { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } });
    expect(s.eos.calls).toContainEqual({ op: 'remove', roomId: shared, productUserId: PUID(1) });
  });
  it('a player who has gone without a word is left alone in their last room: the next heartbeat moves everyone live out of it', async () => {
    const s = await hub(['ann', 'ben', 'cal']);
    const shared = roomsOf(await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }))[0]!.roomId;
    await s.voice('ben', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    await s.voice('cal', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' });
    // Ann's client is gone. Ben and Cal keep their heartbeat; while Ann's presence lives, the room stands.
    const beat = (k: number): number => NOW + k * WONDERLAND_PRESENCE_HEARTBEAT_SECONDS * 1000;
    for (const k of [1, 2, 3, 4]) {
      for (const id of ['ben', 'cal']) {
        expect((await s.social$(id, HEARTBEAT, beat(k)))?.body).toMatchObject({ data: { ok: true, code: 'DONE' }, voice: { revoked: 0, revocationFailures: 0 } });
      }
    }
    expect(s.eos.calls.filter((call) => call.op === 'remove')).toEqual([]);
    // One second past her time to live, Ben's next heartbeat takes both live players out of the room she is in.
    const gone = NOW + (WONDERLAND_PRESENCE_TTL_SECONDS + 1) * 1000;
    const moved = await s.social$('ben', HEARTBEAT, gone);
    expect((moved?.body as { voice: unknown }).voice).toEqual({ revoked: 2, revocationFailures: 0 });
    expect(s.eos.calls.filter((call) => call.op === 'remove').map((call) => [call.roomId, call.productUserId]))
      .toEqual([[shared, PUID(2)], [shared, PUID(3)]]);
    expect(await s.identities.openRoomsOf('ben')).toEqual([]);
    expect(await s.identities.openRoomsOf('cal')).toEqual([]);
    // Her own issuance is not pretended revoked — nobody took it back — but nobody live shares that room any more.
    expect(await s.identities.openRoomsOf('ann')).toEqual([shared]);
    // When she enters again she is reconciled like anyone who enters.
    await s.social$('ann', { kind: 'ENTER_INSTANCE', instanceId: 'public:hub', location: null, activity: 'IDLE', dogId: null }, gone);
    const back = roomsOf(await s.voice('ann', 'POST', '/wonderland/voice/join', { channel: 'INSTANCE' }, gone));
    expect(back.map((room) => room.roomId)).toEqual([shared]);
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
