/**
 * SUNDAY RELAY — THE BOUNDED SINGLE-AGENT ITERATION ENGINE.
 *
 * One run, one role, one adapter, one iteration at a time, every step durable
 * before the next one starts.
 *
 * THE ORDER IS THE DESIGN. Load, lock, validate, check limits, assign, open an
 * iteration, dispatch, record what came back, evaluate, decide, snapshot,
 * release. Nothing in that sequence is an optimisation and none of it may be
 * reordered for speed. Two orderings in particular are load-bearing:
 *
 *   LIMITS ARE CHECKED BEFORE THE DISPATCH, NOT AFTER. A run that has reached
 *   its spend cap must not make the call that discovers it. Checking afterwards
 *   turns a budget into a suggestion that is enforced one iteration late, and
 *   the overrun is real money.
 *
 *   THE EXECUTION IS WRITTEN BEFORE THE AGENT IS CALLED. `agent_execution_started`
 *   lands on disk first, carrying outcome `unknown`. If the process dies during
 *   the call, the journal says an operation was started and never resolved —
 *   which is what makes recovery classify it as uncertain instead of assuming
 *   it failed and running it again. Writing afterwards would lose the dispatch
 *   entirely and a restart would cheerfully repeat a paid call.
 *
 * WHAT IT REFUSES. Everything Stage 2 has not built: `all_eligible_agents`, a
 * compound-agent target resolving to more than one role, any multi-role target,
 * a Cron trigger, an S-Loop, a run whose feature flag is not enabled by the
 * server, an unsupported reviewer configuration, a contract that moved, and an
 * adapter that cannot staff the resolved role. A multi-role target is REFUSED,
 * never quietly narrowed to its first role — silently doing a third of what
 * was asked is worse than doing none of it, because nobody is told.
 *
 * NOTHING HERE COMPLETES A LOOP BY ITSELF. A successful dispatch, a final
 * iteration, an exhausted limit and a model saying "done" are all just facts
 * that get recorded. Completion is decided by `evaluateLoopCompletion`, and the
 * only edge into `completed` is from `completion_check`.
 *
 * PURE. Filesystem, clock, ids, locking and the agent all arrive injected.
 */

import { evaluateLoopCompletion, type RelayLoopCompletionVerdict } from '../loop-completion';
import { featureEnabled, type RelayLoopFeatureFlags } from '../loop-availability';
import { runtimeBlocker, type RelayLoopBlocker } from '../loop-blockers';
import type { MissionCompletionRule, MissionVerdict } from '../../contracts';
import type { RelayLoopTarget } from '../loop-target';
import { portSupportsRole, type RelayLoopAgentPort, type RelayLoopAgentResult, type RelayLoopAgentUsage } from './loop-agent-port';
import {
  appendLoopRunEvent,
  checkpointLoopRun,
  readLoopRun,
  type LoopRunStoreBacking,
} from './loop-runtime-store';
import { classifyLoopRecovery, type LoopRecoveryReport } from './loop-runtime-recovery';
import { isTerminalLoopState, type RelayLoopLimitKind } from './loop-runtime-state';
import type { LoopDigestFn } from './loop-runtime-reducer';
import type { RelayLoopEventInput, RelayLoopEventPayload } from './loop-runtime-events';
import type {
  RelayLoopAgentExecution,
  RelayLoopRun,
  RelayLoopRuntimeState,
} from './loop-runtime-types';

/* ----------------------------------------------------------------- lock */

export interface LoopRunLockHandle {
  release(): void;
}

export type LoopLockResult =
  | { readonly ok: true; readonly handle: LoopRunLockHandle; readonly diagnostics: readonly string[] }
  | { readonly ok: false; readonly problem: string };

/** Mutual exclusion over one run. The Node implementation is the O_EXCL file
 *  lock; the in-memory one below is for single-process tests. */
export interface LoopRunLockPort {
  acquire(runId: string, purpose: string): LoopLockResult;
}

export function createInMemoryLoopLockPort(): LoopRunLockPort {
  const held = new Set<string>();
  return {
    acquire: (runId, purpose) => {
      if (held.has(runId)) {
        return { ok: false, problem: `Loop run ${runId} is already locked in this process (${purpose}).` };
      }
      held.add(runId);
      return {
        ok: true,
        diagnostics: [],
        handle: { release: () => { held.delete(runId); } },
      };
    },
  };
}

/* ------------------------------------------------------------ injection */

export interface LoopEngineDeps {
  readonly backing: LoopRunStoreBacking;
  readonly agent: RelayLoopAgentPort;
  readonly lock: LoopRunLockPort;
  readonly digest: LoopDigestFn;
  /** Injected clock. The engine never reads a real one. */
  readonly now: () => string;
  /** Deterministic id minting. `kind` names what is being identified. */
  readonly newId: (kind: 'lpi' | 'exe' | 'obs' | 'dcn' | 'flr') => string;
}

/** Everything about THIS run that the engine cannot read out of the journal. */
export interface LoopEngineContext {
  readonly runId: string;
  readonly loopId: string;
  readonly projectId: string;
  readonly actor: string;
  readonly sessionId: string;

  readonly target: RelayLoopTarget;
  /** Server-authoritative. A client-supplied flag is not a gate. */
  readonly features: RelayLoopFeatureFlags;
  /** How the run was triggered. Cron is refused in Stage 2. */
  readonly trigger: 'manual' | 'cli' | 'website' | 'api' | 'cron';
  readonly isSLoop: boolean;
  /** `unsupported` refuses; Stage 2 has no reviewer. */
  readonly reviewerConfiguration: 'not_required' | 'supported' | 'unsupported';

  /** The LIVE contract's binding digest. Compared with the run's. */
  readonly contractBindingDigest: string;
  readonly completionRule: MissionCompletionRule;
  readonly acceptanceCriteria: readonly { readonly id: string; readonly blocking: boolean }[];
  /** The mission verdict engine's answer, when there is one. */
  readonly missionVerdict: MissionVerdict | null;

  readonly requestedAdapterId: string;
  readonly requestedModel: string | null;
  /** The bound for ONE iteration's dispatch, in milliseconds. */
  readonly iterationDeadlineMs: number;
  /** Elapsed run minutes, measured by the caller against the injected clock. */
  readonly elapsedMinutes: number;
}

/* -------------------------------------------------------------- results */

export type LoopEngineOutcome =
  | { readonly kind: 'iteration_recorded'; readonly run: RelayLoopRun; readonly iterationId: string; readonly verdict: RelayLoopCompletionVerdict }
  | { readonly kind: 'terminal'; readonly run: RelayLoopRun; readonly state: RelayLoopRuntimeState }
  | { readonly kind: 'paused'; readonly run: RelayLoopRun }
  | { readonly kind: 'recovery_required'; readonly run: RelayLoopRun | null; readonly report: LoopRecoveryReport }
  | { readonly kind: 'refused'; readonly problem: string; readonly blocker: RelayLoopBlocker | null };

const refuse = (problem: string, blocker: RelayLoopBlocker | null = null): LoopEngineOutcome =>
  ({ kind: 'refused', problem, blocker });

/* ------------------------------------------------------------ preflight */

/**
 * Everything that must be true before an agent is dispatched.
 *
 * Returns a refusal or `null`. Ordered so the most structural objection is
 * reported first: a disabled feature is a different conversation from a
 * multi-role target, and telling someone about the second when the first is
 * also true sends them to fix the wrong thing.
 */
export function preflightLoopDispatch(
  context: LoopEngineContext,
  agent: RelayLoopAgentPort,
  run: RelayLoopRun,
  at: string,
): LoopEngineOutcome | null {
  if (!featureEnabled(context.features, 'loop_engine')) {
    return refuse(
      'The Loop engine is not enabled for this project. Nothing was dispatched.',
      runtimeBlocker(
        { kind: 'feature_disabled', feature: 'loop_engine', detail: 'The Loop engine feature is not enabled on the server.' },
        { observedAt: at },
      ),
    );
  }
  if (context.isSLoop) {
    return refuse('S-Loops are not implemented. This run was not started.');
  }
  if (context.trigger === 'cron') {
    return refuse('Cron-triggered Loop runs are not implemented. This run was not started.');
  }

  const kind = context.target.selector.kind;
  if (kind === 'all_eligible_agents') {
    return refuse(
      'A Loop across all eligible agents needs the multi-agent scheduler, which does not exist yet. '
      + 'The run was refused rather than narrowed to one role.',
    );
  }
  const resolved = context.target.resolvedRoles;
  if (resolved.length !== 1) {
    return refuse(
      `This target resolves to ${resolved.length} roles (${resolved.join(', ') || 'none'}). Stage 2 runs exactly one `
      + 'agent, and silently doing part of what was asked would be worse than refusing.',
    );
  }
  const role = resolved[0];

  if (context.reviewerConfiguration === 'unsupported') {
    return refuse('This Loop requires a Reviewer configuration that is not supported yet.');
  }

  const unavailable = context.target.unavailableRoles.find((u) => u.role === role);
  if (unavailable !== undefined) {
    return refuse(
      `The ${role} role cannot be staffed right now.`,
      runtimeBlocker(
        { kind: 'unavailable_role', role, availability: unavailable.availability },
        { observedAt: at },
      ),
    );
  }
  if (!portSupportsRole(agent, role)) {
    return refuse(
      `The ${agent.adapterId} adapter cannot staff the ${role} role, so nothing was dispatched.`,
      runtimeBlocker(
        { kind: 'unavailable_role', role, availability: 'not_configured' },
        { observedAt: at },
      ),
    );
  }

  if (run.contractBindingDigest !== context.contractBindingDigest) {
    return refuse(
      'The Loop Contract changed after this run started. Continuing would do work nobody approved.',
    );
  }
  // The requested and resolved roles must be the same one. A substitution is a
  // different Loop from the one that was confirmed.
  if (context.target.requestedRoles.length === 1 && context.target.requestedRoles[0] !== role) {
    return refuse(
      `This run was confirmed for ${context.target.requestedRoles[0]} but resolved to ${role}. `
      + 'A substituted role is a different Loop from the approved one.',
    );
  }
  return null;
}

/* --------------------------------------------------------------- limits */

export interface LoopLimitVerdict {
  readonly limit: RelayLoopLimitKind | null;
  /**
   * WHY the run must stop, and they are not the same thing.
   *
   * `reached` — the bound was genuinely consumed. The run ends on that limit's
   * exhaustion state, which is truthful: it ran out of the thing.
   *
   * `unaccountable` — a cap is set and the run CANNOT SAY what it has used.
   * That is not exhaustion and must not be reported as it: nobody ran out of
   * money, the accounting broke. It ends the run as a failure carrying a limit
   * violation, because telling a user "you hit your spending cap" when the real
   * problem is an adapter that reports no cost sends them to raise a limit that
   * was never the obstacle.
   */
  readonly reason: 'reached' | 'unaccountable' | 'within_bounds';
  readonly detail: string;
}

/**
 * Which bound, if any, is already spent.
 *
 * UNKNOWN IS NOT UNDER THE LIMIT. When a cap is set and the run cannot account
 * for what it has used, this reports the limit as reached. That is the fail-
 * closed reading: the alternative is to treat "we do not know what we spent"
 * as "we have not spent anything", which is how a budget is exceeded by an
 * amount nobody can name.
 */
export function checkLoopLimits(run: RelayLoopRun, elapsedMinutes: number): LoopLimitVerdict {
  const budget = run.budget;

  if (budget.maxIterations !== null && budget.iterationsStarted >= budget.maxIterations) {
    return {
      limit: 'iterations',
      reason: 'reached',
      detail: `The iteration limit of ${budget.maxIterations} has been reached.`,
    };
  }
  if (budget.maxTotalDurationMinutes !== null && elapsedMinutes >= budget.maxTotalDurationMinutes) {
    return {
      limit: 'duration',
      reason: 'reached',
      detail: `The run has used its ${budget.maxTotalDurationMinutes}-minute budget.`,
    };
  }
  if (budget.maxTotalTokens !== null) {
    if (budget.tokensUsed === null) {
      return {
        limit: 'tokens',
        reason: 'unaccountable',
        detail:
          `A token cap of ${budget.maxTotalTokens} is set, but this run cannot account for the tokens it has used. `
          + 'Unknown usage is never treated as zero, so the run stops rather than continuing blind.',
      };
    }
    if (budget.tokensUsed >= budget.maxTotalTokens) {
      return { limit: 'tokens', reason: 'reached', detail: `The token cap of ${budget.maxTotalTokens} has been reached.` };
    }
  }
  if (budget.maxProviderCalls !== null && budget.providerCallsUsed >= budget.maxProviderCalls) {
    return {
      limit: 'provider_calls',
      reason: 'reached',
      detail: `The provider-call cap of ${budget.maxProviderCalls} has been reached.`,
    };
  }
  if (budget.maxSpendMicros !== null) {
    if (budget.knownSpendMicros === null) {
      return {
        limit: 'spend',
        reason: 'unaccountable',
        detail:
          'A spending cap is set, but this run cannot account for what it has spent. Unknown spending is never '
          + 'treated as zero, so the run stops rather than continuing blind.',
      };
    }
    if (BigInt(budget.knownSpendMicros) >= BigInt(budget.maxSpendMicros)) {
      return { limit: 'spend', reason: 'reached', detail: 'The spending cap has been reached.' };
    }
  }
  return { limit: null, reason: 'within_bounds', detail: 'Every configured bound still has room.' };
}

/* --------------------------------------------------------------- usage */

/** Translate adapter usage into the execution record, keeping Unknown Unknown. */
function executionUsage(usage: RelayLoopAgentUsage): RelayLoopAgentExecution['usage'] {
  return usage.known
    ? {
        costMicros: usage.costMicros,
        currency: usage.currency,
        modelUnits: usage.tokens,
        providerCalls: usage.providerCalls,
      }
    : {
        // Partial knowledge survives; absent knowledge stays null rather than
        // becoming a confident zero.
        costMicros: null,
        currency: null,
        modelUnits: usage.tokens,
        providerCalls: usage.providerCalls,
      };
}

/* -------------------------------------------------------------- engine */

/**
 * Run ONE iteration, or explain why not.
 *
 * Every append goes through `appendLoopRunEvent`, so a duplicate is recognised
 * and the reducer validates each line before it is written. A refusal at any
 * point leaves the journal exactly as it was.
 */
export async function runLoopIteration(
  deps: LoopEngineDeps,
  context: LoopEngineContext,
): Promise<LoopEngineOutcome> {
  const loaded = readLoopRun(deps.backing, context.runId, deps.digest);
  if (loaded === null) return refuse(`There is no Loop run ${context.runId}.`);
  if (loaded.recoveryRequired || loaded.run === null) {
    const report = classifyLoopRecovery({
      run: loaded.run,
      replayProblems: loaded.problems,
      contractStillBinds: true,
      schemaSupported: true,
      adapterObservable: null,
    });
    return { kind: 'recovery_required', run: loaded.run, report };
  }

  const locked = deps.lock.acquire(context.runId, 'loop-iteration');
  if (!locked.ok) return refuse(locked.problem);

  try {
    return await withLock(deps, context, loaded.run);
  } finally {
    // Always. A lock that outlives its holder blocks the run forever, and the
    // failure mode looks like a hang rather than an error.
    locked.handle.release();
  }
}

async function withLock(
  deps: LoopEngineDeps,
  context: LoopEngineContext,
  loadedRun: RelayLoopRun,
): Promise<LoopEngineOutcome> {
  let run = loadedRun;
  const at = deps.now();

  const append = (
    payload: RelayLoopEventPayload,
    options: { readonly expect?: RelayLoopRuntimeState | null; readonly idempotencyKey?: string } = {},
  ): { ok: true; run: RelayLoopRun } | { ok: false; problem: string } => {
    const base: RelayLoopEventInput = {
      at: deps.now(),
      runId: context.runId,
      loopId: context.loopId,
      projectId: context.projectId,
      kind: payload.kind,
      actor: context.actor,
      recoveryGeneration: run.recoveryGeneration,
      expectedPreviousState: options.expect ?? null,
      idempotencyKey: options.idempotencyKey ?? null,
      payload,
    };
    const result = appendLoopRunEvent(deps.backing, { runId: context.runId, base, digest: deps.digest });
    if (!result.ok) return { ok: false, problem: result.problem };
    run = result.run;
    return { ok: true, run };
  };

  /* ---- a finished run is finished ---- */
  if (isTerminalLoopState(run.state)) {
    return { kind: 'terminal', run, state: run.state };
  }

  /* ---- an uncertain in-flight dispatch is never repeated ---- */
  const inFlight = run.currentIterationId === null
    ? null
    : run.iterations.find((it) => it.iterationId === run.currentIterationId) ?? null;
  if (inFlight?.execution?.outcome === 'unknown') {
    const observed = deps.agent.observe === undefined
      ? null
      : await deps.agent.observe(inFlight.iterationId);
    if (observed === null || observed.state !== 'finished') {
      const report = classifyLoopRecovery({
        run,
        replayProblems: [],
        contractStillBinds: run.contractBindingDigest === context.contractBindingDigest,
        schemaSupported: true,
        adapterObservable: observed === null ? null : false,
      });
      const marked = append({
        kind: 'loop.recovery_required',
        reason: report.detail,
        uncertainIterationId: inFlight.iterationId,
      });
      return { kind: 'recovery_required', run: marked.ok ? marked.run : run, report };
    }
    // The adapter could still be read, so the outcome is known after all and
    // the iteration is closed from what it reported — never from a guess.
    const closed = recordAgentResult(
      append, deps, inFlight.iterationId, inFlight.execution.executionId, observed.result, at,
    );
    if (!closed.ok) return refuse(closed.problem);
    run = closed.run;
  }

  /* ---- control state wins over new work ---- */
  if (run.state === 'stopping') {
    const stopped = append({ kind: 'loop.stopped', reason: run.interruptionReason ?? 'The run was stopped.' });
    if (!stopped.ok) return refuse(stopped.problem);
    return { kind: 'terminal', run: stopped.run, state: 'stopped' };
  }
  if (run.state === 'pausing') {
    // A pause REQUEST is not a pause. Ask the adapter to park, record the safe
    // boundary, and only then say the run is paused.
    const pauseRequestId = latestControlRequestId(deps, context.runId, 'loop.pause_requested');
    if (pauseRequestId === null) {
      // `pausing` with no request behind it means the journal and the state
      // disagree about why the run is here. Parking it anyway would invent a
      // pause nobody asked for.
      return refuse('This run is pausing but no pause request is recorded for it.');
    }

    let parked = true;
    if (deps.agent.requestSafeCheckpoint !== undefined && run.currentIterationId !== null) {
      parked = await deps.agent.requestSafeCheckpoint(run.currentIterationId);
    }
    if (!parked) {
      // THE ADAPTER COULD NOT CONFIRM A SAFE BOUNDARY. Reporting "paused
      // safely" here would tell a user it is safe to walk away while an agent
      // may still be working — and any evidence it produces afterwards would
      // land against a run everyone believes is at rest.
      const uncertain = append({
        kind: 'loop.recovery_required',
        reason:
          'A pause was requested but the adapter could not confirm it reached a safe boundary. The run is held for '
          + 'inspection rather than reported as safely paused.',
        uncertainIterationId: run.currentIterationId,
      });
      if (!uncertain.ok) return refuse(uncertain.problem);
      checkpointLoopRun(deps.backing, context.runId, deps.digest);
      return {
        kind: 'recovery_required',
        run: uncertain.run,
        report: classifyLoopRecovery({
          run: uncertain.run,
          replayProblems: [],
          contractStillBinds: true,
          schemaSupported: true,
          adapterObservable: null,
        }),
      };
    }

    const checkpoint = append({
      kind: 'loop.safe_checkpoint_reached',
      reason: 'safe_pause_reached',
      iterationId: run.currentIterationId,
    });
    if (!checkpoint.ok) return refuse(checkpoint.problem);
    // The landing carries the id of the REQUEST it answers, so a second pause
    // after a resume is a distinct fact rather than a duplicate of this one.
    const paused = append({ kind: 'loop.paused', at, requestId: pauseRequestId });
    if (!paused.ok) return refuse(paused.problem);
    // A corroborating snapshot: status after a restart is then a read rather
    // than a full replay. The journal remains the authority either way.
    checkpointLoopRun(deps.backing, context.runId, deps.digest);
    return { kind: 'paused', run: paused.run };
  }
  if (run.state === 'paused') {
    return { kind: 'paused', run };
  }

  /* ---- preflight ---- */
  const objection = preflightLoopDispatch(context, deps.agent, run, at);
  if (objection !== null) {
    if (objection.kind === 'refused' && objection.blocker !== null) {
      append({ kind: 'loop.blocked', blockers: [objection.blocker] });
    }
    return objection;
  }
  const role = context.target.resolvedRoles[0];

  /* ---- limits, BEFORE anything is dispatched ---- */
  const limit = checkLoopLimits(run, context.elapsedMinutes);
  if (limit.limit !== null) {
    const stopped = landOnLimit(append, deps, limit, null);
    if (!stopped.ok) return refuse(stopped.problem);
    return { kind: 'terminal', run: stopped.run, state: stopped.run.state };
  }

  /* ---- assignment: requested now, actual only once observed ---- */
  if (run.assignment === null) {
    const assigned = append({
      kind: 'loop.agent_assigned',
      assignment: {
        requestedRole: context.target.requestedRoles[0] ?? role,
        resolvedRole: role,
        requestedAdapterId: context.requestedAdapterId,
        actualAdapterId: null,
        actualAgentId: null,
        actualModel: null,
        requestedModel: context.requestedModel,
        assignedAt: at,
      },
    });
    if (!assigned.ok) return refuse(assigned.problem);
  }

  /* ---- open the iteration ---- */
  const iterationId = deps.newId('lpi');
  const ordinal = run.iterations.length + 1;
  const started = append({ kind: 'loop.iteration_started', iterationId, ordinal });
  if (!started.ok) return refuse(started.problem);

  const inputRefs = [`loop-contract:${run.contractRef}@${run.contractVersion}`];
  const prepared = append({ kind: 'loop.agent_request_prepared', iterationId, inputRefs });
  if (!prepared.ok) return refuse(prepared.problem);

  /* ---- the dispatch is recorded BEFORE it happens ---- */
  const executionId = deps.newId('exe');
  const dispatchKey = `${context.runId}:${iterationId}`;
  const dispatched = append({ kind: 'loop.agent_execution_started', iterationId, executionId });
  if (!dispatched.ok) return refuse(dispatched.problem);
  run = dispatched.run;

  const result = await deps.agent.begin({
    runId: context.runId,
    iterationId,
    ordinal,
    idempotencyKey: dispatchKey,
    requestedRole: context.target.requestedRoles[0] ?? role,
    resolvedRole: role,
    requestedAdapterId: context.requestedAdapterId,
    requestedModel: context.requestedModel,
    inputRefs,
    deadlineMs: context.iterationDeadlineMs,
  });

  const recorded = recordAgentResult(append, deps, iterationId, executionId, result, at);
  if (!recorded.ok) return refuse(recorded.problem);
  run = recorded.run;

  /* ---- outcomes that end the run without completing it ---- */
  const ending = endingFor(result.outcome);
  if (ending !== null) {
    const ended = ending === 'timed_out'
      ? append({
          kind: 'loop.timed_out',
          detail: result.failureSummary ?? `Iteration ${ordinal} exceeded its bound.`,
          iterationId,
        })
      : ending === 'stopped'
        ? stopTwoPhase(append, iterationId, result.failureSummary ?? 'The iteration was cancelled.')
        : ending === 'recovery'
          ? append({
              kind: 'loop.recovery_required',
              reason:
                result.failureSummary
                ?? `Iteration ${ordinal} ended in a state the adapter could not describe. It was not retried, `
                  + 'because an operation nobody can account for may already have run.',
              uncertainIterationId: iterationId,
            })
          : append({
              kind: 'loop.failed',
              failure: {
                failureId: deps.newId('flr'),
                kind: failureKindFor(result.outcome),
                summary: result.failureSummary ?? `The iteration ended as ${result.outcome}.`,
                iterationId,
                at: deps.now(),
                recoverable: result.outcome === 'adapter_unavailable',
              },
            });
    if (!ended.ok) return refuse(ended.problem);
    checkpointLoopRun(deps.backing, context.runId, deps.digest);
    return { kind: 'terminal', run: ended.run, state: ended.run.state };
  }

  /* ---- completion is EVALUATED, never accepted ---- */
  const evidence = run.iterations.flatMap((it) =>
    it.observations
      .filter((o) => o.kind === 'evidence_produced')
      .map((o) => ({ evidenceId: o.observationId, sourceTrust: o.sourceTrust, criterionIds: o.criterionIds })),
  );
  const completion = evaluateLoopCompletion({
    completionRule: context.completionRule,
    acceptanceCriteria: context.acceptanceCriteria,
    evidence,
    iterations: run.iterations.map((it) => ({
      iterationId: it.iterationId,
      outcome:
        it.state === 'completed' ? 'completed'
          : it.state === 'failed' ? 'failed'
            : it.state === 'unknown' ? 'unknown'
              : 'completed',
    })),
    missionVerdict: context.missionVerdict,
    openBlockingFindings: 0,
    independentReviewRequired: context.reviewerConfiguration !== 'not_required',
    reviewOccurred: false,
    reviewApproved: false,
    reviewerWasIndependent: false,
    // The terminal write has not happened yet — it happens below, if this
    // evaluation permits it. Claiming otherwise here would be announcing an
    // intention as a fact.
    terminalWriteDurable: true,
  });

  const evaluated = append({
    kind: 'loop.completion_evaluated',
    iterationId,
    verdict: completion.verdict,
    reasons: completion.reasons,
  });
  if (!evaluated.ok) return refuse(evaluated.problem);
  run = evaluated.run;

  if (completion.verdict === 'verified_complete') {
    const completed = append({
      kind: 'loop.completed',
      verdict: 'verified_complete',
      evidenceRefs: evidence.map((e) => e.evidenceId),
    });
    if (!completed.ok) return refuse(completed.problem);
    checkpointLoopRun(deps.backing, context.runId, deps.digest);
    return { kind: 'terminal', run: completed.run, state: 'completed' };
  }

  /* ---- not complete: is there room for another iteration? ---- */
  const nextLimit = checkLoopLimits(run, context.elapsedMinutes);
  if (nextLimit.limit !== null) {
    const stopped = landOnLimit(append, deps, nextLimit, iterationId);
    if (!stopped.ok) return refuse(stopped.problem);
    checkpointLoopRun(deps.backing, context.runId, deps.digest);
    return { kind: 'terminal', run: stopped.run, state: stopped.run.state };
  }

  const scheduled = append({
    kind: 'loop.next_iteration_scheduled',
    decision: {
      decisionId: deps.newId('dcn'),
      iterationId,
      action: 'continue',
      reason: completion.reasons[0] ?? 'The work is not finished.',
      nextState: 'running',
      decidedAt: deps.now(),
    },
  });
  if (!scheduled.ok) return refuse(scheduled.problem);
  checkpointLoopRun(deps.backing, context.runId, deps.digest);
  return {
    kind: 'iteration_recorded',
    run: scheduled.run,
    iterationId,
    verdict: completion.verdict,
  };
}

/**
 * The id of the most recent control request of a given kind.
 *
 * Read from the journal rather than tracked in memory, because the process that
 * answers a pause is frequently not the one that received it — a request
 * arrives on the bridge, and the next engine tick, possibly after a restart, is
 * what actually parks the run.
 */
function latestControlRequestId(
  deps: LoopEngineDeps,
  runId: string,
  kind: 'loop.pause_requested' | 'loop.resume_requested' | 'loop.stop_requested',
): string | null {
  const events = deps.backing.read(runId)?.events ?? [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.kind === kind && 'requestId' in event.payload) {
      return (event.payload as { requestId: string }).requestId;
    }
  }
  return null;
}

/* ------------------------------------------------------------ recording */

type Appender = (
  payload: RelayLoopEventPayload,
  options?: { readonly expect?: RelayLoopRuntimeState | null; readonly idempotencyKey?: string },
) => { ok: true; run: RelayLoopRun } | { ok: false; problem: string };

/**
 * Write down everything the agent reported, in the order that keeps the record
 * honest: WHO answered, then what it said, then claims, then evidence, then how
 * the execution ended with its usage.
 *
 * Claims and evidence are persisted SEPARATELY and neither is folded into the
 * other. A completion claim recorded as evidence would satisfy a completion
 * rule that requires corroboration, which is the specific failure this whole
 * system is built to prevent.
 */
function recordAgentResult(
  append: Appender,
  deps: LoopEngineDeps,
  iterationId: string,
  executionId: string,
  result: RelayLoopAgentResult,
  at: string,
): { ok: true; run: RelayLoopRun } | { ok: false; problem: string } {
  let run: RelayLoopRun | null = null;
  const step = (r: ReturnType<Appender>): boolean => {
    if (!r.ok) return false;
    run = r.run;
    return true;
  };

  // Identity, only if something was actually observed. An all-null report says
  // the adapter could not tell us, and writing that would add no fact.
  if (result.actualAdapterId !== null || result.actualAgentId !== null || result.actualModel !== null) {
    const identity = append({
      kind: 'loop.agent_identity_observed',
      iterationId,
      actualAdapterId: result.actualAdapterId,
      actualAgentId: result.actualAgentId,
      actualModel: result.actualModel,
    });
    if (!step(identity)) return { ok: false, problem: (identity as { problem: string }).problem };
  }

  for (const [index, found] of result.findings.entries()) {
    const observed = append({
      kind: 'loop.output_observed',
      observation: {
        observationId: deps.newId('obs'),
        iterationId,
        kind: found.kind === 'repair_requested' ? 'progress_report' : found.kind,
        sourceTrust: found.trust,
        summary: found.summary,
        evidenceRefs: found.evidenceRefs,
        criterionIds: found.criterionIds,
        observedAt: at,
      },
    });
    if (!step(observed)) return { ok: false, problem: (observed as { problem: string }).problem };

    if (found.kind === 'completion_claim') {
      const claim = append({
        kind: 'loop.completion_claim_recorded',
        iterationId,
        observationId: `claim-${iterationId}-${index}`,
      });
      // A repeated claim within one iteration is not a new fact; the reducer
      // says so and that is not an error worth failing the iteration over.
      if (claim.ok) run = claim.run;
    }
  }

  const evidenceRefs = result.findings.flatMap((f) => f.evidenceRefs);
  if (evidenceRefs.length > 0) {
    const recorded = append({ kind: 'loop.evidence_recorded', iterationId, evidenceRefs });
    if (recorded.ok) run = recorded.run;
  }

  const finished = append({
    kind: 'loop.iteration_finished',
    iterationId,
    execution: {
      // THE SAME id the start event carried. Minting a fresh one here would
      // leave the journal saying one execution began and a different one
      // finished — nothing could be correlated, and duplicate detection keys on
      // this very field, so the retry guard would be watching the wrong subject.
      executionId,
      iterationId,
      startedAt: at,
      finishedAt: deps.now(),
      outcome: result.outcome === 'refused' ? 'refused' : result.outcome,
      usage: executionUsage(result.usage),
      failureSummary: result.failureSummary,
    },
  });
  if (!step(finished)) return { ok: false, problem: (finished as { problem: string }).problem };

  return run === null
    ? { ok: false, problem: 'Nothing about this iteration could be recorded.' }
    : { ok: true, run };
}

/**
 * End the run on a limit — as an exhaustion when it was genuinely consumed, as
 * a failure when the run simply cannot account for what it used.
 *
 * The second case is the one worth being careful about. `budget_exhausted`
 * tells a user to raise a cap. If the real problem is an adapter that reports
 * no cost, raising the cap changes nothing and they will raise it again. So an
 * unaccountable run fails with a limit violation that says what actually
 * happened.
 */
function landOnLimit(
  append: Appender,
  deps: LoopEngineDeps,
  verdict: LoopLimitVerdict,
  iterationId: string | null,
): { ok: true; run: RelayLoopRun } | { ok: false; problem: string } {
  if (verdict.limit === null) return { ok: false, problem: 'No limit to land on.' };
  if (verdict.reason === 'unaccountable') {
    const failed = append({
      kind: 'loop.failed',
      failure: {
        failureId: deps.newId('flr'),
        kind: 'limit_violation',
        summary: verdict.detail,
        iterationId,
        at: deps.now(),
        // Recoverable in principle: an adapter that starts reporting usage, or
        // a cap that is removed, makes this run continuable as a NEW run.
        recoverable: true,
      },
    });
    return failed.ok ? { ok: true, run: failed.run } : { ok: false, problem: failed.problem };
  }
  const reached = append({ kind: 'loop.limit_reached', limit: verdict.limit, detail: verdict.detail });
  return reached.ok ? { ok: true, run: reached.run } : { ok: false, problem: reached.problem };
}

/**
 * Stop in two phases, because a stop is an act with a beginning and an end.
 *
 * Even when the adapter has already cancelled, the journal records the request
 * and then the landing. Jumping straight to `stopped` would produce a record in
 * which the run halted with nobody having asked, and the state machine —
 * correctly — has no such edge.
 */
function stopTwoPhase(
  append: Appender,
  iterationId: string,
  reason: string,
): { ok: true; run: RelayLoopRun } | { ok: false; problem: string } {
  const requested = append({
    kind: 'loop.stop_requested',
    requestedBy: 'relay-engine',
    requestId: `stop-${iterationId}`,
    reason,
  }, { idempotencyKey: `stop-${iterationId}` });
  if (!requested.ok) return requested;
  return append({ kind: 'loop.stopped', reason });
}

/** How the run ends for an outcome that ends it, or `null` to continue. */
function endingFor(
  outcome: RelayLoopAgentResult['outcome'],
): 'failed' | 'timed_out' | 'stopped' | 'recovery' | null {
  switch (outcome) {
    case 'timeout':
      return 'timed_out';
    case 'cancelled':
      return 'stopped';
    case 'refused':
    case 'malformed_output':
    case 'crashed':
    case 'adapter_unavailable':
      return 'failed';
    // An adapter reporting `unknown` is saying it does not know what happened.
    // Recording that as `failed` would assert more than anyone knows — and
    // `failed` is terminal, which would close a run whose work may have
    // succeeded, or may have half-succeeded and spent money doing it. An
    // uncertain operation is a recovery case, exactly as a crash mid-dispatch
    // is, and it waits for a human rather than being decided by a default.
    case 'unknown':
      return 'recovery';
    case 'completed':
      return null;
  }
}

function failureKindFor(outcome: RelayLoopAgentResult['outcome']): 'agent_refused' | 'malformed_output' | 'adapter_failure' {
  if (outcome === 'refused') return 'agent_refused';
  if (outcome === 'malformed_output') return 'malformed_output';
  return 'adapter_failure';
}

/* ------------------------------------------------------------- driving */

/**
 * Iterate until the run settles or the caller's own bound is reached.
 *
 * `maxIterationsThisCall` is a guard on THIS invocation, not a Loop limit. It
 * exists so a bug in the transition logic cannot spin: the run's real bounds
 * live in its budget and are enforced per iteration by `checkLoopLimits`.
 */
export async function runLoopUntilSettled(
  deps: LoopEngineDeps,
  context: LoopEngineContext,
  options: { readonly maxIterationsThisCall: number },
): Promise<{ readonly outcomes: readonly LoopEngineOutcome[]; readonly final: LoopEngineOutcome }> {
  const outcomes: LoopEngineOutcome[] = [];
  let last: LoopEngineOutcome = refuse('The engine was asked for zero iterations.');

  for (let i = 0; i < options.maxIterationsThisCall; i += 1) {
    last = await runLoopIteration(deps, context);
    outcomes.push(last);
    if (last.kind !== 'iteration_recorded') break;
  }
  return { outcomes, final: last };
}
