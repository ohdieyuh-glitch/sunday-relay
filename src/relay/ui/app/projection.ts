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
  VerificationCheck,
  WorkspaceDogState,
  WorkspaceOutputState,
  WorkspaceTerminalEvent,
} from '../project-workspace/contracts';
import type {
  CodingTerminalState,
  MissionAttestationSummary,
  ProjectBrain,
  RelayEvent,
  RelayMission,
  RelayMissionState,
  RelayProject,
} from './contracts';
import type { StoredProjectSettings } from './contracts';
import { projectOperations } from '../../shared/llmops';
import type { RelayOperationalRecord } from '../../shared/llmops';

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

/* ------------------------------------------------------------------------ *
 * LIVE REVIEW AND VERIFICATION TRUTH
 *
 * The rule, stated once and applied by every function below: a mission-state
 * value is a POSITION IN THE MISSION MACHINE, never evidence about a role
 * that did or did not run. `verified_complete` in particular proves none of
 * the following, and nothing here derives them from it:
 *
 *   - reviewer approval — only a real reviewer VERDICT proves that;
 *   - verification success — only Relay's own recorded inspection result and
 *     its own recorded test result prove that;
 *   - independent review having happened at all;
 *   - release authorization — release is a separate authority which this
 *     projection does not represent and must never imply.
 *
 * Cost, budget and economics are likewise a separate authority: no spend
 * figure, budget status or receipt can move a reviewer state or a check.
 *
 * Missing evidence stays VISIBLY missing. An absent record renders `waiting`,
 * `pending`, `not_run`, or an empty list — never a pass. The demo path keeps
 * its ordinal-keyed sample content, which is labeled as sample content and
 * can never enter a live mission (machine-enforced).
 * ------------------------------------------------------------------------ */

/** Set comparison of two file lists. Relay's inspection result and the
    agent's claim are both records; the comparison is PERFORMED here rather
    than asserted. */
function sameFiles(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/** Files Relay actually observed changing that fall under a protected path. */
function protectedPathsTouched(terminal: CodingTerminalState): string[] {
  const protectedPaths = terminal.permissions?.protectedPaths ?? [];
  return terminal.changedFiles.filter((file) =>
    protectedPaths.some((p) => file === p || file.startsWith(p.endsWith('/') ? p : `${p}/`)),
  );
}

/**
 * Relay's verification evidence for a LIVE mission.
 *
 * Two distinct facts are kept distinct, because conflating them is the defect
 * this function was repaired to remove:
 *
 *   - a `relay_evidence` inspection/verification EVENT proves the step RAN;
 *   - the persisted coding terminal carries the step's RESULT — the real
 *     changed-file list Relay read from the worktree, and the real status of
 *     the verification command Relay itself executed.
 *
 * "It ran" is rendered `pending`. Only a recorded result is rendered
 * `passed` or `failed`, and the result is recomputed here from the records
 * rather than taken on trust from a headline or a state name.
 */
function deriveLiveVerification(
  state: M,
  events: RelayEvent[],
  mission: RelayMission,
  fallback: ConfiguredWorkspaceState['verificationSummary'],
): ConfiguredWorkspaceState['verificationSummary'] {
  const inspectionRan = events.some((e) => e.category === 'workspace_inspection' && e.truth === 'relay_evidence');
  const verificationRan = events.some((e) => e.category === 'verification' && e.truth === 'relay_evidence');
  const terminal = mission.terminal ?? null;
  /** The mission has reached the point where these checks were DUE. Before
      that, saying "not run" would be noise rather than information. */
  const due = atLeast(state, 'claim_submitted') || state === 'failed';

  const checks: VerificationCheck[] = [];
  const push = (label: string, status: VerificationCheck['status']) => checks.push({ label, status });

  /* --------- Relay's own independent workspace inspection ------------- */
  if (terminal && terminal.changedFiles.length > 0) {
    if (terminal.claim) {
      push(
        'Claimed files match changed files',
        sameFiles(terminal.claim.filesChanged, terminal.changedFiles) ? 'passed' : 'failed',
      );
    }
    push('No protected files changed', protectedPathsTouched(terminal).length === 0 ? 'passed' : 'failed');
  } else if (inspectionRan) {
    push('Claimed files match changed files', 'pending');
  } else if (due) {
    push('Claimed files match changed files', 'not_run');
  }

  /* --------- the deterministic verification Relay itself ran ---------- */
  if (terminal?.test) {
    push('Required tests', terminal.test.status);
  } else if (verificationRan) {
    push('Required tests', 'pending');
  } else if (due) {
    push('Required tests', 'not_run');
  }

  if (checks.length === 0) return fallback;

  const failed = checks.some((c) => c.status === 'failed');
  const pending = checks.some((c) => c.status === 'pending');
  const allPassed = checks.every((c) => c.status === 'passed');

  const headline = failed
    ? 'Relay verification did not pass.'
    : allPassed
      ? 'Required checks passed under Relay verification.'
      : pending
        ? 'Relay recorded that it is verifying the coding-agent claim — no result yet.'
        : 'Relay has not run these checks for this mission.';

  return { headline, checks };
}

/**
 * Live completion evidence. Every line is a RECORD — Relay's own evidence
 * statements, verbatim, plus attested executions — rather than a sentence
 * this module composed about work it cannot see. A mission that completed
 * with no recorded evidence says exactly that, and never claims a review, a
 * verification or a release it has no record of.
 */
function deriveLiveCompletion(
  state: M,
  mission: RelayMission,
  events: RelayEvent[],
): ConfiguredWorkspaceState['completionState'] {
  if (state !== 'verified_complete') return { verdict: 'not_complete', evidence: [] };

  const evidence: string[] = events
    .filter(
      (e) =>
        e.truth === 'relay_evidence' &&
        (e.category === 'workspace_inspection' ||
          e.category === 'verification' ||
          e.category === 'completion_engine'),
    )
    .map((e) => e.headline);

  if (evidence.length === 0) {
    evidence.push('No Relay inspection or verification evidence is recorded for this mission.');
  }

  const attested = (role: MissionAttestationSummary['role']) =>
    (mission.attestations ?? []).find(
      (a) => a.role === role && a.launchVerified && a.completionVerified && !a.fallbackOccurred,
    );

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

/**
 * Reviewer display for a LIVE mission. There is deliberately no fall-back to
 * `REVIEWER[state]` here: that fall-back is what let a mission sitting in
 * `approved`/`verified_complete` render an APPROVED reviewer with no reviewer
 * verdict on record at all.
 *
 * Only a verdict produces an outcome state. Without one, the most this can
 * say is that the reviewer has STARTED — and only when a reviewer execution
 * was actually attested or a reviewer event was actually recorded.
 */
function deriveLiveReviewer(mission: RelayMission, events: RelayEvent[]): ReviewerStateKind {
  const review = mission.review;
  if (review) {
    if (review.verdict === 'changes_required' || review.findings.some((f) => f.severity === 'blocking')) {
      return 'changes_required';
    }
    if (review.verdict === 'unable_to_review') return 'unavailable';
    if (review.verdict === 'approved') return 'approved';
    return 'reviewing';
  }

  // No verdict on record. "The reviewer is running" is a PENDING status, and
  // it too needs a record — an attested launch or a reviewer event.
  const launched =
    (mission.attestations ?? []).some((a) => a.role === 'reviewer' && a.launchVerified) ||
    events.some((e) => e.category === 'reviewer');
  return launched ? 'reviewing' : 'waiting';
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
  /**
   * The project's operational record, when one exists. Absent means nothing
   * has been observed — not an empty record.
   */
  operations?: RelayOperationalRecord;
  /**
   * ISO-8601 instant the operations view is projected for. Required alongside
   * `operations`, because staleness and health are both measured FROM it and a
   * projection that invented one would be answering "is this system alive?"
   * with a number it made up.
   */
  now?: string;
}

export function deriveMissionProjection(
  input: MissionProjectionInput,
): ConfiguredWorkspaceState & { codingTerminal?: CodingTerminalView; roleBilling?: RoleBillingRow[] } {
  const { project, settings, brain, mission, events, operations, now } = input;
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
    : deriveLiveVerification(s, events, mission, base.verificationSummary);

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
        // The mission's own value, never a browser-side assumption about it.
        reviewerBilling: mission.review?.billing ?? null,
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
        state: isDemo ? REVIEWER[s] : deriveLiveReviewer(mission, events),
      },
    },
    phase: PHASE[s],
    outputState: OUTPUT[s],
    dogState: DOG[s],
    handoffNetworkState: s === 'configured' ? 'standby' : 'online',
    terminalEvents: events.map(toTerminalEvent),
    reviewerState: isDemo ? REVIEWER[s] : deriveLiveReviewer(mission, events),
    findings,
    repairs,
    verificationSummary,
    // THE OPERATIONAL RECORD, read back.
    //
    // Both conditions are required and both are honest. Without a record
    // nothing has been observed for this project; without a clock the view's
    // `asOf` would be invented, and every staleness and health answer derives
    // from it. In either case `operationsView` stays undefined and the panel
    // says no operations source is wired — which is TRUE for that host, rather
    // than a constant that would rot the moment one surface was wired.
    ...(operations !== undefined && now !== undefined
      ? { operationsView: projectOperations(operations, now) }
      : {}),
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
      : deriveLiveCompletion(s, mission, events),
    repairUsed: isDemo && atLeast(s, 'repair_in_progress'),
  };
}

export type { ConfiguredWorkspaceState, RelayProjectWorkspaceProps };
