import type {
  ManualTask,
  ProjectMessage,
  RelayProjectWorkspaceProps,
  RepairTask,
  ReviewFinding,
  WorkspaceMission,
  WorkspaceProject,
  WorkspaceTerminalEvent,
} from './contracts';

/**
 * FIXTURE DATA — frontend preview only. Every scenario below is a clearly
 * labeled, deterministic sample of SAFE NORMALIZED Relay activity so the
 * founder can preview each workspace state in a browser. Nothing here is
 * live: no agent ran, no test executed, no review occurred, no research
 * happened. Every event carries `fixture: true` and renders with a FIXTURE
 * label. No raw stdout/stderr, no shell prompts, no provider streams, no
 * session identifiers, no hidden reasoning, no credentials — ever.
 */

export type WorkspaceFixtureKey =
  | 'implementing'
  | 'verifying'
  | 'reviewing'
  | 'revision_required'
  | 'waiting_for_user'
  | 'researching'
  | 'verified_complete';

export type WorkspaceFixture = Omit<
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
> & { fixtureLabel: string };

const PROJECT: WorkspaceProject = {
  projectId: 'rly-001',
  name: 'Sunday Relay Frontend',
  reference: 'RLY / 001',
  projectType: 'Web interface',
};

const MISSION: WorkspaceMission = {
  missionId: 'msn-fixture-001',
  title: 'Relay entry home and project workspace',
  summary:
    'Build the Relay Entry Home and the Active Project Workspace to the founder-approved visual direction.',
};

const ev = (
  eventId: string,
  at: string,
  category: WorkspaceTerminalEvent['category'],
  truth: WorkspaceTerminalEvent['truth'],
  headline: string,
  detail?: string,
  meta?: string,
): WorkspaceTerminalEvent => ({
  eventId,
  at,
  category,
  truth,
  headline,
  detail,
  meta,
  fixture: true,
});

const msg = (
  messageId: string,
  author: ProjectMessage['author'],
  text: string,
  at: string,
  kind?: ProjectMessage['kind'],
  decisionId?: string,
): ProjectMessage => ({ messageId, author, text, at, kind, decisionId, fixture: true });

const BASE_EVENTS: WorkspaceTerminalEvent[] = [
  ev('fx-ev-1', '2026-07-22T11:57:12Z', 'relay', 'system_notice', 'Mission Contract approved.'),
  ev(
    'fx-ev-2',
    '2026-07-22T11:57:18Z',
    'prompt_architect',
    'system_notice',
    'Implementation handoff prepared for Claude Code.',
  ),
];

const NO_FINDINGS: ReviewFinding[] = [];
const NO_REPAIRS: RepairTask[] = [];
const NO_TASKS: ManualTask[] = [];

const BASE: Omit<WorkspaceFixture, 'fixtureLabel'> = {
  project: PROJECT,
  mission: MISSION,
  workforce: {
    promptArchitect: { name: 'Sunday Alcatraz', status: 'waiting' },
    codingAgent: { name: 'Claude Code', status: 'ready' },
    reviewer: { name: 'Codex', state: 'waiting' },
  },
  mode: 'semi',
  phase: 'build',
  outputState: 'implementing',
  dogState: 'running',
  handoffNetworkState: 'online',
  projectMessages: [
    msg(
      'fx-msg-1',
      'relay',
      'Mission started. The Prompt Architect prepared the first implementation handoff for Claude Code.',
      '2026-07-22 11:57 UTC',
      'summary',
    ),
  ],
  terminalEvents: BASE_EVENTS,
  manualTasks: NO_TASKS,
  verificationSummary: { checks: [], headline: null },
  reviewerState: 'waiting',
  findings: NO_FINDINGS,
  repairs: NO_REPAIRS,
  researchState: { status: 'monitoring', approvedTopics: ['Accessibility standards'], note: null },
  projectBrainState: { entries: 12, lastUpdate: '2026-07-21 19:02 UTC', pendingApprovals: 0 },
  completionState: { verdict: 'not_complete', evidence: [] },
  researchEnabled: true,
  repairUsed: false,
};

/* --------------------------------------------------------- 1 IMPLEMENTING */

const implementing: WorkspaceFixture = {
  ...BASE,
  fixtureLabel: 'FIXTURE — IMPLEMENTING',
  workforce: {
    promptArchitect: { name: 'Sunday Alcatraz', status: 'preparing_handoff' },
    codingAgent: { name: 'Claude Code', status: 'implementing' },
    reviewer: { name: 'Codex', state: 'waiting' },
  },
  phase: 'build',
  outputState: 'implementing',
  dogState: 'running',
  terminalEvents: [
    ...BASE_EVENTS,
    ev(
      'fx-ev-impl-1',
      '2026-07-22T11:57:27Z',
      'coding_agent',
      'agent_claim',
      'Implementation report received.',
      'Awaiting Relay inspection.',
      'MODIFY 2 FILES',
    ),
    ev(
      'fx-ev-impl-2',
      '2026-07-22T11:57:29Z',
      'prompt_architect',
      'system_notice',
      'Preparing context for the next bounded task.',
    ),
  ],
};

/* ------------------------------------------------------------ 2 VERIFYING */

const verifying: WorkspaceFixture = {
  ...BASE,
  fixtureLabel: 'FIXTURE — VERIFYING',
  workforce: {
    promptArchitect: { name: 'Sunday Alcatraz', status: 'waiting' },
    codingAgent: { name: 'Claude Code', status: 'verifying' },
    reviewer: { name: 'Codex', state: 'waiting' },
  },
  phase: 'verify',
  outputState: 'held_for_verification',
  dogState: 'verifying',
  verificationSummary: {
    headline: 'Relay verification is running.',
    checks: [
      { label: 'Claimed files match changed files', status: 'passed' },
      { label: 'No protected files changed', status: 'passed' },
      { label: 'Typecheck', status: 'passed' },
      { label: 'Required tests', status: 'pending' },
    ],
  },
  terminalEvents: [
    ...BASE_EVENTS,
    ev(
      'fx-ev-ver-1',
      '2026-07-22T11:57:27Z',
      'coding_agent',
      'agent_claim',
      'Implementation report received.',
      'Awaiting Relay inspection.',
    ),
    ev(
      'fx-ev-ver-2',
      '2026-07-22T11:57:31Z',
      'workspace_inspection',
      'relay_evidence',
      'Two claimed files changed. No protected files changed.',
    ),
    ev(
      'fx-ev-ver-3',
      '2026-07-22T11:57:45Z',
      'verification',
      'relay_evidence',
      'Typecheck passed.',
      undefined,
      'RUN typecheck',
    ),
  ],
};

/* ------------------------------------------------------------ 3 REVIEWING */

const reviewing: WorkspaceFixture = {
  ...BASE,
  fixtureLabel: 'FIXTURE — REVIEWING',
  workforce: {
    promptArchitect: { name: 'Sunday Alcatraz', status: 'waiting' },
    codingAgent: { name: 'Claude Code', status: 'waiting' },
    reviewer: { name: 'Codex', state: 'reviewing' },
  },
  phase: 'review',
  outputState: 'held_for_review',
  dogState: 'reviewing',
  reviewerState: 'reviewing',
  verificationSummary: {
    headline: 'Required tests passed.',
    checks: [
      { label: 'Claimed files match changed files', status: 'passed' },
      { label: 'No protected files changed', status: 'passed' },
      { label: 'Typecheck', status: 'passed' },
      { label: 'Required tests', status: 'passed' },
    ],
  },
  terminalEvents: [
    ...BASE_EVENTS,
    ev(
      'fx-ev-rev-1',
      '2026-07-22T11:57:45Z',
      'verification',
      'relay_evidence',
      'Required tests passed.',
      undefined,
      'RUN required tests',
    ),
    ev(
      'fx-ev-rev-2',
      '2026-07-22T11:57:53Z',
      'reviewer',
      'system_notice',
      'Independent review started.',
      'The Reviewer has read-only access to the held output.',
    ),
  ],
};

/* ---------------------------------------------------- 4 REVISION REQUIRED */

const revisionRequired: WorkspaceFixture = {
  ...BASE,
  fixtureLabel: 'FIXTURE — REVISION REQUIRED',
  workforce: {
    promptArchitect: { name: 'Sunday Alcatraz', status: 'waiting' },
    codingAgent: { name: 'Claude Code', status: 'repairing' },
    reviewer: { name: 'Codex', state: 'changes_required' },
  },
  phase: 'repair',
  outputState: 'revision_required',
  dogState: 'carrying_handoff',
  reviewerState: 'changes_required',
  repairUsed: true,
  findings: [
    {
      findingId: 'F-1',
      severity: 'high',
      title: 'Mobile terminal overflows at 320px',
      criterion: 'Responsive layout: no horizontal overflow at 320px',
      evidenceSummary: 'Reviewer reproduced horizontal scrolling on the terminal event feed.',
      requiredAction: 'Constrain the event feed and re-verify the 320px layout.',
      status: 'validated',
    },
  ],
  repairs: [
    {
      repairId: 'R-1',
      findingId: 'F-1',
      assignedTo: 'Claude Code',
      authorizedFiles: ['src/relay/ui/project-workspace/relay-project-workspace.css'],
      status: 'in_progress',
      verification: 'pending',
    },
  ],
  verificationSummary: {
    headline: 'Repair evidence pending.',
    checks: [
      { label: 'Required tests', status: 'passed' },
      { label: 'Repair evidence', status: 'pending' },
    ],
  },
  terminalEvents: [
    ...BASE_EVENTS,
    ev('fx-ev-fix-1', '2026-07-22T11:58:21Z', 'reviewer', 'review_verdict', 'Changes required.'),
    ev(
      'fx-ev-fix-2',
      '2026-07-22T11:58:22Z',
      'relay',
      'relay_evidence',
      'Finding F-1 validated. Repair R-1 created.',
    ),
    ev(
      'fx-ev-fix-3',
      '2026-07-22T11:59:04Z',
      'repair',
      'agent_claim',
      'Bounded repair submitted.',
      'Awaiting Relay verification.',
    ),
  ],
};

/* ---------------------------------------------------- 5 WAITING FOR USER */

const waitingForUser: WorkspaceFixture = {
  ...BASE,
  fixtureLabel: 'FIXTURE — WAITING FOR USER',
  workforce: {
    promptArchitect: { name: 'Sunday Alcatraz', status: 'waiting' },
    codingAgent: { name: 'Claude Code', status: 'waiting' },
    reviewer: { name: 'Codex', state: 'waiting' },
  },
  phase: 'build',
  outputState: 'waiting_for_user',
  dogState: 'waiting_for_user',
  manualTasks: [
    {
      taskId: 'fx-mt-1',
      reference: 'MT-1',
      title: 'Production deployment requires approval',
      need: 'Relay needs approval before connecting the production deployment target.',
      reason: 'Deployment was not authorized in Project Settings.',
      requiredAction: 'Review the request and approve or keep it blocked.',
      afterward: 'Relay will connect the approved target and continue the mission.',
      safeState: 'stopped_safely',
      status: 'open',
    },
  ],
  projectMessages: [
    ...BASE.projectMessages,
    msg(
      'fx-msg-decision',
      'relay',
      'Approve connecting the production deployment target?',
      '2026-07-22 12:01 UTC',
      'approval_request',
      'fx-decision-deploy',
    ),
  ],
  terminalEvents: [
    ...BASE_EVENTS,
    ev(
      'fx-ev-wait-1',
      '2026-07-22T12:01:02Z',
      'manual_task',
      'user_action_required',
      'Production deployment requires approval.',
      'Mission stopped safely until you decide.',
    ),
  ],
};

/* -------------------------------------------------------- 6 RESEARCHING */

const researching: WorkspaceFixture = {
  ...BASE,
  fixtureLabel: 'FIXTURE — RESEARCHING',
  workforce: {
    promptArchitect: { name: 'Sunday Alcatraz', status: 'researching' },
    codingAgent: { name: 'Claude Code', status: 'ready' },
    reviewer: { name: 'Codex', state: 'waiting' },
  },
  phase: 'research',
  outputState: 'ready',
  dogState: 'researching',
  researchState: {
    status: 'awaiting_approval',
    approvedTopics: ['Accessibility standards', 'Responsive layout patterns'],
    note: 'Authentication library guidance may be outdated. Research approval requested.',
  },
  projectBrainState: { entries: 12, lastUpdate: '2026-07-21 19:02 UTC', pendingApprovals: 1 },
  terminalEvents: [
    ...BASE_EVENTS,
    ev(
      'fx-ev-res-1',
      '2026-07-22T11:58:02Z',
      'research',
      'system_notice',
      'Researching approved topics.',
      'Bounded to the topics approved in Project Settings.',
    ),
    ev(
      'fx-ev-res-2',
      '2026-07-22T11:58:40Z',
      'research',
      'user_action_required',
      'New knowledge awaiting approval.',
      'Project Brain update requires your approval before it is stored.',
    ),
  ],
};

/* --------------------------------------------------- 7 VERIFIED COMPLETE */

const verifiedComplete: WorkspaceFixture = {
  ...BASE,
  fixtureLabel: 'FIXTURE — VERIFIED COMPLETE',
  workforce: {
    promptArchitect: { name: 'Sunday Alcatraz', status: 'waiting' },
    codingAgent: { name: 'Claude Code', status: 'waiting' },
    reviewer: { name: 'Codex', state: 'approved' },
  },
  phase: 'complete',
  outputState: 'verified_complete',
  dogState: 'complete',
  reviewerState: 'approved',
  repairUsed: true,
  repairs: [
    {
      repairId: 'R-1',
      findingId: 'F-1',
      assignedTo: 'Claude Code',
      authorizedFiles: ['src/relay/ui/project-workspace/relay-project-workspace.css'],
      status: 'verified',
      verification: 'passed',
    },
  ],
  findings: [
    {
      findingId: 'F-1',
      severity: 'high',
      title: 'Mobile terminal overflows at 320px',
      criterion: 'Responsive layout: no horizontal overflow at 320px',
      evidenceSummary: 'Repair verified; layout re-checked at 320px.',
      requiredAction: 'None — repaired.',
      status: 'repaired',
    },
  ],
  verificationSummary: {
    headline: 'All required evidence passed.',
    checks: [
      { label: 'Claimed files match changed files', status: 'passed' },
      { label: 'No protected files changed', status: 'passed' },
      { label: 'Typecheck', status: 'passed' },
      { label: 'Required tests', status: 'passed' },
      { label: 'Repair evidence', status: 'passed' },
    ],
  },
  completionState: {
    verdict: 'verified_complete',
    evidence: [
      'Acceptance criteria passed',
      'Required tests passed',
      'Required review approved',
      'No blocking findings',
      'Protected paths unchanged',
      'Source repository protected',
    ],
  },
  terminalEvents: [
    ...BASE_EVENTS,
    ev('fx-ev-done-1', '2026-07-22T11:59:22Z', 'verification', 'relay_evidence', 'Repair evidence passed.'),
    ev('fx-ev-done-2', '2026-07-22T11:59:48Z', 'reviewer', 'review_verdict', 'Approved.'),
    ev(
      'fx-ev-done-3',
      '2026-07-22T11:59:49Z',
      'completion_engine',
      'relay_evidence',
      'Mission verified complete.',
    ),
  ],
};

export const WORKSPACE_FIXTURES: Record<WorkspaceFixtureKey, WorkspaceFixture> = {
  implementing,
  verifying,
  reviewing,
  revision_required: revisionRequired,
  waiting_for_user: waitingForUser,
  researching,
  verified_complete: verifiedComplete,
};

export const WORKSPACE_FIXTURE_KEYS = Object.keys(WORKSPACE_FIXTURES) as WorkspaceFixtureKey[];
