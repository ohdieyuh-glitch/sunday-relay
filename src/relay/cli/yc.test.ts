import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../core/app';
import { runScenarioToCompletion, parseCli } from './main';
import { buildPresentationFrames } from './presentation';
import { deterministicIds, testClock } from '../testing/factories';

const RENDER = { color: false, mascot: false, plain: true, json: false, width: 80 };
const det = () => {
  const clock = testClock('2026-07-22T09:00:00.000Z', 1000);
  return { ids: deterministicIds(), now: () => clock.now() };
};
const run = () => runScenarioToCompletion({ scenarioName: 'yc', render: RENDER, ...det() });

describe('YC scenario', () => {
  it('is registered with the presentation objective and parses from the CLI', () => {
    expect(SCENARIOS.yc).toBeDefined();
    expect(SCENARIOS.yc.displayObjective).toContain('anonymous live-access activation');
    expect(SCENARIOS.yc.taskObjective).toContain('NOT performed');
    expect(parseCli(['demo', 'yc'])).toMatchObject({ command: 'demo', scenario: 'yc' });
    expect(parseCli(['demo', 'yc', '--presentation', '--pace', '0'])).toMatchObject({ presentation: true, pace: 0 });
    expect(parseCli(['demo', 'yc', '--pace=-5']).error).toContain('non-negative');
  });

  it('completes through the real orchestrator: one repair, same session, independent reviewer, exit 0', () => {
    const outcome = run();
    expect(outcome.finalStatus).toBe('completed');
    expect(outcome.exitCode).toBe(0);
    const audit = outcome.app.audit()!;
    expect(audit.repairCount).toBe(1);
    expect(audit.sessionRefs).toHaveLength(1); // same session resumed
    expect(audit.identities?.reviewer).not.toBe(audit.identities?.codingAgent);
    expect(audit.simulationNotice).toContain('SIMULATED');
    expect(audit.claimPromotions?.every((p) => p.decision === 'promoted')).toBe(true);
    // 12 pass + 1 fail on attempt 1; 13 pass on attempt 2 (policy-driven, simulated)
    const evidence = outcome.app.evidence();
    expect(evidence).toHaveLength(26);
    expect(evidence.filter((e) => e.status === 'failed')).toHaveLength(1);
    expect(evidence.find((e) => e.status === 'failed')?.command).toBe('anonymous spend-control proof');
  });

  it('presentation frames show every required moment in order, 80-column safe, simulation-labeled', () => {
    const outcome = run();
    const frames = buildPresentationFrames(outcome.app, RENDER);
    const labels = frames.map((f) => f.label);
    expect(labels).toEqual(['opening', 'objective', 'brain', 'blueprint', 'owner', 'handoff', 'attempt1', 'verify1', 'review1', 'repair', 'verify2', 'review2', 'audit', 'complete']);
    const text = frames.flatMap((f) => f.lines).join('\n');
    expect(text).toContain('SIMULATED AGENT EXECUTION');
    expect(text).toContain('NO REPOSITORY FILES WILL BE MODIFIED');
    expect(text).toContain('PROJECT BRAIN');
    expect(text).toContain('HANDOFF PACKAGE — CODING AGENT');
    expect(text).toContain('never a transcript');
    expect(text).toContain('12 checks passed.');
    expect(text).toContain('[FAIL] anonymous spend-control proof');
    expect(text).toContain('Anonymous spend-boundary bypass');
    expect(text).toContain('One bounded repair authorized');
    expect(text).toContain('13 checks passed.');
    expect(text).toContain('RELAY COMPLETE');
    expect(text).toContain('[PASS] CompletionPolicy satisfied');
    for (const line of frames.flatMap((f) => f.lines)) {
      expect(line.length, line).toBeLessThanOrEqual(100); // no-color plain lines
    }
    // Presentation hides internal noise but full events stay queryable:
    expect(text).not.toContain('ledger.claim_recorded');
    expect(outcome.app.events(0).length).toBeGreaterThan(30);
  });

  it('presentation is renderer-only: JSON mode stays clean and semantics repeat', () => {
    const a = run();
    const b = run();
    const semantic = (o: typeof a) => ({ status: o.finalStatus, exit: o.exitCode, repairs: o.app.audit()?.repairCount, kinds: o.app.events(0).map((e) => e.kind) });
    expect(semantic(b)).toEqual(semantic(a));
    const raw = JSON.stringify(a.json);
    expect(raw).not.toContain('');
    expect(JSON.parse(raw).finalStatus).toBe('completed');
  });

  it('honest failure paths keep their exit codes (presentation never rewrites outcomes)', () => {
    const failure = runScenarioToCompletion({ scenarioName: 'failure', render: RENDER, ...det() });
    const frames = buildPresentationFrames(failure.app, RENDER);
    expect(frames.at(-1)?.label).toBe('stopped');
    expect(frames.flatMap((f) => f.lines).join('\n')).toContain('RELAY STOPPED SAFELY');
    expect(failure.exitCode).not.toBe(0);
  });
});
