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

import { transitionMission, type JuliusBrainEntry, type JuliusEvidence, type JuliusMissionState, type JuliusTask, type JuliusVerificationDecision } from './julius-runtime';
import type { JuliusOperationalEvent } from './julius-events';
import type { JuliusTrajectoryEvent } from './julius-trajectory';
import type { JuliusContextSnapshot } from './julius-context-snapshot';
import type { JuliusAcceptanceCriterion, JuliusReviewerFinding } from './julius-verification-runtime';
import type {
  JuliusClaimedTask, JuliusResultReceiptRow, JuliusRunRow, JuliusRuntimeStore,
} from './julius-runtime-ports';

interface TaskRow extends JuliusTask {
  runId: string;
  leaseOwner: string | null;
  leaseGeneration: number;
  leaseExpiresAt: string | null;
  attempt: number;
  nextAttemptAt: string;
  version: number;
}

interface ResultRow {
  readonly runId: string; readonly taskId: string; readonly leaseGeneration: number;
  readonly status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; readonly idempotencyKey: string;
}

export interface JuliusMemoryStore extends JuliusRuntimeStore {
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
  /** Simulate a process restart: data survives, in-flight leases do not. */
  restart(): void;
}

export function createJuliusMemoryStore(): JuliusMemoryStore {
  const runs = new Map<string, JuliusRunRow>();
  const tasks = new Map<string, TaskRow>();
  const evidence: JuliusEvidence[] = [];
  const evidenceKeys = new Set<string>();
  const decisions: JuliusVerificationDecision[] = [];
  const decisionKeys = new Set<string>();
  const decisionRunIds = new Map<string, string>();
  const findings: JuliusReviewerFinding[] = [];
  const criteria = new Map<string, JuliusAcceptanceCriterion[]>();
  const brain = new Map<string, JuliusBrainEntry[]>();
  const results: ResultRow[] = [];
  const resultKeys = new Set<string>();
  const resultGenerations = new Set<string>();
  const eventLog: JuliusOperationalEvent[] = [];
  const eventIds = new Set<string>();
  const trajectoryLog: JuliusTrajectoryEvent[] = [];
  const trajectoryKeys = new Set<string>();
  const contexts: JuliusContextSnapshot[] = [];
  const contextKeys = new Set<string>();
  const repairRounds = new Map<string, number>();

  /** The dependency predicate the claim query enforces. */
  const dependenciesSatisfied = (task: TaskRow): boolean =>
    task.dependencyIds.every((id) => {
      const dependency = tasks.get(id);
      return dependency !== undefined && (dependency.state === 'SUCCEEDED' || dependency.state === 'SKIPPED');
    });

  const CLAIMABLE_RUN_STATES: readonly JuliusMissionState[] =
    ['READY', 'EXECUTING', 'WAITING', 'REVIEWING', 'REPAIRING', 'VERIFYING'];

  return {
    /* ------------------------------------------------------------ seeding */
    seedRun(run) { runs.set(run.runId, { ...run }); },
    seedTask(runId, task) {
      tasks.set(task.taskId, {
        ...task, runId, leaseOwner: null, leaseGeneration: 0, leaseExpiresAt: null,
        attempt: 0, nextAttemptAt: '1970-01-01T00:00:00.000Z', version: 1,
      });
    },
    seedCriteria(runId, values) { criteria.set(runId, values.map((value) => ({ ...value }))); },
    seedFinding(finding) { findings.push({ ...finding }); },
    seedBrain(runId, entries) { brain.set(runId, entries.map((entry) => ({ ...entry }))); },

    /* --------------------------------------------------------- inspection */
    taskRow(taskId) { const row = tasks.get(taskId); return row ? { ...row } : null; },
    events() { return eventLog.map((event) => ({ ...event })); },
    trajectory() { return trajectoryLog.map((event) => ({ ...event })); },
    contexts() { return contexts.map((snapshot) => ({ ...snapshot })); },
    results() { return results.map((row) => ({ ...row })); },
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
        leaseExpiresAt: null, attempt: 0, nextAttemptAt: '1970-01-01T00:00:00.000Z', version: 1,
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
          const expired = task.state === 'ACTIVE' && task.leaseExpiresAt !== null && task.leaseExpiresAt <= input.now;
          // BLOCKED IS CLAIMABLE ONCE ITS DEPENDENCIES ARE SATISFIED, and the
          // inherited claim query did not say so. `JuliusTaskGraph` promotes
          // BLOCKED to RUNNABLE when its dependencies succeed, but nothing
          // performs that promotion against the database — so a task inserted
          // BLOCKED (which is exactly how a scheduled review or repair task is
          // inserted, since it must not run before what it depends on) could
          // never be claimed at all. The dependency predicate below is already
          // the gate; the state check was a second, stricter one that made the
          // first unreachable.
          if (task.state !== 'RUNNABLE' && task.state !== 'BLOCKED' && !expired) return false;
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
        task.attempt += 1;
        task.version += 1;
        claimed.push({
          taskId: task.taskId, runId: task.runId, role: task.role, taskType: task.taskType,
          leaseGeneration: task.leaseGeneration, attempt: task.attempt,
        });
      }
      return claimed;
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
      return true;
    },

    async appendDecision(input) {
      const key = `${input.runId}::${input.idempotencyKey}`;
      if (decisionKeys.has(key)) return false;
      decisionKeys.add(key);
      decisions.push({ ...input.decision });
      decisionRunIds.set(input.decisionId, input.runId);
      return true;
    },

    /* ------------------------------------------------------------ context */
    async persist(input) {
      const run = runs.get(input.snapshot.runId);
      if (run === undefined || run.projectId !== input.projectId) return false;
      const key = `${input.snapshot.taskId}::${input.snapshot.workerId}::${input.snapshot.contentHash}`;
      if (contextKeys.has(key)) return false;
      contextKeys.add(key);
      contexts.push({ ...input.snapshot });
      return true;
    },

    /* ------------------------------------------------------------- events */
    async appendEvent(event) {
      if (eventIds.has(event.eventId)) return false;
      eventIds.add(event.eventId);
      eventLog.push({ ...event });
      return true;
    },

    async appendTrajectory(event) {
      const key = `${event.runId}::${event.idempotencyKey}`;
      if (trajectoryKeys.has(key)) return false;
      trajectoryKeys.add(key);
      trajectoryLog.push({ ...event });
      return true;
    },

    /* -------------------------------------------------------------- reads */
    async tasksForRun(runId) {
      return [...tasks.values()]
        .filter((task) => task.runId === runId)
        .sort((a, b) => a.ordinal - b.ordinal || a.taskId.localeCompare(b.taskId))
        .map((task) => ({
          taskId: task.taskId, missionId: task.missionId, parentTaskId: task.parentTaskId,
          dependencyIds: task.dependencyIds, requiredEvidenceTypes: task.requiredEvidenceTypes,
          taskType: task.taskType, role: task.role, ordinal: task.ordinal, state: task.state,
        }));
    },
    async evidenceForRun(runId) {
      const ids = new Set([...tasks.values()].filter((task) => task.runId === runId).map((task) => task.taskId));
      return evidence.filter((value) => ids.has(value.taskId)).map((value) => ({ ...value }));
    },
    async findingsForRun(runId) { return findings.filter((value) => value.runId === runId).map((value) => ({ ...value })); },
    async criteriaForRun(runId) { return (criteria.get(runId) ?? []).map((value) => ({ ...value })); },
    async decisionsForRun(runId) {
      const ids = new Set([...decisionRunIds.entries()].filter(([, value]) => value === runId).map(([key]) => key));
      return ids.size === 0 ? [] : decisions.map((value) => ({ ...value }));
    },
    async brainEntriesForRun(runId) { return (brain.get(runId) ?? []).map((entry) => ({ ...entry })); },
    async repairRoundsFor(taskId) { return repairRounds.get(taskId) ?? 0; },
    async reviewCompletedFor(taskId) {
      const review = tasks.get(`${taskId}:review`);
      return review !== undefined && review.state === 'SUCCEEDED';
    },
  };
}
