import { fail, ok, relayError } from '../protocol/errors';
import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import { parseReport, type EventDraft } from '../protocol/envelopes';
import type { Blueprint, EvidenceBundle, EvidenceRecord, UsageRecord } from '../protocol/contracts';
import type { BundleId, EvidenceId, ReportId, SessionRefId, UsageId } from '../protocol/ids';
import type {
  AdapterContext, AdapterDescriptor, ArchitectAdapterPort, ArchitectRequest,
  CodingAgentAdapterPort, CodingAgentDispatch, RelayAdapters, ReviewerAdapterPort,
  ReviewRequest, VerificationAdapterPort, VerificationRequest,
} from './ports';

/**
 * Deterministic simulation adapters (Prompt 4). Every output is stamped
 * `provenance: 'simulated'` — hard-wired, not configurable — and no adapter
 * can claim live execution, real repository modification, or real command
 * runs. Behavior derives ONLY from the explicit ScenarioConfig (no
 * randomness, no clock reads, no scripting language). Reports go back
 * through parseReport so a malformed simulated reply fails exactly like a
 * malformed real one.
 */

export interface ScenarioConfig {
  /** Attempt 1 verification: named check that fails (undefined = all pass). */
  failingCheckAttempt1?: string;
  /** Attempt 2 (post-repair) verification still fails the same check. */
  stillFailingAfterRepair?: boolean;
  /** Verification is unavailable (e.g. runner missing) on attempt 1. */
  verificationUnavailable?: boolean;
  /** Reviewer verdict per attempt; insufficient evidence maps to
   * changes_requested with an `insufficient-evidence` finding (protocol
   * verdict enum is authoritative — no new enum values). */
  reviewerAttempt1?: 'approved' | 'changes_requested' | 'insufficient_evidence';
  reviewerAttempt2?: 'approved' | 'changes_requested';
  /** Architect emits a schema-invalid blueprint report. */
  malformedBlueprint?: boolean;
  /** Coding agent reports blocked instead of implementing. */
  agentBlocked?: boolean;
  /** Coding agent emits a schema-invalid report. */
  malformedAgentReport?: boolean;
  /** Simulated usage per adapter step. */
  usdPerStep?: number;
  tokensPerStep?: number;
  /** Files the simulated implementation claims to change (never real). */
  changedFiles?: string[];
  /** Presentation fixture: the reviewer's blocking finding content (still
   * SIMULATED — deterministic scenario data, never a real review). */
  reviewerFinding?: { id: string; title: string; detail: string; recommendation?: string };
  /** Manual Task fixture (Prompt 6.1): content of the UNTRUSTED
   * ManualActionRequest the simulated coding agent raises alongside its
   * implementation report. Ids/identity are stamped from the dispatch
   * context; Relay Core still validates everything — invalid fixtures are
   * rejected exactly like invalid real requests. */
  manualActionRequest?: Record<string, unknown>;
}

const SIM_NOTICE = 'SIMULATED run — no real repository was read or modified; no real commands were executed.';

const descriptor = (adapterId: string, role: AdapterDescriptor['roles'][number], displayName: string): AdapterDescriptor => ({
  adapterId,
  roles: [role],
  displayName,
  provenance: 'simulated',
  enforcement: { 'worktree-isolation': 'enforced', 'command-allowlist': 'enforced', 'protected-paths': 'enforced' },
  simulatedPolicies: ['worktree-isolation', 'command-allowlist', 'protected-paths'],
});

function usage(ctx: AdapterContext, scenario: ScenarioConfig, adapterId: string, runId: UsageRecord['runId'], taskId?: UsageRecord['taskId']): UsageRecord[] {
  if (scenario.usdPerStep === undefined && scenario.tokensPerStep === undefined) return [];
  return [
    {
      usageId: ctx.ids.next('use') as UsageId,
      runId,
      taskId,
      adapterId,
      at: ctx.now,
      // Simulated actuals are still SIMULATED — never provider-billed.
      kind: 'actual',
      usd: scenario.usdPerStep,
      tokens: scenario.tokensPerStep,
    },
  ];
}

function event(
  base: { projectId: EventDraft['projectId']; runId?: EventDraft['runId']; taskId?: EventDraft['taskId'] },
  ctx: AdapterContext,
  source: EventDraft['source'],
  kind: EventDraft['kind'],
  safeSummary: string,
  payload: Record<string, unknown> = {},
): EventDraft {
  return {
    protocolVersion: RELAY_PROTOCOL_VERSION,
    at: ctx.now,
    projectId: base.projectId,
    runId: base.runId,
    taskId: base.taskId,
    source,
    kind,
    provenance: 'simulated',
    classification: 'historical',
    safeSummary,
    payload,
    correlationId: ctx.correlationId,
  };
}

/* ------------------------- architect ------------------------------ */

export function createSimulatedArchitect(scenario: ScenarioConfig): ArchitectAdapterPort {
  const d = descriptor('sim-architect', 'architect', 'Simulated Architect');
  return {
    descriptor: d,
    createBlueprint(request: ArchitectRequest) {
      const { project, run, context } = request;
      const content = scenario.malformedBlueprint
        ? { objectiveRestatement: '', approach: '', taskBreakdown: [], acceptanceCriteria: [], risks: [], constraints: [] }
        : {
            objectiveRestatement: `Restated: ${request.objective}`,
            approach: 'Deterministic simulated approach (no real repository inspected).',
            taskBreakdown: ['implement the simulated feature'],
            acceptanceCriteria: ['simulated targeted checks pass', 'independent review approves'],
            risks: ['simulation only — real risks unknown'],
            constraints: ['stay inside claimed files'],
          };
      const raw = {
        protocolVersion: RELAY_PROTOCOL_VERSION,
        reportId: context.ids.next('rpt') as ReportId,
        projectId: project.projectId,
        runId: run.runId,
        reportType: 'blueprint',
        agentIdentity: { adapterId: d.adapterId, role: 'architect', displayName: d.displayName },
        provenance: 'simulated',
        submittedAt: context.now,
        payload: { architectDisplayName: d.displayName, content },
      };
      const parsed = parseReport(raw);
      if (!parsed.ok) return parsed;
      const blueprint: Blueprint = {
        blueprintId: context.ids.next('blu'),
        projectId: project.projectId,
        runId: run.runId,
        version: 1,
        source: 'simulated',
        architectIdentity: { adapterId: d.adapterId, displayName: d.displayName },
        submittedAt: context.now,
        content,
        provenance: 'simulated',
      };
      return ok({
        blueprint,
        report: parsed.value,
        usage: usage(context, scenario, d.adapterId, run.runId),
        events: [event({ projectId: project.projectId, runId: run.runId }, context, 'architect', 'architect.blueprint_created', `Simulated blueprint v1 created. ${SIM_NOTICE}`)],
      });
    },
  };
}

/* ------------------------ coding agent ---------------------------- */

export function createSimulatedCodingAgent(scenario: ScenarioConfig): CodingAgentAdapterPort {
  const d = descriptor('sim-coding-agent', 'coding-agent', 'Simulated Coding Agent');
  return {
    descriptor: d,
    execute(dispatch: CodingAgentDispatch) {
      const { pkg, task, assignment, revision, resumeSessionRef, context } = dispatch;
      if (pkg.targetAdapterId !== d.adapterId) {
        return fail(relayError('permission-denied', 'Package targets a different adapter.', { entityIds: { taskId: task.taskId } }));
      }
      if (pkg.taskId !== task.taskId || assignment.taskId !== task.taskId) {
        return fail(relayError('validation-failed', 'Package/assignment do not own this task.', { entityIds: { taskId: task.taskId } }));
      }
      if (revision && !resumeSessionRef) {
        return fail(relayError('illegal-transition', 'The single repair must resume the same simulated session.', { entityIds: { taskId: task.taskId } }));
      }
      const sessionRef = (resumeSessionRef ?? context.ids.next('ses')) as SessionRefId;
      const attempt = revision ? 2 : 1;
      const changedFiles = scenario.changedFiles ?? [...task.claimedFiles];

      const payload = scenario.malformedAgentReport
        ? { summary: '' } // schema-invalid on purpose
        : scenario.agentBlocked
          ? { summary: 'Blocked: simulated blocker encountered.', changedFiles: [], blockers: ['simulated blocker'], notes: SIM_NOTICE }
          : {
              summary: revision
                ? `Simulated repair for finding(s) ${revision.findingsTargeted.join(', ')}. ${SIM_NOTICE}`
                : `Simulated implementation of: ${pkg.objective}. ${SIM_NOTICE}`,
              changedFiles,
              commandsClaimed: [{ command: 'npx vitest run', status: 'pass' as const, outputExcerpt: 'SIMULATED claim — not evidence' }],
              notes: SIM_NOTICE,
            };
      const raw = {
        protocolVersion: RELAY_PROTOCOL_VERSION,
        reportId: context.ids.next('rpt') as ReportId,
        projectId: pkg.projectId,
        runId: pkg.runId,
        taskId: task.taskId,
        packageId: revision ? revision.packageId : pkg.packageId,
        reportType: revision ? 'repair' : 'implementation',
        agentIdentity: { adapterId: d.adapterId, role: 'coding-agent', displayName: d.displayName, sessionRef },
        provenance: 'simulated',
        submittedAt: context.now,
        payload: revision
          ? {
              summary: `Simulated repair applied. ${SIM_NOTICE}`,
              resolvedFindings: revision.findingsTargeted.map((id) => ({ id, resolution: 'Simulated fix applied.' })),
              changedFiles,
            }
          : payload,
      };
      const parsed = parseReport(raw);
      if (!parsed.ok) return parsed;
      const base = { projectId: pkg.projectId, runId: pkg.runId, taskId: task.taskId };
      // Manual Task fixture: the adapter only ASKS — ids/identity stamped
      // here, every content field stays untrusted until Relay Core validates.
      const manualActionRequest =
        scenario.manualActionRequest && !revision
          ? {
              requestId: context.ids.next('mrq'),
              projectId: pkg.projectId,
              runId: pkg.runId,
              relayTaskId: task.taskId,
              requestedBy: d.adapterId,
              createdAt: context.now,
              requestedPermissions: [],
              ...scenario.manualActionRequest,
            }
          : undefined;
      return ok({
        report: parsed.value,
        sessionRef,
        usage: usage(context, scenario, d.adapterId, pkg.runId, task.taskId),
        events: [
          event(base, context, 'coding-agent', attempt === 1 ? 'agent.session_started' : 'agent.session_resumed', `Simulated session ${attempt === 1 ? 'started' : 'resumed'} (${sessionRef}).`),
          event(base, context, 'coding-agent', scenario.agentBlocked && !revision ? 'agent.blocked' : 'agent.report_created', scenario.agentBlocked && !revision ? 'Simulated agent blocked.' : `Simulated ${revision ? 'repair' : 'implementation'} report (attempt ${attempt}). Claims only — not evidence.`),
        ],
        ...(manualActionRequest !== undefined ? { manualActionRequest } : {}),
      });
    },
  };
}

/* -------------------------- reviewer ------------------------------ */

export function createSimulatedReviewer(scenario: ScenarioConfig): ReviewerAdapterPort {
  const d = descriptor('sim-reviewer', 'reviewer', 'Simulated Independent Reviewer');
  return {
    descriptor: d,
    review(request: ReviewRequest) {
      const { pkg, task, reviewerAssignment, attempt, context } = request;
      if (reviewerAssignment.adapterId !== d.adapterId) {
        return fail(relayError('reviewer-independence', 'Reviewer assignment does not match this adapter.', { entityIds: { taskId: task.taskId } }));
      }
      const configured = attempt === 1 ? scenario.reviewerAttempt1 ?? 'approved' : scenario.reviewerAttempt2 ?? 'approved';
      const findings =
        configured === 'approved'
          ? []
          : configured === 'insufficient_evidence'
            ? [{ id: 'R-EVIDENCE', severity: 'major' as const, title: 'Insufficient evidence', detail: 'Simulated reviewer: the evidence bundle does not support the claims.', recommendation: 'Produce the missing verification evidence.' }]
            : [{
                id: scenario.reviewerFinding?.id ?? 'R1',
                severity: 'major' as const,
                title: scenario.reviewerFinding?.title ?? 'Simulated defect',
                detail: scenario.reviewerFinding?.detail ?? 'Simulated reviewer found a deterministic defect in the claimed implementation.',
                recommendation: scenario.reviewerFinding?.recommendation ?? 'Apply the focused simulated fix.',
              }];
      const verdict = configured === 'approved' ? 'approved' : 'changes_requested';
      const raw = {
        protocolVersion: RELAY_PROTOCOL_VERSION,
        reportId: context.ids.next('rpt') as ReportId,
        projectId: pkg.projectId,
        runId: pkg.runId,
        taskId: task.taskId,
        packageId: pkg.packageId,
        reportType: 'review',
        agentIdentity: { adapterId: d.adapterId, role: 'reviewer', displayName: d.displayName },
        provenance: 'simulated',
        submittedAt: context.now,
        payload: { verdict, findings },
      };
      const parsed = parseReport(raw);
      if (!parsed.ok) return parsed;
      const base = { projectId: pkg.projectId, runId: pkg.runId, taskId: task.taskId };
      return ok({
        report: parsed.value,
        usage: usage(context, scenario, d.adapterId, pkg.runId, task.taskId),
        events: [event(base, context, 'reviewer', 'reviewer.verdict_created', `Simulated independent review (attempt ${attempt}): ${verdict}, ${findings.length} finding(s).`)],
      });
    },
  };
}

/* ------------------------ verification ---------------------------- */

export function createSimulatedVerification(scenario: ScenarioConfig): VerificationAdapterPort {
  const d = descriptor('sim-verification', 'verification', 'Simulated Relay Verification');
  return {
    descriptor: d,
    verify(request: VerificationRequest) {
      const { task, run, policy, baseRevision, attempt, context } = request;
      const records: EvidenceRecord[] = policy.requiredEvidence.map((req) => {
        const label = req.command ?? req.evidenceType;
        const unavailable = scenario.verificationUnavailable && attempt === 1;
        const failing =
          !unavailable &&
          ((attempt === 1 && scenario.failingCheckAttempt1 === label) ||
            (attempt === 2 && scenario.stillFailingAfterRepair && scenario.failingCheckAttempt1 === label));
        return {
          evidenceId: context.ids.next('evd') as EvidenceId,
          taskId: task.taskId,
          runId: run.runId,
          source: d.adapterId,
          evidenceType: req.evidenceType,
          command: req.command,
          exitCode: unavailable ? undefined : failing ? 1 : 0,
          outputExcerpt: unavailable ? 'runner unavailable (simulated)' : failing ? 'SIMULATED failure output' : 'SIMULATED passing output',
          executedAt: context.now,
          environment: { os: 'sim-linux', node: 'sim-20', cwd: '/simulated/workspace' },
          repoRevision: baseRevision,
          verificationStatus: unavailable ? 'unavailable' : failing ? 'failed' : 'passed',
          verifier: d.adapterId,
          provenance: 'simulated',
        };
      });
      const overall = records.some((r) => r.verificationStatus === 'unavailable')
        ? 'unavailable'
        : records.some((r) => r.verificationStatus === 'failed')
          ? 'failed'
          : 'passed';
      const bundle: EvidenceBundle = {
        bundleId: context.ids.next('bnd') as BundleId,
        taskId: task.taskId,
        runId: run.runId,
        evidenceIds: records.map((r) => r.evidenceId),
        collectedAt: context.now,
        overallStatus: overall,
        repoRevision: baseRevision,
      };
      const base = { projectId: task.projectId, runId: run.runId, taskId: task.taskId };
      return ok({
        records,
        bundle,
        usage: usage(context, scenario, d.adapterId, run.runId, task.taskId),
        events: [
          event(base, context, 'verification', 'verification.started', `Simulated Relay-controlled verification started (attempt ${attempt}).`),
          ...records.map((r) =>
            event(base, context, 'verification', r.verificationStatus === 'passed' ? 'verification.check_passed' : 'verification.check_failed', `Simulated check ${r.command ?? r.evidenceType}: ${r.verificationStatus}.`, { evidenceId: r.evidenceId }),
          ),
          event(base, context, 'verification', 'verification.completed', `Simulated verification ${overall} (${records.length} check(s)).`),
        ],
      });
    },
  };
}

export function createSimulatedAdapters(scenario: ScenarioConfig = {}): RelayAdapters {
  return {
    architect: createSimulatedArchitect(scenario),
    codingAgent: createSimulatedCodingAgent(scenario),
    reviewer: createSimulatedReviewer(scenario),
    verification: createSimulatedVerification(scenario),
  };
}
