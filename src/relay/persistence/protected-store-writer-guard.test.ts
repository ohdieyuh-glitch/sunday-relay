import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { ProtectedStoreWriteRefused } from './protected-store-writer-guard';
import { openSocialPostgresStore } from './social-postgres';
import { createPostgresVoiceBindings } from './voice-binding-postgres';

/*
 * C2 (the Reviewer's INDEP_REVIEW_035_GUARD_788dffed; the founder, 2026-10-11: no voice session or voice record is ever written
 * to Julius's live store): the voice and social writers refuse a protected store in CODE. A fake pool answers the identity reads
 * as the store it plays and records every OTHER statement; on a protected store that record stays EMPTY. Each refusal has a
 * control that differs in ONE fact, the store's identity, and does reach the tables.
 */

/** The Julius live store's system identifier (protected-store.ts pins sha256("<it>/julius")). */
const LIVE_SID = '7684592472855232550';
const PUID = '0123456789abcdef0123456789abcdef';
const NOW = '2026-10-11T12:00:00.000Z';

interface Identity {
  readonly db: string;
  readonly sid: string | 'DENIED';
  readonly marker?: string | null;
}
const LIVE_STORES: ReadonlyArray<readonly [string, Identity]> = [
  ['the live store (S2, its pinned identity)', { db: 'julius', sid: LIVE_SID }],
  ['the live store restored into a new cluster (S1, its marker)', { db: 'julius_restored', sid: '7999999999999999999', marker: 'relay-store-role=julius-live' }],
  ['the live store through a role that may not read the sid (S3)', { db: 'julius', sid: 'DENIED' }],
];
const ORDINARY: Identity = { db: 'railway', sid: '7000000000000000001' };

function fakePool(id: Identity) {
  const executed: string[] = [];
  let identityReads = 0;
  const query = async (sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
    if (sql.includes('shobj_description')) {
      identityReads += 1;
      return { rows: [{ c: id.marker ?? null }], rowCount: 1 };
    }
    if (sql === 'SELECT current_database() AS db') {
      identityReads += 1;
      return { rows: [{ db: id.db }], rowCount: 1 };
    }
    if (sql.includes('pg_control_system()')) {
      identityReads += 1;
      if (id.sid === 'DENIED') throw Object.assign(new Error('permission denied for function pg_control_system'), { code: '42501' });
      return { rows: [{ sid: id.sid }], rowCount: 1 };
    }
    executed.push(sql.trim().replace(/\s+/gu, ' '));
    return { rows: [], rowCount: 0 };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  return { pool, executed, identityReads: () => identityReads };
}

const bindInput = { userId: 'usr_a', puid: PUID, sessionId: 's-a', sessionIssuedAtIso: null, sessionIssuedAtOf: null, nowIso: NOW };

async function refusedBy(call: Promise<unknown>): Promise<ProtectedStoreWriteRefused> {
  const error = await call.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(ProtectedStoreWriteRefused);
  if (!(error instanceof ProtectedStoreWriteRefused)) throw new Error('not refused');
  expect(error.code).toBe('write_refused_protected_store');
  expect(error.storeRole).toBe('julius-live');
  return error;
}

describe('C2: voice and social data never touch a protected store', () => {
  for (const [name, id] of LIVE_STORES) {
    it(`voice bindings on ${name}: every method refuses, and NOTHING reaches the table`, async () => {
      const { pool, executed } = fakePool(id);
      const bindings = createPostgresVoiceBindings(pool);
      await refusedBy(bindings.bind(bindInput));
      await refusedBy(bindings.bindingOf('usr_a'));
      await refusedBy(bindings.ownerOf(PUID));
      await refusedBy(bindings.puidsOf(['usr_a']));
      await refusedBy(bindings.puidsOf([]));
      expect(executed).toEqual([]);
    });

    it(`the social store on ${name} does not open, and reads nothing there`, async () => {
      const { pool, executed } = fakePool(id);
      await refusedBy(openSocialPostgresStore(pool));
      expect(executed).toEqual([]);
    });
  }

  it('CONTROL: on an ordinary database the same calls reach the table, and its identity is read once per pool, not per call', async () => {
    const { pool, executed, identityReads } = fakePool(ORDINARY);
    const bindings = createPostgresVoiceBindings(pool);
    expect(await bindings.bind(bindInput)).toBe('bound');
    expect(executed[0]).toBe('BEGIN');
    expect(executed.some((s) => s.startsWith('INSERT INTO relay_wonderland.voice_puid_binding'))).toBe(true);
    expect(executed.at(-1)).toBe('COMMIT');
    const readsAfterFirst = identityReads();
    expect(readsAfterFirst).toBeGreaterThan(0);
    await bindings.bindingOf('usr_a');
    await bindings.ownerOf(PUID);
    expect(identityReads()).toBe(readsAfterFirst);
  });

  it('CONTROL: on an ordinary database the social store goes on to read its tables', async () => {
    const { pool, executed } = fakePool(ORDINARY);
    const opened = await openSocialPostgresStore(pool).then(() => null, (e: unknown) => e);
    expect(opened).not.toBeInstanceOf(ProtectedStoreWriteRefused);
    expect(executed[0]).toBe('SELECT * FROM relay_wonderland.social_profiles');
  });

  it('a protected store is refused on EVERY call: no refusal is cached into a pass', async () => {
    const { pool, executed, identityReads } = fakePool(LIVE_STORES[0][1]);
    const bindings = createPostgresVoiceBindings(pool);
    await refusedBy(bindings.bindingOf('usr_a'));
    const readsAfterFirst = identityReads();
    await refusedBy(bindings.bindingOf('usr_a'));
    expect(identityReads()).toBe(2 * readsAfterFirst);
    expect(executed).toEqual([]);
  });
});
