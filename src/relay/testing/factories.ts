import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import { PREFIXES, type Branded, type IdFactory, type IdPrefix } from '../protocol/ids';
import type { CommandEnvelope, CommandType, ReportEnvelope } from '../protocol/envelopes';
import type {
  Blueprint, CompletionPolicy, FinalAuditReport, RelayRun, RelayTask,
  ReviewerVerdictRecord, RevisionContract, VerificationRecord,
} from '../protocol/contracts';
import type { ReportType } from '../protocol/enums';

/**
 * Deterministic test factories — the ONLY place tests mint ids/time.
 * Production uses createRandomIdFactory; the two never mix.
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

export const FIFTEEN_CONDITIONS = [
  'objective-evidence', 'narrow-unambiguous', 'same-agent-session', 'inside-task-objective',
  'inside-file-claims', 'no-protected-file', 'no-new-permission', 'no-destructive-command',
  'no-deployment', 'no-new-dependency', 'no-new-credentials', 'within-budget',
  'no-budget-warning-checkpoint', 'no-unresolved-decision', 'no-conflict-with-canonical-decision',
] as const;

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
