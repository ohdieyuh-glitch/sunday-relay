import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySocialOperation } from '../src/relay/social/social-commands';
import { createInMemoryVoiceBindings, type VoiceBindingStore } from '../src/relay/social/voice-binding';
import { acceptPartyInvite, inviteToParty, voiceAudienceFor } from '../src/relay/social/social-parties';
import { createSocialFixture, FIXTURE_USERS as U } from '../src/relay/social/social-fixtures';
import { blockUser } from '../src/relay/social/social-friends';
import { partyOf, type SocialState } from '../src/relay/social/social-state';
import type { SocialStore } from '../src/relay/social/social-store';
import {
  handleSocialRoute,
  nativeSocialSessionDeps,
  type PartyVoiceTokenMinter,
  type SocialDeliveryRecord,
  type SocialRouteDeps,
  type SocialSessionFacts,
} from './wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY } from './wonderland-social-scope';
import { failureTag, hashId, hashPuid } from './eos-voice';
import { createBrowserSessionStore } from './browser-session/grants';

/*
 * PARTY VOICE AND THE DELIVERY TAP, through the real route. The voice minter is a recorder: what matters is WHO the route
 * asks it to admit, and to which room. The tap must name recipients, sequences, operations and people -- never content.
 */

const T0 = Date.parse('2026-10-03T12:00:00.000Z');
const NOW = new Date(T0).toISOString();
/**
 * A session token "usr_x" is player usr_x in session usr_x; "usr_x#2" is the same player in a NEWER session (a fresh sign-in),
 * "#3" newer still. Every one was issued BEFORE the joins below (at T0): a minute before, one second apart, by its number. The
 * facts carry that issue time and the session lookup answers it (af2eb058 m-d/m-e: the production path, not the fallback).
 */
const issuedAtOf = (token: string): number => T0 - 60_000 + 1000 * Number(token.split('#')[1] ?? '1');
const facts = (token: string): SocialSessionFacts => ({ sessionId: token, participantId: token.split('#')[0], capabilities: [NATIVE_SOCIAL_CAPABILITY], scope: 'native_social', issuedAtMs: issuedAtOf(token) });
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

/**
 * The minter as a recorder: WHO the route asks it to admit, and to which room. It also keeps each room as a provider would
 * (every PUID admitted and not removed since), so a test can read who would still hear the party: `heard(partyId)`.
 */
function minterRecorder(opts: { failRemoval?: boolean } = {}) {
  const asked: Array<{ partyId: string; participantId: string; audience: readonly string[]; puid?: string }> = [];
  const removals: Array<{ partyId: string; participantId: string; puids: readonly string[] }> = [];
  /** Each removal's `mustLeave`, in order (af2eb058 m-a: a removal not confirmed is kept pending only when it must leave). */
  const mustLeave: boolean[] = [];
  const inRoom = new Map<string, Set<string>>();
  const mintedFor = new Map<string, Set<string>>();
  const minter: PartyVoiceTokenMinter = {
    providerId: 'test-provider',
    mint: async (input) => {
      asked.push({ partyId: input.partyId, participantId: input.participantId, audience: [...input.audience].sort(), puid: input.puid });
      const key = `${input.partyId}/${input.participantId}`;
      if (input.puid !== undefined) {
        inRoom.set(input.partyId, new Set([...(inRoom.get(input.partyId) ?? []), input.puid]));
        mintedFor.set(key, new Set([...(mintedFor.get(key) ?? []), input.puid]));
      }
      return { providerId: 'test-provider', roomId: `room-${input.partyId}`, participantToken: `token-for-${input.participantId}`, expiresAtIso: NOW };
    },
    removeFromRoom: async (input) => {
      removals.push({ partyId: input.partyId, participantId: input.participantId, puids: [...input.puids] });
      mustLeave.push(input.mustLeave);
      if (opts.failRemoval === true) throw new Error('provider down');
      const key = `${input.partyId}/${input.participantId}`;
      for (const puid of [...(mintedFor.get(key) ?? []), ...input.puids]) inRoom.get(input.partyId)?.delete(puid);
      mintedFor.delete(key);
    },
  };
  return { asked, removals, mustLeave, minter, heard: (partyId: string) => [...(inRoom.get(partyId) ?? [])].sort() };
}

const join = (deps: SocialRouteDeps, who: string, pid: string, puid: unknown = puidOf(who.split('#')[0])) =>
  handleSocialRoute({ method: 'POST', path: `/wonderland/social/parties/${pid}/voice/join`, authorization: `Relay-Session ${who}`, origin: undefined, body: { eosProductUserId: puid }, now: T0 }, deps) as
    Promise<{ status: number; body: { data?: any; error?: { kind: string; message: string } }; headers?: Readonly<Record<string, string>> }>;

const depsFor = (state: SocialState, voice: PartyVoiceTokenMinter | null, tap?: (r: SocialDeliveryRecord) => void, voiceBindings: VoiceBindingStore | null = createInMemoryVoiceBindings()): SocialRouteDeps => ({
  verifySession: (token) => facts(token),
  // every session here is live: its issue time, by its id (the token)
  sessionIssuedAt: (sessionId) => issuedAtOf(sessionId),
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

  it("A BLOCKED PAIR STILL SHARING THE PARTY (old data, a restore) gets NO token: the stranger's 404 for BOTH (review a6d5842c, M2)", async () => {
    // EOS keeps one room per party and the client plays all of it, so a token is never narrower than the room: a walled member
    // must not be admitted at all
    const { state, pid } = arena();
    const blocked = blockUser(state, U.LYRA, U.ORION, NOW);
    if (!blocked.ok) throw new Error(blocked.error.message);
    // both are still members: the wall holds a coexistence that F1 never separated
    expect(voiceAudienceFor(blocked.value, U.LYRA, pid)).toContain(U.LYRA);
    expect(voiceAudienceFor(blocked.value, U.ORION, pid)).toContain(U.ORION);
    const { asked, minter } = minterRecorder();
    const bindings = createInMemoryVoiceBindings();
    const deps = depsFor(blocked.value, minter, undefined, bindings);
    const missing = await join(deps, U.KAI, 'pty_does_not_exist');
    for (const who of [U.ORION, U.LYRA]) {
      const r = await join(deps, who, pid);
      expect(r.status, who).toBe(404);
      expect(r.body, who).toEqual(missing.body);
    }
    expect(asked).toEqual([]);
    expect(bindings.rows()).toEqual([]); // refused before anything was bound
    // the third member is walled from nobody: admitted, and hears the whole party
    expect((await join(deps, U.KAI, pid)).status).toBe(200);
    expect(asked).toEqual([{ partyId: pid, participantId: U.KAI, audience: [U.KAI, U.LYRA, U.ORION].sort(), puid: puidOf(U.KAI) }]);
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
    const failing: PartyVoiceTokenMinter = { providerId: 'x', mint: async () => { throw new Error('provider down'); }, removeFromRoom: async () => undefined };
    const r = await join(depsFor(state, failing), U.ORION, pid);
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain('provider down');
  });
});

describe('party voice: EOS PUID binding and the uniform 404 (R16 EOS voice backend)', () => {
  it("the first join binds; another player's PUID, a WALLED member, a separated member and a non-member all answer exactly as a party that does not exist", async () => {
    const { state, pid } = arena();
    const { asked, minter } = minterRecorder();
    const deps = depsFor(state, minter);
    expect((await join(deps, U.KAI, pid)).status).toBe(200); // Kai binds his PUID
    const missing = await join(deps, U.ORION, 'pty_does_not_exist');
    const nonMember = await join(deps, U.NOVA, pid);
    const stolen = await join(deps, U.LYRA, pid, puidOf(U.KAI)); // Lyra presents Kai's PUID
    // A WALLED MEMBER (M2): Lyra blocked Orion, and both are still in the party (carried-in data: F1 never ran)
    const carried = blockUser(state, U.LYRA, U.ORION, NOW);
    if (!carried.ok) throw new Error(carried.error.message);
    expect(voiceAudienceFor(carried.value, U.LYRA, pid)).toContain(U.LYRA); // still a member, not a removed one
    const walled = await join({ ...deps, store: fixedStore(carried.value) }, U.LYRA, pid);
    // A SEPARATED MEMBER: Orion (leader) blocks Lyra through blocks.add -- F1 removes her from the party
    const removed = applySocialOperation(state, 'blocks.add', U.ORION, { ids: [], body: { targetId: U.LYRA, confirmSharedParty: true }, query: {} }, NOW);
    if (!removed.ok) throw new Error(removed.error.message);
    expect(voiceAudienceFor(removed.value.state, U.LYRA, pid)).toEqual([]);
    const separated = await join({ ...deps, store: fixedStore(removed.value.state) }, U.LYRA, pid);
    for (const r of [nonMember, stolen, walled, separated]) {
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

  it("the answer's audience lists only SERVER-BOUND PUID -> player pairs; across a wall nobody gets an audience at all", async () => {
    const { state, pid } = arena();
    const bindings = createInMemoryVoiceBindings();
    const deps = depsFor(state, minterRecorder().minter, undefined, bindings);
    expect((await join(deps, U.LYRA, pid)).body.data.audience).toEqual([{ userId: U.LYRA, puid: puidOf(U.LYRA) }]); // nobody else bound yet
    await join(deps, U.ORION, pid);
    const pairsOf = (r: Awaited<ReturnType<typeof join>>) => (r.body.data.audience as Array<{ userId: string; puid: string }>).map((p) => `${p.userId}=${p.puid}`).sort();
    const everyone = [U.KAI, U.LYRA, U.ORION].map((u) => `${u}=${puidOf(u)}`).sort();
    expect(pairsOf(await join(deps, U.KAI, pid))).toEqual(everyone);
    // a block carried in between Lyra and Orion (both still members): neither is admitted, so neither is told the other's PUID;
    // Kai, walled from nobody, keeps hearing and naming both
    const blocked = blockUser(state, U.LYRA, U.ORION, NOW);
    if (!blocked.ok) throw new Error(blocked.error.message);
    const walledDeps = { ...deps, store: fixedStore(blocked.value) };
    for (const who of [U.ORION, U.LYRA]) {
      const r = await join(walledDeps, who, pid);
      expect(r.status, who).toBe(404);
      expect(r.body.data, who).toBeUndefined();
    }
    expect(pairsOf(await join(walledDeps, U.KAI, pid))).toEqual(everyone);
  });
});

describe('party voice: a re-bind takes the replaced PUID out of the room first (review a6d5842c, B1)', () => {
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

  it('a fresh sign-in on another device: the old PUID leaves the room BEFORE the new one is bound; the room then holds only the new one', async () => {
    const { state, pid } = arena();
    const rec = minterRecorder();
    const bindings = createInMemoryVoiceBindings();
    const order: string[] = [];
    const traced: VoiceBindingStore = { ...bindings, bind: async (i) => { order.push(`bind ${i.puid}`); return bindings.bind(i); } };
    const minter: PartyVoiceTokenMinter = { ...rec.minter, removeFromRoom: async (i) => { order.push(`remove ${i.puids.join(',')}`); return rec.minter.removeFromRoom(i); } };
    const deps = depsFor(state, minter, undefined, traced);
    expect((await join(deps, U.KAI, pid)).status).toBe(200);
    expect(rec.heard(pid)).toEqual([puidOf(U.KAI)]);
    const second = puidOf(`${U.KAI}-second-device`);
    expect((await join(deps, `${U.KAI}#2`, pid, second)).status).toBe(200);
    expect(order).toEqual([`bind ${puidOf(U.KAI)}`, `remove ${puidOf(U.KAI)}`, `bind ${second}`]);
    expect(rec.heard(pid)).toEqual([second]); // the first device no longer hears the party
    expect(bindings.rows().map((r) => r.puid)).toEqual([second]);
  });

  it('a re-bind whose removal is not confirmed is a 503 and changes nothing: the old binding stays, and nothing is minted', async () => {
    const { state, pid } = arena();
    const rec = minterRecorder({ failRemoval: true });
    const bindings = createInMemoryVoiceBindings();
    const deps = depsFor(state, rec.minter, undefined, bindings);
    expect((await join(deps, U.KAI, pid)).status).toBe(200);
    const r = await join(deps, `${U.KAI}#2`, pid, puidOf(`${U.KAI}-second-device`));
    expect(r.status).toBe(503);
    expect(r.body.error?.kind).toBe('voice_unavailable');
    expect(bindings.rows().map((row) => [row.puid, row.sessionId])).toEqual([[puidOf(U.KAI), U.KAI]]);
    expect(rec.asked.map((a) => a.puid)).toEqual([puidOf(U.KAI)]);
    // held, so the old PUID is still the binding's: never kept pending for a timer to take away (af2eb058 m-a)
    expect(rec.mustLeave).toEqual([false]);
  });

  it("no removal at all when nothing is re-bound: the same PUID again, a refused one (same session, or another player's), a first bind", async () => {
    const { state, pid } = arena();
    const rec = minterRecorder();
    const deps = depsFor(state, rec.minter);
    expect((await join(deps, U.KAI, pid)).status).toBe(200); // first bind
    expect((await join(deps, U.KAI, pid)).status).toBe(200); // the same PUID again (the client's audience re-ask)
    expect((await join(deps, `${U.KAI}#2`, pid)).status).toBe(200); // the same PUID from a new session
    expect((await join(deps, U.KAI, pid, puidOf('another-device'))).status).toBe(404); // a different PUID, same session
    expect((await join(deps, `${U.KAI}#3`, pid, puidOf(U.LYRA))).status).toBe(200); // Lyra's PUID is nobody's yet: a re-bind
    expect(rec.removals).toEqual([{ partyId: pid, participantId: U.KAI, puids: [puidOf(U.KAI)] }]);
    // Lyra now asks with her own PUID, which Kai holds: refused, and her room is not touched
    expect((await join(deps, U.LYRA, pid)).status).toBe(404);
    expect(rec.removals).toHaveLength(1);
  });

  it("ANOTHER PLAYER'S PUID from the caller's newer session: refused before anything is removed -- the prediction reads the PUID's owner (test review a8ed4c0b MINOR 2)", async () => {
    const { state, pid } = arena();
    const rec = minterRecorder();
    const bindings = createInMemoryVoiceBindings();
    const deps = depsFor(state, rec.minter, undefined, bindings);
    const [X, L] = [puidOf(U.KAI), puidOf(U.LYRA)];
    expect((await join(deps, U.KAI, pid, X)).status).toBe(200); // Kai has bound X
    expect((await join(deps, U.LYRA, pid, L)).status).toBe(200); // Lyra has bound L
    // Kai's newer session (it would win a re-bind of his own) presents Lyra's L
    const missing = await join(deps, `${U.KAI}#2`, 'pty_does_not_exist', L);
    const stolen = await join(deps, `${U.KAI}#2`, pid, L);
    expect(stolen.status).toBe(404);
    expect(stolen.body).toEqual(missing.body);
    expect(rec.removals).toEqual([]); // X never left the room for a re-bind the store was always going to refuse
    expect(rec.heard(pid)).toEqual([X, L].sort()); // X is still heard
    expect(bindings.rows().map((r) => `${r.userId}=${r.puid}`).sort()).toEqual([`${U.KAI}=${X}`, `${U.LYRA}=${L}`].sort());
    expect(rec.asked.map((a) => a.puid)).toEqual([X, L]);
  });

  it('two fresh sign-ins of one player join at once with two new PUIDs: one join at a time, so the room ends holding only the PUID bound last', async () => {
    const { state, pid } = arena();
    const rec = minterRecorder();
    const bindings = createInMemoryVoiceBindings();
    // the first re-bind's removal is held while the second join has every chance to run
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let holds = 1;
    const minter: PartyVoiceTokenMinter = { ...rec.minter, removeFromRoom: async (i) => { if (holds-- > 0) await held; return rec.minter.removeFromRoom(i); } };
    const deps = depsFor(state, minter, undefined, bindings);
    expect((await join(deps, U.KAI, pid)).status).toBe(200);
    const [y, z] = [puidOf('kai-device-y'), puidOf('kai-device-z')];
    const first = join(deps, `${U.KAI}#2`, pid, y);
    await tick();
    const second = join(deps, `${U.KAI}#3`, pid, z);
    await tick();
    release();
    expect([(await first).status, (await second).status]).toEqual([200, 200]);
    expect(bindings.rows().map((r) => r.puid)).toEqual([z]);
    expect(rec.heard(pid)).toEqual([z]); // y left the room when z re-bound; Kai's first PUID left when y did
  });

  it('a re-bind nobody predicted (another process moved the binding): the minted PUIDs leave the room before the mint; logged with hashed ids only', async () => {
    const { state, pid } = arena();
    const rec = minterRecorder();
    const real = createInMemoryVoiceBindings();
    let stale = false;
    // a read that sees no binding, while the table holds one: as if another bridge process bound it in between
    const racing: VoiceBindingStore = { ...real, bindingOf: async (u) => (stale ? null : real.bindingOf(u)) };
    const log: string[] = [];
    const deps: SocialRouteDeps = { ...depsFor(state, rec.minter, undefined, racing), log: (l) => log.push(l) };
    expect((await join(deps, U.KAI, pid)).status).toBe(200);
    stale = true;
    const fresh = puidOf(`${U.KAI}-fresh`);
    expect((await join(deps, `${U.KAI}#2`, pid, fresh)).status).toBe(200);
    expect(rec.removals).toEqual([{ partyId: pid, participantId: U.KAI, puids: [] }]);
    expect(rec.heard(pid)).toEqual([fresh]);
    expect(log).toEqual([`voice join: the binding moved under this join user=${hashId(U.KAI)} puid=${hashPuid(fresh)} predicted=bound actual=rebound`]);
    for (const raw of [U.KAI, fresh, puidOf(U.KAI)]) expect(log.join('\n')).not.toContain(raw);
  });
});

describe("party voice: the NEWEST SESSION WINS on the production path (MAIN's internal reviews af2eb058 m-d/m-e, a8ed4c0b MAJOR 1)", () => {
  // These carry the issue times production carries: the facts' issuedAtMs, and the session store's lookup. Before m-e no route
  // test did, so every re-bind case ran the dev server's "another session" fallback.

  it("KAI's older session binds X; his NEWER session re-binds Y (200); the older asks again with X: the stranger's 404, nothing removed, Y stays bound and heard", async () => {
    const { state, pid } = arena();
    const rec = minterRecorder();
    const bindings = createInMemoryVoiceBindings();
    const deps = depsFor(state, rec.minter, undefined, bindings);
    const [older, newer] = [U.KAI, `${U.KAI}#2`];
    // both live, both signed in before the first join, the older a second before the newer
    expect(facts(older).issuedAtMs).toBeLessThan(facts(newer).issuedAtMs);
    expect(facts(newer).issuedAtMs).toBeLessThan(T0);
    const [X, Y] = [puidOf('kai-device-x'), puidOf('kai-device-y')];
    expect((await join(deps, older, pid, X)).status).toBe(200);
    expect((await join(deps, newer, pid, Y)).status).toBe(200);
    expect(rec.removals).toEqual([{ partyId: pid, participantId: U.KAI, puids: [X] }]);
    const missing = await join(deps, older, 'pty_does_not_exist', X);
    const again = await join(deps, older, pid, X);
    expect(again.status).toBe(404);
    expect(again.body).toEqual(missing.body);
    expect(rec.removals).toHaveLength(1); // the refused ask removed nothing
    expect(rec.asked.map((a) => a.puid)).toEqual([X, Y]); // and was minted nothing
    expect(bindings.rows().map((r) => [r.puid, r.sessionId])).toEqual([[Y, newer]]);
    expect(rec.heard(pid)).toEqual([Y]);
  });

  it('once the newer session is gone (signed out, expired), its binding yields: the older session re-binds X, and Y leaves the room', async () => {
    const { state, pid } = arena();
    const rec = minterRecorder();
    const bindings = createInMemoryVoiceBindings();
    const gone = new Set<string>();
    const deps: SocialRouteDeps = { ...depsFor(state, rec.minter, undefined, bindings), sessionIssuedAt: (id) => (gone.has(id) ? null : issuedAtOf(id)) };
    const [X, Y] = [puidOf('kai-device-x'), puidOf('kai-device-y')];
    expect((await join(deps, U.KAI, pid, X)).status).toBe(200);
    expect((await join(deps, `${U.KAI}#2`, pid, Y)).status).toBe(200);
    expect((await join(deps, U.KAI, pid, X)).status).toBe(404);
    gone.add(`${U.KAI}#2`);
    expect((await join(deps, U.KAI, pid, X)).status).toBe(200);
    expect(bindings.rows().map((r) => [r.puid, r.sessionId])).toEqual([[X, U.KAI]]);
    expect(rec.removals.map((r) => r.puids)).toEqual([[X], [Y]]);
    expect(rec.heard(pid)).toEqual([X]);
  });
});

describe("the bridge's session hop for social: nativeSocialSessionDeps, exactly what server.ts spreads (MAIN's internal reviews af2eb058 m-d/m-e, a8ed4c0b MAJOR 1)", () => {
  const mintFor = (sessions: ReturnType<typeof createBrowserSessionStore>, participantId: string, at: number) => {
    const minted = sessions.mintNativeSocialSession({ now: at, participantId });
    if (!minted.ok) throw new Error(`mint: ${minted.reason}`);
    return minted.session;
  };

  it("a native social session's facts carry its issue time; the lookup answers it by id while the session lives, and null once it is revoked", () => {
    const sessions = createBrowserSessionStore();
    const first = mintFor(sessions, U.KAI, T0 - 60_000);
    const second = mintFor(sessions, U.KAI, T0 - 30_000);
    const hop = nativeSocialSessionDeps(sessions);
    expect(hop.verifySession(first.token, T0)).toEqual({ sessionId: first.sessionId, participantId: U.KAI, capabilities: [NATIVE_SOCIAL_CAPABILITY], scope: 'native_social', issuedAtMs: T0 - 60_000 });
    expect(hop.verifySession(second.token, T0)?.issuedAtMs).toBe(T0 - 30_000);
    expect(hop.sessionIssuedAt?.(first.sessionId, T0)).toBe(T0 - 60_000);
    expect(hop.sessionIssuedAt?.(second.sessionId, T0)).toBe(T0 - 30_000);
    expect(sessions.revokeSession({ token: first.token, now: T0 })).toBe(true);
    expect(hop.verifySession(first.token, T0)).toBeNull();
    expect(hop.sessionIssuedAt?.(first.sessionId, T0)).toBeNull();
  });

  it('through the voice route on REAL sessions: the newer session wins though it signed in before the first join; the older cannot take the binding back until the newer signs out', async () => {
    const { state, pid } = arena();
    const sessions = createBrowserSessionStore();
    const older = mintFor(sessions, U.KAI, T0 - 60_000);
    const newer = mintFor(sessions, U.KAI, T0 - 30_000); // before the older session's first join: the m-d case
    const rec = minterRecorder();
    const bindings = createInMemoryVoiceBindings();
    const deps: SocialRouteDeps = { ...depsFor(state, rec.minter, undefined, bindings), ...nativeSocialSessionDeps(sessions) };
    const [X, Y] = [puidOf('kai-real-x'), puidOf('kai-real-y')];
    expect((await join(deps, older.token, pid, X)).status).toBe(200);
    expect((await join(deps, newer.token, pid, Y)).status).toBe(200);
    expect((await join(deps, older.token, pid, X)).status).toBe(404);
    expect(bindings.rows().map((r) => [r.puid, r.sessionId])).toEqual([[Y, newer.sessionId]]);
    expect(rec.heard(pid)).toEqual([Y]);
    expect(sessions.revokeSession({ token: newer.token, now: T0 })).toBe(true); // the newer signs out
    expect((await join(deps, older.token, pid, X)).status).toBe(200);
    expect(bindings.rows().map((r) => [r.puid, r.sessionId])).toEqual([[X, older.sessionId]]);
    expect(rec.heard(pid)).toEqual([X]);
  });

  it('server.ts serves social with exactly this hop, and builds no session facts of its own', () => {
    const server = readFileSync(resolve(__dirname, 'server.ts'), 'utf8');
    const start = server.indexOf('const socialResult = await handleSocialRoute(');
    expect(start, 'the social route is mounted').toBeGreaterThan(0);
    const end = server.indexOf('\n          });', start);
    expect(end, 'the call closes').toBeGreaterThan(start);
    const call = server.slice(start, end);
    expect(call).toContain('...nativeSocialSessionDeps(browserSessions),');
    expect(call).not.toContain('verifySession:');
    expect(call).not.toContain('sessionIssuedAt:');
    expect(server).not.toContain('verifyNativeSocialSession(');
  });
});

/** A store whose reads walk through `states` (the last repeats), or throw at read number `failAt`: what changed between the route's two reads. */
function steppingStore(states: readonly SocialState[], failAt?: number): SocialStore {
  let reads = 0;
  return {
    ...fixedStore(states[0]),
    read: async () => {
      const at = reads;
      reads += 1;
      if (at === failAt) throw new Error('the social store is down');
      return states[Math.min(at, states.length - 1)];
    },
  };
}

describe('party voice: a join racing a kick or a block (review a6d5842c, M1)', () => {
  const removed = (state: SocialState, pid: string, who: string) => {
    const kicked = applySocialOperation(state, 'parties.remove_member', U.ORION, { ids: [pid, who], body: {}, query: {} }, NOW);
    if (!kicked.ok) throw new Error(kicked.error.message);
    return kicked.value.state;
  };

  it("kicked between the first read and the mint: the new token is taken back, and the answer is the stranger's 404", async () => {
    const { state, pid } = arena();
    const rec = minterRecorder();
    const log: string[] = [];
    const deps: SocialRouteDeps = { ...depsFor(state, rec.minter), store: steppingStore([state, removed(state, pid, U.KAI)]), log: (l) => log.push(l) };
    const missing = await join(depsFor(state, minterRecorder().minter), U.KAI, 'pty_does_not_exist');
    const r = await join(deps, U.KAI, pid);
    expect(r.status).toBe(404);
    expect(r.body).toEqual(missing.body);
    expect(rec.asked.map((a) => a.participantId)).toEqual([U.KAI]); // the token was minted...
    expect(rec.removals).toEqual([{ partyId: pid, participantId: U.KAI, puids: [puidOf(U.KAI)] }]); // ...and taken back
    expect(rec.heard(pid)).toEqual([]);
    expect(log).toEqual([`voice join: left the party while joining; the new token is revoked user=${hashId(U.KAI)} puid=${hashPuid(puidOf(U.KAI))}`]);
  });

  it('walled between the reads (a block carried in, both still members): the same -- token taken back, 404', async () => {
    const { state, pid } = arena();
    const walled = blockUser(state, U.LYRA, U.KAI, NOW);
    if (!walled.ok) throw new Error(walled.error.message);
    const rec = minterRecorder();
    const r = await join({ ...depsFor(state, rec.minter), store: steppingStore([state, walled.value]) }, U.KAI, pid);
    expect(r.status).toBe(404);
    expect(rec.heard(pid)).toEqual([]);
    expect(rec.removals).toHaveLength(1);
  });

  it('a take-back that is not confirmed is still the 404, and is logged as such (the provider keeps the PUID pending: af2eb058 m-a)', async () => {
    const { state, pid } = arena();
    const rec = minterRecorder({ failRemoval: true });
    const log: string[] = [];
    const r = await join({ ...depsFor(state, rec.minter), store: steppingStore([state, removed(state, pid, U.KAI)]), log: (l) => log.push(l) }, U.KAI, pid);
    expect(r.status).toBe(404);
    expect(rec.mustLeave).toEqual([true]); // it must leave: not confirmed, it stays pending at the provider
    // The NOTE fix (a6d5842c) ends every failure line with the error's HASHED tag, never its text: `(<Name> #<12 hex>)`.
    expect(log).toHaveLength(1);
    const prefix = `voice join: left the party while joining; its removal is NOT confirmed (kept pending: tried again before the room's next removal or mint, and by a timer) user=${hashId(U.KAI)} puid=${hashPuid(puidOf(U.KAI))} (`;
    expect(log[0].startsWith(prefix), log[0]).toBe(true);
    expect(log[0].slice(prefix.length), 'the hashed failure tag, nothing else').toMatch(/^[A-Za-z]+ #[0-9a-f]{12}\)$/);
  });

  it('the second read fails: the token is taken back and the answer is 503 -- never a token for a membership nobody confirmed', async () => {
    const { state, pid } = arena();
    const rec = minterRecorder();
    const r = await join({ ...depsFor(state, rec.minter), store: steppingStore([state], 1) }, U.KAI, pid);
    expect(r.status).toBe(503);
    expect(r.body.error).toEqual({ kind: 'voice_unavailable', message: 'Party voice could not confirm your party right now.' });
    expect(rec.heard(pid)).toEqual([]);
  });

  it('the control: still admitted at the second read -- 200, nothing taken back; the audience is the party as it is NOW', async () => {
    const { state, pid } = arena();
    const rec = minterRecorder();
    const bindings = createInMemoryVoiceBindings();
    expect((await join(depsFor(state, rec.minter, undefined, bindings), U.LYRA, pid)).status).toBe(200); // Lyra bound
    const lyraLeft = applySocialOperation(state, 'parties.leave', U.LYRA, { ids: [pid], body: {}, query: {} }, NOW);
    if (!lyraLeft.ok) throw new Error(lyraLeft.error.message);
    const r = await join({ ...depsFor(state, rec.minter, undefined, bindings), store: steppingStore([state, lyraLeft.value.state]) }, U.KAI, pid);
    expect(r.status).toBe(200);
    expect(rec.removals).toEqual([]);
    expect(r.body.data.audience).toEqual([{ userId: U.KAI, puid: puidOf(U.KAI) }]); // Lyra left in between: not named
  });
});

describe('party voice: every failure is an honest 503, logged with hashed ids and a hashed reason (review a6d5842c NOTE; CORE 10-07)', () => {
  // an error whose text names a host, the player, their PUID and something secret-shaped: none of it may reach a log or an answer
  const leak = `connect ECONNREFUSED voice-db.internal:5432 user=${U.KAI} puid=${puidOf(U.KAI)} key=${puidOf('a-planted-secret')}`;
  const boom = () => Object.assign(new Error(leak), { code: 'ECONNREFUSED' });

  it('a failed binding read, bind, mint or audience read: each its own message, never the error text, and one hashed log line', async () => {
    const { state, pid } = arena();
    const real = createInMemoryVoiceBindings();
    const cases: Array<[string, Partial<VoiceBindingStore>, PartyVoiceTokenMinter | null, string, string]> = [
      ['the binding read', { bindingOf: async () => { throw boom(); } }, null, 'Party voice could not read your voice identity right now.', 'the binding could not be read'],
      ['the bind', { bind: async () => { throw boom(); } }, null, 'Party voice could not record your voice identity right now.', 'the bind failed'],
      ['the mint', {}, { providerId: 'x', mint: async () => { throw boom(); }, removeFromRoom: async () => undefined }, 'The voice provider could not admit you right now.', 'the provider minted no token'],
      ['the audience read', { puidsOf: async () => { throw boom(); } }, null, "Party voice could not read the party's voice identities right now.", 'the audience could not be read'],
    ];
    const messages = new Set<string>();
    for (const [label, broken, minter, message, what] of cases) {
      const log: string[] = [];
      const deps: SocialRouteDeps = { ...depsFor(state, minter ?? minterRecorder().minter, undefined, { ...real, ...broken }), log: (l) => log.push(l) };
      const r = await join(deps, U.KAI, pid);
      expect(r.status, label).toBe(503);
      expect(r.body.error, label).toEqual({ kind: 'voice_unavailable', message });
      expect(log, label).toEqual([`voice join: ${what} user=${hashId(U.KAI)} puid=${hashPuid(puidOf(U.KAI))} (code ECONNREFUSED ${hashId(leak)})`]);
      for (const raw of [leak, 'voice-db.internal', U.KAI, puidOf(U.KAI), puidOf('a-planted-secret')]) {
        expect(log.join('\n'), `${label}: ${raw}`).not.toContain(raw);
        expect(JSON.stringify(r.body), `${label}: ${raw}`).not.toContain(raw);
      }
      messages.add(message);
    }
    // four honest, distinct sentences -- none of them the "no provider configured" one
    expect(messages.size).toBe(4);
    expect(messages.has('VOICE TRANSPORT PENDING')).toBe(false);
  });

  it('the reason tag: a well-formed code, else the error class, else unknown -- and never the text', () => {
    expect(failureTag(Object.assign(new Error(leak), { code: '23505' }))).toBe(`code 23505 ${hashId(leak)}`);
    expect(failureTag(new TypeError(leak))).toBe(`TypeError ${hashId(leak)}`);
    expect(failureTag(leak)).toBe(`unknown ${hashId(leak)}`);
    expect(failureTag(Object.assign(new Error(leak), { code: 'not a code: secret value' }))).toBe(`Error ${hashId(leak)}`);
  });
});

describe('the delivery tap', () => {
  it('records each events poll and snapshot by recipient, sequences, operations and people -- never a message body', async () => {
    const { createInMemorySocialStore } = await import('../src/relay/social/social-store');
    const store = createInMemorySocialStore();
    const records: SocialDeliveryRecord[] = [];
    const deps: SocialRouteDeps = {
      verifySession: (token) => facts(token),
      sessionIssuedAt: null,
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
