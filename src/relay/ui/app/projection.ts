import { buildConfiguredWorkspaceState } from '../project-workspace/configured-state';
import type { ConfiguredWorkspaceState } from '../project-workspace/configured-state';
import { buildCodingTerminalView, buildRoleBilling } from '../project-workspace/coding-terminal';
import type { CodingTerminalView, RoleBillingRow } from '../project-workspace/coding-terminal';
import { configuredStartFromSettingsDraft } from '../preview/configured-start';
import type {
  ProjectPhase,
  RelayProjectWorkspaceProps,
  RepairTask,
  ReviewFinding,
  ReviewerStateKind,
  WorkspaceDogState,
  WorkspaceOutputState,
  WorkspaceTerminalEvent,
} from '../project-workspace/contracts';
import type {
  MissionAttestationSummary,
  ProjectBrain,
  RelayEvent,
  RelayMission,
  RelayMissionState,
  RelayProject,
} from './contracts';
import type { StoredProjectSettings } from './contracts';

/**
 * MISSION PROJECTION — derives the Active Workspace's display state from
 * the persisted domain records. The renderer receives only this projection:
 * it can never invent completion, findings, or verification. Every field is
 * a pure function of (project, settings, brain, mission, events).
 */

type M = RelayMissionState;

const OUTPUT: Record<M, WorkspaceOutputState> = {
  configured: 'configured',
  ready: 'ready',
  architect_working: 'ready',
  handoff_ready: 'ready',
  coding: 'implementing',
  claim_submitted: 'held_for_inspection',
  relay_verifying: 'held_for_verification',
  reviewer_reviewing: 'held_for_review',
  repair_required: 'revision_required',
  repair_in_progress: 'repairing',
  re_verifying: 'held_for_re_review',
  approved: 'held_for_review',
  verified_complete: 'verified_complete',
  failed: 'stopped_safely',
  cancelled: 'stopped_safely',
};

const PHASE: Record<M, ProjectPhase> = {
  configured: 'plan',
  ready: 'plan',
  architect_working: 'plan',
  handoff_ready: 'plan',
  coding: 'build',
  claim_submitted: 'verify',
  relay_verifying: 'verify',
  reviewer_reviewing: 'review',
  repair_required: 'review',
  repair_in_progress: 'repair',
  re_verifying: 'verify',
  approved: 'review',
  verified_complete: 'complete',
  failed: 'verify',
  cancelled: 'plan',
};

const DOG: Record<M, WorkspaceDogState> = {
  configured: 'wandering',
  ready: 'trotting',
  architect_working: 'trotting',
  handoff_ready: 'carrying_handoff',
  coding: 'implementing',
  claim_submitted: 'verifying',
  relay_verifying: 'verifying',
  reviewer_reviewing: 'reviewing',
  repair_required: 'reviewing',
  repair_in_progress: 'repairing',
  re_verifying: 'verifying',
  approved: 'reviewing',
  verified_complete: 'complete',
  failed: 'wandering',
  cancelled: 'wandering',
};

const REVIEWER: Record<M, ReviewerStateKind> = {
  configured: 'waiting',
  ready: 'waiting',
  architect_working: 'waiting',
  handoff_ready: 'waiting',
  coding: 'waiting',
  claim_submitted: 'waiting',
  relay_verifying: 'waiting',
  reviewer_reviewing: 'reviewing',
  repair_required: 'changes_required',
  repair_in_progress: 'changes_required',
  re_verifying: 're_reviewing',
  approved: 'approved',
  verified_complete: 'approved',
  failed: 'waiting',
  cancelled: 'waiting',
};

const ORDER: readonly M[] = [
  'configured',
  'ready',
  'architect_working',
  'handoff_ready',
  'coding',
  'claim_submitted',
  'relay_verifying',
  'reviewer_reviewing',
  'repair_required',
  'repair_in_progress',
  're_verifying',
  'approved',
  'verified_complete',
];

const atLeast = (state: M, floor: M) => ORDER.indexOf(state) >= ORDER.indexOf(floor);

/**
 * Live-mission overlays are derived from REAL evidence events + records — never
 * from the state ordinal (which is what fabricates the demo's F-1/R-1). A live
 * mission with no reviewer has no findings/repairs; verification and completion
 * reflect only what Relay actually inspected and verified.
 */
function deriveLiveVerification(
  state: M,
  events: RelayEvent[],
  fallback: ConfiguredWorkspaceState['verificationSummary'],
): ConfiguredWorkspaceState['verificationSummary'] {
  const hasInspection = events.some((e) => e.category === 'workspace_inspection' && e.truth === 'relay_evidence');
  const hasVerification = events.some((e) => e.category === 'verification' && e.truth === 'relay_evidence');
  if (state === 'verified_complete') {
    return {
      headline: 'Required checks passed under Relay verification.',
      checks: [
        { label: 'Claimed files match changed files', status: 'passed' },
        { label: 'No protected files changed', status: 'passed' },
        { label: 'Required tests', status: 'passed' },
        { label: 'Source worktree unchanged', status: 'passed' },
      ],
    };
  }
  if (state === 'failed') {
    return {
      headline: 'Relay stopped the mission before completion.',
      checks: [
        { label: 'Claimed-file / protected-path policy', status: hasInspection ? 'passed' : 'not_run' },
        { label: 'Required tests', status: hasVerification ? 'failed' : 'not_run' },
      ],
    };
  }
  if (hasInspection || hasVerification || state === 'relay_verifying') {
    return {
      headline: 'Relay is verifying the coding-agent claim…',
      checks: [
        { label: 'Claimed files match changed files', status: hasInspection ? 'passed' : 'pending' },
        { label: 'Required tests', status: hasVerification ? 'passed' : 'pending' },
      ],
    };
  }
  return fallback;
}

/**
 * Live completion evidence is assembled from what the backend actually
 * reported — the attestations, the review, and the artifact digest. A mission
 * with no independent review never claims one, and the evidence list never
 * describes a role that did not run.
 */
function deriveLiveCompletion(state: M, mission: RelayMission): ConfiguredWorkspaceState['completionState'] {
  if (state !== 'verified_complete') return { verdict: 'not_complete', evidence: [] };

  const attested = (role: MissionAttestationSummary['role']) =>
    (mission.attestations ?? []).find(
      (a) => a.role === role && a.launchVerified && a.completionVerified && !a.fallbackOccurred,
    );
  const evidence: string[] = ['Coding-agent claim verified independently by Relay-run tests.'];
  evidence.push('Only the claimed file changed; the source worktree is protected.');

  const architect = attested('prompt_architect');
  if (architect) {
    evidence.push(
      `Prompt Architect execution attested (${architect.actualActor}${architect.model ? ` · ${architect.model}` : ''}).`,
    );
  }
  const coder = attested('coding_agent');
  if (coder) evidence.push(`Coding Agent execution attested (${coder.actualActor}).`);

  const review = mission.review;
  const reviewer = attested('reviewer');
  if (review && reviewer && review.verdict === 'approved') {
    evidence.push(
      `Independent review by ${review.reviewer} approved the exact verified artifact` +
        (mission.artifactDigest ? ` (${mission.artifactDigest}).` : '.'),
    );
  }
  evidence.push(
    review
      ? 'Completion policy satisfied — independent review required and supplied.'
      : 'Completion policy evaluated by Relay — no independent review was performed.',
  );
  return { verdict: 'verified_complete', evidence };
}

/** Reviewer display for a live mission comes from the real verdict, never
    from the mission-state ordinal. */
function deriveLiveReviewer(state: M, mission: RelayMission): ReviewerStateKind {
  const review = mission.review;
  if (!review) return REVIEWER[state];
  if (review.findings.some((f) => f.severity === 'blocking') || review.verdict === 'changes_required') {
    return 'changes_required';
  }
  return review.verdict === 'approved' ? 'approved' : 'reviewing';
}

function toTerminalEvent(e: RelayEvent): WorkspaceTerminalEvent {
  return {
    eventId: e.id,
    at: e.at,
    category: e.category,
    truth: e.truth,
    headline: e.headline,
    detail: e.detail,
    meta: e.meta,
    done: e.done,
    fixture: e.demo, // demo events carry the sample-content tag
  };
}

export interface MissionProjectionInput {
  project: RelayProject;
  settings: StoredProjectSettings;
  brain: ProjectBrain | null;
  mission: RelayMission;
  events: RelayEvent[];
}

export function deriveMissionProjection(
  input: MissionProjectionInput,
): ConfiguredWorkspaceState & { codingTerminal?: CodingTerminalView; roleBilling?: RoleBillingRow[] } {
  const { project, settings, brain, mission, events } = input;
  const s = mission.state;

  // Start from the honest configured baseline, then overlay mission truth.
  const base = buildConfiguredWorkspaceState(
    configuredStartFromSettingsDraft(settings.draft, project.id, project.reference),
  );

  // Demo overlays (F-1/R-1/verification/completion) are keyed on the state
  // ordinal and are SAMPLE content — they must never appear on a live mission.
  // A live mission derives everything below from real evidence events/records.
  const isDemo = mission.demo;

  const findings: ReviewFinding[] =
    isDemo && atLeast(s, 'repair_required')
      ? [
          {
            findingId: 'F-1',
            severity: 'normal',
            title: 'Edge-case input is not validated.',
            criterion: 'Inputs are validated before reaching the core module.',
            evidenceSummary: 'Empty input reaches the core module unchecked.',
            requiredAction: 'Add input validation with a regression test.',
            status: atLeast(s, 'approved') ? 'closed' : atLeast(s, 're_verifying') ? 'repaired' : 'validated',
          },
        ]
      : [];

  const repairs: RepairTask[] =
    isDemo && atLeast(s, 'repair_in_progress')
      ? [
          {
            repairId: 'R-1',
            findingId: 'F-1',
            assignedTo: base.workforce.codingAgent.name,
            authorizedFiles: ['src/app/core.ts'],
            status: atLeast(s, 're_verifying') ? 'verified' : 'in_progress',
            verification: atLeast(s, 're_verifying') ? 'passed' : 'pending',
          },
        ]
      : [];

  const verificationSummary: ConfiguredWorkspaceState['verificationSummary'] = isDemo
    ? atLeast(s, 'relay_verifying')
      ? {
          headline: atLeast(s, 're_verifying')
            ? 'Repair verified — all required checks passed.'
            : 'Required checks passed under Relay verification.',
          checks: [
            { label: 'Claimed files match changed files', status: 'passed' },
            { label: 'No protected files changed', status: 'passed' },
            { label: 'Typecheck', status: 'passed' },
            { label: 'Required tests', status: 'passed' },
          ],
        }
      : base.verificationSummary
    : deriveLiveVerification(s, events, base.verificationSummary);

  const architectStatus =
    s === 'architect_working' ? 'planning' : s === 'handoff_ready' ? 'preparing_handoff' : 'waiting';
  const codingStatus: (typeof base.workforce.codingAgent.status) =
    s === 'coding'
      ? 'implementing'
      : s === 'repair_in_progress'
        ? 'repairing'
        : s === 'claim_submitted'
          ? 'verifying'
          : s === 'ready' || s === 'handoff_ready'
            ? 'ready'
            : 'waiting';

  // The Coding Agent terminal and the role/billing rows exist only for a real
  // (non-demo) mission — a demo mission has no Claude process to report on.
  const codingTerminal = isDemo ? undefined : buildCodingTerminalView({ terminal: mission.terminal, phase: PHASE[s] });
  const architectAttestation = (mission.attestations ?? []).find((a) => a.role === 'prompt_architect');
  const reviewerAttestation = (mission.attestations ?? []).find((a) => a.role === 'reviewer');
  const roleBilling = isDemo
    ? undefined
    : buildRoleBilling({
        architectLabel: mission.handoff?.architectLabel,
        architectProvenance: mission.handoff?.architectProvenance,
        // API PAID is claimed only from a proven api-billed, attested request.
        // The browser never synthesizes it; absent one, the row stays NOT BILLED.
        architectApiBilled: Boolean(
          architectAttestation &&
            architectAttestation.billingPath === 'api_billed' &&
            architectAttestation.launchVerified &&
            architectAttestation.completionVerified &&
            !architectAttestation.fallbackOccurred &&
            mission.architectReceipt,
        ),
        architectCoordinationLabel: mission.architectReceipt?.coordinationLabel,
        codingAttestation: mission.terminal?.attestation ?? null,
        reviewerProvider: mission.review?.provider ?? null,
        reviewerModel: mission.review?.model ?? null,
        reviewerRan: Boolean(reviewerAttestation?.launchVerified && mission.review),
        reviewerApproved: mission.review?.verdict === 'approved',
      });

  return {
    ...base,
    codingTerminal,
    roleBilling,
    project: { ...base.project, name: project.name },
    mission: {
      missionId: mission.id,
      title: mission.title,
      summary: mission.objective,
    },
    workforce: {
      promptArchitect: { ...base.workforce.promptArchitect, status: architectStatus },
      codingAgent: { ...base.workforce.codingAgent, status: codingStatus },
      reviewer: {
        ...base.workforce.reviewer,
        state: isDemo ? REVIEWER[s] : deriveLiveReviewer(s, mission),
      },
    },
    phase: PHASE[s],
    outputState: OUTPUT[s],
    dogState: DOG[s],
    handoffNetworkState: s === 'configured' ? 'standby' : 'online',
    terminalEvents: events.map(toTerminalEvent),
    reviewerState: isDemo ? REVIEWER[s] : deriveLiveReviewer(s, mission),
    findings,
    repairs,
    verificationSummary,
    projectBrainState: brain
      ? {
          entries:
            brain.architectureNotes.length +
            brain.decisions.length +
            brain.researchNotes.length +
            brain.constraints.length,
          lastUpdate: brain.lastUpdatedAt.slice(0, 16).replace('T', ' ') + ' UTC',
          pendingApprovals: 0,
        }
      : base.projectBrainState,
    completionState: isDemo
      ? s === 'verified_complete'
        ? {
            verdict: 'verified_complete',
            evidence: [
              'Coding claim verified independently by Relay.',
              'Reviewer finding F-1 repaired and closed.',
              'Reviewer approved the held output.',
              'Completion policy evaluated by Relay.',
            ],
          }
        : { verdict: 'not_complete', evidence: [] }
      : deriveLiveCompletion(s, mission),
    repairUsed: isDemo && atLeast(s, 'repair_in_progress'),
  };
}

export type { ConfiguredWorkspaceState, RelayProjectWorkspaceProps };
