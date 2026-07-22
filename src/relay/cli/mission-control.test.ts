import { describe, expect, it } from 'vitest';
import { parseCli, runScenarioToCompletion } from './main';
import { buildMissionControlFrames } from './mission-control';
import { createSession } from './interactive';
import { deterministicIds, testClock } from '../testing/factories';

/**
 * Mission Control CLI tests (Prompt 8.2) — deterministic, NO provider call.
 * The demo presentation + the interactive /mode /dog /terminal /reviewer
 * /access commands.
 */

const RENDER = { color: false, mascot: false, plain: true, json: false, width: 80 };
const NOW = '2026-07-24T00:00:00.000Z';
const det = () => { const clock = testClock('2026-07-24T00:00:00.000Z', 1000); return { ids: deterministicIds(), now: () => clock.now() }; };
const run = () => runScenarioToCompletion({ scenarioName: 'competitive', render: RENDER, ...det() });
const ESC = String.fromCharCode(27);

describe('mission-control demo command', () => {
  it('parses demo mission-control', () => {
    expect(parseCli(['demo', 'mission-control'])).toMatchObject({ command: 'demo', scenario: 'mission-control' });
  });

  it('renders modes, dog, reviewer gate, and live terminal with truthful labels at 80 columns', () => {
    const frames = buildMissionControlFrames(run().app, RENDER, NOW);
    const labels = frames.map((f) => f.label);
    expect(labels).toEqual([
      'opening', 'header', 'modes', 'guided', 'semi', 'autonomous', 'reviewer-gate',
      'reviewer-package', 'agent-exchanges', 'live-terminal', 'dog', 'complete',
    ]);
    const text = frames.flatMap((f) => f.lines).join('\n');
    expect(text).toContain('MISSION CONTROL');
    expect(text).toContain('GUIDED');
    expect(text).toContain('SEMI');
    expect(text).toContain('AUTONOMOUS');
    expect(text).toContain('waiting_for_user'); // guided dog at manual task
    expect(text).toContain('APPROVED ACCESS');
    expect(text).toContain('never values');
    expect(text).toContain('HELD_FOR_REVIEW');
    expect(text).toContain('RELEASED');
    expect(text).toContain('cannot release before required review');
    expect(text).toContain('ARCHITECT → CODING AGENT');
    expect(text).toContain('CODEX REVIEWER: Deterministic simulation in this presentation');
    expect(text).toContain('EXTERNAL CODEX CONNECTION: Not active');
    expect(text).toContain('npm run relay:claude:live');
    for (const line of frames.flatMap((f) => f.lines)) {
      expect(line.length, line).toBeLessThanOrEqual(80);
      expect(line).not.toContain(ESC);
    }
  });

  it('exposes no secret-shaped or password/token value', () => {
    const text = buildMissionControlFrames(run().app, RENDER, NOW).flatMap((f) => f.lines).join('\n');
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|password[:=]|api[_-]?key[:=]/i);
  });
});

describe('interactive mode/dog/terminal/reviewer/access commands', () => {
  const session = () => createSession({ render: RENDER, scenarioName: 'competitive', interactiveBlueprint: false, ...det() });

  it('mode selection updates policy; dog motion toggles; reviewer + access are truthful', () => {
    const s = session();
    s.handleLine('objective');
    s.handleLine('/continue');
    expect(s.handleLine('/mode').lines.join('\n')).toContain('current: guided');
    expect(s.handleLine('/mode semi').lines.join('\n')).toContain('mode: semi');
    expect(s.handleLine('/mode autonomous').lines.join('\n')).toContain('autonomous');
    const dog = s.handleLine('/dog').lines.join('\n');
    expect(dog).toContain('RELAY DOG');
    expect(s.handleLine('/dog motion off').lines.join('\n')).toContain('motion off');
    expect(s.handleLine('/terminal').lines.join('\n')).toContain('LIVE TERMINAL');
    const reviewer = s.handleLine('/reviewer').lines.join('\n');
    expect(reviewer).toContain('SIMULATED — external Codex not active');
    const access = s.handleLine('/access').lines.join('\n');
    expect(access).toContain('never accepted or displayed');
    expect(access).not.toMatch(/sk-[A-Za-z0-9]{8,}|password[:=]/i);
  });
});
