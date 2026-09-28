/**
 * A DETERMINISTIC IN-MEMORY JULIUS STORE THAT MODELS THE REAL SEMANTICS.
 *
 * WHY THIS EXISTS. The inherited Postgres repositories are exercised by a
 * `PoolStub` that matches SQL SUBSTRINGS and returns canned rows. That proves a
 * query was composed; it cannot prove that two schedulers never claim the same
 * task, that a stale lease generation cannot mutate a task, that a duplicate
 * provider callback is absorbed, or that a run survives a restart — because
 * none of those are properties of a string. This box has no PostgreSQL and no
 * container runtime, so the honest options were "assert nothing" or "model the
 * semantics precisely and say so". This is the second.
 *
 * WHAT IT MODELS, AND THEREFORE WHAT A TEST AGAINST IT PROVES:
 *   - row-level exclusion on claim (the `FOR UPDATE … SKIP LOCKED` effect):
 *     one claimant per task per generation, deterministic ordering;
 *   - lease generations, and the compare-and-set every writer performs
 *     against `(state='ACTIVE', lease_owner, lease_generation)`;
 *   - the unique constraints that make replay safe —
 *     `julius_evidence(run_id, idempotency_key)`,
 *     `julius_worker_results(run_id, idempotency_key)` and
 *     `(task_id, lease_generation)`,
 *     `julius_verification_decisions(run_id, idempotency_key)`,
 *     `julius_trajectory_events(run_id, idempotency_key)`,
 *     `julius_context_snapshots(task_id, worker_id, content_hash)`;
 *   - optimistic concurrency on `julius_runs.version`;
 *   - the mission transition table, via `transitionMission`;
 *   - the dependency predicate in the claim query.
 *
 * WHAT IT DOES NOT MODEL, STATED SO NOTHING OVERCLAIMS: durability, real
 * serializable isolation, deadlock, connection loss, planner behaviour, index
 * performance, or anything about a network. A test that passes here is
 * evidence about the RUNTIME'S LOGIC, never about PostgreSQL. `restart()`
 * simulates a process restart — the data survives and every in-flight lease is
 * treated as owned by a process that is gone — which is exactly the boundary
 * the runtime has to be correct across, and is the one restart property this
 * model can honestly assert.
 *
 * IT IS NOT A PRODUCTION STORE. It holds everything in a Map and forgets it
 * when the process exits. Mounting it in a deployment would be a durable
 * system that is not durable.
 */

import { MAX_TASK_RECOVERIES, planJuliusRecovery, type JuliusRecoveryAction } from './julius-recovery';
import { transitionMission, type JuliusBrainEntry, type JuliusEvidence, type JuliusMissionState, type JuliusRecordedDecision, type JuliusTask } from './julius-runtime';
import { JuliusEventIdConflict, canonicalJuliusEventIdentity, type JuliusOperationalEvent } from './julius-events';
import type { JuliusTrajectoryEvent } from './julius-trajectory';
import type { JuliusContextSnapshot } from './julius-context-snapshot';
import { juliusTaskContractBindingDigest, type JuliusTaskContract } from './julius-task-contract';
import type { JuliusAcceptanceCriterion, JuliusReviewerFinding } from './julius-verification-runtime';
import type {
  JuliusClaimedTask, JuliusResultReceiptRow, JuliusRunRow, JuliusRuntimeStore,
} from './julius-runtime-ports';
import type {
  JuliusSubagentContext, JuliusSubagentRecord, JuliusSubagentState, JuliusSubagentStore,
} from './julius-subagent-runtime';
import type {
  JuliusApprovalRecord, JuliusApprovalStore, JuliusLifecycleStore,
} from './julius-lifecycle-runtime';
import type { JuliusTimelineEntry, JuliusTimelineReader } from './julius-runtime-api';

interface TaskRow extends JuliusTask {
  runId: string;
  leaseOwner: string | null;
  /** Scheduling ownership. Every claim takes a new generation. */
  leaseGeneration: number;
  leaseExpiresAt: string | null;
  /** EXECUTION admissions. Only `admitTask` raises it. */
  attempt: number;
  /** Expired leases reclaimed by recovery. Only `recoverExpired` raises it. */
  recoveries: number;
  nextAttemptAt: string;
  version: number;
}

/**
 * The EXECUTION ceiling recovery requeues against.
 *
 * The inherited `recoverExpired` reads a `maxRetries` written as the SQL
 * literal `2` inside its own query, and `planJuliusRecovery` fails at
 * `attempt >= maxRetries + 1` — the same 3 this names, reached from the other
 * side. This model uses the dispatch path's number, so a task cannot be
 * requeued past the point at which the pipeline would refuse to retry it.
 *
 * IT IS NOT THE ONLY BOUND ANY MORE, and it could not be. Now that `attempt`
 * counts execution admissions, a task that is claimed, crashes before it is
 * admitted, and is recovered leaves this number untouched — so bounded only by
 * it, that loop would run forever. {@link MAX_TASK_RECOVERIES} bounds the
 * recovery itself; both are checked, in `planJuliusRecovery`'s order.
 */
const RECOVERY_MAX_ATTEMPTS = 3;

interface ResultRow {
  readonly runId: string; readonly taskId: string; readonly leaseGeneration: number;
  readonly status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; readonly idempotencyKey: string;
}

export interface JuliusMemoryStore
  extends JuliusRuntimeStore, JuliusSubagentStore,
  JuliusApprovalStore, JuliusLifecycleStore, JuliusTimelineReader {
  /* ---- seeding, for tests and offline runs ---- */
  seedRun(run: JuliusRunRow): void;
  seedTask(runId: string, task: JuliusTask): void;
  seedCriteria(runId: string, criteria: readonly JuliusAcceptanceCriterion[]): void;
  seedFinding(finding: JuliusReviewerFinding): void;
  seedBrain(runId: string, entries: readonly JuliusBrainEntry[]): void;
  /* ---- inspection ---- */
  taskRow(taskId: string): Readonly<TaskRow> | null;
  events(): readonly JuliusOperationalEvent[];
  trajectory(): readonly JuliusTrajectoryEvent[];
  contexts(): readonly JuliusContextSnapshot[];
  results(): readonly ResultRow[];
  /** Reclaim expired leases, as the recovery repository does. */
  recoverExpired(now: string, limit?: number, projectId?: string): Promise<readonly JuliusRecoveryAction[]>;
  /** The last recorded lifecycle change for a run, or null. */
  lifecycleOf(runId: string): { reason: string; actor: string; at: string } | null;
  /** Simulate a process restart: data survives, in-flight leases do not. */
  restart(): void;
}

export function createJuliusMemoryStore(): JuliusMemoryStore {
  const runs = new Map<string, JuliusRunRow>();
  const tasks = new Map<string, TaskRow>();
  const evidence: JuliusEvidence[] = [];
  const evidenceKeys = new Set<string>();
  const decisions: (JuliusRecordedDecision & { readonly runId: string })[] = [];
  const decisionKeys = new Set<string>();
  const decisionRunIds = new Map<string, string>();
  const findings: JuliusReviewerFinding[] = [];
  const criteria = new Map<string, JuliusAcceptanceCriterion[]>();
  const brain = new Map<string, JuliusBrainEntry[]>();
  /**
   * THE MODEL'S COPY OF THE REVISION COUNTER.
   *
   * PostgreSQL allocates from `GREATEST(project_brain_revision, max(revision))`,
   * so a seeded run whose rows carry revisions 1..N continues at N+1 even though
   * the run row still says 0. Seeded entries here carry no revision at all, so
   * the count stands in for the same fact — otherwise the model would hand out 1
   * where production hands out N+1 and the two would disagree about a number
   * that reaches context snapshots and trajectory rows.
   */
  const brainRevisions = new Map<string, number>();
  /**
   * TASK CONTRACTS, keyed `<contractId>@<revision>` because a revision is the
   * unit that is stored, locked and superseded. PostgreSQL keys the same rows
   * on `(contract_id, contract_revision)`.
   */
  const contracts = new Map<string, JuliusTaskContract>();
  const results: ResultRow[] = [];
  const resultKeys = new Set<string>();
  const resultGenerations = new Set<string>();
  const eventLog: JuliusOperationalEvent[] = [];
  const eventIds = new Set<string>();
  /** The canonical identity of every event recorded, so a repeat can be told from a rewrite. */
  const identities = new Map<string, string>();
  /**
   * PER-STREAM SEQUENCES, ASSIGNED ON APPEND.
   *
   * The event LEDGER allocates a sequence — `JuliusEventPostgresRepository`
   * does it with `stream_sequences` — while `JuliusOperationalEvent` itself
   * carries none. That is the right split (a sequence is a fact about the
   * ledger, not about the thing that happened) and it means a model that does
   * not assign one cannot serve a cursor-based timeline at all.
   */
  const eventSequences = new Map<string, number>();
  const sequenceOf = new Map<string, number>();
  const trajectoryLog: JuliusTrajectoryEvent[] = [];
  const trajectoryKeys = new Set<string>();
  const contexts: JuliusContextSnapshot[] = [];
  const contextKeys = new Set<string>();
  const repairRounds = new Map<string, number>();
  const subagents = new Map<string, JuliusSubagentRecord>();
  const approvals = new Map<string, JuliusApprovalRecord>();
  const lifecycle = new Map<string, { reason: string; actor: string; at: string }>();

  /** Whether a run belongs to a project. Every read consults this first. */
  const inProject = (runId: string, projectId: string): boolean =>
    runs.get(runId)?.projectId === projectId;

  /** The dependency predicate the claim query enforces. */
  const dependenciesSatisfied = (task: TaskRow): boolean =>
    task.dependencyIds.every((id) => {
      const dependency = tasks.get(id);
      return dependency !== undefined && (dependency.state === 'SUCCEEDED' || dependency.state === 'SKIPPED');
    });

  const CLAIMABLE_RUN_STATES: readonly JuliusMissionState[] =
    ['READY', 'EXECUTING', 'WAITING', 'REVIEWING', 'REPAIRING', 'VERIFYING'];

  /**
   * ONE APPEND, WHOEVER ASKS.
   *
   * `appendEvent` is the port; a decision writing the events that explain it
   * needs the identical rule from inside its own write. Sharing the body is
   * what makes "the same id may only ever say the same thing" true on both
   * paths rather than true on the one that happened to be tested.
   */
  const recordEvent = (event: JuliusOperationalEvent): boolean => {
    const recorded = identities.get(event.eventId);
    const identity = canonicalJuliusEventIdentity(event);
    if (recorded !== undefined) {
      if (recorded !== identity) throw new JuliusEventIdConflict(event.eventId);
      return false;
    }
    identities.set(event.eventId, identity);
    eventIds.add(event.eventId);
    const next = (eventSequences.get(event.runId) ?? 0) + 1;
    eventSequences.set(event.runId, next);
    sequenceOf.set(event.eventId, next);
    eventLog.push({ ...event });
    return true;
  };

  return {
    /* ------------------------------------------------------------ seeding */
    seedRun(run) { runs.set(run.runId, { ...run }); },
    seedTask(runId, task) {
      tasks.set(task.taskId, {
        ...task, runId, leaseOwner: null, leaseGeneration: 0, leaseExpiresAt: null,
        attempt: 0, recoveries: 0, nextAttemptAt: '1970-01-01T00:00:00.000Z', version: 1,
      });
    },
    seedCriteria(runId, values) { criteria.set(runId, values.map((value) => ({ ...value }))); },
    seedFinding(finding) { findings.push({ ...finding }); },
    seedBrain(runId, entries) {
      brain.set(runId, entries.map((entry) => ({ ...entry })));
      brainRevisions.set(runId, entries.length);
    },

    /* --------------------------------------------------------- inspection */
    taskRow(taskId) { const row = tasks.get(taskId); return row ? { ...row } : null; },
    events() { return eventLog.map((event) => ({ ...event })); },
    trajectory() { return trajectoryLog.map((event) => ({ ...event })); },
    contexts() { return contexts.map((snapshot) => ({ ...snapshot })); },
    results() { return results.map((row) => ({ ...row })); },
    /**
     * The same shape `planJuliusRecovery` decides and the recovery repository
     * applies: an expired lease is REQUEUED while attempts remain and
     * ABANDONED once they do not. The attempt ceiling is the one the dispatch
     * path uses, so a task cannot be requeued past the point at which the
     * pipeline would refuse to retry it.
     */
    async recoverExpired(now, limit = 100, projectId) {
      const actions: JuliusRecoveryAction[] = [];
      for (const task of tasks.values()) {
        if (actions.length >= limit) break;
        if (task.state !== 'ACTIVE') continue;
        if (task.leaseExpiresAt === null || task.leaseExpiresAt > now) continue;
        const run = runs.get(task.runId);
        if (run === undefined) continue;
        if (projectId !== undefined && run.projectId !== projectId) continue;
        // The SAME decision the PostgreSQL sweep takes, taken by the same
        // function, so the two stores cannot drift on which bound stopped a
        // task or on what it is called.
        const action = planJuliusRecovery({
          runId: task.runId, projectId: run.projectId, runState: run.state, taskId: task.taskId,
          attempt: task.attempt, maxRetries: RECOVERY_MAX_ATTEMPTS - 1,
          leaseGeneration: task.leaseGeneration,
          recoveries: task.recoveries, maxRecoveries: MAX_TASK_RECOVERIES,
        });
        const requeue = action.action === 'REQUEUE';
        task.state = requeue ? 'RUNNABLE' : action.action === 'CANCEL_TASK' ? 'CANCELLED' : 'FAILED';
        task.leaseOwner = null;
        task.leaseExpiresAt = null;
        task.nextAttemptAt = now;
        // COUNTED ON THE WAY OUT, and only when this task is being handed
        // another turn. Raising it on a terminal decision would bound nothing
        // and would make the number mean two things.
        if (requeue) task.recoveries += 1;
        task.version += 1;
        actions.push(action);
      }
      return actions;
    },

    lifecycleOf(runId) { const row = lifecycle.get(runId); return row ? { ...row } : null; },
    restart() {
      // Data survives; leases do not. Every ACTIVE task is left ACTIVE with an
      // expired lease, which is exactly what a crashed worker leaves behind and
      // exactly what `recoverExpired` is written to find.
      for (const task of tasks.values()) {
        if (task.state === 'ACTIVE') task.leaseExpiresAt = '1970-01-01T00:00:00.000Z';
      }
    },

    /* ------------------------------------------------------------- runs */
    async loadRun(runId, projectId) {
      const run = runs.get(runId);
      return run !== undefined && run.projectId === projectId ? { ...run } : null;
    },

    async transition(input) {
      const run = runs.get(input.runId);
      if (run === undefined || run.projectId !== input.projectId) throw new Error('julius_run_not_found');
      if (run.version !== input.expectedVersion) throw new Error('optimistic_concurrency_conflict');
      // Legality is the domain's rule, not a second copy of it here.
      transitionMission({
        transitionId: `transition:${input.commandId}`, missionId: run.missionId, current: run.state,
        to: input.to, reasonCode: input.reasonCode, safeSummary: input.safeSummary,
        evidenceIds: input.evidenceIds, occurredAt: input.occurredAt,
      });
      const updated: JuliusRunRow = { ...run, state: input.to, version: run.version + 1 };
      runs.set(run.runId, updated);
      return { ...updated };
    },

    async addTask(input) {
      const run = runs.get(input.runId);
      if (run === undefined || run.projectId !== input.projectId || run.missionId !== input.task.missionId) {
        throw new Error('julius_run_not_found');
      }
      if (tasks.has(input.task.taskId)) return false; // ON CONFLICT DO NOTHING
      for (const id of input.task.dependencyIds) {
        if (!tasks.has(id)) throw new Error(`task_reference_not_found:${id}`);
      }
      tasks.set(input.task.taskId, {
        ...input.task, runId: input.runId, leaseOwner: null, leaseGeneration: 0,
        leaseExpiresAt: null, attempt: 0, recoveries: 0, nextAttemptAt: '1970-01-01T00:00:00.000Z', version: 1,
      });
      if (input.task.taskType.startsWith('repair:') && input.task.parentTaskId !== null) {
        repairRounds.set(input.task.parentTaskId, (repairRounds.get(input.task.parentTaskId) ?? 0) + 1);
      }
      return true;
    },

    /* ----------------------------------------------------------- claiming */
    async claimRunnable(input) {
      if (!input.owner.trim() || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        throw new Error('invalid_julius_claim');
      }
      const candidates = [...tasks.values()]
        .filter((task) => {
          const run = runs.get(task.runId);
          if (run === undefined) return false;
          if (input.projectId !== undefined && run.projectId !== input.projectId) return false;
          if (!CLAIMABLE_RUN_STATES.includes(run.state)) return false;
          if (task.nextAttemptAt > input.now) return false;
          // AN EXPIRED LEASE IS RECOVERY'S, NOT THE CLAIM'S.
          //
          // This query used to also offer an ACTIVE task whose lease had
          // expired, which reclaimed it while raising only `lease_generation` —
          // so a task that was claimed and died before admission could be
          // picked up again forever, bypassing `recoveries` and its ceiling
          // entirely. There is one path back from an expired lease now:
          // `recoverExpired` counts the reclaim, bounds it, and writes the
          // `recovery.action` row that explains it, leaving the task RUNNABLE
          // for an ordinary claim. A runtime whose recovery never runs stalls
          // such a task, which is the safe direction — the unbounded reclaim
          // was the unsafe one. The PostgreSQL claim carries the same rule.
          // RUNNABLE ONLY. BLOCKED used to be claimable once its dependencies
          // had SUCCEEDED, and that is how paid run 34037313976 ran `build`
          // before anyone had reviewed the plan: SUCCEEDED is not ACCEPTED.
          // Julius alone moves a task from BLOCKED to RUNNABLE, in the same
          // durable write as the decision that satisfied it (`appendDecision`
          // with `releaseTaskIds`). Tasks whose dependencies are already
          // satisfied when Julius creates them — a review of a task that has
          // succeeded, a repair, a sub-agent — are created RUNNABLE. The
          // dependency predicate below stays as a second gate: a RUNNABLE task
          // with a dependency that has not succeeded is still never offered.
          // The PostgreSQL claim carries the same rule.
          if (task.state !== 'RUNNABLE') return false;
          return dependenciesSatisfied(task);
        })
        // The claim query orders by run creation, then ordinal, then task id.
        // Deterministic order is what makes a two-claimant race reproducible.
        .sort((a, b) => a.ordinal - b.ordinal || a.taskId.localeCompare(b.taskId))
        .slice(0, input.limit);

      const claimed: JuliusClaimedTask[] = [];
      for (const task of candidates) {
        task.state = 'ACTIVE';
        task.leaseOwner = input.owner;
        task.leaseGeneration += 1;
        task.leaseExpiresAt = input.leaseExpiresAt;
        // THE CLAIM TAKES OWNERSHIP, NOT AN ATTEMPT. `admitTask` spends the
        // execution attempt once the scheduler has decided to run this task,
        // so a concurrency or fairness hand-back costs a lease generation and
        // nothing else.
        task.version += 1;
        claimed.push({
          taskId: task.taskId, runId: task.runId, role: task.role, taskType: task.taskType,
          leaseGeneration: task.leaseGeneration, attempt: task.attempt,
        });
      }
      return claimed;
    },

    async admitTask(input) {
      const task = tasks.get(input.taskId);
      if (task === undefined || task.state !== 'ACTIVE') return null;
      if (task.leaseOwner !== input.owner || task.leaseGeneration !== input.leaseGeneration) return null;
      task.attempt += 1;
      task.version += 1;
      return task.attempt;
    },

    async heartbeat(input) {
      const task = tasks.get(input.taskId);
      if (task === undefined || task.state !== 'ACTIVE') return false;
      if (task.leaseOwner !== input.owner || task.leaseGeneration !== input.leaseGeneration) return false;
      task.leaseExpiresAt = input.leaseExpiresAt;
      return true;
    },

    async finishTask(input) {
      const task = tasks.get(input.taskId);
      if (task === undefined || task.state !== 'ACTIVE') return false;
      if (task.leaseOwner !== input.owner || task.leaseGeneration !== input.leaseGeneration) return false;
      task.state = input.state;
      task.leaseOwner = null;
      task.leaseExpiresAt = null;
      if (input.nextAttemptAt !== undefined) task.nextAttemptAt = input.nextAttemptAt;
      task.version += 1;
      // A FAILED task that may still be retried returns to RUNNABLE only when
      // the caller asked for it by supplying a next attempt time. Silently
      // requeueing every failure would make a permanent failure loop forever.
      if (input.state === 'FAILED' && input.nextAttemptAt !== undefined) task.state = 'RUNNABLE';
      return true;
    },

    /* ------------------------------------------------------------ results */
    async acceptWorkerResult(input): Promise<JuliusResultReceiptRow> {
      const idempotency = `${input.runId}::${input.idempotencyKey}`;
      const existing = results.find((row) => `${row.runId}::${row.idempotencyKey}` === idempotency);
      if (existing !== undefined) return { recorded: false, duplicate: true, taskState: existing.status };
      const task = tasks.get(input.taskId);
      const run = task === undefined ? undefined : runs.get(task.runId);
      if (task === undefined || run === undefined || run.projectId !== input.projectId) throw new Error('julius_task_not_found');
      if (run.state === 'CANCELLED' || task.state === 'CANCELLED') throw new Error('result_after_cancellation');
      if (task.state !== 'ACTIVE' || task.leaseGeneration !== input.leaseGeneration) throw new Error('stale_worker_result');
      const generationKey = `${input.taskId}::${input.leaseGeneration}`;
      if (resultGenerations.has(generationKey)) throw new Error('duplicate_result_generation');

      resultKeys.add(idempotency);
      resultGenerations.add(generationKey);
      results.push({ runId: input.runId, taskId: input.taskId, leaseGeneration: input.leaseGeneration, status: input.status, idempotencyKey: input.idempotencyKey });
      task.state = input.status;
      task.leaseOwner = null;
      task.leaseExpiresAt = null;
      task.version += 1;
      return { recorded: true, duplicate: false, taskState: input.status };
    },

    /* ----------------------------------------------------------- evidence */
    async appendEvidence(input) {
      const run = runs.get(input.runId);
      if (run === undefined || run.projectId !== input.projectId) return false;
      const key = `${input.runId}::${input.idempotencyKey}`;
      if (evidenceKeys.has(key)) return false;
      evidenceKeys.add(key);
      evidence.push({ ...input.evidence });
      /**
       * THE EVENT IS PART OF THE WRITE, and the model was missing it.
       * `JuliusPostgresRepository.appendEvidence` commits
       * `julius.evidence.recorded` in the SAME transaction as the row, so
       * production emits it and this model did not — a divergence the
       * end-to-end scenario caught by asking the ledger for an event that
       * exists in production and never in a test.
       */
      const sequence = (eventSequences.get(input.runId) ?? 0) + 1;
      eventSequences.set(input.runId, sequence);
      const eventId = `evidence:${input.evidence.evidenceId}`;
      if (!eventIds.has(eventId)) {
        eventIds.add(eventId);
        sequenceOf.set(eventId, sequence);
        eventLog.push({
          eventId, runId: input.runId, projectId: input.projectId, type: 'evidence.recorded',
          taskId: input.evidence.taskId, workerId: input.evidence.workerId,
          correlationId: input.evidence.taskId, causationId: null,
          occurredAt: input.evidence.occurredAt,
          facts: {
            evidenceId: input.evidence.evidenceId, evidenceType: input.evidence.type,
            status: input.evidence.status, safeSummary: input.evidence.safeSummary,
          },
        });
      }
      return true;
    },

    async recordFinding(input) {
      // The SQL refuses a finding whose evidence does not exist in the run;
      // the model refuses the same, so a test cannot record a finding that
      // production would reject.
      if (input.finding.evidenceIds.length === 0) throw new Error('reviewer_finding_requires_evidence');
      const run = runs.get(input.finding.runId);
      if (run === undefined || run.projectId !== input.projectId) return false;
      if (findings.some((row) => row.findingId === input.finding.findingId)) return false;
      const known = new Set(evidence.map((row) => row.evidenceId));
      if (input.finding.evidenceIds.some((id) => !known.has(id))) return false;
      findings.push({ ...input.finding });
      return true;
    },

    async appendDecision(input) {
      const key = `${input.runId}::${input.idempotencyKey}`;
      if (decisionKeys.has(key)) return false;
      decisionKeys.add(key);
      decisions.push({ ...input.decision, taskId: input.taskId, runId: input.runId });
      decisionRunIds.set(input.decisionId, input.runId);
      // THE RELEASE IS PART OF THE SAME WRITE. Only a BLOCKED task of this run
      // moves; anything else named here is left exactly as it was.
      for (const taskId of input.releaseTaskIds ?? []) {
        const task = tasks.get(taskId);
        if (task === undefined || task.runId !== input.runId || task.state !== 'BLOCKED') continue;
        task.state = 'RUNNABLE';
        task.version += 1;
      }
      /* AND SO IS THE HISTORY THAT EXPLAINS IT. Production writes these inside
         the decision's transaction; this whole call is synchronous, which is
         the same guarantee — nothing can observe the decision without them.
         They take the same append rule as any other event, so a replayed
         decision that names the same events writes no second row. */
      for (const event of input.events ?? []) recordEvent(event);
      return true;
    },

    /* ----------------------------------------------------- Project Brain */
    async appendBrainEntry(input) {
      const run = runs.get(input.runId);
      if (run === undefined || run.projectId !== input.projectId) return false;
      const existing = brain.get(input.runId) ?? [];
      // A REPLAY MOVES NOTHING. Production reaches the same answer by guarding
      // its counter UPDATE with NOT EXISTS on the entry id, so an idempotent
      // call cannot leave the revision one higher than the entries justify.
      if (existing.some((entry) => entry.entryId === input.entryId)) return false;
      const revision = Math.max(run.projectBrainRevision, brainRevisions.get(input.runId) ?? 0) + 1;
      brainRevisions.set(input.runId, revision);
      runs.set(input.runId, { ...run, projectBrainRevision: revision });
      brain.set(input.runId, [...existing, {
        entryId: input.entryId,
        kind: input.kind,
        text: input.safeText,
        // The row holds ONE task id; the compiler's shape holds a list.
        taskIds: input.taskId === null ? [] : [input.taskId],
        // Matching the read path exactly: stored entries carry no role
        // restriction, and INTERNAL rather than PUBLIC because calling a stored
        // entry PUBLIC would be a claim nobody checked.
        allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'],
        sensitivity: 'INTERNAL',
        /**
         * WHO WROTE IT, WHEN, AND WHAT IT CITED. Every one of these arrives on
         * the append and was being thrown away at the read, so the context
         * integrity layer had no way to tell a reviewer's cited finding from a
         * coder's own note. Matching the PostgreSQL read path exactly, because a
         * model and a database that disagree about provenance is worse than
         * neither carrying it.
         */
        provenance: {
          workerId: input.workerId,
          recordedAt: input.occurredAt,
          evidenceIds: [...input.evidenceIds],
        },
      }]);
      return true;
    },

    /* --------------------------------------------------- task contracts */
    async putTaskContract(input) {
      const key = `${input.contract.contractId}@${input.contract.contractRevision}`;
      const existing = contracts.get(key);
      if (existing !== undefined) {
        // A REPLAY IS NOT AN OVERWRITE, and a different proposal at a stored
        // revision is not a replay. The digest of the TERMS is what decides:
        // the lock fields differ between a stored LOCKED row and the DRAFT a
        // retry would re-propose, and treating that as a conflict would refuse
        // an honest replay.
        if (juliusTaskContractBindingDigest(existing) !== juliusTaskContractBindingDigest(input.contract)) {
          throw new Error('julius_task_contract_revision_conflict');
        }
        return false;
      }
      const run = runs.get(input.contract.runId);
      if (run === undefined || run.projectId !== input.projectId) return false;
      // ONE CONTRACT PER TASK, modelled. Production's
      // `julius_task_contract_one_per_task` refuses a second contract id at a
      // task's revision; the model must refuse it too or the two disagree
      // about whether a task can be governed by two agreements at once.
      const other = [...contracts.values()].find(
        (row) => row.taskId === input.contract.taskId && row.contractRevision === input.contract.contractRevision
          && row.contractId !== input.contract.contractId && runs.get(row.runId)?.projectId === input.projectId,
      );
      if (other !== undefined) throw new Error('julius_task_contract_one_per_task');
      contracts.set(key, input.contract);
      return true;
    },

    async challengeTaskContract(input) {
      const key = `${input.contractId}@${input.contractRevision}`;
      const existing = contracts.get(key);
      if (existing === undefined) return false;
      if (existing.state === 'CHALLENGED') return false;
      if (existing.state !== 'DRAFT') return false;
      contracts.set(key, { ...existing, state: 'CHALLENGED' });
      return true;
    },

    async lockTaskContract(input) {
      const key = `${input.contractId}@${input.contractRevision}`;
      const candidate = contracts.get(key);
      if (candidate === undefined) return { locked: false, reasonCode: 'contract_revision_not_found', lockedRevision: null };
      if (candidate.runId !== undefined && runs.get(candidate.runId)?.projectId !== input.projectId) {
        return { locked: false, reasonCode: 'contract_not_in_project', lockedRevision: null };
      }
      // THE PARTIAL UNIQUE INDEX, modelled. Production refuses a second lock in
      // the database; the model has to refuse it here or the two disagree about
      // what a concurrent lock does.
      const alreadyLocked = [...contracts.values()].find(
        (row) => row.contractId === input.contractId && row.state === 'LOCKED',
      );
      // A lock moves forward or not at all — locking N while N-1 is locked IS
      // superseding. Refused: the same revision twice, and an older revision
      // than the one held, which would roll the agreement backwards under
      // parties already holding the newer one.
      if (alreadyLocked !== undefined && alreadyLocked.contractRevision >= input.contractRevision) {
        return alreadyLocked.contractRevision === input.contractRevision
          ? { locked: false, reasonCode: 'contract_revision_already_locked', lockedRevision: alreadyLocked.contractRevision }
          : { locked: false, reasonCode: 'newer_revision_is_locked', lockedRevision: alreadyLocked.contractRevision };
      }
      if (candidate.state === 'SUPERSEDED') return { locked: false, reasonCode: 'contract_superseded', lockedRevision: null };
      // The caller computed this from the accepted terms; re-deriving it here is
      // what stops a caller locking one document to another document's digest.
      if (juliusTaskContractBindingDigest(candidate) !== input.bindingDigest) {
        return { locked: false, reasonCode: 'binding_digest_mismatch', lockedRevision: null };
      }
      const superseded = [...contracts.values()].filter(
        (row) => row.contractId === input.contractId && row.contractRevision < input.contractRevision && row.state === 'LOCKED',
      );
      for (const row of superseded) contracts.set(`${row.contractId}@${row.contractRevision}`, { ...row, state: 'SUPERSEDED' });
      const locked: JuliusTaskContract = {
        ...candidate, state: 'LOCKED', bindingDigest: input.bindingDigest,
        lockedAt: input.lockedAt, lockedByEvaluatorId: input.evaluatorId,
      };
      contracts.set(key, locked);
      return { locked: true, contract: locked, supersededRevision: superseded[0]?.contractRevision ?? null };
    },

    async loadTaskContract(input) {
      const rows = [...contracts.values()].filter(
        (row) => row.taskId === input.taskId && runs.get(row.runId)?.projectId === input.projectId,
      );
      if (rows.length === 0) return null;
      const lockedRow = rows.find((row) => row.state === 'LOCKED');
      // A locked row whose terms no longer hash to its recorded binding is
      // CORRUPT, not current: production re-derives the digest on read for the
      // same reason, and returning it would hand a caller a binding that does
      // not describe the terms beside it.
      if (lockedRow !== undefined) {
        return juliusTaskContractBindingDigest(lockedRow) === lockedRow.bindingDigest ? lockedRow : null;
      }
      return rows.reduce((newest, row) => (row.contractRevision > newest.contractRevision ? row : newest));
    },

    async taskContractRevisions(input) {
      return [...contracts.values()]
        .filter((row) => row.taskId === input.taskId && runs.get(row.runId)?.projectId === input.projectId)
        .sort((a, b) => a.contractRevision - b.contractRevision);
    },

    /* ------------------------------------------------------------ context */
    async persist(input) {
      const run = runs.get(input.snapshot.runId);
      // No run, no context: there is nothing for a downstream record to point
      // at, and `null` says so rather than a caller-minted id that exists
      // nowhere.
      if (run === undefined || run.projectId !== input.projectId) return null;
      const key = `${input.snapshot.taskId}::${input.snapshot.workerId}::${input.snapshot.contentHash}`;
      // THE STORED ID WINS. A retry mints a new id for identical content; the
      // row that already exists is the one every reference must name, or the
      // durable graph gains an edge to nothing. The Postgres store has a
      // foreign key that catches this; here there is none, so the same defect
      // was silent and produced a dangling reference instead of a crash.
      const existing = contexts.find((value) =>
        value.taskId === input.snapshot.taskId
        && value.workerId === input.snapshot.workerId
        && value.contentHash === input.snapshot.contentHash);
      if (existing !== undefined) return existing.contextId;
      contextKeys.add(key);
      contexts.push({ ...input.snapshot });
      return input.snapshot.contextId;
    },

    /* ------------------------------------------------------------- events */
    async appendEvent(event) {
      /**
       * THE SAME ID MAY ONLY EVER SAY THE SAME THING. This compared the id
       * alone, so a second event carrying DIFFERENT facts under a used id was
       * dropped and its facts were lost — silently, and only in this store.
       */
      return recordEvent(event);
    },

    /**
     * The safe timeline, from the ledger, scoped by BOTH run and project.
     *
     * Only `facts` crosses — never a payload, a prompt or a provider response,
     * because there is no field on the event that could hold one.
     */
    async timeline(input) {
      const run = runs.get(input.runId);
      if (run === undefined || run.projectId !== input.projectId) return { entries: [], hasMore: false };
      const matching = eventLog
        .filter((event) => event.runId === input.runId && (sequenceOf.get(event.eventId) ?? 0) > input.sinceSequence)
        .sort((a, b) => (sequenceOf.get(a.eventId) ?? 0) - (sequenceOf.get(b.eventId) ?? 0));
      const page = matching.slice(0, input.limit);
      const entries: JuliusTimelineEntry[] = page.map((event) => ({
        eventId: event.eventId,
        sequence: sequenceOf.get(event.eventId) ?? 0,
        type: event.type,
        taskId: event.taskId,
        workerId: event.workerId,
        occurredAt: event.occurredAt,
        facts: event.facts,
      }));
      return { entries, hasMore: matching.length > page.length };
    },

    async appendTrajectory(event) {
      const key = `${event.runId}::${event.idempotencyKey}`;
      if (trajectoryKeys.has(key)) return false;
      trajectoryKeys.add(key);
      trajectoryLog.push({ ...event });
      return true;
    },

    /* -------------------------------------------------------------- reads */
    /**
     * EVERY READ TAKES THE PROJECT AND ENFORCES IT. A run id alone is enough
     * to find a row and is not enough to be allowed to read it, so a read
     * whose project does not match the run's returns nothing — the same answer
     * the SQL gives, rather than a laxer one that would let a test pass where
     * production refuses.
     */
    async tasksForRun(runId, projectId) {
      if (!inProject(runId, projectId)) return [];
      return [...tasks.values()]
        .filter((task) => task.runId === runId)
        .sort((a, b) => a.ordinal - b.ordinal || a.taskId.localeCompare(b.taskId))
        .map((task) => ({
          taskId: task.taskId, missionId: task.missionId, parentTaskId: task.parentTaskId,
          dependencyIds: task.dependencyIds, requiredEvidenceTypes: task.requiredEvidenceTypes,
          taskType: task.taskType, role: task.role, ordinal: task.ordinal, state: task.state,
        }));
    },
    async evidenceForRun(runId, projectId) {
      if (!inProject(runId, projectId)) return [];
      const ids = new Set([...tasks.values()].filter((task) => task.runId === runId).map((task) => task.taskId));
      return evidence.filter((value) => ids.has(value.taskId)).map((value) => ({ ...value }));
    },
    async findingsForRun(runId, projectId) {
      return inProject(runId, projectId) ? findings.filter((value) => value.runId === runId).map((value) => ({ ...value })) : [];
    },
    async criteriaForRun(runId, projectId) {
      return inProject(runId, projectId) ? (criteria.get(runId) ?? []).map((value) => ({ ...value })) : [];
    },
    async decisionsForRun(runId, projectId) {
      if (!inProject(runId, projectId)) return [];
      // Scoped to the run, like the PostgreSQL reader: the old model returned
      // EVERY run's decisions once the run had any, which single-run tests
      // could never notice and completion (now per-task) must never see.
      return decisions.filter((value) => value.runId === runId).map(({ runId: _runId, ...value }) => ({ ...value }));
    },
    async brainEntriesForRun(runId, projectId) {
      return inProject(runId, projectId) ? (brain.get(runId) ?? []).map((entry) => ({ ...entry })) : [];
    },
    async repairRoundsFor(taskId, projectId) {
      const task = tasks.get(taskId);
      if (task === undefined || !inProject(task.runId, projectId)) return 0;
      return repairRounds.get(taskId) ?? 0;
    },

    /* --------------------------------------------------------- sub-agents */
    async subagentContext(runId, parentTaskId): Promise<JuliusSubagentContext> {
      const forRun = [...subagents.values()].filter((record) => record.runId === runId);
      // The parent's own record, when the parent is itself a child. A root
      // task has none, and its depth is 0 — read, never claimed by a request.
      const parent = forRun.find((record) => record.childTaskId === parentTaskId) ?? null;
      const ACTIVE_STATES: readonly JuliusSubagentState[] = ['AUTHORIZED', 'ACTIVE'];
      return {
        parentDepth: parent?.depth ?? 0,
        activeChildren: forRun.filter((record) =>
          record.parentTaskId === parentTaskId && ACTIVE_STATES.includes(record.state)).length,
        totalChildren: forRun.length,
        parentPermissions: parent?.permissions ?? [],
      };
    },

    async recordSubagent(record) {
      const key = `${record.runId}::${record.requestId}`;
      if (subagents.has(key)) return { recorded: false, duplicate: true };
      subagents.set(key, { ...record });
      return { recorded: true, duplicate: false };
    },

    async loadSubagent(runId, requestId) {
      const record = subagents.get(`${runId}::${requestId}`);
      return record ? { ...record } : null;
    },

    async subagentsForRun(runId) {
      return [...subagents.values()].filter((record) => record.runId === runId).map((record) => ({ ...record }));
    },

    /* ---------------------------------------------------------- approvals */
    async requestApproval(record) {
      const byKey = [...approvals.values()].find((row) =>
        row.runId === record.runId && row.idempotencyKey === record.idempotencyKey);
      if (byKey !== undefined) return { created: false, record: { ...byKey } };
      // The partial unique index: ONE pending approval per gated operation.
      // `?? ''` because NULL never equals NULL and a run-level gate would
      // otherwise be duplicable — the same COALESCE the index uses.
      const pending = [...approvals.values()].find((row) =>
        row.state === 'PENDING' && row.runId === record.runId
        && (row.taskId ?? '') === (record.taskId ?? '') && row.operation === record.operation);
      if (pending !== undefined) return { created: false, record: { ...pending } };
      approvals.set(record.approvalId, { ...record });
      return { created: true, record: { ...record } };
    },

    async loadApproval(runId, approvalId, projectId) {
      const record = approvals.get(approvalId);
      return record !== undefined && record.runId === runId && record.projectId === projectId
        ? { ...record } : null;
    },

    async pendingApprovals(runId, projectId) {
      return [...approvals.values()]
        .filter((row) => row.runId === runId && row.projectId === projectId && row.state === 'PENDING')
        .map((row) => ({ ...row }));
    },

    async decideApproval(input) {
      const record = approvals.get(input.approvalId);
      if (record === undefined || record.runId !== input.runId || record.projectId !== input.projectId) return false;
      // A decided approval stays decided; only PENDING is decidable.
      if (record.state !== 'PENDING') return false;
      approvals.set(input.approvalId, {
        ...record, state: input.state, decidedAt: input.decidedAt,
        decidedBy: input.decidedBy, decisionReason: input.decisionReason,
      });
      return true;
    },

    /* ---------------------------------------------------------- lifecycle */
    async cancelRunTasks(runId, projectId, now) {
      if (!inProject(runId, projectId)) return 0;
      let cancelled = 0;
      for (const task of tasks.values()) {
        if (task.runId !== runId) continue;
        if (['SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(task.state)) continue;
        task.state = 'CANCELLED';
        task.leaseOwner = null;
        task.leaseExpiresAt = null;
        task.nextAttemptAt = now;
        task.version += 1;
        cancelled += 1;
      }
      return cancelled;
    },

    async recordLifecycle(input) {
      if (!inProject(input.runId, input.projectId)) return false;
      lifecycle.set(input.runId, { reason: input.reason, actor: input.actor, at: input.at });
      return true;
    },

    async setSubagentState(runId, requestId, state) {
      const key = `${runId}::${requestId}`;
      const record = subagents.get(key);
      if (record === undefined) return false;
      subagents.set(key, { ...record, state });
      return true;
    },
    async activeTaskCount(runId, projectId) {
      if (!inProject(runId, projectId)) return 0;
      return [...tasks.values()].filter((task) => task.runId === runId && task.state === 'ACTIVE').length;
    },

    async executedBindingFor(taskId, projectId) {
      const row = tasks.get(taskId);
      if (row === undefined || !inProject(row.runId, projectId)) return null;
      // The LAST claim, because a task claimed twice was dispatched under the
      // binding current at its last dispatch, and that is the one its work
      // was done against.
      const claimed = [...eventLog].reverse().find((event) => event.type === 'task.claimed' && event.taskId === taskId);
      const facts = claimed?.facts ?? {};
      return typeof facts.contractId === 'string' && typeof facts.contractTaskId === 'string'
        && typeof facts.contractRevision === 'number' && typeof facts.bindingDigest === 'string'
        ? { contractId: facts.contractId, taskId: facts.contractTaskId, contractRevision: facts.contractRevision, bindingDigest: facts.bindingDigest }
        : null;
    },
  };
}
