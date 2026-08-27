/**
 * THE JULIUS RUN LOOP — the application runtime that drives a mission.
 *
 * WHAT IT IS. A bounded, restartable pass: claim what is runnable, put each
 * claimed task through {@link runClaimedTask}, then advance every run it
 * touched. Calling `tick()` repeatedly is what turns a set of components into
 * a system; nothing here holds a run in memory between ticks, so a process
 * that dies mid-tick loses a lease and nothing else.
 *
 * WHAT IT IS NOT. Not a scheduler — `claimRunnable` already is one, with real
 * `FOR UPDATE SKIP LOCKED` leases and a dependency predicate. Not a state
 * machine — `transitionMission` already is one. Not a god class: it sequences
 * two things it does not implement, and the task-level work lives in the
 * pipeline module beside it.
 *
 * DEPENDENCY WAKEUP IS THE CLAIM QUERY'S JOB, and deliberately not this
 * module's. `claimRunnable` refuses any task with an unsatisfied dependency,
 * so a task becomes claimable the moment its last dependency reaches SUCCEEDED
 * or SKIPPED. A second wakeup mechanism here would be a race with the first.
 *
 * BOUNDED BY CONSTRUCTION. One tick claims at most `limit` tasks. There is no
 * `while (true)` anywhere in this file — the caller owns the cadence, so a
 * bad run cannot spin a worker process.
 */

import type { JuliusCardPolicy } from './julius-policy';
import type { JuliusVerificationPolicy } from './julius-verification-runtime';
import { JULIUS_MISSION_STATES, transitionMission, type JuliusMissionState, type JuliusTask } from './julius-runtime';
import { runClaimedTask, type JuliusPipelineDependencies, type JuliusTaskOutcome } from './julius-task-pipeline';
import type { JuliusClaimedTask, JuliusRunRow } from './julius-runtime-ports';

/* ---------------------------------------------------------- policy source */

/**
 * WHERE A RUN'S POLICY COMES FROM.
 *
 * C.A.R.D. policy is NOT PERSISTED by the inherited stack — `julius_runs`
 * stores a `card_revision` and nothing stores the policy that revision names.
 * That is a real gap and it is represented as a PORT rather than papered over
 * with a default: a deployment supplies the policy for a run, and the runtime
 * refuses to proceed when the port cannot answer.
 *
 * `capabilityFor` exists for the same reason: a task's required capability is
 * not a column either, so the deployment that authored the task graph is the
 * one that knows it.
 */
export interface JuliusPolicySource {
  policyFor(run: JuliusRunRow): Promise<{
    readonly card: JuliusCardPolicy;
    readonly verification: JuliusVerificationPolicy;
  } | null>;
  capabilityFor(task: { taskId: string; taskType: string; role: string }): string;
}

/* ----------------------------------------------------------- the reports */

export interface JuliusTickReport {
  readonly claimed: number;
  readonly outcomes: readonly JuliusTaskOutcome[];
  /** One entry per run this tick touched, after advancement. */
  readonly runs: readonly JuliusRunAdvance[];
  /** Runs skipped because no policy could be resolved for them. */
  readonly unresolvedPolicyRunIds: readonly string[];
}

export interface JuliusRunAdvance {
  readonly runId: string;
  readonly from: JuliusMissionState;
  readonly to: JuliusMissionState;
  readonly changed: boolean;
  readonly reasonCode: string;
}

export interface JuliusRunLoopConfig {
  /** Tasks claimed per tick. Bounded by the store at 100. */
  readonly claimLimit: number;
  /** How long a claimed task's lease lasts, in milliseconds. */
  readonly leaseMs: number;
}

/* ------------------------------------------------- the run state decision */

/**
 * WHAT STATE A RUN SHOULD BE IN, GIVEN ITS TASKS.
 *
 * Deliberately a pure function of the task states plus the verification
 * decisions, so the same inputs always produce the same target and a restart
 * recomputes rather than remembers. `transitionMission` then decides whether
 * the move is legal; this function never forces one.
 *
 * ORDER OF PRECEDENCE, and why:
 *   nothing yet          → PLANNING. A run with no tasks has not been planned.
 *   any ACTIVE           → EXECUTING. Work is in flight.
 *   any RUNNABLE         → READY. Work is available and nothing holds it.
 *   any BLOCKED          → WAITING. Everything left is waiting on something.
 *   all terminal, any    → FAILED. A failed task the graph never routed
 *     FAILED               around is a failed run; a repaired one leaves the
 *                          original SUCCEEDED behind it.
 *   all SUCCEEDED/SKIPPED→ VERIFYING. The run is ready to be judged; the
 *                          decision to COMPLETE is `missionMayComplete`'s and
 *                          is taken by the caller with the decisions in hand.
 */
export function targetRunState(tasks: readonly JuliusTask[]): { state: JuliusMissionState; reasonCode: string } {
  if (tasks.length === 0) return { state: 'PLANNING', reasonCode: 'NO_TASKS_PLANNED' };
  if (tasks.some((task) => task.state === 'ACTIVE')) return { state: 'EXECUTING', reasonCode: 'TASKS_ACTIVE' };
  if (tasks.some((task) => task.state === 'RUNNABLE')) return { state: 'READY', reasonCode: 'TASKS_RUNNABLE' };
  if (tasks.some((task) => task.state === 'BLOCKED')) return { state: 'WAITING', reasonCode: 'TASKS_BLOCKED' };
  if (tasks.some((task) => task.state === 'FAILED')) return { state: 'FAILED', reasonCode: 'TASK_FAILED' };
  if (tasks.every((task) => task.state === 'SUCCEEDED' || task.state === 'SKIPPED')) {
    return { state: 'VERIFYING', reasonCode: 'ALL_TASKS_TERMINAL' };
  }
  return { state: 'BLOCKED', reasonCode: 'RUN_CANNOT_PROGRESS' };
}

/**
 * Whether a state move is one `transitionMission` will accept, WITHOUT
 * performing it.
 *
 * The loop must not throw on a legal-but-unreachable target — a run in
 * EXECUTING whose tasks are all RUNNABLE again wants READY, and `EXECUTING →
 * READY` is not in the transition table. That is not an error; it is a target
 * this run cannot take right now, and the honest answer is to leave the run
 * where it is.
 *
 * Implemented by PROBING the domain's own transition function rather than by
 * keeping a copy of its table. A copy is a second source of truth for the one
 * rule the whole state machine rests on.
 */
export function transitionIsLegal(from: JuliusMissionState, to: JuliusMissionState): boolean {
  if (from === to) return false;
  try {
    transitionMission({
      transitionId: 'probe', missionId: 'probe', current: from, to,
      reasonCode: 'probe', safeSummary: 'probe', evidenceIds: [], occurredAt: '1970-01-01T00:00:00.000Z',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * THE LEGAL PATH FROM ONE STATE TO ANOTHER, OR NOTHING.
 *
 * A tick can observe a run after several things have already happened to it. A
 * run sitting in READY whose only task both started and finished inside one
 * tick has a target of VERIFYING — and `READY → VERIFYING` is not in the
 * transition table, because a run reaches VERIFYING by EXECUTING first. The
 * first version of this loop treated that as "target unreachable, leave it
 * alone", which silently stranded every single-task run in READY forever.
 *
 * The honest answer is not to widen the transition table but to WALK it: the
 * run really did execute, so the intermediate transition really did happen and
 * belongs in the audit trail. This is a breadth-first search over the domain's
 * own legality check, so the shortest real path wins and no path is invented.
 * Bounded by the state count, which is why there is no visited-set subtlety
 * and no risk of a long walk.
 */
export function planRunStatePath(
  from: JuliusMissionState,
  to: JuliusMissionState,
): readonly JuliusMissionState[] {
  if (from === to) return [];
  const queue: JuliusMissionState[][] = [[from]];
  const seen = new Set<JuliusMissionState>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const tail = path[path.length - 1]!;
    for (const next of JULIUS_MISSION_STATES) {
      if (seen.has(next) || !transitionIsLegal(tail, next)) continue;
      if (next === to) return [...path.slice(1), next];
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return [];
}

/* -------------------------------------------------------------- the loop */

export class JuliusRunLoop {
  constructor(
    private readonly deps: JuliusPipelineDependencies,
    private readonly policies: JuliusPolicySource,
    private readonly config: JuliusRunLoopConfig,
  ) {
    if (!Number.isSafeInteger(config.claimLimit) || config.claimLimit < 1 || config.claimLimit > 100) {
      throw new Error('invalid_julius_claim_limit');
    }
    if (!Number.isSafeInteger(config.leaseMs) || config.leaseMs < 1) {
      throw new Error('invalid_julius_lease_ms');
    }
  }

  /**
   * ONE BOUNDED PASS.
   *
   * `projectId` is required rather than optional. The store's claim query will
   * happily span every project when given no scope, and a worker that claims
   * across tenants is a tenancy hole disguised as a convenience.
   */
  async tick(scope: { readonly projectId: string }, signal?: AbortSignal): Promise<JuliusTickReport> {
    const now = this.deps.clock.now();
    const leaseExpiresAt = new Date(Date.parse(now) + this.config.leaseMs).toISOString();
    const claims = await this.deps.store.claimRunnable({
      owner: this.deps.owner, now, leaseExpiresAt,
      limit: this.config.claimLimit, projectId: scope.projectId,
    });

    const outcomes: JuliusTaskOutcome[] = [];
    const touchedRunIds = new Set<string>();
    const unresolvedPolicyRunIds = new Set<string>();
    const policyCache = new Map<string, { card: JuliusCardPolicy; verification: JuliusVerificationPolicy } | null>();

    for (const claim of claims) {
      touchedRunIds.add(claim.runId);
      const policy = await this.resolvePolicy(claim, scope, policyCache);
      if (policy === null) {
        unresolvedPolicyRunIds.add(claim.runId);
        // THE LEASE IS HANDED BACK, NOT HELD. A task nobody can supply policy
        // for must become claimable again once the deployment is fixed, and
        // holding the lease until it expires would delay that by the lease
        // duration for no reason.
        await this.deps.store.finishTask({
          taskId: claim.taskId, owner: this.deps.owner, leaseGeneration: claim.leaseGeneration,
          state: 'FAILED', now: this.deps.clock.now(),
        });
        continue;
      }
      outcomes.push(await runClaimedTask({
        claim,
        policy: policy.card,
        verification: policy.verification,
        capability: this.policies.capabilityFor(claim),
        signal,
      }, this.deps, scope));
    }

    const runs: JuliusRunAdvance[] = [];
    for (const runId of touchedRunIds) {
      const advance = await this.advanceRun(runId, scope.projectId);
      if (advance !== null) runs.push(advance);
    }

    return { claimed: claims.length, outcomes, runs, unresolvedPolicyRunIds: [...unresolvedPolicyRunIds] };
  }

  private async resolvePolicy(
    claim: JuliusClaimedTask,
    scope: { projectId: string },
    cache: Map<string, { card: JuliusCardPolicy; verification: JuliusVerificationPolicy } | null>,
  ): Promise<{ card: JuliusCardPolicy; verification: JuliusVerificationPolicy } | null> {
    if (cache.has(claim.runId)) return cache.get(claim.runId) ?? null;
    const run = await this.deps.store.loadRun(claim.runId, scope.projectId);
    const policy = run === null ? null : await this.policies.policyFor(run);
    cache.set(claim.runId, policy);
    return policy;
  }

  /**
   * Move a run to the state its tasks imply, if that move is legal.
   *
   * Uses the run's own `version` as the expected version, so two loops
   * advancing the same run concurrently produce one winner and one
   * `optimistic_concurrency_conflict` — which is reported as `changed: false`
   * rather than thrown, because losing that race is ordinary and the next tick
   * recomputes from the same durable facts.
   */
  async advanceRun(runId: string, projectId: string): Promise<JuliusRunAdvance | null> {
    const run = await this.deps.store.loadRun(runId, projectId);
    if (run === null) return null;

    const tasks = await this.deps.store.tasksForRun(runId, projectId);
    const target = targetRunState(tasks);
    const path = planRunStatePath(run.state, target.state);
    if (path.length === 0) {
      return { runId, from: run.state, to: run.state, changed: false, reasonCode: target.reasonCode };
    }

    let current = run;
    for (const [index, step] of path.entries()) {
      const last = index === path.length - 1;
      try {
        current = await this.deps.store.transition({
          commandId: `advance:${runId}:${current.version}`,
          runId, projectId, expectedVersion: current.version, to: step,
          reasonCode: last ? target.reasonCode : 'PASSED_THROUGH',
          safeSummary: last
            ? `Run advanced to ${step} because ${target.reasonCode}.`
            : `Run passed through ${step} on the way to ${target.state}.`,
          evidenceIds: [], occurredAt: this.deps.clock.now(),
        });
      } catch {
        // Losing the version race is ordinary: another loop advanced this run
        // from the same durable facts. Report what actually landed rather than
        // retrying, because the next tick recomputes.
        return {
          runId, from: run.state, to: current.state,
          changed: current.state !== run.state, reasonCode: 'CONCURRENT_ADVANCE',
        };
      }
    }
    return { runId, from: run.state, to: current.state, changed: true, reasonCode: target.reasonCode };
  }
}
