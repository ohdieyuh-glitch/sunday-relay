import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  WONDERLAND_PRESENCE_TTL_SECONDS,
  createMemoryWonderlandSocialStore,
  projectWonderlandConversation,
  projectWonderlandFriends,
  projectWonderlandInbox,
  projectWonderlandInstanceListing,
  projectWonderlandParty,
  projectWonderlandPresenceOf,
  projectWonderlandRecentPlayers,
  projectWonderlandRoster,
  projectWonderlandServer,
  projectWonderlandServers,
  projectWonderlandVoiceRoster,
  wonderlandVoiceRouting,
  type WonderlandSocialCommand,
  type WonderlandSocialState,
  type WonderlandSocialStore,
} from '../mission/wonderland-social';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { WonderlandSocialPostgresStore } from './wonderland-social-postgres';
import { WONDERLAND_MIGRATIONS, WONDERLAND_MIGRATION_032, WONDERLAND_MIGRATION_033 } from './wonderland-postgres';

/**
 * WONDERLAND SOCIAL ON REAL POSTGRESQL — migration 033 and the store contract.
 *
 *   MIGRATION  033 applies only after 032, creates exactly its fifteen tables,
 *              refuses a second application, and its DOWN refuses to destroy
 *              social data unless the loss is stated.
 *   CONTRACT   one scripted world, run against the memory store and the
 *              PostgreSQL store; every projection for every player is EQUAL.
 *              The PostgreSQL store reads only a neighbourhood, so this is the
 *              proof that the neighbourhood is enough — a missing row would
 *              show up as a privacy projection that differs.
 *   WRITES     idempotent by command id, one writer at a time, and a racing
 *              "leader kicks" and "member blocks" never leave a broken party.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database; `todo`
 * everywhere else, so an absent database is a skipped proof, never a passing one.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'julius-migrations', '033');
const committed = (name: string): string => readFileSync(join(DOCS, name), 'utf8').replace(/^\\set ON_ERROR_STOP on\s*$/mu, '');
const BEFORE_033 = WONDERLAND_MIGRATIONS.slice(0, WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_033));
const BEFORE_032 = WONDERLAND_MIGRATIONS.slice(0, WONDERLAND_MIGRATIONS.indexOf(WONDERLAND_MIGRATION_032));
const HUB = 'public:hub';
const PLAZA = 'public:plaza';

suite('Wonderland social on real PostgreSQL (migration 033)', () => {
  const nonce = randomBytes(5).toString('hex');
  let admin: Pool;
  const made: Array<{ name: string; pool: Pool }> = [];
  const create = async (label: string, migrations: readonly string[]): Promise<Pool> => {
    const name = `wsocial${label}${nonce}`;
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(databaseUrl!);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 8 });
    made.push({ name, pool });
    for (const sql of migrations) await pool.query(sql);
    return pool;
  };
  const refusalOf = async (pool: Pool, sql: string): Promise<string | null> => {
    const client = await pool.connect();
    try { await client.query(sql); return null; } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      return (error as Error).message.split(':')[0]!;
    } finally { client.release(); }
  };

  beforeAll(async () => { admin = new Pool({ connectionString: databaseUrl!, max: 2 }); });
  afterAll(async () => {
    for (const { name, pool } of made) {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
    }
    await admin?.end();
    // Eleven databases, each DROP waiting out its last connections: the default ten seconds is not enough under load.
  }, 90_000);

  describe('migration 033', () => {
    it('applies after 032: exactly fifteen social tables, one stamp, and no Recent Players column (P3)', async () => {
      const pool = await create('apply', BEFORE_033);
      expect(await refusalOf(pool, WONDERLAND_MIGRATION_033)).toBeNull();
      const tables = await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='relay_wonderland' AND tablename LIKE 'social\\_%' ORDER BY 1");
      expect(tables.rows).toHaveLength(15);
      const stamp = await pool.query("SELECT 1 FROM relay_wonderland.schema_migrations WHERE version='033_wonderland_social'");
      expect(stamp.rowCount).toBe(1);
      const recent = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema='relay_wonderland' AND table_name LIKE 'social\\_%' AND column_name ILIKE '%recent%'");
      expect(recent.rowCount).toBe(0);
    });

    it('refuses before 032, and refuses a second application, changing nothing either time', async () => {
      const early = await create('early', BEFORE_032);
      expect(await refusalOf(early, WONDERLAND_MIGRATION_033)).toBe('migration_033_requires_032');
      expect((await early.query("SELECT 1 FROM pg_tables WHERE schemaname='relay_wonderland' AND tablename LIKE 'social\\_%'")).rowCount).toBe(0);
      const twice = await create('twice', WONDERLAND_MIGRATIONS);
      expect(await refusalOf(twice, WONDERLAND_MIGRATION_033)).toBe('migration_033_tables_exist');
    });

    it('the pre-check and post-check read what the runbook says they read', async () => {
      const pool = await create('checks', BEFORE_033);
      const pre = await pool.query(committed('precheck.sql')) as unknown as Array<{ rows: Array<Record<string, unknown>> }>;
      expect(pre[2]!.rows[0]).toMatchObject({ migration_032_applied: true, migration_033_applied: false, social_tables_present: '0', ledger_last: '032_julius_outbox_event_delete_forgets' });
      await pool.query(WONDERLAND_MIGRATION_033);
      const post = await pool.query(committed('postcheck.sql')) as unknown as Array<{ rows: Array<Record<string, unknown>> }>;
      expect(post[3]!.rows[0]).toMatchObject({ migration_033_applied: true, ledger_last: '033_wonderland_social', social_tables_present: '15', social_rows: '0', recent_players_columns: '0' });
    });

    it('DOWN refuses to destroy social data unless the loss is stated, then reverses cleanly, and 033 applies again', async () => {
      const pool = await create('down', WONDERLAND_MIGRATIONS);
      await new WonderlandSocialPostgresStore(pool).upsertProfile({ playerId: 'ann', displayName: 'Ann' });
      expect(await refusalOf(pool, committed('down.sql'))).toBe('migration_033_down_refused');
      expect((await pool.query('SELECT 1 FROM relay_wonderland.social_profiles')).rowCount, 'nothing was dropped').toBe(1);
      expect(await refusalOf(pool, `SET relay.migration_033_down_accepts_data_loss = 'yes'; ${committed('down.sql')}`)).toBeNull();
      expect((await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='relay_wonderland' AND tablename LIKE 'social\\_%'")).rowCount).toBe(0);
      expect((await pool.query("SELECT 1 FROM relay_wonderland.schema_migrations WHERE version='033_wonderland_social'")).rowCount).toBe(0);
      expect(await refusalOf(pool, WONDERLAND_MIGRATION_033)).toBeNull();
    });

    it('a name recorded from the account survives a request that knows none; a new player starts Unknown', async () => {
      const pool = await create('names', WONDERLAND_MIGRATIONS);
      const store = new WonderlandSocialPostgresStore(pool);
      await store.upsertProfile({ playerId: 'ann', displayName: 'ann-on-github' });
      await store.ensureProfile('ann');
      await store.ensureProfile('ben');
      await store.ensureProfile('ben');
      const rows = await pool.query<{ player_id: string; display_name: string | null }>(
        'SELECT player_id, display_name FROM relay_wonderland.social_profiles ORDER BY player_id');
      expect(rows.rows).toEqual([{ player_id: 'ann', display_name: 'ann-on-github' }, { player_id: 'ben', display_name: null }]);
      expect((await store.stateFor({ viewerId: 'ann', now: '2026-10-04T12:00:00.000Z' })).profiles.ann).toEqual({ displayName: 'ann-on-github' });
      await expect(store.ensureProfile('not a player id')).rejects.toThrow('wonderland_social_player_invalid');
    });

    it('the schema refuses the states the rules forbid: two parties for one player, self-blocks, a friendship stored twice', async () => {
      const pool = await create('constraints', WONDERLAND_MIGRATIONS);
      await pool.query("INSERT INTO relay_wonderland.players(player_id) VALUES('ann'),('ben')");
      await pool.query("INSERT INTO relay_wonderland.social_parties(party_id,leader_id,created_at) VALUES('p1','ann',now()),('p2','ben',now())");
      await pool.query("INSERT INTO relay_wonderland.social_party_members(party_id,player_id) VALUES('p1','ann')");
      expect(await refusalOf(pool, "INSERT INTO relay_wonderland.social_party_members(party_id,player_id) VALUES('p2','ann')")).toMatch(/duplicate key/u);
      expect(await refusalOf(pool, "INSERT INTO relay_wonderland.social_blocks(blocker_id,blocked_id,created_at) VALUES('ann','ann',now())")).toMatch(/check constraint/u);
      expect(await refusalOf(pool, "INSERT INTO relay_wonderland.social_friendships(player_low,player_high,created_at) VALUES('ben','ann',now())")).toMatch(/check constraint/u);
      expect(await refusalOf(pool, "INSERT INTO relay_wonderland.social_settings(player_id,visibility,updated_at) VALUES('ann','NOBODY',now())")).toMatch(/check constraint/u);
    });
  });

  describe('the store contract: the PostgreSQL store answers every projection as the memory store does', () => {
    const PLAYERS = ['ann', 'ben', 'cal', 'dee', 'fay', 'gus', 'hana', 'ivy', 'owen', 'mia', 'max', 'lea', 'mo', 'ned', 'sam', 'zed'];
    let sequence = 0;
    const at = (): string => new Date(Date.UTC(2026, 9, 4, 12, 0, sequence)).toISOString();
    const SCRIPT: Array<[string, WonderlandSocialCommand]> = [
      ['hana', { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } }],
      ['ann', { kind: 'FRIEND_REQUEST', toId: 'ben' }], ['ben', { kind: 'FRIEND_ACCEPT', fromId: 'ann' }],
      ['hana', { kind: 'FRIEND_REQUEST', toId: 'fay' }], ['fay', { kind: 'FRIEND_ACCEPT', fromId: 'hana' }],
      ['cal', { kind: 'FRIEND_REQUEST', toId: 'dee' }],
      ['lea', { kind: 'PARTY_CREATE', partyId: 'party-1' }],
      ['lea', { kind: 'PARTY_INVITE', inviteeId: 'mo' }], ['mo', { kind: 'PARTY_JOIN', partyId: 'party-1' }],
      ['lea', { kind: 'PARTY_INVITE', inviteeId: 'ned' }], ['ned', { kind: 'PARTY_JOIN', partyId: 'party-1' }],
      ['lea', { kind: 'PARTY_INVITE', inviteeId: 'hana' }], ['hana', { kind: 'PARTY_JOIN', partyId: 'party-1' }],
      ['lea', { kind: 'PARTY_INVITE', inviteeId: 'zed' }],
      // Ivy joins the party and never stands anywhere: her name reaches her party-mates only through the party.
      ['lea', { kind: 'PARTY_INVITE', inviteeId: 'ivy' }], ['ivy', { kind: 'PARTY_JOIN', partyId: 'party-1' }],
      ['owen', { kind: 'SERVER_CREATE', serverId: 'srv-1', name: 'The garden' }],
      ['owen', { kind: 'SERVER_INVITE', serverId: 'srv-1', inviteeId: 'mia' }], ['mia', { kind: 'SERVER_JOIN', serverId: 'srv-1' }],
      ['owen', { kind: 'SERVER_INVITE', serverId: 'srv-1', inviteeId: 'max' }], ['max', { kind: 'SERVER_JOIN', serverId: 'srv-1' }],
      ['owen', { kind: 'SERVER_INVITE', serverId: 'srv-1', inviteeId: 'sam' }],
      ...['sam', 'ann', 'ben', 'hana', 'fay', 'lea', 'mo', 'ned', 'cal'].map((player): [string, WonderlandSocialCommand] =>
        [player, { kind: 'ENTER_INSTANCE', instanceId: HUB, location: { zone: 'plaza', x: 1, y: 2, z: 0 }, activity: 'EXPLORING', dogId: 'dog-corgi' }]),
      ...['owen', 'mia', 'max'].map((player): [string, WonderlandSocialCommand] =>
        [player, { kind: 'ENTER_INSTANCE', instanceId: 'server:srv-1', location: null, activity: 'BUILDING', dogId: null }]),
      // The garden is not in anybody's listing: Dee sees Zed there only because the store reads who stands around her.
      // Zed arrives hidden (so Dee records no meeting), then un-hides while still standing there: Dee must now see him,
      // and only reading who stands around her can show it.
      ['zed', { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } }],
      ['dee', { kind: 'ENTER_INSTANCE', instanceId: 'public:garden', location: null, activity: 'IDLE', dogId: null }],
      ['zed', { kind: 'ENTER_INSTANCE', instanceId: 'public:garden', location: null, activity: 'IDLE', dogId: null }],
      ['zed', { kind: 'SET_SETTINGS', settings: { visibility: 'EVERYONE' } }],
      // A friendship and a server membership that exist without any meeting: Ivy and Dee are friends who never stood
      // together, and Dee joins Owen's server but never enters it.
      ['ivy', { kind: 'FRIEND_REQUEST', toId: 'dee' }], ['dee', { kind: 'FRIEND_ACCEPT', fromId: 'ivy' }],
      ['owen', { kind: 'SERVER_INVITE', serverId: 'srv-1', inviteeId: 'dee' }], ['dee', { kind: 'SERVER_JOIN', serverId: 'srv-1' }],
      ['ann', { kind: 'SEND_MESSAGE', messageId: 'm-1', toId: 'ben', body: 'hello' }],
      ['ben', { kind: 'SEND_MESSAGE', messageId: 'm-2', toId: 'ann', body: 'hi back' }],
      ['sam', { kind: 'SEND_MESSAGE', messageId: 'm-3', toId: 'cal', body: 'nice dog' }],
      ['sam', { kind: 'SEND_MESSAGE', messageId: 'm-4', toId: 'hana', body: 'are you here' }],
      ['ann', { kind: 'UPDATE_PRESENCE', location: { zone: 'fountain', x: 5, y: 5, z: 0 }, activity: 'IDLE' }],
      // The privacy wall's writes.
      ['owen', { kind: 'BLOCK', targetId: 'mia' }], // P4
      ['max', { kind: 'BLOCK', targetId: 'owen' }], // P5
      ['lea', { kind: 'BLOCK', targetId: 'mo' }], // leader blocks member
      ['ned', { kind: 'BLOCK', targetId: 'hana' }], // non-leader blocks non-leader
      ['ann', { kind: 'BLOCK', targetId: 'ben' }], // friends in a shared instance, with a conversation
      ['sam', { kind: 'BLOCK', targetId: 'cal' }],
      ['sam', { kind: 'UNBLOCK', targetId: 'cal' }],
      ['ben', { kind: 'SEND_MESSAGE', messageId: 'm-5', toId: 'ann', body: 'why' }], // refused, stores nothing
      ['cal', { kind: 'LEAVE_INSTANCE' }],
      // Gus is linked to Sam ONLY by a meeting: he passes through, leaves, and hides. Sam's Recent Players must drop him,
      // which the PostgreSQL store can only get right if it reads the settings of everyone the viewer has met.
      ['gus', { kind: 'ENTER_INSTANCE', instanceId: HUB, location: null, activity: 'IDLE', dogId: null }],
      ['gus', { kind: 'LEAVE_INSTANCE' }],
      ['gus', { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } }],
    ];

    /**
     * Two slices, so each read path is the ONLY route to what it must supply: the listing from a slice asked for the
     * listed instances, every other projection from the viewer's own slice, asked for nothing else.
     */
    const projectionsFor = (state: WonderlandSocialState, listingState: WonderlandSocialState, viewer: string) => ({
      roster: projectWonderlandRoster(state, viewer, state.presence[viewer]?.instanceId ?? HUB),
      listing: projectWonderlandInstanceListing(listingState, viewer, [HUB, PLAZA]),
      presence: PLAYERS.map((id) => projectWonderlandPresenceOf(state, viewer, id)),
      friends: projectWonderlandFriends(state, viewer),
      recent: projectWonderlandRecentPlayers(state, viewer),
      party: projectWonderlandParty(state, viewer),
      servers: projectWonderlandServers(state, viewer),
      server: projectWonderlandServer(state, viewer, 'srv-1'),
      inbox: projectWonderlandInbox(state, viewer),
      conversations: PLAYERS.map((id) => projectWonderlandConversation(state, viewer, id)),
    });

    it('runs the same script to the same outcomes, and every player sees the same world in both stores', async () => {
      const pool = await create('contract', WONDERLAND_MIGRATIONS);
      const stores: Record<'memory' | 'postgres', WonderlandSocialStore> = {
        memory: createMemoryWonderlandSocialStore(),
        postgres: new WonderlandSocialPostgresStore(pool),
      };
      for (const store of Object.values(stores)) {
        for (const player of PLAYERS) await store.upsertProfile({ playerId: player, displayName: player.toUpperCase() });
      }
      for (const [index, [actorId, command]] of SCRIPT.entries()) {
        sequence = index;
        const outcomes = await Promise.all(Object.values(stores).map((store) =>
          store.execute({ actorId, commandId: `script-${String(index)}`, command, at: at() })));
        expect(outcomes[1], `step ${String(index)} ${command.kind} by ${actorId}`).toEqual(outcomes[0]);
      }
      for (const viewer of PLAYERS) {
        const memory = projectionsFor(
          await stores.memory.stateFor({ viewerId: viewer, now: at() }), await stores.memory.stateFor({ viewerId: viewer, publicInstanceIds: [HUB, PLAZA], now: at() }), viewer);
        const postgres = projectionsFor(
          await stores.postgres.stateFor({ viewerId: viewer, now: at() }), await stores.postgres.stateFor({ viewerId: viewer, publicInstanceIds: [HUB, PLAZA], now: at() }), viewer);
        expect(postgres, `the world as ${viewer} sees it`).toEqual(memory);
      }
      for (const channel of [['ann', 'ben', 'sam', 'hana', 'fay'], ['owen', 'mia', 'max'], ['lea', 'ned', 'hana', 'mo']]) {
        expect(wonderlandVoiceRouting(await stores.postgres.voiceStateFor({ participantIds: channel, now: at() }), channel))
          .toEqual(wonderlandVoiceRouting(await stores.memory.voiceStateFor({ participantIds: channel, now: at() }), channel));
        for (const listener of channel) {
          expect(projectWonderlandVoiceRoster(await stores.postgres.voiceStateFor({ participantIds: channel, now: at() }), listener, channel))
            .toEqual(projectWonderlandVoiceRoster(await stores.memory.voiceStateFor({ participantIds: channel, now: at() }), listener, channel));
        }
      }
      // And the walls held, read back from PostgreSQL itself.
      const server = await pool.query("SELECT array_agg(player_id ORDER BY join_order) AS members FROM relay_wonderland.social_server_members WHERE server_id='srv-1'");
      expect(server.rows[0].members, 'P4 removed Mia, P5 took Max out; Dee joined later').toEqual(['dee']);
      const party = await pool.query("SELECT array_agg(player_id ORDER BY join_order) AS members FROM relay_wonderland.social_party_members WHERE party_id='party-1'");
      expect(party.rows[0].members, 'Mo removed by the leader; Ned left after blocking Hana').toEqual(['lea', 'hana', 'ivy']);
      const refusedDuringBlock = await pool.query("SELECT 1 FROM relay_wonderland.social_messages WHERE message_id='m-5'");
      expect(refusedDuringBlock.rowCount).toBe(0);
    });

    it('a presence expires in both stores at the same instant: nothing is deleted, and an entry meets only who is live', async () => {
      const pool = await create('liveness', WONDERLAND_MIGRATIONS);
      const stores: Record<'memory' | 'postgres', WonderlandSocialStore> = {
        memory: createMemoryWonderlandSocialStore(),
        postgres: new WonderlandSocialPostgresStore(pool),
      };
      const TTL = WONDERLAND_PRESENCE_TTL_SECONDS;
      const t = (seconds: number): string => new Date(Date.UTC(2026, 9, 4, 14, 0, 0) + seconds * 1000).toISOString();
      const enter: WonderlandSocialCommand = { kind: 'ENTER_INSTANCE', instanceId: HUB, location: null, activity: 'IDLE', dogId: null };
      const heartbeat: WonderlandSocialCommand = { kind: 'UPDATE_PRESENCE', location: null, activity: 'IDLE' };
      const steps: Array<[string, WonderlandSocialCommand, number, string]> = [
        ['ann', { kind: 'FRIEND_REQUEST', toId: 'ben' }, 0, 'DONE'], ['ben', { kind: 'FRIEND_ACCEPT', fromId: 'ann' }, 0, 'DONE'],
        ['ann', enter, 0, 'DONE'], ['ben', enter, 60, 'DONE'], ['cal', enter, 60, 'DONE'],
        // One second past Ann's time to live: Ben's heartbeat holds, Ann's is told to enter again, and Dee meets only who is there.
        ['ben', heartbeat, TTL + 1, 'DONE'], ['ann', heartbeat, TTL + 1, 'NOT_IN_INSTANCE'], ['dee', enter, TTL + 2, 'DONE'],
      ];
      for (const store of Object.values(stores)) {
        for (const player of ['ann', 'ben', 'cal', 'dee']) await store.upsertProfile({ playerId: player, displayName: player.toUpperCase() });
      }
      for (const [index, [actorId, command, seconds, code]] of steps.entries()) {
        const outcomes = await Promise.all(Object.values(stores).map((store) =>
          store.execute({ actorId, commandId: `live-${String(index)}`, command, at: t(seconds) })));
        expect(outcomes[1], `step ${String(index)} ${command.kind} by ${actorId}`).toEqual(outcomes[0]);
        expect(outcomes[0]!.code, `step ${String(index)} ${command.kind} by ${actorId}`).toBe(code);
      }
      const now = t(TTL + 2);
      for (const viewer of PLAYERS) {
        const memory = projectionsFor(
          await stores.memory.stateFor({ viewerId: viewer, now }), await stores.memory.stateFor({ viewerId: viewer, publicInstanceIds: [HUB, PLAZA], now }), viewer);
        const postgres = projectionsFor(
          await stores.postgres.stateFor({ viewerId: viewer, now }), await stores.postgres.stateFor({ viewerId: viewer, publicInstanceIds: [HUB, PLAZA], now }), viewer);
        expect(postgres, `the world as ${viewer} sees it`).toEqual(memory);
      }
      const dee = await stores.postgres.stateFor({ viewerId: 'dee', publicInstanceIds: [HUB], now });
      expect(projectWonderlandRoster(dee, 'dee', HUB)).toMatchObject({ players: [{ playerId: 'ben' }, { playerId: 'cal' }, { playerId: 'dee' }] });
      expect(projectWonderlandInstanceListing(dee, 'dee', [HUB])).toEqual([{ instanceId: HUB, population: 3 }]);
      expect(projectWonderlandPresenceOf(await stores.postgres.stateFor({ viewerId: 'ben', now }), 'ben', 'ann')).toEqual({ status: 'UNAVAILABLE' });
      const voice = ['ann', 'ben', 'cal', 'dee'];
      expect(Object.keys((await stores.postgres.voiceStateFor({ participantIds: voice, now })).presence).sort()).toEqual(['ben', 'cal', 'dee']);
      expect(wonderlandVoiceRouting(await stores.postgres.voiceStateFor({ participantIds: voice, now }), voice))
        .toEqual(wonderlandVoiceRouting(await stores.memory.voiceStateFor({ participantIds: voice, now }), voice));
      // Read back from PostgreSQL itself: Ann's row is still there (expiry deletes nothing), and no meeting with her was recorded.
      const rows = await pool.query<{ player_id: string }>('SELECT player_id FROM relay_wonderland.social_presence ORDER BY player_id');
      expect(rows.rows.map((row) => row.player_id)).toEqual(['ann', 'ben', 'cal', 'dee']);
      const met = await pool.query<{ pair: string }>("SELECT player_id || '>' || other_id AS pair FROM relay_wonderland.social_encounters WHERE 'dee' IN (player_id, other_id) ORDER BY 1");
      expect(met.rows.map((row) => row.pair)).toEqual(['ben>dee', 'cal>dee', 'dee>ben', 'dee>cal']);
    });

    it('a command id is one write: a replay returns its first outcome, and another actor cannot reuse it', async () => {
      const pool = await create('idem', WONDERLAND_MIGRATIONS);
      const store = new WonderlandSocialPostgresStore(pool);
      await store.upsertProfile({ playerId: 'ann', displayName: 'Ann' });
      await store.upsertProfile({ playerId: 'ben', displayName: 'Ben' });
      const first = await store.execute({ actorId: 'ann', commandId: 'c-1', command: { kind: 'FRIEND_REQUEST', toId: 'ben' }, at: '2026-10-04T12:00:00.000Z' });
      expect(first).toEqual({ ok: true, code: 'DONE' });
      expect(await store.execute({ actorId: 'ann', commandId: 'c-1', command: { kind: 'FRIEND_REQUEST', toId: 'ben' }, at: '2026-10-04T12:00:01.000Z' })).toEqual(first);
      expect(await store.execute({ actorId: 'ben', commandId: 'c-1', command: { kind: 'BLOCK', targetId: 'ann' }, at: '2026-10-04T12:00:02.000Z' })).toEqual({ ok: false, code: 'ID_TAKEN' });
      expect((await pool.query('SELECT 1 FROM relay_wonderland.social_blocks')).rowCount, 'the reused id wrote nothing').toBe(0);
    });

    it('a racing "leader kicks the member" and "member blocks the leader" serialize: never an error, never a broken party', async () => {
      const pool = await create('race', WONDERLAND_MIGRATIONS);
      const store = new WonderlandSocialPostgresStore(pool);
      for (const player of ['lea', 'mo', 'ned']) await store.upsertProfile({ playerId: player, displayName: player });
      for (let round = 0; round < 10; round += 1) {
        const partyId = `race-${String(round)}`;
        const t = `2026-10-04T13:${String(round).padStart(2, '0')}:00.000Z`;
        await store.execute({ actorId: 'lea', commandId: `${partyId}-create`, command: { kind: 'PARTY_CREATE', partyId }, at: t });
        for (const member of ['mo', 'ned']) {
          await store.execute({ actorId: 'lea', commandId: `${partyId}-invite-${member}`, command: { kind: 'PARTY_INVITE', inviteeId: member }, at: t });
          await store.execute({ actorId: member, commandId: `${partyId}-join-${member}`, command: { kind: 'PARTY_JOIN', partyId }, at: t });
        }
        const [kick, blocked] = await Promise.all([
          store.execute({ actorId: 'lea', commandId: `${partyId}-kick`, command: { kind: 'PARTY_KICK', memberId: 'mo' }, at: t }),
          store.execute({ actorId: 'mo', commandId: `${partyId}-block`, command: { kind: 'BLOCK', targetId: 'lea' }, at: t }),
        ]);
        expect(kick.ok && blocked.ok).toBe(true);
        const members = await pool.query<{ player_id: string }>('SELECT player_id FROM relay_wonderland.social_party_members WHERE party_id=$1 ORDER BY join_order', [partyId]);
        expect(members.rows.map((row) => row.player_id)).toEqual(['lea', 'ned']);
        expect((await pool.query("SELECT 1 FROM relay_wonderland.social_parties WHERE party_id=$1 AND leader_id='lea'", [partyId])).rowCount).toBe(1);
        // Reset for the next round: the block is lifted, and the parties are left behind.
        await store.execute({ actorId: 'mo', commandId: `${partyId}-unblock`, command: { kind: 'UNBLOCK', targetId: 'lea' }, at: t });
        await store.execute({ actorId: 'lea', commandId: `${partyId}-leave`, command: { kind: 'PARTY_LEAVE' }, at: t });
        await store.execute({ actorId: 'ned', commandId: `${partyId}-leave-ned`, command: { kind: 'PARTY_LEAVE' }, at: t });
      }
    }, 60_000);
  });
});
