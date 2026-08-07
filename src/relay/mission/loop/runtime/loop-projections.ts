/**
 * SUNDAY RELAY — WHAT A SURFACE IS ALLOWED TO SEE.
 *
 * Three read-models over a durable run: a concise status, a richer inspection,
 * and a list of a Loop's runs. They are projections, not the record — a surface
 * gets what these build and never the run itself, so a field added to the
 * domain cannot leak to a browser by default.
 *
 * WHAT IS DELIBERATELY ABSENT, AND WHY EACH ONE MATTERS.
 *
 *   The lock owner. It carries a pid and a hostname — operational detail about
 *   the machine Relay runs on, useful to nobody who is not already inside it.
 *
 *   Raw model output and hidden reasoning. Journal payloads are sanitized on
 *   the way in, and these projections carry only summaries and REFERENCES to
 *   evidence, so even a sanitizer regression cannot turn into a transcript on a
 *   status page.
 *
 *   Filesystem paths. A run directory is under the operator's home. It is not a
 *   fact about the Loop and it is not the browser's business.
 *
 * UNKNOWN IS RENDERED AS UNKNOWN. Usage carries explicit `…Unknown` flags
 * rather than a number a surface would have to guess about. A projection that
 * emitted `0` for an unreported cost would make every consumer of it wrong at
 * once, and none of them would know.
 */

import { classifyLoopState, isTerminalLoopState, loopRunSucceeded } from './loop-runtime-state';
import type { RelayLoopEvent } from './loop-runtime-events';
import type { RelayLoopRun, RelayLoopRuntimeState } from './loop-runtime-types';

/* --------------------------------------------------------------- status */

export interface LoopUsageProjection {
  readonly maxIterations: number | null;
  readonly iterationsStarted: number;
  readonly iterationsCompleted: number;
  readonly maxTotalDurationMinutes: number | null;
  readonly maxSpendMicros: string | null;
  /** `null` means UNKNOWN and the flag says so explicitly. */
  readonly knownSpendMicros: string | null;
  readonly spendUnknown: boolean;
  readonly currency: string | null;
  readonly maxTotalTokens: number | null;
  readonly tokensUsed: number | null;
  readonly tokensUnknown: boolean;
  readonly maxProviderCalls: number | null;
  readonly providerCallsUsed: number | null;
  readonly providerCallsUnknown: boolean;
}

export interface LoopIdentityProjection {
  readonly requestedRole: string;
  readonly resolvedRole: string;
  readonly requestedAdapterId: string;
  /** `null` until observed. NEVER the requested value. */
  readonly actualAdapterId: string | null;
  readonly actualAgentId: string | null;
  readonly requestedModel: string | null;
  readonly actualModel: string | null;
}

export interface LoopStatusProjection {
  readonly loopId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly workspaceId: string | null;
  readonly state: RelayLoopRuntimeState;
  readonly stateClass: string;
  /** True only for `completed`. Every exhaustion, stop and timeout is false. */
  readonly succeeded: boolean;
  readonly finished: boolean;
  readonly currentIterationId: string | null;
  readonly currentOrdinal: number | null;
  readonly identity: LoopIdentityProjection | null;
  readonly usage: LoopUsageProjection;
  /** The first blocker, in the words the blocker itself used. */
  readonly blocker: { readonly reason: string; readonly detail: string; readonly requiredUserAction: string | null } | null;
  readonly latestFailure: { readonly kind: string; readonly summary: string; readonly at: string } | null;
  readonly latestCheckpoint: { readonly reason: string; readonly at: string } | null;
  readonly interruptionReason: string | null;
  readonly recoveryGeneration: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function projectLoopStatus(run: RelayLoopRun): LoopStatusProjection {
  const current = run.currentIterationId === null
    ? null
    : run.iterations.find((it) => it.iterationId === run.currentIterationId) ?? null;
  const failure = run.failures.length === 0 ? null : run.failures[run.failures.length - 1];
  const blocker = run.blockers.length === 0 ? null : run.blockers[0];

  return {
    loopId: run.loopId,
    runId: run.runId,
    projectId: run.projectId,
    workspaceId: run.workspaceId,
    state: run.state,
    stateClass: classifyLoopState(run.state),
    succeeded: loopRunSucceeded(run.state),
    finished: isTerminalLoopState(run.state),
    currentIterationId: run.currentIterationId,
    currentOrdinal: current?.ordinal ?? null,
    identity: run.assignment === null ? null : {
      requestedRole: run.assignment.requestedRole,
      resolvedRole: run.assignment.resolvedRole,
      requestedAdapterId: run.assignment.requestedAdapterId,
      actualAdapterId: run.assignment.actualAdapterId,
      actualAgentId: run.assignment.actualAgentId,
      requestedModel: run.assignment.requestedModel,
      actualModel: run.assignment.actualModel,
    },
    usage: {
      maxIterations: run.budget.maxIterations,
      iterationsStarted: run.budget.iterationsStarted,
      iterationsCompleted: run.budget.iterationsCompleted,
      maxTotalDurationMinutes: run.budget.maxTotalDurationMinutes,
      maxSpendMicros: run.budget.maxSpendMicros,
      knownSpendMicros: run.budget.knownSpendMicros,
      spendUnknown: run.budget.spendHasUnknownComponent || run.budget.knownSpendMicros === null,
      currency: run.budget.currency,
      maxTotalTokens: run.budget.maxTotalTokens,
      tokensUsed: run.budget.tokensUsed,
      tokensUnknown: run.budget.tokensHaveUnknownComponent || run.budget.tokensUsed === null,
      maxProviderCalls: run.budget.maxProviderCalls,
      providerCallsUsed: run.budget.providerCallsUsed,
      providerCallsUnknown:
        run.budget.providerCallsHaveUnknownComponent || run.budget.providerCallsUsed === null,
    },
    blocker: blocker === undefined || blocker === null ? null : {
      reason: blocker.reason,
      detail: blocker.detail,
      requiredUserAction: blocker.requiredUserAction,
    },
    latestFailure: failure === null ? null
      : { kind: failure.kind, summary: failure.summary, at: failure.at },
    latestCheckpoint: run.lastCheckpoint === null ? null
      : { reason: run.lastCheckpoint.reason, at: run.lastCheckpoint.at },
    interruptionReason: run.interruptionReason,
    recoveryGeneration: run.recoveryGeneration,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

/* -------------------------------------------------------------- inspect */

export interface LoopIterationProjection {
  readonly iterationId: string;
  readonly ordinal: number;
  readonly state: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly identity: LoopIdentityProjection;
  readonly executionOutcome: string | null;
  readonly observations: readonly {
    readonly kind: string;
    readonly trust: string;
    readonly summary: string;
    readonly evidenceRefs: readonly string[];
    readonly criterionIds: readonly string[];
  }[];
  readonly decision: { readonly action: string; readonly reason: string } | null;
  readonly evidenceRefs: readonly string[];
}

export interface LoopInspectionProjection extends LoopStatusProjection {
  readonly contract: {
    readonly ref: string;
    readonly version: number;
    readonly bindingDigest: string;
  };
  readonly iterations: readonly LoopIterationProjection[];
  readonly failures: readonly { readonly kind: string; readonly summary: string; readonly at: string; readonly recoverable: boolean }[];
  readonly blockers: readonly { readonly reason: string; readonly detail: string }[];
  /** Kind + sequence only. Payloads stay in the journal. */
  readonly events: readonly { readonly sequence: number; readonly kind: string; readonly at: string }[];
  readonly journalIntegrity: string;
  readonly snapshotSource: string;
}

export function projectLoopInspection(input: {
  readonly run: RelayLoopRun;
  readonly events: readonly RelayLoopEvent[];
  readonly journalIntegrity: string;
  readonly snapshotSource: string;
}): LoopInspectionProjection {
  const { run } = input;
  return {
    ...projectLoopStatus(run),
    contract: {
      ref: run.contractRef,
      version: run.contractVersion,
      bindingDigest: run.contractBindingDigest,
    },
    iterations: run.iterations.map((it) => ({
      iterationId: it.iterationId,
      ordinal: it.ordinal,
      state: it.state,
      startedAt: it.startedAt,
      finishedAt: it.finishedAt,
      identity: {
        requestedRole: it.assignment.requestedRole,
        resolvedRole: it.assignment.resolvedRole,
        requestedAdapterId: it.assignment.requestedAdapterId,
        actualAdapterId: it.assignment.actualAdapterId,
        actualAgentId: it.assignment.actualAgentId,
        requestedModel: it.assignment.requestedModel,
        actualModel: it.assignment.actualModel,
      },
      executionOutcome: it.execution?.outcome ?? null,
      observations: it.observations.map((o) => ({
        kind: o.kind,
        trust: o.sourceTrust,
        summary: o.summary,
        evidenceRefs: o.evidenceRefs,
        criterionIds: o.criterionIds,
      })),
      decision: it.decision === null ? null : { action: it.decision.action, reason: it.decision.reason },
      evidenceRefs: it.outputRefs,
    })),
    failures: run.failures.map((f) => ({
      kind: f.kind, summary: f.summary, at: f.at, recoverable: f.recoverable,
    })),
    blockers: run.blockers.map((b) => ({ reason: b.reason, detail: b.detail })),
    // Sequence, kind and time. Enough to see the causal story; not enough to
    // reconstruct a payload the sanitizer was protecting.
    events: input.events.map((e) => ({ sequence: e.sequence, kind: e.kind, at: e.at })),
    journalIntegrity: input.journalIntegrity,
    snapshotSource: input.snapshotSource,
  };
}

/* -------------------------------------------------------------- history */

export interface LoopHistoryEntry {
  readonly runId: string;
  readonly state: RelayLoopRuntimeState;
  readonly succeeded: boolean;
  readonly finished: boolean;
  readonly iterationsStarted: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One Loop definition's runs, newest first. */
export function projectLoopHistory(runs: readonly RelayLoopRun[]): readonly LoopHistoryEntry[] {
  return [...runs]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((run) => ({
      runId: run.runId,
      state: run.state,
      succeeded: loopRunSucceeded(run.state),
      finished: isTerminalLoopState(run.state),
      iterationsStarted: run.budget.iterationsStarted,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    }));
}

/**
 * A last line of defence over any projection about to leave the process.
 *
 * The sanitizer runs on the way INTO the journal, so this should never find
 * anything. It exists because "should never" is not a guarantee, and a status
 * route is the one place where a regression becomes a disclosure.
 */
export function projectionLeaksNothing(projection: unknown): string | null {
  const serialized = JSON.stringify(projection);
  if (/sk-[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY/.test(serialized)) {
    return 'a secret-shaped value';
  }
  if (/<thinking>|chain[- ]of[- ]thought|hidden reasoning/i.test(serialized)) {
    return 'hidden-reasoning-shaped content';
  }
  if (/"pid"\s*:|"hostname"\s*:/.test(serialized)) return 'lock owner detail';
  if (/\/home\/|\/Users\/|C:\\\\Users/.test(serialized)) return 'a filesystem path';
  return null;
}
