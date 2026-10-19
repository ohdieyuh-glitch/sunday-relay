import type { RelayApp } from '../core/app';
import { projectMission, type MissionProjectionBundle, type MissionSpec, type ReviewInput } from '../mission';

/**
 * Competitive proof — the PURE mission spec and projection, shared by both
 * Relay surfaces.
 *
 * This module is BROWSER-SAFE by contract: it may import Relay Core, the
 * Mission Operations domain and pure types, and nothing else. It must never
 * import a terminal renderer (`src/relay/cli/**`), a persistence
 * implementation (`src/relay/persistence/**`) or a Node built-in.
 *
 * It exists because both surfaces need the same projected mission bundle:
 * the website renders it as Mission Control, the CLI renders it as the
 * competitive presentation. Before the repository separation those lived in
 * separate worktrees, so the website reached into `cli/competitive.ts` for the
 * projection and dragged the whole CLI product shell — and with it the Node
 * persistence layer — into the browser bundle. The seam is here now: one
 * projection, two renderers, neither importing the other.
 *
 * Enforced by `src/relay/shared/browser-boundary.test.ts`.
 */

export const COMPETITIVE_MISSION_SPEC: MissionSpec = {
  title: 'Protect anonymous live access',
  objective: 'Preserve anonymous access while preventing one actor from bypassing identity limits or spending controls.',
  requirements: [
    'Durable anonymous rate limiting',
    'IPv6 identity aggregation',
    'Global spending breaker remains active',
    'Zero provider dispatch after a block',
    'Existing authenticated behavior remains unchanged',
  ],
  constraints: [
    'No pricing redesign',
    'No authentication redesign',
    'No new model providers',
    'No production deployment',
    'No Supabase migration',
    'No Alcatraz engine changes',
  ],
  acceptanceCriteria: [
    { id: 'AC-1', text: 'Anonymous rate-limit proof passes 30/30.', blocking: true },
    { id: 'AC-2', text: 'Session proof passes 40/40.', blocking: true },
    { id: 'AC-3', text: 'Spending proof passes 23/23.', blocking: true },
    { id: 'AC-4', text: 'TypeScript build passes.', blocking: true },
    { id: 'AC-5', text: 'A single actor cannot evade the anonymous identity limit through address rotation.', blocking: true },
    { id: 'AC-6', text: 'Zero provider dispatch occurs after a block.', blocking: true },
  ],
  filesInScope: ['src/access/anonymous-policy.ts', 'src/access/ipv6-identity.ts', 'src/access/spend-boundary.ts'],
  filesOutOfScope: ['src/pricing', 'src/auth'],
  systemsInScope: ['anonymous access policy', 'spending breaker'],
  systemsOutOfScope: ['Supabase migrations', 'Alcatraz engine', 'Production deployment', 'Model providers'],
  assumptions: ['Existing authenticated flows are already covered by their own tests.'],
  decisions: ['Anonymous identity is aggregated before policy application.'],
  unresolvedQuestions: [],
  requiredEvidence: [
    '30/30 anonymous rate-limit proof', '40/40 session proof', '23/23 spending proof',
    'TypeScript build', 'file-claim policy', 'protected-path policy',
  ],
  requiredReviewers: ['Codex — Independent Coding Reviewer'],
  implementerRequirement: 'Claude Code',
  reviewerRequirement: 'Codex — Independent Coding Reviewer',
  maximumRepairIterations: 1,
  maximumReviewRuns: 2,
  maximumCostUsd: 2,
  maximumRuntimeMinutes: 30,
  completionRule: 'all_blocking_criteria_and_independent_review',
  createdBy: 'relay-operator',
};

const AFFECTED_CRITERIA = ['AC-5'];

/** Project the mission bundle from a completed competitive run's read
 * models. Pure data-in / bundle-out — no live call, no core mutation. */
export function projectCompetitiveMission(app: RelayApp, now: string): MissionProjectionBundle {
  const status = app.status();
  const audit = app.audit();
  const events = app.events(0);
  const reviewsRaw = app.review();
  const evidence = app.evidence();
  const task = app.task();
  const handoff = app.handoff();

  const runId = status?.runId ?? 'run_unknown';
  const taskId = status?.taskId ?? 'tsk_unknown';
  const projectId = status?.projectId ?? 'prj_unknown';
  const requestedImplementerId = handoff?.targetAdapterId ?? 'sim-coding-agent';
  const actualImplementerId = audit?.identities?.codingAgent ?? 'sim-coding-agent';
  const actualReviewerId = audit?.identities?.reviewer ?? 'sim-reviewer';
  const eventKinds = events.map((e) => e.kind);

  const reviews: ReviewInput[] = reviewsRaw.map((r) => ({
    attempt: r.attempt,
    verdict: r.verdict === 'approved' ? 'approved' : 'changes_requested',
    reviewerAgentId: r.adapterId,
    requestedReviewerAgentId: 'sim-reviewer',
    independent: r.independent,
    provenance: (r.provenance as MissionProjectionBundle['mission']['provenance']),
    findings: r.findings.map((f) => ({ id: f.id, severity: f.severity, title: f.title, detail: f.detail, recommendation: f.recommendation })),
  }));

  const requiredCommands = COMPETITIVE_MISSION_SPEC.requiredEvidence;
  const passedCommands = new Set(
    evidence.filter((e) => e.status === 'passed' && e.command && requiredCommands.includes(e.command)).map((e) => e.command as string),
  );
  const passedEvidenceIds = evidence.filter((e) => e.status === 'passed').map((e) => e.evidenceId);

  return projectMission({
    spec: COMPETITIVE_MISSION_SPEC,
    missionId: 'msn_competitive', projectId, taskId, runId, now, provenance: 'simulated',
    requestedImplementerId, requestedReviewerId: 'sim-reviewer',
    actualImplementerId, actualReviewerId,
    implementerAdapterProvenance: 'simulated', reviewerAdapterProvenance: 'simulated',
    implementerLaunchVerified: eventKinds.includes('agent.session_started'),
    implementerCompletionSignal: eventKinds.includes('agent.report_created'),
    reviewerLaunchVerified: reviewsRaw.length > 0,
    implementerSessionId: audit?.sessionRefs?.[0] ?? null, workspaceId: null,
    workspaceInspectionCompleted: false, verificationCompleted: eventKinds.includes('verification.completed'),
    runStatus: status?.status ?? 'unknown',
    reviews, originalClaimedFiles: (task?.claimedFiles ?? []).map((c) => c.path),
    affectedCriterionIds: AFFECTED_CRITERIA, workspaceRevision: status?.baseRevision ?? 'rev-sim',
    postRepairEvidenceIds: passedEvidenceIds,
    allEvidence: evidence.map((e) => ({ evidenceId: e.evidenceId, status: e.status })),
    requiredEvidenceCount: requiredCommands.length, passedEvidenceCount: passedCommands.size,
    repairDispatched: (audit?.repairCount ?? 0) > 0, implementationReported: eventKinds.includes('agent.report_created'),
    events: events.map((e) => ({ sequence: e.sequence, at: e.at, source: e.source, kind: e.kind, provenance: e.provenance as ReviewInput['provenance'], safeSummary: e.safeSummary })),
  });
}

/** Serializable JSON payload (no ANSI, no mascot, no secrets). */
export function competitiveJson(app: RelayApp, now: string): MissionProjectionBundle {
  return projectCompetitiveMission(app, now);
}
