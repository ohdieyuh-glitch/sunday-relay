/**
 * Durable Wonderland admission file.
 *
 * The operator-claim stack imports this module by this name. Schema version 3
 * is one JSON document: `{ schemaVersion, rows }`, keyed on the client's
 * `wlj_` id. Schema version 2 is the legacy `run:` document. It is read and
 * is not rewritten. Version 1 is refused: it has no place to put the required
 * `state` row. A write is a temp file in the same directory, an fsync of that
 * file, a rename onto the store path, and an fsync of the directory. One lock
 * file sits beside the store. A held lock fails closed, including when the
 * recorded pid is another process or a dead pid. This process never deletes a
 * lock it did not create. Corrupt bytes fail closed. A different numeric
 * schema version fails closed with `ledger_schema_unsupported`. Neither is
 * rewritten.
 *
 * The founder operator claim tool is the only writer of the dispatched
 * transition. This file keeps admitted rows, and `dispatched` stays false.
 * The in-memory ledger in `admission-store.ts` is for tests.
 */

import {
  closeSync, constants, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync, accessSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  SHA256_HEX, type ReviewedModelPins,
} from './admission-contract';
import { identifyAdmissionRun, parseJuliusAdmissionRunId, spentLockName } from './admission-run-id';
import type { AdmissionLedger, AdmissionLedgerRow, AdmissionState } from './admission-store';

/** New documents. Keyed on the client's `wlj_` id. `serverRunId` is that id. */
export const ADMISSION_FILE_SCHEMA_VERSION = 3;
/** Legacy `run:` rows. Readable, never rewritten, and not claimed. */
export const LEGACY_ADMISSION_SCHEMA_VERSION = 2;

const RECEIVED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const ROW_KEYS = [
  'phase', 'runId', 'serverRunId', 'keyHash', 'dispatchId', 'missionId', 'requestId',
  'clientLogSha256', 'clientUiActionUtc', 'receivedAt', 'ledgerRef', 'resultSha256', 'state',
  'modelPins',
] as const;

const PIN_KEYS = ['architectModel', 'codingModel', 'reviewerProvider', 'reviewerModel'] as const;

export type AdmissionFileClosedCode =
  | 'lock_held'
  | 'corrupt'
  | 'unwritable'
  | 'unwritten'
  | 'ledger_schema_unsupported'
  | 'legacy_readonly';

export class AdmissionFileClosedError extends Error {
  readonly code: AdmissionFileClosedCode;

  constructor(code: AdmissionFileClosedCode) {
    super(`admission_file_${code}`);
    this.name = 'AdmissionFileClosedError';
    this.code = code;
  }
}

export function isAdmissionFileClosed(error: unknown): error is AdmissionFileClosedError {
  return error instanceof AdmissionFileClosedError;
}

export type AdmissionStorePath =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false };

/**
 * A local absolute path whose parent directory exists and is writable.
 * Unset, relative, a URL, and a path this process cannot write are refused.
 * On Windows a drive-absolute path (`C:\...` or `C:/...`) is a path, not a URL
 * scheme. A drive-relative `C:foo` is still refused.
 */
export function resolveAdmissionStorePath(raw: string | undefined, platform: NodeJS.Platform = process.platform): AdmissionStorePath {
  if (typeof raw !== 'string') return { ok: false };
  const trimmed = raw.trim();
  const windowsDrivePath = platform === 'win32' && /^[a-zA-Z]:[\\/]/.test(trimmed);
  if (trimmed === '' || trimmed.includes('\0') || trimmed.includes('://')) return { ok: false };
  if (!windowsDrivePath && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return { ok: false };
  if (!isAbsolute(trimmed) || trimmed.startsWith('//')) return { ok: false };
  // A network share or a device namespace is not a local file: `\\server\share`, `\\?\`, `\\.\`.
  if (platform === 'win32' && (trimmed.startsWith('\\\\') || trimmed.startsWith('\\/') || trimmed.startsWith('/\\'))) return { ok: false };
  const filePath = resolve(trimmed);
  const dir = dirname(filePath);
  try {
    if (!statSync(dir).isDirectory()) return { ok: false };
    accessSync(dir, constants.W_OK);
    if (existsSync(filePath)) {
      if (!statSync(filePath).isFile()) return { ok: false };
      accessSync(filePath, constants.W_OK);
    }
  } catch {
    return { ok: false };
  }
  return { ok: true, path: filePath };
}

export interface FileAdmissionLedger extends AdmissionLedger {
  readonly filePath: string;
  close(): void;
}

export interface FileAdmissionLedgerOptions {
  /**
   * Test seam. Replaces the atomic writer for the reservation and the
   * completion. A throw on the reservation leaves the previous bytes. A
   * throw on the completion leaves the `LEDGER_UNWRITTEN` reservation.
   */
  readonly persist?: (filePath: string, contents: string) => void;
}

let temporaryFiles = 0;

export function createFileAdmissionLedger(
  filePath: string,
  options?: FileAdmissionLedgerOptions,
): FileAdmissionLedger {
  const located = resolveAdmissionStorePath(filePath);
  if (!located.ok) throw new AdmissionFileClosedError('unwritable');
  const resolved = located.path;
  const lockPath = `${resolved}.lock`;
  acquireLock(lockPath);
  let loaded: LoadedAdmission;
  try {
    loaded = readAdmission(resolved);
  } catch (error) {
    releaseLock(lockPath);
    throw error;
  }
  let rows = loaded.rows;
  const schemaVersion = loaded.schemaVersion;
  const persist = options?.persist ?? writeAdmissionFileAtomic;
  let closed = false;
  let pending: Promise<void> = Promise.resolve();
  return {
    filePath: resolved,
    async rows() {
      if (closed) throw new AdmissionFileClosedError('lock_held');
      return rows.map((row) => ({ ...row }));
    },
    legacyReadonly() {
      return schemaVersion === LEGACY_ADMISSION_SCHEMA_VERSION;
    },
    append(row) {
      const write = pending.then(() => {
        if (closed) throw new AdmissionFileClosedError('lock_held');
        if (schemaVersion !== ADMISSION_FILE_SCHEMA_VERSION) {
          throw new AdmissionFileClosedError('legacy_readonly');
        }
        // Both writes go through `persist`. The reservation hits disk before
        // the completion write. A failure of the completion leaves this
        // LEDGER_UNWRITTEN row for the next process.
        const reserved = [...rows, stamped(row, 'LEDGER_UNWRITTEN')];
        try {
          persist(resolved, documentText(reserved));
        } catch (error) {
          if (isAdmissionFileClosed(error) && error.code !== 'unwritten') throw error;
          throw new AdmissionFileClosedError('unwritten');
        }
        rows = reserved;
        try {
          const held = [...reserved.slice(0, -1), stamped(row, 'ADMISSION_HELD')];
          persist(resolved, documentText(held));
          rows = held;
        } catch (error) {
          if (isAdmissionFileClosed(error) && error.code !== 'unwritten') throw error;
          throw new AdmissionFileClosedError('unwritten');
        }
      });
      pending = write.then(() => undefined, () => undefined);
      return write;
    },
    close() {
      if (closed) return;
      closed = true;
      releaseLock(lockPath);
    },
  };
}

function stamped(row: AdmissionLedgerRow, state: 'ADMISSION_HELD' | 'LEDGER_UNWRITTEN'): AdmissionLedgerRow {
  return { ...row, state };
}

function documentText(rows: readonly AdmissionLedgerRow[]): string {
  return `${JSON.stringify({ schemaVersion: ADMISSION_FILE_SCHEMA_VERSION, rows })}\n`;
}

function writeAdmissionFileAtomic(filePath: string, data: string): void {
  temporaryFiles += 1;
  const tmpPath = `${filePath}.${process.pid}.${temporaryFiles}.tmp`;
  const fd = openSync(tmpPath, 'wx', 0o600);
  try {
    writeSync(fd, data, null, 'utf8');
    fsyncSync(fd);
  } catch (error) {
    try { closeSync(fd); } catch { /* already closing */ }
    try { unlinkSync(tmpPath); } catch { /* temp may be absent */ }
    throw error;
  }
  closeSync(fd);
  try {
    renameSync(tmpPath, filePath);
  } catch (error) {
    try { unlinkSync(tmpPath); } catch { /* temp may be absent */ }
    throw error;
  }
  fsyncDirectory(dirname(filePath));
}

/**
 * Windows cannot open a directory for fsync (EPERM), so the rename's directory
 * entry is not flushed there. Every other platform still fsyncs the directory,
 * and an error there still fails the write.
 */
function fsyncDirectory(dirPath: string, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') return;
  const fd = openSync(dirPath, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function acquireLock(lockPath: string): void {
  let fd: number;
  try {
    fd = openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new AdmissionFileClosedError('lock_held');
    throw new AdmissionFileClosedError('unwritable');
  }
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, purpose: 'wonderland-admission' }), null, 'utf8');
    fsyncSync(fd);
  } catch (error) {
    try { closeSync(fd); } catch { /* already closing */ }
    try { unlinkSync(lockPath); } catch { /* lock may be absent */ }
    throw error instanceof AdmissionFileClosedError ? error : new AdmissionFileClosedError('unwritable');
  }
  closeSync(fd);
  try {
    fsyncDirectory(dirname(lockPath));
  } catch (error) {
    try { unlinkSync(lockPath); } catch { /* lock may be absent */ }
    throw error instanceof AdmissionFileClosedError ? error : new AdmissionFileClosedError('unwritable');
  }
}

function releaseLock(lockPath: string): void {
  try { unlinkSync(lockPath); } catch { /* already released */ }
  try { fsyncDirectory(dirname(lockPath)); } catch { /* the lock name is already gone */ }
}

interface LoadedAdmission {
  readonly schemaVersion: typeof ADMISSION_FILE_SCHEMA_VERSION | typeof LEGACY_ADMISSION_SCHEMA_VERSION;
  readonly rows: AdmissionLedgerRow[];
}

function readRows(filePath: string): AdmissionLedgerRow[] {
  return readAdmission(filePath).rows;
}

function readAdmission(filePath: string): LoadedAdmission {
  if (!existsSync(filePath)) return { schemaVersion: ADMISSION_FILE_SCHEMA_VERSION, rows: [] };
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (text.trim() === '') throw new AdmissionFileClosedError('corrupt');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AdmissionFileClosedError('corrupt');
  }
  const doc = parsed as Record<string, unknown>;
  const keys = Object.keys(doc);
  if (keys.length !== 2 || !Object.hasOwn(doc, 'schemaVersion') || !Object.hasOwn(doc, 'rows')) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (typeof doc.schemaVersion !== 'number') throw new AdmissionFileClosedError('corrupt');
  if (doc.schemaVersion !== ADMISSION_FILE_SCHEMA_VERSION && doc.schemaVersion !== LEGACY_ADMISSION_SCHEMA_VERSION) {
    throw new AdmissionFileClosedError('ledger_schema_unsupported');
  }
  const schemaVersion = doc.schemaVersion === LEGACY_ADMISSION_SCHEMA_VERSION
    ? LEGACY_ADMISSION_SCHEMA_VERSION
    : ADMISSION_FILE_SCHEMA_VERSION;
  if (!Array.isArray(doc.rows)) throw new AdmissionFileClosedError('corrupt');
  const seenRun = new Set<string>();
  const seenKey = new Set<string>();
  const seenServer = new Set<string>();
  const rows: AdmissionLedgerRow[] = [];
  for (const item of doc.rows) {
    const row = parseRow(item, schemaVersion);
    if (seenRun.has(row.runId) || seenKey.has(row.keyHash) || seenServer.has(row.serverRunId)) {
      throw new AdmissionFileClosedError('corrupt');
    }
    seenRun.add(row.runId);
    seenKey.add(row.keyHash);
    seenServer.add(row.serverRunId);
    rows.push(row);
  }
  return { schemaVersion, rows };
}

function parseRow(
  value: unknown,
  schemaVersion: LoadedAdmission['schemaVersion'],
): AdmissionLedgerRow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdmissionFileClosedError('corrupt');
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== ROW_KEYS.length || ROW_KEYS.some((key) => !Object.hasOwn(row, key))) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (row.phase !== 'run_admission') throw new AdmissionFileClosedError('corrupt');
  const identity = identifyAdmissionRun(row.runId, row.serverRunId);
  const form = schemaVersion === LEGACY_ADMISSION_SCHEMA_VERSION ? 'legacy' : 'wlj';
  if (!identity.ok || identity.form !== form) throw new AdmissionFileClosedError('corrupt');
  if (typeof row.keyHash !== 'string' || !SHA256_HEX.test(row.keyHash)) throw new AdmissionFileClosedError('corrupt');
  if (typeof row.dispatchId !== 'string' || row.dispatchId.length < 1 || row.dispatchId.length > 128) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (!(row.missionId === null || (typeof row.missionId === 'string' && row.missionId.length > 0 && row.missionId.length <= 128))) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (typeof row.requestId !== 'string' || row.requestId.length < 1 || row.requestId.length > 128) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (typeof row.clientLogSha256 !== 'string' || !SHA256_HEX.test(row.clientLogSha256)) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (typeof row.clientUiActionUtc !== 'string' || row.clientUiActionUtc.length < 1 || row.clientUiActionUtc.length > 80) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (typeof row.receivedAt !== 'string' || !RECEIVED_AT.test(row.receivedAt)) throw new AdmissionFileClosedError('corrupt');
  if (typeof row.ledgerRef !== 'string' || !row.ledgerRef.startsWith('julius-wonderland-admission:')) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (row.resultSha256 !== null) throw new AdmissionFileClosedError('corrupt');
  if (row.state !== 'ADMISSION_HELD' && row.state !== 'LEDGER_UNWRITTEN') {
    throw new AdmissionFileClosedError('corrupt');
  }
  return {
    phase: 'run_admission',
    runId: identity.wljRunId,
    serverRunId: identity.serverRunId,
    keyHash: row.keyHash,
    dispatchId: row.dispatchId,
    missionId: row.missionId,
    requestId: row.requestId,
    clientLogSha256: row.clientLogSha256,
    clientUiActionUtc: row.clientUiActionUtc,
    receivedAt: row.receivedAt,
    ledgerRef: row.ledgerRef,
    resultSha256: null,
    state: row.state,
    modelPins: parsePins(row.modelPins),
  };
}

function parsePins(value: unknown): ReviewedModelPins {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdmissionFileClosedError('corrupt');
  }
  const pins = value as Record<string, unknown>;
  if (Object.keys(pins).length !== PIN_KEYS.length || PIN_KEYS.some((key) => !Object.hasOwn(pins, key))) {
    throw new AdmissionFileClosedError('corrupt');
  }
  const parsed = {} as Record<(typeof PIN_KEYS)[number], string | null>;
  for (const key of PIN_KEYS) {
    const item = pins[key];
    if (!(item === null || (typeof item === 'string' && item.length > 0 && item.length <= 128))) {
      throw new AdmissionFileClosedError('corrupt');
    }
    parsed[key] = item;
  }
  return parsed;
}

/**
 * Operator claims live beside the admission document, not inside it.
 * The admission file stays `{ schemaVersion, rows }`. `dispatched` is not a
 * row field. The journal uses the same atomic write, the same lock file, and
 * the same fail-closed errors. A held lock, a corrupt journal, or an unknown
 * schema version leaves both files as they are.
 */
const CLAIM_STATES = ['dispatched', 'dispatch_failed', 'already_spent'] as const;
const SPENT_TAG_STATES = ['unknown', 'present', 'absent'] as const;
const WORKFLOW_HALTS = ['RUN_ID_ALREADY_SPENT', 'SPENT_TAG_UNVERIFIED'] as const;
const DISPATCH_ERRORS = ['gh_workflow_run_failed', 'SPENT_TAG_UNVERIFIED'] as const;
const JOURNAL_KEYS = ['schemaVersion', 'revision', 'claims', 'progress', 'owners'] as const;
const OWNER_ID = /^[A-Za-z0-9_-]{1,128}$/;
/**
 * A stored progress token. The status route accepts only the closed status
 * unions and maps any other token to `unknown`. This check only bounds the
 * text so a later note can be read and refused.
 */
const PROGRESS_STATE = /^[a-z][a-z0-9_]{0,63}$/;
const PROGRESS_CAUSE = /^[\x20-\x7e]{1,200}$/;
const CLAIM_KEYS = [
  'wonderlandRunId', 'serverRunId', 'state', 'spentTag', 'spentTagState', 'at',
  'dispatchAttempted', 'dispatchError', 'halt', 'workflowRunId',
] as const;
/** A GitHub Actions workflow run id. Null until dispatch learns one. */
const WORKFLOW_RUN_ID = /^[1-9][0-9]{0,18}$/;

export type OperatorClaimState = (typeof CLAIM_STATES)[number];
export type SpentTagState = (typeof SPENT_TAG_STATES)[number];
export type WorkflowHalt = (typeof WORKFLOW_HALTS)[number];
export type DispatchError = (typeof DISPATCH_ERRORS)[number];

export interface StoredAdmission extends AdmissionLedgerRow {
  readonly admissionState: AdmissionState;
}

export interface ClaimEvent {
  readonly wonderlandRunId: string;
  readonly serverRunId: string;
  readonly state: OperatorClaimState;
  readonly spentTag: string;
  readonly spentTagState: SpentTagState;
  readonly at: string;
  readonly dispatchAttempted: boolean;
  readonly dispatchError: DispatchError | null;
  /** Workflow halt, when one was visible. Terminal. Never returns the record to admitted. */
  readonly halt: WorkflowHalt | null;
  /**
   * Hint only. The authoritative id is `workflow_run_id` in the spend tag's
   * `julius-run-spent.v1` message. This copy is the id `gh workflow run`
   * printed for the child this process spawned, or null until that print.
   * A request body, query, header, CLI flag, environment variable, or a
   * caller-supplied journal field does not set it on a new claim.
   */
  readonly workflowRunId: string | null;
}

/** True for a decimal GitHub workflow run id that fits in a signed 64-bit integer. */
export function isStoredWorkflowRunId(value: string): boolean {
  if (!WORKFLOW_RUN_ID.test(value)) return false;
  return value.length < 19 || value <= '9223372036854775807';
}

export interface StoredProgress {
  readonly serverRunId: string;
  readonly state: string;
  readonly cause: string | null;
  readonly updatedAt: string;
}

export interface OperatorDocument {
  readonly version: 1;
  readonly revision: number;
  readonly admissions: readonly StoredAdmission[];
  readonly claims: readonly ClaimEvent[];
  readonly progress: readonly StoredProgress[];
}

export interface AdmissionFileIo {
  read(): OperatorDocument;
  write(document: OperatorDocument): void;
}

export interface AdmissionFile {
  readonly path: string;
  readonly ledger: AdmissionLedger;
  exclusive<T>(job: (io: AdmissionFileIo) => Promise<T>): Promise<T>;
}

interface OperatorJournal {
  readonly schemaVersion: typeof ADMISSION_FILE_SCHEMA_VERSION | typeof LEGACY_ADMISSION_SCHEMA_VERSION;
  readonly revision: number;
  readonly claims: readonly ClaimEvent[];
  readonly progress: readonly StoredProgress[];
  readonly owners: Readonly<Record<string, string>>;
}

const tails = new Map<string, Promise<void>>();

function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(job, job);
  tails.set(key, run.then(() => undefined, () => undefined));
  return run;
}

/** Absolute local path whose parent #407's resolver will accept. A URL is not a store. */
export function isLocalStorePath(storePath: string): boolean {
  return resolveAdmissionStorePath(storePath).ok;
}

export function emptyOperatorDocument(): OperatorDocument {
  return { version: 1, revision: 0, admissions: [], claims: [], progress: [] };
}

export function operatorJournalPath(storePath: string): string {
  return `${storePath}.operator.json`;
}

/** Read rows and the journal. Does not take the lock and does not write. */
export function readAdmissionDocument(storePath: string): OperatorDocument {
  const located = resolveAdmissionStorePath(storePath);
  if (!located.ok) throw new AdmissionFileClosedError('unwritable');
  return composeDocument(located.path);
}

export function openAdmissionFile(storePath: string): AdmissionFile {
  const located = resolveAdmissionStorePath(storePath);
  if (!located.ok) throw new AdmissionFileClosedError('unwritable');
  const path = located.path;
  const lockPath = `${path}.lock`;
  const exclusive = <T>(job: (io: AdmissionFileIo) => Promise<T>): Promise<T> => enqueue(path, async () => {
    acquireLock(lockPath);
    try {
      let document = composeDocument(path);
      return await job({
        read: () => document,
        write: (next) => {
          writeJournal(path, next);
          document = composeDocument(path);
        },
      });
    } finally {
      releaseLock(lockPath);
    }
  });
  const ledger: AdmissionLedger = {
    async rows() {
      return enqueue(path, async () => {
        acquireLock(lockPath);
        try {
          return readRows(path).map((row) => ({ ...row }));
        } finally {
          releaseLock(lockPath);
        }
      });
    },
    legacyReadonly() {
      return readAdmission(path).schemaVersion === LEGACY_ADMISSION_SCHEMA_VERSION;
    },
    async append(row) {
      await enqueue(path, async () => {
        acquireLock(lockPath);
        try {
          const loaded = readAdmission(path);
          if (loaded.schemaVersion !== ADMISSION_FILE_SCHEMA_VERSION) {
            throw new AdmissionFileClosedError('legacy_readonly');
          }
          const current = loaded.rows;
          if (current.some((held) => held.runId === row.runId || held.serverRunId === row.serverRunId || held.keyHash === row.keyHash)) {
            throw new Error('admission_file_duplicate');
          }
          // Same two-phase reservation as the bridge writer. A current row
          // must carry `state` and `modelPins`. A failed completion leaves
          // LEDGER_UNWRITTEN and does not look like a held admission.
          const reserved = [...current, stamped(row, 'LEDGER_UNWRITTEN')];
          try {
            writeAdmissionFileAtomic(path, documentText(reserved));
          } catch (error) {
            if (isAdmissionFileClosed(error) && error.code !== 'unwritten') throw error;
            throw new AdmissionFileClosedError('unwritten');
          }
          try {
            const heldRows = [...reserved.slice(0, -1), stamped(row, 'ADMISSION_HELD')];
            writeAdmissionFileAtomic(path, documentText(heldRows));
          } catch (error) {
            if (isAdmissionFileClosed(error) && error.code !== 'unwritten') throw error;
            throw new AdmissionFileClosedError('unwritten');
          }
        } finally {
          releaseLock(lockPath);
        }
      });
    },
  };
  return { path, ledger, exclusive };
}

function composeDocument(path: string): OperatorDocument {
  const journal = readJournal(operatorJournalPath(path));
  return {
    version: 1,
    revision: journal.revision,
    admissions: readRows(path).map((row) => toStoredAdmission(row, journal.owners[row.serverRunId])),
    claims: journal.claims,
    progress: journal.progress,
  };
}

function toStoredAdmission(row: AdmissionLedgerRow, ownerPlayerId: string | undefined): StoredAdmission {
  return {
    ...row,
    admissionState: row.state === 'LEDGER_UNWRITTEN' ? 'LEDGER_UNWRITTEN' : 'ADMISSION_HELD',
    ...(ownerPlayerId === undefined ? {} : { ownerPlayerId }),
  };
}

/**
 * Record the player who admitted a row. The admission document itself stays
 * `{ schemaVersion, rows }`. This does not take the lock: the bridge already
 * holds it, and a path that is not a local store is ignored.
 */
export function recordAdmissionOwner(storePath: string | undefined, serverRunId: string, playerId: string): void {
  const located = resolveAdmissionStorePath(storePath);
  const parsed = parseJuliusAdmissionRunId(serverRunId);
  if (!located.ok || !parsed.ok || parsed.form !== 'wlj' || !OWNER_ID.test(playerId)) return;
  const journalPath = operatorJournalPath(located.path);
  const current = readJournal(journalPath);
  if (existsSync(journalPath) && current.schemaVersion !== ADMISSION_FILE_SCHEMA_VERSION) return;
  writeJournalBytes(located.path, {
    schemaVersion: ADMISSION_FILE_SCHEMA_VERSION,
    revision: current.revision,
    claims: current.claims,
    progress: current.progress,
    owners: { ...current.owners, [serverRunId]: playerId },
  });
}

function readJournal(
  journalPath: string,
  missingSchema: OperatorJournal['schemaVersion'] = ADMISSION_FILE_SCHEMA_VERSION,
): OperatorJournal {
  if (!existsSync(journalPath)) {
    return { schemaVersion: missingSchema, revision: 0, claims: [], progress: [], owners: {} };
  }
  let text: string;
  try {
    text = readFileSync(journalPath, 'utf8');
  } catch {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (text.trim() === '') throw new AdmissionFileClosedError('corrupt');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AdmissionFileClosedError('corrupt');
  const doc = parsed as Record<string, unknown>;
  const keys = Object.keys(doc);
  if (keys.length !== JOURNAL_KEYS.length || JOURNAL_KEYS.some((key) => !Object.hasOwn(doc, key))) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (doc.schemaVersion !== ADMISSION_FILE_SCHEMA_VERSION && doc.schemaVersion !== LEGACY_ADMISSION_SCHEMA_VERSION) {
    throw new AdmissionFileClosedError('corrupt');
  }
  const schemaVersion = doc.schemaVersion === LEGACY_ADMISSION_SCHEMA_VERSION
    ? LEGACY_ADMISSION_SCHEMA_VERSION
    : ADMISSION_FILE_SCHEMA_VERSION;
  if (typeof doc.revision !== 'number' || !Number.isInteger(doc.revision) || doc.revision < 0) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (!Array.isArray(doc.claims) || !Array.isArray(doc.progress)) throw new AdmissionFileClosedError('corrupt');
  if (doc.owners === null || typeof doc.owners !== 'object' || Array.isArray(doc.owners)) {
    throw new AdmissionFileClosedError('corrupt');
  }
  const owners: Record<string, string> = {};
  for (const [serverRunId, playerId] of Object.entries(doc.owners as Record<string, unknown>)) {
    if (!serverIdMatchesSchema(schemaVersion, serverRunId) || typeof playerId !== 'string' || !OWNER_ID.test(playerId)) {
      throw new AdmissionFileClosedError('corrupt');
    }
    owners[serverRunId] = playerId;
  }
  return {
    schemaVersion,
    revision: doc.revision,
    claims: doc.claims.map((claim) => parseClaim(claim, schemaVersion)),
    progress: doc.progress.map((note) => parseProgress(note, schemaVersion)),
    owners,
  };
}

function serverIdMatchesSchema(schemaVersion: OperatorJournal['schemaVersion'], serverRunId: unknown): boolean {
  const parsed = parseJuliusAdmissionRunId(serverRunId);
  if (!parsed.ok) return false;
  return schemaVersion === LEGACY_ADMISSION_SCHEMA_VERSION ? parsed.form === 'legacy' : parsed.form === 'wlj';
}

function parseProgress(value: unknown, schemaVersion: OperatorJournal['schemaVersion']): StoredProgress {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AdmissionFileClosedError('corrupt');
  const note = value as Record<string, unknown>;
  const keys = Object.keys(note);
  if (keys.length !== 4 || !['serverRunId', 'state', 'cause', 'updatedAt'].every((key) => Object.hasOwn(note, key))) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (typeof note.serverRunId !== 'string' || !serverIdMatchesSchema(schemaVersion, note.serverRunId)) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (typeof note.state !== 'string' || !PROGRESS_STATE.test(note.state)) throw new AdmissionFileClosedError('corrupt');
  if (note.cause !== null && (typeof note.cause !== 'string' || !PROGRESS_CAUSE.test(note.cause))) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (typeof note.updatedAt !== 'string' || !RECEIVED_AT.test(note.updatedAt)) throw new AdmissionFileClosedError('corrupt');
  return {
    serverRunId: note.serverRunId,
    state: note.state,
    cause: note.cause,
    updatedAt: note.updatedAt,
  };
}

/**
 * Record that the held phase was observed expired. The admission document
 * stays `{ schemaVersion, rows }` and the row stays `ADMISSION_HELD`. The
 * note is the terminal record: a later claim must not dispatch.
 *
 * This does not take the admission lock. The bridge holds that lock for the
 * process lifetime, and the status route runs in that process. A path that
 * is not a local store, a run id the shared module cannot parse, or a
 * timestamp that is not ISO-8601 is ignored. A legacy `run:` id keeps the
 * journal at schema v2 and does not rewrite the admission document. A claim
 * already stored for the server run, or the same expiry note, is left as it is.
 */
export function noteAwaitingOperatorExpiry(storePath: string, serverRunId: string, updatedAt: string): void {
  const located = resolveAdmissionStorePath(storePath);
  const parsed = parseJuliusAdmissionRunId(serverRunId);
  if (!located.ok || !parsed.ok || !RECEIVED_AT.test(updatedAt)) return;
  const journalPath = operatorJournalPath(located.path);
  const wanted = parsed.form === 'legacy' ? LEGACY_ADMISSION_SCHEMA_VERSION : ADMISSION_FILE_SCHEMA_VERSION;
  const current = readJournal(journalPath, wanted);
  if (existsSync(journalPath) && current.schemaVersion !== wanted) return;
  if (parsed.form === 'legacy' && readAdmission(located.path).schemaVersion !== LEGACY_ADMISSION_SCHEMA_VERSION) return;
  const admissionBefore = existsSync(located.path) ? readFileSync(located.path) : null;
  if (current.claims.some((event) => event.serverRunId === serverRunId)) return;
  if (current.progress.some((note) => isOperatorExpiry(note) && note.serverRunId === serverRunId)) return;
  writeJournalBytes(located.path, {
    schemaVersion: wanted,
    revision: current.revision + 1,
    claims: current.claims,
    progress: [...current.progress, {
      serverRunId,
      state: 'failed',
      cause: 'AWAITING_OPERATOR_EXPIRED',
      updatedAt,
    }],
    owners: current.owners,
  });
  if (admissionBefore !== null && !readFileSync(located.path).equals(admissionBefore)) {
    throw new AdmissionFileClosedError('legacy_readonly');
  }
}

function isOperatorExpiry(note: StoredProgress): boolean {
  return note.state === 'failed' && note.cause === 'AWAITING_OPERATOR_EXPIRED';
}

/**
 * The terminal held-phase note for this server run, if the journal has one.
 * The admission row stays `ADMISSION_HELD` after that note is written, so a
 * reader that sees only the row still has to call this before it acts.
 */
export function awaitingOperatorExpiryNote(
  progress: readonly StoredProgress[],
  serverRunId: string,
): StoredProgress | null {
  return progress.find((note) => note.serverRunId === serverRunId && isOperatorExpiry(note)) ?? null;
}

function writeJournal(path: string, document: OperatorDocument): void {
  const journalPath = operatorJournalPath(path);
  const current = readJournal(journalPath);
  if (existsSync(journalPath) && current.schemaVersion === LEGACY_ADMISSION_SCHEMA_VERSION) {
    throw new AdmissionFileClosedError('legacy_readonly');
  }
  const incomingProgress = (document.progress ?? []).map((note) => parseProgress(note, ADMISSION_FILE_SCHEMA_VERSION));
  const progress = mergeExpiryProgress(incomingProgress, current.progress);
  const claims = claimsRespectingExpiry(
    document.claims.map((claim) => parseClaim(claim, ADMISSION_FILE_SCHEMA_VERSION)),
    current.claims,
    current.progress,
  );
  writeJournalBytes(path, {
    schemaVersion: ADMISSION_FILE_SCHEMA_VERSION,
    revision: Math.max(document.revision, current.revision),
    claims,
    progress,
    owners: current.owners,
  });
}

/** A claim write must not erase an expiry note it had not read. */
function mergeExpiryProgress(incoming: readonly StoredProgress[], onDisk: readonly StoredProgress[]): StoredProgress[] {
  const merged = [...incoming];
  for (const note of onDisk) {
    if (!isOperatorExpiry(note)) continue;
    if (merged.some((row) => row.serverRunId === note.serverRunId && isOperatorExpiry(row))) continue;
    merged.push(note);
  }
  return merged;
}

/**
 * An expiry note already on disk means the run was judged expired. A claim
 * that was not already stored does not get to land afterwards.
 */
function claimsRespectingExpiry(
  incoming: readonly ClaimEvent[],
  onDiskClaims: readonly ClaimEvent[],
  onDiskProgress: readonly StoredProgress[],
): ClaimEvent[] {
  const expired = new Set(onDiskProgress.filter(isOperatorExpiry).map((note) => note.serverRunId));
  if (expired.size === 0) return [...incoming];
  const prior = new Set(onDiskClaims.map(claimStamp));
  return incoming.filter((claim) => prior.has(claimStamp(claim)) || !expired.has(claim.serverRunId));
}

function claimStamp(claim: ClaimEvent): string {
  return [
    claim.wonderlandRunId,
    claim.serverRunId,
    claim.state,
    claim.spentTagState,
    claim.at,
    claim.dispatchAttempted ? '1' : '0',
    claim.dispatchError ?? '',
    claim.halt ?? '',
    claim.workflowRunId ?? '',
  ].join('\0');
}

function writeJournalBytes(path: string, body: OperatorJournal): void {
  try {
    writeAdmissionFileAtomic(operatorJournalPath(path), `${JSON.stringify(body)}\n`);
  } catch (error) {
    if (isAdmissionFileClosed(error)) throw error;
    throw new AdmissionFileClosedError('unwritten');
  }
}

function parseClaim(value: unknown, schemaVersion: OperatorJournal['schemaVersion']): ClaimEvent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AdmissionFileClosedError('corrupt');
  const claim = value as Record<string, unknown>;
  const keys = Object.keys(claim);
  if (keys.some((key) => !(CLAIM_KEYS as readonly string[]).includes(key))) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (CLAIM_KEYS.some((key) => key !== 'workflowRunId' && !Object.hasOwn(claim, key))) {
    throw new AdmissionFileClosedError('corrupt');
  }
  const workflowRunId = Object.hasOwn(claim, 'workflowRunId')
    ? storedWorkflowRunId(claim.workflowRunId)
    : null;
  const identity = identifyAdmissionRun(claim.wonderlandRunId, claim.serverRunId);
  const form = schemaVersion === LEGACY_ADMISSION_SCHEMA_VERSION ? 'legacy' : 'wlj';
  if (!identity.ok || identity.form !== form) throw new AdmissionFileClosedError('corrupt');
  if (typeof claim.state !== 'string' || !CLAIM_STATES.includes(claim.state as OperatorClaimState)) {
    throw new AdmissionFileClosedError('corrupt');
  }
  const state = claim.state as OperatorClaimState;
  if (claim.spentTag !== spentLockName(identity.serverRunId)) throw new AdmissionFileClosedError('corrupt');
  if (typeof claim.spentTagState !== 'string' || !SPENT_TAG_STATES.includes(claim.spentTagState as SpentTagState)) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (typeof claim.at !== 'string' || !RECEIVED_AT.test(claim.at)) throw new AdmissionFileClosedError('corrupt');
  if (typeof claim.dispatchAttempted !== 'boolean') throw new AdmissionFileClosedError('corrupt');
  const error = claim.dispatchError;
  const halt = claim.halt;
  if (halt !== null && (typeof halt !== 'string' || !WORKFLOW_HALTS.includes(halt as WorkflowHalt))) {
    throw new AdmissionFileClosedError('corrupt');
  }
  const recordedHalt = halt === null ? null : halt as WorkflowHalt;
  if (state === 'dispatch_failed') {
    if (claim.dispatchAttempted !== true) throw new AdmissionFileClosedError('corrupt');
    if (recordedHalt === 'SPENT_TAG_UNVERIFIED') {
      if (error !== 'SPENT_TAG_UNVERIFIED') throw new AdmissionFileClosedError('corrupt');
    } else if (recordedHalt !== null || error !== 'gh_workflow_run_failed') {
      throw new AdmissionFileClosedError('corrupt');
    }
  } else if (error !== null) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (state === 'already_spent') {
    if (recordedHalt !== 'RUN_ID_ALREADY_SPENT' || claim.spentTagState !== 'present') {
      throw new AdmissionFileClosedError('corrupt');
    }
  } else if (recordedHalt === 'RUN_ID_ALREADY_SPENT') {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (state === 'dispatched' && recordedHalt !== null) throw new AdmissionFileClosedError('corrupt');
  const dispatchError: DispatchError | null = state === 'dispatch_failed'
    ? (recordedHalt === 'SPENT_TAG_UNVERIFIED' ? 'SPENT_TAG_UNVERIFIED' : 'gh_workflow_run_failed')
    : null;
  return {
    wonderlandRunId: identity.wljRunId,
    serverRunId: identity.serverRunId,
    state,
    spentTag: spentLockName(identity.serverRunId),
    spentTagState: claim.spentTagState as SpentTagState,
    at: claim.at,
    dispatchAttempted: claim.dispatchAttempted,
    dispatchError,
    halt: state === 'dispatched' ? null : recordedHalt,
    workflowRunId,
  };
}

function storedWorkflowRunId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'string' && isStoredWorkflowRunId(value)) return value;
  throw new AdmissionFileClosedError('corrupt');
}
