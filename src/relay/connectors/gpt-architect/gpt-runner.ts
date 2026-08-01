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
  readonly signal?: AbortSignal;
}

export interface GptRunSuccess {
  readonly ok: true;
  /** The provider response is the AUTHORITY for the actual model. */
  readonly actualModel: string;
  readonly responseId: string;
  readonly status: string;
  /** Raw structured text; the caller validates it before trusting it. */
  readonly outputText: string;
  readonly usage: {
    readonly inputTokens: number | null;
    readonly cachedInputTokens: number | null;
    readonly outputTokens: number | null;
    readonly reasoningTokens: number | null;
    readonly totalTokens: number | null;
  };
}

export interface GptRunFailure {
  readonly ok: false;
  readonly failureClass: GptFailureClass;
  /** Safe and redacted — never the raw provider payload. */
  readonly message: string;
  /** Present when the provider got far enough to identify itself. */
  readonly actualModel?: string;
  readonly responseId?: string;
}

export type GptRunOutcome = GptRunSuccess | GptRunFailure;

/** Never let a provider message carry request content or key material out. */
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
            name: ARCHITECT_PLAN_SCHEMA_NAME,
            schema: ARCHITECT_PLAN_SCHEMA,
            strict: true,
          },
        },
      },
      { signal: request.signal },
    );

    const usage = {
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
              actualModel: response.model, responseId: response.id,
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
        actualModel: response.model, responseId: response.id,
      };
    }
    if (response.status !== 'completed') {
      return {
        ok: false, failureClass: 'provider_error',
        message: `The provider reported status "${response.status}".`,
        actualModel: response.model, responseId: response.id,
      };
    }

    const outputText = response.output_text ?? '';
    if (outputText.trim().length === 0) {
      return {
        ok: false, failureClass: 'malformed_output',
        message: 'The provider returned no structured output.',
        actualModel: response.model, responseId: response.id,
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
