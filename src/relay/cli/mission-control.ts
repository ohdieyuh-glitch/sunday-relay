import type { RelayApp } from '../core/app';
import { style, badge, type RenderOptions } from './render';
import { projectCompetitiveMission } from './competitive';
import {
  defaultModePolicy, buildAutonomousConsent, computeDogActivity,
  entitlementPolicy, computeOutputVisibility, assignReviewer, reviewerIsIndependent,
  buildReviewerPackage, projectTerminalEvent, buildAgentExchanges,
  type RelayMode, type DogComputeInput,
} from '../mission';
import { officialDogRows } from './product';

/**
 * Mission Control presentation (Prompt 8.2) — RENDERER + PROJECTION glue.
 * Demonstrates operational modes, the event-driven Relay Dog, the Pro/Max
 * Reviewer release gate, and the Live Terminal, all projected from a real
 * completed run + the pure mission engines. Truthful: Claude Implementer and
 * Codex Reviewer are deterministic SIMULATIONS here; no external Codex; no
 * provider call. The real Claude path stays relay:claude:live.
 */

export interface PresentationFrame { label: string; lines: string[] }

const CONSENT_NOW = '2026-07-24T00:00:00.000Z';
const CONSENT_EXPIRES = '2026-07-24T02:00:00.000Z';

const dogFor = (events: DogComputeInput['events'], over: Partial<DogComputeInput>): ReturnType<typeof computeDogActivity> =>
  computeDogActivity({
    events, runStatus: 'active', phase: 'implementation', mode: 'semi', manualTaskActive: false,
    checkpointActive: false, missionVerdict: 'none', reducedMotion: false, now: CONSENT_NOW,
    provenance: 'simulated', ...over,
  });

const ev = (seq: number, source: string, kind: string) => ({ sequence: seq, source, kind, provenance: 'simulated' as const });

export function buildMissionControlFrames(app: RelayApp, opts: RenderOptions, now: string): PresentationFrame[] {
  const s = style(opts);
  const b = projectCompetitiveMission(app, now);
  const frames: PresentationFrame[] = [];
  const push = (label: string, lines: string[]) => frames.push({ label, lines });

  const rawEvents = app.events(0);
  const finalDog = computeDogActivity({
    events: rawEvents.map((e) => ev(e.sequence, e.source, e.kind)),
    runStatus: 'completed', phase: 'audit', mode: 'semi', manualTaskActive: false, checkpointActive: false,
    missionVerdict: b.verdict.verdict, reducedMotion: false, now, provenance: 'simulated',
  });

  push('opening', [
    '', `${s.bold('SUNDAY RELAY')} — ${s.bold('MISSION CONTROL')}`, '',
    `${badge('SIMULATED')} Deterministic mission-control presentation`,
    'CLAUDE CODE IMPLEMENTER: Deterministic simulation in this presentation',
    'CODEX REVIEWER: Deterministic simulation in this presentation',
    'EXTERNAL CODEX CONNECTION: Not active',
    'REAL CLAUDE CODE SUPPORT: Available through npm run relay:claude:live',
  ]);

  push('header', [
    '', s.gold('LIVE TERMINAL'),
    '  Mode: Semi     Plan: Pro',
    `  Mission: ${b.mission.title}`,
    `  Run: ${b.mission.missionId}   Status: verified_complete`,
    `  Dog: ${finalDog.state} (${finalDog.statusLabel})`,
    '  Connection: LIVE     Provenance: SIMULATED',
  ]);

  /* --- modes --- */
  const modeLine = (m: RelayMode) => {
    const p = defaultModePolicy(m, now);
    return `  ${m.toUpperCase().padEnd(11)} steps<=${p.automaticStepLimit} repairs<=${p.automaticRepairLimit} spend<=$${p.maximumSpendUsd} checkpoints=${p.checkpointPolicy}`;
  };
  push('modes', [
    '', s.gold('OPERATIONAL MODES'),
    modeLine('guided'), modeLine('semi'), modeLine('autonomous'),
    s.dim('  The UI submits the mode; Relay Core owns the policy.'),
  ]);

  /* --- guided --- */
  const guidedDog = dogFor([ev(1, 'relay-core', 'run.created')], { mode: 'guided', runStatus: 'checkpoint_required', manualTaskActive: true });
  push('guided', [
    '', s.gold('GUIDED MODE'),
    '  Relay handles routine work and asks before important decisions.',
    '  Narrow access; credential handles disabled by default.',
    `  Dog: ${guidedDog.state} (${guidedDog.statusLabel}) — waiting at a Manual Task.`,
  ]);

  /* --- semi --- */
  const semiDog = dogFor([ev(1, 'architect', 'architect.blueprint_created'), ev(2, 'coding-agent', 'agent.session_started'), ev(3, 'coding-agent', 'agent.report_created'), ev(4, 'verification', 'verification.completed')], { mode: 'semi' });
  push('semi', [
    '', s.gold('SEMI MODE'),
    '  Relay works independently through routine tasks and asks before',
    '  high-impact actions.',
    `  Dog: ${semiDog.state} (${semiDog.statusLabel}); one bounded repair may run.`,
    '  Relay STOPS before destructive, deployment, spending, or scope changes.',
  ]);

  /* --- autonomous consent --- */
  const consent = buildAutonomousConsent({
    consentId: 'cns_demo', grantedBy: 'relay-operator', grantedAt: CONSENT_NOW,
    access: {
      services: ['github (read-only)'], projects: ['sunday-relay'], tools: ['Read', 'Edit'],
      credentialHandleIds: ['crd_claude_session'], maximumSpendUsd: 5, maximumRuntimeMinutes: 30,
      deploymentPermitted: false, destructiveActionPermitted: false, reviewerPolicy: 'required_when_entitled',
      expiresAt: CONSENT_EXPIRES,
    },
  });
  push('autonomous', [
    '', s.gold('AUTONOMOUS MODE'),
    '  Relay can complete more steps without stopping to ask you.',
    '  It may use accounts, tools, and secure access that you approve.',
    '  Relay will not display or give your passwords to AI agents.',
    '  Relay still stops before destructive, financial, identity-sensitive,',
    '  or unsupported actions.',
    '', '  APPROVED ACCESS (names + scopes only — never values):',
    ...(consent.ok ? [
      `    Services: ${consent.value.access.services.join(', ')}`,
      `    Tools: ${consent.value.access.tools.join(', ')}`,
      `    Credential handles: ${consent.value.access.credentialHandleIds.join(', ')}`,
      `    Max spend: $${consent.value.access.maximumSpendUsd}   Max runtime: ${consent.value.access.maximumRuntimeMinutes}m`,
      `    Deployment: ${consent.value.access.deploymentPermitted ? 'permitted' : 'no'}   Destructive: ${consent.value.access.destructiveActionPermitted ? 'permitted' : 'no'}`,
      `    Expires: ${consent.value.access.expiresAt}`,
    ] : ['    (consent invalid)']),
    '', '  [ Enable Autonomous Mode ]  [ Review Access ]  [ Cancel ]',
    s.dim('  Consent is specific and immutable; there is no "access everything".'),
  ]);

  /* --- reviewer gate (Pro) --- */
  const pro = entitlementPolicy('pro');
  const reviewer = assignReviewer('pro', 'simulated');
  const independent = reviewerIsIndependent({
    reviewerAgentId: 'sim-reviewer', reviewerSessionId: null, reviewerAdapterId: 'sim-reviewer', reviewerIndependenceGroup: 'reviewers',
    implementerAgentId: 'sim-coding-agent', implementerSessionId: 'ses_impl', implementerAdapterId: 'sim-coding-agent', implementerIndependenceGroup: 'implementers',
  });
  const gate = (over: Parameters<typeof computeOutputVisibility>[0]) => computeOutputVisibility(over);
  const base = {
    entitlement: 'pro' as const, substantiveCoding: true, implementationReported: true, verificationPassed: true,
    reviewerRequired: true, reviewerIsIndependent: independent, runStatus: 'active',
  };
  push('reviewer-gate', [
    '', s.gold('PRO/MAX REVIEWER RELEASE GATE'),
    `  Plan: ${pro.label} — independent Reviewer required for substantive coding.`,
    `  Reviewer: ${reviewer.agentId} (independent=${independent}) ${badge('SIMULATED')}`,
    `  ${badge(gate({ ...base, reviewOccurred: false, blockingFindingOpen: false, reviewApproved: false, completionPolicySatisfied: false }).visibility.toUpperCase())} output held for the required independent review`,
    `  ${badge('REVISION_REQUIRED')} blocking finding — repair authorized`,
    `  ${badge(gate({ ...base, reviewOccurred: true, blockingFindingOpen: false, reviewApproved: true, completionPolicySatisfied: false }).visibility.toUpperCase())} reviewer approved`,
    `  ${badge(gate({ ...base, reviewOccurred: true, blockingFindingOpen: false, reviewApproved: true, completionPolicySatisfied: true }).visibility.toUpperCase())} only after CompletionPolicy passes`,
    s.dim('  Output cannot release before required review; Autonomous cannot bypass it.'),
  ]);

  /* --- reviewer package (safe subset) --- */
  const pkg = buildReviewerPackage({
    missionObjective: b.mission.objective, requirements: b.mission.requirements,
    acceptanceCriteria: b.mission.acceptanceCriteria.map((c) => c.text), changedFiles: b.mission.filesInScope,
    verificationEvidence: b.mission.requiredEvidence.map((c) => ({ command: c, status: 'passed' })),
  });
  push('reviewer-package', [
    '', s.gold('REVIEWER PACKAGE (no transcript, no secrets)'),
    `  Objective, ${pkg.requirements.length} requirements, ${pkg.acceptanceCriteria.length} criteria`,
    `  ${pkg.changedFiles.length} changed files, ${pkg.verificationEvidence.length} evidence checks`,
    `  Rubric: ${pkg.reviewRubric.join(', ')}`,
    `  Blocking threshold: ${pkg.blockingThreshold}`,
  ]);

  /* --- live terminal (safe structured exchanges + events) --- */
  const exchanges = buildAgentExchanges({
    objective: b.mission.objective, changedFiles: b.mission.filesInScope,
    requiredProof: b.mission.requiredEvidence, findingTitle: b.findings[0]?.title ?? null,
    repairAction: b.repairs[0]?.requiredChanges ?? null,
  });
  const exchangeLines = exchanges.flatMap((x) => [`  ${x.from} → ${x.to}`, `    ${x.title}`]);
  push('agent-exchanges', ['', s.gold('VISIBLE RESPONSIBILITY EXCHANGES'), ...exchangeLines]);

  const terminalEvents = rawEvents
    .filter((e) => !e.kind.startsWith('ledger.') && !e.kind.startsWith('file_claim.'))
    .slice(0, 10)
    .map((e) => projectTerminalEvent({ sequence: e.sequence, at: e.at, source: e.source, kind: e.kind, safeSummary: e.safeSummary, provenance: e.provenance }));
  push('live-terminal', [
    '', s.gold('LIVE TERMINAL — SAFE EVENT FEED'),
    ...terminalEvents.map((t) => `  [${String(t.sequence).padStart(2, '0')}] ${t.sourceRole.padEnd(12)} ${t.headline}`),
    s.dim('  Hidden reasoning is never shown; secrets are redacted.'),
  ]);

  /* --- dog + complete --- */
  // The OFFICIAL Relay Dog — the shared sprite, never a second mascot. The
  // mission domain owns the state; this renders the official visual for it.
  push('dog', [
    '', s.gold('RELAY DOG'),
    ...officialDogRows('standing', {
      tty: true, color: opts.color, unicode: !opts.plain, width: opts.width,
      reducedMotion: opts.plain, plain: opts.plain, json: opts.json,
    }).map((l) => `  ${l}`),
    `  RELAY DOG — ${finalDog.statusLabel}`,
    s.dim(`  activity=${finalDog.activityLevel} sync=${finalDog.synchronizationLevel} — derived from real events.`),
  ]);
  push('complete', [
    '', s.bold(s.gold('MISSION CONTROL READY')),
    `  Verdict: ${b.verdict.verdict}   Dog: ${finalDog.state}   Output: released`,
    '', s.dim('Real Claude proof:  npm run relay:claude:live'),
    s.dim('Competitive proof:  npm run relay:competitive'),
  ]);
  return frames;
}
