import { createHash, randomUUID } from 'node:crypto';
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
 */

export const ASK_QUESTION_MAX_CHARS = 2_000;
export const ASK_ANSWER_MAX_CHARS = 8_000;
export const ASK_DEFAULT_DAILY_CAP = 20;
export const ASK_DEFAULT_MAX_CONCURRENT = 1;
/** The provider call is bounded to this even when the architect timeout is longer (a request deadline, not a token or dollar ceiling). */
export const ASK_MAX_TIMEOUT_MS = 90_000;

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
export type AskLedgerLine = Readonly<Record<string, string | number | boolean | null | Readonly<Record<string, number | null>>>>;
export interface AskLedger {
  /** Rejects (or throws) when the line was NOT durably written; a pre-call failure then stops the call. */
  append(line: AskLedgerLine): void | Promise<void>;
}

export interface JuliusAskDeps {
  readonly runArchitect: AskRunner;
  readonly readConfig: (env: Record<string, string | undefined>) => GptArchitectConfig;
  readonly now: () => number;
  readonly ledger: AskLedger;
  readonly env: Record<string, string | undefined>;
  /** What is known about the configured model; defaults to this module's (empty) documented table. */
  readonly modelCapabilities?: (model: string | null) => AskModelCapabilities;
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
}
export type JuliusAskResult = JuliusAskSuccess | JuliusAskFailure;

const NOT_ATTEMPTED: ReadonlySet<string> = new Set(['julius_ask_not_configured', 'julius_ask_cap_reached', 'julius_ask_busy', 'julius_ask_ledger_unavailable']);
const fail = (code: string, httpStatus: number): JuliusAskFailure => ({ ok: false, code, httpStatus });
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

export function createJuliusAsk(deps: JuliusAskDeps): { handleAsk(input: JuliusAskInput): Promise<JuliusAskResult> } {
  /* Per-process state, deliberately: a restart resets it, which is why the ledger (not these) is the record. */
  const stored = new Map<string, { readonly questionHash: string; readonly pending: Promise<JuliusAskResult> }>();
  let day = '';
  let callsToday = 0;
  let inFlight = 0;

  async function runOnce(question: string, callerHash: string, keyHash: string): Promise<JuliusAskResult> {
    const { env } = deps;
    const config = deps.readConfig(env);
    const readiness = evaluateReadiness(config);
    if (!readiness.ready) return fail('julius_ask_not_configured', 503);

    const override = parseOverride(env.JULIUS_ASK_MAX_OUTPUT_TOKENS);
    if (override === 'invalid') return fail('julius_ask_not_configured', 503);
    const capabilities = (deps.modelCapabilities ?? ((m: string | null) => (m === null ? {} : MODEL_CAPABILITIES[m] ?? {})))(config.model);
    const budget = selectAskBudget({ questionChars: question.length, modelCapabilities: capabilities, operatorOverride: override });
    const dailyCap = positiveInt(env.JULIUS_ASK_DAILY_CAP, ASK_DEFAULT_DAILY_CAP);
    const maxConcurrent = positiveInt(env.JULIUS_ASK_MAX_CONCURRENT, ASK_DEFAULT_MAX_CONCURRENT);
    const startedAt = deps.now();
    const today = utcDay(startedAt);
    if (today !== day) { day = today; callsToday = 0; }
    if (callsToday >= dailyCap) return fail('julius_ask_cap_reached', 429);
    if (inFlight >= maxConcurrent) return fail('julius_ask_busy', 429);

    /* RESERVE the cap slot and the concurrency slot SYNCHRONOUSLY, before the first await. Check-then-await-then-increment
       let any number of parallel distinct-key asks pass the same check. Everything above is synchronous, so no other ask
       can interleave between the check and this reservation. */
    callsToday += 1;
    inFlight += 1;
    try {
      const askId = `ask_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const ledgerRef = `julius-ask-ledger:${askId}`;
      /* The pre-call line is written BEFORE the provider is contacted, and a line that cannot be written stops the call
         (and gives the reserved cap slot back: nothing was spent). */
      try {
        await deps.ledger.append({
          phase: 'pre_call', askId, at: new Date(startedAt).toISOString(), callerHash, keyHash,
          questionLength: question.length, model: config.model, maxAttempts: 1,
          /* The budget BASIS, honestly: the override or documented value, or null when max_output_tokens is omitted. */
          maxOutputTokensSent: budget.maxOutputTokens === null ? 'omitted' : budget.maxOutputTokens, budgetBasis: budget.basis,
          reasoningEffortChosen: budget.reasoningEffort, effortBasis: budget.reasoningEffort === null ? 'not_sent' : 'dynamic',
        });
      } catch {
        if (day === today && callsToday > 0) callsToday -= 1;
        return fail('julius_ask_ledger_unavailable', 503);
      }

      const apiKey = (env.OPENAI_API_KEY ?? '').trim();
      let outcome: GptRunOutcome;
      try {
        outcome = await deps.runArchitect({
          apiKey,
          config: {
            ...config,
            ...(budget.maxOutputTokens === null ? {} : { maxOutputTokens: budget.maxOutputTokens }),
            /* Always the budget's own choice (or none), never whatever the config reader happened to carry. */
            reasoningEffort: budget.reasoningEffort ?? undefined,
            timeoutMs: Math.min(config.timeoutMs, ASK_MAX_TIMEOUT_MS),
          },
          /* No route-imposed output cap: the provider's own limit applies (the architect's 4000 default is for plans, not asks). */
          ...(budget.maxOutputTokens === null ? { omitMaxOutputTokens: true } : {}),
          instructions: INSTRUCTIONS,
          input: question,
          schema: SCHEMA,
          /* One ask is at most ONE billed provider request: no SDK retry. */
          maxRetries: 0,
        });
      } catch {
        outcome = { ok: false, failureClass: 'provider_error', message: 'provider call threw' };
      }

      const result = finish(outcome, askId, ledgerRef, apiKey);
      try {
        /* Everything needed to reconcile a billed call with the provider dashboard; never question text, answer text or a key.
           `providerResponseId` is the FULL id and lives in the ledger only, never in the HTTP response. */
        await deps.ledger.append({
          phase: 'result', askId, at: new Date(deps.now()).toISOString(),
          outcome: result.ok ? 'answered' : result.code,
          failureClass: outcome.ok ? (result.ok ? null : 'malformed_output') : outcome.failureClass,
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
    } finally {
      inFlight -= 1;
    }
  }

  return {
    async handleAsk(input: JuliusAskInput): Promise<JuliusAskResult> {
      if (deps.env.JULIUS_ASK_ENABLED !== '1') return fail('julius_ask_disabled', 503);
      if (typeof input.caller !== 'string' || input.caller.trim() === '') return fail('julius_ask_caller_required', 401);
      if (typeof input.question !== 'string') return fail('julius_ask_question_invalid', 400);
      const question = input.question.trim();
      if (question.length < 1 || question.length > ASK_QUESTION_MAX_CHARS) return fail('julius_ask_question_invalid', 400);
      if (typeof input.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
        return fail('julius_ask_idempotency_key_invalid', 400);
      }
      const callerHash = sha(input.caller.trim());
      const keyHash = sha(input.idempotencyKey);
      /* In memory only, never ledgered: it binds a key to ONE question. */
      const questionHash = createHash('sha256').update(question).digest('hex');
      /* Scoped to the caller, so one caller's key can never replay another's answer. The promise is stored BEFORE awaiting,
         so two concurrent requests with one key share one paid call. A failed attempt is stored too: it may have been billed. */
      const slot = `${callerHash}:${keyHash}`;
      const existing = stored.get(slot);
      if (existing !== undefined) {
        /* The same key with a DIFFERENT question is a client bug or an attempt to read someone else's answer: refuse it. */
        return existing.questionHash === questionHash ? existing.pending : fail('julius_ask_idempotency_key_reused', 409);
      }
      const pending = runOnce(question, callerHash, keyHash);
      stored.set(slot, { questionHash, pending });
      const result = await pending;
      /* A refusal made BEFORE any provider contact (not configured, cap reached, busy, ledger down) bought nothing, so it is
         not the key's answer: the caller may retry the same key once the condition clears. */
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

const refuse = (status: number, kind: string, message: string) => ({ status, body: { error: { kind, message } } });

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
  if (!result.ok) return refuse(result.httpStatus, result.code, 'Julius could not answer this question.');
  const { ok: _ok, ...data } = result;
  return { status: 200, body: { data } };
}

/**
 * The production ledger: one JSON line per event, appended to a file under the bridge's state root, or (no state root) to
 * stdout with a fixed prefix so the host's log is the record. A write that throws makes the pre-call step refuse the call.
 */
export function createAskLedger(file: string | null): AskLedger {
  return {
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
