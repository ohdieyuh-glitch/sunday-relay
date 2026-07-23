import { parseArgs } from 'node:util';
import * as readline from 'node:readline';
import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import { createRelayApp, SCENARIOS, type RelayApp } from '../core/app';
import { createSession } from './interactive';
import { buildPresentationFrames } from './presentation';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
import { detectRenderOptions, renderAudit, renderEvent, renderManualTask, welcome, badge, type RenderOptions } from './render';
import { buildCompetitiveFrames, competitiveJson } from './competitive';
import { buildMissionControlFrames } from './mission-control';
import { EXIT, exitCodeForFinalStatus } from './exit-codes';
import { runWorkspaceVerification, workspaceDoctorReport } from '../workspace';
import { createRandomIdFactory } from '../protocol/ids';
import {
  checkLivePrerequisites, classifyClaudeAuth, claudeDoctorReport, DEFAULT_LIVE_LIMITS,
  probeClaudeCapabilities, runClaudeContractVerification, runClaudeProof,
} from '../connectors/claude-code';
import {
  checkReviewPrerequisites, classifyCodexAuth, codexDoctorReport,
  probeCodexCapabilities, runCodexReviewerContractVerification, runCodexReviewProof,
} from '../connectors/codex-reviewer';
import {
  checkSupervisedPrerequisites, runSupervisedContractVerification, runSupervisedProof,
} from '../connectors/supervised';

/**
 * Relay CLI entry (Prompt 5). Thin client: parses arguments, composes the
 * Relay app through the approved composition root, renders read models.
 * Simulation-only, volatile storage — and it says so, always.
 */

export const CLI_VERSION = '0.5.0';

export interface CliIo {
  out(line: string): void;
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
}

const defaultIo: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  isTTY: process.stdout.isTTY === true,
  env: process.env,
};

export interface ParsedCli {
  command: 'interactive' | 'demo' | 'run' | 'doctor' | 'version' | 'help' | 'workspace' | 'claude' | 'codex' | 'supervised';
  workspaceAction?: 'doctor' | 'verify';
  claudeAction?: 'doctor' | 'run' | 'inspect' | 'cancel' | 'contract-verify';
  codexAction?: 'doctor' | 'run' | 'inspect' | 'cancel' | 'contract-verify';
  supervisedAction?: 'run' | 'contract-verify';
  fixture?: string;
  confirmLive: boolean;
  scenario?: string;
  objective?: string;
  maxCost?: number;
  untilStopped: boolean;
  autoAcceptBlueprint: boolean;
  presentation: boolean;
  pace?: number;
  compact: boolean;
  json: boolean;
  noColor: boolean;
  plain: boolean;
  quiet: boolean;
  error?: string;
}

export function parseCli(argv: string[]): ParsedCli {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        objective: { type: 'string' },
        scenario: { type: 'string' },
        'max-cost': { type: 'string' },
        'until-stopped': { type: 'boolean', default: false },
        'auto-accept-blueprint': { type: 'boolean', default: false },
        presentation: { type: 'boolean', default: false },
        pace: { type: 'string' },
        compact: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        plain: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        fixture: { type: 'string' },
        'confirm-live': { type: 'boolean', default: false },
      },
    });
    const pace = values.pace !== undefined ? Number(values.pace) : undefined;
    const base = {
      json: values.json === true, noColor: values['no-color'] === true,
      plain: values.plain === true, quiet: values.quiet === true,
      untilStopped: values['until-stopped'] === true,
      autoAcceptBlueprint: values['auto-accept-blueprint'] === true,
      presentation: values.presentation === true,
      pace, compact: values.compact === true,
      confirmLive: values['confirm-live'] === true,
    };
    if (pace !== undefined && (!Number.isFinite(pace) || pace < 0)) {
      return { command: 'help', ...base, pace: undefined, error: '--pace must be a non-negative number of milliseconds.' };
    }
    const [first, second] = positionals;
    if (values.help || first === 'help') return { command: 'help', ...base };
    if (first === 'version') return { command: 'version', ...base };
    if (first === 'doctor') return { command: 'doctor', ...base };
    if (first === 'workspace') {
      if (second !== 'doctor' && second !== 'verify') {
        return { command: 'workspace', ...base, error: 'workspace requires an action: doctor or verify.' };
      }
      return { command: 'workspace', workspaceAction: second, ...base };
    }
    if (first === 'claude') {
      const actions = ['doctor', 'run', 'inspect', 'cancel', 'contract-verify'];
      if (!second || !actions.includes(second)) {
        return { command: 'claude', ...base, error: 'claude requires an action: doctor, run, inspect, cancel, or contract-verify.' };
      }
      return { command: 'claude', claudeAction: second as ParsedCli['claudeAction'], fixture: values.fixture, ...base };
    }
    if (first === 'codex') {
      const actions = ['doctor', 'run', 'inspect', 'cancel', 'contract-verify'];
      if (!second || !actions.includes(second)) {
        return { command: 'codex', ...base, error: 'codex requires an action: doctor, run, inspect, cancel, or contract-verify.' };
      }
      return { command: 'codex', codexAction: second as ParsedCli['codexAction'], fixture: values.fixture, ...base };
    }
    if (first === 'supervised') {
      const actions = ['run', 'contract-verify'];
      if (!second || !actions.includes(second)) {
        return { command: 'supervised', ...base, error: 'supervised requires an action: run or contract-verify.' };
      }
      return { command: 'supervised', supervisedAction: second as ParsedCli['supervisedAction'], fixture: values.fixture, ...base };
    }
    if (first === 'demo') {
      if (!second) return { command: 'demo', ...base, error: 'demo requires a scenario name (e.g. relay demo repair).' };
      // mission-control is a presentation OVER the competitive scenario.
      if (second === 'mission-control') return { command: 'demo', scenario: 'mission-control', ...base };
      if (!SCENARIOS[second]) return { command: 'demo', ...base, error: `Unknown scenario "${second}". Known: ${Object.keys(SCENARIOS).join(', ')}, mission-control.` };
      return { command: 'demo', scenario: second, ...base };
    }
    if (first === 'run') {
      if (!values.objective) return { command: 'run', ...base, error: 'run requires --objective "<text>".' };
      const scenario = values.scenario ?? 'direct';
      if (!SCENARIOS[scenario]) return { command: 'run', ...base, error: `Unknown scenario "${scenario}".` };
      const maxCost = values['max-cost'] !== undefined ? Number(values['max-cost']) : undefined;
      if (maxCost !== undefined && (!Number.isFinite(maxCost) || maxCost <= 0)) {
        return { command: 'run', ...base, error: '--max-cost must be a positive number.' };
      }
      return { command: 'run', objective: values.objective, scenario, maxCost, ...base };
    }
    if (first !== undefined) return { command: 'help', ...base, error: `Unknown command "${first}".` };
    return { command: 'interactive', ...base };
  } catch (err) {
    return {
      command: 'help', json: false, noColor: true, plain: true, quiet: false,
      untilStopped: false, autoAcceptBlueprint: false, presentation: false, compact: false,
      confirmLive: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export const HELP_TEXT = [
  'Sunday Relay CLI — simulation demo surface (SIMULATED · VOLATILE storage)',
  '',
  'Usage:',
  '  relay                          interactive session',
  '  relay demo <scenario>          run one deterministic scenario',
  '  relay run --objective "<t>"    run a custom displayed objective',
  '       [--scenario <name>] [--max-cost <usd>] [--until-stopped]',
  '       [--auto-accept-blueprint]',
  '  relay doctor                   read-only environment checks',
  '  relay workspace doctor         isolated-worktree capability checks (live local)',
  '  relay workspace verify         deterministic workspace security verification',
  '  relay claude doctor            truthful Claude Code capability + auth report',
  '  relay claude contract-verify   offline adapter proof (no provider call)',
  '  relay claude run --fixture safe-edit --confirm-live   REAL Claude Code proof',
  '  relay codex doctor             truthful Codex reviewer capability + auth report',
  '  relay codex contract-verify    offline reviewer proof (no provider call)',
  '  relay codex run --fixture review-defect --confirm-live   REAL Codex review',
  '  relay supervised contract-verify   offline full-workflow proof (no provider call)',
  '  relay supervised run --fixture safe-edit --confirm-live   REAL supervised loop',
  '  relay demo competitive         Mission Contract + Claude/Codex proof (SIMULATED)',
  '  relay demo mission-control     modes + Relay Dog + Reviewer gate + Live Terminal',
  '  relay version | relay help',
  '',
  'Options: --json --no-color --plain --quiet',
  `Scenarios: ${Object.keys(SCENARIOS).join(', ')}`,
].join('\n');

/* ----------------------- demo / run execution ---------------------- */

export interface DemoOutcome {
  exitCode: number;
  lines: string[];
  finalStatus: string;
  json?: unknown;
  /** The composed app (read models only) for presentation rendering. */
  app: RelayApp;
}

export function runScenarioToCompletion(input: {
  scenarioName: string;
  objective?: string;
  maxCost?: number;
  autoAcceptBlueprint?: boolean;
  render: RenderOptions;
  ids?: Parameters<typeof createRelayApp>[0]['ids'];
  now?: () => string;
}): DemoOutcome {
  const { scenarioName, render } = input;
  const definition = SCENARIOS[scenarioName];
  const lines: string[] = [];
  const emit = (moreLines: string[]) => lines.push(...moreLines);
  const created = createRelayApp({
    scenarioName,
    interactiveBlueprint: false,
    maxCostUsd: input.maxCost,
    ids: input.ids,
    now: input.now,
  });
  if (!created.ok) return { exitCode: EXIT.usage, lines: [created.error.message], finalStatus: 'error', app: null as unknown as RelayApp };
  const app: RelayApp = created.value;
  emit(welcome(render, scenarioName));
  const objective = input.objective ?? `Demonstrate the "${scenarioName}" Relay scenario.`;
  const started = app.start(objective);
  if (!started.ok) return { exitCode: EXIT.internalError, lines: [...lines, started.error.message], finalStatus: 'error', app };

  let seq = 0;
  const drain = () => {
    const events = app.events(seq);
    seq = events.at(-1)?.sequence ?? seq;
    emit(events.map((e) => renderEvent(e, render)));
  };

  const doContinue = () => {
    const result = app.continueRun();
    if (!result.ok) emit([`${badge('FAIL')} ${result.error.message}`]);
    drain();
  };

  // pause/cancel choreography must act MID-run — step partway instead of
  // completing first (a cancel after completion would be a dishonest demo).
  if (definition.choreography === 'pause-resume' || definition.choreography === 'cancel' || definition.choreography === 'stale') {
    for (let i = 0; i < 4; i++) app.step();
    drain();
  } else {
    doContinue();
  }
  /* demo choreography for multi-phase scenarios */
  if (definition.choreography === 'pause-resume') {
    app.pause();
    emit([`${badge('INFO')} Paused by demo choreography.`]);
    app.resume();
    emit([`${badge('INFO')} Resumed.`]);
    doContinue();
  } else if (definition.choreography === 'cancel') {
    app.cancel('demo choreography cancellation');
    drain();
  } else if (definition.choreography === 'duplicate') {
    emit([`${badge('INFO')} First run is active. Creating an EQUIVALENT second run (same equivalence key)…`]);
    const second = app.startSecondEquivalentRun();
    if (second.ok) doContinue();
  } else if (definition.choreography === 'stale') {
    emit([`${badge('INFO')} Repository moved to a new revision under the compiled handoff…`]);
    app.moveBaseRevision('rev-moved-by-demo');
    doContinue();
  } else if (definition.choreography === 'manual') {
    // Manual Task demo: the run REALLY stopped at the checkpoint; the demo
    // choreography plays the user choosing "Done", honestly labeled.
    if (app.manualTask()) {
      emit(['', ...renderManualTask(app)]);
      emit(['', `${badge('INFO')} Demo choreography: the user completes the steps and chooses "Done".`]);
      const responded = app.respondManualTask('done');
      if (!responded.ok) emit([`${badge('FAIL')} ${responded.error.message}`]);
      drain();
      doContinue();
    }
  }

  const status = app.status();
  const finalStatus = status?.status ?? 'unknown';
  const audit = app.audit();
  if (audit) emit(['', ...renderAudit(app)]);
  if (status?.checkpoint && !status.checkpoint.respondedAt) {
    if (app.manualTask()) emit(['', ...renderManualTask(app)]);
    else emit(['', 'CHECKPOINT REQUIRED', `  ${status.checkpoint.reason}`, '  Automatic work has stopped.']);
  }
  const exitCode = exitCodeForFinalStatus(finalStatus, status?.checkpoint?.reason ?? null);
  const jsonPayload = {
    scenario: scenarioName,
    protocolVersion: RELAY_PROTOCOL_VERSION,
    adapterProfile: 'simulation',
    storageProfile: 'volatile-memory',
    finalStatus,
    exitCode,
    status,
    audit,
    manualTask: app.manualTask(),
    events: app.events(0),
    usage: app.usage(),
  };
  return { exitCode, lines, finalStatus, json: jsonPayload, app };
}

/* ------------------------------ doctor ----------------------------- */

export function doctorReport(io: CliIo): { lines: string[]; exitCode: number } {
  const checks: Array<[string, string]> = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push(['Node runtime', nodeMajor >= 18 ? `v${process.versions.node} (supported)` : `v${process.versions.node} (UNSUPPORTED — need >= 18)`]);
  let coreOk = false;
  try {
    const app = createRelayApp({ scenarioName: 'direct' });
    coreOk = app.ok;
  } catch {
    coreOk = false;
  }
  checks.push(['Relay Core', coreOk ? 'available' : 'FAILED to construct']);
  checks.push(['Protocol', RELAY_PROTOCOL_VERSION]);
  checks.push(['Simulation adapters', 'available']);
  checks.push(['Scenario registry', `${Object.keys(SCENARIOS).length} scenarios`]);
  checks.push(['Current storage', 'volatile memory (state dies with the process)']);
  checks.push(['Durable storage', 'DEFERRED (later prompt)']);
  checks.push(['Real Claude Code adapter', 'DEFERRED']);
  checks.push(['Real Codex adapter', 'DEFERRED']);
  checks.push(['Hermes adapter', 'DEFERRED']);
  checks.push(['Worktree manager', 'DEFERRED']);
  checks.push(['Production deployment', 'disabled']);
  checks.push(['Provider credentials accessed', 'no']);
  checks.push(['Terminal TTY', io.isTTY ? 'interactive' : 'non-interactive']);
  checks.push(['Color', io.env.NO_COLOR !== undefined ? 'disabled (NO_COLOR)' : io.isTTY ? 'available' : 'disabled (no TTY)']);
  const ready = coreOk && nodeMajor >= 18;
  checks.push(['Demo readiness', ready ? 'ready' : 'NOT READY']);
  return {
    lines: ['RELAY DOCTOR', ...checks.map(([k, v]) => `  ${k.padEnd(28)} ${v}`)],
    exitCode: ready ? EXIT.completed : EXIT.doctorFailure,
  };
}

/* --------------------------- claude commands ----------------------- */

async function runClaudeCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const now = () => new Date().toISOString();
  const out = (...lines: string[]) => lines.forEach((line) => io.out(line));

  if (parsed.claudeAction === 'doctor') {
    const report = claudeDoctorReport(now());
    if (parsed.json) io.out(JSON.stringify({ report: report.lines.slice(1), exitCode: report.exitCode }));
    else report.lines.forEach((line) => io.out(line));
    return report.exitCode;
  }

  if (parsed.claudeAction === 'contract-verify') {
    io.out('RELAY CLAUDE ADAPTER CONTRACT VERIFICATION (offline — no provider call)');
    const { checks, failures } = await runClaudeContractVerification();
    for (const check of checks) io.out(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    if (failures > 0) {
      io.out(`\nCLAUDE CONTRACT VERIFICATION FAILED: ${failures} check(s).`);
      return EXIT.doctorFailure;
    }
    io.out('\nCLAUDE CONTRACT VERIFICATION PASSED — adapter proven with no provider call.');
    return EXIT.completed;
  }

  if (parsed.claudeAction === 'inspect' || parsed.claudeAction === 'cancel') {
    // Live sessions are volatile and process-local: a fresh CLI process has
    // no active live run to inspect or cancel. Reported truthfully.
    io.out(parsed.claudeAction === 'inspect'
      ? 'No active live Claude run in this process (live sessions are volatile and not durably stored).'
      : 'No active live Claude run to cancel in this process.');
    return EXIT.completed;
  }

  // claudeAction === 'run': the explicit live proof.
  const fixture = parsed.fixture ?? 'safe-edit';
  if (fixture !== 'safe-edit') {
    io.out(`Only the "safe-edit" fixture is supported for the live proof (got "${fixture}").`);
    return EXIT.usage;
  }
  const caps = probeClaudeCapabilities(now());
  const auth = classifyClaudeAuth(now(), caps.executablePath);

  const prereq = checkLivePrerequisites({
    capabilities: caps, authApproved: auth.approvedForLiveRun, authLoggedIn: auth.loggedIn,
    authSourceClass: auth.sourceClass, settingsRisk: 'clean', approvalGranted: parsed.confirmLive,
  });
  const turnLimitLine = `  unlimited (bounded by ${Math.round(DEFAULT_LIVE_LIMITS.maxRuntimeMs / 60_000)}-minute runtime and output limits)`;
  if (!prereq.ready) {
    // Manual Task-shaped stop — simple steps, no live call, no secrets.
    out('MANUAL TASK', '', 'Relay needs your help.', '', prereq.manualTitle, '',
      'Why Relay stopped:', `  ${prereq.manualReason}`);
    if (!parsed.confirmLive && caps.executablePath && auth.approvedForLiveRun) {
      out('', 'LIVE CLAUDE CODE RUN', '',
        'This will use your existing Claude Code account.', '',
        'Workspace:', '  Isolated Relay worktree',
        'Source repository:', '  Will not be modified',
        'Deployment:', '  Disabled', 'Git push:', '  Prohibited',
        'Maximum agent turns:', turnLimitLine,
        'Files Claude may change:', '  src/normalize.js', '',
        'To proceed, re-run with --confirm-live (approval is never inferred from a TTY).');
    }
    return EXIT.checkpointRequired;
  }

  // Approved live run — show the confirmation screen, then run for real.
  out('LIVE CLAUDE CODE RUN', '',
    'This will use your existing Claude Code account.', '',
    'Workspace:', '  Isolated Relay worktree',
    'Source repository:', '  Will not be modified',
    'Deployment:', '  Disabled', 'Git push:', '  Prohibited',
    'Maximum agent turns:', turnLimitLine,
    'Files Claude may change:', '  src/normalize.js', '',
    'Confirmed via --confirm-live.');

  const proof = await runClaudeProof({
    executablePath: caps.executablePath!, capabilities: caps, now, ids: createRandomIdFactory(),
  });
  if (parsed.json) {
    io.out(JSON.stringify({
      exitCode: proof.exitCode, sessionCaptured: proof.sessionCaptured,
      filesChanged: proof.filesChanged, protectedChanges: proof.protectedChanges,
      inspectionAssessment: proof.inspectionAssessment, sourceUnchanged: proof.sourceUnchanged,
      verificationPassed: proof.verificationPassed, completionOutcome: proof.completionOutcome,
      audit: proof.audit,
    }));
  } else {
    proof.lines.forEach((line) => io.out(line));
  }
  return proof.exitCode;
}

/* --------------------------- codex commands ------------------------ */

async function runCodexCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const now = () => new Date().toISOString();
  const out = (...lines: string[]) => lines.forEach((line) => io.out(line));

  if (parsed.codexAction === 'doctor') {
    const report = codexDoctorReport(now());
    if (parsed.json) io.out(JSON.stringify({ report: report.lines.slice(1), exitCode: report.exitCode }));
    else report.lines.forEach((line) => io.out(line));
    return report.exitCode;
  }

  if (parsed.codexAction === 'contract-verify') {
    io.out('RELAY CODEX REVIEWER CONTRACT VERIFICATION (offline — no provider call)');
    const { checks, failures } = await runCodexReviewerContractVerification();
    for (const check of checks) io.out(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    if (failures > 0) {
      io.out(`\nCODEX CONTRACT VERIFICATION FAILED: ${failures} check(s).`);
      return EXIT.doctorFailure;
    }
    io.out('\nCODEX CONTRACT VERIFICATION PASSED — reviewer proven with no provider call.');
    return EXIT.completed;
  }

  if (parsed.codexAction === 'inspect' || parsed.codexAction === 'cancel') {
    io.out(parsed.codexAction === 'inspect'
      ? 'No active live Codex review in this process (reviewer sessions are volatile and not durably stored).'
      : 'No active live Codex review to cancel in this process.');
    return EXIT.completed;
  }

  // codexAction === 'run': the explicit live independent review.
  const fixture = parsed.fixture ?? 'review-defect';
  if (fixture !== 'review-defect') {
    io.out(`Only the "review-defect" fixture is supported for the live review (got "${fixture}").`);
    return EXIT.usage;
  }
  const caps = probeCodexCapabilities(now());
  const auth = classifyCodexAuth(now(), caps.executablePath);
  // The trusted Relay fixture supplies no hooks/plugins/MCP/custom provider.
  const configRisk = 'clean' as const;

  const prereq = checkReviewPrerequisites({
    capabilities: caps, authApproved: auth.approvedForLiveReview, authStatus: auth.status,
    configRisk, approvalGranted: parsed.confirmLive,
  });

  const reviewScreen = (footer: string): void => {
    out('LIVE CODEX REVIEW', '',
      'This will use your existing local Codex account.', '',
      'Role:', '  Independent Coding Reviewer',
      'Workspace:', '  Isolated Relay worktree',
      'Access:', '  Read only',
      'Files Codex may modify:', '  None',
      'Source repository:', '  Will not be modified',
      'Deployment:', '  Disabled', 'Git push:', '  Prohibited',
      'Fallback Reviewer:', '  Disabled',
      'Expected live calls:', '  1', '',
      footer);
  };

  if (!prereq.ready) {
    // Manual Task-shaped stop — simple steps, no live call, no secrets, never
    // an API key. Sign-in help mirrors the required Manual Task copy.
    out('MANUAL TASK', '', 'Relay needs your help.', '', prereq.manualTitle, '',
      'Why Relay stopped:', `  ${prereq.manualReason}`);
    if (prereq.manualTitle === 'Sign in to Codex') {
      out('', 'Do this:', '  1. Open a new terminal.', '  2. Type `codex`.',
        '  3. Complete the sign-in steps.', '  4. Close Codex when sign-in is finished.',
        '  5. Return to Relay.', '  6. Choose "Done."', '',
        'What Relay will do next:', '  Relay will check Codex again before starting the review.',
        '', 'Do not paste an API key into Relay.');
    }
    if (!parsed.confirmLive && caps.executablePath && auth.approvedForLiveReview && caps.readOnlySandboxSupported) {
      reviewScreen('To proceed, re-run with --confirm-live (approval is never inferred from a TTY).');
    }
    return EXIT.checkpointRequired;
  }

  // Approved live review — show the confirmation screen, then run for real.
  reviewScreen('Confirmed via --confirm-live.');

  const proof = await runCodexReviewProof({
    executablePath: caps.executablePath!, capabilities: caps, now, ids: createRandomIdFactory(),
  });
  if (parsed.json) {
    io.out(JSON.stringify({
      exitCode: proof.exitCode, reviewId: proof.reviewId, sessionCaptured: proof.sessionCaptured,
      launchVerified: proof.launchVerified, requestedReviewer: proof.requestedReviewer,
      actualReviewer: proof.actualReviewer, reviewerIndependent: proof.reviewerIndependent,
      preInspectionAssessment: proof.preInspectionAssessment, postInspectionAssessment: proof.postInspectionAssessment,
      reviewerFileChanges: proof.reviewerFileChanges, sourceUnchanged: proof.sourceUnchanged,
      verdict: proof.verdict, blockingFindings: proof.blockingFindings, outputVisibility: proof.outputVisibility,
      fallbackOccurred: proof.fallbackOccurred, cleanupOutcome: proof.cleanupOutcome,
    }));
  } else {
    proof.lines.forEach((line) => io.out(line));
  }
  return proof.exitCode;
}

/* ------------------------- supervised commands --------------------- */

async function runSupervisedCli(parsed: ParsedCli, io: CliIo): Promise<number> {
  const now = () => new Date().toISOString();
  const out = (...lines: string[]) => lines.forEach((line) => io.out(line));

  if (parsed.supervisedAction === 'contract-verify') {
    io.out('RELAY SUPERVISED WORKFLOW CONTRACT VERIFICATION (offline — no provider call)');
    const { checks, failures } = await runSupervisedContractVerification();
    for (const check of checks) io.out(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
    if (failures > 0) {
      io.out(`\nSUPERVISED CONTRACT VERIFICATION FAILED: ${failures} check(s).`);
      return EXIT.doctorFailure;
    }
    io.out('\nSUPERVISED CONTRACT VERIFICATION PASSED — full workflow proven with no provider call.');
    io.out('\nREADY FOR LIVE SUPERVISED WORKFLOW');
    return EXIT.completed;
  }

  // supervisedAction === 'run': the explicit founder-initiated live workflow.
  const fixture = parsed.fixture ?? 'safe-edit';
  if (fixture !== 'safe-edit') {
    io.out(`Only the "safe-edit" fixture is supported for the supervised live workflow (got "${fixture}").`);
    return EXIT.usage;
  }
  const claudeCaps = probeClaudeCapabilities(now());
  const claudeAuth = classifyClaudeAuth(now(), claudeCaps.executablePath);
  const codexCaps = probeCodexCapabilities(now());
  const codexAuth = classifyCodexAuth(now(), codexCaps.executablePath);

  const prereq = checkSupervisedPrerequisites({
    claude: {
      capabilities: claudeCaps, authApproved: claudeAuth.approvedForLiveRun,
      authLoggedIn: claudeAuth.loggedIn, authSourceClass: claudeAuth.sourceClass,
      settingsRisk: 'clean', approvalGranted: parsed.confirmLive,
    },
    codex: {
      capabilities: codexCaps, authApproved: codexAuth.approvedForLiveReview,
      authStatus: codexAuth.status, configRisk: 'clean', approvalGranted: parsed.confirmLive,
    },
  });

  const workflowScreen = (footer: string): void => {
    out('LIVE SUPERVISED WORKFLOW', '',
      'This will use your existing local Claude Code and Codex accounts.', '',
      'Implementer:', '  Claude Code (live)',
      'Reviewer:', '  Codex (live, independent, read only)',
      'Workspace:', '  Isolated Relay worktree',
      'Source repository:', '  Will not be modified',
      'Deployment:', '  Disabled', 'Git push:', '  Prohibited',
      'Fallback:', '  Disabled',
      'Fault injection:', '  None — every verdict is the reviewer\'s genuine report',
      'Repairs:', '  At most ONE bounded repair, only on a genuine reviewer finding',
      'Expected live calls:', '  2 (implementation + review); up to 4 with one repair cycle',
      'Files Claude may change:', '  src/normalize.js', '',
      footer);
  };

  if (!prereq.ready) {
    out('MANUAL TASK', '', 'Relay needs your help.', '', prereq.manualTitle, '',
      'Why Relay stopped:', `  ${prereq.manualReason}`);
    const bothOtherwiseReady = !parsed.confirmLive &&
      claudeCaps.executablePath && claudeAuth.approvedForLiveRun &&
      codexCaps.executablePath && codexAuth.approvedForLiveReview && codexCaps.readOnlySandboxSupported;
    if (bothOtherwiseReady) {
      workflowScreen('To proceed, re-run with --confirm-live (approval is never inferred from a TTY).');
    }
    return EXIT.checkpointRequired;
  }

  workflowScreen('Confirmed via --confirm-live.');

  const proof = await runSupervisedProof({
    claude: { executablePath: claudeCaps.executablePath!, capabilities: claudeCaps },
    codex: { executablePath: codexCaps.executablePath!, capabilities: codexCaps },
    now, ids: createRandomIdFactory(),
  });
  if (parsed.json) {
    io.out(JSON.stringify({
      exitCode: proof.exitCode, path: proof.path, stopReason: proof.stopReason,
      claudeSessionCaptured: proof.claudeSessionCaptured, codexSessionCaptured: proof.codexSessionCaptured,
      claudeInvocations: proof.claudeInvocations, codexInvocations: proof.codexInvocations,
      reviewVerdicts: proof.reviewVerdicts, reviewerIndependent: proof.reviewerIndependent,
      filesChanged: proof.filesChanged, protectedChanges: proof.protectedChanges,
      verificationsPassed: proof.verificationsPassed, repairDispatched: proof.repairDispatched,
      findings: proof.findings, repairs: proof.repairs, outputVisibility: proof.outputVisibility,
      completionOutcome: proof.completionOutcome, sourceUnchanged: proof.sourceUnchanged,
      audit: proof.audit,
    }));
  } else {
    proof.lines.forEach((line) => io.out(line));
  }
  return proof.exitCode;
}

/* ------------------------------- main ------------------------------ */

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const parsed = parseCli(argv);
  const render = detectRenderOptions(
    { json: parsed.json, 'no-color': parsed.noColor, plain: parsed.plain, quiet: parsed.quiet },
    io.env,
    io.isTTY,
  );
  if (parsed.error) {
    io.out(parsed.error);
    io.out(HELP_TEXT);
    return EXIT.usage;
  }
  switch (parsed.command) {
    case 'help':
      io.out(HELP_TEXT);
      return EXIT.completed;
    case 'version':
      if (parsed.json) {
        io.out(JSON.stringify({ cliVersion: CLI_VERSION, protocolVersion: RELAY_PROTOCOL_VERSION, adapterProfile: 'simulation', storageProfile: 'volatile-memory' }));
      } else {
        io.out(`Relay CLI ${CLI_VERSION}`);
        io.out(`Protocol ${RELAY_PROTOCOL_VERSION}`);
        io.out('Adapter profile: simulation');
        io.out('Storage profile: volatile memory');
      }
      return EXIT.completed;
    case 'doctor': {
      const report = doctorReport(io);
      if (parsed.json) io.out(JSON.stringify({ report: report.lines.slice(1), exitCode: report.exitCode }));
      else report.lines.forEach((line) => io.out(line));
      return report.exitCode;
    }
    case 'workspace': {
      // Live local workspace infrastructure — composed ONLY here; the CLI
      // renders results and never makes workspace policy decisions.
      if (parsed.workspaceAction === 'doctor') {
        const report = workspaceDoctorReport();
        if (parsed.json) io.out(JSON.stringify({ report: report.lines.slice(1), exitCode: report.exitCode }));
        else report.lines.forEach((line) => io.out(line));
        return report.exitCode;
      }
      io.out('RELAY WORKSPACE VERIFICATION (live local, fixture repository only)');
      const { checks, failures } = await runWorkspaceVerification();
      for (const check of checks) {
        io.out(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
      }
      if (failures > 0) {
        io.out(`\nWORKSPACE VERIFICATION FAILED: ${failures} check(s).`);
        return EXIT.doctorFailure;
      }
      io.out('\nWORKSPACE VERIFICATION PASSED — isolation, policy, and cleanup proven.');
      return EXIT.completed;
    }
    case 'claude':
      return runClaudeCli(parsed, io);
    case 'codex':
      return runCodexCli(parsed, io);
    case 'supervised':
      return runSupervisedCli(parsed, io);
    case 'demo':
    case 'run': {
      // mission-control renders over a real competitive run.
      const isMissionControl = parsed.scenario === 'mission-control';
      const isCompetitive = parsed.scenario === 'competitive';
      const runScenarioName = isMissionControl ? 'competitive' : parsed.scenario!;
      const definition = SCENARIOS[runScenarioName];
      const objective = parsed.objective ?? definition.displayObjective;
      const outcome = runScenarioToCompletion({
        scenarioName: runScenarioName,
        objective,
        maxCost: parsed.maxCost,
        autoAcceptBlueprint: parsed.autoAcceptBlueprint,
        render,
      });
      // Presentation mode: renderer-only milestones + pacing. Auto-enabled
      // for yc / competitive / mission-control unless JSON/quiet was requested.
      const presentation = !parsed.json && !parsed.quiet && (parsed.presentation || parsed.scenario === 'yc' || isCompetitive || isMissionControl);
      const nowIso = new Date().toISOString();
      if (parsed.json) {
        const payload = isCompetitive || isMissionControl
          ? { ...(outcome.json as object), mission: competitiveJson(outcome.app, nowIso) }
          : outcome.json;
        io.out(JSON.stringify(payload));
      } else if (parsed.quiet) {
        io.out(`${outcome.finalStatus} (exit ${outcome.exitCode})`);
      } else if (presentation) {
        const frames = isMissionControl
          ? buildMissionControlFrames(outcome.app, render, nowIso)
          : isCompetitive
            ? buildCompetitiveFrames(outcome.app, render, nowIso)
            : buildPresentationFrames(outcome.app, render);
        const pace = parsed.pace ?? (io.isTTY ? 2500 : 0);
        for (const frame of frames) {
          frame.lines.forEach((line) => io.out(line));
          if (pace > 0 && frame !== frames[frames.length - 1]) await sleep(pace);
        }
      } else {
        outcome.lines.forEach((line) => io.out(line));
      }
      return outcome.exitCode;
    }
    case 'interactive': {
      const session = createSession({
        render,
        scenarioName: parsed.scenario ?? 'repair',
        interactiveBlueprint: !parsed.autoAcceptBlueprint,
      });
      session.banner().forEach((line) => io.out(line));
      io.out('Enter an engineering objective (or /help):');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
      rl.prompt();
      rl.on('line', (line) => {
        const result = session.handleLine(line);
        result.lines.forEach((l) => io.out(l));
        if (result.exit) rl.close();
        else rl.prompt();
      });
      rl.on('close', () => process.exit(EXIT.completed));
      return EXIT.completed;
    }
  }
}

/* Bundled entry */
if (require.main === module) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
