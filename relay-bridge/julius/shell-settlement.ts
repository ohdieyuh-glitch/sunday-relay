/**
 * HOW ONE SHELL EFFECT IS SETTLED, AND HOW ONE THAT CANNOT BE IS CLOSED: shared by the live shell port
 * (`./executor-effects.ts`) and the provider-free preflight (`scripts/julius-live-preflight.ts`).
 *
 * WHY IT IS ITS OWN MODULE. The preflight exists to prove, before any provider is paid, that the path
 * the mission will take works on the real executor and the real store. Paid run 36568129865 failed on
 * a path the preflight never took: the executor stored a NUL-bearing close-out result, and nothing
 * provider-free ever settled one. A preflight that built its own copy of the settlement would prove its
 * copy. So both callers build the command here, and this module stays pure (a digest and types) so the
 * preflight can import it without reaching `./live-workers` and the provider connectors behind it.
 */

import { createHash } from 'node:crypto';
import type { JuliusExecutorRefusal, JuliusToolSettlementCommand, ToolInvocationResult } from '../../src/relay/mission/julius';

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Canonical JSON, identical to the settlement repository's and the executor's. */
const stable = (value: unknown): string => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;

/** The digest the settlement repository recomputes: over the RAW value, never a stored form of it. */
export const digestOf = (value: unknown): string => sha(stable(value));

/**
 * The settlement of one executed shell effect: the result exactly as the executor's signed receipts
 * derived it (raw, NULs and all), and one COMMAND_EXECUTION evidence row whose integrity hash covers
 * the raw output. The repository encodes what PostgreSQL cannot hold; nothing here does.
 */
export function shellEffectSettlement(input: {
  readonly invocationId: string;
  readonly dispatchGeneration: number;
  readonly result: ToolInvocationResult;
  /** Already made safe by the caller; the live port uses `safeClaim`. */
  readonly safeSummary: string;
  readonly occurredAt: string;
}): JuliusToolSettlementCommand {
  return {
    settlementId: `settlement:${input.invocationId}`,
    invocationId: input.invocationId,
    dispatchGeneration: input.dispatchGeneration,
    resultDigest: digestOf(input.result),
    result: input.result,
    artifacts: [],
    evidence: [{
      evidenceId: `tool:${input.invocationId}`,
      type: 'COMMAND_EXECUTION',
      integrityHash: sha(input.result.stdout + input.result.stderr),
      facts: { safeSummary: input.safeSummary },
    }],
    taskOutcome: null,
    occurredAt: input.occurredAt,
  };
}

/** Where in the dispatch a shell effect failed. Only `execute` can have run the command. */
export type ShellEffectStage = 'create' | 'prepare' | 'execute' | 'settle';

/**
 * REFUSALS THAT PROVE THE COMMAND NEVER RAN. The executor refuses these before it reserves the
 * execution identity (a malformed request, a credential it does not accept, a scope Julius does not
 * hold), so nothing inside a sandbox started. Every other failure of `execute` is treated as possibly
 * effected: a 500 after the receipts were written, an unknown outcome, a lost connection, an answer
 * Julius could not verify. Paid run 36568129865's 500 was exactly that: the effect had happened.
 */
const NO_EFFECT_REFUSALS: ReadonlySet<JuliusExecutorRefusal> = new Set<JuliusExecutorRefusal>([
  'executor_request_invalid', 'executor_identity_invalid', 'executor_authorization_refused', 'executor_scope_refused',
]);

/**
 * How a dispatch that will not settle is closed. Creating and preparing a sandbox run no command, so a
 * failure there provably had no effect; a failure to execute or to settle may have had one.
 */
export function shellDispatchFailure(stage: ShellEffectStage, refusal: JuliusExecutorRefusal | null): 'NO_EFFECT' | 'UNKNOWN_OUTCOME' {
  if (stage === 'create' || stage === 'prepare') return 'NO_EFFECT';
  if (stage === 'execute' && refusal !== null && NO_EFFECT_REFUSALS.has(refusal)) return 'NO_EFFECT';
  return 'UNKNOWN_OUTCOME';
}

/**
 * What `JuliusToolPostgresRepository.failDispatch` is handed for a dispatch that will not settle. The
 * summary names the step (the last segment of the invocation key: `base`, `status`, `diff`, `test`) and
 * the class, never the executor's text.
 */
export function shellDispatchClosure(input: {
  readonly invocationId: string;
  /** The key the step is read from; the live port's `invocationKey`, or the invocation id. */
  readonly invocationKey: string;
  readonly dispatchGeneration: number;
  readonly stage: ShellEffectStage;
  readonly refusal: JuliusExecutorRefusal | null;
  /** A class, `[a-z][a-z0-9_]*`: the refusal, or the local reason it was not settled. */
  readonly failureClass: string;
  readonly completedAt: string;
}): { invocationId: string; dispatchGeneration: number; failure: 'NO_EFFECT' | 'UNKNOWN_OUTCOME'; failureClass: string; safeSummary: string; completedAt: string } {
  const failure = shellDispatchFailure(input.stage, input.refusal);
  const tail = input.invocationKey.slice(input.invocationKey.lastIndexOf(':') + 1);
  const step = /^[a-z]{1,8}$/u.test(tail) ? tail : 'tool';
  return {
    invocationId: input.invocationId, dispatchGeneration: input.dispatchGeneration, failure, failureClass: input.failureClass,
    safeSummary: failure === 'NO_EFFECT'
      ? `The ${step} effect failed at ${input.stage} (${input.failureClass}); the executor ran nothing.`
      : `The ${step} effect failed at ${input.stage} (${input.failureClass}); whether the executor ran it is unknown to Julius.`,
    completedAt: input.completedAt,
  };
}

/* ------------------------------------------------ what the executor said */

export interface ExecutorRefusalClass {
  readonly refusal: JuliusExecutorRefusal;
  /** The envelope or request field the executor named, snake-cased, or null. */
  readonly field: string | null;
}

const snake = (name: string): string | null => {
  const token = name.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').replace(/[.-]/gu, '_').toLowerCase();
  return /^[a-z][a-z0-9_]{0,63}$/u.test(token) ? token : null;
};

/**
 * WHAT A REFUSED TOOL EFFECT WAS, from the error the executor client raised.
 *
 * The client (`remote-executor-control-plane.ts`) turns every non-2xx answer
 * into an untyped `Error` — a 400 for an invalid request included, as
 * `EXECUTOR_UNAVAILABLE:<executor code>` — and the coordinator could only say
 * "Execution boundary failed." with no class. This names it. It reads codes and
 * field names only, never a value, and anything it does not recognise is
 * `executor_refused_unclassified`, never silence.
 */
export function classifyExecutorRefusal(error: unknown): ExecutorRefusalClass {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const fieldOf = (pattern: RegExp): string | null => {
    const match = pattern.exec(message);
    return match?.[1] === undefined ? null : snake(match[1]);
  };
  if (/^EXECUTOR_UNAVAILABLE:INVALID_REQUEST:execution_envelope_(?:invalid:executionIdentity|identity_mismatch)\b/u.test(message)) {
    return { refusal: 'executor_identity_invalid', field: 'execution_identity' };
  }
  if (/^EXECUTOR_UNAVAILABLE:INVALID_REQUEST:/u.test(message)) {
    return { refusal: 'executor_request_invalid', field: fieldOf(/:(?:execution_envelope_invalid|execution_request|execution_payload|executor_[a-z_]+?):([A-Za-z][A-Za-z0-9_.]{0,63})$/u) };
  }
  if (message === 'EXECUTOR_UNAVAILABLE' || /^EXECUTOR_UNAVAILABLE(?::|$)/u.test(message)) return { refusal: 'executor_unavailable', field: null };
  if (message === 'executor_authorization_refused') return { refusal: 'executor_authorization_refused', field: null };
  if (message.startsWith('executor_scope_not_held:') || message === 'execution_envelope_scope_refused') return { refusal: 'executor_scope_refused', field: null };
  if (message === 'executor_identity_conflict') return { refusal: 'executor_identity_conflict', field: null };
  if (message === 'STARTED_UNKNOWN_OUTCOME') return { refusal: 'executor_outcome_unknown', field: null };
  if (message.startsWith('SECURITY_FAILURE:')) return { refusal: 'executor_security_failure', field: null };
  if (message.startsWith('TERMINAL_FAILURE:')) return { refusal: 'executor_terminal_failure', field: null };
  if (/^executor_response_(?:missing|too_large|malformed)$/u.test(message)) return { refusal: 'executor_response_invalid', field: null };
  return { refusal: 'executor_refused_unclassified', field: null };
}
