import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRIVATE_SERVER_POLICY, type ServerEntitlementRow } from './private-server-lifecycle';
import {
  createInMemoryPrivateServerRegistry,
  PRIVATE_SERVER_CACHE_FRESH_MS,
  PRIVATE_SERVER_CACHE_MAX_STALE_MS,
  PRIVATE_SERVER_RACE_MESSAGE,
  PRIVATE_SERVER_READ_TIMEOUT_MS,
  PRIVATE_SERVER_UNAVAILABLE_MESSAGE,
  type InMemoryPrivateServerRegistry,
  type PrivateServerRegistry,
} from './private-server-registry';
import { createSocialFixture, FIXTURE_USERS as U } from './social-fixtures';
import { createInMemorySocialStore, type SocialStore } from './social-store';
import { WORLD_PRIVATE_CAPACITY, emptyWorldState, joinWorld, type WorldView } from './world-presence';

/*
 * THE FOUNDER'S PRIVATE-SERVER RULES (2026-10-11), through the REAL social operations on the in-memory store: the store reads the
 * owner's records before each world operation, persists an open by compare-and-set, and fails closed. A registry handed to a
 * second store models a restart (or a second bridge) -- the lifecycle outlives the store; the world does not. The numbered cases
 * are the directive's Rule H list. PostgreSQL's own suite (wonderland-migration-037.real-postgres.test.ts) repeats the durable ones.
 */

const MIN = 60_000;
const H = 60 * MIN;
const T0 = Date.parse('2026-10-12T08:00:00.000Z');
const W = PRIVATE_SERVER_POLICY.freeActiveWindowMs;
const C = PRIVATE_SERVER_POLICY.freeCooldownMs;
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const here = { x: 100, y: 200, z: 22, yaw: 90, speed: 0, motion: 'IDLE', skinId: 'shadow_flame' };
const tier = (userId: string, t: 'PRO' | 'MAX', from: number, until: number | null = null): ServerEntitlementRow => ({ userId, tier: t, validFromMs: T0 + from, validUntilMs: until === null ? null : T0 + until });

function harness(registry: PrivateServerRegistry = createInMemoryPrivateServerRegistry()) {
  const store = createInMemorySocialStore(createSocialFixture(), { privateServers: registry });
  return { store, registry };
}

const call = (store: SocialStore, actor: string, op: Parameters<SocialStore['apply']>[0], body: Record<string, unknown>, ms: number) =>
  store.apply(op, actor, { ids: [], body, query: {} }, iso(ms));

async function view(store: SocialStore, actor: string, op: Parameters<SocialStore['apply']>[0], body: Record<string, unknown>, ms: number): Promise<WorldView> {
  const r = await call(store, actor, op, body, ms);
  if (!r.ok) throw new Error(`${op} refused at +${ms / MIN} min: ${r.error.code} ${r.error.message}`);
  return r.value as WorldView;
}

const open = (store: SocialStore, actor: string, ms: number, name = '') => call(store, actor, 'world.join', { target: 'PRIVATE', name }, ms);

describe('Rule A / H(1): every player opens a private server, free', () => {
  it('(1) a FREE player (no tier row anywhere) opens one: in, with its closing time from the server clock', async () => {
    const { store, registry } = harness();
    const v = await view(store, U.KAI, 'world.join', { target: 'PRIVATE', name: "Kai's Lab" }, 0);
    expect(v.context).toMatchObject({ contextId: `priv_${U.KAI}`, kind: 'PRIVATE_SERVER', serverName: "Kai's Lab" });
    expect(v.context?.lifecycle).toEqual({ status: 'ACTIVE', closesAtIso: iso(W), closesInMs: W, tier: 'FREE' });
    expect((registry as InMemoryPrivateServerRegistry).stored(U.KAI)).toMatchObject({ cycleTier: 'FREE', status: 'ACTIVE', activatedAtMs: T0, activeUntilMs: T0 + W, cooldownUntilMs: T0 + W + C, version: 1 });
  });
});

describe('Rules B / C: the Free window closes on time and the cooldown holds', () => {
  it('(2) the window is enforced: a member\'s first report at the window\'s end closes the server for EVERYONE in it, with when it reopens', async () => {
    const { store, registry } = harness();
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    const inviteId = ((await call(store, U.KAI, 'world.invite', { toUserId: U.NOVA }, MIN)) as { ok: true; value: { inviteId: string } }).value.inviteId;
    await view(store, U.NOVA, 'world.join', { target: 'INVITE', inviteId }, 2 * MIN);
    expect((await view(store, U.NOVA, 'world.state', here, W - 1)).context?.contextId).toBe(`priv_${U.KAI}`);
    const nova = await view(store, U.NOVA, 'world.state', here, W);
    expect(nova.context).toBeNull();
    expect(nova.closed).toEqual({ reopensAtIso: null }); // a guest is told it closed, never the owner's schedule
    // and nobody is left "in" it in a friend's list: both locations cleared
    const after = await store.read();
    expect([after.users[U.KAI].presence.location, after.users[U.NOVA].presence.location]).toEqual([null, null]);
    const kai = await view(store, U.KAI, 'world.state', here, W + 100);
    expect(kai.context).toBeNull();
    expect(kai.closed).toEqual({ reopensAtIso: iso(W + C) });
    expect((registry as InMemoryPrivateServerRegistry).stored(U.KAI)?.status).toBe('COOLDOWN'); // the observation was recorded
  });

  it('(3) the cooldown is enforced: the owner\'s open is a 409-class refusal naming the reopening time; after it, a NEW window', async () => {
    const { store } = harness();
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    const refused = await open(store, U.KAI, W + MIN);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe('illegal-transition');
    expect(refused.error.message).toContain(new Date(T0 + W + C).toISOString().slice(0, 16).replace('T', ' '));
    expect((await open(store, U.KAI, W + C - 1)).ok).toBe(false);
    const again = await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, W + C);
    expect(again.context?.lifecycle?.closesAtIso).toBe(iso(W + C + W));
  });

  it('(4) a RESTART does not reset the cooldown: a new store on the same records refuses the open until the cooldown ends', async () => {
    const registry = createInMemoryPrivateServerRegistry();
    await view(harness(registry).store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    // the bridge restarts during the cooldown: the world is empty, the lifecycle is not
    const restarted = harness(registry).store;
    expect((await open(restarted, U.KAI, W + H)).ok).toBe(false);
    // and a restart DURING the window does not give a fresh window either
    const r2 = createInMemoryPrivateServerRegistry();
    await view(harness(r2).store, U.NOVA, 'world.join', { target: 'PRIVATE' }, 0);
    const back = await view(harness(r2).store, U.NOVA, 'world.join', { target: 'PRIVATE' }, 3 * H);
    expect(back.context?.lifecycle?.closesAtIso).toBe(iso(W));
  });

  it('(5) a RECONNECT does not bypass expiry: leaving, signing out and coming back keep the same closing time, and after it the open is refused', async () => {
    const { store, registry } = harness();
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    await call(store, U.KAI, 'world.leave', {}, H);
    await call(store, U.KAI, 'presence.update_self', { connected: false }, H + MIN);
    const back = await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 2 * H);
    expect(back.context?.lifecycle?.closesAtIso).toBe(iso(W));
    expect((registry as InMemoryPrivateServerRegistry).stored(U.KAI)?.version).toBe(1); // nothing re-opened it
    await call(store, U.KAI, 'world.leave', {}, W - MIN);
    expect((await open(store, U.KAI, W + 1)).ok).toBe(false);
  });

  it('(6) the client\'s clock is not an input: time, tier and state fields in a body change nothing', async () => {
    const { store, registry } = harness();
    const forged = { nowMs: T0 + 100 * H, now: '2031-01-01T00:00:00.000Z', clientTime: 0, activatedAt: 0, activeUntil: 9e15, cooldownUntil: 0, tier: 'MAX', status: 'CONTINUOUS' };
    const v = await view(store, U.KAI, 'world.join', { target: 'PRIVATE', ...forged }, 0);
    expect(v.context?.lifecycle).toMatchObject({ status: 'ACTIVE', tier: 'FREE', closesAtIso: iso(W) });
    expect((registry as InMemoryPrivateServerRegistry).stored(U.KAI)).toMatchObject({ cycleTier: 'FREE', activatedAtMs: T0, activeUntilMs: T0 + W });
    // a report claiming a far-future time does not close the server early ...
    expect((await view(store, U.KAI, 'world.state', { ...here, ...forged }, H)).context?.contextId).toBe(`priv_${U.KAI}`);
    // ... and a cooldown is not lifted by a body claiming a later time or a tier
    expect((await call(store, U.KAI, 'world.join', { target: 'PRIVATE', ...forged }, W + MIN)).ok).toBe(false);
  });
});

describe('Rules D / E: PRO and MAX are continuous, and only the trusted tier row grants them', () => {
  it('(7) PRO: open, and still open a day and a month later -- no window, no cooldown', async () => {
    const { store, registry } = harness();
    (registry as InMemoryPrivateServerRegistry).grant(tier(U.KAI, 'PRO', -H));
    const v = await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    expect(v.context?.lifecycle).toEqual({ status: 'CONTINUOUS', closesAtIso: null, closesInMs: null, tier: 'PRO' });
    for (const later of [W, W + C, 24 * H, 30 * 24 * H]) {
      expect((await view(store, U.KAI, 'world.state', here, later)).context?.contextId, `+${later / H} h`).toBe(`priv_${U.KAI}`);
    }
  });

  it('(8) MAX: a Free owner resting in a cooldown, upgraded to MAX by the operator, opens at once', async () => {
    const { store, registry } = harness();
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    expect((await open(store, U.KAI, W + MIN)).ok).toBe(false);
    (registry as InMemoryPrivateServerRegistry).grant(tier(U.KAI, 'MAX', W + MIN));
    const v = await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, W + 2 * MIN);
    expect(v.context?.lifecycle).toMatchObject({ status: 'CONTINUOUS', tier: 'MAX' });
  });

  it('(9) an EXPIRED subscription keeps nothing unearned: when PRO lapses, the server runs one Free window from the lapse, then closes', async () => {
    const { store, registry } = harness();
    (registry as InMemoryPrivateServerRegistry).grant(tier(U.KAI, 'PRO', -H, 2 * H));
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    expect((await view(store, U.KAI, 'world.state', here, 2 * H + W - MIN)).context?.contextId).toBe(`priv_${U.KAI}`);
    // the cache's minute passes and the report re-reads: the lapse is on the Free clock
    const closed = await view(store, U.KAI, 'world.state', here, 2 * H + W + 2 * MIN);
    expect(closed.context).toBeNull();
    expect((await open(store, U.KAI, 2 * H + W + 3 * MIN)).ok).toBe(false);
  });

  it('a REVOKED tier row reaches a running server at the cache\'s minute: CONTINUOUS just before it, a Free window (from the opening) just after', async () => {
    const { store, registry } = harness();
    (registry as InMemoryPrivateServerRegistry).grant(tier(U.KAI, 'MAX', -H));
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    (registry as InMemoryPrivateServerRegistry).revoke(U.KAI);
    expect((await view(store, U.KAI, 'world.state', here, PRIVATE_SERVER_CACHE_FRESH_MS - 1)).context?.lifecycle?.status).toBe('CONTINUOUS');
    const after = await view(store, U.KAI, 'world.state', here, PRIVATE_SERVER_CACHE_FRESH_MS + 1);
    expect(after.context?.lifecycle).toMatchObject({ status: 'ACTIVE', tier: 'FREE', closesAtIso: iso(W) });
    // the conversion was written down at that read
    expect((registry as InMemoryPrivateServerRegistry).stored(U.KAI)).toMatchObject({ cycleTier: 'FREE', activatedAtMs: T0, activeUntilMs: T0 + W });
  });

  it('(M1) a LAPSE IS WRITTEN DOWN: once a lapsed owner is seen resting, deleting the expired row cannot end the cooldown early', async () => {
    const { store, registry } = harness();
    const lapse = 30 * 24 * H;
    (registry as InMemoryPrivateServerRegistry).grant(tier(U.KAI, 'PRO', -H, lapse));
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    await call(store, U.KAI, 'world.leave', {}, H);
    // a month later, past the lapse's Free window: resting, and the read wrote the Free cycle down
    expect((await open(store, U.KAI, lapse + W + H)).ok).toBe(false);
    expect((registry as InMemoryPrivateServerRegistry).stored(U.KAI)).toMatchObject({ cycleTier: 'FREE', activatedAtMs: T0 + lapse, cooldownUntilMs: T0 + lapse + W + C });
    // the operator (or billing) deletes the expired row: the cycle's times do not move, so the owner is still resting
    (registry as InMemoryPrivateServerRegistry).revoke(U.KAI);
    expect((await open(store, U.KAI, lapse + W + 2 * H)).ok).toBe(false);
    expect((await open(store, U.KAI, lapse + W + C)).ok).toBe(true);
  });
});

describe('H(10): nobody joins a server that is not open, and nobody unauthorised joins at all', () => {
  it('an INVITATION: used while the server is open it admits (control); the same kind used after the window ended is refused 409-class, and so is a new invitation from inside it', async () => {
    const { store } = harness();
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    // CONTROL: an invitation used while open admits
    const early = (await call(store, U.KAI, 'world.invite', { toUserId: U.NOVA }, MIN)) as { ok: true; value: { inviteId: string } };
    expect((await view(store, U.NOVA, 'world.join', { target: 'INVITE', inviteId: early.value.inviteId }, 2 * MIN)).context?.contextId).toBe(`priv_${U.KAI}`);
    await call(store, U.NOVA, 'world.leave', {}, 3 * MIN);
    // an invitation made just before the end (inside its 10-minute life), used just after it -- Kai still inside, no report yet
    const late = (await call(store, U.KAI, 'world.invite', { toUserId: U.NOVA }, W - 5 * MIN)) as { ok: true; value: { inviteId: string } };
    const refused = await call(store, U.NOVA, 'world.join', { target: 'INVITE', inviteId: late.value.inviteId }, W + 1);
    expect(refused.ok === false && refused.error).toMatchObject({ code: 'illegal-transition' });
    const reinvite = await call(store, U.KAI, 'world.invite', { toUserId: U.NOVA }, W + 2);
    expect(reinvite.ok === false && reinvite.error.code).toBe('illegal-transition');
  });

  it('a FRIEND follow (the owner shares their private server with friends): admitted while open (control), refused 409-class after the window', async () => {
    const { store } = harness();
    await view(store, U.KAI, 'privacy.update_self', { privateServerVisibility: 'FRIENDS' }, 0);
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, MIN);
    expect((await view(store, U.NOVA, 'world.join', { target: 'FRIEND', userId: U.KAI }, 2 * MIN)).context?.contextId).toBe(`priv_${U.KAI}`);
    await call(store, U.NOVA, 'world.leave', {}, 3 * MIN);
    const refused = await call(store, U.NOVA, 'world.join', { target: 'FRIEND', userId: U.KAI }, MIN + W + 1);
    expect(refused.ok === false && refused.error.code).toBe('illegal-transition');
  });

  it('a PARTY follow: a member follows the leader into the leader\'s open server (control), and is refused 409-class after its window', async () => {
    const { store } = harness();
    await view(store, U.ORION, 'world.join', { target: 'PRIVATE' }, 0);
    expect((await view(store, U.LYRA, 'world.join', { target: 'PARTY' }, MIN)).context?.contextId).toBe(`priv_${U.ORION}`);
    await call(store, U.LYRA, 'world.leave', {}, 2 * MIN);
    const refused = await call(store, U.LYRA, 'world.join', { target: 'PARTY' }, W + 1);
    expect(refused.ok === false && refused.error.code).toBe('illegal-transition');
  });

  it('a stranger cannot follow into an OPEN server either (the friend / presence rules still decide first)', async () => {
    const { store } = harness();
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    const r = await call(store, U.VEGA, 'world.join', { target: 'FRIEND', userId: U.KAI }, MIN);
    expect(r.ok).toBe(false);
  });

  it('capacity is the same for every tier: a MAX owner\'s server is full at WORLD_PRIVATE_CAPACITY', () => {
    const s = createSocialFixture();
    const members = [U.NOVA, ...Array.from({ length: WORLD_PRIVATE_CAPACITY - 1 }, (_, i) => `u_member_${i}`)];
    const world = {
      ...emptyWorldState(),
      contexts: { [`priv_${U.NOVA}`]: { contextId: `priv_${U.NOVA}`, kind: 'PRIVATE_SERVER' as const, serverName: 'Lab', ownerId: U.NOVA, capacity: WORLD_PRIVATE_CAPACITY, authority: 'CLIENT_REPORTED' as const, memberIds: members } },
      invites: [{ inviteId: 'winv_1', contextId: `priv_${U.NOVA}`, fromUserId: U.NOVA, toUserId: U.KAI, expiresAtMs: T0 + H }],
    };
    const gate = { ownerId: U.NOVA, access: { status: 'CONTINUOUS' as const, tier: 'MAX' as const, activeUntilMs: null, cooldownUntilMs: null } };
    const r = joinWorld(world, s, U.KAI, { kind: 'INVITE', inviteId: 'winv_1' }, T0, gate);
    expect(r.ok === false && r.code).toBe('full');
  });
});

describe('H(11): concurrent requests cannot open a server twice or slip past the lifecycle', () => {
  it('two opens at the same moment on one store: one cycle, version 1, both answered with the same closing time', async () => {
    const { store, registry } = harness();
    const [a, b] = await Promise.all([view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0), view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0)]);
    expect(a.context?.lifecycle?.closesAtIso).toBe(iso(W));
    expect(b.context?.lifecycle?.closesAtIso).toBe(iso(W));
    expect((registry as InMemoryPrivateServerRegistry).stored(U.KAI)?.version).toBe(1);
  });

  it('two BRIDGES racing the same first open: compare-and-set lets exactly one write; the other changes nothing and answers 503-retryable', async () => {
    const inner = createInMemoryPrivateServerRegistry();
    // both reads are held until both have been asked, so both bridges decide from the SAME empty record (then it lets reads through)
    let holding = true;
    let waiting: Array<() => void> = [];
    const barrier: PrivateServerRegistry = {
      read: async (owner) => {
        const records = await inner.read(owner);
        if (!holding) return records;
        await new Promise<void>((release) => {
          waiting.push(release);
          if (waiting.length === 2) {
            for (const r of waiting) r();
            waiting = [];
          }
        });
        return records;
      },
      write: (next) => inner.write(next),
    };
    const a = harness(barrier).store;
    const b = harness(barrier).store;
    const [ra, rb] = await Promise.all([open(a, U.KAI, 0), open(b, U.KAI, 0)]);
    const results = [ra, rb];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const lost = results.find((r) => !r.ok);
    expect(lost !== undefined && !lost.ok && lost.error).toMatchObject({ code: 'stale-ledger-version', retryable: true, message: PRIVATE_SERVER_RACE_MESSAGE });
    expect(inner.stored(U.KAI)?.version).toBe(1);
    // the loser's retry sees the cycle the winner opened -- the same window, nothing re-opened
    holding = false;
    const loser = ra.ok ? b : a;
    const retry = await view(loser, U.KAI, 'world.join', { target: 'PRIVATE' }, 1000);
    expect(retry.context?.lifecycle?.closesAtIso).toBe(iso(W));
    expect(inner.stored(U.KAI)).toMatchObject({ version: 1, activeUntilMs: T0 + W });
  });
});

describe('H(12): a cooldown closes a SESSION, never data', () => {
  it('friends, requests, blocks, conversations, messages, parties and profiles are identical before and after a whole cycle', async () => {
    const { store } = harness();
    const before = await store.read();
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    await view(store, U.KAI, 'world.state', here, W);          // closes
    expect((await open(store, U.KAI, W + MIN)).ok).toBe(false);  // cooling down
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, W + C); // opens again
    const after = await store.read();
    for (const key of ['friendships', 'requests', 'blocks', 'mutes', 'reports', 'conversations', 'messages', 'parties', 'partyInvites', 'readStates'] as const) {
      expect((after as unknown as Record<string, unknown>)[key], key).toEqual((before as unknown as Record<string, unknown>)[key]);
    }
    for (const id of Object.keys(before.users)) expect(after.users[id].profile, id).toEqual(before.users[id].profile);
  });
});

describe('H(13): a server tier is not a Julius allowance', () => {
  it('the private-server modules import nothing from Julius / missions, and nothing in Julius / missions imports them', () => {
    const root = resolve(__dirname, '..');
    const mine = ['social/private-server-lifecycle.ts', 'social/private-server-registry.ts', 'persistence/private-server-postgres.ts'];
    for (const f of mine) {
      const imports = [...readFileSync(join(root, f), 'utf8').matchAll(/from\s+'([^']+)'/gu)].map((m) => m[1]);
      for (const i of imports) expect(i, `${f} imports ${i}`).not.toMatch(/mission|julius|entitlement|economics|usage/u);
    }
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/u.test(e.name) ? [join(dir, e.name)] : []));
    const juliusSide = [...walk(join(root, 'mission')), ...walk(join(root, 'usage'))];
    expect(juliusSide.length).toBeGreaterThan(20);
    for (const f of juliusSide) expect(readFileSync(f, 'utf8'), f).not.toMatch(/private-server-(lifecycle|registry|postgres)/u);
  });
});

describe('(M2) the records are no oracle for where another player is', () => {
  it('records unreadable: a STRANGER\'s follow still gets the stranger\'s refusal (403-class), never a 503 only a private-server target could produce', async () => {
    const { store, registry } = harness();
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    (registry as InMemoryPrivateServerRegistry).failReads(true);
    const r = await call(store, U.VEGA, 'world.join', { target: 'FRIEND', userId: U.KAI }, MIN);
    expect(r.ok === false && r.error.code).toBe('permission-denied');
  });

  it('a follow reads ONCE whether its target is in a private server or in a public world (the same work, so the same timing)', async () => {
    const { store, registry } = harness();
    const reg = registry as InMemoryPrivateServerRegistry;
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    await view(store, U.NOVA, 'world.join', { target: 'PUBLIC' }, 0);
    const before = reg.readsAsked();
    await call(store, U.VEGA, 'world.join', { target: 'FRIEND', userId: U.KAI }, MIN);
    const intoPrivate = reg.readsAsked() - before;
    await call(store, U.VEGA, 'world.join', { target: 'FRIEND', userId: U.NOVA }, 2 * MIN);
    const intoPublic = reg.readsAsked() - before - intoPrivate;
    expect([intoPrivate, intoPublic]).toEqual([1, 1]);
  });
});

describe('H(14): a backend failure never opens a restricted server', () => {
  it('records that never answer: the open gives up after the read timeout and answers 503-retryable; nothing opens', async () => {
    const { store, registry } = harness();
    (registry as InMemoryPrivateServerRegistry).hangReads(true);
    const started = Date.now();
    const r = await open(store, U.KAI, 0);
    expect(Date.now() - started).toBeLessThan(PRIVATE_SERVER_READ_TIMEOUT_MS + 1_500);
    expect(r.ok === false && r.error).toMatchObject({ code: 'stale-ledger-version', retryable: true });
    expect((registry as InMemoryPrivateServerRegistry).stored(U.KAI)).toBeNull();
  }, 15_000);

  it('records unreadable: an open is refused 503-retryable and nothing changes (no context, no record)', async () => {
    const { store, registry } = harness();
    (registry as InMemoryPrivateServerRegistry).failReads(true);
    const r = await open(store, U.KAI, 0);
    expect(r.ok === false && r.error).toMatchObject({ code: 'stale-ledger-version', retryable: true, message: PRIVATE_SERVER_UNAVAILABLE_MESSAGE });
    expect((await view(store, U.KAI, 'world.read', {}, 1)).context).toBeNull();
  });

  it('records unwritable: the open does not happen (no context), even though the read said READY', async () => {
    const { store, registry } = harness();
    (registry as InMemoryPrivateServerRegistry).failWrites(true);
    expect((await open(store, U.KAI, 0)).ok).toBe(false);
    expect((await view(store, U.KAI, 'world.read', {}, 1)).context).toBeNull();
    expect((registry as InMemoryPrivateServerRegistry).stored(U.KAI)).toBeNull();
  });

  it('a member\'s report while the records are unreadable: a recent read still decides by its own times; past the bound, the server CLOSES', async () => {
    const { store, registry } = harness();
    await view(store, U.KAI, 'world.join', { target: 'PRIVATE' }, 0);
    (registry as InMemoryPrivateServerRegistry).failReads(true);
    // inside the fresh minute: no read at all
    expect((await view(store, U.KAI, 'world.state', here, PRIVATE_SERVER_CACHE_FRESH_MS - 1)).context).not.toBeNull();
    // the refresh fails, the cached read is younger than the bound: it still decides (the Free window is far from over)
    expect((await view(store, U.KAI, 'world.state', here, PRIVATE_SERVER_CACHE_MAX_STALE_MS - 1)).context).not.toBeNull();
    // past the bound with nothing readable: closed, not open by default
    const v = await view(store, U.KAI, 'world.state', here, PRIVATE_SERVER_CACHE_MAX_STALE_MS + 1);
    expect(v.context).toBeNull();
    expect(v.closed).toEqual({ reopensAtIso: null });
  });

  it('even a cached read cannot hold a Free server open past its window: the times decide, not the cache', async () => {
    const { store, registry } = harness();
    await view(store, U.NOVA, 'world.join', { target: 'PRIVATE' }, 0);
    await view(store, U.NOVA, 'world.state', here, W - 30_000); // refreshes the cache just before the end
    (registry as InMemoryPrivateServerRegistry).failReads(true);
    expect((await view(store, U.NOVA, 'world.state', here, W)).context).toBeNull();
  });
});
