import {
  compileHostedEnvelope, hostedChildEnv, verifyGrantedEnvelope,
  withinCostCeiling, DEFAULT_HOSTED_LIMITS,
  type HostedEnvelope, type HostedLimits,
} from './hosted-envelope';
import {
  emptyObservation, foldHostedMessage, hostedStreamIsUsable,
  type HostedObservation,
} from './hosted-observation';
import { HOSTED_ADAPTER_ID, HOSTED_SDK_PACKAGE } from './hosted-readiness';

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
    readonly observation: HostedObservation;
    readonly envelope: HostedEnvelope;
    readonly startedAt: string;
    readonly completedAt: string;
  }
  | {
    readonly kind: 'cancelled' | 'timed_out' | 'launch_failed';
    readonly safeMessage: string;
    readonly observation: HostedObservation;
    readonly startedAt: string;
    readonly completedAt: string;
  };

export interface HostedRunInput {
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
  });
  const startedAt = input.now();

  const controller = new AbortController();
  let cancelled = false;
  let timedOut = false;
  input.onCancel?.(() => { cancelled = true; controller.abort(); });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limits.maxRuntimeMs);

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
        }),
        abortController: controller,
        ...(envelope.model !== null ? { model: envelope.model } : {}),
      },
    });

    for await (const message of stream) {
      observation = foldHostedMessage(observation, message);
    }
  } catch (error) {
    const completedAt = input.now();
    if (cancelled) {
      return { kind: 'cancelled', safeMessage: 'The hosted Coding Agent was cancelled.', observation, startedAt, completedAt };
    }
    if (timedOut) {
      return { kind: 'timed_out', safeMessage: 'The hosted Coding Agent exceeded its runtime bound.', observation, startedAt, completedAt };
    }
    // A provider error can quote the request, which can quote the credential —
    // so only a fixed sentence leaves this function.
    return {
      kind: 'launch_failed',
      safeMessage: 'The hosted Coding Agent could not complete a run.',
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

  const refuse = (safeMessage: string): HostedRunOutcome =>
    ({ kind: 'refused', safeMessage, observation, envelope, startedAt, completedAt });

  const usable = hostedStreamIsUsable(observation);
  if (!usable.ok) return refuse(`The hosted run could not be trusted: ${usable.reason}.`);

  // CONTAINMENT GATE. The envelope Relay requested is compared with the one
  // the runtime reported granting. A clean result message does not certify
  // that the run stayed inside its boundary.
  const granted = verifyGrantedEnvelope({
    envelope,
    reportedTools: observation.reportedTools,
    reportedCwd: observation.reportedCwd,
  });
  if (!granted.matches) return refuse(`The hosted runtime did not honour the requested envelope: ${granted.reason}.`);

  const cost = withinCostCeiling(observation.usage.totalCostUsd, limits);
  if (!cost.within) return refuse(cost.reason as string);

  return { kind: 'completed', observation, envelope, startedAt, completedAt };
}
