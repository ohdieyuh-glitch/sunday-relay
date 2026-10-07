import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blockUser } from '../src/relay/social/social-friends';
import { createInMemorySocialStore, type SocialStore } from '../src/relay/social/social-store';
import { partyOf } from '../src/relay/social/social-state';
import { createInMemoryVoiceBindings } from '../src/relay/social/voice-binding';
import { EPIC, EosVoiceTokenMinter, createVoiceRemovals, eosFromEnv, hashId, hashPuid, loadEosVoiceConfig, type EosFetch, type EosVoiceConfig } from './eos-voice';
import { EOS_FROM_ENV, EOS_GAME_CONFIG_ENV, EOS_ROOM_SALT_ENV, loadEosGameClientConfig, type EosDeployment } from './eos-voice';

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

/*
 * THE HASHED-ID FORM, pinned (10-04): the game cannot SHA-256 on UE 5.8 (GetSHA256Signature is checkf(false) on Windows), so the
 * client tags ids with FSHA1 and the bridge must produce the SAME tag. One known vector, for the client and the bridge to cross-check.
 */
describe('hashed ids: "#" + SHA-1 first 12', () => {
  it('pins the known vector, computed independently with node crypto and written out', () => {
    const input = '0123456789abcdef0123456789abcdef';
    const independent = `#${createHash('sha1').update(Buffer.from(input, 'utf8')).digest('hex').slice(0, 12)}`;
    expect(hashId(input)).toBe(independent);
    expect(hashId(input)).toBe('#b1775a785f09');
    expect(hashId(input)).toMatch(/^#[0-9a-f]{12}$/);
    // not the old form (sha256 first 12, no '#')
    expect(hashId(input)).not.toBe(createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 12));
  });

  it('a PUID is lowercased first; a room id is hashed exactly as the client receives it', () => {
    expect(hashPuid('0123456789ABCDEF0123456789ABCDEF')).toBe('#b1775a785f09');
    expect(hashPuid('  0123456789abcdef0123456789ABCDEF ')).toBe('#b1775a785f09');
    // hashId itself does not fold case: the room id string is the client's, byte for byte
    expect(hashId('0123456789ABCDEF0123456789ABCDEF')).not.toBe('#b1775a785f09');
  });
});

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
    expect(eosFromEnv({}, { bindings: () => null, log: (l) => log.push(l) })).toEqual({ voice: null, gameConfig: null });
    const loaded = loadEosVoiceConfig(env, { readFile: () => `\uFEFF${JSON.stringify(good)}`, log: (l) => log.push(l) });
    expect(loaded).toEqual(good);
    const all = log.join('\n');
    for (const secret of [good.clientSecret, good.roomSalt, good.clientId, good.deploymentId, hashId(good.deploymentId), 'secret-place']) expect(all).not.toContain(secret);
    expect(all).toContain('configured (JSON)');
  });

  it('the JSON room salt holds 32 to 512 characters, as the .env salt does (review a6d5842c, m6): 31 and 513 are refused by name', () => {
    const plenty = hex(300);
    const at = (length: number) => {
      const log: string[] = [];
      const roomSalt = plenty.slice(0, length);
      const loaded = loadEosVoiceConfig({ WONDERLAND_EOS_VOICE_CONFIG: 'x' }, { readFile: () => JSON.stringify(config({ roomSalt })), log: (l) => log.push(l) });
      for (const line of log) expect(line).not.toContain(roomSalt);
      return { loaded, log };
    };
    for (const refused of [31, 16, 513]) {
      expect(at(refused).loaded, String(refused)).toBeNull();
      expect(at(refused).log, String(refused)).toEqual(['eos voice: the EOS config file is missing or has out of shape: roomSalt -- party voice answers 503']);
    }
    for (const taken of [32, 512]) expect(at(taken).loaded?.roomSalt, String(taken)).toHaveLength(taken);
  });
});

/*
 * THE FOUNDER'S .env (10-04): WONDERLAND_EOS_VOICE_CONFIG may name a KEY=VALUE file; the room salt is a SEPARATE file
 * (WONDERLAND_EOS_ROOM_SALT_FILE). Every file here is SYNTHETIC, written to a fresh temp directory; values are made at run time.
 */
describe('the EOS config as a .env file and a room-salt file', () => {
  function world(envText: string | ((v: Record<string, string>) => string), salt: string | null = hex(20)) {
    const dir = mkdtempSync(join(tmpdir(), 'eos-voice-env-'));
    const v = { product: `prod${hex(4)}`, sandbox: `sbx${hex(4)}`, deployment: `dep${hex(4)}`, serverId: `srv${hex(6)}`, serverSecret: hex(24), gameId: `gam${hex(6)}`, gameSecret: hex(24) };
    const envPath = join(dir, 'eos.env');
    writeFileSync(envPath, typeof envText === 'function' ? envText(v) : envText);
    const saltPath = join(dir, 'room-salt.txt');
    if (salt !== null) writeFileSync(saltPath, salt);
    const log: string[] = [];
    const load = (over: NodeJS.ProcessEnv = {}) => loadEosVoiceConfig({ WONDERLAND_EOS_VOICE_CONFIG: envPath, WONDERLAND_EOS_ROOM_SALT_FILE: saltPath, ...over }, { log: (l) => log.push(l) });
    const values = () => [v.serverSecret, v.gameSecret, v.serverId, v.gameId, v.product, v.sandbox, v.deployment, ...(salt === null ? [] : [salt.trim()]), dir];
    return { v, load, log, values, dir, done: () => rmSync(dir, { recursive: true, force: true }) };
  }
  const full = (v: Record<string, string>, opts: { server?: boolean; game?: boolean } = { server: true, game: true }) => [
    ...(opts.server ? [`EOS_SERVER_CLIENT_ID=${v.serverId}`, `EOS_SERVER_CLIENT_SECRET=${v.serverSecret}`] : []),
    ...(opts.game ? [`EOS_GAME_CLIENT_ID=${v.gameId}`, `EOS_GAME_CLIENT_SECRET=${v.gameSecret}`] : []),
    `EOS_PRODUCT_ID=${v.product}`, `EOS_SANDBOX_ID=${v.sandbox}`, `EOS_DEPLOYMENT_ID=${v.deployment}`,
  ];

  it('parses CRLF with a BOM, comments, blank lines, quotes and spaces around "="; unknown keys ignored; the salt from its own file', () => {
    const salt = `  ${hex(20)}  \r\nsecond line ignored`;
    const w = world((v) => `\uFEFFEOS_PRODUCT_ID = "${v.product}"\r\n# the founder's EOS file\r\n\r\nEOS_SANDBOX_ID='${v.sandbox}'\r\n  EOS_DEPLOYMENT_ID=${v.deployment}  \r\nSOMETHING_ELSE=whatever\r\nEOS_SERVER_CLIENT_ID = ${v.serverId}\r\nEOS_SERVER_CLIENT_SECRET="${v.serverSecret}"\r\n`, salt);
    const c = w.load();
    expect(c).toEqual({ productId: w.v.product, sandboxId: w.v.sandbox, deploymentId: w.v.deployment, clientId: w.v.serverId, clientSecret: w.v.serverSecret, roomSalt: salt.split(/\r?\n/)[0].trim() });
    // LF works the same
    const lf = world((v) => full(v).join('\n'));
    expect(lf.load()?.clientId).toBe(lf.v.serverId);
    w.done();
    lf.done();
  });

  it('voice uses the Trusted Server client ONLY: a game-only file, or a half server pair beside the game pair, is refused by key name (review a6d5842c, M3)', () => {
    const both = world((v) => full(v).join('\n'));
    expect(both.load()).toMatchObject({ clientId: both.v.serverId, clientSecret: both.v.serverSecret });
    expect(both.log).toEqual(['eos voice: client kind server']);
    // the game pair is never a fallback: it is the pair every signed-in player is handed
    const gameOnly = world((v) => full(v, { game: true }).join('\n'));
    expect(gameOnly.load()).toBeNull();
    expect(gameOnly.log).toEqual(['eos voice: the EOS config file is missing EOS_SERVER_CLIENT_ID, EOS_SERVER_CLIENT_SECRET (voice uses the Trusted Server client only; EOS_GAME_* is never used for voice) -- party voice answers 503']);
    const half = world((v) => [...full(v, { game: true }), `EOS_SERVER_CLIENT_ID=${v.serverId}`].join('\n'));
    expect(half.load()).toBeNull();
    expect(half.log.join('\n')).toMatch(/is missing EOS_SERVER_CLIENT_SECRET \(voice uses the Trusted Server client only/);
    // the server keys holding the GAME client's id: refused by key name, never started
    const same = world((v) => [...full(v).filter((l) => !l.startsWith('EOS_SERVER_CLIENT_ID')), `EOS_SERVER_CLIENT_ID=${v.gameId}`].join('\n'));
    expect(same.load()).toBeNull();
    expect(same.log).toEqual(['eos voice: the EOS config file names the game client as the voice client (EOS_SERVER_CLIENT_ID equals EOS_GAME_CLIENT_ID) -- party voice answers 503']);
    for (const w of [both, gameOnly, half, same]) {
      const all = w.log.join('\n');
      for (const value of w.values()) expect(all, 'a log line carries a config value or path').not.toContain(value);
      expect(all).not.toMatch(/Trusted Server policy/);
      w.done();
    }
  });

  it('a missing key, a missing or short salt, or an unreadable file: no minter -- and the log names WHICH key or file, never a value', () => {
    const cases: Array<[string, (v: Record<string, string>) => string, string | null, NodeJS.ProcessEnv, RegExp]> = [
      ['no product', (v) => full(v).filter((l) => !l.startsWith('EOS_PRODUCT_ID')).join('\n'), hex(20), {}, /missing EOS_PRODUCT_ID/],
      ['no sandbox', (v) => full(v).filter((l) => !l.startsWith('EOS_SANDBOX_ID')).join('\n'), hex(20), {}, /missing EOS_SANDBOX_ID/],
      ['no deployment', (v) => full(v).filter((l) => !l.startsWith('EOS_DEPLOYMENT_ID')).join('\n'), hex(20), {}, /missing EOS_DEPLOYMENT_ID/],
      ['no client pair at all', (v) => full(v, {}).join('\n'), hex(20), {}, /missing EOS_SERVER_CLIENT_ID, EOS_SERVER_CLIENT_SECRET \(voice uses the Trusted Server client only/],
      ['an empty quoted secret', (v) => [...full(v, {}), `EOS_SERVER_CLIENT_ID=${v.serverId}`, 'EOS_SERVER_CLIENT_SECRET=""'].join('\n'), hex(20), {}, /missing EOS_SERVER_CLIENT_SECRET \(voice uses/],
      ['a deployment id out of shape', (v) => [...full(v).filter((l) => !l.startsWith('EOS_DEPLOYMENT_ID')), 'EOS_DEPLOYMENT_ID=a/b'].join('\n'), hex(20), {}, /out of shape: EOS_DEPLOYMENT_ID/],
      ['a short salt (31 characters)', (v) => full(v).join('\n'), 'x'.repeat(31), {}, /room salt file must hold one line of 32/],
      ['no salt file', (v) => full(v).join('\n'), null, {}, /room salt file could not be read/],
      ['the salt variable unset', (v) => full(v).join('\n'), hex(20), { WONDERLAND_EOS_ROOM_SALT_FILE: '' }, /WONDERLAND_EOS_ROOM_SALT_FILE is not set/],
    ];
    for (const [label, text, salt, over, why] of cases) {
      const w = world(text, salt);
      expect(w.load(over), label).toBeNull();
      expect(w.log.join('\n'), label).toMatch(why);
      for (const value of w.values()) expect(w.log.join('\n'), `${label}: a value or path in the log`).not.toContain(value);
      w.done();
    }
    const gone = world((v) => full(v).join('\n'));
    expect(gone.load({ WONDERLAND_EOS_VOICE_CONFIG: join(gone.dir, 'nope.env') })).toBeNull();
    expect(gone.log.join('\n')).toMatch(/the EOS config file could not be read/);
    expect(gone.log.join('\n')).not.toContain(gone.dir);
    gone.done();
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
  const deleteOfPuid = (p: string) => `https://api.epicgames.dev${EPIC.participantPath('dep-wl', minter.roomIdFor(pid), p)}`;
  const deleteOf = (who: string) => deleteOfPuid(puid[who]);
  return { store, run, removals, epic, pid, people, puid, deletes, deleteOf, deleteOfPuid, commits, log, backoffs, minter, bindings };
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

  it("a WALLED member already in the room (a blocked pair carried into a shared party) leaves it: the next commit's F1 separation is a departure (M2)", async () => {
    const w = await voicedArena();
    const carried = blockUser(await w.store.read(), w.people.a, w.people.b, new Date(T0).toISOString());
    if (!carried.ok) throw new Error(carried.error.message);
    // a restore: both still members, walled; the bridge's hook feeds the same removal queue
    const restored = createInMemorySocialStore(carried.value, { afterCommit: (c) => w.removals.onDepartures(c.departures) });
    expect([partyOf(await restored.read(), w.people.a)?.partyId, partyOf(await restored.read(), w.people.b)?.partyId]).toEqual([w.pid, w.pid]);
    // any committed change reconciles first: a (the blocker, not the leader) leaves by F1
    const changed = await restored.apply('presence.update_self', w.people.leader, { ids: [], body: { connected: true }, query: {} }, new Date(T0).toISOString());
    expect(changed.ok).toBe(true);
    await w.removals.idle();
    expect(partyOf(await restored.read(), w.people.a)).toBeUndefined();
    expect(w.deletes()).toEqual([w.deleteOf(w.people.a)]);
  });

  it('a failed removal is retried with backoff, then succeeds; a removal that keeps failing gives up -- logged hashed', async () => {
    const w = await voicedArena({ remove: [{ status: 500 }, { status: 503 }, { status: 204 }] });
    await w.run('parties.leave', w.people.a, [w.pid], {});
    await w.removals.idle();
    expect(w.deletes()).toEqual([w.deleteOf(w.people.a), w.deleteOf(w.people.a), w.deleteOf(w.people.a)]);
    expect(w.backoffs).toEqual([250, 1000]);
    expect(w.log.some((l) => l.includes('after 2 retries') && l.includes(hashPuid(w.puid[w.people.a])))).toBe(true);
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

describe("removal takes out EVERY PUID minted for the member in that room, not only the one bound now (review a6d5842c, B1)", () => {
  const nowIso = new Date(T0).toISOString();

  it('a re-bind left the old PUID in the room: a kick DELETEs the old one and the new one, and forgets both', async () => {
    const w = await voicedArena();
    const room = w.minter.roomIdFor(w.pid);
    const old = w.puid[w.people.a];
    await w.minter.mint({ partyId: w.pid, participantId: w.people.a, audience: [], nowIso, puid: old });
    // a fresh sign-in re-binds a to a new PUID (Epic does not validate PUIDs: any 32 hex), and a token is minted for it as well
    const fresh = hex(16);
    expect(await w.bindings.bind({ userId: w.people.a, puid: fresh, sessionId: 's-a-2', nowIso })).toBe('rebound');
    await w.minter.mint({ partyId: w.pid, participantId: w.people.a, audience: [], nowIso, puid: fresh });
    expect([...w.minter.mintedIn(room, w.people.a).keys()]).toEqual([old, fresh]);
    await w.run('parties.remove_member', w.people.leader, [w.pid, w.people.a], {});
    await w.removals.idle();
    expect(w.deletes()).toEqual([w.deleteOfPuid(old), w.deleteOfPuid(fresh)]);
    expect(w.minter.mintedIn(room, w.people.a).size).toBe(0);
  });

  it("after a restart nothing minted is remembered: the binding's PUID is the fallback", async () => {
    const w = await voicedArena(); // this minter minted nothing: as after a restart
    expect(w.minter.mintedIn(w.minter.roomIdFor(w.pid), w.people.b).size).toBe(0);
    await w.run('parties.leave', w.people.b, [w.pid], {});
    await w.removals.idle();
    expect(w.deletes()).toEqual([w.deleteOf(w.people.b)]);
  });

  it('the record forgets a PUID only when that mint is confirmed removed: a removal given up on, or a newer mint, stays', async () => {
    const w = await voicedArena({ remove: [{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }] });
    const room = w.minter.roomIdFor(w.pid);
    const p = w.puid[w.people.b];
    await w.minter.mint({ partyId: w.pid, participantId: w.people.b, audience: [], nowIso, puid: p });
    const first = w.minter.mintedIn(room, w.people.b).get(p);
    await w.run('parties.leave', w.people.b, [w.pid], {});
    await w.removals.idle();
    expect(w.log.some((l) => l.includes('GAVE UP'))).toBe(true);
    expect(w.minter.mintedIn(room, w.people.b).has(p)).toBe(true); // still recorded: the next departure from the room tries it again
    await w.minter.mint({ partyId: w.pid, participantId: w.people.b, audience: [], nowIso, puid: p });
    w.minter.forgetMinted(room, w.people.b, p, first); // a stale serial never drops the newer, live token
    expect(w.minter.mintedIn(room, w.people.b).has(p)).toBe(true);
  });

  it("the route's removeFromRoom: the minted PUIDs plus the given one, one DELETE each; rejects after trying all; logs hashed only", async () => {
    const epic = epicFake({ remove: [{ status: 204 }, { status: 500 }, { status: 404 }] });
    const log: string[] = [];
    const minter = new EosVoiceTokenMinter(config(), { fetchImpl: epic.fetchImpl, now: () => T0, log: (l) => log.push(l) });
    const [p1, p2, elsewhere, other] = [hex(16), hex(16), hex(16), hex(16)];
    await minter.mint({ partyId: 'pty_1', participantId: 'u', audience: ['u'], nowIso, puid: p1 });
    await minter.mint({ partyId: 'pty_1', participantId: 'u', audience: ['u'], nowIso, puid: p2 });
    await minter.mint({ partyId: 'pty_2', participantId: 'u', audience: ['u'], nowIso, puid: elsewhere }); // another room: untouched
    await minter.mint({ partyId: 'pty_1', participantId: 'v', audience: ['v'], nowIso, puid: other }); // another player: untouched
    const room = minter.roomIdFor('pty_1');
    // the given PUID is normalised (and the minted p1 is not asked twice); anything not a PUID is never put in a URL
    await expect(minter.removeFromRoom({ partyId: 'pty_1', participantId: 'u', puids: [p1.toUpperCase(), 'not-a-puid'] })).rejects.toThrow('1 of 2 participant removals failed');
    expect(epic.calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([p1, p2].map((p) => `https://api.epicgames.dev${EPIC.participantPath('dep-wl', room, p)}`));
    expect([...minter.mintedIn(room, 'u').keys()]).toEqual([p2]); // p1 confirmed and forgotten; p2 failed, so it stays
    await minter.removeFromRoom({ partyId: 'pty_1', participantId: 'u', puids: [] }); // Epic's 404: already gone counts
    expect(minter.mintedIn(room, 'u').size).toBe(0);
    expect([...minter.mintedIn(minter.roomIdFor('pty_2'), 'u').keys()]).toEqual([elsewhere]);
    expect([...minter.mintedIn(room, 'v').keys()]).toEqual([other]);
    const all = log.join('\n');
    for (const raw of [p1, p2, elsewhere, other, room]) expect(all).not.toContain(raw);
    expect(all).toContain(`eos voice: removal failed room=${hashId(room)} puid=${hashPuid(p2)} (500)`);
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
    expect(all).toContain(hashPuid(PUID_B));
    expect(all).toContain(hashId(grant.roomId));
    // the mint line, exactly: the room id as the client received it (grant.roomId), the PUID lowercased
    expect(log.filter((l) => l.includes('room token minted'))).toEqual([`eos voice: room token minted room=${hashId(grant.roomId)} puid=${hashPuid(PUID_B)}`]);
    // every id on a log line is the '#' + 12-hex SHA-1 tag; no bare 12-hex (the old sha256 form) or 32-hex id is left
    for (const line of log) {
      for (const tag of line.match(/(room|puid)=(\S+)/g) ?? []) expect(tag, line).toMatch(/^(room|puid)=#[0-9a-f]{12}$/);
      expect(line, line).not.toMatch(/[0-9a-f]{32}/);
    }
    expect(log.length).toBeGreaterThanOrEqual(5);
  });
});

describe("the GAME client's EOS config: EOS_GAME_* only, never the Trusted Server's (founder 10-04)", () => {
  const PATH_SEEN = `C:/secret-place-${hex(4)}/eos-game.env`;
  // the founder's file is CRLF with no BOM; a BOM is tolerated
  const dotEnv = (pairs: Record<string, string>) => `\uFEFF${Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join('\r\n')}\r\n`;
  /** Planted values, made at run time: ids shaped like EOS's, secrets that say what they are. */
  const fileOf = () => {
    const ids = { EOS_PRODUCT_ID: hex(16), EOS_SANDBOX_ID: hex(16), EOS_DEPLOYMENT_ID: hex(16) };
    const game = { EOS_GAME_CLIENT_ID: `xyza${hex(14)}`, EOS_GAME_CLIENT_SECRET: `planted-game-${hex(16)}` };
    const server = { EOS_SERVER_CLIENT_ID: `xyzs${hex(14)}`, EOS_SERVER_CLIENT_SECRET: `planted-server-${hex(16)}` };
    return { ids, game, server, values: [...Object.values(ids), ...Object.values(game), ...Object.values(server)] };
  };
  const load = (text: string | (() => string), deployment?: EosDeployment | null) => {
    const log: string[] = [];
    const config = loadEosGameClientConfig({ [EOS_GAME_CONFIG_ENV]: PATH_SEEN }, { readFile: typeof text === 'function' ? text : () => text, log: (l) => log.push(l), deployment });
    return { config, log };
  };
  /** No value, no path, no length in any line. */
  const clean = (lines: readonly string[], values: readonly string[]) => {
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      for (const v of values) expect(line).not.toContain(v);
      expect(line).not.toContain('secret-place');
      expect(line).not.toMatch(/\d+ (chars|characters|bytes)/);
    }
  };

  it('loads the five values of the .env form and says only "loaded (5 keys)"', () => {
    const f = fileOf();
    const { config, log } = load(dotEnv({ ...f.ids, ...f.game }));
    expect(config).toEqual({ productId: f.ids.EOS_PRODUCT_ID, sandboxId: f.ids.EOS_SANDBOX_ID, deploymentId: f.ids.EOS_DEPLOYMENT_ID, clientId: f.game.EOS_GAME_CLIENT_ID, clientSecret: f.game.EOS_GAME_CLIENT_SECRET });
    expect(Object.isFrozen(config)).toBe(true);
    expect(log).toEqual(['eos game config: loaded (5 keys)']);
    clean(log, f.values);
  });

  it("a file holding BOTH pairs serves the GAME pair; a file holding only the Trusted Server's pair is refused, by key name", () => {
    const f = fileOf();
    const both = load(dotEnv({ ...f.ids, ...f.server, ...f.game }));
    expect(both.config?.clientId).toBe(f.game.EOS_GAME_CLIENT_ID);
    expect(both.config?.clientSecret).toBe(f.game.EOS_GAME_CLIENT_SECRET);
    for (const v of Object.values(f.server)) expect(JSON.stringify(both.config)).not.toContain(v);
    const serverOnly = load(dotEnv({ ...f.ids, ...f.server }));
    expect(serverOnly.config).toBeNull();
    expect(serverOnly.log).toEqual(['eos game config: the EOS game config file is missing EOS_GAME_CLIENT_ID, EOS_GAME_CLIENT_SECRET -- the client config route answers 503']);
    clean([...both.log, ...serverOnly.log], f.values);
  });

  it('absent, unreadable, JSON, a missing key or a value out of shape: null, and the log names keys only', () => {
    const f = fileOf();
    const absent: string[] = [];
    expect(loadEosGameClientConfig({}, { log: (l) => absent.push(l) })).toBeNull();
    expect(absent).toEqual(['eos game config: absent']);
    const cases: Array<[string | (() => string), string]> = [
      [() => { throw new Error(`ENOENT ${PATH_SEEN} ${f.game.EOS_GAME_CLIENT_SECRET}`); }, 'the EOS game config file could not be read'],
      [JSON.stringify({ productId: f.ids.EOS_PRODUCT_ID, clientSecret: f.game.EOS_GAME_CLIENT_SECRET }), 'the EOS game config file must be the .env form'],
      [dotEnv({ ...f.ids, EOS_GAME_CLIENT_ID: f.game.EOS_GAME_CLIENT_ID }), 'the EOS game config file is missing EOS_GAME_CLIENT_SECRET'],
      [dotEnv({ ...f.ids, ...f.game, EOS_SANDBOX_ID: `bad id ${hex(4)}` }), 'the EOS game config file has out of shape: EOS_SANDBOX_ID'],
      [dotEnv({ ...f.ids, ...f.game, EOS_GAME_CLIENT_SECRET: `x${'y'.repeat(600)}` }), 'the EOS game config file has out of shape: EOS_GAME_CLIENT_SECRET'],
    ];
    const lines: string[] = [];
    for (const [text, why] of cases) {
      const { config, log } = load(text);
      expect(config, why).toBeNull();
      expect(log).toEqual([`eos game config: ${why} -- the client config route answers 503`]);
      lines.push(...log);
    }
    clean(lines, f.values);
  });

  it("a game config naming another product, sandbox or deployment than the voice config is refused, by field name", () => {
    const f = fileOf();
    const text = dotEnv({ ...f.ids, ...f.game });
    const same: EosDeployment = { productId: f.ids.EOS_PRODUCT_ID, sandboxId: f.ids.EOS_SANDBOX_ID, deploymentId: f.ids.EOS_DEPLOYMENT_ID };
    expect(load(text, same).config?.deploymentId).toBe(f.ids.EOS_DEPLOYMENT_ID);
    const elsewhere = hex(16);
    const other = load(text, { ...same, deploymentId: elsewhere });
    expect(other.config).toBeNull();
    expect(other.log).toEqual(['eos game config: the EOS game config file names another deploymentId than the voice config -- the client config route answers 503']);
    clean(other.log, [...f.values, elsewhere]);
  });

  it("eosFromEnv carries the voice config's ids -- and nothing secret -- for that check, and checks the game config against them", () => {
    const dir = mkdtempSync(join(tmpdir(), 'eos-deploy-'));
    try {
      const f = fileOf();
      const envPath = join(dir, 'eos-server.env');
      const gamePath = join(dir, 'eos-game.env');
      const saltPath = join(dir, 'salt.txt');
      writeFileSync(envPath, dotEnv({ ...f.ids, ...f.server }));
      writeFileSync(gamePath, dotEnv({ ...f.ids, ...f.game }));
      writeFileSync(saltPath, `${hex(32)}\n`);
      const eos = eosFromEnv({ WONDERLAND_EOS_VOICE_CONFIG: envPath, WONDERLAND_EOS_ROOM_SALT_FILE: saltPath, [EOS_GAME_CONFIG_ENV]: gamePath }, { bindings: () => null });
      expect(eos.voice?.deployment).toEqual({ productId: f.ids.EOS_PRODUCT_ID, sandboxId: f.ids.EOS_SANDBOX_ID, deploymentId: f.ids.EOS_DEPLOYMENT_ID });
      for (const v of Object.values(f.server)) expect(JSON.stringify(eos.voice?.deployment)).not.toContain(v);
      expect(eos.gameConfig?.clientId).toBe(f.game.EOS_GAME_CLIENT_ID);
      // a game config naming another deployment is refused against the voice config's ids
      writeFileSync(gamePath, dotEnv({ ...f.ids, EOS_DEPLOYMENT_ID: hex(16), ...f.game }));
      expect(eosFromEnv({ WONDERLAND_EOS_VOICE_CONFIG: envPath, WONDERLAND_EOS_ROOM_SALT_FILE: saltPath, [EOS_GAME_CONFIG_ENV]: gamePath }, { bindings: () => null }).gameConfig).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("eosFromEnv refuses voice whose client IS the game client handed to players -- the JSON form too; another client starts it (review a6d5842c, M3)", () => {
    const f = fileOf();
    const voiceSecret = `planted-voice-${hex(16)}`;
    const voiceSalt = hex(24);
    const files: Record<string, string> = { 'voice.json': '', 'eos-game.env': dotEnv({ ...f.ids, ...f.game }) };
    const json = (clientId: string) => JSON.stringify({ productId: f.ids.EOS_PRODUCT_ID, sandboxId: f.ids.EOS_SANDBOX_ID, deploymentId: f.ids.EOS_DEPLOYMENT_ID, clientId, clientSecret: voiceSecret, roomSalt: voiceSalt });
    const run = (clientId: string) => {
      files['voice.json'] = json(clientId);
      const log: string[] = [];
      const eos = eosFromEnv({ WONDERLAND_EOS_VOICE_CONFIG: 'voice.json', [EOS_GAME_CONFIG_ENV]: 'eos-game.env' }, { bindings: () => null, readFile: (p) => files[p], log: (l) => log.push(l) });
      return { eos, log };
    };
    const same = run(f.game.EOS_GAME_CLIENT_ID);
    expect(same.eos.voice).toBeNull();
    expect(same.log).toContain("eos voice: the voice client is the game client handed to every signed-in player (the voice config's EOS_SERVER_CLIENT_ID or JSON clientId equals EOS_GAME_CLIENT_ID) -- party voice answers 503");
    clean(same.log, [...f.values, voiceSecret, voiceSalt]);
    const trusted = run(f.server.EOS_SERVER_CLIENT_ID);
    expect(trusted.eos.voice?.minter).toBeInstanceOf(EosVoiceTokenMinter);
    expect(trusted.eos.gameConfig?.clientId).toBe(f.game.EOS_GAME_CLIENT_ID);
    expect(trusted.log).toEqual(['eos voice: configured (JSON)', 'eos game config: loaded (5 keys)']);
  });
});

describe("the EOS config from the process ENVIRONMENT (env:), for a host whose secrets are variables (JUJU MAIN's hosted plan r3)", () => {
  /** Planted at run time; the path variables say `env:` and nothing may be read from a file. */
  const planted = () => {
    const ids = { EOS_PRODUCT_ID: hex(16), EOS_SANDBOX_ID: hex(16), EOS_DEPLOYMENT_ID: hex(16) };
    const game = { EOS_GAME_CLIENT_ID: `xyza${hex(14)}`, EOS_GAME_CLIENT_SECRET: `planted-game-${hex(16)}` };
    const server = { EOS_SERVER_CLIENT_ID: `xyzs${hex(14)}`, EOS_SERVER_CLIENT_SECRET: `planted-server-${hex(16)}` };
    const salt = hex(32);
    return { ids, game, server, salt, values: [...Object.values(ids), ...Object.values(game), ...Object.values(server), salt] };
  };
  const noFile = () => {
    throw new Error('a file was read');
  };
  const clean = (lines: readonly string[], values: readonly string[]) => {
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) for (const v of values) expect(line).not.toContain(v);
  };

  it('the voice config: the Trusted Server pair and the salt, from variables; no file is touched; the log names nothing secret', () => {
    const p = planted();
    const log: string[] = [];
    const config = loadEosVoiceConfig(
      { WONDERLAND_EOS_VOICE_CONFIG: EOS_FROM_ENV, WONDERLAND_EOS_ROOM_SALT_FILE: EOS_FROM_ENV, [EOS_ROOM_SALT_ENV]: p.salt, ...p.ids, ...p.server, ...p.game },
      { readFile: noFile, log: (l) => log.push(l) },
    );
    expect(config).toMatchObject({ productId: p.ids.EOS_PRODUCT_ID, deploymentId: p.ids.EOS_DEPLOYMENT_ID, clientId: p.server.EOS_SERVER_CLIENT_ID, clientSecret: p.server.EOS_SERVER_CLIENT_SECRET, roomSalt: p.salt });
    expect(log).toEqual(['eos voice: client kind server']);
    clean(log, p.values);
  });

  it('the salt is never made up: absent or short as a variable, the voice config is refused by NAME', () => {
    const p = planted();
    for (const salt of [undefined, '', 'short']) {
      const log: string[] = [];
      const env: NodeJS.ProcessEnv = { WONDERLAND_EOS_VOICE_CONFIG: EOS_FROM_ENV, WONDERLAND_EOS_ROOM_SALT_FILE: EOS_FROM_ENV, ...p.ids, ...p.server };
      if (salt !== undefined) env[EOS_ROOM_SALT_ENV] = salt;
      expect(loadEosVoiceConfig(env, { readFile: noFile, log: (l) => log.push(l) }), String(salt)).toBeNull();
      expect(log).toEqual(['eos voice: WONDERLAND_EOS_ROOM_SALT must hold 32 to 512 characters -- party voice answers 503']);
      clean(log, p.values);
    }
    // a missing id from the environment: refused by name, with "the environment" as the source
    const log: string[] = [];
    const noSandbox = { EOS_PRODUCT_ID: p.ids.EOS_PRODUCT_ID, EOS_DEPLOYMENT_ID: p.ids.EOS_DEPLOYMENT_ID };
    expect(loadEosVoiceConfig({ WONDERLAND_EOS_VOICE_CONFIG: EOS_FROM_ENV, WONDERLAND_EOS_ROOM_SALT_FILE: EOS_FROM_ENV, [EOS_ROOM_SALT_ENV]: p.salt, ...noSandbox, ...p.server }, { readFile: noFile, log: (l) => log.push(l) })).toBeNull();
    expect(log).toEqual(['eos voice: the environment is missing EOS_SANDBOX_ID -- party voice answers 503']);
  });

  it("the game config from variables serves the GAME pair even with the Trusted Server's beside it, and never falls back to it", () => {
    const p = planted();
    const both: string[] = [];
    const config = loadEosGameClientConfig({ [EOS_GAME_CONFIG_ENV]: EOS_FROM_ENV, ...p.ids, ...p.server, ...p.game }, { readFile: noFile, log: (l) => both.push(l) });
    expect(config).toEqual({ productId: p.ids.EOS_PRODUCT_ID, sandboxId: p.ids.EOS_SANDBOX_ID, deploymentId: p.ids.EOS_DEPLOYMENT_ID, clientId: p.game.EOS_GAME_CLIENT_ID, clientSecret: p.game.EOS_GAME_CLIENT_SECRET });
    expect(both).toEqual(['eos game config: loaded (5 keys)']);
    const serverOnly: string[] = [];
    expect(loadEosGameClientConfig({ [EOS_GAME_CONFIG_ENV]: EOS_FROM_ENV, ...p.ids, ...p.server }, { readFile: noFile, log: (l) => serverOnly.push(l) })).toBeNull();
    expect(serverOnly).toEqual(['eos game config: the environment is missing EOS_GAME_CLIENT_ID, EOS_GAME_CLIENT_SECRET -- the client config route answers 503']);
    clean([...both, ...serverOnly], p.values);
  });

  it('`env:` is the whole value: a path that merely starts with it is a file path, read as one', () => {
    const p = planted();
    const asked: string[] = [];
    const log: string[] = [];
    const read = (path: string) => {
      asked.push(path);
      return `${Object.entries({ ...p.ids, ...p.game }).map(([k, v]) => `${k}=${v}`).join('\n')}\n`;
    };
    expect(loadEosGameClientConfig({ [EOS_GAME_CONFIG_ENV]: 'env:/somewhere/eos-game.env', ...p.ids, ...p.server }, { readFile: read, log: (l) => log.push(l) })?.clientId).toBe(p.game.EOS_GAME_CLIENT_ID);
    expect(asked).toEqual(['env:/somewhere/eos-game.env']);
    clean(log, p.values);
  });
});
