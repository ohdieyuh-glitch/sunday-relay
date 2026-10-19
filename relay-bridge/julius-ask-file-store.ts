import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, truncateSync, writeSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  markAskStoreDurable, reserveOverDurableLedger,
  type AskLedger, type AskLedgerLine, type AskReserveInput, type AskReserveOutcome, type AskStore,
} from './julius-ask';

/**
 * A FILE-BACKED, SINGLE-INSTANCE ask store for the founder-only in-game demonstration (P6).
 *
 * WHAT IT IS: one append-only JSON-lines file. Every row is appended with ONE write and an fsync BEFORE the call that needs it
 * proceeds, under an in-process lock; at startup the file is read back, so the daily cap, the per-caller cap and the idempotency
 * keys SURVIVE A RESTART of the bridge. It implements the same `AskStore` contract as the in-memory fake: reserve = duplicate, then
 * the global cap, then the caller cap, then the insert.
 *
 * WHAT IT IS NOT: it is NOT safe across replicas or two bridge processes on one file (the lock lives in this process and the
 * rows are read once at startup), and it is NOT the player path. It exists so ONE local bridge, wired by the operator through
 * JULIUS_ASK_STORE_FILE, can serve a Relay-Session (player-mode) ask during the demonstration. Postgres (slice 3: unique index and a
 * locked count-and-insert, tested with two parallel replicas) remains the store for real players.
 *
 * DURABILITY IS BRANDED, NOT DECLARED: `createFileAskStore` registers its own object with `markAskStoreDurable`. The flag is set by
 * this wiring code only, never by a request and never by an arbitrary ledger object.
 *
 * THE FILE: rows hold ids, hashes, counts and digests only (no question text, no answer text, no key). Two loading rules:
 *   - a TORN FINAL LINE (the process died mid-write: no terminating newline and not valid JSON) is TOLERATED: the fragment is moved
 *     to `<file>.torn` and cut from the file, so the next append cannot weld onto it. It is safe to drop: a pre-call row is written
 *     and synced BEFORE the provider is contacted, so a torn pre-call row means no call was made, and a torn result row leaves its
 *     pre-call row, which is answered `julius_ask_attempt_unknown`;
 *   - ANY OTHER unreadable line (garbage in the middle, or a complete line that is not a valid row) REFUSES to open the store: the
 *     lost row could have been a cap or a key, so the store fails closed instead of guessing.
 */

const NL = String.fromCharCode(10);

export interface FileAskStore extends AskStore {
  readonly file: string;
  /** Releases the file handle (tests, shutdown). Appends after close throw. */
  close(): void;
}

function isPreCall(row: Record<string, unknown>): boolean {
  return typeof row.askId === 'string' && typeof row.at === 'string' && typeof row.callerHash === 'string' && typeof row.keyHash === 'string';
}

/** One parsed line, or null when it is not a valid ledger row. */
function parseRow(text: string): AskLedgerLine | null {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.phase === 'pre_call') return isPreCall(row) ? (row as AskLedgerLine) : null;
  if (row.phase === 'result') return typeof row.askId === 'string' ? (row as AskLedgerLine) : null;
  return null;
}

/** Reads the existing file: every valid row in order, repairing a torn final line (see the header) and refusing anything else. */
function loadRows(file: string): AskLedgerLine[] {
  if (!existsSync(file)) return [];
  const bytes = readFileSync(file);
  const text = bytes.toString('utf8');
  const rows: AskLedgerLine[] = [];
  const lastNewline = text.lastIndexOf('\n');
  const complete = lastNewline === -1 ? '' : text.slice(0, lastNewline);
  const tail = text.slice(lastNewline + 1);
  const lines = complete === '' ? [] : complete.split('\n');
  lines.forEach((line, index) => {
    const row = parseRow(line);
    if (row === null) throw new Error(`julius ask store: line ${index + 1} of the store file is not a valid ledger row; refusing to open it`);
    rows.push(row);
  });
  if (tail !== '') {
    const last = parseRow(tail);
    if (last !== null) {
      /* A complete row whose newline was lost: keep it and terminate it, so the next append starts a fresh line. */
      rows.push(last);
      appendFileSync(file, '\n');
    } else {
      appendFileSync(`${file}.torn`, `${tail}\n`);
      truncateSync(file, Buffer.byteLength(text.slice(0, lastNewline + 1), 'utf8'));
    }
  }
  return rows;
}

export function createFileAskStore(options: { readonly file: string }): FileAskStore {
  const file = resolve(options.file);
  mkdirSync(dirname(file), { recursive: true });
  const rows = loadRows(file);
  let fd: number | null = openSync(file, 'a');
  /* Every write goes through this chain, so appends never interleave and memory only ever holds what the file holds. */
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => T | Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
  /* After a failed write the file may end in a partial line; the next append terminates it first (it then reads back as garbage
     in the middle, which is refused at the next start rather than guessed at). */
  let sealNeeded = false;

  /* Returns normally only when the row is written AND synced. When the bytes were written but the sync failed, the row may well be
     on disk, so it still joins memory (counted: never under-counting a cap) and the error is rethrown; the controller then reads
     the row back and answers attempt_unknown instead of inviting a retry. When the write itself failed nothing is kept. */
  const writeDurably = (line: AskLedgerLine): void => {
    if (fd === null) throw new Error('julius ask store: closed');
    const data = Buffer.from((sealNeeded ? NL : '') + JSON.stringify(line) + NL, 'utf8');
    let written = false;
    try {
      let offset = 0;
      while (offset < data.length) offset += writeSync(fd, data, offset, data.length - offset);
      written = true;
      fsyncSync(fd);
      sealNeeded = false;
    } catch (error) {
      sealNeeded = !written;
      if (written) rows.push(line);
      throw error;
    }
    rows.push(line);
  };

  const store: FileAskStore = {
    durable: true,
    file,
    append(line: AskLedgerLine): Promise<void> {
      /* The row joins memory only once its bytes are in the file (see writeDurably). */
      return serial(() => { writeDurably(line); });
    },
    async rows(): Promise<readonly AskLedgerLine[]> { return rows.slice(); },
    reserve(input: AskReserveInput): Promise<AskReserveOutcome> { return reserveOverDurableLedger(store, input); },
    close(): void {
      if (fd !== null) { closeSync(fd); fd = null; }
    },
  };
  return markAskStoreDurable(store);
}

/**
 * The operator's wiring: JULIUS_ASK_STORE_FILE=<path> selects the file store; absent or empty keeps `fallback` (today's
 * non-durable ledger, so a player ask is still refused 503). A file that cannot be opened (unreadable, corrupt) is reported on
 * stderr WITHOUT any row content and also keeps `fallback`: the demo then fails closed (players 503) instead of the bridge dying.
 */
export function selectAskLedger(env: Record<string, string | undefined>, fallback: AskLedger): AskLedger {
  const path = (env.JULIUS_ASK_STORE_FILE ?? '').trim();
  if (path === '') return fallback;
  try {
    return createFileAskStore({ file: path });
  } catch (error) {
    console.error(`[julius-ask] JULIUS_ASK_STORE_FILE could not be opened (${error instanceof Error ? error.message : 'unknown error'}); player asks stay refused`);
    return fallback;
  }
}
