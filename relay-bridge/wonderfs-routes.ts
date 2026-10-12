/**
 * WONDERFS /wonderfs/v1 -- R1: the READ routes, for the Wonderland desktop client (contract r1.4 §6.1, §7, §8.2, §9.1, §11, §17;
 * the routes plan §2.1). Writes are R2.
 *
 * ALWAYS ON (INV-10, §19.m6): nothing in this file, the gate, the table or the budgets reads a setting. The one thing that can make
 * WonderFS answer 503 is a FACT -- this server has no database -- never a switch.
 *
 *   GET /wonderfs/v1/projects                                         H1  the caller's projects        wonderfs.project_list.v1
 *   GET /wonderfs/v1/projects/:p                                      H4  head, usage, limits          wonderfs.project.v1
 *   GET /wonderfs/v1/projects/:p/branches/main/tree?rev=&after=&limit=  H5  one page of the tree        wonderfs.tree_page.v1
 *   GET /wonderfs/v1/projects/:p/branches/main/files/:f?before=&limit=  H6  a file + its paged history  wonderfs.file.v1
 *   GET /wonderfs/v1/projects/:p/branches/main/files/:f/content?rev=    the file's BYTES at a revision (Range)
 *   GET /wonderfs/v1/projects/:p/blobs/:sha256                        H7  a blob's BYTES (Range), only if a version, an entry or a
 *                                                                          retained conflict of this project names it
 *   GET /wonderfs/v1/projects/:p/events?after=&limit=&wait=0          H9  lifecycle events, no long-poll yet  wonderfs.events_page.v1
 *
 * JSON answers are `{data: {schema: 'wonderfs.<object>.v1', ...}}` (§17), every page at most 1 MiB of JSON (§6.1, §7: the store
 * bounds the items to 1 MiB - 4 KiB, and the envelope here is far below the rest). Errors are the gate's model (wonderfs-gate.ts).
 *
 * BYTES. `application/octet-stream` (a WonderFS file has no media type: §6.2's create carries none, so octet-stream is the honest
 * type; the client names the file from the tree), `X-Content-Type-Options: nosniff`, `ETag: "<sha256>"`, `Accept-Ranges: bytes`.
 * One `Range: bytes=a-b | a- | -n` is honoured (206 + Content-Range); an unsatisfiable one is 416; several ranges, or a malformed
 * header, are ignored and the whole file is sent (RFC 9110 lets a server ignore Range). Every byte answer is RE-HASHED against its
 * address and size before it is sent: a stored blob that fails its check is never served silently (§19.M6) -- 503, and the log
 * names the blob. At most WONDERFS_MAX_BYTE_READS_IN_FLIGHT byte answers are in flight per process (wonderfs-budgets.ts).
 *
 * PAGE CURSORS. The tree's `after` is opaque and BOUND to its project: a cursor from another project's listing is refused (400),
 * never read as a position in this one. History (`before`: a version) and events (`after`: a sequence) page by the numbers the
 * client already holds (H4's `lastEventSeq`, a version), which mean the same thing in any project.
 *
 * NOT IN R1: `changes` (H8) and the conflicts list / record (H10) -- one record can pass the page bound and the client's 2 MiB
 * cap (REVIEW_WONDERFS_R0B MAJOR-1, C2: they wait for contract r1.5); long-poll (`wait` > 0, R4); a blob the caller uploaded but has
 * not committed (H7's pending-upload rule needs upload provenance, R2); reading a file BY PATH (a path never travels in a URL,
 * plan §2: a client resolves path -> file id from the tree it lists).
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';

import { openWfsPostgresStore } from '../src/relay/persistence/wonderfs-postgres';
import { WFS_ALPHA_LIMITS, type WfsEntry, type WfsLimits } from '../src/relay/wonderfs/wonderfs-contracts';
import { WFS_MAIN_BRANCH } from '../src/relay/wonderfs/wonderfs-engine';
import { WFS_MAX_PATH_CHARS } from '../src/relay/wonderfs/wonderfs-paths';
import { WFS_PAGE_MAX_LIMIT, type WfsStore } from '../src/relay/wonderfs/wonderfs-store';
import type { BrowserSessionStore } from './browser-session/grants';
import { createWonderfsBudgets, WONDERFS_BYTE_READ_RETRY_MS, type WonderfsBudgets } from './wonderfs-budgets';
import {
  wonderfsError,
  wonderfsFromRelayError,
  wonderfsGate,
  wonderfsJson,
  wonderfsNotFound,
  wonderfsRateLimited,
  wonderfsSessionVerifier,
  wonderfsUnavailable,
  WONDERFS_NO_STORE,
  type WonderfsAdmission,
  type WonderfsAnswer,
  type WonderfsGateDeps,
  type WonderfsRequest,
} from './wonderfs-gate';
import { isWonderfsRoute, type WonderfsQueryKey } from './wonderfs-scope';

export { isWonderfsRoute } from './wonderfs-scope';
export type { WonderfsAnswer, WonderfsRequest } from './wonderfs-gate';

export interface WonderfsRouteDeps extends WonderfsGateDeps {
  /** The limits this deployment's store enforces (§11), reported by H4; default the Alpha's. */
  readonly limits?: WfsLimits;
}

/** A byte answer that holds a slot of the process's byte-read budget: the writer releases it once the answer is written. */
export interface WonderfsByteAnswer extends WonderfsAnswer {
  readonly release?: () => void;
}

/* ------------------------------------------------------------------------------------------------------------------ query */

const invalid = (what: string): WonderfsAnswer => wonderfsError(400, 'invalid_request', `WonderFS refused the request: ${what}.`);

/** Plain tokens only (ids, numbers, cursors): anything encoded or spaced is refused, never decoded. */
const QUERY_VALUE = /^[A-Za-z0-9._:-]{1,160}$/u;
const WHOLE = /^(0|[1-9][0-9]{0,9})$/u;

/** The query as given, refused WHOLE if it names a key the operation does not read, names one twice, or holds an encoded value. */
function readQuery(search: string, allowed: readonly WonderfsQueryKey[]): { ok: true; values: Partial<Record<WonderfsQueryKey, string>> } | { ok: false; answer: WonderfsAnswer } {
  const values: Partial<Record<WonderfsQueryKey, string>> = {};
  for (const pair of search.split('&')) {
    if (pair === '') continue;
    const at = pair.indexOf('=');
    const key = at < 0 ? pair : pair.slice(0, at);
    const value = at < 0 ? '' : pair.slice(at + 1);
    if (!(allowed as readonly string[]).includes(key)) return { ok: false, answer: invalid('this request does not take that query parameter') };
    if (values[key as WonderfsQueryKey] !== undefined) return { ok: false, answer: invalid('a query parameter is given twice') };
    if (!QUERY_VALUE.test(value)) return { ok: false, answer: invalid('a query parameter is empty or malformed') };
    values[key as WonderfsQueryKey] = value;
  }
  return { ok: true, values };
}

/** A whole number from the query (the store judges its range), or undefined when absent; null = malformed. */
function whole(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  return WHOLE.test(value) ? Number(value) : null;
}

/* --------------------------------------------------------------------------------------------------------- tree cursors */

/** The tag binding a tree cursor to ONE listing (this project's main): a sha256 prefix of the project id -- the caller's own. */
const treeTag = (projectId: string): string =>
  createHash('sha256').update(`wonderfs.tree_page.v1\n${projectId}\n${WFS_MAIN_BRANCH}`, 'utf8').digest('hex').slice(0, 16);

export function wonderfsEncodeTreeCursor(projectId: string, storeCursor: string): string {
  return `${treeTag(projectId)}.${storeCursor}`;
}

const TREE_CURSOR = /^([0-9a-f]{16})\.((?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8}))$/u;

/** The store's cursor inside a route cursor, or why it is refused (a cursor from another project's listing is never a position here). */
function decodeTreeCursor(projectId: string, cursor: string): { ok: true; storeCursor: string } | { ok: false; answer: WonderfsAnswer } {
  const m = TREE_CURSOR.exec(cursor);
  if (m === null) return { ok: false, answer: invalid('the page cursor is malformed') };
  if (m[1] !== treeTag(projectId)) return { ok: false, answer: invalid('the page cursor belongs to another listing') };
  return { ok: true, storeCursor: m[2] };
}

/* ------------------------------------------------------------------------------------------------------------------ bytes */

export type WonderfsRange = { readonly kind: 'whole' } | { readonly kind: 'part'; readonly start: number; readonly end: number } | { readonly kind: 'unsatisfiable' };

/** ONE byte range of a `size`-byte body (RFC 9110 §14): `bytes=a-b`, `bytes=a-`, `bytes=-n`. Anything else is ignored (whole). */
export function wonderfsRange(header: string | undefined, size: number): WonderfsRange {
  if (header === undefined) return { kind: 'whole' };
  const m = /^bytes=(\d{0,15})-(\d{0,15})$/u.exec(header.trim());
  if (m === null || (m[1] === '' && m[2] === '')) return { kind: 'whole' };
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0 || size === 0) return { kind: 'unsatisfiable' };
    return { kind: 'part', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Number(m[2]);
  if (end < start) return { kind: 'whole' }; // syntactically invalid: ignored
  if (start >= size) return { kind: 'unsatisfiable' };
  return { kind: 'part', start, end: Math.min(end, size - 1) };
}

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A held blob's bytes, checked against its address and size, as 200 / 206 / 416. */
async function bytesAnswer(admitted: WonderfsAdmission, request: WonderfsRequest, deps: WonderfsRouteDeps, sha256: string, size: number): Promise<WonderfsByteAnswer> {
  const release = deps.budgets === null ? () => undefined : deps.budgets.startByteRead();
  if (release === null) return wonderfsRateLimited(WONDERFS_BYTE_READ_RETRY_MS);
  let handedOver = false;
  try {
    const projectId = admitted.projectId as string;
    const bytes = await admitted.store.readBlob(projectId, sha256);
    if (bytes === null || bytes.byteLength !== size || sha256Of(bytes) !== sha256) {
      deps.log?.(`wonderfs: ${admitted.op.id} blob ${sha256} failed its check (${bytes === null ? 'bytes missing' : 'size or hash differs'}); nothing was served`);
      return wonderfsUnavailable();
    }
    const range = wonderfsRange(request.range, size);
    if (range.kind === 'unsatisfiable') return wonderfsError(416, 'range_not_satisfiable', 'That byte range is outside the file.', { 'content-range': `bytes */${size}` });
    const all = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const body = range.kind === 'part' ? all.subarray(range.start, range.end + 1) : all;
    const headers: Record<string, string> = {
      ...WONDERFS_NO_STORE,
      'content-type': 'application/octet-stream',
      'content-length': String(body.byteLength),
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'bytes',
      etag: `"${sha256}"`,
      'x-wonderfs-sha256': sha256,
    };
    if (range.kind === 'part') headers['content-range'] = `bytes ${range.start}-${range.end}/${size}`;
    handedOver = true;
    return { status: range.kind === 'part' ? 206 : 200, headers, body, release };
  } finally {
    if (!handedOver) release();
  }
}

/** A file's entry on main at revision `rev` (the head when undefined): the newest version at or below it, from its history. */
async function entryAt(store: WfsStore, projectId: string, fileId: string, rev: number | undefined, log?: (line: string) => void): Promise<{ ok: true; entry: WfsEntry } | { ok: false; answer: WonderfsAnswer }> {
  if (rev !== undefined) {
    const head = await store.head(projectId);
    if (!head.ok) return { ok: false, answer: wonderfsFromRelayError(head.error, 'file.content head', log) };
    if (rev > head.value.main.headRev) return { ok: false, answer: wonderfsNotFound() };
  }
  let before: number | null = null;
  for (let pages = 0; pages < 100_000; pages += 1) {
    const page = await store.fileHistory(projectId, { branchId: WFS_MAIN_BRANCH, fileId, before, limit: rev === undefined ? 1 : WFS_PAGE_MAX_LIMIT });
    if (!page.ok) return { ok: false, answer: wonderfsFromRelayError(page.error, 'file.content history', log) };
    if (rev === undefined) return { ok: true, entry: page.value.current };
    // newest first; a file's revisions rise with its versions on one branch
    const found = page.value.versions.find((v) => v.rev <= rev);
    if (found !== undefined) return { ok: true, entry: found.entry };
    if (page.value.next === null) return { ok: false, answer: wonderfsNotFound() }; // it did not exist yet at that revision
    before = page.value.next;
  }
  return { ok: false, answer: wonderfsUnavailable() };
}

/* ----------------------------------------------------------------------------------------------------------- operations */

const data = (schema: string, value: Record<string, unknown>): WonderfsAnswer => wonderfsJson(200, { data: { schema, ...value } });

async function serveAdmitted(admitted: WonderfsAdmission, request: WonderfsRequest, deps: WonderfsRouteDeps): Promise<WonderfsByteAnswer> {
  const { op, store, principal } = admitted;
  const query = readQuery(admitted.search, op.query);
  if (!query.ok) return query.answer;
  const q = query.values;
  const limit = whole(q.limit);
  if (limit === null) return invalid('the page size is malformed');
  const refused = (r: { readonly ok: false; readonly error: Parameters<typeof wonderfsFromRelayError>[0] }) => wonderfsFromRelayError(r.error, op.id, deps.log);

  switch (op.id) {
    case 'projects.list': {
      const r = await store.projectsOf(principal.id, { after: q.after ?? null, limit });
      if (!r.ok) return refused(r);
      return data('wonderfs.project_list.v1', { projects: r.value.projects, next: r.value.next });
    }
    case 'project.read': {
      const projectId = admitted.projectId as string;
      const r = await store.head(projectId);
      if (!r.ok) return refused(r);
      const limits = deps.limits ?? WFS_ALPHA_LIMITS;
      return data('wonderfs.project.v1', {
        projectId,
        role: admitted.role,
        genesisHash: r.value.genesisHash,
        main: r.value.main,
        usage: r.value.usage,
        lastEventSeq: r.value.lastEventSeq,
        limits: { maxFileBytes: limits.maxFileBytes, maxFiles: limits.maxFiles, maxProjectBytes: limits.maxProjectBytes, maxOpsPerCommit: limits.maxOpsPerCommit, maxPathChars: WFS_MAX_PATH_CHARS },
      });
    }
    case 'tree.read': {
      const projectId = admitted.projectId as string;
      const rev = whole(q.rev);
      if (rev === null) return invalid('the revision is malformed');
      let cursor: string | null = null;
      if (q.after !== undefined) {
        const decoded = decodeTreeCursor(projectId, q.after);
        if (!decoded.ok) return decoded.answer;
        cursor = decoded.storeCursor;
      }
      const r = await store.tree(projectId, { branchId: WFS_MAIN_BRANCH, rev: rev ?? null, cursor, limit });
      if (!r.ok) return refused(r);
      return data('wonderfs.tree_page.v1', {
        branchId: r.value.branchId, rev: r.value.rev, headRev: r.value.headRev, entries: r.value.entries,
        next: r.value.next === null ? null : wonderfsEncodeTreeCursor(projectId, r.value.next),
      });
    }
    case 'file.history': {
      const before = whole(q.before);
      if (before === null) return invalid('the history cursor is malformed');
      const r = await store.fileHistory(admitted.projectId as string, { branchId: WFS_MAIN_BRANCH, fileId: admitted.fileId as string, before: before ?? null, limit });
      if (!r.ok) return refused(r);
      return data('wonderfs.file.v1', { branchId: r.value.branchId, fileId: r.value.fileId, current: r.value.current, versions: r.value.versions, next: r.value.next });
    }
    case 'file.content': {
      const rev = whole(q.rev);
      if (rev === null) return invalid('the revision is malformed');
      const at = await entryAt(store, admitted.projectId as string, admitted.fileId as string, rev, deps.log);
      if (!at.ok) return at.answer;
      const e = at.entry;
      // a deleted file, a directory: nothing to read there -- the one not-found
      if (e.deleted || e.kind !== 'file' || e.sha256 === null || e.size === null) return wonderfsNotFound();
      return bytesAnswer(admitted, request, deps, e.sha256, e.size);
    }
    case 'blob.read': {
      const sha256 = admitted.sha256 as string;
      const info = await store.blobInfo(admitted.projectId as string, sha256);
      if (!info.ok) return refused(info);
      // only a blob something of THIS project names: an uncommitted upload is not readable by address (H7)
      if (info.value === null || !info.value.referenced) return wonderfsNotFound();
      return bytesAnswer(admitted, request, deps, sha256, info.value.size);
    }
    case 'events.read': {
      const after = whole(q.after);
      if (after === null) return invalid('the event to read after is malformed');
      if (q.wait !== undefined && q.wait !== '0') return invalid('waiting for events (long-poll) is not served yet; ask with wait=0');
      const r = await store.events(admitted.projectId as string, { afterSeq: after ?? 0, limit });
      if (!r.ok) return refused(r);
      return data('wonderfs.events_page.v1', { events: r.value.events, lastSeq: r.value.lastSeq, next: r.value.next });
    }
    default:
      return wonderfsError(403, 'not_permitted', 'This session may not do that.');
  }
}

/**
 * THE ROUTE: null when the path is not WonderFS's; otherwise always an answer. A store that THROWS (an outage on a process's first
 * call, a protected store refused: REVIEW_WONDERFS_R0B MINOR-5) is 503 wonderfs_unavailable, never a 500 with a stack.
 */
export async function answerWonderfs(request: WonderfsRequest, deps: WonderfsRouteDeps): Promise<WonderfsByteAnswer | null> {
  if (!isWonderfsRoute(request.url)) return null;
  try {
    const gate = await wonderfsGate(request, deps);
    if (!gate.ok) return gate.answer;
    return await serveAdmitted(gate.admitted, request, deps);
  } catch (error) {
    deps.log?.(`wonderfs: a request failed in the store (${error instanceof Error ? error.name : 'unknown'}); answered 503`);
    return wonderfsUnavailable();
  }
}

/** Write an answer (with the bridge's CORS headers under it); a byte answer's budget slot is released once the socket is done. */
export function writeWonderfsAnswer(res: ServerResponse, answer: WonderfsByteAnswer, extraHeaders: Readonly<Record<string, string>> = {}): void {
  if (answer.release !== undefined) res.once('close', answer.release);
  res.writeHead(answer.status, { ...extraHeaders, ...answer.headers });
  res.end(answer.body);
}

/* ----------------------------------------------------------------------------------------------------- the bridge mount */

export interface WonderfsMountInput {
  readonly sessions: Pick<BrowserSessionStore, 'verifyNativeSocialSession' | 'nativeSocialSessionRef'>;
  /** The bridge's one database pool (server.ts juliusPool), or null: this server has no database. Asked per request. */
  readonly pool: () => Pool | null;
  readonly log?: (line: string) => void;
}

export interface WonderfsMount {
  serve(req: IncomingMessage, res: ServerResponse, extraHeaders: Readonly<Record<string, string>>): Promise<void>;
}

/**
 * WHAT server.ts MOUNTS: built ONCE per process (its budgets and its store live as long as the process), served from ONE dispatch
 * block. No flag, no setting: the store opens lazily on the bridge's pool, and no pool means 503 by fact.
 */
/** What WonderFS reads of an HTTP request: the path after /relay-api with its query, and four headers. Nothing else, no body. */
export function wonderfsRequestOf(req: IncomingMessage, now: number): WonderfsRequest {
  const header = (name: string): string | undefined => {
    const value = req.headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    method: req.method ?? 'GET',
    url: (req.url ?? '/').replace(/^\/relay-api/u, ''),
    authorization: header('authorization'),
    origin: header('origin'),
    clientBuild: header('x-wonderland-build'),
    range: header('range'),
    now,
  };
}

export function createWonderfsMount(input: WonderfsMountInput): WonderfsMount {
  const budgets: WonderfsBudgets = createWonderfsBudgets();
  const verifySession = wonderfsSessionVerifier(input.sessions);
  let opened: { readonly pool: Pool; readonly store: WfsStore } | null = null;
  const store = (): WfsStore | null => {
    const pool = input.pool();
    if (pool === null) return null;
    if (opened === null || opened.pool !== pool) opened = { pool, store: openWfsPostgresStore(pool) };
    return opened.store;
  };
  return {
    async serve(req, res, extraHeaders) {
      const answer = await answerWonderfs(wonderfsRequestOf(req, Date.now()), { verifySession, store, budgets, log: input.log });
      writeWonderfsAnswer(res, answer ?? wonderfsNotFound(), extraHeaders);
    },
  };
}
