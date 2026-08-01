/**
 * SERVER-SIDE CONFIGURATION for the GPT Prompt Architect.
 *
 * The key is read from the process environment and NEVER returned, logged or
 * placed in a record. There is deliberately no VITE_-prefixed variable: a
 * VITE_ name would be inlined into the browser bundle by the bundler, which
 * is precisely the failure this module exists to prevent.
 *
 * Live execution is explicit. A key alone never enables it — the existing
 * bridge convention (`RELAY_PROMPT_ARCHITECT_MODE=live`) is reused rather
 * than inventing a second switch.
 */

export interface GptArchitectConfig {
  readonly apiKeyPresent: boolean;
  readonly model: string | null;
  readonly liveMode: boolean;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

/** What is missing before a live request may be attempted. */
export interface GptArchitectReadiness {
  readonly ready: boolean;
  readonly missing: readonly string[];
  readonly blockedReason: string | null;
}

export const DEFAULT_MAX_OUTPUT_TOKENS = 4_000;
export const DEFAULT_TIMEOUT_MS = 300_000;

/** Read configuration WITHOUT ever exposing the key value itself. */
export function readGptArchitectConfig(
  env: Record<string, string | undefined>,
): GptArchitectConfig {
  const key = env.OPENAI_API_KEY;
  const maxTokens = Number(env.RELAY_PROMPT_ARCHITECT_MAX_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS);
  const timeout = Number(env.RELAY_PROMPT_ARCHITECT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return {
    // Presence only. The value never leaves this function.
    apiKeyPresent: typeof key === 'string' && key.trim().length > 0,
    model: env.OPENAI_PROMPT_ARCHITECT_MODEL?.trim() || null,
    liveMode: env.RELAY_PROMPT_ARCHITECT_MODE === 'live',
    maxOutputTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_OUTPUT_TOKENS,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

export function evaluateReadiness(config: GptArchitectConfig): GptArchitectReadiness {
  const missing: string[] = [];
  if (!config.apiKeyPresent) missing.push('OPENAI_API_KEY');
  if (config.model === null) missing.push('OPENAI_PROMPT_ARCHITECT_MODEL');
  if (!config.liveMode) missing.push('RELAY_PROMPT_ARCHITECT_MODE=live');
  return {
    ready: missing.length === 0,
    missing,
    blockedReason: missing.length === 0
      ? null
      : `Live Prompt Architect requires: ${missing.join(', ')}.`,
  };
}
