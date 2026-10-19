import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import type { UserProfileView } from '../social/social-contracts';
import type { SocialStore } from '../social/social-store';
import { openSocialPostgresStore } from './social-postgres';

/*
 * BF-2 ON THE DURABLE STORE'S OWN PATH (R16 B23), without a database: the worn skin a world report carries is written through to
 * social_profiles.relay_dog in the store's transaction, once per change (never per tick), and a store opened again from those rows
 * -- a backend restart -- serves it. A fake pool plays an ordinary Wonderland database: it keeps the social_profiles rows it is
 * given (applied at COMMIT, dropped at ROLLBACK, as PostgreSQL would) and answers every other read empty. The real-PostgreSQL case
 * is in social-postgres.real-postgres.test.ts (CI).
 */

const KAI = 'usr_kai';
const NOVA = 'usr_nova';
const VEGA = 'usr_vega';
const T0 = Date.parse('2026-10-13T12:00:00.000Z');

type Row = Record<string, unknown>;

function fakeDatabase(seed: Row[] = []) {
  const profiles = new Map<string, Row>(seed.map((r) => [r.player_id as string, r]));
  const log: string[] = [];
  let failNextProfileWrite = false;
  const client = () => {
    let pending: Map<string, Row> | null = null;
    const query = async (sql: string, params: unknown[] = []): Promise<{ rows: Row[]; rowCount: number }> => {
      // the identity reads: an ordinary database (protected-store-writer-guard.test.ts plays the same three)
      if (sql.includes('shobj_description')) return { rows: [{ c: null }], rowCount: 1 };
      if (sql === 'SELECT current_database() AS db') return { rows: [{ db: 'railway' }], rowCount: 1 };
      if (sql.includes('pg_control_system()')) return { rows: [{ sid: '7000000000000000001' }], rowCount: 1 };
      const text = sql.trim().replace(/\s+/gu, ' ');
      log.push(text);
      if (text === 'BEGIN') pending = new Map();
      else if (text === 'COMMIT') {
        for (const [id, row] of pending ?? []) profiles.set(id, row);
        pending = null;
      } else if (text === 'ROLLBACK') pending = null;
      else if (text.startsWith('SELECT * FROM relay_wonderland.social_profiles')) {
        return { rows: [...profiles.values()].map((r) => ({ ...r })), rowCount: profiles.size };
      } else if (text.startsWith('INSERT INTO relay_wonderland.social_profiles')) {
        if (failNextProfileWrite) {
          failNextProfileWrite = false;
          throw Object.assign(new Error('server closed the connection unexpectedly'), { code: '08006' });
        }
        const [id, displayName, handle, avatarRef, nationId, clanName, relayDog, primaryAgent, activeCompanion, showcaseAgents, showcaseCompanions, stats, memberSince] = params;
        const json = (v: unknown) => (v === null ? null : JSON.parse(v as string));
        const row: Row = {
          player_id: id, display_name: displayName, handle, avatar_ref: avatarRef, nation_id: nationId, clan_name: clanName,
          relay_dog: json(relayDog), primary_agent: json(primaryAgent), active_companion: json(activeCompanion),
          showcase_agents: json(showcaseAgents), showcase_companions: json(showcaseCompanions), stats: json(stats), member_since: memberSince,
        };
        (pending ?? profiles).set(id as string, row);
      }
      return { rows: [], rowCount: 0 };
    };
    return { query, release: () => undefined };
  };
  const pool = { query: client().query, connect: async () => client() } as unknown as Pool;
  return {
    pool,
    profiles,
    profileWrites: () => log.filter((s) => s.startsWith('INSERT INTO relay_wonderland.social_profiles')).length,
    transactions: () => log.filter((s) => s === 'BEGIN').length,
    failNextProfileWrite: () => {
      failNextProfileWrite = true;
    },
  };
}

function player(store: SocialStore) {
  let clock = T0;
  const apply = (actor: string, op: Parameters<SocialStore['apply']>[0], body: Record<string, unknown> = {}, ids: string[] = []) =>
    store.apply(op, actor, { ids, body, query: {} }, new Date((clock += 1000)).toISOString());
  const tick = (actor: string, skinId: string) => apply(actor, 'world.state', { x: 1, y: 2, z: 3, yaw: 0, speed: 0, motion: 'IDLE', skinId });
  const skinSeenBy = async (viewer: string, subject: string) => {
    const r = await apply(viewer, 'profile.read', {}, [subject]);
    if (!r.ok) throw new Error(r.error.message);
    return (r.value as UserProfileView).profile.relayDog.skinId;
  };
  return { apply, tick, skinSeenBy };
}

async function opened(db: ReturnType<typeof fakeDatabase>, ids: readonly string[] = [KAI, NOVA, VEGA]) {
  const store = await openSocialPostgresStore(db.pool);
  for (const id of ids) await store.ensureUser({ userId: id, displayName: id.slice(4), handle: `@${id.slice(4)}` }, new Date(T0).toISOString());
  return store;
}

describe('BF-2 on the durable store: the worn skin is written through, once per change, and survives a restart', () => {
  it('a world report with a canonical skin writes relay_dog in one transaction; a restarted store serves it to another player', async () => {
    const db = fakeDatabase();
    const p = player(await opened(db));
    expect((await p.apply(KAI, 'world.join', { target: 'PUBLIC' })).ok).toBe(true);
    const [writes, transactions] = [db.profileWrites(), db.transactions()];
    expect((await p.tick(KAI, 'baal')).ok).toBe(true);
    expect(db.profileWrites(), 'the change wrote the profile row once').toBe(writes + 1);
    expect(db.transactions()).toBe(transactions + 1);
    expect(db.profiles.get(KAI)?.relay_dog).toEqual({ skinId: 'baal', primary: null, secondary: null, flame: null, appearanceTier: null });
    // a tick that changes no skin writes NOTHING (no transaction at all: the world report's fast path)
    expect((await p.tick(KAI, 'baal')).ok).toBe(true);
    expect([db.profileWrites(), db.transactions()]).toEqual([writes + 1, transactions + 1]);

    // THE RESTART: a new store read back from the rows alone
    const after = player(await openSocialPostgresStore(db.pool));
    expect(await after.skinSeenBy(NOVA, KAI)).toBe('baal');
    const self = await after.apply(KAI, 'snapshot.read');
    expect(self.ok && (self.value as { self: UserProfileView }).self.profile.relayDog.skinId).toBe('baal');
    // the control: a player who never reported still reads the base form after the same restart
    expect(await after.skinSeenBy(NOVA, VEGA)).toBe('relay_og');
    // and the agent card stays truthfully empty (RQ-1)
    const card = await after.apply(NOVA, 'profile.read', {}, [KAI]);
    expect(card.ok && (card.value as UserProfileView).profile.primaryAgent).toBeNull();
  });

  it('an id outside the registry writes nothing; a malformed one is refused and writes nothing', async () => {
    const db = fakeDatabase();
    const p = player(await opened(db));
    await p.apply(KAI, 'world.join', { target: 'PUBLIC' });
    expect((await p.tick(KAI, 'celestial_light')).ok).toBe(true);
    const writes = db.profileWrites();
    for (const id of ['bee', 'apollo', 'skeleton_flame_v1']) expect((await p.tick(KAI, id)).ok, id).toBe(true);
    const malformed = await p.tick(KAI, 'Baal');
    expect(malformed.ok).toBe(false);
    expect(db.profileWrites()).toBe(writes);
    expect((db.profiles.get(KAI)?.relay_dog as { skinId: string }).skinId).toBe('celestial_light');
    // the control: a registered id writes
    expect((await p.tick(KAI, 'shadow_flame')).ok).toBe(true);
    expect(db.profileWrites()).toBe(writes + 1);
  });

  it('a write that fails changes nothing (the tick answers retryable, the card keeps its skin); the next tick writes it', async () => {
    const db = fakeDatabase();
    const p = player(await opened(db));
    await p.apply(KAI, 'world.join', { target: 'PUBLIC' });
    db.failNextProfileWrite();
    const failed = await p.tick(KAI, 'jack_flame');
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.retryable).toBe(true);
    expect(await p.skinSeenBy(NOVA, KAI)).toBe('relay_og');
    expect((db.profiles.get(KAI)?.relay_dog as { skinId: string }).skinId).toBe('relay_og');
    expect((await p.tick(KAI, 'jack_flame')).ok).toBe(true);
    expect(await p.skinSeenBy(NOVA, KAI)).toBe('jack_flame');
    expect((db.profiles.get(KAI)?.relay_dog as { skinId: string }).skinId).toBe('jack_flame');
  });

  it('rows written behind the store: a relay_dog that is no object loads as the base Dog, an unregistered stored id is served as the base form', async () => {
    const row = (id: string, relayDog: unknown): Row => ({
      player_id: id, display_name: id.slice(4), handle: `@${id.slice(4)}`, avatar_ref: `generated:${id}`, nation_id: null, clan_name: null,
      relay_dog: relayDog, primary_agent: null, active_companion: null, showcase_agents: [], showcase_companions: [], stats: [], member_since: new Date(T0).toISOString(),
    });
    const db = fakeDatabase([
      row(KAI, 'baal'),
      row(NOVA, { skinId: 'apollo', primary: null, secondary: null, flame: null, appearanceTier: null }),
      row(VEGA, { skinId: 'shadow_flame', primary: null, secondary: null, flame: null, appearanceTier: null }),
    ]);
    const store = await openSocialPostgresStore(db.pool);
    expect((await store.read()).users[KAI].profile.relayDog).toEqual({ skinId: 'relay_og', primary: null, secondary: null, flame: null, appearanceTier: null });
    const p = player(store);
    expect([await p.skinSeenBy(VEGA, KAI), await p.skinSeenBy(VEGA, NOVA), await p.skinSeenBy(NOVA, NOVA)]).toEqual(['relay_og', 'relay_og', 'relay_og']);
    // the control: a canonical stored skin is served as stored
    expect(await p.skinSeenBy(KAI, VEGA)).toBe('shadow_flame');
    // and the next canonical report repairs the row into an object
    await p.apply(KAI, 'world.join', { target: 'PUBLIC' });
    expect((await p.tick(KAI, 'baal')).ok).toBe(true);
    expect(db.profiles.get(KAI)?.relay_dog).toEqual({ skinId: 'baal', primary: null, secondary: null, flame: null, appearanceTier: null });
  });
});
