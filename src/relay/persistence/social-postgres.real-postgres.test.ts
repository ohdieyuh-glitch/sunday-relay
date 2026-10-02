import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleSocialRoute, type SocialRouteDeps, type SocialSessionFacts } from '../../../relay-bridge/wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY } from '../../../relay-bridge/wonderland-social-scope';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { openSocialPostgresStore } from './social-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';
import type { SocialStore } from '../social/social-store';

/**
 * WONDERLAND SOCIAL ON REAL POSTGRESQL, ACROSS A RESTART.
 *
 * Two players run the launch loop through the REAL routes against the durable store: a friend request and its
 * acceptance, presence, a message and its read position, a party with an invitation accepted, a mute. Then the store is
 * thrown away and opened again from the database -- a backend restart -- and everything a player relies on must come
 * back: friends, messages, unread and read positions, the party and its membership, the chosen status (OFFLINE until the
 * client reports again), privacy, the events a client missed, and the id sequence (a new id after the restart never
 * collides with one before it). Then a block, and the blocked player is never told.
 *
 * Runs only where JULIUS_TEST_DATABASE_URL names a THROWAWAY database (fresh: the social tables are global); `todo`
 * elsewhere. 030 is applied after the chain's own migrations, as it will be once it is registered.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;

suite('Wonderland social on real PostgreSQL, across a restart', () => {
  const nonce = randomBytes(5).toString('hex');
  const KAI = `usr_kai_${nonce}`;
  const NOVA = `usr_nova_${nonce}`;
  const VEGA = `usr_vega_${nonce}`;
  const SESSIONS: Record<string, SocialSessionFacts> = {
    kai: { sessionId: 's1', participantId: KAI, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
    nova: { sessionId: 's2', participantId: NOVA, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
    vega: { sessionId: 's3', participantId: VEGA, capabilities: [NATIVE_SOCIAL_CAPABILITY] },
  };
  let pool: Pool;
  let store: SocialStore;
  let clock = Date.parse('2026-10-02T15:00:00.000Z');

  const call = async (who: string, method: string, path: string, body: unknown = null) => {
    clock += 1000;
    const deps: SocialRouteDeps = {
      verifySession: (token) => SESSIONS[token] ?? null,
      identify: async (id) => ({ userId: id, displayName: id.split('_')[1].replace(/^./, (c) => c.toUpperCase()), handle: `@${id}` }),
      store,
    };
    const result = await handleSocialRoute({ method, path: `/wonderland/social${path}`, authorization: `Relay-Session ${who}`, origin: undefined, body, now: clock }, deps);
    return result as { status: number; body: { data?: any; error?: { kind: string; message: string } } };
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    const applied = await pool.query(`SELECT 1 FROM relay_wonderland.schema_migrations WHERE version='030_wonderland_social'`);
    if (applied.rowCount === 0) {
      await pool.query(readFileSync(join(__dirname, '..', 'social', 'persistence', '030_wonderland_social.sql'), 'utf8'));
    }
    for (const id of [KAI, NOVA, VEGA]) await pool.query(`INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING`, [id]);
    store = await openSocialPostgresStore(pool);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('the loop, written through, comes back whole after a restart', async () => {
    // the loop
    await call('kai', 'GET', '/snapshot');
    await call('nova', 'GET', '/snapshot');
    expect((await call('kai', 'POST', '/requests', { toUserId: NOVA })).status).toBe(200);
    const requestId = (await call('nova', 'GET', '/snapshot')).body.data.requests.incoming[0].requestId;
    expect((await call('nova', 'POST', `/requests/${requestId}/accept`)).status).toBe(200);
    expect((await call('kai', 'POST', '/presence', { connected: true, availability: 'BUSY', signals: { juliusWorking: true } })).status).toBe(200);
    const conversationId = (await call('kai', 'POST', '/conversations', { otherUserId: NOVA })).body.data.conversationId;
    expect((await call('kai', 'POST', `/conversations/${conversationId}/messages`, { body: 'first' })).status).toBe(200);
    expect((await call('kai', 'POST', `/conversations/${conversationId}/messages`, { body: 'second' })).status).toBe(200);
    expect((await call('nova', 'POST', `/conversations/${conversationId}/read`, { sequence: 1 })).status).toBe(200);
    const partyId = (await call('kai', 'POST', '/parties', { name: 'Lab Crew' })).body.data.partyId;
    expect((await call('kai', 'POST', `/parties/${partyId}/invites`, { toUserId: NOVA })).status).toBe(200);
    const inviteId = (await call('nova', 'GET', '/snapshot')).body.data.partyInvites[0].inviteId;
    expect((await call('nova', 'POST', `/party-invites/${inviteId}/accept`)).status).toBe(200);
    expect((await call('nova', 'POST', '/privacy', { messagePolicy: 'EVERYONE' })).status).toBe(200);
    expect((await call('kai', 'POST', '/mutes', { targetId: NOVA, voice: true, messages: false })).status).toBe(200);
    const novaEventsBefore = (await call('nova', 'GET', '/events')).body.data;
    expect(novaEventsBefore.events.length).toBeGreaterThan(0);

    // THE RESTART: a new store, read back from the database alone
    store = await openSocialPostgresStore(pool);

    const kai = (await call('kai', 'GET', '/snapshot')).body.data;
    const nova = (await call('nova', 'GET', '/snapshot')).body.data;
    expect(kai.friends.map((f: any) => f.userId)).toEqual([NOVA]);
    expect(nova.friends.map((f: any) => f.userId)).toEqual([KAI]);
    // the chosen status survives; "connected" does not -- OFFLINE until the client reports again
    expect(nova.friends[0].presence.onlineState).toBe('OFFLINE');
    expect((await store.read()).users[KAI].presence.availability).toBe('BUSY');
    // messages, in order, with Nova's read position (1 of 2 read: 1 unread)
    expect(nova.messages[conversationId].map((m: any) => m.body)).toEqual(['first', 'second']);
    expect(nova.conversations.find((c: any) => c.conversationId === conversationId).unread).toBe(1);
    // the party and its membership, from both sides
    expect(kai.party.members.map((m: any) => m.userId).sort()).toEqual([KAI, NOVA].sort());
    expect(nova.party.partyId).toBe(partyId);
    expect(kai.party.viewerIsLeader).toBe(true);
    // privacy and the mute
    expect((await store.read()).users[NOVA].privacy.messagePolicy).toBe('EVERYONE');
    expect((await store.read()).mutes).toEqual([{ muterId: KAI, mutedId: NOVA, voice: true, messages: false }]);
    // the events a client missed are still there to poll
    const novaEventsAfter = (await call('nova', 'GET', '/events')).body.data;
    expect(novaEventsAfter.events.map((e: any) => e.seq)).toEqual(novaEventsBefore.events.map((e: any) => e.seq));
    // the id sequence continues: a new request after the restart takes a new id
    await call('vega', 'GET', '/snapshot');
    expect((await call('vega', 'POST', '/requests', { toUserId: KAI })).status).toBe(200);
    const ids = (await store.read()).requests.map((r) => r.requestId);
    expect(new Set(ids).size).toBe(ids.length);

    // A BLOCK, durable, and never told to the blocked player
    const kaiLatest = (await call('kai', 'GET', '/events')).body.data.latest;
    expect((await call('nova', 'POST', '/blocks', { targetId: KAI })).status).toBe(200);
    expect((await call('kai', 'GET', `/events?after=${kaiLatest}`)).body.data.events).toEqual([]);
    store = await openSocialPostgresStore(pool);
    const kaiAfterBlock = (await call('kai', 'GET', '/snapshot')).body.data;
    expect(kaiAfterBlock.friends).toEqual([]);
    expect(kaiAfterBlock.profiles[NOVA]).toBeUndefined();
    expect((await call('kai', 'POST', `/conversations/${conversationId}/messages`, { body: 'hello?' })).status).not.toBe(200);
  }, 60_000);
});
