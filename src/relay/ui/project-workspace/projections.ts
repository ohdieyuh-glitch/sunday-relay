import type {
  CompletionState,
  EventTruthClass,
  PhaseStepState,
  ProjectPhase,
  RepairTask,
  ReviewFinding,
  ReviewerStateKind,
  TerminalEventCategory,
  WorkspaceDogState,
  WorkspaceOutputState,
} from './contracts';
import type { PixelDogMarker, PixelDogPose } from '../pixel-dog';

/**
 * Pure display projections for the Active Project Workspace. These functions
 * shape safe normalized data for rendering — they never create canonical
 * events, never decide policy, and never override Relay Core. The
 * completion guard here is defense-in-depth for DISPLAY only: even if props
 * disagree, the UI refuses to show VERIFIED COMPLETE while a blocker is
 * visible.
 */

/* ----------------------------------------------------------- truth badges */

export const TRUTH_BADGE: Record<EventTruthClass, { label: string; tone: string }> = {
  agent_claim: { label: 'CLAIM — PENDING VERIFICATION', tone: 'claim' },
  relay_evidence: { label: 'VERIFIED EVIDENCE', tone: 'evidence' },
  review_verdict: { label: 'INDEPENDENT REVIEW', tone: 'review' },
  user_action_required: { label: 'WAITING FOR USER', tone: 'user' },
  system_notice: { label: 'SYSTEM', tone: 'system' },
};

export const CATEGORY_LABEL: Record<TerminalEventCategory, string> = {
  relay: 'RELAY',
  prompt_architect: 'PROMPT ARCHITECT',
  research: 'RESEARCH',
  coding_agent: 'CODING AGENT',
  workspace_inspection: 'WORKSPACE INSPECTION',
  verification: 'VERIFICATION',
  reviewer: 'REVIEWER',
  repair: 'REPAIR',
  manual_task: 'MANUAL TASK',
  completion_engine: 'COMPLETION ENGINE',
  security: 'SECURITY',
  system: 'SYSTEM',
};

/** ISO timestamp → HH:MM:SS display (UTC slice; deterministic). */
export function formatEventTime(iso: string): string {
  const m = iso.match(/T(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : iso;
}

/* -------------------------------------------------------- output states */

export const OUTPUT_STATE_LABEL: Record<WorkspaceOutputState, string> = {
  draft: 'DRAFT',
  configured: 'CONFIGURED',
  ready: 'READY',
  implementing: 'IMPLEMENTING',
  held_for_inspection: 'HELD FOR INSPECTION',
  held_for_verification: 'HELD FOR VERIFICATION',
  held_for_review: 'HELD FOR REVIEW',
  revision_required: 'REVISION REQUIRED',
  repairing: 'REPAIRING',
  held_for_re_review: 'HELD FOR RE-REVIEW',
  waiting_for_user: 'WAITING FOR USER',
  stopped_safely: 'STOPPED SAFELY',
  verified_complete: 'VERIFIED COMPLETE',
  demo_verified_complete: 'DEMO VERIFIED COMPLETE',
};

export const REVIEWER_STATE_LABEL: Record<ReviewerStateKind, string> = {
  not_configured: 'NOT CONFIGURED',
  not_required: 'NOT REQUIRED',
  waiting: 'WAITING',
  reviewing: 'REVIEWING',
  changes_required: 'CHANGES REQUIRED',
  re_reviewing: 'RE-REVIEWING',
  approved: 'APPROVED',
  unavailable: 'UNAVAILABLE',
  sign_in_required: 'SIGN-IN REQUIRED',
};

/* ------------------------------------------------------------ phase rail */

export interface PhaseRailInput {
  phase: ProjectPhase;
  researchEnabled: boolean;
  repairUsed: boolean;
  /** A blocking finding, unresolved repair, or required review is open. */
  blockingOpen: boolean;
  verified: boolean;
}

export interface PhaseRailStep {
  phase: ProjectPhase;
  label: string;
  state: PhaseStepState;
}

const PHASE_ORDER: ProjectPhase[] = [
  'plan',
  'research',
  'build',
  'verify',
  'review',
  'repair',
  'complete',
];

const PHASE_LABEL: Record<ProjectPhase, string> = {
  plan: 'PLAN',
  research: 'RESEARCH',
  build: 'BUILD',
  verify: 'VERIFY',
  review: 'REVIEW',
  repair: 'REPAIR',
  complete: 'COMPLETE',
};

/**
 * Compute the phase rail. Only the active phase is highlighted; earlier
 * phases are marked complete (research/repair may be optional); COMPLETE is
 * locked while any blocker is open and is never active by default.
 */
export function phaseRailSteps(input: PhaseRailInput): PhaseRailStep[] {
  const activeIndex = PHASE_ORDER.indexOf(input.phase);
  return PHASE_ORDER.map((phase, index) => {
    let state: PhaseStepState;
    if (phase === 'complete') {
      if (input.blockingOpen) state = 'locked';
      else if (input.phase === 'complete') state = 'active';
      else if (input.verified) state = 'complete';
      else state = 'pending';
    } else if (index === activeIndex) {
      state = 'active';
    } else if (index < activeIndex) {
      if (phase === 'research' && !input.researchEnabled) state = 'optional';
      else if (phase === 'repair' && !input.repairUsed) state = 'optional';
      else state = 'complete';
    } else {
      state = 'pending';
    }
    return { phase, label: PHASE_LABEL[phase], state };
  });
}

/* ------------------------------------------------------ completion guard */

export interface CompletionDisplayInput {
  completionState: CompletionState;
  reviewerState: ReviewerStateKind;
  findings: ReviewFinding[];
  repairs: RepairTask[];
}

export interface CompletionDisplay {
  showVerifiedComplete: boolean;
  blockers: string[];
}

/**
 * Display-only completion guard. VERIFIED COMPLETE renders ONLY when the
 * CompletionPolicy verdict arrived as verified_complete AND no visible
 * blocker contradicts it. An agent's completion claim is never enough.
 */
export function completionDisplay(input: CompletionDisplayInput): CompletionDisplay {
  const blockers: string[] = [];
  for (const f of input.findings) {
    if ((f.status === 'open' || f.status === 'validated') && f.severity !== 'low') {
      blockers.push(`Finding ${f.findingId} is ${f.status}.`);
    }
  }
  for (const r of input.repairs) {
    if (r.status !== 'verified' || r.verification !== 'passed') {
      blockers.push(`Repair ${r.repairId} is not verified.`);
    }
  }
  if (input.reviewerState === 'changes_required' || input.reviewerState === 're_reviewing') {
    blockers.push('Independent review has not approved the work.');
  }
  if (input.reviewerState === 'reviewing' || input.reviewerState === 'waiting') {
    blockers.push('Required review has not completed.');
  }
  return {
    showVerifiedComplete:
      input.completionState.verdict === 'verified_complete' && blockers.length === 0,
    blockers,
  };
}

/* -------------------------------------------------------------- dog map */

export interface DogPresentation {
  pose: PixelDogPose;
  marker: PixelDogMarker;
  moving: boolean;
  label: string;
}

export const DOG_PRESENTATION: Record<WorkspaceDogState, DogPresentation> = {
  wandering: { pose: 'standing', marker: 'none', moving: true, label: 'WANDERING' },
  trotting: { pose: 'trotting', marker: 'none', moving: true, label: 'TROTTING' },
  running: { pose: 'running', marker: 'none', moving: true, label: 'RUNNING' },
  implementing: { pose: 'coding', marker: 'none', moving: false, label: 'IMPLEMENTING' },
  sprinting: { pose: 'running', marker: 'none', moving: true, label: 'SPRINTING' },
  carrying_handoff: { pose: 'carrying', marker: 'none', moving: true, label: 'CARRYING HANDOFF' },
  researching: { pose: 'sitting', marker: 'scan', moving: false, label: 'RESEARCHING' },
  verifying: { pose: 'standing', marker: 'question', moving: false, label: 'VERIFYING' },
  // The review marker stays a QUESTION: a review in progress is neither an
  // approval nor a verification, so it must never render as a check.
  reviewing: { pose: 'sleeping', marker: 'question', moving: false, label: 'REVIEWING' },
  repairing: { pose: 'digging', marker: 'alert', moving: false, label: 'REPAIRING' },
  waiting_for_user: { pose: 'sitting', marker: 'alert', moving: false, label: 'WAITING FOR USER' },
  stopped_safely: { pose: 'lying', marker: 'none', moving: false, label: 'STOPPED SAFELY' },
  complete: { pose: 'sitting', marker: 'check', moving: false, label: 'COMPLETE' },
};
