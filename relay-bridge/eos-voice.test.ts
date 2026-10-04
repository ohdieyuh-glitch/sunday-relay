import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createInMemorySocialStore, type SocialStore } from '../src/relay/social/social-store';
import { partyOf } from '../src/relay/social/social-state';
import { createInMemoryVoiceBindings } from '../src/relay/social/voice-binding';
import { EPIC, EosVoiceTokenMinter, createVoiceRemovals, eosVoiceFromEnv, hashId, loadEosVoiceConfig, type EosFetch, type EosVoiceConfig } from './eos-voice';

/*
 * PARTY VOICE ON EOS, AGAINST A RECORDED EPIC FAKE (R16 EOS voice backend). Every request the bridge would send to
 * api.epicgames.dev is recorded and answered by script; the real API is exercised only by the R16 run.
 * Secrets and tokens are made at run time (the release scan matches secret SHAPES).
 */

const hex = (n: number) => randomBytes(n).toString('hex');
const T0 = Date.parse('2026-10-04T09:00:00.000Z');

function config(over: Partial<EosVoiceConfig> = {}): EosVoiceConfig {
  return { productId: 'prod-wl', sandboxId: 'sbx-dev', deploymentId: 'dep-wl', clientId: 'xyz-trusted', clientSecret: hex(24), roomSalt: hex(24), ...over };
}

interface Call { method: string; url: string; headers: Record<string, string>; body: string | undefined }
type Answer = { status: number; body?: unknown };

/** A recorded EOS: tokens, createRoomToken and removeParticipant, each from a script (or a sensible default). */
function epicFake(script: { token?: Answer[]; room?: Answer[]; remove?: Array<Answer | 'hang'> } = {}) {
  const calls: Call[] = [];
  const issued = { access: [] as string[], room: [] as string[], mediaUrls: [] as string[] };
  const queue = { token: [...(script.token ?? [])], room: [...(script.room ?? [])], remove: [...(script.remove ?? [])] };
  const reply = (a: Answer) => ({ ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body ?? {} });
  const fetchImpl: EosFetch = async (url, init) => {
    calls.push({ method: init.method, url, headers: init.headers, body: init.body });
    if (url === `${EPIC.apiRoot}${EPIC.tokenPath}`) {
      const next = queue.token.shift();
      if (next !== undefined) return reply(next);
      const access = `at_${hex(16)}`;
      issued.access.push(access);
      return reply({ status: 200, body: { [EPIC.tokenAnswer.accessToken]: access, [EPIC.tokenAnswer.expiresIn]: 3600 } });
    }
    if (init.method === 'POST' && /\/rtc\/v1\/[^/]+\/room\/[0-9a-f]{32}$/.test(url)) {
      const next = queue.room.shift();
      if (next !== undefined) return reply(next);
      const puid = JSON.parse(init.body ?? '{}')[EPIC.roomBody.participants][0][EPIC.roomBody.puid];
      const token = `rt_${hex(20)}`;
      const media = `wss://rtc.media.example/v1?region=eu&sig=${hex(8)}`;
      issued.room.push(token);
      issued.mediaUrls.push(media);
      return reply({ status: 200, body: { [EPIC.roomAnswer.clientBaseUrl]: media, [EPIC.roomAnswer.participants]: [{ [EPIC.roomAnswer.puid]: puid, [EPIC.roomAnswer.token]: token, hardMuted: false }] } });
    }
    if (init.method === 'DELETE' && /\/participants\/[0-9a-f]{32}$/.test(url)) {
      const next = queue.remove.shift();
      if (next === 'hang') return new Promise(() => undefined);
      return reply(next ?? { status: 204 });
    }
    return reply({ status: 404 });
  };
  return { calls, issued, fetchImpl, tokenCalls: () => calls.filter((c) => c.url.endsWith(EPIC.tokenPath)) };
}

const PUID_A = hex(16);
const PUID_B = hex(16);

describe('the EOS config file', () => {
  it('missing variable, unreadable file, bad JSON or a field out of shape: no minter (voice stays 503), and the log names nothing in it', () => {
    const log: string[] = [];
    const good = config();
    expect(loadEosVoiceConfig({}, { log: (l) => log.push(l) })).toBeNull();
    const env = { WONDERLAND_EOS_VOICE_CONFIG: 'C:/secret-place/eos.json' };
    expect(loadEosVoiceConfig(env, { readFile: () => { throw new Error('ENOENT C:/secret-place/eos.json'); }, log: (l) => log.push(l) })).toBeNull();
    expect(loadEosVoiceConfig(env, { readFile: () => '{not json', log: (l) => log.push(l) })).toBeNull();
    for (const broken of [{ ...good, clientSecret: '' }, { ...good, roomSalt: 'short' }, { ...good, deploymentId: 'a/b' }, { ...good, productId: undefined }]) {
      expect(loadEosVoiceConfig(env, { readFile: () => JSON.stringify(broken), log: (l) => log.push(l) }), JSON.stringify(Object.keys(broken))).toBeNull();
    }
    expect(eosVoiceFromEnv({}, { bindings: () => null, log: (l) => log.push(l) })).toBeNull();
    const loaded = loadEosVoiceConfig(env, { readFile: () => `\uFEFF${JSON.stringify(good)}`, log: (l) => log.push(l) });
    expect(loaded).toEqual(good);
    const all = log.join('\n');
    for (const secret of [good.clientSecret, good.roomSalt, good.clientId, 'secret-place']) expect(all).not.toContain(secret);
    expect(all).toContain(hashId(good.deploymentId));
  });
});

describe('minting a room token', () => {
  it('client-credentials token, then createRoomToken for the ONE bound PUID in the party\'s opaque room; the token JSON EOSVoiceChat expects', async () => {
    const cfg = config();
    const epic = epicFake();
    const minter = new EosVoiceTokenMinter(cfg, { fetchImpl: epic.fetchImpl, now: () => T0 });
    const grant = await minter.mint({ partyId: 'pty_7', participantId: 'ghu-1', audience: ['ghu-1', 'ghu-2'], nowIso: new Date(T0).toISOString(), puid: PUID_A });
    const [token, room] = epic.calls;
    // the access token: Basic clientId:clientSecret, grant_type=client_credentials, deployment_id
    expect(token.method).toBe('POST');
    expect(token.headers.Authorization).toBe(`Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(token.body))).toEqual({ grant_type: 'client_credentials', deployment_id: cfg.deploymentId });
    // the room: HMAC-SHA256(roomSalt, partyId), first 32 hex
    const roomId = createHmac('sha256', cfg.roomSalt).update('pty_7').digest('hex').slice(0, 32);
    expect(room.url).toBe(`https://api.epicgames.dev/rtc/v1/${cfg.deploymentId}/room/${roomId}`);
    expect(room.headers.Authorization).toBe(`Bearer ${epic.issued.access[0]}`);
    expect(JSON.parse(room.body ?? '')).toEqual({ participants: [{ puid: PUID_A, hardMuted: false }] });
    expect(grant.providerId).toBe('eos');
    expect(grant.roomId).toBe(roomId);
    expect(JSON.parse(grant.participantToken)).toEqual({ client_base_url: epic.issued.mediaUrls[0], participant_token: epic.issued.room[0] });
    // opaque and stable: names no party, one room per party
    expect(grant.roomId).not.toContain('pty_7');
    expect(minter.roomIdFor('pty_7')).toBe(roomId);
    expect(minter.roomIdFor('pty_8')).not.toBe(roomId);
    // without a bound PUID nothing is asked
    await expect(minter.mint({ partyId: 'pty_7', participantId: 'ghu-1', audience: ['ghu-1'], nowIso: new Date(T0).toISOString() })).rejects.toThrow();
    expect(epic.calls).toHaveLength(2);
  });
});

describe('the access token', () => {
  it('is cached until 60 s before it expires, then refreshed', async () => {
    let now = T0;
    const epic = epicFake();
    const minter = new EosVoiceTokenMinter(config(), { fetchImpl: epic.fetchImpl, now: () => now });
    const mint = () => minter.mint({ partyId: 'p', participantId: 'u', audience: ['u'], nowIso: new Date(now).toISOString(), puid: PUID_A });
    await mint();
    now = T0 + 30 * 60_000;
    await mint();
    expect(epic.tokenCalls()).toHaveLength(1);
    now = T0 + 3600_000 - 59_000; // inside the last minute
    await mint();
    expect(epic.tokenCalls()).toHaveLength(2);
  });

  it('a 401 refreshes it ONCE and retries; a second 401 fails without looping', async () => {
    const log: string[] = [];
    const epic = epicFake({ room: [{ status: 401 }] });
    const minter = new EosVoiceTokenMinter(config(), { fetchImpl: epic.fetchImpl, now: () => T0, log: (l) => log.push(l) });
    const grant = await minter.mint({ partyId: 'p', participantId: 'u', audience: ['u'], nowIso: new Date(T0).toISOString(), puid: PUID_A });
    expect(JSON.parse(grant.participantToken).participant_token).toBe(epic.issued.room[0]);
    expect(epic.tokenCalls()).toHaveLength(2);
    expect(log.some((l) => l.includes('refreshed after a 401'))).toBe(true);
    const twice = epicFake({ room: [{ status: 401 }, { status: 401 }] });
    const stubborn = new EosVoiceTokenMinter(config(), { fetchImpl: twice.fetchImpl, now: () => T0 });
    await expect(stubborn.mint({ partyId: 'p', participantId: 'u', audience: ['u'], nowIso: new Date(T0).toISOString(), puid: PUID_A })).rejects.toThrow(/401/);
    expect(twice.calls.filter((c) => c.method === 'POST' && c.url.includes('/room/'))).toHaveLength(2);
  });
});

/** An in-memory social world whose after-commit hook feeds the removal queue, with PUIDs bound for everyone. */
async function voicedArena(script: Parameters<typeof epicFake>[0] = {}) {
  const log: string[] = [];
  const epic = epicFake(script);
  const minter = new EosVoiceTokenMinter(config(), { fetchImpl: epic.fetchImpl, now: () => T0, log: (l) => log.push(l) });
  const bindings = createInMemoryVoiceBindings();
  const backoffs: number[] = [];
  const removals = createVoiceRemovals({ target: minter, bindings: () => bindings, log: (l) => log.push(l), sleep: async (ms) => { backoffs.push(ms); } });
  const commits: string[] = [];
  let store: SocialStore;
  store = createInMemorySocialStore(undefined, {
    afterCommit: (c) => {
      commits.push(`${c.op}:${c.departures.map((d) => d.userId).join(',')}`);
      removals.onDepartures(c.departures);
    },
  });
  const run = async (op: Parameters<SocialStore['apply']>[0], actor: string, ids: string[], body: Record<string, unknown>) => {
    const r = await store.apply(op, actor, { ids, body, query: {} }, new Date(T0).toISOString());
    if (!r.ok) throw new Error(`${op} by ${actor}: ${r.error.message}`);
    return r.value as Record<string, unknown> | null;
  };
  const people = { leader: 'ghu-leader', a: 'ghu-a', b: 'ghu-b' };
  const puid: Record<string, string> = { [people.leader]: hex(16), [people.a]: hex(16), [people.b]: hex(16) };
  for (const id of Object.values(people)) {
    await store.ensureUser({ userId: id, displayName: id, handle: `@${id}` }, new Date(T0).toISOString());
    await bindings.bind({ userId: id, puid: puid[id], sessionId: `s-${id}`, nowIso: new Date(T0).toISOString() });
  }
  for (const friend of [people.a, people.b]) {
    await run('requests.send', people.leader, [], { toUserId: friend });
    await run('requests.accept', friend, [(await store.read()).requests.find((r) => r.toUserId === friend && r.status === 'PENDING')!.requestId], {});
  }
  await run('parties.create', people.leader, [], {});
  const pid = partyOf(await store.read(), people.leader)!.partyId;
  for (const m of [people.a, people.b]) await run('party_invites.accept', m, [String((await run('parties.invite', people.leader, [pid], { toUserId: m }))?.inviteId)], {});
  const deletes = () => epic.calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
  const deleteOf = (who: string) => `https://api.epicgames.dev${EPIC.participantPath('dep-wl', minter.roomIdFor(pid), puid[who])}`;
  return { store, run, removals, epic, pid, people, puid, deletes, deleteOf, commits, log, backoffs };
}

describe('server-side removal after a committed party departure', () => {
  for (const [label, act, departed] of [
    ['the leader blocks a member (F1: the member is removed)', (w: Awaited<ReturnType<typeof voicedArena>>) => w.run('blocks.add', w.people.leader, [], { targetId: w.people.a, confirmSharedParty: true }), 'a'],
    ['a member blocks a member (F1: the blocker leaves)', (w: Awaited<ReturnType<typeof voicedArena>>) => w.run('blocks.add', w.people.a, [], { targetId: w.people.b, confirmSharedParty: true }), 'a'],
    ['a member blocks the leader (F1: the blocker leaves)', (w: Awaited<ReturnType<typeof voicedArena>>) => w.run('blocks.add', w.people.b, [], { targetId: w.people.leader, confirmSharedParty: true }), 'b'],
    ['a member leaves', (w: Awaited<ReturnType<typeof voicedArena>>) => w.run('parties.leave', w.people.a, [w.pid], {}), 'a'],
    ['the leader removes a member (a kick)', (w: Awaited<ReturnType<typeof voicedArena>>) => w.run('parties.remove_member', w.people.leader, [w.pid, w.people.b], {}), 'b'],
  ] as const) {
    it(`${label}: exactly that PUID is removed from that party's room, after the commit`, async () => {
      const w = await voicedArena();
      expect(w.deletes()).toEqual([]);
      await act(w);
      await w.removals.idle();
      const who = w.people[departed];
      expect(w.deletes()).toEqual([w.deleteOf(who)]);
      expect(w.commits.at(-1)?.endsWith(who)).toBe(true);
    });
  }

  it('in order, and never for a refused change (an unconfirmed block in a shared party changes nothing)', async () => {
    const w = await voicedArena();
    await expect(w.run('blocks.add', w.people.leader, [], { targetId: w.people.a })).rejects.toThrow(/BLOCK_NEEDS_CONFIRMATION/);
    await w.run('parties.leave', w.people.b, [w.pid], {});
    await w.run('parties.remove_member', w.people.leader, [w.pid, w.people.a], {});
    await w.run('parties.leave', w.people.leader, [w.pid], {}); // the last one out ends the party
    await w.removals.idle();
    expect(w.deletes()).toEqual([w.deleteOf(w.people.b), w.deleteOf(w.people.a), w.deleteOf(w.people.leader)]);
  });

  it('a failed removal is retried with backoff, then succeeds; a removal that keeps failing gives up -- logged hashed', async () => {
    const w = await voicedArena({ remove: [{ status: 500 }, { status: 503 }, { status: 204 }] });
    await w.run('parties.leave', w.people.a, [w.pid], {});
    await w.removals.idle();
    expect(w.deletes()).toEqual([w.deleteOf(w.people.a), w.deleteOf(w.people.a), w.deleteOf(w.people.a)]);
    expect(w.backoffs).toEqual([250, 1000]);
    expect(w.log.some((l) => l.includes('after 2 retries') && l.includes(hashId(w.puid[w.people.a])))).toBe(true);
    const g = await voicedArena({ remove: [{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }] });
    await g.run('parties.leave', g.people.b, [g.pid], {});
    await g.removals.idle();
    expect(g.deletes()).toHaveLength(4);
    expect(g.log.some((l) => l.includes('GAVE UP'))).toBe(true);
  });

  it('never blocks or fails the social change: a hanging EOS, and a hook that throws, leave the change committed', async () => {
    const w = await voicedArena({ remove: ['hang'] });
    await w.run('parties.leave', w.people.a, [w.pid], {}); // resolves although EOS never answers
    expect(partyOf(await w.store.read(), w.people.a)).toBeUndefined();
    await w.run('parties.leave', w.people.b, [w.pid], {}); // the store is not held up either
    expect(partyOf(await w.store.read(), w.people.b)).toBeUndefined();
    const store = createInMemorySocialStore(undefined, { afterCommit: () => { throw new Error('voice is down'); } });
    for (const id of ['x', 'y']) await store.ensureUser({ userId: id, displayName: id, handle: `@${id}` }, new Date(T0).toISOString());
    await store.apply('parties.create', 'x', { ids: [], body: {}, query: {} }, new Date(T0).toISOString());
    const pid = partyOf(await store.read(), 'x')!.partyId;
    expect((await store.apply('parties.leave', 'x', { ids: [pid], body: {}, query: {} }, new Date(T0).toISOString())).ok).toBe(true);
  });
});

describe('logs carry hashed ids only', () => {
  it('no client secret, room salt, access token, room token or media address -- and no raw PUID or room id -- in any line', async () => {
    const cfg = config();
    const log: string[] = [];
    loadEosVoiceConfig({ WONDERLAND_EOS_VOICE_CONFIG: 'x' }, { readFile: () => JSON.stringify(cfg), log: (l) => log.push(l) });
    const epic = epicFake({ room: [{ status: 401 }], remove: [{ status: 500 }, { status: 204 }] });
    const minter = new EosVoiceTokenMinter(cfg, { fetchImpl: epic.fetchImpl, now: () => T0, log: (l) => log.push(l) });
    const grant = await minter.mint({ partyId: 'pty_9', participantId: 'u', audience: ['u'], nowIso: new Date(T0).toISOString(), puid: PUID_B });
    const bindings = createInMemoryVoiceBindings();
    await bindings.bind({ userId: 'u', puid: PUID_B, sessionId: 's', nowIso: new Date(T0).toISOString() });
    const removals = createVoiceRemovals({ target: minter, bindings: () => bindings, log: (l) => log.push(l), sleep: async () => undefined });
    removals.onDepartures([{ partyId: 'pty_9', userId: 'u' }]);
    await removals.idle();
    const all = log.join('\n');
    const media = epic.issued.mediaUrls[0];
    for (const forbidden of [cfg.clientSecret, cfg.roomSalt, ...epic.issued.access, ...epic.issued.room, media, media.split('?')[1], PUID_B, grant.roomId]) {
      expect(all, 'a log line carries a secret or a raw id').not.toContain(forbidden);
    }
    expect(all).toContain(hashId(PUID_B));
    expect(all).toContain(hashId(grant.roomId));
    expect(log.length).toBeGreaterThanOrEqual(5);
  });
});
