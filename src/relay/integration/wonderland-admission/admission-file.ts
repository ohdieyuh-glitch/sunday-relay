/**
 * Durable Wonderland admission file.
 *
 * The operator-claim stack imports this module by this name. Schema version 2
 * is one JSON document: `{ schemaVersion, rows }`. Version 1 is refused: it
 * has no place to put the required `state` row. A write is a temp file in
 * the same directory, an fsync of that file, a rename onto the store path,
 * and an fsync of the directory. One lock file sits beside the store. A held
 * lock fails closed, including when the recorded pid is another process or
 * a dead pid. This process never deletes a lock it did not create. Corrupt
 * bytes fail closed. A different numeric schema version fails closed with
 * `ledger_schema_unsupported`. Neither is rewritten.
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
  JULIUS_BOOTSTRAP_RUN_ID, SHA256_HEX, WONDERLAND_RUN_ID, type ReviewedModelPins,
} from './admission-contract';
import type { AdmissionLedger, AdmissionLedgerRow } from './admission-store';

export const ADMISSION_FILE_SCHEMA_VERSION = 2;

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
  | 'ledger_schema_unsupported';

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
  if (typeof doc.schemaVersion !== 'number') throw new AdmissionFileClosedError('corrupt');
  if (doc.schemaVersion !== ADMISSION_FILE_SCHEMA_VERSION) {
    throw new AdmissionFileClosedError('ledger_schema_unsupported');
  }
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
  if (row.state !== 'ADMISSION_HELD' && row.state !== 'LEDGER_UNWRITTEN') {
    throw new AdmissionFileClosedError('corrupt');
  }
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
