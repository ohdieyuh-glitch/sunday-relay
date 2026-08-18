import { describe, expect, it } from 'vitest';

import {
  DUEL_COMMANDS,
  DUEL_COMMAND_NAMES,
  commandSpec,
  planAutomationFight,
  resolveCommand,
  type DuelEnginePorts,
} from './duel-commands';
import { ACTIVE_AUTOMATION_FIGHT, CHALLENGED_DUEL, CONCLUDED_MANUAL_DUEL } from './duel-fixtures';
import { provisionSandbox, type SandboxProvisioned } from './duel-sandbox';
import { createInMemoryDurableBacking } from '../durable';
import { createDuelStore } from './duel-store';
import { money } from '../economics/money';

describe('the command table tells the truth about bindings', () => {
  it('covers all nine commands exactly once', () => {
    expect(DUEL_COMMANDS.map((c) => c.name).sort()).toEqual([...DUEL_COMMAND_NAMES].sort());
    expect(new Set(DUEL_COMMANDS.map((c) => c.name)).size).toBe(9);
  });

  it('declares exactly TRACE, SB and VERIFY bound — the engines that exist on main', () => {
    const bound = DUEL_COMMANDS.filter((c) => c.binding === 'bound').map((c) => c.name).sort();
    expect(bound).toEqual(['SB', 'TRACE', 'VERIFY']);
  });

  it('every bound command names an engine port; every unbound command has none', () => {
    for (const spec of DUEL_COMMANDS) {
      if (spec.binding === 'bound') expect(spec.enginePort).not.toBeNull();
      else expect(spec.enginePort).toBeNull();
    }
  });

  it('every unbound description admits no engine exists — SPECIFIED is not IMPLEMENTED', () => {
    for (const spec of DUEL_COMMANDS.filter((c) => c.binding === 'unbound')) {
      expect(spec.description).toMatch(/SPECIFIED only/);
      expect(spec.description).toMatch(/no .* engine exists on main/i);
    }
  });
});

describe('executing commands', () => {
  const wiredPorts: DuelEnginePorts = {
    trace: { readEntries: async () => [] },
    sandboxRepair: {
      runRepairPass: async () => ({ outcome: 'unknown', summary: 'not run' }),
    },
    verify: {
      verify: async () => ({ verdict: 'unknown', verifierId: 'reviewer-x' }),
    },
  };

  it('an unbound command returns a truthful refusal, never a simulated result', () => {
    const result = resolveCommand('RED', wiredPorts);
    expect(result.executed).toBe(false);
    if (!result.executed) expect(result.refusal).toContain('no engine on main');
  });

  it('a bound command whose port is not wired here is ALSO refused', () => {
    const result = resolveCommand('TRACE', {});
    expect(result.executed).toBe(false);
    if (!result.executed) expect(result.refusal).toContain('no engine was wired');
  });

  it('a bound, wired command dispatches to its named port', () => {
    expect(resolveCommand('TRACE', wiredPorts)).toEqual({ executed: true, enginePort: 'trace' });
    expect(resolveCommand('SB', wiredPorts)).toEqual({ executed: true, enginePort: 'sandboxRepair' });
    expect(resolveCommand('VERIFY', wiredPorts)).toEqual({ executed: true, enginePort: 'verify' });
  });

  it('commandSpec resolves every name', () => {
    for (const name of DUEL_COMMAND_NAMES) expect(commandSpec(name).name).toBe(name);
  });
});

describe('automation fight planning', () => {
  const loopPorts: DuelEnginePorts = {
    automationLoop: {
      runIteration: async () => ({ outcome: 'completed', summary: 'one pass', costMicros: null }),
    },
  };
  const limits = { turnCap: 5, budgetCap: money('USD', '2000000') };

  /** Fresh, registry-checked sandboxes matching the fixture's recorded facts —
      what a composition root produces by (re-)provisioning in this process. */
  const freshSandboxes = (): readonly [SandboxProvisioned, SandboxProvisioned] => [
    provisionSandbox({
      sourceTargetRef: 'repo:red-target@main',
      sandboxCopyId: 'sandbox-red-001',
      provisionedAt: '2026-08-18T08:00:00.000Z',
    }),
    provisionSandbox({
      sourceTargetRef: 'repo:blue-target@main',
      sandboxCopyId: 'sandbox-blue-001',
      provisionedAt: '2026-08-18T08:00:02.000Z',
    }),
  ];

  it('plans one lane per participant, both under the same explicit limits', () => {
    const plan = planAutomationFight(ACTIVE_AUTOMATION_FIGHT, freshSandboxes(), limits, loopPorts);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.lanes.map((l) => l.participantId)).toEqual(['auto-red', 'auto-blue']);
      expect(plan.lanes.map((l) => l.sandboxCopyId)).toEqual(['sandbox-red-001', 'sandbox-blue-001']);
      expect(plan.limits.turnCap).toBe(5);
      expect(plan.limits.budgetCap).toEqual(money('USD', '2000000'));
    }
  });

  it('refuses a manual duel, an inactive duel, a missing turn cap, and a missing engine', () => {
    expect(planAutomationFight(CONCLUDED_MANUAL_DUEL, freshSandboxes(), limits, loopPorts).ok).toBe(false);
    expect(planAutomationFight(CHALLENGED_DUEL, freshSandboxes(), limits, loopPorts).ok).toBe(false);
    expect(planAutomationFight(ACTIVE_AUTOMATION_FIGHT, freshSandboxes(), { turnCap: 0, budgetCap: null }, loopPorts).ok).toBe(false);
    const noEngine = planAutomationFight(ACTIVE_AUTOMATION_FIGHT, freshSandboxes(), limits, {});
    expect(noEngine.ok).toBe(false);
    if (!noEngine.ok) expect(noEngine.reason).toContain('no autonomous loop engine');
  });

  it('a null budget cap is preserved as null — not treated as zero', () => {
    const plan = planAutomationFight(ACTIVE_AUTOMATION_FIGHT, freshSandboxes(), { turnCap: 3, budgetCap: null }, loopPorts);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.limits.budgetCap).toBeNull();
  });

  it('C-2: a persisted-then-reloaded active duel is refused until re-provisioned — forged sandbox facts never reach the planner', async () => {
    // Persist the active duel and reload it through the store, exactly as a
    // resumed (or forged) record would arrive: sandbox FACTS only, no
    // registry-backed SandboxProvisioned capability.
    const backing = createInMemoryDurableBacking();
    const store = createDuelStore(backing);
    expect((await store.writeDuel(ACTIVE_AUTOMATION_FIGHT)).ok).toBe(true);
    const read = await store.readDuel(ACTIVE_AUTOMATION_FIGHT.duelId);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    // Forged "sandboxes": shape-perfect literals cast past the brand.
    const forged = read.duel.sandboxes as unknown as readonly [SandboxProvisioned, SandboxProvisioned];
    const refused = planAutomationFight(read.duel, forged, limits, loopPorts);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('re-provisioned');

    // Re-provisioning in this process restores the capability.
    const replanned = planAutomationFight(read.duel, freshSandboxes(), limits, loopPorts);
    expect(replanned.ok).toBe(true);
  });

  it('fresh sandboxes that do not match the recorded facts are refused', () => {
    const mismatched: readonly [SandboxProvisioned, SandboxProvisioned] = [
      provisionSandbox({
        sourceTargetRef: 'repo:red-target@main',
        sandboxCopyId: 'sandbox-red-OTHER',
        provisionedAt: '2026-08-18T08:10:00.000Z',
      }),
      provisionSandbox({
        sourceTargetRef: 'repo:blue-target@main',
        sandboxCopyId: 'sandbox-blue-001',
        provisionedAt: '2026-08-18T08:10:02.000Z',
      }),
    ];
    const refused = planAutomationFight(ACTIVE_AUTOMATION_FIGHT, mismatched, limits, loopPorts);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('do not match');
  });
});
