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
 * DEPENDENCY WAKEUP IS JULIUS'S DECISION, and deliberately not this module's.
 * The claim query offers RUNNABLE tasks whose dependencies have succeeded, and
 * the only path from BLOCKED to RUNNABLE is the pipeline's accepting decision,
 * written together with the tasks it releases. SUCCEEDED alone released work
 * once, and paid run 34037313976 built against an unreviewed plan for it.
 *
 * BOUNDED BY CONSTRUCTION. One tick claims at most `limit` tasks. There is no
 * `while (true)` anywhere in this file — the caller owns the cadence, so a
 * bad run cannot spin a worker process.
 */

import { juliusEitherSignal, keepJuliusLease, type JuliusLeaseRenewalPolicy } from './julius-lease-keeper';
import type { JuliusCardPolicy } from './julius-policy';
import type { JuliusVerificationPolicy } from './julius-verification-runtime';
import { JULIUS_TERMINAL_MISSION_STATES, missionMayComplete, type JuliusMissionState, type JuliusRecordedDecision, type JuliusTask } from './julius-runtime';
import { canStillBeAccepted } from './julius-release-runtime';
import { planRunStatePath, transitionIsLegal } from './julius-state-path';

/**
 * Re-exported so the run loop's own tests and callers keep one import site.
 * The rules themselves live in `julius-state-path.ts`, which the lifecycle
 * runtime shares — two runtimes, one walk of one table.
 */
export { planRunStatePath, transitionIsLegal };
import {
  juliusArchitectureGateFor, juliusFindingsGateFor, prepareClaimedTask, resumeUnverifiedTasks, runClaimedTask, serveArchitectureTriggers,
  type JuliusPipelineDependencies, type JuliusTaskOutcome,
} from './julius-task-pipeline';
import { continuationConcurrency } from './julius-continuation';
import { juliusRunHaltingFailureClass } from './julius-coding-agent';
import type { JuliusClaimedTask, JuliusRecoveryDriver, JuliusRunRow } from './julius-runtime-ports';
import { validateJuliusEvent } from './julius-events';
import { JULIUS_RUNTIME_VERSION } from './julius-runtime';
import { validateTrajectoryEvent, type JuliusTrajectoryEvent, type JuliusTrajectoryKind } from './julius-trajectory';

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
  /** Tasks handed back so one run could not monopolize the tick. */
  readonly yieldedForFairness: number;
  /**
   * Tasks claimed and handed straight back because the run was already at its
   * C.A.R.D. concurrency. Reported rather than hidden: a number that stays
   * high means the claim limit is wider than the runs it serves.
   */
  readonly yieldedForConcurrency: number;
  /**
   * Tasks whose lease was gone by the time this worker tried to admit them —
   * reclaimed by recovery, or taken by another worker after a restart. They
   * were neither run nor finished here, and they spent no execution attempt.
   * Distinct from a hand-back, which this worker chose.
   */
  readonly lostLeases: number;
  /**
   * Tasks a pre-execution gate refused — outside this scope, an unresolvable
   * role, a C.A.R.D. denial, an approval nobody has given, a task that no
   * longer exists. None executed anything, so none spent an execution attempt
   * or took a slot in the run's concurrency allowance for this tick.
   */
  readonly refusedBeforeAdmission: number;
}

export interface JuliusRunAdvance {
  readonly runId: string;
  readonly from: JuliusMissionState;
  readonly to: JuliusMissionState;
  readonly changed: boolean;
  readonly reasonCode: string;
  /**
   * VERIFICATIONS THIS CALL RESUMED, and a separate field rather than a wider
   * `changed`.
   *
   * `changed` means the RUN STATE moved, and resuming a verification often does
   * not move it — an accepted plan releases a BLOCKED build while the run stays
   * READY, which is correct. A driver reading `changed` alone would call that a
   * stall on the very tick that unblocked the run, so the two facts are
   * reported separately and a driver treats either as progress.
   */
  readonly resumedVerifications: number;
}

export interface JuliusRunLoopConfig {
  /** Tasks claimed per tick. Bounded by the store at 100. */
  readonly claimLimit: number;
  /** How long a claimed task's lease lasts, in milliseconds. */
  readonly leaseMs: number;
  /**
   * ADMISSION: the most tasks one RUN may take from a single tick.
   *
   * Without it, a run with three hundred runnable tasks fills every claim and
   * a run with one waits behind it — not because it was lower priority but
   * because it was smaller. The C.A.R.D. concurrency bound does not solve
   * this: a generous C.A.R.D. is exactly the case where one run can take
   * everything.
   *
   * `null` means no per-run share, which is right for a worker dedicated to
   * one run and wrong for a shared pool. There is no default share, because a
   * fairness policy nobody chose is a fairness policy nobody can reason about.
   */
  readonly perRunShare?: number | null;
  /**
   * RENEWAL OF WHAT THIS LOOP HOLDS. With it, an admitted task's lease is
   * renewed from admission until the task is finished, never past the hold
   * bound its policy derives, and a lease the store says is gone aborts the
   * dispatch. Without it a lease lasts exactly `leaseMs` from the claim, which
   * is right for a proof and wrong for any worker slower than its lease.
   */
  readonly leaseRenewal?: JuliusLeaseRenewalPolicy;
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
 *   any LIVE BLOCKED     → WAITING. Something left is waiting on work that
 *                          can still arrive. A task blocked on a dependency
 *                          that has already FAILED or been CANCELLED is not
 *                          waiting for anything — see `stillReachable` — and
 *                          does not hold the run here.
 *   any FAILED           → FAILED. A failed task the graph never routed
 *                          around is a failed run; a repaired one leaves the
 *                          original SUCCEEDED behind it.
 *   all SUCCEEDED/SKIPPED→ VERIFYING. The run is ready to be judged; the
 *                          decision to COMPLETE is `missionMayComplete`'s and
 *                          is taken by the caller with the decisions in hand.
 */
/**
 * COULD THIS TASK STILL REACH SUCCEEDED?
 *
 * A claim is only offered to a task whose every dependency is SUCCEEDED or
 * SKIPPED, and a FAILED task is terminal: `finishTask` moves it back to
 * RUNNABLE only when the caller supplies a next attempt time in the same call,
 * and recovery requeues only ACTIVE tasks whose lease expired. So a task
 * blocked behind a FAILED or CANCELLED dependency can never be claimed again,
 * however many ticks it is given.
 *
 * THE FIRST PAID MISSION IS WHY THIS EXISTS. Its `plan` task failed and its
 * dependent `build` task stayed BLOCKED, so `any BLOCKED → WAITING` kept
 * answering WAITING while nothing could ever move. The run reported "stalled
 * before terminal state" instead of FAILED, which reads as a runtime that lost
 * track rather than a mission that failed.
 *
 * Cycles are structurally impossible in the DURABLE stores these tasks are
 * read from: both `addTask` implementations refuse a dependency that does not
 * already exist — PostgreSQL by foreign key plus
 * `CHECK(task_id<>dependency_task_id)`, the memory store by an explicit
 * `task_reference_not_found` throw — and a task's dependencies are written
 * only when that task is created, so no back-edge can ever appear. (An earlier
 * comment here cited `JuliusTaskGraph.add`, which nothing on this path
 * instantiates.) A cycle would be unsatisfiable anyway, so re-entry answers
 * false and the walk terminates on any input. `visiting` is a path stack and `settled` a memo:
 * without the memo a diamond-shaped graph is walked once per path to each
 * node, and this runs on every advance.
 */
function stillReachable(
  task: JuliusTask,
  byId: ReadonlyMap<string, JuliusTask>,
  visiting: Set<string> = new Set(),
  settled: Map<string, boolean> = new Map(),
  acceptable: (taskId: string) => boolean = () => true,
): boolean {
  if (task.state === 'SKIPPED') return true;
  /**
   * SUCCEEDED IS NOT ACCEPTED. A dependent is released only when Julius
   * accepts its dependency, so a SUCCEEDED dependency whose acceptance can no
   * longer happen — its review FAILED and nothing else can decide it, or its
   * decision is a HALT — leaves the dependent as dead as a FAILED one would.
   * `canStillBeAccepted` says which; without it (the pure-graph callers)
   * SUCCEEDED counts as reachable, exactly as before.
   */
  if (task.state === 'SUCCEEDED') return acceptable(task.taskId);
  if (task.state === 'FAILED' || task.state === 'CANCELLED') return false;
  if (task.state !== 'BLOCKED') return true;
  const memo = settled.get(task.taskId);
  if (memo !== undefined) return memo;
  if (visiting.has(task.taskId)) return false;
  visiting.add(task.taskId);
  try {
    const reachable = task.dependencyIds.every((id) => {
      const dependency = byId.get(id);
      // A dependency the run does not hold can never become SUCCEEDED here,
      // so the task waiting on it is not waiting for anything either.
      return dependency !== undefined && stillReachable(dependency, byId, visiting, settled, acceptable);
    });
    settled.set(task.taskId, reachable);
    return reachable;
  } finally {
    visiting.delete(task.taskId);
  }
}

export function targetRunState(
  tasks: readonly JuliusTask[],
  decisions: readonly JuliusRecordedDecision[] = [],
): { state: JuliusMissionState; reasonCode: string } {
  if (tasks.length === 0) return { state: 'PLANNING', reasonCode: 'NO_TASKS_PLANNED' };
  if (tasks.some((task) => task.state === 'ACTIVE')) return { state: 'EXECUTING', reasonCode: 'TASKS_ACTIVE' };
  if (tasks.some((task) => task.state === 'RUNNABLE')) return { state: 'READY', reasonCode: 'TASKS_RUNNABLE' };
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const settled = new Map<string, boolean>();
  const acceptable = canStillBeAccepted(tasks, decisions);
  if (tasks.some((task) => task.state === 'BLOCKED' && stillReachable(task, byId, new Set(), settled, acceptable))) {
    return { state: 'WAITING', reasonCode: 'TASKS_BLOCKED' };
  }
  if (tasks.some((task) => task.state === 'FAILED')) return { state: 'FAILED', reasonCode: 'TASK_FAILED' };
  if (tasks.every((task) => task.state === 'SUCCEEDED' || task.state === 'SKIPPED')) {
    /**
     * A RUN COULD NEVER REACH COMPLETED, and the event-coverage audit is what
     * found it: `run.completed` was in the catalogue and nothing emitted it,
     * because nothing called `missionMayComplete`. Every run stopped at
     * VERIFYING and stayed there — the last state before the one that matters.
     *
     * The rule lives on `missionMayComplete` and is not restated here. It
     * requires the run to be VERIFYING, every task terminal, at least one
     * decision, and every task's CURRENT decision effectively accepted: an
     * ACCEPT outright, or a REPAIR superseded by its own planner-shaped
     * repair lineage reaching an effective ACCEPT. A HALT — or a REPAIR
     * nobody repaired — keeps the run in VERIFYING, which is the honest
     * answer rather than a completion that ignores a decision; history
     * itself is never rewritten to get past one.
     */
    if (missionMayComplete({ state: 'VERIFYING', tasks, decisions })) {
      return { state: 'COMPLETED', reasonCode: 'MISSION_VERIFIED' };
    }
    return { state: 'VERIFYING', reasonCode: 'ALL_TASKS_TERMINAL' };
  }
  return { state: 'BLOCKED', reasonCode: 'RUN_CANNOT_PROGRESS' };
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
    const renewal = config.leaseRenewal;
    if (renewal !== undefined && (!Number.isSafeInteger(renewal.renewEveryMs) || renewal.renewEveryMs < 1 || renewal.renewEveryMs >= config.leaseMs)) {
      throw new Error('invalid_julius_lease_renewal_interval');
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
    /**
     * RECOVERY IS THE KERNEL'S, NOT THE DRIVER'S.
     *
     * An expired lease is no longer reclaimable by the claim query: that path
     * raised only `lease_generation`, so a task claimed and dead before
     * admission could be picked up forever, bypassing `recoveries` and its
     * ceiling. The sweep is the one way back — it counts the reclaim, bounds
     * it, writes the `recovery.action` row that explains it, and leaves the
     * task RUNNABLE for an ordinary claim below.
     *
     * It runs HERE rather than in a driver so no future caller can bypass the
     * invariant by ticking differently. `driveJuliusRunToTerminal` owned this
     * call and no longer does — a store-level guarantee should not depend on
     * one composition root remembering to make it, and that driver also passed
     * the sweep's default limit where this passes the claim limit, so the bound
     * the comments advertised was not the one the live path applied.
     */
    await this.recover(scope, this.deps.store, this.config.claimLimit);

    // AFTER THE SWEEP, deliberately. A recovered task is given a next attempt
    // time from the clock the sweep read, so a `now` captured before it would
    // be older and the claim below would refuse the very task just recovered —
    // making a reclaim take one extra tick for no reason.
    const now = this.deps.clock.now();
    const leaseExpiresAt = new Date(Date.parse(now) + this.config.leaseMs).toISOString();
    const claimed = await this.deps.store.claimRunnable({
      owner: this.deps.owner, now, leaseExpiresAt,
      limit: this.config.claimLimit, projectId: scope.projectId,
    });

    /* ------------------------------------------------------- admission --- */
    /**
     * ROUND-ROBIN, NOT FIRST-COME. The claim query orders by run creation then
     * ordinal, so a large old run is offered first and would take the whole
     * tick. Interleaving by run before anything executes gives every run in
     * the batch a turn, and the share caps how many turns one run gets.
     *
     * Anything over the share is handed BACK immediately rather than held, so
     * another worker can take it in the same instant instead of waiting out a
     * lease. `yieldedForFairness` reports how many, because a number that
     * stays high means the claim limit is wider than the share.
     */
    const byRun = new Map<string, JuliusClaimedTask[]>();
    for (const claim of claimed) {
      const bucket = byRun.get(claim.runId);
      if (bucket) bucket.push(claim); else byRun.set(claim.runId, [claim]);
    }
    const share = this.config.perRunShare ?? null;
    const admitted: JuliusClaimedTask[] = [];
    const yielded: JuliusClaimedTask[] = [];
    let round = 0;
    let remaining = true;
    while (remaining) {
      remaining = false;
      for (const bucket of byRun.values()) {
        const next = bucket[round];
        if (next === undefined) continue;
        remaining = true;
        if (share !== null && round >= share) yielded.push(next); else admitted.push(next);
      }
      round += 1;
    }
    for (const claim of yielded) {
      await this.deps.store.finishTask({
        taskId: claim.taskId, owner: this.deps.owner, leaseGeneration: claim.leaseGeneration,
        state: 'FAILED', now: this.deps.clock.now(), nextAttemptAt: this.deps.clock.now(),
      });
    }
    const claims = admitted;

    const outcomes: JuliusTaskOutcome[] = [];
    const touchedRunIds = new Set<string>();
    const unresolvedPolicyRunIds = new Set<string>();
    const policyCache = new Map<string, { card: JuliusCardPolicy; verification: JuliusVerificationPolicy } | null>();

    // Per-run in-flight counts, read ONCE before anything is executed. The
    // C.A.R.D. concurrency bound is about a run, not about a worker process,
    // so N workers each running the run's full allowance would be N times the
    // width C.A.R.D. granted.
    const inFlight = new Map<string, number>();
    let yieldedForConcurrency = 0;
    let lostLeases = 0;
    let refusedBeforeAdmission = 0;

    for (const claim of claims) {
      touchedRunIds.add(claim.runId);
      const policy = await this.resolvePolicy(claim, scope, policyCache);
      if (policy === null) {
        unresolvedPolicyRunIds.add(claim.runId);
        // THE LEASE IS RELEASED, AND THE TASK IS FAILED — not handed back.
        // This call passes no next attempt time, so under the rule both stores
        // now share it ends the task rather than requeueing it, and a FAILED
        // task is claimable by nobody. That is deliberate: a task nobody can
        // supply policy for would otherwise be claimed, refused and released on
        // every tick forever. Releasing the lease immediately still beats
        // holding it until it expires. (An earlier comment here claimed the
        // task became claimable again; it never did.)
        await this.deps.store.finishTask({
          taskId: claim.taskId, owner: this.deps.owner, leaseGeneration: claim.leaseGeneration,
          state: 'FAILED', now: this.deps.clock.now(),
        });
        continue;
      }
      if (!inFlight.has(claim.runId)) {
        // The claim itself already moved this task to ACTIVE, so the stored
        // count includes it — the allowance is compared against the count
        // BEFORE this tick's claims, which is what the subtraction recovers.
        const active = await this.deps.store.activeTaskCount(claim.runId, scope.projectId);
        inFlight.set(claim.runId, active - claims.filter((other) => other.runId === claim.runId).length);
      }
      const running = inFlight.get(claim.runId)!;
      const allowance = continuationConcurrency(policy.card);
      if (running >= allowance) {
        // HANDED BACK, NOT HELD. The task returns to RUNNABLE immediately so
        // another worker — or this one on its next tick — can take it as soon
        // as the run has room, rather than waiting out the lease.
        await this.deps.store.finishTask({
          taskId: claim.taskId, owner: this.deps.owner, leaseGeneration: claim.leaseGeneration,
          state: 'FAILED', now: this.deps.clock.now(), nextAttemptAt: this.deps.clock.now(),
        });
        yieldedForConcurrency += 1;
        continue;
      }
      /* ------------------------------------------ pre-execution gates first */
      /**
       * EVERY REFUSAL IS ANSWERED BEFORE AN ATTEMPT IS SPENT.
       *
       * The two questions above — can policy be resolved for this run, does
       * the run have room — are answered by handing the task BACK. The gates
       * below can refuse it outright: a run outside this scope, a role Julius
       * cannot resolve, a C.A.R.D. that denies the dispatch or the capability,
       * an approval nobody has given, a task that no longer exists. None of
       * those is a worker execution, and while admission ran before them each
       * one spent an attempt on work Julius had just decided not to do.
       *
       * The policy is evaluated in ONE place — `prepareClaimedTask` — and this
       * loop reads the verdict off the type rather than re-deciding it.
       */
      const request = {
        claim, policy: policy.card, verification: policy.verification,
        capability: this.policies.capabilityFor(claim), signal,
        // The pipeline needs to answer "could a repair of this be routed?"
        // for a task that does not exist yet, so the resolver travels with it.
        capabilityFor: (task: { taskId: string; taskType: string; role: string }) => this.policies.capabilityFor(task),
      };
      const preflight = await prepareClaimedTask(request, this.deps, scope);
      if (preflight.kind === 'REFUSED') {
        // No execution happened, so no attempt is spent. An unresolvable role,
        // a C.A.R.D. denial and an unlocked contract END the task. A
        // governance hold does not: a C.A.R.D. approval gate records a PENDING
        // approval and holds the run BLOCKED, and a run found held at the
        // dispatch boundary (paused, blocked, awaiting an approval) keeps its
        // task — both hand it back RUNNABLE for the claim after the hold lifts.
        // The two that write nothing — a run outside this scope, and a task
        // that has vanished from its run — leave the lease to expire and the
        // sweep to reclaim it. Neither is reachable from a real claim: the
        // claim query is scoped by project, and a claimed task is in
        // `tasksForRun` by construction.
        refusedBeforeAdmission += 1;
        outcomes.push(preflight.outcome);
        continue;
      }

      /* ------------------------------------------------- execution admission */
      /**
       * EVERY GATE THAT CAN REFUSE CHEAPLY HAS ANSWERED; THIS TASK IS GOING
       * TO RUN.
       *
       * Two refusals still follow, and both are deliberate: the router refuses
       * when C.A.R.D. denies every eligible PROVIDER, and the coordinator
       * refuses when the budget is spent. Each ends the task after one attempt
       * rather than looping, and each needs the worker set or the reservation
       * that only exist past this point.
       *
       * The attempt is spent here rather than by the claim because the live
       * topology hands tasks back routinely — a claim limit of 4 against a
       * C.A.R.D. concurrency of 1 — so a task could be yielded twice and
       * reach its FIRST real dispatch on attempt 3 of 3, where a rate limit is
       * refused as exhausted without one provider call. (Before the release
       * rule, `build` and the plan's review were both claimable on the tick
       * after the plan succeeded; now only what Julius released is.)
       *
       * `null` means the lease moved while we decided. The task is somebody
       * else's now: do not run it, and do not finish it either, because
       * finishing needs the generation we no longer hold.
       */
      const attempt = await this.deps.store.admitTask({
        taskId: claim.taskId, owner: this.deps.owner,
        leaseGeneration: claim.leaseGeneration, now: this.deps.clock.now(),
      });
      if (attempt === null) {
        lostLeases += 1;
        continue;
      }
      /**
       * THE LEASE IS RENEWED FROM ADMISSION, not trusted from the claim. A task
       * queued behind another in this tick spent its lease waiting; the first
       * renewal gives it a whole one before any work starts, and a store that
       * says the lease is already gone means the task is not run at all.
       */
      const renewal = this.config.leaseRenewal;
      const keeper = renewal === undefined ? null : keepJuliusLease({
        store: this.deps.store, clock: this.deps.clock,
        ...(renewal.timers === undefined ? {} : { timers: renewal.timers }),
        taskId: claim.taskId, owner: this.deps.owner, leaseGeneration: claim.leaseGeneration,
        leaseMs: this.config.leaseMs, renewEveryMs: renewal.renewEveryMs,
        holdUntilMs: Date.parse(this.deps.clock.now()) + renewal.holdBoundMsFor(claim),
      });
      if (keeper !== null && !(await keeper.renewNow())) {
        await keeper.stop();
        lostLeases += 1;
        continue;
      }

      // COUNTED ONLY ONCE THE TASK IS REALLY RUNNING. Counted before the
      // admission, a lease lost between the two would hold a slot in this
      // run's allowance for work nobody is doing, and the next claim in the
      // same tick would be handed back to make room for it.
      inFlight.set(claim.runId, running + 1);

      // A LOST LEASE ENDS THE DISPATCH, whichever signal fires first.
      const linked = keeper === null ? null : juliusEitherSignal(signal, keeper.signal);
      try {
        outcomes.push(await runClaimedTask({
          // The claim carried the count BEFORE this admission. Everything
          // downstream — the retry ceiling, the operation id that makes a
          // repeated dispatch idempotent, the resource estimate — must read the
          // attempt actually being run.
          ...request, ...(linked === null ? {} : { signal: linked.signal }), claim: { ...claim, attempt },
        }, this.deps, preflight));
      } finally {
        linked?.detach();
        await keeper?.stop();
      }
    }

    /**
     * ONLY THE RUNS THIS TICK TOUCHED, WHICH IS NOT EVERY RUN THAT NEEDS ONE.
     *
     * A run whose only outstanding task is SUCCEEDED-and-undecided — the state
     * a crash between `acceptWorkerResult` and the decision leaves — has
     * nothing claimable and no lease to sweep, so it is never touched here and
     * `advanceRun` never runs the verification it is owed.
     *
     * THAT IS A LIMIT OF `tick`, NOT A DEFECT IN THE RUNTIME, because no
     * production caller uses `tick` alone: `driveJuliusRunToTerminal` calls
     * `advanceRun` explicitly whenever a tick claimed nothing, for exactly this
     * window. A future scheduler that calls `tick` on its own must do the same,
     * or a paid answer will sit verified by nobody. Making `tick` self
     * sufficient would mean enumerating runs with stranded verifications, which
     * is a store query that does not exist yet and should be added deliberately
     * rather than inferred from a loop that happens to be here.
     *
     * `julius-chaos.test.ts` drives the resume the way that driver does, so it
     * tests the contract production relies on rather than a shape nothing uses.
     */
    const runs: JuliusRunAdvance[] = [];
    for (const runId of touchedRunIds) {
      const advance = await this.advanceRun(runId, scope.projectId);
      if (advance !== null) runs.push(advance);
    }

    return {
      // The number the STORE handed over, not the number admitted. Reporting
      // only the admitted count would hide the whole point of the share: that
      // the claim limit is wider than the runs it serves.
      claimed: claimed.length, outcomes, runs,
      unresolvedPolicyRunIds: [...unresolvedPolicyRunIds], yieldedForConcurrency,
      yieldedForFairness: yielded.length, lostLeases, refusedBeforeAdmission,
    };
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
   * Run any verification this run is owed. Returns how many tasks were
   * verified, so the caller can re-read only when something changed.
   *
   * A run whose policy cannot be resolved is left alone rather than verified
   * under a guess: the verification policy decides whether a review is required
   * and how many repair rounds are authorised, and inventing one would be
   * Julius deciding a mission's terms for it.
   */
  async #resumeVerifications(
    run: JuliusRunRow,
    tasks: readonly JuliusTask[],
    decisions: readonly JuliusRecordedDecision[],
    projectId: string,
  ): Promise<number> {
    const policy = await this.policies.policyFor(run);
    if (policy === null) return 0;
    const outcomes = await resumeUnverifiedTasks({
      deps: this.deps, run, policy: policy.card, verification: policy.verification, tasks, decisions,
      // A resumed decision may be REPAIR, and a repair is proven routable
      // before it exists — which needs the capability its task WOULD require.
      // Without this the routability proof would be skipped on exactly the path
      // that produced paid run 34037313976's unroutable `repair:plan`.
      capabilityFor: (task) => this.policies.capabilityFor(task),
    });
    void projectId;
    return outcomes.length;
  }

  /**
   * One trajectory fact about a run, with the versions every eval groups by.
   *
   * `#`-private: it is not part of the loop's surface, and a `private` helper
   * would still be callable from JavaScript.
   */
  async #trajectory(
    run: JuliusRunRow,
    kind: JuliusTrajectoryKind,
    input: {
      taskId?: string | null; outcome?: string | null; durationMs?: number | null;
      usdMicros?: number | null; facts?: Record<string, string | number | boolean | null>;
      /**
       * Distinguishes rows a run VERSION cannot. A recovery does not change the
       * run's version, so without this every action in a sweep shares one key
       * and the writers — which dedupe on it — keep the first and drop the rest.
       */
      idempotencySuffix?: string;
    },
  ): Promise<void> {
    const event: JuliusTrajectoryEvent = {
      trajectoryEventId: this.deps.ids.next(`trajectory:${kind}`),
      runId: run.runId, projectId: run.projectId, kind,
      taskId: input.taskId ?? null, workerId: null, providerId: null, contextId: null,
      runtimeVersion: JULIUS_RUNTIME_VERSION,
      // The run's own C.A.R.D. revision doubles as the policy version here:
      // nothing stores a separate policy version, and inventing one would put
      // a value in every eval that means nothing.
      policyVersion: run.cardRevision,
      cardRevision: run.cardRevision,
      missionContractRevision: run.missionContractRevision,
      projectBrainRevision: run.projectBrainRevision,
      // UNKNOWN IS NULL. A duration or cost this loop did not observe is not
      // zero, and writing zero would make an eval average a lie.
      durationMs: input.durationMs ?? null, usdMicros: input.usdMicros ?? null,
      inputTokens: null, outputTokens: null,
      outcome: input.outcome ?? null, safeFacts: input.facts ?? {},
      idempotencyKey: `${run.runId}:${kind}:${run.version}${input.idempotencySuffix === undefined ? '' : `:${input.idempotencySuffix}`}`,
      occurredAt: this.deps.clock.now(),
    };
    validateTrajectoryEvent(event);
    await this.deps.store.appendTrajectory(event);
  }

  /**
   * ONE BOUNDED RECOVERY SWEEP.
   *
   * `recoverExpired` was written in #173 and never called. The runtime worked
   * without it because the claim query ALSO offered an expired ACTIVE task —
   * a reclaim that counted nothing, so its absence lost every RECOVERY FACT
   * (what was requeued, what was abandoned, how a run reached the state an
   * operator is looking at) AND left the churn unbounded. That branch is gone,
   * so this is the only way back from an expired lease.
   *
   * `tick()` calls it before it claims. An earlier version of this comment
   * said the two were separate on purpose, so a deployment could choose its
   * own cadence; that made a store-level guarantee depend on whichever driver
   * remembered to sweep, which is not a choice worth offering.
   */
  async recover(
    scope: { readonly projectId: string },
    driver: JuliusRecoveryDriver,
    limit = 100,
  ): Promise<{ readonly actions: number; readonly requeued: number; readonly abandoned: number }> {
    const now = this.deps.clock.now();
    const actions = await driver.recoverExpired(now, limit, scope.projectId);
    let requeued = 0;
    let abandoned = 0;
    for (const action of actions) {
      if (action.action === 'REQUEUE') requeued += 1; else abandoned += 1;
      // `RESUME_RUN` is about the run and names no task; the event still
      // records it, with a null task, rather than being dropped for the shape
      // of its subject.
      const run = await this.deps.store.loadRun(action.runId, scope.projectId);
      if (run === null) continue;    // another tenant's task; nothing is written
      const event = {
        eventId: this.deps.ids.next('event:recovery.action'),
        runId: run.runId, projectId: run.projectId, type: 'recovery.action' as const,
        taskId: action.taskId, workerId: null,
        // A `RESUME_RUN` action names no task, so the run correlates it. A
        // null correlation id would fail `validateJuliusEvent`, which is the
        // right refusal — an event nothing can be correlated by is an event
        // nobody can follow.
        correlationId: action.taskId ?? run.runId, causationId: null,
        occurredAt: this.deps.clock.now(),
        facts: { action: action.action, reasonCode: action.reasonCode, owner: this.deps.owner },
      };
      validateJuliusEvent(event);
      await this.deps.store.appendEvent(event);
      // KEYED BY THE ACTION, NOT THE RUN VERSION. A recovery does not change
      // the run's version, and the trajectory writers dedupe on that key — so a
      // sweep that recovered ten tasks recorded one row, and consecutive sweeps
      // between transitions recorded none after the first. Newly reachable,
      // because nothing called this before the live driver began sweeping.
      await this.#trajectory(run, 'RECOVERY', {
        taskId: action.taskId, outcome: action.action,
        facts: { reasonCode: action.reasonCode },
        // THE LEASE GENERATION IS THE DISCRIMINATOR, because it is the one
        // value that differs between two reclaims of the SAME task for the
        // SAME reason. Task and reason alone still collapsed that case — every
        // REQUEUE carries LEASE_EXPIRED, and a recovery does not bump the run's
        // version — so a task crash-looping before admission recorded one row
        // for three recoveries, and the eval metric that counts them
        // under-reported in exactly the scenario recovery exists for. Each
        // reclaim follows its own claim, so each carries its own generation.
        idempotencySuffix: `${action.taskId ?? run.runId}:${action.reasonCode}:${action.expectedLeaseGeneration ?? 'none'}`,
      });
    }
    return { actions: actions.length, requeued, abandoned };
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

    let [tasks, decisions] = await Promise.all([
      this.deps.store.tasksForRun(runId, projectId),
      this.deps.store.decisionsForRun(runId, projectId),
    ]);

    /**
     * A RECORDED DENIAL ENDS THE RUN, WHATEVER ELSE HOLDS IT.
     *
     * `decideJuliusApproval` writes DENIED and then moves the run to FAILED, and
     * that move can lose a version race: a concurrent advance walks BLOCKED ->
     * READY between the two, and the FAILED move is not retried. The claim
     * refuses a run holding a DENIED approval, so nothing ran. But the run then
     * sat READY for ever: the denial was invisible, and the drive "stalled" with
     * no cause. So the denial is enacted here, before the pause and the pending
     * holds (a denied run is not waiting on anyone) and before the verification
     * sweep (which dispatches a reviewer).
     */
    const deniedApprovals = this.deps.store.deniedApprovals;
    if (!JULIUS_TERMINAL_MISSION_STATES.includes(run.state) && deniedApprovals !== undefined
      && (await deniedApprovals.call(this.deps.store, runId, projectId)).length > 0) {
      return this.#applyTarget(run, { state: 'FAILED', reasonCode: 'APPROVAL_DENIED' }, tasks, decisions, 0);
    }

    /**
     * A CODER ANSWERED BY A MODEL IT DID NOT ASK FOR ENDS THE RUN, NOT ONLY ITS
     * TASK (`JULIUS_RUN_HALTING_FAILURE_CLASSES`; founder rule, 2026-09-30).
     *
     * The failed task alone was not a stop:
     *  - the task graph read FAILED as the generic `TASK_FAILED`;
     *  - while any sibling was RUNNABLE the target was READY, so the next claim
     *    sent that sibling to the same mis-serving path.
     * So the recorded class is enacted here, the way a denial is:
     *  - read off the `task.failed` rows that already exist, never written as a
     *    decision no verifier made;
     *  - before the pause and pending holds and before the verification sweep;
     *  - FAILED, with the class as the run's own reason, which `run.failed`
     *    then carries;
     *  - one winner under the same version race as the denial.
     * The dispatch boundary refuses the run's claims meanwhile, so a sibling
     * claimed before this lands is ended, never dispatched.
     */
    const haltingFailureClasses = this.deps.store.haltingFailureClasses;
    if (!JULIUS_TERMINAL_MISSION_STATES.includes(run.state) && haltingFailureClasses !== undefined) {
      const [halting] = (await haltingFailureClasses.call(this.deps.store, runId, projectId))
        .map(juliusRunHaltingFailureClass).filter((value): value is string => value !== null);
      if (halting !== undefined) return this.#applyTarget(run, { state: 'FAILED', reasonCode: halting }, tasks, decisions, 0);
    }

    /**
     * A VERIFICATION THAT NEVER RAN IS RESUMED BEFORE THE STATE IS COMPUTED.
     *
     * A process that dies between `acceptWorkerResult` and the decision leaves
     * a SUCCEEDED task nothing will look at again — the claim query offers
     * RUNNABLE tasks only — and the run parks in VERIFYING permanently. It
     * parks honestly, which is why nothing detected it: no false completion,
     * just a mission that never finishes.
     *
     * HERE, rather than in `tick`, because a stranded run has no claimable task
     * and a tick that claims nothing never names it. `advanceRun` is called
     * with the run id by exactly the caller that has noticed nothing moved, so
     * this is where the question "is anything owed on this run?" can be asked
     * at all.
     *
     * AND BEFORE `targetRunState`, because a resumed decision can release a
     * BLOCKED task, schedule a repair or complete the run — computing the
     * target from the pre-resume rows would report the stall this just cleared.
     */
    /**
     * A TERMINAL RUN IS FINISHED TRUTH, AND THE SWEEP DOES NOT TOUCH IT.
     *
     * Without this, advancing a run that had already COMPLETED, FAILED or been
     * CANCELLED still re-ran the verification sweep. Work whose review FAILED
     * is SUCCEEDED-and-undecided for good — no review can conclude now — so it
     * was stranded on every pass, and every pass wrote another `review.started`
     * saying exactly what the one before it said: eighty of them in the probe
     * that found this, under eighty different event ids.
     *
     * The live driver returns as soon as a run is terminal, which is why
     * nothing had run into it; that is a property of one caller, not of the
     * run. Nothing a finished run owes can still be paid, so nothing is owed.
     */
    if (JULIUS_TERMINAL_MISSION_STATES.includes(run.state)) {
      return { runId, from: run.state, to: run.state, changed: false, reasonCode: 'RUN_TERMINAL', resumedVerifications: 0 };
    }

    /**
     * A PAUSED RUN IS HELD BY SOMEBODY, AND ADVANCING IT IS NOT THIS LOOP'S CALL.
     *
     * The claim query already refuses a PAUSED run, which is why a pause looked
     * honoured. It was not: the live driver calls `advanceRun` exactly when a
     * tick claimed nothing, the target computed from the tasks is READY
     * (`TASKS_RUNNABLE`), and `PAUSED -> READY` is a legal transition — so the
     * very next idle tick UN-PAUSED the run under the reason `TASKS_RUNNABLE`
     * and the tick after it dispatched. A pause held for one tick. Found by the
     * operator lifecycle channel's route proof, driving the live driver.
     *
     * AND BEFORE THE VERIFICATION SWEEP, because a resumed verification
     * dispatches the reviewer, and pause means "start nothing further". Only
     * `resumeJuliusRun` — somebody's decision, recorded — takes a run out of
     * PAUSED; cancel still reaches it because cancel does not go through here.
     */
    if (run.state === 'PAUSED') {
      return { runId, from: run.state, to: run.state, changed: false, reasonCode: 'RUN_PAUSED', resumedVerifications: 0 };
    }

    /**
     * A PENDING APPROVAL IS SOMEBODY'S DECISION TOO, AND THIS LOOP DOES NOT
     * WALK AROUND IT.
     *
     * The sibling of the PAUSED hold, with the same shape: `requestJuliusApproval`
     * moves the run to BLOCKED, the claim query refuses a BLOCKED run, and so
     * the gate looked honoured. It was not: an idle tick called `advanceRun`,
     * the target from the TASKS was READY (`TASKS_RUNNABLE`), BLOCKED -> READY
     * is legal, and the next tick dispatched — the whole mission ran to
     * COMPLETED with the approval still PENDING. Only `decideJuliusApproval`
     * takes a run out of an approval hold (READY when every gate is granted,
     * FAILED on a denial); cancel still reaches it because cancel does not go
     * through here. Checked in any non-terminal state, before the verification
     * sweep, because a resumed verification dispatches the reviewer.
     */
    const pendingApprovals = this.deps.store.pendingApprovals;
    if (pendingApprovals !== undefined && (await pendingApprovals.call(this.deps.store, runId, projectId)).length > 0) {
      return { runId, from: run.state, to: run.state, changed: false, reasonCode: 'RUN_AWAITING_APPROVAL', resumedVerifications: 0 };
    }

    const resumed = await this.#resumeVerifications(run, tasks, decisions, projectId);
    if (resumed > 0) {
      [tasks, decisions] = await Promise.all([
        this.deps.store.tasksForRun(runId, projectId),
        this.deps.store.decisionsForRun(runId, projectId),
      ]);
    }

    let target = targetRunState(tasks, decisions);

    /**
     * THE ARCHITECT IS A PEER FOR THE WHOLE MISSION, NOT ONLY ITS FIRST
     * MINUTE.
     *
     * Julius goes back to it when the record says the design moved, when
     * evidence contradicts an assumption it named, when a dependency appeared,
     * when a repair was required for an architectural reason, when a coder
     * asked the design a question, when a re-plan was proposed — and before a
     * run may call itself complete. HERE, beside the resume sweep, because
     * `advanceRun` is the one place that holds the whole run rather than one
     * task, and it is called exactly when nothing else moved.
     */
    const policy = await this.policies.policyFor(run);
    if (policy !== null) {
      const consulted = await serveArchitectureTriggers({
        deps: this.deps, run, policy: policy.card, tasks,
        completionReady: target.state === 'COMPLETED',
        capabilityFor: (task) => this.policies.capabilityFor(task),
      });
      if (consulted > 0) {
        [tasks, decisions] = await Promise.all([
          this.deps.store.tasksForRun(runId, projectId),
          this.deps.store.decisionsForRun(runId, projectId),
        ]);
        target = targetRunState(tasks, decisions);
      }
    }

    /**
     * A COMPLETION THE ARCHITECT SAYS WOULD BE UNTRUE DOES NOT HAPPEN.
     *
     * The gate can only HOLD: it cannot accept a task, cannot mint a verdict
     * and cannot complete a mission. A run that recorded no architecture is not
     * held at all, and neither is one whose consultation no worker could serve
     * — a feature nothing opted into must not be able to strand every mission.
     */
    /**
     * A COMPLETION OVER A FINDING NOBODY RESOLVED DOES NOT HAPPEN EITHER.
     *
     * Checked where completion is decided, and wherever a run has stopped for a
     * generic reason — VERIFYING with every task terminal, BLOCKED because nothing
     * can progress — so the record names the finding that holds it rather than
     * the symptom. Like the architecture gate, it can only hold: a run it names
     * stays in the state it was going to, never COMPLETED.
     */
    const generic = (target.state === 'VERIFYING' && target.reasonCode === 'ALL_TASKS_TERMINAL')
      || (target.state === 'BLOCKED' && target.reasonCode === 'RUN_CANNOT_PROGRESS');
    if (target.state === 'COMPLETED' || generic) {
      const findings = await juliusFindingsGateFor(this.deps, run);
      if (!findings.ok) target = { state: target.state === 'BLOCKED' ? 'BLOCKED' : 'VERIFYING', reasonCode: findings.reasonCode };
    }
    if (target.state === 'COMPLETED') {
      const gate = await juliusArchitectureGateFor(this.deps, run);
      if (!gate.ok) target = { state: 'VERIFYING', reasonCode: gate.reasonCode };
    }

    // The graph's SHAPE, recorded once per run version so an eval can relate
    // cost and latency to how big the mission actually was. Idempotent by
    // version, so re-advancing writes nothing new.
    await this.#trajectory(run, 'TASK_TOPOLOGY', {
      outcome: run.state,
      facts: {
        tasks: tasks.length,
        edges: tasks.reduce((total, item) => total + item.dependencyIds.length, 0),
        roles: new Set(tasks.map((item) => item.role)).size,
      },
    });
    return this.#applyTarget(run, target, tasks, decisions, resumed);
  }

  /**
   * Move a run to `target` along a legal path, recording the completion fact and
   * the terminal event. One place, used by the task graph's target and by a
   * recorded denial, so a denial ends a run exactly the way anything else does.
   */
  async #applyTarget(
    run: JuliusRunRow,
    target: { state: JuliusMissionState; reasonCode: string },
    tasks: readonly JuliusTask[],
    decisions: readonly JuliusRecordedDecision[],
    resumed: number,
  ): Promise<JuliusRunAdvance> {
    const { runId, projectId } = run;
    const path = planRunStatePath(run.state, target.state);
    if (path.length === 0) {
      return { runId, from: run.state, to: run.state, changed: false, reasonCode: target.reasonCode, resumedVerifications: resumed };
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
          resumedVerifications: resumed,
        };
      }
    }
    /**
     * THE COMPLETION FACT THE EVALS ARE COUNTED FROM.
     *
     * `JuliusTrajectoryPostgresRepository.summarize` counts a verified
     * completion by looking for a COMPLETION trajectory event whose outcome is
     * VERIFIED — and nothing emitted one, so `verifiedCompletionRate` was
     * structurally zero for every project and every runtime version. An eval
     * that always reports zero is worse than no eval, because it looks like a
     * measurement.
     */
    if (current.state === 'COMPLETED' || current.state === 'FAILED' || current.state === 'CANCELLED') {
      await this.#trajectory(run, 'COMPLETION', {
        outcome: current.state === 'COMPLETED' ? 'VERIFIED' : current.state,
        facts: { reasonCode: target.reasonCode, tasks: tasks.length, decisions: decisions.length },
      });
    }
    if (current.state === 'COMPLETED' || current.state === 'FAILED') {
      const event = {
        eventId: this.deps.ids.next(`event:run.${current.state.toLowerCase()}`),
        runId, projectId, type: current.state === 'COMPLETED' ? 'run.completed' as const : 'run.failed' as const,
        taskId: null, workerId: null, correlationId: runId, causationId: null,
        occurredAt: this.deps.clock.now(),
        facts: { reasonCode: target.reasonCode, tasks: tasks.length, decisions: decisions.length },
      };
      validateJuliusEvent(event);
      await this.deps.store.appendEvent(event);
    }
    return { runId, from: run.state, to: current.state, changed: true, reasonCode: target.reasonCode, resumedVerifications: resumed };
  }
}
