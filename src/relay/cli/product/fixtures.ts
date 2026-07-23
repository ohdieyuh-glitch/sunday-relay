import type {
  EvidenceVM, FindingVM, HomeVM, ManualTaskVM, ProjectDraft, RecentProjectVM, RecoveryVM,
  RepairVM, SafeEventVM,
} from './contracts';
import { STARTING_ROUTES } from './contracts';

/**
 * Relay CLI OFFLINE DEMO fixtures (Prompt 8.6). Deterministic, clearly
 * labeled demo data used ONLY by `relay:cli:demo` — never shown in normal
 * project lists. FAKE ADAPTERS · NO PROVIDER CALLS: every event below is a
 * scripted safe projection; nothing here claims real execution.
 */

export const DEMO_PROJECT: ProjectDraft = {
  projectId: 'prj-demo-frontend',
  name: 'Sunday Relay Frontend',
  projectType: 'Web application',
  objective: 'Finish the Relay entry home and project workspace safely.',
  existingProject: true,
  repositoryPath: '~/sunday-relay',
  stack: ['TypeScript', 'React', 'Vite'],
  scopeSummary: 'Relay entry home, project settings, live terminal drawer.',
  protectedAreas: ['payments/', 'infrastructure/'],
  productionImpact: 'internal',
  architect: 'Sunday Alcatraz',
  codingAgent: 'Claude Code',
  reviewer: 'Codex',
  mode: 'GUIDED',
  researchPreference: 'monitoring',
  evidenceRequirements: ['frontend test suite', 'file-claim inspection'],
  runtimeLimitMinutes: 30,
  callLimit: 4,
  reviewLimit: 1,
  repairLimit: 1,
  createdAt: '2026-07-26T12:40:00.000Z',
  updatedAt: '2026-07-26T12:44:53.000Z',
  status: 'in_progress',
};

export const DEMO_RECENT_PROJECTS: RecentProjectVM[] = [
  { index: 1, reference: 'RLY / 001', name: 'Sunday Relay Frontend', state: 'IN PROGRESS', stateTone: 'gold', detail: 'GUIDED · Claude Code + Codex' },
  { index: 2, reference: 'RLY / 002', name: 'Alcatraz Beta Safety', state: 'WAITING FOR USER', stateTone: 'amber', detail: 'GUIDED' },
  { index: 3, reference: 'RLY / 003', name: 'Authentication Hardening', state: 'VERIFIED COMPLETE', stateTone: 'green', detail: 'GUIDED · reviewed by Codex' },
];

export function demoHome(): HomeVM {
  return {
    route: 'RLY / HOME',
    projectLine: 'No project selected',
    handoffNetwork: 'Standby',
    recent: DEMO_RECENT_PROJECTS,
    routes: STARTING_ROUTES.map((label, i) => ({ index: i + 1, label })),
    commands: [
      { key: 'N', label: 'New project' },
      { key: 'O', label: 'Open project' },
      { key: 'C', label: 'Connect project' },
      { key: 'R', label: 'Recover run' },
      { key: 'Q', label: 'Quit' },
    ],
    demo: true,
  };
}

/* ------------------------- scripted timeline ------------------------- */

/** The full offline mission timeline — architect research → coding →
 * relay verification → review → finding/repair → re-review → complete.
 * Timestamps are fixture times (HH:MM:SS), NEVER derived from wall clock. */
export const DEMO_TIMELINE: SafeEventVM[] = [
  { at: '12:43:12', role: 'relay', symbol: 'active', primary: 'Mission locked. Starting execution.', secondary: 'Mission Contract accepted at revision 1.' },
  { at: '12:43:21', role: 'architect', symbol: 'event', primary: 'Generating implementation handoff…', secondary: 'Analyzing requirements and constraints.' },
  { at: '12:43:29', role: 'architect', symbol: 'event', primary: 'Researching project details…', secondary: 'Checking approved technologies and project facts.' },
  { at: '12:43:41', role: 'architect', symbol: 'event', primary: 'Updating Project Brain…', secondary: 'Approved knowledge prepared for project context.' },
  { at: '12:43:49', role: 'architect', symbol: 'handoff', primary: 'Handoff ready.', secondary: 'Passing to Coding Agent…', tone: 'green', annotation: { kind: 'COMPLETE', text: 'COMPLETE' } },
  { at: '12:44:02', role: 'coding', symbol: 'event', primary: 'Inspecting claimed files…', secondary: 'Reading repository structure inside the isolated worktree.' },
  { at: '12:44:18', role: 'coding', symbol: 'event', primary: 'Editing claimed file', secondary: 'Updating the Relay entry view.', annotation: { kind: 'MODIFY', text: 'src/relay/ui/RelayHome.tsx' } },
  { at: '12:44:27', role: 'coding', symbol: 'event', primary: 'Running approved verification', secondary: 'frontend test suite', annotation: { kind: 'RUN', text: 'npm test' } },
  { at: '12:44:37', role: 'coding', symbol: 'event', primary: 'Submitting implementation report…', secondary: 'Status: CLAIM PENDING VERIFICATION' },
  { at: '12:44:39', role: 'relay', symbol: 'event', primary: 'Agent report received. Claim pending verification.', secondary: 'A completion statement is a claim, not proof.' },
  { at: '12:44:42', role: 'relay', symbol: 'event', primary: 'Inspecting workspace revision…', secondary: 'Two claimed files changed. Zero protected files changed.' },
  { at: '12:44:52', role: 'verification', symbol: 'verified', primary: 'Required tests passed. Verified evidence.', secondary: 'Evidence bound to revision 7.', tone: 'green' },
  { at: '12:44:53', role: 'relay', symbol: 'event', primary: 'Output held for independent review.', secondary: 'Context preserved. Handoff intact.', annotation: { kind: 'HELD', text: 'HELD FOR REVIEW' } },
  { at: '12:45:03', role: 'reviewer', symbol: 'review', primary: 'Independent review active.', secondary: 'Sandbox: read only. Reviewing for security, reliability, and clarity.' },
  { at: '12:45:41', role: 'reviewer', symbol: 'blocked', primary: 'Changes required.', secondary: 'Finding F-1 · Severity High · Criterion AC-2', tone: 'coral' },
  { at: '12:45:42', role: 'relay', symbol: 'event', primary: 'Finding F-1 validated. Repair R-1 created.', secondary: 'Scope-locked to the original claims. Output remains held.' },
  { at: '12:45:58', role: 'coding', symbol: 'event', primary: 'Applying bounded repair…', secondary: 'Exact original session resumed. Attempt 2 of 2.', annotation: { kind: 'MODIFY', text: 'src/relay/ui/RelayHome.tsx' } },
  { at: '12:46:21', role: 'verification', symbol: 'verified', primary: 'Re-verification passed.', secondary: 'Evidence bound to revision 8.', tone: 'green' },
  { at: '12:46:44', role: 'reviewer', symbol: 'review', primary: 'Re-review active.', secondary: 'Exact original reviewer session resumed.' },
  { at: '12:47:12', role: 'reviewer', symbol: 'verified', primary: 'Approved.', secondary: 'Finding F-1 resolved by evidence and re-review.', tone: 'green', annotation: { kind: 'COMPLETE', text: 'APPROVED' } },
  { at: '12:47:14', role: 'relay', symbol: 'verified', primary: 'Mission verified complete.', secondary: 'CompletionPolicy satisfied. Repairs used: 1 of 1.', tone: 'green' },
];

/** PATH-A style short timeline used by the console before review begins. */
export const DEMO_TIMELINE_PREFIX_COUNT = 13;

export const DEMO_MANUAL_TASK: ManualTaskVM = {
  id: 'MT-1',
  status: 'WAITING FOR USER',
  title: 'Relay needs approval before connecting the production deployment target.',
  whyStopped: 'Deployment permission was disabled in Project Settings.',
  approveOutcome: 'Relay continues within the existing mission boundaries.',
  rejectOutcome: 'The mission remains stopped safely.',
};

export const DEMO_FINDING: FindingVM = {
  id: 'F-1',
  status: 'OPEN',
  severity: 'HIGH',
  reviewer: 'CODEX',
  criteria: ['AC-2'],
  workspaceRevision: '7',
  evidence: 'A single active spending breaker does not block dispatch.',
  requiredAction: 'Correct the guard and add the missing single-condition test.',
  linkedRepair: 'R-1',
};

export const DEMO_FINDING_RESOLVED: FindingVM = {
  ...DEMO_FINDING, status: 'RESOLVED', workspaceRevision: '8',
};

export const DEMO_REPAIR: RepairVM = {
  id: 'R-1',
  findingId: 'F-1',
  status: 'ASSIGNED',
  requiredChanges: 'Correct the guard and add the missing single-condition test.',
  authorizedFiles: ['src/relay/ui/RelayHome.tsx'],
};

export const DEMO_EVIDENCE: EvidenceVM[] = [
  { id: 'E-17', type: 'TEST', status: 'CURRENT', criteria: ['AC-1', 'AC-2', 'AC-3', 'AC-4'], revision: '8', authority: 'RELAY', result: 'PASS', resultTone: 'green' },
  { id: 'E-18', type: 'FILE-CLAIM INSPECTION', status: 'CURRENT', criteria: ['AC-2'], revision: '8', authority: 'RELAY', result: 'PASS', resultTone: 'green' },
  { id: 'E-19', type: 'INDEPENDENT REVIEW', status: 'CURRENT', criteria: ['AC-1', 'AC-2'], revision: '8', authority: 'CODEX', result: 'APPROVED', resultTone: 'green' },
];

export const DEMO_RECOVERY: RecoveryVM = {
  required: true,
  projectName: 'Sunday Relay Frontend',
  interruptedPhase: 'HELD FOR RE-REVIEW',
  workspace: 'MATCHES PERSISTED REVISION',
  evidence: 'CURRENT',
  openFindings: ['F-1'],
  repairs: ['R-1 submitted and verified'],
  sessions: [
    { provider: 'Claude', classification: 'reference persisted but unverified' },
    { provider: 'Codex', classification: 'reference persisted but unverified' },
  ],
  callBudget: { consumed: 3, max: 4 },
  nextAction: 'Verify provider session readiness and request founder authorization for the exact Codex re-review.',
  planOutcome: 'ready_for_exact_codex_resume',
};
