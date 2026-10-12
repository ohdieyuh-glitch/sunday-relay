/**
 * WONDERFS REQUEST BODIES (R2; the routes plan §3.3 "Body limits"). The bridge's shared reader caps at 64 KiB (server.ts readBody);
 * WonderFS's writes need more, so they get their own two readers, each BOUNDED, ABORT-SAFE and TIMEOUT-SAFE:
 *
 *   readWonderfsJson    H12's commit: at most 1 MiB of `application/json` (2,000 ops of ~350 B fit, wonderfs-contracts.ts
 *                       maxOpsPerCommit). A declared Content-Length over the cap is refused BEFORE a byte is read; a body without
 *                       one is counted as it arrives and refused the moment it passes the cap.
 *   readWonderfsOctets  H11's upload: `application/octet-stream`, at most the per-file limit (§11: 64 MiB). Content-Length is
 *                       REQUIRED (411 otherwise), so the size is judged -- and the upload budget charged -- before a byte is read;
 *                       the bytes are hashed WHILE they arrive (sha256, incrementally), and a body that runs past its declared
 *                       length or the cap is abandoned at once (never buffered past it).
 *
 * NEVER BUFFERED PAST THE CAP: a chunk that would cross it is dropped and reading stops (the stream is paused and every listener
 * removed). ABORT: a client that goes away (an `error`, a `close` before `end`, or a stream already destroyed when reading starts)
 * settles the read as `aborted` -- once. TIMEOUT: a whole-body deadline and an idle timeout (reset by every chunk) settle it as
 * `timeout`; both timers are cleared on every outcome and never keep the process alive (`unref`). A refusal after reading began
 * leaves the rest of the body unread, so its answer carries `Connection: close` (the writer then ends the socket).
 *
 * Nothing here logs, and no refusal echoes a byte of the body.
 */

import { createHash } from 'node:crypto';

import { wonderfsError, type WonderfsAnswer } from './wonderfs-gate';

/** §6.1 / plan §3.3: a WonderFS JSON request body is at most 1 MiB. */
export const WONDERFS_JSON_MAX_BYTES = 1024 * 1024;
/** How long a JSON body may take in all, and between two chunks. */
export const WONDERFS_JSON_DEADLINE_MS = 30_000;
export const WONDERFS_JSON_IDLE_MS = 10_000;
/** How long an upload may take in all (64 MiB at ~220 KB/s), and between two chunks: R1's byte-write timeouts, mirrored. */
export const WONDERFS_UPLOAD_DEADLINE_MS = 300_000;
export const WONDERFS_UPLOAD_IDLE_MS = 30_000;

/** What a reader needs of a request: its headers and a readable byte stream (node:http's IncomingMessage is one). */
export interface WonderfsBodySource {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly destroyed?: boolean;
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'end' | 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  removeListener(event: 'data', listener: (chunk: Buffer) => void): unknown;
  removeListener(event: 'end' | 'close', listener: () => void): unknown;
  removeListener(event: 'error', listener: (error: Error) => void): unknown;
  pause(): unknown;
  resume(): unknown;
}

export interface WonderfsBodyTimeouts {
  readonly deadlineMs?: number;
  readonly idleMs?: number;
}

export type WonderfsBodyResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly answer: WonderfsAnswer };

/** A refusal whose body was (or may have been) left unread: the connection is not reused. */
const CLOSE = Object.freeze({ connection: 'close' });

const refuse = (status: number, kind: string, message: string, unread: boolean): { ok: false; answer: WonderfsAnswer } => ({
  ok: false,
  answer: wonderfsError(status, kind, message, unread ? CLOSE : {}),
});

const header = (source: WonderfsBodySource, name: string): string | undefined => {
  const value = source.headers[name];
  return typeof value === 'string' ? value : undefined;
};

/** The media type of a Content-Type header, lower case, without parameters (`application/json; charset=utf-8` -> `application/json`). */
function mediaType(source: WonderfsBodySource): string | null {
  const value = header(source, 'content-type');
  if (value === undefined) return null;
  return value.split(';')[0].trim().toLowerCase();
}

/** A declared Content-Length: undefined when absent, null when malformed (node:http has already refused most malformed ones). */
function declaredLength(source: WonderfsBodySource): number | undefined | null {
  const value = header(source, 'content-length');
  if (value === undefined) return undefined;
  return /^(0|[1-9][0-9]{0,15})$/u.test(value.trim()) ? Number(value.trim()) : null;
}

type ReadOutcome = { readonly ok: true; readonly size: number } | { readonly ok: false; readonly why: 'too_large' | 'overrun' | 'aborted' | 'timeout' };

/**
 * Read `source` to its end, handing each chunk to `take` -- never one byte past `maxBytes` (`too_large`) nor past `declared`, when
 * known (`overrun`: node:http never delivers more than a Content-Length, so only a stream that lies gets here). Settles exactly once;
 * on any outcome every listener and timer is removed, and on a failure the stream is paused.
 */
export function readBounded(
  source: WonderfsBodySource,
  limits: { readonly maxBytes: number; readonly declared: number | null; readonly deadlineMs: number; readonly idleMs: number },
  take: (chunk: Buffer, at: number) => void,
): Promise<ReadOutcome> {
  return new Promise<ReadOutcome>((resolve) => {
    if (source.destroyed === true) {
      resolve({ ok: false, why: 'aborted' });
      return;
    }
    let size = 0;
    let settled = false;
    let idle: ReturnType<typeof setTimeout> | null = null;
    const arm = (): void => {
      if (idle !== null) clearTimeout(idle);
      idle = setTimeout(() => settle({ ok: false, why: 'timeout' }), limits.idleMs);
      (idle as { unref?: () => void }).unref?.();
    };
    const deadline = setTimeout(() => settle({ ok: false, why: 'timeout' }), limits.deadlineMs);
    (deadline as { unref?: () => void }).unref?.();
    const onData = (chunk: Buffer): void => {
      if (settled) return;
      // the chunk that would cross the cap (or the declared length) is dropped, and nothing more is read
      if (size + chunk.byteLength > limits.maxBytes) return settle({ ok: false, why: 'too_large' });
      if (limits.declared !== null && size + chunk.byteLength > limits.declared) return settle({ ok: false, why: 'overrun' });
      take(chunk, size);
      size += chunk.byteLength;
      arm();
    };
    const onEnd = (): void => settle(limits.declared !== null && size !== limits.declared ? { ok: false, why: 'aborted' } : { ok: true, size });
    const onError = (): void => settle({ ok: false, why: 'aborted' });
    // a `close` before `end`: the client went away (after a normal `end` the read has already settled)
    const onClose = (): void => settle({ ok: false, why: 'aborted' });
    function settle(outcome: ReadOutcome): void {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (idle !== null) clearTimeout(idle);
      source.removeListener('data', onData);
      source.removeListener('end', onEnd);
      source.removeListener('error', onError);
      source.removeListener('close', onClose);
      if (!outcome.ok) source.pause();
      resolve(outcome);
    }
    arm();
    source.on('data', onData);
    source.on('end', onEnd);
    source.on('error', onError);
    source.on('close', onClose);
    source.resume();
  });
}

/** A read that failed for any reason but size: too slow (408), longer than its Content-Length (400), or the client went (400). */
function unreadable(why: 'overrun' | 'aborted' | 'timeout'): { ok: false; answer: WonderfsAnswer } {
  if (why === 'timeout') return refuse(408, 'request_timeout', 'The request did not arrive in time; send it again.', true);
  if (why === 'overrun') return refuse(400, 'invalid_request', 'The request is longer than its Content-Length.', true);
  return refuse(400, 'invalid_request', 'The request ended before all of it arrived; send it again.', true);
}

/**
 * H12's body: `application/json`, at most `maxBytes` (1 MiB), UTF-8, one JSON value. The value is returned as parsed; its SHAPE is the
 * caller's to check.
 */
export async function readWonderfsJson(source: WonderfsBodySource, options: WonderfsBodyTimeouts & { readonly maxBytes?: number } = {}): Promise<WonderfsBodyResult<unknown>> {
  const maxBytes = options.maxBytes ?? WONDERFS_JSON_MAX_BYTES;
  if (mediaType(source) !== 'application/json') return refuse(415, 'unsupported_media_type', 'WonderFS takes this request as application/json.', true);
  const declared = declaredLength(source);
  if (declared === null) return refuse(400, 'invalid_request', 'The request\'s Content-Length is malformed.', true);
  if (declared !== undefined && declared > maxBytes) return refuse(413, 'request_too_large', `A WonderFS request is at most ${maxBytes} bytes.`, true);
  const chunks: Buffer[] = [];
  const read = await readBounded(
    source,
    { maxBytes, declared: declared ?? null, deadlineMs: options.deadlineMs ?? WONDERFS_JSON_DEADLINE_MS, idleMs: options.idleMs ?? WONDERFS_JSON_IDLE_MS },
    (chunk) => chunks.push(chunk),
  );
  if (!read.ok) return read.why === 'too_large' ? refuse(413, 'request_too_large', `A WonderFS request is at most ${maxBytes} bytes.`, true) : unreadable(read.why);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, read.size));
  } catch {
    return refuse(400, 'invalid_request', 'The request is not UTF-8 text.', false);
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return refuse(400, 'invalid_request', 'The request is not one JSON value.', false);
  }
}

export interface WonderfsUploadedBytes {
  readonly bytes: Uint8Array;
  readonly size: number;
  /** sha256 of exactly `bytes`, computed here as they arrived (the store hashes them again: an address is never one caller's word). */
  readonly sha256: string;
}

/** The declared size of an upload (Content-Length, REQUIRED) and its media type, judged before ANY byte is read. */
export function wonderfsUploadDeclared(source: WonderfsBodySource, maxBytes: number): WonderfsBodyResult<number> {
  if (mediaType(source) !== 'application/octet-stream') return refuse(415, 'unsupported_media_type', 'WonderFS takes file bytes as application/octet-stream.', true);
  const declared = declaredLength(source);
  if (declared === undefined) return refuse(411, 'length_required', 'Send the file with its Content-Length.', true);
  if (declared === null) return refuse(400, 'invalid_request', 'The request\'s Content-Length is malformed.', true);
  if (declared > maxBytes) return refuse(413, 'file_too_large', `That file is larger than a project allows (${maxBytes} bytes).`, true);
  return { ok: true, value: declared };
}

/**
 * H11's body, streamed: exactly `declared` bytes (already judged by `wonderfsUploadDeclared`), never more than `maxBytes`, hashed
 * while they arrive into ONE buffer of the declared size.
 */
export async function readWonderfsOctets(source: WonderfsBodySource, declared: number, options: WonderfsBodyTimeouts & { readonly maxBytes: number }): Promise<WonderfsBodyResult<WonderfsUploadedBytes>> {
  if (declared > options.maxBytes) return refuse(413, 'file_too_large', `That file is larger than a project allows (${options.maxBytes} bytes).`, true);
  // its own memory (never a slice of node's shared pool), exactly the declared size: a body cannot grow it
  const bytes = Buffer.allocUnsafeSlow(declared);
  const hash = createHash('sha256');
  const read = await readBounded(
    source,
    { maxBytes: options.maxBytes, declared, deadlineMs: options.deadlineMs ?? WONDERFS_UPLOAD_DEADLINE_MS, idleMs: options.idleMs ?? WONDERFS_UPLOAD_IDLE_MS },
    (chunk, at) => {
      chunk.copy(bytes, at);
      hash.update(chunk);
    },
  );
  if (!read.ok) return read.why === 'too_large' ? refuse(413, 'file_too_large', `That file is larger than a project allows (${options.maxBytes} bytes).`, true) : unreadable(read.why);
  return { ok: true, value: { bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, read.size), size: read.size, sha256: hash.digest('hex') } };
}
