import { describe, expect, it } from 'vitest';
import { parseCli, runScenarioToCompletion } from './main';
import { createSession } from './interactive';
import { renderManualTask } from './render';
import { deterministicIds, testClock } from '../testing/factories';

const RENDER_PLAIN = { color: false, mascot: false, plain: true, json: false, width: 80 };
const det = () => {
  const clock = testClock('2026-07-22T10:00:00.000Z', 1000);
  return { ids: deterministicIds(), now: () => clock.now() };
};
const ESC = String.fromCharCode(27);

describe('manual demo command', () => {
  it('relay demo manual parses and runs to completion with the full manual-task flow', () => {
    expect(parseCli(['demo', 'manual'])).toMatchObject({ command: 'demo', scenario: 'manual' });
    expect(parseCli(['demo', 'manual', '--pace', '0'])).toMatchObject({ command: 'demo', scenario: 'manual', pace: 0 });

    const outcome = runScenarioToCompletion({ scenarioName: 'manual', render: RENDER_PLAIN, ...det() });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.finalStatus).toBe('completed');
    const text = outcome.lines.join('\n');
    expect(text).toContain('MANUAL TASK');
    expect(text).toContain('Relay needs your help.');
    expect(text).toContain('Why Relay stopped:');
    expect(text).toContain('The run is stopped safely.');
    expect(text).toContain('1. Open the project settings.');
    expect(text).toContain('6. Choose "Done."');
    expect(text).toContain('What Relay will do next:');
    expect(text).toContain('[D] Done');
    expect(text).toContain('[H] I need help');
    expect(text).toContain('[N] I cannot do this');
    expect(text).toContain('[C] Cancel run');
    expect(text).toContain('Demo choreography: the user completes the steps and chooses "Done".');
    expect(text).toContain('FINAL AUDIT REPORT');
    expect(text).toContain('[SIMULATED]');
    expect(text).not.toContain(ESC);
  });

  it('renders the manual task inside 80 columns in plain/no-color mode', () => {
    const outcome = runScenarioToCompletion({ scenarioName: 'manual', render: RENDER_PLAIN, ...det() });
    const start = outcome.lines.findIndex((line) => line === 'MANUAL TASK');
    const end = outcome.lines.findIndex((line) => line.includes('[C] Cancel run'));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    for (const line of outcome.lines.slice(start, end + 1)) {
      expect(line.length, line).toBeLessThanOrEqual(80);
      expect(line).not.toContain(ESC);
    }
  });

  it('JSON mode returns the serializable read model with no ANSI, mascot, or secrets', () => {
    const outcome = runScenarioToCompletion({ scenarioName: 'manual', render: { ...RENDER_PLAIN, json: true }, ...det() });
    const raw = JSON.stringify(outcome.json);
    expect(raw).not.toContain(ESC);
    expect(raw).not.toContain('RELAY DOG');
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY/);
    const parsed = JSON.parse(raw) as {
      finalStatus: string;
      manualTask: {
        status: string; steps: string[]; availableResponses: string[];
        checkpointId: string; verification: { available: boolean; lastOutcome: string };
      };
      status: { checkpoint: { checkpointId: string } };
    };
    expect(parsed.finalStatus).toBe('completed');
    expect(parsed.manualTask.status).toBe('completed');
    expect(parsed.manualTask.steps).toHaveLength(6);
    expect(parsed.manualTask.verification).toMatchObject({ available: true, lastOutcome: 'passed' });
    expect(parsed.manualTask.checkpointId).toBe(parsed.status.checkpoint.checkpointId);
    expect(Array.isArray(parsed.manualTask.availableResponses)).toBe(true);
  });
});

describe('interactive manual task session', () => {
  const session = (scenario = 'manual') =>
    createSession({ render: RENDER_PLAIN, scenarioName: scenario, interactiveBlueprint: false, ...det() });

  const stopAtTask = () => {
    const s = session();
    s.handleLine('objective');
    const stopped = s.handleLine('/continue');
    return { s, stopped };
  };

  it('shows the manual task automatically at the checkpoint and via /manual', () => {
    const { s, stopped } = stopAtTask();
    expect(stopped.lines.join('\n')).toContain('MANUAL TASK');
    expect(stopped.lines.join('\n')).toContain('[D] Done');
    expect(s.handleLine('/manual').lines.join('\n')).toContain('Approve a protected setting');
  });

  it('D completes the flow: done → verified → /continue finishes the run', () => {
    const { s } = stopAtTask();
    const done = s.handleLine('d');
    expect(done.lines.join('\n')).toContain('Relay checked the result');
    expect(s.app?.status()?.status).toBe('active');
    const finished = s.handleLine('/continue');
    expect(finished.lines.join('\n')).toContain('FINAL AUDIT REPORT');
    expect(s.app?.status()?.status).toBe('completed');
  });

  it('H shows simpler deterministic help and keeps the run stopped', () => {
    const { s } = stopAtTask();
    const helped = s.handleLine('h');
    expect(helped.lines.join('\n')).toContain('HELP');
    expect(helped.lines.join('\n')).toContain('stays safely stopped');
    expect(s.app?.status()?.status).toBe('checkpoint_required');
  });

  it('N records the blocker and keeps work safe; /cannot-complete carries a note', () => {
    const { s } = stopAtTask();
    s.handleLine('n');
    expect(s.app?.status()?.status).toBe('checkpoint_required');
    expect(s.app?.manualTask()?.status).toBe('cannot_complete');

    const { s: second } = stopAtTask();
    second.handleLine('/cannot-complete I do not have access');
    expect(second.app?.manualTask()?.blockerNote).toContain('access');
  });

  it('C cancels the run canonically', () => {
    const { s } = stopAtTask();
    const cancelled = s.handleLine('c');
    expect(cancelled.lines.join('\n')).toContain('Cancelled');
    expect(s.app?.status()?.status).toBe('cancelled');
    expect(s.app?.manualTask()?.status).toBe('cancelled');
  });

  it('single-letter shortcuts stay inert when no manual task is active', () => {
    const repair = createSession({ render: RENDER_PLAIN, scenarioName: 'repair', interactiveBlueprint: false, ...det() });
    repair.handleLine('objective');
    const midRun = repair.handleLine('d');
    expect(midRun.lines.join('\n')).toContain('Run already exists');
    expect(repair.handleLine('/done').lines.join('\n')).toContain('No manual task');

    const manual = session();
    manual.handleLine('objective');
    // Run created but not yet driven to the checkpoint — still inert.
    expect(manual.handleLine('h').lines.join('\n')).toContain('Run already exists');
  });

  it('renderManualTask stays honest for non-pending states', () => {
    const { s } = stopAtTask();
    s.handleLine('n');
    const view = renderManualTask(s.app!);
    const text = view.join('\n');
    expect(text).toContain('You said you cannot do this.');
    expect(text).not.toContain('[D] Done');
    for (const line of view) expect(line.length, line).toBeLessThanOrEqual(80);
  });
});
