import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applySocialOperation } from '../src/relay/social/social-commands';
import { createInMemoryVoiceBindings, type VoiceBindingStore } from '../src/relay/social/voice-binding';
import { acceptPartyInvite, inviteToParty } from '../src/relay/social/social-parties';
import { createSocialFixture, FIXTURE_USERS as U } from '../src/relay/social/social-fixtures';
import { blockUser } from '../src/relay/social/social-friends';
import { partyOf, type SocialState } from '../src/relay/social/social-state';
import type { SocialStore } from '../src/relay/social/social-store';
import {
  handleSocialRoute,
  type PartyVoiceTokenMinter,
  type SocialDeliveryRecord,
  type SocialRouteDeps,
  type SocialSessionFacts,
} from './wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY } from './wonderland-social-scope';

/*
 * PARTY VOICE AND THE DELIVERY TAP, through the real route. The voice minter is a recorder: what matters is WHO the route
 * asks it to admit, and to which room. The tap must name recipients, sequences, operations and people -- never content.
 */

const T0 = Date.parse('2026-10-03T12:00:00.000Z');
const NOW = new Date(T0).toISOString();
/** A session token "usr_x" is player usr_x in session usr_x; "usr_x#2" is the same player in a NEW session (a fresh sign-in). */
const facts = (token: string): SocialSessionFacts => ({ sessionId: token, participantId: token.split('#')[0], capabilities: [NATIVE_SOCIAL_CAPABILITY], scope: 'native_social' });
/** A deterministic EOS ProductUserId per player (and per variant), made at run time. */
const puidOf = (who: string) => createHash('sha256').update(who).digest('hex').slice(0, 32);

/** Arena Run: ORION leads, LYRA joined, KAI invited in -- three members. */
function arena(): { state: SocialState; pid: string } {
  const s = createSocialFixture();
  const pid = partyOf(s, U.ORION)?.partyId as string;
  const invited = inviteToParty(s, U.ORION, pid, U.KAI, NOW);
  if (!invited.ok) throw new Error(invited.error.message);
  const joined = acceptPartyInvite(invited.value.state, U.KAI, invited.value.inviteId, NOW);
  if (!joined.ok) throw new Error(joined.error.message);
  return { state: joined.value, pid };
}

/** A store that serves one fixed state (the route only reads it for voice) and refuses to apply anything else. */
function fixedStore(state: SocialState): SocialStore {
  return {
    read: async () => state,
    ensureUser: async () => undefined,
    apply: async () => ({ ok: false, error: { code: 'invalid-command', message: 'fixed', retryable: false } as never }),
    eventsFor: async () => ({ events: [], latest: 0, reset: false }),
  };
}

function minterRecorder() {
  const asked: Array<{ partyId: string; participantId: string; audience: readonly string[]; puid?: string }> = [];
  const minter: PartyVoiceTokenMinter = {
    providerId: 'test-provider',
    mint: async (input) => {
      asked.push({ partyId: input.partyId, participantId: input.participantId, audience: [...input.audience].sort(), puid: input.puid });
      return { providerId: 'test-provider', roomId: `room-${input.partyId}`, participantToken: `token-for-${input.participantId}`, expiresAtIso: NOW };
    },
  };
  return { asked, minter };
}

const join = (deps: SocialRouteDeps, who: string, pid: string, puid: unknown = puidOf(who.split('#')[0])) =>
  handleSocialRoute({ method: 'POST', path: `/wonderland/social/parties/${pid}/voice/join`, authorization: `Relay-Session ${who}`, origin: undefined, body: { eosProductUserId: puid }, now: T0 }, deps) as
    Promise<{ status: number; body: { data?: any; error?: { kind: string; message: string } }; headers?: Readonly<Record<string, string>> }>;

const depsFor = (state: SocialState, voice: PartyVoiceTokenMinter | null, tap?: (r: SocialDeliveryRecord) => void, voiceBindings: VoiceBindingStore | null = createInMemoryVoiceBindings()): SocialRouteDeps => ({
  verifySession: (token) => facts(token),
  identify: async (id) => ({ userId: id, displayName: id, handle: `@${id}` }),
  store: fixedStore(state),
  voice,
  voiceBindings,
  tap,
});

describe('party voice: the provider seam', () => {
  it('with no provider (or no binding store) it is 503 VOICE TRANSPORT PENDING -- never a connected state', async () => {
    const { state, pid } = arena();
    const r = await join(depsFor(state, null), U.ORION, pid);
    expect(r.status).toBe(503);
    expect(r.body.error).toEqual({ kind: 'voice_unavailable', message: 'VOICE TRANSPORT PENDING' });
    expect((await join(depsFor(state, minterRecorder().minter, undefined, null), U.ORION, pid)).body.error?.message).toBe('VOICE TRANSPORT PENDING');
  });

  it('a member gets a token for their own party room, for the whole un-walled party, for their own bound PUID', async () => {
    const { state, pid } = arena();
    const { asked, minter } = minterRecorder();
    const r = await join(depsFor(state, minter), U.KAI, pid);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ providerId: 'test-provider', roomId: `room-${pid}`, participantToken: `token-for-${U.KAI}` });
    expect(asked).toEqual([{ partyId: pid, participantId: U.KAI, audience: [U.KAI, U.LYRA, U.ORION].sort(), puid: puidOf(U.KAI) }]);
  });

  it('a non-member is refused as if the party did not exist, and the provider is never asked', async () => {
    const { state, pid } = arena();
    const { asked, minter } = minterRecorder();
    expect((await join(depsFor(state, minter), U.NOVA, pid)).status).toBe(404);
    expect(asked).toEqual([]);
  });

  it('A BLOCKED PAIR SHARING THE PARTY (old data, a restore) never receive a token naming each other', async () => {
    const { state, pid } = arena();
    const blocked = blockUser(state, U.LYRA, U.ORION, NOW);
    if (!blocked.ok) throw new Error(blocked.error.message);
    const { asked, minter } = minterRecorder();
    const deps = depsFor(blocked.value, minter);
    expect((await join(deps, U.ORION, pid)).status).toBe(200);
    expect((await join(deps, U.LYRA, pid)).status).toBe(200);
    expect((await join(deps, U.KAI, pid)).status).toBe(200);
    const audienceOf = (who: string) => asked.find((a) => a.participantId === who)?.audience;
    expect(audienceOf(U.ORION)).toEqual([U.KAI, U.ORION].sort());
    expect(audienceOf(U.LYRA)).toEqual([U.KAI, U.LYRA].sort());
    // the third member keeps the permitted view of both
    expect(audienceOf(U.KAI)).toEqual([U.KAI, U.LYRA, U.ORION].sort());
  });

  it("a party id naming something Object.prototype holds is the stranger's 404 with no-store, never a thrown 500 (review a6d5842c, m4)", async () => {
    const { state, pid } = arena();
    const { asked, minter } = minterRecorder();
    const deps = depsFor(state, minter);
    const missing = await join(deps, U.ORION, 'pty_does_not_exist');
    expect(missing.status).toBe(404);
    for (const id of ['constructor', '__proto__', 'hasOwnProperty', 'toString', 'valueOf']) {
      const r = await join(deps, U.ORION, id);
      expect(r.status, id).toBe(404);
      expect(r.body, id).toEqual(missing.body);
      expect(r.headers?.['cache-control'], id).toBe('no-store');
    }
    expect(asked).toEqual([]);
    expect((await join(deps, U.ORION, pid)).status).toBe(200); // the control: the real party id admits its member
  });

  it('a provider failure is 503, not a token', async () => {
    const { state, pid } = arena();
    const failing: PartyVoiceTokenMinter = { providerId: 'x', mint: async () => { throw new Error('provider down'); } };
    const r = await join(depsFor(state, failing), U.ORION, pid);
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain('provider down');
  });
});

describe('party voice: EOS PUID binding and the uniform 404 (R16 EOS voice backend)', () => {
  it("the first join binds; another player's PUID, a walled caller and a non-member all answer exactly as a party that does not exist", async () => {
    const { state, pid } = arena();
    const { asked, minter } = minterRecorder();
    const deps = depsFor(state, minter);
    expect((await join(deps, U.KAI, pid)).status).toBe(200); // Kai binds his PUID
    const missing = await join(deps, U.ORION, 'pty_does_not_exist');
    const nonMember = await join(deps, U.NOVA, pid);
    const stolen = await join(deps, U.LYRA, pid, puidOf(U.KAI)); // Lyra presents Kai's PUID
    // Orion (leader) blocks Lyra: F1 removes her -- she is walled out of the party
    const removed = applySocialOperation(state, 'blocks.add', U.ORION, { ids: [], body: { targetId: U.LYRA, confirmSharedParty: true }, query: {} }, NOW);
    if (!removed.ok) throw new Error(removed.error.message);
    const walled = await join({ ...deps, store: fixedStore(removed.value.state) }, U.LYRA, pid);
    for (const r of [nonMember, stolen, walled]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual(missing.body);
    }
    expect(asked.map((a) => a.participantId)).toEqual([U.KAI]); // nobody refused ever reached the provider
  });

  it("a player's own DIFFERENT PUID re-binds only from a new session (a fresh sign-in)", async () => {
    const { state, pid } = arena();
    const { asked, minter } = minterRecorder();
    const deps = depsFor(state, minter);
    expect((await join(deps, U.KAI, pid)).status).toBe(200);
    const otherDevice = puidOf(`${U.KAI}-second-device`);
    expect((await join(deps, U.KAI, pid, otherDevice)).status).toBe(404); // same session: refused
    expect((await join(deps, `${U.KAI}#2`, pid, otherDevice)).status).toBe(200); // a fresh sign-in: re-bound
    expect(asked.map((a) => a.puid)).toEqual([puidOf(U.KAI), otherDevice]);
  });

  it('a malformed PUID is a 400, never bound and never minted; case is normalised', async () => {
    const { state, pid } = arena();
    const { asked, minter } = minterRecorder();
    const deps = depsFor(state, minter);
    for (const bad of ['', 'xyz', puidOf(U.KAI).slice(1), 42, null]) expect((await join(deps, U.KAI, pid, bad)).status, String(bad)).toBe(400);
    expect(asked).toEqual([]);
    expect((await join(deps, U.KAI, pid, puidOf(U.KAI).toUpperCase())).status).toBe(200);
    expect(asked[0].puid).toBe(puidOf(U.KAI));
  });

  it("the answer's audience lists only SERVER-BOUND PUID -> player pairs, only of the walled audience", async () => {
    const { state, pid } = arena();
    const blocked = blockUser(state, U.LYRA, U.ORION, NOW); // a carried-in blocked pair, still sharing the party
    if (!blocked.ok) throw new Error(blocked.error.message);
    const deps = depsFor(blocked.value, minterRecorder().minter);
    expect((await join(deps, U.LYRA, pid)).body.data.audience).toEqual([{ userId: U.LYRA, puid: puidOf(U.LYRA) }]); // nobody else bound yet
    await join(deps, U.ORION, pid);
    const kai = await join(deps, U.KAI, pid);
    const pairs = (kai.body.data.audience as Array<{ userId: string; puid: string }>).map((p) => `${p.userId}=${p.puid}`).sort();
    expect(pairs).toEqual([U.KAI, U.LYRA, U.ORION].map((u) => `${u}=${puidOf(u)}`).sort());
    // Orion's audience never names Lyra (or her PUID), and the reverse
    const orion = await join(deps, U.ORION, pid);
    expect(JSON.stringify(orion.body.data.audience)).not.toContain(U.LYRA);
    expect(JSON.stringify(orion.body.data.audience)).not.toContain(puidOf(U.LYRA));
  });
});

describe('the delivery tap', () => {
  it('records each events poll and snapshot by recipient, sequences, operations and people -- never a message body', async () => {
    const { createInMemorySocialStore } = await import('../src/relay/social/social-store');
    const store = createInMemorySocialStore();
    const records: SocialDeliveryRecord[] = [];
    const deps: SocialRouteDeps = {
      verifySession: (token) => facts(token),
      identify: async (id) => ({ userId: id, displayName: id.replace('usr_', ''), handle: `@${id}` }),
      store,
      tap: (r) => records.push(r),
    };
    const call = (who: string, method: string, path: string, body: unknown = null) =>
      handleSocialRoute({ method, path: `/wonderland/social${path}`, authorization: `Relay-Session ${who}`, origin: undefined, body, now: T0 }, deps) as
        Promise<{ status: number; body: { data?: any } }>;
    await call(U.KAI, 'GET', '/snapshot');
    await call(U.NOVA, 'GET', '/snapshot');
    expect((await call(U.KAI, 'POST', '/requests', { toUserId: U.NOVA })).status).toBe(200);
    const requestId = (await call(U.NOVA, 'GET', '/snapshot')).body.data.requests.incoming[0].requestId;
    expect((await call(U.NOVA, 'POST', `/requests/${requestId}/accept`)).status).toBe(200);
    const conversationId = (await call(U.KAI, 'POST', '/conversations', { otherUserId: U.NOVA })).body.data.conversationId;
    const secret = 'a-private-message-body-that-must-not-reach-the-tap';
    expect((await call(U.KAI, 'POST', `/conversations/${conversationId}/messages`, { body: secret })).status).toBe(200);
    await call(U.NOVA, 'GET', '/events?after=0');
    await call(U.NOVA, 'GET', '/snapshot');
    const novaEvents = records.filter((r) => r.recipient === U.NOVA && r.kind === 'events');
    expect(novaEvents).toHaveLength(1);
    expect(novaEvents[0]?.ops).toContain('messages.send');
    expect(novaEvents[0]?.seqs.length).toBe(novaEvents[0]?.ops.length);
    const novaLast = records.filter((r) => r.recipient === U.NOVA && r.kind === 'snapshot').at(-1);
    expect(novaLast?.userIds).toContain(U.KAI);
    expect(novaLast?.userIds).toContain(U.NOVA);
    expect(JSON.stringify(records)).not.toContain(secret);
  });
});
