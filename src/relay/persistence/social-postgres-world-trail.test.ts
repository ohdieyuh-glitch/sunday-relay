import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import type { SocialStore } from '../social/social-store';
import type { WorldView } from '../social/world-presence';
import { openSocialPostgresStore } from './social-postgres';

/*
 * THE TRANSPORT RING ON THE DURABLE STORE'S OWN PATH (r16reh18 PROTOTYPE; not evidence), without a database. The ring is in memory
 * in both stores; what differs is WHEN the PostgreSQL store adopts an operation's world: only once its transaction committed. So a
 * clear rides with the change that caused it: committed together, or neither. A fake pool answers the identity reads of an
 * ordinary database, every other query empty, and can fail the next COMMIT. The real-PostgreSQL suite is CI's.
 */

const KAI = 'usr_kai';
const NOVA = 'usr_nova';
const T0 = Date.parse('2026-10-21T12:00:00.000Z');

function fakePool() {
  let failNextCommit = false;
  const query = async (sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
    if (sql.includes('shobj_description')) return { rows: [{ c: null }], rowCount: 1 };
    if (sql === 'SELECT current_database() AS db') return { rows: [{ db: 'railway' }], rowCount: 1 };
    if (sql.includes('pg_control_system()')) return { rows: [{ sid: '7000000000000000001' }], rowCount: 1 };
    if (sql.trim() === 'COMMIT' && failNextCommit) {
      failNextCommit = false;
      throw Object.assign(new Error('could not serialize access'), { code: '40001' });
    }
    return { rows: [], rowCount: 0 };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  return { pool, failNextCommit: () => { failNextCommit = true; } };
}

async function relay(pool: Pool) {
  const store: SocialStore = await openSocialPostgresStore(pool);
  for (const id of [KAI, NOVA]) await store.ensureUser({ userId: id, displayName: id.slice(4), handle: `@${id.slice(4)}` }, new Date(T0).toISOString());
  const apply = (actor: string, op: Parameters<SocialStore['apply']>[0], ms: number, body: Record<string, unknown> = {}, ids: string[] = []) =>
    store.apply(op, actor, { ids, body, query: {} }, new Date(T0 + ms).toISOString());
  const pos = (x: number) => ({ x, y: 0, z: 10, yaw: 90, speed: 600, motion: 'RUN', skinId: 'shadow_flame' });
  const report = (who: string, ms: number) => apply(who, 'world.state', ms, pos(ms));
  /** Kai's answer with a cursor of 0: Nova's figure as [x, trail x's], or null. */
  const kaiSeesNova = async (ms: number) => {
    const r = await store.apply('world.state', KAI, { ids: [], body: pos(1), query: { sinceMs: '0' } }, new Date(T0 + ms).toISOString());
    if (!r.ok) throw new Error(r.error.message);
    const nova = (r.value as WorldView).avatars.find((a) => a.userId === NOVA);
    return nova === undefined ? null : [nova.x, (nova.trail ?? []).map((p) => p.x)];
  };
  for (const id of [KAI, NOVA]) {
    await apply(id, 'presence.update_self', 1, { connected: true });
    await apply(id, 'world.join', 2, { target: 'PUBLIC' });
  }
  return { apply, report, kaiSeesNova };
}

describe('the ring on the PostgreSQL store: a clear is adopted with the change that caused it', () => {
  it('RING-P01 a block and its removal, each committed, clear the ring: nothing Nova reported while blocked reaches Kai afterwards', async () => {
    const r = await relay(fakePool().pool);
    for (const ms of [100, 200, 300]) await r.report(NOVA, ms);
    expect(await r.kaiSeesNova(350)).toEqual([300, [100, 200]]);
    expect((await r.apply(KAI, 'blocks.add', 400, { targetId: NOVA })).ok).toBe(true);
    for (const ms of [500, 600, 700]) await r.report(NOVA, ms);
    expect(await r.kaiSeesNova(750)).toBeNull();
    expect((await r.apply(KAI, 'blocks.remove', 800, {}, [NOVA])).ok).toBe(true);
    await r.report(NOVA, 900);
    expect(await r.kaiSeesNova(950)).toEqual([900, []]);
  });

  it('RING-P02 a change whose commit fails changes nothing and clears nothing; its retry does both', async () => {
    const db = fakePool();
    const r = await relay(db.pool);
    for (const ms of [100, 200, 300]) await r.report(NOVA, ms);
    db.failNextCommit();
    const failed = await r.apply(NOVA, 'presence.update_self', 350, { availability: 'APPEAR_OFFLINE' });
    expect(failed.ok).toBe(false);
    expect(await r.kaiSeesNova(360)).toEqual([300, [100, 200]]);
    expect((await r.apply(NOVA, 'presence.update_self', 370, { availability: 'APPEAR_OFFLINE' })).ok).toBe(true);
    expect(await r.kaiSeesNova(380)).toBeNull();
    for (const ms of [400, 500]) await r.report(NOVA, ms);
    expect((await r.apply(NOVA, 'presence.update_self', 550, { availability: 'AVAILABLE' })).ok).toBe(true);
    await r.report(NOVA, 600);
    expect(await r.kaiSeesNova(650)).toEqual([600, []]);
  });
});
