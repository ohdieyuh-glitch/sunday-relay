import type {
  ProjectPhase,
  RelayProjectWorkspaceProps,
  ReviewFinding,
  ReviewerStateKind,
  WorkspaceDogState,
  WorkspaceOutputState,
  WorkspaceTerminalEvent,
} from '../../project-workspace';
import type { RelayDemoRole, RelayDemoSimulationState } from './demo-simulation-types';

type HandlerKey =
  | 'terminalOpen'
  | 'terminalFullScreen'
  | 'reducedMotion'
  | 'onSendProjectMessage'
  | 'onApproveDecision'
  | 'onRejectDecision'
  | 'onOpenTerminal'
  | 'onCloseTerminal'
  | 'onOpenProjectSettings'
  | 'onOpenManualTask'
  | 'onApproveManualTask'
  | 'onRejectManualTask'
  | 'onRequestResearch'
  | 'onOpenFinding'
  | 'onOpenRepair'
  | 'onReturnHome';

export type RelayDemoWorkspaceBase = Omit<RelayProjectWorkspaceProps, HandlerKey>;

const phaseForStep = (index: number): ProjectPhase => {
  if (index <= 1) return 'plan';
  if (index <= 4) return 'research';
  if (index === 5) return 'build';
  if (index === 6 || index === 10) return 'verify';
  if (index === 7 || index === 11) return 'review';
  if (index === 8 || index === 9) return 'repair';
  return 'complete';
};

const outputForStep = (index: number): WorkspaceOutputState => {
  if (index <= 1) return 'ready';
  if (index <= 4) return 'held_for_inspection';
  if (index === 5) return 'implementing';
  if (index === 6 || index === 10) return 'held_for_verification';
  if (index === 7) return 'held_for_review';
  if (index === 8) return 'revision_required';
  if (index === 9) return 'repairing';
  if (index === 11) return 'held_for_re_review';
  return 'demo_verified_complete';
};

const dogForStep = (index: number): WorkspaceDogState => {
  if (index <= 1) return 'wandering';
  if (index === 2) return 'researching';
  if (index <= 5) return 'implementing';
  if (index === 6 || index === 10) return 'verifying';
  if (index === 7 || index === 11) return 'reviewing';
  if (index === 8) return 'waiting_for_user';
  if (index === 9) return 'repairing';
  return 'complete';
};

const reviewerForStep = (index: number): ReviewerStateKind => {
  if (index < 7) return 'waiting';
  if (index === 7) return 'reviewing';
  if (index === 8 || index === 9) return 'changes_required';
  if (index === 10 || index === 11) return 're_reviewing';
  return 'approved';
};

const categoryForRole: Record<RelayDemoRole, WorkspaceTerminalEvent['category']> = {
  founder: 'relay',
  prompt_architect: 'prompt_architect',
  alcatraz: 'research',
  coding_agent: 'coding_agent',
  relay_verifier: 'verification',
  reviewer: 'reviewer',
  repair: 'repair',
  complete: 'completion_engine',
};

const truthForRole: Record<RelayDemoRole, WorkspaceTerminalEvent['truth']> = {
  founder: 'system_notice',
  prompt_architect: 'agent_claim',
  alcatraz: 'system_notice',
  coding_agent: 'agent_claim',
  relay_verifier: 'relay_evidence',
  reviewer: 'review_verdict',
  repair: 'agent_claim',
  complete: 'system_notice',
};

const findingForStep = (index: number): ReviewFinding[] => {
  if (index < 7) return [];
  return [{
    findingId: 'F-1',
    severity: 'blocking',
    title: 'Repeated hyphens are not collapsed',
    criterion: 'Canonical hyphen separation',
    evidenceSummary: 'Simulated review of artifact demo-r1 found repeated existing hyphens.',
    requiredAction: 'Collapse repeated hyphens within the assigned file.',
    status: index >= 11 ? 'closed' : index >= 9 ? 'repaired' : index >= 8 ? 'validated' : 'open',
  }];
};

export function projectDemoSimulationIntoWorkspace(
  state: RelayDemoSimulationState,
  base: RelayDemoWorkspaceBase,
): RelayDemoWorkspaceBase {
  const index = state.currentStepIndex;
  const phase = phaseForStep(index);
  const reviewerState = reviewerForStep(index);
  const findings = findingForStep(index);
  const repairVisible = index >= 8;
  const repairVerified = index >= 10;
  const verificationVisible = index >= 6;
  const currentRevision = repairVerified ? 'demo-r2' : 'demo-r1';

  return {
    ...base,
    mission: {
      missionId: state.instanceId,
      title: 'Demo Mission · normalizeProjectName',
      summary: 'Offline deterministic Relay coordination demonstration.',
    },
    workforce: {
      promptArchitect: {
        name: 'ChatGPT',
        status: index < 2 ? 'waiting' : index === 2 ? 'researching' : index <= 4 ? 'preparing_handoff' : 'waiting',
      },
      codingAgent: {
        name: 'Claude Code',
        status: index === 5 ? 'implementing' : index === 6 || index === 10 ? 'verifying' : index === 8 || index === 9 ? 'repairing' : 'waiting',
      },
      reviewer: { name: 'Hermes', state: reviewerState },
    },
    mode: 'demo_simulation',
    phase,
    outputState: outputForStep(index),
    dogState: dogForStep(index),
    handoffNetworkState: 'standby',
    terminalEvents: state.events.map((event) => ({
      eventId: event.id,
      at: `2026-07-24T12:00:${String(event.sequence).padStart(2, '0')}Z`,
      category: categoryForRole[event.role],
      truth: truthForRole[event.role],
      headline: event.title,
      detail: event.summary,
      meta: event.result ?? event.relatedFile ?? event.command,
      done: event.sequence < state.events.length || state.status === 'complete',
      simulated: true,
    })),
    manualTasks: [],
    verificationSummary: {
      headline: verificationVisible
        ? `SIMULATED evidence bound to ${currentRevision}. NO PROVIDER CALLS.`
        : null,
      checks: [
        { label: 'Changed-file scope', status: verificationVisible ? 'passed' : 'pending' },
        { label: 'Protected paths', status: verificationVisible ? 'passed' : 'pending' },
        { label: 'normalizeProjectName tests', status: verificationVisible ? 'passed' : 'pending' },
        { label: `Current artifact · ${currentRevision}`, status: verificationVisible ? 'passed' : 'pending' },
      ],
    },
    reviewerState,
    findings,
    repairs: repairVisible ? [{
      repairId: 'R-1',
      findingId: 'F-1',
      assignedTo: 'Claude Code · SIMULATED',
      authorizedFiles: ['src/core/normalizeProjectName.ts'],
      status: repairVerified ? 'verified' : index >= 9 ? 'in_progress' : 'created',
      verification: repairVerified ? 'passed' : 'pending',
    }] : [],
    researchState: {
      status: index >= 2 && index <= 4 ? 'researching' : 'monitoring',
      approvedTopics: ['normalizeProjectName acceptance criteria'],
      note: index >= 3 ? 'Sunday Alcatraz preserved the approved mission constraints.' : null,
    },
    projectBrainState: {
      entries: base.projectBrainState.entries,
      lastUpdate: index >= 3 ? 'SIMULATED · demo-v1' : base.projectBrainState.lastUpdate,
      pendingApprovals: 0,
    },
    completionState: { verdict: 'not_complete', evidence: [] },
    researchEnabled: true,
    repairUsed: repairVisible,
    codingTerminal: undefined,
    roleBilling: undefined,
  };
}
