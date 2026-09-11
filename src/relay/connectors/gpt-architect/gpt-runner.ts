import OpenAI from 'openai';
import { ARCHITECT_PLAN_SCHEMA, ARCHITECT_PLAN_SCHEMA_NAME } from './plan-schema';
import type { GptArchitectConfig } from './config';

/**
 * THE ONE LIVE PROVIDER CALL — OpenAI Responses API, server-side only.
 *
 * Deliberate choices, each one a rule this milestone must not break:
 *   - `store: false`         — no provider-side conversation state; Relay's
 *                              own persistence is the memory authority.
 *   - no `previous_response_id` — nothing becomes hidden mission memory.
 *   - `text.format` json_schema + `strict: true` — the answer is shape-
 *     constrained, and Relay STILL revalidates it.
 *   - `instructions` carries the Mission Contract (the operating authority);
 *     `input` carries the user's requested work and bounded context.
 *   - AbortController — the SDK's supported cancellation mechanism.
 *   - no tools, no web search — external research is not connected, so it is
 *     not advertised and not enabled.
 *
 * Errors are classified and REDACTED: a raw provider error can contain the
 * request, so only a safe class and a short message ever leave here.
 */

export type GptFailureClass =
  | 'authentication_failed' | 'permission_denied' | 'model_unavailable'
  | 'rate_limited' | 'timeout' | 'malformed_output' | 'refused'
  | 'incomplete_response' | 'network_disconnected' | 'provider_error';

export interface GptRunRequest {
  readonly apiKey: string;
  readonly config: GptArchitectConfig;
  /** Mission Contract derived — the developer/system-level authority. */
  readonly instructions: string;
  /** The user's requested work plus bounded context. */
  readonly input: string;
  /**
   * WHICH ANSWER IS BEING ASKED FOR. The architect has two jobs and they have
   * different shapes: a PLAN before the contract locks, and a GUIDANCE PACKET
   * after it. Both are strict json_schema answers through this one runner, so
   * there is still exactly one place a provider call is made, one place a
   * failure is classified, and one place a credential could leak from.
   *
   * Absent means the plan schema, because every caller that predates guidance
   * asked for a plan and a default that silently changed shape would be the
   * worst of both.
   */
  readonly schema?: { readonly name: string; readonly schema: Record<string, unknown> };
  readonly signal?: AbortSignal;
}

/**
 * WHAT THE PROVIDER SAID THE CALL CONSUMED.
 *
 * Named, because it is no longer the success path's private business: a call
 * that FAILS was still billed, and the numbers are in the same response.
 */
export interface GptUsage {
  readonly inputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly totalTokens: number | null;
}

export interface GptRunSuccess {
  readonly ok: true;
  /** The provider response is the AUTHORITY for the actual model. */
  readonly actualModel: string;
  readonly responseId: string;
  readonly status: string;
  /** Raw structured text; the caller validates it before trusting it. */
  readonly outputText: string;
  readonly usage: GptUsage;
}

export interface GptRunFailure {
  readonly ok: false;
  readonly failureClass: GptFailureClass;
  /** Safe and redacted — never the raw provider payload. */
  readonly message: string;
  /**
   * PRESENT ONLY WHEN THE PROVIDER ANSWERED, and absent is not zero.
   *
   * Paid Live Mission 4's first attempt (run 34459684814) burned a real
   * `gpt-5.6-sol` call for 62 seconds, came back `incomplete`, and recorded
   * NOTHING about what it cost: this interface had no `usage` field at all, so
   * the numbers the provider had just reported were computed and dropped on
   * the floor one line later. `costBasis` was then honestly `UNKNOWN` — but it
   * was unknown only because the answer had been discarded, which is the one
   * kind of unknown this system is not allowed to manufacture.
   *
   * Failures raised BEFORE a response exists (no model configured, a thrown
   * transport error) leave this undefined, because there genuinely is no usage
   * to report and inventing one would be the opposite fix.
   */
  readonly usage?: GptUsage;
  /**
   * THE PROVIDER'S OWN REASON an otherwise-successful call stopped early —
   * `max_output_tokens`, `content_filter`. A machine token, narrowed here, so
   * it can travel into the durable record beside the failure class instead of
   * living only in `message`, which the evidence allowlist withholds (as it
   * should: a message is free text). Without it, "the plan was incomplete" and
   * "the plan ran out of budget" are the same sentence, and the second is the
   * one that says what to change.
   */
  readonly incompleteReason?: string | null;
  /** The provider's own `status` when it answered — `incomplete`, `failed`. */
  readonly providerStatus?: string | null;
  /** Present when the provider got far enough to identify itself. */
  readonly actualModel?: string;
  readonly responseId?: string;
}

export type GptRunOutcome = GptRunSuccess | GptRunFailure;

/** Never let a provider message carry request content or key material out. */
/**
 * A PROVIDER'S REASON, NARROWED TO A MACHINE TOKEN.
 *
 * `incomplete_details.reason` is provider-controlled text. It reaches a durable
 * row, so it is held to the same shape every durable reason code is: lower
 * snake-case, bounded. Anything else becomes null rather than travelling as
 * prose — an unrecognised reason is honestly unknown, not quietly quoted.
 */
function safeReasonToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return /^[a-z][a-z0-9_]{0,63}$/.test(trimmed) ? trimmed : null;
}

function safeMessage(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw ?? 'provider error');
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 200);
}

function classify(error: unknown): GptFailureClass {
  const status = (error as { status?: number } | null)?.status;
  const name = (error as { name?: string } | null)?.name ?? '';
  if (name === 'AbortError') return 'timeout';
  if (status === 401) return 'authentication_failed';
  if (status === 403) return 'permission_denied';
  if (status === 404) return 'model_unavailable';
  if (status === 429) return 'rate_limited';
  if (typeof status === 'number' && status >= 500) return 'provider_error';
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') {
    return 'network_disconnected';
  }
  return 'provider_error';
}

/**
 * Execute exactly one bounded planning request. The SDK's own bounded retry
 * is capped at a single transient attempt; nothing retries indefinitely and
 * nothing falls back to a different model.
 */
export async function runGptArchitect(request: GptRunRequest): Promise<GptRunOutcome> {
  const { config } = request;
  if (config.model === null) {
    return { ok: false, failureClass: 'model_unavailable', message: 'No model is configured.' };
  }

  const client = new OpenAI({
    apiKey: request.apiKey,
    // One bounded transient retry — never an indefinite loop.
    maxRetries: 1,
    timeout: config.timeoutMs,
  });

  try {
    const response = await client.responses.create(
      {
        model: config.model,
        instructions: request.instructions,
        input: request.input,
        // Relay's persistence is the memory authority, not the provider's.
        store: false,
        max_output_tokens: config.maxOutputTokens,
        text: {
          format: {
            type: 'json_schema',
            name: request.schema?.name ?? ARCHITECT_PLAN_SCHEMA_NAME,
            schema: request.schema?.schema ?? ARCHITECT_PLAN_SCHEMA,
            strict: true,
          },
        },
      },
      { signal: request.signal },
    );

    /* Computed BEFORE the failure checks below, and now carried into every one
     * of them: a refusal, an incomplete answer and a 500-after-work were all
     * billed, and until this change all three reported nothing. */
    const usage: GptUsage = {
      inputTokens: response.usage?.input_tokens ?? null,
      cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? null,
      totalTokens: response.usage?.total_tokens ?? null,
    };

    // A refusal is not a completion.
    for (const item of response.output ?? []) {
      if (item.type === 'message') {
        for (const part of item.content ?? []) {
          if (part.type === 'refusal') {
            return {
              ok: false, failureClass: 'refused',
              message: safeMessage(part.refusal),
              actualModel: response.model, responseId: response.id, usage,
              providerStatus: safeReasonToken(response.status),
            };
          }
        }
      }
    }

    // Neither is an incomplete response.
    if (response.status === 'incomplete') {
      return {
        ok: false, failureClass: 'incomplete_response',
        message: `The response was incomplete (${response.incomplete_details?.reason ?? 'unknown reason'}).`,
        actualModel: response.model, responseId: response.id, usage,
        providerStatus: safeReasonToken(response.status),
        incompleteReason: safeReasonToken(response.incomplete_details?.reason),
      };
    }
    if (response.status !== 'completed') {
      return {
        ok: false, failureClass: 'provider_error',
        message: `The provider reported status "${response.status}".`,
        actualModel: response.model, responseId: response.id, usage,
        providerStatus: safeReasonToken(response.status),
      };
    }

    const outputText = response.output_text ?? '';
    if (outputText.trim().length === 0) {
      return {
        ok: false, failureClass: 'malformed_output',
        message: 'The provider returned no structured output.',
        actualModel: response.model, responseId: response.id, usage,
        providerStatus: safeReasonToken(response.status),
      };
    }

    return {
      ok: true,
      // The RESPONSE is the authority for the actual model, never the config.
      actualModel: response.model,
      responseId: response.id,
      status: response.status,
      outputText,
      usage,
    };
  } catch (error) {
    return { ok: false, failureClass: classify(error), message: safeMessage(error) };
  }
}

/** Redacted tail of a provider id — never the full identifier. */
export const redactResponseId = (id: string): string => `…${id.slice(-6)}`;
