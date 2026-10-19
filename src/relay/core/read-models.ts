import type { RelayStores } from '../storage/interfaces';
import type { Blueprint, RelayRun } from '../protocol/contracts';
import { listEvents } from '../ledger/ledger';
import { projectLedger } from '../ledger/projection';
import type { RunId } from '../protocol/ids';

/**
 * Serializable READ MODELS (Prompt 5) — the query side of the client
 * boundary (Decision 9). Pure projections over the stores: plain
 * JSON-serializable objects, never mutable internal domain references.
 * Clients (CLI now; desktop/mobile later) render these and NOTHING else.
 */

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function runOf(stores: RelayStores, runId: RunId): RelayRun | null {
  return stores.runs.get(runId);
}

export function runStatusView(stores: RelayStores, runId: RunId) {
  const run = runOf(stores, runId);
  if (!run) return null;
  const task = run.taskIds.length ? stores.tasks.get(run.taskIds[0]) : null;
  const owner = stores.assignments.list().find((a) => a.taskId === task?.taskId && a.role === 'coding-agent' && !a.endedAt) ?? null;
  const events = listEvents(stores.events, run.projectId);
  const usage = stores.usage.list().filter((u) => u.runId === runId);
  const usedUsd = usage.reduce((a, u) => a + (u.usd ?? 0), 0);
  return clone({
    runId: run.runId, objective: run.objective, status: run.status, phase: run.phase,
    mode: run.mode, provenanceProfile: run.provenanceProfile,
    projectId: run.projectId, taskId: task?.taskId ?? null,
    owner: owner ? { adapterId: owner.adapterId, assignmentId: owner.assignmentId, leaseExpiresAt: owner.leaseExpiresAt ?? null } : null,
    repairCount: run.repairCount,
    ledgerVersion: events.at(-1)?.sequence ?? 0,
    contextVersion: (task?.contextVersion as number) ?? 0,
    baseRevision: task?.baseRevision ?? null,
    latestEvent: events.at(-1)?.safeSummary ?? null,
    checkpoint: run.checkpoint ? { checkpointId: run.checkpoint.checkpointId, reason: run.checkpoint.reason, respondedAt: run.checkpoint.respondedAt ?? null, response: run.checkpoint.response ?? null } : null,
    budget: { maxUsd: run.budget.maxUsd ?? null, usedUsd, remainingUsd: run.budget.maxUsd !== undefined ? Math.max(0, run.budget.maxUsd - usedUsd) : null },
    storageProfile: 'volatile-memory',
  });
}

export function eventFeedView(stores: RelayStores, runId: RunId, sinceSequence = 0) {
  const run = runOf(stores, runId);
  if (!run) return [];
  return listEvents(stores.events, run.projectId)
    .filter((e) => e.sequence > sinceSequence && (e.runId === runId || !e.runId))
    .map((e) => clone({
      sequence: e.sequence, at: e.at, source: e.source, kind: e.kind,
      safeSummary: e.safeSummary, provenance: e.provenance, classification: e.classification,
    }));
}

export function projectBrainView(stores: RelayStores, runId: RunId) {
  const run = runOf(stores, runId);
  if (!run) return null;
  const projection = projectLedger(listEvents(stores.events, run.projectId));
  const claims = Object.values(projection.claims).map((c) => ({ claimId: c.claimId, status: c.status, label: c.status === 'promoted' ? 'VERIFIED' : c.status === 'rejected' ? 'HISTORICAL' : 'CLAIM' }));
  return clone({
    objective: { value: projection.canonical.objective ?? run.objective, label: 'CANONICAL' },
    acceptedBlueprintId: projection.canonical.acceptedBlueprintId ?? null,
    promotedClaimIds: projection.canonical.promotedClaimIds,
    verifiedEvidenceRefs: projection.canonical.verifiedEvidenceRefs,
    claims,
    taskStatuses: projection.taskStatuses,
    runStatus: projection.runStatuses[runId] ?? run.status,
    openQuestionIds: projection.openQuestionIds,
    ledgerVersion: projection.ledgerVersion,
  });
}

export function taskOwnershipView(stores: RelayStores, runId: RunId) {
  const run = runOf(stores, runId);
  const task = run?.taskIds.length ? stores.tasks.get(run.taskIds[0]) : null;
  if (!run || !task) return null;
  const assignments = stores.assignments.list().filter((a) => a.taskId === task.taskId);
  const claims = stores.fileClaims.list().filter((c) => c.taskId === task.taskId);
  return clone({
    taskId: task.taskId, objective: task.objective, status: task.status,
    owner: assignments.find((a) => !a.endedAt)?.adapterId ?? null,
    ownershipHistory: assignments.map((a) => ({ adapterId: a.adapterId, role: a.role, assignedAt: a.assignedAt, endedAt: a.endedAt ?? null, endReason: a.endReason ?? null })),
    leaseExpiresAt: task.leaseExpiresAt ?? null,
    dependencies: task.dependencies,
    claimedFiles: claims.map((c) => ({ path: c.path, mode: c.mode, status: c.status })),
    claimedResources: task.claimedResources,
    contextVersion: task.contextVersion, baseRevision: task.baseRevision,
    acceptanceCriteria: task.acceptanceCriteria,
  });
}

export function blueprintView(stores: RelayStores, runId: RunId, blueprint: Blueprint | null, accepted: boolean) {
  const run = runOf(stores, runId);
  if (!run || !blueprint) return null;
  return clone({
    blueprintId: blueprint.blueprintId, version: blueprint.version,
    architect: blueprint.architectIdentity.displayName, provenance: blueprint.provenance,
    content: blueprint.content, approvalStatus: accepted ? 'accepted' : 'awaiting-approval',
  });
}

export function handoffView(stores: RelayStores, runId: RunId) {
  const pkg = stores.packages.list().find((p) => p.runId === runId);
  if (!pkg) return null;
  const record = stores.compilations.list().find((c) => c.packageId === pkg.packageId) ?? null;
  return clone({
    packageId: pkg.packageId, role: pkg.role, targetAdapterId: pkg.targetAdapterId,
    responsibilityBoundary: pkg.responsibilityBoundary,
    contextRefs: pkg.contextRefs,
    compilationInputs: record?.inputRefs ?? [],
    compilerVersion: record?.compilerVersion ?? null,
    permittedFiles: pkg.permittedFiles, permittedTools: pkg.permittedTools,
    prohibitedActions: pkg.prohibitedActions,
    requiredEvidence: pkg.requiredEvidence,
    acceptanceCriteria: pkg.acceptanceCriteria,
    stoppingCondition: pkg.stoppingCondition,
    ledgerVersion: pkg.ledgerVersion, contextVersion: pkg.contextVersion, baseRevision: pkg.baseRevision,
    expiresAt: pkg.expiresAt ?? null,
  });
}

export function evidenceView(stores: RelayStores, runId: RunId) {
  return clone(
    stores.evidence.list().filter((e) => e.runId === runId).map((e) => ({
      evidenceId: e.evidenceId, type: e.evidenceType, command: e.command ?? null,
      status: e.verificationStatus, provenance: e.provenance, verifier: e.verifier,
      repoRevision: e.repoRevision, exitCode: e.exitCode ?? null, executedAt: e.executedAt,
      outputExcerpt: e.outputExcerpt,
    })),
  );
}

export function reviewView(stores: RelayStores, runId: RunId, verdicts: Array<{ verdict: string; findings: Array<{ id: string; severity: string; title: string; detail: string; recommendation?: string }>; independent: boolean; provenance: string; reportId: string }>) {
  const reports = stores.reports.list().filter((r) => r.runId === runId && r.reportType === 'review');
  return clone(
    verdicts.map((v, i) => ({
      attempt: i + 1,
      reviewer: reports[i]?.agentIdentity.displayName ?? 'unknown',
      adapterId: reports[i]?.agentIdentity.adapterId ?? 'unknown',
      independent: v.independent, verdict: v.verdict, provenance: v.provenance,
      findings: v.findings,
    })),
  );
}

export function usageView(stores: RelayStores, runId: RunId) {
  const run = runOf(stores, runId);
  const records = stores.usage.list().filter((u) => u.runId === runId);
  const total = (kind: 'actual' | 'estimated') => records.filter((u) => u.kind === kind).reduce((a, u) => ({ usd: a.usd + (u.usd ?? 0), tokens: a.tokens + (u.tokens ?? 0) }), { usd: 0, tokens: 0 });
  return clone({
    records: records.map((u) => ({ adapterId: u.adapterId, kind: u.kind, usd: u.usd ?? null, tokens: u.tokens ?? null, at: u.at, note: 'SIMULATED usage — never provider-billed' })),
    simulatedActual: total('actual'), estimated: total('estimated'),
    budget: run ? { maxUsd: run.budget.maxUsd ?? null } : null,
  });
}

export function auditView(stores: RelayStores, runId: RunId) {
  const audit = stores.audits.list().find((a) => a.runId === runId);
  return audit ? clone(audit) : null;
}

/** Manual Task read model (Prompt 6.1). Serializable projection of the
 * canonical task riding the run's checkpoint — never secrets, never the
 * raw request. availableResponses is core policy, not a client decision. */
export function manualTaskView(stores: RelayStores, runId: RunId) {
  const run = runOf(stores, runId);
  const task = run?.checkpoint?.manualTask;
  if (!run || !task) return null;
  const availableResponses =
    task.status === 'pending' || task.status === 'needs_more_information'
      ? ['done', 'help', 'cannot', 'cancel']
      : task.status === 'user_marked_done'
        ? ['help', 'cannot', 'cancel']
        : task.status === 'cannot_complete'
          ? ['cancel']
          : [];
  return clone({
    manualTaskId: task.manualTaskId,
    checkpointId: task.checkpointId,
    runId: task.runId,
    taskId: task.relayTaskId,
    title: task.title,
    whyRelayStopped: task.whyRelayStopped,
    category: task.category,
    applicationOrLocation: task.applicationOrLocation,
    steps: task.steps,
    expectedResult: task.expectedResult,
    securityNotice: task.securityNotice ?? null,
    whatRelayWillDoNext: task.whatRelayWillDoNext,
    helpText: task.helpText,
    status: task.status,
    requestedBy: task.requestedBy,
    validatedByRelay: task.validatedByRelay,
    verification: {
      available: task.verificationAvailable,
      lastOutcome: task.lastVerificationOutcome ?? null,
      operatorConfirmationRequired:
        task.status === 'user_marked_done' && task.lastVerificationOutcome === 'unavailable',
    },
    availableResponses,
    canResumeAfterCompletion: task.canResumeAfterCompletion,
    blockerNote: task.blockerNote ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt ?? null,
    cancelledAt: task.cancelledAt ?? null,
  });
}
