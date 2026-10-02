import {
  PROJECT_BRAIN_SCHEMA_V1,
  encodeProjectBrainCursor,
  projectBrainEventTypeForJulius,
  projectBrainRef,
  type ProjectBrainActor,
  type ProjectBrainActorKind,
  type ProjectBrainCursor,
  type ProjectBrainDeliverer,
  type ProjectBrainRecordDomain,
  type ProjectBrainScope,
  type ProjectBrainStatus,
} from './project-brain';

/**
 * THE PROJECT BRAIN DOCUMENT: EVERYTHING DURABLE ABOUT A PROJECT, IN ONE READ.
 *
 * Built from the rows Julius and Project Brain already hold -- nothing in it is
 * computed from a client's view, nothing is invented, and nothing is copied out
 * of the store into a second place. Every item names the row it came from (`ref`,
 * `sourceTable`), who stated it and which channel carried it. An empty section is
 * an empty section: there are no sample lines anywhere in this module.
 *
 * Pure: the store reads the rows inside one snapshot; this only arranges them.
 */

export const PROJECT_BRAIN_SECTIONS = [
  'objective', 'missions', 'architecture', 'requirements', 'constraints', 'acceptanceCriteria', 'decisions', 'research',
  'findings', 'handoffs', 'repairs', 'activity', 'evidence', 'evals', 'trace', 'provenance', 'governance', 'memory', 'companions',
] as const;
export type ProjectBrainSection = (typeof PROJECT_BRAIN_SECTIONS)[number];

/* ------------------------------------------------------------------ rows */

export interface PbMissionRow {
  readonly runId: string; readonly missionId: string; readonly state: string;
  readonly objective: string | null; readonly createdAt: string; readonly updatedAt: string;
  readonly cardRevision: string; readonly contractRevision: number; readonly brainRevision: number;
  readonly lifecycleReason: string | null; readonly lifecycleActor: string | null; readonly lifecycleAt: string | null;
  /** Safe policy fields of the Mission Contract snapshot; null where the snapshot does not carry them. */
  readonly policy: {
    readonly executionMode: string | null; readonly reviewRequirement: string | null; readonly completionRule: string | null;
    readonly limits: Readonly<Record<string, number | null>> | null;
    readonly requestedPermissions: readonly string[]; readonly systemsInScope: readonly string[]; readonly systemsOutOfScope: readonly string[];
    readonly workerRoles: readonly string[];
  };
}
export interface PbEntryRow { readonly entryId: string; readonly runId: string; readonly taskId: string | null; readonly workerId: string; readonly kind: string; readonly text: string; readonly evidenceIds: readonly string[]; readonly revision: number; readonly createdAt: string }
export interface PbCriterionRow { readonly runId: string; readonly criterionId: string; readonly description: string; readonly ordinal: number; readonly passedEvidenceIds: readonly string[]; readonly linkedEvidenceIds: readonly string[] }
export interface PbFindingRow { readonly findingId: string; readonly runId: string; readonly taskId: string; readonly reviewerWorkerId: string; readonly severity: string; readonly category: string; readonly claim: string; readonly criterionId: string | null; readonly evidenceIds: readonly string[]; readonly blocking: boolean; readonly status: string; readonly createdAt: string; readonly updatedAt: string }
export interface PbEvidenceRow { readonly evidenceId: string; readonly runId: string; readonly taskId: string; readonly workerId: string; readonly evidenceType: string; readonly status: string; readonly summary: string; readonly integrityHash: string | null; readonly occurredAt: string; readonly role: string | null }
export interface PbArtifactRow { readonly artifactId: string; readonly runId: string; readonly taskId: string; readonly role: string; readonly kind: string; readonly byteSize: number; readonly contentHash: string; readonly occurredAt: string }
export interface PbDecisionRow { readonly decisionId: string; readonly runId: string; readonly taskId: string; readonly action: string; readonly reasonCode: string; readonly summary: string; readonly evidenceIds: readonly string[]; readonly policyRevision: string; readonly occurredAt: string }
export interface PbRepairRow { readonly repairId: string; readonly runId: string; readonly originalTaskId: string; readonly repairTaskId: string; readonly round: number; readonly findingIds: readonly string[]; readonly evidenceIds: readonly string[]; readonly state: string; readonly createdAt: string; readonly updatedAt: string }
export interface PbApprovalRow { readonly approvalId: string; readonly runId: string; readonly taskId: string | null; readonly operation: string; readonly policyRevision: string; readonly reasonCode: string; readonly rationale: string; readonly state: string; readonly requestedAt: string; readonly decidedAt: string | null; readonly decidedBy: string | null }
export interface PbContractRow { readonly contractId: string; readonly revision: number; readonly runId: string; readonly taskId: string; readonly state: string; readonly lockedAt: string | null; readonly lockedBy: string | null; readonly createdAt: string }
export interface PbTransitionRow { readonly transitionId: string; readonly runId: string; readonly fromState: string; readonly toState: string; readonly reasonCode: string; readonly summary: string; readonly evidenceIds: readonly string[]; readonly occurredAt: string; readonly sequence: number }
export interface PbTrajectoryRow { readonly id: string; readonly runId: string; readonly kind: string; readonly taskId: string | null; readonly workerId: string | null; readonly providerId: string | null; readonly outcome: string | null; readonly durationMs: number | null; readonly inputTokens: number | null; readonly outputTokens: number | null; readonly occurredAt: string }
export interface PbClaimRow { readonly claimId: string; readonly standingRevision: number; readonly runId: string; readonly entryId: string; readonly provenance: string; readonly trust: string; readonly assertedBy: string; readonly assertedAt: string; readonly evidenceRefs: readonly string[]; readonly reason: string }
export interface PbContextRow { readonly contextId: string; readonly runId: string; readonly taskId: string; readonly workerRole: string; readonly compilerVersion: string; readonly characterCount: number; readonly truncated: boolean; readonly redactionCount: number; readonly sourceEntryCount: number; readonly createdAt: string }
export interface PbTaskRow { readonly taskId: string; readonly runId: string; readonly role: string; readonly taskType: string; readonly state: string; readonly updatedAt: string }
export interface PbSubagentRow { readonly requestId: string; readonly runId: string; readonly capability: string; readonly state: string; readonly depth: number; readonly updatedAt: string }
export interface PbRecordRow {
  readonly recordId: string; readonly runId: string | null; readonly scope: ProjectBrainScope; readonly domain: ProjectBrainRecordDomain;
  readonly status: ProjectBrainStatus; readonly title: string; readonly body: string; readonly subjectRef: string | null;
  readonly version: number; readonly contentHash: string; readonly author: ProjectBrainActor; readonly deliverer: ProjectBrainDeliverer;
  readonly createdAt: string; readonly updatedAt: string;
}
export interface PbLinkRow { readonly linkId: string; readonly fromRef: string; readonly relation: string; readonly toRef: string; readonly createdAt: string }
export interface PbMutationRow { readonly mutationId: string; readonly operation: string; readonly recordId: string | null; readonly resultingVersion: number | null; readonly runId: string | null; readonly author: ProjectBrainActor; readonly deliverer: ProjectBrainDeliverer; readonly eventId: string; readonly occurredAt: string }
export interface PbEventRow { readonly eventId: string; readonly streamId: string; readonly sequence: number; readonly eventType: string; readonly runId: string | null; readonly taskId: string | null; readonly workerId: string | null; readonly occurredAt: string }

/** A served-model view per role for the newest missions, as `JuliusRuntimeApi.inspectSlots` answers it. */
export interface PbSlotRow { readonly runId: string; readonly role: string; readonly providerId: string | null; readonly requestedModel: string | null; readonly servedModel: string | null; readonly state: string }

export interface ProjectBrainRows {
  readonly projectId: string;
  readonly observedAt: string;
  readonly cursor: ProjectBrainCursor;
  /** Present when the read is narrowed to one mission. */
  readonly runId: string | null;
  readonly missions: readonly PbMissionRow[];
  readonly entries: readonly PbEntryRow[];
  readonly criteria: readonly PbCriterionRow[];
  readonly findings: readonly PbFindingRow[];
  readonly evidence: readonly PbEvidenceRow[];
  readonly artifacts: readonly PbArtifactRow[];
  readonly decisions: readonly PbDecisionRow[];
  readonly repairs: readonly PbRepairRow[];
  readonly approvals: readonly PbApprovalRow[];
  readonly contracts: readonly PbContractRow[];
  readonly transitions: readonly PbTransitionRow[];
  readonly trajectory: readonly PbTrajectoryRow[];
  readonly claims: readonly PbClaimRow[];
  readonly contexts: readonly PbContextRow[];
  readonly tasks: readonly PbTaskRow[];
  readonly subagents: readonly PbSubagentRow[];
  readonly records: readonly PbRecordRow[];
  readonly links: readonly PbLinkRow[];
  readonly mutations: readonly PbMutationRow[];
  readonly events: readonly PbEventRow[];
  readonly slots: readonly PbSlotRow[];
  /** Row sets that reached their read limit, so a reader knows the section is a window. */
  readonly truncated: readonly string[];
  /** Julius brain entries in scope plus every Project Brain record version in scope, counted in the read's snapshot. */
  readonly revision: number;
}

/* --------------------------------------------------------------- document */

export type ProjectBrainItemSource = 'JULIUS' | 'PROJECT_BRAIN';
export type ProjectBrainAttribute = string | number | boolean | null;

export interface ProjectBrainItem {
  readonly ref: string;
  readonly section: ProjectBrainSection;
  /** What kind of thing this is in its own table's vocabulary. */
  readonly kind: string;
  readonly missionRef: string | null;
  readonly scope: ProjectBrainScope;
  readonly title: string;
  readonly text: string;
  readonly status: string | null;
  readonly version: number | null;
  readonly recordedAt: string | null;
  readonly author: ProjectBrainActor | null;
  readonly deliverer: ProjectBrainDeliverer | null;
  readonly source: ProjectBrainItemSource;
  readonly sourceTable: string;
  readonly evidenceRefs: readonly string[];
  readonly subjectRef: string | null;
  readonly attributes: Readonly<Record<string, ProjectBrainAttribute>>;
}

export interface ProjectBrainMissionSummary {
  readonly ref: string;
  readonly runId: string;
  readonly missionId: string;
  readonly state: string;
  readonly objective: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly openBlockingFindings: number;
  readonly criteriaSatisfied: number;
  readonly criteriaTotal: number;
}

export interface ProjectBrainDocument {
  readonly schemaVersion: typeof PROJECT_BRAIN_SCHEMA_V1;
  readonly projectId: string;
  readonly observedAt: string;
  /** Resume the live feed from here: everything in this document is at or before it. */
  readonly cursor: string;
  readonly scope: { readonly kind: ProjectBrainScope; readonly runId: string | null };
  /**
   * A monotone count of durable Brain facts this document was built from: Julius's
   * brain entries plus Project Brain record versions. Two reads with the same
   * revision saw the same Brain.
   */
  readonly revision: number;
  readonly missions: readonly ProjectBrainMissionSummary[];
  readonly sections: Readonly<Record<ProjectBrainSection, readonly ProjectBrainItem[]>>;
  readonly links: readonly { readonly ref: string; readonly fromRef: string; readonly relation: string; readonly toRef: string; readonly createdAt: string }[];
  readonly counts: Readonly<Record<ProjectBrainSection, number>>;
  readonly truncated: readonly string[];
}

/* ---------------------------------------------------------------- helpers */

const TEXT_MAX = 1200;
const bounded = (text: string, max = TEXT_MAX): string => (text.length > max ? `${text.slice(0, max)}…` : text);
const firstLine = (text: string, max = 160): string => bounded(text.split('\n')[0]?.trim() ?? '', max);
const missionRef = (runId: string | null): string | null => (runId === null ? null : projectBrainRef('mission', runId));
const JULIUS: ProjectBrainActor = { kind: 'JULIUS', id: 'julius' };
const RUNTIME: ProjectBrainDeliverer = { kind: 'JULIUS_RUNTIME', id: 'julius-runtime' };
const BOOTSTRAP: ProjectBrainDeliverer = { kind: 'RELAY_BOOTSTRAP', id: 'relay-bootstrap' };

const ROLE_KIND: Readonly<Record<string, ProjectBrainActorKind>> = {
  PROMPT_ARCHITECT: 'PROMPT_ARCHITECT',
  CODING_AGENT: 'CODING_AGENT',
  INDEPENDENT_REVIEWER: 'INDEPENDENT_REVIEWER',
};

/** Who wrote a Julius row: its role when the row's task says, else Julius. Never guessed from a name. */
const juliusAuthor = (workerId: string | null, role: string | null): ProjectBrainActor => {
  if (workerId === null || workerId === '') return JULIUS;
  if (workerId === 'relay-bootstrap') return { kind: 'SYSTEM', id: workerId };
  const kind = role === null ? undefined : ROLE_KIND[role];
  return { kind: kind ?? 'JULIUS', id: workerId };
};

const evidenceRefs = (ids: readonly string[]): readonly string[] => ids.map((id) => projectBrainRef('evidence', id));

const item = (fields: Omit<ProjectBrainItem, 'attributes' | 'subjectRef' | 'evidenceRefs' | 'version'> & Partial<Pick<ProjectBrainItem, 'attributes' | 'subjectRef' | 'evidenceRefs' | 'version'>>): ProjectBrainItem => ({
  attributes: {}, subjectRef: null, evidenceRefs: [], version: null, ...fields,
});

/** Julius's seed text carries a label (`REQUIREMENT: ...`); the label is the section, not the content. */
const stripLabel = (text: string, label: string): string => (text.startsWith(`${label}: `) ? text.slice(label.length + 2) : text);

/** Which section a Julius brain entry belongs to, from the id Julius gave it. Null: a context copy shown elsewhere. */
export function projectBrainSectionForEntry(entry: Pick<PbEntryRow, 'entryId' | 'runId' | 'kind'>): ProjectBrainSection | null {
  const id = entry.entryId;
  if (id === `${entry.runId}:objective`) return 'objective';
  if (id.startsWith(`${entry.runId}:requirement:`)) return 'requirements';
  if (id.startsWith(`${entry.runId}:constraint:`)) return 'constraints';
  if (id === `${entry.runId}:criteria`) return null; // the criteria table is the authority; this is their context form
  if (id.startsWith('brain:architecture:')) return 'architecture';
  if (id.startsWith('brain:research-')) return 'research';
  if (id.startsWith('brain:decision:')) return null; // the verification decision row is the authority
  if (id.startsWith('finding:') || id.startsWith('brain:repair-round:')) return null; // the finding row is the authority
  if (id.startsWith('carried:')) return 'provenance';
  if (entry.kind === 'HANDOFF') return 'handoffs';
  if (entry.kind === 'DECISION') return 'decisions';
  if (entry.kind === 'RESEARCH_NOTE') return 'research';
  if (entry.kind === 'CONSTRAINT') return 'constraints';
  if (entry.kind === 'ACCEPTANCE_UPDATE') return 'requirements';
  if (entry.kind === 'FINDING') return null;
  return 'evidence';
}

const RECORD_SECTION: Readonly<Record<ProjectBrainRecordDomain, ProjectBrainSection>> = {
  USER_FACT: 'memory', PREFERENCE: 'memory', IDENTITY: 'memory', INSTRUCTION: 'memory', WORKFLOW: 'memory', SCRATCHPAD: 'memory',
  SHARED_CONTEXT: 'companions', COMPANION_RESULT: 'companions',
  OBJECTIVE_NOTE: 'objective', MISSION_INPUT: 'objective', REQUIREMENT: 'requirements', CONSTRAINT: 'constraints',
  ACCEPTANCE_CRITERION: 'acceptanceCriteria', ARCHITECTURE_NOTE: 'architecture', DECISION: 'decisions', RESEARCH_NOTE: 'research',
  MEMORY_REVIEW: 'provenance', FINDING_RESPONSE: 'findings', GOVERNANCE_ACK: 'governance',
};

export const projectBrainSectionForRecord = (domain: ProjectBrainRecordDomain): ProjectBrainSection => RECORD_SECTION[domain];

/* ------------------------------------------------------------- projection */

export function buildProjectBrainDocument(rows: ProjectBrainRows): ProjectBrainDocument {
  const sections = Object.fromEntries(PROJECT_BRAIN_SECTIONS.map((section) => [section, [] as ProjectBrainItem[]])) as Record<ProjectBrainSection, ProjectBrainItem[]>;
  const push = (value: ProjectBrainItem) => { sections[value.section].push(value); };
  const roleOfTask = new Map(rows.tasks.map((task) => [task.taskId, task.role] as const));

  for (const mission of rows.missions) {
    const ref = projectBrainRef('mission', mission.runId);
    push(item({
      ref, section: 'missions', kind: 'MISSION', missionRef: ref, scope: 'MISSION',
      title: mission.objective === null ? mission.missionId : firstLine(mission.objective),
      text: `${mission.missionId} · ${mission.state}`, status: mission.state, recordedAt: mission.updatedAt,
      author: JULIUS, deliverer: RUNTIME, source: 'JULIUS', sourceTable: 'julius_runs',
      attributes: {
        missionId: mission.missionId, cardRevision: mission.cardRevision, contractRevision: mission.contractRevision,
        brainRevision: mission.brainRevision, createdAt: mission.createdAt,
        lifecycleActor: mission.lifecycleActor, lifecycleReason: mission.lifecycleReason, lifecycleAt: mission.lifecycleAt,
      },
    }));
    // THE GOVERNANCE THE MISSION RUNS UNDER, from its own contract.
    push(item({
      ref: `${ref}#policy`, section: 'governance', kind: 'MISSION_POLICY', missionRef: ref, scope: 'MISSION',
      title: `Mission policy: ${mission.policy.executionMode ?? 'unstated'} execution, ${mission.policy.reviewRequirement ?? 'unstated'} review`,
      text: [
        mission.policy.completionRule === null ? null : `completion: ${mission.policy.completionRule}`,
        mission.policy.limits === null ? null : `limits: ${Object.entries(mission.policy.limits).map(([k, v]) => `${k}=${v === null ? 'none' : v}`).join(', ')}`,
        mission.policy.requestedPermissions.length === 0 ? null : `permissions requested: ${mission.policy.requestedPermissions.join(', ')}`,
        mission.policy.systemsOutOfScope.length === 0 ? null : `out of scope: ${mission.policy.systemsOutOfScope.join(', ')}`,
        mission.policy.workerRoles.length === 0 ? null : `roles: ${mission.policy.workerRoles.join(', ')}`,
      ].filter((line): line is string => line !== null).join(' · '),
      status: mission.state, recordedAt: mission.createdAt, author: JULIUS, deliverer: BOOTSTRAP, source: 'JULIUS', sourceTable: 'mission_contracts',
      attributes: {
        executionMode: mission.policy.executionMode, reviewRequirement: mission.policy.reviewRequirement,
        completionRule: mission.policy.completionRule,
        spendUsd: mission.policy.limits?.spendUsd ?? null, repairCycles: mission.policy.limits?.repairCycles ?? null,
      },
    }));
    if (mission.lifecycleActor !== null) {
      push(item({
        ref: `${ref}#lifecycle`, section: 'governance', kind: 'LIFECYCLE_CONTROL', missionRef: ref, scope: 'MISSION',
        title: `${mission.state} by ${mission.lifecycleActor}`, text: mission.lifecycleReason ?? '', status: mission.state,
        recordedAt: mission.lifecycleAt, author: { kind: 'FOUNDER', id: mission.lifecycleActor }, deliverer: { kind: 'OPERATOR_API', id: 'julius-lifecycle-routes' },
        source: 'JULIUS', sourceTable: 'julius_runs',
      }));
    }
  }

  for (const entry of rows.entries) {
    const section = projectBrainSectionForEntry(entry);
    if (section === null) continue;
    const role = entry.taskId === null ? null : roleOfTask.get(entry.taskId) ?? null;
    const isSeed = entry.workerId === 'relay-bootstrap';
    const text = section === 'objective' ? stripLabel(entry.text, 'OBJECTIVE')
      : section === 'requirements' ? stripLabel(entry.text, 'REQUIREMENT')
        : section === 'constraints' ? stripLabel(entry.text, 'CONSTRAINT') : entry.text;
    push(item({
      ref: projectBrainRef('entry', entry.entryId), section, kind: `BRAIN_${entry.kind}`, missionRef: missionRef(entry.runId), scope: 'MISSION',
      title: firstLine(text), text: bounded(text), status: section === 'requirements' || section === 'constraints' || section === 'objective' ? 'CONTRACT' : null,
      version: entry.revision, recordedAt: entry.createdAt, author: juliusAuthor(entry.workerId, role),
      deliverer: isSeed ? BOOTSTRAP : RUNTIME, source: 'JULIUS', sourceTable: 'julius_brain_entries',
      evidenceRefs: evidenceRefs(entry.evidenceIds), attributes: { brainRevision: entry.revision, taskId: entry.taskId },
    }));
  }

  for (const criterion of rows.criteria) {
    const ref = projectBrainRef('criterion', `${criterion.runId}/${criterion.criterionId}`);
    const satisfied = criterion.passedEvidenceIds.length > 0;
    push(item({
      ref, section: 'acceptanceCriteria', kind: 'ACCEPTANCE_CRITERION', missionRef: missionRef(criterion.runId), scope: 'MISSION',
      title: `${criterion.criterionId}: ${firstLine(criterion.description, 140)}`, text: bounded(criterion.description),
      status: satisfied ? 'SATISFIED' : 'UNSATISFIED', recordedAt: null, author: JULIUS, deliverer: BOOTSTRAP,
      source: 'JULIUS', sourceTable: 'julius_acceptance_criteria', evidenceRefs: evidenceRefs(criterion.linkedEvidenceIds),
      attributes: { criterionId: criterion.criterionId, ordinal: criterion.ordinal, satisfied },
    }));
    push(item({
      ref: `${ref}#eval`, section: 'evals', kind: 'CRITERION_EVALUATION', missionRef: missionRef(criterion.runId), scope: 'MISSION',
      title: `${criterion.criterionId} ${satisfied ? 'satisfied' : 'not yet satisfied'}`,
      text: satisfied ? `Passed evidence: ${criterion.passedEvidenceIds.join(', ')}` : 'No passing evidence is linked to this criterion.',
      status: satisfied ? 'PASSED' : 'PENDING', recordedAt: null, author: { kind: 'JULIUS', id: 'julius:verification' }, deliverer: RUNTIME,
      source: 'JULIUS', sourceTable: 'julius_criterion_evidence', subjectRef: ref, evidenceRefs: evidenceRefs(criterion.passedEvidenceIds),
      attributes: { criterionId: criterion.criterionId, result: satisfied ? 'PASSED' : 'PENDING', evaluator: 'julius:verification' },
    }));
  }

  for (const finding of rows.findings) {
    push(item({
      ref: projectBrainRef('finding', finding.findingId), section: 'findings', kind: 'REVIEWER_FINDING', missionRef: missionRef(finding.runId), scope: 'MISSION',
      title: `${finding.severity} ${finding.category}${finding.blocking ? ' (blocking)' : ''}`, text: bounded(finding.claim),
      status: finding.status, recordedAt: finding.updatedAt,
      author: { kind: 'INDEPENDENT_REVIEWER', id: finding.reviewerWorkerId }, deliverer: RUNTIME,
      source: 'JULIUS', sourceTable: 'julius_reviewer_findings', evidenceRefs: evidenceRefs(finding.evidenceIds),
      subjectRef: finding.criterionId === null ? null : projectBrainRef('criterion', `${finding.runId}/${finding.criterionId}`),
      attributes: { severity: finding.severity, category: finding.category, blocking: finding.blocking, taskId: finding.taskId, createdAt: finding.createdAt },
    }));
  }

  for (const evidence of rows.evidence) {
    push(item({
      ref: projectBrainRef('evidence', evidence.evidenceId), section: 'evidence', kind: `EVIDENCE_${evidence.evidenceType}`,
      missionRef: missionRef(evidence.runId), scope: 'MISSION', title: `${evidence.evidenceType} ${evidence.status}`, text: bounded(evidence.summary),
      status: evidence.status, recordedAt: evidence.occurredAt, author: juliusAuthor(evidence.workerId, evidence.role), deliverer: RUNTIME,
      source: 'JULIUS', sourceTable: 'julius_evidence', attributes: { taskId: evidence.taskId, integrityHash: evidence.integrityHash },
    }));
  }
  for (const artifact of rows.artifacts) {
    const section: ProjectBrainSection = artifact.kind === 'RESEARCH' ? 'research' : 'evidence';
    push(item({
      ref: projectBrainRef('artifact', artifact.artifactId), section, kind: `ARTIFACT_${artifact.kind}`, missionRef: missionRef(artifact.runId), scope: 'MISSION',
      title: `${artifact.kind} artifact (${artifact.byteSize} bytes)`, text: `sha256 ${artifact.contentHash}`,
      status: null, recordedAt: artifact.occurredAt, author: juliusAuthor(artifact.role, artifact.role), deliverer: RUNTIME,
      source: 'JULIUS', sourceTable: 'julius_work_artifacts', attributes: { taskId: artifact.taskId, contentHash: artifact.contentHash, byteSize: artifact.byteSize },
    }));
  }

  for (const decision of rows.decisions) {
    push(item({
      ref: projectBrainRef('decision', decision.decisionId), section: 'decisions', kind: 'VERIFICATION_DECISION',
      missionRef: missionRef(decision.runId), scope: 'MISSION', title: `${decision.action}: ${decision.reasonCode}`, text: bounded(decision.summary),
      status: decision.action, recordedAt: decision.occurredAt, author: JULIUS, deliverer: RUNTIME,
      source: 'JULIUS', sourceTable: 'julius_verification_decisions', evidenceRefs: evidenceRefs(decision.evidenceIds),
      attributes: { taskId: decision.taskId, policyRevision: decision.policyRevision, action: decision.action, reasonCode: decision.reasonCode },
    }));
    push(item({
      ref: `${projectBrainRef('decision', decision.decisionId)}#eval`, section: 'evals', kind: 'VERIFICATION_EVALUATION',
      missionRef: missionRef(decision.runId), scope: 'MISSION', title: `Verification of ${decision.taskId}: ${decision.action}`, text: bounded(decision.summary),
      status: decision.action === 'ACCEPT' || decision.action === 'COMPLETE' ? 'PASSED' : decision.action === 'HALT' ? 'FAILED' : 'REPAIR',
      recordedAt: decision.occurredAt, author: { kind: 'JULIUS', id: 'julius:verification' }, deliverer: RUNTIME,
      source: 'JULIUS', sourceTable: 'julius_verification_decisions', evidenceRefs: evidenceRefs(decision.evidenceIds),
      subjectRef: projectBrainRef('task', decision.taskId),
      attributes: { result: decision.action, evaluator: 'julius:verification', policyRevision: decision.policyRevision },
    }));
  }

  for (const repair of rows.repairs) {
    push(item({
      ref: projectBrainRef('repair', repair.repairId), section: 'repairs', kind: 'REPAIR_CYCLE', missionRef: missionRef(repair.runId), scope: 'MISSION',
      title: `Repair round ${repair.round} of ${repair.originalTaskId}`, text: `${repair.findingIds.length} finding(s) addressed by ${repair.repairTaskId}`,
      status: repair.state, recordedAt: repair.updatedAt, author: JULIUS, deliverer: RUNTIME, source: 'JULIUS', sourceTable: 'julius_repair_cycles',
      evidenceRefs: evidenceRefs(repair.evidenceIds),
      attributes: { round: repair.round, originalTaskId: repair.originalTaskId, repairTaskId: repair.repairTaskId, findings: repair.findingIds.map((id) => projectBrainRef('finding', id)).join(' ') },
    }));
  }

  for (const approval of rows.approvals) {
    push(item({
      ref: projectBrainRef('approval', approval.approvalId), section: 'governance', kind: 'APPROVAL', missionRef: missionRef(approval.runId), scope: 'MISSION',
      title: `${approval.operation}: ${approval.state}`, text: bounded(approval.rationale), status: approval.state,
      recordedAt: approval.decidedAt ?? approval.requestedAt, author: JULIUS, deliverer: RUNTIME, source: 'JULIUS', sourceTable: 'julius_approvals',
      attributes: { operation: approval.operation, reasonCode: approval.reasonCode, policyRevision: approval.policyRevision, decidedBy: approval.decidedBy, requestedAt: approval.requestedAt },
    }));
  }
  for (const contract of rows.contracts) {
    push(item({
      ref: projectBrainRef('contract', `${contract.contractId}@${contract.revision}`), section: 'governance', kind: 'TASK_CONTRACT',
      missionRef: missionRef(contract.runId), scope: 'MISSION', title: `Task contract r${contract.revision}: ${contract.state}`,
      text: contract.lockedBy === null ? `for ${contract.taskId}` : `for ${contract.taskId}, locked by ${contract.lockedBy}`,
      status: contract.state, recordedAt: contract.lockedAt ?? contract.createdAt, author: JULIUS, deliverer: RUNTIME,
      source: 'JULIUS', sourceTable: 'julius_task_contracts', attributes: { taskId: contract.taskId, revision: contract.revision },
    }));
  }
  for (const slot of rows.slots) {
    push(item({
      ref: `${projectBrainRef('mission', slot.runId)}#slot:${slot.role}`, section: 'governance', kind: 'MODEL_TOPOLOGY',
      missionRef: missionRef(slot.runId), scope: 'MISSION', title: `${slot.role}: ${slot.requestedModel ?? 'model unstated'}`,
      text: `served ${slot.servedModel ?? 'nothing yet'} via ${slot.providerId ?? 'no provider yet'}`, status: slot.state, recordedAt: null,
      author: JULIUS, deliverer: RUNTIME, source: 'JULIUS', sourceTable: 'julius_slots',
      attributes: { role: slot.role, providerId: slot.providerId, requestedModel: slot.requestedModel, servedModel: slot.servedModel },
    }));
  }

  for (const transition of rows.transitions) {
    push(item({
      ref: projectBrainRef('transition', transition.transitionId), section: 'trace', kind: 'STATE_TRANSITION', missionRef: missionRef(transition.runId), scope: 'MISSION',
      title: `${transition.fromState} → ${transition.toState}`, text: bounded(transition.summary), status: transition.toState,
      recordedAt: transition.occurredAt, author: JULIUS, deliverer: RUNTIME, source: 'JULIUS', sourceTable: 'julius_transitions',
      evidenceRefs: evidenceRefs(transition.evidenceIds), attributes: { reasonCode: transition.reasonCode, sequence: transition.sequence },
    }));
  }
  for (const step of rows.trajectory) {
    push(item({
      ref: projectBrainRef('trajectory', step.id), section: 'trace', kind: `TRAJECTORY_${step.kind}`, missionRef: missionRef(step.runId), scope: 'MISSION',
      title: `${step.kind}${step.outcome === null ? '' : `: ${step.outcome}`}`,
      text: [step.workerId === null ? null : `worker ${step.workerId}`, step.providerId === null ? null : `provider ${step.providerId}`,
        step.durationMs === null ? null : `${step.durationMs} ms`].filter((value): value is string => value !== null).join(' · '),
      status: step.outcome, recordedAt: step.occurredAt, author: juliusAuthor(step.workerId, step.taskId === null ? null : roleOfTask.get(step.taskId) ?? null),
      deliverer: RUNTIME, source: 'JULIUS', sourceTable: 'julius_trajectory_events',
      attributes: { taskId: step.taskId, providerId: step.providerId, inputTokens: step.inputTokens, outputTokens: step.outputTokens, durationMs: step.durationMs },
    }));
  }
  for (const subagent of rows.subagents) {
    push(item({
      ref: projectBrainRef('task', `subagent:${subagent.requestId}`), section: 'trace', kind: `SUBAGENT_${subagent.state}`, missionRef: missionRef(subagent.runId), scope: 'MISSION',
      title: `Sub-agent for ${subagent.capability}: ${subagent.state}`, text: `depth ${subagent.depth}`, status: subagent.state,
      recordedAt: subagent.updatedAt, author: JULIUS, deliverer: RUNTIME, source: 'JULIUS', sourceTable: 'julius_subagents',
      attributes: { capability: subagent.capability, depth: subagent.depth },
    }));
  }
  for (const context of rows.contexts) {
    push(item({
      ref: projectBrainRef('trajectory', `context:${context.contextId}`), section: 'handoffs', kind: 'CONTEXT_PACKET', missionRef: missionRef(context.runId), scope: 'MISSION',
      title: `Context to ${context.workerRole}: ${context.characterCount} characters`,
      text: `${context.sourceEntryCount} Brain entries · compiler ${context.compilerVersion}${context.truncated ? ' · truncated' : ''}${context.redactionCount > 0 ? ` · ${context.redactionCount} redacted` : ''}`,
      status: null, recordedAt: context.createdAt, author: JULIUS, deliverer: RUNTIME, source: 'JULIUS', sourceTable: 'julius_context_snapshots',
      attributes: { workerRole: context.workerRole, characterCount: context.characterCount, truncated: context.truncated, taskId: context.taskId },
    }));
  }

  for (const claim of rows.claims) {
    push(item({
      ref: projectBrainRef('claim', claim.claimId), section: 'provenance', kind: 'CLAIM_STANDING', missionRef: missionRef(claim.runId), scope: 'MISSION',
      title: `${claim.trust} (${claim.provenance})`, text: `asserted by ${claim.assertedBy}: ${bounded(claim.reason, 300)}`, status: claim.trust,
      version: claim.standingRevision, recordedAt: claim.assertedAt, author: { kind: 'JULIUS', id: claim.assertedBy }, deliverer: RUNTIME,
      source: 'JULIUS', sourceTable: 'julius_claim_standings', subjectRef: projectBrainRef('entry', claim.entryId), evidenceRefs: claim.evidenceRefs,
      attributes: { provenance: claim.provenance, trust: claim.trust },
    }));
  }

  for (const record of rows.records) {
    push(item({
      ref: record.recordId, section: projectBrainSectionForRecord(record.domain), kind: record.domain, missionRef: missionRef(record.runId), scope: record.scope,
      title: record.title, text: bounded(record.body), status: record.status, version: record.version, recordedAt: record.updatedAt,
      author: record.author, deliverer: record.deliverer, source: 'PROJECT_BRAIN', sourceTable: 'project_brain_records',
      subjectRef: record.subjectRef, attributes: { createdAt: record.createdAt, contentHash: record.contentHash },
    }));
  }
  for (const mutation of rows.mutations) {
    push(item({
      ref: projectBrainRef('event', mutation.eventId), section: 'provenance', kind: `MUTATION_${mutation.operation}`, missionRef: missionRef(mutation.runId),
      scope: mutation.runId === null ? 'PROJECT' : 'MISSION',
      title: `${mutation.operation} by ${mutation.author.kind}`, text: `${mutation.author.id} via ${mutation.deliverer.kind}`,
      status: null, version: mutation.resultingVersion, recordedAt: mutation.occurredAt, author: mutation.author, deliverer: mutation.deliverer,
      source: 'PROJECT_BRAIN', sourceTable: 'project_brain_mutations', subjectRef: mutation.recordId,
      attributes: { mutationId: mutation.mutationId },
    }));
  }
  for (const event of rows.events) {
    push(item({
      ref: projectBrainRef('event', event.eventId), section: 'activity', kind: event.eventType,
      missionRef: missionRef(event.runId), scope: event.runId === null ? 'PROJECT' : 'MISSION',
      title: event.eventType.startsWith('project_brain.') ? event.eventType : projectBrainEventTypeForJulius(event.eventType),
      text: event.eventType, status: null, recordedAt: event.occurredAt,
      author: event.workerId === null ? null : juliusAuthor(event.workerId, event.taskId === null ? null : roleOfTask.get(event.taskId) ?? null),
      deliverer: event.eventType.startsWith('project_brain.') ? null : RUNTIME,
      source: event.eventType.startsWith('project_brain.') ? 'PROJECT_BRAIN' : 'JULIUS', sourceTable: 'events',
      attributes: { streamId: event.streamId, sequence: event.sequence, taskId: event.taskId },
    }));
  }

  // Newest first in every section; ties broken by ref so two reads order alike.
  for (const section of PROJECT_BRAIN_SECTIONS) {
    sections[section].sort((a, b) => {
      const at = (b.recordedAt ?? '').localeCompare(a.recordedAt ?? '');
      return at !== 0 ? at : a.ref.localeCompare(b.ref);
    });
  }

  const missions: ProjectBrainMissionSummary[] = rows.missions.map((mission) => {
    const criteria = rows.criteria.filter((criterion) => criterion.runId === mission.runId);
    return {
      ref: projectBrainRef('mission', mission.runId), runId: mission.runId, missionId: mission.missionId, state: mission.state,
      objective: mission.objective, createdAt: mission.createdAt, updatedAt: mission.updatedAt,
      openBlockingFindings: rows.findings.filter((finding) => finding.runId === mission.runId && finding.blocking && finding.status === 'OPEN').length,
      criteriaSatisfied: criteria.filter((criterion) => criterion.passedEvidenceIds.length > 0).length,
      criteriaTotal: criteria.length,
    };
  });

  const counts = Object.fromEntries(PROJECT_BRAIN_SECTIONS.map((section) => [section, sections[section].length])) as Record<ProjectBrainSection, number>;
  return {
    schemaVersion: PROJECT_BRAIN_SCHEMA_V1,
    projectId: rows.projectId,
    observedAt: rows.observedAt,
    cursor: encodeProjectBrainCursor(rows.cursor),
    scope: { kind: rows.runId === null ? 'PROJECT' : 'MISSION', runId: rows.runId },
    revision: rows.revision,
    missions,
    sections,
    links: rows.links.map((link) => ({ ref: `link:${link.linkId}`, fromRef: link.fromRef, relation: link.relation, toRef: link.toRef, createdAt: link.createdAt })),
    counts,
    truncated: rows.truncated,
  };
}
