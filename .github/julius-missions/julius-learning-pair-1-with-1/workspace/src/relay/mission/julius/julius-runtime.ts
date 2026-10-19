/** Provider-neutral, deterministic Julius orchestration kernel. */

import { effectivelyAcceptedTaskIds } from './julius-repair-lineage';

export const JULIUS_RUNTIME_VERSION = 'julius-runtime.v1' as const;

export const JULIUS_MISSION_STATES = [
  'CREATED', 'PLANNING', 'READY', 'EXECUTING', 'WAITING', 'REVIEWING',
  'REPAIRING', 'VERIFYING', 'BLOCKED', 'PAUSED', 'FAILED', 'COMPLETED', 'CANCELLED',
] as const;
export type JuliusMissionState = typeof JULIUS_MISSION_STATES[number];

const TERMINAL = new Set<JuliusMissionState>(['FAILED', 'COMPLETED', 'CANCELLED']);
const TRANSITIONS: Readonly<Record<JuliusMissionState, readonly JuliusMissionState[]>> = {
  CREATED: ['PLANNING', 'CANCELLED'],
  PLANNING: ['READY', 'BLOCKED', 'FAILED', 'CANCELLED'],
  READY: ['EXECUTING', 'PAUSED', 'CANCELLED'],
  EXECUTING: ['WAITING', 'REVIEWING', 'REPAIRING', 'VERIFYING', 'BLOCKED', 'PAUSED', 'FAILED', 'CANCELLED'],
  WAITING: ['READY', 'EXECUTING', 'BLOCKED', 'PAUSED', 'FAILED', 'CANCELLED'],
  REVIEWING: ['REPAIRING', 'VERIFYING', 'BLOCKED', 'PAUSED', 'FAILED', 'CANCELLED'],
  REPAIRING: ['EXECUTING', 'REVIEWING', 'VERIFYING', 'BLOCKED', 'PAUSED', 'FAILED', 'CANCELLED'],
  VERIFYING: ['REPAIRING', 'COMPLETED', 'BLOCKED', 'PAUSED', 'FAILED', 'CANCELLED'],
  BLOCKED: ['READY', 'REPAIRING', 'PAUSED', 'FAILED', 'CANCELLED'],
  PAUSED: ['READY', 'BLOCKED', 'CANCELLED'],
  FAILED: [], COMPLETED: [], CANCELLED: [],
};

export interface JuliusTransition {
  readonly transitionId: string; readonly missionId: string;
  readonly from: JuliusMissionState; readonly to: JuliusMissionState;
  readonly reasonCode: string; readonly safeSummary: string;
  readonly evidenceIds: readonly string[]; readonly occurredAt: string;
  readonly runtimeVersion: typeof JULIUS_RUNTIME_VERSION;
}

export function transitionMission(input: Omit<JuliusTransition, 'from' | 'runtimeVersion'> & { current: JuliusMissionState }): JuliusTransition {
  if (!TRANSITIONS[input.current].includes(input.to)) throw new Error(`invalid_julius_transition:${input.current}->${input.to}`);
  if (!input.reasonCode.trim() || !input.safeSummary.trim()) throw new Error('transition_reason_required');
  return { transitionId: input.transitionId, missionId: input.missionId, from: input.current, to: input.to,
    reasonCode: input.reasonCode, safeSummary: input.safeSummary, evidenceIds: [...new Set(input.evidenceIds)],
    occurredAt: input.occurredAt, runtimeVersion: JULIUS_RUNTIME_VERSION };
}

export const JULIUS_DEFAULT_ROLES = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const;
export type JuliusDefaultRole = typeof JULIUS_DEFAULT_ROLES[number];
export type JuliusWorkerRole = JuliusDefaultRole | `SPECIALIST:${string}`;
export interface JuliusWorker {
  readonly workerId: string; readonly role: JuliusWorkerRole; readonly adapterId: string;
  readonly providerId: string; readonly capabilities: readonly string[];
  readonly taskTypes: readonly string[]; readonly concurrencyLimit: number;
  readonly timeoutMs: number; readonly maxRetries: number;
  readonly status: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
}

export class JuliusWorkerRegistry {
  private readonly workers = new Map<string, JuliusWorker>();
  register(worker: JuliusWorker): void {
    if (this.workers.has(worker.workerId)) throw new Error('worker_already_registered');
    if (!worker.adapterId.trim() || !worker.providerId.trim()) throw new Error('worker_adapter_and_provider_required');
    for (const [name, value] of [['concurrencyLimit', worker.concurrencyLimit], ['timeoutMs', worker.timeoutMs], ['maxRetries', worker.maxRetries]] as const)
      if (!Number.isSafeInteger(value) || value < (name === 'maxRetries' ? 0 : 1)) throw new Error(`invalid_worker_${name}`);
    this.workers.set(worker.workerId, structuredClone(worker));
  }
  get(workerId: string): JuliusWorker | null { const value = this.workers.get(workerId); return value ? structuredClone(value) : null; }
  eligible(role: JuliusWorkerRole, taskType: string, capability: string): JuliusWorker[] {
    return [...this.workers.values()].filter(worker => worker.status !== 'UNAVAILABLE' && worker.role === role &&
      worker.taskTypes.includes(taskType) && worker.capabilities.includes(capability)).sort((a, b) => a.workerId.localeCompare(b.workerId)).map(worker => structuredClone(worker));
  }
}

export const JULIUS_TASK_STATES = ['BLOCKED', 'RUNNABLE', 'ACTIVE', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED'] as const;
export type JuliusTaskState = typeof JULIUS_TASK_STATES[number];
export interface JuliusTask {
  readonly taskId: string; readonly missionId: string; readonly parentTaskId: string | null;
  readonly dependencyIds: readonly string[]; readonly requiredEvidenceTypes: readonly JuliusEvidenceType[];
  readonly taskType: string; readonly role: JuliusWorkerRole; readonly ordinal: number;
  state: JuliusTaskState;
}

export class JuliusTaskGraph {
  private readonly tasks = new Map<string, JuliusTask>();
  add(task: JuliusTask): void {
    if (this.tasks.has(task.taskId)) throw new Error('task_already_exists');
    if (task.dependencyIds.includes(task.taskId) || task.parentTaskId === task.taskId) throw new Error('task_self_reference');
    for (const id of [...task.dependencyIds, ...(task.parentTaskId ? [task.parentTaskId] : [])]) {
      const related = this.tasks.get(id); if (!related) throw new Error(`task_reference_not_found:${id}`);
      if (related.missionId !== task.missionId) throw new Error('cross_mission_task_reference');
    }
    this.tasks.set(task.taskId, structuredClone(task));
  }
  resolveRunnable(missionId: string): JuliusTask[] {
    for (const task of this.tasks.values()) if (task.missionId === missionId && task.state === 'BLOCKED') {
      const dependencies = task.dependencyIds.map(id => this.tasks.get(id)!);
      if (dependencies.some(dependency => ['FAILED', 'CANCELLED'].includes(dependency.state))) continue;
      if (dependencies.every(dependency => ['SUCCEEDED', 'SKIPPED'].includes(dependency.state))) task.state = 'RUNNABLE';
    }
    return [...this.tasks.values()].filter(task => task.missionId === missionId && task.state === 'RUNNABLE')
      .sort((a, b) => a.ordinal - b.ordinal || a.taskId.localeCompare(b.taskId)).map(task => structuredClone(task));
  }
  transition(taskId: string, expected: JuliusTaskState, next: JuliusTaskState): JuliusTask {
    const task = this.tasks.get(taskId); if (!task) throw new Error('task_not_found');
    if (task.state !== expected) throw new Error('stale_task_state');
    const allowed: Readonly<Record<JuliusTaskState, readonly JuliusTaskState[]>> = {
      BLOCKED: ['RUNNABLE', 'CANCELLED', 'SKIPPED'], RUNNABLE: ['ACTIVE', 'CANCELLED', 'SKIPPED'],
      ACTIVE: ['SUCCEEDED', 'FAILED', 'CANCELLED'], FAILED: ['RUNNABLE', 'CANCELLED'],
      SUCCEEDED: [], CANCELLED: [], SKIPPED: [],
    };
    if (!allowed[task.state].includes(next)) throw new Error(`invalid_task_transition:${task.state}->${next}`);
    task.state = next; return structuredClone(task);
  }
  snapshot(): JuliusTask[] { return [...this.tasks.values()].map(task => structuredClone(task)); }
}

export const JULIUS_EVIDENCE_TYPES = ['TEST', 'COMMAND', 'BUILD', 'LINT', 'TYPECHECK', 'ARTIFACT', 'DIFF', 'REVIEW_FINDING', 'SECURITY_SCAN', 'PROVIDER_RECEIPT', 'USER_APPROVAL', 'TOOL_RECEIPT'] as const;
export type JuliusEvidenceType = typeof JULIUS_EVIDENCE_TYPES[number];
export interface JuliusEvidence {
  readonly evidenceId: string; readonly missionId: string; readonly taskId: string;
  readonly workerId: string; readonly type: JuliusEvidenceType; readonly status: 'PASSED' | 'FAILED' | 'INCONCLUSIVE';
  readonly safeSummary: string; readonly artifactRef: string | null; readonly integrityHash: string | null;
  readonly occurredAt: string;
}

export type JuliusDecisionAction = 'ACCEPT' | 'REPAIR' | 'REROUTE' | 'RETRY' | 'ESCALATE' | 'HALT' | 'COMPLETE';
export interface JuliusVerificationDecision { readonly action: JuliusDecisionAction; readonly reasonCode: string; readonly evidenceIds: readonly string[]; readonly safeSummary: string; }
export function verifyTask(task: JuliusTask, evidence: readonly JuliusEvidence[], unresolvedBlockingFindings: number): JuliusVerificationDecision {
  const scoped = evidence.filter(item => item.missionId === task.missionId && item.taskId === task.taskId);
  const failed = scoped.filter(item => item.status === 'FAILED');
  if (failed.length || unresolvedBlockingFindings > 0) return { action: 'REPAIR', reasonCode: failed.length ? 'EVIDENCE_FAILED' : 'BLOCKING_FINDINGS', evidenceIds: failed.map(item => item.evidenceId), safeSummary: 'Verification requires repair.' };
  const missing = task.requiredEvidenceTypes.filter(type => !scoped.some(item => item.type === type && item.status === 'PASSED'));
  if (missing.length) return { action: 'HALT', reasonCode: 'REQUIRED_EVIDENCE_MISSING', evidenceIds: scoped.map(item => item.evidenceId), safeSummary: `Missing required evidence: ${missing.join(', ')}.` };
  return { action: 'ACCEPT', reasonCode: 'TASK_VERIFIED', evidenceIds: scoped.map(item => item.evidenceId), safeSummary: 'Required evidence passed.' };
}

export interface JuliusBrainEntry { readonly entryId: string; readonly kind: 'OBJECTIVE' | 'REQUIREMENT' | 'CONSTRAINT' | 'DECISION' | 'FINDING' | 'REPAIR' | 'HANDOFF' | 'ARTIFACT' | 'EVIDENCE'; readonly text: string; readonly taskIds: readonly string[]; readonly allowedRoles: readonly JuliusWorkerRole[]; readonly sensitivity: 'PUBLIC' | 'INTERNAL' | 'SECRET'; }
export interface JuliusContextPacket { readonly missionId: string; readonly taskId: string; readonly workerId: string; readonly sourceEntryIds: readonly string[]; readonly blocks: readonly { kind: JuliusBrainEntry['kind']; text: string }[]; readonly truncated: boolean; }
export function compileJuliusContext(input: { missionId: string; task: JuliusTask; worker: JuliusWorker; entries: readonly JuliusBrainEntry[]; maxCharacters: number }): JuliusContextPacket {
  if (input.maxCharacters < 1) throw new Error('invalid_context_budget');
  const relevant = input.entries.filter(entry => entry.sensitivity !== 'SECRET' && entry.allowedRoles.includes(input.worker.role) &&
    (entry.taskIds.length === 0 || entry.taskIds.includes(input.task.taskId)));
  const blocks: { kind: JuliusBrainEntry['kind']; text: string }[] = []; const sourceEntryIds: string[] = []; let used = 0;
  for (const entry of relevant) { const sanitized = entry.text.replace(/(?:api[_-]?key|token|secret)\s*[=:]\s*\S+/gi, '$1=[REDACTED]');
    if (used + sanitized.length > input.maxCharacters) break; blocks.push({ kind: entry.kind, text: sanitized }); sourceEntryIds.push(entry.entryId); used += sanitized.length; }
  return { missionId: input.missionId, taskId: input.task.taskId, workerId: input.worker.workerId, sourceEntryIds, blocks, truncated: sourceEntryIds.length < relevant.length };
}

/**
 * A VERIFICATION DECISION AS RECORDED — the decision plus the task it
 * governs. `JuliusVerificationDecision` deliberately stays a pure verdict;
 * completion needs to know WHICH work each verdict is about, and the durable
 * rows have always carried `task_id`. Ordering is the durable decision log's
 * (`occurred_at, decision_id` on PostgreSQL, append order in the model): for
 * one task, a later entry in the log is that task's CURRENT decision.
 */
export interface JuliusRecordedDecision extends JuliusVerificationDecision { readonly taskId: string; }

/**
 * COMPLETION READS EFFECTIVE VERIFICATION STATE, NOT RAW HISTORY.
 *
 * The previous rule required EVERY decision in the run's history to be
 * ACCEPT, which made the product's own repair flow uncompletable: the durable
 * REPAIR decision that ADMITTED a repair round poisoned completion forever,
 * even after the repair succeeded and its re-review accepted. Founder
 * decision, 2026-09-01: history is immutable audit material and is never
 * deleted or rewritten — but a REPAIR that has been successfully addressed
 * through its own repair lineage no longer blocks completion.
 *
 * THE EFFECTIVE RULE, per task, deterministic from durable state alone:
 *
 *   - A task's CURRENT decision is its LAST entry in the ordered decision
 *     log. Only a genuine re-verification of the same task appends a newer
 *     entry, so recency here is authority, not accident.
 *   - ACCEPT is effective acceptance.
 *   - REPAIR is superseded ONLY through its own repair lineage, and lineage
 *     means the repair PLANNER'S full contract — not a naming convention. A
 *     `repair:` type prefix alone is not proof: any producer of parent-linked
 *     tasks (a sub-agent spawn, a future feature) could mint one, and an
 *     ACCEPT on such an impostor must never launder a REPAIR. A child
 *     supersedes only when it matches everything `planJuliusRepair` emits —
 *     `isJuliusRepairOf` is that contract, and the one both this rule and the
 *     release rule read, so the two can never disagree: a parent link to the
 *     governed task, the PARENT'S OWN ROLE (a plan is revised by the Prompt
 *     Architect, code repaired by the Coding Agent), the taskType
 *     `repair:<parent's STAGE>` with every `repair:` prefix stripped, and the
 *     taskId `repair:<parent's id>:<round>:task` —
 *     and the child SUCCEEDED and is itself effectively accepted,
 *     recursively, so a repaired repair works and an abandoned one still
 *     blocks. An undecided repair child vouches for nothing, and an ACCEPT
 *     on any unrelated task supersedes nothing.
 *   - HALT and every other action stay FAIL-CLOSED: no lineage supersedes
 *     them. (A later decision on the SAME task can — that is the evaluator
 *     re-verifying the same work, the one authorized reverification path.)
 *
 * Everything else is unchanged: the run must be VERIFYING, every task
 * terminal, and at least one decision recorded. The full history remains in
 * the log for evidence, trajectories, audit and recovery.
 */
export function missionMayComplete(input: { state: JuliusMissionState; tasks: readonly JuliusTask[]; decisions: readonly JuliusRecordedDecision[] }): boolean {
  if (TERMINAL.has(input.state) || input.state !== 'VERIFYING') return false;
  if (input.tasks.length === 0 || !input.tasks.every(task => ['SUCCEEDED', 'SKIPPED'].includes(task.state))) return false;
  if (input.decisions.length === 0) return false;

  /**
   * THE LINEAGE RULE LIVES IN ONE PLACE. `effectivelyAcceptedTaskIds` is the
   * shape of a planner repair and the walk through its rounds, shared with the
   * release evaluator so that "accepted enough to complete" and "accepted
   * enough to unblock what depends on it" can never disagree.
   */
  const decided = new Set(input.decisions.map(decision => decision.taskId));
  const accepted = effectivelyAcceptedTaskIds(input.tasks, input.decisions);
  return [...decided].every(taskId => accepted.has(taskId));
}
