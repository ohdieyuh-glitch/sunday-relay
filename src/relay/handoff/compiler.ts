import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import type {
  AgentHandoffPackage, Blueprint, BudgetPolicy, CompletionPolicy, DecisionRecord,
  HandoffCompilationRecord, LoopPolicy, PermissionPolicy, RelayProject, RelayRun,
  RelayTask, Restriction, StoppingCondition, TaskAssignment,
} from '../protocol/contracts';
import { checkAgentHandoffPackage } from '../protocol/contracts';
import type { EventDraft } from '../protocol/envelopes';
import type { ContextVersion, IdempotencyKey, IdFactory, LedgerVersion } from '../protocol/ids';
import type { Provenance, ReportType, Role } from '../protocol/enums';

/**
 * Structured Handoff Compiler (Prompt 3, PROTOCOL §4.2–4.3). Compiles a
 * responsibility contract from CANONICAL STRUCTURED STATE — never from a
 * transcript. Context selection is explicit and deterministic: only records
 * reachable through direct references, dependencies, claims, policy
 * requirements, or explicit pins are included; everything else is excluded
 * and the exclusion is recorded. Large artifacts stay references.
 */

export const COMPILER_VERSION = 'relay-handoff/1';

export interface CompileHandoffInput {
  project: RelayProject;
  run: RelayRun;
  task: RelayTask;
  assignment: TaskAssignment;
  role: Role;
  blueprint?: Blueprint;
  /** Non-superseded decisions considered relevant via explicit association. */
  decisions?: ReadonlyArray<{ record: DecisionRecord; associatedTaskIds?: RelayTask['taskId'][]; pinned?: boolean }>;
  evidenceRefs?: string[];
  artifactRefs?: string[];
  completionPolicy: CompletionPolicy;
  permissionPolicy: PermissionPolicy;
  budget: BudgetPolicy;
  loopPolicy: LoopPolicy;
  stoppingCondition: StoppingCondition;
  ledgerVersion: LedgerVersion;
  contextVersion: ContextVersion;
  baseRevision: string;
  provenance: Provenance;
  ids: IdFactory;
  now: string;
  idempotencyKey: string;
  correlationId?: string;
  expiresAt?: string;
  /** Prior compilations for idempotency (same key → same output). */
  priorCompilations?: ReadonlyArray<{ record: HandoffCompilationRecord; pkg: AgentHandoffPackage; idempotencyKey?: string }>;
}

export interface CompiledHandoff {
  pkg: AgentHandoffPackage;
  record: HandoffCompilationRecord;
  events: EventDraft[];
  idempotent: boolean;
}

const ROLE_REPORT: Record<Role, ReportType> = {
  architect: 'blueprint',
  'coding-agent': 'implementation',
  reviewer: 'review',
  'security-reviewer': 'review',
  operations: 'implementation',
  verification: 'verification-output',
};

/** Role templates: what each responsibility prioritizes (Section 10). */
const ROLE_REQUIRED_EVIDENCE: Record<Role, string[]> = {
  architect: ['structured blueprint matching the required Blueprint schema'],
  'coding-agent': ['diff/artifact references for every changed file', 'targeted test results', 'typecheck result'],
  reviewer: ['finding list with ids and severities', 'independent checks actually performed'],
  'security-reviewer': ['security findings with ids', 'auth-boundary checks performed', 'secret-policy verification'],
  operations: ['operational artifact reference', 'actions performed with timestamps'],
  verification: ['command results with exit codes pinned to the repository revision'],
};

const ROLE_BOUNDARY: Record<Role, string> = {
  architect: 'Author the Blueprint only — no implementation, no repository mutation.',
  'coding-agent': 'Implement within claimed files only; report honestly; never claim unrun commands.',
  reviewer: 'Independent adversarial review only — do not trust the implementer’s claims; verify against the diff.',
  'security-reviewer': 'Security review only: authentication/authorization boundaries, secrets policy, abuse scenarios.',
  operations: 'Operational objective only; no destructive action, no credential handling beyond approved scope.',
  verification: 'Execute the declared deterministic checks exactly; record real exit codes.',
};

export function compileHandoff(input: CompileHandoffInput): RelayResult<CompiledHandoff> {
  const {
    project, run, task, assignment, role, blueprint, decisions = [], evidenceRefs = [],
    artifactRefs = [], completionPolicy, permissionPolicy, budget, loopPolicy,
    stoppingCondition, ledgerVersion, contextVersion, baseRevision, provenance, ids,
    now, idempotencyKey, correlationId, expiresAt, priorCompilations = [],
  } = input;

  const prior = priorCompilations.find((p) => p.idempotencyKey === idempotencyKey);
  if (prior) {
    const same = prior.pkg.taskId === task.taskId && prior.pkg.role === role && prior.pkg.targetAdapterId === assignment.adapterId;
    if (same) return ok({ pkg: prior.pkg, record: prior.record, events: [], idempotent: true });
    return fail(relayError('duplicate-idempotency-key', 'Idempotency key was already used for a different compilation.', { entityIds: { taskId: task.taskId } }));
  }
  if (assignment.taskId !== task.taskId) {
    return fail(relayError('validation-failed', 'Assignment does not own this task.', { entityIds: { taskId: task.taskId, assignmentId: assignment.assignmentId } }));
  }

  /* Explicit context selection (Section 11): include only reachable records. */
  const included: Array<{ ref: string; reason: string }> = [];
  const excluded: Array<{ ref: string; reason: string }> = [];

  if (blueprint) included.push({ ref: blueprint.blueprintId, reason: 'run-blueprint' });
  for (const d of decisions) {
    if (d.record.supersededBy) { excluded.push({ ref: d.record.decisionId, reason: 'superseded-decision' }); continue; }
    if (d.pinned || d.associatedTaskIds?.includes(task.taskId)) {
      included.push({ ref: d.record.decisionId, reason: d.pinned ? 'explicit-pin' : 'task-association' });
    } else {
      excluded.push({ ref: d.record.decisionId, reason: 'not-associated-with-task' });
    }
  }
  for (const e of evidenceRefs) included.push({ ref: e, reason: 'completion-policy-evidence' });
  for (const a of artifactRefs) included.push({ ref: a, reason: 'artifact-reference-only' }); // contents never inlined
  for (const dep of task.dependencies) included.push({ ref: dep, reason: 'task-dependency' });

  const permittedFiles: Restriction[] = task.claimedFiles.map((path) => ({ value: path, enforcement: 'advisory' }));
  const protectedRestrictions: Restriction[] = permissionPolicy.protectedPaths.map((p) => ({ value: `protected:${p.pattern}`, enforcement: p.enforcement }));

  const pkg: AgentHandoffPackage = {
    packageId: ids.next('pkg'),
    protocolVersion: RELAY_PROTOCOL_VERSION,
    projectId: project.projectId,
    runId: run.runId,
    taskId: task.taskId,
    targetAdapterId: assignment.adapterId,
    role,
    objective: task.objective,
    responsibilityBoundary: ROLE_BOUNDARY[role],
    contextRefs: included.map((i) => i.ref),
    requiredInputs: blueprint ? [`blueprint:${blueprint.blueprintId}`] : [],
    permittedTools: permissionPolicy.permittedTools,
    permittedFiles,
    prohibitedActions: [...permissionPolicy.prohibitedActions, ...protectedRestrictions],
    dependencies: [...task.dependencies],
    acceptanceCriteria: [...task.acceptanceCriteria],
    requiredEvidence: [
      ...ROLE_REQUIRED_EVIDENCE[role],
      ...completionPolicy.requiredEvidence.map((r) => `policy:${r.evidenceType}${r.command ? `:${r.command}` : ''}${r.mustPass ? ' (must pass)' : ''}`),
    ],
    budget,
    stoppingCondition,
    expectedReportType: ROLE_REPORT[role],
    contextVersion,
    ledgerVersion,
    baseRevision,
    createdAt: now,
    expiresAt,
    correlationId,
    idempotencyKey: idempotencyKey as IdempotencyKey,
  };

  const schemaErrors = checkAgentHandoffPackage(pkg, 'package');
  if (schemaErrors.length > 0) {
    return fail(relayError('validation-failed', 'Compiled package failed schema validation.', { details: schemaErrors }));
  }

  const record: HandoffCompilationRecord = {
    recordId: ids.next('hcr'),
    packageId: pkg.packageId,
    compiledAt: now,
    ledgerVersion,
    contextVersion,
    inputRefs: included.map((i) => `${i.ref}(${i.reason})`),
    compilerVersion: `${COMPILER_VERSION}#role=${role}#excluded=${excluded.map((e) => `${e.ref}(${e.reason})`).join(',') || 'none'}#loop=${loopPolicy.maxAutomaticRevisions}`,
  };

  const events: EventDraft[] = [
    {
      protocolVersion: RELAY_PROTOCOL_VERSION,
      at: now,
      projectId: project.projectId,
      runId: run.runId,
      taskId: task.taskId,
      source: 'relay-core',
      kind: 'handoff.created',
      provenance,
      classification: 'historical',
      safeSummary: `Compiled ${role} responsibility contract (ledger v${ledgerVersion}, context v${contextVersion}, ${baseRevision}).`,
      payload: { role, targetAdapterId: assignment.adapterId },
      correlationId,
      refs: { packageId: pkg.packageId, ledgerVersion, contextVersion },
    },
  ];

  return ok({ pkg, record, events, idempotent: false });
}
