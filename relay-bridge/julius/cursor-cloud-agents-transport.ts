import { createHash } from 'node:crypto';

import type {
  CodingAgentBranch,
  CodingAgentCreateInput,
  CodingAgentCreateOutcome,
  CodingAgentPollOutcome,
  CodingAgentReceipt,
  CodingAgentResultOutcome,
  CodingAgentRunRef,
  CodingAgentTerminalStatus,
  CodingAgentTransport,
  CodingAgentUsage,
} from './grok-bot-coding-provider';

/**
 * THE CURSOR CLOUD AGENTS API v1 (public beta) AS A {@link CodingAgentTransport}, over an INJECTED fetch.
 *
 * Read from the public docs only, without a key, on 2026-10-30:
 *  - https://cursor.com/docs/cloud-agent/api/endpoints.md
 *      POST /v1/agents                       create (body: prompt.text, model.id, repos[{url,startingRef}], autoCreatePR, agentId)
 *      GET  /v1/agents/{id}/runs/{runId}     status CREATING|RUNNING|WAITING_FOR_BACKGROUND_WORK → FINISHED|ERROR|CANCELLED|EXPIRED;
 *                                            terminal runs carry `result`, `durationMs`, `git.branches[{repoUrl (no scheme), branch?, prUrl?}]`
 *      GET  /v1/agents/{id}/usage?runId=     per-run token usage; "Runs without any recorded token usage report zeros"
 *      POST /v1/agents/{id}/runs/{runId}/cancel   `409 run_not_cancellable` when terminal
 *      `agentId` "Useful for idempotent create flows — re-POSTing the same agentId returns 409 agent_id_conflict"
 *  - https://cursor.com/docs/cloud-agent/api/overview   ("Webhooks are coming soon": this transport POLLS)
 *  - https://cursor.com/docs/api.md                     (Basic or Bearer auth; default 20 requests/minute; 429 on limit)
 *
 * UNDOCUMENTED, AND THEREFORE FAIL-CLOSED CONFIGURATION, NEVER AN ASSUMPTION:
 *  - No served-model field is documented on the agent, run or usage record. {@link CURSOR_ATTESTED_MODEL_FIELD} is a
 *    reviewed CODE constant, null today, so `reportedModelId` is always null and the provider halts
 *    `coder_served_model_unattested`. It is not an option: configuration cannot choose the field. A field that could be the
 *    service echoing the request's own `model` (any `model`/`modelId` segment on the agent or run record) never counts,
 *    even if the constant is changed to name one (review ruling, Oct 30 2026).
 *  - `Retry-After` is documented only for the Admin API; it is honoured when present (bounded), otherwise backoff is ours.
 *  - The exact error-body shape for Cloud Agents codes is not pinned down; mapping is by HTTP status only.
 *
 * THE KEY: obtained from an injected getter at the moment of each request, placed in exactly one header, and never put in a
 * result, an error, a log line or a diagnostic. Any response string that contains it is redacted before it leaves.
 * `CURSOR_API_KEY_ENV_NAME` is a NAME for the composition root; this module never reads the environment.
 */

export const CURSOR_API_ORIGIN = 'https://api.cursor.com';
export const CURSOR_API_KEY_ENV_NAME = 'CURSOR_API_KEY';
export const CURSOR_CLOUD_AGENTS_TRANSPORT_KIND = 'cursor_cloud_agents_v1';

export interface CursorFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers?: { get(name: string): string | null };
  /** The streamed body (WHATWG fetch). When present it is the ONLY way the body is read, and it is read with a byte cap. */
  readonly body?: ReadableStream<Uint8Array> | null;
  /** Fallback only for a response without a stream; its length is still capped before anything is parsed. */
  text(): Promise<string>;
}
export type CursorFetch = (url: string, init: {
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly redirect: 'error';
  readonly signal?: AbortSignal;
}) => Promise<CursorFetchResponse>;

/**
 * THE GLOBAL FETCH AND RESPONSE AS THEY WERE WHEN THIS MODULE LOADED (F7 part B). "live" means requests went through
 * exactly these, not "whatever `globalThis.fetch` is at call time": a replacement installed later (a test double, a
 * monkey-patch) is never called, and a transport that sees one is stamped "fake" for good.
 *
 * RESIDUAL LIMIT, stated rather than hidden: a replacement installed BEFORE this module is imported is what gets captured,
 * and no in-process check can tell it from the platform's own fetch (Node's fetch is ordinary JavaScript, so there is no
 * native-code marker to test). The one further check that is feasible is applied: each answer must be an instance of the
 * `Response` class captured with it, so a stand-in that returns plain objects is refused. Proving that a request reached
 * api.cursor.com needs a response field only the real service produces; none is verified yet (the request id and
 * createdAt are "not provided" until a real, authorized response shows them).
 */
const GLOBAL_FETCH_AT_LOAD: typeof fetch | null = typeof globalThis.fetch === 'function' ? globalThis.fetch : null;
const GLOBAL_RESPONSE_AT_LOAD: typeof Response | null = typeof globalThis.Response === 'function' ? globalThis.Response : null;
/**
 * Skywalker N2b: THE DISPATCHER ROUTE. Node's fetch (undici) sends through the dispatcher stored in the process-wide slot
 * `globalThis[Symbol.for('undici.globalDispatcher.1')]` (what undici's `setGlobalDispatcher` writes). Replacing it after load
 * leaves `globalThis.fetch` untouched while every request, and every byte of every answer, goes wherever the new dispatcher
 * says. So the slot is captured at load too and must be unchanged for the fetch to count as intact. Node creates the slot
 * lazily on the first fetch; to capture it at load this module makes ONE local `data:` fetch at import (no network, no
 * socket). If the slot is still empty after that (a runtime that is not Node's undici), nothing is ever "live".
 *
 * WHAT "live" MEANS, AND WHAT IT DOES NOT: "built over the fetch and dispatcher this process had when this module loaded,
 * and neither has changed since". It is NEVER proof that a request reached api.cursor.com: code that ran before this module
 * was imported (a fetch or dispatcher installed early), a patched Node, or a proxy the original dispatcher honours cannot be
 * detected in-process. Downstream acceptance must keep treating `live` that way.
 *
 * N15, FAILS CLOSED BY DESIGN: monitoring code that wraps `globalThis.fetch` or sets a global dispatcher AFTER this module
 * loads (APM, Sentry, OpenTelemetry fetch/undici instrumentation) makes every later call `not_sent` `transport_untrusted`
 * and every transport "fake". Load such instrumentation before this module, or not at all, on a live host.
 *
 * Skywalker F10, RESIDUAL: patching the captured dispatcher object's methods IN PLACE (`dispatcher.dispatch = wrapper`)
 * leaves its identity unchanged and is NOT detected. Like the pre-import residual, it is outside what an in-process check
 * can see.
 */
const UNDICI_GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.1');
const readGlobalDispatcher = (): unknown => (globalThis as unknown as Record<symbol, unknown>)[UNDICI_GLOBAL_DISPATCHER];
const GLOBAL_DISPATCHER_AT_LOAD: unknown = (() => {
  if (GLOBAL_FETCH_AT_LOAD === null) return undefined;
  if (readGlobalDispatcher() === undefined) {
    try { void GLOBAL_FETCH_AT_LOAD.call(globalThis, 'data:,').catch(() => undefined); } catch { /* a fetch that throws here is no fetch to trust */ }
  }
  return readGlobalDispatcher();
})();
/** True while `globalThis.fetch` is still the function captured at module load AND the undici global dispatcher is still the one captured then. */
export const cursorGlobalFetchIntact = (): boolean =>
  GLOBAL_FETCH_AT_LOAD !== null && globalThis.fetch === GLOBAL_FETCH_AT_LOAD
  && GLOBAL_DISPATCHER_AT_LOAD !== undefined && GLOBAL_DISPATCHER_AT_LOAD !== null && readGlobalDispatcher() === GLOBAL_DISPATCHER_AT_LOAD;

/** The process's global fetch (as captured at load), adapted. A transport built over exactly this function is the only one that can be "live". */
export const cursorGlobalFetch: CursorFetch = async (url, init) => {
  // Never a replacement: refuse rather than call whatever is installed now.
  if (!cursorGlobalFetchIntact() || GLOBAL_FETCH_AT_LOAD === null) throw new Error('cursor_global_fetch_replaced');
  const res = await GLOBAL_FETCH_AT_LOAD.call(globalThis, url, { method: init.method, headers: init.headers, redirect: 'error', ...(init.body === undefined ? {} : { body: init.body }), ...(init.signal === undefined ? {} : { signal: init.signal }) });
  if (GLOBAL_RESPONSE_AT_LOAD === null || !(res instanceof GLOBAL_RESPONSE_AT_LOAD)) throw new Error('cursor_global_fetch_response_foreign');
  return { ok: res.ok, status: res.status, headers: res.headers, body: res.body, text: () => res.text() };
};
const LIVE_TRANSPORTS = new WeakSet<object>();
/** Transports that once saw the global fetch replaced: "fake" from then on, even after it is put back. */
const TAINTED_TRANSPORTS = new WeakSet<object>();
/**
 * F15: "live" only for a transport this module built over {@link cursorGlobalFetch} while the global fetch was intact,
 * that has never seen it replaced, and only while it is still intact; anything else, whatever its transportKind, is "fake".
 */
export function cursorTransportMode(transport: unknown): 'live' | 'fake' {
  return typeof transport === 'object' && transport !== null && LIVE_TRANSPORTS.has(transport) && !TAINTED_TRANSPORTS.has(transport) && cursorGlobalFetchIntact() ? 'live' : 'fake';
}

/*
 * M-6 / Skywalker F4: secrets that are not the Cursor key (sk-/sk-ant-, xai-, gsk_, AKIA/ASIA, org-, gh*_, github_pat_,
 * JWT, Bearer/Basic, PEM keys) are redacted by the stream scrub, after the Cursor-key patterns and before the residue check. Patterns are the well-known public token shapes; the count of redactions is recorded per event and in total.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{8,}/gu,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/gu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/giu,
  /sk-ant-[A-Za-z0-9_-]{8,}/gu,
  /\bsk-[A-Za-z0-9_-]{10,}/gu,
  /xai-[A-Za-z0-9_-]{16,}/gu,
  /\bgsk_[A-Za-z0-9]{16,}/gu,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/gu,
  /\bAIza[0-9A-Za-z_-]{30,}/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu,
  /\borg-[A-Za-z0-9]{16,}/gu,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/giu,
  // Skywalker L1: an AWS secret access key named as such, and a password inside a URL's userinfo.
  /(?:aws_secret_access_key|SecretAccessKey)["']?\s{0,8}[=:]\s{0,8}["']?[A-Za-z0-9/+=]{40}/giu,
  // Round 4 R3-7: npm and Stripe tokens.
  /\bnpm_[A-Za-z0-9]{30,}/gu,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/gu,
  /\b([a-z][a-z0-9+.-]{0,31}:\/\/[^\s/:@]{1,256}:)[^\s/@]{1,256}@/giu,
];
/** Invisible format characters (ZWSP, ZWJ, BOM, soft hyphen...) are dropped before matching, so they cannot split a token. */
const INVISIBLE = /[\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/gu;
const PEM_BEGIN = '-----BEGIN ';
const PEM_TAG = /^[A-Z ]{0,40}PRIVATE KEY-----/iu;
/** ASCII-only lower-casing keeps indices aligned (String#toLowerCase can change length). */
const asciiLower = (t: string): string => t.replace(/[A-Z]/gu, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
/**
 * PILOT N-2: PEM private keys by a linear scan (no backtracking regex). A BEGIN marker with no END line redacts to the end
 * of the text (a truncated key is still a key).
 */
function redactPem(text: string): { text: string; count: number } {
  let out = '';
  let count = 0;
  let i = 0;
  const low = asciiLower(text); // Round 4 R3-7: lowercase PEM armour
  for (;;) {
    const b = low.indexOf('-----begin ', i);
    if (b === -1) break;
    if (!PEM_TAG.test(text.slice(b + PEM_BEGIN.length, b + PEM_BEGIN.length + 60))) { out += text.slice(i, b + 1); i = b + 1; continue; }
    out += `${text.slice(i, b)}[REDACTED:secret]`;
    count += 1;
    const e = low.indexOf('-----end ', b + PEM_BEGIN.length);
    if (e === -1) { i = text.length; break; }
    const close = low.indexOf('-----', e + 9);
    i = close === -1 ? text.length : close + 5;
  }
  return { text: out + text.slice(i), count };
}
const applyPatterns = (text: string): { text: string; count: number } => {
  const pem = redactPem(text);
  let count = pem.count;
  let out = pem.text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (...m: unknown[]) => {
      count += 1;
      return re.source.startsWith('\\b([a-z]') ? `${m[1] as string}[REDACTED:secret]@` : '[REDACTED:secret]';
    });
  }
  return { text: out, count };
};
const anyPattern = (text: string): boolean => asciiLower(text).includes('-----begin ') && redactPem(text).count > 0
  || SECRET_PATTERNS.some((re) => { re.lastIndex = 0; const hit = re.test(text); re.lastIndex = 0; return hit; });
const B64_TOKEN = /[A-Za-z0-9+/_-]{20,}={0,2}/gu;
/**
 * Skywalker L1, FAIL CLOSED: forms the patterns cannot rewrite in place. After redaction, the text is decoded in copies
 * (JSON `\uXXXX` and `%XX` escapes, line breaks removed so a token split over two `data:` lines joins up, reversed, and
 * base64 tokens decoded); a secret pattern matching any copy means a secret is still there in a form we cannot redact,
 * and the caller must not store the text. Each copy is one linear pass.
 */
/** Round 4 M4: a reversed match counts only at a plausible token length (ordinary words ending in `-ks` are not keys). */
const REVERSED_MIN = 24;
const HEX_RUN = /\b(?:[0-9a-f]{2}){12,}\b/giu;
const SPACED_HEX_RUN = /\b[0-9a-f]{2}(?: [0-9a-f]{2}){11,}\b/giu;
/** R4-7: the Cyrillic/Greek letters that look like Latin ones in key prefixes (a deliberately small map, not full UTS #39). */
const CONFUSABLE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '\u0430': 'a', '\u0410': 'A', '\u0435': 'e', '\u0415': 'E', '\u043a': 'k', '\u041a': 'K', '\u043e': 'o', '\u041e': 'O', '\u0440': 'p', '\u0420': 'P',
  '\u0441': 'c', '\u0421': 'C', '\u0445': 'x', '\u0425': 'X', '\u0443': 'y', '\u0456': 'i', '\u0406': 'I', '\u0458': 'j', '\u0455': 's', '\u0405': 'S',
  '\u03bf': 'o', '\u039f': 'O', '\u03a7': 'X', '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u039a': 'K', '\u03a1': 'P', '\u03a4': 'T', '\u0131': 'i',
});
const foldConfusables = (s: string): string => s.replace(/[\u0370-\u04ff\u0131]/gu, (c) => CONFUSABLE_MAP[c] ?? c);
function secretSurvives(raw: string): boolean {
  /* Round 4 M4: our own markers are not secrets (a URL `user:[REDACTED:secret]@` must not re-trigger the userinfo pattern). */
  const text = raw.replace(/\[REDACTED:secret\]/gu, ' ');
  const unescaped = text
    /* Round 4 R3-8: HTML numeric entities. */
    .replace(/&#x([0-9a-f]{1,6});/giu, (_m, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&#([0-9]{1,7});/gu, (_m, d: string) => codePoint(parseInt(d, 10)))
    .replace(/\\u([0-9a-f]{4})/giu, (_m, h: string) => codePoint(parseInt(h, 16)))
    .replace(/%([0-9a-f]{2})/giu, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(INVISIBLE, '');
  const joined = unescaped.replace(/[\r\n]+/gu, '');
  if (anyPattern(unescaped) || anyPattern(joined)) return true;
  /* Round 4 R3-8: fullwidth / compatibility forms (NFKC). */
  const nfkc = joined.normalize('NFKC');
  if (nfkc !== joined && anyPattern(nfkc)) return true;
  const reversed = [...joined].reverse().join('');
  if ([...allMatches(reversed)].some((m) => m.length >= REVERSED_MIN)) return true;
  /* PILOT 44c062b9 R4-7: Cyrillic/Greek homoglyphs (`хai-`), folded through a small confusables map. */
  const folded = foldConfusables(nfkc);
  if (folded !== nfkc && anyPattern(folded)) return true;
  /* Round 4 R3-8: hex-encoded tokens; R4-7: also space-separated hex bytes. */
  for (const m of joined.matchAll(HEX_RUN)) if (anyPattern(Buffer.from(m[0], 'hex').toString('latin1'))) return true;
  for (const m of joined.matchAll(SPACED_HEX_RUN)) if (anyPattern(Buffer.from(m[0].replace(/ /gu, ''), 'hex').toString('latin1'))) return true;
  /* base64, and base64 of base64 (one extra level only). */
  const b64 = (t: string): string => Buffer.from(t.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64').toString('latin1');
  for (const m of joined.matchAll(B64_TOKEN)) {
    const decoded = b64(m[0]);
    if (anyPattern(decoded)) return true;
    for (const n of decoded.matchAll(B64_TOKEN)) if (anyPattern(b64(n[0]))) return true;
  }
  return false;
}
/** Non-Cursor secrets redacted in place (linear time). `residue` is true when a secret survives in an encoded form. */
const allMatches = (text: string): Set<string> => {
  const out = new Set<string>();
  for (const re of SECRET_PATTERNS) for (const m of text.matchAll(re)) out.add(m[0]);
  return out;
};
/** A token split by a line break (two `data:` lines of one event): a match in the joined text that no line has alone. */
const splitAcrossLines = (text: string): boolean => {
  if (!/[\r\n]/u.test(text)) return false;
  const perLine = allMatches(text);
  for (const m of allMatches(text.replace(/[\r\n]+/gu, ''))) if (![...perLine].some((p) => p.startsWith(m) || m === p)) return true;
  return false;
};
export function redactSecrets(text: string): { readonly text: string; readonly count: number; readonly residue?: true } {
  if (splitAcrossLines(text.replace(INVISIBLE, ''))) return { text: '', count: 0, residue: true };
  const r = applyPatterns(text.replace(INVISIBLE, ''));
  const out = r.count === 0 && !INVISIBLE.test(text) ? text : r.text;
  INVISIBLE.lastIndex = 0;
  return secretSurvives(out) ? { text: out, count: r.count, residue: true } : { text: out, count: r.count };
}

/** E2: one scrubbed piece of stream text, or `residue` when key characters survive the scrub (the caller fails closed). */
export type CursorStreamScrub = { readonly kind: 'clean'; readonly text: string; readonly scrubbed: boolean; readonly secrets: number } | { readonly kind: 'residue' } | { readonly kind: 'secret_residue' };
/**
 * E2: the outcome of opening `GET /v1/agents/{id}/runs/{runId}/stream` once. `opened` hands over the response body and a
 * scrubber bound to the key that was sent (the key itself never leaves this module); `mode` is the transport's live stamp at
 * the moment of opening. Every other outcome sent nothing usable.
 */
export type CursorStreamOpen =
  | {
    readonly kind: 'opened';
    readonly status: number;
    /** `X-Cursor-Stream-Retention-Seconds` as sent (digits only), or null when absent or malformed. */
    readonly retentionSeconds: string | null;
    readonly contentType: string | null;
    readonly body: ReadableStream<Uint8Array> | null;
    readonly mode: 'live' | 'fake';
    readonly scrub: (text: string) => CursorStreamScrub;
    /** Ends the request (idempotent). */
    readonly close: () => void;
  }
  | { readonly kind: 'status'; readonly status: number }
  | { readonly kind: 'not_sent'; readonly cause: 'aborted' | 'key_absent' | 'transport_untrusted' | 'transport_unknown' | 'ref_invalid' | 'last_event_id_invalid' | 'rate_budget_exhausted' }
  | { readonly kind: 'failed_in_flight'; readonly cause: 'timeout' | 'network' | 'aborted_in_flight' }
  | { readonly kind: 'deadline' };
type CursorStreamOpener = (ref: CodingAgentRunRef, lastEventId: string | null, opts: { readonly deadlineAtMs: number; readonly signal?: AbortSignal }) => Promise<CursorStreamOpen>;
/** Stream openers of transports THIS module built; a hand-made transport has none, so it can never open a stream. */
const STREAM_OPENERS = new WeakMap<object, CursorStreamOpener>();
/**
 * E2: opens the run's SSE stream through the transport's own auth, 429 backoff, key handling and pinned fetch. A transport
 * this module did not build answers `not_sent` `transport_unknown`. The caller labels what it captures with `mode`; only a
 * `live` capture can count for E2, and `live` is still never proof that the bytes came from Cursor (see the N2b note above).
 */
export function openCursorRunStream(transport: unknown, ref: CodingAgentRunRef, lastEventId: string | null, opts: { readonly deadlineAtMs: number; readonly signal?: AbortSignal }): Promise<CursorStreamOpen> {
  const opener = typeof transport === 'object' && transport !== null ? STREAM_OPENERS.get(transport) : undefined;
  return opener === undefined ? Promise.resolve({ kind: 'not_sent', cause: 'transport_unknown' }) : opener(ref, lastEventId, opts);
}
/** Runs each transport created in this process, with the model id it asked for (agentId NUL runId -> modelId). */
const CREATED_RUNS = new WeakMap<object, Map<string, string>>();
/**
 * PILOT 43b93a4e M-2 / Skywalker N2: the model id this transport sent when IT created the run, or null when it did not
 * create it (a ref from elsewhere, another transport, a reattach). This is the REQUESTED model, not an attested served
 * model, and it proves only that the run was created in this process, not that a stream opened before its first event.
 */
export function cursorRunCreatedBy(transport: unknown, ref: CodingAgentRunRef): { readonly modelId: string } | null {
  const m = typeof transport === 'object' && transport !== null ? CREATED_RUNS.get(transport) : undefined;
  const modelId = m?.get(`${ref.agentId}\u0000${ref.runId}`);
  return modelId === undefined ? null : { modelId };
}
/** A Last-Event-ID we will send back: printable ASCII, no spaces, at most 256 characters (the docs call the id opaque). */
const LAST_EVENT_ID = /^[\x21-\x7e]{1,256}$/u;
const RETENTION_SECONDS = /^\d{1,9}$/u;

/**
 * EVERY FORM OF THE KEY A SERVICE MIGHT ECHO BACK (F12): as is, URL-encoded (both component and form encoding), in hex
 * (lower and upper case, bare and percent-escaped), and in
 * base64 and base64url at each of the three byte alignments a key can sit at inside a longer encoded string (only the
 * characters that depend on key bytes alone, so a match is the key whatever surrounds it). Longest first; forms shorter
 * than 8 characters are dropped so a short key cannot erase ordinary text.
 */
export function cursorKeyForms(key: string): readonly string[] {
  if (key === '') return [];
  const bytes = Buffer.from(key, 'utf8');
  const forms = new Set<string>([key, encodeURIComponent(key), encodeURIComponent(key).replace(/%20/gu, '+')]);
  for (let o = 0; o < 3; o += 1) {
    const b64 = Buffer.concat([Buffer.alloc(o), bytes]).toString('base64');
    const first = Math.ceil((8 * o) / 6);
    const end = Math.floor((8 * (o + bytes.length)) / 6);
    const core = b64.slice(first, end);
    forms.add(core);
    forms.add(core.replace(/\+/gu, '-').replace(/\//gu, '_'));
  }
  forms.add(bytes.toString('base64'));
  forms.add(bytes.toString('base64url'));
  /* PILOT Low 9: hex, lower and upper case, bare and as `%XX` for every byte. Hex is byte-local (each byte is its own
   * two characters), so unlike base64 the key's hex is the same substring at every byte alignment inside a longer hex
   * string: one form per case covers the three alignments the base64 forms handle. */
  const hex = bytes.toString('hex');
  for (const h of hex.length >= 8 ? [hex, hex.toUpperCase()] : []) {
    forms.add(h);
    forms.add(h.replace(/(..)/gu, '%$1'));
  }
  return Object.freeze([...forms].filter((f) => f.length >= 8).sort((x, y) => y.length - x.length));
}

/** Separators a service (or a log formatter) may put between the characters of an echoed key: `k e y`, `6b:65:79`. */
const KEY_SEPARATOR = '[\\s:-]?';
const reEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
/**
 * Skywalker L3/N3: every form of {@link cursorKeyForms}, matched case-insensitively (an upper- or lower-cased echo of the
 * key or of its hex) and with at most one whitespace, `:` or `-` between characters (a space-separated or `xx:yy` hex
 * echo). Over-matching only ever redacts more.
 */
export function cursorKeyPatterns(key: string): readonly RegExp[] {
  return Object.freeze(cursorKeyForms(key).map((f) => new RegExp([...f].map(reEscape).join(KEY_SEPARATOR), 'giu')));
}
const REDACTED = '[REDACTED]';
/** What a whole text becomes when key characters survive the patterns (Skywalker N12). */
const KEY_RESIDUE_REDACTED = '[REDACTED: key residue]';
/** Skywalker N12: this many of the key's own characters in a row, after normalising, is treated as the key. */
const KEY_RESIDUE_RUN = 6;
const codePoint = (n: number): string => (Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');
/**
 * Skywalker N12: the text as a key-echo comparison sees it. JSON `\uXXXX` and HTML `&#NN;` / `&#xNN;` escapes decoded,
 * invisible characters (`\p{Cf}`, e.g. ZWSP) and combining marks (`\p{M}`) deleted, NFKC (fullwidth to ASCII), lower case,
 * and then ONLY letters and digits kept, so any separator (`  `, `_`, `.`, `,`) between the key's characters disappears.
 */
const keyMatchNormal = (text: string): string => text
  .replace(/\\u([0-9a-f]{4})/giu, (_m, h: string) => codePoint(parseInt(h, 16)))
  .replace(/&#x([0-9a-f]{1,6});?/giu, (_m, h: string) => codePoint(parseInt(h, 16)))
  .replace(/&#([0-9]{1,7});?/gu, (_m, d: string) => codePoint(Number(d)))
  .replace(/[\p{Cf}\p{M}]/gu, '').normalize('NFKC').replace(/[\p{Cf}\p{M}]/gu, '')
  .toLowerCase().replace(/[^a-z0-9]/gu, '');
/**
 * Skywalker N12, FAIL CLOSED: true when {@link KEY_RESIDUE_RUN} or more of the key's letters and digits, in order or
 * reversed, appear in a row in the normalised text: the echo forms the patterns cannot enumerate (wide separators, ZWSP,
 * reversal, `\u` and HTML escapes, fullwidth, pieces of a split key). A key with fewer letters and digits than that is
 * never matched this way (the patterns still apply).
 */
export function cursorKeyResidue(text: string, key: string): boolean {
  const k = keyMatchNormal(key);
  if (k.length < KEY_RESIDUE_RUN) return false;
  const runs = new Set<string>();
  for (const form of [k, [...k].reverse().join('')]) for (let i = 0; i + KEY_RESIDUE_RUN <= form.length; i += 1) runs.add(form.slice(i, i + KEY_RESIDUE_RUN));
  const t = keyMatchNormal(text);
  for (let i = 0; i + KEY_RESIDUE_RUN <= t.length; i += 1) if (runs.has(t.slice(i, i + KEY_RESIDUE_RUN))) return true;
  return keyHexResidue(text, key);
}
/** PILOT M-6/I-1: this many hex digits in a row of the key's UTF-8, UTF-16BE or UTF-16LE hex is the key. */
const KEY_HEX_RUN = 16;
/**
 * PILOT M-6/I-1, FAIL CLOSED: the key written as hex bytes with `0x` or `\x` prefixes and any separators (`0x53, 0x45`),
 * or as UTF-16 hex (`0053 0045`). The text's hex digits are kept (prefixes and separators dropped) and compared, in
 * windows of {@link KEY_HEX_RUN}, against the key's hex in the three encodings. Linear in the text.
 */
function keyHexResidue(text: string, key: string): boolean {
  const forms = [Buffer.from(key, 'utf8'), Buffer.from(key, 'utf16le'), Buffer.from(key, 'utf16le').swap16()].map((b) => b.toString('hex'));
  if (forms[0]!.length < KEY_HEX_RUN) return false;
  const runs = new Set<string>();
  for (const f of forms) for (let i = 0; i + KEY_HEX_RUN <= f.length; i += 2) runs.add(f.slice(i, i + KEY_HEX_RUN));
  const t = text.toLowerCase().replace(/0x|\\x/gu, '').replace(/[^0-9a-f]/gu, '');
  for (let i = 0; i + KEY_HEX_RUN <= t.length; i += 1) if (runs.has(t.slice(i, i + KEY_HEX_RUN))) return true;
  return false;
}
/**
 * Every occurrence of the key, in any form {@link cursorKeyPatterns} matches, replaced by `[REDACTED]`. Skywalker N12: if
 * key characters still survive ({@link cursorKeyResidue}), the WHOLE text is replaced by `[REDACTED: key residue]`.
 */
export function scrubCursorKey(text: string, key: string): string {
  let out = text;
  for (const re of cursorKeyPatterns(key)) out = out.replace(re, REDACTED);
  return cursorKeyResidue(out, key) ? KEY_RESIDUE_REDACTED : out;
}
/** A fragment this long of any key form, in any case, is treated as the key (a truncated or partial echo). */
const KEY_FRAGMENT = 16;
/**
 * True when a short structural value the service returned (a request id, a run or agent id) carries the key: any form
 * in any case and with separators, or any {@link KEY_FRAGMENT}-character window of any form (a truncated base64 or hex
 * echo). Such a value is never recorded; it is dropped or the response is not trusted.
 */
export function carriesCursorKey(value: string, key: string): boolean {
  if (key === '') return false;
  if (cursorKeyPatterns(key).some((re) => { re.lastIndex = 0; return re.test(value); })) return true;
  if (cursorKeyResidue(value, key)) return true;
  const v = value.toLowerCase();
  for (const form of cursorKeyForms(key)) {
    const f = form.toLowerCase();
    const w = Math.min(KEY_FRAGMENT, f.length);
    for (let i = 0; i + w <= f.length; i += 1) if (v.includes(f.slice(i, i + w))) return true;
  }
  return false;
}

/** Where, on which record, a served model id would be read. */
export interface CursorAttestedModelField { readonly record: 'agent' | 'run'; readonly path: readonly string[] }

/**
 * THE ONLY PLACE A SERVED-MODEL FIELD CAN BE NAMED: a reviewed code change, after a response field is shown to be
 * independent of the request. Null: none is, so nothing is ever reported.
 */
export const CURSOR_ATTESTED_MODEL_FIELD: CursorAttestedModelField | null = null;

/**
 * A segment that could be the service echoing the `model` the create request itself sent: `model`, `modelId`,
 * `modelName` (PILOT Low 8), `requestedModel`, in any case, with or without `_`/`-` between the words.
 */
const REQUEST_ECHO_SEGMENT = /^(models?|model[_-]?(id|name)|requested[_-]?model([_-]?(id|name))?)$/iu;

/** True when reading `field` could return the request's own model back: such a field is never attestation. */
export function isRequestEchoField(field: CursorAttestedModelField): boolean {
  return field.path.length === 0 || field.path.some((part) => REQUEST_ECHO_SEGMENT.test(part));
}

/** Reads `field` from `record`: a request-echo field, a non-string, or anything not shaped like a model id is not reported. */
export function readAttestedModelId(record: unknown, field: CursorAttestedModelField | null, clean: (v: string) => string | null): string | null {
  const effective = effectiveAttestedModelField(field);
  if (effective === null) return null;
  let cur: unknown = record;
  for (const part of effective.path) cur = isRecord(cur) ? cur[part] : undefined;
  if (typeof cur !== 'string' || cur === '') return null;
  const cleaned = clean(cur);
  return cleaned !== null && REPORTED_MODEL_ID.test(cleaned) ? cleaned : null;
}

/** The field the transport reads: the reviewed constant, unless it is a request echo. */
export function effectiveAttestedModelField(field: CursorAttestedModelField | null): CursorAttestedModelField | null {
  return field === null || isRequestEchoField(field) ? null : field;
}

export interface CursorCloudAgentsTransportOptions {
  readonly fetch: CursorFetch;
  readonly getApiKey: () => string | null;
  readonly now?: () => number;
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Must equal {@link CURSOR_API_ORIGIN}; anything else is refused at construction. */
  readonly baseUrl?: string;
  /** Between status polls. Default 6000 (10/min, half the documented 20/min); never below 3000. */
  readonly pollIntervalMs?: number;
  /** Per request. Default 30000. */
  readonly requestTimeoutMs?: number;
  /** First 429 backoff when no Retry-After is given. Default 10000, doubling to 60000. */
  readonly rateLimitBackoffMs?: number;
  /** Shared request budget per 60 s for this transport; default and maximum 20. */
  readonly requestsPerMinute?: number;
  readonly log?: (line: string) => void;
}

const MIN_POLL_MS = 3_000;
const MAX_BACKOFF_MS = 60_000;
const MAX_RETRY_AFTER_MS = 120_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** Strings the service returns that reach evidence: bounded here, before the router's own caps. */
const MAX_FINAL_TEXT_CHARS = 16_000;
const MAX_PR_URL_CHARS = 300;
const PR_URL = /^https:\/\/github\.com\/[A-Za-z0-9._~\/%#?=&+-]+$/u;
const REPORTED_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
/** The same instant shape the router keeps (UTC, at most microseconds), so a carried value is never dropped downstream. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u;

/**
 * Reads a response body, never past {@link MAX_BODY_BYTES}: a declared Content-Length over the cap is refused unread, and the
 * stream is counted chunk by chunk and cancelled the moment it passes the cap. Null: oversized or unreadable (never parsed).
 */
export async function readCappedBody(res: CursorFetchResponse, maxBytes: number = MAX_BODY_BYTES): Promise<string | null> {
  const declared = res.headers?.get('content-length') ?? null;
  if (declared !== null && /^\d+$/u.test(declared.trim()) && Number(declared.trim()) > maxBytes) {
    try { await res.body?.cancel(); } catch { /* best effort */ }
    return null;
  }
  if (res.body !== undefined && res.body !== null) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { try { await reader.cancel(); } catch { /* best effort */ } return null; }
        chunks.push(value);
      }
    } catch { return null; }
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.byteLength; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(all); } catch { return null; }
  }
  let text: string;
  try { text = await res.text(); } catch { return null; }
  return Buffer.byteLength(text, 'utf8') > maxBytes ? null : text;
}
const ACTIVE = new Set(['CREATING', 'RUNNING', 'WAITING_FOR_BACKGROUND_WORK']);
const TERMINAL = new Set<CodingAgentTerminalStatus>(['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal?.aborted === true) { resolve(); return; }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = (): void => { clearTimeout(timer); resolve(); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

/** An untrusted PR link is kept only as a bounded https://github.com/… URL; anything else is dropped. */
const safePrUrl = (v: string | null): string | null => (v !== null && v.length <= MAX_PR_URL_CHARS && PR_URL.test(v) ? v : null);
const isAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

type Sent =
  | { readonly kind: 'response'; readonly status: number; readonly body: unknown; readonly retryAfterMs: number | null; readonly requestId: string | null; readonly responseSha256: string }
  | { readonly kind: 'not_sent'; readonly cause: 'aborted' | 'key_absent' | 'transport_untrusted' }
  | { readonly kind: 'failed_in_flight'; readonly cause: 'timeout' | 'network' | 'aborted_in_flight' };

/** Skywalker 43b93a4e N1: NaN or infinite options fall back to the default (never disable a limit). */
const finiteNumber = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
export function createCursorCloudAgentsTransport(options: CursorCloudAgentsTransportOptions): CodingAgentTransport {
  const base = options.baseUrl ?? CURSOR_API_ORIGIN;
  if (base !== CURSOR_API_ORIGIN) throw new Error('cursor_base_url_unpinned');
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const pollMs = Math.max(MIN_POLL_MS, finiteNumber(options.pollIntervalMs, 6_000));
  const requestTimeoutMs = Math.max(1, finiteNumber(options.requestTimeoutMs, 30_000));
  const firstBackoff = Math.max(1_000, finiteNumber(options.rateLimitBackoffMs, 10_000));
  const modelField = effectiveAttestedModelField(CURSOR_ATTESTED_MODEL_FIELD);
  const log = options.log ?? ((): void => undefined);
  /*
   * Skywalker F3: ONE request budget per transport, shared by every call it makes (create, poll, result, usage, cancel,
   * stream). Every request is counted in a sliding 60 s window; a stream open that would exceed the budget (default and
   * maximum 20, Cursor's documented default) is not sent (`rate_budget_exhausted`). Other calls are counted, not blocked:
   * they keep their 429 handling. The window uses the transport's clock.
   */
  const budget = Math.min(20, Math.max(1, Math.floor(finiteNumber(options.requestsPerMinute, 20))));
  const sentAt: number[] = [];
  const budgetLeft = (): number => {
    const t = now();
    while (sentAt.length > 0 && (sentAt[0] as number) <= t - 60_000) sentAt.shift();
    return budget - sentAt.length;
  };
  const noteRequest = (): void => { budgetLeft(); sentAt.push(now()); };

  /** The key, only for the duration of one request. A malformed key is treated as absent. */
  const readKey = (): string | null => {
    let key: string | null;
    try { key = options.getApiKey(); } catch { return null; }
    return typeof key === 'string' && key.length >= 8 && !/[\s\u0000-\u001f\u007f]/u.test(key) ? key : null;
  };
  /** Removes every occurrence of the key from a string the service returned. */
  const scrub = (text: string | null, key: string): string | null => {
    if (text === null) return null;
    return scrubCursorKey(text, key);
  };

  async function send(method: 'GET' | 'POST', path: string, body: unknown, signal: AbortSignal | undefined): Promise<Sent & { key?: string }> {
    if (signal?.aborted === true) return { kind: 'not_sent', cause: 'aborted' };
    // F7 part B: a "live" transport whose global fetch has been replaced sends nothing, and is never "live" again.
    if (options.fetch === cursorGlobalFetch && !cursorGlobalFetchIntact()) {
      TAINTED_TRANSPORTS.add(transport);
      return { kind: 'not_sent', cause: 'transport_untrusted' };
    }
    const key = readKey();
    if (key === null) return { kind: 'not_sent', cause: 'key_absent' };
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), requestTimeoutMs);
    const onAbort = (): void => timeout.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    noteRequest();
    try {
      const res = await options.fetch(`${CURSOR_API_ORIGIN}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: timeout.signal,
      });
      const text = await readCappedBody(res);
      let parsed: unknown = null;
      if (text !== null && text.length > 0) { try { parsed = JSON.parse(text); } catch { parsed = null; } }
      const ra = res.headers?.get('retry-after') ?? null;
      const raSeconds = ra !== null && /^\d{1,6}$/u.test(ra.trim()) ? Number(ra.trim()) : null;
      const rid = res.headers?.get('x-request-id') ?? res.headers?.get('x-cursor-request-id') ?? null;
      const requestId = rid !== null && REQUEST_ID.test(rid.trim()) && !carriesCursorKey(rid, key) ? rid.trim() : null;
      const responseSha256 = createHash('sha256').update(text ?? '').digest('hex');
      return { kind: 'response', status: res.status, body: parsed, retryAfterMs: raSeconds === null ? null : Math.min(raSeconds * 1000, MAX_RETRY_AFTER_MS), requestId, responseSha256, key };
    } catch {
      // Never the error itself: its message can carry a URL, a header or a body.
      if (isAborted(signal)) return { kind: 'failed_in_flight', cause: 'aborted_in_flight' };
      return { kind: 'failed_in_flight', cause: timeout.signal.aborted ? 'timeout' : 'network' };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** GETs are safe to repeat: a 429 waits (Retry-After when given, else doubling backoff) and tries again, never past the deadline. */
  async function getWithBackoff(path: string, deadlineAtMs: number, signal: AbortSignal | undefined): Promise<Sent & { key?: string } | { kind: 'deadline' }> {
    let backoff = firstBackoff;
    for (;;) {
      const r = await send('GET', path, undefined, signal);
      if (r.kind !== 'response' || r.status !== 429) return r;
      const wait = r.retryAfterMs ?? backoff;
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      log(`cursor-transport rate-limited wait_ms=${wait}`);
      if (now() + wait > deadlineAtMs) return { kind: 'deadline' };
      await sleep(wait, signal);
      if (isAborted(signal)) return { kind: 'not_sent', cause: 'aborted' };
    }
  }

  const readModel = (record: unknown, key: string): string | null => readAttestedModelId(record, modelField, (v) => scrub(v, key));

  const transport: CodingAgentTransport = {
    transportKind: CURSOR_CLOUD_AGENTS_TRANSPORT_KIND,

    async createRun(input: CodingAgentCreateInput, signal?: AbortSignal): Promise<CodingAgentCreateOutcome> {
      if (!/^bc-[A-Za-z0-9-]{1,100}$/u.test(input.agentId) || !/^[0-9a-f]{40}$/u.test(input.startingRef) || input.modelId === '' || input.promptText === '') {
        return { kind: 'not_sent', cause: 'request_invalid' };
      }
      const r = await send('POST', '/v1/agents', {
        prompt: { text: input.promptText },
        model: { id: input.modelId },
        repos: [{ url: input.repoUrl, startingRef: input.startingRef }],
        // The agent's branch is untrusted: no PR is opened, and it never pushes onto the starting ref.
        workOnCurrentBranch: false,
        autoCreatePR: false,
        mode: 'agent',
        name: input.name,
        agentId: input.agentId,
      }, signal);
      if (r.kind === 'not_sent') return { kind: 'not_sent', cause: r.cause };
      if (r.kind === 'failed_in_flight') {
        log(`cursor-transport create outcome-unknown cause=${r.cause}`);
        return { kind: 'outcome_unknown', cause: r.cause };
      }
      const s = r.status;
      if (s >= 200 && s < 300) {
        const agent = isRecord(r.body) && isRecord(r.body.agent) ? r.body.agent : null;
        const run = isRecord(r.body) && isRecord(r.body.run) ? r.body.run : null;
        const agentId = typeof agent?.id === 'string' ? agent.id : null;
        const runId = typeof run?.id === 'string' ? run.id : null;
        if (agentId === null || runId === null || !SAFE_ID.test(agentId) || !SAFE_ID.test(runId)) return { kind: 'outcome_unknown', cause: 'malformed_response' };
        // Skywalker N3: an id that echoes the key is never handed back (it would reach the provider's diagnostics as
        // evidence.cursorRunId). The run may exist, so its outcome is unknown, never "not started".
        if (carriesCursorKey(agentId, r.key ?? '') || carriesCursorKey(runId, r.key ?? '')) {
          log('cursor-transport create outcome-unknown cause=id_carries_key');
          return { kind: 'outcome_unknown', cause: 'malformed_response' };
        }
        CREATED_RUNS.get(transport)?.set(`${agentId}\u0000${runId}`, input.modelId);
        return { kind: 'created', ref: { agentId, runId } };
      }
      if (s === 409) return { kind: 'conflict', status: 409 };
      if (s === 401) return { kind: 'rejected', status: s, cause: 'authentication' };
      if (s === 403) return { kind: 'rejected', status: s, cause: 'forbidden' };
      if (s === 429) return { kind: 'rejected', status: s, cause: 'rate_limited' };
      if (s === 402) return { kind: 'rejected', status: s, cause: 'credit' };
      if (s === 404) return { kind: 'rejected', status: s, cause: 'not_found' };
      if (s === 400 || s === 422) return { kind: 'rejected', status: s, cause: 'invalid_request' };
      // 5xx and anything unexpected: the service may have acted (docs: a server error "may still have" taken effect).
      log(`cursor-transport create outcome-unknown status=${s}`);
      return { kind: 'outcome_unknown', cause: 'server_error' };
    },

    async pollUntilTerminal(ref: CodingAgentRunRef, { deadlineAtMs, signal }): Promise<CodingAgentPollOutcome> {
      if (!SAFE_ID.test(ref.agentId) || !SAFE_ID.test(ref.runId)) return { kind: 'poll_failed', cause: 'malformed_response', polls: 0 };
      const path = `/v1/agents/${encodeURIComponent(ref.agentId)}/runs/${encodeURIComponent(ref.runId)}`;
      let polls = 0;
      let transient = 0;
      for (;;) {
        if (signal?.aborted === true) return { kind: 'aborted', polls };
        if (now() >= deadlineAtMs) return { kind: 'deadline', polls };
        const r = await getWithBackoff(path, deadlineAtMs, signal);
        polls += 1;
        if (r.kind === 'deadline') return { kind: 'deadline', polls };
        if (r.kind === 'not_sent') return r.cause === 'aborted' ? { kind: 'aborted', polls } : { kind: 'poll_failed', cause: r.cause, polls };
        if (r.kind === 'failed_in_flight') {
          if (r.cause === 'aborted_in_flight') return { kind: 'aborted', polls };
          transient += 1;
        } else if (r.status === 401 || r.status === 403) {
          return { kind: 'poll_failed', cause: 'authentication', polls };
        } else if (r.status === 404) {
          return { kind: 'poll_failed', cause: 'not_found', polls };
        } else if (r.status >= 200 && r.status < 300) {
          const status = isRecord(r.body) && typeof r.body.status === 'string' ? r.body.status : null;
          if (status !== null && TERMINAL.has(status as CodingAgentTerminalStatus)) return { kind: 'terminal', status: status as CodingAgentTerminalStatus, polls };
          if (status === null || !ACTIVE.has(status)) return { kind: 'poll_failed', cause: 'malformed_response', polls };
          transient = 0;
        } else if (r.status >= 500) {
          transient += 1;
        } else {
          return { kind: 'poll_failed', cause: 'unexpected_status', polls };
        }
        // Repeated transient read failures end the poll: the run's outcome is then unknown, which the provider says.
        if (transient >= 5) return { kind: 'poll_failed', cause: 'transient_exhausted', polls };
        const wait = Math.min(pollMs, Math.max(0, deadlineAtMs - now()));
        if (wait <= 0) return { kind: 'deadline', polls };
        await sleep(wait, signal);
      }
    },

    async fetchResult(ref: CodingAgentRunRef, signal?: AbortSignal, fetchOptions?: { readonly deadlineAtMs?: number }): Promise<CodingAgentResultOutcome> {
      if (!SAFE_ID.test(ref.agentId) || !SAFE_ID.test(ref.runId)) return { kind: 'unavailable', cause: 'ref_invalid' };
      const agentPath = `/v1/agents/${encodeURIComponent(ref.agentId)}`;
      // F14: never past the run's own deadline, nor past five minutes.
      const runDeadline = fetchOptions?.deadlineAtMs;
      const deadline = Math.min(now() + 5 * 60_000, typeof runDeadline === 'number' && Number.isFinite(runDeadline) ? runDeadline : Number.POSITIVE_INFINITY);
      const run = await getWithBackoff(`${agentPath}/runs/${encodeURIComponent(ref.runId)}`, deadline, signal);
      if (isAborted(signal) || (run.kind === 'not_sent' && run.cause === 'aborted') || (run.kind === 'failed_in_flight' && run.cause === 'aborted_in_flight')) return { kind: 'unavailable', cause: 'aborted' };
      if (run.kind === 'deadline') return { kind: 'unavailable', cause: 'deadline' };
      if (run.kind !== 'response' || run.status < 200 || run.status >= 300 || !isRecord(run.body) || run.key === undefined) return { kind: 'unavailable', cause: 'run_unreadable' };
      const key = run.key;
      const body = run.body;
      if (body.status !== 'FINISHED') return { kind: 'unavailable', cause: 'run_not_finished' };
      const fullText = typeof body.result === 'string' ? scrub(body.result, key) : null;
      const finalTextTruncated = fullText !== null && fullText.length > MAX_FINAL_TEXT_CHARS;
      const finalText = fullText === null ? null : finalTextTruncated ? fullText.slice(0, MAX_FINAL_TEXT_CHARS) : fullText;
      const durationMs = count(body.durationMs);
      const branches: CodingAgentBranch[] = [];
      const git = isRecord(body.git) ? body.git : null;
      if (git !== null && git.branches !== undefined) {
        if (!Array.isArray(git.branches)) return { kind: 'unavailable', cause: 'branches_malformed' };
        for (const b of git.branches) {
          if (!isRecord(b) || typeof b.repoUrl !== 'string') return { kind: 'unavailable', cause: 'branches_malformed' };
          branches.push(Object.freeze({
            repoUrl: scrub(b.repoUrl, key) as string,
            branch: typeof b.branch === 'string' ? scrub(b.branch, key) : null,
            prUrl: safePrUrl(typeof b.prUrl === 'string' ? scrub(b.prUrl, key) : null),
          }));
        }
      }
      let usage: CodingAgentUsage | null = null;
      const u = await getWithBackoff(`${agentPath}/usage?runId=${encodeURIComponent(ref.runId)}`, deadline, signal);
      if (u.kind === 'response' && u.status >= 200 && u.status < 300 && isRecord(u.body) && Array.isArray(u.body.runs)) {
        const entry = u.body.runs.find((x) => isRecord(x) && x.id === ref.runId);
        const usageRecord = isRecord(entry) && isRecord(entry.usage) ? entry.usage : null;
        if (usageRecord !== null) {
          const fields = ['inputTokens', 'outputTokens', 'cacheWriteTokens', 'cacheReadTokens', 'totalTokens'] as const;
          const values = fields.map((f) => count(usageRecord[f]));
          if (values.every((v) => v !== null)) {
            const [inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, totalTokens] = values as number[];
            usage = Object.freeze({ inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, totalTokens }) as CodingAgentUsage;
          }
        }
      }
      let reportedModelId: string | null = null;
      if (modelField !== null) {
        if (modelField.record === 'run') reportedModelId = readModel(body, key);
        else {
          const a = await getWithBackoff(agentPath, deadline, signal);
          if (a.kind === 'response' && a.status >= 200 && a.status < 300) reportedModelId = readModel(a.body, key);
        }
      }
      return {
        kind: 'result', finalText, finalTextTruncated, durationMs, branches: Object.freeze(branches), usage, reportedModelId,
        reportedModelSource: reportedModelId === null || modelField === null ? null : `${modelField.record}.${modelField.path.join('.')}`,
        receipt: Object.freeze({
          runId: typeof body.id === 'string' && SAFE_ID.test(body.id) ? body.id : null,
          createdAt: typeof body.createdAt === 'string' && ISO_INSTANT.test(body.createdAt) ? body.createdAt : null,
          requestId: run.requestId,
          responseSha256: run.responseSha256,
        }) as CodingAgentReceipt,
      };
    },

    async cancelRun(ref: CodingAgentRunRef): Promise<'cancelled' | 'not_cancellable' | 'failed'> {
      if (!SAFE_ID.test(ref.agentId) || !SAFE_ID.test(ref.runId)) return 'failed';
      const r = await send('POST', `/v1/agents/${encodeURIComponent(ref.agentId)}/runs/${encodeURIComponent(ref.runId)}/cancel`, undefined, undefined);
      if (r.kind !== 'response') return 'failed';
      if (r.status >= 200 && r.status < 300) return 'cancelled';
      return r.status === 409 ? 'not_cancellable' : 'failed';
    },
  };
  /**
   * E2: one stream request. Same gate as {@link send} (intact fetch, key read per request, one Authorization header,
   * redirects refused); the request timeout covers only the wait for response headers; a 429 waits like
   * {@link getWithBackoff}, never past the deadline. A non-2xx answer's body is read capped and dropped (status only).
   */
  const openStream: CursorStreamOpener = async (ref, lastEventId, { deadlineAtMs, signal }) => {
    if (!SAFE_ID.test(ref.agentId) || !SAFE_ID.test(ref.runId)) return { kind: 'not_sent', cause: 'ref_invalid' };
    let backoff = firstBackoff;
    for (;;) {
      if (isAborted(signal)) return { kind: 'not_sent', cause: 'aborted' };
      if (options.fetch === cursorGlobalFetch && !cursorGlobalFetchIntact()) {
        TAINTED_TRANSPORTS.add(transport);
        return { kind: 'not_sent', cause: 'transport_untrusted' };
      }
      const key = readKey();
      if (key === null) return { kind: 'not_sent', cause: 'key_absent' };
      if (lastEventId !== null && (!LAST_EVENT_ID.test(lastEventId) || carriesCursorKey(lastEventId, key))) return { kind: 'not_sent', cause: 'last_event_id_invalid' };
      const mode = cursorTransportMode(transport);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), requestTimeoutMs);
      const onAbort = (): void => ctl.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      let closed = false;
      const close = (): void => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        ctl.abort();
      };
      if (budgetLeft() <= 0) { close(); return { kind: 'not_sent', cause: 'rate_budget_exhausted' }; }
      noteRequest();
      let res: CursorFetchResponse;
      try {
        res = await options.fetch(`${CURSOR_API_ORIGIN}/v1/agents/${encodeURIComponent(ref.agentId)}/runs/${encodeURIComponent(ref.runId)}/stream`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${key}`, Accept: 'text/event-stream', ...(lastEventId === null ? {} : { 'Last-Event-ID': lastEventId }) },
          redirect: 'error',
          signal: ctl.signal,
        });
      } catch {
        const cause = isAborted(signal) ? 'aborted_in_flight' : ctl.signal.aborted ? 'timeout' : 'network';
        close();
        return { kind: 'failed_in_flight', cause };
      }
      clearTimeout(timer);
      if (res.status === 429) {
        await readCappedBody(res, 64 * 1024);
        close();
        const ra = res.headers?.get('retry-after') ?? null;
        const wait = ra !== null && /^\d{1,6}$/u.test(ra.trim()) ? Math.min(Number(ra.trim()) * 1000, MAX_RETRY_AFTER_MS) : backoff;
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        log(`cursor-transport stream rate-limited wait_ms=${wait}`);
        if (now() + wait > deadlineAtMs) return { kind: 'deadline' };
        await sleep(wait, signal);
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        await readCappedBody(res, 64 * 1024);
        close();
        return { kind: 'status', status: res.status };
      }
      const rs = res.headers?.get('x-cursor-stream-retention-seconds') ?? null;
      const scrub = (text: string): CursorStreamScrub => {
        let out = text;
        for (const re of cursorKeyPatterns(key)) out = out.replace(re, REDACTED);
        const other = redactSecrets(out);
        out = other.text;
        if (cursorKeyResidue(out, key)) return { kind: 'residue' };
        return other.residue === true ? { kind: 'secret_residue' } : { kind: 'clean', text: out, scrubbed: out !== text, secrets: other.count };
      };
      return {
        kind: 'opened', status: res.status, mode, scrub, close,
        retentionSeconds: rs !== null && RETENTION_SECONDS.test(rs.trim()) ? rs.trim() : null,
        contentType: res.headers?.get('content-type') ?? null,
        body: res.body ?? null,
      };
    }
  };
  STREAM_OPENERS.set(transport, openStream);
  CREATED_RUNS.set(transport, new Map());
  // F15: only a transport over the real global fetch, built while it is intact, is "live"; every other instance (a fake
  // fetch, a hand-made object, one built after a replacement) is "fake".
  if (options.fetch === cursorGlobalFetch && cursorGlobalFetchIntact()) LIVE_TRANSPORTS.add(transport);
  return Object.freeze(transport);
}
