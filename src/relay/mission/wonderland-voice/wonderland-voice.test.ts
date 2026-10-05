import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createMemoryWonderlandSocialStore, isWonderlandVisibleTo, type WonderlandSocialState } from '../wonderland-social';
import {
  WONDERLAND_EOS_CLAIM_REFUSALS,
  checkWonderlandEosIdTokenClaims,
  createMemoryWonderlandVoiceIdentityStore,
  diffWonderlandVoicePlans,
  isWonderlandMutuallyVisible,
  planWonderlandVoiceRooms,
  type WonderlandVoicePlan,
} from './index';

/**
 * WONDERLAND VOICE, HELD TO THE WALL.
 *
 * The room planner is checked as a PROPERTY over hundreds of seeded random
 * worlds — hidden players, friendships, blocks, parties — because the three
 * invariants must hold for every social graph, not for the four a person
 * thought to write down:
 *   (a) every room is a clique of mutual visibility (a room discloses its members);
 *   (b) every mutually visible pair shares exactly one room (heard, and once);
 *   (c) a pair that is not mutually visible shares no room;
 *   (d) a player's rooms never depend on anyone that player cannot see.
 */

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const at = '2026-10-04T12:00:00.000Z';

/** A small seeded PRNG, so a failing world can be replayed from its seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; s ^= s >>> 13; return (s >>> 0) / 4294967296; };
}

async function randomWorld(seed: number, size: number): Promise<{ state: WonderlandSocialState; players: string[] }> {
  const random = rng(seed);
  const store = createMemoryWonderlandSocialStore();
  const players = Array.from({ length: size }, (_, i) => `p${String(i)}`);
  let n = 0;
  const run = (actorId: string, command: Parameters<typeof store.execute>[0]['command']) => store.execute({ actorId, commandId: `c${String(n++)}`, command, at });
  for (const player of players) await store.upsertProfile({ playerId: player, displayName: player });
  for (const player of players) if (random() < 0.3) await run(player, { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } });
  for (const a of players) for (const b of players) {
    if (a >= b) continue;
    const roll = random();
    if (roll < 0.2) { await run(a, { kind: 'FRIEND_REQUEST', toId: b }); await run(b, { kind: 'FRIEND_ACCEPT', fromId: a }); }
    else if (roll < 0.3) await run(a, { kind: 'BLOCK', targetId: b });
  }
  if (random() < 0.5 && size >= 3) {
    const leader = players[Math.floor(random() * size)]!;
    await run(leader, { kind: 'PARTY_CREATE', partyId: `party-${String(seed)}` });
    for (const member of players) {
      if (member === leader || random() < 0.5) continue;
      await run(leader, { kind: 'PARTY_INVITE', inviteeId: member });
      await run(member, { kind: 'PARTY_JOIN', partyId: `party-${String(seed)}` });
    }
  }
  return { state: store.snapshot(), players };
}

function assertWall(state: WonderlandSocialState, players: readonly string[], plan: WonderlandVoicePlan, seed: number): void {
  const shared = new Map<string, number>();
  for (const room of plan.rooms) {
    for (let i = 0; i < room.memberIds.length; i += 1) {
      for (let j = i + 1; j < room.memberIds.length; j += 1) {
        const a = room.memberIds[i]!; const b = room.memberIds[j]!;
        expect(isWonderlandMutuallyVisible(state, a, b), `seed ${String(seed)}: room ${room.roomId} pairs ${a} and ${b}, who are not mutually visible (a)`).toBe(true);
        shared.set(`${a}|${b}`, (shared.get(`${a}|${b}`) ?? 0) + 1);
      }
    }
  }
  const sorted = [...players].sort();
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i]!; const b = sorted[j]!;
      const count = shared.get(`${a}|${b}`) ?? 0;
      if (isWonderlandMutuallyVisible(state, a, b)) expect(count, `seed ${String(seed)}: ${a} and ${b} share ${String(count)} rooms (b)`).toBe(1);
      else expect(count, `seed ${String(seed)}: ${a} and ${b} are not mutually visible and share a room (c)`).toBe(0);
    }
  }
  for (const player of players) {
    const expected = plan.rooms.filter((room) => room.memberIds.includes(player)).map((room) => room.roomId).sort();
    expect(plan.joins[player]).toEqual(expected);
  }
}

describe('the room plan keeps the wall, over random worlds', () => {
  it('300 seeded worlds of 2 to 9 players: every invariant, every time', async () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const size = 2 + (seed % 8);
      const { state, players } = await randomWorld(seed, size);
      const plan = planWonderlandVoiceRooms(state, { kind: 'INSTANCE', scopeId: 'public:hub', participantIds: players }, sha);
      assertWall(state, players, plan, seed);
      // Deterministic: the same world plans the same rooms, whatever order the participants arrive in.
      expect(planWonderlandVoiceRooms(state, { kind: 'INSTANCE', scopeId: 'public:hub', participantIds: [...players].reverse() }, sha)).toEqual(plan);
    }
  }, 60_000);
});

/** A player's own view of a plan: the rooms they hold, by id and members. Nothing else reaches their client. */
const roomsOf = (plan: WonderlandVoicePlan, viewer: string): string[] =>
  plan.rooms.filter((room) => room.memberIds.includes(viewer)).map((room) => `${room.roomId}:${room.memberIds.join(',')}`).sort();

describe('the room plan discloses nothing a player cannot see (P1, no inference)', () => {
  it('300 seeded worlds: a player\'s rooms are the same whether or not anyone they cannot see is in the channel', async () => {
    const channel = (participantIds: readonly string[]) => ({ kind: 'INSTANCE' as const, scopeId: 'public:hub', participantIds });
    for (let seed = 1; seed <= 300; seed += 1) {
      const size = 2 + (seed % 8);
      const { state, players } = await randomWorld(seed, size);
      const full = planWonderlandVoiceRooms(state, channel(players), sha);
      for (const viewer of players) {
        const unseen = players.filter((other) => other !== viewer && !isWonderlandVisibleTo(state, viewer, other));
        if (unseen.length === 0) continue;
        const withoutAll = planWonderlandVoiceRooms(state, channel(players.filter((player) => !unseen.includes(player))), sha);
        expect(roomsOf(full, viewer), `seed ${String(seed)}: ${viewer}'s rooms change with players they cannot see (${unseen.join(', ')})`)
          .toEqual(roomsOf(withoutAll, viewer));
        for (const one of unseen) {
          const withoutOne = planWonderlandVoiceRooms(state, channel(players.filter((player) => player !== one)), sha);
          expect(roomsOf(full, viewer), `seed ${String(seed)}: ${viewer}'s rooms change with ${one}, whom they cannot see`).toEqual(roomsOf(withoutOne, viewer));
        }
      }
    }
  }, 60_000);

  it('a hidden player\'s arrival does not split a stranger\'s room (the review\'s case)', async () => {
    const { store, run } = await named(['amy', 'ben', 'cat', 'dan']);
    await run('ben', { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } });
    for (const friend of ['amy', 'cat']) { await run('ben', { kind: 'FRIEND_REQUEST', toId: friend }); await run(friend, { kind: 'FRIEND_ACCEPT', fromId: 'ben' }); }
    const plan = (ids: string[]) => planWonderlandVoiceRooms(store.snapshot(), { kind: 'INSTANCE', scopeId: 'public:hub', participantIds: ids }, sha);
    expect(roomsOf(plan(['amy', 'ben', 'cat', 'dan']), 'dan')).toEqual(roomsOf(plan(['amy', 'cat', 'dan']), 'dan'));
  });

  it('a player\'s rooms do not change when someone they blocked arrives (the review\'s case)', async () => {
    const { store, run } = await named(['amy', 'bob', 'xan', 'yul']);
    await run('bob', { kind: 'BLOCK', targetId: 'amy' });
    const plan = (ids: string[]) => planWonderlandVoiceRooms(store.snapshot(), { kind: 'INSTANCE', scopeId: 'public:hub', participantIds: ids }, sha);
    expect(roomsOf(plan(['amy', 'bob', 'xan', 'yul']), 'bob')).toEqual(roomsOf(plan(['bob', 'xan', 'yul']), 'bob'));
    expect(roomsOf(plan(['amy', 'bob', 'xan', 'yul']), 'amy'), 'nor the blocked player\'s, when the blocker arrives')
      .toEqual(roomsOf(plan(['amy', 'xan', 'yul']), 'amy'));
  });
});

async function named(names: readonly string[]) {
  const store = createMemoryWonderlandSocialStore();
  for (const name of names) await store.upsertProfile({ playerId: name, displayName: name });
  let n = 0;
  const run = (actorId: string, command: Parameters<typeof store.execute>[0]['command']) => store.execute({ actorId, commandId: `c${String(n++)}`, command, at });
  return { store, run };
}

describe('the cases a person would ask about', () => {
  it('when everyone may see everyone, every pair has its own room, and each player hears every other once', async () => {
    const { store } = await named(['ann', 'ben', 'cal', 'dee']);
    const plan = planWonderlandVoiceRooms(store.snapshot(), { kind: 'INSTANCE', scopeId: 'public:hub', participantIds: ['ann', 'ben', 'cal', 'dee'] }, sha);
    expect(plan.rooms.map((room) => room.memberIds)).toEqual([
      ['ann', 'ben'], ['ann', 'cal'], ['ann', 'dee'], ['ben', 'cal'], ['ben', 'dee'], ['cal', 'dee'],
    ]);
    for (const player of ['ann', 'ben', 'cal', 'dee']) expect(plan.joins[player], `${player} holds one room per channel mate`).toHaveLength(3);
  });

  it('a hidden player shares a room with her friend and with nobody else; the strangers keep theirs', async () => {
    const { store, run } = await named(['hana', 'fay', 'sam', 'tom']);
    await run('hana', { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } });
    await run('hana', { kind: 'FRIEND_REQUEST', toId: 'fay' }); await run('fay', { kind: 'FRIEND_ACCEPT', fromId: 'hana' });
    const plan = planWonderlandVoiceRooms(store.snapshot(), { kind: 'INSTANCE', scopeId: 'public:hub', participantIds: ['hana', 'fay', 'sam', 'tom'] }, sha);
    expect(plan.rooms.map((room) => room.memberIds)).toEqual([['fay', 'hana'], ['fay', 'sam'], ['fay', 'tom'], ['sam', 'tom']]);
    expect(plan.joins.sam, 'Sam holds no room with Hana in it').not.toContain(plan.rooms[0]!.roomId);
    expect(plan.joins.hana, 'and Hana cannot hear the strangers either: she would be in their room').toEqual([plan.rooms[0]!.roomId]);
  });

  it('a blocked pair never shares a room, in an instance or anywhere', async () => {
    const { store, run } = await named(['ann', 'ben', 'cal']);
    await run('ann', { kind: 'BLOCK', targetId: 'ben' });
    const plan = planWonderlandVoiceRooms(store.snapshot(), { kind: 'INSTANCE', scopeId: 'public:hub', participantIds: ['ann', 'ben', 'cal'] }, sha);
    for (const room of plan.rooms) expect(room.memberIds.includes('ann') && room.memberIds.includes('ben')).toBe(false);
    expect(plan.rooms.map((room) => room.memberIds)).toEqual([['ann', 'cal'], ['ben', 'cal']]);
  });

  it('a party is a room per pair of party-mates: they see each other, and a block cannot share a party', async () => {
    const { store, run } = await named(['lea', 'hana', 'mo']);
    await run('hana', { kind: 'SET_SETTINGS', settings: { visibility: 'HIDDEN_FROM_STRANGERS' } });
    await run('lea', { kind: 'PARTY_CREATE', partyId: 'party-1' });
    for (const member of ['hana', 'mo']) { await run('lea', { kind: 'PARTY_INVITE', inviteeId: member }); await run(member, { kind: 'PARTY_JOIN', partyId: 'party-1' }); }
    const plan = planWonderlandVoiceRooms(store.snapshot(), { kind: 'PARTY', scopeId: 'party-1', participantIds: ['lea', 'hana', 'mo'] }, sha);
    expect(plan.rooms.map((room) => room.memberIds)).toEqual([['hana', 'lea'], ['hana', 'mo'], ['lea', 'mo']]);
  });

  it('room names are opaque: no player id, no scope, in any room name', async () => {
    const { store } = await named(['ann', 'ben']);
    const plan = planWonderlandVoiceRooms(store.snapshot(), { kind: 'INSTANCE', scopeId: 'public:hub', participantIds: ['ann', 'ben'] }, sha);
    for (const room of plan.rooms) {
      expect(room.roomId).toMatch(/^wl_[0-9a-f]{32}$/u);
      expect(room.roomId).not.toMatch(/ann|ben|hub/u);
    }
  });

  it('a block ends exactly the blocked pair\'s room, and the diff names both memberships the trusted server must revoke', async () => {
    const { store, run } = await named(['ann', 'ben', 'cal']);
    const channel = { kind: 'INSTANCE' as const, scopeId: 'public:hub', participantIds: ['ann', 'ben', 'cal'] };
    const before = planWonderlandVoiceRooms(store.snapshot(), channel, sha);
    await run('ann', { kind: 'BLOCK', targetId: 'ben' });
    const after = planWonderlandVoiceRooms(store.snapshot(), channel, sha);
    const diff = diffWonderlandVoicePlans(before, after);
    const pair = before.rooms.find((room) => room.memberIds.join() === 'ann,ben')!.roomId;
    expect(diff.removals).toEqual(['ann', 'ben'].map((playerId) => ({ roomId: pair, playerId })));
    expect(diff.additions, 'nobody else\'s room changes: Cal keeps both of his').toEqual([]);
  });
});

describe('EOS identity claims', () => {
  const expectation = {
    issuers: ['https://api.epicgames.dev/auth/v1/oauth'], productId: 'prod-1', sandboxId: 'sbx-1', deploymentId: 'dep-1', clientId: 'client-1',
  };
  const now = 1_790_000_000;
  const good = {
    iss: 'https://api.epicgames.dev/auth/v1/oauth', sub: 'a'.repeat(32), pfpid: 'prod-1', pfsid: 'sbx-1', pfdid: 'dep-1',
    aud: 'client-1', exp: now + 600, iat: now - 10,
  };
  const check = (payload: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }) =>
    checkWonderlandEosIdTokenClaims({ header, payload, expect: expectation, nowSeconds: now });

  it('binds a token of ours to its PUID', () => {
    expect(check(good)).toEqual({ ok: true, productUserId: 'a'.repeat(32), expiresAt: now + 600 });
    expect(check({ ...good, aud: undefined, appid: 'client-1' }).ok, 'the client id may arrive as appid').toBe(true);
  });

  it.each([
    ['header_alg_not_rs256', good, { alg: 'none' }],
    ['header_alg_not_rs256', good, { alg: 'HS256' }],
    ['issuer_not_allowed', { ...good, iss: 'https://evil.example' }, undefined],
    ['subject_not_a_puid', { ...good, sub: 'not-a-puid' }, undefined],
    ['deployment_mismatch', { ...good, pfdid: 'dep-other' }, undefined],
    ['sandbox_mismatch', { ...good, pfsid: 'sbx-other' }, undefined],
    ['product_mismatch', { ...good, pfpid: 'prod-other' }, undefined],
    ['client_mismatch', { ...good, aud: 'client-other' }, undefined],
    ['expired', { ...good, exp: now }, undefined],
    ['issued_in_future', { ...good, iat: now + 120 }, undefined],
    ['claims_malformed', { ...good, exp: 'soon' }, undefined],
  ] as const)('refuses %s', (reason, payload, header) => {
    expect(check(payload as Record<string, unknown>, header)).toEqual({ ok: false, reason });
  });

  it('every refusal code is reachable above', () => {
    expect([...WONDERLAND_EOS_CLAIM_REFUSALS].sort()).toEqual([
      'claims_malformed', 'client_mismatch', 'deployment_mismatch', 'expired', 'header_alg_not_rs256', 'issued_in_future',
      'issuer_not_allowed', 'product_mismatch', 'sandbox_mismatch', 'subject_not_a_puid',
    ]);
  });
});

describe('one player, one PUID', () => {
  it('binds, re-binds to a new PUID, and refuses a PUID that belongs to another player', async () => {
    const store = createMemoryWonderlandVoiceIdentityStore();
    const p1 = '1'.repeat(32); const p2 = '2'.repeat(32);
    expect(await store.bind({ playerId: 'ann', productUserId: p1, at })).toEqual({ outcome: 'BIND', previousProductUserId: null });
    expect(await store.bind({ playerId: 'ann', productUserId: p1, at })).toEqual({ outcome: 'UNCHANGED', previousProductUserId: p1 });
    expect(await store.bind({ playerId: 'ben', productUserId: p1, at })).toEqual({ outcome: 'REFUSED', reason: 'puid_bound_to_another_player' });
    expect(await store.bind({ playerId: 'ann', productUserId: p2, at })).toEqual({ outcome: 'REBIND', previousProductUserId: p1 });
    expect(await store.bind({ playerId: 'ben', productUserId: p1, at }), 'a released PUID can be bound by its new owner').toEqual({ outcome: 'BIND', previousProductUserId: null });
    expect(await store.productUserIdsOf(['ann', 'ben', 'cal'])).toEqual({ ann: p2, ben: p1 });
    await expect(store.bind({ playerId: 'cal', productUserId: 'NOT-HEX', at })).rejects.toThrow('wonderland_voice_puid_invalid');
  });
});
