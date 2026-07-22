import { createRelayApp, SCENARIOS, type RelayApp } from '../core/app';
import type { IdFactory } from '../protocol/ids';
import {
  badge, mascot, mascotStateFor, renderAudit, renderBlueprint, renderBrain,
  renderCheckpoint, renderEvent, renderEvidence, renderHandoff, renderReview,
  renderStatus, renderTask, renderUsage, welcome, type RenderOptions,
} from './render';

/**
 * Interactive Relay session (Prompt 5) — a PURE line handler so tests drive
 * it without a TTY; main.ts wires readline around it. The session never
 * advances state itself: every action is a Relay Core command or query.
 */

export interface SessionResult {
  lines: string[];
  exit?: boolean;
}

export interface Session {
  handleLine(line: string): SessionResult;
  banner(): string[];
  readonly app: RelayApp | null;
}

export interface SessionOptions {
  render: RenderOptions;
  scenarioName: string;
  interactiveBlueprint: boolean;
  ids?: IdFactory;
  now?: () => string;
}

const HELP = [
  'Interactive commands:',
  '  <text>            set the objective and create the run (before start)',
  '  /start /step /continue        drive the workflow through Relay Core',
  '  /status /events /project /task /ownership /blueprint /handoff',
  '  /evidence /review /usage /checkpoint /audit   inspect read models',
  '  /approve /reject <reason>     answer blueprint or checkpoint decisions',
  '  /pause /resume /cancel        run control',
  '  /scenario [name]              show or switch scenario (before start)',
  '  /mascot on|off  /color on|off|auto  /json on|off  /clear /help /exit',
];

export function createSession(options: SessionOptions): Session {
  let scenarioName = options.scenarioName;
  let app: RelayApp | null = null;
  let renderOpts = { ...options.render };
  let lastSeq = 0;

  const ensureApp = (): RelayApp | { error: string } => {
    if (app) return app;
    const created = createRelayApp({ scenarioName, interactiveBlueprint: options.interactiveBlueprint, ids: options.ids, now: options.now });
    if (!created.ok) return { error: created.error.message };
    app = created.value;
    return app;
  };

  const newEvents = (): string[] => {
    if (!app) return [];
    const events = app.events(lastSeq);
    lastSeq = events.at(-1)?.sequence ?? lastSeq;
    return events.map((e) => renderEvent(e, renderOpts));
  };

  const mascotLines = (): string[] => {
    const status = app?.status();
    return mascot(status ? mascotStateFor(status.status, status.phase) : 'LISTENING', renderOpts);
  };

  const startRun = (objective: string): string[] => {
    const target = ensureApp();
    if ('error' in target) return [`${badge('FAIL')} ${target.error}`];
    const started = target.start(objective);
    if (!started.ok) return [`${badge('FAIL')} ${started.error.message}`];
    return [`Run created for objective: ${objective}`, 'Use /continue (or /step) to proceed.', ...newEvents()];
  };

  const drive = (mode: 'step' | 'continue'): string[] => {
    if (!app) return [`${badge('WAIT')} No run yet — enter an objective first.`];
    const result = mode === 'step' ? app.step() : app.continueRun();
    if (!result.ok) return [`${badge('FAIL')} ${result.error.message}`];
    const lines = [...newEvents()];
    const status = app.status();
    if (status?.checkpoint && !status.checkpoint.respondedAt) lines.push('', ...renderCheckpoint(app));
    if (status?.status === 'active' && status.phase === 'blueprint' && app.blueprint()?.approvalStatus === 'awaiting-approval') {
      lines.push('', ...renderBlueprint(app), '', `${badge('WAIT')} Blueprint awaits your decision: /approve or /reject <reason>.`);
    }
    if (status?.status === 'completed') lines.push('', ...renderAudit(app));
    lines.push(...mascotLines());
    return lines;
  };

  const respond = (response: 'approve' | 'reject', note?: string): string[] => {
    if (!app) return [`${badge('WAIT')} No run yet.`];
    const status = app.status();
    // Blueprint decision takes precedence when one is pending.
    if (app.blueprint()?.approvalStatus === 'awaiting-approval' && !status?.checkpoint) {
      const result = response === 'approve' ? app.acceptBlueprint() : app.rejectBlueprint(note ?? 'rejected by operator');
      if (!result.ok) return [`${badge('FAIL')} ${result.error.message}`];
      return [`Blueprint ${response}d.`, ...newEvents()];
    }
    const result = app.respondCheckpoint(response, note);
    if (!result.ok) return [`${badge('FAIL')} ${result.error.message}`];
    return [`Checkpoint ${response}d.`, ...newEvents()];
  };

  return {
    get app() {
      return app;
    },
    banner: () => [...welcome(renderOpts, scenarioName), ...mascotLines()],
    handleLine(raw: string): SessionResult {
      const line = raw.trim();
      if (line === '') return { lines: [] };
      if (!line.startsWith('/')) {
        if (app) return { lines: [`${badge('INFO')} Run already exists — use /status, /continue, or /exit.`] };
        return { lines: startRun(line) };
      }
      const [command, ...rest] = line.split(/\s+/);
      const arg = rest.join(' ');
      switch (command) {
        case '/help': return { lines: HELP };
        case '/exit': return { lines: ['Goodbye. (Volatile session state is discarded.)'], exit: true };
        case '/objective': return { lines: app ? [`${badge('INFO')} Run already exists.`] : startRun(arg) };
        case '/scenario':
          if (!arg) return { lines: [`scenario: ${scenarioName}`, ...Object.values(SCENARIOS).map((d) => `  ${d.name.padEnd(16)} ${d.description}`)] };
          if (app) return { lines: [`${badge('FAIL')} Cannot switch scenario after the run started.`] };
          if (!SCENARIOS[arg]) return { lines: [`${badge('FAIL')} Unknown scenario "${arg}".`] };
          scenarioName = arg;
          return { lines: [`scenario set: ${arg}`] };
        case '/start':
        case '/step': return { lines: drive('step') };
        case '/continue': return { lines: drive('continue') };
        case '/status': return { lines: app ? renderStatus(app) : ['No run yet.'] };
        case '/events': return { lines: app ? app.events(0).map((e) => renderEvent(e, renderOpts)) : ['No run yet.'] };
        case '/project': return { lines: app ? renderBrain(app) : ['No run yet.'] };
        case '/task':
        case '/ownership': return { lines: app ? renderTask(app) : ['No run yet.'] };
        case '/blueprint': return { lines: app ? renderBlueprint(app) : ['No run yet.'] };
        case '/handoff': return { lines: app ? renderHandoff(app) : ['No run yet.'] };
        case '/evidence': return { lines: app ? renderEvidence(app) : ['No run yet.'] };
        case '/review': return { lines: app ? renderReview(app) : ['No run yet.'] };
        case '/usage': return { lines: app ? renderUsage(app) : ['No run yet.'] };
        case '/checkpoint': return { lines: app ? renderCheckpoint(app) : ['No run yet.'] };
        case '/audit': return { lines: app ? renderAudit(app) : ['No run yet.'] };
        case '/approve': return { lines: respond('approve') };
        case '/reject': return { lines: respond('reject', arg || undefined) };
        case '/pause': return { lines: app ? (app.pause().ok ? ['Paused.', ...newEvents()] : [`${badge('FAIL')} Cannot pause now.`]) : ['No run yet.'] };
        case '/resume': return { lines: app ? (app.resume().ok ? ['Resumed.', ...newEvents()] : [`${badge('FAIL')} Cannot resume now.`]) : ['No run yet.'] };
        case '/cancel': {
          if (!app) return { lines: ['No run yet.'] };
          const result = app.cancel(arg || 'cancelled by operator');
          return { lines: result.ok ? ['Cancelled.', ...newEvents()] : [`${badge('FAIL')} ${result.error.message}`] };
        }
        case '/clear': return { lines: ['c'] };
        case '/mascot':
          renderOpts = { ...renderOpts, mascot: arg !== 'off' };
          return { lines: [`mascot: ${renderOpts.mascot ? 'on' : 'off'}`] };
        case '/color':
          renderOpts = { ...renderOpts, color: arg === 'on' };
          return { lines: [`color: ${renderOpts.color ? 'on' : 'off'}`] };
        case '/json':
          renderOpts = { ...renderOpts, json: arg === 'on' };
          return { lines: [`json: ${renderOpts.json ? 'on' : 'off'}`] };
        default:
          return { lines: [`${badge('FAIL')} Unknown command ${command}. Try /help.`] };
      }
    },
  };
}
