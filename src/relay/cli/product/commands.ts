import type { StateStore } from '../../persistence';
import { recoverRun } from '../../persistence';
import type { CliCaps, ProjectDraft } from './contracts';
import { homeVM, projectHomeVM, recoveryVM } from './projections';
import {
  renderEvidence, renderFinding, renderHeader, renderHome, renderManualTask,
  renderProjectHome, renderRecovery, renderRepair,
} from './renderer';
import { paint } from './theme';
import { safeText } from './safety';
import { renderStageView } from './stage';
import type { RelayStageActor } from '../../shared/relay-stage-layout';

/**
 * Relay CLI product commands (Prompt 8.6) — the NON-INTERACTIVE command
 * surface (`relay home`, `relay projects`, `relay project status`, …):
 * deterministic plain/JSON-safe output projected from canonical durable
 * state. No provider is ever called here; `relay project run` renders the
 * founder-confirmation screen and defers to the existing supervised
 * command for any live launch.
 */

export interface ProductCommandResult {
  lines: string[];
  json?: unknown;
  exitCode: number;
}

function loadProjects(store: StateStore): ProjectDraft[] {
  return store.listProjectRecords()
    .filter((r): r is Record<string, unknown> => typeof r.projectId === 'string' && typeof r.name === 'string')
    .map((r) => r as unknown as ProjectDraft)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function findProject(store: StateStore, reference: string | undefined): ProjectDraft | null {
  const projects = loadProjects(store);
  if (!reference) return projects[0] ?? null;
  const needle = reference.toLowerCase();
  return projects.find((p) => p.projectId.toLowerCase() === needle
    || p.projectId.toLowerCase() === `prj-${needle}`
    || p.name.toLowerCase() === needle) ?? null;
}

/** Resolve a `--project <ref>` / positional reference to a durable record so
 * `relay project open|terminal <ref>` can pre-select it in the shell. */
export function findProjectRecord(store: StateStore, reference: string | undefined): ProjectDraft | null {
  return findProject(store, reference);
}

/** Build the interactive shell's data from CANONICAL durable state — the
 * same store the browser app and engineering commands use. Findings/
 * repairs/evidence project from the most recent persisted run; no demo
 * fixture ever appears here. */
export function loadAppData(store: StateStore): import('./app').AppData {
  const projects = loadProjects(store);
  const runs = store.listRuns();
  const latest = runs[0] ? store.loadRun(runs[0].runId) : null;
  const state = latest && latest.ok ? latest.value.state : null;
  const recoveryRun = runs.find((r) => r.recoveryRequired);
  let recovery = null;
  if (recoveryRun) {
    const report = recoverRun({ store, reference: recoveryRun.runId, now: () => new Date().toISOString() });
    if (report.ok) recovery = recoveryVM(report.value, recoveryRun.displayName);
  }
  return {
    projects,
    events: [],
    tasks: [],
    findings: (state?.findings ?? []).map((f) => ({
      id: f.findingId, status: f.status.toUpperCase(), severity: f.severity.toUpperCase(),
      reviewer: 'CODEX', criteria: f.affectedCriterionIds, workspaceRevision: safeText(state?.workspace?.lastInspectedRevision ?? '-', { maxLength: 12 }),
      evidence: f.description, requiredAction: f.requiredAction, linkedRepair: f.repairTaskId,
    })),
    repairs: (state?.repairs ?? []).map((r) => ({
      id: r.repairId, findingId: r.findingId, status: r.status.toUpperCase(),
      requiredChanges: r.requiredChanges, authorizedFiles: r.affectedFiles,
    })),
    evidence: (state?.evidence ?? []).map((e) => ({
      id: e.evidenceId, type: e.evidenceType.toUpperCase(),
      status: (e.status === 'stale' ? 'STALE' : 'CURRENT') as 'CURRENT' | 'STALE',
      criteria: e.criterionIds, revision: safeText(e.workspaceRevision, { maxLength: 12 }),
      authority: e.verificationAuthority.toUpperCase(),
      result: e.exitStatus === 0 ? 'PASS' : e.exitStatus === null ? 'RECORDED' : 'FAIL',
      resultTone: (e.exitStatus === 0 ? 'green' : e.exitStatus === null ? 'gray' : 'coral') as 'green' | 'gray' | 'coral',
    })),
    recovery,
    demo: false,
  };
}

export function productHome(store: StateStore, caps: CliCaps): ProductCommandResult {
  const projects = loadProjects(store);
  const vm = homeVM({ projects, runs: store.listRuns(), selectedProject: null });
  return { lines: renderHome(vm, caps), json: vm, exitCode: 0 };
}

export function productProjects(store: StateStore, caps: CliCaps): ProductCommandResult {
  const p = paint(caps);
  const projects = loadProjects(store);
  const lines = [...renderHeader({ caps, route: 'RLY / PROJECTS', workforce: null, demo: false })];
  if (projects.length === 0) {
    lines.push(p.dim('No projects yet. Run `relay project new` in an interactive terminal.'));
  }
  projects.forEach((project, i) => {
    lines.push(`  ${p.dim(String(i + 1).padStart(2, '0'))}  ${p.tone('cream', safeText(project.name, { maxLength: 48 }))}`
      + `  ${p.dim(String(project.status).toUpperCase())}`);
  });
  return {
    lines,
    json: { projects: projects.map((project) => ({ projectId: project.projectId, name: project.name, status: project.status })) },
    exitCode: 0,
  };
}

export function productProjectStatus(store: StateStore, caps: CliCaps, reference?: string): ProductCommandResult {
  const project = findProject(store, reference);
  if (!project) {
    return { lines: ['No project found. Run `relay project new` first.'], json: { error: 'not-found' }, exitCode: 4 };
  }
  const vm = projectHomeVM({
    draft: project, reference: 'RLY / 001',
    phaseIndex: project.status === 'verified_complete' ? 5 : project.status === 'draft' ? 0 : 2,
    currentAction: project.status === 'draft' ? 'Draft saved. No mission started.' : 'See `relay runs list` for run state.',
    outputVisibility: project.status === 'draft' ? 'NOT STARTED' : 'SEE RUN',
    callBudget: { consumed: 0, max: project.callLimit },
  });
  return { lines: renderProjectHome(vm, caps), json: vm, exitCode: 0 };
}

/**
 * The cast the CLI knows about — one actor, for the same reason the website
 * has one: the Relay Dog is the only agent with artwork and a state model.
 * Naming a Leopard here would be inventing a cast.
 */
const RELAY_CLI_STAGE_CAST: readonly RelayStageActor[] = Object.freeze([
  Object.freeze({
    id: 'relay-dog', x: 0.5, depth: 1, width: 1, track: 6, layer: 'actors' as const,
  }),
]);

export type ProjectView =
  | 'tasks' | 'findings' | 'repairs' | 'evidence' | 'history' | 'settings' | 'workforce'
  | 'research' | 'stage';

const VIEW_ROUTE: Record<ProjectView, string> = {
  tasks: 'RLY / TASKS', findings: 'RLY / FINDINGS', repairs: 'RLY / FINDINGS',
  evidence: 'RLY / EVIDENCE', history: 'RLY / HISTORY', settings: 'RLY / SETTINGS',
  workforce: 'RLY / WORKFORCE', research: 'RLY / RESEARCH', stage: 'RLY / STAGE',
};

/** Non-interactive project sub-surfaces (`relay project findings|tasks|
 * evidence|history|settings|workforce|research`). Each renders its OWN
 * canonical content projected from the latest persisted run — never the
 * generic status screen — so a piped/CI reader and `--json` see real data. */
export function productProjectView(
  store: StateStore, caps: CliCaps, view: ProjectView, reference?: string,
): ProductCommandResult {
  const p = paint(caps);
  const project = findProject(store, reference);
  if (!project) {
    return { lines: ['No project found. Run `relay project new` first.'], json: { error: 'not-found' }, exitCode: 4 };
  }
  const data = loadAppData(store);
  const lines = [...renderHeader({
    caps, route: VIEW_ROUTE[view], workforce: null, demo: false,
    subtitle: `PROJECT / ${safeText(project.name, { maxLength: 60 })}`,
  })];
  let json: unknown = {};

  switch (view) {
    case 'findings':
    case 'repairs': {
      if (data.findings.length === 0 && data.repairs.length === 0) {
        lines.push(p.dim('No findings recorded for the latest run.'));
      }
      for (const f of data.findings) lines.push(...renderFinding(f, caps));
      for (const r of data.repairs) lines.push(...renderRepair(r, caps));
      json = { findings: data.findings, repairs: data.repairs };
      break;
    }
    case 'evidence': {
      if (data.evidence.length === 0) lines.push(p.dim('No evidence recorded for the latest run.'));
      else lines.push(...renderEvidence(data.evidence, caps));
      json = { evidence: data.evidence };
      break;
    }
    case 'tasks': {
      if (data.tasks.length === 0) {
        lines.push(p.dim('No manual tasks. Relay has not needed your input on the latest run.'));
      }
      for (const t of data.tasks) lines.push(...renderManualTask(t, caps));
      json = { tasks: data.tasks };
      break;
    }
    case 'history': {
      if (data.events.length === 0) {
        lines.push(p.dim('No mission history yet. Live events stream into the console once a supervised run is wired in.'));
      }
      for (const e of data.events) {
        lines.push(`  ${p.dim(safeText(e.at, { maxLength: 8 }))}  ${p.tone('cream', safeText(e.primary, { maxLength: 200 }))}`);
      }
      json = { events: data.events };
      break;
    }
    case 'workforce': {
      lines.push(
        `  ${p.dim('PROMPT ARCHITECT'.padEnd(18))} ${p.tone('cream', safeText(project.architect, { maxLength: 40 }))}`,
        `  ${p.dim('CODING AGENT'.padEnd(18))} ${p.tone('cream', safeText(project.codingAgent, { maxLength: 40 }))}`,
        `  ${p.dim('REVIEWER'.padEnd(18))} ${project.reviewer ? p.tone('cyan', safeText(project.reviewer, { maxLength: 40 })) : p.dim('NOT CONFIGURED')}`,
        `  ${p.dim('MODE'.padEnd(18))} ${p.tone('gold', safeText(project.mode, { maxLength: 20 }))}`,
      );
      json = { architect: project.architect, codingAgent: project.codingAgent, reviewer: project.reviewer, mode: project.mode };
      break;
    }
    case 'research': {
      const label = project.researchPreference === 'active' ? 'RESEARCH ACTIVE'
        : project.researchPreference === 'monitoring' ? 'RESEARCH MONITORING' : 'RESEARCH NOT CONFIGURED';
      lines.push(
        `  ${p.dim('STATUS'.padEnd(18))} ${p.tone(label === 'RESEARCH NOT CONFIGURED' ? 'gray' : 'amber', label)}`, '',
        p.dim('The Prompt Architect researches only approved topics; new knowledge requires your approval before it enters the Project Brain.'),
      );
      json = { research: label };
      break;
    }
    case 'stage': {
      // The SAME projection the website renders. A terminal cannot draw the
      // stage; it can answer every question the stage answers.
      const view = renderStageView({
        caps,
        actors: RELAY_CLI_STAGE_CAST,
        selectedBackdrop: project.stageBackdrop,
      });
      lines.push(...view.lines);
      json = view.json;
      break;
    }
    case 'settings':
    default: {
      const kv = (k: string, value: string): string => `  ${p.dim(k.padEnd(20))} ${p.tone('cream', safeText(value, { maxLength: 200 }))}`;
      lines.push(
        kv('Name', project.name), kv('Type', project.projectType),
        kv('Objective', project.objective || '-'), kv('Repository', project.repositoryPath ?? '-'),
        kv('Stack', project.stack.join(', ') || '-'), kv('Protected areas', project.protectedAreas.join(', ') || '-'),
        kv('Production impact', project.productionImpact), kv('Runtime limit', `${project.runtimeLimitMinutes} min`),
        kv('Call limit', String(project.callLimit)), kv('Review limit', String(project.reviewLimit)),
        kv('Repair limit', String(project.repairLimit)),
      );
      json = project;
      break;
    }
  }
  return { lines, json, exitCode: 0 };
}

export function productRecover(store: StateStore, caps: CliCaps, runRef: string | undefined): ProductCommandResult {
  const p = paint(caps);
  if (!runRef) {
    const runs = store.listRuns();
    const needing = runs.filter((r) => r.recoveryRequired);
    const lines = [...renderHeader({ caps, route: 'RLY / RECOVER', workforce: null, demo: false })];
    if (runs.length === 0) lines.push(p.dim('No persisted runs. Nothing to recover.'));
    else if (needing.length === 0) lines.push(p.dim('No run requires recovery.'));
    for (const run of needing) {
      lines.push(`  ${p.tone('amber', 'RECOVERY REQUIRED')}  ${p.tone('cream', run.displayName)}  ${p.dim(run.runId)}`);
    }
    if (needing.length > 0) lines.push('', p.dim('Run `relay recover <run-reference>` to validate and plan (zero provider calls).'));
    return { lines, json: { runsNeedingRecovery: needing.map((r) => r.runId) }, exitCode: 0 };
  }
  const report = recoverRun({ store, reference: runRef, now: () => new Date().toISOString(), persistMarkers: true });
  if (!report.ok) return { lines: [report.error.message], json: { error: report.error.message }, exitCode: 8 };
  const projectName = report.value.loaded?.state?.project.displayName
    || report.value.loaded?.metadata.displayName || runRef;
  const vm = recoveryVM(report.value, projectName);
  return {
    lines: [...renderHeader({ caps, route: 'RLY / RECOVER', workforce: null, demo: false }), ...renderRecovery(vm, caps)],
    json: vm,
    exitCode: report.value.plan.outcome === 'unrecoverable' ? 8 : 0,
  };
}

/** The founder-confirmation screen for `relay project run`. NEVER launches
 * anything itself — it points at the existing founder-confirmed supervised
 * command, which owns prerequisites and `--confirm-live`. */
export function productRunConfirmation(store: StateStore, caps: CliCaps, reference?: string): ProductCommandResult {
  const p = paint(caps);
  const project = findProject(store, reference);
  const kv = (k: string, value: string): string => `${p.dim(k)}\n  ${p.tone('cream', value)}`;
  const lines = [
    ...renderHeader({ caps, route: 'RLY / RUN', workforce: null, demo: false }),
    p.boldTone('gold', 'LIVE SUPERVISED RELAY WORKFLOW'), '',
    kv('Project:', safeText(project?.name ?? 'No project selected', { maxLength: 60 })),
    kv('Prompt Architect:', safeText(project?.architect ?? 'Sunday Alcatraz', { maxLength: 40 })),
    kv('Coding Agent:', safeText(project?.codingAgent ?? 'Claude Code', { maxLength: 40 })),
    kv('Reviewer:', safeText(project?.reviewer ?? 'Codex', { maxLength: 40 })),
    kv('Mode:', safeText(project?.mode ?? 'Guided', { maxLength: 20 })),
    kv('Expected minimum calls:', '2'),
    kv('Maximum calls:', String(project?.callLimit ?? 4)),
    kv('Automatic retries:', 'Disabled'),
    kv('Fallback:', 'Disabled'),
    kv('Deployment:', 'Disabled unless explicitly configured'),
    kv('Source repository:', 'Protected'),
    '',
    p.tone('amber', 'Explicit founder confirmation is required for any live call.'),
    p.dim('To proceed: npm run relay:supervised:live   (relay supervised run --fixture safe-edit --confirm-live)'),
    p.dim('No provider was called by this screen.'),
  ];
  return { lines, json: { confirmed: false, next: 'relay supervised run --confirm-live' }, exitCode: 5 };
}
