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
  /**
   * VARIABLES THAT WERE SET TO SOMETHING UNUSABLE, by NAME — never by value.
   *
   * A bound that was supplied and could not be parsed is not the same fact as
   * a bound nobody supplied, and silently substituting the default for the
   * first makes the operator's request disappear without a word. The names
   * travel so `evaluateReadiness` can refuse and SAY WHICH, which is the same
   * fail-closed-and-named contract `architectPreflight` already applies on the
   * bridge path — the two used to disagree about malformed input, one
   * refusing and one quietly defaulting.
   */
  readonly unusable: readonly string[];
}

/** What is missing before a live request may be attempted. */
export interface GptArchitectReadiness {
  readonly ready: boolean;
  readonly missing: readonly string[];
  readonly blockedReason: string | null;
}

/**
 * JULIUS'S ARCHITECT ENVELOPE, and the DEFAULTS ONLY.
 *
 * These are what an unset environment resolves to — never "the limit". The
 * limit is whatever `readGptArchitectConfig` returns, because
 * `RELAY_PROMPT_ARCHITECT_MAX_TOKENS` and `RELAY_PROMPT_ARCHITECT_TIMEOUT_MS`
 * may move either one. Anything that needs the number a request is actually
 * bounded by must resolve it from the environment (see
 * `architectOperativeTimeoutMs`), not read these.
 *
 * THE SAME TWO VARIABLES ARE ALSO READ BY `relay-bridge/openai-architect.ts`,
 * which serves the separate Relay demo mission and defaults to a deliberately
 * smaller envelope (1,200 tokens, 90 s) for a deliberately smaller answer.
 * Both pairs arrived in one commit (97106c56) and neither referenced the
 * other; `architect-envelope.test.ts` now enumerates every reader of both
 * variables and pins every default, so a third cannot appear unnoticed and
 * these two cannot drift silently.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_000;
export const DEFAULT_TIMEOUT_MS = 300_000;

/** Read configuration WITHOUT ever exposing the key value itself. */
export function readGptArchitectConfig(
  env: Record<string, string | undefined>,
): GptArchitectConfig {
  const key = env.OPENAI_API_KEY;
  const maxTokens = Number(env.RELAY_PROMPT_ARCHITECT_MAX_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS);
  const timeout = Number(env.RELAY_PROMPT_ARCHITECT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const usable = (value: number): boolean => Number.isFinite(value) && value > 0;
  /**
   * SET-BUT-UNUSABLE, and absence cannot reach this list — not because a guard
   * excludes it, but because `?? DEFAULT` above has already substituted a
   * usable number by the time we look. An explicit `!== undefined` test here
   * would read as load-bearing and bind nothing, which is the exact fault this
   * whole change is about.
   */
  const unusable: string[] = [];
  if (!usable(maxTokens)) unusable.push('RELAY_PROMPT_ARCHITECT_MAX_TOKENS');
  if (!usable(timeout)) unusable.push('RELAY_PROMPT_ARCHITECT_TIMEOUT_MS');
  return {
    // Presence only. The value never leaves this function.
    apiKeyPresent: typeof key === 'string' && key.trim().length > 0,
    model: env.OPENAI_PROMPT_ARCHITECT_MODEL?.trim() || null,
    liveMode: env.RELAY_PROMPT_ARCHITECT_MODE === 'live',
    // The bound stays usable whatever was supplied, so nothing downstream has
    // to defend against a zero or a NaN; `unusable` is what carries the fault.
    maxOutputTokens: usable(maxTokens) ? maxTokens : DEFAULT_MAX_OUTPUT_TOKENS,
    timeoutMs: usable(timeout) ? timeout : DEFAULT_TIMEOUT_MS,
    unusable,
  };
}

/**
 * THE NUMBER THAT ACTUALLY BOUNDS AN ARCHITECT REQUEST, resolved from the
 * environment — not the default it falls back to.
 *
 * `runGptArchitect` passes `config.timeoutMs` straight to the OpenAI client's
 * `timeout`, so this is the only value that cuts a plan off. It exists as its
 * own named export because the Julius composition root has to DECLARE the
 * architect's deadline on the worker it registers, and a declaration that
 * reads `DEFAULT_TIMEOUT_MS` is right only while nobody sets the variable.
 * That is the same declared-versus-operative drift `reviewer-deadline.ts`
 * exists to end, one role over: both sides now call this, so they cannot
 * disagree for any environment at all.
 */
export const architectOperativeTimeoutMs = (
  env: Record<string, string | undefined>,
): number => readGptArchitectConfig(env).timeoutMs;

export function evaluateReadiness(config: GptArchitectConfig): GptArchitectReadiness {
  const missing: string[] = [];
  if (!config.apiKeyPresent) missing.push('OPENAI_API_KEY');
  if (config.model === null) missing.push('OPENAI_PROMPT_ARCHITECT_MODEL');
  if (!config.liveMode) missing.push('RELAY_PROMPT_ARCHITECT_MODE=live');
  // A bound somebody set and nobody can use is a configuration fault, not a
  // default. Refused here and NAMED, exactly as the bridge path refuses it.
  missing.push(...config.unusable);
  return {
    ready: missing.length === 0,
    missing,
    blockedReason: missing.length === 0
      ? null
      : `Live Prompt Architect requires: ${missing.join(', ')}.`,
  };
}
