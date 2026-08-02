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

export const DEFAULT_HOSTED_LIMITS: HostedLimits = Object.freeze({
  maxTurns: 12,
  maxRuntimeMs: 6 * 60_000,
  maxCostCents: 50,
});

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
}): Record<string, string> {
  const env: Record<string, string> = {
    ANTHROPIC_API_KEY: input.apiKey,
    PATH: input.path ?? '',
    HOME: input.home ?? '',
    // A hosted child is never attached to a terminal; say so rather than
    // letting it probe.
    CI: '1',
    NO_COLOR: '1',
    TERM: 'dumb',
  };
  return env;
}

/** The keys `hostedChildEnv` may ever produce — asserted by the boundary test. */
export const HOSTED_CHILD_ENV_KEYS: readonly string[] = Object.freeze([
  'ANTHROPIC_API_KEY', 'PATH', 'HOME', 'CI', 'NO_COLOR', 'TERM',
]);

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
    // empty settings sources and Relay's post-run inspection — never a dialog.
    permissionMode: 'acceptEdits',
    maxTurns: DEFAULT_HOSTED_LIMITS.maxTurns,
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
