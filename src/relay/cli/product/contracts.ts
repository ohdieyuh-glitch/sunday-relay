import {
  OFFICIAL_RELAY_DOG_ACTIVITY_MOTION,
  OFFICIAL_RELAY_DOG_TRAVELLING_MOTIONS,
  projectOfficialRelayDogActivity,
} from '../../shared/official-relay-dog-states';

/**
 * Relay CLI product contracts (Prompt 8.6) — PURE view-model types for the
 * terminal product shell. Renderers accept ONLY these safe view models
 * (never arbitrary provider strings); every text field is produced through
 * the safety boundary in `safety.ts`. No policy decisions live here.
 */

/* ------------------------------ caps -------------------------------- */

export interface CliCaps {
  tty: boolean;
  color: boolean;
  unicode: boolean;
  width: number;
  reducedMotion: boolean;
  plain: boolean;
  json: boolean;
}

export type Breakpoint = 'full' | 'stacked' | 'compact' | 'linear';

/* ------------------------------ roles ------------------------------- */

export type RoleKey = 'relay' | 'architect' | 'coding' | 'reviewer' | 'verification' | 'system' | 'user';

export const ROLE_LABEL: Record<RoleKey, string> = {
  relay: 'RELAY', architect: 'PROMPT ARCHITECT', coding: 'CODING AGENT',
  reviewer: 'REVIEWER', verification: 'VERIFICATION', system: 'SYSTEM', user: 'USER',
};

/** Short labels for the stream timeline (mockup 1). */
export const ROLE_SHORT: Record<RoleKey, string> = {
  relay: 'RELAY', architect: 'ARCHITECT', coding: 'CODING AGENT',
  reviewer: 'REVIEWER', verification: 'VERIFICATION', system: 'SYSTEM', user: 'USER',
};

export type Tone = 'gold' | 'goldDim' | 'cream' | 'gray' | 'green' | 'amber' | 'coral' | 'cyan';

export const ROLE_TONE: Record<RoleKey, Tone> = {
  relay: 'gold', architect: 'gold', coding: 'gold', reviewer: 'cyan',
  verification: 'green', system: 'gray', user: 'cream',
};

/* ------------------------------ events ------------------------------ */

/** Symbols carry text equivalents — no state relies on color or glyph. */
export type EventSymbol = 'active' | 'event' | 'handoff' | 'verified' | 'review' | 'action' | 'blocked';

export interface EventAnnotation {
  kind: 'CREATE' | 'MODIFY' | 'RUN' | 'COMPLETE' | 'CONTEXT' | 'HELD' | 'INFO';
  text: string;
}

export interface SafeEventVM {
  at: string;            // HH:MM:SS only
  role: RoleKey;
  symbol: EventSymbol;
  primary: string;       // safe, bounded
  secondary?: string;    // safe, bounded
  annotation?: EventAnnotation;
  tone?: Tone;           // primary-line override (e.g. green completion)
}

/* ------------------------------ panels ------------------------------ */

export type PanelBadge = 'ACTIVE' | 'LIVE' | 'WORKING' | 'WAITING' | 'COMPLETE'
  | 'NOT CONFIGURED' | 'NOT REQUIRED' | 'REVIEWING' | 'CHANGES REQUIRED'
  | 'RE-REVIEWING' | 'APPROVED' | 'SIGN-IN REQUIRED' | 'UNAVAILABLE' | 'STANDBY' | 'VERIFYING';

export interface PanelVM {
  role: RoleKey;
  title: string;
  badge: PanelBadge;
  /** Right-edge status, e.g. THINKING ●● / WORKING ●●● (dots animate only
   * when the canonical state is active AND motion is allowed). */
  statusRight: string;
  statusTone: Tone;
  events: SafeEventVM[];
}

/* ------------------------------ dog --------------------------------- */

/**
 * The CLI's dog vocabulary is the website's vocabulary in display case
 * ('CARRYING HANDOFF' <-> 'carrying_handoff'), so both surfaces name the same
 * states. IMPLEMENTING is the explicit Milestone 4.5 state for "the coding
 * agent is doing the work"; RUNNING and SPRINTING are the legacy values that
 * mean the same thing.
 */
export type DogStateVM =
  | 'WANDERING' | 'TROTTING' | 'RUNNING' | 'IMPLEMENTING' | 'SPRINTING' | 'CARRYING HANDOFF'
  | 'RESEARCHING' | 'VERIFYING' | 'REVIEWING' | 'REPAIRING'
  | 'WAITING FOR USER' | 'STOPPED SAFELY' | 'COMPLETE';

export const DOG_STATES: readonly DogStateVM[] = [
  'WANDERING', 'TROTTING', 'RUNNING', 'IMPLEMENTING', 'SPRINTING', 'CARRYING HANDOFF',
  'RESEARCHING', 'VERIFYING', 'REVIEWING', 'REPAIRING',
  'WAITING FOR USER', 'STOPPED SAFELY', 'COMPLETE',
];

/**
 * States in which the dog TRAVELS along its track. Derived from the shared
 * official-dog semantics rather than restated here, so the CLI can never
 * disagree with the website about which states walk. Under Milestone 4.5 only
 * idle patrol and carrying a handoff travel: thinking, implementing, reviewing
 * and the rest hold their ground and animate in place.
 */
export const MOVING_DOG_STATES: readonly DogStateVM[] = DOG_STATES.filter((state) =>
  OFFICIAL_RELAY_DOG_TRAVELLING_MOTIONS.includes(
    OFFICIAL_RELAY_DOG_ACTIVITY_MOTION[
      projectOfficialRelayDogActivity(state.toLowerCase().replace(/ /g, '_'))
    ],
  ),
);

/* --------------------------- workforce ------------------------------ */

export interface WorkforceVM {
  architect: { name: string; online: boolean };
  coding: { name: string; online: boolean };
  reviewer: { name: string; online: boolean; configured: boolean };
  mode: string; // GUIDED
}

/* --------------------------- console -------------------------------- */

export type ConsoleView = 'stream' | 'panels';

export interface MissionConsoleVM {
  route: string;              // RLY / 001
  projectName: string;
  missionLabel: string;       // MISSION IN PROGRESS · OFFLINE DEMO …
  live: boolean;
  demo: boolean;              // OFFLINE DEMO banner labels
  view: ConsoleView;
  workforce: WorkforceVM;
  phase: string;              // PLAN → RESEARCH → …
  outputVisibility: string;
  callBudget: { consumed: number; max: number };
  stream: SafeEventVM[];
  panels: PanelVM[];
  dog: { state: DogStateVM; label: string };
  commandHint: string;
  footer: { handoff: string; motto: string; systems: string; systemsTone: Tone };
}

/* ----------------------------- home --------------------------------- */

export interface RecentProjectVM {
  index: number;
  reference: string;
  name: string;
  state: string;
  stateTone: Tone;
  detail: string; // GUIDED · Claude Code + Codex
}

export interface HomeVM {
  route: string;                // RLY / HOME
  projectLine: string;          // No project selected
  handoffNetwork: string;       // Standby / Online
  recent: RecentProjectVM[];
  routes: Array<{ index: number; label: string }>;
  commands: Array<{ key: string; label: string }>;
  demo: boolean;
}

export const STARTING_ROUTES = [
  'Build a product feature',
  'Build a web or mobile interface',
  'Build a new application',
  'Review an existing project',
  'Fix a bug or failing build',
  'Build an API or backend service',
] as const;

/* ------------------------- project records --------------------------- */

/** Safe project draft — durable via the canonical persistence store.
 * NEVER credentials, tokens, cookies, or recovery codes. */
export interface ProjectDraft {
  projectId: string;
  name: string;
  projectType: string;
  objective: string;
  existingProject: boolean;
  repositoryPath: string | null;
  stack: string[];
  scopeSummary: string;
  protectedAreas: string[];
  productionImpact: 'none' | 'internal' | 'external';
  architect: string;
  codingAgent: string;
  reviewer: string;
  mode: string;
  researchPreference: 'not_configured' | 'monitoring' | 'active';
  evidenceRequirements: string[];
  runtimeLimitMinutes: number;
  callLimit: number;
  reviewLimit: number;
  repairLimit: number;
  createdAt: string;
  updatedAt: string;
  status: 'draft' | 'in_progress' | 'waiting_for_user' | 'verified_complete' | 'stopped_safely';
}

export interface ProjectHomeVM {
  route: string;
  name: string;
  state: string;
  stateTone: Tone;
  mode: string;
  workforce: WorkforceVM;
  phaseRail: string[];      // PLAN RESEARCH BUILD VERIFY REVIEW COMPLETE
  phaseIndex: number;
  currentAction: string;
  outputVisibility: string;
  callBudget: { consumed: number; max: number };
  research: ResearchStateVM;
  actions: Array<{ key: string; label: string }>;
}

export type ResearchStateVM =
  | 'RESEARCH NOT CONFIGURED' | 'RESEARCH MONITORING' | 'RESEARCH ACTIVE'
  | 'KNOWLEDGE AWAITING APPROVAL' | 'PROJECT BRAIN UPDATED';

/* ------------------------ tasks / findings --------------------------- */

export interface ManualTaskVM {
  id: string;
  status: string;
  title: string;
  whyStopped: string;
  approveOutcome: string;
  rejectOutcome: string;
}

export interface FindingVM {
  id: string;
  status: string;
  severity: string;
  reviewer: string;
  criteria: string[];
  workspaceRevision: string;
  evidence: string;
  requiredAction: string;
  linkedRepair: string | null;
}

export interface RepairVM {
  id: string;
  findingId: string;
  status: string;
  requiredChanges: string;
  authorizedFiles: string[];
}

export interface EvidenceVM {
  id: string;
  type: string;
  status: 'CURRENT' | 'STALE';
  criteria: string[];
  revision: string;
  authority: string;
  result: string;
  resultTone: Tone;
}

/* ---------------------------- recovery ------------------------------- */

export interface RecoveryVM {
  required: boolean;
  projectName: string;
  interruptedPhase: string;
  workspace: string;
  evidence: string;
  openFindings: string[];
  repairs: string[];
  sessions: Array<{ provider: string; classification: string }>;
  callBudget: { consumed: number; max: number };
  nextAction: string;
  planOutcome: string;
}

/* ------------------------------ misc -------------------------------- */

export const FOOTER_MOTTO = 'PASS THE WORK. KEEP THE CONTEXT.';
export const PRODUCT_TAGLINE = 'Ship every Sunday.';
export const DEMO_LABELS = ['OFFLINE DEMO', 'VISUAL SIMULATION', 'FAKE ADAPTERS', 'NO PROVIDER CALLS'] as const;
/** The full honesty banner shown on the demo activation splash. */
export const DEMO_SPLASH_LABELS = [
  'OFFLINE VISUAL SIMULATION', 'FAKE ADAPTERS', 'NO PROVIDER CALLS', 'NO REAL FILE CHANGES',
] as const;
