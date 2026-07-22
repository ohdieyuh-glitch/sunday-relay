import { parseArgs } from 'node:util';
import * as readline from 'node:readline';
import { RELAY_PROTOCOL_VERSION } from '../protocol/version';
import { createRelayApp, SCENARIOS, type RelayApp } from '../core/app';
import { createSession } from './interactive';
import { buildPresentationFrames } from './presentation';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
import { detectRenderOptions, renderAudit, renderEvent, welcome, badge, type RenderOptions } from './render';
import { EXIT, exitCodeForFinalStatus } from './exit-codes';

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
  command: 'interactive' | 'demo' | 'run' | 'doctor' | 'version' | 'help';
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
    };
    if (pace !== undefined && (!Number.isFinite(pace) || pace < 0)) {
      return { command: 'help', ...base, pace: undefined, error: '--pace must be a non-negative number of milliseconds.' };
    }
    const [first, second] = positionals;
    if (values.help || first === 'help') return { command: 'help', ...base };
    if (first === 'version') return { command: 'version', ...base };
    if (first === 'doctor') return { command: 'doctor', ...base };
    if (first === 'demo') {
      if (!second) return { command: 'demo', ...base, error: 'demo requires a scenario name (e.g. relay demo repair).' };
      if (!SCENARIOS[second]) return { command: 'demo', ...base, error: `Unknown scenario "${second}". Known: ${Object.keys(SCENARIOS).join(', ')}.` };
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
  }

  const status = app.status();
  const finalStatus = status?.status ?? 'unknown';
  const audit = app.audit();
  if (audit) emit(['', ...renderAudit(app)]);
  if (status?.checkpoint && !status.checkpoint.respondedAt) {
    emit(['', 'CHECKPOINT REQUIRED', `  ${status.checkpoint.reason}`, '  Automatic work has stopped.']);
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
    case 'demo':
    case 'run': {
      const definition = SCENARIOS[parsed.scenario!];
      const objective = parsed.objective ?? definition.displayObjective;
      const outcome = runScenarioToCompletion({
        scenarioName: parsed.scenario!,
        objective,
        maxCost: parsed.maxCost,
        autoAcceptBlueprint: parsed.autoAcceptBlueprint,
        render,
      });
      // Presentation mode: renderer-only milestones + pacing. Auto-enabled
      // for the yc scenario unless JSON/quiet output was requested.
      const presentation = !parsed.json && !parsed.quiet && (parsed.presentation || parsed.scenario === 'yc');
      if (parsed.json) {
        io.out(JSON.stringify(outcome.json));
      } else if (parsed.quiet) {
        io.out(`${outcome.finalStatus} (exit ${outcome.exitCode})`);
      } else if (presentation) {
        const frames = buildPresentationFrames(outcome.app, render);
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
