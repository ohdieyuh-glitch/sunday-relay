import { coderMaxRuntimeMs, coderMaxTurns } from './coder-envelope';
/**
 * THE HOSTED CODING AGENT'S SAFETY ENVELOPE — PURE.
 *
 * Sunday Relay already runs Claude Code locally against the founder's own
 * subscription. This is the SECOND execution surface: the Claude Agent SDK
 * (`@anthropic-ai/claude-agent-sdk`), which is Claude Code packaged as a
 * library and authenticated server-side. It is emphatically NOT a raw
 * completion call dressed up as an agent — it ships the same harness, the same
 * built-in tools, and the same permission model, which is exactly why Relay can
 * hold it to the same envelope it already holds the local CLI to.
 *
 * This module computes that envelope and nothing else. It touches no process,
 * no filesystem and no network, so the restrictions Relay claims to apply can
 * be asserted directly in tests rather than inferred from a run.
 *
 * THE ENVELOPE, AND WHY EACH PIECE IS HERE:
 *
 *   cwd                pinned to one disposable workspace, so the agent starts
 *                      nowhere near the primary checkout;
 *   allowedTools       Read/Glob/Grep/Edit only — the same set the local
 *                      adapter permits for the same fixture;
 *   disallowedTools    every capability that could act rather than read,
 *                      reach the network, or spawn more agents;
 *   settingSources     EMPTY, so no host or project settings file, hook, or
 *                      plugin on the server can widen any of the above;
 *   env                an ALLOWLIST built from nothing — the provider
 *                      credential is passed explicitly and every other Railway
 *                      variable is simply absent from the child;
 *   maxTurns / abort   bounded work and a real cancellation handle.
 *
 * A configured envelope is not a verified one. What actually ran is read back
 * off the SDK's own `init` message and compared here, because the difference
 * between "we asked for these tools" and "these tools were granted" is the
 * whole point.
 */

import { CLAUDE_SUBSCRIPTION_TOKEN_ENV, type ClaudeAuthMode } from './hosted-auth';

/** Tools the hosted agent may use for the safe-edit fixture. */
export const HOSTED_ALLOWED_TOOLS: readonly string[] = Object.freeze([
  'Read', 'Glob', 'Grep', 'Edit',
]);

/**
 * Tools the hosted agent may never use. `Bash` is the important one: the SDK
 * ships it by default, and a hosted agent with a shell could read Railway's
 * environment directly and defeat the credential boundary below.
 */
export const HOSTED_DISALLOWED_TOOLS: readonly string[] = Object.freeze([
  'Bash', 'BashOutput', 'KillShell', 'Write', 'NotebookEdit',
  'WebFetch', 'WebSearch', 'Task', 'SlashCommand', 'TodoWrite',
]);

/** Bounds for one hosted execution. */
export interface HostedLimits {
  readonly maxTurns: number;
  readonly maxRuntimeMs: number;
  /** Hard ceiling on spend for one proof, in US cents. */
  readonly maxCostCents: number;
}

/**
 * TURNS AND RUNTIME ARE DERIVED; COST IS NOT.
 *
 * These read `12` and `6 * 60_000`, sized by the first mission that fit inside
 * them. Paid Mission 4 finished in 11 turns of 12 — one turn of margin nobody
 * could see — and Paid Mission 5 spent both: a runtime abort at ~363 s, then
 * `error_max_turns` at 13 turns, with the mission substantially implemented.
 * `coder-envelope.ts` derives both from what paid runs were observed to do.
 *
 * `maxCostCents` stays a flat conservative floor for a run NOBODY budgeted, and
 * `hostedLimitsForAllocation` is still the only thing that raises it. A larger
 * turn or runtime allowance must never move the money, which is the whole
 * reason the money can stay an independent hard bound.
 */
export const DEFAULT_HOSTED_LIMITS: HostedLimits = Object.freeze({
  maxTurns: coderMaxTurns(),
  maxRuntimeMs: coderMaxRuntimeMs(),
  maxCostCents: 50,
});

/**
 * THE LIMIT JULIUS RESERVED, as hosted limits.
 *
 * The 50 cent default above is the ceiling for a run NOBODY has budgeted — a
 * conservative floor, not a mission policy. Paid run 34037313976 authorised
 * $20 and was refused at 50 cents after the work was done, because nothing
 * carried the mission's allocation down to this envelope. This is the one
 * seam that does: the amount is what Julius reserved for the dispatch, in
 * micro-dollars, and it becomes both the post-hoc ceiling and the runtime's
 * own `maxBudgetUsd` stop. Rounded DOWN to whole cents so the envelope never
 * admits more than the reservation. Turns and runtime keep their bounds.
 */
export function hostedLimitsForAllocation(usdMicros: number, base: HostedLimits = DEFAULT_HOSTED_LIMITS): HostedLimits {
  if (!Number.isFinite(usdMicros) || usdMicros < 0) throw new Error('hosted_allocation_invalid');
  return Object.freeze({ ...base, maxCostCents: Math.floor(usdMicros / 10_000) });
}

/**
 * The environment the hosted agent's child process receives.
 *
 * This is built from `{}` — it is not a filtered copy of `process.env`. On a
 * hosted box the parent environment holds the bridge's own operator token, the
 * xAI reviewer key, the OpenAI architect key and the database URL; a deny-list
 * would leak whichever one nobody thought to name. Starting empty means a new
 * Railway variable added next month is absent by construction rather than by
 * remembering to add a rule.
 *
 * `PATH` and `HOME` are included because the SDK spawns its own executable;
 * the provider credential is included because the run cannot happen without
 * it. Nothing else is.
 */
export function hostedChildEnv(input: {
  apiKey: string;
  path?: string;
  home?: string;
  /**
   * `CLAUDE_SUBSCRIPTION` OMITS THE CREDENTIAL ENTIRELY, and that omission is the
   * whole mechanism.
   *
   * Anthropic documents that `ANTHROPIC_API_KEY` takes PRECEDENCE over subscription
   * authentication, so leaving it in place while hoping the subscription is used
   * would bill an API balance nobody chose. Because this environment is built from
   * `{}`, not setting the key is a structural guarantee rather than a sanitising
   * pass that might miss a variable.
   *
   * MEASURED, NOT ASSUMED: on 2026-09-28 the `claude` CLI answered
   * `loggedIn: true, authMethod: "claude.ai", subscriptionType: "max"` under exactly
   * this environment minus the key — `PATH`, `HOME`, `CI`, `NO_COLOR`, `TERM` and
   * nothing else. Adding `USERPROFILE`, `APPDATA` or `LOCALAPPDATA` changed nothing,
   * so none is included. The CLI finds its own stored credential from `HOME`.
   *
   * Absent means API mode, so every existing caller is unchanged.
   */
  mode?: ClaudeAuthMode;
  /**
   * A `claude setup-token` subscription token, placed in the child as
   * `CLAUDE_CODE_OAUTH_TOKEN` UNDER `CLAUDE_SUBSCRIPTION` ONLY and only when
   * non-empty. In API mode it is ignored: API mode carries the API key alone.
   * The value is passed through and never read, compared or logged.
   */
  oauthToken?: string;
}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: input.path ?? '',
    HOME: input.home ?? '',
    // A hosted child is never attached to a terminal; say so rather than
    // letting it probe.
    CI: '1',
    NO_COLOR: '1',
    TERM: 'dumb',
  };
  if ((input.mode ?? 'ANTHROPIC_API') === 'ANTHROPIC_API') env.ANTHROPIC_API_KEY = input.apiKey;
  else if (typeof input.oauthToken === 'string' && input.oauthToken !== '') env[CLAUDE_SUBSCRIPTION_TOKEN_ENV] = input.oauthToken;
  return env;
}

/** The keys `hostedChildEnv` may ever produce in API mode — asserted by the boundary test. */
export const HOSTED_CHILD_ENV_KEYS: readonly string[] = Object.freeze([
  'ANTHROPIC_API_KEY', 'PATH', 'HOME', 'CI', 'NO_COLOR', 'TERM',
]);

/**
 * The keys it ALWAYS produces in SUBSCRIPTION mode: the same set, minus the API key.
 * `CLAUDE_CODE_OAUTH_TOKEN` is added on top when a setup-token token is supplied;
 * a preflight therefore decides over `Object.keys` of the environment it actually
 * composed, not over this list.
 */
export const HOSTED_CHILD_ENV_KEYS_SUBSCRIPTION: readonly string[] = Object.freeze(
  HOSTED_CHILD_ENV_KEYS.filter((key) => key !== 'ANTHROPIC_API_KEY'),
);

/** The keys the child may carry under a mode. One place, so the two lists cannot drift. */
export const hostedChildEnvKeys = (mode: ClaudeAuthMode): readonly string[] =>
  mode === 'CLAUDE_SUBSCRIPTION' ? HOSTED_CHILD_ENV_KEYS_SUBSCRIPTION : HOSTED_CHILD_ENV_KEYS;

export interface HostedEnvelope {
  readonly cwd: string;
  readonly model: string | null;
  readonly allowedTools: readonly string[];
  readonly disallowedTools: readonly string[];
  readonly permissionMode: 'acceptEdits';
  readonly maxTurns: number;
  /** Empty: no host or project settings file may widen this envelope. */
  readonly settingSources: readonly string[];
  readonly includePartialMessages: false;
}

/**
 * Compile the envelope for one hosted run.
 *
 * `requestedModel` is passed through exactly as given and may be null — Relay
 * does not pick a model on the founder's behalf, and a run whose model was
 * never requested records Unknown rather than inventing a default.
 */
export function compileHostedEnvelope(input: {
  workspacePath: string;
  requestedModel?: string | null;
  /**
   * THE LIMITS THIS RUN WAS ACTUALLY GRANTED.
   *
   * `HostedLimits.maxTurns` used to be decorative: `hosted-runner.ts` read
   * runtime and cost off the limits but built the envelope without them, so the
   * SDK's turn ceiling always came from `DEFAULT_HOSTED_LIMITS` and a caller
   * could raise `maxTurns` to forty and still stop at twelve. It binds now.
   */
  limits?: HostedLimits;
}): HostedEnvelope {
  const requested = typeof input.requestedModel === 'string' && input.requestedModel.trim() !== ''
    ? input.requestedModel.trim()
    : null;
  return {
    cwd: input.workspacePath,
    model: requested,
    allowedTools: [...HOSTED_ALLOWED_TOOLS],
    disallowedTools: [...HOSTED_DISALLOWED_TOOLS],
    // Edits are applied without a prompt because a hosted run has no operator
    // to prompt. Containment is the tool restriction, the pinned cwd, the
    // empty settings sources, Julius's `PreToolUse` authority on every file
    // tool (`hosted-tool-authority.ts`) and Relay's post-run inspection —
    // never a dialog. The allow list alone confines nothing: it approves
    // `Read` and `Edit` at any path, which is why the authority exists.
    permissionMode: 'acceptEdits',
    maxTurns: (input.limits ?? DEFAULT_HOSTED_LIMITS).maxTurns,
    settingSources: [],
    includePartialMessages: false,
  };
}

/**
 * Compare the envelope Relay REQUESTED against the one the runtime reported
 * granting in its `init` message.
 *
 * A hosted runtime that grants a tool Relay disallowed is not a curiosity to
 * log — it is a containment failure, and the caller stops on it. This is the
 * hosted equivalent of the local adapter's scope audit: the control is only
 * worth claiming if something measures it.
 */
export interface EnvelopeVerification {
  readonly matches: boolean;
  /** Disallowed tools the runtime reported as available anyway. */
  readonly unexpectedTools: readonly string[];
  /** Requested tools the runtime did not grant. */
  readonly missingTools: readonly string[];
  readonly cwdMatches: boolean;
  readonly reason: string | null;
}

export function verifyGrantedEnvelope(input: {
  envelope: HostedEnvelope;
  /** Tools the runtime's own init message said it has. */
  reportedTools: readonly string[];
  reportedCwd: string | null;
}): EnvelopeVerification {
  const disallowed = new Set(input.envelope.disallowedTools);
  const unexpectedTools = input.reportedTools.filter((t) => disallowed.has(t));
  const reported = new Set(input.reportedTools);
  const missingTools = input.envelope.allowedTools.filter((t) => !reported.has(t));
  // A runtime that reported no cwd has not proven it started where Relay put
  // it, so an absent value fails rather than passes.
  const cwdMatches = input.reportedCwd === input.envelope.cwd;

  const problems: string[] = [];
  if (unexpectedTools.length > 0) {
    problems.push(`runtime granted disallowed tool(s): ${unexpectedTools.join(', ')}`);
  }
  if (!cwdMatches) {
    problems.push(
      `runtime reported working directory ${input.reportedCwd ?? 'Unknown'}, not the isolated workspace`,
    );
  }
  return {
    // A missing ALLOWED tool is recorded but does not fail the run: a runtime
    // offering less than Relay asked for has not escaped anything.
    matches: unexpectedTools.length === 0 && cwdMatches,
    unexpectedTools,
    missingTools,
    cwdMatches,
    reason: problems.length === 0 ? null : problems.join('; '),
  };
}

/** Spend ceiling check. Reported cost is the runtime's own figure. */
export function withinCostCeiling(
  reportedCostUsd: number | null,
  limits: HostedLimits = DEFAULT_HOSTED_LIMITS,
): { within: boolean; reason: string | null } {
  if (reportedCostUsd === null || !Number.isFinite(reportedCostUsd)) {
    // Unknown cost is not a pass and not a failure — it is Unknown, and the
    // caller records it as such rather than asserting the ceiling held.
    return { within: true, reason: null };
  }
  const cents = reportedCostUsd * 100;
  if (cents > limits.maxCostCents) {
    return {
      within: false,
      reason: `The hosted run reported ${cents.toFixed(2)}¢, above the ${limits.maxCostCents}¢ ceiling.`,
    };
  }
  return { within: true, reason: null };
}
