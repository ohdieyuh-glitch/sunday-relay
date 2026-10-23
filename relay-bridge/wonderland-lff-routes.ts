/**
 * LOOKING FOR FEED routes. Not mounted on the bridge server by this change:
 * a composition root calls `handleLffHttp` with the session's own player.
 *
 * Paths are the LFF 037 list named in
 * wonderland/Tools/b33_v3_1b/server_check/ROUTES_cbe584be_vs_client_1e7cdebb.md.
 * `withdraw|accept|decline` is three paths. Listing withdraw is POST close.
 * The canonical prefix is `/wonderland/social`, the same prefix the desktop
 * client already puts in front of a social path. `/lff/...` is accepted too.
 */

import type {
  LffErrorCode,
  LffResult,
  WonderlandLffBoard,
} from '../src/relay/mission/wonderland/wonderland-lff';

export interface LffHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly actorId: string;
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly nowIso: string;
}

export interface LffHttpResponse {
  readonly status: number;
  readonly body:
    | { readonly ok: true; readonly result: unknown; readonly data?: unknown }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };
}

interface LffPattern {
  readonly method: 'GET' | 'POST';
  readonly template: string;
  readonly re: RegExp;
  readonly id: 'none' | 'listing' | 'request';
}

const ID = '([A-Za-z0-9_-]{1,80})';
const PATTERNS: readonly LffPattern[] = [
  { method: 'GET', template: '/lff/posts', re: /^\/lff\/posts$/, id: 'none' },
  { method: 'POST', template: '/lff/posts', re: /^\/lff\/posts$/, id: 'none' },
  { method: 'GET', template: '/lff/requests', re: /^\/lff\/requests$/, id: 'none' },
  { method: 'GET', template: '/lff/posts/:id', re: new RegExp(`^\\/lff\\/posts\\/${ID}$`), id: 'listing' },
  { method: 'POST', template: '/lff/posts/:id/edit', re: new RegExp(`^\\/lff\\/posts\\/${ID}\\/edit$`), id: 'listing' },
  { method: 'POST', template: '/lff/posts/:id/close', re: new RegExp(`^\\/lff\\/posts\\/${ID}\\/close$`), id: 'listing' },
  { method: 'POST', template: '/lff/posts/:id/delete', re: new RegExp(`^\\/lff\\/posts\\/${ID}\\/delete$`), id: 'listing' },
  { method: 'GET', template: '/lff/posts/:id/requests', re: new RegExp(`^\\/lff\\/posts\\/${ID}\\/requests$`), id: 'listing' },
  { method: 'POST', template: '/lff/posts/:id/requests', re: new RegExp(`^\\/lff\\/posts\\/${ID}\\/requests$`), id: 'listing' },
  { method: 'POST', template: '/lff/requests/:id/withdraw', re: new RegExp(`^\\/lff\\/requests\\/${ID}\\/withdraw$`), id: 'request' },
  { method: 'POST', template: '/lff/requests/:id/accept', re: new RegExp(`^\\/lff\\/requests\\/${ID}\\/accept$`), id: 'request' },
  { method: 'POST', template: '/lff/requests/:id/decline', re: new RegExp(`^\\/lff\\/requests\\/${ID}\\/decline$`), id: 'request' },
];

export const LFF_ROUTE_TEMPLATES: readonly { readonly method: 'GET' | 'POST'; readonly template: string }[] =
  PATTERNS.map(({ method, template }) => ({ method, template }));

const HTTP_STATUS: Readonly<Record<LffErrorCode, number>> = {
  invalid_category: 400,
  invalid_text: 400,
  invalid_contact: 400,
  invalid_player: 400,
  invalid_lifetime: 400,
  invalid_time: 400,
  invalid_body: 400,
  invalid_id: 500,
  actor_mismatch: 403,
  out_of_scope: 400,
  listing_cap: 409,
  category_cap: 409,
  not_found: 404,
  not_author: 403,
  not_open: 409,
  not_involved: 403,
  request_cap: 409,
  request_exists: 409,
  cannot_request_own: 403,
  not_requester: 403,
  request_not_open: 409,
  store_corrupt: 500,
  store_unavailable: 500,
};

const httpFail = (status: number, code: string, message: string): LffHttpResponse => ({
  status,
  body: { ok: false, error: { code, message } },
});

const httpOk = (status: number, result: unknown, data?: unknown): LffHttpResponse => ({
  status,
  body: data === undefined ? { ok: true, result } : { ok: true, result, data },
});

function desktopCreate(body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  if ('displayName' in record || 'contactMethod' in record || 'body' in record) return false;
  return 'description' in record || 'projectLabel' in record || 'skills' in record || 'openSlots' in record
    || (typeof record.category === 'string' && record.category === record.category.toUpperCase() && record.category !== record.category.toLowerCase());
}

function fromBoard(result: LffResult<unknown>, success: number): LffHttpResponse {
  if (!result.ok) return httpFail(HTTP_STATUS[result.code], result.code, result.message);
  return httpOk(success, result.value);
}

export function normalizeLffPath(path: string): string | null {
  if (path.includes('..') || path.includes('%') || path.includes('//') || path.includes('\\') || path.includes('?') || path.includes('#')) {
    return null;
  }
  let bare = path;
  if (bare.startsWith('/wonderland/social/')) bare = bare.slice('/wonderland/social'.length);
  if (bare.length > 1 && bare.endsWith('/')) bare = bare.slice(0, -1);
  if (!bare.startsWith('/lff/')) return null;
  return bare;
}

export function handleLffHttp(board: WonderlandLffBoard, request: LffHttpRequest): LffHttpResponse {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'POST') return httpFail(405, 'method_not_allowed', 'Looking for Feed allows GET and POST');
  const bare = normalizeLffPath(request.path);
  if (bare === null) return httpFail(400, 'invalid_path', 'path is not a safe Looking for Feed path');
  const hits = PATTERNS.filter((pattern) => pattern.re.test(bare));
  if (hits.length === 0) return httpFail(404, 'no_such_route', 'no such Looking for Feed route');
  const hit = hits.find((pattern) => pattern.method === method);
  if (hit === undefined) return httpFail(405, 'method_not_allowed', 'that Looking for Feed path does not allow this method');
  const found = hit.re.exec(bare);
  const id = found?.[1];
  const query = request.query ?? {};
  const body = request.body;
  const { actorId, nowIso } = request;

  switch (hit.template) {
    case '/lff/posts':
      if (hit.method === 'GET') {
        const category = query.category === undefined || query.category === '' ? undefined : query.category;
        if (query.category === '') return httpFail(400, 'invalid_category', 'category must be one of the Looking for Feed categories');
        const listed = board.list(actorId, category, nowIso);
        if (!listed.ok) return fromBoard(listed, 200);
        const page = board.desktopFeed(actorId, {
          category: query.category,
          projectLabel: query.projectLabel,
          skill: query.skill,
          mine: query.mine === '1',
          hasOpenSlots: query.hasOpenSlots === '1',
          cursor: query.cursor,
          limit: query.limit,
        }, nowIso);
        if (!page.ok) return fromBoard(page, 200);
        return httpOk(200, listed.value, page.value);
      }
      {
        const created = board.create(actorId, body, nowIso);
        if (!created.ok) return fromBoard(created, 201);
        return httpOk(desktopCreate(body) ? 200 : 201, created.value, { postId: created.value.listingId });
      }
    case '/lff/posts/:id':
      {
        const seen = board.get(actorId, id ?? '', nowIso);
        if (!seen.ok) return fromBoard(seen, 200);
        const detail = board.desktopPost(actorId, id ?? '', nowIso);
        if (!detail.ok) return fromBoard(detail, 200);
        return httpOk(200, seen.value, detail.value);
      }
    case '/lff/posts/:id/edit':
      return fromBoard(board.edit(actorId, id ?? '', body, nowIso), 200);
    case '/lff/posts/:id/close':
      return fromBoard(board.close(actorId, id ?? '', body, nowIso), 200);
    case '/lff/posts/:id/delete':
      return fromBoard(board.delete(actorId, id ?? '', body, nowIso), 200);
    case '/lff/posts/:id/requests':
      if (hit.method === 'GET') {
        const inbox = board.listPostRequests(actorId, id ?? '', nowIso);
        if (!inbox.ok) return fromBoard(inbox, 200);
        const desktop = board.desktopInbox(actorId, id ?? '', nowIso);
        const data = desktop.ok ? desktop.value : { postId: id ?? '', requests: [] };
        return httpOk(200, inbox.value, data);
      }
      {
        const asked = board.createRequest(actorId, id ?? '', body, nowIso);
        if (!asked.ok) return fromBoard(asked, 201);
        const record = body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
        const status = 'displayName' in record ? 201 : 200;
        return httpOk(status, asked.value, { requestId: asked.value.requestId });
      }
    case '/lff/requests':
      {
        const mine = board.listRequests(actorId, nowIso);
        if (!mine.ok) return fromBoard(mine, 200);
        const desktop = board.desktopMine(actorId, nowIso);
        if (!desktop.ok) return fromBoard(desktop, 200);
        return httpOk(200, mine.value, desktop.value);
      }
    case '/lff/requests/:id/withdraw':
      return fromBoard(board.withdrawRequest(actorId, id ?? '', body, nowIso), 200);
    case '/lff/requests/:id/accept':
      return fromBoard(board.acceptRequest(actorId, id ?? '', body, nowIso), 200);
    case '/lff/requests/:id/decline':
      return fromBoard(board.declineRequest(actorId, id ?? '', body, nowIso), 200);
    default:
      return httpFail(404, 'no_such_route', 'no such Looking for Feed route');
  }
}
