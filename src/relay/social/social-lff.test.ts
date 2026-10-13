import { describe, expect, it } from 'vitest';
import type { RelayError, RelayResult } from '../protocol/errors';
import { applySocialOperation, type SocialCommandOutcome } from './social-commands';
import type { SocialOperationId } from './social-contracts';
import { FIXTURE_NOW, FIXTURE_USERS as U, createSocialFixture } from './social-fixtures';
import {
  LFF_CATEGORIES,
  LFF_CREATION_WINDOW_MS,
  LFF_DECLINE_COOLDOWN_MS,
  LFF_MAX_CREATED_PER_WINDOW,
  LFF_MAX_OPEN_POSTS_PER_USER,
  LFF_MAX_PENDING_OUTGOING_PER_USER,
  LFF_MAX_PENDING_PER_POST,
  LFF_NOT_FOUND_MESSAGE,
  LFF_POST_TTL_MS,
  LFF_PURGE_BATCH,
  LFF_REREQUEST_COOLDOWN_MS,
  LFF_RETENTION_MS,
  lffPostStatusAt,
  purgeLffPastRetention,
  type LffFeedPage,
  type LffPost,
  type LffMyRequests,
  type LffPostDetail,
  type LffPostRequests,
} from './social-lff';
import { lffPostById, lffRequestById, type SocialState } from './social-state';
import { ensureSocialUser } from './social-store';

/*
 * LFF, THE LOOKING FOR FEED: the rules (social-lff.ts) through the one dispatcher (applySocialOperation), as the routes call them.
 * Every refusal here stands beside a control that is ACCEPTED, so a refusal cannot pass for the wrong reason. Privacy (walls,
 * visibility, rosters, events, the import sweep) is social-lff-privacy.test.ts.
 */

const T0 = Date.parse(FIXTURE_NOW);
const MIN = 60_000;

type Outcome = RelayResult<SocialCommandOutcome>;

function run(s: SocialState, actor: string, op: SocialOperationId, opts: { ids?: string[]; body?: Record<string, unknown>; query?: Record<string, string> } = {}, nowMs = T0): Outcome {
  return applySocialOperation(s, op, actor, { ids: opts.ids ?? [], body: opts.body ?? {}, query: opts.query ?? {} }, new Date(nowMs).toISOString());
}

function must(r: Outcome): SocialCommandOutcome {
  if (!r.ok) throw new Error(`expected success, got ${r.error.code}: ${r.error.message}`);
  return r.value;
}

function refused(r: Outcome): RelayError {
  if (r.ok) throw new Error('expected a refusal, got success');
  return r.error;
}

const BASE = { category: 'BUILDERS', title: 'Need a level designer', openSlots: 2 };

function post(s: SocialState, owner: string, body: Record<string, unknown> = {}, nowMs = T0): { state: SocialState; postId: string } {
  const o = must(run(s, owner, 'lff.post.create', { body: { ...BASE, ...body } }, nowMs));
  return { state: o.state, postId: (o.data as { postId: string }).postId };
}

function ask(s: SocialState, requester: string, postId: string, body: Record<string, unknown> = {}, nowMs = T0): { state: SocialState; requestId: string } {
  const o = must(run(s, requester, 'lff.request.create', { ids: [postId], body }, nowMs));
  return { state: o.state, requestId: (o.data as { requestId: string }).requestId };
}

const feed = (s: SocialState, viewer: string, filter: Record<string, unknown> = {}, nowMs = T0, query: Record<string, string> = {}): LffFeedPage =>
  must(run(s, viewer, 'lff.feed.list', { body: filter, query }, nowMs)).data as LffFeedPage;
const detail = (s: SocialState, viewer: string, postId: string, nowMs = T0): LffPostDetail => must(run(s, viewer, 'lff.post.get', { ids: [postId] }, nowMs)).data as LffPostDetail;
const mine = (s: SocialState, viewer: string, nowMs = T0): LffMyRequests => must(run(s, viewer, 'lff.requests.mine', {}, nowMs)).data as LffMyRequests;
const inbox = (s: SocialState, owner: string, postId: string): LffPostRequests => must(run(s, owner, 'lff.requests.forPost', { ids: [postId] })).data as LffPostRequests;

/** The answer for a post that does not exist: every "not yours / not there" answer must equal it byte for byte. */
const missingPost = (s: SocialState) => refused(run(s, U.KAI, 'lff.post.get', { ids: ['lffp_999999'] }));

const cp = (n: number, ch = 'a') => ch.repeat(n);
const DOG = String.fromCodePoint(0x1f415);

/** A state with `n` more players, `p0` … `p<n-1>`, each with the default privacy. */
function withPlayers(s: SocialState, n: number): { state: SocialState; ids: string[] } {
  let state = s;
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const userId = `usr_p${i}`;
    state = ensureSocialUser(state, { userId, displayName: `P${i}`, handle: `p${i}` }, FIXTURE_NOW);
    ids.push(userId);
  }
  return { state, ids };
}

describe('LFF create', () => {
  it('creates an OPEN post with server times, a 14-day expiry, version 1, told to the owner alone', () => {
    const o = must(run(createSocialFixture(), U.KAI, 'lff.post.create', {
      body: { category: 'TEAMS', title: '  Squad for GVE  ', description: 'Evenings, EU', projectLabel: 'Tower Lane', skills: ['UE5', ' Blender '], openSlots: 3 },
    }));
    const postId = (o.data as { postId: string }).postId;
    expect(postId).toMatch(/^lffp_\d+$/);
    expect(o.audience).toEqual([U.KAI]);
    expect(o.extraEvents).toBeUndefined();
    const stored = lffPostById(o.state, postId)!;
    expect(stored).toEqual({
      id: postId,
      ownerId: U.KAI,
      category: 'TEAMS',
      title: 'Squad for GVE',
      description: 'Evenings, EU',
      projectLabel: 'Tower Lane',
      skills: ['UE5', 'Blender'],
      openSlots: 3,
      status: 'OPEN',
      createdAtMs: T0,
      updatedAtMs: T0,
      expiresAtMs: T0 + LFF_POST_TTL_MS,
      version: 1,
    });
    expect(LFF_POST_TTL_MS).toBe(14 * 24 * 60 * 60_000);
    expect(o.state.lffCreations).toEqual([{ userId: U.KAI, postId, atMs: T0 }]);
    const view = detail(o.state, U.KAI, postId);
    expect(view.status).toBe('OPEN');
    expect(view.createdAtIso).toBe(FIXTURE_NOW);
    expect(view.viewerIsOwner).toBe(true);
    expect(view.availableSlots).toBe(3);
    expect(view.author.userId).toBe(U.KAI);
  });

  it('leaves description, projectLabel and skills empty when they are not sent', () => {
    const p = post(createSocialFixture(), U.KAI);
    const stored = lffPostById(p.state, p.postId)!;
    expect([stored.description, stored.projectLabel, stored.skills]).toEqual(['', '', []]);
  });
});

describe('LFF validation (contract rule 7): each bound at the edge is accepted, one past it refused', () => {
  const create = (body: Record<string, unknown>) => run(createSocialFixture(), U.KAI, 'lff.post.create', { body });
  const code = (r: Outcome) => (r.ok ? 'ok' : r.error.code);

  it('category: each of the six is accepted; anything else, or none, is refused', () => {
    for (const category of LFF_CATEGORIES) expect(code(create({ ...BASE, category })), category).toBe('ok');
    expect(LFF_CATEGORIES).toEqual(['TEAMS', 'BUILDERS', 'AI_ENGINEERS', 'DESIGNERS', 'COMPETITORS', 'COLLABORATORS']);
    for (const category of ['GAMERS', 'teams', '', 3]) expect(code(create({ ...BASE, category })), String(category)).toBe('validation-failed');
    expect(code(create({ title: BASE.title, openSlots: BASE.openSlots }))).toBe('validation-failed');
  });

  it('title: 1 and 80 code points accepted; empty, blank and 81 refused; an emoji counts as ONE', () => {
    expect(code(create({ ...BASE, title: 'a' }))).toBe('ok');
    expect(code(create({ ...BASE, title: cp(80) }))).toBe('ok');
    expect(code(create({ ...BASE, title: cp(80, DOG) })), '80 emoji = 160 UTF-16 units, 80 code points').toBe('ok');
    expect(code(create({ ...BASE, title: cp(81) }))).toBe('validation-failed');
    expect(code(create({ ...BASE, title: cp(81, DOG) }))).toBe('validation-failed');
    expect(code(create({ ...BASE, title: '' }))).toBe('validation-failed');
    expect(code(create({ ...BASE, title: '    ' }))).toBe('validation-failed');
    expect(code(create({ ...BASE, title: 42 }))).toBe('validation-failed');
    expect(code(create({ category: BASE.category, openSlots: BASE.openSlots }))).toBe('validation-failed');
  });

  it('description: 0 and 1000 accepted; 1001 refused', () => {
    expect(code(create({ ...BASE, description: '' }))).toBe('ok');
    expect(code(create({ ...BASE, description: cp(1000) }))).toBe('ok');
    expect(code(create({ ...BASE, description: cp(1001) }))).toBe('validation-failed');
  });

  it('projectLabel: 0 and 80 accepted; 81 refused', () => {
    expect(code(create({ ...BASE, projectLabel: '' }))).toBe('ok');
    expect(code(create({ ...BASE, projectLabel: cp(80) }))).toBe('ok');
    expect(code(create({ ...BASE, projectLabel: cp(81) }))).toBe('validation-failed');
  });

  it('skills: 0 and 8 items accepted, 9 refused; an item of 1 and 32 accepted, empty and 33 refused; never anything but a list of text', () => {
    expect(code(create({ ...BASE, skills: [] }))).toBe('ok');
    expect(code(create({ ...BASE, skills: Array.from({ length: 8 }, (_, i) => `s${i}`) }))).toBe('ok');
    expect(code(create({ ...BASE, skills: Array.from({ length: 9 }, (_, i) => `s${i}`) }))).toBe('validation-failed');
    expect(code(create({ ...BASE, skills: ['x', cp(32)] }))).toBe('ok');
    expect(code(create({ ...BASE, skills: [cp(33)] }))).toBe('validation-failed');
    expect(code(create({ ...BASE, skills: [''] }))).toBe('validation-failed');
    expect(code(create({ ...BASE, skills: [' '] }))).toBe('validation-failed');
    expect(code(create({ ...BASE, skills: 'UE5' }))).toBe('validation-failed');
    expect(code(create({ ...BASE, skills: [7] }))).toBe('validation-failed');
  });

  it('openSlots: 1 and 20 accepted; 0, 21, a fraction, a string and none refused', () => {
    expect(code(create({ ...BASE, openSlots: 1 }))).toBe('ok');
    expect(code(create({ ...BASE, openSlots: 20 }))).toBe('ok');
    for (const openSlots of [0, 21, 1.5, '3', -1]) expect(code(create({ ...BASE, openSlots })), String(openSlots)).toBe('validation-failed');
    expect(code(create({ category: BASE.category, title: BASE.title }))).toBe('validation-failed');
  });

  it('an unknown field is refused (an owner id among them: the actor is the session), beside the same body without it', () => {
    expect(code(create(BASE))).toBe('ok');
    for (const extra of [{ ownerId: U.KAI }, { priority: 1 }, { status: 'CLOSED' }, { expiresAtMs: 0 }]) {
      const r = create({ ...BASE, ...extra });
      expect(code(r), JSON.stringify(extra)).toBe('validation-failed');
    }
    // a key that is not a plain identifier is never repeated back verbatim (it could carry a control character)
    const weird = refused(create({ ...BASE, [`x${String.fromCharCode(10)}y`]: 1 }));
    expect(weird.message).toBe('a field is not one this operation takes');
  });

  it('every other LFF operation refuses an unknown field, in the body or the query; the same call without it is accepted', () => {
    const p = post(createSocialFixture(), U.NOVA, { openSlots: 3 });
    const a = ask(p.state, U.KAI, p.postId);
    const s = a.state;
    const calls: Array<[SocialOperationId, string, string[], Record<string, unknown>]> = [
      ['lff.post.get', U.KAI, [p.postId], {}],
      ['lff.requests.mine', U.KAI, [], {}],
      ['lff.requests.forPost', U.NOVA, [p.postId], {}],
      ['lff.post.edit', U.NOVA, [p.postId], { title: 'x' }],
      ['lff.post.close', U.NOVA, [p.postId], {}],
      ['lff.post.delete', U.NOVA, [p.postId], {}],
      ['lff.post.create', U.NOVA, [], BASE],
      ['lff.request.withdraw', U.KAI, [a.requestId], {}],
      ['lff.request.accept', U.NOVA, [a.requestId], {}],
      ['lff.request.decline', U.NOVA, [a.requestId], {}],
    ];
    for (const [op, actor, ids, body] of calls) {
      expect(refused(run(s, actor, op, { ids, body: { ...body, extra: 1 } })).code, `${op} body`).toBe('validation-failed');
      expect(refused(run(s, actor, op, { ids, body, query: { extra: '1' } })).code, `${op} query`).toBe('validation-failed');
      expect(run(s, actor, op, { ids, body }).ok, `${op} control`).toBe(true);
    }
  });

  it('the request message: absent, empty and 200 accepted; 201 refused; an unknown field refused', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const req = (body: Record<string, unknown>) => run(p.state, U.KAI, 'lff.request.create', { ids: [p.postId], body });
    expect(code(req({}))).toBe('ok');
    expect(code(req({ message: '' }))).toBe('ok');
    expect(code(req({ message: cp(200) }))).toBe('ok');
    expect(code(req({ message: cp(200, DOG) }))).toBe('ok');
    expect(code(req({ message: cp(201) }))).toBe('validation-failed');
    expect(code(req({ message: 'hi', note: 'x' }))).toBe('validation-failed');
    const kept = must(req({ message: '  Can I join?  ' }));
    expect(kept.state.lffRequests[kept.state.lffRequests.length - 1].message).toBe('Can I join?');
  });

  it('a C1 control (U+0080-U+009F) is refused in every LFF text field, as PostgreSQL [[:cntrl:]] would; U+00A0 beside it is accepted', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const sends: Array<[string, (text: string) => Outcome]> = [
      ['title', (t) => create({ ...BASE, title: t })],
      ['description', (t) => create({ ...BASE, description: t })],
      ['projectLabel', (t) => create({ ...BASE, projectLabel: t })],
      ['skills[0]', (t) => create({ ...BASE, skills: [t] })],
      ['message', (t) => run(p.state, U.KAI, 'lff.request.create', { ids: [p.postId], body: { message: t } })],
    ];
    for (const [field, send] of sends) {
      for (const c1 of [0x80, 0x85, 0x9f]) {
        const e = refused(send(`a${String.fromCharCode(c1)}b`));
        expect(e.code, `${field} U+${c1.toString(16)}`).toBe('validation-failed');
        expect(e.message).toBe(`${field} must not contain a control character or a line break`);
      }
      expect(code(send(`a${String.fromCharCode(0xa0)}b`)), `${field} U+00A0`).toBe('ok');
    }
  });

  it('an unpaired surrogate is refused (PostgreSQL would store U+FFFD in its place); a whole pair is accepted', () => {
    for (const lone of [0xd800, 0xdbff, 0xdc00, 0xdfff]) {
      const e = refused(create({ ...BASE, title: `a${String.fromCharCode(lone)}b` }));
      expect(e).toEqual({ code: 'validation-failed', message: 'title is not valid text' });
    }
    expect(refused(create({ ...BASE, title: `ab${String.fromCharCode(0xd83d)}` })).message, 'a high surrogate at the very end').toBe('title is not valid text');
    expect(code(create({ ...BASE, title: `a${DOG}b` }))).toBe('ok');
  });

  it('a control character is refused with the SAME words social-commands uses for every other text a player writes', () => {
    const lf = String.fromCharCode(10);
    const lff = refused(create({ ...BASE, title: `a${lf}b` }));
    const party = refused(run(createSocialFixture(), U.KAI, 'parties.create', { body: { name: `a${lf}b` } }));
    expect(lff.code).toBe(party.code);
    expect(lff.message.replace(/^title /, '')).toBe(party.message.replace(/^name /, ''));
    const nul = refused(create({ ...BASE, title: `a${String.fromCharCode(0)}b` }));
    const partyNul = refused(run(createSocialFixture(), U.KAI, 'parties.create', { body: { name: `a${String.fromCharCode(0)}b` } }));
    expect(nul.message.replace(/^title /, '')).toBe(partyNul.message.replace(/^name /, ''));
  });
});

describe('LFF edit', () => {
  it('the owner edits an OPEN post: the fields change, the version moves, told to the owner alone', () => {
    const p = post(createSocialFixture(), U.KAI);
    const o = must(run(p.state, U.KAI, 'lff.post.edit', { ids: [p.postId], body: { title: 'Need two level designers', skills: ['Hammer'], openSlots: 4 } }, T0 + MIN));
    const stored = lffPostById(o.state, p.postId)!;
    expect([stored.title, stored.skills, stored.openSlots, stored.version, stored.updatedAtMs, stored.createdAtMs]).toEqual(['Need two level designers', ['Hammer'], 4, 2, T0 + MIN, T0]);
    expect(stored.category).toBe('BUILDERS');
    expect(o.audience).toEqual([U.KAI]);
    expect(o.extraEvents).toBeUndefined();
  });

  it('a non-owner editing is answered exactly as a missing post; the owner, same body, is accepted', () => {
    const p = post(createSocialFixture(), U.KAI);
    const e = refused(run(p.state, U.NOVA, 'lff.post.edit', { ids: [p.postId], body: { title: 'mine now' } }));
    expect(e).toEqual(missingPost(p.state));
    expect(e).toEqual({ code: 'not-found', message: LFF_NOT_FOUND_MESSAGE });
    expect(run(p.state, U.KAI, 'lff.post.edit', { ids: [p.postId], body: { title: 'mine now' } }).ok).toBe(true);
  });

  it('an edit after close is refused; before the close the same edit is accepted', () => {
    const p = post(createSocialFixture(), U.KAI);
    expect(run(p.state, U.KAI, 'lff.post.edit', { ids: [p.postId], body: { title: 'x' } }).ok).toBe(true);
    const closed = must(run(p.state, U.KAI, 'lff.post.close', { ids: [p.postId] })).state;
    expect(refused(run(closed, U.KAI, 'lff.post.edit', { ids: [p.postId], body: { title: 'x' } })).code).toBe('illegal-transition');
  });

  it('an edit at exactly expiresAtMs is accepted; one millisecond later the post is EXPIRED and the edit refused', () => {
    const p = post(createSocialFixture(), U.KAI);
    const expiry = lffPostById(p.state, p.postId)!.expiresAtMs;
    expect(run(p.state, U.KAI, 'lff.post.edit', { ids: [p.postId], body: { title: 'x' } }, expiry).ok).toBe(true);
    expect(refused(run(p.state, U.KAI, 'lff.post.edit', { ids: [p.postId], body: { title: 'x' } }, expiry + 1)).code).toBe('illegal-transition');
  });

  it('an empty edit is refused; any one field is accepted', () => {
    const p = post(createSocialFixture(), U.KAI);
    expect(refused(run(p.state, U.KAI, 'lff.post.edit', { ids: [p.postId], body: {} })).code).toBe('validation-failed');
    expect(run(p.state, U.KAI, 'lff.post.edit', { ids: [p.postId], body: { description: '' } }).ok).toBe(true);
  });

  it('slots may not drop below those already accepted; dropping to exactly them fills and closes the post, told to every live requester as a close', () => {
    const p = post(createSocialFixture(), U.KAI, { openSlots: 3 });
    const a = ask(p.state, U.NOVA, p.postId);
    const b = ask(a.state, U.ORION, p.postId);
    const c = ask(b.state, U.LYRA, p.postId);
    let s = must(run(c.state, U.KAI, 'lff.request.accept', { ids: [a.requestId] })).state;
    s = must(run(s, U.KAI, 'lff.request.accept', { ids: [b.requestId] })).state;
    expect(refused(run(s, U.KAI, 'lff.post.edit', { ids: [p.postId], body: { openSlots: 1 } })).code).toBe('validation-failed');
    const filled = must(run(s, U.KAI, 'lff.post.edit', { ids: [p.postId], body: { openSlots: 2 } }));
    expect(lffPostById(filled.state, p.postId)!.status).toBe('CLOSED');
    expect(filled.audience).toEqual([U.KAI]);
    expect(filled.extraEvents).toEqual([{ op: 'lff.post.close', audience: [U.NOVA, U.ORION, U.LYRA] }]);
    // the control: an edit that does not fill tells nobody else
    expect(must(run(s, U.KAI, 'lff.post.edit', { ids: [p.postId], body: { openSlots: 3, title: 'y' } })).extraEvents).toBeUndefined();
  });
});

describe('LFF close and delete', () => {
  it('the owner closes an OPEN post (version +1), told to the owner and every live requester; a second close is refused', () => {
    const p = post(createSocialFixture(), U.KAI, { openSlots: 3 });
    const a = ask(p.state, U.NOVA, p.postId);
    const b = ask(a.state, U.ORION, p.postId);
    const accepted = must(run(b.state, U.KAI, 'lff.request.accept', { ids: [b.requestId] })).state;
    const c = ask(accepted, U.LYRA, p.postId);
    const withdrawn = must(run(c.state, U.LYRA, 'lff.request.withdraw', { ids: [c.requestId] })).state;
    const o = must(run(withdrawn, U.KAI, 'lff.post.close', { ids: [p.postId] }, T0 + MIN));
    expect(lffPostById(o.state, p.postId)).toMatchObject({ status: 'CLOSED', version: 2, updatedAtMs: T0 + MIN });
    expect([...o.audience].sort()).toEqual([U.KAI, U.NOVA, U.ORION].sort());
    expect(refused(run(o.state, U.KAI, 'lff.post.close', { ids: [p.postId] })).code).toBe('illegal-transition');
    // the pending requester may no longer see the closed post; the accepted one still may
    expect(mine(o.state, U.NOVA).requests.map((r) => [r.status, r.post])).toEqual([['NO_LONGER_AVAILABLE', null]]);
    expect(mine(o.state, U.ORION).requests.map((r) => [r.status, r.post?.status])).toEqual([['ACCEPTED', 'CLOSED']]);
  });

  it('a non-owner close or delete is answered exactly as a missing post; the owner is accepted', () => {
    const p = post(createSocialFixture(), U.KAI);
    expect(refused(run(p.state, U.NOVA, 'lff.post.close', { ids: [p.postId] }))).toEqual(missingPost(p.state));
    expect(refused(run(p.state, U.NOVA, 'lff.post.delete', { ids: [p.postId] }))).toEqual(missingPost(p.state));
    expect(run(p.state, U.KAI, 'lff.post.close', { ids: [p.postId] }).ok).toBe(true);
    expect(run(p.state, U.KAI, 'lff.post.delete', { ids: [p.postId] }).ok).toBe(true);
  });

  it('delete is a HARD delete: the post and every request to it go; another post and its requests stay', () => {
    const p = post(createSocialFixture(), U.KAI);
    const q = post(p.state, U.NOVA);
    const a = ask(q.state, U.NOVA, p.postId);
    const b = ask(a.state, U.ORION, p.postId);
    const other = ask(b.state, U.KAI, q.postId);
    const o = must(run(other.state, U.KAI, 'lff.post.delete', { ids: [p.postId] }));
    expect(lffPostById(o.state, p.postId)).toBeUndefined();
    expect(lffRequestById(o.state, a.requestId)).toBeUndefined();
    expect(lffRequestById(o.state, b.requestId)).toBeUndefined();
    expect(o.state.lffRequests.filter((r) => r.postId === p.postId)).toEqual([]);
    expect(lffPostById(o.state, q.postId)).toBeDefined();
    expect(lffRequestById(o.state, other.requestId)?.status).toBe('PENDING');
    expect([...o.audience].sort()).toEqual([U.KAI, U.NOVA, U.ORION].sort());
    // afterwards the post is simply missing, for everyone, the owner included
    expect(refused(run(o.state, U.KAI, 'lff.post.get', { ids: [p.postId] }))).toEqual(missingPost(o.state));
    expect(refused(run(o.state, U.NOVA, 'lff.request.withdraw', { ids: [a.requestId] }))).toEqual(missingPost(o.state));
  });

  it('a closed or expired post may still be deleted by its owner', () => {
    const p = post(createSocialFixture(), U.KAI);
    const closed = must(run(p.state, U.KAI, 'lff.post.close', { ids: [p.postId] })).state;
    expect(run(closed, U.KAI, 'lff.post.delete', { ids: [p.postId] }).ok).toBe(true);
    expect(run(p.state, U.KAI, 'lff.post.delete', { ids: [p.postId] }, T0 + LFF_POST_TTL_MS + 1).ok).toBe(true);
  });
});

describe('LFF feed: OPEN posts only, newest first, filtered, paged by a server cursor', () => {
  /** Kai's friends post at minutes 0..3; Nova's two share a millisecond (the serial breaks the tie); Lyra's is closed. */
  function seeded(): { state: SocialState; ids: Record<string, string> } {
    let s = createSocialFixture();
    const ids: Record<string, string> = {};
    const add = (key: string, owner: string, body: Record<string, unknown>, minute: number) => {
      const p = post(s, owner, body, T0 + minute * MIN);
      s = p.state;
      ids[key] = p.postId;
    };
    add('orionTeams', U.ORION, { category: 'TEAMS', title: 'GVE squad', projectLabel: 'Tower Lane arena', skills: ['Shooter'] }, 0);
    add('novaA', U.NOVA, { category: 'BUILDERS', title: 'Weather builder', projectLabel: 'Weather Dashboard', skills: ['TypeScript', 'React'] }, 1);
    add('novaB', U.NOVA, { category: 'DESIGNERS', title: 'Dashboard designer', projectLabel: 'weather dashboard v2', skills: ['Figma'] }, 1);
    add('rheaAi', U.RHEA, { category: 'AI_ENGINEERS', title: 'Agent tuning', skills: ['typescript'] }, 2);
    add('lyraClosed', U.LYRA, { category: 'COLLABORATORS', title: 'Content', skills: ['Writing'] }, 3);
    s = must(run(s, U.LYRA, 'lff.post.close', { ids: [ids.lyraClosed] }, T0 + 4 * MIN)).state;
    return { state: s, ids };
  }
  const idsOf = (page: LffFeedPage) => page.posts.map((p) => p.postId);
  const AT = T0 + 5 * MIN;

  it('lists newest first by server time, a same-millisecond pair by serial (the later one first); a closed post is never listed', () => {
    const { state, ids } = seeded();
    expect(idsOf(feed(state, U.KAI, {}, AT))).toEqual([ids.rheaAi, ids.novaB, ids.novaA, ids.orionTeams]);
  });

  it('a CLOSED post is in nobody\'s general feed, its owner\'s included, with or without hasOpenSlots; the owner finds it in mine', () => {
    const { state, ids } = seeded();
    for (const viewer of [U.KAI, U.LYRA, U.ORION]) {
      expect(idsOf(feed(state, viewer, {}, AT)), viewer).not.toContain(ids.lyraClosed);
      expect(idsOf(feed(state, viewer, { hasOpenSlots: false }, AT)), viewer).not.toContain(ids.lyraClosed);
    }
    expect(idsOf(feed(state, U.LYRA, { mine: true }, AT))).toEqual([ids.lyraClosed]);
    expect(idsOf(feed(state, U.LYRA, { mine: true, hasOpenSlots: true }, AT)), 'hasOpenSlots narrows the owner\'s list').toEqual([]);
    expect(idsOf(feed(state, U.NOVA, { mine: true, hasOpenSlots: true }, AT))).toEqual([ids.novaB, ids.novaA]);
  });

  it('category filters to one category; a category with no post gives an empty page', () => {
    const { state, ids } = seeded();
    expect(idsOf(feed(state, U.KAI, { category: 'DESIGNERS' }, AT))).toEqual([ids.novaB]);
    expect(idsOf(feed(state, U.KAI, { category: 'COMPETITORS' }, AT))).toEqual([]);
    expect(idsOf(feed(state, U.KAI, { category: 'COLLABORATORS' }, AT)), 'the only one is closed').toEqual([]);
  });

  it('projectLabel filters by substring, case-insensitively', () => {
    const { state, ids } = seeded();
    expect(idsOf(feed(state, U.KAI, { projectLabel: 'WEATHER dash' }, AT))).toEqual([ids.novaB, ids.novaA]);
    expect(idsOf(feed(state, U.KAI, { projectLabel: 'tower' }, AT))).toEqual([ids.orionTeams]);
    expect(idsOf(feed(state, U.KAI, { projectLabel: 'nowhere' }, AT))).toEqual([]);
  });

  it('skill matches one whole item, case-insensitively, never a part of one', () => {
    const { state, ids } = seeded();
    expect(idsOf(feed(state, U.KAI, { skill: 'TYPESCRIPT' }, AT))).toEqual([ids.rheaAi, ids.novaA]);
    expect(idsOf(feed(state, U.KAI, { skill: 'Type' }, AT))).toEqual([]);
  });

  it('filters may come in the query of a GET (strings) as well as a body', () => {
    const { state, ids } = seeded();
    expect(idsOf(feed(state, U.KAI, {}, AT, { category: 'TEAMS' }))).toEqual([ids.orionTeams]);
    expect(idsOf(feed(state, U.KAI, {}, AT, { hasOpenSlots: '1', limit: '2' }))).toEqual([ids.rheaAi, ids.novaB]);
    expect(idsOf(feed(state, U.KAI, {}, AT, { category: '' })), 'an empty query value is no filter').toHaveLength(4);
  });

  it('an expired post leaves the feed (with hasOpenSlots too); at exactly its expiresAtMs it is still there', () => {
    const { state, ids } = seeded();
    const orionExpiry = lffPostById(state, ids.orionTeams)!.expiresAtMs;
    expect(idsOf(feed(state, U.KAI, {}, orionExpiry))).toContain(ids.orionTeams);
    expect(idsOf(feed(state, U.KAI, { hasOpenSlots: true }, orionExpiry))).toContain(ids.orionTeams);
    expect(idsOf(feed(state, U.KAI, {}, orionExpiry + 1))).not.toContain(ids.orionTeams);
    expect(idsOf(feed(state, U.KAI, { hasOpenSlots: true }, orionExpiry + 1))).not.toContain(ids.orionTeams);
  });

  it('mine lists only the viewer\'s own posts, an expired one included', () => {
    const { state, ids } = seeded();
    const late = lffPostById(state, ids.novaA)!.expiresAtMs + 1;
    expect(idsOf(feed(state, U.NOVA, { mine: true }, late))).toEqual([ids.novaB, ids.novaA]);
    expect(feed(state, U.NOVA, { mine: true }, late).posts.map((p) => p.status)).toEqual(['EXPIRED', 'EXPIRED']);
    expect(idsOf(feed(state, U.KAI, { mine: true }, AT))).toEqual([]);
  });

  it('pages: a page boundary inside a same-millisecond pair splits it exactly; the last page says so; a deleted post at the cursor breaks nothing', () => {
    const { state, ids } = seeded();
    const first = feed(state, U.KAI, { limit: 2 }, AT);
    expect(idsOf(first)).toEqual([ids.rheaAi, ids.novaB]);
    expect(first.nextCursor).not.toBeNull();
    // the cursor sits on novaB; novaA has the SAME createdAtMs and a lower serial: it must open the next page, not be skipped
    expect(lffPostById(state, ids.novaA)!.createdAtMs).toBe(lffPostById(state, ids.novaB)!.createdAtMs);
    const second = feed(state, U.KAI, { limit: 2, cursor: first.nextCursor }, AT);
    expect(idsOf(second)).toEqual([ids.novaA, ids.orionTeams]);
    expect(second.nextCursor).toBeNull();
    const gone = must(run(state, U.NOVA, 'lff.post.delete', { ids: [ids.novaB] })).state;
    expect(idsOf(feed(gone, U.KAI, { limit: 2, cursor: first.nextCursor }, AT))).toEqual([ids.novaA, ids.orionTeams]);
  });

  it('a post created between pages is neither repeated nor skipped: it is on a fresh first page, not on the next one', () => {
    const { state, ids } = seeded();
    const first = feed(state, U.KAI, { limit: 2 }, AT);
    const fresh = post(state, U.JUNO, { title: 'Late arrival' }, AT + MIN);
    const second = feed(fresh.state, U.KAI, { limit: 2, cursor: first.nextCursor }, AT + MIN);
    expect(idsOf(second)).toEqual([ids.novaA, ids.orionTeams]);
    expect(idsOf(feed(fresh.state, U.KAI, { limit: 2 }, AT + MIN))).toEqual([fresh.postId, ids.rheaAi]);
  });

  it('a cursor it did not give, a limit outside 1-50, an unknown filter and a bad flag are refused; the defaults are accepted', () => {
    const s = seeded().state;
    expect(run(s, U.KAI, 'lff.feed.list').ok).toBe(true);
    expect(run(s, U.KAI, 'lff.feed.list', { body: { limit: 50 } }).ok).toBe(true);
    expect(run(s, U.KAI, 'lff.feed.list', { body: { limit: 1 } }).ok).toBe(true);
    for (const body of [{ cursor: 'lffp_3' }, { cursor: 7 }, { limit: 0 }, { limit: 51 }, { limit: 2.5 }, { sort: 'oldest' }, { hasOpenSlots: 'yes' }, { category: 'GAMERS' }, { skill: cp(33) }]) {
      expect(refused(run(s, U.KAI, 'lff.feed.list', { body })).code, JSON.stringify(body)).toBe('validation-failed');
    }
    expect(refused(run(s, U.KAI, 'lff.feed.list', { query: { order: 'x' } })).code).toBe('validation-failed');
  });
});

describe('LFF requests: ask, withdraw, accept, decline', () => {
  it('asking creates a PENDING request told to requester and owner; the requester and the owner each see it', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const o = must(run(p.state, U.KAI, 'lff.request.create', { ids: [p.postId], body: { message: 'I build levels' } }));
    const requestId = (o.data as { requestId: string }).requestId;
    expect(requestId).toMatch(/^lffr_\d+$/);
    expect([...o.audience].sort()).toEqual([U.KAI, U.NOVA].sort());
    expect(lffRequestById(o.state, requestId)).toEqual({ id: requestId, postId: p.postId, requesterId: U.KAI, message: 'I build levels', status: 'PENDING', createdAtMs: T0, updatedAtMs: T0 });
    expect(mine(o.state, U.KAI).requests.map((r) => [r.requestId, r.status, r.post?.postId])).toEqual([[requestId, 'PENDING', p.postId]]);
    expect(detail(o.state, U.KAI, p.postId).viewerRequest).toEqual({ requestId, status: 'PENDING' });
    const box = inbox(o.state, U.NOVA, p.postId);
    expect(box.requests.map((r) => [r.requestId, r.status, r.message, r.requester.userId])).toEqual([[requestId, 'PENDING', 'I build levels', U.KAI]]);
  });

  it('asking to join one\'s own post is refused; another player asking the same post is accepted', () => {
    const p = post(createSocialFixture(), U.NOVA);
    expect(refused(run(p.state, U.NOVA, 'lff.request.create', { ids: [p.postId] })).code).toBe('validation-failed');
    expect(run(p.state, U.KAI, 'lff.request.create', { ids: [p.postId] }).ok).toBe(true);
  });

  it('a second pending request to the same post is refused; a withdraw is told to requester and owner', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const a = ask(p.state, U.KAI, p.postId);
    expect(refused(run(a.state, U.KAI, 'lff.request.create', { ids: [p.postId] })).code).toBe('validation-failed');
    const w = must(run(a.state, U.KAI, 'lff.request.withdraw', { ids: [a.requestId] }));
    expect([...w.audience].sort()).toEqual([U.KAI, U.NOVA].sort());
    expect(lffRequestById(w.state, a.requestId)?.status).toBe('WITHDRAWN');
  });

  it(`after withdrawing, the same player may ask the same post again only ${LFF_REREQUEST_COOLDOWN_MS / MIN} minutes later; another post, or another player, at once`, () => {
    const p = post(createSocialFixture(), U.NOVA);
    const q = post(p.state, U.RHEA);
    const a = ask(q.state, U.KAI, p.postId);
    const withdrawnAt = T0 + MIN;
    const w = must(run(a.state, U.KAI, 'lff.request.withdraw', { ids: [a.requestId] }, withdrawnAt)).state;
    expect(LFF_REREQUEST_COOLDOWN_MS).toBe(10 * MIN);
    expect(refused(run(w, U.KAI, 'lff.request.create', { ids: [p.postId] }, withdrawnAt)).code).toBe('illegal-transition');
    expect(refused(run(w, U.KAI, 'lff.request.create', { ids: [p.postId] }, withdrawnAt + LFF_REREQUEST_COOLDOWN_MS - 1)).code).toBe('illegal-transition');
    expect(run(w, U.KAI, 'lff.request.create', { ids: [p.postId] }, withdrawnAt + LFF_REREQUEST_COOLDOWN_MS).ok).toBe(true);
    expect(run(w, U.KAI, 'lff.request.create', { ids: [q.postId] }, withdrawnAt).ok, 'another post at once').toBe(true);
    expect(run(w, U.ORION, 'lff.request.create', { ids: [p.postId] }, withdrawnAt).ok, 'another player at once').toBe(true);
  });

  it('asking a closed post, or one past its expiry, is answered as a missing post (it is no longer shown); at exactly expiresAtMs it is accepted', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const expiry = lffPostById(p.state, p.postId)!.expiresAtMs;
    expect(run(p.state, U.KAI, 'lff.request.create', { ids: [p.postId] }, expiry).ok).toBe(true);
    expect(refused(run(p.state, U.KAI, 'lff.request.create', { ids: [p.postId] }, expiry + 1))).toEqual(missingPost(p.state));
    const closed = must(run(p.state, U.NOVA, 'lff.post.close', { ids: [p.postId] })).state;
    expect(refused(run(closed, U.KAI, 'lff.request.create', { ids: [p.postId] }))).toEqual(missingPost(closed));
  });

  it('only the requester withdraws: the owner and a stranger are answered as a missing post; a withdrawn request is gone', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const a = ask(p.state, U.KAI, p.postId);
    expect(refused(run(a.state, U.NOVA, 'lff.request.withdraw', { ids: [a.requestId] }))).toEqual(missingPost(a.state));
    expect(refused(run(a.state, U.VEGA, 'lff.request.withdraw', { ids: [a.requestId] }))).toEqual(missingPost(a.state));
    const w = must(run(a.state, U.KAI, 'lff.request.withdraw', { ids: [a.requestId] })).state;
    expect(refused(run(w, U.KAI, 'lff.request.withdraw', { ids: [a.requestId] }))).toEqual(missingPost(w));
    expect(mine(w, U.KAI).requests).toEqual([]);
    expect(inbox(w, U.NOVA, p.postId).requests).toEqual([]);
  });

  it('only the owner accepts or declines: anyone else is answered as a missing post; the owner is accepted', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const a = ask(p.state, U.KAI, p.postId);
    for (const actor of [U.KAI, U.VEGA, U.ORION]) {
      expect(refused(run(a.state, actor, 'lff.request.accept', { ids: [a.requestId] })), actor).toEqual(missingPost(a.state));
      expect(refused(run(a.state, actor, 'lff.request.decline', { ids: [a.requestId] })), actor).toEqual(missingPost(a.state));
    }
    expect(refused(run(a.state, U.NOVA, 'lff.request.accept', { ids: ['lffr_999999'] }))).toEqual(missingPost(a.state));
    const acc = must(run(a.state, U.NOVA, 'lff.request.accept', { ids: [a.requestId] }, T0 + MIN));
    expect([...acc.audience].sort()).toEqual([U.KAI, U.NOVA].sort());
    expect(acc.extraEvents).toBeUndefined();
    expect(lffRequestById(acc.state, a.requestId)).toMatchObject({ status: 'ACCEPTED', updatedAtMs: T0 + MIN });
    expect(mine(acc.state, U.KAI).requests[0].status).toBe('ACCEPTED');
    expect(detail(acc.state, U.KAI, p.postId).viewerRequest).toEqual({ requestId: a.requestId, status: 'ACCEPTED' });
    expect(detail(acc.state, U.NOVA, p.postId).availableSlots).toBe(1);
    // accepting again, or declining an accepted one, finds no PENDING request: a missing post's answer
    expect(refused(run(acc.state, U.NOVA, 'lff.request.accept', { ids: [a.requestId] }))).toEqual(missingPost(acc.state));
    expect(refused(run(acc.state, U.NOVA, 'lff.request.decline', { ids: [a.requestId] }))).toEqual(missingPost(acc.state));
  });

  it(`decline: the requester sees DECLINED, the owner's inbox no longer lists it, and asking again waits ${LFF_DECLINE_COOLDOWN_MS / MIN} minutes (SEC m-c)`, () => {
    const p = post(createSocialFixture(), U.NOVA);
    const q = post(p.state, U.RHEA);
    const a = ask(q.state, U.KAI, p.postId);
    const declinedAt = T0 + MIN;
    const d = must(run(a.state, U.NOVA, 'lff.request.decline', { ids: [a.requestId] }, declinedAt));
    expect([...d.audience].sort()).toEqual([U.KAI, U.NOVA].sort());
    expect(mine(d.state, U.KAI, declinedAt).requests.map((r) => r.status)).toEqual(['DECLINED']);
    expect(detail(d.state, U.KAI, p.postId, declinedAt).viewerRequest).toEqual({ requestId: a.requestId, status: 'DECLINED' });
    expect(inbox(d.state, U.NOVA, p.postId).requests).toEqual([]);
    // THE EDGE (PROPOSED, 1 hour): refused at once and 1 ms before the hour, as an illegal transition -- never the missing post's
    // answer, and it tells nothing new: the requester already sees DECLINED. At exactly the hour, accepted.
    expect(LFF_DECLINE_COOLDOWN_MS).toBe(60 * MIN);
    for (const at of [declinedAt, declinedAt + LFF_DECLINE_COOLDOWN_MS - 1]) {
      const r = refused(run(d.state, U.KAI, 'lff.request.create', { ids: [p.postId] }, at));
      expect([r.code, r.message], `at +${at - declinedAt} ms`).toEqual(['illegal-transition', 'your request to this post was declined: you can ask again 60 minutes after']);
    }
    expect(run(d.state, U.KAI, 'lff.request.create', { ids: [p.postId] }, declinedAt + LFF_DECLINE_COOLDOWN_MS).ok, 'at exactly the hour').toBe(true);
    // THE CONTROLS: another post, or another player, at once
    expect(run(d.state, U.KAI, 'lff.request.create', { ids: [q.postId] }, declinedAt).ok, 'another post at once').toBe(true);
    expect(run(d.state, U.ORION, 'lff.request.create', { ids: [p.postId] }, declinedAt).ok, 'another player at once').toBe(true);
  });

  it('accepting on a closed or expired post is refused; declining there is still accepted', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const a = ask(p.state, U.KAI, p.postId);
    const expiry = lffPostById(a.state, p.postId)!.expiresAtMs;
    expect(run(a.state, U.NOVA, 'lff.request.accept', { ids: [a.requestId] }, expiry).ok).toBe(true);
    expect(refused(run(a.state, U.NOVA, 'lff.request.accept', { ids: [a.requestId] }, expiry + 1)).code).toBe('illegal-transition');
    const closed = must(run(a.state, U.NOVA, 'lff.post.close', { ids: [p.postId] })).state;
    expect(refused(run(closed, U.NOVA, 'lff.request.accept', { ids: [a.requestId] })).code).toBe('illegal-transition');
    expect(mine(closed, U.KAI).requests.map((r) => [r.status, r.post])).toEqual([['NO_LONGER_AVAILABLE', null]]);
    expect(run(closed, U.NOVA, 'lff.request.decline', { ids: [a.requestId] }).ok).toBe(true);
  });

  it('the accept that fills the last slot CLOSES the post; every other live requester is told a CLOSE (never an accept) and a pending one reads NO LONGER AVAILABLE', () => {
    const p = post(createSocialFixture(), U.NOVA, { openSlots: 2 });
    const a = ask(p.state, U.KAI, p.postId);
    const b = ask(a.state, U.ORION, p.postId);
    const c = ask(b.state, U.LYRA, p.postId);
    const first = must(run(c.state, U.NOVA, 'lff.request.accept', { ids: [a.requestId] }));
    expect(lffPostById(first.state, p.postId)).toMatchObject({ status: 'OPEN', version: 1 });
    expect(first.extraEvents).toBeUndefined();
    expect(detail(first.state, U.NOVA, p.postId).availableSlots).toBe(1);
    const second = must(run(first.state, U.NOVA, 'lff.request.accept', { ids: [b.requestId] }, T0 + MIN));
    expect(lffPostById(second.state, p.postId)).toMatchObject({ status: 'CLOSED', version: 2, updatedAtMs: T0 + MIN });
    expect([...second.audience].sort()).toEqual([U.NOVA, U.ORION].sort());
    expect(second.extraEvents).toEqual([{ op: 'lff.post.close', audience: [U.KAI, U.LYRA] }]);
    expect(detail(second.state, U.NOVA, p.postId).availableSlots).toBe(0);
    expect(mine(second.state, U.LYRA).requests[0].status).toBe('NO_LONGER_AVAILABLE');
    expect(mine(second.state, U.KAI).requests[0].status).toBe('ACCEPTED');
    expect(refused(run(second.state, U.NOVA, 'lff.request.accept', { ids: [c.requestId] })).code).toBe('illegal-transition');
  });

  it('withdrawing an accepted request frees its slot (the owner sees it back); a post a fill closed stays closed (no reopen in Alpha)', () => {
    const p = post(createSocialFixture(), U.NOVA, { openSlots: 3 });
    const a = ask(p.state, U.KAI, p.postId);
    const acc = must(run(a.state, U.NOVA, 'lff.request.accept', { ids: [a.requestId] })).state;
    expect(detail(acc, U.NOVA, p.postId).availableSlots).toBe(2);
    const left = must(run(acc, U.KAI, 'lff.request.withdraw', { ids: [a.requestId] })).state;
    expect(detail(left, U.NOVA, p.postId).availableSlots).toBe(3);
    expect(detail(left, U.NOVA, p.postId).accepted).toEqual([]);
    const one = post(createSocialFixture(), U.NOVA, { openSlots: 1 });
    const k = ask(one.state, U.KAI, one.postId);
    const full = must(run(k.state, U.NOVA, 'lff.request.accept', { ids: [k.requestId] })).state;
    const freed = must(run(full, U.KAI, 'lff.request.withdraw', { ids: [k.requestId] })).state;
    expect([detail(freed, U.NOVA, one.postId).status, detail(freed, U.NOVA, one.postId).availableSlots]).toEqual(['CLOSED', 1]);
  });

  it('requests.mine lists the requester\'s own, newest first: PENDING, ACCEPTED, DECLINED and NO LONGER AVAILABLE (with no post)', () => {
    let s = createSocialFixture();
    const posts = [U.NOVA, U.ORION, U.RHEA, U.LYRA].map((owner) => {
      const p = post(s, owner);
      s = p.state;
      return p.postId;
    });
    const r = posts.map((postId, i) => {
      const a = ask(s, U.KAI, postId, {}, T0 + i * MIN);
      s = a.state;
      return a.requestId;
    });
    s = must(run(s, U.ORION, 'lff.request.accept', { ids: [r[1]] }, T0 + 10 * MIN)).state;
    s = must(run(s, U.RHEA, 'lff.request.decline', { ids: [r[2]] }, T0 + 11 * MIN)).state;
    s = must(run(s, U.LYRA, 'lff.post.close', { ids: [posts[3]] }, T0 + 12 * MIN)).state;
    const list = mine(s, U.KAI, T0 + 13 * MIN);
    expect(list.requests.map((x) => [x.requestId, x.status, x.post?.postId ?? null])).toEqual([
      [r[2], 'DECLINED', posts[2]],
      [r[1], 'ACCEPTED', posts[1]],
      [r[3], 'NO_LONGER_AVAILABLE', null],
      [r[0], 'PENDING', posts[0]],
    ]);
    expect(list.truncated).toBe(false);
    expect(list.requests.map((x) => x.postId)).toEqual([posts[2], posts[1], posts[3], posts[0]]);
  });

  it('requests.forPost is the owner\'s: pending and accepted, oldest first; anyone else is answered as a missing post', () => {
    const p = post(createSocialFixture(), U.NOVA, { openSlots: 3 });
    const a = ask(p.state, U.KAI, p.postId, { message: 'one' });
    const b = ask(a.state, U.ORION, p.postId, { message: 'two' }, T0 + MIN);
    const s = must(run(b.state, U.NOVA, 'lff.request.accept', { ids: [b.requestId] })).state;
    expect(inbox(s, U.NOVA, p.postId).requests.map((r) => [r.requester.userId, r.status, r.message])).toEqual([
      [U.KAI, 'PENDING', 'one'],
      [U.ORION, 'ACCEPTED', 'two'],
    ]);
    // the order is the requests' own (time, then serial), never the array's: reversed rows answer the same
    const reversed: SocialState = { ...s, lffRequests: [...s.lffRequests].reverse() };
    expect(inbox(reversed, U.NOVA, p.postId)).toEqual(inbox(s, U.NOVA, p.postId));
    expect(detail(reversed, U.NOVA, p.postId)).toEqual(detail(s, U.NOVA, p.postId));
    for (const actor of [U.KAI, U.ORION, U.VEGA]) expect(refused(run(s, actor, 'lff.requests.forPost', { ids: [p.postId] })), actor).toEqual(missingPost(s));
  });
});

describe('LFF time: a stepped-back server clock never moves updatedAt backwards (037 stamped())', () => {
  it('edit, accept, withdraw, close and a block, each at createdAt - 1 min, keep updatedAt at the creation time; the version still moves', () => {
    const p = post(createSocialFixture(), U.NOVA, { openSlots: 3 });
    const a = ask(p.state, U.KAI, p.postId);
    const b = ask(a.state, U.ORION, p.postId);
    const back = T0 - MIN;
    const edited = must(run(b.state, U.NOVA, 'lff.post.edit', { ids: [p.postId], body: { title: 'x' } }, back)).state;
    expect(lffPostById(edited, p.postId)).toMatchObject({ createdAtMs: T0, updatedAtMs: T0, version: 2 });
    const accepted = must(run(b.state, U.NOVA, 'lff.request.accept', { ids: [a.requestId] }, back)).state;
    expect(lffRequestById(accepted, a.requestId)).toMatchObject({ status: 'ACCEPTED', createdAtMs: T0, updatedAtMs: T0 });
    const withdrawn = must(run(b.state, U.KAI, 'lff.request.withdraw', { ids: [a.requestId] }, back)).state;
    expect(lffRequestById(withdrawn, a.requestId)).toMatchObject({ status: 'WITHDRAWN', updatedAtMs: T0 });
    const closed = must(run(b.state, U.NOVA, 'lff.post.close', { ids: [p.postId] }, back)).state;
    expect(lffPostById(closed, p.postId)).toMatchObject({ status: 'CLOSED', updatedAtMs: T0, version: 2 });
    const blocked = must(run(b.state, U.ORION, 'blocks.add', { body: { targetId: U.NOVA } }, back)).state;
    expect(lffRequestById(blocked, b.requestId), 'the requester blocked: stored as their withdrawal').toMatchObject({ status: 'WITHDRAWN', updatedAtMs: T0 });
    const blockedByOwner = must(run(b.state, U.NOVA, 'blocks.add', { body: { targetId: U.ORION } }, back)).state;
    expect(lffRequestById(blockedByOwner, b.requestId), 'the owner blocked: cancelled').toMatchObject({ status: 'CANCELLED', updatedAtMs: T0 });
    // the control: a later clock does move it
    const later = must(run(b.state, U.NOVA, 'lff.post.edit', { ids: [p.postId], body: { title: 'x' } }, T0 + MIN)).state;
    expect(lffPostById(later, p.postId)!.updatedAtMs).toBe(T0 + MIN);
  });
});

describe('LFF caps (PROPOSED Alpha defaults)', () => {
  it(`at most ${LFF_MAX_OPEN_POSTS_PER_USER} open posts: the next is refused; closing one, or one expiring, makes room again`, () => {
    let s = createSocialFixture();
    const ids: string[] = [];
    for (let i = 0; i < LFF_MAX_OPEN_POSTS_PER_USER; i += 1) {
      const p = post(s, U.KAI, { title: `post ${i}` });
      s = p.state;
      ids.push(p.postId);
    }
    expect(LFF_MAX_OPEN_POSTS_PER_USER).toBe(5);
    expect(refused(run(s, U.KAI, 'lff.post.create', { body: BASE })).code).toBe('illegal-transition');
    expect(run(s, U.NOVA, 'lff.post.create', { body: BASE }).ok, 'another player is not capped by Kai\'s posts').toBe(true);
    const closed = must(run(s, U.KAI, 'lff.post.close', { ids: [ids[0]] })).state;
    expect(run(closed, U.KAI, 'lff.post.create', { body: BASE }).ok).toBe(true);
    expect(run(s, U.KAI, 'lff.post.create', { body: BASE }, T0 + LFF_POST_TTL_MS + 1).ok).toBe(true);
  });

  it(`at most ${LFF_MAX_CREATED_PER_WINDOW} posts CREATED in any rolling 24 hours, closed and deleted ones counted: the next is refused until the window rolls`, () => {
    let s = createSocialFixture();
    for (let i = 0; i < LFF_MAX_CREATED_PER_WINDOW; i += 1) {
      const at = T0 + i * MIN;
      const p = post(s, U.KAI, { title: `burst ${i}` }, at);
      // close half and delete half: neither gives a creation back
      s = must(run(p.state, U.KAI, i % 2 === 0 ? 'lff.post.close' : 'lff.post.delete', { ids: [p.postId] }, at)).state;
    }
    expect(LFF_MAX_CREATED_PER_WINDOW).toBe(10);
    expect(LFF_CREATION_WINDOW_MS).toBe(24 * 60 * MIN);
    expect(s.lffPosts.filter((p) => p.ownerId === U.KAI && p.status === 'OPEN'), 'the open-post cap is not the reason').toEqual([]);
    expect(refused(run(s, U.KAI, 'lff.post.create', { body: BASE }, T0 + 10 * MIN)).code).toBe('illegal-transition');
    expect(run(s, U.NOVA, 'lff.post.create', { body: BASE }, T0 + 10 * MIN).ok, 'another player is not capped by Kai\'s posts').toBe(true);
    // the oldest creation (T0) still counts at exactly 24 h old; at 24 h + 1 ms it no longer does
    expect(refused(run(s, U.KAI, 'lff.post.create', { body: BASE }, T0 + LFF_CREATION_WINDOW_MS)).code).toBe('illegal-transition');
    const rolled = must(run(s, U.KAI, 'lff.post.create', { body: BASE }, T0 + LFF_CREATION_WINDOW_MS + 1));
    // ...and it is pruned by that write: the record keeps only the window
    expect(rolled.state.lffCreations.filter((c) => c.userId === U.KAI).map((c) => c.atMs)).toEqual([
      ...Array.from({ length: LFF_MAX_CREATED_PER_WINDOW - 1 }, (_, i) => T0 + (i + 1) * MIN),
      T0 + LFF_CREATION_WINDOW_MS + 1,
    ]);
    // bounded: a create prunes everyone's entries older than the window
    expect(s.lffCreations.filter((c) => c.userId === U.KAI)).toHaveLength(LFF_MAX_CREATED_PER_WINDOW);
    const later = must(run(s, U.NOVA, 'lff.post.create', { body: BASE }, T0 + 2 * LFF_CREATION_WINDOW_MS));
    const novaPost = (later.data as { postId: string }).postId;
    expect(later.state.lffCreations).toEqual([{ userId: U.NOVA, postId: novaPost, atMs: T0 + 2 * LFF_CREATION_WINDOW_MS }]);
  });

  it('a DELETE inside the window still counts: the creation record keeps each post\'s id after the post is gone', () => {
    let s = createSocialFixture();
    const made: string[] = [];
    for (let i = 0; i < LFF_MAX_CREATED_PER_WINDOW; i += 1) {
      const p = post(s, U.KAI, { title: `gone ${i}` }, T0 + i * MIN);
      s = must(run(p.state, U.KAI, 'lff.post.delete', { ids: [p.postId] }, T0 + i * MIN)).state;
      made.push(p.postId);
    }
    expect(s.lffPosts.filter((p) => p.ownerId === U.KAI), 'every post is deleted').toEqual([]);
    expect(s.lffCreations).toEqual(made.map((postId, i) => ({ userId: U.KAI, postId, atMs: T0 + i * MIN })));
    expect(refused(run(s, U.KAI, 'lff.post.create', { body: BASE }, T0 + 10 * MIN)).code).toBe('illegal-transition');
    // the control: one fewer creation in the window, and the create is accepted
    const fewer: SocialState = { ...s, lffCreations: s.lffCreations.slice(1) };
    expect(run(fewer, U.KAI, 'lff.post.create', { body: BASE }, T0 + 10 * MIN).ok).toBe(true);
  });

  it(`at most ${LFF_MAX_PENDING_OUTGOING_PER_USER} pending requests out: the next is refused; a withdraw, or a post closing, makes room`, () => {
    let s = createSocialFixture();
    const owners = [U.NOVA, U.RHEA, U.ORION, U.VEGA, U.LYRA];
    const postIds: string[] = [];
    for (const owner of owners) {
      for (let i = 0; i < 5; i += 1) {
        const p = post(s, owner, { title: `${owner} ${i}` });
        s = p.state;
        postIds.push(p.postId);
      }
    }
    const requestIds: string[] = [];
    for (let i = 0; i < LFF_MAX_PENDING_OUTGOING_PER_USER; i += 1) {
      const a = ask(s, U.KAI, postIds[i]);
      s = a.state;
      requestIds.push(a.requestId);
    }
    expect(LFF_MAX_PENDING_OUTGOING_PER_USER).toBe(20);
    const next = postIds[LFF_MAX_PENDING_OUTGOING_PER_USER];
    expect(refused(run(s, U.KAI, 'lff.request.create', { ids: [next] })).code).toBe('illegal-transition');
    expect(run(s, U.JUNO, 'lff.request.create', { ids: [next] }).ok, 'another player is not capped by Kai\'s requests').toBe(true);
    const withdrawn = must(run(s, U.KAI, 'lff.request.withdraw', { ids: [requestIds[0]] })).state;
    expect(run(withdrawn, U.KAI, 'lff.request.create', { ids: [next] }).ok).toBe(true);
    const ownerOfFirst = lffPostById(s, postIds[0])!.ownerId;
    const closed = must(run(s, ownerOfFirst, 'lff.post.close', { ids: [postIds[0]] })).state;
    expect(run(closed, U.KAI, 'lff.request.create', { ids: [next] }).ok, 'a pending request to a closed post holds no room').toBe(true);
  });

  it(`at most ${LFF_MAX_PENDING_PER_POST} pending requests on one post: the next is refused; a decline makes room`, () => {
    const crowd = withPlayers(createSocialFixture(), LFF_MAX_PENDING_PER_POST + 1);
    const p = post(crowd.state, U.NOVA);
    let s = p.state;
    const requestIds: string[] = [];
    for (let i = 0; i < LFF_MAX_PENDING_PER_POST; i += 1) {
      const a = ask(s, crowd.ids[i], p.postId);
      s = a.state;
      requestIds.push(a.requestId);
    }
    expect(LFF_MAX_PENDING_PER_POST).toBe(50);
    const last = crowd.ids[LFF_MAX_PENDING_PER_POST];
    expect(refused(run(s, last, 'lff.request.create', { ids: [p.postId] })).code).toBe('illegal-transition');
    const declined = must(run(s, U.NOVA, 'lff.request.decline', { ids: [requestIds[0]] })).state;
    expect(run(declined, last, 'lff.request.create', { ids: [p.postId] }).ok).toBe(true);
  });
});

describe('LFF expiry is read from the server clock', () => {
  it('a post reads OPEN at exactly expiresAtMs and EXPIRED one millisecond later, to its owner; to anyone else it is then gone; nothing is written', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const stored = lffPostById(p.state, p.postId)!;
    expect(detail(p.state, U.NOVA, p.postId, stored.expiresAtMs).status).toBe('OPEN');
    expect(detail(p.state, U.KAI, p.postId, stored.expiresAtMs).status).toBe('OPEN');
    expect(detail(p.state, U.NOVA, p.postId, stored.expiresAtMs + 1).status).toBe('EXPIRED');
    expect(refused(run(p.state, U.KAI, 'lff.post.get', { ids: [p.postId] }, stored.expiresAtMs + 1))).toEqual(missingPost(p.state));
    expect(lffPostById(p.state, p.postId)!.status).toBe('OPEN');
    expect(detail(p.state, U.NOVA, p.postId, stored.expiresAtMs + 1).expiresAtIso).toBe(new Date(T0 + LFF_POST_TTL_MS).toISOString());
  });

  it('a pending request to an expired post reads NO LONGER AVAILABLE; before expiry it reads PENDING', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const a = ask(p.state, U.KAI, p.postId);
    const expiry = lffPostById(a.state, p.postId)!.expiresAtMs;
    expect(mine(a.state, U.KAI, expiry).requests[0].status).toBe('PENDING');
    expect(mine(a.state, U.KAI, expiry + 1).requests.map((r) => [r.status, r.post])).toEqual([['NO_LONGER_AVAILABLE', null]]);
  });
});

describe('LFF retention (rule 7, PROPOSED; the B2b review m3): a post no longer open and more than 30 days old is purged, with its requests, by the next write', () => {
  const DAY = 24 * 60 * MIN;

  /** Nova's post at T0: Orion asked and was accepted, Kai asked and was declined, then she closed it. Rhea's post a day later, closed. */
  function oldPosts(): { state: SocialState; novaPost: string; rheaPost: string; kaiRequest: string; orionRequest: string } {
    const p = post(createSocialFixture(), U.NOVA, { openSlots: 3 }, T0);
    const o = ask(p.state, U.ORION, p.postId, {}, T0 + 1000);
    const k = ask(o.state, U.KAI, p.postId, {}, T0 + 2000);
    let s = must(run(k.state, U.NOVA, 'lff.request.accept', { ids: [o.requestId] }, T0 + 3000)).state;
    s = must(run(s, U.NOVA, 'lff.request.decline', { ids: [k.requestId] }, T0 + 4000)).state;
    s = must(run(s, U.NOVA, 'lff.post.close', { ids: [p.postId] }, T0 + 5000)).state;
    const r = post(s, U.RHEA, {}, T0 + DAY);
    s = must(run(r.state, U.RHEA, 'lff.post.close', { ids: [r.postId] }, T0 + DAY + 1000)).state;
    return { state: s, novaPost: p.postId, rheaPost: r.postId, kaiRequest: k.requestId, orionRequest: o.requestId };
  }

  it('THE EDGE: exactly 30 days old the post is kept; 1 ms older, the next write deletes it and every request on it -- nothing else, and tells nobody', () => {
    expect(LFF_RETENTION_MS).toBe(30 * DAY);
    const old = oldPosts();
    // Lyra posts an hour before the edge (an OPEN post: the one she edits below)
    const lyra = post(old.state, U.LYRA, { title: 'Lyra\'s' }, T0 + LFF_RETENTION_MS - 60 * MIN);
    const edit = (s: SocialState, nowMs: number) => must(run(s, U.LYRA, 'lff.post.edit', { ids: [lyra.postId], body: { title: `at ${nowMs}` } }, nowMs));
    // AT EXACTLY 30 DAYS: kept, with its requests
    const kept = edit(lyra.state, T0 + LFF_RETENTION_MS);
    expect(lffPostById(kept.state, old.novaPost), 'exactly 30 days old: kept').toBeDefined();
    expect([lffRequestById(kept.state, old.kaiRequest)?.status, lffRequestById(kept.state, old.orionRequest)?.status]).toEqual(['DECLINED', 'ACCEPTED']);
    expect(kept.state.lffRequests, 'nothing purged: the request list is the same object').toBe(lyra.state.lffRequests);
    // 1 MS LATER: the next write purges it
    const at = T0 + LFF_RETENTION_MS + 1;
    const purged = edit(kept.state, at);
    expect(lffPostById(purged.state, old.novaPost), '1 ms past 30 days: purged').toBeUndefined();
    expect(purged.state.lffRequests.filter((r) => r.postId === old.novaPost), 'its requests go with it').toEqual([]);
    expect(lffPostById(purged.state, old.rheaPost), 'a younger closed post stays').toBeDefined();
    expect(lffPostById(purged.state, lyra.postId)).toMatchObject({ title: `at ${at}`, status: 'OPEN' });
    expect(purged.state.lffCreations, 'the creation record is not the purge\'s (its own 24 h prune)').toBe(kept.state.lffCreations);
    // the write answers exactly as it would without the purge: told to its actor alone, no extra event
    expect([purged.audience, purged.extraEvents]).toEqual([[U.LYRA], undefined]);
    // and every view reads as a deletion: the owner's own list, the accepted and the declined requester's lists, a get
    expect(feed(purged.state, U.NOVA, { mine: true }, at).posts).toEqual([]);
    expect(mine(purged.state, U.ORION, at).requests).toEqual([]);
    expect(mine(purged.state, U.KAI, at).requests).toEqual([]);
    expect(refused(run(purged.state, U.NOVA, 'lff.post.get', { ids: [old.novaPost] }, at))).toEqual(missingPost(purged.state));
  });

  it('a READ never purges: past the edge, a feed or a get leaves the state exactly as it was', () => {
    const old = oldPosts();
    const at = T0 + LFF_RETENTION_MS + 1;
    expect(must(run(old.state, U.NOVA, 'lff.feed.list', { body: { mine: true } }, at)).state).toBe(old.state);
    expect(must(run(old.state, U.NOVA, 'lff.post.get', { ids: [old.novaPost] }, at)).state).toBe(old.state);
    expect(feed(old.state, U.NOVA, { mine: true }, at).posts.map((p) => [p.postId, p.status]), 'not yet purged: still the owner\'s, EXPIRED').toEqual([[old.novaPost, 'EXPIRED']]);
  });

  it(`a BOUNDED BATCH: at most ${LFF_PURGE_BATCH} posts per write, oldest first whatever the array order; the rest go with the next write`, () => {
    expect(LFF_PURGE_BATCH).toBe(50);
    const n = LFF_PURGE_BATCH + 1;
    // n closed posts, stored NEWEST first (the array's order is not the purge's); a request on the newest one
    const raw: LffPost[] = Array.from({ length: n }, (_, i): LffPost => {
      const createdAtMs = T0 + (n - 1 - i) * 1000;
      return {
        id: `lffp_${900_000 + i}`, ownerId: U.NOVA, category: 'TEAMS', title: `old ${i}`, description: '', projectLabel: '', skills: [], openSlots: 1,
        status: 'CLOSED', createdAtMs, updatedAtMs: createdAtMs, expiresAtMs: createdAtMs + LFF_POST_TTL_MS, version: 2,
      };
    });
    const base = createSocialFixture();
    const s: SocialState = {
      ...base,
      lffPosts: raw,
      lffRequests: [{ id: 'lffr_990000', postId: raw[0].id, requesterId: U.KAI, message: '', status: 'DECLINED', createdAtMs: T0 + MIN, updatedAtMs: T0 + MIN }],
    };
    const at = T0 + LFF_RETENTION_MS + n * 1000;
    const first = must(run(s, U.ORION, 'lff.post.create', { body: BASE }, at)).state;
    expect(first.lffPosts.filter((p) => p.ownerId === U.NOVA).map((p) => p.id), 'the newest old post waits').toEqual([raw[0].id]);
    expect(first.lffRequests.map((r) => r.id), 'and its request with it').toContain('lffr_990000');
    const orionPost = first.lffPosts.find((p) => p.ownerId === U.ORION)!.id;
    const second = must(run(first, U.ORION, 'lff.post.close', { ids: [orionPost] }, at)).state;
    expect(second.lffPosts.filter((p) => p.ownerId === U.NOVA), 'the next write takes the rest').toEqual([]);
    expect(second.lffRequests.map((r) => r.id)).not.toContain('lffr_990000');
    // the function itself: nothing due gives back the SAME state (a store's by-reference diff then writes nothing)
    expect(purgeLffPastRetention(second, at)).toBe(second);
    expect(purgeLffPastRetention(s, T0 + LFF_RETENTION_MS)).toBe(s);
  });

  it('an OPEN post is never purged, however old (a hand-made row past 038\'s 30-day bound): only once it reads EXPIRED', () => {
    const p = post(createSocialFixture(), U.NOVA, {}, T0);
    const longLived: SocialState = { ...p.state, lffPosts: p.state.lffPosts.map((x) => ({ ...x, expiresAtMs: T0 + 40 * DAY })) };
    expect(purgeLffPastRetention(longLived, T0 + 31 * DAY), 'OPEN at 31 days: kept').toBe(longLived);
    expect(purgeLffPastRetention(longLived, T0 + 40 * DAY), 'OPEN at exactly its expiry: kept').toBe(longLived);
    expect(purgeLffPastRetention(longLived, T0 + 40 * DAY + 1).lffPosts, 'EXPIRED, and past 30 days: purged').toEqual([]);
    // a stepped-back clock: a post stamped after "now" is never due
    expect(purgeLffPastRetention(p.state, T0 - DAY)).toBe(p.state);
  });

  it('the owner\'s DELETE runs no batch (it removes rows itself; its clock only stamps a D-L5 hold); the next timed write does', () => {
    const old = oldPosts();
    const at = T0 + LFF_RETENTION_MS + 1;
    const fresh = post(old.state, U.NOVA, { title: 'fresh' }, at - 60 * MIN);
    const deleted = must(run(fresh.state, U.NOVA, 'lff.post.delete', { ids: [fresh.postId] }, at)).state;
    expect(lffPostById(deleted, old.novaPost), 'the delete purged nothing').toBeDefined();
    const after = must(run(deleted, U.NOVA, 'lff.post.create', { body: BASE }, at)).state;
    expect(lffPostById(after, old.novaPost)).toBeUndefined();
  });
});

describe('D-L5 (rule 8, contract r2.4): a REPORTED post is moderation evidence -- HELD, never deleted, and to every player exactly a deleted post', () => {
  const DAY = 24 * 60 * MIN;
  /**
   * A report through the existing flow (reports.file), by Lyra about Nova: naming `subjectRef` as its subject, or none. The CONTROL of
   * every case is the SAME report naming no post, so both branches file one report and mint the same ids afterwards.
   */
  const report = (s: SocialState, subjectRef: string | null, nowMs = T0): SocialState =>
    must(run(s, U.LYRA, 'reports.file', { body: { reportedId: U.NOVA, reason: 'SPAM', ...(subjectRef === null ? {} : { subjectRef }) } }, nowMs)).state;

  /** Nova's post at T0: Orion asked and was accepted, Kai asked and was declined, Vega asked (still pending); closed at +6 s, or not. */
  function novasPost(close: boolean): { state: SocialState; postId: string; orion: string; kai: string; vega: string } {
    const p = post(createSocialFixture(), U.NOVA, { openSlots: 3 }, T0);
    const o = ask(p.state, U.ORION, p.postId, {}, T0 + 1000);
    const k = ask(o.state, U.KAI, p.postId, {}, T0 + 2000);
    const v = ask(k.state, U.VEGA, p.postId, {}, T0 + 3000);
    let s = must(run(v.state, U.NOVA, 'lff.request.accept', { ids: [o.requestId] }, T0 + 4000)).state;
    s = must(run(s, U.NOVA, 'lff.request.decline', { ids: [k.requestId] }, T0 + 5000)).state;
    if (close) s = must(run(s, U.NOVA, 'lff.post.close', { ids: [p.postId] }, T0 + 6000)).state;
    return { state: s, postId: p.postId, orion: o.requestId, kai: k.requestId, vega: v.requestId };
  }
  const requestsOf = (s: SocialState, postId: string) => s.lffRequests.filter((r) => r.postId === postId);

  for (const [status, close] of [['CLOSED', true], ['EXPIRED', false]] as const) {
    it(`R-1 THE EDGE (${status}): reported after it ended, it is never purged -- 1 ms past 30 days it is HELD with every request (the accepted list included) and reads exactly as the purged control; the same post unreported IS purged`, () => {
      const n = novasPost(close);
      // the report comes a day AFTER the post ended: what decides is the server's state at the purge
      const reported = report(n.state, n.postId, T0 + DAY);
      const control = report(n.state, null, T0 + DAY);
      // the write that carries the purge: Lyra edits her own OPEN post
      const lyra = (s: SocialState) => post(s, U.LYRA, { title: 'Lyra\'s' }, T0 + LFF_RETENTION_MS - 60 * MIN);
      const [r0, c0] = [lyra(reported), lyra(control)];
      expect(r0.postId).toBe(c0.postId);
      const edit = (s: SocialState, nowMs: number) => must(run(s, U.LYRA, 'lff.post.edit', { ids: [r0.postId], body: { title: `at ${nowMs}` } }, nowMs));
      // AT EXACTLY 30 DAYS: both kept, nothing held
      const edge = T0 + LFF_RETENTION_MS;
      const [r1, c1] = [edit(r0.state, edge), edit(c0.state, edge)];
      expect([lffPostById(r1.state, n.postId) !== undefined, lffPostById(c1.state, n.postId) !== undefined]).toEqual([true, true]);
      expect([r1.state.lffHeld, c1.state.lffHeld]).toEqual([[], []]);
      // 1 MS LATER
      const at = edge + 1;
      const [r2, c2] = [edit(r1.state, at), edit(c1.state, at)];
      // THE CONTROL: the unreported post is purged, its requests with it, and nothing is held
      expect(lffPostById(c2.state, n.postId), 'the control is purged').toBeUndefined();
      expect([requestsOf(c2.state, n.postId), c2.state.lffHeld]).toEqual([[], []]);
      // THE REPORTED POST: held exactly as last written, with all three requests, stamped with the purge's server time
      expect(r2.state.lffHeld).toEqual([{ post: lffPostById(r1.state, n.postId), requests: requestsOf(r1.state, n.postId), heldAtMs: at }]);
      expect(r2.state.lffHeld[0].requests.map((r) => [r.id, r.status])).toEqual([[n.orion, 'ACCEPTED'], [n.kai, 'DECLINED'], [n.vega, 'PENDING']]);
      // held exactly as stored (CLOSED, or still OPEN and past its expiry); either way it reads EXPIRED by now
      expect([r2.state.lffHeld[0].post.status, lffPostStatusAt(r2.state.lffHeld[0].post, at)], 'held as stored').toEqual([close ? 'CLOSED' : 'OPEN', 'EXPIRED']);
      // TO EVERY PLAYER, THE PURGED CONTROL: the same player-facing state, the same answer, the same views
      expect([r2.state.lffPosts, r2.state.lffRequests, r2.state.lffCreations, r2.state.nextSerial]).toEqual([c2.state.lffPosts, c2.state.lffRequests, c2.state.lffCreations, c2.state.nextSerial]);
      expect([r2.data, r2.audience, r2.extraEvents]).toEqual([c2.data, c2.audience, c2.extraEvents]);
      for (const viewer of [U.NOVA, U.ORION, U.KAI, U.VEGA, U.LYRA, U.RHEA]) {
        expect(JSON.stringify(mine(r2.state, viewer, at)), `${viewer}: requests.mine`).toBe(JSON.stringify(mine(c2.state, viewer, at)));
        expect(JSON.stringify(feed(r2.state, viewer, { mine: true }, at)), `${viewer}: own posts`).toBe(JSON.stringify(feed(c2.state, viewer, { mine: true }, at)));
        expect(refused(run(r2.state, viewer, 'lff.post.get', { ids: [n.postId] }, at)), `${viewer}: get`).toEqual(missingPost(c2.state));
      }
      // ANY AGE: a year on, the next purge (it takes Lyra's own expired post) leaves the evidence exactly as it was
      const yearOn = must(run(r2.state, U.RHEA, 'lff.post.create', { body: BASE }, T0 + 365 * DAY)).state;
      expect(lffPostById(yearOn, r0.postId), 'the year-on write did purge (an unreported post)').toBeUndefined();
      expect(yearOn.lffHeld, 'the evidence is untouched').toBe(r2.state.lffHeld);
      // the rule itself, called directly: the reported post is held, the control purged
      expect(purgeLffPastRetention(r1.state, at).lffHeld.map((h) => h.post.id)).toEqual([n.postId]);
      expect(purgeLffPastRetention(c1.state, at).lffHeld).toEqual([]);
    });
  }

  it('R-2: the owner deletes a REPORTED post -- kept as evidence with every request; the answer, the people told and the player-facing state are an ordinary delete\'s; the same post unreported is hard-deleted', () => {
    const n = novasPost(false);
    const reported = report(n.state, n.postId);
    const control = report(n.state, null);
    const at = T0 + MIN;
    const held = must(run(reported, U.NOVA, 'lff.post.delete', { ids: [n.postId] }, at));
    const deleted = must(run(control, U.NOVA, 'lff.post.delete', { ids: [n.postId] }, at));
    // THE CONTROL: a hard delete, nothing kept
    expect([lffPostById(deleted.state, n.postId), requestsOf(deleted.state, n.postId), deleted.state.lffHeld]).toEqual([undefined, [], []]);
    // THE EVIDENCE: the post as last written and every request on it, in every status
    expect(held.state.lffHeld).toEqual([{ post: lffPostById(reported, n.postId), requests: requestsOf(reported, n.postId), heldAtMs: at }]);
    expect(held.state.lffHeld[0].requests.map((r) => r.status)).toEqual(['ACCEPTED', 'DECLINED', 'PENDING']);
    // A DELETE IN EVERY RESPECT A PLAYER SEES: the answer, who is told (the owner and the live requesters), the player-facing state
    expect([held.data, held.audience, held.extraEvents]).toEqual([deleted.data, deleted.audience, deleted.extraEvents]);
    expect([...held.audience].sort()).toEqual([U.NOVA, U.ORION, U.VEGA].sort());
    expect([held.state.lffPosts, held.state.lffRequests, held.state.lffCreations, held.state.nextSerial]).toEqual([deleted.state.lffPosts, deleted.state.lffRequests, deleted.state.lffCreations, deleted.state.nextSerial]);
    // NO LATER PATH DELETES IT: a second delete is the uniform not-found, and no purge ever reaches it
    expect(refused(run(held.state, U.NOVA, 'lff.post.delete', { ids: [n.postId] }, at))).toEqual(missingPost(held.state));
    expect(purgeLffPastRetention(held.state, T0 + 400 * DAY)).toBe(held.state);
    // a stepped-back clock: held no earlier than the post was last written (038's lff_posts_held_at CHECK)
    const back = must(run(reported, U.NOVA, 'lff.post.delete', { ids: [n.postId] }, T0 - MIN)).state.lffHeld[0];
    expect(back.heldAtMs).toBe(lffPostById(reported, n.postId)!.updatedAtMs);
  });

  it('R-2: only a report naming THIS post holds it -- one naming another post holds nothing here; two reports make one hold', () => {
    const n = novasPost(false);
    const other = post(n.state, U.NOVA, { title: 'Another' });
    const aboutOther = report(other.state, other.postId);
    expect(must(run(aboutOther, U.NOVA, 'lff.post.delete', { ids: [n.postId] })).state.lffHeld, 'the other post\'s report does not hold this one').toEqual([]);
    const both = report(report(other.state, n.postId), n.postId);
    const first = must(run(both, U.NOVA, 'lff.post.delete', { ids: [n.postId] })).state;
    const gone = must(run(first, U.NOVA, 'lff.post.delete', { ids: [other.postId] })).state;
    expect(gone.lffHeld.map((h) => h.post.id), 'two reports, one hold; the unreported second post is deleted').toEqual([n.postId]);
    expect(lffPostById(gone, other.postId)).toBeUndefined();
  });

  it('R-5: an OPEN reported post stays visible and requestable, exactly as before the report; the control (a close) shows the comparison sees a change', () => {
    const p = post(createSocialFixture(), U.NOVA);
    const reported = report(p.state, p.postId);
    for (const viewer of [U.RHEA, U.LYRA, U.KAI, U.NOVA]) {
      expect(JSON.stringify(feed(reported, viewer)), `${viewer}: the feed`).toBe(JSON.stringify(feed(p.state, viewer)));
      expect(detail(reported, viewer, p.postId), `${viewer}: the post`).toEqual(detail(p.state, viewer, p.postId));
    }
    expect(feed(reported, U.RHEA).posts.map((x) => x.postId)).toContain(p.postId);
    expect(run(reported, U.KAI, 'lff.request.create', { ids: [p.postId] }).ok, 'still requestable').toBe(true);
    expect(reported.lffHeld).toEqual([]);
    const closed = must(run(reported, U.NOVA, 'lff.post.close', { ids: [p.postId] })).state;
    expect(JSON.stringify(feed(closed, U.RHEA)), 'the control: the same comparison sees a close').not.toBe(JSON.stringify(feed(p.state, U.RHEA)));
  });
});
