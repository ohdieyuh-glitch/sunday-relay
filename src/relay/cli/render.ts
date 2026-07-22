import type { RelayApp } from '../core/app';

/**
 * Relay CLI rendering (Prompt 5) — UI_VISION-aligned: calm, terminal-first,
 * restrained gold, honest badges. Works fully without ANSI color and without
 * Unicode (ASCII fallback). Never renders hidden reasoning, secrets, full
 * artifacts, or claims of real execution during simulation.
 */

export interface RenderOptions {
  color: boolean;
  mascot: boolean;
  plain: boolean;
  json: boolean;
  width: number;
}

export function detectRenderOptions(argv: { json?: boolean; 'no-color'?: boolean; plain?: boolean; quiet?: boolean }, env: NodeJS.ProcessEnv, isTTY: boolean): RenderOptions {
  const noColor = argv['no-color'] === true || env.NO_COLOR !== undefined || !isTTY || argv.json === true || argv.plain === true;
  return {
    color: !noColor,
    mascot: isTTY && argv.json !== true && argv.plain !== true,
    plain: argv.plain === true,
    json: argv.json === true,
    width: Math.max(40, Math.min(120, (process.stdout.columns ?? 80) as number)),
  };
}

const GOLD = '[33m';
const DIM = '[2m';
const BOLD = '[1m';
const RESET = '[0m';

export const style = (opts: RenderOptions) => ({
  gold: (s: string) => (opts.color ? `${GOLD}${s}${RESET}` : s),
  dim: (s: string) => (opts.color ? `${DIM}${s}${RESET}` : s),
  bold: (s: string) => (opts.color ? `${BOLD}${s}${RESET}` : s),
});

/* ----- mascot: compact pixel dog, ASCII-safe, optional ----- */

export const MASCOT_STATES: Record<string, string> = {
  created: 'LISTENING',
  'active:blueprint': 'ARCHITECT WORKING',
  'active:handoff': 'CARRYING HANDOFF',
  'active:implementation': 'AGENT WORKING',
  'active:repair': 'AGENT WORKING',
  'active:verification': 'VERIFYING',
  'active:final_verification': 'VERIFYING',
  'active:review': 'WAITING',
  'active:final_review': 'WAITING',
  'active:audit': 'VERIFYING',
  paused: 'WAITING',
  checkpoint_required: 'CHECKPOINT',
  completed: 'COMPLETE',
  failed: 'STOPPED SAFELY',
  cancelled: 'STOPPED SAFELY',
};

export function mascot(stateLabel: string, opts: RenderOptions): string[] {
  if (!opts.mascot) return [];
  const s = style(opts);
  return [
    s.dim(' |\\_/|'),
    s.dim(' (o.o)  ' + s.gold(`RELAY DOG - ${stateLabel}`)),
    s.dim(' /| |\\'),
  ];
}

export function mascotStateFor(status: string, phase: string): string {
  return MASCOT_STATES[`${status}:${phase}`] ?? MASCOT_STATES[status] ?? 'LISTENING';
}

/* ----- banner ----- */

export function welcome(opts: RenderOptions, scenarioName: string): string[] {
  const s = style(opts);
  return [
    '',
    `${s.bold('SUNDAY RELAY')}  ${s.dim('RLY / 001')}`,
    s.dim('Pass the work. Keep the context.'),
    '',
    `${badge('SIMULATED')}  scenario: ${scenarioName}`,
    'SESSION STORAGE: VOLATILE (state lives only while this process runs)',
    'This run demonstrates Relay orchestration using simulated agent execution.',
    'No repository files will be modified.',
    '',
  ];
}

export const badge = (label: string) => `[${label}]`;

/* ----- events ----- */

const SOURCE_LABEL: Record<string, string> = {
  'relay-core': 'RELAY', architect: 'ARCHITECT', 'coding-agent': 'AGENT',
  reviewer: 'REVIEW', verification: 'VERIFY', system: 'SYSTEM', user: 'USER',
};

export function renderEvent(e: { at: string; source: string; safeSummary: string; provenance: string }, opts: RenderOptions): string {
  const s = style(opts);
  const time = e.at.slice(11, 19);
  const source = (SOURCE_LABEL[e.source] ?? e.source.toUpperCase()).padEnd(10);
  const sim = e.provenance === 'simulated' ? `${badge('SIMULATED')} ` : e.provenance === 'manual' ? '' : `[${e.provenance.toUpperCase()}] `;
  return `${s.dim(`[${time}]`)} ${s.gold(source)} ${sim}${e.safeSummary}`;
}

/* ----- read-model views (each returns plain lines) ----- */

type App = RelayApp;

const kv = (k: string, v: unknown) => `  ${k.padEnd(18)} ${v === null || v === undefined ? '-' : String(v)}`;

export function renderStatus(app: App): string[] {
  const v = app.status();
  if (!v) return ['No run yet.'];
  return [
    'STATUS',
    kv('run', v.runId), kv('objective', v.objective), kv('status', v.status), kv('phase', v.phase),
    kv('mode', v.mode), kv('provenance', `${v.provenanceProfile} ${badge('SIMULATED')}`),
    kv('task', v.taskId), kv('owner', v.owner?.adapterId ?? null), kv('repairs', `${v.repairCount}/1`),
    kv('ledger version', v.ledgerVersion), kv('context version', v.contextVersion), kv('base revision', v.baseRevision),
    kv('checkpoint', v.checkpoint ? v.checkpoint.reason : null),
    kv('budget', v.budget.maxUsd !== null ? `$${v.budget.usedUsd.toFixed(2)} used / $${(v.budget.remainingUsd ?? 0).toFixed(2)} remaining (simulated)` : 'none'),
    kv('storage', `${v.storageProfile} (VOLATILE)`),
    kv('latest', v.latestEvent),
  ];
}

export function renderBrain(app: App): string[] {
  const v = app.brain();
  if (!v) return ['No run yet.'];
  const lines = [
    'PROJECT BRAIN',
    kv('objective', `${v.objective.value} [CANONICAL]`),
    kv('run state', v.runStatus),
    kv('ledger version', v.ledgerVersion),
    kv('accepted blueprint', v.acceptedBlueprintId ?? '- [PENDING]'),
  ];
  for (const c of v.claims) lines.push(kv(`claim ${c.claimId.slice(0, 12)}…`, `[${c.label}]`));
  lines.push(kv('verified evidence', v.verifiedEvidenceRefs.length ? v.verifiedEvidenceRefs.join(', ') : 'none yet'));
  return lines;
}

export function renderTask(app: App): string[] {
  const v = app.task();
  if (!v) return ['No task yet.'];
  return [
    'TASK & OWNERSHIP',
    kv('task', v.taskId), kv('objective', v.objective), kv('status', v.status), kv('owner', v.owner),
    kv('lease expires', v.leaseExpiresAt), kv('context version', v.contextVersion), kv('base revision', v.baseRevision),
    kv('claimed files', v.claimedFiles.map((c) => `${c.path} (${c.mode}, ${c.status})`).join('; ') || 'none'),
    kv('dependencies', v.dependencies.join(', ') || 'none'),
    kv('acceptance', v.acceptanceCriteria.join(' · ')),
    ...v.ownershipHistory.map((h) => kv('history', `${h.adapterId} (${h.role})${h.endReason ? ` → ${h.endReason}` : ''}`)),
  ];
}

export function renderBlueprint(app: App): string[] {
  const v = app.blueprint();
  if (!v) return ['No blueprint yet.'];
  return [
    'BLUEPRINT',
    kv('id', v.blueprintId), kv('version', v.version), kv('architect', `${v.architect} ${badge('SIMULATED')}`),
    kv('approval', v.approvalStatus === 'accepted' ? 'accepted' : 'AWAITING APPROVAL (/approve or /reject <reason>)'),
    kv('restated', v.content.objectiveRestatement),
    kv('approach', v.content.approach),
    kv('tasks', v.content.taskBreakdown.join('; ')),
    kv('acceptance', v.content.acceptanceCriteria.join('; ')),
    kv('risks', v.content.risks.join('; ') || 'none listed'),
  ];
}

export function renderHandoff(app: App): string[] {
  const v = app.handoff();
  if (!v) return ['No handoff compiled yet.'];
  const enforcement = (r: { value: string; enforcement: string }) => `${r.value} [${r.enforcement.toUpperCase()}]`;
  return [
    'HANDOFF PACKAGE',
    kv('package', v.packageId), kv('role', v.role), kv('target', v.targetAdapterId),
    kv('boundary', v.responsibilityBoundary),
    kv('pins', `ledger v${v.ledgerVersion} · context v${v.contextVersion} · ${v.baseRevision}`),
    kv('context refs', v.contextRefs.join(', ') || 'none'),
    kv('allowed files', v.permittedFiles.map(enforcement).join('; ') || 'none'),
    kv('prohibited', v.prohibitedActions.map(enforcement).join('; ') || 'none'),
    kv('required evidence', v.requiredEvidence.join('; ')),
    kv('stopping', v.stoppingCondition.description),
  ];
}

export function renderEvidence(app: App): string[] {
  const records = app.evidence();
  if (records.length === 0) return ['No evidence yet.'];
  return [
    'EVIDENCE (Relay-produced; simulated — no real commands were executed)',
    ...records.map((e) =>
      `  ${badge(e.status.toUpperCase())} ${badge('SIMULATED')} ${e.command ?? e.type}  exit=${e.exitCode ?? '-'}  rev=${e.repoRevision}  verifier=${e.verifier}`,
    ),
  ];
}

export function renderReview(app: App): string[] {
  const reviews = app.review();
  if (reviews.length === 0) return ['No review yet.'];
  const lines = ['INDEPENDENT REVIEW'];
  for (const r of reviews) {
    lines.push(kv(`attempt ${r.attempt}`, `${r.reviewer} ${badge('SIMULATED')} · independent=${r.independent} · ${r.verdict}`));
    for (const f of r.findings) lines.push(`    - ${f.id} [${f.severity}] ${f.title}: ${f.detail}`);
  }
  return lines;
}

export function renderUsage(app: App): string[] {
  const v = app.usage();
  if (!v) return ['No usage yet.'];
  return [
    'USAGE (SIMULATED — never provider-billed)',
    kv('simulated actual', `$${v.simulatedActual.usd.toFixed(2)} · ${v.simulatedActual.tokens} tokens`),
    kv('estimated', `$${v.estimated.usd.toFixed(2)} · ${v.estimated.tokens} tokens`),
    kv('budget ceiling', v.budget?.maxUsd !== null && v.budget ? `$${v.budget.maxUsd}` : 'none'),
    ...v.records.map((r) => kv(r.adapterId, `${r.kind} $${r.usd ?? 0} (${r.note})`)),
  ];
}

export function renderCheckpoint(app: App): string[] {
  const v = app.status();
  if (!v?.checkpoint) return ['No checkpoint pending.'];
  return [
    'CHECKPOINT REQUIRED',
    '',
    `Reason:`,
    `  ${v.checkpoint.reason}`,
    '',
    'Automatic work has stopped.',
    'Options: /approve · /reject <reason> · /cancel',
    kv('checkpoint', v.checkpoint.checkpointId),
    kv('task', v.taskId), kv('owner', v.owner?.adapterId ?? null),
    kv('responded', v.checkpoint.respondedAt ?? 'awaiting decision'),
  ];
}

/** Wrap text at a terminal-safe width (80-column recordings never clip). */
const wrapText = (text: string, width = 78): string[] => {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > width) {
      lines.push(current.trim());
      current = word;
    } else current = `${current} ${word}`;
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
};

/** Manual Task screen (Prompt 6.1). Pure presentation of the read model —
 * the CLI never decides safety, verification, or resume. Simple enough to
 * follow without knowing any command. */
export function renderManualTask(app: App): string[] {
  const v = app.manualTask();
  if (!v) return ['No manual task pending.'];
  const lines: string[] = [
    'MANUAL TASK',
    '',
    'Relay needs your help.',
    '',
    `${v.title}`,
    '',
    'Why Relay stopped:',
    ...wrapText(v.whyRelayStopped).map((l) => `  ${l}`),
  ];
  const active = ['pending', 'user_marked_done', 'needs_more_information'].includes(v.status);
  if (active) lines.push('  The run is stopped safely.');
  lines.push('', 'Do this:', '');
  v.steps.forEach((step: string, i: number) => lines.push(`  ${i + 1}. ${step}`));
  if (v.securityNotice) {
    lines.push('', 'Security note:', ...wrapText(v.securityNotice).map((l) => `  ${l}`));
  }
  lines.push('', 'What Relay will do next:', ...wrapText(v.whatRelayWillDoNext).map((l) => `  ${l}`));
  if (v.verification.lastOutcome === 'failed') {
    lines.push('', '  Relay could not confirm the result yet.', '  Try the steps again, then choose Done.');
  }
  if (v.verification.operatorConfirmationRequired) {
    lines.push('', '  Relay cannot check this automatically.', '  Confirm what changed with /approve to continue.');
  }
  if (v.status === 'cannot_complete') {
    lines.push('', '  You said you cannot do this. The work is stopped safely.', '  Options: /approve to close it, or /cancel to stop the run.');
  }
  if (v.status === 'completed') {
    lines.push('', `${badge('PASS')} This manual task is complete.`);
  }
  if (v.availableResponses.includes('done')) {
    lines.push(
      '',
      'Choose:',
      '',
      '  [D] Done',
      '  [H] I need help',
      '  [N] I cannot do this',
      '  [C] Cancel run',
    );
  }
  return lines;
}

/** Deterministic simpler guidance for "I need help" — compiled by Relay
 * Core into the read model; the CLI only displays it. */
export function renderManualTaskHelp(app: App): string[] {
  const v = app.manualTask();
  if (!v) return ['No manual task pending.'];
  return ['HELP', '', ...v.helpText.map((l: string) => `  ${l}`), '', 'The run stays safely stopped while you decide.'];
}

export function renderAudit(app: App): string[] {
  const v = app.audit();
  if (!v) return ['No final audit yet (the run has not completed).'];
  return [
    'FINAL AUDIT REPORT',
    kv('outcome', v.outcome), kv('objective', v.objective),
    kv('provenance', `${v.provenanceProfile} ${badge('SIMULATED')}`),
    kv('notice', v.simulationNotice ?? '-'),
    kv('architect', v.identities?.architect), kv('coding agent', v.identities?.codingAgent),
    kv('reviewer', v.identities?.reviewer), kv('repairs', `${v.repairCount}/1`),
    kv('verifications', v.verificationRefs.length), kv('reviews', v.reviewRefs.length),
    kv('claim promotions', (v.claimPromotions ?? []).map((p) => `${p.claimId.slice(0, 10)}…=${p.decision}`).join(', ') || 'none'),
    kv('usage', `$${(v.usageSummary.actualUsd ?? 0).toFixed(2)} simulated`),
    kv('completion', v.completionReason ?? '-'),
    kv('ledger version', v.ledgerVersion), kv('audited at', v.at),
  ];
}
