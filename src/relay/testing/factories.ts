import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import { PREFIXES, type Branded, type IdFactory, type IdPrefix } from '../protocol/ids';
import type { CommandEnvelope, CommandType, ReportEnvelope } from '../protocol/envelopes';
import type {
  AgentHandoffPackage, Blueprint, CompletionPolicy, EvidenceRecord, FileClaim,
  FinalAuditReport, PermissionPolicy, RelayProject, RelayRun, RelayTask,
  ReviewerVerdictRecord, RevisionContract, TaskAssignment, UsageRecord,
  VerificationRecord,
} from '../protocol/contracts';
// Value import, deliberately NOT re-exported: the condition set is owned by the
// protocol contract that pins it, and fixtures consume it like anything else.
import { FIFTEEN_CONDITIONS } from '../protocol/contracts';
import type { Provenance, ReportType, Role } from '../protocol/enums';

/**
 * Deterministic test factories — the ONLY place tests mint ids/time.
 *
 * The application uses createRandomIdFactory. This module is BANNED from the
 * production dependency graph: `src/relay/testing/` is a FORBIDDEN_DIR in
 * src/relay/shared/browser-boundary.test.ts, so nothing reachable from the
 * browser entry may import it, and a rule in
 * src/relay/relay-core-boundary.test.ts forbids it across the nine core roots
 * (protocol, core, ledger, storage, testing, coordination, handoff,
 * verification, recovery).
 *
 * It is NOT banned repository-wide, and saying so would be false. Four Node-
 * only OFFLINE HARNESSES import `deterministicIds` and `testClock` on purpose,
 * because a contract-verification run has to be reproducible:
 *
 *   src/relay/persistence/driver-main.ts                  (recovery drill)
 *   src/relay/connectors/claude-code/contract-verify.ts
 *   src/relay/connectors/codex-reviewer/verify-harness.ts
 *   src/relay/connectors/supervised/verify-harness.ts
 *
 * Each builds a throwaway temp directory and makes no provider call. They sit
 * under connectors/ and persistence/, which the browser boundary already
 * forbids, so none of them can reach the shipped application. A website,
 * bridge or LIVE runtime import of this module remains forbidden.
 */

export function deterministicIds(): IdFactory & { minted: string[] } {
  const counters = new Map<string, number>();
  const minted: string[] = [];
  return {
    minted,
    next<P extends IdPrefix>(prefix: P) {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      const value = `${PREFIXES[prefix]}t${String(n).padStart(4, '0')}` as Branded<P>;
      minted.push(value);
      return value;
    },
  };
}

export function testClock(startIso = '2026-07-21T22:00:00.000Z', stepMs = 1000) {
  let t = Date.parse(startIso);
  return {
    now(): string {
      const value = new Date(t).toISOString();
      t += stepMs;
      return value;
    },
    peek(): string {
      return new Date(t).toISOString();
    },
  };
}

const T0 = '2026-07-21T22:00:00.000Z';

export const fixedId = <P extends IdPrefix>(prefix: P, token = 'fixed'): Branded<P> =>
  `${PREFIXES[prefix]}${token}` as Branded<P>;

export function makeCommand<T extends CommandType>(
  commandType: T,
  payload: Record<string, unknown>,
  overrides: Partial<CommandEnvelope> = {},
): CommandEnvelope {
  return {
    protocolVersion: RELAY_PROTOCOL_VERSION,
    commandId: `cmd-${commandType}-1`,
    commandType,
    issuedAt: T0,
    actor: { kind: 'user', id: 'founder' },
    payload,
    provenance: 'manual',
    ...overrides,
  } as CommandEnvelope;
}

export function makeReport(
  reportType: ReportType,
  payload: Record<string, unknown>,
  overrides: Partial<ReportEnvelope> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    protocolVersion: RELAY_PROTOCOL_VERSION,
    reportId: fixedId('rpt', `${reportType}-1`),
    projectId: fixedId('prj'),
    runId: fixedId('run'),
    reportType,
    agentIdentity: { adapterId: 'sim-coding-agent', role: 'coding-agent', displayName: 'Simulated Coding Agent' },
    provenance: 'simulated',
    submittedAt: T0,
    payload,
  };
  if (reportType !== 'blueprint') {
    base.taskId = fixedId('tsk');
    base.packageId = fixedId('pkg');
  }
  return { ...base, ...overrides };
}

export function makeRun(overrides: Partial<RelayRun> = {}): RelayRun {
  return {
    runId: fixedId('run'),
    projectId: fixedId('prj'),
    createdAt: T0,
    status: 'created',
    phase: 'blueprint',
    objective: 'Prove the deterministic golden path.',
    mode: 'guided',
    taskIds: [],
    budget: { maxUsd: 1 },
    loopPolicy: { maxAutomaticRevisions: 1 },
    repairCount: 0,
    provenanceProfile: 'simulated',
    verificationRefs: [],
    reviewRefs: [],
    failureRefs: [],
    ...overrides,
  };
}

export function makeTask(overrides: Partial<RelayTask> = {}): RelayTask {
  return {
    taskId: fixedId('tsk'),
    projectId: fixedId('prj'),
    runId: fixedId('run'),
    objective: 'Implement the simulated feature.',
    category: 'implementation',
    status: 'proposed',
    ownerAssignmentId: null,
    dependencies: [],
    claimedFiles: ['src/sim/feature.ts'],
    claimedResources: [],
    acceptanceCriteria: ['simulated checks pass'],
    completionPolicyId: fixedId('pol'),
    contextVersion: 1 as RelayTask['contextVersion'],
    baseRevision: 'rev-abc123',
    createdAt: T0,
    updatedAt: T0,
    priority: 1,
    ...overrides,
  };
}

export function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    blueprintId: fixedId('blu'),
    projectId: fixedId('prj'),
    runId: fixedId('run'),
    version: 1,
    source: 'simulated',
    architectIdentity: { adapterId: 'sim-architect', displayName: 'Simulated Architect' },
    submittedAt: T0,
    content: {
      objectiveRestatement: 'Restated objective.',
      approach: 'Simulated approach.',
      taskBreakdown: ['one task'],
      acceptanceCriteria: ['checks pass'],
      risks: [],
      constraints: [],
    },
    provenance: 'simulated',
    ...overrides,
  };
}

export function makeVerification(
  outcome: VerificationRecord['outcome'],
  overrides: Partial<VerificationRecord> = {},
): VerificationRecord {
  return {
    verificationId: fixedId('vrf', `${outcome}-1`),
    taskId: fixedId('tsk'),
    runId: fixedId('run'),
    policyId: fixedId('pol'),
    bundleId: fixedId('bnd'),
    at: T0,
    outcome,
    checks: [{ id: 'tests', label: 'Simulated tests', status: outcome === 'passed' ? 'passed' : 'failed', detail: 'sim' }],
    ...overrides,
  };
}

export function makeVerdict(
  verdict: ReviewerVerdictRecord['verdict'],
  overrides: Partial<ReviewerVerdictRecord> = {},
): ReviewerVerdictRecord {
  return {
    reportId: fixedId('rpt', `review-${verdict}`),
    reviewerAssignmentId: fixedId('asn', 'reviewer'),
    verdict,
    findings:
      verdict === 'changes_requested'
        ? [{ id: 'R1', severity: 'major', title: 'Simulated defect', detail: 'Found by simulated reviewer.' }]
        : [],
    independent: true,
    provenance: 'simulated',
    ...overrides,
  };
}

export function makeRevisionContract(
  overrides: Partial<RevisionContract> = {},
  unsatisfied: string[] = [],
): RevisionContract {
  return {
    packageId: fixedId('pkg', 'revision'),
    parentPackageId: fixedId('pkg'),
    findingsTargeted: ['R1'],
    narrowScope: { sameTask: true, sameFiles: true, sameAssignment: true },
    conditionsChecked: FIFTEEN_CONDITIONS.map((condition) => ({
      condition,
      satisfied: !unsatisfied.includes(condition),
    })),
    ...overrides,
  };
}

export function makePolicy(overrides: Partial<CompletionPolicy> = {}): CompletionPolicy {
  return {
    policyId: fixedId('pol'),
    riskLevel: 'low',
    requiredEvidence: [{ evidenceType: 'command', command: 'npx vitest run', mustPass: true }],
    requiresIndependentReview: true,
    requiresHumanApproval: false,
    enforcementRequirements: [],
    ...overrides,
  };
}

export function makeProject(overrides: Partial<RelayProject> = {}): RelayProject {
  return {
    projectId: fixedId('prj'),
    name: 'Sim project',
    createdAt: T0,
    objective: 'Prove coordination.',
    ledgerVersion: 1 as RelayProject['ledgerVersion'],
    ...overrides,
  };
}

export function makeAssignment(overrides: Partial<TaskAssignment> = {}): TaskAssignment {
  return {
    assignmentId: fixedId('asn'),
    taskId: fixedId('tsk'),
    role: 'coding-agent' as Role,
    adapterId: 'sim-coding-agent',
    assignedAt: T0,
    provenance: 'simulated' as Provenance,
    leaseExpiresAt: '2026-07-21T23:00:00.000Z',
    ...overrides,
  };
}

export function makeFileClaim(overrides: Partial<FileClaim> = {}): FileClaim {
  return {
    claimId: fixedId('clm'),
    taskId: fixedId('tsk'),
    path: 'src/sim/feature.ts',
    mode: 'write',
    claimedAt: T0,
    expiresAt: '2026-07-21T23:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

export function makeEvidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    evidenceId: fixedId('evd'),
    taskId: fixedId('tsk'),
    runId: fixedId('run'),
    source: 'sim-verification',
    evidenceType: 'command',
    command: 'npx vitest run',
    exitCode: 0,
    outputExcerpt: 'all green',
    executedAt: T0,
    environment: { os: 'linux', node: '20', cwd: '/sim' },
    repoRevision: 'rev-abc123',
    verificationStatus: 'passed',
    verifier: 'sim-verification',
    provenance: 'simulated',
    ...overrides,
  };
}

export function makeUsage(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    usageId: fixedId('use', `u${Math.abs(JSON.stringify(overrides).length)}`),
    runId: fixedId('run'),
    adapterId: 'sim-coding-agent',
    at: T0,
    kind: 'actual',
    ...overrides,
  };
}

export function makePermissionPolicy(overrides: Partial<PermissionPolicy> = {}): PermissionPolicy {
  return {
    permittedTools: [{ value: 'editor', enforcement: 'advisory' }],
    permittedFiles: [],
    prohibitedActions: [{ value: 'network-egress', enforcement: 'advisory' }],
    protectedPaths: [{ pattern: '.git', enforcement: 'enforced' }],
    ...overrides,
  };
}

export function makePackage(overrides: Partial<AgentHandoffPackage> = {}): AgentHandoffPackage {
  return {
    packageId: fixedId('pkg'),
    protocolVersion: RELAY_PROTOCOL_VERSION,
    projectId: fixedId('prj'),
    runId: fixedId('run'),
    taskId: fixedId('tsk'),
    targetAdapterId: 'sim-coding-agent',
    role: 'coding-agent',
    objective: 'Implement the simulated feature.',
    responsibilityBoundary: 'Implement within claimed files only.',
    contextRefs: [],
    requiredInputs: [],
    permittedTools: [{ value: 'editor', enforcement: 'advisory' }],
    permittedFiles: [{ value: 'src/sim/feature.ts', enforcement: 'advisory' }],
    prohibitedActions: [{ value: 'protected:.git', enforcement: 'enforced' }],
    dependencies: [],
    acceptanceCriteria: ['simulated checks pass'],
    requiredEvidence: ['targeted test results'],
    budget: { maxUsd: 1 },
    stoppingCondition: { description: 'stop after report', maxRuntimeMs: 60000 },
    expectedReportType: 'implementation',
    contextVersion: 1 as AgentHandoffPackage['contextVersion'],
    ledgerVersion: 1 as AgentHandoffPackage['ledgerVersion'],
    baseRevision: 'rev-abc123',
    createdAt: T0,
    idempotencyKey: 'pkg-key-1' as AgentHandoffPackage['idempotencyKey'],
    ...overrides,
  };
}

export function makeAudit(overrides: Partial<FinalAuditReport> = {}): FinalAuditReport {
  return {
    auditId: fixedId('aud'),
    runId: fixedId('run'),
    projectId: fixedId('prj'),
    at: T0,
    outcome: 'verified-complete',
    objective: 'Prove the deterministic golden path.',
    taskRefs: [fixedId('tsk')],
    verificationRefs: [fixedId('vrf', 'passed-1')],
    reviewRefs: [fixedId('rpt', 'review-approved')],
    repairCount: 0,
    evidenceBundleRefs: [fixedId('bnd')],
    usageSummary: {},
    checkpoints: [],
    provenanceProfile: 'simulated',
    unresolvedQuestions: [],
    ...overrides,
  };
}
