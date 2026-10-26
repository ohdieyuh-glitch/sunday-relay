/**
 * THE AGENTIC ARCHITECT ON THE CLAUDE AGENT SDK, behind a runtime switch that defaults OFF.
 *
 * WHAT THIS IS. The Prompt Architect slot (role `PROMPT_ARCHITECT`, shown as the "Agentic Architect") answered by a
 * genuine Claude Agent SDK session instead of one Messages request. The session may reason over several turns and may
 * READ the mission workspace with three approved tools; it may not change anything, run anything or reach the network.
 *
 * WHAT IT IS NOT. A second architect. It plugs into the EXISTING slot: `createLiveArchitectAdapter` (live-workers.ts)
 * still builds the charter, the packet, the output schema (`ARCHITECT_PLAN_SCHEMA` and its siblings, with the research
 * asks), parses the answer, runs `validateArchitectPlan`, buys at most one correction, maps the plan onto a contract
 * proposal and stores the artifact. This module only replaces the one provider call inside that slot (`run`), and wraps
 * the slot's result with what the SDK reported it cost. Julius still decides every task; the SDK runs INSIDE one
 * architect dispatch.
 *
 * WHY IT LIVES HERE. It is the Claude Agent SDK hosting surface the Coding Agent already uses, and it reuses that
 * surface's pieces rather than copying them: `loadHostedQuery` (the one allowed dynamic import), `hostedChildEnv` (the
 * child environment built from nothing, `CLAUDE_CODE_MAX_RETRIES=0`, no model fallback), `juliusHostedToolAuthority`
 * (real-path workspace confinement), `foldHostedMessage` and the served-model attestation. None of their behaviour for
 * the coder changes.
 *
 * THE SWITCH. `JULIUS_ARCHITECT_RUNTIME`, read by the composition: absent or `messages` keeps the existing runner;
 * `agent_sdk` selects this one; anything else is refused before any adapter exists. The paid workflow does not set it.
 */

import { HOSTED_DISALLOWED_TOOLS, hostedChildEnv } from './hosted-envelope';
import {
  emptyObservation, foldHostedMessage, hostedServedModel, hostedServedModelVerdict, hostedStreamIsUsable,
  type HostedObservation,
} from './hosted-observation';
import { classifyHostedFailure, type HostedFailureReason } from './hosted-failure-reason';
import { juliusHostedToolAuthority, type HostedHookOutput, type HostedToolFs } from './hosted-tool-authority';
import { loadHostedQuery, type HostedQueryFn } from './hosted-runner';
import type { GptRunOutcome } from '../../src/relay/connectors/gpt-architect';
import {
  JuliusDispatchError,
  type JuliusDispatchInput,
  type JuliusErrorCode,
  type JuliusProviderAdapter,
  type JuliusProviderResult,
} from '../../src/relay/mission/julius/julius-router';

/* ------------------------------------------------------------------------------------------------ the switch */

export const JULIUS_ARCHITECT_RUNTIME_ENV = 'JULIUS_ARCHITECT_RUNTIME';
export const JULIUS_ARCHITECT_RUNTIMES = ['messages', 'agent_sdk'] as const;
export type JuliusArchitectRuntime = (typeof JULIUS_ARCHITECT_RUNTIMES)[number];
/** The default is the existing runner. Turning the SDK architect on is a separate, founder-signed change. */
export const JULIUS_ARCHITECT_RUNTIME_DEFAULT: JuliusArchitectRuntime = 'messages';

/**
 * WHICH RUNNER ANSWERS THE ARCHITECT SLOT. Unset or empty is the default. A value nobody defined is REFUSED, not
 * defaulted: a misspelled `agent-sdk` silently running the other runner would be a deployment nobody chose.
 */
export function resolveJuliusArchitectRuntime(
  env: Record<string, string | undefined>,
): { readonly ok: true; readonly runtime: JuliusArchitectRuntime } | { readonly ok: false; readonly refusal: 'architect_runtime_unknown' } {
  const raw = env[JULIUS_ARCHITECT_RUNTIME_ENV];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return { ok: true, runtime: JULIUS_ARCHITECT_RUNTIME_DEFAULT };
  return (JULIUS_ARCHITECT_RUNTIMES as readonly string[]).includes(value)
    ? { ok: true, runtime: value as JuliusArchitectRuntime }
    : { ok: false, refusal: 'architect_runtime_unknown' };
}

/**
 * THE ARCHITECT'S OWN CREDENTIAL. The only key this child ever receives, placed under the name the SDK reads
 * (`ANTHROPIC_API_KEY`) inside a child environment built from nothing. The coder's key, GITHUB_TOKEN and every other
 * secret on the host are absent by construction.
 */
export const AGENTIC_ARCHITECT_API_KEY_ENV = 'ANTHROPIC_ARCHITECT_API_KEY';

/* ------------------------------------------------------------------------------------------------ the tools */

/** The approved tools: read and search the mission workspace. Nothing else. */
export const AGENTIC_ARCHITECT_READ_TOOLS: readonly string[] = Object.freeze(['Read', 'Grep', 'Glob']);
/**
 * The SDK's own answer carrier for `outputFormat: json_schema`. It has no effect outside the session: calling it IS
 * the architect handing back its structured plan. Allowed so the schema-constrained answer can arrive; nothing else
 * is allowed beside the read tools.
 */
export const AGENTIC_ARCHITECT_ANSWER_TOOL = 'StructuredOutput';
export const AGENTIC_ARCHITECT_ALLOWED_TOOLS: readonly string[] = Object.freeze([...AGENTIC_ARCHITECT_READ_TOOLS, AGENTIC_ARCHITECT_ANSWER_TOOL]);
/**
 * Named refusals, for the SDK's own removal from context. The hook below is the authority and denies EVERYTHING not
 * on the allow list whether or not it is named here; this list only stops the model from being offered them.
 */
export const AGENTIC_ARCHITECT_DISALLOWED_TOOLS: readonly string[] = Object.freeze([...new Set([
  ...HOSTED_DISALLOWED_TOOLS,
  'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'BashOutput', 'KillShell', 'WebFetch', 'WebSearch',
  'Task', 'Agent', 'Skill', 'SlashCommand', 'TodoWrite', 'ExitPlanMode', 'LS', 'NotebookRead',
])]);

/** Why the authority refused a tool that is not approved for this role. Shown to the model, so it says what to do. */
const NOT_GRANTED = 'architect_tool_not_granted: The Agentic Architect may only Read, Grep and Glob inside the mission workspace. It may not edit, write, run commands or reach the network; plan from what you can read.';

/**
 * JULIUS'S AUTHORITY OVER EVERY TOOL THE ARCHITECT CALLS: default deny.
 *
 * A `PreToolUse` hook runs before deny rules, the permission mode and the allow list, and its deny holds in every mode
 * (see `hosted-tool-authority.ts`). A tool off the allow list is refused here whatever the SDK offered. An allowed READ
 * tool is then handed to the Coding Agent's own workspace authority, which confines it to the workspace by real path
 * and refuses `..`, a home-relative root and a glob that climbs out.
 */
export function agenticArchitectToolAuthority(input: {
  readonly workspacePath: string;
  readonly signal?: AbortSignal;
  readonly fs?: HostedToolFs;
  /** Every refusal, by tool name only. */
  readonly onDeny?: (tool: string) => void;
}): (hookInput: unknown, toolUseId?: string, options?: { readonly signal?: AbortSignal }) => Promise<HostedHookOutput> {
  // No file-creation grant, ever: the architect creates nothing.
  const confine = juliusHostedToolAuthority({
    workspacePath: input.workspacePath,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.fs === undefined ? {} : { fs: input.fs }),
    fileCreation: null,
  });
  return async (hookInput, toolUseId, options) => {
    const payload = (hookInput !== null && typeof hookInput === 'object' ? hookInput : {}) as Record<string, unknown>;
    const tool = typeof payload.tool_name === 'string' ? payload.tool_name : '';
    if (tool === AGENTIC_ARCHITECT_ANSWER_TOOL) return {};
    if (!AGENTIC_ARCHITECT_READ_TOOLS.includes(tool)) {
      input.onDeny?.(tool);
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: NOT_GRANTED } };
    }
    const decision = await confine(hookInput, toolUseId, options);
    if ('hookSpecificOutput' in decision) input.onDeny?.(tool);
    return decision;
  };
}

/* ------------------------------------------------------------------------------------------------ the env */

/**
 * THE ARCHITECT CHILD'S ENVIRONMENT: the Coding Agent's builder, API mode, the ARCHITECT's key. Built from `{}` so
 * nothing on the host reaches it but PATH, HOME, the terminal markers, the model pins, `CLAUDE_CODE_NO_MODEL_FALLBACK=1`,
 * `CLAUDE_CODE_MAX_RETRIES=0` and this one key. There is no subscription mode for the architect.
 */
export function agenticArchitectChildEnv(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly path?: string;
  readonly home?: string;
}): Record<string, string> {
  return hostedChildEnv({
    apiKey: input.apiKey,
    model: input.model,
    mode: 'ANTHROPIC_API',
    ...(input.path === undefined ? {} : { path: input.path }),
    ...(input.home === undefined ? {} : { home: input.home }),
  });
}

/* ------------------------------------------------------------------------------------------------ the bounds */

export interface AgenticArchitectLimits {
  readonly maxTurns: number;
  /** The runtime's own stop and the post-hoc ceiling, in whole US cents. */
  readonly maxCostCents: number;
  readonly maxRuntimeMs: number;
}

/**
 * THE BOUNDS FOR A DISPATCH NOBODY BUDGETED: the same conservative 50¢ floor the coder keeps, and a turn bound sized
 * for reading a workspace and answering once. With an allocation, the allocation is the money bound.
 */
export const AGENTIC_ARCHITECT_DEFAULT_MAX_TURNS = 16;
export const AGENTIC_ARCHITECT_DEFAULT_MAX_COST_CENTS = 50;

/** The allocation Julius reserved, rounded DOWN to whole cents so the runtime never admits more than the reservation. */
export function agenticArchitectCentsFor(usdMicros: number): number {
  if (!Number.isFinite(usdMicros) || usdMicros < 0) throw new Error('architect_allocation_invalid');
  return Math.floor(usdMicros / 10_000);
}

/** A reported figure in micro-dollars, or null. Unknown is never 0. */
const microsOf = (observation: HostedObservation): number | null => {
  const figure = observation.usage.totalCostUsd;
  return observation.usage.source === 'runtime_reported' && typeof figure === 'number' && Number.isFinite(figure) && figure >= 0
    ? Math.round(figure * 1_000_000)
    : null;
};

/* ------------------------------------------------------------------------------------------------ one session */

/** What the slot hands this runtime: the same four things it hands the Messages runner, minus the key and config. */
export interface AgenticArchitectSlotRequest {
  readonly instructions: string;
  readonly input: string;
  readonly schema?: { readonly name: string; readonly schema: Record<string, unknown> };
  readonly signal?: AbortSignal;
}

/** One call, as the architect slot's `run` sees it. The key and the config are this runtime's, not the request's. */
export type AgenticArchitectSlotRun = (request: AgenticArchitectSlotRequest) => Promise<GptRunOutcome>;

const TOOL_NOTE = 'TOOLS: you may use Read, Grep and Glob to inspect the mission workspace (your working directory) before you answer. You cannot change, create or run anything, and you have no network. Give your answer only through the structured output.';

/** The SDK options for one architect session, as a pure value, so the envelope is checkable without a session. */
export function agenticArchitectSdkOptions(input: {
  readonly workspacePath: string;
  readonly requestedModel: string;
  readonly instructions: string;
  readonly schema?: { readonly name: string; readonly schema: Record<string, unknown> };
  readonly limits: AgenticArchitectLimits;
  readonly env: Record<string, string>;
  readonly abortController: AbortController;
  readonly hook: (hookInput: unknown, toolUseId?: string, options?: { readonly signal?: AbortSignal }) => Promise<HostedHookOutput>;
}): Record<string, unknown> {
  return {
    cwd: input.workspacePath,
    model: input.requestedModel,
    // The base set of built-in tools the session even has, then the approvals, then the named refusals.
    tools: [...AGENTIC_ARCHITECT_READ_TOOLS],
    allowedTools: [...AGENTIC_ARCHITECT_ALLOWED_TOOLS],
    disallowedTools: [...AGENTIC_ARCHITECT_DISALLOWED_TOOLS],
    // Anything not pre-approved is denied without a prompt; a hosted session has no one to ask.
    permissionMode: 'dontAsk',
    maxTurns: input.limits.maxTurns,
    // The runtime stops itself at the ceiling Julius reserved (`error_max_budget_usd`).
    maxBudgetUsd: input.limits.maxCostCents / 100,
    // No settings file, hook, plugin, MCP server or persisted session on the host can widen this.
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: {},
    persistSession: false,
    includePartialMessages: false,
    systemPrompt: `${input.instructions}\n\n${TOOL_NOTE}`,
    env: input.env,
    abortController: input.abortController,
    hooks: { PreToolUse: [{ hooks: [input.hook] }] },
    ...(input.schema === undefined ? {} : { outputFormat: { type: 'json_schema', schema: input.schema.schema } }),
  };
}

/** The SDK's own `SDKAssistantMessageError` members this runtime reads, by membership only. */
const ASSISTANT_ERRORS = new Set([
  'authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'verification_required', 'billing_error',
  'rate_limit', 'overloaded', 'invalid_request', 'model_not_found', 'server_error', 'unknown', 'max_output_tokens',
  'cloud_credential_error',
]);

/** The structured error the CLI wrote for a failed API call, and whether any model turn came before it. */
interface StructuredError { readonly error: string; readonly beforeAnyTurn: boolean }

export type AgenticArchitectCall =
  | {
    readonly kind: 'answered';
    readonly outcome: Extract<GptRunOutcome, { ok: true }>;
    readonly observation: HostedObservation;
    readonly costUsdMicros: number | null;
  }
  | {
    readonly kind: 'failed';
    readonly error: JuliusDispatchError;
    /** Whether a session ran that may have been billed. False only on positive evidence nothing was processed. */
    readonly ran: boolean;
    readonly costUsdMicros: number | null;
  };

/** Facts every ending carries. Allowlisted names only (`safeReviewDiagnostics`). */
const sessionFacts = (observation: HostedObservation, requestedModel: string, limits: AgenticArchitectLimits): Record<string, unknown> => {
  const served = hostedServedModel(observation);
  return {
    transport: 'hosted', provider: 'anthropic', requestedModel,
    servedModel: served.servedModel, servedModelBasis: served.basis,
    announcedModel: observation.actualModel,
    numTurns: observation.numTurns, toolUseCount: observation.toolInvocations, permissionDenials: observation.permissionDenials,
    resultSubtype: observation.resultSubtype, isError: observation.isError, terminalReason: observation.terminalReason,
    inputTokens: observation.usage.inputTokens, outputTokens: observation.usage.outputTokens,
    costCeilingUsdMicros: limits.maxCostCents * 10_000,
    ...(typeof observation.anthropicRequestId === 'string' ? { providerRequestId: observation.anthropicRequestId, providerRequestAvailability: 'CAPTURED' } : {}),
  };
};

/** A structured or classified reason, as the hosted vocabulary names it. */
function reasonFor(structured: StructuredError | null, text: string | null): HostedFailureReason {
  switch (structured?.error) {
    case 'rate_limit': return 'rate_limited';
    case 'billing_error': return 'credit_unavailable';
    case 'authentication_failed': case 'oauth_org_not_allowed': case 'account_on_hold': case 'verification_required': case 'cloud_credential_error':
      return 'provider_auth_rejected';
    case 'overloaded': return 'provider_overloaded';
    case 'server_error': return 'provider_server_error';
    case 'invalid_request': case 'model_not_found': return 'provider_bad_request';
    default: return classifyHostedFailure(text);
  }
}

/**
 * THE #479 RULES, FOR THE ARCHITECT.
 *
 * - A RATE LIMIT is retryable ONLY with positive evidence nothing was processed: the CLI's own structured
 *   `rate_limit` error on the session's FIRST API request (no model turn before it; `CLAUDE_CODE_MAX_RETRIES=0`, so
 *   that request was the only one). It then carries `runtimeStarted: false`, and the coordinator retries it once. A
 *   rate limit after any turn, or one recognised only from prose, carries `runtimeStarted: true` and the coordinator
 *   makes it HANDED_FAILURE_OUTCOME_UNKNOWN.
 * - A TIMEOUT is retryable as a class only; after the handoff the coordinator never retries it.
 * - Credit too low, a rejected key and a bad request are NEVER retryable.
 * - Anything unrecognised after the session started is not retryable: an unknown is not a reason to spend again.
 */
function failureFor(input: {
  readonly reason: HostedFailureReason;
  readonly structured: StructuredError | null;
  readonly initSeen: boolean;
}): { readonly code: JuliusErrorCode; readonly retryable: boolean; readonly failureClass: string; readonly message: string; readonly processed: boolean } {
  if (input.structured?.error === 'rate_limit') {
    return input.structured.beforeAnyTurn
      ? { code: 'RATE_LIMIT', retryable: true, failureClass: 'architect_rate_limited', message: 'The Agentic Architect was rate limited on its first request; nothing was processed.', processed: false }
      : { code: 'RATE_LIMIT', retryable: true, failureClass: 'architect_rate_limited', message: 'The Agentic Architect was rate limited part-way through its session.', processed: true };
  }
  switch (input.reason) {
    case 'credit_unavailable':
    case 'usage_limit_reached':
      return { code: 'PROVIDER_UNAVAILABLE', retryable: false, failureClass: 'architect_credit_unavailable', message: 'The Agentic Architect account cannot pay for the call.', processed: input.initSeen };
    case 'provider_auth_rejected':
      return { code: 'AUTH_CONFIGURATION', retryable: false, failureClass: 'architect_auth_rejected', message: 'The Agentic Architect credential was rejected.', processed: input.initSeen };
    case 'provider_bad_request':
    case 'context_length_exceeded':
    case 'content_filtered':
      return { code: 'INVALID_REQUEST', retryable: false, failureClass: 'architect_request_refused', message: 'The Agentic Architect provider declined this request.', processed: input.initSeen };
    case 'provider_overloaded':
    case 'provider_server_error':
    case 'stream_interrupted':
      // Retryable as a CLASS; after the handoff this is HANDED_FAILURE_OUTCOME_UNKNOWN.
      return { code: 'PROVIDER_UNAVAILABLE', retryable: true, failureClass: 'architect_provider_unavailable', message: 'The Agentic Architect provider was unavailable.', processed: true };
    default:
      return input.initSeen
        ? { code: 'WORKER_EXECUTION_FAILURE', retryable: false, failureClass: 'architect_provider_error_after_init', message: 'The Agentic Architect stopped part-way through its session.', processed: true }
        : { code: 'AUTH_CONFIGURATION', retryable: false, failureClass: 'architect_launch_failed', message: 'The Agentic Architect runtime could not launch.', processed: false };
  }
}

/** Run ONE architect session, bounded, and report what it observed. It never throws for a provider failure. */
export async function runAgenticArchitect(input: {
  readonly queryFn: HostedQueryFn;
  readonly request: AgenticArchitectSlotRequest;
  readonly apiKey: string;
  readonly requestedModel: string;
  readonly workspacePath: string;
  readonly limits: AgenticArchitectLimits;
  readonly host?: { readonly path?: string; readonly home?: string };
  readonly fs?: HostedToolFs;
}): Promise<AgenticArchitectCall> {
  const { limits, requestedModel } = input;
  const fail = (code: JuliusErrorCode, retryable: boolean, failureClass: string, message: string, observation: HostedObservation, ran: boolean, extra: Record<string, unknown> = {}): AgenticArchitectCall => {
    const costUsdMicros = microsOf(observation);
    return {
      kind: 'failed', ran, costUsdMicros,
      error: new JuliusDispatchError(code, retryable, message, failureClass, {
        ...sessionFacts(observation, requestedModel, limits), ...extra,
        runtimeStarted: ran,
        ...(costUsdMicros === null ? {} : { costUsdMicros }),
        costBasis: costUsdMicros === null ? 'UNKNOWN' : 'PROVIDER_REPORTED',
        billingPath: 'API_BILLED',
      }),
    };
  };
  if (input.request.signal?.aborted === true) {
    return fail('CANCELLED', false, 'architect_cancelled_before_launch', 'The dispatch was cancelled before the Agentic Architect launched.', emptyObservation(), false);
  }
  const controller = new AbortController();
  let cancelled = false;
  let timedOut = false;
  const onAbort = (): void => { cancelled = true; controller.abort(); };
  input.request.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limits.maxRuntimeMs);
  const hook = agenticArchitectToolAuthority({
    workspacePath: input.workspacePath, signal: controller.signal, ...(input.fs === undefined ? {} : { fs: input.fs }),
  });
  let observation = emptyObservation();
  let structured: StructuredError | null = null;
  let structuredOutput: unknown;
  let turnsSeen = 0;
  let thrown: string | null = null;
  let threw = false;
  try {
    const stream = input.queryFn({
      prompt: input.request.input,
      options: agenticArchitectSdkOptions({
        workspacePath: input.workspacePath, requestedModel, instructions: input.request.instructions,
        ...(input.request.schema === undefined ? {} : { schema: input.request.schema }),
        limits, abortController: controller, hook,
        env: agenticArchitectChildEnv({ apiKey: input.apiKey, model: requestedModel, path: input.host?.path, home: input.host?.home }),
      }),
    });
    for await (const message of stream) {
      if (message !== null && typeof message === 'object') {
        const m = message as Record<string, unknown>;
        if (m.type === 'assistant' && (m.parent_tool_use_id === null || m.parent_tool_use_id === undefined)) {
          if (structured === null && typeof m.error === 'string') {
            structured = { error: ASSISTANT_ERRORS.has(m.error) ? m.error : 'unknown', beforeAnyTurn: turnsSeen === 0 };
          }
          turnsSeen += 1;
        }
        if (m.type === 'result' && 'structured_output' in m) structuredOutput = m.structured_output;
      }
      observation = foldHostedMessage(observation, message);
    }
  } catch (error) {
    threw = true;
    // Matched against a closed table and dropped; no character of it is kept.
    thrown = error instanceof Error ? error.message : typeof error === 'string' ? error : null;
  } finally {
    clearTimeout(timer);
    input.request.signal?.removeEventListener('abort', onAbort);
  }

  const ran = observation.initSeen;
  if (cancelled) return fail('CANCELLED', false, 'architect_cancelled', 'The Agentic Architect was cancelled.', observation, ran);
  if (timedOut) return fail('TIMEOUT', true, 'architect_timed_out', 'The Agentic Architect exceeded its runtime bound.', observation, ran, { timedOut: true, timeoutMs: limits.maxRuntimeMs });
  // The runtime stopped itself at Julius's ceiling: a cost refusal, whichever way the stream ended.
  if (observation.resultSubtype === 'error_max_budget_usd') {
    return fail('WORKER_EXECUTION_FAILURE', false, 'architect_cost_exceeded', `The Agentic Architect stopped at its ${limits.maxCostCents}¢ ceiling.`, observation, true);
  }
  const usable = hostedStreamIsUsable(observation);
  if (threw || structured !== null || !usable.ok) {
    const reason = reasonFor(structured, thrown ?? observation.finalText);
    // A prose-only rate limit is not evidence; it is read as an unrecognised failure, never as `runtimeStarted: false`.
    const failure = failureFor({ reason: structured === null && reason === 'rate_limited' ? 'unclassified' : reason, structured, initSeen: ran });
    if (!threw && structured === null && usable.ok === false && failure.failureClass === 'architect_provider_error_after_init') {
      return fail('WORKER_EXECUTION_FAILURE', false, 'architect_result_untrusted', 'The Agentic Architect session ended without a result that can be trusted.', observation, ran, { failureReason: reason });
    }
    return fail(failure.code, failure.retryable, failure.failureClass, failure.message, observation, failure.processed, { failureReason: reason });
  }
  // CONTAINMENT: the runtime's own account of what it granted. Any tool beyond the allow list, or another cwd, refuses.
  const extra = observation.reportedTools.filter((tool) => !AGENTIC_ARCHITECT_ALLOWED_TOOLS.includes(tool));
  if (extra.length > 0 || observation.reportedCwd !== input.workspacePath) {
    return fail('WORKER_EXECUTION_FAILURE', false, 'architect_envelope_not_honoured', 'The Agentic Architect runtime did not honour the read-only envelope.', observation, true);
  }
  const costUsdMicros = microsOf(observation);
  if (costUsdMicros !== null && costUsdMicros > limits.maxCostCents * 10_000) {
    return fail('WORKER_EXECUTION_FAILURE', false, 'architect_cost_exceeded', `The Agentic Architect reported more than its ${limits.maxCostCents}¢ ceiling.`, observation, true);
  }
  // THE MODEL THAT ANSWERED IS THE ONE ASKED FOR, OR THE RUN STOPS — the coder's attestation, the architect's halt classes.
  const served = hostedServedModel(observation);
  const verdict = hostedServedModelVerdict(served, requestedModel);
  if (verdict !== 'MATCH') {
    return verdict === 'MISMATCH'
      ? fail('WORKER_EXECUTION_FAILURE', false, 'architect_served_model_mismatch', 'The Agentic Architect was answered by a model other than the one requested.', observation, true)
      : fail('WORKER_EXECUTION_FAILURE', false, 'architect_served_model_unattested', 'The Agentic Architect finished without attesting which model answered.', observation, true);
  }
  const outputText = structuredOutput !== undefined && structuredOutput !== null && typeof structuredOutput === 'object'
    ? JSON.stringify(structuredOutput)
    : observation.finalText ?? '';
  const input_ = observation.usage.inputTokens;
  const output_ = observation.usage.outputTokens;
  return {
    kind: 'answered', observation, costUsdMicros,
    outcome: {
      ok: true,
      actualModel: served.servedModel as string,
      // The Anthropic request id when the stream carried one; a session id is not a response id.
      responseId: observation.anthropicRequestId ?? observation.anthropicMessageId ?? 'unreported',
      status: 'completed',
      outputText,
      usage: {
        inputTokens: input_, cachedInputTokens: null, outputTokens: output_, reasoningTokens: null,
        totalTokens: input_ === null || output_ === null ? null : input_ + output_,
      },
    },
  };
}

/* ------------------------------------------------------------------------------------------------ the slot */

/**
 * THE ARCHITECT SLOT, ANSWERED BY THE SDK.
 *
 * `slot` is the EXISTING architect adapter, built by the composition with the `run` this function hands it — so the
 * charter, the schema, the validator, the correction and the contract proposal are exactly the slot's. Per dispatch:
 *   1. The ALLOCATION Julius reserved (julius-allocation) becomes the runtime's `maxBudgetUsd` and the post-hoc
 *      ceiling; below one cent nothing launches. No allocation keeps the 50¢ floor.
 *   2. Each SDK session's reported `total_cost_usd` is recorded. A correction call is bounded by what is left, and
 *      refused when a prior figure is unknown (it cannot be bounded).
 *   3. The slot's result is returned with the SUM as `usdMicros` and `PROVIDER_REPORTED` — or, when any session's
 *      figure is unknown, no amount and `UNKNOWN`, so the ledger holds the reservation. Unknown is never $0.
 *   4. A failure carries the same facts, so the coordinator's `end` settles a figure it knows and holds one it does not.
 */
export function createAgentSdkArchitectAdapter(input: {
  readonly adapterId: string;
  readonly requestedModel: string;
  readonly apiKey: string;
  readonly workspacePath: string;
  readonly maxRuntimeMs: number;
  readonly maxTurns?: number;
  readonly queryLoader?: () => Promise<HostedQueryFn>;
  readonly host?: { readonly path?: string; readonly home?: string };
  readonly fs?: HostedToolFs;
  readonly slot: (run: AgenticArchitectSlotRun) => JuliusProviderAdapter;
}): JuliusProviderAdapter {
  const nonEmpty = (v: string): boolean => typeof v === 'string' && v.trim() !== '';
  if (!nonEmpty(input.requestedModel) || !nonEmpty(input.apiKey) || !nonEmpty(input.workspacePath)
    || !(Number.isFinite(input.maxRuntimeMs) && input.maxRuntimeMs > 0)) {
    throw new Error('agentic_architect_requires_live_config');
  }
  const loadQuery = input.queryLoader ?? loadHostedQuery;
  const maxTurns = input.maxTurns ?? AGENTIC_ARCHITECT_DEFAULT_MAX_TURNS;
  return {
    adapterId: input.adapterId,
    async dispatch(dispatch: JuliusDispatchInput): Promise<JuliusProviderResult> {
      const ceilingCents = dispatch.allocation === undefined
        ? AGENTIC_ARCHITECT_DEFAULT_MAX_COST_CENTS
        : agenticArchitectCentsFor(dispatch.allocation.usdMicros);
      if (ceilingCents < 1) {
        throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false,
          'The remaining mission budget is below one cent; the Agentic Architect was not dispatched.', 'architect_allocation_below_one_cent',
          { transport: 'hosted', provider: 'anthropic', runtimeStarted: false, costCeilingUsdMicros: dispatch.allocation?.usdMicros ?? null });
      }
      /** One entry per session that RAN: its figure, or null when it reported none. */
      const spent: (number | null)[] = [];
      let queryFn: HostedQueryFn | null = null;
      const run: AgenticArchitectSlotRun = async (request) => {
        const known = spent.every((value): boolean => value !== null);
        if (!known) {
          throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false,
            'A prior Agentic Architect session reported no cost, so a further session cannot be bounded.', 'architect_correction_unbounded', { runtimeStarted: true });
        }
        const usedCents = Math.ceil((spent as number[]).reduce((a, b) => a + b, 0) / 10_000);
        const remainingCents = ceilingCents - usedCents;
        if (remainingCents < 1) {
          throw new JuliusDispatchError('WORKER_EXECUTION_FAILURE', false,
            'The Agentic Architect allocation is spent; no further session is bought.', 'architect_allocation_exhausted', { runtimeStarted: spent.length > 0 });
        }
        if (queryFn === null) {
          try { queryFn = await loadQuery(); } catch {
            throw new JuliusDispatchError('AUTH_CONFIGURATION', false, 'The Claude Agent SDK runtime is not installed.', 'architect_runtime_not_installed', { runtimeStarted: false });
          }
        }
        const call = await runAgenticArchitect({
          queryFn, apiKey: input.apiKey, requestedModel: input.requestedModel, workspacePath: input.workspacePath,
          limits: { maxTurns, maxCostCents: remainingCents, maxRuntimeMs: input.maxRuntimeMs },
          request: {
            instructions: request.instructions, input: request.input,
            ...(request.schema === undefined ? {} : { schema: request.schema }),
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
          ...(input.host === undefined ? {} : { host: input.host }),
          ...(input.fs === undefined ? {} : { fs: input.fs }),
        });
        if (call.kind === 'answered') { spent.push(call.costUsdMicros); return call.outcome; }
        if (call.ran) spent.push(call.costUsdMicros);
        throw call.error;
      };
      const cost = (): { readonly usdMicros: number | null; readonly costBasis: 'PROVIDER_REPORTED' | 'UNKNOWN' } => {
        const all = spent.length > 0 && spent.every((value): boolean => value !== null);
        return all
          ? { usdMicros: (spent as number[]).reduce((a, b) => a + b, 0), costBasis: 'PROVIDER_REPORTED' }
          : { usdMicros: null, costBasis: 'UNKNOWN' };
      };
      let result: JuliusProviderResult;
      try {
        result = await input.slot(run).dispatch(dispatch);
      } catch (error) {
        if (!(error instanceof JuliusDispatchError)) throw error;
        const facts = cost();
        const ranAny = spent.length > 0;
        throw new JuliusDispatchError(error.code, error.retryable, error.safeMessage, error.failureClass, {
          ...(error.diagnostics ?? {}),
          transport: 'hosted', provider: 'anthropic', billingPath: 'API_BILLED',
          // A session that ran was billed, whatever the last error says; nothing ran keeps the error's own word.
          ...(ranAny ? { runtimeStarted: true, costBasis: facts.costBasis } : {}),
          ...(ranAny && facts.usdMicros !== null ? { costUsdMicros: facts.usdMicros } : {}),
        }, error.implementation);
      }
      const facts = cost();
      const usage = (result.usage !== null && typeof result.usage === 'object' ? result.usage : {}) as Record<string, unknown>;
      const diagnostics = (result.diagnostics !== null && typeof result.diagnostics === 'object' ? result.diagnostics : {}) as Record<string, unknown>;
      const { usdMicros: _ignored, ...usageWithoutAmount } = usage;
      return {
        ...result,
        diagnostics: {
          ...diagnostics,
          transport: 'hosted', provider: 'anthropic', costBasis: facts.costBasis, billingPath: 'API_BILLED',
          ...(facts.usdMicros === null ? {} : { costUsdMicros: facts.usdMicros }),
          costCeilingUsdMicros: ceilingCents * 10_000,
        },
        usage: {
          ...usageWithoutAmount,
          costBasis: facts.costBasis,
          billingPath: 'API_BILLED',
          ...(facts.usdMicros === null ? {} : { usdMicros: facts.usdMicros }),
        },
      };
    },
  };
}
