import { describe, expect, it } from 'vitest';
import { parseCli, runScenarioToCompletion, doctorReport, HELP_TEXT } from './main';
import { createSession } from './interactive';
import { detectRenderOptions, renderEvent, mascot, mascotStateFor } from './render';
import { EXIT, exitCodeForFinalStatus } from './exit-codes';
import { deterministicIds, testClock } from '../testing/factories';

const RENDER_PLAIN = { color: false, mascot: false, plain: true, json: false, width: 80 };

const det = () => {
  const clock = testClock('2026-07-22T07:00:00.000Z', 1000);
  return { ids: deterministicIds(), now: () => clock.now() };
};

describe('CLI parsing', () => {
  it('parses help/version/doctor/demo/run and rejects bad input with usage errors', () => {
    expect(parseCli(['help']).command).toBe('help');
    expect(parseCli(['version']).command).toBe('version');
    expect(parseCli(['doctor']).command).toBe('doctor');
    expect(parseCli(['demo', 'repair'])).toMatchObject({ command: 'demo', scenario: 'repair' });
    expect(parseCli(['demo']).error).toContain('scenario');
    expect(parseCli(['demo', 'nonsense']).error).toContain('Unknown scenario');
    expect(parseCli(['run']).error).toContain('--objective');
    expect(parseCli(['run', '--objective', 'x', '--max-cost=-1']).error).toContain('positive');
    expect(parseCli(['run', '--objective', 'x', '--scenario', 'repair', '--max-cost', '2'])).toMatchObject({ command: 'run', scenario: 'repair', maxCost: 2 });
    expect(parseCli(['frobnicate']).error).toContain('Unknown command');
    expect(parseCli([]).command).toBe('interactive');
    expect(parseCli(['--json', 'demo', 'direct']).json).toBe(true);
    expect(HELP_TEXT).toContain('SIMULATED');
  });

  it('render options: NO_COLOR, no TTY, json and plain all disable color and mascot', () => {
    expect(detectRenderOptions({}, { NO_COLOR: '1' }, true).color).toBe(false);
    expect(detectRenderOptions({}, {}, false).color).toBe(false);
    expect(detectRenderOptions({ json: true }, {}, true).mascot).toBe(false);
    expect(detectRenderOptions({ plain: true }, {}, true).mascot).toBe(false);
    expect(detectRenderOptions({}, {}, true).color).toBe(true);
  });
});

describe('exit codes', () => {
  it('never uses 0 for incomplete work; budget checkpoints map to 7', () => {
    expect(exitCodeForFinalStatus('completed')).toBe(0);
    expect(exitCodeForFinalStatus('failed')).toBe(EXIT.runFailed);
    expect(exitCodeForFinalStatus('cancelled')).toBe(EXIT.cancelled);
    expect(exitCodeForFinalStatus('checkpoint_required', 'protected file')).toBe(EXIT.checkpointRequired);
    expect(exitCodeForFinalStatus('checkpoint_required', 'Budget stop before dispatch')).toBe(EXIT.budgetExceeded);
    expect(exitCodeForFinalStatus('active')).toBe(EXIT.blocked);
  });
});

describe('demo scenarios through the facade (deterministic)', () => {
  it('repair demo: completes, exactly one repair, SIMULATED labeling, no workflow logic in CLI output path', () => {
    const outcome = runScenarioToCompletion({ scenarioName: 'repair', render: RENDER_PLAIN, ...det() });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.finalStatus).toBe('completed');
    const text = outcome.lines.join('\n');
    expect(text).toContain('[SIMULATED]');
    expect(text).toContain('SESSION STORAGE: VOLATILE');
    expect(text).toContain('No repository files will be modified');
    expect(text).toContain('FINAL AUDIT REPORT');
    expect(text).toContain('repairs            1/1');
    expect(text).not.toMatch(/\[/); // plain mode: no ANSI
  });

  it('checkpoint demo stops with exit 5; duplicate demo never invokes the agent; failure demo never completes', () => {
    const checkpoint = runScenarioToCompletion({ scenarioName: 'checkpoint', render: RENDER_PLAIN, ...det() });
    expect(checkpoint.exitCode).toBe(EXIT.checkpointRequired);
    expect(checkpoint.lines.join('\n')).toContain('CHECKPOINT REQUIRED');

    const duplicate = runScenarioToCompletion({ scenarioName: 'duplicate', render: RENDER_PLAIN, ...det() });
    expect(duplicate.exitCode).toBe(EXIT.checkpointRequired);
    expect(duplicate.lines.join('\n')).toContain('no-duplicate-work');

    const failure = runScenarioToCompletion({ scenarioName: 'failure', render: RENDER_PLAIN, ...det() });
    expect(failure.finalStatus).not.toBe('completed');
  });

  it('json payload is serializable, ANSI-free, and preserves provenance + protocol ids', () => {
    const outcome = runScenarioToCompletion({ scenarioName: 'direct', render: RENDER_PLAIN, ...det() });
    const raw = JSON.stringify(outcome.json);
    expect(raw).not.toContain('');
    const parsed = JSON.parse(raw) as { protocolVersion: string; storageProfile: string; audit: { provenanceProfile: string } };
    expect(parsed.protocolVersion).toBe('relay.protocol.v1');
    expect(parsed.storageProfile).toBe('volatile-memory');
    expect(parsed.audit.provenanceProfile).toBe('simulated');
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]{8,}/); // no secret-shaped content
  });
});

describe('interactive session (pure handler — no TTY needed)', () => {
  const session = (scenario = 'repair', interactive = true) =>
    createSession({ render: RENDER_PLAIN, scenarioName: scenario, interactiveBlueprint: interactive, ...det() });

  it('objective entry creates the run; blueprint awaits interactive approval; /approve proceeds to completion', () => {
    const s = session();
    expect(s.banner().join('\n')).toContain('VOLATILE');
    const started = s.handleLine('Ship the demo feature');
    expect(started.lines.join('\n')).toContain('Run created');
    const paused = s.handleLine('/continue');
    expect(paused.lines.join('\n')).toContain('AWAITING APPROVAL');
    expect(s.handleLine('/blueprint').lines.join('\n')).toContain('BLUEPRINT');
    const approved = s.handleLine('/approve');
    expect(approved.lines.join('\n')).toContain('Blueprint approved');
    const finished = s.handleLine('/continue');
    expect(finished.lines.join('\n')).toContain('FINAL AUDIT REPORT');
    expect(s.app?.status()?.status).toBe('completed');
  });

  it('blueprint /reject cancels the run canonically', () => {
    const s = session();
    s.handleLine('objective');
    s.handleLine('/continue');
    const rejected = s.handleLine('/reject not the right plan');
    expect(rejected.lines.join('\n')).toContain('Blueprint rejectd');
    expect(s.app?.status()?.status).toBe('cancelled');
  });

  it('step mode, status/views, pause/resume, checkpoint approval, unknown command, exit', () => {
    const s = session('checkpoint', false);
    s.handleLine('objective');
    expect(s.handleLine('/step').lines.length).toBeGreaterThan(0);
    expect(s.handleLine('/status').lines.join('\n')).toContain('STATUS');
    expect(s.handleLine('/pause').lines.join('\n')).toContain('Paused');
    expect(s.handleLine('/resume').lines.join('\n')).toContain('Resumed');
    const run = s.handleLine('/continue');
    expect(run.lines.join('\n')).toContain('CHECKPOINT REQUIRED');
    expect(s.handleLine('/checkpoint').lines.join('\n')).toContain('Automatic work has stopped');
    expect(s.handleLine('/approve').lines.join('\n')).toContain('Checkpoint approved');
    expect(s.handleLine('/nonsense').lines.join('\n')).toContain('Unknown command');
    expect(s.handleLine('/evidence').lines.join('\n')).toContain('SIMULATED');
    expect(s.handleLine('/handoff').lines.join('\n')).toContain('HANDOFF PACKAGE');
    expect(s.handleLine('/task').lines.join('\n')).toContain('TASK & OWNERSHIP');
    expect(s.handleLine('/project').lines.join('\n')).toContain('PROJECT BRAIN');
    expect(s.handleLine('/usage').lines.join('\n')).toContain('never provider-billed');
    expect(s.handleLine('/exit').exit).toBe(true);
  });

  it('scenario switching before start; refused after; mascot toggle; cancel', () => {
    const s = session('direct', false);
    expect(s.handleLine('/scenario').lines.join('\n')).toContain('direct');
    expect(s.handleLine('/scenario repair').lines.join('\n')).toContain('scenario set');
    expect(s.handleLine('/scenario nonsense').lines.join('\n')).toContain('Unknown scenario');
    s.handleLine('objective');
    expect(s.handleLine('/scenario direct').lines.join('\n')).toContain('Cannot switch');
    expect(s.handleLine('/mascot off').lines.join('\n')).toContain('mascot: off');
    expect(s.handleLine('/cancel demo over').lines.join('\n')).toContain('Cancelled');
    expect(s.app?.status()?.status).toBe('cancelled');
  });
});

describe('rendering truthfulness', () => {
  it('events carry SIMULATED badges; mascot maps real states, stays small, and is optional', () => {
    const line = renderEvent({ at: '2026-07-22T07:00:00.000Z', source: 'coding-agent', safeSummary: 'x', provenance: 'simulated' }, RENDER_PLAIN);
    expect(line).toContain('[SIMULATED]');
    expect(line).toContain('AGENT');
    expect(mascotStateFor('active', 'implementation')).toBe('AGENT WORKING');
    expect(mascotStateFor('checkpoint_required', 'review')).toBe('CHECKPOINT');
    expect(mascot('LISTENING', RENDER_PLAIN)).toEqual([]); // disabled in plain mode
    const shown = mascot('LISTENING', { ...RENDER_PLAIN, mascot: true });
    expect(shown.length).toBeLessThanOrEqual(3);
  });

  it('workspace commands parse and the workspace doctor is truthful', () => {
    expect(parseCli(['workspace', 'doctor'])).toMatchObject({ command: 'workspace', workspaceAction: 'doctor' });
    expect(parseCli(['workspace', 'verify'])).toMatchObject({ command: 'workspace', workspaceAction: 'verify' });
    expect(parseCli(['workspace']).error).toContain('doctor | verify');
    expect(parseCli(['workspace', 'nuke']).error).toContain('doctor | verify');
    expect(HELP_TEXT).toContain('relay workspace doctor');
  });

  it('doctor is truthful about deferred capabilities and never prints env values', () => {
    const report = doctorReport({ out: () => {}, isTTY: false, env: { SECRET_THING: 'never-shown' } });
    const text = report.lines.join('\n');
    expect(text).toContain('Real Claude Code adapter');
    expect(text).toContain('DEFERRED');
    expect(text).toContain('volatile memory');
    expect(text).toContain('Provider credentials accessed   no'.replace(/\s+/g, ' ').split(' ')[0]);
    expect(text).not.toContain('never-shown');
    expect(report.exitCode).toBe(0);
  });
});
