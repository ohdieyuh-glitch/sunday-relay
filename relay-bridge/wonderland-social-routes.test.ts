import { describe, expect, it } from 'vitest';
import { applySocialOperation } from '../src/relay/social/social-commands';
import { PARTY_MAX_MEMBERS } from '../src/relay/social/social-contracts';
import { emptySocialState } from '../src/relay/social/social-state';
import { createInMemorySocialStore, ensureSocialUser, type SocialStore } from '../src/relay/social/social-store';
import {
  budgetClassesOf,
  createCommandBudgets,
  createPresenceLease,
  endSocialPresence,
  handleSocialRoute,
  PRESENCE_LEASE_MS,
  SOCIAL_BUDGETS,
  type SocialRouteDeps,
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
  'tok-kai': { sessionId: 's1', participantId: 'usr_kai', issuedAtMs: T0, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
  'tok-nova': { sessionId: 's2', participantId: 'usr_nova', issuedAtMs: T0, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
  'tok-mira': { sessionId: 's3', participantId: 'usr_mira', issuedAtMs: T0, capabilities: [] },
  'tok-vega': { sessionId: 's4', participantId: 'usr_vega', issuedAtMs: T0, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
};

function world(store: SocialStore = createInMemorySocialStore()) {
  let clock = T0;
  const deps: SocialRouteDeps = {
    verifySession: (token) => SESSIONS[token] ?? null,
    sessionIssuedAt: null,
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
    const deps: SocialRouteDeps = { verifySession: (t) => SESSIONS[t] ?? null, sessionIssuedAt: null, identify: async () => null, store: null };
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

describe('BF-2 through the real routes: the profile Relay Dog follows the worn skin, as privacy allows (R16 B23)', () => {
  const report = (skinId: string) => ({ x: 1, y: 2, z: 3, yaw: 0, speed: 0, motion: 'IDLE', skinId });
  const skinOf = async (who: { get: (path: string) => Promise<{ body: { data?: any } }> }, id: string) =>
    (await who.get(`/profiles/${id}`)).body.data?.profile.relayDog.skinId;

  it('Kai wears Jack Flame in the world -> Nova is told, and her profile read and snapshot card show it; Vega, a stranger, as privacy allows', async () => {
    const store = createInMemorySocialStore();
    const w = await friendsOn(store);
    await w.vega.get('/snapshot');
    expect((await w.kai.post('/world/join', { target: 'PUBLIC' })).status).toBe(200);
    // the control before any report: the base form, for everybody
    expect([await skinOf(w.nova, 'usr_kai'), await skinOf(w.vega, 'usr_kai')]).toEqual(['relay_og', 'relay_og']);
    const novaLatest = (await w.nova.get('/events')).body.data.latest;
    expect((await w.kai.post('/world/state', report('jack_flame'))).status).toBe(200);
    expect((await w.nova.get(`/events?after=${novaLatest}`)).body.data.events.map((e: any) => e.op)).toEqual(['world.state']);
    expect(await skinOf(w.nova, 'usr_kai')).toBe('jack_flame');
    expect((await w.nova.get('/snapshot')).body.data.profiles.usr_kai.profile.relayDog.skinId).toBe('jack_flame');
    expect((await w.kai.get('/snapshot')).body.data.self.profile.relayDog.skinId).toBe('jack_flame');
    expect(await skinOf(w.vega, 'usr_kai'), 'presence is EVERYONE by default: a stranger sees it').toBe('jack_flame');
    // the agent card: nothing configured, said as null -- never a default Julius (RQ-1)
    expect((await w.nova.get('/profiles/usr_kai')).body.data.profile.primaryAgent).toBeNull();

    // an unregistered id: the report is answered (the in-world figure stands), the profile is not touched; a malformed one is a 400
    expect((await w.kai.post('/world/state', report('bee'))).status).toBe(200);
    expect(await skinOf(w.nova, 'usr_kai')).toBe('jack_flame');
    expect((await w.kai.post('/world/state', report('JACK FLAME'))).status).toBe(400);
    expect(await skinOf(w.nova, 'usr_kai')).toBe('jack_flame');

    // privacy: presence to friends only -> the stranger reads the base form, the friend still the skin
    expect((await w.kai.post('/privacy', { presenceVisibility: 'FRIENDS' })).status).toBe(200);
    expect([await skinOf(w.nova, 'usr_kai'), await skinOf(w.vega, 'usr_kai')]).toEqual(['jack_flame', 'relay_og']);
    // a block, either way: nothing (presence EVERYONE again, so the block alone decides; control first)
    expect((await w.kai.post('/privacy', { presenceVisibility: 'EVERYONE' })).status).toBe(200);
    expect(await skinOf(w.vega, 'usr_kai')).toBe('jack_flame');
    expect((await w.vega.post('/blocks', { targetId: 'usr_kai' })).status).toBe(200);
    expect(await skinOf(w.vega, 'usr_kai')).toBe('relay_og');
    expect((await w.vega.post('/blocks/usr_kai/remove')).status).toBe(200);
    expect((await w.kai.post('/blocks', { targetId: 'usr_vega' })).status).toBe(200);
    expect(await skinOf(w.vega, 'usr_kai')).toBe('relay_og');
    expect(await skinOf(w.nova, 'usr_kai'), 'their block changes nothing for Nova').toBe('jack_flame');
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

describe("the store opens only after the session gate (JUJU MAIN's hosted plan r3)", () => {
  it('an anonymous, unknown, web-page or uncapable request never opens it; an admitted one does; a store that cannot open is 503', async () => {
    let opened = 0;
    const memory = createInMemorySocialStore();
    const deps: SocialRouteDeps = {
      verifySession: (token) => SESSIONS[token] ?? null,
      sessionIssuedAt: null,
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

/*
 * PRESENCE IS A LEASE, AND EVERY PLAYER HAS A BUDGET (Second's R16 review, 10-06). The clock is the test's own here: time passes
 * only when a test says so, and a player "is talking" only when they call.
 */
function clocked(opts: { lease?: boolean; budgets?: boolean } = {}) {
  let clock = T0;
  const store = createInMemorySocialStore();
  const deps: SocialRouteDeps = {
    verifySession: (token) => SESSIONS[token] ?? null,
    sessionIssuedAt: null,
    identify: async (participantId) => ({ userId: participantId, displayName: participantId.replace('usr_', ''), handle: `@${participantId.replace('usr_', '')}` }),
    store,
    presenceLease: opts.lease === false ? null : createPresenceLease(),
    commandBudgets: opts.budgets === true ? createCommandBudgets() : null,
  };
  const call = async (token: string, method: string, path: string, body: unknown = null) => {
    const result = await handleSocialRoute({ method, path, authorization: `Relay-Session ${token}`, origin: undefined, body, now: clock }, deps);
    if (result === null) throw new Error(`not a social route: ${path}`);
    return result as { status: number; headers?: Record<string, string>; body: { data?: any; error?: { kind: string; message: string } } };
  };
  const as = (token: string) => ({
    get: (path: string) => call(token, 'GET', `/wonderland/social${path}`),
    post: (path: string, body: unknown = {}) => call(token, 'POST', `/wonderland/social${path}`, body),
  });
  return { store, advance: (ms: number) => { clock += ms; }, kai: as('tok-kai'), nova: as('tok-nova'), vega: as('tok-vega') };
}

async function clockedFriends(opts: { lease?: boolean; budgets?: boolean } = {}) {
  const w = clocked(opts);
  await w.kai.get('/snapshot');
  await w.nova.get('/snapshot');
  await w.kai.post('/requests', { toUserId: 'usr_nova' });
  const requestId = (await w.nova.get('/snapshot')).body.data.requests.incoming[0].requestId;
  await w.nova.post(`/requests/${requestId}/accept`);
  return w;
}

const kaiAsNovaSees = async (w: Awaited<ReturnType<typeof clockedFriends>>) =>
  (await w.nova.get('/snapshot')).body.data.friends.find((f: any) => f.userId === 'usr_kai')?.presence.onlineState;

describe("presence is a lease (Second's R16 review, 10-06: a crashed client stayed ONLINE to its friends)", () => {
  it('a player whose client keeps talking stays ONLINE past the lease; one that goes silent is OFFLINE after it, and the friend is told', async () => {
    const w = await clockedFriends();
    await w.kai.post('/presence', { connected: true, availability: 'AVAILABLE' });
    expect(await kaiAsNovaSees(w)).toBe('ONLINE');
    // two and a half minutes of a live client: its events poll every 5 s
    for (let i = 0; i < 30; i += 1) {
      w.advance(5_000);
      await w.kai.get('/events');
      await w.nova.get('/events');
    }
    expect(await kaiAsNovaSees(w)).toBe('ONLINE');
    const before = (await w.nova.get('/events')).body.data.latest;
    // Kai's client dies: only Nova keeps talking, for longer than the lease
    for (let i = 0; i < Math.ceil(PRESENCE_LEASE_MS / 5_000) + 2; i += 1) {
      w.advance(5_000);
      await w.nova.get('/events');
    }
    expect((await w.nova.get(`/events?after=${before}`)).body.data.events.map((e: any) => e.op)).toContain('presence.update_self');
    expect(await kaiAsNovaSees(w)).toBe('OFFLINE');
  });

  it("the lapsed player's next call restores them, and their friend is told", async () => {
    const w = await clockedFriends();
    await w.kai.post('/presence', { connected: true, availability: 'AVAILABLE' });
    w.advance(PRESENCE_LEASE_MS + 5_000);
    await w.nova.get('/events');
    expect(await kaiAsNovaSees(w)).toBe('OFFLINE');
    const before = (await w.nova.get('/events')).body.data.latest;
    w.advance(1_000);
    await w.kai.get('/events');   // the client was alive after all: a hitch, a sleep
    expect((await w.nova.get(`/events?after=${before}`)).body.data.events.map((e: any) => e.op)).toContain('presence.update_self');
    expect(await kaiAsNovaSees(w)).toBe('ONLINE');
  });

  it('a player who said goodbye is never resurrected: silent past the lease, then a stray call, they stay OFFLINE', async () => {
    const w = await clockedFriends();
    await w.kai.post('/presence', { connected: true, availability: 'AVAILABLE' });
    await w.kai.post('/presence', { connected: false });
    w.advance(PRESENCE_LEASE_MS + 5_000);
    await w.nova.get('/events');   // the sweep runs: Kai is silent, but already gone by their own word
    w.advance(1_000);
    await w.kai.get('/events');
    expect(await kaiAsNovaSees(w)).toBe('OFFLINE');
  });

  it("a lapsed player's own goodbye restores nothing: their friend is told nothing, never an ONLINE-then-OFFLINE pair", async () => {
    const w = await clockedFriends();
    await w.kai.post('/presence', { connected: true, availability: 'AVAILABLE' });
    w.advance(PRESENCE_LEASE_MS + 5_000);
    await w.nova.get('/events');
    expect(await kaiAsNovaSees(w)).toBe('OFFLINE');
    const before = (await w.nova.get('/events')).body.data.latest;
    w.advance(1_000);
    expect((await w.kai.post('/presence', { connected: false })).status).toBe(200);   // the client's goodbye, its first call back
    // NO event (10-07, the hardening's view rule): the lapse already showed Kai OFFLINE to Nova, so the goodbye moves nothing she can
    // see, and P1 tells nobody of a change they cannot see (it was ONE event before: still never the TWO, ONLINE then OFFLINE, of a
    // restore -- the blip the goodbye guard exists to prevent).
    expect((await w.nova.get(`/events?after=${before}`)).body.data.events.map((e: any) => e.op)).toEqual([]);
    expect(await kaiAsNovaSees(w)).toBe('OFFLINE');
  });

  it('P1: a player who appears offline lapses and returns with nothing told to anyone', async () => {
    const w = await clockedFriends();
    await w.kai.post('/presence', { connected: true, availability: 'APPEAR_OFFLINE' });
    const before = (await w.nova.get('/events')).body.data.latest;
    w.advance(PRESENCE_LEASE_MS + 5_000);
    await w.nova.get('/events');
    w.advance(1_000);
    await w.kai.get('/events');
    expect((await w.nova.get(`/events?after=${before}`)).body.data.events).toEqual([]);
    expect(await kaiAsNovaSees(w)).toBe('OFFLINE');
  });

  it('without a lease (a bridge that gives none) nothing lapses -- the behaviour the lease exists to end', async () => {
    const w = await clockedFriends({ lease: false });
    await w.kai.post('/presence', { connected: true, availability: 'AVAILABLE' });
    w.advance(10 * PRESENCE_LEASE_MS);
    await w.nova.get('/events');
    expect(await kaiAsNovaSees(w)).toBe('ONLINE');
  });

  it('the lease itself: each silent player is returned once; a sweep at most once a second; forget ends both the lapse and the restore', () => {
    const lease = createPresenceLease(10_000);
    expect(lease.touch('a', 0)).toBe(false);
    lease.touch('b', 0);
    expect(lease.lapsed(5_000)).toEqual([]);
    expect(lease.lapsed(10_001)).toEqual(['a', 'b']);
    expect(lease.lapsed(20_000)).toEqual([]);
    lease.markTakenOffline('a');
    expect(lease.touch('a', 20_500)).toBe(true);   // restored once
    expect(lease.touch('a', 20_600)).toBe(false);
    lease.markTakenOffline('b');
    lease.forget('b');
    expect(lease.touch('b', 21_000)).toBe(false);
    lease.touch('c', 30_000);
    expect(lease.lapsed(40_001)).toEqual(['a', 'b', 'c']);   // each silent > 10 s, in the order they last called
    // at most one sweep a second: a player already past the lease waits for the next allowed sweep
    const once = createPresenceLease(1_000);
    once.touch('x', 0);
    expect(once.lapsed(500)).toEqual([]);        // swept at 500: x is 0.5 s silent
    expect(once.lapsed(1_200)).toEqual([]);      // x is 1.2 s silent, but 0.7 s after the last sweep: no sweep at all
    expect(once.lapsed(1_500)).toEqual(['x']);   // a full second after it: swept, x returned
  });
});

describe("every player has a budget (Second's R16 review, 10-06: before, a signed-in account could flood without limit)", () => {
  it('the classes: the world report alone; any other read; a write, plus message / invitation for those', () => {
    expect(budgetClassesOf({ id: 'world.state', writes: true })).toEqual(['report']);
    expect(budgetClassesOf({ id: 'snapshot.read', writes: false })).toEqual(['read']);
    expect(budgetClassesOf({ id: 'events.stream', writes: false })).toEqual(['read']);
    expect(budgetClassesOf({ id: 'blocks.add', writes: true })).toEqual(['write']);
    expect(budgetClassesOf({ id: 'messages.send', writes: true })).toEqual(['write', 'message']);
    for (const id of ['requests.send', 'parties.invite', 'world.invite']) expect(budgetClassesOf({ id, writes: true })).toEqual(['write', 'invitation']);
    // a voice join writes PostgreSQL and calls Epic: its own budget, not a read's (review a6d5842c, m5)
    expect(budgetClassesOf({ id: 'parties.voice_join', writes: false })).toEqual(['voice']);
  });

  it('a voice join has its OWN budget (review a6d5842c, m5): ten at once, the eleventh is 429; reads are not charged for joins, nor joins for reads', async () => {
    const w = clocked({ budgets: true });
    await w.kai.get('/snapshot');
    await w.nova.get('/snapshot');
    const voiceJoin = () => w.kai.post('/parties/pty_none/voice/join', { eosProductUserId: '0123456789abcdef0123456789abcdef' });
    // no party and no provider here: an admitted call runs and answers the stranger's 404; the budget refuses before that
    for (let i = 0; i < SOCIAL_BUDGETS.voice.burst; i += 1) expect((await voiceJoin()).status, `join ${i + 1}`).toBe(404);
    const over = await voiceJoin();
    expect([over.status, over.body.error?.kind, over.headers?.['retry-after']]).toEqual([429, 'rate_limited', '1']);
    expect((await w.kai.get('/snapshot')).status).toBe(200); // the read budget is untouched by the joins
    expect((await w.nova.post('/parties/pty_none/voice/join', { eosProductUserId: '0123456789abcdef0123456789abcdef' })).status).toBe(404); // another player is not charged
    // and many reads leave the voice budget alone: one second on, one more join is admitted
    for (let i = 0; i < 50; i += 1) await w.kai.get('/snapshot');
    w.advance(SOCIAL_BUDGETS.voice.everyMs);
    expect((await voiceJoin()).status).toBe(404);
    expect((await voiceJoin()).status).toBe(429);
  });

  it("the client's audience re-ask (throttled to one a second, CORE's client contract) never meets the voice budget: one join a second for two minutes", async () => {
    const w = clocked({ budgets: true });
    await w.kai.get('/snapshot');
    const statuses = new Set<number>();
    for (let tick = 0; tick < 120; tick += 1) {
      w.advance(1_000);
      statuses.add((await w.kai.post('/parties/pty_none/voice/join', { eosProductUserId: '0123456789abcdef0123456789abcdef' })).status);
    }
    expect([...statuses]).toEqual([404]);
  });

  it('the write after the burst is 429 rate_limited with Retry-After, no-store, and is NOT executed; another player is not charged', async () => {
    const w = clocked({ budgets: true });
    await w.kai.get('/snapshot');
    const availability = async () => (await w.kai.get('/snapshot')).body.data.self.presence.availability;
    for (let i = 0; i < SOCIAL_BUDGETS.write.burst; i += 1) {
      expect((await w.kai.post('/presence', { connected: true, availability: i % 2 === 0 ? 'AWAY' : 'AVAILABLE' })).status).toBe(200);
      if (i === 0) expect(await availability()).toBe('AWAY');   // the observable moves with an admitted write (the control)
    }
    expect(await availability()).toBe('AVAILABLE');
    const over = await w.kai.post('/presence', { connected: true, availability: 'BUSY' });
    expect(over.status).toBe(429);
    expect(over.body.error?.kind).toBe('rate_limited');
    expect(over.headers?.['retry-after']).toBe('1');
    expect(over.headers?.['cache-control']).toBe('no-store');
    expect(await availability()).toBe('AVAILABLE');   // the refused write did not run
    await w.nova.get('/snapshot');
    expect((await w.nova.post('/presence', { connected: true })).status).toBe(200);
    // one write-interval later, one more is admitted -- and a refused call charged nothing
    w.advance(SOCIAL_BUDGETS.write.everyMs);
    expect((await w.kai.post('/presence', { connected: true })).status).toBe(200);
    expect((await w.kai.post('/presence', { connected: true })).status).toBe(429);
  });

  it('messages: twenty at once, the twenty-first is 429 (three seconds); a message refused for its budget is never delivered', async () => {
    const w = await clockedFriends({ budgets: true });
    const opened = (await w.kai.post('/conversations', { otherUserId: 'usr_nova' })).body.data;
    for (let i = 0; i < SOCIAL_BUDGETS.message.burst; i += 1) {
      expect((await w.kai.post(`/conversations/${opened.conversationId}/messages`, { body: `hello ${i}` })).status).toBe(200);
    }
    const over = await w.kai.post(`/conversations/${opened.conversationId}/messages`, { body: 'one too many' });
    expect([over.status, over.headers?.['retry-after']]).toEqual([429, '3']);
    const history = (await w.nova.get(`/conversations/${opened.conversationId}/messages`)).body.data;
    expect(history.length).toBe(SOCIAL_BUDGETS.message.burst);
    expect(JSON.stringify(history)).not.toContain('one too many');
  });

  it('invitations: ten at once, the eleventh is 429 (thirty seconds) -- refused targets are charged too, so a flood cannot probe for free', async () => {
    const w = clocked({ budgets: true });
    await w.kai.get('/snapshot');
    for (let i = 0; i < SOCIAL_BUDGETS.invitation.burst; i += 1) {
      expect((await w.kai.post('/requests', { toUserId: `usr_ghost_${i}` })).status).not.toBe(429);
    }
    const over = await w.kai.post('/requests', { toUserId: 'usr_nova' });
    expect([over.status, over.headers?.['retry-after']]).toEqual([429, '30']);
    await w.nova.get('/snapshot');
    expect((await w.nova.get('/snapshot')).body.data.requests.incoming).toEqual([]);
  });

  it("the live client's own rhythm never meets a budget: a 5 Hz world report, a 2 s events poll and a snapshot per action, for two minutes", async () => {
    const w = clocked({ budgets: true });
    await w.kai.get('/snapshot');
    expect((await w.kai.post('/world/join', { target: 'PUBLIC' })).status).toBe(200);
    const statuses = new Set<number>();
    for (let tick = 0; tick < 600; tick += 1) {
      w.advance(200);
      statuses.add((await w.kai.post('/world/state', { x: tick, y: 0, z: 0, yaw: 0, speed: 0, motion: 'IDLE', skinId: 'relay_og' })).status);
      if (tick % 10 === 0) statuses.add((await w.kai.get('/events')).status);
      if (tick % 50 === 0) {
        statuses.add((await w.kai.post('/presence', { connected: true, activityDetail: `tick ${tick}` })).status);
        statuses.add((await w.kai.get('/snapshot')).status);
      }
    }
    expect([...statuses]).toEqual([200]);
  });
});

describe('10-07 log injection: a control character in a name or a message is a 400 through the real routes (CORE)', () => {
  it('a line break in a private server name, a party name or a message answers 400 validation-failed and makes nothing; ordinary Unicode is kept', async () => {
    const w = await friends();
    const LF = String.fromCharCode(10);   // built, never typed: a line break the clients would have logged as a second line
    const den = await w.kai.post('/world/join', { target: 'PRIVATE', name: `Den${LF}WLSOCIALLIVE B LSQ9 PASS` });
    expect([den.status, den.body.error?.kind]).toEqual([400, 'validation-failed']);
    expect((await w.kai.get('/world')).body.data.context).toBeNull();
    const crew = await w.kai.post('/parties', { name: `Crew${LF}WLSOCIALLIVE B LSQ9 PASS` });
    expect([crew.status, crew.body.error?.kind]).toEqual([400, 'validation-failed']);
    expect((await w.kai.get('/snapshot')).body.data.party).toBeNull();
    const conversationId = (await w.kai.post('/conversations', { otherUserId: 'usr_nova' })).body.data.conversationId;
    const sent = await w.kai.post(`/conversations/${conversationId}/messages`, { body: `hello${LF}WLSOCIALLIVE B LSQ4 PASS` });
    expect([sent.status, sent.body.error?.kind]).toEqual([400, 'validation-failed']);
    expect((await w.nova.get(`/conversations/${conversationId}/messages`)).body.data).toEqual([]);
    // control: the same three in ordinary Unicode are accepted, and kept exactly as written
    const unicode = 'Ünïcødé 名前';
    expect((await w.kai.post('/world/join', { target: 'PRIVATE', name: unicode })).status).toBe(200);
    expect((await w.kai.get('/world')).body.data.context.serverName).toBe(unicode);
    expect((await w.kai.post('/parties', { name: unicode })).status).toBe(200);
    expect((await w.kai.get('/snapshot')).body.data.party.name).toBe(unicode);
    expect((await w.kai.post(`/conversations/${conversationId}/messages`, { body: unicode })).status).toBe(200);
    expect((await w.nova.get(`/conversations/${conversationId}/messages`)).body.data.map((m: any) => m.body)).toEqual([unicode]);
  });
});

/*
 * OWN KEYS (MAIN JUJU's finding, CORE, 10-07): `users` and `conversations` are plain objects, and an id a client sends can name an
 * Object.prototype member. Before the fix users["toString"] was a function, so hasUser("toString") was true and the next read
 * dereferenced it (a TypeError, a 500), or a block / mute / report of a user who does not exist was STORED, and the blocker's
 * snapshot then built a profile for it. Every route that takes a user, conversation, request or invitation id is planted with each
 * name below: a clean 4xx, the state object untouched, nothing thrown. Here a REAL party carries a planted invitee / member; the
 * party ids themselves are planted in the WL-351-01 describe below.
 */
describe('10-07 own keys: an id named like an Object.prototype member is no record, on every route that takes one (CORE)', () => {
  const PLANTED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
  type Answer = { status: number; body: { data?: any; error?: { kind: string; message: string } } };
  type W = Awaited<ReturnType<typeof friendsOn>>;
  const ROUTES: ReadonlyArray<readonly [string, number, (w: W, key: string, party: string) => Promise<Answer>]> = [
    ['GET /profiles/:id', 404, (w, k) => w.kai.get(`/profiles/${k}`)],
    ['GET /profiles/:id/showcase', 404, (w, k) => w.kai.get(`/profiles/${k}/showcase`)],
    ['POST /friends/:id/remove', 400, (w, k) => w.kai.post(`/friends/${k}/remove`)],
    ['POST /requests {toUserId}', 404, (w, k) => w.kai.post('/requests', { toUserId: k })],
    ['POST /requests/:id/accept', 404, (w, k) => w.kai.post(`/requests/${k}/accept`)],
    ['POST /requests/:id/decline', 404, (w, k) => w.kai.post(`/requests/${k}/decline`)],
    ['POST /requests/:id/cancel', 404, (w, k) => w.kai.post(`/requests/${k}/cancel`)],
    ['POST /blocks {targetId}', 404, (w, k) => w.kai.post('/blocks', { targetId: k })],
    ['POST /blocks/:id/remove', 400, (w, k) => w.kai.post(`/blocks/${k}/remove`)],
    ['POST /mutes {targetId}', 404, (w, k) => w.kai.post('/mutes', { targetId: k, voice: true, messages: true })],
    ['POST /reports {reportedId}', 404, (w, k) => w.kai.post('/reports', { reportedId: k, reason: 'SPAM' })],
    ['POST /conversations {otherUserId}', 404, (w, k) => w.kai.post('/conversations', { otherUserId: k })],
    ['GET /conversations/:id/messages', 404, (w, k) => w.kai.get(`/conversations/${k}/messages`)],
    ['POST /conversations/:id/messages', 404, (w, k) => w.kai.post(`/conversations/${k}/messages`, { body: 'hello?' })],
    ['POST /conversations/:id/read', 404, (w, k) => w.kai.post(`/conversations/${k}/read`, {})],
    ['POST /parties/:id/invites {toUserId}', 404, (w, k, party) => w.kai.post(`/parties/${party}/invites`, { toUserId: k })],
    ['POST /parties/:id/members/:id/remove', 404, (w, k, party) => w.kai.post(`/parties/${party}/members/${k}/remove`)],
    ['POST /parties/:id/leader {memberId}', 400, (w, k, party) => w.kai.post(`/parties/${party}/leader`, { memberId: k })],
    ['POST /party-invites/:id/accept', 404, (w, k) => w.kai.post(`/party-invites/${k}/accept`)],
    ['POST /party-invites/:id/decline', 404, (w, k) => w.kai.post(`/party-invites/${k}/decline`)],
    ['POST /world/join {FRIEND userId}', 403, (w, k) => w.kai.post('/world/join', { target: 'FRIEND', userId: k })],
    ['POST /world/join {INVITE inviteId}', 404, (w, k) => w.kai.post('/world/join', { target: 'INVITE', inviteId: k })],
    ['POST /world/invites {toUserId}', 403, (w, k) => w.kai.post('/world/invites', { toUserId: k })],
  ];

  /** Kai and Nova, friends; Kai leads a party and stands in a public world (so the invite routes reach their user lookup). */
  async function setUp() {
    const store = createInMemorySocialStore();
    const w = await friendsOn(store);
    const party = (await w.kai.post('/parties', { name: 'Crew' })).body.data.partyId as string;
    expect((await w.kai.post('/world/join', { target: 'PUBLIC' })).status).toBe(200);
    return { store, w, party };
  }

  for (const [route, status, call] of ROUTES) {
    it(`${route}: every planted id answers ${status}, changes nothing and throws nothing`, async () => {
      const { store, w, party } = await setUp();
      for (const key of PLANTED) {
        const before = await store.read();
        const answer = await call(w, key, party).catch((e: unknown): Answer => ({ status: 500, body: { error: { kind: 'THROWN', message: String(e) } } }));
        const label = `${route} with ${JSON.stringify(key)} -> ${JSON.stringify(answer.body.error ?? answer.body.data ?? null).slice(0, 160)}`;
        expect(answer.status, label).toBe(status);
        expect(await store.read(), `${label}: the state must not move`).toBe(before);
      }
      // the actor's own view still answers: a stored record for a planted id had broken it (snapshot.read builds a profile for each)
      expect((await w.kai.get('/snapshot')).status).toBe(200);
    });
  }
});

/*
 * WL-351-01 (the independent review of #351, 10-13): the #351 body said a party id like `constructor` is "simply a party that does
 * not exist", but party lookups were still raw (`state.parties[id]`), so such an id was a thrown TypeError -- a 500. Every route
 * that looks a party up by its path id is planted with each name below: the answer is exactly a missing party's (status, kind and
 * words, against a real-shaped id that names nothing), the state object is untouched and nothing is thrown.
 */
describe('WL-351-01: a party id named like an Object.prototype member is a party that does not exist, on every party route', () => {
  const PLANTED_PARTY_IDS = ['constructor', '__proto__', 'hasOwnProperty', 'toString', 'valueOf'];
  type Answer = { status: number; body: { data?: any; error?: { kind: string; message: string } } };
  type W = Awaited<ReturnType<typeof friendsOn>>;
  const PUID = '0123456789abcdef0123456789abcdef';
  const PARTY_ROUTES: ReadonlyArray<readonly [string, (w: W, party: string) => Promise<Answer>]> = [
    ['GET /parties/:id', (w, k) => w.nova.get(`/parties/${k}`)],
    // Nova is in no party, so the join reaches the id (a joiner already in one is told to leave first, naming nothing)
    ['POST /parties/:id/join', (w, k) => w.nova.post(`/parties/${k}/join`)],
    ['POST /parties/:id/invites', (w, k) => w.kai.post(`/parties/${k}/invites`, { toUserId: 'usr_nova' })],
    ['POST /parties/:id/members/:id/remove', (w, k) => w.kai.post(`/parties/${k}/members/usr_nova/remove`)],
    ['POST /parties/:id/leader', (w, k) => w.kai.post(`/parties/${k}/leader`, { memberId: 'usr_nova' })],
    ['POST /parties/:id/rules', (w, k) => w.kai.post(`/parties/${k}/rules`, { privacy: 'OPEN_TO_FRIENDS' })],
    ['POST /parties/:id/voice/join', (w, k) => w.kai.post(`/parties/${k}/voice/join`, { eosProductUserId: PUID })],
  ];

  for (const [route, call] of PARTY_ROUTES) {
    it(`${route}: every planted party id answers exactly as a missing party (404), changes nothing and throws nothing`, async () => {
      const store = createInMemorySocialStore();
      const w = await friendsOn(store);
      expect((await w.kai.post('/parties', { name: 'Crew' })).status).toBe(200); // Kai leads a real party; Nova is in none
      const missing = await call(w, 'pty_does_not_exist');
      expect([missing.status, missing.body.error?.kind]).toEqual([404, 'not-found']);
      for (const key of PLANTED_PARTY_IDS) {
        const before = await store.read();
        const answer = await call(w, key).catch((e: unknown): Answer => ({ status: 500, body: { error: { kind: 'THROWN', message: String(e) } } }));
        const label = `${route} with ${JSON.stringify(key)} -> ${answer.status} ${JSON.stringify(answer.body.error ?? answer.body.data ?? null).slice(0, 160)}`;
        expect([answer.status, answer.body.error], label).toEqual([missing.status, missing.body.error]);
        expect(await store.read(), `${label}: the state must not move`).toBe(before);
      }
      expect((await w.kai.get('/snapshot')).status).toBe(200);
      expect((await w.nova.get('/snapshot')).status).toBe(200);
    });
  }
});

/*
 * WL-351-02 through the real routes: the reviewer's repro (an APPEAR_OFFLINE player's new open party reached every friend's next
 * snapshot, though M2 had silenced the event) on two real sessions, with its control.
 */
describe('WL-351-02: an Appear-Offline leader\'s open party is not in a friend\'s /snapshot (routes)', () => {
  it('hidden: no visibleParties entry, no mention of the id, /parties/:id answers as a missing party; AVAILABLE again: listed and readable', async () => {
    const w = await friends();
    expect((await w.kai.post('/presence', { connected: true, availability: 'APPEAR_OFFLINE' })).status).toBe(200);
    const created = await w.kai.post('/parties', { name: 'Quiet', privacy: 'OPEN_TO_FRIENDS' });
    expect(created.status).toBe(200);
    const partyId = created.body.data.partyId as string;
    expect((await w.nova.post('/presence', { connected: true, availability: 'AVAILABLE' })).status).toBe(200);
    const hidden = (await w.nova.get('/snapshot')).body.data;
    expect(hidden.visibleParties).toEqual([]);
    expect(JSON.stringify(hidden)).not.toContain(JSON.stringify(partyId));
    const read = await w.nova.get(`/parties/${partyId}`);
    const missing = await w.nova.get('/parties/pty_does_not_exist');
    expect([read.status, read.body.error]).toEqual([missing.status, missing.body.error]);
    // control: Kai visible again -- the same party is listed, led by Kai, and readable
    expect((await w.kai.post('/presence', { availability: 'AVAILABLE' })).status).toBe(200);
    const shown = (await w.nova.get('/snapshot')).body.data;
    expect(shown.visibleParties.map((p: any) => [p.partyId, p.leaderId])).toEqual([[partyId, 'usr_kai']]);
    expect((await w.nova.get(`/parties/${partyId}`)).status).toBe(200);
  });
});

/*
 * WL-358-01 / WL-358-02 (FOUNDER RULINGS, 2026-10-13T15:52:09Z, R16 acceptance checklist APPENDIX 5) through the real routes, each
 * with its control: no open-join into a party holding a member hidden from the joiner (invites still work), and an invite into a
 * party that has filled answers "You can't join this party right now" in a missing invite's 404 shape.
 */
describe('WL-358-01: no open-join into a party holding a member hidden from the joiner (routes)', () => {
  it('Vega, hidden from Nova (presence FRIENDS, strangers), is in Kai\'s open party: join and read are a missing party\'s, /snapshot shows nothing; Vega visible: listed and joined', async () => {
    const w = await friends(); // Kai and Nova
    await w.vega.get('/snapshot');
    expect((await w.kai.post('/requests', { toUserId: 'usr_vega' })).status).toBe(200);
    const requestId = (await w.vega.get('/snapshot')).body.data.requests.incoming[0].requestId;
    expect((await w.vega.post(`/requests/${requestId}/accept`)).status).toBe(200);
    for (const who of [w.kai, w.nova, w.vega]) expect((await who.post('/presence', { connected: true, availability: 'AVAILABLE' })).status).toBe(200);
    const partyId = (await w.kai.post('/parties', { name: 'Open', privacy: 'OPEN_TO_FRIENDS' })).body.data.partyId as string;
    expect((await w.vega.post(`/parties/${partyId}/join`)).status).toBe(200);
    expect((await w.vega.post('/privacy', { presenceVisibility: 'FRIENDS' })).status).toBe(200);

    const missingJoin = await w.nova.post('/parties/pty_does_not_exist/join');
    expect([missingJoin.status, missingJoin.body.error?.kind]).toEqual([404, 'not-found']);
    const join = await w.nova.post(`/parties/${partyId}/join`);
    expect([join.status, join.body.error]).toEqual([missingJoin.status, missingJoin.body.error]);
    const read = await w.nova.get(`/parties/${partyId}`);
    const missingRead = await w.nova.get('/parties/pty_does_not_exist');
    expect([read.status, read.body.error]).toEqual([missingRead.status, missingRead.body.error]);
    const hidden = (await w.nova.get('/snapshot')).body.data;
    expect(hidden.visibleParties).toEqual([]);
    expect(hidden.party).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain(JSON.stringify(partyId));
    expect(JSON.stringify(hidden)).not.toContain('usr_vega');
    expect(hidden.profiles.usr_kai.partyStatus).toEqual({ inParty: false, memberCount: null, joinable: false });

    // control: Vega visible to everyone -- the same party is listed whole and the same join succeeds
    expect((await w.vega.post('/privacy', { presenceVisibility: 'EVERYONE' })).status).toBe(200);
    const shown = (await w.nova.get('/snapshot')).body.data;
    expect(shown.visibleParties.map((p: any) => [p.partyId, p.members.map((m: any) => m.userId).sort()])).toEqual([[partyId, ['usr_kai', 'usr_vega']]]);
    expect(shown.profiles.usr_kai.partyStatus).toEqual({ inParty: true, memberCount: 2, joinable: true });
    expect((await w.nova.post(`/parties/${partyId}/join`)).status).toBe(200);
    expect((await w.nova.get('/snapshot')).body.data.party?.partyId).toBe(partyId);
  });

  it('invites still work: with Vega hidden from Nova, Kai invites Nova and her accept brings her in, where she sees the party whole', async () => {
    const w = await friends();
    await w.vega.get('/snapshot');
    await w.kai.post('/requests', { toUserId: 'usr_vega' });
    const requestId = (await w.vega.get('/snapshot')).body.data.requests.incoming[0].requestId;
    await w.vega.post(`/requests/${requestId}/accept`);
    for (const who of [w.kai, w.nova, w.vega]) await who.post('/presence', { connected: true, availability: 'AVAILABLE' });
    const partyId = (await w.kai.post('/parties', { name: 'Open', privacy: 'OPEN_TO_FRIENDS' })).body.data.partyId as string;
    expect((await w.vega.post(`/parties/${partyId}/join`)).status).toBe(200);
    expect((await w.vega.post('/privacy', { presenceVisibility: 'FRIENDS' })).status).toBe(200);
    expect((await w.nova.post(`/parties/${partyId}/join`)).status).toBe(404);
    const invited = await w.kai.post(`/parties/${partyId}/invites`, { toUserId: 'usr_nova' });
    expect(invited.status).toBe(200);
    expect((await w.nova.post(`/party-invites/${invited.body.data.inviteId}/accept`)).status).toBe(200);
    const mine = (await w.nova.get('/snapshot')).body.data.party;
    expect([mine?.partyId, mine?.members.map((m: any) => m.userId).sort()]).toEqual([partyId, ['usr_kai', 'usr_nova', 'usr_vega']]);
  });
});

describe('WL-358-02: accepting an invite to a party that has filled answers the generic words (routes)', () => {
  const GENERIC = "You can't join this party right now";

  /** A store whose state has Kai leading a party, Nova invited to it while it had room, then `more` of Kai's friends joined. */
  function seeded(more: number): { store: SocialStore; partyId: string; inviteId: string } {
    const at = new Date(T0).toISOString();
    let s = emptySocialState();
    const run = (actor: string, name: Parameters<typeof applySocialOperation>[1], body: Record<string, unknown> = {}, ids: string[] = []) => {
      const r = applySocialOperation(s, name, actor, { ids, body, query: {} }, at);
      if (!r.ok) throw new Error(`${name} by ${actor} refused: ${r.error.message}`);
      s = r.value.state;
      return r.value.data as Record<string, string>;
    };
    const befriendKai = (id: string) => {
      run('usr_kai', 'requests.send', { toUserId: id });
      run(id, 'requests.accept', {}, [s.requests.find((r) => r.fromUserId === 'usr_kai' && r.toUserId === id && r.status === 'PENDING')!.requestId]);
    };
    s = ensureSocialUser(s, { userId: 'usr_kai', displayName: 'Kai', handle: '@kai' }, at);
    s = ensureSocialUser(s, { userId: 'usr_nova', displayName: 'Nova', handle: '@nova' }, at);
    befriendKai('usr_nova');
    const partyId = run('usr_kai', 'parties.create', { name: 'Crew' }).partyId;
    const inviteId = run('usr_kai', 'parties.invite', { toUserId: 'usr_nova' }, [partyId]).inviteId;
    for (let i = 1; i <= more; i += 1) {
      const id = `usr_filler${i}`;
      s = ensureSocialUser(s, { userId: id, displayName: `Filler${i}`, handle: `@filler${i}` }, at);
      befriendKai(id);
      run(id, 'party_invites.accept', {}, [run('usr_kai', 'parties.invite', { toUserId: id }, [partyId]).inviteId]);
    }
    return { store: createInMemorySocialStore(s), partyId, inviteId };
  }

  it('full: Nova\'s accept is a 404 not-found with exactly the generic words (a missing invite\'s shape); the invite stays in her inbox', async () => {
    const { store, partyId, inviteId } = seeded(PARTY_MAX_MEMBERS - 1); // Kai + 7 = full
    expect((await store.read()).parties[partyId].members.length).toBe(PARTY_MAX_MEMBERS);
    const w = world(store);
    const missing = await w.nova.post('/party-invites/pinv_does_not_exist/accept');
    expect([missing.status, missing.body.error?.kind]).toEqual([404, 'not-found']);
    const answer = await w.nova.post(`/party-invites/${inviteId}/accept`);
    expect([answer.status, answer.body.error]).toEqual([missing.status, { kind: missing.body.error?.kind, message: GENERIC }]);
    expect((await w.nova.get('/party-invites')).body.data.map((i: any) => i.inviteId)).toEqual([inviteId]);
    expect((await w.nova.get('/snapshot')).body.data.party).toBeNull();
  });

  it('control: one fewer (room left), the same accept answers 200 and Nova is in the party', async () => {
    const { store, partyId, inviteId } = seeded(PARTY_MAX_MEMBERS - 2); // Kai + 6: room for one
    expect((await store.read()).parties[partyId].members.length).toBe(PARTY_MAX_MEMBERS - 1);
    const w = world(store);
    expect((await w.nova.post(`/party-invites/${inviteId}/accept`)).status).toBe(200);
    expect((await w.nova.get('/snapshot')).body.data.party?.partyId).toBe(partyId);
  });
});
