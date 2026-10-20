/**
 * WONDERFS /wonderfs/v1 -- R2: the human WRITE routes (contract r1.4 §6.2, §6.4, §8.2, §8.4, §10.1, §11, §19.m3, INV-2, INV-8;
 * the routes plan §2.1 H11 / H12 and §4 R2). Mounted through wonderfs-routes.ts's dispatcher, behind the SAME gate as the reads
 * (wonderfs-gate.ts: desktop only, a live session, the operation table, the store, the read budget, then the role read NOW and
 * `authorizeHuman(write)` -- all before any WonderFS row or byte of the body is touched).
 *
 * ALWAYS ON (INV-10, §19.m6): nothing here reads a setting (wonderfs-http.test.ts scans this file). NOT GATED ON A COOLDOWN (plan D5):
 * §11's Q-3 "read-only for humans during a cooldown" has no governing clock yet, so R2 does not refuse writes for one -- on purpose.
 *
 * THE R2 WIRE SHAPES (for C1; additive fields only, §17; contract r1.5 is asked to record them). JSON answers are `{data:{schema,
 * ...}}`; every refusal is `{error:{kind, message}}` with `Cache-Control: no-store` (wonderfs-gate.ts), and a refusal that left the
 * body unread -- a gate refusal of any POST included -- also carries `Connection: close`.
 *   POST /wonderfs/v1/projects/:p/blobs                                  H11  upload ONE file's bytes
 *        Content-Type: application/octet-stream; Content-Length REQUIRED (411); optional `X-WonderFS-Sha256: <64 lowercase hex>`
 *        200 wonderfs.blob.v1 {sha256, size}       the same for bytes the project already holds (idempotent; nothing new kept)
 *        413 file_too_large                         Content-Length past the per-file limit (judged before a byte is read)
 *        413 project_full                           a NEW blob that does not fit beside main's live bytes and the PENDING bytes
 *                                                   (every held blob no file's history names: orphans and conflict-held uploads,
 *                                                   §19.m3 + R2-r2); nothing kept
 *        422 hash_mismatch                          the bytes hash to another address than X-WonderFS-Sha256; nothing kept
 *        429 rate_limited + Retry-After N           upload room in flight (declared bytes per process, 1 upload per player), the
 *                                                   player's upload INGRESS budget (every declared byte, never given back), or the
 *                                                   project's stored-bytes budget (given back when nothing new was kept -- but never
 *                                                   after a 422)
 *        400 / 408 / 415                            a short or over-long body, too slow (a deadline that shrinks with the declared
 *                                                   size: 10 s + 64 KiB/s, at most 300 s), not octet-stream
 *   POST /wonderfs/v1/projects/:p/branches/main/commits                  H12  one atomic change to main
 *        Content-Type: application/json, at most 1 MiB: {requestId, baseRev, ops[], resolvesConflictId?} and NOTHING else -- who
 *        makes the change is the signed-in player, never a field of the request (plan §2.2 interface point 2). Every number in it
 *        (baseRev, size, the expect* counters) is a whole number 0..2^31-1 (R2-r2, security MAJOR-1: a record is hashed and kept
 *        forever, §19.M7). The client mints `requestId` with at least 128 random bits (a CSPRNG; contract r1.6.2 a32.1, defence in
 *        depth). Ids are one namespace per (project, ACTOR) (wfs_requests, R2-r5 K4 / e2): another member sending the same id is an
 *        independent request -- it can neither take a player's next id first nor be answered with that player's outcome.
 *        200 wonderfs.commit_result.v1 {branchId, rev, commitId, commitHash, replay}
 *        409 conflict {error:{kind:'conflict', message, conflictId, branchId, headRev, replay, failures[{opIndex, kind, fileId,
 *            detail}], failureCount}}  -- NOTHING applied; the whole changeset is kept as the conflict (INV-2). A failure carries no
 *            path (§6.6: an error never echoes a path; the client knows its own ops by `opIndex`, and the stored record keeps them)
 *        409 duplicate_idempotency_key / conflict_closed
 *        413 project_full (§11 grow-only: a commit that SHRINKS an over-limit project is accepted) / request_too_large
 *        429 rate_limited + Retry-After N            the commit rate, the commit-body bytes budget, or -- with `reason:
 *                                                    'too_many_open_conflicts'` -- §8.4's OPEN-conflicts budget: resolving some lifts it
 *        429 conflict_storage_full + reason 'retained_conflicts' (R2-r3)  the RETAINED-conflict storage limit: closed conflicts are
 *                                                    kept 30 days and count until then, so resolving does NOT lift it; Retry-After N is
 *                                                    the time until the oldest closed one expires (absent when none is closed). A change
 *                                                    that lands is never refused by either conflict limit
 *        400 invalid_request                         malformed, a §6.6 path refusal included (the reserved `.wonderfs` root too);
 *                                                    never a conflict: the client's journal keeps it (§12)
 *   The three resolutions (§6.4) are all H12 with `resolvesConflictId` (helpers below; C1 mirrors them):
 *        keep mine   the conflict's ops again, at the counters the files have NOW          `wonderfsKeepMine`
 *        keep theirs `ops: []` -- a recorded dismissal                                      `wonderfsKeepTheirs`
 *        keep both   the preserved CONTENT created at `stem (conflict, <who>, <UTC>).ext`   `wonderfsKeepBoth` / `wonderfsKeepBothPath`
 *
 * THE ORDER, and why (R0a review MINOR-5; REVIEW_WONDERFS_R0B MINOR-1):
 *   1. the gate's role check (session -> player -> project_members NOW) -- an unknown project and a stranger get the one 404 before
 *      anything else, so nothing is learned from a replay;
 *   2. the write budget; the body (bounded, wonderfs-body.ts); its shape; its paths (§6.6); every operation against the gate's role;
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
import { normalizeWfsPath, wfsParentPath, wfsPathKey, WFS_MAX_COMPONENT_BYTES, WFS_MAX_PATH_CHARS } from '../src/relay/wonderfs/wonderfs-paths';
import {
  wfsBoundPage,
  WFS_DETAIL_FILE_TOO_LARGE,
  WFS_DETAIL_HASH_MISMATCH,
  WFS_DETAIL_RETAINED_CONFLICTS,
  WFS_DETAIL_TOO_MANY_OPEN_CONFLICTS,
  wfsRetainedConflictsFreeAt,
  WFS_PROJECT_FULL_MESSAGE,
  type WfsAuthorityNeed,
} from '../src/relay/wonderfs/wonderfs-store';
import {
  readWonderfsJson,
  readWonderfsOctets,
  wonderfsUploadDeclared,
  WONDERFS_UPLOAD_DEADLINE_MS,
  type WonderfsBodySource,
  type WonderfsBodyTimeouts,
} from './wonderfs-body';
import {
  createWonderfsBudgets,
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
  /** Fixed timeouts, for tests; absent, an upload's deadline follows its declared size (`wonderfsUploadDeadlineMs`). */
  readonly bodyTimeouts?: { readonly json?: WonderfsBodyTimeouts; readonly upload?: WonderfsBodyTimeouts };
}

/* --------------------------------------------------------------------------------------------------------- write budgets */

/**
 * §8.4 for writes (the routes plan §3.3; Alpha proposals, plan D3). A refused budget does nothing and charges nothing.
 *   commit        per (player, project): a burst of 30, then one per 2 s (R1's GCRA, wonderfs-budgets.ts, with this table);
 *   commit_any    per player, across every project: a burst of 60, then one per 1 s;
 *   commit bytes  per (player, project): 64 MiB of request bodies a day (R2-r2, security MAJOR-2(c): the commit RATE alone let a
 *                 player store ~1 MiB of conflict record every 2 s), charged each body's size once read;
 *   upload ingress  per PLAYER, across every project: 1 GiB a day of DECLARED upload bytes, charged before a byte is read and NEVER
 *                 given back (R2-r3, security R2r2-MINOR-1: a refund made holding the upload room free -- a slow upload that ends in a
 *                 422, or a re-upload of held bytes, now costs its sender);
 *   stored bytes  per (player, project): 512 MiB a day, charged the DECLARED size before a byte is read, and given back when nothing
 *                 new was kept -- a re-upload of bytes the project holds, a 413 or an outage (R2-r2, correctness MINOR-1) -- but NOT
 *                 after a 422 (the sender claimed an address its bytes do not have) nor when the client failed to send what it
 *                 declared (a stall or an abort keeps its cost);
 *   uploads in flight  at most 160 MiB DECLARED per process (two whole 64 MiB files, and room beside them) and 1 per player
 *                 (R2-r2, security MINOR-1: a small upload never takes a big slot, and a stalled one holds its slot only for
 *                 `wonderfsUploadDeadlineMs`);
 *   open conflicts      at most 100 OPEN per (player, project) (§8.4) -- resolving lifts it;
 *   retained conflicts  at most 500 RETAINED (open, or closed within its 30 days) per (player, project) -- a STORAGE limit time lifts;
 *                 both judged on the commit's OUTCOME inside its transaction (wonderfs-store.ts wfsConflictLimits).
 * The byte buckets forget a key once it is full again (pruned at most once a minute), so they never grow without bound.
 */
export const WONDERFS_WRITE_BUDGETS = Object.freeze({
  commit: Object.freeze({ burst: 30, everyMs: 2_000 }),
  commit_any: Object.freeze({ burst: 60, everyMs: 1_000 }),
});
const DAY_MINUTES = 1440;
export const WONDERFS_COMMIT_BYTE_BUDGET: WonderfsByteBudget = Object.freeze({ burstBytes: 64 * 1024 * 1024, perMinuteBytes: Math.floor((64 * 1024 * 1024) / DAY_MINUTES) });
export const WONDERFS_UPLOAD_BYTE_BUDGET: WonderfsByteBudget = Object.freeze({ burstBytes: 512 * 1024 * 1024, perMinuteBytes: Math.floor((512 * 1024 * 1024) / DAY_MINUTES) });
export const WONDERFS_UPLOAD_INGRESS_BUDGET: WonderfsByteBudget = Object.freeze({ burstBytes: 1024 * 1024 * 1024, perMinuteBytes: Math.floor((1024 * 1024 * 1024) / DAY_MINUTES) });
export const WONDERFS_MAX_UPLOAD_BYTES_IN_FLIGHT = 160 * 1024 * 1024;
export const WONDERFS_MAX_UPLOADS_PER_PLAYER = 1;
export const WONDERFS_UPLOAD_RETRY_MS = 1_000;
export const WONDERFS_MAX_OPEN_CONFLICTS = 100;
export const WONDERFS_MAX_RETAINED_CONFLICTS = 500;
/** §8.4's open-conflicts 429: resolving lifts it, so the client resolves and looks again in a minute. */
export const WONDERFS_OPEN_CONFLICTS_RETRY_MS = 60_000;
/** An upload's deadline: 10 s, plus its declared size at 64 KiB/s, at most WONDERFS_UPLOAD_DEADLINE_MS (R2-r2, security MINOR-1). */
export const WONDERFS_UPLOAD_GRACE_MS = 10_000;
export const WONDERFS_UPLOAD_MIN_BYTES_PER_SECOND = 64 * 1024;

export function wonderfsUploadDeadlineMs(declaredBytes: number): number {
  return Math.min(WONDERFS_UPLOAD_DEADLINE_MS, WONDERFS_UPLOAD_GRACE_MS + Math.ceil((declaredBytes * 1000) / WONDERFS_UPLOAD_MIN_BYTES_PER_SECOND));
}

export interface WonderfsWriteBudgets {
  takeCommit(playerId: string, projectId: string, now: number): WonderfsBudgetDecision;
  takeCommitBytes(playerId: string, projectId: string, bytes: number, now: number): WonderfsBudgetDecision;
  /** The stored-bytes budget per (player, project), and the INGRESS budget per player: both charged together, or neither. */
  takeUploadBytes(playerId: string, projectId: string, bytes: number, now: number): WonderfsBudgetDecision;
  /** Gives back STORED bytes only; ingress is never given back. */
  refundUploadBytes(playerId: string, projectId: string, bytes: number, now: number): void;
  /** Room for one upload of `declaredBytes` for `playerId`, or null (the process's room or the player's share is taken). The function gives it back, once. */
  startUpload(playerId: string, declaredBytes: number): (() => void) | null;
  readonly maxOpenConflicts: number;
  readonly maxRetainedConflicts: number;
}

export interface WonderfsWriteBudgetOptions {
  readonly commit?: WonderfsRate;
  readonly commitAny?: WonderfsRate;
  readonly commitBytes?: WonderfsByteBudget;
  readonly uploadBytes?: WonderfsByteBudget;
  readonly uploadIngress?: WonderfsByteBudget;
  readonly maxUploadBytesInFlight?: number;
  readonly maxUploadsPerPlayer?: number;
  readonly maxOpenConflicts?: number;
  readonly maxRetainedConflicts?: number;
}

/** A per-key byte bucket that can give bytes back, and forgets keys that are full again. */
function byteBucket(rate: WonderfsByteBudget) {
  const perMs = rate.perMinuteBytes / 60_000;
  const held = new Map<string, { tokens: number; at: number }>();
  let lastPrune = 0;
  const level = (key: string, now: number): number => {
    const h = held.get(key);
    return h === undefined ? rate.burstBytes : Math.min(rate.burstBytes, h.tokens + Math.max(0, now - h.at) * perMs);
  };
  const store = (key: string, tokens: number, now: number): void => {
    if (tokens >= rate.burstBytes) held.delete(key);
    else held.set(key, { tokens, at: now });
  };
  return {
    take(key: string, bytes: number, now: number): WonderfsBudgetDecision {
      if (now - lastPrune > 60_000) {
        lastPrune = now;
        for (const k of [...held.keys()]) if (level(k, now) >= rate.burstBytes) held.delete(k);
      }
      const tokens = level(key, now);
      if (bytes > tokens) return { ok: false, retryAfterMs: Math.ceil((bytes - tokens) / perMs), budget: 'bytes' };
      store(key, tokens - bytes, now);
      return { ok: true };
    },
    refund(key: string, bytes: number, now: number): void {
      store(key, Math.min(rate.burstBytes, level(key, now) + bytes), now);
    },
    get size(): number {
      return held.size;
    },
  };
}

export function createWonderfsWriteBudgets(options: WonderfsWriteBudgetOptions = {}): WonderfsWriteBudgets {
  // R1's GCRA with the commit table: its two classes are (player, project) and (player)
  const commits = createWonderfsBudgets({ read: options.commit ?? WONDERFS_WRITE_BUDGETS.commit, read_any: options.commitAny ?? WONDERFS_WRITE_BUDGETS.commit_any });
  const commitBytes = byteBucket(options.commitBytes ?? WONDERFS_COMMIT_BYTE_BUDGET);
  const uploadBytes = byteBucket(options.uploadBytes ?? WONDERFS_UPLOAD_BYTE_BUDGET);
  const ingress = byteBucket(options.uploadIngress ?? WONDERFS_UPLOAD_INGRESS_BUDGET);
  const maxInFlight = options.maxUploadBytesInFlight ?? WONDERFS_MAX_UPLOAD_BYTES_IN_FLIGHT;
  const maxPerPlayer = options.maxUploadsPerPlayer ?? WONDERFS_MAX_UPLOADS_PER_PLAYER;
  let inFlight = 0;
  const uploading = new Map<string, number>();
  // keyed by (player, project): a project id never holds '\n' (grants.ts PROJECT_ID_PATTERN)
  const key = (playerId: string, projectId: string): string => `${playerId}\n${projectId}`;
  return {
    takeCommit: (playerId, projectId, now) => commits.take(playerId, projectId, now),
    takeCommitBytes: (playerId, projectId, bytes, now) => commitBytes.take(key(playerId, projectId), bytes, now),
    takeUploadBytes(playerId, projectId, bytes, now) {
      const stored = uploadBytes.take(key(playerId, projectId), bytes, now);
      if (!stored.ok) return stored;
      const sent = ingress.take(playerId, bytes, now);
      if (!sent.ok) uploadBytes.refund(key(playerId, projectId), bytes, now); // a refused budget charges nothing
      return sent;
    },
    refundUploadBytes: (playerId, projectId, bytes, now) => uploadBytes.refund(key(playerId, projectId), bytes, now),
    startUpload(playerId, declaredBytes) {
      const mine = uploading.get(playerId) ?? 0;
      if (mine >= maxPerPlayer || inFlight + declaredBytes > maxInFlight) return null;
      inFlight += declaredBytes;
      uploading.set(playerId, mine + 1);
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        inFlight -= declaredBytes;
        const left = (uploading.get(playerId) ?? 1) - 1;
        if (left <= 0) uploading.delete(playerId);
        else uploading.set(playerId, left);
      };
    },
    maxOpenConflicts: options.maxOpenConflicts ?? WONDERFS_MAX_OPEN_CONFLICTS,
    maxRetainedConflicts: options.maxRetainedConflicts ?? WONDERFS_MAX_RETAINED_CONFLICTS,
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

/** The answer with `Connection: close`: its request's body was (or may have been) left unread, so the socket is not reused. */
export const wonderfsClosing = (answer: WonderfsAnswer): WonderfsAnswer => ({ ...answer, headers: { ...answer.headers, connection: 'close' } });
const invalid = (what: string): WonderfsAnswer => wonderfsError(400, 'invalid_request', `WonderFS refused the request: ${what}.`);

const CONFLICT_MESSAGE = 'Someone changed this first. Nothing was applied; your change is kept as a conflict: keep yours, keep theirs, or keep both.';

/** A store's refusal of a write, as HTTP. The reason (`details`) is logged here and never sent; nothing logged names a path. */
function writeRefusal(error: RelayError, what: string, now: number, log?: (line: string) => void): WonderfsAnswer {
  const details = error.details ?? [];
  const logged = (answer: WonderfsAnswer): WonderfsAnswer => {
    log?.(`wonderfs: ${what} refused ${error.code}${details.length === 0 ? '' : ` (${details.join('; ')})`}`);
    return answer;
  };
  if (error.code === 'budget-exceeded') {
    if (details.includes(WFS_DETAIL_TOO_MANY_OPEN_CONFLICTS)) {
      // §8.4's open-conflicts budget: resolving lifts it (a `reason` tells it from a plain rate limit: security MINOR-7)
      const n = wonderfsRetrySeconds(WONDERFS_OPEN_CONFLICTS_RETRY_MS);
      const message = `You have too many unresolved conflicts in this project: resolve some, then try again in ${n} s.`;
      return logged(wonderfsJson(429, { error: { kind: 'rate_limited', reason: 'too_many_open_conflicts', message } }, { 'retry-after': String(n) }));
    }
    if (details.includes(WFS_DETAIL_RETAINED_CONFLICTS)) {
      // R2-r3: the RETAINED-conflict storage limit. Resolving does not lift it; the oldest closed conflict's retention ending does --
      // so Retry-After is exactly that wait, and no Retry-After is sent when none is closed (no wait would help)
      const freeAt = wfsRetainedConflictsFreeAt(details);
      const n = freeAt === null ? null : wonderfsRetrySeconds(Date.parse(freeAt) - now);
      const message = `This project keeps each of your conflicts for 30 days after it closes, and it holds as many of yours as it keeps${n === null ? '' : `; the next one frees in ${n} s`}. A change that does not conflict still lands.`;
      return logged(wonderfsJson(429, { error: { kind: 'conflict_storage_full', reason: 'retained_conflicts', message } }, n === null ? {} : { 'retry-after': String(n) }));
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
/** The numbers a commit carries; each, when present, a whole number 0..WONDERFS_MAX_COUNTER (the engine judges its meaning). */
const OP_NUMBERS = ['size', 'expectContentVersion', 'expectPathVersion', 'expectVersion', 'expectSubtreeRev'] as const;
/**
 * R2-r2 (security MAJOR-1): the largest number a commit may carry -- revisions, counters, sizes. A commit record is hashed and kept
 * forever (§19.M7: "no integer above 2^53-1 appears in a record"; TJ-8's off-host verifier), so a number past this is refused before
 * anything is decided. 2^31-1 is the bound every WonderFS store query already uses for a revision.
 */
export const WONDERFS_MAX_COUNTER = 2_147_483_647;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/u;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCounter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= WONDERFS_MAX_COUNTER;

/**
 * H12's body, its SHAPE only (the engine judges every value it decides on, and the store hashes `ops` exactly as sent: a journal
 * replays its cached bytes verbatim, R0a review MINOR-6). Refused whole, before any lookup, when it names a field a commit does not
 * take -- a principal or actor field above all -- or an op this route does not know, or a number that is not a whole 0..2^31-1.
 */
export function wonderfsCommitBody(value: unknown, limits: WfsLimits): { ok: true; body: Required<WonderfsCommitBody> } | { ok: false; answer: WonderfsAnswer } {
  const no = (what: string) => ({ ok: false as const, answer: invalid(what) });
  if (!isObject(value)) return no('a commit is a JSON object');
  if (Object.keys(value).some((key) => !COMMIT_KEYS.has(key))) return no('a commit names a field it does not take (who makes a change is the signed-in player, never the request)');
  if (typeof value.requestId !== 'string') return no('the request id is malformed');
  if (!isCounter(value.baseRev)) return no(`the base revision is not a whole number from 0 to ${WONDERFS_MAX_COUNTER}`);
  if (!Array.isArray(value.ops)) return no('ops is not a list');
  if (value.ops.length > limits.maxOpsPerCommit) return no(`a commit has more than ${limits.maxOpsPerCommit} operations`);
  for (const op of value.ops as unknown[]) {
    if (!isObject(op) || typeof op.op !== 'string' || !Object.prototype.hasOwnProperty.call(OP_KEYS, op.op)) return no('an operation is not one of create / update / move / delete / undelete');
    const allowed = OP_KEYS[op.op as WfsOp['op']];
    if (Object.keys(op).some((key) => !allowed.has(key))) return no('an operation names a field it does not take');
    if (OP_NUMBERS.some((key) => op[key] !== undefined && !isCounter(op[key]))) return no(`an operation's number is not a whole number from 0 to ${WONDERFS_MAX_COUNTER}`);
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
  if (claimed !== undefined && !/^[0-9a-f]{64}$/u.test(claimed)) return wonderfsClosing(invalid('the content hash sent with the file is not 64 lowercase hex characters'));
  // 2. room in flight: the process's declared bytes, and this player's one upload
  const release = budgets === null ? () => undefined : budgets.startUpload(player, declared.value);
  if (release === null) return wonderfsClosing(wonderfsRateLimited(WONDERFS_UPLOAD_RETRY_MS));
  let charged = 0;
  /** Gives back the STORED bytes charged when nothing new was kept though the client sent what it declared (never after a 422; never ingress). */
  const refund = (): void => {
    if (budgets !== null && charged > 0) budgets.refundUploadBytes(player, projectId, charged, request.now);
    charged = 0;
  };
  try {
    // 3. the upload budget, charged the declared size before a byte is read
    if (budgets !== null) {
      const took = budgets.takeUploadBytes(player, projectId, declared.value, request.now);
      if (!took.ok) return wonderfsClosing(wonderfsRateLimited(took.retryAfterMs));
      charged = declared.value;
    }
    // 4. the bytes, streamed, never past the declared size or the cap, within a deadline that follows the declared size
    const read = await readWonderfsOctets(body, declared.value, { maxBytes: limits.maxFileBytes, deadlineMs: wonderfsUploadDeadlineMs(declared.value), ...deps.bodyTimeouts?.upload });
    if (!read.ok) return read.answer; // the client did not send what it declared: its cost stands
    // 5. an address claimed and not met: 422 at once, nothing kept, NOTHING given back (the store judges it again, for every caller)
    if (claimed !== undefined && claimed !== read.value.sha256) {
      return writeRefusal({ code: 'validation-failed', message: 'The file\'s bytes do not match the content hash sent with them; nothing was kept.', details: [WFS_DETAIL_HASH_MISMATCH] }, 'blob.upload', request.now, deps.log);
    }
    // 6. the store: re-hashes, re-reads the role INSIDE its transaction, the room (§19.m3), then keeps the bytes
    const stored = await admitted.store.putBlob(projectId, read.value.bytes, { claimedSha256: claimed ?? null, authority: { playerId: player, needs: [{ action: 'write', paths: [] }] } });
    if (!stored.ok) {
      if (!(stored.error.details ?? []).includes(WFS_DETAIL_HASH_MISMATCH)) refund(); // a 413 or an outage: nothing kept, nothing owed
      return writeRefusal(stored.error, 'blob.upload', request.now, deps.log);
    }
    if (!stored.value.created) refund(); // bytes the project already held: nothing new STORED (its ingress is still spent)
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
  // 1. the commit rate (before the body: a refused commit costs no read)
  if (budgets !== null) {
    const took = budgets.takeCommit(player, projectId, request.now);
    if (!took.ok) return wonderfsClosing(wonderfsRateLimited(took.retryAfterMs));
  }
  // 2. the body, bounded; its bytes against the day's budget; its shape
  const parsed = await readWonderfsJson(body, deps.bodyTimeouts?.json);
  if (!parsed.ok) return parsed.answer;
  if (budgets !== null) {
    const took = budgets.takeCommitBytes(player, projectId, parsed.value.size, request.now);
    if (!took.ok) return wonderfsRateLimited(took.retryAfterMs);
  }
  const shaped = wonderfsCommitBody(parsed.value.value, limits);
  if (!shaped.ok) return shaped.answer;
  const { requestId, baseRev, ops, resolvesConflictId } = shaped.body;
  // 3. every path it names against §6.6 -- a 400 (INV-2: malformed, never a conflict), the reserved root included (correctness MINOR-7)
  for (const op of ops) {
    const path: unknown = op.op === 'create' ? op.path : op.op === 'move' ? op.newPath : undefined;
    if (path === undefined) continue;
    const checked = normalizeWfsPath(path);
    if (!checked.ok) return writeRefusal(checked.error, 'commit.create', request.now, deps.log);
  }
  // 4. every operation against the role the gate read NOW (the store judges it again, inside the change)
  const needs = wonderfsCommitNeeds(ops, resolvesConflictId);
  for (const need of needs) {
    const allowed = authorizeHuman({ role: admitted.role, action: need.action, paths: need.paths });
    if (!allowed.ok) return wonderfsFromRelayError(allowed.error, 'commit.create', deps.log);
  }
  // 5. the change: the principal is the gate's (the session's player, its session_ref as provenance), never the body's
  const req: WfsCommitRequest = { requestId, branchId: WFS_MAIN_BRANCH, baseRev, ops, principal: admitted.principal, resolvesConflictId };
  const r = await admitted.store.commit(projectId, req, new Date(request.now).toISOString(), {
    playerId: player, needs, maxOpenConflicts: budgets?.maxOpenConflicts ?? null, maxRetainedConflicts: budgets?.maxRetainedConflicts ?? null,
  });
  if (!r.ok) return writeRefusal(r.error, 'commit.create', request.now, deps.log);
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
const graphemes = (text: string): string[] => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((g) => g.segment);
/** The most keep-both names tried for one file before the client is asked for a name. */
export const WONDERFS_KEEP_BOTH_ATTEMPTS = 99;

/**
 * KEEP BOTH's name (§6.4: `name (conflict, <who>, <UTC>).ext`), defined ONCE, here. In the same folder as `path`; `<UTC>` is the
 * colon-free `wonderfsCompactUtc` (an ISO time's `:` is refused by §6.6); `<who>` is the author's id with anything outside
 * `[A-Za-z0-9._-]` made `-`; the extension is the name's last `.suffix` (none for a leading-dot name such as `.env`). The STEM is
 * shortened, whole GRAPHEME CLUSTERS at a time (R2-r2: never splitting a letter from its accents), until the path is at most 200
 * characters and the name at most 255 UTF-8 bytes; every answer passes §6.6 (`normalizeWfsPath`). When the name is `taken` (by a
 * path key: an existing live entry, or another name this resolution chose), a counter follows the time -- `(conflict, <who>,
 * <UTC>, 2)` and on. null: no name fits (a folder that deep, or every counter taken): the client asks the player for a name.
 */
export function wonderfsKeepBothPath(path: string, who: string, atIso: string, taken: (pathKey: string) => boolean = () => false): string | null {
  const original = normalizeWfsPath(path);
  const utc = wonderfsCompactUtc(atIso);
  if (!original.ok || utc === null) return null;
  const name = original.value.components[original.value.components.length - 1];
  const parent = wfsParentPath(original.value.path);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const author = who.replace(/[^A-Za-z0-9._-]/gu, '-').slice(0, 64) || 'someone';
  for (let attempt = 1; attempt <= WONDERFS_KEEP_BOTH_ATTEMPTS; attempt += 1) {
    const suffix = ` (conflict, ${author}, ${utc}${attempt === 1 ? '' : `, ${attempt}`})`;
    const kept = graphemes(stem);
    while (kept.length > 0) {
      const leaf = `${kept.join('')}${suffix}${ext}`;
      const candidate = parent === null ? leaf : `${parent}/${leaf}`;
      if (candidate.length <= WFS_MAX_PATH_CHARS && utf8Bytes(leaf) <= WFS_MAX_COMPONENT_BYTES) {
        const checked = normalizeWfsPath(candidate);
        if (checked.ok) {
          if (!taken(checked.value.key)) return checked.value.path;
          break; // this counter's name is taken: the next counter
        }
      }
      kept.pop();
    }
    if (kept.length === 0) return null; // not even one grapheme of the stem fits beside the suffix
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
 * now). A file someone DELETED meanwhile is brought back first (an `undelete` at its version now, before the first op on it: R2-r2,
 * correctness MINOR-6), so "keep mine" over an `edit_deleted` lands. An op whose file this base does not know is re-sent as it was
 * given (the engine then answers for it). A path someone took meanwhile (`path_taken`, `parent_missing`) cannot be kept as it was:
 * re-sending conflicts again, and the client offers keep-both. A merge's ops (agent phase) are never a human's to re-send: null.
 */
export function wonderfsKeepMine(conflict: WfsConflict, now: WonderfsResolutionBase, requestId: string): WonderfsCommitBody | null {
  const ops: WfsOp[] = [];
  const restored = new Set<string>();
  const restore = (fileId: string, cur: WfsEntry | undefined): void => {
    if (cur === undefined || !cur.deleted || restored.has(fileId)) return;
    restored.add(fileId);
    ops.push({ op: 'undelete', fileId, expectVersion: cur.version });
  };
  for (const op of conflict.ops) {
    if (op.op === 'merge_put') return null;
    const cur = op.op === 'create' ? undefined : now.entries.get(op.fileId);
    switch (op.op) {
      case 'create':
        ops.push(op.kind === 'file' ? { op: 'create', path: op.path, kind: 'file', sha256: op.sha256, size: op.size } : { op: 'create', path: op.path, kind: 'dir' });
        break;
      case 'update':
        restore(op.fileId, cur);
        ops.push({ op: 'update', fileId: op.fileId, expectContentVersion: cur?.contentVersion ?? op.expectContentVersion, sha256: op.sha256, size: op.size });
        break;
      case 'move':
        restore(op.fileId, cur);
        ops.push({ op: 'move', fileId: op.fileId, expectPathVersion: cur?.pathVersion ?? op.expectPathVersion, newPath: op.newPath });
        break;
      case 'delete':
        if (cur === undefined) ops.push(op.expectContentVersion !== undefined ? { op: 'delete', fileId: op.fileId, expectContentVersion: op.expectContentVersion } : { op: 'delete', fileId: op.fileId, expectSubtreeRev: op.expectSubtreeRev as number });
        else if (cur.kind === 'dir') ops.push({ op: 'delete', fileId: op.fileId, expectSubtreeRev: wfsSubtreeRev(now.entries, cur) });
        else ops.push({ op: 'delete', fileId: op.fileId, expectContentVersion: cur.contentVersion });
        break;
      case 'undelete':
        if (!restored.has(op.fileId)) {
          restored.add(op.fileId);
          ops.push({ op: 'undelete', fileId: op.fileId, expectVersion: cur?.version ?? op.expectVersion });
        }
        break;
    }
  }
  return { requestId, baseRev: now.headRev, ops, resolvesConflictId: conflict.conflictId };
}

/**
 * KEEP BOTH (§6.4): the conflict's preserved CONTENT goes to new paths beside the originals (`wonderfsKeepBothPath`), and the current
 * files stay as they are. Content is what an `update` or a file `create` carries; moves, deletes, undeletes and folder creates carry
 * none, so they are not part of keep-both (keep mine re-applies them). Each name is unique among the live files NOW and the names this
 * resolution chose (a counter follows the time). null: there is no content to keep, or no name fits.
 */
export function wonderfsKeepBoth(conflict: WfsConflict, now: WonderfsResolutionBase, requestId: string): WonderfsCommitBody | null {
  const live = new Set<string>();
  for (const e of now.entries.values()) if (!e.deleted) live.add(e.pathKey);
  const chosen = new Set<string>();
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
    const path = wonderfsKeepBothPath(from, conflict.principal.id, conflict.atIso, (key) => live.has(key) || chosen.has(key));
    if (path === null) return null;
    chosen.add(wfsPathKey(path));
    ops.push({ op: 'create', path, kind: 'file', ...content });
  }
  return ops.length === 0 ? null : { requestId, baseRev: now.headRev, ops, resolvesConflictId: conflict.conflictId };
}
