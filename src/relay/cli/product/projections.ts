import type { RecoveryReport } from '../../persistence';
import type { RunIndexEntry } from '../../persistence';
import type {
  ConsoleView, DogStateVM, HomeVM, MissionConsoleVM, PanelBadge, PanelVM, ProjectDraft,
  ProjectHomeVM, RecoveryVM, ResearchStateVM, RoleKey, SafeEventVM, Tone, WorkforceVM,
} from './contracts';
import { FOOTER_MOTTO, ROLE_LABEL, STARTING_ROUTES } from './contracts';
import { safeSummary, safeText } from './safety';

/**
 * Relay CLI projections (Prompt 8.6) — PURE functions that turn canonical
 * Relay state (durable index entries, project records, recovery reports,
 * safe normalized events) into the view models the renderers accept. No
 * policy decisions: the CLI never evaluates CompletionPolicy, never creates
 * findings, never invents progress. Every text field passes the safety
 * boundary here.
 */

/* ------------------------------ events ------------------------------- */

/** Re-sanitize an event VM (fixtures included) — defense in depth: even
 * pre-built safe events pass the boundary before rendering. */
export function sanitizeEvent(event: SafeEventVM): SafeEventVM {
  return {
    ...event,
    at: safeText(event.at, { maxLength: 8 }),
    primary: safeSummary(event.primary),
    secondary: event.secondary === undefined ? undefined : safeSummary(event.secondary),
    annotation: event.annotation
      ? { kind: event.annotation.kind, text: safeText(event.annotation.text, { maxLength: 60 }) }
      : undefined,
  };
}

/* ------------------------------ console ------------------------------ */

const PANEL_ROLES: RoleKey[] = ['architect', 'coding', 'relay', 'reviewer'];

function roleEvents(events: SafeEventVM[], role: RoleKey): SafeEventVM[] {
  if (role === 'relay') return events.filter((e) => e.role === 'relay' || e.role === 'verification');
  return events.filter((e) => e.role === role);
}

function badgeFor(role: RoleKey, events: SafeEventVM[], reviewerConfigured: boolean): { badge: PanelBadge; statusRight: string; statusTone: Tone } {
  const last = events[events.length - 1];
  if (role === 'reviewer') {
    if (!reviewerConfigured) return { badge: 'NOT CONFIGURED', statusRight: 'NOT CONFIGURED', statusTone: 'gray' };
    if (!last) return { badge: 'WAITING', statusRight: 'WAITING', statusTone: 'amber' };
    if (last.symbol === 'verified') return { badge: 'APPROVED', statusRight: 'APPROVED', statusTone: 'green' };
    if (last.symbol === 'blocked') return { badge: 'CHANGES REQUIRED', statusRight: 'CHANGES REQUIRED', statusTone: 'coral' };
    return { badge: 'REVIEWING', statusRight: 'REVIEWING', statusTone: 'cyan' };
  }
  if (!last) return { badge: 'WAITING', statusRight: 'WAITING', statusTone: 'gray' };
  if (role === 'relay') {
    if (last.symbol === 'verified' && /complete/i.test(last.primary)) return { badge: 'COMPLETE', statusRight: 'COMPLETE', statusTone: 'green' };
    return { badge: 'LIVE', statusRight: last.role === 'verification' ? 'VERIFYING' : 'LIVE', statusTone: 'gold' };
  }
  if (last.annotation?.kind === 'COMPLETE' || (last.symbol === 'verified')) {
    return { badge: 'COMPLETE', statusRight: 'COMPLETE', statusTone: 'green' };
  }
  return role === 'architect'
    ? { badge: 'ACTIVE', statusRight: 'THINKING', statusTone: 'gold' }
    : { badge: 'ACTIVE', statusRight: 'WORKING', statusTone: 'gold' };
}

export function dogStateFrom(events: SafeEventVM[]): DogStateVM {
  const last = events[events.length - 1];
  if (!last) return 'WANDERING';
  if (/verified complete/i.test(last.primary)) return 'COMPLETE';
  if (/stopped safely/i.test(last.primary)) return 'STOPPED SAFELY';
  if (last.role === 'reviewer') return 'REVIEWING';
  if (last.role === 'verification') return 'VERIFYING';
  if (/research/i.test(last.primary)) return 'RESEARCHING';
  if (/repair/i.test(last.primary)) return 'REPAIRING';
  if (last.symbol === 'handoff') return 'CARRYING HANDOFF';
  if (last.symbol === 'action') return 'WAITING FOR USER';
  if (last.role === 'coding') return 'RUNNING';
  if (last.role === 'architect') return 'TROTTING';
  return 'TROTTING';
}

export function missionConsoleVM(input: {
  route: string;
  projectName: string;
  workforce: WorkforceVM;
  events: SafeEventVM[];
  view: ConsoleView;
  demo: boolean;
  callBudget: { consumed: number; max: number };
  outputVisibility: string;
  phase: string;
}): MissionConsoleVM {
  const events = input.events.map(sanitizeEvent);
  const complete = events.some((e) => /verified complete/i.test(e.primary));
  const panels: PanelVM[] = PANEL_ROLES.map((role) => {
    const own = roleEvents(events, role).slice(-4);
    const status = badgeFor(role, roleEvents(events, role), input.workforce.reviewer.configured);
    return {
      role,
      title: role === 'relay' ? 'RELAY SYSTEM' : ROLE_LABEL[role],
      badge: status.badge,
      statusRight: status.statusRight,
      statusTone: status.statusTone,
      events: role === 'reviewer' && own.length === 0
        ? [{ at: '', role: 'reviewer', symbol: 'review', primary: 'Independent review begins after Relay verification.' }]
        : own,
    };
  });
  const dogState = dogStateFrom(events);
  const last = events[events.length - 1];
  const handoff = events.length === 0 ? 'HANDOFF NETWORK / STANDBY'
    : complete ? 'HANDOFF NETWORK / COMPLETE'
      : last?.role === 'reviewer' ? 'HANDOFF NETWORK / REVIEWING'
        : last?.role === 'verification' ? 'HANDOFF NETWORK / VERIFYING'
          : 'HANDOFF NETWORK / ACTIVE';
  return {
    route: safeText(input.route, { maxLength: 24 }),
    projectName: safeText(input.projectName, { maxLength: 60 }),
    missionLabel: complete ? 'MISSION VERIFIED COMPLETE' : 'MISSION IN PROGRESS',
    live: !input.demo,
    demo: input.demo,
    view: input.view,
    workforce: input.workforce,
    phase: input.phase,
    outputVisibility: safeText(input.outputVisibility, { maxLength: 40 }),
    callBudget: input.callBudget,
    stream: events,
    panels,
    dog: { state: dogState, label: `RELAY DOG · ${dogState}` },
    commandHint: 'Ask Relay anything or run a command...',
    footer: {
      handoff,
      motto: FOOTER_MOTTO,
      systems: 'ALL SYSTEMS GO',
      systemsTone: 'green',
    },
  };
}

/* ------------------------------- home -------------------------------- */

const STATE_TONE: Record<string, Tone> = {
  verified_complete: 'green', in_progress: 'gold', waiting_for_user: 'amber',
  stopped_safely: 'coral', draft: 'gray', recovery_required: 'amber',
};

const STATE_LABEL: Record<string, string> = {
  verified_complete: 'VERIFIED COMPLETE', in_progress: 'IN PROGRESS',
  waiting_for_user: 'WAITING FOR USER', stopped_safely: 'STOPPED SAFELY', draft: 'DRAFT',
};

export function homeVM(input: {
  projects: ProjectDraft[];
  runs: RunIndexEntry[];
  selectedProject: ProjectDraft | null;
}): HomeVM {
  const recent = input.projects.slice(0, 6).map((p, i) => ({
    index: i + 1,
    reference: `RLY / ${String(i + 1).padStart(3, '0')}`,
    name: safeText(p.name, { maxLength: 48 }),
    state: STATE_LABEL[p.status] ?? p.status.toUpperCase(),
    stateTone: STATE_TONE[p.status] ?? 'cream',
    detail: safeText(`${p.mode} · ${p.codingAgent}${p.reviewer ? ` + ${p.reviewer}` : ''}`, { maxLength: 48 }),
  }));
  const recovering = input.runs.some((r) => r.recoveryRequired);
  return {
    route: 'RLY / HOME',
    projectLine: input.selectedProject ? safeText(input.selectedProject.name, { maxLength: 48 }) : 'No project selected',
    handoffNetwork: recovering ? 'Recovery available' : 'Standby',
    recent,
    routes: STARTING_ROUTES.map((label, i) => ({ index: i + 1, label })),
    commands: [
      { key: 'N', label: 'New project' },
      { key: 'O', label: 'Open project' },
      { key: 'C', label: 'Connect project' },
      { key: 'R', label: 'Recover run' },
      { key: 'Q', label: 'Quit' },
    ],
    demo: false,
  };
}

/* ---------------------------- project home ---------------------------- */

export const PHASES = ['PLAN', 'RESEARCH', 'BUILD', 'VERIFY', 'REVIEW', 'COMPLETE'];

export function researchState(draft: ProjectDraft): ResearchStateVM {
  switch (draft.researchPreference) {
    case 'not_configured': return 'RESEARCH NOT CONFIGURED';
    case 'monitoring': return 'RESEARCH MONITORING';
    case 'active': return 'RESEARCH ACTIVE';
    default: return 'RESEARCH NOT CONFIGURED';
  }
}

export function projectHomeVM(input: {
  draft: ProjectDraft;
  reference: string;
  phaseIndex: number;
  currentAction: string;
  outputVisibility: string;
  callBudget: { consumed: number; max: number };
}): ProjectHomeVM {
  const d = input.draft;
  return {
    route: safeText(input.reference, { maxLength: 24 }),
    name: safeText(d.name, { maxLength: 60 }),
    state: STATE_LABEL[d.status] ?? d.status.toUpperCase(),
    stateTone: STATE_TONE[d.status] ?? 'cream',
    mode: safeText(d.mode, { maxLength: 16 }),
    workforce: {
      architect: { name: safeText(d.architect, { maxLength: 32 }), online: true },
      coding: { name: safeText(d.codingAgent, { maxLength: 32 }), online: true },
      reviewer: { name: safeText(d.reviewer, { maxLength: 32 }), online: true, configured: d.reviewer !== '' },
      mode: safeText(d.mode, { maxLength: 16 }),
    },
    phaseRail: PHASES,
    phaseIndex: Math.max(0, Math.min(PHASES.length - 1, input.phaseIndex)),
    currentAction: safeSummary(input.currentAction),
    outputVisibility: safeText(input.outputVisibility, { maxLength: 40 }),
    callBudget: input.callBudget,
    research: researchState(d),
    actions: [
      { key: 'T', label: 'Live Terminal' }, { key: 'W', label: 'Workforce' },
      { key: 'R', label: 'Research' }, { key: 'M', label: 'Manual Tasks' },
      { key: 'F', label: 'Findings' }, { key: 'E', label: 'Evidence' },
      { key: 'S', label: 'Settings' }, { key: 'H', label: 'History' },
      { key: 'Q', label: 'Back' },
    ],
  };
}

/* ----------------------------- recovery ------------------------------- */

export function recoveryVM(report: RecoveryReport, projectName: string): RecoveryVM {
  const plan = report.plan;
  const state = report.loaded?.state ?? null;
  const lifecycleLabel = (state?.run.lifecycle ?? plan.lifecycle).replaceAll('_', ' ').toUpperCase();
  const workspaceLabel: Record<string, string> = {
    match: 'MATCHES PERSISTED REVISION', drift: 'DRIFTED FROM PERSISTED REVISION',
    missing: 'MISSING', source_changed: 'SOURCE REPOSITORY CHANGED', not_applicable: 'NOT APPLICABLE',
  };
  return {
    required: plan.lifecycle === 'recovery_required' || plan.outcome !== 'inspection_only',
    projectName: safeText(projectName, { maxLength: 48 }),
    interruptedPhase: lifecycleLabel,
    workspace: workspaceLabel[plan.workspaceReconciliation] ?? plan.workspaceReconciliation.toUpperCase(),
    evidence: plan.staleEvidenceIds.length > 0 ? `STALE (${plan.staleEvidenceIds.length})` : 'CURRENT',
    openFindings: plan.openFindingIds,
    repairs: plan.pendingRepairIds,
    sessions: Object.entries(plan.sessionReadiness).map(([provider, classification]) => ({
      provider: provider === 'claude' ? 'Claude' : 'Codex',
      classification: classification === 'persisted_unverified'
        ? 'reference persisted but unverified'
        : String(classification).replaceAll('_', ' '),
    })),
    callBudget: { consumed: plan.callBudget.consumed, max: plan.callBudget.maxCalls },
    nextAction: safeSummary(plan.nextPermittedActions[0] ?? 'founder decision required'),
    planOutcome: plan.outcome,
  };
}
