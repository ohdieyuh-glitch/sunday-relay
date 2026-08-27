/** Provider-neutral, deterministic Julius orchestration kernel. */

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

export function missionMayComplete(input: { state: JuliusMissionState; tasks: readonly JuliusTask[]; decisions: readonly JuliusVerificationDecision[] }): boolean {
  return !TERMINAL.has(input.state) && input.state === 'VERIFYING' && input.tasks.length > 0 && input.tasks.every(task => ['SUCCEEDED', 'SKIPPED'].includes(task.state)) && input.decisions.length > 0 && input.decisions.every(decision => decision.action === 'ACCEPT');
}
