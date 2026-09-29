import { CLAUDE_SUBSCRIPTION_TOKEN_ENV, CODER_CLAUDE_EXECUTABLE_ENV, type ClaudeAuthMode } from './hosted-auth';
import {
  compileHostedEnvelope, hostedChildEnv, verifyGrantedEnvelope,
  withinCostCeiling, DEFAULT_HOSTED_LIMITS,
  type HostedEnvelope, type HostedLimits,
} from './hosted-envelope';
import {
  emptyObservation, foldHostedMessage, hostedStreamIsUsable,
  type HostedObservation,
} from './hosted-observation';
import { classifyHostedFailure, type HostedFailureReason } from './hosted-failure-reason';
import { HOSTED_ADAPTER_ID, HOSTED_SDK_PACKAGE } from './hosted-readiness';
import { juliusHostedToolAuthority } from './hosted-tool-authority';

/**
 * ONE HOSTED CODING AGENT EXECUTION.
 *
 * The Claude Agent SDK is reached through an injected `query` function rather
 * than imported at the top of this file, for two reasons that both matter.
 *
 * It is ESM and the bridge builds to CJS, so a static import cannot be bundled
 * — and it must NOT be bundled anyway: the SDK extracts a platform-native
 * executable from `node_modules` at run time, which an esbuild output file
 * cannot carry. The deployment therefore keeps the package installed and this
 * module loads it dynamically, exactly once, only when a run is authorized.
 *
 * The injection also makes the whole pipeline provable offline: the tests
 * drive a fake `query` that yields real message shapes, so containment,
 * identity and cancellation are all asserted without a paid call.
 *
 * WHAT THIS FUNCTION WILL NOT DO: it will not report a run as passed. It
 * returns what it OBSERVED — the model that answered, the tools that were
 * granted, the paths that were touched, the cost that was reported — and
 * whether the run stayed inside its envelope. Whether the resulting code is
 * correct is decided afterwards by Relay's own inspection and test run, on the
 * workspace, exactly as on the local surface.
 */

/** The shape of the SDK's `query`, narrowed to what Relay uses. */
export type HostedQueryFn = (params: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<unknown>;

/** Loads the real SDK. Called only for an authorized run. */
export async function loadHostedQuery(): Promise<HostedQueryFn> {
  // Indirected so esbuild cannot statically resolve and inline the ESM SDK;
  // the package stays external and is required to exist at run time.
  const dynamicImport = new Function('id', 'return import(id)') as (id: string) => Promise<unknown>;
  const mod = await dynamicImport(HOSTED_SDK_PACKAGE) as { query?: unknown };
  if (typeof mod.query !== 'function') {
    throw new Error('The hosted Coding Agent runtime does not expose a query function.');
  }
  return mod.query as HostedQueryFn;
}

export type HostedRunOutcome =
  | {
    readonly kind: 'completed';
    readonly observation: HostedObservation;
    readonly envelope: HostedEnvelope;
    readonly startedAt: string;
    readonly completedAt: string;
  }
  | {
    readonly kind: 'refused';
    /** Relay refused the RESULT — the process may have finished perfectly. */
    readonly safeMessage: string;
    /**
     * WHY, AS A MACHINE TOKEN.
     *
     * Paid Mission #2 recorded `coder_refused` and nothing else, which is the
     * same opacity `reviewer_review_incomplete` was — on the third worker. The
     * message that distinguishes an untrusted result from a broken envelope
     * from a cost ceiling is composed and then dropped, because the coordinator
     * persists the class and not the text. These four are the refusals this
     * runner can actually reach.
     */
    readonly refusalCode:
      | 'coder_result_untrusted'
      | 'coder_envelope_not_honoured'
      | 'coder_cost_exceeded'
      | 'coder_provider_error_after_init';
    /**
     * WHY THE PROVIDER STOPPED, AS A CLASSIFIED TOKEN.
     *
     * Set only on `coder_provider_error_after_init`, whose cause lives in a
     * thrown error this function may not repeat: a provider error can quote the
     * request, which can quote the credential. `classifyHostedFailure` MATCHES
     * that text and returns a constant of its own, so the reason travels and
     * not one character of the message does. Absent on the three refusals whose
     * cause is already the refusal code.
     */
    readonly failureReason?: HostedFailureReason | null;
    readonly observation: HostedObservation;
    readonly envelope: HostedEnvelope;
    readonly startedAt: string;
    readonly completedAt: string;
  }
  | {
    readonly kind: 'cancelled' | 'timed_out' | 'launch_failed';
    readonly safeMessage: string;
    /**
     * Set on `launch_failed` for the same reason and by the same classifier.
     * A cancellation and a timeout are Relay's own decisions and carry none:
     * the thrown abort would classify as a broken stream and say something
     * false beside `timed_out`.
     */
    readonly failureReason?: HostedFailureReason | null;
    readonly observation: HostedObservation;
    readonly startedAt: string;
    readonly completedAt: string;
  };

export interface HostedRunInput {
  /**
   * Which credential the child may use. Absent means `ANTHROPIC_API`, the mode
   * this surface has always had. `CLAUDE_SUBSCRIPTION` omits the API key so the
   * CLI authenticates from the founder's own subscription login — which
   * Anthropic's documented precedence makes an omission rather than a preference.
   */
  readonly authMode?: ClaudeAuthMode;
  readonly queryFn: HostedQueryFn;
  readonly prompt: string;
  readonly workspacePath: string;
  readonly apiKey: string;
  readonly requestedModel: string | null;
  readonly limits?: HostedLimits;
  readonly now: () => string;
  /** Lets a browser Stop abort a hosted run. */
  readonly onCancel?: (cancel: () => void) => void;
}

export const HOSTED_RUN_ADAPTER_ID = HOSTED_ADAPTER_ID;

/**
 * Run once, bounded, and report honestly.
 *
 * Cancellation and timeout share one `AbortController`: the SDK is handed the
 * signal, so a stop request reaches the child process rather than merely
 * abandoning the async iterator while the work continues.
 */
export async function runHostedCodingAgent(input: HostedRunInput): Promise<HostedRunOutcome> {
  const limits = input.limits ?? DEFAULT_HOSTED_LIMITS;
  const envelope = compileHostedEnvelope({
    workspacePath: input.workspacePath,
    requestedModel: input.requestedModel,
    // The SAME limits the abort timer and the budget stop below use. Passing
    // them is what makes `maxTurns` an operative limit rather than a field.
    limits,
  });
  const startedAt = input.now();

  const controller = new AbortController();
  let cancelled = false;
  let timedOut = false;
  input.onCancel?.(() => { cancelled = true; controller.abort(); });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limits.maxRuntimeMs);

  /**
   * JULIUS'S AUTHORITY, AS THE FIRST STEP OF EVERY TOOL CALL, ON EVERY RUN. A
   * `PreToolUse` hook runs before deny rules, the permission mode and the allow
   * list, and its deny holds in every mode; without it the allow list and
   * `acceptEdits` approve `Read` and `Edit` at ANY path the host user can reach.
   * It confines every file tool to this workspace by real path and refuses edits
   * in control, credential and workflow locations (`hosted-tool-authority.ts`).
   */
  const authority = juliusHostedToolAuthority({ workspacePath: input.workspacePath, signal: controller.signal });

  let observation = emptyObservation();
  try {
    const stream = input.queryFn({
      prompt: input.prompt,
      options: {
        cwd: envelope.cwd,
        allowedTools: [...envelope.allowedTools],
        disallowedTools: [...envelope.disallowedTools],
        permissionMode: envelope.permissionMode,
        maxTurns: envelope.maxTurns,
        // THE RUNTIME STOPS ITSELF at the ceiling Julius reserved, returning
        // `error_max_budget_usd`, instead of Relay discovering the overspend
        // after the fact. The post-hoc ceiling check below still stands, so a
        // runtime that ignores this option is refused rather than trusted.
        maxBudgetUsd: limits.maxCostCents / 100,
        // Empty: no settings file, hook or plugin on the host may widen the
        // envelope this module just compiled.
        settingSources: [...envelope.settingSources],
        includePartialMessages: envelope.includePartialMessages,
        // Built from nothing — see `hostedChildEnv`. Every other variable on
        // the host is absent from the child by construction.
        env: hostedChildEnv({
          apiKey: input.apiKey,
          path: process.env.PATH,
          home: process.env.HOME,
          // ABSENT MEANS API MODE, so every existing caller is unchanged. Under
          // CLAUDE_SUBSCRIPTION the API key is omitted entirely and the CLI
          // authenticates from the subscription — a setup-token token when one
          // is supplied, else its own stored login — which `decideClaudeAuth`
          // has already refused to allow without observing.
          ...(input.authMode === undefined ? {} : { mode: input.authMode }),
          // Passed through, never read. `hostedChildEnv` places it ONLY under
          // CLAUDE_SUBSCRIPTION; in API mode it is dropped.
          oauthToken: process.env[CLAUDE_SUBSCRIPTION_TOKEN_ENV],
        }),
        // The binary the preflight observed, when the operator named one.
        ...(process.env[CODER_CLAUDE_EXECUTABLE_ENV]
          ? { pathToClaudeCodeExecutable: process.env[CODER_CLAUDE_EXECUTABLE_ENV] }
          : {}),
        abortController: controller,
        // No matcher: every tool call reaches the authority, which answers only
        // for file tools and has no opinion on the rest.
        hooks: { PreToolUse: [{ hooks: [authority] }] },
        ...(envelope.model !== null ? { model: envelope.model } : {}),
      },
    });

    for await (const message of stream) {
      observation = foldHostedMessage(observation, message);
    }
  } catch (error) {
    const completedAt = input.now();
    /**
     * THE ONLY THING THIS FUNCTION EVER DOES WITH A PROVIDER'S ERROR TEXT.
     *
     * Paid Mission 5's coder stopped here after six of twenty-six turns, having
     * changed nothing, for $0.885661 — and the durable record could say only
     * `coder_provider_error_after_init`, which names the boundary and not the
     * cause. The cause was in this variable and was dropped on the next line.
     *
     * It is still not repeated. `classifyHostedFailure` matches the message
     * against a pattern table and returns a constant from its own closed
     * vocabulary; `message` is not captured, not interpolated and not returned,
     * so the fixed sentences below remain the only text that leaves.
     */
    const failureReason = classifyHostedFailure(
      error instanceof Error ? error.message : typeof error === 'string' ? error : null,
    );
    if (cancelled) {
      return { kind: 'cancelled', safeMessage: 'The hosted Coding Agent was cancelled.', observation, startedAt, completedAt };
    }
    if (timedOut) {
      return { kind: 'timed_out', safeMessage: 'The hosted Coding Agent exceeded its runtime bound.', observation, startedAt, completedAt };
    }
    /**
     * A THROW AFTER THE RUNTIME STARTED IS NOT A FAILURE TO START.
     *
     * `initSeen` is the runtime's own init message, so it is direct evidence
     * that the agent launched. A provider error, a rate limit or a dropped
     * stream eight turns in — the ordinary failure mode of a long agent run —
     * was returning `launch_failed`, which the seam documents as "nothing ran,
     * so there is no output to distrust and nothing in the workspace to
     * inspect". Turns had been billed and the workspace really had been edited.
     *
     * A `refused` result makes the ATTESTATION honest about having launched.
     * It does NOT make the workspace inspectable: the coding leg returns at its
     * structural gate, before inspection, and removes the fixture root on the
     * way out. An earlier version of this comment claimed it did. What the
     * change buys is a record that no longer names the model that answered
     * while asserting the runtime never started.
     *
     * A provider error can quote the request, which can quote the credential —
     * so only a fixed sentence leaves this function either way.
     */
    if (observation.initSeen) {
      /**
       * THE RUNTIME'S OWN TERMINAL RESULT OUTRANKS THE ERROR THAT FOLLOWED IT.
       *
       * Paid run 34739303313: the runtime emitted its result message with
       * subtype `error_max_budget_usd` — it had stopped itself at the ceiling
       * Julius handed it — and the SDK then threw. This path used to report
       * `coder_provider_error_after_init`, classified `execution_error`, so the
       * durable record blamed the provider for Julius's own spend ceiling and
       * hid the one fact that mattered: the coder had been granted too little.
       *
       * The non-throwing path below already refuses this subtype as
       * `coder_cost_exceeded`. The same fact must produce the same refusal
       * whichever way the stream ended, and the observation already holds it.
       * Only the budget stop is read this way: it is the runtime's statement
       * about Julius's ceiling, not about the provider, so there is no error
       * text to classify and nothing a provider wrote reaches the record.
       */
      if (observation.resultSubtype === 'error_max_budget_usd') {
        return {
          kind: 'refused',
          refusalCode: 'coder_cost_exceeded',
          safeMessage: `The hosted runtime stopped at its ${limits.maxCostCents}¢ budget ceiling.`,
          observation, envelope, startedAt, completedAt,
        };
      }
      return {
        kind: 'refused',
        // The runtime started and then failed: its own error, after init.
        refusalCode: 'coder_provider_error_after_init',
        safeMessage: 'The hosted Coding Agent stopped part-way through its run',
        failureReason,
        observation, envelope, startedAt, completedAt,
      };
    }
    return {
      kind: 'launch_failed',
      safeMessage: 'The hosted Coding Agent could not complete a run.',
      failureReason,
      observation, startedAt, completedAt,
    };
  } finally {
    clearTimeout(timer);
  }

  const completedAt = input.now();
  if (cancelled) {
    return { kind: 'cancelled', safeMessage: 'The hosted Coding Agent was cancelled.', observation, startedAt, completedAt };
  }
  if (timedOut) {
    return { kind: 'timed_out', safeMessage: 'The hosted Coding Agent exceeded its runtime bound.', observation, startedAt, completedAt };
  }

  const refuse = (
    refusalCode: Extract<HostedRunOutcome, { kind: 'refused' }>['refusalCode'],
    safeMessage: string,
  ): HostedRunOutcome =>
    ({ kind: 'refused', refusalCode, safeMessage, observation, envelope, startedAt, completedAt });

  // A BUDGET STOP IS A COST REFUSAL, NOT AN UNTRUSTED RESULT. The runtime
  // reports it as an error subtype, which the usability gate would otherwise
  // file under "could not be trusted" and hide the one fact that matters.
  if (observation.resultSubtype === 'error_max_budget_usd') {
    return refuse('coder_cost_exceeded', `The hosted runtime stopped at its ${limits.maxCostCents}¢ budget ceiling.`);
  }
  const usable = hostedStreamIsUsable(observation);
  if (!usable.ok) return refuse('coder_result_untrusted', `The hosted run could not be trusted: ${usable.reason}.`);

  // CONTAINMENT GATE. The envelope Relay requested is compared with the one
  // the runtime reported granting. A clean result message does not certify
  // that the run stayed inside its boundary.
  const granted = verifyGrantedEnvelope({
    envelope,
    reportedTools: observation.reportedTools,
    reportedCwd: observation.reportedCwd,
  });
  if (!granted.matches) return refuse('coder_envelope_not_honoured', `The hosted runtime did not honour the requested envelope: ${granted.reason}.`);

  const cost = withinCostCeiling(observation.usage.totalCostUsd, limits);
  if (!cost.within) return refuse('coder_cost_exceeded', cost.reason as string);

  return { kind: 'completed', observation, envelope, startedAt, completedAt };
}
