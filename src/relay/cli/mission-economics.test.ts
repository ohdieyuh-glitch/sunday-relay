import { describe, expect, it } from 'vitest';

import {
  buildMissionEconomicsFixture,
  renderMissionBudget,
  renderMissionEconomics,
  renderMissionReceipts,
} from './mission-economics';
import { parseCli, runCli } from './main';

const WIDE = { width: 80, plain: true };
const NARROW = { width: 40, plain: true };

function capture() {
  const lines: string[] = [];
  return {
    io: { out: (line: string) => lines.push(line), isTTY: false, env: {} as NodeJS.ProcessEnv },
    text: () => lines.join('\n'),
    lines,
  };
}

describe('mission economics command parsing', () => {
  it.each(['economics', 'budget', 'receipts'] as const)('parses `mission %s`', (action) => {
    const parsed = parseCli(['mission', action]);
    expect(parsed.command).toBe('mission');
    expect(parsed.missionAction).toBe(action);
    expect(parsed.error).toBeUndefined();
  });

  it('rejects a missing or unknown action rather than guessing', () => {
    expect(parseCli(['mission']).error).toMatch(/economics, budget, or receipts/u);
    expect(parseCli(['mission', 'spend']).error).toMatch(/economics, budget, or receipts/u);
  });
});

describe('mission economics rendering', () => {
  const fixture = buildMissionEconomicsFixture();

  it('renders the shared projection with exact amounts', () => {
    const text = renderMissionEconomics(fixture.projection, WIDE).join('\n');
    expect(text).toContain('MISSION ECONOMICS');
    expect(text).toContain('$10.00'); // budget
    expect(text).toContain('$2.15'); // finalized actual
    expect(text).toContain('$7.85'); // remaining
    expect(text).toContain('UNDER BUDGET');
    expect(text).toContain('COST BREAKDOWN');
  });

  it('never fabricates $0.00 for a missing category', () => {
    const text = renderMissionEconomics(fixture.projection, WIDE).join('\n');
    expect(text).toContain('Not available');
    expect(text).not.toContain('$0.00');
  });

  it('renders the budget view with warning, approval, and hard-limit state', () => {
    const text = renderMissionBudget(fixture.projection, fixture.evaluation, WIDE).join('\n');
    expect(text).toContain('MISSION BUDGET');
    expect(text).toContain('Warning threshold');
    expect(text).toContain('not reached');
    expect(text).toContain('Approval');
    expect(text).toContain('not required');
    expect(text).toContain('Hard limit');
    expect(text).toContain('within limit');
    // Budget changes go through the canonical command, never a direct edit.
    expect(text).toContain('change_budget');
    expect(text).toContain('never edited directly');
  });

  it('renders safe receipt summaries with actual-agent attribution', () => {
    const text = renderMissionReceipts(fixture.receipts, WIDE).join('\n');
    expect(text).toContain('MISSION COST RECEIPTS');
    expect(text).toContain('r-plan');
    expect(text).toContain('actual agent');
    expect(text).toContain('agent-architect');
    expect(text).toContain('$0.20');
  });

  it('says so honestly when there are no receipts', () => {
    const text = renderMissionReceipts([], WIDE).join('\n');
    expect(text).toContain('not the same as $0.00 spent');
  });

  it('never prints a credential or raw metadata blob', () => {
    const text = [
      ...renderMissionEconomics(fixture.projection, WIDE),
      ...renderMissionBudget(fixture.projection, fixture.evaluation, WIDE),
      ...renderMissionReceipts(fixture.receipts, WIDE),
    ].join('\n');
    for (const pattern of [/\bsk-[A-Za-z0-9]{8,}/u, /Bearer\s+\S+/u, /-----BEGIN/u, /metadata/iu]) {
      expect(pattern.test(text), `output must not contain ${pattern}`).toBe(false);
    }
  });

  it('stays readable at a narrow terminal width', () => {
    const wide = renderMissionEconomics(fixture.projection, WIDE);
    const narrow = renderMissionEconomics(fixture.projection, NARROW);
    // Narrow mode stacks label and value instead of overflowing the column.
    expect(narrow.join('\n')).toContain('Budget:');
    for (const line of narrow.flatMap((l) => l.split('\n'))) {
      expect(line.length).toBeLessThanOrEqual(72);
    }
    expect(wide.length).toBeGreaterThan(0);
  });
});

describe('mission economics through the CLI entry', () => {
  it.each([
    ['economics', 'MISSION ECONOMICS'],
    ['budget', 'MISSION BUDGET'],
    ['receipts', 'MISSION COST RECEIPTS'],
  ] as const)('`relay mission %s` prints %s', async (action, heading) => {
    const { io, text } = capture();
    const code = await runCli(['mission', action], io);
    expect(code).toBe(0);
    expect(text()).toContain(heading);
  });

  it('an unknown action exits with a usage code and no economics output', async () => {
    const { io, text } = capture();
    const code = await runCli(['mission', 'spend'], io);
    expect(code).not.toBe(0);
    expect(text()).not.toContain('MISSION ECONOMICS');
  });

  it('produces the SAME semantic values the shared projection decided', async () => {
    const { io, text } = capture();
    await runCli(['mission', 'economics'], io);
    const fixture = buildMissionEconomicsFixture();
    // Every headline figure in the terminal came from the shared projection.
    expect(text()).toContain(fixture.projection.finalizedActualLabel);
    expect(text()).toContain(fixture.projection.projectedTotalLabel);
    expect(text()).toContain(fixture.projection.remainingLabel);
    expect(text()).toContain(fixture.projection.completenessLabel);
    expect(text()).toContain(fixture.projection.statusLabel.toUpperCase());
  });
});
