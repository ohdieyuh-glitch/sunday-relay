/**
 * SUNDAY RELAY — THE SCRIPTED LOOP AGENT.
 *
 * An adapter that returns exactly what a test told it to, in order, and does
 * nothing else. It is the only agent Stage 2 can run, and that is the point:
 * the engine, the limits, the completion rules and the recovery paths are all
 * provable end to end before a single paid call exists.
 *
 * WHAT IT MAY NOT DO, ENFORCED BY A TEST THAT READS THIS FILE. No network, no
 * child process, no provider SDK, no credential, no `Date.now()`. Time comes
 * from an injected clock, so a "timeout" in a test is a scripted fact rather
 * than a race that passes on a fast machine and fails on a loaded one.
 *
 * WHY EVERY INVOCATION IS ATTRIBUTABLE. The fake records the run, iteration,
 * ordinal and idempotency key of every call. That is what lets a test prove the
 * hard things: that a retry with the same key did NOT dispatch twice, that a
 * duplicate engine invocation did not produce a second iteration, and that a
 * pause happened before the next dispatch rather than after it. Without the
 * record those claims would be asserted about the run's state alone, which is
 * exactly the thing under test.
 *
 * IT NEVER SELF-CERTIFIES. A scripted step may ask for `attested` or `verified`
 * trust, because a test needs to drive completion — but the fake models an
 * adapter REPORTING what a harness told it, not an agent grading itself. The
 * completion evaluator still applies its own rules to whatever comes back.
 *
 * PURE.
 */

import {
  type RelayLoopAgentFinding,
  type RelayLoopAgentPort,
  type RelayLoopAgentRequest,
  type RelayLoopAgentResult,
  type RelayLoopAgentStatus,
  type RelayLoopAgentUsage,
} from './loop-agent-port';
import type { RelayAgentRole } from '../../agent-operating';

/* ---------------------------------------------------------------- steps */

/**
 * One scripted iteration outcome.
 *
 * The named shorthands cover the scenarios Stage 2 must prove; `custom` exists
 * so a test can express something the shorthands do not without anyone being
 * tempted to widen the list for a single case.
 */
export type FakeLoopAgentStep =
  /** The model says it is done and offers nothing to check. */
  | { readonly kind: 'completion_claim_only'; readonly usage?: RelayLoopAgentUsage }
  /** Work happened and Relay saw the output, but nothing corroborates it. */
  | { readonly kind: 'observed_evidence'; readonly evidenceRefs?: readonly string[]; readonly usage?: RelayLoopAgentUsage }
  /** Evidence carrying an attestation. */
  | { readonly kind: 'attested_evidence'; readonly evidenceRefs?: readonly string[]; readonly usage?: RelayLoopAgentUsage }
  /** Evidence Relay itself verified. */
  | { readonly kind: 'verified_evidence'; readonly evidenceRefs?: readonly string[]; readonly usage?: RelayLoopAgentUsage }
  /** The agent found something wrong and wants a repair pass. */
  | { readonly kind: 'repair_requested'; readonly usage?: RelayLoopAgentUsage }
  /** Progress, not finished. */
  | { readonly kind: 'continuing'; readonly usage?: RelayLoopAgentUsage }
  | { readonly kind: 'refusal'; readonly summary?: string }
  | { readonly kind: 'malformed_output' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cancellation' }
  | { readonly kind: 'crash' }
  | { readonly kind: 'adapter_unavailable' }
  /** Finishes normally but cannot account for what it spent. */
  | { readonly kind: 'unknown_usage'; readonly reason?: string }
  /** Reports usage that will push a counter past its bound. */
  | { readonly kind: 'heavy_usage'; readonly usage: RelayLoopAgentUsage }
  /** Parks at a safe boundary — but only after `afterCalls` dispatches, so a
   *  test can prove a pause waits for a real boundary instead of claiming one. */
  | { readonly kind: 'delayed_safe_checkpoint'; readonly afterCalls: number }
  | { readonly kind: 'custom'; readonly result: RelayLoopAgentResult };

export interface FakeLoopAgentInvocation {
  readonly runId: string;
  readonly iterationId: string;
  readonly ordinal: number;
  readonly idempotencyKey: string;
  readonly requestedRole: RelayAgentRole;
  readonly at: string;
}

export interface FakeLoopAgentOptions {
  readonly adapterId?: string;
  readonly agentId?: string;
  /** What the adapter REPORTS running. `null` models an adapter that cannot
   *  say — the case that must stay Unknown rather than becoming the request. */
  readonly model?: string | null;
  readonly supportedRoles?: readonly RelayAgentRole[];
  /** Injected clock. The fake never reads a real one. */
  readonly now?: () => string;
}

export interface FakeLoopAgent extends RelayLoopAgentPort {
  /** Every dispatch, in order. The evidence for "it ran once, not twice". */
  readonly invocations: readonly FakeLoopAgentInvocation[];
  /** Dispatches for one idempotency key. */
  callsFor(idempotencyKey: string): number;
  readonly cancellations: readonly string[];
  readonly checkpointRequests: readonly string[];
}

const KNOWN_USAGE: RelayLoopAgentUsage = {
  known: true, costMicros: '1000', currency: 'USD', tokens: 100, providerCalls: 1,
};

const finding = (
  kind: RelayLoopAgentFinding['kind'],
  trust: RelayLoopAgentFinding['trust'],
  summary: string,
  evidenceRefs: readonly string[] = [],
): RelayLoopAgentFinding => ({ kind, trust, summary, evidenceRefs, criterionIds: ['AC-1'] });

/**
 * Build a scripted agent.
 *
 * Steps are consumed in order. Running past the end is a SCRIPT ERROR, not a
 * default outcome — an engine that dispatched more times than the test planned
 * has done something the test did not describe, and inventing a result for it
 * would hide exactly that.
 */
export function createFakeLoopAgent(
  script: readonly FakeLoopAgentStep[],
  options: FakeLoopAgentOptions = {},
): FakeLoopAgent {
  const adapterId = options.adapterId ?? 'fake-loop-agent';
  const agentId = options.agentId ?? 'fake-agent-1';
  const model = options.model === undefined ? 'fake-model-1' : options.model;
  const now = options.now ?? (() => '1970-01-01T00:00:00.000Z');
  const invocations: FakeLoopAgentInvocation[] = [];
  const cancellations: string[] = [];
  const checkpointRequests: string[] = [];
  // One remembered answer per idempotency key: a redelivered request returns
  // the SAME result and does not consume another scripted step.
  const answered = new Map<string, RelayLoopAgentResult>();
  let cursor = 0;

  const identity = {
    actualAdapterId: adapterId,
    actualAgentId: agentId,
    actualModel: model,
  };

  const resultFor = (step: FakeLoopAgentStep, request: RelayLoopAgentRequest): RelayLoopAgentResult => {
    const base = {
      ...identity,
      findings: [] as readonly RelayLoopAgentFinding[],
      usage: KNOWN_USAGE,
      failureSummary: null as string | null,
      checkpointed: false,
    };
    switch (step.kind) {
      case 'completion_claim_only':
        return {
          ...base, outcome: 'completed', usage: step.usage ?? KNOWN_USAGE,
          findings: [finding('completion_claim', 'claim', 'The task is complete.')],
        };
      case 'observed_evidence':
        return {
          ...base, outcome: 'completed', usage: step.usage ?? KNOWN_USAGE,
          findings: [
            finding('completion_claim', 'claim', 'The task is complete.'),
            finding('evidence_produced', 'observed', 'Relay saw output from the run.', step.evidenceRefs ?? ['evd_observed']),
          ],
        };
      case 'attested_evidence':
        return {
          ...base, outcome: 'completed', usage: step.usage ?? KNOWN_USAGE,
          findings: [
            finding('completion_claim', 'claim', 'The task is complete.'),
            finding('evidence_produced', 'attested', 'The fixture harness attested the result.', step.evidenceRefs ?? ['evd_attested']),
          ],
        };
      case 'verified_evidence':
        return {
          ...base, outcome: 'completed', usage: step.usage ?? KNOWN_USAGE,
          findings: [
            finding('completion_claim', 'claim', 'The task is complete.'),
            finding('evidence_produced', 'verified', 'Relay ran the check itself.', step.evidenceRefs ?? ['evd_verified']),
          ],
        };
      case 'repair_requested':
        return {
          ...base, outcome: 'completed', usage: step.usage ?? KNOWN_USAGE,
          findings: [finding('repair_requested', 'observed', 'A defect needs repairing before this is done.')],
        };
      case 'continuing':
        return {
          ...base, outcome: 'completed', usage: step.usage ?? KNOWN_USAGE,
          findings: [finding('progress_report', 'claim', 'Still working.')],
        };
      case 'refusal':
        return {
          ...base, outcome: 'refused',
          findings: [finding('refusal', 'observed', step.summary ?? 'The agent declined this task.')],
          failureSummary: step.summary ?? 'The agent declined this task.',
        };
      case 'malformed_output':
        return { ...base, outcome: 'malformed_output', failureSummary: 'The adapter returned a shape Relay cannot read.' };
      case 'timeout':
        return { ...base, outcome: 'timeout', failureSummary: `Iteration ${request.ordinal} exceeded its bound.` };
      case 'cancellation':
        return { ...base, outcome: 'cancelled', failureSummary: 'Relay cancelled this iteration.' };
      case 'crash':
        return { ...base, outcome: 'crashed', failureSummary: 'The agent process ended unexpectedly.' };
      case 'adapter_unavailable':
        // Nothing was dispatched, so there is no identity to report and no
        // usage to account for. Reporting an adapter id here would claim a
        // conversation that never happened.
        return {
          outcome: 'adapter_unavailable',
          actualAdapterId: null, actualAgentId: null, actualModel: null,
          findings: [],
          usage: { known: false, reason: 'The adapter was never reached.', providerCalls: 0, tokens: 0 },
          failureSummary: 'The adapter could not be reached.',
          checkpointed: false,
        };
      case 'unknown_usage':
        return {
          ...base, outcome: 'completed',
          findings: [finding('progress_report', 'claim', 'Work done; cost not reported.')],
          usage: {
            known: false,
            reason: step.reason ?? 'This adapter does not report usage.',
            providerCalls: null,
            tokens: null,
          },
        };
      case 'heavy_usage':
        return {
          ...base, outcome: 'completed', usage: step.usage,
          findings: [finding('progress_report', 'claim', 'Expensive work done.')],
        };
      case 'delayed_safe_checkpoint':
        return {
          ...base, outcome: 'completed', usage: KNOWN_USAGE,
          checkpointed: invocations.length >= step.afterCalls,
          findings: [finding('progress_report', 'claim', 'Working; will park at the next boundary.')],
        };
      case 'custom':
        return step.result;
    }
  };

  return {
    adapterId,
    supportedRoles: options.supportedRoles ?? ['coding_agent'],
    invocations,
    cancellations,
    checkpointRequests,

    callsFor: (idempotencyKey) =>
      invocations.filter((i) => i.idempotencyKey === idempotencyKey).length,

    begin: async (request) => {
      const remembered = answered.get(request.idempotencyKey);
      if (remembered !== undefined) {
        // A redelivery. The adapter did NOT work twice, and the script did not
        // advance — which is what makes "no duplicate dispatch" provable.
        return remembered;
      }
      if (cursor >= script.length) {
        throw new Error(
          `The fake agent was dispatched ${cursor + 1} times but was scripted for ${script.length}. `
          + 'An unscripted dispatch is a defect in what is being tested, not a case to invent a result for.',
        );
      }
      const step = script[cursor];
      cursor += 1;
      invocations.push({
        runId: request.runId,
        iterationId: request.iterationId,
        ordinal: request.ordinal,
        idempotencyKey: request.idempotencyKey,
        requestedRole: request.requestedRole,
        at: now(),
      });
      const result = resultFor(step, request);
      answered.set(request.idempotencyKey, result);
      return result;
    },

    observe: async (iterationId): Promise<RelayLoopAgentStatus> => {
      const seen = invocations.find((i) => i.iterationId === iterationId);
      if (seen === undefined) {
        return { state: 'unobservable', reason: 'This adapter has no record of that iteration.' };
      }
      const result = answered.get(seen.idempotencyKey);
      return result === undefined
        ? { state: 'unobservable', reason: 'The dispatch was recorded but produced no result.' }
        : { state: 'finished', result };
    },

    cancel: async (iterationId) => {
      cancellations.push(iterationId);
    },

    requestSafeCheckpoint: async (iterationId) => {
      checkpointRequests.push(iterationId);
      return true;
    },
  };
}
