import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMemoryWonderlandSocialStore } from '../src/relay/mission/wonderland-social';
import type { WonderlandVoiceIdentityStore } from '../src/relay/mission/wonderland-voice';
import { juliusTestDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { WONDERLAND_MIGRATIONS } from '../src/relay/persistence/wonderland-postgres';
import { WonderlandVoicePostgresStore } from '../src/relay/persistence/wonderland-voice-postgres';
import { createBrowserSessionStore } from './browser-session/grants';
import { WONDERLAND_EOS_ENV, readWonderlandEosClientConfig } from './wonderland-voice/eos';
import { handleWonderlandSocialRoute } from './wonderland-social-routes';
import {
  handleWonderlandVoiceRoute,
  reconcileWonderlandVoiceAfterCommand,
  settleWonderlandVoice,
  wonderlandVoiceAffected,
  type WonderlandVoiceRoutePorts,
} from './wonderland-voice-routes';

/**
 * ONE PLAYER'S VOICE, ONE STEP AT A TIME, ACROSS TWO BRIDGE PROCESSES.
 *
 * The routes order one player's voice steps inside a process. Two processes on
 * one database (a deploy's overlap, a second replica) each had their own order,
 * and the race that order closed came back between them: a join that had
 * planned before a block issued the blocked pair's room after the block's
 * reconcile had already run. Here each "process" is its own set of ports: its
 * own voice store, on its own pool, with its own lock pool, so nothing in this
 * test process orders them; only the database's lock can. They share what two
 * bridges share: the database, the social state and Epic's trusted server.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database; `todo`
 * everywhere else, so an absent database is a skipped proof, never a passing one.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;
const MIGRATION_035 = readFileSync(join(__dirname, '..', 'docs', 'julius-migrations', '035', '035_wonderland_voice.sql'), 'utf8')
  .replace(/^\\set ON_ERROR_STOP on\s*$/mu, '');
const PLACEHOLDER_034 = "INSERT INTO relay_wonderland.schema_migrations(version) VALUES('034_test_placeholder_not_a_migration')";
const ORIGIN = 'https://wonderland.example';
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
const AT = new Date(NOW).toISOString();
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const PUID = (c: string): string => c.repeat(32);
const ENV = {
  [WONDERLAND_EOS_ENV.productId]: 'prod-1', [WONDERLAND_EOS_ENV.sandboxId]: 'sbx-1', [WONDERLAND_EOS_ENV.deploymentId]: 'dep-1',
  [WONDERLAND_EOS_ENV.clientId]: 'client-1', [WONDERLAND_EOS_ENV.clientSecret]: 'game-client-secret',
};
const ENTER = { kind: 'ENTER_INSTANCE', instanceId: 'public:hub', location: null, activity: 'IDLE', dogId: null } as const;

function gate() {
  let release!: () => void;
  let reach!: () => void;
  const open = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { reach = resolve; });
  return { open, reached, release, reach };
}

/** Epic's trusted server, one for both processes: who each room admits now. */
function fakeEpic() {
  const members = new Map<string, Set<string>>();
  return {
    members,
    port: {
      async roomToken({ roomId, productUserId }: { roomId: string; productUserId: string }) {
        if (!members.has(roomId)) members.set(roomId, new Set());
        members.get(roomId)!.add(productUserId);
        return { token: `token:${roomId}:${productUserId}`, clientBaseUrl: 'https://rtc.example' };
      },
      async removeParticipant({ roomId, productUserId }: { roomId: string; productUserId: string }) {
        members.get(roomId)?.delete(productUserId);
      },
    },
  };
}

/** One process's identity store, with its read of open issuances held on request: to stop a join after it planned. */
function holdable(inner: WonderlandVoiceIdentityStore) {
  let hold: ReturnType<typeof gate> | null = null;
  const store: WonderlandVoiceIdentityStore = {
    bind: (input) => inner.bind(input),
    productUserIdOf: (playerId) => inner.productUserIdOf(playerId),
    productUserIdsOf: (playerIds) => inner.productUserIdsOf(playerIds),
    recordIssuance: (input) => inner.recordIssuance(input),
    openRoomsOf: (playerId) => inner.openRoomsOf(playerId),
    async openIssuancesOf(playerId) {
      if (hold !== null) {
        const held = hold;
        hold = null;
        held.reach();
        await held.open;
      }
      return inner.openIssuancesOf(playerId);
    },
    recordRevocation: (input) => inner.recordRevocation(input),
    ...(inner.withPlayerVoiceLock === undefined ? {} : { withPlayerVoiceLock: (playerId, step) => inner.withPlayerVoiceLock!(playerId, step) }),
  };
  return { store, hold() { const g = gate(); hold = g; return g; } };
}

suite('Wonderland voice across two bridge processes on one PostgreSQL', () => {
  const name = `wvoiceprocs${randomBytes(4).toString('hex')}`;
  let admin: Pool;
  let target = '';
  const pools: Pool[] = [];
  const open = (max: number): Pool => {
    const pool = new Pool({ connectionString: target, max });
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
    const setup = open(2);
    for (const sql of WONDERLAND_MIGRATIONS) await setup.query(sql);
    await setup.query(PLACEHOLDER_034);
    await setup.query(MIGRATION_035);
  }, 60_000);

  afterAll(async () => {
    for (const pool of pools) await pool.end().catch(() => undefined);
    await admin?.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
    await admin?.end();
  }, 60_000);

  it('a block one process commits inside the other process\'s join: once both settle, the blocked pair shares no room', async () => {
    const sessions = createBrowserSessionStore();
    const social = createMemoryWonderlandSocialStore();
    const epic = fakeEpic();
    const config = readWonderlandEosClientConfig(ENV);
    if (!config.ok) throw new Error('config');
    // Two processes: each its own store, pool and lock pool.
    const first = holdable(new WonderlandVoicePostgresStore(open(4), { locks: open(2) }));
    const second = new WonderlandVoicePostgresStore(open(4), { locks: open(2) });
    const process = (identities: WonderlandVoiceIdentityStore): WonderlandVoiceRoutePorts => ({
      sessions, allowNative: false, social, identities, eos: config, verifyIdToken: null, voice: epic.port, digest: sha,
    });
    const one = process(first.store);
    const two = process(second);

    const tokens = new Map<string, string>();
    for (const [player, puid] of [['amy', PUID('a')], ['xan', PUID('b')]] as const) {
      const minted = sessions.mintIdentitySession({ origin: ORIGIN, now: NOW, participantId: player, scope: 'browser_control' });
      if (!minted.ok) throw new Error('mint');
      tokens.set(player, minted.session.token);
      await social.upsertProfile({ playerId: player, displayName: player });
      expect((await second.bind({ playerId: player, productUserId: puid, at: AT })).outcome).toBe('BIND');
    }
    let n = 0;
    const command = (ports: WonderlandVoiceRoutePorts, player: string, body: unknown) => handleWonderlandSocialRoute({
      method: 'POST', path: '/wonderland/social/commands', url: '/wonderland/social/commands', origin: ORIGIN, now: NOW,
      authorization: `Relay-Session ${tokens.get(player)!}`, body: { commandId: `c-${String(++n)}`, command: body },
    }, {
      store: social, sessions, allowNative: false,
      afterCommand: async ({ actorId, command: done, before, after, at }) =>
        reconcileWonderlandVoiceAfterCommand(ports, actorId, wonderlandVoiceAffected(before, after, actorId, done), at, () => undefined),
    });
    const join = (ports: WonderlandVoiceRoutePorts, player: string) => handleWonderlandVoiceRoute({
      method: 'POST', path: '/wonderland/voice/join', origin: ORIGIN, body: { channel: 'INSTANCE' }, now: NOW,
      authorization: `Relay-Session ${tokens.get(player)!}`,
    }, ports);
    for (const player of ['amy', 'xan']) await command(one, player, ENTER);
    // Xan is already talking, through process two: the pair's room admits him.
    expect((await join(two, 'xan'))?.status).toBe(200);
    await Promise.all([settleWonderlandVoice(one), settleWonderlandVoice(two)]);
    expect([...epic.members.values()].some((admitted) => admitted.has(PUID('b'))), 'Xan is in the pair\'s room').toBe(true);

    // Process one's join has planned (Amy and Xan see each other) and is about to take back and issue.
    const planned = first.hold();
    const joining = join(one, 'amy');
    await planned.reached;
    // Process two commits Xan's block of Amy, answers it, and reconciles Amy. Unordered across processes, that
    // reconcile runs now, finds nothing to take back, and the join then issues from its older plan.
    const block = await command(two, 'xan', { kind: 'BLOCK', targetId: 'amy' });
    expect(block?.status).toBe(200);
    await new Promise<void>((resolve) => { setTimeout(resolve, 100); });
    planned.release();
    expect((await joining)?.status).toBe(200);
    await Promise.all([settleWonderlandVoice(one), settleWonderlandVoice(two)]);

    expect(await second.openIssuancesOf('amy'), 'nothing the block ended stays open on the record').toEqual([]);
    const shared = [...epic.members.values()].filter((admitted) => admitted.has(PUID('a')) && admitted.has(PUID('b')));
    expect(shared, 'Epic admits the blocked pair to no common room').toEqual([]);
    expect([...epic.members.values()].some((admitted) => admitted.has(PUID('a'))), 'Amy is in no room').toBe(false);
  }, 60_000);
});
