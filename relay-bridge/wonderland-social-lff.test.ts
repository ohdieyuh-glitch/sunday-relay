import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { relayError } from '../src/relay/protocol/errors';
import { createBetaEnrolmentStore } from '../src/relay/persistence';
import {
  LFF_CREATION_WINDOW_MS,
  LFF_MAX_CREATED_PER_WINDOW,
  LFF_MAX_OPEN_POSTS_PER_USER,
  LFF_MAX_PENDING_OUTGOING_PER_USER,
  LFF_MAX_PENDING_PER_POST,
  LFF_POST_TTL_MS,
} from '../src/relay/social/social-lff';
import { createInMemorySocialStore, type SocialStore } from '../src/relay/social/social-store';
import { betaWaveZeroState } from './beta-routes';
import { loadBridgeConfig } from './config';
import { createBridgeServer } from './server';
import {
  budgetClassesOf,
  createCommandBudgets,
  createPresenceLease,
  handleSocialRoute,
  SOCIAL_BUDGETS,
  type SocialRouteDeps,
  type SocialSessionFacts,
} from './wonderland-social-routes';
import { NATIVE_SOCIAL_CAPABILITY, SOCIAL_OPERATIONS } from './wonderland-social-scope';

/*
 * LFF, THE LOOKING FOR FEED, OVER REAL HTTP (slice B3). Every call below is a real HTTP request to a real node:http server that
 * does what relay-bridge/server.ts does for /wonderland/social/* -- a POST's JSON body read under the bridge's 64 KiB cap, the
 * path passed WITH its query string, the Origin and Authorization headers passed on, the route's own headers (no-store) sent --
 * into the real routes (handleSocialRoute: the seven gates, the budgets, the presence lease) and the real in-memory social store
 * running the real LFF rules (src/relay/social/social-lff.ts). Only the session store and the account lookup are stand-ins, as in
 * wonderland-social-routes.test.ts. "Social disabled" is the REAL bridge (createBridgeServer), as in wonderland-social-http.test.ts.
 *
 * Kai, Nova, Vega and Rio each hold a desktop sign-in session with `social`; Mira is signed in without it; `tok-p<n>` are more
 * players with `social`, for the caps. B3.1 (the B3 review's R1, m1-m5): the feed's text filters are decoded once and applied on
 * the server; an unreadable query spends nothing; caps, expiry and the r2 absences are exercised here too.
 */

const T0 = Date.parse('2026-10-12T09:00:00.000Z');
const MAX_BODY_BYTES = 64 * 1024;   // relay-bridge/server.ts MAX_BODY_BYTES

const session = (participantId: string, capabilities: readonly string[]): SocialSessionFacts => ({
  sessionId: `s-${participantId}`,
  participantId,
  issuedAtMs: T0,
  capabilities,
  scope: 'native_social',
});

const SESSIONS: Record<string, SocialSessionFacts> = {
  'tok-kai': session('usr_kai', [NATIVE_SOCIAL_CAPABILITY]),
  'tok-nova': session('usr_nova', [NATIVE_SOCIAL_CAPABILITY]),
  'tok-vega': session('usr_vega', [NATIVE_SOCIAL_CAPABILITY]),
  'tok-rio': session('usr_rio', [NATIVE_SOCIAL_CAPABILITY]),
  'tok-mira': session('usr_mira', []),
};

/** A session's facts: the named players above, or a generated player `tok-p<n>` -> `usr_p<n>` (the caps need many). */
const sessionOf = (token: string): SocialSessionFacts | null =>
  SESSIONS[token] ?? (/^tok-p\d{1,3}$/.test(token) ? session(`usr_${token.slice(4)}`, [NATIVE_SOCIAL_CAPABILITY]) : null);

/** The uniform absence, exactly as the client receives it. */
const NOT_FOUND_TEXT = '{"error":{"kind":"not-found","message":"post not found"}}';

const BASE = { category: 'BUILDERS', title: 'Need a level designer', openSlots: 2 };

const servers: Server[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const server of servers) server.closeAllConnections();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

interface Answer {
  readonly status: number;
  /** The body exactly as it came over the wire. */
  readonly text: string;
  readonly body: any;
  readonly headers: Record<string, string>;
}

/** server.ts's readBody: the bytes under the cap, then JSON. */
function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', () => reject(new Error('request error')));
  });
}

async function fetchAnswer(url: string, init: RequestInit): Promise<Answer> {
  const response = await fetch(url, init);
  const text = await response.text();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return { status: response.status, text, body: JSON.parse(text), headers };
}

/** One bridge: a real HTTP server in front of the real routes and the in-memory store. The clock moves only when a test says so. */
async function lffBridge(opts: { budgets?: boolean; store?: SocialStore | null } = {}) {
  let clock = T0;
  const store = opts.store === undefined ? createInMemorySocialStore() : opts.store;
  const deps: SocialRouteDeps = {
    verifySession: (token) => sessionOf(token),
    sessionIssuedAt: null,
    identify: async (participantId) => {
      const name = participantId.replace('usr_', '');
      return { userId: participantId, displayName: name.replace(/^./, (c) => c.toUpperCase()), handle: `@${name}` };
    },
    store,
    presenceLease: createPresenceLease(),
    commandBudgets: opts.budgets === true ? createCommandBudgets() : null,
  };
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const method = req.method ?? 'GET';
        const result = await handleSocialRoute(
          {
            method,
            path: (req.url ?? '/').replace(/^\/relay-api/, ''),
            authorization: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
            origin: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
            body: method === 'POST' ? await readBody(req) : null,
            now: clock,
          },
          deps,
        );
        if (result === null) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }
        res.writeHead(result.status, { 'content-type': 'application/json', ...(result.headers ?? {}) });
        res.end(JSON.stringify(result.body));
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'internal error';
        const safe = msg === 'request body too large' || msg === 'invalid JSON body' ? msg : 'internal error';
        res.writeHead(safe === 'internal error' ? 500 : 400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: safe }));
      }
    })();
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/relay-api/wonderland/social`;

  const call = (token: string | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Answer> => {
    const headers: Record<string, string> = { ...extra };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token !== null) headers.authorization = `Relay-Session ${token}`;
    return fetchAnswer(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  const as = (token: string) => ({
    get: (path: string) => call(token, 'GET', path),
    post: (path: string, body: unknown = {}) => call(token, 'POST', path, body),
  });
  return {
    store,
    call,
    as,
    advance: (ms: number) => {
      clock += ms;
    },
    kai: as('tok-kai'),
    nova: as('tok-nova'),
    vega: as('tok-vega'),
    rio: as('tok-rio'),
    mira: as('tok-mira'),
  };
}

type Bridge = Awaited<ReturnType<typeof lffBridge>>;
type Player = Bridge['kai'];

async function createPost(player: Player, fields: Record<string, unknown> = {}): Promise<string> {
  const made = await player.post('/lff/posts', { ...BASE, ...fields });
  expect(made.status, made.text).toBe(200);
  expect(made.body.data.postId).toMatch(/^lffp_\d+$/);
  return made.body.data.postId as string;
}

async function askToJoin(player: Player, postId: string, message?: string): Promise<string> {
  const asked = await player.post(`/lff/posts/${postId}/requests`, message === undefined ? {} : { message });
  expect(asked.status, asked.text).toBe(200);
  expect(asked.body.data.requestId).toMatch(/^lffr_\d+$/);
  return asked.body.data.requestId as string;
}

const feedIds = async (player: Player, query = ''): Promise<string[]> => {
  const page = await player.get(`/lff/posts${query}`);
  expect(page.status, page.text).toBe(200);
  return page.body.data.posts.map((p: any) => p.postId);
};

const latestEvent = async (player: Player): Promise<number> => (await player.get('/events')).body.data.latest;
const eventOpsAfter = async (player: Player, after: number): Promise<string[]> => (await player.get(`/events?after=${after}`)).body.data.events.map((e: any) => e.op);

/** Every header but the date, which moves with the clock of the machine. */
const withoutDate = (headers: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(headers).filter(([k]) => k !== 'date'));

const LFF_OPS = SOCIAL_OPERATIONS.filter((op) => op.id.startsWith('lff.'));

/** A concrete path for an LFF row: a post id where the template names a post, a request id where it names a request. */
const pathOf = (template: string, postId = 'lffp_1', requestId = 'lffr_1'): string =>
  template.startsWith('/lff/requests/') ? template.replace(':id', requestId) : template.replace(':id', postId);

describe('LFF: the table B3 serves (B1 op ids; MAIN\'s route table, 10-12)', () => {
  it('twelve rows, each one method and path, reads and writes classed, budgets as the contract says (+ the audit\'s post class)', () => {
    const rows = LFF_OPS.map((op) => [op.id, op.method, op.template, op.writes, budgetClassesOf(op).join('+')]);
    expect(rows).toEqual([
      ['lff.feed.list', 'GET', '/lff/posts', false, 'read'],
      ['lff.post.get', 'GET', '/lff/posts/:id', false, 'read'],
      ['lff.requests.forPost', 'GET', '/lff/posts/:id/requests', false, 'read'],
      ['lff.requests.mine', 'GET', '/lff/requests', false, 'read'],
      ['lff.post.create', 'POST', '/lff/posts', true, 'write+post'],
      ['lff.post.edit', 'POST', '/lff/posts/:id/edit', true, 'write+post'],
      ['lff.post.close', 'POST', '/lff/posts/:id/close', true, 'write'],
      ['lff.post.delete', 'POST', '/lff/posts/:id/delete', true, 'write'],
      ['lff.request.create', 'POST', '/lff/posts/:id/requests', true, 'write+invitation'],
      ['lff.request.withdraw', 'POST', '/lff/requests/:id/withdraw', true, 'write'],
      ['lff.request.accept', 'POST', '/lff/requests/:id/accept', true, 'write'],
      ['lff.request.decline', 'POST', '/lff/requests/:id/decline', true, 'write'],
    ]);
    expect(SOCIAL_BUDGETS.post).toEqual({ burst: 5, everyMs: 120_000 });
    // the friend request keeps its classes beside the LFF request (one invitation budget for both)
    expect(budgetClassesOf({ id: 'requests.send', writes: true })).toEqual(['write', 'invitation']);
  });
});

describe('LFF over HTTP: two players, every operation end to end', () => {
  it('create -> the other finds it in the feed and by id -> asks to join -> the owner is told, lists it, accepts -> both see the connection', async () => {
    const w = await lffBridge();
    const postId = await createPost(w.kai, { description: 'A moon base map', projectLabel: 'Moonbase', skills: ['Unreal', 'Level Design'] });

    const feed = await w.nova.get('/lff/posts');
    expect(feed.status).toBe(200);
    expect(feed.headers['cache-control']).toBe('no-store');
    const listed = feed.body.data.posts.find((p: any) => p.postId === postId);
    expect(listed).toMatchObject({ title: 'Need a level designer', projectLabel: 'Moonbase', skills: ['Unreal', 'Level Design'], viewerIsOwner: false, viewerRequest: null });
    expect(listed.author.userId).toBe('usr_kai');

    const detail = await w.nova.get(`/lff/posts/${postId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ postId, status: 'OPEN', accepted: null });

    const kaiBefore = await latestEvent(w.kai);
    const requestId = await askToJoin(w.nova, postId, 'I build maps');
    expect(await eventOpsAfter(w.kai, kaiBefore)).toContain('lff.request.create');

    const mine = await w.nova.get('/lff/requests');
    expect(mine.status).toBe(200);
    expect(mine.body.data.requests.map((r: any) => [r.requestId, r.postId, r.status])).toEqual([[requestId, postId, 'PENDING']]);

    const inbox = await w.kai.get(`/lff/posts/${postId}/requests`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.data.requests.map((r: any) => [r.requestId, r.status, r.message, r.requester.userId])).toEqual([[requestId, 'PENDING', 'I build maps', 'usr_nova']]);

    const novaBefore = await latestEvent(w.nova);
    const accepted = await w.kai.post(`/lff/requests/${requestId}/accept`);
    expect(accepted.status, accepted.text).toBe(200);
    expect(accepted.headers['cache-control']).toBe('no-store');
    expect(await eventOpsAfter(w.nova, novaBefore)).toContain('lff.request.accept');

    expect((await w.nova.get('/lff/requests')).body.data.requests.map((r: any) => r.status)).toEqual(['ACCEPTED']);
    // the connection: both see the accepted list (owner and accepted users only)
    expect((await w.kai.get(`/lff/posts/${postId}`)).body.data.accepted.map((p: any) => p.userId)).toEqual(['usr_nova']);
    expect((await w.nova.get(`/lff/posts/${postId}`)).body.data.accepted.map((p: any) => p.userId)).toEqual(['usr_nova']);
    // an accept grants nothing else: no friendship appears
    expect((await w.kai.get('/snapshot')).body.data.friends).toEqual([]);
  });

  it('edit, decline, withdraw, close, delete: the owner manages the post; a declined and a withdrawn request read as such', async () => {
    const w = await lffBridge();
    const postId = await createPost(w.kai, { openSlots: 3 });
    const novaRequest = await askToJoin(w.nova, postId);
    const vegaRequest = await askToJoin(w.vega, postId, 'count me in');

    const edited = await w.kai.post(`/lff/posts/${postId}/edit`, { title: 'Need level designers', skills: ['Blender'] });
    expect(edited.status, edited.text).toBe(200);
    expect((await w.nova.get(`/lff/posts/${postId}`)).body.data).toMatchObject({ title: 'Need level designers', skills: ['Blender'] });

    expect((await w.kai.post(`/lff/requests/${novaRequest}/decline`)).status).toBe(200);
    expect((await w.nova.get('/lff/requests')).body.data.requests.map((r: any) => [r.requestId, r.status])).toEqual([[novaRequest, 'DECLINED']]);

    expect((await w.vega.post(`/lff/requests/${vegaRequest}/withdraw`)).status).toBe(200);
    expect((await w.vega.get('/lff/requests')).body.data.requests).toEqual([]);
    expect((await w.kai.get(`/lff/posts/${postId}/requests`)).body.data.requests).toEqual([]);

    expect((await w.kai.post(`/lff/posts/${postId}/close`)).status).toBe(200);
    expect((await w.kai.get(`/lff/posts/${postId}`)).body.data.status).toBe('CLOSED');

    const deleted = await w.kai.post(`/lff/posts/${postId}/delete`);
    expect(deleted.status, deleted.text).toBe(200);
    expect((await w.kai.get(`/lff/posts/${postId}`)).text).toBe(NOT_FOUND_TEXT);
    expect((await w.nova.get('/lff/requests')).body.data.requests).toEqual([]);
  });

  it('the feed\'s filters travel in the query and are APPLIED: category, skill, project label, open slots, a bounded page and its cursor', async () => {
    const w = await lffBridge();
    const a = await createPost(w.kai, { category: 'TEAMS', skills: ['Unreal'], projectLabel: 'moonbase-alpha' });
    const b = await createPost(w.kai, { category: 'BUILDERS', skills: ['Blender'], projectLabel: 'Lab' });
    const c = await createPost(w.kai, { category: 'TEAMS', skills: ['unreal', 'Audio'], projectLabel: 'Moonbase' });

    expect(await feedIds(w.nova)).toEqual([c, b, a]);   // newest first (one server millisecond: then by serial)
    expect(await feedIds(w.nova, '?category=TEAMS')).toEqual([c, a]);
    expect(await feedIds(w.nova, '?category=BUILDERS')).toEqual([b]);
    expect(await feedIds(w.nova, '?skill=UNREAL')).toEqual([c, a]);
    expect(await feedIds(w.nova, '?projectLabel=moonbase')).toEqual([c, a]);
    expect(await feedIds(w.nova, '?category=TEAMS&skill=audio')).toEqual([c]);

    // a bounded page and its cursor: three pages of one, nothing repeated or skipped
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      const answer = await w.nova.get(`/lff/posts?limit=1${cursor === null ? '' : `&cursor=${cursor}`}`);
      expect(answer.status, answer.text).toBe(200);
      expect(answer.body.data.posts).toHaveLength(1);
      seen.push(answer.body.data.posts[0].postId);
      cursor = answer.body.data.nextCursor;
    }
    expect(seen).toEqual([c, b, a]);
    expect(cursor).toBeNull();

    // the owner's own list
    expect((await feedIds(w.kai, '?mine=1')).sort()).toEqual([a, b, c].sort());
    // open slots: a closed post is left out
    expect((await w.kai.post(`/lff/posts/${b}/close`)).status).toBe(200);
    expect(await feedIds(w.nova, '?hasOpenSlots=1')).toEqual([c, a]);
  });
});

/** The route's own refusal of a query it cannot read starts so; a refusal by the domain's text rule does not. */
const ROUTE_QUERY_REFUSAL = 'This query cannot be read:';

describe('the feed query is read whole: text filters are percent-decoded EXACTLY ONCE and applied on the server, anything else refused (B3.1 = review R1)', () => {
  it('"Wonder Web", "C++", "UI/UX", "Équipe", "café": decoded once and APPLIED, each beside a post it must not match; %2520 stays the literal "%20"', async () => {
    const w = await lffBridge();
    const wonder = await createPost(w.kai, { title: 'W', skills: ['Wonder Web'], projectLabel: 'The Wonder Web Studio' });
    const near = await createPost(w.kai, { title: 'N', skills: ['Web'], projectLabel: 'Wonder-Webs' });
    const cpp = await createPost(w.kai, { title: 'C', skills: ['C++', 'UI/UX'], projectLabel: 'Engine room' });
    const accent = await createPost(w.kai, { title: 'E', skills: ['Équipe'], projectLabel: 'Café' });
    const literal = await createPost(w.kai, { title: 'L', skills: ['%20'], projectLabel: 'Done 100%' });
    // the control: unfiltered, all five
    expect(await feedIds(w.nova)).toEqual([literal, accent, cpp, near, wonder]);

    expect(await feedIds(w.nova, '?skill=Wonder%20Web')).toEqual([wonder]);
    expect(await feedIds(w.nova, '?skill=wonder%20WEB')).toEqual([wonder]);                 // case-insensitive, exact item
    expect(await feedIds(w.nova, '?projectLabel=wonder%20web')).toEqual([wonder]);          // a substring ("Wonder-Webs" is not one)
    expect(await feedIds(w.nova, '?skill=Web&projectLabel=Wonder-Webs')).toEqual([near]);   // both filters at once
    expect(await feedIds(w.nova, '?skill=C%2B%2B')).toEqual([cpp]);                         // %2B is a plus
    expect(await feedIds(w.nova, '?skill=UI%2FUX')).toEqual([cpp]);
    expect(await feedIds(w.nova, '?skill=%C3%89quipe')).toEqual([accent]);                  // UTF-8, decoded once
    expect(await feedIds(w.nova, '?projectLabel=caf%C3%A9')).toEqual([accent]);
    expect(await feedIds(w.nova, '?skill=%2520')).toEqual([literal]);                       // ONE decode: the text "%20", never a space
    expect(await feedIds(w.nova, '?projectLabel=0%25')).toEqual([literal]);
    expect(await feedIds(w.nova, '?skill=Blender')).toEqual([]);                            // a filter matching nothing: an empty page
  });

  it('refused, never ignored: a raw "+", a malformed or non-UTF-8 escape, a control character or over-length text after the decode, a repeated or encoded key, a second "?", an escape outside the text filters', async () => {
    const w = await lffBridge();
    const unreal = await createPost(w.kai, { skills: ['Unreal Engine'] });
    await createPost(w.kai, { skills: ['Blender'] });
    expect(await feedIds(w.nova, '?skill=Unreal%20Engine')).toEqual([unreal]);   // the control

    // [query, who refuses it]: the ROUTE (it cannot be read) or the DOMAIN's text rule (lffText), applied to the decoded text
    for (const [query, by] of [
      ['skill=Unreal+Engine', 'route'],          // a raw plus: refused, never read as a space (parseQuery never carried one)
      ['skill=UI/UX', 'route'],                  // a raw slash
      ['skill=%ZZ', 'route'],                    // a malformed escape
      ['skill=Web%', 'route'],
      ['skill=%E0%A4', 'route'],                 // a truncated UTF-8 sequence
      ['skill=%C0%AF', 'route'],                 // an overlong form
      ['skill=%ED%A0%80', 'route'],              // an encoded surrogate
      ['skill=%FF', 'route'],                    // not UTF-8 at all
      ['skill=Blender&skill=Unreal', 'route'],   // a repeated key
      ['sk%69ll=Blender', 'route'],              // an encoded key: keys are never decoded
      ['skill=Blender?skill=x', 'route'],        // a second "?"
      ['category=TE%41MS', 'route'],             // only the text filters are decoded
      ['cursor=1%2E2', 'route'],
      ['skill=a%00b', 'domain'],                 // NUL
      ['skill=a%0Ab', 'domain'],                 // a line break
      ['projectLabel=a%0D', 'domain'],
      ['skill=%C2%85', 'domain'],                // a C1 control
      ['skill=%E2%80%A8', 'domain'],             // U+2028
      [`skill=${'%C3%A9'.repeat(33)}`, 'domain'], // 33 code points: one past a skill's 32
      ['skill=%20', 'domain'],                   // a space alone: empty after the trim
    ] as const) {
      const refused = await w.nova.get(`/lff/posts?${query}`);
      expect([refused.status, refused.body.error?.kind], query).toEqual([400, 'validation-failed']);
      expect(refused.body.data, query).toBeUndefined();
      expect(refused.text, query).not.toContain('lffp_');
      if (by === 'route') expect(refused.body.error.message.startsWith(ROUTE_QUERY_REFUSAL), `${query}: ${refused.text}`).toBe(true);
      else expect(refused.body.error.message.startsWith(ROUTE_QUERY_REFUSAL), `${query} reached the domain: ${refused.text}`).toBe(false);
    }
  });

  it('the refusal names its rules (review m5); the other LFF routes decode nothing; the existing routes keep their own query handling', async () => {
    const w = await lffBridge();
    const refused = await w.nova.get('/lff/posts?skill=Unreal+Engine');
    for (const rule of ['key (1-32 characters)', 'ASCII letters, digits, "_" or "-", given once', 'value (up to 80', '"."', '%XX escapes of UTF-8', 'decoded once', 'a space is %20', 'a plus %2B', 'a raw "+" is refused']) {
      expect(refused.body.error.message, rule).toContain(rule);
    }
    // only the feed's two text filters decode: elsewhere an escape is a 400 (the route's), and a key the op takes none of is the domain's
    expect((await w.nova.get('/lff/requests?skill=a%20b')).body.error.message.startsWith(ROUTE_QUERY_REFUSAL)).toBe(true);
    expect((await w.nova.get('/lff/requests?x%20y=1')).status).toBe(400);
    expect((await w.nova.get('/lff/requests')).status).toBe(200);
    // non-LFF: parseQuery as before (events ignores what it cannot read, and still answers)
    expect((await w.nova.get('/events?after=0&x%20y=1')).status).toBe(200);
    expect((await w.nova.get('/events?after=0&skill=a%20b')).status).toBe(200);
  });

  it('a query that cannot be read is refused BEFORE the store, the lease or any budget (review m1): it spends nothing and makes no record', async () => {
    const w = await lffBridge({ budgets: true });
    for (let i = 0; i < 3; i += 1) {
      const refused = await w.kai.post('/lff/posts?x%20y=1', BASE);
      expect([refused.status, refused.body.error?.kind]).toEqual([400, 'validation-failed']);
    }
    expect(Object.hasOwn((await w.store!.read()).users, 'usr_kai'), 'the store was never asked to make his record').toBe(false);
    // all five of the post budget are still there, and the sixth meets it (the control: the budget is real)
    for (let i = 0; i < SOCIAL_BUDGETS.post.burst; i += 1) await createPost(w.kai, { title: `Post ${i}` });
    expect((await w.kai.post('/lff/posts', BASE)).status).toBe(429);
  });
});

/** The missing post's 404 as this bridge answers it, and a check that another answer IS it: status, bytes and headers. */
async function uniform404(w: Bridge): Promise<(answer: Answer, label: string) => void> {
  const missing = await w.nova.get('/lff/posts/lffp_999999');
  expect(missing.status).toBe(404);
  expect(missing.text).toBe(NOT_FOUND_TEXT);
  expect(missing.headers['cache-control']).toBe('no-store');
  expect(missing.headers['retry-after']).toBeUndefined();
  return (answer, label) => {
    expect(answer.status, label).toBe(404);
    expect(answer.text, label).toBe(missing.text);
    expect(withoutDate(answer.headers), label).toEqual(withoutDate(missing.headers));
  };
}

describe('the one 404 over HTTP: a missing post, another player\'s post, a post behind a block -- byte for byte, the same headers', () => {
  it('every not-yours / not-there / walled answer equals the missing post\'s, while the controls are answered', async () => {
    const w = await lffBridge();
    const postId = await createPost(w.kai);
    const novaRequest = await askToJoin(w.nova, postId);
    const same = await uniform404(w);

    // the controls: before any block, Vega sees the post; its owner reads its inbox
    expect((await w.vega.get(`/lff/posts/${postId}`)).status).toBe(200);
    expect((await w.kai.get(`/lff/posts/${postId}/requests`)).status).toBe(200);

    // NOT THE OWNER'S / NOT THE REQUESTER'S: refused exactly as a missing post, and nothing moves
    const before = await w.store!.read();
    same(await w.vega.post(`/lff/posts/${postId}/edit`, { title: 'mine now' }), 'non-owner edit');
    same(await w.vega.post(`/lff/posts/${postId}/close`), 'non-owner close');
    same(await w.vega.post(`/lff/posts/${postId}/delete`), 'non-owner delete');
    same(await w.vega.get(`/lff/posts/${postId}/requests`), 'non-owner inbox');
    same(await w.vega.post(`/lff/requests/${novaRequest}/accept`), 'non-owner accept');
    same(await w.vega.post(`/lff/requests/${novaRequest}/decline`), 'non-owner decline');
    same(await w.vega.post(`/lff/requests/${novaRequest}/withdraw`), 'non-requester withdraw');
    same(await w.nova.post(`/lff/requests/${novaRequest}/accept`), 'a requester accepting their own request');
    same(await w.kai.post('/lff/requests/lffr_999999/withdraw'), 'missing request');
    same(await w.kai.post('/lff/posts/lffp_999999/edit', { title: 'x' }), 'missing post edit');
    expect(await w.store!.read(), 'the refused writes changed nothing').toBe(before);

    // BEHIND A BLOCK, the owner's side: Kai blocks Vega
    expect((await w.kai.post('/blocks', { targetId: 'usr_vega' })).status).toBe(200);
    same(await w.vega.get(`/lff/posts/${postId}`), 'walled get (owner blocked the viewer)');
    same(await w.vega.post(`/lff/posts/${postId}/requests`, {}), 'walled request (owner blocked the viewer)');
    expect(await feedIds(w.vega)).toEqual([]);

    // BEHIND A BLOCK, the viewer's side: Nova blocks Kai -- her pending request goes with it
    expect((await w.nova.get(`/lff/posts/${postId}`)).status).toBe(200);   // control, before her block
    expect((await w.nova.post('/blocks', { targetId: 'usr_kai' })).status).toBe(200);
    same(await w.nova.get(`/lff/posts/${postId}`), 'walled get (viewer blocked the owner)');
    same(await w.nova.post(`/lff/posts/${postId}/requests`, {}), 'walled request (viewer blocked the owner)');
    same(await w.kai.post(`/lff/requests/${novaRequest}/accept`), 'accepting a request a block cancelled');
    expect((await w.nova.get('/lff/requests')).body.data.requests).toEqual([]);
    expect((await w.kai.get(`/lff/posts/${postId}/requests`)).body.data.requests).toEqual([]);
    // and the owner still has the post (the walls are views, not deletions)
    expect((await w.kai.get(`/lff/posts/${postId}`)).status).toBe(200);
  });

  it('r2 (review m4): an author hidden from the viewer by privacy, and a CLOSED post seen by a stranger, are the same 404; the controls are answered', async () => {
    const w = await lffBridge();
    const same = await uniform404(w);

    // AN AUTHOR HIDDEN BY PRIVACY: Kai lets nobody see his presence -> his post is absent for Nova, a stranger
    const hidden = await createPost(w.kai, { title: 'Hidden author' });
    expect((await w.nova.get(`/lff/posts/${hidden}`)).status).toBe(200);   // control: visible while his audience admits her
    expect((await w.kai.post('/privacy', { presenceVisibility: 'NOBODY' })).status).toBe(200);
    same(await w.nova.get(`/lff/posts/${hidden}`), 'author hidden by privacy: get');
    same(await w.nova.post(`/lff/posts/${hidden}/requests`, {}), 'author hidden by privacy: request');
    expect(await feedIds(w.nova)).toEqual([]);
    expect((await w.kai.get(`/lff/posts/${hidden}`)).status).toBe(200);    // the owner still sees it
    expect((await w.kai.post('/privacy', { presenceVisibility: 'EVERYONE' })).status).toBe(200);
    expect((await w.nova.get(`/lff/posts/${hidden}`)).status).toBe(200);   // and it was the privacy: visible again

    // A CLOSED POST: its owner and the users accepted on it see it; a stranger gets the missing post's answer
    const closed = await createPost(w.kai, { title: 'Closing soon' });
    const accepted = await askToJoin(w.nova, closed);
    expect((await w.kai.post(`/lff/requests/${accepted}/accept`)).status).toBe(200);
    expect((await w.vega.get(`/lff/posts/${closed}`)).status).toBe(200);   // control: open, a stranger sees it
    expect((await w.kai.post(`/lff/posts/${closed}/close`)).status).toBe(200);
    same(await w.vega.get(`/lff/posts/${closed}`), 'closed post, stranger: get');
    same(await w.vega.post(`/lff/posts/${closed}/requests`, {}), 'closed post, stranger: request');
    expect(await feedIds(w.vega)).not.toContain(closed);
    expect((await w.nova.get(`/lff/posts/${closed}`)).body.data.status).toBe('CLOSED');   // the accepted user still sees it
    expect((await w.kai.get(`/lff/posts/${closed}`)).body.data.status).toBe('CLOSED');    // and its owner
  });
});

describe('who may call: the same gates as every social route, on all twelve LFF routes', () => {
  it('no session and an unknown one are 401; a session without `social` is 403 not_permitted; a web page is 403 desktop_only', async () => {
    const w = await lffBridge();
    const kaiPost = await createPost(w.kai);
    for (const op of LFF_OPS) {
      const path = pathOf(op.template, kaiPost);
      const body = op.method === 'POST' ? {} : undefined;
      const label = `${op.method} ${op.template}`;
      const anonymous = await w.call(null, op.method, path, body);
      expect([anonymous.status, anonymous.body.error?.kind], label).toEqual([401, 'session_required']);
      expect(anonymous.headers['cache-control'], label).toBe('no-store');
      expect((await w.call('tok-nobody', op.method, path, body)).status, label).toBe(401);
      const uncapable = await w.call('tok-mira', op.method, path, body);
      expect([uncapable.status, uncapable.body.error?.kind], label).toEqual([403, 'not_permitted']);
      const webPage = await w.call('tok-kai', op.method, path, body, { origin: 'https://sunday-relay.vercel.app' });
      expect([webPage.status, webPage.body.error?.kind], label).toEqual([403, 'desktop_only']);
      // the control: the same call from the desktop session passes every gate (the rule answers: 200, 400, 404 or 409)
      const admitted = await w.call('tok-kai', op.method, path, body);
      expect([200, 400, 404, 409], `${label} -> ${admitted.text}`).toContain(admitted.status);
    }
  });

  it('the actor is the session: a body naming another owner, requester or actor is 403 actor_mismatch and makes nothing', async () => {
    const w = await lffBridge();
    const postId = await createPost(w.kai);
    const before = await w.store!.read();
    for (const [label, answer] of [
      ['create as another owner', await w.nova.post('/lff/posts', { ...BASE, ownerId: 'usr_kai' })],
      ['request as another requester', await w.vega.post(`/lff/posts/${postId}/requests`, { fromUserId: 'usr_nova' })],
      ['edit as another actor', await w.nova.post(`/lff/posts/${postId}/edit`, { title: 'x', actorId: 'usr_kai' })],
    ] as const) {
      expect([answer.status, answer.body.error?.kind], label).toEqual([403, 'actor_mismatch']);
    }
    expect(await w.store!.read()).toBe(before);
    // the control: naming oneself passes the actor gate, and the rule then refuses a field the operation does not take
    const self = await w.nova.post('/lff/posts', { ...BASE, ownerId: 'usr_nova' });
    expect([self.status, self.body.error?.kind]).toEqual([400, 'validation-failed']);
    expect(await feedIds(w.nova, '?mine=1')).toEqual([]);
  });

  it('a wrong method, an encoded segment or a path not in the table is 403 not_permitted', async () => {
    const w = await lffBridge();
    for (const [method, path] of [
      ['DELETE', '/lff/posts/lffp_1'],
      ['GET', '/lff/posts/lffp_1/edit'],
      ['POST', '/lff/posts/lffp_1'],
      ['GET', '/lff/posts/lffp_1%2Fedit'],
      ['POST', '/lff/requests'],
      ['GET', '/lff/requests/lffr_1'],
      ['GET', '/lff/feed'],
    ] as const) {
      const answer = await w.call('tok-kai', method, path, method === 'POST' ? {} : undefined);
      expect([answer.status, answer.body.error?.kind], `${method} ${path}`).toEqual([403, 'not_permitted']);
    }
  });
});

describe('503: social disabled, no store, a store that cannot commit', () => {
  const ORIGIN = 'https://sunday-relay.vercel.app';

  async function bootRealBridge(env: Record<string, string>): Promise<string> {
    const root = mkdtempSync(join(tmpdir(), 'relay-social-lff-'));
    roots.push(root);
    vi.stubEnv('RELAY_BRIDGE_API_TOKEN', 'operator-token-for-tests-0123456789abcdef');
    vi.stubEnv('RELAY_ALLOWED_ORIGINS', ORIGIN);
    vi.stubEnv('RELAY_DATA_DIR', root);
    // no database in this file, whatever the shell carries
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('JULIUS_DATABASE_URL', '');
    vi.stubEnv('WONDERLAND_SOCIAL_ENABLED', '');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const server = createBridgeServer(
      loadBridgeConfig(process.env),
      { start: () => ({ state: 'ready' }) as never, get: () => ({ state: 'ready', missionId: 'm' }) as never, cancel: () => undefined, retry: () => undefined } as never,
      null, null, null, null,
      () => false,
      createBetaEnrolmentStore({ root }),
      [{ wave: 'wave_0', state: betaWaveZeroState(process.env), seats: 100 }],
    ) as unknown as Server;
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/relay-api/wonderland/social`;
  }

  const callBridge = (base: string, method: string, path: string) =>
    fetchAnswer(`${base}${path}`, {
      method,
      headers: { authorization: 'Relay-Session not-a-session', 'content-type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
    });

  it('the REAL bridge with social off answers every LFF route 503 social_unavailable; with it on, LFF is the social family (its own 401, no-store)', async () => {
    const off = await bootRealBridge({});
    for (const op of LFF_OPS) {
      const answer = await callBridge(off, op.method, pathOf(op.template));
      expect([answer.status, answer.body], `${op.method} ${op.template}`).toEqual([503, { error: { kind: 'social_unavailable', message: 'Social is not available on this server.' } }]);
    }
    const on = await bootRealBridge({ WONDERLAND_SOCIAL_ENABLED: '1', RELAY_GITHUB_APP_CLIENT_ID: 'Iv1.public' });
    for (const op of LFF_OPS) {
      const answer = await callBridge(on, op.method, `${pathOf(op.template)}${op.id === 'lff.feed.list' ? '?category=TEAMS' : ''}`);
      expect([answer.status, answer.body], `${op.method} ${op.template}`).toEqual([401, { error: { kind: 'session_required', message: 'Sign in to Wonderland to use social.' } }]);
      expect(answer.headers['cache-control'], op.template).toBe('no-store');
    }
  });

  it('a bridge without a social store: 503 after the gates (an anonymous call is still 401)', async () => {
    const w = await lffBridge({ store: null });
    const answer = await w.kai.get('/lff/posts');
    expect([answer.status, answer.body.error?.kind]).toEqual([503, 'social_unavailable']);
    expect((await w.call(null, 'GET', '/lff/posts')).status).toBe(401);
  });

  it('a store failure is the retryable 503, changes nothing, and the same call then succeeds', async () => {
    const inner = createInMemorySocialStore();
    let failing = false;
    const store: SocialStore = {
      read: inner.read,
      ensureUser: inner.ensureUser,
      eventsFor: inner.eventsFor,
      apply: async (op, actorId, input, nowIso) =>
        failing && op.startsWith('lff.')
          ? { ok: false, error: relayError('stale-ledger-version', 'The social store could not commit right now.', { retryable: true }) }
          : inner.apply(op, actorId, input, nowIso),
    };
    const w = await lffBridge({ store });
    failing = true;
    const outage = await w.kai.post('/lff/posts', BASE);
    expect([outage.status, outage.body]).toEqual([503, { error: { kind: 'stale-ledger-version', message: 'The social store could not commit right now.' } }]);
    expect(outage.headers['cache-control']).toBe('no-store');
    expect((await w.kai.get('/lff/posts')).status).toBe(503);
    failing = false;
    expect(await feedIds(w.kai, '?mine=1')).toEqual([]);
    const postId = await createPost(w.kai);
    expect(await feedIds(w.kai, '?mine=1')).toEqual([postId]);
  });
});

describe('budgets: posts have their own; a request to join is an invitation', () => {
  it('create + edit share the post budget: five at once, the sixth is 429 (Retry-After 120) and is not run; close is not charged to it; two minutes on, one more', async () => {
    const w = await lffBridge({ budgets: true });
    const a = await createPost(w.kai, { title: 'A' });
    const b = await createPost(w.kai, { title: 'B' });
    const c = await createPost(w.kai, { title: 'C' });
    expect((await w.kai.post(`/lff/posts/${a}/edit`, { title: 'A2' })).status).toBe(200);
    expect((await w.kai.post(`/lff/posts/${b}/edit`, { title: 'B2' })).status).toBe(200);   // the fifth: admitted (the control just under)

    const overCreate = await w.kai.post('/lff/posts', { ...BASE, title: 'D' });
    expect([overCreate.status, overCreate.body.error?.kind, overCreate.headers['retry-after']]).toEqual([429, 'rate_limited', '120']);
    expect(overCreate.headers['cache-control']).toBe('no-store');
    expect(overCreate.body.error.message).toBe('Too many requests; try again in 120 s.');
    const overEdit = await w.kai.post(`/lff/posts/${a}/edit`, { title: 'A3' });
    expect([overEdit.status, overEdit.headers['retry-after']]).toEqual([429, '120']);
    expect((await feedIds(w.kai, '?mine=1')).sort()).toEqual([a, b, c].sort());   // D was never made
    expect((await w.kai.get(`/lff/posts/${a}`)).body.data.title).toBe('A2');        // A3 was never written

    expect((await w.kai.post(`/lff/posts/${c}/close`)).status).toBe(200);   // a close is a write, not a post
    expect((await w.nova.post('/lff/posts', BASE)).status).toBe(200);       // another player is not charged

    w.advance(SOCIAL_BUDGETS.post.everyMs);
    expect((await w.kai.post('/lff/posts', { ...BASE, title: 'D' })).status).toBe(200);
    expect((await w.kai.post('/lff/posts', { ...BASE, title: 'E' })).status).toBe(429);
  });

  it('requests to join spend the invitation budget, shared with friend requests: ten at once, the eleventh is 429 (Retry-After 30) and is not run', async () => {
    const w = await lffBridge({ budgets: true });
    const targets: string[] = [];
    for (let i = 0; i < 5; i += 1) targets.push(await createPost(w.kai, { title: `Kai ${i}` }));
    for (let i = 0; i < 5; i += 1) targets.push(await createPost(w.vega, { title: `Vega ${i}` }));
    const rioPost = await createPost(w.rio, { title: 'Rio' });
    expect(targets).toHaveLength(SOCIAL_BUDGETS.invitation.burst);

    for (const postId of targets) await askToJoin(w.nova, postId);   // the tenth is admitted (the control just under)
    const over = await w.nova.post(`/lff/posts/${rioPost}/requests`, { message: 'one too many' });
    expect([over.status, over.body.error?.kind, over.headers['retry-after']]).toEqual([429, 'rate_limited', '30']);
    expect((await w.rio.get(`/lff/posts/${rioPost}/requests`)).body.data.requests).toEqual([]);   // not run
    // the SAME budget as a friend request
    expect((await w.nova.post('/requests', { toUserId: 'usr_rio' })).status).toBe(429);

    w.advance(SOCIAL_BUDGETS.invitation.everyMs);
    await askToJoin(w.nova, rioPost);
    expect((await w.rio.get(`/lff/posts/${rioPost}/requests`)).body.data.requests.map((r: any) => r.requester.userId)).toEqual(['usr_nova']);
  });
});

describe('caps and expiry over HTTP (review m3): a cap\'s refusal is the domain\'s 409 illegal-transition, beside an admitted control', () => {
  const refusedByCap = (answer: Answer, label: string) => {
    expect([answer.status, answer.body.error?.kind], `${label}: ${answer.text}`).toEqual([409, 'illegal-transition']);
  };

  it('open posts, then the rolling creation cap (closed posts count): the last admitted, the next 409; past the window, admitted again', async () => {
    const w = await lffBridge();
    const first: string[] = [];
    for (let i = 0; i < LFF_MAX_OPEN_POSTS_PER_USER; i += 1) first.push(await createPost(w.kai, { title: `Open ${i}` }));   // the last admitted
    const overOpen = await w.kai.post('/lff/posts', BASE);
    refusedByCap(overOpen, 'one open post too many');
    expect(overOpen.body.error.message).toContain('open posts');

    for (const id of first) expect((await w.kai.post(`/lff/posts/${id}/close`)).status).toBe(200);
    const second: string[] = [];
    for (let i = LFF_MAX_OPEN_POSTS_PER_USER; i < LFF_MAX_CREATED_PER_WINDOW; i += 1) second.push(await createPost(w.kai, { title: `Again ${i}` }));
    expect((await w.kai.post(`/lff/posts/${second[0]}/close`)).status).toBe(200);   // so the OPEN cap is not what refuses next
    const overCreated = await w.kai.post('/lff/posts', BASE);
    refusedByCap(overCreated, 'one creation too many in the window');
    expect(overCreated.body.error.message).toContain('24 hours');
    expect(await feedIds(w.kai, '?mine=1&limit=50')).toHaveLength(LFF_MAX_CREATED_PER_WINDOW);   // nothing more was made

    w.advance(LFF_CREATION_WINDOW_MS);
    refusedByCap(await w.kai.post('/lff/posts', BASE), 'at exactly the window\'s length, still inside it');
    w.advance(1);
    await createPost(w.kai, { title: 'A day later' });
  });

  it('pending requests: a player\'s last pending request out is admitted and the next is 409; a post\'s last pending is admitted and the next 409', async () => {
    const w = await lffBridge();
    // open posts from five other players, as many each as the open cap allows
    const posts: string[] = [];
    for (let p = 0; p < 5; p += 1) {
      for (let i = 0; i < LFF_MAX_OPEN_POSTS_PER_USER; i += 1) posts.push(await createPost(w.as(`tok-p${p}`), { title: `P${p}.${i}` }));
    }
    expect(posts.length).toBeGreaterThan(LFF_MAX_PENDING_OUTGOING_PER_USER);
    for (let i = 0; i < LFF_MAX_PENDING_OUTGOING_PER_USER; i += 1) await askToJoin(w.nova, posts[i]);   // the last admitted
    const next = posts[LFF_MAX_PENDING_OUTGOING_PER_USER];
    refusedByCap(await w.nova.post(`/lff/posts/${next}/requests`, {}), 'one pending request out too many');
    const nextOwner = w.as(`tok-p${Math.floor(LFF_MAX_PENDING_OUTGOING_PER_USER / LFF_MAX_OPEN_POSTS_PER_USER)}`);
    expect((await nextOwner.get(`/lff/posts/${next}/requests`)).body.data.requests).toEqual([]);   // not made

    // one post, as many pending requesters as it may hold: the last admitted, the next 409
    const crowded = await createPost(w.kai, { title: 'Crowded' });
    for (let r = 0; r < LFF_MAX_PENDING_PER_POST; r += 1) await askToJoin(w.as(`tok-p${100 + r}`), crowded);
    refusedByCap(await w.as(`tok-p${100 + LFF_MAX_PENDING_PER_POST}`).post(`/lff/posts/${crowded}/requests`, {}), 'one pending request on a post too many');
    expect((await w.kai.get(`/lff/posts/${crowded}/requests`)).body.data.requests).toHaveLength(LFF_MAX_PENDING_PER_POST);
  });

  it('expiry: at exactly its expiry a post is still OPEN; a millisecond later it leaves the feed, is the missing post\'s 404 to a stranger, and reads EXPIRED to its owner', async () => {
    const w = await lffBridge();
    const postId = await createPost(w.kai, { title: 'Two weeks' });
    const same = await uniform404(w);
    w.advance(LFF_POST_TTL_MS);
    expect(await feedIds(w.nova)).toEqual([postId]);   // the control: at expiresAt exactly, not yet past it
    expect((await w.nova.get(`/lff/posts/${postId}`)).body.data.status).toBe('OPEN');
    w.advance(1);
    expect(await feedIds(w.nova)).toEqual([]);
    same(await w.nova.get(`/lff/posts/${postId}`), 'an expired post, stranger: get');
    same(await w.nova.post(`/lff/posts/${postId}/requests`, {}), 'an expired post, stranger: request');
    expect((await w.kai.get(`/lff/posts/${postId}`)).body.data.status).toBe('EXPIRED');
    expect(await feedIds(w.kai, '?mine=1')).toEqual([postId]);
  });
});

describe('input: the domain\'s refusals reach the client as 400, each beside an accepted control', () => {
  it('an unknown field in the body or the query is 400 on every LFF operation, and changes nothing', async () => {
    const w = await lffBridge();
    const postId = await createPost(w.kai, { openSlots: 3 });
    const novaRequest = await askToJoin(w.nova, postId);
    expect((await w.vega.get('/lff/posts')).status).toBe(200);   // Vega's record exists before any refusal is measured

    const refusedThenAdmitted = async (label: string, refuse: () => Promise<Answer>, admit: () => Promise<Answer>) => {
      const before = await w.store!.read();
      const refused = await refuse();
      expect([refused.status, refused.body.error?.kind], `${label}: ${refused.text}`).toEqual([400, 'validation-failed']);
      expect(await w.store!.read(), `${label}: the state must not move`).toBe(before);
      const admitted = await admit();
      expect(admitted.status, `${label} control: ${admitted.text}`).toBe(200);
      return admitted;
    };

    await refusedThenAdmitted('create', () => w.kai.post('/lff/posts', { ...BASE, color: 'red' }), () => w.kai.post('/lff/posts', BASE));
    await refusedThenAdmitted('edit', () => w.kai.post(`/lff/posts/${postId}/edit`, { title: 'T2', color: 'red' }), () => w.kai.post(`/lff/posts/${postId}/edit`, { title: 'T2' }));
    const vega = await refusedThenAdmitted('request', () => w.vega.post(`/lff/posts/${postId}/requests`, { message: 'hi', note: 'x' }), () => w.vega.post(`/lff/posts/${postId}/requests`, { message: 'hi' }));
    const vegaRequest = vega.body.data.requestId as string;
    await refusedThenAdmitted('feed', () => w.nova.get('/lff/posts?sort=old'), () => w.nova.get('/lff/posts?category=BUILDERS'));
    await refusedThenAdmitted('get', () => w.nova.get(`/lff/posts/${postId}?t=1`), () => w.nova.get(`/lff/posts/${postId}`));
    await refusedThenAdmitted('inbox', () => w.kai.get(`/lff/posts/${postId}/requests?t=1`), () => w.kai.get(`/lff/posts/${postId}/requests`));
    await refusedThenAdmitted('mine', () => w.nova.get('/lff/requests?t=1'), () => w.nova.get('/lff/requests'));
    await refusedThenAdmitted('accept', () => w.kai.post(`/lff/requests/${novaRequest}/accept`, { note: 'x' }), () => w.kai.post(`/lff/requests/${novaRequest}/accept`));
    await refusedThenAdmitted('decline', () => w.kai.post(`/lff/requests/${vegaRequest}/decline`, { note: 'x' }), () => w.kai.post(`/lff/requests/${vegaRequest}/decline`));
    await refusedThenAdmitted('withdraw', () => w.nova.post(`/lff/requests/${novaRequest}/withdraw`, { why: 'x' }), () => w.nova.post(`/lff/requests/${novaRequest}/withdraw`));
    await refusedThenAdmitted('close', () => w.kai.post(`/lff/posts/${postId}/close`, { why: 'x' }), () => w.kai.post(`/lff/posts/${postId}/close`));
    await refusedThenAdmitted('delete', () => w.kai.post(`/lff/posts/${postId}/delete`, { why: 'x' }), () => w.kai.post(`/lff/posts/${postId}/delete`));
  });

  it('lengths and control characters are the domain\'s rule, unchanged by the route: one past a limit or a line break is 400; at the limit, 200', async () => {
    const w = await lffBridge();
    const status = async (answer: Promise<Answer>) => (await answer).status;
    expect(await status(w.kai.post('/lff/posts', { ...BASE, title: 'a'.repeat(81) }))).toBe(400);
    expect(await status(w.kai.post('/lff/posts', { ...BASE, description: 'd'.repeat(1001) }))).toBe(400);
    expect(await status(w.kai.post('/lff/posts', { ...BASE, title: 'line\nbreak' }))).toBe(400);
    expect(await status(w.kai.post('/lff/posts', { ...BASE, title: 'nul\u0000here' }))).toBe(400);
    expect(await feedIds(w.kai, '?mine=1')).toEqual([]);
    const atLimit = await createPost(w.kai, { title: 'a'.repeat(80), description: 'd'.repeat(1000) });
    await createPost(w.kai, { title: `Équipe ${String.fromCodePoint(0x1f415)}` });
    expect(await status(w.nova.post(`/lff/posts/${atLimit}/requests`, { message: 'm'.repeat(201) }))).toBe(400);
    expect(await status(w.nova.post(`/lff/posts/${atLimit}/requests`, { message: 'tab\there' }))).toBe(400);
    await askToJoin(w.nova, atLimit, 'm'.repeat(200));
  });
});

describe('the snapshot is untouched: LFF is read through its own routes only (the audit forbids a snapshot schema change)', () => {
  it('after posts and requests, each snapshot has the same keys as before and names no post, request or post text', async () => {
    const w = await lffBridge();
    const kaiKeys = Object.keys((await w.kai.get('/snapshot')).body.data).sort();
    const novaKeys = Object.keys((await w.nova.get('/snapshot')).body.data).sort();
    const postId = await createPost(w.kai, { title: 'Looking for a composer' });
    await askToJoin(w.nova, postId, 'I write music');
    for (const [player, keys] of [[w.kai, kaiKeys], [w.nova, novaKeys]] as const) {
      const snapshot = await player.get('/snapshot');
      expect(Object.keys(snapshot.body.data).sort()).toEqual(keys);
      for (const needle of ['lffp_', 'lffr_', 'Looking for a composer', 'I write music']) expect(snapshot.text).not.toContain(needle);
    }
  });
});
