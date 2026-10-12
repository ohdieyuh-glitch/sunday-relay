/**
 * WONDERFS /wonderfs/v1 -- R2: the human WRITE routes (contract r1.4 §6.2, §6.4, §8.2, §8.4, §10.1, §11, §19.m3, INV-2, INV-8;
 * the routes plan §2.1 H11 / H12 and §4 R2). Mounted through wonderfs-routes.ts's dispatcher, behind the SAME gate as the reads
 * (wonderfs-gate.ts: desktop only, a live session, the operation table, the store, the read budget, then the role read NOW and
 * `authorizeHuman(write)` -- all before any WonderFS row or byte of the body is touched).
 *
 * ALWAYS ON (INV-10, §19.m6): nothing here reads a setting (wonderfs-http.test.ts scans this file).
 *
 * THE R2 WIRE SHAPES (for C1; additive fields only, §17). JSON answers are `{data:{schema, ...}}`; every refusal is
 * `{error:{kind, message}}` with `Cache-Control: no-store` (wonderfs-gate.ts), and a refusal that left the body unread also carries
 * `Connection: close`.
 *   POST /wonderfs/v1/projects/:p/blobs                                  H11  upload ONE file's bytes
 *        Content-Type: application/octet-stream; Content-Length REQUIRED (411); optional `X-WonderFS-Sha256: <64 lowercase hex>`
 *        200 wonderfs.blob.v1 {sha256, size}       the same for bytes the project already holds (idempotent; nothing new kept)
 *        413 file_too_large                         Content-Length past the per-file limit (judged before a byte is read)
 *        413 project_full                           a NEW blob that does not fit beside main's live bytes and every uncommitted
 *                                                   upload's pending bytes (§19.m3); nothing kept
 *        422 hash_mismatch                          the bytes hash to another address than X-WonderFS-Sha256; nothing kept
 *        429 rate_limited + Retry-After N           an upload slot (2 per bridge process, 1 per player) or the upload budget
 *        400 / 408 / 415                            a short or over-long body, too slow, not octet-stream
 *   POST /wonderfs/v1/projects/:p/branches/main/commits                  H12  one atomic change to main
 *        Content-Type: application/json, at most 1 MiB: {requestId, baseRev, ops[], resolvesConflictId?} and NOTHING else -- who
 *        makes the change is the signed-in player, never a field of the request (plan §2.2 interface point 2)
 *        200 wonderfs.commit_result.v1 {branchId, rev, commitId, commitHash, replay}
 *        409 conflict {error:{kind:'conflict', message, conflictId, branchId, headRev, replay, failures[{opIndex, kind, fileId,
 *            detail}], failureCount}}  -- NOTHING applied; the whole changeset is kept as the conflict (INV-2). A failure carries no
 *            path (§6.6: an error never echoes a path; the client knows its own ops by `opIndex`, and the stored record keeps them)
 *        409 duplicate_idempotency_key / conflict_closed
 *        413 project_full (§11 grow-only: a commit that SHRINKS an over-limit project is accepted) / request_too_large
 *        429 rate_limited + Retry-After N            the commit budget, or the open-conflicts cap (resolve some first)
 *        400 invalid_request                         malformed (never a conflict: the client's journal keeps it, §12)
 *   The three resolutions (§6.4) are all H12 with `resolvesConflictId` (helpers below; C1 mirrors them):
 *        keep mine   the conflict's ops again, at the counters the files have NOW          `wonderfsKeepMine`
 *        keep theirs `ops: []` -- a recorded dismissal                                      `wonderfsKeepTheirs`
 *        keep both   the preserved CONTENT created at `stem (conflict, <who>, <UTC>).ext`   `wonderfsKeepBoth` / `wonderfsKeepBothPath`
 *
 * THE ORDER, and why (R0a review MINOR-5; REVIEW_WONDERFS_R0B MINOR-1):
 *   1. the gate's role check (session -> player -> project_members NOW) -- an unknown project and a stranger get the one 404 before
 *      anything else, so nothing is learned from a replay;
 *   2. the write budget; the body (bounded, wonderfs-body.ts); its shape; every operation against the gate's role (a cheap first no);
 *   3. the STORE re-reads the role INSIDE the write's own transaction and judges every operation again, BEFORE its replay lookup: a
 *      membership removed or demoted after step 1 writes nothing and answers the same 404.
 *   The idempotency hash is R0a's (wonderfs-engine.ts requestActor: the change + the player's stable identity, never the session),
 *   so a journal replay after a NEW sign-in -- a bridge restart signs everyone out -- answers the original revision.
 *
 * Logs: operation ids, error codes and the stores' reason tags only -- never a path, a token, a session ref or a byte of content.
 */

import type { RelayError } from '../src/relay/protocol/errors';
import { authorizeHuman } from '../src/relay/wonderfs/wonderfs-authz';
import { WFS_ALPHA_LIMITS, type WfsCommitOutcome, type WfsCommitRequest, type WfsConflict, type WfsEntry, type WfsFileId, type WfsLimits, type WfsOp } from '../src/relay/wonderfs/wonderfs-contracts';
import { WFS_MAIN_BRANCH, wfsSubtreeRev } from '../src/relay/wonderfs/wonderfs-engine';
import { normalizeWfsPath, wfsParentPath, WFS_MAX_COMPONENT_BYTES, WFS_MAX_PATH_CHARS } from '../src/relay/wonderfs/wonderfs-paths';
import {
  wfsBoundPage,
  WFS_DETAIL_FILE_TOO_LARGE,
  WFS_DETAIL_HASH_MISMATCH,
  WFS_DETAIL_OPEN_CONFLICTS,
  WFS_PROJECT_FULL_MESSAGE,
  type WfsAuthorityNeed,
} from '../src/relay/wonderfs/wonderfs-store';
import { readWonderfsJson, readWonderfsOctets, wonderfsUploadDeclared, type WonderfsBodySource, type WonderfsBodyTimeouts } from './wonderfs-body';
import {
  createWonderfsBudgets,
  WONDERFS_BUDGETS,
  wonderfsRetrySeconds,
  type WonderfsBudgetDecision,
  type WonderfsBudgets,
  type WonderfsByteBudget,
  type WonderfsRate,
} from './wonderfs-budgets';
import {
  wonderfsError,
  wonderfsFromRelayError,
  wonderfsJson,
  wonderfsRateLimited,
  type WonderfsAdmission,
  type WonderfsAnswer,
  type WonderfsGateDeps,
  type WonderfsRequest,
} from './wonderfs-gate';

/* ------------------------------------------------------------------------------------------------------------- the deps */

/** A request with its body (node:http's IncomingMessage, as wonderfs-routes.ts's `wonderfsRequestOf` passes it). */
export interface WonderfsWriteRequest extends WonderfsRequest {
  readonly body?: WonderfsBodySource;
}

export interface WonderfsWriteDeps extends WonderfsGateDeps {
  /** The limits this deployment's store enforces (§11); default the Alpha's. The upload reader caps at its `maxFileBytes`. */
  readonly limits?: WfsLimits;
  /**
   * The process's write budgets (§8.4). Absent: derived ONCE per `budgets` object (the mount builds one per process), so a mount can
   * never run writes unbudgeted by forgetting this. null: none -- only in a test that is not about budgets (as `budgets: null`).
   */
  readonly writeBudgets?: WonderfsWriteBudgets | null;
  readonly bodyTimeouts?: { readonly json?: WonderfsBodyTimeouts; readonly upload?: WonderfsBodyTimeouts };
}

/* --------------------------------------------------------------------------------------------------------- write budgets */

/**
 * §8.4 for writes (the routes plan §3.3; Alpha proposals, plan D3). Built from R1's own budget code (wonderfs-budgets.ts), with its
 * own tables, so there is ONE GCRA and ONE byte bucket in WonderFS:
 *   commit        per (player, project): a burst of 30, then one per 2 s;
 *   commit_any    per player, across every project: a burst of 60, then one per 1 s;
 *   upload bytes  per (player, project): 512 MiB a day (a bucket of 512 MiB refilled over 24 h), charged the DECLARED size before a
 *                 byte is read;
 *   uploads       at most 2 in flight per process and 1 per player (each holds up to 64 MiB in memory until it is stored);
 *   open conflicts at most 100 OPEN per (player, project), judged inside the commit's transaction (wonderfs-store.ts wfsAdmitCommit).
 */
export const WONDERFS_WRITE_BUDGETS = Object.freeze({
  commit: Object.freeze({ burst: 30, everyMs: 2_000 }),
  commit_any: Object.freeze({ burst: 60, everyMs: 1_000 }),
});
export const WONDERFS_UPLOAD_BYTE_BUDGET: WonderfsByteBudget = Object.freeze({ burstBytes: 512 * 1024 * 1024, perMinuteBytes: Math.floor((512 * 1024 * 1024) / 1440) });
export const WONDERFS_MAX_UPLOADS_IN_FLIGHT = 2;
export const WONDERFS_MAX_UPLOADS_PER_PLAYER = 1;
export const WONDERFS_UPLOAD_RETRY_MS = 1_000;
export const WONDERFS_MAX_OPEN_CONFLICTS = 100;
/** The open-conflicts cap is lifted by resolving, not by waiting; the client is told to look again in a minute. */
export const WONDERFS_OPEN_CONFLICTS_RETRY_MS = 60_000;

export interface WonderfsWriteBudgets {
  takeCommit(playerId: string, projectId: string, now: number): WonderfsBudgetDecision;
  takeUploadBytes(playerId: string, projectId: string, bytes: number, now: number): WonderfsBudgetDecision;
  /** One upload slot for `playerId`, or null (the process's or the player's share is taken). The function gives it back, once. */
  startUpload(playerId: string): (() => void) | null;
  readonly maxOpenConflicts: number;
}

export interface WonderfsWriteBudgetOptions {
  readonly commit?: WonderfsRate;
  readonly commitAny?: WonderfsRate;
  readonly uploadBytes?: WonderfsByteBudget;
  readonly maxUploads?: number;
  readonly maxUploadsPerPlayer?: number;
  readonly maxOpenConflicts?: number;
}

export function createWonderfsWriteBudgets(options: WonderfsWriteBudgetOptions = {}): WonderfsWriteBudgets {
  // R1's GCRA with the commit table: its two classes are (player, project) and (player)
  const commits = createWonderfsBudgets({ read: options.commit ?? WONDERFS_WRITE_BUDGETS.commit, read_any: options.commitAny ?? WONDERFS_WRITE_BUDGETS.commit_any });
  // R1's byte bucket and slots, as the upload budget and the upload slots
  const uploads = createWonderfsBudgets(WONDERFS_BUDGETS, {
    maxByteReads: options.maxUploads ?? WONDERFS_MAX_UPLOADS_IN_FLIGHT,
    maxByteReadsPerPlayer: options.maxUploadsPerPlayer ?? WONDERFS_MAX_UPLOADS_PER_PLAYER,
    byteBudget: options.uploadBytes ?? WONDERFS_UPLOAD_BYTE_BUDGET,
  });
  return {
    takeCommit: (playerId, projectId, now) => commits.take(playerId, projectId, now),
    // keyed by (player, project): a project id never holds '\n' (grants.ts PROJECT_ID_PATTERN)
    takeUploadBytes: (playerId, projectId, bytes, now) => uploads.takeBytes(`${playerId}\n${projectId}`, bytes, now),
    startUpload: (playerId) => uploads.startByteRead(playerId),
    maxOpenConflicts: options.maxOpenConflicts ?? WONDERFS_MAX_OPEN_CONFLICTS,
  };
}

const derivedWriteBudgets = new WeakMap<WonderfsBudgets, WonderfsWriteBudgets>();

/** The write budgets for these deps: given, none (null), or the ones derived once for this process's `budgets`. */
export function wonderfsWriteBudgetsOf(deps: WonderfsWriteDeps): WonderfsWriteBudgets | null {
  if (deps.writeBudgets !== undefined) return deps.writeBudgets;
  if (deps.budgets === null) return null;
  let held = derivedWriteBudgets.get(deps.budgets);
  if (held === undefined) {
    held = createWonderfsWriteBudgets();
    derivedWriteBudgets.set(deps.budgets, held);
  }
  return held;
}

/* ------------------------------------------------------------------------------------------------------------- answers */

const closing = (answer: WonderfsAnswer): WonderfsAnswer => ({ ...answer, headers: { ...answer.headers, connection: 'close' } });
const invalid = (what: string): WonderfsAnswer => wonderfsError(400, 'invalid_request', `WonderFS refused the request: ${what}.`);

const CONFLICT_MESSAGE = 'Someone changed this first. Nothing was applied; your change is kept as a conflict: keep yours, keep theirs, or keep both.';

/** A store's refusal of a write, as HTTP. The reason (`details`) is logged here and never sent; nothing logged names a path. */
function writeRefusal(error: RelayError, what: string, log?: (line: string) => void): WonderfsAnswer {
  const details = error.details ?? [];
  const logged = (answer: WonderfsAnswer): WonderfsAnswer => {
    log?.(`wonderfs: ${what} refused ${error.code}${details.length === 0 ? '' : ` (${details.join('; ')})`}`);
    return answer;
  };
  if (error.code === 'budget-exceeded') {
    if (details.includes(WFS_DETAIL_OPEN_CONFLICTS)) {
      const n = wonderfsRetrySeconds(WONDERFS_OPEN_CONFLICTS_RETRY_MS);
      return logged(wonderfsError(429, 'rate_limited', `You have too many unresolved conflicts in this project: resolve some; try again in ${n} s.`, { 'retry-after': String(n) }));
    }
    return logged(wonderfsError(413, 'project_full', WFS_PROJECT_FULL_MESSAGE));
  }
  if (error.code === 'validation-failed' && details.includes(WFS_DETAIL_HASH_MISMATCH)) return logged(wonderfsError(422, 'hash_mismatch', error.message));
  if (error.code === 'validation-failed' && details.includes(WFS_DETAIL_FILE_TOO_LARGE)) return logged(wonderfsError(413, 'file_too_large', 'That file is larger than a project allows.'));
  if (error.code === 'duplicate-idempotency-key') return logged(wonderfsError(409, 'duplicate_idempotency_key', 'That request id was already used for a different change.'));
  if (error.code === 'immutable') {
    return logged(details.includes('wonderfs: conflict resolved')
      ? wonderfsError(409, 'conflict_closed', 'That conflict is already resolved.')
      : wonderfsError(409, 'branch_closed', 'That branch is closed.'));
  }
  // not-found / permission-denied -> the one 404; validation-failed -> 400 (fixed phrases, no path: §6.6); outage -> 503; else 500
  return wonderfsFromRelayError(error, what, log);
}

/** §6.4: a 409 with the conflict's id and its failures -- each without a path (§6.6), bounded to one JSON page (§6.1). */
function conflictAnswer(outcome: Extract<WfsCommitOutcome, { status: 'conflict' }>): WonderfsAnswer {
  const failures = outcome.failures.map(({ opIndex, kind, fileId, detail }) => ({ opIndex, kind, fileId, detail }));
  const page = wfsBoundPage(failures, Math.max(1, failures.length));
  return wonderfsJson(409, {
    error: {
      kind: 'conflict',
      message: CONFLICT_MESSAGE,
      conflictId: outcome.conflictId,
      branchId: outcome.branchId,
      headRev: outcome.headRev,
      replay: outcome.replay,
      failures: page.items,
      failureCount: failures.length,
    },
  });
}

/* -------------------------------------------------------------------------------------------------------- the commit body */

export interface WonderfsCommitBody {
  readonly requestId: string;
  readonly baseRev: number;
  readonly ops: readonly WfsOp[];
  readonly resolvesConflictId?: string | null;
}

const COMMIT_KEYS: ReadonlySet<string> = new Set(['requestId', 'baseRev', 'ops', 'resolvesConflictId']);
/** Each op's fields (wonderfs-contracts.ts WfsOp). Anything else -- a principal, an actor, a server-assigned id -- is refused. */
const OP_KEYS: Readonly<Record<WfsOp['op'], ReadonlySet<string>>> = {
  create: new Set(['op', 'path', 'kind', 'sha256', 'size']),
  update: new Set(['op', 'fileId', 'expectContentVersion', 'sha256', 'size']),
  move: new Set(['op', 'fileId', 'expectPathVersion', 'newPath']),
  delete: new Set(['op', 'fileId', 'expectContentVersion', 'expectSubtreeRev']),
  undelete: new Set(['op', 'fileId', 'expectVersion']),
};
const ID = /^[A-Za-z0-9_.:-]{1,128}$/u;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * H12's body, its SHAPE only (the engine judges every value it decides on, and the store hashes `ops` exactly as sent: a journal
 * replays its cached bytes verbatim, R0a review MINOR-6). Refused whole, before any lookup, when it names a field a commit does not
 * take -- a principal or actor field above all -- or an op this route does not know.
 */
export function wonderfsCommitBody(value: unknown, limits: WfsLimits): { ok: true; body: Required<WonderfsCommitBody> } | { ok: false; answer: WonderfsAnswer } {
  const no = (what: string) => ({ ok: false as const, answer: invalid(what) });
  if (!isObject(value)) return no('a commit is a JSON object');
  if (Object.keys(value).some((key) => !COMMIT_KEYS.has(key))) return no('a commit names a field it does not take (who makes a change is the signed-in player, never the request)');
  if (typeof value.requestId !== 'string') return no('the request id is malformed');
  if (typeof value.baseRev !== 'number' || !Number.isInteger(value.baseRev) || value.baseRev < 0) return no('the base revision is malformed');
  if (!Array.isArray(value.ops)) return no('ops is not a list');
  if (value.ops.length > limits.maxOpsPerCommit) return no(`a commit has more than ${limits.maxOpsPerCommit} operations`);
  for (const op of value.ops as unknown[]) {
    if (!isObject(op) || typeof op.op !== 'string' || !Object.prototype.hasOwnProperty.call(OP_KEYS, op.op)) return no('an operation is not one of create / update / move / delete / undelete');
    const allowed = OP_KEYS[op.op as WfsOp['op']];
    if (Object.keys(op).some((key) => !allowed.has(key))) return no('an operation names a field it does not take');
  }
  const resolves = value.resolvesConflictId ?? null;
  if (resolves !== null && (typeof resolves !== 'string' || !ID.test(resolves))) return no('the conflict id is malformed');
  if (value.ops.length === 0 && resolves === null) return no('a commit has no operations');
  return { ok: true, body: { requestId: value.requestId, baseRev: value.baseRev, ops: value.ops as WfsOp[], resolvesConflictId: resolves } };
}

/**
 * What a commit DOES, as `authorizeHuman` judges it (plan §3.3 step 5): create / update / undelete -> write; move -> move (its new
 * path); delete -> delete; resolvesConflictId -> resolve. Paths are the ones the request names (a create's path, a move's new path):
 * an existing entry's own path was admitted when it was made (§6.6 refuses `.wonderfs` at the root at every write), so it is not
 * re-read here -- which would be a lookup before authorization.
 */
export function wonderfsCommitNeeds(ops: readonly WfsOp[], resolvesConflictId: string | null): WfsAuthorityNeed[] {
  const writes: string[] = [];
  const moves: string[] = [];
  let write = false;
  let move = false;
  let del = false;
  for (const op of ops) {
    if (op.op === 'create') {
      write = true;
      if (typeof op.path === 'string') writes.push(op.path);
    } else if (op.op === 'update' || op.op === 'undelete') {
      write = true;
    } else if (op.op === 'move') {
      move = true;
      if (typeof op.newPath === 'string') moves.push(op.newPath);
    } else if (op.op === 'delete') {
      del = true;
    }
  }
  const needs: WfsAuthorityNeed[] = [];
  if (write) needs.push({ action: 'write', paths: writes });
  if (move) needs.push({ action: 'move', paths: moves });
  if (del) needs.push({ action: 'delete', paths: [] });
  if (resolvesConflictId !== null) needs.push({ action: 'resolve', paths: [] });
  return needs;
}

/* -------------------------------------------------------------------------------------------------------------- serving */

const header = (source: WonderfsBodySource, name: string): string | undefined => {
  const value = source.headers[name];
  return typeof value === 'string' ? value : undefined;
};

/** H11: one file's bytes, streamed, hashed as they arrive, kept only if they fit and match (§10.1, §19.m3). */
async function uploadBlob(admitted: WonderfsAdmission, request: WonderfsWriteRequest, body: WonderfsBodySource, deps: WonderfsWriteDeps, budgets: WonderfsWriteBudgets | null): Promise<WonderfsAnswer> {
  const limits = deps.limits ?? WFS_ALPHA_LIMITS;
  const projectId = admitted.projectId as string;
  const player = admitted.principal.id;
  // 1. what is declared, judged before a byte is read
  const declared = wonderfsUploadDeclared(body, limits.maxFileBytes);
  if (!declared.ok) return declared.answer;
  const claimed = header(body, 'x-wonderfs-sha256');
  if (claimed !== undefined && !/^[0-9a-f]{64}$/u.test(claimed)) return closing(invalid('the content hash sent with the file is not 64 lowercase hex characters'));
  // 2. an upload slot: the process's, and this player's share of it
  const release = budgets === null ? () => undefined : budgets.startUpload(player);
  if (release === null) return closing(wonderfsRateLimited(WONDERFS_UPLOAD_RETRY_MS));
  try {
    // 3. the upload budget, charged the declared size before a byte is read
    if (budgets !== null) {
      const took = budgets.takeUploadBytes(player, projectId, declared.value, request.now);
      if (!took.ok) return closing(wonderfsRateLimited(took.retryAfterMs));
    }
    // 4. the bytes, streamed, never past the declared size or the cap
    const read = await readWonderfsOctets(body, declared.value, { maxBytes: limits.maxFileBytes, ...deps.bodyTimeouts?.upload });
    if (!read.ok) return read.answer;
    // 5. an address claimed and not met: 422 at once, nothing kept (the store judges it again, for every other caller)
    if (claimed !== undefined && claimed !== read.value.sha256) {
      return writeRefusal({ code: 'validation-failed', message: 'The file\'s bytes do not match the content hash sent with them; nothing was kept.', details: [WFS_DETAIL_HASH_MISMATCH] }, 'blob.upload', deps.log);
    }
    // 6. the store: re-hashes, re-reads the role INSIDE its transaction, the room (§19.m3), then keeps the bytes
    const stored = await admitted.store.putBlob(projectId, read.value.bytes, { claimedSha256: claimed ?? null, authority: { playerId: player, needs: [{ action: 'write', paths: [] }] } });
    if (!stored.ok) return writeRefusal(stored.error, 'blob.upload', deps.log);
    return wonderfsJson(200, { data: { schema: 'wonderfs.blob.v1', sha256: stored.value.sha256, size: stored.value.size } });
  } finally {
    release();
  }
}

/** H12: one atomic change to main (§6.2), a preserved conflict (§6.4), or the original answer to a request id it already took (INV-8). */
async function commitToMain(admitted: WonderfsAdmission, request: WonderfsWriteRequest, body: WonderfsBodySource, deps: WonderfsWriteDeps, budgets: WonderfsWriteBudgets | null): Promise<WonderfsAnswer> {
  const limits = deps.limits ?? WFS_ALPHA_LIMITS;
  const projectId = admitted.projectId as string;
  const player = admitted.principal.id;
  // 1. the commit budget (before the body: a refused commit costs no read)
  if (budgets !== null) {
    const took = budgets.takeCommit(player, projectId, request.now);
    if (!took.ok) return closing(wonderfsRateLimited(took.retryAfterMs));
  }
  // 2. the body, bounded; its shape
  const parsed = await readWonderfsJson(body, deps.bodyTimeouts?.json);
  if (!parsed.ok) return parsed.answer;
  const shaped = wonderfsCommitBody(parsed.value, limits);
  if (!shaped.ok) return shaped.answer;
  const { requestId, baseRev, ops, resolvesConflictId } = shaped.body;
  // 3. every operation against the role the gate read NOW (the store judges it again, inside the change)
  const needs = wonderfsCommitNeeds(ops, resolvesConflictId);
  for (const need of needs) {
    const allowed = authorizeHuman({ role: admitted.role, action: need.action, paths: need.paths });
    if (!allowed.ok) return wonderfsFromRelayError(allowed.error, 'commit.create', deps.log);
  }
  // 4. the change: the principal is the gate's (the session's player, its session_ref as provenance), never the body's
  const req: WfsCommitRequest = { requestId, branchId: WFS_MAIN_BRANCH, baseRev, ops, principal: admitted.principal, resolvesConflictId };
  const r = await admitted.store.commit(projectId, req, new Date(request.now).toISOString(), { playerId: player, needs, maxOpenConflicts: budgets?.maxOpenConflicts ?? null });
  if (!r.ok) return writeRefusal(r.error, 'commit.create', deps.log);
  if (r.value.status === 'conflict') return conflictAnswer(r.value);
  const c = r.value;
  return wonderfsJson(200, { data: { schema: 'wonderfs.commit_result.v1', branchId: c.branchId, rev: c.rev, commitId: c.commitId, commitHash: c.commitHash, replay: c.replay } });
}

/** THE WRITE ROUTES, for an operation the gate admitted (wonderfs-routes.ts dispatches H11 / H12 here). */
export async function serveWonderfsWrite(admitted: WonderfsAdmission, request: WonderfsWriteRequest, deps: WonderfsWriteDeps): Promise<WonderfsAnswer> {
  const body = request.body;
  if (body === undefined) return invalid('this request needs a body');
  const budgets = wonderfsWriteBudgetsOf(deps);
  if (admitted.op.id === 'blob.upload') return uploadBlob(admitted, request, body, deps, budgets);
  if (admitted.op.id === 'commit.create') return commitToMain(admitted, request, body, deps, budgets);
  return wonderfsError(403, 'not_permitted', 'This session may not do that.');
}

/* ------------------------------------------------------------------------------------------- conflict-resolution helpers */

/** An ISO instant as `YYYYMMDDTHHMMSSZ`: no `:`, which §6.6 refuses in a name (wonderfs-paths.ts). null for a non-date. */
export function wonderfsCompactUtc(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${String(at.getUTCFullYear()).padStart(4, '0')}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}T${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}Z`;
}

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/**
 * KEEP BOTH's name (§6.4: `name (conflict, <who>, <UTC>).ext`), defined ONCE, here. In the same folder as `path`; `<UTC>` is the
 * colon-free `wonderfsCompactUtc` (an ISO time's `:` is refused by §6.6); `<who>` is the author's id with anything outside
 * `[A-Za-z0-9._-]` made `-`; the extension is the name's last `.suffix` (none for a leading-dot name such as `.env`). The STEM is
 * shortened, whole code points at a time, until the path is at most 200 characters and the name at most 255 UTF-8 bytes; every
 * answer passes §6.6 (`normalizeWfsPath`). null: not even a one-character stem fits (a folder that deep: the client asks for a name).
 */
export function wonderfsKeepBothPath(path: string, who: string, atIso: string): string | null {
  const original = normalizeWfsPath(path);
  const utc = wonderfsCompactUtc(atIso);
  if (!original.ok || utc === null) return null;
  const name = original.value.components[original.value.components.length - 1];
  const parent = wfsParentPath(original.value.path);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const author = who.replace(/[^A-Za-z0-9._-]/gu, '-').slice(0, 64) || 'someone';
  const suffix = ` (conflict, ${author}, ${utc})`;
  const kept = [...stem];
  while (kept.length > 0) {
    const leaf = `${kept.join('')}${suffix}${ext}`;
    const candidate = parent === null ? leaf : `${parent}/${leaf}`;
    if (candidate.length <= WFS_MAX_PATH_CHARS && utf8Bytes(leaf) <= WFS_MAX_COMPONENT_BYTES) {
      const checked = normalizeWfsPath(candidate);
      if (checked.ok) return checked.value.path;
    }
    kept.pop();
  }
  return null;
}

/** The files as they are NOW (the head's entries, tombstones included) and the head revision: what a resolution is built against. */
export interface WonderfsResolutionBase {
  readonly entries: ReadonlyMap<WfsFileId, WfsEntry>;
  readonly headRev: number;
}

/** KEEP THEIRS (§6.4): a recorded dismissal -- no ops, naming the conflict. Nothing changes; the conflict closes as dismissed. */
export function wonderfsKeepTheirs(conflictId: string, requestId: string, baseRev: number): WonderfsCommitBody {
  return { requestId, baseRev, ops: [], resolvesConflictId: conflictId };
}

/**
 * KEEP MINE (§6.4): the conflict's own ops, re-sent at the counters each file has NOW (a directory delete at its subtree revision
 * now). An op whose file this base does not know is re-sent as it was given (the engine then answers for it). A merge's ops
 * (agent phase) are never a human's to re-send: null.
 */
export function wonderfsKeepMine(conflict: WfsConflict, now: WonderfsResolutionBase, requestId: string): WonderfsCommitBody | null {
  const ops: WfsOp[] = [];
  for (const op of conflict.ops) {
    if (op.op === 'merge_put') return null;
    const cur = op.op === 'create' ? undefined : now.entries.get(op.fileId);
    switch (op.op) {
      case 'create':
        ops.push(op.kind === 'file' ? { op: 'create', path: op.path, kind: 'file', sha256: op.sha256, size: op.size } : { op: 'create', path: op.path, kind: 'dir' });
        break;
      case 'update':
        ops.push({ op: 'update', fileId: op.fileId, expectContentVersion: cur?.contentVersion ?? op.expectContentVersion, sha256: op.sha256, size: op.size });
        break;
      case 'move':
        ops.push({ op: 'move', fileId: op.fileId, expectPathVersion: cur?.pathVersion ?? op.expectPathVersion, newPath: op.newPath });
        break;
      case 'delete':
        if (cur === undefined) ops.push(op.expectContentVersion !== undefined ? { op: 'delete', fileId: op.fileId, expectContentVersion: op.expectContentVersion } : { op: 'delete', fileId: op.fileId, expectSubtreeRev: op.expectSubtreeRev as number });
        else if (cur.kind === 'dir') ops.push({ op: 'delete', fileId: op.fileId, expectSubtreeRev: wfsSubtreeRev(now.entries, cur) });
        else ops.push({ op: 'delete', fileId: op.fileId, expectContentVersion: cur.contentVersion });
        break;
      case 'undelete':
        ops.push({ op: 'undelete', fileId: op.fileId, expectVersion: cur?.version ?? op.expectVersion });
        break;
    }
  }
  return { requestId, baseRev: now.headRev, ops, resolvesConflictId: conflict.conflictId };
}

/**
 * KEEP BOTH (§6.4): the conflict's preserved CONTENT goes to new paths beside the originals (`wonderfsKeepBothPath`), and the current
 * files stay as they are. Content is what an `update` or a file `create` carries; moves, deletes, undeletes and folder creates carry
 * none, so they are not part of keep-both (keep mine re-applies them). null: there is no content to keep, or no name fits.
 */
export function wonderfsKeepBoth(conflict: WfsConflict, now: WonderfsResolutionBase, requestId: string): WonderfsCommitBody | null {
  const ops: WfsOp[] = [];
  for (const op of conflict.ops) {
    let from: string | null = null;
    let content: { sha256: string; size: number } | null = null;
    if (op.op === 'create' && op.kind === 'file' && typeof op.sha256 === 'string' && typeof op.size === 'number') {
      from = op.path;
      content = { sha256: op.sha256, size: op.size };
    } else if (op.op === 'update') {
      from = now.entries.get(op.fileId)?.path ?? null;
      content = { sha256: op.sha256, size: op.size };
    }
    if (from === null || content === null) continue;
    const path = wonderfsKeepBothPath(from, conflict.principal.id, conflict.atIso);
    if (path === null) return null;
    ops.push({ op: 'create', path, kind: 'file', ...content });
  }
  return ops.length === 0 ? null : { requestId, baseRev: now.headRev, ops, resolvesConflictId: conflict.conflictId };
}
