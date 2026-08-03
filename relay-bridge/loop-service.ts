import { createLoopRunNodeStore, type LoopRunNodeStore } from '../src/relay/persistence/loop-run-node';
import { createNodeLoopLockPort } from '../src/relay/persistence/loop-lock-node';
import {
  confirmLoopRun,
  emptyLoopBudget,
  loopConfirmationKey,
  loopDigest,
  projectLoopHistory,
  projectLoopInspection,
  projectLoopStatus,
  readLoopRun,
  requestLoopPause,
  requestLoopResume,
  requestLoopStop,
  runLoopUntilSettled,
  type LoopEngineContext,
  type LoopEngineDeps,
  type LoopHistoryEntry,
  type LoopInspectionProjection,
  type LoopOperationDeps,
  type LoopStatusProjection,
  type RelayLoopAgentPort,
  type RelayLoopControlAction,
  type RelayLoopRun,
} from '../src/relay/mission/loop/runtime';
import type { LoopRunPort } from './loop-routes';

/**
 * THE LOOP RUN SERVICE — where the control plane meets real bytes.
 *
 * This is the composition root for Loop execution: the Node store, the REAL
 * file lock, the injected agent adapter, an injected clock and injected id
 * minting. Everything above it (`loop-routes`) is a control plane that decides
 * nothing; everything below it (the engine, the reducer) is pure and decides
 * everything. This module is the only place that knows all three exist.
 *
 * WHY THE ENGINE RUNS INLINE. Confirmation persists a run and then drives it to
 * settlement in the same request. That is honest for Stage 2, where the only
 * adapter is a deterministic fake and an iteration costs microseconds — and it
 * is exactly what a background worker must NOT do later without a queue, which
 * is why the seam is a single call rather than scattered through the routes.
 *
 * THE LOCK IS THE REAL ONE. `createNodeLoopLockPort` over `acquireRunLock`, so
 * two bridge processes over one state root cannot both dispatch. The in-memory
 * port remains available to focused tests and is never wired here.
 *
 * NO PROVIDER IS REACHABLE FROM THIS FILE. The adapter arrives injected, and
 * Stage 2 injects a fake. Nothing here imports a provider SDK, holds a
 * credential, or knows a base URL.
 */

export interface LoopServiceOptions {
  /** Resolved state root. Runs live under `<root>/loops/…`. */
  readonly root: string;
  /** The agent that executes an iteration. Stage 2 passes a fake. */
  readonly agent: RelayLoopAgentPort;
  /** Injected clock — the service never reads a real one directly. */
  readonly now: () => string;
  /** Mints ids. Injected so a test run is reproducible. */
  readonly newId: (kind: string) => string;
  /**
   * How many iterations one confirmation may drive before returning. A bound on
   * the REQUEST, not on the Loop: the run's own limits are enforced per
   * iteration by the engine and are the thing that actually stops it.
   */
  readonly maxIterationsPerCall?: number;
  /** Contract facts the engine needs and the journal does not carry. */
  readonly contractPolicy?: (input: { readonly loopId: string; readonly runId: string }) => {
    readonly completionRule: 'all_blocking_criteria' | 'all_blocking_criteria_and_independent_review';
    readonly acceptanceCriteria: readonly { readonly id: string; readonly blocking: boolean }[];
    readonly maxIterations: number | null;
    readonly maxSpendMicros: string | null;
    readonly maxTotalTokens: number | null;
    readonly maxProviderCalls: number | null;
    readonly maxTotalDurationMinutes: number | null;
  };
}

const DEFAULT_POLICY = {
  completionRule: 'all_blocking_criteria' as const,
  acceptanceCriteria: [{ id: 'AC-1', blocking: true }],
  maxIterations: 10,
  maxSpendMicros: '10000000',
  maxTotalTokens: 1_000_000,
  maxProviderCalls: 100,
  maxTotalDurationMinutes: 60,
};

export interface LoopService extends LoopRunPort {
  /** Exposed for diagnostics and tests; never reachable from a route. */
  readonly store: LoopRunNodeStore;
}

export function createLoopService(options: LoopServiceOptions): LoopService {
  const store = createLoopRunNodeStore({ root: options.root });
  const policyFor = options.contractPolicy ?? (() => DEFAULT_POLICY);

  const operations: LoopOperationDeps = { backing: store, digest: loopDigest, now: options.now };

  const lock = createNodeLoopLockPort({
    store,
    // The lock lives in the run's own directory, so the Loop that owns the run
    // is resolved from the durable record rather than from anything a caller
    // asserted.
    loopIdFor: (runId) => store.read(runId)?.seed.loopId ?? null,
    now: options.now,
  });

  const engine: LoopEngineDeps = {
    backing: store,
    agent: options.agent,
    lock,
    digest: loopDigest,
    now: options.now,
    newId: options.newId as LoopEngineDeps['newId'],
  };

  const statusOf = (runId: string): LoopStatusProjection | null => {
    const loaded = readLoopRun(store, runId, loopDigest);
    return loaded?.run == null ? null : projectLoopStatus(loaded.run);
  };

  const contextFor = (run: RelayLoopRun): LoopEngineContext => {
    const policy = policyFor({ loopId: run.loopId, runId: run.runId });
    return {
      runId: run.runId,
      loopId: run.loopId,
      projectId: run.projectId,
      actor: 'relay-loop-service',
      sessionId: 'bridge',
      target: {
        selector: { kind: 'exact_roles', requestedExpression: 'coding', requestedRoles: ['coding_agent'] },
        requestedRoles: ['coding_agent'],
        resolvedRoles: ['coding_agent'],
        unavailableRoles: [],
        assignments: [{
          role: 'coding_agent',
          requestedAdapterId: options.agent.adapterId,
          actualAgentId: null,
          actualAdapterId: null,
        }],
        registryProvenance: 'simulated',
        resolvedAt: options.now(),
      },
      // The route already gated on the server flag; the engine re-checks it
      // rather than trusting that it was checked.
      features: { loop_engine: true },
      trigger: 'api',
      isSLoop: false,
      reviewerConfiguration: 'not_required',
      contractBindingDigest: run.contractBindingDigest,
      completionRule: policy.completionRule,
      acceptanceCriteria: policy.acceptanceCriteria,
      missionVerdict: 'verified_complete',
      requestedAdapterId: options.agent.adapterId,
      requestedModel: null,
      iterationDeadlineMs: 60_000,
      elapsedMinutes: 0,
    };
  };

  const drive = async (run: RelayLoopRun): Promise<void> => {
    await runLoopUntilSettled(engine, contextFor(run), {
      maxIterationsThisCall: options.maxIterationsPerCall ?? 12,
    });
  };

  return {
    store,

    confirm: async (input) => {
      const policy = policyFor({ loopId: input.loopId, runId: '' });
      /**
       * THE RUN ID IS DERIVED FROM THE CONFIRMATION, NOT MINTED.
       *
       * A minted id would be different on every retry, so the second delivery
       * of one confirmation would create a second run — the exact duplicate
       * this endpoint exists to prevent. Hashing the confirmation identity
       * means a retry lands on the SAME id, finds the existing run, and returns
       * it; and two genuinely different confirmations cannot collide, because
       * the digest covers everything that makes them different.
       */
      const confirmationKey = loopConfirmationKey({
        principal: input.principal,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        contractBindingDigest: input.contractBindingDigest,
        confirmationRequestId: input.confirmationRequestId,
      });
      const created = confirmLoopRun(operations, {
        principal: input.principal,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        loopId: input.loopId,
        runId: `lpr_${loopDigest(confirmationKey).slice(0, 32)}`,
        contractRef: input.contractRef,
        contractVersion: input.contractVersion,
        contractBindingDigest: input.contractBindingDigest,
        confirmationRequestId: input.confirmationRequestId,
        creationSource: input.creationSource,
        budget: emptyLoopBudget({
          maxIterations: policy.maxIterations,
          maxTotalDurationMinutes: policy.maxTotalDurationMinutes,
          maxSpendMicros: policy.maxSpendMicros,
          currency: 'USD',
          maxTotalTokens: policy.maxTotalTokens,
          maxProviderCalls: policy.maxProviderCalls,
          maxConsecutiveFailures: 3,
        }),
        provenance: 'offline',
      });
      if (!created.ok) {
        return { ok: false, status: created.status, kind: created.kind, message: created.problem };
      }
      if (!created.duplicate) await drive(created.run);
      const status = statusOf(created.run.runId);
      return status === null
        ? { ok: false, status: 500, kind: 'not_readable', message: 'The run was created but does not read back.' }
        : { ok: true, status, duplicate: created.duplicate };
    },

    status: async (runId) => statusOf(runId),

    inspect: async (runId): Promise<LoopInspectionProjection | null> => {
      const loaded = readLoopRun(store, runId, loopDigest);
      if (loaded?.run == null) return null;
      return projectLoopInspection({
        run: loaded.run,
        events: store.read(runId)?.events ?? [],
        journalIntegrity: loaded.journalIntegrity,
        snapshotSource: loaded.source,
      });
    },

    history: async (loopId): Promise<readonly LoopHistoryEntry[] | null> => {
      const runIds = store.runIdsForLoop(loopId);
      if (runIds === null) return null;
      const runs: RelayLoopRun[] = [];
      for (const runId of runIds) {
        const loaded = readLoopRun(store, runId, loopDigest);
        if (loaded?.run != null) runs.push(loaded.run);
      }
      return projectLoopHistory(runs);
    },

    control: async (input) => {
      const request = {
        requestId: input.requestId,
        action: input.action as RelayLoopControlAction,
        requestedBy: input.requestedBy,
        reason: input.reason,
      };
      const outcome = input.action === 'pause'
        ? requestLoopPause(operations, input.runId, request)
        : input.action === 'resume'
          ? requestLoopResume(operations, input.runId, request)
          : requestLoopStop(operations, input.runId, request);

      if (!outcome.ok) {
        return { ok: false, status: outcome.status, kind: outcome.kind, message: outcome.problem };
      }
      // A pause or a stop only becomes real when the engine reaches a safe
      // point and records it; a resume only continues when the engine re-checks
      // and dispatches. Driving here is what turns the REQUEST into the fact.
      if (!outcome.duplicate) await drive(outcome.run);
      const status = statusOf(input.runId);
      return status === null
        ? { ok: false, status: 500, kind: 'not_readable', message: 'The run does not read back.' }
        : { ok: true, status, duplicate: outcome.duplicate };
    },
  };
}
