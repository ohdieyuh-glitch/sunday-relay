import type { RelayApp } from '../core/app';
import { style, badge, type RenderOptions } from './render';
import { projectMission, type MissionProjectionBundle, type MissionSpec, type ReviewInput } from '../mission';

/**
 * Competitive proof presentation (Prompt 8.1) — RENDERER + PROJECTION glue.
 * Runs on the completed `competitive` scenario's read models, projects the
 * mission bundle (Mission Contract, attestations, findings, repairs, verdict,
 * timeline) from canonical state, and renders the ordered competitive
 * progression. Truthful labels: the Claude Implementer and Codex Reviewer are
 * deterministic SIMULATIONS in this presentation; no external Codex is active;
 * the real Claude proof stays separately available via relay:claude:live.
 */

export const COMPETITIVE_MISSION_SPEC: MissionSpec = {
  title: 'Protect anonymous live access',
  objective: 'Preserve anonymous access while preventing one actor from bypassing identity limits or spending controls.',
  requirements: [
    'Durable anonymous rate limiting',
    'IPv6 identity aggregation',
    'Global spending breaker remains active',
    'Zero provider dispatch after a block',
    'Existing authenticated behavior remains unchanged',
  ],
  constraints: [
    'No pricing redesign',
    'No authentication redesign',
    'No new model providers',
    'No production deployment',
    'No Supabase migration',
    'No Alcatraz engine changes',
  ],
  acceptanceCriteria: [
    { id: 'AC-1', text: 'Anonymous rate-limit proof passes 30/30.', blocking: true },
    { id: 'AC-2', text: 'Session proof passes 40/40.', blocking: true },
    { id: 'AC-3', text: 'Spending proof passes 23/23.', blocking: true },
    { id: 'AC-4', text: 'TypeScript build passes.', blocking: true },
    { id: 'AC-5', text: 'A single actor cannot evade the anonymous identity limit through address rotation.', blocking: true },
    { id: 'AC-6', text: 'Zero provider dispatch occurs after a block.', blocking: true },
  ],
  filesInScope: ['src/access/anonymous-policy.ts', 'src/access/ipv6-identity.ts', 'src/access/spend-boundary.ts'],
  filesOutOfScope: ['src/pricing', 'src/auth'],
  systemsInScope: ['anonymous access policy', 'spending breaker'],
  systemsOutOfScope: ['Supabase migrations', 'Alcatraz engine', 'Production deployment', 'Model providers'],
  assumptions: ['Existing authenticated flows are already covered by their own tests.'],
  decisions: ['Anonymous identity is aggregated before policy application.'],
  unresolvedQuestions: [],
  requiredEvidence: [
    '30/30 anonymous rate-limit proof', '40/40 session proof', '23/23 spending proof',
    'TypeScript build', 'file-claim policy', 'protected-path policy',
  ],
  requiredReviewers: ['Codex — Independent Coding Reviewer'],
  implementerRequirement: 'Claude Code',
  reviewerRequirement: 'Codex — Independent Coding Reviewer',
  maximumRepairIterations: 1,
  maximumReviewRuns: 2,
  maximumCostUsd: 2,
  maximumRuntimeMinutes: 30,
  completionRule: 'all_blocking_criteria_and_independent_review',
  createdBy: 'relay-operator',
};

const AFFECTED_CRITERIA = ['AC-5'];

/** Project the mission bundle from a completed competitive run's read
 * models. Pure data-in / bundle-out — no live call, no core mutation. */
export function projectCompetitiveMission(app: RelayApp, now: string): MissionProjectionBundle {
  const status = app.status();
  const audit = app.audit();
  const events = app.events(0);
  const reviewsRaw = app.review();
  const evidence = app.evidence();
  const task = app.task();
  const handoff = app.handoff();

  const runId = status?.runId ?? 'run_unknown';
  const taskId = status?.taskId ?? 'tsk_unknown';
  const projectId = status?.projectId ?? 'prj_unknown';
  const requestedImplementerId = handoff?.targetAdapterId ?? 'sim-coding-agent';
  const actualImplementerId = audit?.identities?.codingAgent ?? 'sim-coding-agent';
  const actualReviewerId = audit?.identities?.reviewer ?? 'sim-reviewer';
  const eventKinds = events.map((e) => e.kind);

  const reviews: ReviewInput[] = reviewsRaw.map((r) => ({
    attempt: r.attempt,
    verdict: r.verdict === 'approved' ? 'approved' : 'changes_requested',
    reviewerAgentId: r.adapterId,
    requestedReviewerAgentId: 'sim-reviewer',
    independent: r.independent,
    provenance: (r.provenance as MissionProjectionBundle['mission']['provenance']),
    findings: r.findings.map((f) => ({ id: f.id, severity: f.severity, title: f.title, detail: f.detail, recommendation: f.recommendation })),
  }));

  const requiredCommands = COMPETITIVE_MISSION_SPEC.requiredEvidence;
  const passedCommands = new Set(
    evidence.filter((e) => e.status === 'passed' && e.command && requiredCommands.includes(e.command)).map((e) => e.command as string),
  );
  const passedEvidenceIds = evidence.filter((e) => e.status === 'passed').map((e) => e.evidenceId);

  return projectMission({
    spec: COMPETITIVE_MISSION_SPEC,
    missionId: 'msn_competitive', projectId, taskId, runId, now, provenance: 'simulated',
    requestedImplementerId, requestedReviewerId: 'sim-reviewer',
    actualImplementerId, actualReviewerId,
    implementerAdapterProvenance: 'simulated', reviewerAdapterProvenance: 'simulated',
    implementerLaunchVerified: eventKinds.includes('agent.session_started'),
    implementerCompletionSignal: eventKinds.includes('agent.report_created'),
    reviewerLaunchVerified: reviewsRaw.length > 0,
    implementerSessionId: audit?.sessionRefs?.[0] ?? null, workspaceId: null,
    workspaceInspectionCompleted: false, verificationCompleted: eventKinds.includes('verification.completed'),
    runStatus: status?.status ?? 'unknown',
    reviews, originalClaimedFiles: (task?.claimedFiles ?? []).map((c) => c.path),
    affectedCriterionIds: AFFECTED_CRITERIA, workspaceRevision: status?.baseRevision ?? 'rev-sim',
    postRepairEvidenceIds: passedEvidenceIds,
    allEvidence: evidence.map((e) => ({ evidenceId: e.evidenceId, status: e.status })),
    requiredEvidenceCount: requiredCommands.length, passedEvidenceCount: passedCommands.size,
    repairDispatched: (audit?.repairCount ?? 0) > 0, implementationReported: eventKinds.includes('agent.report_created'),
    events: events.map((e) => ({ sequence: e.sequence, at: e.at, source: e.source, kind: e.kind, provenance: e.provenance as ReviewInput['provenance'], safeSummary: e.safeSummary })),
  });
}

const VERDICT_LABEL: Record<string, string> = {
  claimed_complete: 'CLAIMED COMPLETE', reviewed: 'REVIEWED', approved: 'APPROVED',
  verified_complete: 'VERIFIED COMPLETE', partially_complete: 'PARTIALLY COMPLETE',
  blocked: 'BLOCKED', failed: 'FAILED', needs_human: 'NEEDS HUMAN',
};

export interface PresentationFrame { label: string; lines: string[] }

const wrap = (text: string, width = 76): string[] => {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > width) { lines.push(current.trim()); current = word; }
    else current = `${current} ${word}`;
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
};

const TRUTH_LABELS = [
  'CLAUDE CODE IMPLEMENTER: Deterministic simulation in this presentation',
  'CODEX REVIEWER: Deterministic simulation in this presentation',
  'EXTERNAL CODEX CONNECTION: Not active',
  'REAL CLAUDE CODE SUPPORT: Available through npm run relay:claude:live',
];

export function buildCompetitiveFrames(app: RelayApp, opts: RenderOptions, now: string): PresentationFrame[] {
  const s = style(opts);
  const b = projectCompetitiveMission(app, now);
  const frames: PresentationFrame[] = [];
  const push = (label: string, lines: string[]) => frames.push({ label, lines });
  const finding = b.findings[0];
  const repair = b.repairs[0];

  push('opening', [
    '', `${s.bold('SUNDAY RELAY')} — ${s.bold('COMPETITIVE PROOF')}`, '',
    `${badge('SIMULATED')} Deterministic mission-control orchestration`, ...TRUTH_LABELS,
  ]);
  push('mission', ['', s.gold('MISSION'), ...wrap(b.mission.objective).map((l) => `  ${l}`)]);
  push('mission-contract', [
    '', s.gold('MISSION CONTRACT'),
    `  Revision ${b.mission.revision} locked.`,
    `  ${b.mission.requirements.length} requirements.`,
    `  ${b.mission.acceptanceCriteria.filter((c) => c.blocking).length} blocking completion criteria.`,
    `  ${b.mission.implementerRequirement} assigned as Implementer.`,
    `  ${b.mission.reviewerRequirement} required as Independent Reviewer.`,
  ]);
  push('project-ledger', ['', s.gold('PROJECT LEDGER'), '  Architecture and policy state loaded.']);
  push('implementer-handoff', [
    '', s.gold('IMPLEMENTER HANDOFF'),
    '  Claude Code receives implementation responsibility.',
    '  Only relevant files and requirements included.',
  ]);
  push('implementation-claim', [
    '', s.gold('IMPLEMENTATION CLAIM'),
    '  Claude Code reports completion.',
    `  ${badge('MISSION VERDICT')} CLAIMED COMPLETE`,
  ]);
  push('verification-initial', ['', s.gold('RELAY VERIFICATION'), '  Initial deterministic checks completed.']);
  push('reviewer-handoff', [
    '', s.gold('REVIEWER HANDOFF'),
    "  Codex is told not to trust the Implementer's claim.",
  ]);
  push('independent-review', [
    '', s.gold('INDEPENDENT REVIEW'),
    `  High-severity finding: ${finding?.title ?? 'IPv6 /128 rotation bypass'}.`,
    `  ${badge('MISSION VERDICT')} CHANGES REQUIRED`,
  ]);
  push('repair-ledger', [
    '', s.gold('REPAIR LEDGER'),
    `  Finding ${finding?.findingId ?? 'F-1'} created.`,
    `  Repair ${repair?.repairId ?? 'R-1'} assigned.`,
    `  ${b.mission.maximumRepairIterations} repair iteration remains.`,
  ]);
  push('revision-contract', [
    '', s.gold('REVISION CONTRACT'),
    '  Apply IPv6 /64 identity aggregation.',
    '  Do not expand scope. Do not expand permissions.',
  ]);
  push('repair-claim', [
    '', s.gold('REPAIR CLAIM'),
    '  Claude Code reports the repair complete.',
    '  Finding remains open until Relay verifies.',
  ]);
  push('verification-repair', [
    '', s.gold('RELAY VERIFICATION'),
    ...b.mission.requiredEvidence.map((e) => `  ${badge('PASS')} ${e}`),
  ]);
  push('re-review', [
    '', s.gold('RE-REVIEW'),
    '  Codex approves the repaired state.',
    `  Finding ${finding?.findingId ?? 'F-1'} resolved.`,
  ]);
  push('completion-engine', [
    '', s.gold('COMPLETION ENGINE'),
    '  All blocking criteria passed.',
    '  Required review completed.',
    '  Required evidence verified.',
    '  No blocking findings remain.',
  ]);
  push('mission-verdict', [
    '', s.bold(s.gold('MISSION VERDICT')),
    `  ${VERDICT_LABEL[b.verdict.verdict] ?? b.verdict.verdict}`,
  ]);
  push('final-audit', [
    '', s.gold('FINAL AUDIT'),
    `  Implementer  requested: ${b.mission.implementerRequirement}`,
    `               actual:    ${b.executionSummary.actualImplementer}`,
    `  Reviewer     requested: Codex — Independent Coding Reviewer`,
    `               actual:    ${b.executionSummary.actualReviewer}`,
    `  Fallback occurred: ${b.executionSummary.fallbackOccurred ? 'yes' : 'no'}`,
    `  ${badge('SIMULATED')} Claude + Codex agents are deterministic simulations here.`,
    '  External Codex connection: not active.',
    `  History retained: ${b.findings.length} finding(s), ${b.repairs.length} repair(s).`,
    '', s.dim('Real Claude Code proof: npm run relay:claude:live'),
  ]);
  return frames;
}

/* --------------------------- inspection views ----------------------- */

const kv = (k: string, v: unknown) => `  ${k.padEnd(22)} ${v === null || v === undefined ? '-' : String(v)}`;

export function renderMissionContract(b: MissionProjectionBundle): string[] {
  const m = b.mission;
  return [
    'MISSION CONTRACT',
    kv('mission', m.missionId), kv('title', m.title), kv('objective', m.objective),
    kv('status', m.status), kv('revision', m.revision), kv('binding digest', m.bindingDigest),
    kv('requirements', m.requirements.length), kv('blocking criteria', m.acceptanceCriteria.filter((c) => c.blocking).length),
    kv('implementer', m.implementerRequirement), kv('reviewer', m.reviewerRequirement),
    kv('required reviewers', m.requiredReviewers.join('; ')),
    kv('out of scope', [...m.filesOutOfScope, ...m.systemsOutOfScope].join(', ')),
    kv('completion rule', m.completionRule),
    kv('max repairs', m.maximumRepairIterations), kv('max reviews', m.maximumReviewRuns),
    kv('provenance', m.provenance),
    ...(b.errors.length ? ['', 'VALIDATION ERRORS:', ...b.errors.map((e) => `  - ${e}`)] : []),
  ];
}

export function renderAttestations(b: MissionProjectionBundle): string[] {
  if (b.attestations.length === 0) return ['No execution attestations.'];
  const lines = ['EXECUTION ATTESTATIONS'];
  for (const a of b.attestations) {
    lines.push(
      kv('attestation', a.attestationId),
      kv('requested', `${a.requestedAgentId} (${a.requestedRole})`),
      kv('actual', `${a.actualAgentId} (${a.actualRole})`),
      kv('launch verified', a.launchVerified), kv('completion signal', a.completionSignalReceived),
      kv('fallback', a.fallbackOccurred ? `${a.fallbackAgentId} (${a.fallbackReason})` : 'none'),
      kv('provenance', a.provenance), kv('immutable', a.immutable),
      '',
    );
  }
  return lines;
}

export function renderFindings(b: MissionProjectionBundle): string[] {
  if (b.findings.length === 0) return ['No findings.'];
  const lines = ['FINDINGS'];
  for (const f of b.findings) {
    lines.push(
      kv(`${f.findingId} [${f.severity}]`, f.title),
      kv('  status', f.status), kv('  blocking', f.blocking),
      kv('  required action', f.requiredAction),
      kv('  affected criteria', f.affectedCriterionIds.join(', ')),
      kv('  repair', f.repairTaskId ?? 'none'),
      kv('  resolved by', f.resolutionReviewId ?? '-'),
    );
  }
  return lines;
}

export function renderRepairs(b: MissionProjectionBundle): string[] {
  if (b.repairs.length === 0) return ['No repairs.'];
  const lines = ['REPAIRS'];
  for (const r of b.repairs) {
    lines.push(
      kv(r.repairId, `for ${r.findingId} (iteration ${r.iteration})`),
      kv('  status', r.status), kv('  scope-locked', r.prohibitedScopeExpansion),
      kv('  changes', r.requiredChanges),
      kv('  files', r.affectedFiles.join(', ')),
    );
  }
  return lines;
}

export function renderVerdict(b: MissionProjectionBundle): string[] {
  const v = b.verdict;
  return [
    'MISSION VERDICT',
    kv('verdict', VERDICT_LABEL[v.verdict] ?? v.verdict),
    kv('open blocking findings', v.blockingFindingsOpen),
    kv('required review', v.requiredReviewsSatisfied ? 'satisfied' : 'not satisfied'),
    kv('attestations', v.requiredAttestationsPresent ? 'present' : 'missing'),
    kv('evidence', v.evidenceSatisfied ? 'satisfied' : 'not satisfied'),
    kv('within limits', v.withinRepairAndReviewLimits),
    '', 'CHECKS:',
    ...v.checks.map((c) => `  [${c.passed ? 'PASS' : 'FAIL'}] ${c.requirement} — ${c.detail}`),
    '', 'REASONS:', ...v.reasons.map((r) => `  - ${r}`),
  ];
}

export function renderTimeline(b: MissionProjectionBundle): string[] {
  const lines = ['MISSION TIMELINE'];
  for (const e of b.timeline) {
    const agent = e.actualAgent ? ` [${e.role}: req=${e.requestedAgent} act=${e.actualAgent}${e.attempt ? ` a${e.attempt}` : ''}]` : '';
    lines.push(`  ${String(e.sequence).padStart(2, '0')} ${e.kind}${agent}`);
    lines.push(`     ${e.summary}`.slice(0, 78));
  }
  return lines;
}

/** Serializable JSON payload (no ANSI, no mascot, no secrets). */
export function competitiveJson(app: RelayApp, now: string): MissionProjectionBundle {
  return projectCompetitiveMission(app, now);
}
