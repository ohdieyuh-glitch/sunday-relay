/**
 * WONDERFS /wonderfs/v1 -- R1: the READ routes, for the Wonderland desktop client (contract r1.4 §6.1, §7, §8.2, §9.1, §11, §17;
 * the routes plan §2.1). The WRITES (H11 upload, H12 commit) are R2's, in wonderfs-write-routes.ts, dispatched from here behind the
 * same gate.
 *
 * ALWAYS ON (INV-10, §19.m6): nothing in this file, the gate, the table or the budgets reads a setting. The one thing that can make
 * WonderFS answer 503 is a FACT -- this server has no database -- never a switch.
 *
 * THE R1 WIRE SHAPES (frozen for C1; R1 correctness review MINOR-4). JSON is `{data: {schema, ...}}` (§17); additive fields only.
 *   GET /wonderfs/v1/projects?after=&limit=                       H1  wonderfs.project_list.v1 {projects[{projectId, role}], next}
 *        next = the last projectId of this page when more follow (pass it as `after`), else null
 *   GET /wonderfs/v1/projects/:p                                  H4  wonderfs.project.v1 {projectId, role, genesisHash,
 *        main{headRev, headCommitHash}, usage{files, bytes}, lastEventSeq, limits{maxFileBytes, maxFiles, maxProjectBytes,
 *        maxOpsPerCommit, maxPathChars}}
 *   GET .../projects/:p/branches/main/tree?rev=&after=&limit=     H5  wonderfs.tree_page.v1 {branchId, rev, headRev, entries[WfsEntry],
 *        next}; next = an OPAQUE cursor pinned to this listing's revision and bound to this project (pass it as `after`), else null
 *   GET .../projects/:p/branches/main/files/:f?before=&limit=     H6  wonderfs.file.v1 {branchId, fileId, current, versions[{rev,
 *        entry}], next}; versions newest first; next = the last version number of this page (pass it as `before`), else null
 *   GET .../projects/:p/branches/main/files/:f/content?rev=       the file's BYTES at a revision (the head without `rev`)
 *   GET .../projects/:p/blobs/:sha256                             H7  a blob's BYTES, only if something of this project names it:
 *        a version, a current or fork-time entry, or a retained conflict, on ANY branch (R1 security MINOR-3: before the agent phase
 *        creates mission branches, decide whether a human may fetch an unmerged branch's bytes by address)
 *   GET .../projects/:p/events?after=&limit=&wait=0               H9  wonderfs.events_page.v1 {events[{seq, kind, body, atIso}],
 *        lastSeq, next}; next = the last seq of this page (pass it as `after`), else null; `after` absent = 0; `wait` absent = 0
 * Every JSON page is at most 1 MiB (§6.1, §7: the store bounds the items to 1 MiB - 4 KiB; the envelope is far below the rest).
 * Errors are the gate's model (wonderfs-gate.ts).
 *
 * BYTES. `application/octet-stream` (a WonderFS file has no media type: §6.2's create carries none, so octet-stream is the honest
 * type; the client names the file from the tree), `X-Content-Type-Options: nosniff`, `Content-Disposition: attachment`, a
 * `Content-Security-Policy` that runs nothing, `ETag: "<sha256>"` (strong: the address IS the bytes), `Accept-Ranges: bytes`.
 *   RANGE (RFC 9110 §14): one `bytes=a-b | a- | -n` is honoured (206 + Content-Range); an unsatisfiable one (§14.1.2: first-pos
 *   not less than the length, or a zero suffix-length) is 416 + `Content-Range: bytes *\/<length>`; an invalid one (§14.1.1: last-pos
 *   below first-pos), several ranges, or a malformed header are ignored (§14.2) and the whole file is sent. A 0-BYTE file: `bytes=0-`,
 *   `bytes=0-0` and `bytes=-0` are 416; `bytes=-n` (n > 0) is satisfiable (§14.1.2) but a 206 cannot carry an empty range, so it is
 *   ignored (§14.2) and the empty file is sent whole, 200 (`wonderfsRange` below).
 *   FOR THE C1 CLIENT (review of r4, MINOR-2): a 416 whose `Content-Range: bytes *\/<length>` length EQUALS the bytes it already
 *   holds means "COMPLETE" -- e.g. a resumed download (`Range: bytes=<held>-`, `If-Range: "<sha256>"`) of a file it already has
 *   whole -- never an error: keep the bytes held (and check them against the ETag's sha256).
 *   IF-RANGE (RFC 9110 §13.1.5, R1 correctness MAJOR-2): with a Range, it must STRONGLY match the current ETag, else the Range is
 *   ignored and the whole current file is sent (200). A weak tag or a date never matches (no Last-Modified is sent). So a client
 *   resuming `content` after the file changed gets the new file whole, never old and new bytes spliced.
 *   INTEGRITY (§10.1, §19.M6): every byte answer is checked against its address and recorded size BEFORE any byte is sent; a blob
 *   that fails is never served (503, and the log names it). The hash runs in 1 MiB slices with a yield between them (R1 security
 *   MAJOR-1(d)), so a 64 MiB check never holds the bridge's one thread -- social, voice and sign-in keep running. Nothing is trusted
 *   from an earlier check: the bytes are re-read and re-hashed per answer, and the per-player bytes budget pays for it.
 *   BUDGETS (wonderfs-budgets.ts): the range is judged on the recorded size first (a 416 costs no read); then a byte-read slot -- at
 *   most 2 per process and 1 per player; then the player's bytes budget, charged the WHOLE blob (it is read and hashed whole).
 *   SLOTS ALWAYS RETURN (R1 security BLOCKER-1 / correctness MAJOR-1): the writer releases a slot through `stream.finished`, which
 *   fires once whether the answer finished, failed, or the client had ALREADY gone during the read; a client gone during the read
 *   is also noticed before the hash; and a byte answer has a write deadline and an idle timeout, so a stalled reader frees its slot.
 *
 * NOT IN R1: `changes` (H8) and the conflicts list / record (H10) -- one record can pass the page bound and the client's 2 MiB
 * cap (REVIEW_WONDERFS_R0B MAJOR-1, C2: they wait for contract r1.5); long-poll (`wait` > 0, R4); a blob the caller uploaded but has
 * not committed (H7's pending-upload rule needs upload provenance, R2); reading a file BY PATH (a path never travels in a URL,
 * plan §2: a client resolves path -> file id from the tree it lists); streaming from the store (the WfsBlobStore seam, R2/R5).
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { finished } from 'node:stream';
import type { Pool } from 'pg';

import { openWfsPostgresStore } from '../src/relay/persistence/wonderfs-postgres';
import { WFS_ALPHA_LIMITS, type WfsLimits } from '../src/relay/wonderfs/wonderfs-contracts';
import { WFS_MAIN_BRANCH } from '../src/relay/wonderfs/wonderfs-engine';
import { WFS_MAX_PATH_CHARS } from '../src/relay/wonderfs/wonderfs-paths';
import type { WfsStore } from '../src/relay/wonderfs/wonderfs-store';
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
  type WonderfsRequest,
} from './wonderfs-gate';
import { isWonderfsRoute, type WonderfsQueryKey } from './wonderfs-scope';
import { serveWonderfsWrite, wonderfsClosing, type WonderfsWriteDeps, type WonderfsWriteRequest } from './wonderfs-write-routes';

export { isWonderfsRoute } from './wonderfs-scope';
export type { WonderfsAnswer, WonderfsRequest } from './wonderfs-gate';

export interface WonderfsRouteDeps extends WonderfsWriteDeps {
  /** The limits this deployment's store enforces (§11), reported by H4; default the Alpha's. */
  readonly limits?: WfsLimits;
}

/** A byte answer that holds a slot of the process's byte reads: the writer gives it back once the answer is written or abandoned. */
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

/**
 * ONE byte range of a `size`-byte body (RFC 9110 §14): `bytes=a-b`, `bytes=a-`, `bytes=-n`. Anything else -- several ranges, another
 * unit, a malformed header -- is ignored (whole), as §14.2 allows ("A server MAY ignore the Range header field").
 *   - INVALID (§14.1.1: "An int-range is invalid if the last-pos value is present and less than the first-pos"): ignored -> whole.
 *   - SATISFIABLE (§14.1.2): an int-range whose first-pos is less than the length, or a suffix-range with a NON-ZERO suffix-length.
 *     So `bytes=-0` is unsatisfiable (416) at any size, and `bytes=a-` / `bytes=a-b` with a >= length is unsatisfiable (416).
 *   - A 0-BYTE BODY (§14.1.2: "When a selected representation has zero length, the only satisfiable form of range-spec in a GET
 *     request is a suffix-range with a non-zero suffix-length"): `bytes=0-` and `bytes=0-0` are unsatisfiable (416), but
 *     `bytes=-n` (n > 0) IS satisfiable -- and a 206 cannot carry an empty range, so the Range is ignored (§14.2: a server "MAY
 *     ignore a Range header field when the selected representation has no content") and the empty body goes out whole, 200.
 *     R1-r5 (review of r4, MAJOR-1): that case answered 416 before.
 */
export function wonderfsRange(header: string | undefined, size: number): WonderfsRange {
  if (header === undefined) return { kind: 'whole' };
  const m = /^bytes=(\d{0,15})-(\d{0,15})$/u.exec(header.trim());
  if (m === null || (m[1] === '' && m[2] === '')) return { kind: 'whole' };
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return { kind: 'unsatisfiable' }; // §14.1.2: a zero suffix-length is never satisfiable
    if (size === 0) return { kind: 'whole' }; // satisfiable, but nothing to put in a 206: ignored (§14.2), the empty body whole
    return { kind: 'part', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  // only an EXPLICIT last position below the first is invalid (ignored); an open end is never compared before the size check --
  // R1-r4 (CI r1.10): `bytes=<size>-` once turned its open end into size-1 < start and answered the whole file instead of 416
  const explicitEnd = m[2] === '' ? null : Number(m[2]);
  if (explicitEnd !== null && explicitEnd < start) return { kind: 'whole' }; // §14.1.1: invalid, ignored
  if (start >= size) return { kind: 'unsatisfiable' }; // §14.1.2: first-pos not less than the length
  return { kind: 'part', start, end: Math.min(explicitEnd ?? size - 1, size - 1) };
}

/**
 * The range to honour, with If-Range (RFC 9110 §13.1.5): when both are present, the Range stands only if If-Range STRONGLY matches
 * this representation's ETag `"<sha256>"`; a weak tag (`W/"..."`) or an HTTP-date (no Last-Modified is ever sent) never matches, and
 * then the whole current body is the answer.
 */
export function wonderfsEffectiveRange(range: string | undefined, ifRange: string | undefined, sha256: string, size: number): WonderfsRange {
  if (range === undefined) return { kind: 'whole' };
  if (ifRange !== undefined && ifRange.trim() !== `"${sha256}"`) return { kind: 'whole' };
  return wonderfsRange(range, size);
}

/** sha256 in 1 MiB slices, yielding to the event loop between them: a 64 MiB check never blocks the bridge's one thread. */
const HASH_SLICE_BYTES = 1024 * 1024;
async function sha256Sliced(bytes: Uint8Array): Promise<string> {
  const hash = createHash('sha256');
  for (let at = 0; at < bytes.byteLength; at += HASH_SLICE_BYTES) {
    hash.update(bytes.subarray(at, at + HASH_SLICE_BYTES));
    if (at + HASH_SLICE_BYTES < bytes.byteLength) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return hash.digest('hex');
}

/** A referenced blob's bytes, checked against its address and recorded size, as 200 / 206 / 416. */
async function bytesAnswer(admitted: WonderfsAdmission, request: WonderfsRequest, deps: WonderfsRouteDeps, sha256: string, size: number): Promise<WonderfsByteAnswer> {
  const projectId = admitted.projectId as string;
  const player = admitted.principal.id;
  // 1. the range, judged on the recorded size before anything is read: a 416 costs no read
  const range = wonderfsEffectiveRange(request.range, request.ifRange, sha256, size);
  if (range.kind === 'unsatisfiable') return wonderfsError(416, 'range_not_satisfiable', 'That byte range is outside the file.', { 'content-range': `bytes */${size}` });
  // 2. a byte-read slot: the process's, and this player's share of it
  const release = deps.budgets === null ? () => undefined : deps.budgets.startByteRead(player);
  if (release === null) return wonderfsRateLimited(WONDERFS_BYTE_READ_RETRY_MS);
  let handedOver = false;
  try {
    // 3. the player's bytes budget: the WHOLE blob is read and verified, whatever the range
    if (deps.budgets !== null) {
      const took = deps.budgets.takeBytes(player, size, request.now);
      if (!took.ok) return wonderfsRateLimited(took.retryAfterMs);
    }
    // 4. ONE consistent read: the project is live, something of it names the address, and its bytes
    const read = await admitted.store.readReferencedBlob(projectId, sha256);
    if (!read.ok) return wonderfsFromRelayError(read.error, `${admitted.op.id} bytes`, deps.log);
    if (read.value === null) return wonderfsNotFound();
    // a client that left during the read is answered with nothing: no hash, and its slot comes back now (finally)
    if (request.closed?.() === true) return wonderfsUnavailable();
    // 5. integrity, before any byte is sent (§10.1, §19.M6)
    const bytes = read.value.bytes;
    if (bytes === null || read.value.size !== size || bytes.byteLength !== size || (await sha256Sliced(bytes)) !== sha256) {
      deps.log?.(`wonderfs: ${admitted.op.id} blob ${sha256} failed its check (${bytes === null ? 'bytes missing' : 'size or hash differs'}); nothing was served`);
      return wonderfsUnavailable();
    }
    if (request.closed?.() === true) return wonderfsUnavailable();
    const all = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const body = range.kind === 'part' ? all.subarray(range.start, range.end + 1) : all;
    const headers: Record<string, string> = {
      ...WONDERFS_NO_STORE,
      'content-type': 'application/octet-stream',
      'content-length': String(body.byteLength),
      'x-content-type-options': 'nosniff',
      // defence in depth (R1 security MINOR-4): if an auth mode ever let a browser fetch this, it would neither render nor run it
      'content-disposition': 'attachment',
      'content-security-policy': "default-src 'none'; sandbox",
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

/* ----------------------------------------------------------------------------------------------------------- operations */

const data = (schema: string, value: Record<string, unknown>): WonderfsAnswer => wonderfsJson(200, { data: { schema, ...value } });

async function serveAdmitted(admitted: WonderfsAdmission, request: WonderfsWriteRequest, deps: WonderfsRouteDeps): Promise<WonderfsByteAnswer> {
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
      // the file at that revision in ONE read (R1 reviews: security MINOR-1, correctness MINOR-3)
      const at = await store.fileAt(admitted.projectId as string, { branchId: WFS_MAIN_BRANCH, fileId: admitted.fileId as string, rev: rev ?? null });
      if (!at.ok) return refused(at);
      const e = at.value.entry;
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
    case 'blob.upload':
    case 'commit.create':
      return serveWonderfsWrite(admitted, request, deps); // R2: H11 / H12
    default:
      return wonderfsError(403, 'not_permitted', 'This session may not do that.');
  }
}

/**
 * THE ROUTE: null when the path is not WonderFS's; otherwise always an answer. A store that THROWS (an outage on a process's first
 * call, a protected store refused: REVIEW_WONDERFS_R0B MINOR-5) is 503 wonderfs_unavailable, never a 500 with a stack.
 */
export async function answerWonderfs(request: WonderfsWriteRequest, deps: WonderfsRouteDeps): Promise<WonderfsByteAnswer | null> {
  if (!isWonderfsRoute(request.url)) return null;
  try {
    const gate = await wonderfsGate(request, deps);
    // R2-r2 (reviews' NIT): a POST refused at the gate leaves its body unread -- the socket is closed, never drained for reuse
    if (!gate.ok) return request.method === 'GET' ? gate.answer : wonderfsClosing(gate.answer);
    return await serveAdmitted(gate.admitted, request, deps);
  } catch (error) {
    deps.log?.(`wonderfs: a request failed in the store (${error instanceof Error ? error.name : 'unknown'}); answered 503`);
    return wonderfsUnavailable();
  }
}

/* --------------------------------------------------------------------------------------------------------------- writing */

/** A byte answer's whole-transfer deadline and its idle timeout: a stalled or crawling reader cannot keep a slot (R1 security MAJOR-1(c)). */
export const WONDERFS_BYTE_WRITE_DEADLINE_MS = 300_000;
export const WONDERFS_BYTE_WRITE_IDLE_MS = 30_000;

export interface WonderfsWriteOptions {
  readonly deadlineMs?: number;
  readonly idleMs?: number;
}

/**
 * Write an answer (the bridge's CORS headers under it). A byte answer's slot is given back through `stream.finished`, registered
 * BEFORE anything is written: it fires exactly once whether the answer finished, failed, timed out, or the client had already gone
 * (a `close` that fired during the store read would never reach a listener added now -- R1 security BLOCKER-1, correctness
 * MAJOR-1). The deadline and the idle timeout destroy a transfer that does not finish, which fires `finished` too.
 */
export function writeWonderfsAnswer(res: ServerResponse, answer: WonderfsByteAnswer, extraHeaders: Readonly<Record<string, string>> = {}, options: WonderfsWriteOptions = {}): void {
  const release = answer.release;
  if (release !== undefined) {
    const deadline = setTimeout(() => res.destroy(), options.deadlineMs ?? WONDERFS_BYTE_WRITE_DEADLINE_MS);
    deadline.unref?.();
    finished(res, () => {
      clearTimeout(deadline);
      release();
    });
    res.setTimeout(options.idleMs ?? WONDERFS_BYTE_WRITE_IDLE_MS, () => res.destroy());
  }
  try {
    res.writeHead(answer.status, { ...extraHeaders, ...answer.headers });
    res.end(answer.body);
  } catch {
    // a response that cannot be written is ended here; `finished` then gives its slot back
    res.destroy();
  }
}

/* ----------------------------------------------------------------------------------------------------- the bridge mount */

/** What WonderFS reads of an HTTP request: the path after /relay-api with its query, five headers, whether the client is gone, and the body (read only by R2's writes, wonderfs-body.ts). */
export function wonderfsRequestOf(req: IncomingMessage, now: number): WonderfsWriteRequest {
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
    ifRange: header('if-range'),
    closed: () => req.socket.destroyed,
    now,
    body: req,
  };
}

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
