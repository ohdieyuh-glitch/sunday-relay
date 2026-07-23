import type {
  RelayProjectWorkspaceProps,
  ReviewerStateKind,
  WorkspaceMission,
} from './contracts';

/**
 * CONFIGURED PROJECT STATE — the honest workspace projection for a project
 * the developer just started from Project Settings, BEFORE any mission has
 * run. Nothing here fabricates activity: the console is empty on STANDBY,
 * every agent is WAITING, verification has no checks, the Project Brain is
 * empty, and the mission slot truthfully says the first mission has not
 * begun. This is a pure mapping of typed configuration — the UI still never
 * launches agents or generates canonical events.
 *
 * The input is deliberately NOT the ProjectSettingsDraft: the workspace
 * module stays independent of the settings module. Hosts (the preview shell
 * today, Relay Core projections later) resolve ids to display names and
 * pass this neutral shape.
 */

export interface ConfiguredProjectStart {
  projectId: string;
  name: string;
  /** Route reference, e.g. "RLY / 002". */
  reference: string;
  /** Display label, e.g. "Web application". */
  projectType: string;
  mode: RelayProjectWorkspaceProps['mode'];
  promptArchitectName: string;
  codingAgentName: string;
  /** Display name of the selected reviewer, or null when none is selected. */
  reviewerName: string | null;
  /** False only when the reviewer policy is NEVER. */
  reviewerRequired: boolean;
  /** True when research automation was enabled in Project Settings. */
  researchEnabled: boolean;
  /** Topics approved in Project Settings (shown; nothing runs from them). */
  approvedResearchTopics: string[];
}

/** The workspace data props a host must supply — everything but callbacks
    and presentation flags. Matches the fixture shape used by the preview. */
export type ConfiguredWorkspaceState = Omit<
  RelayProjectWorkspaceProps,
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
  | 'onReturnHome'
>;

/** Truthful reviewer projection before the first mission. */
export function configuredReviewerState(
  reviewerName: string | null,
  reviewerRequired: boolean,
): ReviewerStateKind {
  if (reviewerName) return 'waiting';
  return reviewerRequired ? 'not_configured' : 'not_required';
}

export function buildConfiguredWorkspaceState(
  start: ConfiguredProjectStart,
): ConfiguredWorkspaceState {
  const reviewerState = configuredReviewerState(start.reviewerName, start.reviewerRequired);

  // Not a real mission — a truthful placeholder for surfaces that display
  // the mission slot (the Live Terminal header) before the first handoff.
  const mission: WorkspaceMission = {
    missionId: `${start.projectId}-no-mission`,
    title: 'Awaiting first mission',
    summary:
      'Project configured. Relay will prepare the first mission handoff when work begins.',
  };

  return {
    project: {
      projectId: start.projectId,
      name: start.name,
      reference: start.reference,
      projectType: start.projectType,
    },
    mission,
    workforce: {
      promptArchitect: { name: start.promptArchitectName, status: 'waiting' },
      codingAgent: { name: start.codingAgentName, status: 'waiting' },
      reviewer: { name: start.reviewerName ?? 'None selected', state: reviewerState },
    },
    mode: start.mode,
    phase: 'plan',
    outputState: 'configured',
    dogState: 'wandering',
    handoffNetworkState: 'standby',
    projectMessages: [],
    terminalEvents: [],
    manualTasks: [],
    verificationSummary: { checks: [], headline: null },
    reviewerState,
    findings: [],
    repairs: [],
    researchState: {
      status: start.researchEnabled ? 'configured' : 'not_configured',
      approvedTopics: start.researchEnabled ? start.approvedResearchTopics : [],
      note: null,
    },
    projectBrainState: { entries: 0, lastUpdate: null, pendingApprovals: 0 },
    completionState: { verdict: 'not_complete', evidence: [] },
    researchEnabled: start.researchEnabled,
    repairUsed: false,
  };
}
