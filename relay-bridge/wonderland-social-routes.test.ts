import { describe, expect, it } from 'vitest';

import { WONDERLAND_PRESENCE_TTL_SECONDS, createMemoryWonderlandSocialStore } from '../src/relay/mission/wonderland-social';
import { NATIVE_WORLD_AUDIENCE, createBrowserSessionStore } from './browser-session/grants';
import { createWonderlandCommandLimiter } from './wonderland-social-rate-limit';
import {
  handleWonderlandSocialRoute,
  isWonderlandSocialRoute,
  parseWonderlandSocialCommand,
  type WonderlandSocialRoutePorts,
  type WonderlandSocialRouteRequest,
} from './wonderland-social-routes';

/**
 * THE SOCIAL API, HELD TO WHO MAY ASK AND WHAT THEY ARE TOLD.
 *
 * Real session store, real credentials: a player session minted the way sign-in
 * mints it, a read-only browser session, the operator's bearer token, a native
 * client's session paired the way the desktop client pairs, and a browser token
 * copied into a client that sends no Origin. The privacy wall itself is proven
 * in the domain; these cases prove the routes put the right player in front of
 * it and pass its answers through untouched.
 */

const ORIGIN = 'https://wonderland.example';
const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const NO_ORIGIN = '<no origin>';

function stage(over: Partial<WonderlandSocialRoutePorts> = {}) {
  const sessions = createBrowserSessionStore();
  const store = createMemoryWonderlandSocialStore();
  const player = (participantId: string): string => {
    const minted = sessions.mintIdentitySession({ origin: ORIGIN, now: NOW, participantId, scope: 'browser_control' });
    if (!minted.ok) throw new Error('mint failed');
    return minted.session.token;
  };
  const native = (participantId: string): string => {
    const grant = sessions.createGrant({ origin: NATIVE_WORLD_AUDIENCE, now: NOW, scope: 'native_world', participantId, projectId: 'prj-1' });
    const consumed = sessions.consumeGrant({ grantId: grant.grantId, secret: grant.secret, origin: NATIVE_WORLD_AUDIENCE, now: NOW });
    if (!consumed.ok) throw new Error('pair failed');
    return consumed.session.token;
  };
  const ports: WonderlandSocialRoutePorts = { store, sessions, allowNative: false, displayNameFor: async (id) => id.toUpperCase(), ...over };
  /** `NO_ORIGIN` sends no Origin header at all, as a native client does. (A default parameter would swallow `undefined`.) */
  const call = (token: string | null, method: string, path: string, body?: unknown, origin: string = ORIGIN, now: number = NOW) =>
    handleWonderlandSocialRoute({
      method, path, url: path, origin: origin === NO_ORIGIN ? undefined : origin, body, now,
      authorization: token === null ? undefined : `Relay-Session ${token}`,
    } satisfies WonderlandSocialRouteRequest, ports);
  let sequence = 0;
  const command = (token: string, value: unknown, now: number = NOW) =>
    call(token, 'POST', '/wonderland/social/commands', { commandId: `c-${String(++sequence)}`, command: value }, ORIGIN, now);
  return { sessions, store, ports, player, native, call, command };
}

describe('who may ask', () => {
  it('serves only /wonderland/social/*', async () => {
    expect(isWonderlandSocialRoute('/wonderland/social/me')).toBe(true);
    expect(isWonderlandSocialRoute('/wonderland/events')).toBe(false);
    expect(await stage().call(null, 'GET', '/wonderland/events')).toBeNull();
  });

  it('a signed-in player is served, as themselves, with their account name', async () => {
    const { player, call } = stage();
    const result = await call(player('ann'), 'GET', '/wonderland/social/me');
    expect(result?.status).toBe(200);
    expect((result?.body as { data: { playerId: string; settings: unknown } }).data).toMatchObject({ playerId: 'ann', settings: { visibility: 'EVERYONE' } });
  });

  it('no session, the operator token, and a read-only browser session are all refused', async () => {
    const { sessions, call } = stage();
    expect((await call(null, 'GET', '/wonderland/social/me'))?.status).toBe(401);
    const operator = await handleWonderlandSocialRoute({
      method: 'GET', path: '/wonderland/social/me', url: '/wonderland/social/me', origin: ORIGIN, body: undefined, now: NOW,
      authorization: 'Bearer operator-token',
    }, stage().ports);
    expect(operator?.status).toBe(401);
    const grant = sessions.createGrant({ origin: ORIGIN, now: NOW });
    const readOnly = sessions.consumeGrant({ grantId: grant.grantId, secret: grant.secret, origin: ORIGIN, now: NOW });
    if (!readOnly.ok) throw new Error('grant failed');
    expect((await call(readOnly.session.token, 'GET', '/wonderland/social/me'))?.status).toBe(403);
  });

  it('a player session from another origin is refused', async () => {
    const { player, call } = stage();
    expect((await call(player('ann'), 'GET', '/wonderland/social/me', undefined, 'https://elsewhere.example'))?.status).toBe(401);
  });

  it('THE COPY GUARD: a browser player token sent with no Origin is not a player here', async () => {
    const { player, call } = stage();
    const copied = await call(player('ann'), 'GET', '/wonderland/social/me', undefined, NO_ORIGIN);
    expect(copied?.status).toBe(403);
    const enabled = stage({ allowNative: true });
    expect((await enabled.call(enabled.player('ann'), 'GET', '/wonderland/social/me', undefined, NO_ORIGIN))?.status, 'not even with native social on').toBe(401);
  });

  it('a paired native client is refused while native social is off, and served as its player once it is on', async () => {
    const off = stage();
    const refused = await off.call(off.native('ann'), 'GET', '/wonderland/social/me', undefined, NO_ORIGIN);
    expect(refused?.status).toBe(403);
    expect((refused?.body as { error: { kind: string } }).error.kind).toBe('native_social_not_enabled');
    const on = stage({ allowNative: true });
    const served = await on.call(on.native('ann'), 'GET', '/wonderland/social/me', undefined, NO_ORIGIN);
    expect(served?.status).toBe(200);
    expect((served?.body as { data: { playerId: string } }).data.playerId).toBe('ann');
    expect((await on.call(on.native('ann'), 'GET', '/wonderland/social/me', undefined, ORIGIN))?.status, 'a native credential from a web origin fails its origin binding').toBe(401);
  });

  it('no database: 503, and nothing is pretended', async () => {
    const { player, call } = stage({ store: null });
    expect((await call(player('ann'), 'GET', '/wonderland/social/me'))?.status).toBe(503);
  });
});

describe('what the wire accepts', () => {
  it('a command has exactly its kind\'s fields: an extra one is refused, not ignored', () => {
    expect(parseWonderlandSocialCommand({ kind: 'BLOCK', targetId: 'ben' })).toEqual({ kind: 'BLOCK', targetId: 'ben' });
    expect(parseWonderlandSocialCommand({ kind: 'BLOCK', targetId: 'ben', silently: true })).toBeNull();
    expect(parseWonderlandSocialCommand({ kind: 'BLOCK' })).toBeNull();
    expect(parseWonderlandSocialCommand({ kind: 'BECOME_ADMIN' })).toBeNull();
    expect(parseWonderlandSocialCommand({ kind: 'SET_SETTINGS', settings: { visibility: 'EVERYONE' }, appearInRecentPlayers: false })).toBeNull();
  });

  it('a write needs a command id, and the actor is the session\'s player whatever the body says', async () => {
    const { player, call, command, store } = stage();
    const ann = player('ann');
    await call(player('ben'), 'GET', '/wonderland/social/me');
    expect((await call(ann, 'POST', '/wonderland/social/commands', { command: { kind: 'BLOCK', targetId: 'ben' } }))?.status).toBe(400);
    const done = await command(ann, { kind: 'BLOCK', targetId: 'ben' });
    expect(done).toEqual({ status: 200, body: { data: { ok: true, code: 'DONE' } } });
    expect(store.snapshot().blocks.map((block) => [block.blockerId, block.blockedId])).toEqual([['ann', 'ben']]);
    const self = await command(ann, { kind: 'BLOCK', targetId: 'ann' });
    expect(self?.status).toBe(400);
  });

  it('a refusal about another player is a 409 with the one generic code', async () => {
    const { player, command } = stage();
    expect(await command(player('ann'), { kind: 'FRIEND_REQUEST', toId: 'nobody' })).toEqual({ status: 409, body: { data: { ok: false, code: 'UNAVAILABLE' } } });
  });
});

describe('what a player is told', () => {
  it('the roster, a lookup and a conversation pass the privacy wall\'s answers through untouched', async () => {
    const { player, call, command } = stage();
    const ann = player('ann');
    const ben = player('ben');
    const hana = player('hana');
    for (const token of [ann, ben, hana]) await call(token, 'GET', '/wonderland/social/me');
    await command(hana, { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } });
    for (const token of [ann, ben, hana]) {
      await command(token, { kind: 'ENTER_INSTANCE', instanceId: 'public:hub', location: null, activity: 'IDLE', dogId: null });
    }
    const roster = (await call(ann, 'GET', '/wonderland/social/roster'))?.body as { data: { players: Array<{ playerId: string; displayName: string }> } };
    expect(roster.data.players.map((entry) => [entry.playerId, entry.displayName])).toEqual([['ann', 'ANN'], ['ben', 'BEN']]);
    expect((await call(ann, 'GET', '/wonderland/social/presence/hana'))?.body).toEqual({ data: { status: 'UNAVAILABLE' } });
    expect((await call(ann, 'GET', '/wonderland/social/presence/no-such-player'))?.body).toEqual({ data: { status: 'UNAVAILABLE' } });
    const listing = (await call(ann, 'GET', '/wonderland/social/instances?ids=public:hub,not-an-instance'))?.body;
    expect(listing).toEqual({ data: [{ instanceId: 'public:hub', population: 2 }] });
    await command(ann, { kind: 'SEND_MESSAGE', messageId: 'm-1', toId: 'ben', body: 'hello' });
    await command(ben, { kind: 'BLOCK', targetId: 'ann' });
    expect((await call(ann, 'GET', '/wonderland/social/conversations/ben'))?.body).toEqual({ data: [] });
    expect((await call(ben, 'GET', '/wonderland/social/conversations/ann'))?.body).toEqual({ data: [] });
  });

  it('a player who has gone without a word stops being reported at every route, and their own heartbeat is told to enter again', async () => {
    const { player, call, command } = stage();
    const ann = player('ann');
    const ben = player('ben');
    for (const token of [ann, ben]) await call(token, 'GET', '/wonderland/social/me');
    expect((await command(ann, { kind: 'FRIEND_REQUEST', toId: 'ben' }))?.status).toBe(200);
    expect((await command(ben, { kind: 'FRIEND_ACCEPT', fromId: 'ann' }))?.body).toEqual({ data: { ok: true, code: 'DONE' } });
    for (const token of [ann, ben]) {
      await command(token, { kind: 'ENTER_INSTANCE', instanceId: 'public:hub', location: null, activity: 'IDLE', dogId: null });
    }
    // Ben keeps his heartbeat. Ann's client is gone and says nothing.
    expect((await command(ben, { kind: 'UPDATE_PRESENCE', location: null, activity: 'IDLE' }, NOW + 60_000))?.body).toEqual({ data: { ok: true, code: 'DONE' } });
    const edge = NOW + WONDERLAND_PRESENCE_TTL_SECONDS * 1000;
    const gone = edge + 1000;
    const get = (token: string, path: string, now: number) => call(token, 'GET', path, undefined, ORIGIN, now);
    expect((await get(ben, '/wonderland/social/presence/ann', edge))?.body).toMatchObject({ data: { status: 'AVAILABLE', instanceId: 'public:hub' } });
    expect((await get(ben, '/wonderland/social/presence/ann', gone))?.body).toEqual({ data: { status: 'UNAVAILABLE' } });
    const roster = (await get(ben, '/wonderland/social/roster', gone))?.body as { data: { players: Array<{ playerId: string }> } };
    expect(roster.data.players.map((entry) => entry.playerId)).toEqual(['ben']);
    expect((await get(ben, '/wonderland/social/instances?ids=public:hub', gone))?.body).toEqual({ data: [{ instanceId: 'public:hub', population: 1 }] });
    // Ann's client comes back: her heartbeat is not a silent revival, and entering again is.
    const stale = await command(ann, { kind: 'UPDATE_PRESENCE', location: null, activity: 'IDLE' }, gone);
    expect([stale?.status, stale?.body]).toEqual([409, { data: { ok: false, code: 'NOT_IN_INSTANCE' } }]);
    expect((await get(ann, '/wonderland/social/roster', gone))?.body).toEqual({ data: { available: false } });
    await command(ann, { kind: 'ENTER_INSTANCE', instanceId: 'public:hub', location: null, activity: 'IDLE', dogId: null }, gone);
    expect((await get(ben, '/wonderland/social/presence/ann', gone))?.body).toMatchObject({ data: { status: 'AVAILABLE' } });
  });

  it('a malformed path is a 404, not an exception', async () => {
    const { player, call } = stage();
    expect((await call(player('ann'), 'GET', '/wonderland/social/presence/%E0%A4%A'))?.status).toBe(404);
    expect((await call(player('ann'), 'GET', '/wonderland/social/presence/a/b'))?.status).toBe(404);
    expect((await call(player('ann'), 'DELETE', '/wonderland/social/me'))?.status).toBe(405);
  });
});

describe('display names come from the account, and a request that knows none never erases one', () => {
  it('a name recorded at sign-in survives every later request, and reaches only those who may see the player', async () => {
    const { store, player, command, call } = stage({ displayNameFor: undefined });
    const ann = player('ann');
    const bob = player('bob');
    // What sign-in records from the verified identity (`onIdentityVerified`).
    await store.upsertProfile({ playerId: 'ann', displayName: 'ann-on-github' });
    for (const token of [ann, bob, ann]) await call(token, 'GET', '/wonderland/social/me');
    for (const token of [ann, bob]) {
      await command(token, { kind: 'ENTER_INSTANCE', instanceId: 'public:plaza', location: null, activity: 'IDLE', dogId: null });
    }
    const named = (view: unknown, playerId: string) =>
      ((view as { data: { players: { playerId: string; displayName: string | null }[] } }).data.players.find((entry) => entry.playerId === playerId) ?? null);
    expect(named((await call(bob, 'GET', '/wonderland/social/roster'))!.body, 'ann')?.displayName).toBe('ann-on-github');
    // A player the account never named is Unknown — null — never a guess.
    expect(named((await call(ann, 'GET', '/wonderland/social/roster'))!.body, 'bob')?.displayName).toBeNull();
    expect(store.snapshot().profiles.ann).toEqual({ displayName: 'ann-on-github' });
    // Hidden from strangers, the name goes with everything else.
    await command(ann, { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } });
    expect(JSON.stringify((await call(bob, 'GET', '/wonderland/social/roster'))!.body)).not.toContain('ann-on-github');
  });

  it('a composition with an authoritative source still supplies the name on every request', async () => {
    const { store, player, call } = stage();
    await call(player('cal'), 'GET', '/wonderland/social/me');
    expect(store.snapshot().profiles.cal).toEqual({ displayName: 'CAL' });
  });
});

describe('a flood from one signed-in player', () => {
  it('is refused at its budget with 429, executes nothing past it, and leaves every other player untouched', async () => {
    const { player, command, call } = stage({ limiter: createWonderlandCommandLimiter() });
    const ann = player('ann');
    const ben = player('ben');
    const cal = player('cal');
    await call(ben, 'GET', '/wonderland/social/me');
    await call(cal, 'GET', '/wonderland/social/me');
    for (const [from, to] of [[ann, 'ben'], [ben, 'ann']] as const) await command(from, { kind: 'FRIEND_REQUEST', toId: to });
    const sent = [];
    for (let index = 0; index < 25; index += 1) {
      sent.push(await command(ann, { kind: 'SEND_MESSAGE', messageId: `flood-${String(index)}`, toId: 'ben', body: `message ${String(index)}` }));
    }
    expect(sent.slice(0, 20).every((result) => result?.status === 200), 'twenty are a person\'s burst').toBe(true);
    for (const refused of sent.slice(20)) {
      expect(refused).toMatchObject({ status: 429, body: { error: { kind: 'rate_limited', bucket: 'message', retryAfterSeconds: 3 } }, headers: { 'retry-after': '3' } });
      expect((refused?.body as { error: { message: string } }).error.message).toContain('this command was not executed');
    }
    const conversation = await call(ben, 'GET', '/wonderland/social/conversations/ann');
    expect((conversation?.body as { data: unknown[] }).data, 'nothing past the budget was stored').toHaveLength(20);
    // Everyone else is untouched, and ann may still do what is not a message.
    expect((await command(cal, { kind: 'SEND_MESSAGE', messageId: 'cal-1', toId: 'ben', body: 'hi' }))?.status).toBe(200);
    expect((await command(ben, { kind: 'SEND_MESSAGE', messageId: 'ben-1', toId: 'ann', body: 'slow down' }))?.status).toBe(200);
    expect((await command(ann, { kind: 'BLOCK', targetId: 'cal' }))?.status, 'a block is never held behind a message budget').toBe(200);
    // Three seconds later one more message is admitted.
    expect((await command(ann, { kind: 'SEND_MESSAGE', messageId: 'later', toId: 'ben', body: 'later' }, NOW + 3_000))?.status).toBe(200);
  });

  it('without a limiter composed, nothing is limited, as before', async () => {
    const { player, command, call } = stage();
    const ann = player('ann');
    const ben = player('ben');
    await call(ben, 'GET', '/wonderland/social/me');
    for (const [from, to] of [[ann, 'ben'], [ben, 'ann']] as const) await command(from, { kind: 'FRIEND_REQUEST', toId: to });
    for (let index = 0; index < 30; index += 1) {
      expect((await command(ann, { kind: 'SEND_MESSAGE', messageId: `free-${String(index)}`, toId: 'ben', body: 'x' }))?.status).toBe(200);
    }
  });
});
