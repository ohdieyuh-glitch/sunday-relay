import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { evaluateReadiness, readGptArchitectConfig, type GptArchitectConfig } from '../src/relay/connectors/gpt-architect/config';
import { redactResponseId, runGptArchitect, type GptRunOutcome, type GptRunRequest, type GptUsage } from '../src/relay/connectors/gpt-architect/gpt-runner';
import { sanitizeTerminalBlock } from '../src/relay/ui/app/terminal-sanitize';
import { bearerMatches } from './bearer-auth';
import { sessionTokenFrom } from './browser-session/routes';

/**
 * "ASK JULIUS", PHASE A: one read-only question to the ARCHITECT leg of Julius's provider system.
 *
 * What this is, exactly: a single bounded OpenAI Responses call (through the repository's own `runGptArchitect`) with no
 * tools, no research, no file access and `store:false`. It is NOT a Julius mission: none of the Actions-only controls
 * (confirm phrase, environment reviewer, one-paid-run-per-namespace marker, accept-main checkpoint) apply to it, and the
 * answer does not claim them. It is off unless `JULIUS_ASK_ENABLED=1`.
 *
 * The controller is pure and injectable (provider, config reader, clock, ledger, environment) so every control is
 * testable without a network. The API key is read from the injected environment INSIDE a call, handed to the runner, and
 * never stored, logged, ledgered or returned; the question text is never ledgered either (its length is).
 *
 * PLAYER EXPOSURE (slices 1 and 2 of the F4-F8 plan): the LEDGER is the source of truth for the daily cap, the per-caller cap
 * and the idempotency key. A PLAYER ask requires a DURABLE store; durability is a property a store FACTORY brands (see
 * `markAskStoreDurable`), never something an object or a request can declare. The operator may use a plain FILE ledger for a
 * local smoke, never stdout. Callers are default-deny: only `player:<id>` and exactly `operator` are recognised. The pre-call row is inserted by one atomic `reserve` step; when it cannot commit the route refuses
 * (503) and makes no provider call. The in-process maps below are only an optimisation for concurrent same-key requests.
 */

export const ASK_QUESTION_MAX_CHARS = 2_000;
export const ASK_ANSWER_MAX_CHARS = 8_000;
export const ASK_DEFAULT_DAILY_CAP = 20;
export const ASK_DEFAULT_MAX_CONCURRENT = 1;
/**
 * The in-process idempotency map (answer replay and same-key coalescing) holds at most this many SETTLED keys; beyond it the OLDEST
 * settled entry is evicted (an in-flight key never is). Eviction loses nothing that matters: the daily caps are counted by the store
 * (or the per-day counters), never by this map, and the ledger remains the record of every key, so an evicted key that comes back is
 * answered by the store's named 409 (duplicate) instead of an in-memory replay. Without eviction the map grew for the life of the process.
 */
export const ASK_IDEMPOTENCY_MAP_MAX = 5_000;
/** The provider call is bounded to this even when the architect timeout is longer (a request deadline, not a token or dollar ceiling). */
export const ASK_MAX_TIMEOUT_MS = 90_000;
/** Per-caller daily cap when JULIUS_ASK_CALLER_DAILY_CAP is unset: strictly below the global cap whenever the global cap is 3 or more. */
export function defaultCallerDailyCap(globalCap: number): number {
  return globalCap <= 2 ? globalCap : Math.min(3, globalCap - 1);
}
/** The highest reasoning effort a PLAYER caller may get, unless the operator sets JULIUS_ASK_PLAYER_MAX_EFFORT. Operator callers are not capped. */
export const ASK_DEFAULT_PLAYER_MAX_EFFORT = 'medium';

/**
 * THE ASK'S OUTPUT AND REASONING BUDGET, chosen per question. There is NO route-imposed token or dollar ceiling: the
 * provider's own hard limits and API constraints still apply, and the daily call cap, the concurrency limit, the request
 * deadline and the one-billed-call rule remain the abuse and cost protections.
 *
 * Reasoning effort, by the question's length in characters (a longer question is, on average, a harder one):
 *   - up to 200 characters   -> 'low'     (a short factual question)
 *   - 201 to 800 characters  -> 'medium'
 *   - over 800 characters    -> 'high'    (a long or complex question)
 * If the model is known NOT to accept a reasoning effort, none is sent (null).
 *
 * SERVER-SIDE INPUTS ONLY: the trimmed question's length, the validated config's model and this module's capability table, and
 * the operator's environment. Nothing the caller supplies (body fields, headers, the idempotency key) reaches this function.
 * The effort comes from the CLOSED set low|medium|high; the output ceiling is never infinite and never from the request.
 *
 * Output budget, in this order (basis recorded in the ledger):
 *   1. 'operator_override': JULIUS_ASK_MAX_OUTPUT_TOKENS, passed through unchanged;
 *   2. 'provider_max': the model's DOCUMENTED provider maximum, when the capability table states one;
 *   3. 'omitted': null, `max_output_tokens` is OMITTED from the request, so the provider's own hard limit applies.
 * No file in this repository states a documented output maximum for the model in use, so today the table is empty and the
 * answer is (3) unless the operator sets an override.
 */
export interface AskModelCapabilities {
  /** The model's documented provider maximum output tokens, or null/absent when this repository does not state one. */
  readonly maxOutputTokens?: number | null;
  /** False only when the model is known to reject a reasoning effort. Absent means it is accepted. */
  readonly supportsReasoningEffort?: boolean;
}
export type AskReasoningEffort = 'low' | 'medium' | 'high';
export type AskBudgetBasis = 'operator_override' | 'provider_max' | 'omitted';
/** The CLOSED set of efforts an ask may send. Anything else is rejected, not forwarded. */
export const ASK_EFFORTS: readonly AskReasoningEffort[] = ['low', 'medium', 'high'];
export interface AskBudget {
  readonly reasoningEffort: AskReasoningEffort | null;
  /** The value sent as max_output_tokens, or null meaning the field is OMITTED (never a stand-in number). */
  readonly maxOutputTokens: number | null;
  readonly basis: AskBudgetBasis;
}
export const ASK_EFFORT_LOW_MAX_CHARS = 200;
export const ASK_EFFORT_MEDIUM_MAX_CHARS = 800;

export function selectAskBudget(input: {
  readonly questionChars: number;
  readonly modelCapabilities?: AskModelCapabilities;
  readonly operatorOverride?: number | null;
}): AskBudget {
  const caps = input.modelCapabilities ?? {};
  const reasoningEffort: AskReasoningEffort | null = caps.supportsReasoningEffort === false
    ? null
    : input.questionChars <= ASK_EFFORT_LOW_MAX_CHARS ? 'low'
      : input.questionChars <= ASK_EFFORT_MEDIUM_MAX_CHARS ? 'medium' : 'high';
  if (reasoningEffort !== null && !ASK_EFFORTS.includes(reasoningEffort)) throw new Error('ask effort outside the closed set');
  if (input.operatorOverride !== undefined && input.operatorOverride !== null) {
    return { reasoningEffort, maxOutputTokens: input.operatorOverride, basis: 'operator_override' };
  }
  if (typeof caps.maxOutputTokens === 'number' && Number.isInteger(caps.maxOutputTokens) && caps.maxOutputTokens > 0) {
    return { reasoningEffort, maxOutputTokens: caps.maxOutputTokens, basis: 'provider_max' };
  }
  return { reasoningEffort, maxOutputTokens: null, basis: 'omitted' };
}

/** Per-model facts this repository documents. Empty on purpose: nothing here states a provider output maximum. */
const MODEL_CAPABILITIES: Readonly<Record<string, AskModelCapabilities>> = {};

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,80}$/;
const SCHEMA = {
  name: 'julius_ask_answer',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['answer'],
    properties: { answer: { type: 'string' } },
  },
} as const;
const INSTRUCTIONS =
  'You are the architect role of Julius, answering one question from a Wonderland player. Answer directly and briefly in plain text. '
  + 'You have no tools, no files, no web access and no memory of earlier questions; say so rather than guessing when the answer needs them. '
  + 'Reply with a JSON object {"answer": "<your answer>"}.';

export type AskRunner = (request: GptRunRequest) => Promise<GptRunOutcome>;

/** One ledger line. Never contains the question text, the key, or the raw provider response id. */
export type AskLedgerLine = Readonly<Record<string, string | number | boolean | null | Readonly<Record<string, string | number | null>>>>;
export interface AskLedger {
  /** Set by the production stdout and file ledgers. A stdout ledger cannot fail closed and is refused for every caller. */
  readonly kind?: 'stdout' | 'file';
  /** Descriptive only. A store counts as durable ONLY when a store factory branded it (`markAskStoreDurable`); this flag alone is ignored. */
  readonly durable?: boolean;
  /** Rejects (or throws) when the line was NOT durably written; a pre-call failure then stops the call. */
  append(line: AskLedgerLine): void | Promise<void>;
}
/** A durable ledger that can also be read back, so a fresh process (a restart or a replica) rebuilds cap and key state from it. */
export interface AskDurableLedger extends AskLedger {
  readonly durable: true;
  rows(): Promise<readonly AskLedgerLine[]>;
}
/** The stored form of the key-to-question binding: `v` is the MAC scheme version, `mac` the lowercase hex HMAC-SHA256. */
export interface AskQuestionBinding { readonly v: number; readonly mac: string }
export const ASK_BINDING_VERSION = 1;
export interface AskReserveInput {
  /** The whole pre-call ledger line (never question text, answer text or a key). */
  readonly line: AskLedgerLine;
  readonly callerHash: string;
  readonly keyHash: string;
  /** Versioned, caller-bound HMAC of the question, or null when no (long enough) secret is configured. Binds a key to one question across a restart. */
  readonly questionBinding: AskQuestionBinding | null;
  readonly utcDay: string;
  readonly globalCap: number;
  readonly callerCap: number;
}
export type AskReserveOutcome =
  | { readonly kind: 'reserved' }
  | { readonly kind: 'cap_reached' }
  | { readonly kind: 'caller_cap_reached' }
  | { readonly kind: 'duplicate'; readonly askId: string; readonly questionBinding: AskQuestionBinding | null; readonly result: AskLedgerLine | null };
/**
 * A durable store with ONE atomic reservation step: count today's pre-call rows globally and for the caller, refuse when over,
 * and otherwise insert the pre-call row, so one (caller, key) pair means one billed attempt across restarts and replicas.
 * A duplicate (the pair already has a pre-call row) takes precedence over the caps. A throw means NOTHING was inserted.
 */
export interface AskStore extends AskDurableLedger {
  reserve(input: AskReserveInput): Promise<AskReserveOutcome>;
}

export interface JuliusAskDeps {
  readonly runArchitect: AskRunner;
  readonly readConfig: (env: Record<string, string | undefined>) => GptArchitectConfig;
  readonly now: () => number;
  /** Any ledger; a store that can also be read back (AskDurableLedger) or that reserves atomically (AskStore) is what a player ask requires. */
  readonly ledger: AskLedger | AskDurableLedger | AskStore;
  readonly env: Record<string, string | undefined>;
  /** What is known about the configured model; defaults to this module's (empty) documented table. */
  readonly modelCapabilities?: (model: string | null) => AskModelCapabilities;
  /** Overrides ASK_IDEMPOTENCY_MAP_MAX (tests). */
  readonly idempotencyMapMax?: number;
}

export interface JuliusAskInput {
  readonly question: unknown;
  readonly idempotencyKey: unknown;
  readonly caller: unknown;
}

export interface JuliusAskSuccess {
  readonly ok: true;
  readonly askId: string;
  readonly answer: string;
  readonly role: 'architect';
  readonly provider: 'openai';
  readonly model: string;
  readonly usage: { readonly input: number | null; readonly cached: number | null; readonly output: number | null; readonly reasoning: number | null; readonly total: number | null };
  readonly costBasis: 'UNKNOWN';
  readonly billingPath: 'API_BILLED';
  readonly responseId: string;
  readonly ledgerRef: string;
  /** sha256 (hex) of the UTF-8 bytes of `answer` exactly as returned, so rendered text can be tied to this response and its ledger row. */
  readonly answerDigest: string;
  /** Length of `answer` in UTF-16 code units (JavaScript string length). */
  readonly answerChars: number;
}
export interface JuliusAskFailure {
  readonly ok: false;
  readonly code: string;
  readonly httpStatus: number;
  /** Only on the named 409 states after a duplicate key: ids and a digest, never answer or question text. */
  readonly detail?: Readonly<Record<string, string | null>>;
}
export type JuliusAskResult = JuliusAskSuccess | JuliusAskFailure;

/** Refusals made BEFORE any provider contact (or answered from the ledger): they buy nothing and are never remembered as the key's outcome. */
const NOT_ATTEMPTED: ReadonlySet<string> = new Set([
  'julius_ask_not_configured', 'julius_ask_cap_reached', 'julius_ask_caller_cap_reached', 'julius_ask_busy', 'julius_ask_ledger_unavailable',
  'julius_ask_already_answered', 'julius_ask_previous_attempt_failed', 'julius_ask_attempt_unknown', 'julius_ask_idempotency_key_reused',
  'julius_ask_key_not_bound',
]);
const fail = (code: string, httpStatus: number): JuliusAskFailure => ({ ok: false, code, httpStatus });
/* 16 hex (64 bits) on purpose: the stored callerHash/keyHash width. A database column CHECK for these must allow 16 to 64 hex digits. */
const sha = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 16);
const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** The operator's optional output-token override: null when unset, the number when valid, 'invalid' when set to something unusable (fail closed, never silently uncapped). */
function parseOverride(raw: string | undefined): number | null | 'invalid' {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 'invalid';
}

function usageOf(usage: GptUsage | undefined): JuliusAskSuccess['usage'] {
  return {
    input: usage?.inputTokens ?? null,
    cached: usage?.cachedInputTokens ?? null,
    output: usage?.outputTokens ?? null,
    reasoning: usage?.reasoningTokens ?? null,
    total: usage?.totalTokens ?? null,
  };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* INPUT POLICY (F7): what a player may send to the provider. Pure.                                                    */

export type AskInputPolicyResult =
  | { readonly ok: true; readonly question: string }
  | { readonly ok: false; readonly code: string; readonly httpStatus: number };

/* Stripped, not refused: C0 controls except TAB and LF (so CR too), DEL, C1 controls, soft hyphen, the combining grapheme joiner
   (U+034F), Arabic letter mark, Mongolian vowel separator and free variation selectors, the Hangul fillers (U+115F, U+1160,
   U+3164, U+FFA0), zero-width and bidi marks (U+200B-U+200F), U+2028/2029, bidi embeddings/overrides/isolates, word joiners and
   the deprecated format characters (U+2060-U+206F), variation selectors (U+FE00-U+FE0F, U+E0100-U+E01EF), the byte-order mark,
   and the TAG characters U+E0000-U+E007F (an invisible channel that can carry hidden text or split a secret shape). Everything
   here is removed BEFORE the shape checks. The `u` flag makes the astral ranges match whole code points. */
// eslint-disable-next-line no-control-regex
const STRIP_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u180b-\u180f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;

/** Any Unicode decimal digit (Arabic-Indic, fullwidth, mathematical, ...) as its ASCII digit. Nd characters come in contiguous runs of ten. */
function foldDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x30 && cp <= 0x39) return ch;
    let runStart = cp;
    while (runStart > 0 && /\p{Nd}/u.test(String.fromCodePoint(runStart - 1))) runStart -= 1;
    return String((cp - runStart) % 10);
  });
}

/* Refused, not redacted: a redacted question still carries the context the player did not mean to send. */
const SECRET_SHAPES: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*\S{12,}/i,
];
/* Letters and digits of any script, so an internationalised address is caught as well as an ASCII one. */
const EMAIL_SHAPE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/u;

/* PHONE NUMBERS: a structure, not "any run of 10 to 15 digits" (that refused years, dates, coordinates and ids). Three shapes:
   an international number (a leading +), a grouped North American style number (3-3-4 with a separator, or a bracketed area
   code), and a digit run right after a phone word ("call me on 07911 123456"). A bare unseparated digit run is NOT a phone number. */
const PHONE_INTERNATIONAL = /(?<![\w.])\+\d[\d\s().-]{6,20}\d(?!\w)/g;
const PHONE_GROUPED = /(?<![\w.-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]?\d{4}(?!\w|[.-]\d)/;
const PHONE_AFTER_WORD = /\b(?:call|phone|tel(?:ephone)?|text|sms|whatsapp|mobile|cell|reach|contact|dial)\b[^\d\n]{0,25}?(\+?\(?\d[\d\s().-]{5,20}\d)/gi;
const ISO_DATE_START = /^\d{4}-\d{2}-\d{2}/;

function hasPhoneShape(text: string): boolean {
  for (const m of text.matchAll(PHONE_INTERNATIONAL)) {
    const digits = m[0].replace(/\D/g, '').length;
    if (digits >= 8 && digits <= 15) return true;
  }
  if (PHONE_GROUPED.test(text)) return true;
  for (const m of text.matchAll(PHONE_AFTER_WORD)) {
    const run = m[1] ?? '';
    const digits = run.replace(/\D/g, '').length;
    const groups = run.split(/[\s().-]+/).filter((g) => g !== '');
    const allYears = groups.length > 1 && groups.every((g) => /^(?:1\d{3}|20\d{2})$/.test(g));
    if (digits >= 7 && digits <= 15 && !ISO_DATE_START.test(run) && !allYears) return true;
  }
  return false;
}

/* SELF-DECLARED AGE UNDER 13: a TEXT HEURISTIC, not an age control. It catches the common first-person phrasings ("I am 11 years
   old", "I'm 9 and ...", "my age is 12", "age: 9", "I am aged 10", "I just turned 8") and lets an ordinary number through
   ("I'm 5 minutes away", "I'm 3 and 0 in ranked", "I am 12 so close to the boss"). A child who does not say it, or says it
   another way, is NOT caught: real age assurance has to come from the account, not from this text. */
const AGE_NUMBER = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const AGE_SHAPES: readonly RegExp[] = [
  new RegExp(
    `\\b(?:i\\s+am|i['\\u2019]m|im)\\s+(?:a\\s+|an\\s+|only\\s+|just\\s+|still\\s+)?(?:aged\\s+)?${AGE_NUMBER}`
    + '(?:[\\s-]*(?:years?|yrs?)(?:[\\s-]*old\\b|(?=\\s*(?:$|[.,;:!?])))|\\s*y\\/?o\\b|(?=\\s*(?:$|[.,;:!?]|(?:and(?!\\s+\\d)|but|btw|can|how|what|why|do|does|where|who|is|please)\\b)))', 'i'),
  new RegExp(`\\b(?:my\\s+)?age\\s*(?:is\\s+|[:=]\\s*)${AGE_NUMBER}\\b`, 'i'),
  new RegExp(`\\baged\\s+${AGE_NUMBER}\\b`, 'i'),
  new RegExp(`\\bi\\s+(?:just\\s+)?turn(?:ed|ing|s)?\\s+${AGE_NUMBER}\\b`, 'i'),
];
const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function declaresAgeUnder13(text: string): boolean {
  for (const shape of AGE_SHAPES) {
    const m = shape.exec(text);
    const raw = m?.[1]?.toLowerCase();
    if (raw === undefined) continue;
    const n = NUMBER_WORDS[raw] ?? Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 12) return true;
  }
  return false;
}

/**
 * The question policy, run BEFORE the idempotency-key step. It removes the invisible characters, applies Unicode NFKC (so a
 * fullwidth or styled letter is its plain form) and folds every Unicode digit to ASCII, then strips again (the normalisation can
 * produce a strippable character) and trims; the visible text is kept, and what the provider receives is this normalised
 * question. It then REFUSES (4xx, so no slot is reserved and the provider is never contacted) a credential shape, an e-mail
 * address, a phone number, or a self-declared age under 13. Strip and normalise first, so hidden or look-alike characters cannot
 * be used to split or disguise a shape.
 */
export function applyAskInputPolicy(question: string): AskInputPolicyResult {
  const cleaned = foldDigits(question.replace(STRIP_CHARS, '').normalize('NFKC')).replace(STRIP_CHARS, '').trim();
  if (cleaned.length < 1 || cleaned.length > ASK_QUESTION_MAX_CHARS) return { ok: false, code: 'julius_ask_question_invalid', httpStatus: 400 };
  if (SECRET_SHAPES.some((shape) => shape.test(cleaned))) return { ok: false, code: 'julius_ask_input_refused', httpStatus: 400 };
  if (EMAIL_SHAPE.test(cleaned) || hasPhoneShape(cleaned)) return { ok: false, code: 'julius_ask_input_refused', httpStatus: 400 };
  if (declaresAgeUnder13(cleaned)) return { ok: false, code: 'julius_ask_age_restricted', httpStatus: 403 };
  return { ok: true, question: cleaned };
}

/**
 * The provider's abuse-attribution id for one caller: an HMAC under an OPERATOR secret (JULIUS_ASK_SAFETY_SECRET, else
 * JULIUS_ASK_BINDING_SECRET), so nobody without the secret can recompute it from a player id; opaque, stable per caller, never the
 * raw id. With no usable secret (under 16 characters) it is null and NO safety_identifier is sent (the pre-call row says
 * `safetyBasis: none`): an unsalted hash of a guessable id would only look like protection.
 */
export function safetyIdentifierFor(caller: string, secret: string): string | null {
  if (secret.length < 16) return null;
  return `jask_${createHmac('sha256', secret).update(`julius-ask-safety:v1:${caller}`, 'utf8').digest('hex').slice(0, 32)}`;
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* THE STORE: reservation over a durable ledger.                                                                       */

/* Serialises reservations per ledger object inside one process (the stand-in for the database's advisory lock). */
const reservationLocks = new WeakMap<object, Promise<unknown>>();
function withReservationLock<T>(key: object, fn: () => Promise<T>): Promise<T> {
  const previous = reservationLocks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  reservationLocks.set(key, run.then(() => undefined, () => undefined));
  return run;
}

/** The stored binding of a pre-call row, or null for a row without one (no secret was configured, or a legacy row with a bare MAC). */
function bindingOf(row: AskLedgerLine): AskQuestionBinding | null {
  const raw = row.questionBinding;
  if (typeof raw !== 'object' || raw === null) return null;
  return typeof raw.v === 'number' && typeof raw.mac === 'string' ? { v: raw.v, mac: raw.mac } : null;
}

/** Reserve over any durable ledger that can be read back: duplicate first, then the global cap, then the caller cap, then the insert. */
async function reserveOverRows(ledger: AskDurableLedger, input: AskReserveInput): Promise<AskReserveOutcome> {
  const rows = await ledger.rows();
  const pre = rows.filter((row) => row.phase === 'pre_call');
  const dup = pre.find((row) => row.callerHash === input.callerHash && row.keyHash === input.keyHash);
  if (dup !== undefined) {
    const result = rows.find((row) => row.phase === 'result' && row.askId === dup.askId) ?? null;
    return { kind: 'duplicate', askId: String(dup.askId), questionBinding: bindingOf(dup), result };
  }
  const today = pre.filter((row) => String(row.at).slice(0, 10) === input.utcDay);
  if (today.length >= input.globalCap) return { kind: 'cap_reached' };
  if (today.filter((row) => row.callerHash === input.callerHash).length >= input.callerCap) return { kind: 'caller_cap_reached' };
  /* The commit of this append IS the durable pre-call write; a throw leaves nothing behind. */
  await ledger.append(input.questionBinding === null ? input.line : { ...input.line, questionBinding: { v: input.questionBinding.v, mac: input.questionBinding.mac } });
  return { kind: 'reserved' };
}

/**
 * DURABILITY IS BRANDED, NOT DECLARED. A store counts as durable only if a store factory (createMemoryAskStore, the file store, the
 * future Postgres store) registered the very object here. The registry is module-private, so a plain object carrying
 * `durable: true`, a copy or a wrapper of a branded store, or anything built from a request is NOT durable and a player is refused.
 */
const durableBrand = new WeakSet<object>();
/** Called by a store FACTORY on the store object it returns, never by the route or from request data. Returns the same object. */
export function markAskStoreDurable<T extends AskDurableLedger>(store: T): T {
  durableBrand.add(store);
  return store;
}
const isDurableLedger = (ledger: AskLedger): ledger is AskDurableLedger =>
  durableBrand.has(ledger) && ledger.durable === true && typeof (ledger as Partial<AskDurableLedger>).rows === 'function';
const isAskStore = (ledger: AskLedger): ledger is AskStore => isDurableLedger(ledger) && typeof (ledger as Partial<AskStore>).reserve === 'function';

/**
 * An in-memory DURABLE fake store (shared between controller instances, so a restart or a replica can be simulated). It is the
 * seam's reference implementation and a test double, NOT production storage. `failWrites` makes the next commits throw.
 */
export function createMemoryAskStore(options: { readonly failWrites?: () => boolean } = {}): AskStore & { readonly held: AskLedgerLine[] } {
  const held: AskLedgerLine[] = [];
  const store: AskStore & { readonly held: AskLedgerLine[] } = {
    durable: true,
    held,
    async append(line) {
      await Promise.resolve();
      if (options.failWrites?.() === true) throw new Error('memory store write refused');
      held.push(line);
    },
    async rows() { return held.slice(); },
    reserve(input) { return reserveOverDurableLedger(store, input); },
  };
  return markAskStoreDurable(store);
}

/** Serialised (in this process) reservation over any durable ledger that can be read back; the building block of a single-instance store. */
export function reserveOverDurableLedger(ledger: AskDurableLedger, input: AskReserveInput): Promise<AskReserveOutcome> {
  return withReservationLock(ledger, () => reserveOverRows(ledger, input));
}

const ledgerRefOf = (askId: string): string => `julius-ask-ledger:${askId}`;
/** Version 1: HMAC-SHA256 over a length-unambiguous JSON array of (scheme, caller, key, question). Null when the secret is too short. */
export function bindQuestion(secret: string, caller: string, idempotencyKey: string, question: string): AskQuestionBinding | null {
  if (secret.length < 16) return null;
  const mac = createHmac('sha256', secret).update(JSON.stringify(['julius-ask-binding', ASK_BINDING_VERSION, caller, idempotencyKey, question]), 'utf8').digest('hex');
  return { v: ASK_BINDING_VERSION, mac };
}
const macEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The named 409 states for a key that already has a pre-call row. FIRST the key must be BOUND: a stored binding of a known version
 * must exist AND this request must carry one. Without both (no secret now or then, a legacy row, an unknown version) the route cannot
 * tell whether this is the same question, so it answers `julius_ask_key_not_bound` and never the old answer digest. When both exist
 * and differ the key is `julius_ask_idempotency_key_reused`; only a matching binding reaches the three states below.
 */
function duplicateFailure(dup: Extract<AskReserveOutcome, { kind: 'duplicate' }>, binding: AskQuestionBinding | null): JuliusAskFailure {
  const detail = { askId: dup.askId, ledgerRef: ledgerRefOf(dup.askId) };
  if (binding === null || dup.questionBinding === null || dup.questionBinding.v !== binding.v) {
    return { ok: false, code: 'julius_ask_key_not_bound', httpStatus: 409, detail };
  }
  if (!macEqual(binding.mac, dup.questionBinding.mac)) return fail('julius_ask_idempotency_key_reused', 409);
  if (dup.result === null) return { ok: false, code: 'julius_ask_attempt_unknown', httpStatus: 409, detail };
  if (dup.result.outcome === 'answered') {
    return { ok: false, code: 'julius_ask_already_answered', httpStatus: 409, detail: { ...detail, answerDigest: typeof dup.result.answerSha256 === 'string' ? dup.result.answerSha256 : null } };
  }
  return { ok: false, code: 'julius_ask_previous_attempt_failed', httpStatus: 409, detail: { ...detail, failureClass: typeof dup.result.failureClass === 'string' ? dup.result.failureClass : null } };
}

const EFFORT_RANK: Readonly<Record<AskReasoningEffort, number>> = { low: 0, medium: 1, high: 2 };
/** The operator's ceiling for PLAYER callers; anything unusable falls back to the (restrictive) default, never to "no ceiling". */
function playerMaxEffort(raw: string | undefined): AskReasoningEffort {
  const value = (raw ?? '').trim().toLowerCase();
  return (ASK_EFFORTS as readonly string[]).includes(value) ? (value as AskReasoningEffort) : ASK_DEFAULT_PLAYER_MAX_EFFORT;
}

interface AttemptInfo { askId: string | null; failureClass: string | null }

/** Drops the oldest SETTLED entries (Map iteration is insertion order) until at most `max` remain; entries still in flight are kept. */
function evictSettled(map: Map<string, { settled: JuliusAskResult | null }>, max: number): void {
  if (map.size <= max) return;
  for (const [slot, entry] of map) {
    if (map.size <= max) break;
    if (entry.settled !== null) map.delete(slot);
  }
}

export function createJuliusAsk(deps: JuliusAskDeps): { handleAsk(input: JuliusAskInput): Promise<JuliusAskResult> } {
  /* Per-process state, deliberately: a restart resets it. The durable store (not these) is the record for players; for the
     operator's local smoke over a file ledger these are all there is. */
  const stored = new Map<string, { readonly questionHash: string; readonly pending: Promise<JuliusAskResult>; settled: JuliusAskResult | null; readonly info: AttemptInfo }>();
  const memory = { day: '', total: 0, byCaller: new Map<string, number>() };
  let inFlight = 0;

  /* The reservation for a ledger that is not an AskStore and is not durable (the operator's file ledger): counts in this process. */
  async function reserveInMemory(input: AskReserveInput): Promise<AskReserveOutcome> {
    if (input.utcDay !== memory.day) { memory.day = input.utcDay; memory.total = 0; memory.byCaller.clear(); }
    if (memory.total >= input.globalCap) return { kind: 'cap_reached' };
    const mine = memory.byCaller.get(input.callerHash) ?? 0;
    if (mine >= input.callerCap) return { kind: 'caller_cap_reached' };
    /* Counted SYNCHRONOUSLY, before the first await, so parallel distinct-key asks cannot pass the same check. */
    memory.total += 1;
    memory.byCaller.set(input.callerHash, mine + 1);
    try {
      await deps.ledger.append(input.line);
    } catch (error) {
      if (memory.day === input.utcDay) {
        memory.total = Math.max(0, memory.total - 1);
        memory.byCaller.set(input.callerHash, Math.max(0, (memory.byCaller.get(input.callerHash) ?? 1) - 1));
      }
      throw error;
    }
    return { kind: 'reserved' };
  }

  async function committedPreCall(askId: string): Promise<boolean> {
    const { ledger } = deps;
    if (!isDurableLedger(ledger)) return false;
    try {
      return (await ledger.rows()).some((row) => row.phase === 'pre_call' && row.askId === askId);
    } catch {
      return false;
    }
  }

  function reserve(input: AskReserveInput): Promise<AskReserveOutcome> {
    const { ledger } = deps;
    if (isAskStore(ledger)) return ledger.reserve(input);
    /* Operator only (a player never reaches here without an AskStore): serialised per ledger OBJECT in this process. */
    if (isDurableLedger(ledger)) return reserveOverDurableLedger(ledger, input);
    return reserveInMemory(input);
  }

  async function runOnce(question: string, who: { callerHash: string; keyHash: string; caller: string; questionBinding: AskQuestionBinding | null; isPlayer: boolean }, info: AttemptInfo): Promise<JuliusAskResult> {
    const { env } = deps;
    let reserved = false;
    let holdsSlot = false;
    try {
      const config = deps.readConfig(env);
      const readiness = evaluateReadiness(config);
      if (!readiness.ready) return fail('julius_ask_not_configured', 503);

      const override = parseOverride(env.JULIUS_ASK_MAX_OUTPUT_TOKENS);
      if (override === 'invalid') return fail('julius_ask_not_configured', 503);
      const capabilities = (deps.modelCapabilities ?? ((m: string | null) => (m === null ? {} : MODEL_CAPABILITIES[m] ?? {})))(config.model);
      const budget = selectAskBudget({ questionChars: question.length, modelCapabilities: capabilities, operatorOverride: override });
      /* The operator-side effort policy: a PLAYER's question length can no longer select a higher effort than the operator allows. */
      let effort = budget.reasoningEffort;
      let effortBasis: string = effort === null ? 'not_sent' : 'dynamic';
      if (effort !== null && who.isPlayer) {
        const ceiling = playerMaxEffort(env.JULIUS_ASK_PLAYER_MAX_EFFORT);
        if (EFFORT_RANK[effort] > EFFORT_RANK[ceiling]) { effort = ceiling; effortBasis = 'policy_capped'; }
      }
      const dailyCap = positiveInt(env.JULIUS_ASK_DAILY_CAP, ASK_DEFAULT_DAILY_CAP);
      /* The per-caller cap protects players from each other; the operator is bound only by the global cap. */
      const callerCap = who.isPlayer ? positiveInt(env.JULIUS_ASK_CALLER_DAILY_CAP, defaultCallerDailyCap(dailyCap)) : dailyCap;
      const maxConcurrent = positiveInt(env.JULIUS_ASK_MAX_CONCURRENT, ASK_DEFAULT_MAX_CONCURRENT);
      const startedAt = deps.now();
      const today = utcDay(startedAt);
      /* The concurrency slot is taken SYNCHRONOUSLY (no await since the check), before the reservation. */
      if (inFlight >= maxConcurrent) return fail('julius_ask_busy', 429);
      inFlight += 1;
      holdsSlot = true;

      const safetyId = safetyIdentifierFor(who.caller, (env.JULIUS_ASK_SAFETY_SECRET ?? '').trim() || (env.JULIUS_ASK_BINDING_SECRET ?? '').trim());
      const askId = `ask_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const ledgerRef = ledgerRefOf(askId);
      /* ONE atomic step: count the day globally and for the caller, and insert the pre-call row. The row is written BEFORE the
         provider is contacted; when it cannot be committed nothing was inserted, no slot is held and no provider call is made. */
      let reservation: AskReserveOutcome;
      try {
        reservation = await reserve({
          line: {
            phase: 'pre_call', askId, at: new Date(startedAt).toISOString(), callerHash: who.callerHash, keyHash: who.keyHash,
            questionLength: question.length, model: config.model, maxAttempts: 1,
            /* The budget BASIS, honestly: the override or documented value, or null when max_output_tokens is omitted. */
            maxOutputTokensSent: budget.maxOutputTokens === null ? 'omitted' : budget.maxOutputTokens, budgetBasis: budget.basis,
            reasoningEffortChosen: effort, effortBasis, safetyBasis: safetyId === null ? 'none' : 'hmac',
          },
          callerHash: who.callerHash, keyHash: who.keyHash, questionBinding: who.questionBinding, utcDay: today, globalCap: dailyCap, callerCap,
        });
      } catch {
        /* A store can commit the pre-call row and THEN throw (a lost connection after COMMIT). When the ledger can be read back and
           holds this attempt's row, a billed call is a possibility we must not invite a retry of: answer attempt_unknown NOW, the
           same state every later retry of the key gets. Otherwise nothing was committed (or it cannot be told): 503, retry allowed. */
        if (await committedPreCall(askId)) return { ok: false, code: 'julius_ask_attempt_unknown', httpStatus: 409, detail: { askId, ledgerRef } };
        return fail('julius_ask_ledger_unavailable', 503);
      }
      if (reservation.kind === 'cap_reached') return fail('julius_ask_cap_reached', 429);
      if (reservation.kind === 'caller_cap_reached') return fail('julius_ask_caller_cap_reached', 429);
      if (reservation.kind === 'duplicate') return duplicateFailure(reservation, who.questionBinding);
      reserved = true;
      info.askId = askId;

      const apiKey = (env.OPENAI_API_KEY ?? '').trim();
      let outcome: GptRunOutcome;
      try {
        outcome = await deps.runArchitect({
          apiKey,
          config: {
            ...config,
            ...(budget.maxOutputTokens === null ? {} : { maxOutputTokens: budget.maxOutputTokens }),
            /* Always the route's own choice (or none), never whatever the config reader happened to carry. */
            reasoningEffort: effort ?? undefined,
            timeoutMs: Math.min(config.timeoutMs, ASK_MAX_TIMEOUT_MS),
          },
          /* No route-imposed output cap: the provider's own limit applies (the architect's 4000 default is for plans, not asks). */
          ...(budget.maxOutputTokens === null ? { omitMaxOutputTokens: true } : {}),
          instructions: INSTRUCTIONS,
          input: question,
          schema: SCHEMA,
          /* One ask is at most ONE billed provider request: no SDK retry. */
          maxRetries: 0,
          ...(safetyId === null ? {} : { safetyIdentifier: safetyId }),
        });
      } catch {
        outcome = { ok: false, failureClass: 'provider_error', message: 'provider call threw' };
      }

      const result = finish(outcome, askId, ledgerRef, apiKey);
      info.failureClass = outcome.ok ? (result.ok ? null : 'malformed_output') : outcome.failureClass;
      try {
        /* Everything needed to reconcile a billed call with the provider dashboard; never question text, answer text or a key.
           `providerResponseId` is the FULL id and lives in the ledger only, never in the HTTP response. */
        await deps.ledger.append({
          phase: 'result', askId, at: new Date(deps.now()).toISOString(),
          outcome: result.ok ? 'answered' : result.code,
          failureClass: info.failureClass,
          incompleteReason: outcome.ok ? null : outcome.incompleteReason ?? null,
          providerStatus: outcome.ok ? outcome.status : outcome.providerStatus ?? null,
          providerHttpStatus: outcome.ok ? null : outcome.providerHttpStatus ?? null,
          providerResponseId: outcome.responseId ?? null,
          /* The digest and length of the RETURNED answer (never the text), null for a failure: ties rendered text to this row. */
          answerSha256: result.ok ? result.answerDigest : null,
          answerChars: result.ok ? result.answerChars : null,
          usage: usageOf(outcome.usage),
          model: outcome.actualModel ?? null,
          /* The effort that went on the wire and the one the provider reported (GptEffort), as in the Julius pipeline. */
          effortSent: outcome.effort?.sent ?? null,
          effortEchoed: outcome.effort?.echoed ?? null,
          /* Exactly one, because the request carried maxRetries 0. */
          attempts: 1,
        });
      } catch {
        /* The pre-call line already exists; a lost result line must not discard an answer that was paid for. */
      }
      return result;
    } catch {
      /* A throw BEFORE the pre-call row was committed bought nothing (not remembered, the key stays usable); a throw after it may
         have been billed and is remembered as a failed attempt. */
      return reserved ? fail('julius_ask_provider_failed', 502) : fail('julius_ask_not_configured', 503);
    } finally {
      if (holdsSlot) inFlight -= 1;
    }
  }

  /** A key that already ran in THIS process and failed: the named reason, never a silent replay of the original code. */
  const failedBefore = (info: AttemptInfo): JuliusAskFailure => {
    if (info.askId === null) return fail('julius_ask_attempt_unknown', 409);
    const detail = { askId: info.askId, ledgerRef: ledgerRefOf(info.askId) };
    return { ok: false, code: 'julius_ask_previous_attempt_failed', httpStatus: 409, detail: { ...detail, failureClass: info.failureClass } };
  };

  return {
    async handleAsk(input: JuliusAskInput): Promise<JuliusAskResult> {
      if (deps.env.JULIUS_ASK_ENABLED !== '1') return fail('julius_ask_disabled', 503);
      if (typeof input.caller !== 'string' || input.caller.trim() === '') return fail('julius_ask_caller_required', 401);
      const caller = input.caller.trim();
      /* DEFAULT-DENY: exactly `operator` or `player:<id>`; any other string is refused, never silently treated as the operator. */
      const isPlayer = caller.length > 'player:'.length && caller.startsWith('player:');
      if (!isPlayer && caller !== 'operator') return fail('julius_ask_caller_not_recognised', 403);
      /* A player needs a branded store WITH an atomic reserve: a rows-based fallback over two ledger objects on one row set would
         let a cap or a key be spent twice, so the rows-based path below is for the OPERATOR's smoke only. A stdout ledger cannot
         fail closed, so nobody may use it. */
      if (isPlayer && !isAskStore(deps.ledger)) return fail('julius_ask_durable_ledger_required', 503);
      if (!isPlayer && deps.ledger.kind === 'stdout') return fail('julius_ask_ledger_unavailable', 503);
      if (typeof input.question !== 'string') return fail('julius_ask_question_invalid', 400);
      const trimmed = input.question.trim();
      if (trimmed.length < 1 || trimmed.length > ASK_QUESTION_MAX_CHARS) return fail('julius_ask_question_invalid', 400);
      /* Strip and refuse BEFORE the key step: a refused question reserves nothing and never reaches the provider. */
      const policy = applyAskInputPolicy(trimmed);
      if (!policy.ok) return fail(policy.code, policy.httpStatus);
      const question = policy.question;
      if (typeof input.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
        return fail('julius_ask_idempotency_key_invalid', 400);
      }
      const callerHash = sha(caller);
      const keyHash = sha(input.idempotencyKey);
      /* In memory only, never ledgered: it binds a key to ONE question inside this process. */
      const questionHash = createHash('sha256').update(question).digest('hex');
      /* Across a restart the binding is a versioned HMAC under an operator-held secret (never a plain hash, which a dictionary could
         invert for a short question), bound to the CALLER and the KEY as well as the question. Absent or too short a secret means
         NO durable question-derived value exists, and a repeated key after a restart is then answered `julius_ask_key_not_bound`. */
      const questionBinding = bindQuestion((deps.env.JULIUS_ASK_BINDING_SECRET ?? '').trim(), caller, input.idempotencyKey, question);
      /* Scoped to the caller, so one caller's key can never replay another's answer. The promise is stored BEFORE awaiting,
         so two concurrent requests with one key share one paid call. */
      const slot = `${callerHash}:${keyHash}`;
      const existing = stored.get(slot);
      if (existing !== undefined) {
        /* The same key with a DIFFERENT question is a client bug or an attempt to read someone else's answer: refuse it. */
        if (existing.questionHash !== questionHash) return fail('julius_ask_idempotency_key_reused', 409);
        if (existing.settled === null) return existing.pending;
        /* A completed answer is replayed from process memory only as an optimisation (a client must not rely on it: after a
           restart the ledger holds no answer text). A completed FAILURE is a named refusal, not a replay of the original code. */
        return existing.settled.ok ? existing.settled : failedBefore(existing.info);
      }
      const info: AttemptInfo = { askId: null, failureClass: null };
      const pending = runOnce(question, { callerHash, keyHash, caller, questionBinding, isPlayer }, info);
      const entry = { questionHash, pending, settled: null as JuliusAskResult | null, info };
      stored.set(slot, entry);
      const result = await pending;
      entry.settled = result;
      evictSettled(stored, deps.idempotencyMapMax ?? ASK_IDEMPOTENCY_MAP_MAX);
      /* A refusal made BEFORE any provider contact (not configured, cap reached, busy, ledger down, or answered from the
         ledger by a named 409) bought nothing now, so it is not the key's outcome: the caller may retry once it clears. */
      if (!result.ok && NOT_ATTEMPTED.has(result.code)) stored.delete(slot);
      return result;
    },
  };
}

function finish(outcome: GptRunOutcome, askId: string, ledgerRef: string, apiKey: string): JuliusAskResult {
  if (!outcome.ok) return fail('julius_ask_provider_failed', 502);
  let answer: unknown;
  try {
    answer = (JSON.parse(outcome.outputText) as { answer?: unknown }).answer;
  } catch {
    return fail('julius_ask_provider_malformed', 502);
  }
  if (typeof answer !== 'string' || answer.trim() === '') return fail('julius_ask_provider_malformed', 502);
  /* The exact key value is removed first (a shape-based scrub cannot know it), then the shared terminal sanitizer runs. */
  const keyless = apiKey.length >= 8 ? answer.split(apiKey).join('[redacted]') : answer;
  const clean = sanitizeTerminalBlock(keyless, { maxChars: ASK_ANSWER_MAX_CHARS, maxLineLength: ASK_ANSWER_MAX_CHARS }).slice(0, ASK_ANSWER_MAX_CHARS);
  return {
    ok: true, askId, answer: clean, role: 'architect', provider: 'openai', model: outcome.actualModel,
    usage: usageOf(outcome.usage), costBasis: 'UNKNOWN', billingPath: 'API_BILLED',
    responseId: redactResponseId(outcome.responseId), ledgerRef,
    answerDigest: createHash('sha256').update(clean, 'utf8').digest('hex'), answerChars: clean.length,
  };
}

/* ------------------------------------------------------------------------------------------------------------------ */
/* The HTTP edge: authentication and body handling, kept out of server.ts so its diff stays a few lines.               */

export const JULIUS_ASK_PATH = '/wonderland/julius/ask';
export const isJuliusAskRoute = (path: string): boolean => path === JULIUS_ASK_PATH;

export interface JuliusAskRouteRequest {
  readonly method: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  readonly rawBody: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly now: number;
  readonly operatorToken: string | undefined;
}
export interface JuliusAskRoutePorts {
  readonly ask: { handleAsk(input: JuliusAskInput): Promise<JuliusAskResult> };
  readonly verifyNativeSession: (input: { token: string; now: number }) => { playerId: string } | null;
}

const refuse = (status: number, kind: string, message: string, detail?: Readonly<Record<string, string | null>>) =>
  ({ status, body: { error: { kind, message, ...(detail === undefined ? {} : { detail }) } } });

export async function handleJuliusAskRoute(
  request: JuliusAskRouteRequest,
  ports: JuliusAskRoutePorts,
): Promise<{ status: number; body: unknown }> {
  if (request.method !== 'POST') return refuse(405, 'method_not_allowed', 'Asking Julius is a POST.');
  /* The operator bearer (a developer's own token) or a paired native Relay-Session. A browser origin is never accepted. */
  let caller: string | null = null;
  if (bearerMatches(request.authorization, request.operatorToken)) {
    caller = 'operator';
  } else if (request.origin === undefined) {
    const token = sessionTokenFrom(request.authorization);
    const native = token === null ? null : ports.verifyNativeSession({ token, now: request.now });
    if (native !== null) caller = `player:${native.playerId}`;
  }
  if (caller === null) return refuse(401, 'sign_in_required', 'Asking Julius needs a paired Wonderland session.');

  let question: unknown;
  if (request.rawBody !== undefined) {
    try { question = (JSON.parse(request.rawBody) as { question?: unknown } | null)?.question; } catch { question = undefined; }
  }
  const result = await ports.ask.handleAsk({ question, idempotencyKey: request.idempotencyKey, caller });
  if (!result.ok) return refuse(result.httpStatus, result.code, 'Julius could not answer this question.', result.detail);
  const { ok: _ok, ...data } = result;
  return { status: 200, body: { data } };
}

/**
 * The production ledger: one JSON line per event, appended to a file under the bridge's state root, or (no state root) to
 * stdout with a fixed prefix so the host's log is the record. A write that throws makes the pre-call step refuse the call.
 */
export function createAskLedger(file: string | null): AskLedger {
  return {
    /* Neither is a durable store: a player is refused over either, and nobody is served over stdout (it cannot fail closed). */
    kind: file === null ? 'stdout' : 'file',
    append(line) {
      const text = JSON.stringify(line);
      if (file === null) { console.log(`[julius-ask-ledger] ${text}`); return; }
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${text}
`, 'utf8');
    },
  };
}

/** The production composition: the real runner and the real config reader. */
export const createProductionJuliusAsk = (ledger: AskLedger, env: Record<string, string | undefined> = process.env) =>
  createJuliusAsk({ runArchitect: runGptArchitect, readConfig: readGptArchitectConfig, now: Date.now, ledger, env });
