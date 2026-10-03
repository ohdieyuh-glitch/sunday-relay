import { describe, expect, it } from 'vitest';
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
const facts = (participantId: string): SocialSessionFacts => ({ sessionId: participantId, participantId, capabilities: [NATIVE_SOCIAL_CAPABILITY], scope: 'native_social' });

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
  const asked: Array<{ partyId: string; participantId: string; audience: readonly string[] }> = [];
  const minter: PartyVoiceTokenMinter = {
    providerId: 'test-provider',
    mint: async (input) => {
      asked.push({ partyId: input.partyId, participantId: input.participantId, audience: [...input.audience].sort() });
      return { providerId: 'test-provider', roomId: `room-${input.partyId}`, participantToken: `token-for-${input.participantId}`, expiresAtIso: NOW };
    },
  };
  return { asked, minter };
}

const join = (deps: SocialRouteDeps, who: string, pid: string) =>
  handleSocialRoute({ method: 'POST', path: `/wonderland/social/parties/${pid}/voice/join`, authorization: `Relay-Session ${who}`, origin: undefined, body: {}, now: T0 }, deps) as
    Promise<{ status: number; body: { data?: any; error?: { kind: string; message: string } } }>;

const depsFor = (state: SocialState, voice: PartyVoiceTokenMinter | null, tap?: (r: SocialDeliveryRecord) => void): SocialRouteDeps => ({
  verifySession: (token) => facts(token),
  identify: async (id) => ({ userId: id, displayName: id, handle: `@${id}` }),
  store: fixedStore(state),
  voice,
  tap,
});

describe('party voice: the provider seam', () => {
  it('with no provider it is 503 VOICE TRANSPORT PENDING -- never a connected state', async () => {
    const { state, pid } = arena();
    const r = await join(depsFor(state, null), U.ORION, pid);
    expect(r.status).toBe(503);
    expect(r.body.error).toEqual({ kind: 'voice_unavailable', message: 'VOICE TRANSPORT PENDING' });
  });

  it('a member gets a token for their own party room, for the whole un-walled party', async () => {
    const { state, pid } = arena();
    const { asked, minter } = minterRecorder();
    const r = await join(depsFor(state, minter), U.KAI, pid);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ providerId: 'test-provider', roomId: `room-${pid}`, participantToken: `token-for-${U.KAI}` });
    expect(asked).toEqual([{ partyId: pid, participantId: U.KAI, audience: [U.KAI, U.LYRA, U.ORION].sort() }]);
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

  it('a provider failure is 503, not a token', async () => {
    const { state, pid } = arena();
    const failing: PartyVoiceTokenMinter = { providerId: 'x', mint: async () => { throw new Error('provider down'); } };
    const r = await join(depsFor(state, failing), U.ORION, pid);
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain('provider down');
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
