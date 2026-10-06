import { describe, expect, it } from 'vitest';
import { createInMemorySocialStore, type SocialStore } from '../src/relay/social/social-store';
import { randomBytes } from 'node:crypto';
import { createInMemoryVoiceBindings } from '../src/relay/social/voice-binding';
import { hashId } from './eos-voice';
import {
  createSessionRateLimit,
  endSocialPresence,
  EOS_CLIENT_CONFIG_RATE,
  handleSocialRoute,
  type SocialRouteDeps,
  type SocialRouteResult,
  type SocialSessionFacts,
} from './wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY } from './wonderland-social-scope';

/*
 * TWO REAL PLAYERS THROUGH THE REAL ROUTES. Kai and Nova each hold a native session with the `social` capability; Mira's
 * session lacks it. Every call goes through handleSocialRoute -- the gates, the actor binding, the store's atomic apply and
 * its events -- exactly as the bridge would run it; only the session store and the account lookup are stand-ins.
 */

const T0 = Date.parse('2026-10-02T12:00:00.000Z');

const SESSIONS: Record<string, SocialSessionFacts> = {
  'tok-kai': { sessionId: 's1', participantId: 'usr_kai', capabilities: [NATIVE_SOCIAL_CAPABILITY] },
  'tok-nova': { sessionId: 's2', participantId: 'usr_nova', capabilities: [NATIVE_SOCIAL_CAPABILITY] },
  'tok-mira': { sessionId: 's3', participantId: 'usr_mira', capabilities: [] },
  'tok-vega': { sessionId: 's4', participantId: 'usr_vega', capabilities: [NATIVE_SOCIAL_CAPABILITY] },
};

function world(store: SocialStore = createInMemorySocialStore()) {
  let clock = T0;
  const deps: SocialRouteDeps = {
    verifySession: (token) => SESSIONS[token] ?? null,
    identify: async (participantId) => ({ userId: participantId, displayName: participantId.replace('usr_', '').replace(/^./, (c) => c.toUpperCase()), handle: `@${participantId.replace('usr_', '')}` }),
    store,
  };
  const call = async (token: string | null, method: string, path: string, body: unknown = null, origin?: string) => {
    clock += 1000;
    const result = await handleSocialRoute(
      { method, path, authorization: token === null ? undefined : `Relay-Session ${token}`, origin, body, now: clock },
      deps,
    );
    if (result === null) throw new Error(`not a social route: ${path}`);
    return result as { status: number; body: { data?: any; error?: { kind: string; message: string } } };
  };
  const as = (token: string) => ({
    get: (path: string) => call(token, 'GET', `/wonderland/social${path}`),
    post: (path: string, body: unknown = {}) => call(token, 'POST', `/wonderland/social${path}`, body),
  });
  return { call, kai: as('tok-kai'), nova: as('tok-nova'), mira: as('tok-mira'), vega: as('tok-vega') };
}

describe('the social routes: who may call', () => {
  it('refuses no session, a browser origin, a session without the capability, and anything not in the table', async () => {
    const w = world();
    expect((await w.call(null, 'GET', '/wonderland/social/snapshot')).status).toBe(401);
    expect((await w.call('tok-nope', 'GET', '/wonderland/social/snapshot')).status).toBe(401);
    expect((await w.call('tok-kai', 'GET', '/wonderland/social/snapshot', null, 'https://evil.example')).status).toBe(403);
    expect((await w.mira.get('/snapshot')).body.error?.kind).toBe('not_permitted');
    expect((await w.kai.get('/admin/users')).body.error?.kind).toBe('not_permitted');
    expect((await w.kai.get('/profiles/../../x')).body.error?.kind).toBe('not_permitted');
    expect((await w.kai.post('/requests', { toUserId: 'usr_nova', fromUserId: 'usr_nova' })).body.error?.kind).toBe('actor_mismatch');
  });

  it('is 503 without a store, after the gates', async () => {
    const deps: SocialRouteDeps = { verifySession: (t) => SESSIONS[t] ?? null, identify: async () => null, store: null };
    const result = await handleSocialRoute({ method: 'GET', path: '/wonderland/social/snapshot', authorization: 'Relay-Session tok-kai', origin: undefined, body: null, now: T0 }, deps);
    expect(result?.status).toBe(503);
  });
});

describe('the social routes: two players, the launch loop', () => {
  it('a new player gets a record on first contact: Relay OG, rank and level PENDING, no friends', async () => {
    const w = world();
    const snap = (await w.kai.get('/snapshot')).body.data;
    expect(snap.developmentPreview).toBe(false);
    expect(snap.schema).toBe('relay-wonderland-social-view.v1');
    expect(snap.viewerId).toBe('usr_kai');
    expect(snap.self.profile.relayDog.skinId).toBe('relay_og');
    expect(snap.self.profile.progression).toEqual({ source: 'PENDING', rank: null, level: null });
    expect(snap.friends).toEqual([]);
    expect(snap.voiceStates).toEqual([]);
  });

  it('friend request -> the other is told -> accept -> both see each other, with presence', async () => {
    const w = world();
    await w.kai.get('/snapshot');
    await w.nova.get('/snapshot');
    const latestNova = (await w.nova.get('/events')).body.data.latest;
    expect((await w.kai.post('/requests', { toUserId: 'usr_nova' })).status).toBe(200);
    const told = (await w.nova.get(`/events?after=${latestNova}`)).body.data;
    expect(told.events.map((e: any) => e.op)).toEqual(['requests.send']);
    const incoming = (await w.nova.get('/snapshot')).body.data.requests.incoming;
    expect(incoming.map((r: any) => r.from.userId)).toEqual(['usr_kai']);
    expect((await w.nova.post(`/requests/${incoming[0].requestId}/accept`)).status).toBe(200);
    expect((await w.kai.get('/snapshot')).body.data.friends.map((f: any) => f.userId)).toEqual(['usr_nova']);
    expect((await w.nova.get('/snapshot')).body.data.friends.map((f: any) => f.userId)).toEqual(['usr_kai']);

    // presence: Kai reports a GvE battle; Nova, a friend, sees it on her next read
    await w.kai.post('/presence', { connected: true, availability: 'AVAILABLE', signals: { inGveBattle: true } });
    const kaiSeenByNova = (await w.nova.get('/snapshot')).body.data.friends[0].presence;
    expect(kaiSeenByNova.onlineState).toBe('ONLINE');
    expect(kaiSeenByNova.headline).toBe('IN GVE');
  });

  it('messages: open, send, the other is told, reads it, unread clears', async () => {
    const w = await friends();
    const opened = (await w.kai.post('/conversations', { otherUserId: 'usr_nova' })).body.data;
    expect(typeof opened.conversationId).toBe('string');
    const before = (await w.nova.get('/events')).body.data.latest;
    expect((await w.kai.post(`/conversations/${opened.conversationId}/messages`, { body: 'Running in Golden Arrival.' })).status).toBe(200);
    expect((await w.nova.get(`/events?after=${before}`)).body.data.events.map((e: any) => e.op)).toEqual(['messages.send']);
    const inbox = (await w.nova.get('/snapshot')).body.data.conversations;
    expect(inbox[0].unread).toBe(1);
    const history = (await w.nova.get(`/conversations/${opened.conversationId}/messages`)).body.data;
    expect(history.map((m: any) => m.body)).toEqual(['Running in Golden Arrival.']);
    await w.nova.post(`/conversations/${opened.conversationId}/read`, {});
    expect((await w.nova.get('/snapshot')).body.data.conversations[0].unread).toBe(0);
    // a session without the capability is stopped at the gate; a capable stranger by the conversation's own membership
    expect((await w.mira.get(`/conversations/${opened.conversationId}/messages`)).status).toBe(403);
    await w.vega.get('/snapshot');
    const stranger = await w.vega.get(`/conversations/${opened.conversationId}/messages`);
    expect(stranger.status).toBe(404);
    expect(JSON.stringify(stranger.body)).not.toContain('Golden Arrival');
  });

  it('party: create, invite, the invitee is told, accepts, both are in it; leave', async () => {
    const w = await friends();
    const partyId = (await w.kai.post('/parties', { name: 'Lab Crew' })).body.data.partyId;
    const before = (await w.nova.get('/events')).body.data.latest;
    expect((await w.kai.post(`/parties/${partyId}/invites`, { toUserId: 'usr_nova' })).status).toBe(200);
    expect((await w.nova.get(`/events?after=${before}`)).body.data.events.map((e: any) => e.op)).toEqual(['parties.invite']);
    const invite = (await w.nova.get('/snapshot')).body.data.partyInvites[0];
    expect(invite.partyName).toBe('Lab Crew');
    expect((await w.nova.post(`/party-invites/${invite.inviteId}/accept`)).status).toBe(200);
    const kaiParty = (await w.kai.get('/snapshot')).body.data.party;
    expect(kaiParty.members.map((m: any) => m.userId).sort()).toEqual(['usr_kai', 'usr_nova']);
    expect(kaiParty.viewerIsLeader).toBe(true);
    expect((await w.nova.post(`/parties/${partyId}/leave`)).status).toBe(200);
    expect((await w.kai.get('/snapshot')).body.data.party.members.map((m: any) => m.userId)).toEqual(['usr_kai']);
  });

  it('block: the blocked player is never told of a block (only of the ended friendship, as by any unfriend), can no longer message, and the blocker vanishes from their view', async () => {
    const w = await friends();
    const conversationId = (await w.kai.post('/conversations', { otherUserId: 'usr_nova' })).body.data.conversationId;
    const kaiBefore = (await w.kai.get('/events')).body.data.latest;
    expect((await w.nova.post('/blocks', { targetId: 'usr_kai' })).status).toBe(200);
    expect((await w.kai.get(`/events?after=${kaiBefore}`)).body.data.events.map((e: any) => e.op)).toEqual(['friends.remove']);
    expect((await w.kai.post(`/conversations/${conversationId}/messages`, { body: 'hello?' })).status).not.toBe(200);
    const kaiView = (await w.kai.get('/snapshot')).body.data;
    expect(kaiView.friends).toEqual([]);
    expect(kaiView.profiles.usr_nova).toBeUndefined();
    // and Nova still sees her own block's effect: Kai is no friend of hers either
    expect((await w.nova.get('/snapshot')).body.data.friends).toEqual([]);
  });

  it('mute and report are told to nobody but the actor', async () => {
    const w = await friends();
    const novaBefore = (await w.nova.get('/events')).body.data.latest;
    expect((await w.kai.post('/mutes', { targetId: 'usr_nova', voice: true, messages: false })).status).toBe(200);
    expect((await w.kai.post('/reports', { reportedId: 'usr_nova', reason: 'SPAM', note: 'test' })).status).toBe(200);
    expect((await w.nova.get(`/events?after=${novaBefore}`)).body.data.events).toEqual([]);
  });

  it('a client too far behind the event log is told to refresh', async () => {
    const w = world(createInMemorySocialStore(undefined, { maxEvents: 2 }));
    await w.kai.get('/snapshot');
    await w.nova.get('/snapshot');
    await w.kai.post('/requests', { toUserId: 'usr_nova' });
    for (let i = 0; i < 3; i += 1) await w.kai.post('/presence', { connected: true, activityDetail: `step ${i}` });
    expect((await w.nova.get('/events?after=1')).body.data.reset).toBe(true);
  });
});

/** Kai and Nova, friends. */
async function friends() {
  const w = world();
  await w.kai.get('/snapshot');
  await w.nova.get('/snapshot');
  await w.kai.post('/requests', { toUserId: 'usr_nova' });
  const requestId = (await w.nova.get('/snapshot')).body.data.requests.incoming[0].requestId;
  await w.nova.post(`/requests/${requestId}/accept`);
  return w;
}

describe('sign-out ends presence (Second\'s R16 run, 10-04)', () => {
  it('endSocialPresence: the friend is told, sees the player OFFLINE, and the player leaves the world', async () => {
    const store = createInMemorySocialStore();
    const w = await friendsOn(store);
    await w.kai.post('/presence', { connected: true, availability: 'AVAILABLE' });
    await w.kai.post('/world/join', { target: 'PUBLIC' });
    expect((await w.nova.get('/snapshot')).body.data.friends[0].presence.onlineState).toBe('ONLINE');
    const before = (await w.nova.get('/events')).body.data.latest;
    await endSocialPresence(store, 'usr_kai', T0 + 60_000);
    expect((await w.nova.get(`/events?after=${before}`)).body.data.events.map((e: any) => e.op)).toContain('presence.update_self');
    expect((await w.nova.get('/snapshot')).body.data.friends[0].presence.onlineState).toBe('OFFLINE');
    expect((await w.kai.get('/world')).body.data.context).toBeNull();
    // no store, or no such player: nothing happens and nothing throws
    await endSocialPresence(null, 'usr_kai', T0);
    await endSocialPresence(store, 'usr_nobody', T0);
  });
});

/** Kai and Nova, friends, on a given store. */
async function friendsOn(store: SocialStore) {
  const w = world(store);
  await w.kai.get('/snapshot');
  await w.nova.get('/snapshot');
  await w.kai.post('/requests', { toUserId: 'usr_nova' });
  const requestId = (await w.nova.get('/snapshot')).body.data.requests.incoming[0].requestId;
  await w.nova.post(`/requests/${requestId}/accept`);
  return w;
}

describe("the GAME client's EOS config route (founder 10-04: from the backend, held in the client's memory only)", () => {
  const PATH = '/wonderland/social/voice/eos-client-config';
  const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' };
  /** Planted at run time: values a log line or an error must never carry. */
  const planted = () => ({
    productId: `p${randomBytes(8).toString('hex')}`,
    sandboxId: `s${randomBytes(8).toString('hex')}`,
    deploymentId: `d${randomBytes(8).toString('hex')}`,
    clientId: `c${randomBytes(8).toString('hex')}`,
    clientSecret: `planted-${randomBytes(16).toString('hex')}`,
  });
  const stubVoice = { providerId: 'stub', mint: async (): Promise<never> => { throw new Error('nothing is minted here'); } };
  const setup = (over: Partial<SocialRouteDeps> = {}) => {
    const config = planted();
    const log: string[] = [];
    const deps: SocialRouteDeps = {
      verifySession: (token) => SESSIONS[token] ?? null,
      identify: async (participantId) => ({ userId: participantId, displayName: participantId, handle: `@${participantId}` }),
      store: createInMemorySocialStore(),
      voice: stubVoice,
      voiceBindings: createInMemoryVoiceBindings(),
      eosClientConfig: config,
      eosClientConfigAllowed: createSessionRateLimit(EOS_CLIENT_CONFIG_RATE.limit, EOS_CLIENT_CONFIG_RATE.windowMs),
      log: (line) => log.push(line),
      ...over,
    };
    const get = async (token: string | null, at = T0, opts: { method?: string; origin?: string } = {}) => {
      const result = await handleSocialRoute(
        { method: opts.method ?? 'GET', path: PATH, authorization: token === null ? undefined : `Relay-Session ${token}`, origin: opts.origin, body: null, now: at },
        deps,
      );
      if (result === null) throw new Error('not a social route');
      return result as SocialRouteResult & { body: { data?: any; error?: { kind: string; message: string } } };
    };
    return { config, log, get, values: Object.values(config) };
  };
  const noValueIn = (what: unknown, values: readonly string[]) => {
    const text = JSON.stringify(what);
    for (const v of values) expect(text).not.toContain(v);
  };

  it('a signed-in player gets exactly the schema and the five values, no-store; the log says only whom, hashed', async () => {
    const { config, log, get, values } = setup();
    const r = await get('tok-kai');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ data: { schema: 'wonderland-eos-client-config.v1', ...config } });
    expect(Object.keys(r.body.data).sort()).toEqual(['clientId', 'clientSecret', 'deploymentId', 'productId', 'sandboxId', 'schema']);
    expect(r.headers).toEqual(NO_STORE);
    expect(log).toEqual([`eos client config served to ${hashId('usr_kai')}`]);
    noValueIn(log, [...values, 'usr_kai']);
  });

  it('refuses before any value: no session or an unknown one 401, a web page 403, a session without `social` 403, another method 403; nothing logged', async () => {
    const { log, get, values } = setup();
    expect((await get(null)).status).toBe(401);
    expect((await get('tok-nope')).status).toBe(401);
    const page = await get('tok-kai', T0, { origin: 'https://evil.example' });
    expect([page.status, page.body.error?.kind]).toEqual([403, 'desktop_only']);
    const mira = await get('tok-mira');
    expect([mira.status, mira.body.error?.kind]).toEqual([403, 'not_permitted']);
    const posted = await get('tok-kai', T0, { method: 'POST' });
    expect([posted.status, posted.body.error?.kind]).toEqual([403, 'not_permitted']);
    for (const r of [page, mira, posted]) {
      noValueIn(r, values);
      expect(r.headers).toEqual(NO_STORE);
    }
    expect(log).toEqual([]);
  });

  it('503 voice_unavailable, no-store, without the game config, without a voice provider or bindings, and without the rate limit (never unlimited)', async () => {
    const overs: Array<Partial<SocialRouteDeps>> = [{ eosClientConfig: null }, { voice: null }, { voiceBindings: null }, { eosClientConfigAllowed: null }];
    for (const over of overs) {
      const { log, get, values } = setup(over);
      const r = await get('tok-kai');
      expect([r.status, r.body.error?.kind], Object.keys(over).join()).toEqual([503, 'voice_unavailable']);
      expect(r.headers).toEqual(NO_STORE);
      noValueIn(r, values);
      expect(log).toEqual([]);
    }
  });

  it('at most 6 a minute per session: the 7th is 429 with no value; another session is not counted; a minute on, served again', async () => {
    const { log, get, values } = setup();
    for (let i = 0; i < 6; i += 1) expect((await get('tok-kai', T0 + i * 1000)).status).toBe(200);
    const seventh = await get('tok-kai', T0 + 6000);
    expect([seventh.status, seventh.body.error?.kind]).toEqual([429, 'rate_limited']);
    expect(seventh.headers).toEqual(NO_STORE);
    noValueIn(seventh, values);
    expect((await get('tok-nova', T0 + 6000)).status).toBe(200);
    expect((await get('tok-kai', T0 + 60_001)).status).toBe(200);
    expect(log).toHaveLength(8);
    noValueIn(log, values);
  });
});

describe("the store opens only after the session gate (JUJU MAIN's hosted plan r3)", () => {
  it('an anonymous, unknown, web-page or uncapable request never opens it; an admitted one does; a store that cannot open is 503', async () => {
    let opened = 0;
    const memory = createInMemorySocialStore();
    const deps: SocialRouteDeps = {
      verifySession: (token) => SESSIONS[token] ?? null,
      identify: async (participantId) => ({ userId: participantId, displayName: participantId, handle: `@${participantId}` }),
      store: async () => {
        opened += 1;
        return memory;
      },
    };
    const call = async (token: string | null, origin?: string, over: Partial<SocialRouteDeps> = {}) =>
      (await handleSocialRoute({ method: 'GET', path: '/wonderland/social/snapshot', authorization: token === null ? undefined : `Relay-Session ${token}`, origin, body: null, now: T0 }, { ...deps, ...over }))?.status;
    expect(await call(null)).toBe(401);
    expect(await call('tok-nope')).toBe(401);
    expect(await call('tok-kai', 'https://evil.example')).toBe(403);
    expect(await call('tok-mira')).toBe(403);
    expect(opened).toBe(0);
    expect(await call('tok-kai')).toBe(200);
    expect(opened).toBe(1);
    expect(await call('tok-kai', undefined, { store: async () => null })).toBe(503);
  });
});
