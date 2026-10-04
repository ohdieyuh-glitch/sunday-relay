import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusTestDatabaseUrl } from './julius-test-database';
import { openSocialPostgresStore } from './social-postgres';
import { createPostgresVoiceBindings } from './voice-binding-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';

/**
 * PARTY VOICE PUID BINDINGS ON REAL POSTGRESQL (migration 033): the rule of src/relay/social/voice-binding.ts, durable and race-safe.
 *
 * Runs only where JULIUS_TEST_DATABASE_URL names a THROWAWAY database; `todo` elsewhere. The chain's own migrate() applies 033.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;

suite('party voice PUID bindings on real PostgreSQL', () => {
  const nonce = randomBytes(5).toString('hex');
  const A = `ghu-a-${nonce}`;
  const B = `ghu-b-${nonce}`;
  const P1 = randomBytes(16).toString('hex');
  const P2 = randomBytes(16).toString('hex');
  const NOW = '2026-10-04T08:00:00.000Z';
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    for (const id of [A, B]) await pool.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING', [id]);
  }, 60_000);

  // Shared databases: remove what this suite made (the binding rows cascade with the players). The pool is absent only when
  // beforeAll's first act threw: then nothing was made. This is teardown, not a test; nothing here could assert.
  const removeWhatThisSuiteMade = async (db: Pool): Promise<void> => {
    await db.query('DELETE FROM relay_wonderland.players WHERE player_id = ANY($1::text[])', [[A, B]]);
    await db.end();
  };
  afterAll(async () => {
    await (pool === undefined ? Promise.resolve() : removeWhatThisSuiteMade(pool));
  });

  it('migration 033 is applied and binds, refuses and re-binds by the rule -- durably, and never two owners for one PUID', async () => {
    const applied = await new TransactionalWonderlandDatabase(pool).appliedMigrationVersions();
    expect(applied.has('033_wonderland_voice')).toBe(true);
    const bindings = createPostgresVoiceBindings(pool);
    expect(await bindings.bind({ userId: A, puid: P1, sessionId: 's1', nowIso: NOW })).toBe('bound');
    expect(await bindings.bind({ userId: A, puid: P1, sessionId: 's1', nowIso: NOW })).toBe('same');
    expect(await bindings.bind({ userId: B, puid: P1, sessionId: 'sb', nowIso: NOW })).toBe('refused');
    expect(await bindings.bind({ userId: A, puid: P2, sessionId: 's1', nowIso: NOW })).toBe('refused');
    // a fresh store (a restart) reads the same rows back
    const again = createPostgresVoiceBindings(pool);
    expect(Object.fromEntries(await again.puidsOf([A, B]))).toEqual({ [A]: P1 });
    expect(await again.bind({ userId: A, puid: P2, sessionId: 's2', nowIso: NOW })).toBe('rebound');
    expect(Object.fromEntries(await again.puidsOf([A]))).toEqual({ [A]: P2 });
    // two racing first binds of one PUID: exactly one owner
    const P3 = randomBytes(16).toString('hex');
    const raced = await Promise.all([again.bind({ userId: B, puid: P3, sessionId: 'sb', nowIso: NOW }), createPostgresVoiceBindings(pool).bind({ userId: A, puid: P3, sessionId: 's3', nowIso: NOW })]);
    expect(raced.filter((r) => r === 'bound' || r === 'rebound')).toHaveLength(1);
    const owners = await pool.query('SELECT user_id FROM relay_wonderland.voice_puid_binding WHERE puid = $1', [P3]);
    expect(owners.rowCount).toBe(1);
    // the table itself refuses a malformed PUID and a second owner
    await expect(pool.query('INSERT INTO relay_wonderland.voice_puid_binding(user_id, puid, session_id, bound_at) VALUES($1, $2, $3, $4)', [B, 'NOT-A-PUID', 's', NOW])).rejects.toThrow();
  }, 60_000);

  it('the PostgreSQL social store tells a party departure only AFTER its transaction committed (what voice removal reads)', async () => {
    // the hook looks at the database from ANOTHER connection the instant it is told: the departed row must already be gone
    const seen: Array<Promise<number>> = [];
    const told: string[] = [];
    const store = await openSocialPostgresStore(pool, {
      afterCommit: (commit) => {
        for (const d of commit.departures) {
          told.push(`${commit.op}:${d.userId}`);
          seen.push(pool.query('SELECT count(*)::int AS n FROM relay_wonderland.social_party_members WHERE party_id = $1 AND player_id = $2', [d.partyId, d.userId]).then((r) => r.rows[0].n as number));
        }
      },
    });
    const run = async (op: Parameters<typeof store.apply>[0], actor: string, ids: string[], body: Record<string, unknown>) => {
      const r = await store.apply(op, actor, { ids, body, query: {} }, NOW);
      if (!r.ok) throw new Error(`${op}: ${r.error.message}`);
      return r.value as Record<string, unknown> | null;
    };
    for (const id of [A, B]) await store.ensureUser({ userId: id, displayName: id, handle: `@${id}` }, NOW);
    await run('requests.send', A, [], { toUserId: B });
    await run('requests.accept', B, [(await store.read()).requests.find((r) => r.toUserId === B && r.status === 'PENDING')!.requestId], {});
    const pid = String((await run('parties.create', A, [], {}))?.partyId);
    await run('party_invites.accept', B, [String((await run('parties.invite', A, [pid], { toUserId: B }))?.inviteId)], {});
    expect(told).toEqual([]);
    await run('parties.leave', B, [pid], {});
    expect(told).toEqual([`parties.leave:${B}`]);
    expect(await Promise.all(seen)).toEqual([0]);
    await run('parties.leave', A, [pid], {}); // the last one out ends the party: told as a departure too
    expect(told).toEqual([`parties.leave:${B}`, `parties.leave:${A}`]);
    expect(await Promise.all(seen)).toEqual([0, 0]);
    await pool.query('DELETE FROM relay_wonderland.social_events WHERE audience && $1::text[]', [[A, B]]);
  }, 60_000);
});
