/**
 * DETERMINISTIC CODING AGENT PROVIDERS, FOR PROOFS THAT MUST NOT SPEND.
 *
 * Julius's claim is that the Coding Agent is a role, not a provider: swapping
 * Claude Code for Codex or anything else changes transport and execution and
 * nothing about task ownership, authority, review, findings, guidance or
 * completion. That claim is only as good as its proof, and the proof cannot
 * call a paid provider. So these are shaped like real ones — each speaks its
 * own native vocabulary and translates it at the port, exactly as a real
 * implementation must — and contact nothing.
 *
 * NOT COMPOSED BY THE LIVE ROOT. Nothing on the live path imports this file;
 * it exists for tests and is excluded from the harness manifest by name.
 */

import type {
  JuliusCodingAgentFailure,
  JuliusCodingAgentProvider,
  JuliusCodingAgentProviderOutcome,
  JuliusCodingAgentRequest,
} from '../../src/relay/mission/julius/julius-coding-agent';
import type { ShellEffectInput, ShellEffectPort, ShellEffectResult } from './executor-effects';

/* --------------------------------------------------------- generic scripted */

/** One scripted turn of a generic Coding Agent. */
export type ScriptedCodingAgentStep =
  | { readonly kind: 'completed'; readonly finalText?: string | null; readonly costUsdMicros?: number | null }
  /**
   * A LONG SESSION THAT HONOURS ITS SIGNAL: it runs until aborted, then stops
   * and reports the cancellation, as a cooperative provider must. `started` is
   * called once the session is under way, so a proof can abort mid-flight.
   */
  | { readonly kind: 'runUntilAborted'; readonly started?: () => void; readonly costUsdMicros?: number | null }
  | {
    readonly kind: 'failed';
    readonly failure: JuliusCodingAgentFailure;
    readonly runtimeStarted?: boolean;
    readonly costUsdMicros?: number | null;
  };

export interface RecordingCodingAgentProvider extends JuliusCodingAgentProvider {
  /** Every governed request the provider was handed, in order. */
  readonly requests: JuliusCodingAgentRequest[];
}

/** A fixture provider handed an already-aborted signal launches nothing, as a real one must not. */
const cancelledBeforeLaunch = (): JuliusCodingAgentProviderOutcome => ({
  kind: 'failed', failure: 'CANCELLED', runtimeStarted: false, costUsdMicros: null,
  safeMessage: 'The dispatch was cancelled before the coding provider launched.',
  providerFailureClass: 'fixture_cancelled_before_launch', diagnostics: {},
});

/** The plainest possible implementation of the port: a script, and a record of what it was shown. */
export function createScriptedCodingAgentProvider(input: {
  readonly providerKind?: string;
  readonly script: readonly ScriptedCodingAgentStep[];
}): RecordingCodingAgentProvider {
  const requests: JuliusCodingAgentRequest[] = [];
  let index = 0;
  return {
    providerKind: input.providerKind ?? 'generic-scripted',
    requests,
    async execute(request, signal): Promise<JuliusCodingAgentProviderOutcome> {
      requests.push(request);
      const step = input.script[Math.min(index, input.script.length - 1)] ?? { kind: 'completed' as const };
      index += 1;
      if (signal?.aborted === true) return cancelledBeforeLaunch();
      if (step.kind === 'runUntilAborted') {
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve(), { once: true });
          step.started?.();
        });
        return {
          kind: 'failed', failure: 'CANCELLED', runtimeStarted: true, costUsdMicros: step.costUsdMicros ?? null,
          safeMessage: 'The scripted coding provider stopped when its dispatch was cancelled.',
          providerFailureClass: 'fixture_cancelled', diagnostics: {},
        };
      }
      if (step.kind === 'failed') {
        return {
          kind: 'failed', failure: step.failure, runtimeStarted: step.runtimeStarted ?? true,
          costUsdMicros: step.costUsdMicros ?? null, safeMessage: 'The scripted coding provider failed.',
          providerFailureClass: null, diagnostics: {},
        };
      }
      return {
        kind: 'completed',
        finalText: step.finalText ?? 'Implemented.',
        observation: {
          providerModel: 'scripted-model', turns: 2, toolInvocations: 4, inputTokens: 300, outputTokens: 120,
          costUsdMicros: step.costUsdMicros ?? 15_000, costBasis: step.costUsdMicros === null ? 'UNKNOWN' : 'PROVIDER_REPORTED',
          diagnostics: {},
        },
      };
    },
  };
}

/* --------------------------------------------------------------- codex-shaped */

/**
 * A response in the vocabulary a Codex-style task API speaks: a status, a text
 * output, snake_case usage, and a typed error code. NOT the Claude Agent SDK's
 * vocabulary — which is the point: the translation to the port happens here.
 */
export interface CodexShapedResponse {
  readonly status: 'completed' | 'failed' | 'incomplete' | 'cancelled';
  readonly output_text?: string | null;
  readonly model?: string;
  readonly usage?: { readonly input_tokens: number; readonly output_tokens: number; readonly cost_usd?: number | null };
  readonly error?: { readonly code: string } | null;
  readonly incomplete_details?: { readonly reason: string } | null;
}

/** How a Codex-shaped error code reads as a Julius failure. Its own table; nothing shared with the hosted runner. */
export function codexErrorAsFailure(response: CodexShapedResponse): JuliusCodingAgentFailure {
  if (response.status === 'cancelled') return 'CANCELLED';
  if (response.status === 'incomplete') {
    return response.incomplete_details?.reason === 'max_output_tokens' ? 'CONTEXT_OVERFLOW' : 'PARTIAL_RESPONSE';
  }
  switch (response.error?.code) {
    case 'rate_limit_exceeded': return 'RATE_LIMITED';
    case 'insufficient_quota': return 'CREDIT_UNAVAILABLE';
    case 'invalid_api_key': return 'AUTHENTICATION';
    case 'server_error':
    case 'service_unavailable': return 'PROVIDER_UNAVAILABLE';
    case 'context_length_exceeded': return 'CONTEXT_OVERFLOW';
    case 'timeout': return 'TIMEOUT';
    default: return 'UNCLASSIFIED';
  }
}

export function createCodexShapedCodingAgentProvider(input: {
  readonly respond: (prompt: string, request: JuliusCodingAgentRequest) => CodexShapedResponse;
  readonly renderPrompt: (request: JuliusCodingAgentRequest) => string;
}): RecordingCodingAgentProvider & { readonly prompts: string[] } {
  const requests: JuliusCodingAgentRequest[] = [];
  const prompts: string[] = [];
  return {
    providerKind: 'codex-shaped',
    requests,
    prompts,
    async execute(request, signal): Promise<JuliusCodingAgentProviderOutcome> {
      requests.push(request);
      if (signal?.aborted === true) return cancelledBeforeLaunch();
      const prompt = input.renderPrompt(request);
      prompts.push(prompt);
      const response = input.respond(prompt, request);
      if (response.status !== 'completed') {
        return {
          kind: 'failed', failure: codexErrorAsFailure(response),
          runtimeStarted: response.usage !== undefined,
          costUsdMicros: response.usage?.cost_usd === undefined || response.usage.cost_usd === null ? null : Math.round(response.usage.cost_usd * 1_000_000),
          safeMessage: 'The Codex-shaped task did not complete.',
          providerFailureClass: response.error === null || response.error === undefined ? null : `codex_${response.error.code}`,
          diagnostics: {},
        };
      }
      const cost = response.usage?.cost_usd;
      return {
        kind: 'completed',
        finalText: response.output_text ?? null,
        observation: {
          providerModel: response.model ?? null, turns: null, toolInvocations: null,
          inputTokens: response.usage?.input_tokens ?? null, outputTokens: response.usage?.output_tokens ?? null,
          costUsdMicros: cost === undefined || cost === null ? null : Math.round(cost * 1_000_000),
          costBasis: cost === undefined || cost === null ? 'UNKNOWN' : 'PROVIDER_REPORTED',
          diagnostics: {},
        },
      };
    },
  };
}

/* ---------------------------------------------------------------- the executor */

/**
 * A FAKE INDEPENDENT EXECUTOR. It answers `git rev-parse`, the diff, the status
 * and the test command from a scripted workspace, and records every invocation
 * so a proof can say exactly which effects ran — and, as importantly, which did
 * not.
 */
export function createFakeExecutorShell(input: {
  /** Tracked changes as `git diff` would print them. */
  readonly diff?: string;
  /** Porcelain v1 lines for the changed-path set, e.g. ` M src/a.ts`, `?? src/new.ts`. */
  readonly status?: readonly string[];
  /** Untracked-file content as the no-index diff would print it. */
  readonly untrackedDiff?: string;
  readonly testExitCode?: number;
  /** The change-set or diff capture fails with a non-zero exit, as a broken git would. */
  readonly statusFails?: boolean;
  readonly diffFails?: boolean;
  /** The attempt's start snapshot fails, so the trees are missing even where the change set is not. */
  readonly baseFails?: boolean;
  /** Throw from this step, to model an executor refusal after a paid session. */
  readonly refuse?: 'diff' | 'test' | 'status' | 'base';
  readonly refusal?: () => Error;
  /* ------------------------------------------------- the attempt's own trees */
  readonly headRevision?: string;
  readonly baseTree?: string;
  /** The working tree when the attempt started; null means the executor reported none. */
  readonly startTree?: string | null;
  /** The working tree when it stopped; null means the close-out reported none. */
  readonly endTree?: string | null;
  /** `git diff --name-status` pairs, e.g. `[['M', 'src/slug.ts']]`. Absent follows the change set. */
  readonly own?: readonly (readonly [string, string])[];
  readonly inherited?: readonly (readonly [string, string])[];
  readonly cumulative?: readonly (readonly [string, string])[];
  /** What the executor reports about an undo Julius asked for. */
  readonly restore?: 'RESTORED' | 'REFUSED_TREE_MOVED';
  readonly restoreCounts?: readonly [number, number];
}): ShellEffectPort & { readonly invocations: ShellEffectInput[]; readonly commands: string[] } {
  const invocations: ShellEffectInput[] = [];
  const commands: string[] = [];
  let counter = 0;
  const answer = (effect: ShellEffectInput, stdout: string, exitCode = 0): ShellEffectResult => ({
    status: exitCode === 0 ? 'SUCCEEDED' : 'FAILED', exitCode, stdout, stderr: '',
    invocationId: `inv-${effect.invocationKey}-${String(++counter)}`,
  });
  const NUL = String.fromCharCode(0);
  const SECTION = `${NUL}JULIUS-SECTION-9f2a${NUL}`;
  /** A tree id the fixture hands out: forty hex characters, as git prints them. */
  const treeId = (seed: string): string => seed.repeat(40).slice(0, 40);
  const head = input.headRevision ?? 'abc123def4567890abc123def4567890abc123de';
  const baseTree = input.baseTree ?? treeId('b');
  const startTree = input.startTree === undefined ? treeId('5') : input.startTree;
  const endTree = input.endTree === undefined ? treeId('e') : input.endTree;
  const nameStatus = (
    pairs: readonly (readonly [string, string])[] | undefined,
    fallback: readonly (readonly [string, string])[],
  ): string => (pairs ?? fallback).map(([status, path]) => `${status}${NUL}${path}${NUL}`).join('');
  return {
    invocations,
    commands,
    async run(effect) {
      invocations.push(effect);
      commands.push(effect.command);
      const step = effect.invocationKey.split(':').pop();
      if (input.refuse !== undefined && step === input.refuse) throw (input.refusal ?? (() => new Error('refused')))();
      if (step === 'base') {
        if (input.baseFails === true) return answer(effect, '', 128);
        const restore = input.restore === undefined ? 'RESTORE NONE'
          : input.restore === 'RESTORED'
            ? `RESTORE RESTORED ${String(input.restoreCounts?.[0] ?? 1)} ${String(input.restoreCounts?.[1] ?? 0)}`
            : 'RESTORE REFUSED_TREE_MOVED';
        const lines = [restore, `HEAD ${head}`, `BASE ${baseTree}`];
        if (startTree !== null) lines.push(`START ${startTree}`);
        return answer(effect, `${lines.join(String.fromCharCode(10))}${String.fromCharCode(10)}`);
      }
      if (step === 'diff' && input.diffFails === true) return answer(effect, '', 128);
      if (step === 'diff') return answer(effect, `${input.diff ?? 'diff --git a/src/slug.ts b/src/slug.ts\n+export const slug = 1;\n'}${input.untrackedDiff ?? ''}`);
      if (step === 'status') {
        if (input.statusFails === true) return answer(effect, '', 128);
        const porcelain = (input.status ?? [' M src/slug.ts']).map((line) => `${line}${NUL}`).join('');
        // The plain change-set command: the adapter had no start snapshot to compare against.
        if (!effect.command.includes('JULIUS-SECTION')) return answer(effect, porcelain);
        const observed = (input.status ?? [' M src/slug.ts']).map((line): readonly [string, string] =>
          [line.startsWith('??') ? 'A' : line.trim().startsWith('D') ? 'D' : 'M', line.slice(3)]);
        return answer(effect, [
          endTree === null ? '' : `END ${endTree}${String.fromCharCode(10)}`,
          porcelain,
          nameStatus(input.own, observed),
          nameStatus(input.inherited, []),
          nameStatus(input.cumulative, observed),
        ].join(SECTION));
      }
      if (step === 'test') return answer(effect, 'tests ran', input.testExitCode ?? 0);
      return answer(effect, '');
    },
  };
}
