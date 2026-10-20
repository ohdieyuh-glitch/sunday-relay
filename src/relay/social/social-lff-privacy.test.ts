import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RelayError, RelayResult } from '../protocol/errors';
import { applySocialOperation, type SocialCommandOutcome } from './social-commands';
import { NEVER_SOCIAL_CONCERNS, type SocialOperationId } from './social-contracts';
import { FIXTURE_NOW, FIXTURE_USERS as U, createSocialFixture } from './social-fixtures';
import { LFF_REREQUEST_COOLDOWN_MS, type LffFeedPage, type LffMyRequests, type LffPostDetail, type LffPostRequests, type LffPostView } from './social-lff';
import { resolvePresenceFor } from './social-presence';
import { buildSocialView, type SocialPersonRow } from './social-preview';
import { emptySocialState, lffPostById, lffRequestById, type SocialState } from './social-state';
import { createInMemorySocialStore } from './social-store';

/*
 * LFF PRIVACY AND SAFETY (contract rules 1, 2, 3, 5 and 6, as MAIN decided them in r2): one absence for everything that is not the
 * viewer's to see; blocks either way, each side TOLD exactly what the ordinary change it imitates tells; a post shown only to a
 * viewer who may see its author (no anonymous listing), so every post can be reported; no counts and no rosters; content-free
 * events told only to whom they concern; and NO WRITER beyond LFF's own rows -- proven on the state, and by walking social-lff.ts's
 * real import graph. Every refusal stands beside an accepted control.
 */

const T0 = Date.parse(FIXTURE_NOW);
const LATER = new Date(T0 + 60_000).toISOString();
type Outcome = RelayResult<SocialCommandOutcome>;

function run(s: SocialState, actor: string, op: SocialOperationId, opts: { ids?: string[]; body?: Record<string, unknown> } = {}, nowMs = T0): Outcome {
  return applySocialOperation(s, op, actor, { ids: opts.ids ?? [], body: opts.body ?? {}, query: {} }, new Date(nowMs).toISOString());
}

function must(r: Outcome): SocialCommandOutcome {
  if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
  return r.value;
}

function refused(r: Outcome): RelayError {
  if (r.ok) throw new Error('expected a refusal, got success');
  return r.error;
}

function post(s: SocialState, owner: string, body: Record<string, unknown> = {}): { state: SocialState; postId: string } {
  const o = must(run(s, owner, 'lff.post.create', { body: { category: 'TEAMS', title: 'Looking for a squad', openSlots: 2, ...body } }));
  return { state: o.state, postId: (o.data as { postId: string }).postId };
}

function ask(s: SocialState, requester: string, postId: string): { state: SocialState; requestId: string } {
  const o = must(run(s, requester, 'lff.request.create', { ids: [postId] }));
  return { state: o.state, requestId: (o.data as { requestId: string }).requestId };
}

const hide = (s: SocialState, who: string, presenceVisibility: string) => must(run(s, who, 'privacy.update_self', { body: { presenceVisibility } })).state;
const accept = (s: SocialState, owner: string, requestId: string) => must(run(s, owner, 'lff.request.accept', { ids: [requestId] })).state;
const block = (s: SocialState, actor: string, target: string) => must(run(s, actor, 'blocks.add', { body: { targetId: target } })).state;
const feed = (s: SocialState, viewer: string, filter: Record<string, unknown> = {}): LffFeedPage => must(run(s, viewer, 'lff.feed.list', { body: filter })).data as LffFeedPage;
const feedIds = (s: SocialState, viewer: string) => feed(s, viewer).posts.map((p) => p.postId);
const detail = (s: SocialState, viewer: string, postId: string): LffPostDetail => must(run(s, viewer, 'lff.post.get', { ids: [postId] })).data as LffPostDetail;
const mine = (s: SocialState, viewer: string): LffMyRequests => must(run(s, viewer, 'lff.requests.mine')).data as LffMyRequests;
const inbox = (s: SocialState, owner: string, postId: string): LffPostRequests => must(run(s, owner, 'lff.requests.forPost', { ids: [postId] })).data as LffPostRequests;

/** The answer for a post that does not exist. */
const missingPost = (s: SocialState) => refused(run(s, U.KAI, 'lff.post.get', { ids: ['lffp_424242'] }));

/** Each viewer's event stream, serialized, after these operations run through a real in-memory store from `initial`. */
async function streamsAfter(initial: SocialState, steps: Array<[SocialOperationId, string, string[], Record<string, unknown>]>, viewers: string[]): Promise<Record<string, string>> {
  const store = createInMemorySocialStore(initial);
  for (const [op, actor, ids, body] of steps) {
    const r = await store.apply(op, actor, { ids, body, query: {} }, LATER);
    if (!r.ok) throw new Error(`${op}: ${r.error.message}`);
  }
  const out: Record<string, string> = {};
  for (const viewer of viewers) out[viewer] = JSON.stringify((await store.eventsFor(viewer, 0, 100)).events);
  return out;
}

function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, into));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

describe('rule 1 + 2 + 3: ONE absence -- not yours, behind a wall, not shown to you, or missing, the answer is byte for byte the same', () => {
  it('every refusal of something that is not the actor\'s equals a missing post\'s, serialized; each has an accepted control', () => {
    let s = createSocialFixture();
    const nova = post(s, U.NOVA);
    s = nova.state;
    const mira = post(s, U.MIRA); // Mira has blocked Kai (the fixture)
    s = mira.state;
    const kai = post(s, U.KAI);
    s = kai.state;
    s = hide(s, U.ORION, 'FRIENDS'); // Orion shows himself to friends only: Kai yes, Vega no
    const orion = post(s, U.ORION);
    s = orion.state;
    const lyra = post(s, U.LYRA);
    s = must(run(lyra.state, U.LYRA, 'lff.post.close', { ids: [lyra.postId] })).state;
    const req = ask(s, U.KAI, nova.postId);
    s = req.state;
    const missing = JSON.stringify(missingPost(s));
    expect(JSON.parse(missing)).toEqual({ code: 'not-found', message: 'post not found' });
    const refusals: Array<[string, Outcome]> = [
      ['get, blocked BY the owner', run(s, U.KAI, 'lff.post.get', { ids: [mira.postId] })],
      ['get, the owner is blocked BY the viewer', run(s, U.MIRA, 'lff.post.get', { ids: [kai.postId] })],
      ['get, the author hides from the viewer', run(s, U.VEGA, 'lff.post.get', { ids: [orion.postId] })],
      ['get, a closed post the viewer was not accepted on', run(s, U.KAI, 'lff.post.get', { ids: [lyra.postId] })],
      ['request, blocked BY the owner', run(s, U.KAI, 'lff.request.create', { ids: [mira.postId] })],
      ['request, the owner is blocked BY the viewer', run(s, U.MIRA, 'lff.request.create', { ids: [kai.postId] })],
      ['request, the author hides from the viewer', run(s, U.VEGA, 'lff.request.create', { ids: [orion.postId] })],
      ['request, a closed post', run(s, U.KAI, 'lff.request.create', { ids: [lyra.postId] })],
      ['edit, not the owner', run(s, U.VEGA, 'lff.post.edit', { ids: [nova.postId], body: { title: 'x' } })],
      ['close, not the owner', run(s, U.VEGA, 'lff.post.close', { ids: [nova.postId] })],
      ['delete, not the owner', run(s, U.VEGA, 'lff.post.delete', { ids: [nova.postId] })],
      ['requests.forPost, not the owner', run(s, U.KAI, 'lff.requests.forPost', { ids: [nova.postId] })],
      ['accept, not the owner (the requester)', run(s, U.KAI, 'lff.request.accept', { ids: [req.requestId] })],
      ['accept, not the owner (a stranger)', run(s, U.VEGA, 'lff.request.accept', { ids: [req.requestId] })],
      ['decline, not the owner', run(s, U.VEGA, 'lff.request.decline', { ids: [req.requestId] })],
      ['withdraw, not the requester (the owner)', run(s, U.NOVA, 'lff.request.withdraw', { ids: [req.requestId] })],
      ['withdraw, not the requester (a stranger)', run(s, U.VEGA, 'lff.request.withdraw', { ids: [req.requestId] })],
      ['edit, missing', run(s, U.KAI, 'lff.post.edit', { ids: ['lffp_424242'], body: { title: 'x' } })],
      ['accept, missing', run(s, U.NOVA, 'lff.request.accept', { ids: ['lffr_424242'] })],
      ['get, a planted prototype name', run(s, U.KAI, 'lff.post.get', { ids: ['constructor'] })],
      ['withdraw, a planted prototype name', run(s, U.KAI, 'lff.request.withdraw', { ids: ['__proto__'] })],
    ];
    for (const [label, r] of refusals) expect(JSON.stringify(refused(r)), label).toBe(missing);
    // the controls: the right actor, the same call, accepted
    expect(run(s, U.VEGA, 'lff.post.get', { ids: [mira.postId] }).ok, 'a viewer outside the wall sees Mira\'s post').toBe(true);
    expect(run(s, U.MIRA, 'lff.post.get', { ids: [mira.postId] }).ok).toBe(true);
    expect(run(s, U.KAI, 'lff.post.get', { ids: [orion.postId] }).ok, 'Orion\'s friend sees his post').toBe(true);
    expect(run(s, U.LYRA, 'lff.post.get', { ids: [lyra.postId] }).ok, 'the owner sees her closed post').toBe(true);
    expect(run(s, U.VEGA, 'lff.request.create', { ids: [kai.postId] }).ok).toBe(true);
    expect(run(s, U.KAI, 'lff.request.create', { ids: [orion.postId] }).ok).toBe(true);
    expect(run(s, U.NOVA, 'lff.post.edit', { ids: [nova.postId], body: { title: 'x' } }).ok).toBe(true);
    expect(run(s, U.NOVA, 'lff.post.close', { ids: [nova.postId] }).ok).toBe(true);
    expect(run(s, U.NOVA, 'lff.post.delete', { ids: [nova.postId] }).ok).toBe(true);
    expect(run(s, U.NOVA, 'lff.requests.forPost', { ids: [nova.postId] }).ok).toBe(true);
    expect(run(s, U.NOVA, 'lff.request.accept', { ids: [req.requestId] }).ok).toBe(true);
    expect(run(s, U.NOVA, 'lff.request.decline', { ids: [req.requestId] }).ok).toBe(true);
    expect(run(s, U.KAI, 'lff.request.withdraw', { ids: [req.requestId] }).ok).toBe(true);
  });
});

describe('rule 2: a block, either way', () => {
  it('the feed leaves out a walled post both ways (blocked, and blocker); a viewer outside the wall sees both', () => {
    const mira = post(createSocialFixture(), U.MIRA);
    const kai = post(mira.state, U.KAI);
    const s = kai.state;
    expect(feedIds(s, U.KAI)).not.toContain(mira.postId);
    expect(feedIds(s, U.MIRA)).not.toContain(kai.postId);
    expect(feedIds(s, U.NOVA)).toEqual(expect.arrayContaining([mira.postId, kai.postId]));
    expect(feedIds(s, U.KAI)).toContain(kai.postId);
  });

  it('a block placed now hides each side\'s post from the other at once, and an unblock shows them again', () => {
    const vega = post(createSocialFixture(), U.VEGA);
    const kai = post(vega.state, U.KAI);
    expect(feedIds(kai.state, U.KAI)).toContain(vega.postId);
    const walled = block(kai.state, U.KAI, U.VEGA);
    expect(feedIds(walled, U.KAI)).not.toContain(vega.postId);
    expect(feedIds(walled, U.VEGA)).not.toContain(kai.postId);
    expect(refused(run(walled, U.VEGA, 'lff.post.get', { ids: [kai.postId] }))).toEqual(missingPost(walled));
    const lifted = must(run(walled, U.KAI, 'blocks.remove', { ids: [U.VEGA] })).state;
    expect(feedIds(lifted, U.KAI)).toContain(vega.postId);
    expect(feedIds(lifted, U.VEGA)).toContain(kai.postId);
  });

  // SEC m-a: the OWNER's block stores CANCELLED; the REQUESTER's block stores WITHDRAWN (exactly their own withdrawal's row)
  for (const [who, blocker, blocked, stored] of [
    ['the owner blocks the requester', U.NOVA, U.KAI, 'CANCELLED'],
    ['the requester blocks the owner', U.KAI, U.NOVA, 'WITHDRAWN'],
  ] as const) {
    it(`${who}: the pending request ends ${stored} -- a deletion to the requester, a withdrawal to the owner; a third requester is untouched`, () => {
      const p = post(createSocialFixture(), U.NOVA);
      const kai = ask(p.state, U.KAI, p.postId);
      const orion = ask(kai.state, U.ORION, p.postId);
      const before = orion.state;
      const walled = block(before, blocker, blocked);
      expect(lffRequestById(walled, kai.requestId)?.status).toBe(stored);
      expect(lffRequestById(walled, orion.requestId)?.status, 'the control: a request the block does not cross').toBe('PENDING');
      // the requester: exactly what a deleted post leaves
      const deleted = must(run(before, U.NOVA, 'lff.post.delete', { ids: [p.postId] })).state;
      expect(mine(walled, U.KAI)).toEqual(mine(deleted, U.KAI));
      expect(mine(walled, U.KAI).requests).toEqual([]);
      expect(feedIds(walled, U.KAI)).toEqual(feedIds(deleted, U.KAI));
      expect(refused(run(walled, U.KAI, 'lff.post.get', { ids: [p.postId] }))).toEqual(missingPost(walled));
      expect(refused(run(walled, U.KAI, 'lff.request.withdraw', { ids: [kai.requestId] }))).toEqual(missingPost(walled));
      expect(refused(run(walled, U.KAI, 'lff.request.create', { ids: [p.postId] }))).toEqual(missingPost(walled));
      // the owner: exactly what a withdrawal leaves
      const withdrawn = must(run(before, U.KAI, 'lff.request.withdraw', { ids: [kai.requestId] })).state;
      expect(inbox(walled, U.NOVA, p.postId)).toEqual(inbox(withdrawn, U.NOVA, p.postId));
      expect(inbox(walled, U.NOVA, p.postId).requests.map((r) => r.requester.userId)).toEqual([U.ORION]);
      expect(detail(walled, U.NOVA, p.postId)).toEqual(detail(withdrawn, U.NOVA, p.postId));
      expect(refused(run(walled, U.NOVA, 'lff.request.accept', { ids: [kai.requestId] }))).toEqual(missingPost(walled));
      // the requester's own block IS their withdrawal: the very row a withdrawal at the same time leaves
      if (stored === 'WITHDRAWN') expect(lffRequestById(walled, kai.requestId)).toEqual(lffRequestById(withdrawn, kai.requestId));
      // an ended request outlives an unblock (as a revoked party invite does): the post comes back, the request does not
      const lifted = must(run(walled, blocker, 'blocks.remove', { ids: [blocked] })).state;
      expect(feedIds(lifted, U.KAI)).toContain(p.postId);
      expect(mine(lifted, U.KAI).requests).toEqual([]);
      expect(lffRequestById(lifted, kai.requestId)?.status).toBe(stored);
    });
  }

  it('SEC m-a: the requester blocks the owner, unblocks and asks again -- refused exactly as after a withdrawal until the cooldown ends; the owner sees a withdrawal throughout', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const kai = ask(p.state, U.KAI, p.postId);
    const before = kai.state;
    const lifted = must(run(block(before, U.KAI, U.NOVA), U.KAI, 'blocks.remove', { ids: [U.NOVA] })).state;
    const withdrawn = must(run(before, U.KAI, 'lff.request.withdraw', { ids: [kai.requestId] })).state;
    // the owner's views and the stored row: a withdrawal's
    expect(lffRequestById(lifted, kai.requestId)).toEqual(lffRequestById(withdrawn, kai.requestId));
    expect(inbox(lifted, U.NOVA, p.postId)).toEqual(inbox(withdrawn, U.NOVA, p.postId));
    expect(detail(lifted, U.NOVA, p.postId)).toEqual(detail(withdrawn, U.NOVA, p.postId));
    // asking again 1 min later: the SAME refusal as after a withdrawal; at the cooldown's end, accepted after either
    const oneMin = T0 + 60_000;
    const afterBlock = refused(run(lifted, U.KAI, 'lff.request.create', { ids: [p.postId] }, oneMin));
    expect(afterBlock).toEqual(refused(run(withdrawn, U.KAI, 'lff.request.create', { ids: [p.postId] }, oneMin)));
    expect(afterBlock.code).toBe('illegal-transition');
    const cooled = T0 + LFF_REREQUEST_COOLDOWN_MS;
    expect(run(lifted, U.KAI, 'lff.request.create', { ids: [p.postId] }, cooled).ok).toBe(true);
    expect(run(withdrawn, U.KAI, 'lff.request.create', { ids: [p.postId] }, cooled).ok).toBe(true);
  });

  it('SEC m-a, the other way: the OWNER blocks the requester and unblocks -- CANCELLED carries no cooldown (one would tell the requester of the block), so asking again 1 min later is accepted', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const kai = ask(p.state, U.KAI, p.postId);
    const lifted = must(run(block(kai.state, U.NOVA, U.KAI), U.NOVA, 'blocks.remove', { ids: [U.KAI] })).state;
    expect(lffRequestById(lifted, kai.requestId)?.status).toBe('CANCELLED');
    expect(run(lifted, U.KAI, 'lff.request.create', { ids: [p.postId] }, T0 + 60_000).ok).toBe(true);
  });

  it('the requester blocks the owner of a post they were ACCEPTED on: withdrawn, the slot freed -- the owner sees exactly a withdrawal', () => {
    const p = post(createSocialFixture(), U.NOVA, { openSlots: 3 });
    const kai = ask(p.state, U.KAI, p.postId);
    const before = accept(kai.state, U.NOVA, kai.requestId);
    expect(detail(before, U.NOVA, p.postId).availableSlots).toBe(2);
    const walled = block(before, U.KAI, U.NOVA);
    const withdrawn = must(run(before, U.KAI, 'lff.request.withdraw', { ids: [kai.requestId] })).state;
    expect(lffRequestById(walled, kai.requestId)).toEqual(lffRequestById(withdrawn, kai.requestId));
    expect(lffRequestById(walled, kai.requestId)?.status).toBe('WITHDRAWN');
    expect(detail(walled, U.NOVA, p.postId)).toEqual(detail(withdrawn, U.NOVA, p.postId));
    expect(detail(walled, U.NOVA, p.postId).availableSlots).toBe(3);
    expect(detail(walled, U.NOVA, p.postId).accepted).toEqual([]);
  });

  it('the owner blocks a requester they ACCEPTED: cancelled, the slot freed -- the requester reads exactly a deleted post', () => {
    const p = post(createSocialFixture(), U.NOVA, { openSlots: 3 });
    const kai = ask(p.state, U.KAI, p.postId);
    const before = accept(kai.state, U.NOVA, kai.requestId);
    const walled = block(before, U.NOVA, U.KAI);
    const deleted = must(run(before, U.NOVA, 'lff.post.delete', { ids: [p.postId] })).state;
    expect(lffRequestById(walled, kai.requestId)?.status).toBe('CANCELLED');
    expect(mine(walled, U.KAI)).toEqual(mine(deleted, U.KAI));
    expect(feedIds(walled, U.KAI)).toEqual(feedIds(deleted, U.KAI));
    expect(refused(run(walled, U.KAI, 'lff.post.get', { ids: [p.postId] }))).toEqual(missingPost(walled));
    expect(detail(walled, U.NOVA, p.postId).availableSlots).toBe(3);
  });

  it('old data carried across a block (a request the block path never saw): hidden from the owner, unacceptable, not withdrawable, told to nobody on the far side', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const kai = ask(p.state, U.KAI, p.postId);
    const orion = ask(kai.state, U.ORION, p.postId);
    expect(inbox(orion.state, U.NOVA, p.postId).requests.map((r) => r.requester.userId), 'the control, before the wall').toEqual([U.KAI, U.ORION]);
    const raw: SocialState = { ...orion.state, blocks: [...orion.state.blocks, { blockerId: U.NOVA, blockedId: U.KAI, sinceIso: FIXTURE_NOW }] };
    expect(lffRequestById(raw, kai.requestId)?.status).toBe('PENDING');
    expect(inbox(raw, U.NOVA, p.postId).requests.map((r) => r.requester.userId)).toEqual([U.ORION]);
    expect(mine(raw, U.KAI).requests).toEqual([]);
    expect(refused(run(raw, U.NOVA, 'lff.request.accept', { ids: [kai.requestId] }))).toEqual(missingPost(raw));
    expect(refused(run(raw, U.KAI, 'lff.request.withdraw', { ids: [kai.requestId] }))).toEqual(missingPost(raw));
    expect(run(raw, U.NOVA, 'lff.request.accept', { ids: [orion.requestId] }).ok).toBe(true);
    expect(run(raw, U.ORION, 'lff.request.withdraw', { ids: [orion.requestId] }).ok).toBe(true);
    const closed = must(run(raw, U.NOVA, 'lff.post.close', { ids: [p.postId] }));
    expect([...closed.audience].sort(), 'the block floor: the walled requester is not told').toEqual([U.NOVA, U.ORION].sort());
  });
});

describe('rule 2 (SEC-M2): a block\'s cancellation is TOLD exactly as the change it imitates -- silence is never the tell', () => {
  /** Nova posts; Vega, a stranger to her, asks to join. */
  function asked(): { state: SocialState; postId: string; requestId: string } {
    const p = post(createSocialFixture(), U.NOVA);
    const v = ask(p.state, U.VEGA, p.postId);
    return { state: v.state, postId: p.postId, requestId: v.requestId };
  }

  it('the requester blocks the owner: the owner\'s event stream is byte for byte the stream of a withdrawal', async () => {
    const a = asked();
    const blocked = await streamsAfter(a.state, [['blocks.add', U.VEGA, [], { targetId: U.NOVA }]], [U.NOVA, U.VEGA, U.KAI]);
    const withdrew = await streamsAfter(a.state, [['lff.request.withdraw', U.VEGA, [a.requestId], {}]], [U.NOVA, U.KAI]);
    expect(blocked[U.NOVA]).toBe(withdrew[U.NOVA]);
    expect(JSON.parse(blocked[U.NOVA])).toEqual([{ seq: 1, op: 'lff.request.withdraw', atIso: LATER }]);
    expect([blocked[U.KAI], withdrew[U.KAI]], 'a bystander hears nothing either way').toEqual(['[]', '[]']);
    expect(JSON.parse(blocked[U.VEGA]).map((e: { op: string }) => e.op), 'the blocker is told their block, as always').toEqual(['blocks.add']);
  });

  it('the owner blocks the requester: the requester\'s event stream is byte for byte the stream of the post\'s deletion', async () => {
    const a = asked();
    const blocked = await streamsAfter(a.state, [['blocks.add', U.NOVA, [], { targetId: U.VEGA }]], [U.VEGA, U.NOVA]);
    const deleted = await streamsAfter(a.state, [['lff.post.delete', U.NOVA, [a.postId], {}]], [U.VEGA]);
    expect(blocked[U.VEGA]).toBe(deleted[U.VEGA]);
    expect(JSON.parse(blocked[U.VEGA])).toEqual([{ seq: 1, op: 'lff.post.delete', atIso: LATER }]);
    expect(JSON.parse(blocked[U.NOVA]).map((e: { op: string }) => e.op)).toEqual(['blocks.add']);
  });

  it('the control: a block that crosses no LFF request tells the other side nothing, as before', async () => {
    const a = asked();
    const blocked = await streamsAfter(a.state, [['blocks.add', U.ORION, [], { targetId: U.VEGA }]], [U.VEGA, U.ORION]);
    expect(blocked[U.VEGA]).toBe('[]');
    expect(JSON.parse(blocked[U.ORION]).map((e: { op: string }) => e.op)).toEqual(['blocks.add']);
  });

  it('a fill is told to the other requesters byte for byte as a manual close (the op never says the post filled)', async () => {
    const p = post(createSocialFixture(), U.NOVA, { openSlots: 1 });
    const kai = ask(p.state, U.KAI, p.postId);
    const lyra = ask(kai.state, U.LYRA, p.postId);
    const filled = await streamsAfter(lyra.state, [['lff.request.accept', U.NOVA, [kai.requestId], {}]], [U.LYRA, U.KAI]);
    const closed = await streamsAfter(lyra.state, [['lff.post.close', U.NOVA, [p.postId], {}]], [U.LYRA]);
    expect(filled[U.LYRA]).toBe(closed[U.LYRA]);
    expect(JSON.parse(filled[U.LYRA])).toEqual([{ seq: 1, op: 'lff.post.close', atIso: LATER }]);
    expect(JSON.parse(filled[U.KAI]).map((e: { op: string }) => e.op), 'the accepted requester is told the accept').toEqual(['lff.request.accept']);
  });
});

describe('rule 3: a post is shown only to a viewer who may see its author -- there is no anonymous listing', () => {
  it('an author hidden from a viewer: the post is ABSENT for them (feed, get, request); a viewer the author admits sees it, named; showing again lists it again', () => {
    const p = post(hide(createSocialFixture(), U.NOVA, 'FRIENDS'), U.NOVA);
    const s = p.state;
    expect(feedIds(s, U.VEGA)).not.toContain(p.postId);
    expect(JSON.stringify(feed(s, U.VEGA))).not.toContain(U.NOVA);
    expect(refused(run(s, U.VEGA, 'lff.post.get', { ids: [p.postId] }))).toEqual(missingPost(s));
    expect(refused(run(s, U.VEGA, 'lff.request.create', { ids: [p.postId] }))).toEqual(missingPost(s));
    // the controls: a friend (Kai) is shown it, named, with the author's card
    expect(feedIds(s, U.KAI)).toContain(p.postId);
    expect(detail(s, U.KAI, p.postId).author.userId).toBe(U.NOVA);
    expect(detail(s, U.KAI, p.postId).authorProfile?.profile.userId).toBe(U.NOVA);
    const shown = hide(s, U.NOVA, 'EVERYONE');
    expect(detail(shown, U.VEGA, p.postId).author.userId).toBe(U.NOVA);
  });

  it('a block/unblock toggle teaches nothing: a hidden author\'s post stays absent through it, and a shown post already names its author', () => {
    const p = post(hide(createSocialFixture(), U.NOVA, 'FRIENDS'), U.NOVA);
    const toggled = must(run(block(p.state, U.VEGA, U.NOVA), U.VEGA, 'blocks.remove', { ids: [U.NOVA] })).state;
    for (const s of [p.state, block(p.state, U.VEGA, U.NOVA), toggled]) {
      expect(feedIds(s, U.VEGA)).not.toContain(p.postId);
      expect(refused(run(s, U.VEGA, 'lff.post.get', { ids: [p.postId] }))).toEqual(missingPost(s));
    }
  });

  it('every post any player is shown -- feed, detail -- names its real author; "A Wonderland player" is gone', () => {
    let s = hide(hide(createSocialFixture(), U.NOVA, 'FRIENDS'), U.ORION, 'NOBODY');
    const ids: string[] = [];
    for (const owner of [U.NOVA, U.ORION, U.RHEA, U.SOL, U.MIRA]) {
      const p = post(s, owner);
      s = p.state;
      ids.push(p.postId);
    }
    let shown = 0;
    for (const viewer of Object.values(U)) {
      const views: LffPostView[] = [...feed(s, viewer).posts];
      for (const id of ids) {
        const r = run(s, viewer, 'lff.post.get', { ids: [id] });
        if (r.ok) views.push(r.value.data as LffPostDetail);
      }
      for (const v of views) {
        expect(v.author.userId, `${viewer} ${v.postId}`).toBe(lffPostById(s, v.postId)!.ownerId);
        shown += 1;
      }
      expect(JSON.stringify(views), viewer).not.toContain('A Wonderland player');
    }
    expect(shown, 'the sweep saw real views').toBeGreaterThan(20);
  });

  it('every visible post can be reported through the existing reports.file: reportedId = its author, subjectRef = the post id', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const seen = feed(p.state, U.VEGA).posts.find((x) => x.postId === p.postId)!;
    const filed = must(run(p.state, U.VEGA, 'reports.file', { body: { reportedId: seen.author.userId, reason: 'INAPPROPRIATE_CONTENT', subjectRef: seen.postId } }));
    expect(filed.state.reports[filed.state.reports.length - 1]).toMatchObject({ reporterId: U.VEGA, reportedId: U.NOVA, reason: 'INAPPROPRIATE_CONTENT', subjectRef: p.postId });
    expect(filed.audience, 'a report is told to the reporter alone').toEqual([U.VEGA]);
    // the control: the existing flow needs the reported person -- which every visible post now gives
    expect(refused(run(p.state, U.VEGA, 'reports.file', { body: { reason: 'INAPPROPRIATE_CONTENT', subjectRef: p.postId } })).code).toBe('validation-failed');
  });

  it('every visible post has a visible author: an author who later hides from a user accepted on their post is no longer shown to them (the request keeps its word)', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const v = ask(p.state, U.VEGA, p.postId);
    const acc = accept(v.state, U.NOVA, v.requestId);
    expect(detail(acc, U.VEGA, p.postId).author.userId).toBe(U.NOVA);
    const hid = hide(acc, U.NOVA, 'FRIENDS');
    expect(refused(run(hid, U.VEGA, 'lff.post.get', { ids: [p.postId] }))).toEqual(missingPost(hid));
    expect(mine(hid, U.VEGA).requests.map((r) => [r.status, r.post])).toEqual([['ACCEPTED', null]]);
    expect(detail(hid, U.NOVA, p.postId).accepted?.map((r) => r.userId)).toEqual([U.VEGA]);
  });

  it('APPEAR_OFFLINE is not hiding: the post stays listed, its author named and reading exactly as a signed-out author (the M1 rule)', () => {
    // Sol appears offline and Juno is signed out (the fixture); both keep the default presence audience, EVERYONE
    const sol = post(createSocialFixture(), U.SOL);
    const juno = post(sol.state, U.JUNO);
    expect(feedIds(juno.state, U.VEGA)).toEqual(expect.arrayContaining([sol.postId, juno.postId]));
    const solRow = detail(juno.state, U.VEGA, sol.postId).author;
    const junoRow = detail(juno.state, U.VEGA, juno.postId).author;
    expect(solRow.userId).toBe(U.SOL);
    expect(solRow.presence.onlineState).toBe('OFFLINE');
    // everything but who it is and when they were last seen (each author's own time)
    const shape = (row: SocialPersonRow) => {
      const v = row.presence;
      return [v.onlineState, v.headline, v.activityLabel, v.location, v.partyId, v.can, v.restrictedReason, v.availability];
    };
    expect(shape(solRow)).toEqual(shape(junoRow));
  });

  it('the author row\'s activity and location follow the author\'s own audiences (Nova: friends only; Orion: everyone)', () => {
    const nova = post(createSocialFixture(), U.NOVA);
    const orion = post(nova.state, U.ORION);
    const s = orion.state;
    expect(detail(s, U.VEGA, nova.postId).author.presence.activityLabel).toBeNull();
    expect(detail(s, U.VEGA, nova.postId).author.presence.location).toBeNull();
    expect(detail(s, U.KAI, nova.postId).author.presence.activityLabel).toBe('Creating software · Weather dashboard');
    expect(detail(s, U.KAI, nova.postId).author.presence.location?.serverName).toBe('Golden Arrival');
    expect(detail(s, U.VEGA, orion.postId).author.presence.activityLabel).toBe('In GVE · Tower Lane arena');
    expect(detail(s, U.VEGA, nova.postId).author).toEqual(resolveRowFor(s, U.VEGA, U.NOVA));
  });
});

/** The row exactly as the presence authority builds it (social-preview.ts row), to prove LFF re-derives nothing. */
function resolveRowFor(s: SocialState, viewerId: string, userId: string) {
  const user = s.users[userId];
  return { userId, displayName: user.profile.displayName, handle: user.profile.handle, avatarRef: user.profile.avatarRef, presence: resolvePresenceFor(s, viewerId, userId) };
}

describe('no counts and no rosters', () => {
  it('availableSlots is the owner\'s alone; the accepted list is for the owner and the accepted users, null for everyone else', () => {
    const p = post(createSocialFixture(), U.NOVA, { openSlots: 3 });
    const kai = ask(p.state, U.KAI, p.postId);
    const orion = ask(kai.state, U.ORION, p.postId);
    const s = accept(orion.state, U.NOVA, kai.requestId);
    const owner = detail(s, U.NOVA, p.postId);
    expect([owner.availableSlots, owner.accepted?.map((r) => r.userId)]).toEqual([2, [U.KAI]]);
    const acceptedUser = detail(s, U.KAI, p.postId);
    expect([acceptedUser.availableSlots, acceptedUser.accepted?.map((r) => r.userId), acceptedUser.author.userId]).toEqual([null, [U.KAI], U.NOVA]);
    for (const viewer of [U.ORION, U.VEGA]) {
      const v = detail(s, viewer, p.postId);
      expect([v.availableSlots, v.accepted], viewer).toEqual([null, null]);
    }
    for (const viewer of [U.KAI, U.ORION, U.VEGA]) {
      const listed = feed(s, viewer).posts.find((x) => x.postId === p.postId)!;
      expect(listed.availableSlots, viewer).toBeNull();
      expect(Object.keys(listed), viewer).not.toContain('accepted');
    }
    expect(refused(run(s, U.KAI, 'lff.requests.forPost', { ids: [p.postId] }))).toEqual(missingPost(s));
  });

  it('two accepted users walled from each other are absent from each other\'s accepted list; the owner sees both', () => {
    const p = post(createSocialFixture(), U.NOVA, { openSlots: 3 });
    const kai = ask(p.state, U.KAI, p.postId);
    const mira = ask(kai.state, U.MIRA, p.postId); // Mira has blocked Kai
    const s = accept(accept(mira.state, U.NOVA, kai.requestId), U.NOVA, mira.requestId);
    expect(detail(s, U.NOVA, p.postId).accepted?.map((r) => r.userId)).toEqual([U.KAI, U.MIRA]);
    expect(detail(s, U.KAI, p.postId).accepted?.map((r) => r.userId)).toEqual([U.KAI]);
    expect(detail(s, U.MIRA, p.postId).accepted?.map((r) => r.userId)).toEqual([U.MIRA]);
    expect(JSON.stringify(detail(s, U.KAI, p.postId))).not.toContain(U.MIRA);
  });

  it('co-accepted users obey the visibility rule (SEC m5): a member who hides from the viewer is left out, never named; the owner sees everyone', () => {
    const p = post(hide(createSocialFixture(), U.VEGA, 'NOBODY'), U.NOVA, { openSlots: 3 });
    const kai = ask(p.state, U.KAI, p.postId);
    const vega = ask(kai.state, U.VEGA, p.postId);
    const s = accept(accept(vega.state, U.NOVA, kai.requestId), U.NOVA, vega.requestId);
    expect(detail(s, U.NOVA, p.postId).accepted?.map((r) => r.userId)).toEqual([U.KAI, U.VEGA]);
    expect(detail(s, U.KAI, p.postId).accepted?.map((r) => r.userId)).toEqual([U.KAI]);
    expect(JSON.stringify(detail(s, U.KAI, p.postId))).not.toContain(U.VEGA);
    expect(detail(s, U.VEGA, p.postId).accepted?.map((r) => r.userId), 'the control: Kai shows himself to everyone').toEqual([U.KAI, U.VEGA]);
  });

  it('no LFF view carries anything the social layer may never carry', () => {
    const p = post(createSocialFixture(), U.NOVA, { skills: ['UE5'], projectLabel: 'Sky Islands' });
    const kai = ask(p.state, U.KAI, p.postId);
    const s = accept(kai.state, U.NOVA, kai.requestId);
    const views = [feed(s, U.KAI), feed(s, U.NOVA, { mine: true }), detail(s, U.NOVA, p.postId), detail(s, U.KAI, p.postId), detail(s, U.VEGA, p.postId), mine(s, U.KAI), inbox(s, U.NOVA, p.postId)];
    const keys = allKeys(views);
    for (const forbidden of NEVER_SOCIAL_CONCERNS) expect(keys.has(forbidden), forbidden).toBe(false);
    expect(keys.has('postId')).toBe(true);
  });
});

describe('rule 6: LFF grants nothing and reaches no other writer', () => {
  const LFF_KEYS = new Set(['lffPosts', 'lffRequests', 'lffCreations', 'lffHeld', 'lffSnapshots', 'nextSerial']);
  const OTHER_KEYS = Object.keys(emptySocialState()).filter((k) => !LFF_KEYS.has(k)) as Array<keyof SocialState>;

  it('every LFF write leaves every other part of the social state the very same object, and asks for no world, server or voice write', () => {
    expect(OTHER_KEYS.length).toBeGreaterThan(10);
    let s = createSocialFixture();
    const steps: Array<[string, (st: SocialState) => Outcome]> = [];
    const p = post(s, U.NOVA, { openSlots: 2 });
    const postId = p.postId;
    let requestIds: string[] = [];
    steps.push(['create', (st) => run(st, U.NOVA, 'lff.post.create', { body: { category: 'DESIGNERS', title: 'x', openSlots: 1 } })]);
    steps.push(['edit', (st) => run(st, U.NOVA, 'lff.post.edit', { ids: [postId], body: { title: 'y' } })]);
    steps.push(['request', (st) => run(st, U.KAI, 'lff.request.create', { ids: [postId] })]);
    steps.push(['request 2', (st) => run(st, U.VEGA, 'lff.request.create', { ids: [postId] })]);
    steps.push(['request 3', (st) => run(st, U.ORION, 'lff.request.create', { ids: [postId] })]);
    steps.push(['decline', (st) => run(st, U.NOVA, 'lff.request.decline', { ids: [requestIds[2]] })]);
    steps.push(['accept', (st) => run(st, U.NOVA, 'lff.request.accept', { ids: [requestIds[0]] })]);
    steps.push(['withdraw', (st) => run(st, U.KAI, 'lff.request.withdraw', { ids: [requestIds[0]] })]);
    steps.push(['accept 2', (st) => run(st, U.NOVA, 'lff.request.accept', { ids: [requestIds[1]] })]);
    steps.push(['close', (st) => run(st, U.NOVA, 'lff.post.close', { ids: [postId] })]);
    steps.push(['delete', (st) => run(st, U.NOVA, 'lff.post.delete', { ids: [postId] })]);
    s = p.state;
    for (const [label, step] of steps) {
      const o = must(step(s));
      for (const key of OTHER_KEYS) expect(o.state[key], `${label}: ${key}`).toBe(s[key]);
      expect([o.world, o.eventOp, o.floorExempt, o.extraEvents], label).toEqual([undefined, undefined, undefined, undefined]);
      const made = (o.data as { requestId?: string } | null)?.requestId;
      if (made !== undefined) requestIds = [...requestIds, made];
      s = o.state;
    }
    expect(requestIds).toHaveLength(3);
    expect(lffPostById(s, postId)).toBeUndefined();
  });

  it('accept connects nobody: strangers stay strangers (no friendship, no conversation, no message or party right)', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const vega = ask(p.state, U.VEGA, p.postId);
    const before = vega.state;
    const after = accept(before, U.NOVA, vega.requestId);
    expect(after.lffRequests.filter((r) => r !== before.lffRequests.find((b) => b.id === r.id)).map((r) => r.id), 'only the accepted row changed').toEqual([vega.requestId]);
    for (const [viewer, subject] of [[U.NOVA, U.VEGA], [U.VEGA, U.NOVA]]) {
      expect(resolvePresenceFor(after, viewer, subject)).toEqual(resolvePresenceFor(before, viewer, subject));
      expect(resolvePresenceFor(after, viewer, subject)?.can.message).toBe(false);
      expect(resolvePresenceFor(after, viewer, subject)?.can.inviteToParty).toBe(false);
    }
    expect(Object.values(after.conversations).some((c) => c.memberIds.includes(U.NOVA) && c.memberIds.includes(U.VEGA))).toBe(false);
  });

  it('social-lff.ts imports only the social domain it needs; its runtime import graph reaches no repo, private server, agent, WonderFS, Project Brain, voice or persistence module', () => {
    const entry = join(__dirname, 'social-lff.ts');
    const direct = importsOf(entry).map((i) => `${i.typeOnly ? 'type ' : ''}${i.spec}`).sort();
    expect(direct).toEqual(['../protocol/errors', './social-presence', './social-state', 'type ./social-contracts', 'type ./social-preview'].sort());
    const graph = runtimeGraph(entry);
    const root = resolve(__dirname, '..');
    const files = graph.files.map((f) => relative(root, f).split('\\').join('/')).sort();
    expect(graph.packages, 'no package at all: the rules are pure').toEqual([]);
    for (const f of files) expect(f, f).not.toMatch(FORBIDDEN_MODULE);
    expect(files).toContain('social/social-lff.ts');
    // no import the static parse cannot see, in ANY file of the graph (SEC m11): no dynamic import, no require
    for (const f of graph.files) {
      const source = readFileSync(f, 'utf8');
      expect(source, f).not.toMatch(/\brequire\s*\(/);
      expect(source, f).not.toMatch(/\bimport\s*\(/);
    }
    // the controls: the pattern catches the writers it names, and the parser sees double quotes and side-effect imports
    for (const writer of ['persistence/social-postgres.ts', 'persistence/voice-binding-postgres.ts', 'social/world-presence.ts', 'social/voice-binding.ts', 'social/social-voice.ts']) {
      expect(writer, writer).toMatch(FORBIDDEN_MODULE);
    }
    expect(parseImports(`import "./x";\nimport { a } from "./y";\nimport type { B } from './z';\nexport * from './w';\nexport const q = 'from';\n`)).toEqual([
      { spec: './x', typeOnly: false },
      { spec: './y', typeOnly: false },
      { spec: './z', typeOnly: true },
      { spec: './w', typeOnly: false },
    ]);
  });
});

const FORBIDDEN_MODULE = /persistence|private-server|world-presence|voice|wonderfs|wfs|brain|julius|mission|agent|repo|workspace|connector|executor|mcp/i;

/** The static imports and re-exports in a source text, either quote, side-effect imports included; `import type` (erased) marked. */
function parseImports(source: string): { spec: string; typeOnly: boolean }[] {
  const out: { spec: string; typeOnly: boolean }[] = [];
  const pattern = /^\s*(?:import|export)\s+(type\s+)?(?:[^;'"]*?\bfrom\s+)?['"]([^'"]+)['"];/gm;
  for (let m = pattern.exec(source); m !== null; m = pattern.exec(source)) out.push({ spec: m[2], typeOnly: m[1] !== undefined });
  return out;
}

const importsOf = (file: string) => parseImports(readFileSync(file, 'utf8'));

/** Every file reached by RUNTIME imports from `entry`, and every package named. */
function runtimeGraph(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const { spec, typeOnly } of importsOf(file)) {
      if (typeOnly) continue;
      if (!spec.startsWith('.')) {
        packages.add(spec);
        continue;
      }
      const base = resolve(dirname(file), spec);
      queue.push(existsSync(`${base}.ts`) ? `${base}.ts` : join(base, 'index.ts'));
    }
  }
  return { files: [...files], packages: [...packages] };
}

describe('events: content-free, told only to whom the change concerns', () => {
  it('through the store: create, request and accept reach the owner and the requester only, each as {seq, op, atIso}; reads reach nobody', async () => {
    const store = createInMemorySocialStore(createSocialFixture());
    const input = (ids: string[], body: Record<string, unknown> = {}) => ({ ids, body, query: {} });
    const created = await store.apply('lff.post.create', U.NOVA, input([], { category: 'TEAMS', title: 'Squad', openSlots: 1 }), FIXTURE_NOW);
    expect(created.ok).toBe(true);
    const postId = (created as { ok: true; value: { postId: string } }).value.postId;
    const asked = await store.apply('lff.request.create', U.KAI, input([postId], { message: 'me' }), FIXTURE_NOW);
    const requestId = (asked as { ok: true; value: { requestId: string } }).value.requestId;
    expect((await store.apply('lff.feed.list', U.ORION, input([]), FIXTURE_NOW)).ok).toBe(true);
    expect((await store.apply('lff.post.get', U.VEGA, input([postId]), FIXTURE_NOW)).ok).toBe(true);
    expect((await store.apply('lff.request.accept', U.NOVA, input([requestId]), FIXTURE_NOW)).ok).toBe(true);
    const opsFor = async (userId: string) => (await store.eventsFor(userId, 0, 100)).events;
    const nova = await opsFor(U.NOVA);
    const kai = await opsFor(U.KAI);
    expect(nova.map((e) => e.op)).toEqual(['lff.post.create', 'lff.request.create', 'lff.request.accept']);
    expect(kai.map((e) => e.op)).toEqual(['lff.request.create', 'lff.request.accept']);
    for (const e of [...nova, ...kai]) expect(Object.keys(e).sort()).toEqual(['atIso', 'op', 'seq']);
    expect(await opsFor(U.ORION)).toEqual([]);
    expect(await opsFor(U.VEGA)).toEqual([]);
    const after = await store.read();
    expect(lffPostById(after, postId)?.status, 'one slot, filled: closed').toBe('CLOSED');
  });
});

describe('no seeded or fake posts; the preview shows no LFF data', () => {
  it('the fixture holds no LFF row and social-fixtures.ts names none; the snapshot of a state with posts is the snapshot without them', () => {
    const fixture = createSocialFixture();
    expect([fixture.lffPosts, fixture.lffRequests, fixture.lffCreations, fixture.lffHeld, fixture.lffSnapshots]).toEqual([[], [], [], [], []]);
    expect(readFileSync(join(__dirname, 'social-fixtures.ts'), 'utf8')).not.toMatch(/lff/i);
    const p = post(fixture, U.NOVA, { title: 'Unmistakable LFF title' });
    const kai = ask(p.state, U.KAI, p.postId);
    const mineToo = post(kai.state, U.KAI, { title: 'Kai LFF post' });
    const withLff = mineToo.state;
    for (const viewer of [U.KAI, U.NOVA]) {
      const plain = JSON.stringify(buildSocialView(fixture, viewer, FIXTURE_NOW, { developmentPreview: false }));
      const lff = JSON.stringify(buildSocialView(withLff, viewer, FIXTURE_NOW, { developmentPreview: false }));
      expect(lff, viewer).toBe(plain);
      expect(lff).not.toContain('Unmistakable LFF title');
      expect(lff).not.toContain(p.postId);
    }
  });
});

describe('D-L5 R-3: no player surface tells a HELD post from a DELETED one -- not the owner, a requester, a third party, the reporter, a walled or a hidden-from viewer', () => {
  /** Nova (owner), Orion (accepted), Kai (pending), Vega (declined), Lyra (the reporter), Rhea (a friend), Juno (walled from Nova), Mira. */
  const VIEWERS = [U.NOVA, U.ORION, U.KAI, U.VEGA, U.LYRA, U.RHEA, U.JUNO, U.MIRA];
  /** Lyra's report about Nova through the existing flow: naming `subjectRef`, or (every CONTROL here) naming no post. */
  const reportBody = (subjectRef: string | null): Record<string, unknown> => ({ reportedId: U.NOVA, reason: 'SPAM', ...(subjectRef === null ? {} : { subjectRef }) });

  /** Juno has blocked Nova. Nova's post: Orion asked and was accepted, Kai asked (pending), Vega asked and was declined. */
  function asked(): { state: SocialState; postId: string; requestIds: string[] } {
    const p = post(block(createSocialFixture(), U.JUNO, U.NOVA), U.NOVA, { openSlots: 3 });
    const o = ask(p.state, U.ORION, p.postId);
    const k = ask(o.state, U.KAI, p.postId);
    const v = ask(k.state, U.VEGA, p.postId);
    const s = must(run(accept(v.state, U.NOVA, o.requestId), U.NOVA, 'lff.request.decline', { ids: [v.requestId] })).state;
    return { state: s, postId: p.postId, requestIds: [o.requestId, k.requestId, v.requestId] };
  }

  /**
   * Lyra reports -- naming the post (it becomes evidence: the delete then HOLDS it) or naming none (an ordinary delete); Nova edits the
   * post (an evidence post's edit is snapshotted, M-1); optionally Nova then hides from strangers; and Nova deletes the post.
   */
  function deletedAfter(subject: 'the post' | 'no post', hideAfter = false): { state: SocialState; postId: string; requestIds: string[] } {
    const a = asked();
    let s = must(run(a.state, U.LYRA, 'reports.file', { body: reportBody(subject === 'the post' ? a.postId : null) })).state;
    s = must(run(s, U.NOVA, 'lff.post.edit', { ids: [a.postId], body: { title: 'Cleaned up' } }, T0 + 30_000)).state;
    if (hideAfter) s = hide(s, U.NOVA, 'FRIENDS');
    return { ...a, state: must(run(s, U.NOVA, 'lff.post.delete', { ids: [a.postId] }, T0 + 60_000)).state };
  }

  /**
   * EVERY LFF SURFACE each viewer has on the post and its requests, serialized: the feed, their own posts, the post, their own
   * requests, the owner's inbox, the answers asking, editing, closing, deleting, withdrawing, accepting and declining would give, the
   * answer to their next post (the open-post and creation caps), and their social snapshot.
   */
  function surfaces(s: SocialState, postId: string, requestIds: readonly string[]): string {
    const at = T0 + 120_000;
    const answer = (r: Outcome) => (r.ok ? { ok: true, data: r.value.data, audience: r.value.audience, extra: r.value.extraEvents ?? null } : { ok: false, error: r.error });
    const out: Record<string, unknown> = {};
    for (const v of VIEWERS) {
      const on = (op: SocialOperationId, ids: string[] = [], body: Record<string, unknown> = {}) => answer(run(s, v, op, { ids, body }, at));
      out[v] = {
        feed: on('lff.feed.list'),
        ownPosts: on('lff.feed.list', [], { mine: true }),
        get: on('lff.post.get', [postId]),
        myRequests: on('lff.requests.mine'),
        inbox: on('lff.requests.forPost', [postId]),
        ask: on('lff.request.create', [postId]),
        edit: on('lff.post.edit', [postId], { title: 'x' }),
        close: on('lff.post.close', [postId]),
        delete: on('lff.post.delete', [postId]),
        requests: requestIds.map((id) => [on('lff.request.withdraw', [id]), on('lff.request.accept', [id]), on('lff.request.decline', [id])]),
        nextPost: on('lff.post.create', [], { category: 'TEAMS', title: 'Next', openSlots: 1 }),
        snapshot: buildSocialView(s, v, new Date(at).toISOString(), { developmentPreview: false }),
      };
    }
    return JSON.stringify(out);
  }

  /** The WHOLE state but the evidence (lffHeld, lffSnapshots) and a report's subject: what the two branches may differ in, and only that. */
  const comparable = (s: SocialState): SocialState => ({ ...s, lffHeld: [], lffSnapshots: [], reports: s.reports.map((r) => ({ ...r, subjectRef: null })) });

  for (const hideAfter of [false, true]) {
    it(`every surface of every viewer, and the whole state but the evidence, are an ordinary delete's, while the evidence is kept${hideAfter ? ' (Nova hides from strangers before deleting)' : ''}`, () => {
      const held = deletedAfter('the post', hideAfter);
      const deleted = deletedAfter('no post', hideAfter);
      expect(held.state.lffHeld.map((h) => [h.post.id, h.post.title]), 'held, as last written').toEqual([[held.postId, 'Cleaned up']]);
      expect(held.state.lffHeld[0].requests.map((r) => r.id)).toEqual(held.requestIds);
      expect(held.state.lffSnapshots.map((x) => [x.seq, x.cause, x.post.title]), 'as reported, then as edited').toEqual([[1, 'REPORTED', 'Looking for a squad'], [2, 'EDITED', 'Cleaned up']]);
      expect([deleted.state.lffHeld, deleted.state.lffSnapshots]).toEqual([[], []]);
      expect([held.postId, held.requestIds]).toEqual([deleted.postId, deleted.requestIds]);
      expect(surfaces(held.state, held.postId, held.requestIds)).toBe(surfaces(deleted.state, deleted.postId, deleted.requestIds));
      expect(comparable(held.state), 'the whole state but the evidence (security review m-9)').toEqual(comparable(deleted.state));
    });
  }

  it('THE CONTROLS: the same comparisons FAIL for a post only reported (not deleted), and for a leaky "hold" that left the post on a player surface', () => {
    const deleted = deletedAfter('no post');
    const reference = surfaces(deleted.state, deleted.postId, deleted.requestIds);
    const a = asked();
    const onlyReported = must(run(a.state, U.LYRA, 'reports.file', { body: reportBody(a.postId) })).state;
    expect(surfaces(onlyReported, a.postId, a.requestIds), 'a post still there').not.toBe(reference);
    expect(comparable(onlyReported), 'the whole state too').not.toEqual(comparable(deleted.state));
    const held = deletedAfter('the post');
    const kept = held.state.lffHeld[0];
    const leaky: SocialState = { ...held.state, lffPosts: [...held.state.lffPosts, kept.post], lffRequests: [...held.state.lffRequests, ...kept.requests] };
    expect(surfaces(leaky, held.postId, held.requestIds), 'a hold that a player could see').not.toBe(reference);
    expect(comparable(leaky)).not.toEqual(comparable(deleted.state));
  });

  it('every viewer\'s event stream through the store is byte for byte an ordinary delete\'s; the control (a close instead of a delete) shows the streams can differ', async () => {
    const a = asked();
    const steps = (subjectRef: string | null, last: SocialOperationId): Array<[SocialOperationId, string, string[], Record<string, unknown>]> => [
      ['reports.file', U.LYRA, [], reportBody(subjectRef)],
      ['lff.post.edit', U.NOVA, [a.postId], { title: 'Cleaned up' }],
      [last, U.NOVA, [a.postId], {}],
    ];
    const held = await streamsAfter(a.state, steps(a.postId, 'lff.post.delete'), VIEWERS);
    const deleted = await streamsAfter(a.state, steps(null, 'lff.post.delete'), VIEWERS);
    expect(held).toEqual(deleted);
    expect(JSON.parse(held[U.ORION]), 'the accepted requester is told a delete').toEqual([{ seq: 3, op: 'lff.post.delete', atIso: LATER }]);
    expect(JSON.parse(held[U.VEGA]), 'the declined one, nothing').toEqual([]);
    const closed = await streamsAfter(a.state, steps(null, 'lff.post.close'), VIEWERS);
    expect(closed[U.ORION], 'the control').not.toBe(deleted[U.ORION]);
  });
});
