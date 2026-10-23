/**
 * Durable Wonderland admission file.
 *
 * The operator-claim stack imports this module by this name. Schema version 1
 * is one JSON document: `{ schemaVersion, rows }`. A write is a temp file in
 * the same directory, an fsync of that file, a rename onto the store path,
 * and an fsync of the directory. One lock file sits beside the store. A held
 * lock fails closed. Corrupt bytes, or a schema version this process does
 * not know, fail closed and are left on disk.
 *
 * The founder operator claim tool is the only writer of the dispatched
 * transition. This file keeps admitted rows, and `dispatched` stays false.
 * The in-memory ledger in `admission-store.ts` is for tests.
 */

import {
  closeSync, constants, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync, accessSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { JULIUS_BOOTSTRAP_RUN_ID, SHA256_HEX, WONDERLAND_RUN_ID } from './admission-contract';
import type { AdmissionLedger, AdmissionLedgerRow, AdmissionState } from './admission-store';

export const ADMISSION_FILE_SCHEMA_VERSION = 1;

const RECEIVED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const ROW_KEYS = [
  'phase', 'runId', 'serverRunId', 'keyHash', 'dispatchId', 'missionId', 'requestId',
  'clientLogSha256', 'clientUiActionUtc', 'receivedAt', 'ledgerRef', 'resultSha256',
] as const;

export type AdmissionFileClosedCode = 'lock_held' | 'corrupt' | 'unwritable' | 'unwritten';

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
 */
export function resolveAdmissionStorePath(raw: string | undefined): AdmissionStorePath {
  if (typeof raw !== 'string') return { ok: false };
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.includes('\0') || trimmed.includes('://')) return { ok: false };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return { ok: false };
  if (!isAbsolute(trimmed) || trimmed.startsWith('//')) return { ok: false };
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
  /** Test seam. Replaces the atomic writer. A throw leaves the previous bytes. */
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
  let rows: AdmissionLedgerRow[];
  try {
    rows = readRows(resolved);
  } catch (error) {
    releaseLock(lockPath);
    throw error;
  }
  const persist = options?.persist ?? writeAdmissionFileAtomic;
  let closed = false;
  let pending: Promise<void> = Promise.resolve();
  return {
    filePath: resolved,
    async rows() {
      if (closed) throw new AdmissionFileClosedError('lock_held');
      return rows.map((row) => ({ ...row }));
    },
    append(row) {
      const write = pending.then(() => {
        if (closed) throw new AdmissionFileClosedError('lock_held');
        const next = [...rows, row];
        try {
          persist(resolved, documentText(next));
        } catch (error) {
          if (isAdmissionFileClosed(error)) throw error;
          throw new AdmissionFileClosedError('unwritten');
        }
        rows = next;
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

function fsyncDirectory(dirPath: string): void {
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

function readRows(filePath: string): AdmissionLedgerRow[] {
  if (!existsSync(filePath)) return [];
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
  if (doc.schemaVersion !== ADMISSION_FILE_SCHEMA_VERSION) throw new AdmissionFileClosedError('corrupt');
  if (!Array.isArray(doc.rows)) throw new AdmissionFileClosedError('corrupt');
  const seenRun = new Set<string>();
  const seenKey = new Set<string>();
  const seenServer = new Set<string>();
  const rows: AdmissionLedgerRow[] = [];
  for (const item of doc.rows) {
    const row = parseRow(item);
    if (seenRun.has(row.runId) || seenKey.has(row.keyHash) || seenServer.has(row.serverRunId)) {
      throw new AdmissionFileClosedError('corrupt');
    }
    seenRun.add(row.runId);
    seenKey.add(row.keyHash);
    seenServer.add(row.serverRunId);
    rows.push(row);
  }
  return rows;
}

function parseRow(value: unknown): AdmissionLedgerRow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdmissionFileClosedError('corrupt');
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== ROW_KEYS.length || ROW_KEYS.some((key) => !Object.hasOwn(row, key))) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (row.phase !== 'run_admission') throw new AdmissionFileClosedError('corrupt');
  if (typeof row.runId !== 'string' || !WONDERLAND_RUN_ID.test(row.runId)) throw new AdmissionFileClosedError('corrupt');
  if (typeof row.serverRunId !== 'string' || !JULIUS_BOOTSTRAP_RUN_ID.test(row.serverRunId)) {
    throw new AdmissionFileClosedError('corrupt');
  }
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
  return {
    phase: 'run_admission',
    runId: row.runId,
    serverRunId: row.serverRunId,
    keyHash: row.keyHash,
    dispatchId: row.dispatchId,
    missionId: row.missionId,
    requestId: row.requestId,
    clientLogSha256: row.clientLogSha256,
    clientUiActionUtc: row.clientUiActionUtc,
    receivedAt: row.receivedAt,
    ledgerRef: row.ledgerRef,
    resultSha256: null,
  };
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
  'dispatchAttempted', 'dispatchError', 'halt',
] as const;

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
  readonly schemaVersion: typeof ADMISSION_FILE_SCHEMA_VERSION;
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
    async append(row) {
      await enqueue(path, async () => {
        acquireLock(lockPath);
        try {
          const current = readRows(path);
          if (current.some((held) => held.runId === row.runId || held.serverRunId === row.serverRunId || held.keyHash === row.keyHash)) {
            throw new Error('admission_file_duplicate');
          }
          writeAdmissionFileAtomic(path, documentText([...current, row]));
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
    admissionState: 'ADMISSION_HELD',
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
  if (!located.ok || !JULIUS_BOOTSTRAP_RUN_ID.test(serverRunId) || !OWNER_ID.test(playerId)) return;
  const current = readJournal(operatorJournalPath(located.path));
  writeJournalBytes(located.path, {
    schemaVersion: ADMISSION_FILE_SCHEMA_VERSION,
    revision: current.revision,
    claims: current.claims,
    progress: current.progress,
    owners: { ...current.owners, [serverRunId]: playerId },
  });
}

function readJournal(journalPath: string): OperatorJournal {
  if (!existsSync(journalPath)) {
    return { schemaVersion: ADMISSION_FILE_SCHEMA_VERSION, revision: 0, claims: [], progress: [], owners: {} };
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
  if (doc.schemaVersion !== ADMISSION_FILE_SCHEMA_VERSION) throw new AdmissionFileClosedError('corrupt');
  if (typeof doc.revision !== 'number' || !Number.isInteger(doc.revision) || doc.revision < 0) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (!Array.isArray(doc.claims) || !Array.isArray(doc.progress)) throw new AdmissionFileClosedError('corrupt');
  if (doc.owners === null || typeof doc.owners !== 'object' || Array.isArray(doc.owners)) {
    throw new AdmissionFileClosedError('corrupt');
  }
  const owners: Record<string, string> = {};
  for (const [serverRunId, playerId] of Object.entries(doc.owners as Record<string, unknown>)) {
    if (!JULIUS_BOOTSTRAP_RUN_ID.test(serverRunId) || typeof playerId !== 'string' || !OWNER_ID.test(playerId)) {
      throw new AdmissionFileClosedError('corrupt');
    }
    owners[serverRunId] = playerId;
  }
  return {
    schemaVersion: ADMISSION_FILE_SCHEMA_VERSION,
    revision: doc.revision,
    claims: doc.claims.map(parseClaim),
    progress: doc.progress.map(parseProgress),
    owners,
  };
}

function parseProgress(value: unknown): StoredProgress {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AdmissionFileClosedError('corrupt');
  const note = value as Record<string, unknown>;
  const keys = Object.keys(note);
  if (keys.length !== 4 || !['serverRunId', 'state', 'cause', 'updatedAt'].every((key) => Object.hasOwn(note, key))) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (typeof note.serverRunId !== 'string' || !JULIUS_BOOTSTRAP_RUN_ID.test(note.serverRunId)) {
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

function writeJournal(path: string, document: OperatorDocument): void {
  const current = readJournal(operatorJournalPath(path));
  writeJournalBytes(path, {
    schemaVersion: ADMISSION_FILE_SCHEMA_VERSION,
    revision: document.revision,
    claims: document.claims.map(parseClaim),
    progress: (document.progress ?? []).map(parseProgress),
    owners: current.owners,
  });
}

function writeJournalBytes(path: string, body: OperatorJournal): void {
  try {
    writeAdmissionFileAtomic(operatorJournalPath(path), `${JSON.stringify(body)}\n`);
  } catch (error) {
    if (isAdmissionFileClosed(error)) throw error;
    throw new AdmissionFileClosedError('unwritten');
  }
}

function parseClaim(value: unknown): ClaimEvent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AdmissionFileClosedError('corrupt');
  const claim = value as Record<string, unknown>;
  if (Object.keys(claim).length !== CLAIM_KEYS.length || CLAIM_KEYS.some((key) => !Object.hasOwn(claim, key))) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (typeof claim.wonderlandRunId !== 'string' || !WONDERLAND_RUN_ID.test(claim.wonderlandRunId)) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (typeof claim.serverRunId !== 'string' || !JULIUS_BOOTSTRAP_RUN_ID.test(claim.serverRunId)) {
    throw new AdmissionFileClosedError('corrupt');
  }
  if (typeof claim.state !== 'string' || !CLAIM_STATES.includes(claim.state as OperatorClaimState)) {
    throw new AdmissionFileClosedError('corrupt');
  }
  const state = claim.state as OperatorClaimState;
  const hex = claim.serverRunId.slice('run:'.length);
  if (claim.spentTag !== `julius-run-spent-${hex}`) throw new AdmissionFileClosedError('corrupt');
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
    wonderlandRunId: claim.wonderlandRunId,
    serverRunId: claim.serverRunId,
    state,
    spentTag: `julius-run-spent-${hex}`,
    spentTagState: claim.spentTagState as SpentTagState,
    at: claim.at,
    dispatchAttempted: claim.dispatchAttempted,
    dispatchError,
    halt: state === 'dispatched' ? null : recordedHalt,
  };
}
