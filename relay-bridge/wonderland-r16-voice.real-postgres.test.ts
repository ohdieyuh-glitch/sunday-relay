import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WONDERLAND_PRESENCE_TTL_SECONDS } from '../src/relay/mission/wonderland-social';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { WONDERLAND_MIGRATIONS } from '../src/relay/persistence/wonderland-postgres';
import { WonderlandSocialPostgresStore } from '../src/relay/persistence/wonderland-social-postgres';
import { WonderlandVoicePostgresStore } from '../src/relay/persistence/wonderland-voice-postgres';
import {
  R16_CHECKS, R16_VOICE_CHECKS, r16Players, r16VoiceRestartCheck, readR16VoiceRooms, readR16Views, runR16Scenario, summarizeR16,
  verifyR16Restart, verifyR16Voice,
} from '../scripts/wonderland-r16-harness.mjs';
import { createR16VoiceBackend, r16ProductUserIdOf } from './wonderland-r16-voice.fixture';

/**
 * WONDERLAND R16 VOICE ON THE DURABLE STORES: THE SOCIAL TABLES (033) AND THE VOICE TABLES (035).
 *
 * The same voice wall, checked by the same harness over the same routes, with
 * the social state and every EOS identity and issuance in PostgreSQL. A
 * restart here is what a hosted restart is to these stores: every session gone,
 * the pool closed, a new pool and new stores opened on the same database. Each
 * player must then hold the identity they proved and, reconnected, be given
 * exactly the rooms they were given before. Epic's trusted server is the fake,
 * and it does not restart with the backend, as Epic does not.
 *
 * 035 is staged behind 034, so the database takes the TEST-ONLY placeholder
 * stamp `034_test_placeholder_not_a_migration`, exactly as the 035 suite does.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database; `todo`
 * everywhere else, so an absent database is a skipped proof, never a passing one.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const MIGRATION_035 = readFileSync(join(__dirname, '..', 'docs', 'julius-migrations', '035', '035_wonderland_voice.sql'), 'utf8')
  .replace(/^\\set ON_ERROR_STOP on\s*$/mu, '');
const PLACEHOLDER_034 = "INSERT INTO relay_wonderland.schema_migrations(version) VALUES('034_test_placeholder_not_a_migration')";
const ORIGIN = 'https://r16-voice.durable.test';
const T0 = Date.UTC(2026, 9, 5, 12, 0, 0);

suite('Wonderland R16 voice on PostgreSQL through 035', () => {
  const name = `r16voice${randomBytes(4).toString('hex')}`;
  let admin: Pool;
  let target = '';
  const pools: Pool[] = [];
  const open = (): Pool => {
    const pool = new Pool({ connectionString: target, max: 4 });
    pool.on('error', () => undefined);
    pools.push(pool);
    return pool;
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl!, max: 2 });
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    target = url.toString();
    const setup = open();
    for (const sql of WONDERLAND_MIGRATIONS) await setup.query(sql);
    await setup.query(PLACEHOLDER_034);
    await setup.query(MIGRATION_035);
  }, 60_000);

  afterAll(async () => {
    for (const pool of pools) await pool.end().catch(() => undefined);
    await admin?.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
    await admin?.end();
  });

  it('every check and every voice check passes on the durable stores, and a restart keeps each identity and each player\'s rooms', async () => {
    let pool = open();
    const backend = createR16VoiceBackend({
      origin: ORIGIN, t0: T0, stepMs: 500,
      stores: () => ({ social: new WonderlandSocialPostgresStore(pool), identities: new WonderlandVoicePostgresStore(pool) }),
    });
    const players = r16Players('durable');
    const sessions = backend.signIn([players.a, players.b, players.c]);
    const breaches: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await backend.fetch(input, init);
      breaches.push(...await backend.wallBreaches());
      return response;
    };
    const outcome = await runR16Scenario({
      bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'durable', fetch, clock: backend.clock,
      voice: { idTokens: backend.idTokens([players.a, players.b, players.c]) },
    });
    expect(outcome.results.filter((row) => row.result === 'FAIL'), 'no check failed').toEqual([]);
    expect(summarizeR16(outcome.results, { voice: true })).toMatchObject({ failed: 0, of: R16_CHECKS.length + R16_VOICE_CHECKS.length });
    expect(breaches, 'the trusted server never admitted what the wall forbids').toEqual([]);

    // What the stores hold: three proven identities, and a record of every token issued. By the end of the scenario the wall
    // has moved past every room it gave, so every issuance is taken back.
    const held = await pool.query<{ player_id: string; product_user_id: string }>('SELECT player_id, product_user_id FROM relay_wonderland.voice_identities ORDER BY player_id');
    expect(held.rows).toEqual([players.a, players.b, players.c].sort().map((player) => ({ player_id: player, product_user_id: r16ProductUserIdOf(player) })));
    const openIssuances = async () => (await pool.query<{ player_id: string; room_id: string }>(
      'SELECT player_id, room_id FROM relay_wonderland.voice_issuances WHERE revoked_at IS NULL ORDER BY player_id')).rows;
    expect((await pool.query('SELECT 1 FROM relay_wonderland.voice_issuances WHERE revoked_at IS NOT NULL')).rowCount).toBeGreaterThan(0);
    expect(await openIssuances()).toEqual([]);

    const recorded = {
      views: await readR16Views({ bridge: ORIGIN, origin: ORIGIN, sessions, players, nonce: 'durable', fetch: backend.fetch }),
      voice: { rooms: await readR16VoiceRooms({ bridge: ORIGIN, origin: ORIGIN, sessions, players, fetch: backend.fetch }) },
    };
    // Reading the plans IS joining: B and C, the one mutually visible pair the scenario ends with, now hold their room, and A none.
    const given = recorded.voice.rooms[players.b]!.INSTANCE;
    const room = 'rooms' in given ? given.rooms : [];
    expect(room).toHaveLength(1);
    expect(await openIssuances()).toEqual([{ player_id: players.b, room_id: room[0] }, { player_id: players.c, room_id: room[0] }]);
    // THE RESTART: longer than a lease, every session gone, the pool closed and a new one opened on the same database.
    backend.advance(WONDERLAND_PRESENCE_TTL_SECONDS * 1000 + 30_000);
    const old = pool;
    pool = open();
    await old.end();
    backend.restart();
    const again = backend.signIn([players.a, players.b, players.c]);
    const verified = await verifyR16Restart({ bridge: ORIGIN, origin: ORIGIN, sessions: again, players, nonce: 'durable', recorded, fetch: backend.fetch });
    expect(verified.results.filter((row) => row.result === 'FAIL')).toEqual([]);
    expect(verified.reconnect).toEqual({ [players.a]: 'REENTERED', [players.b]: 'REENTERED', [players.c]: 'REENTERED' });
    const heard = await verifyR16Voice({ bridge: ORIGIN, origin: ORIGIN, sessions: again, players, recorded, fetch: backend.fetch });
    expect(heard).toEqual([players.a, players.b, players.c].map((player) => ({ name: r16VoiceRestartCheck(player), result: 'PASS', detail: '' })));
    expect(await backend.wallBreaches()).toEqual([]);
  }, 120_000);
});
