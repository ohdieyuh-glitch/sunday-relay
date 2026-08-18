/**
 * AGENT PROGRESSION — the projection of the XP ledger.
 *
 * The tests derive their data THROUGH the real store (`appendXp` /
 * `readXpLedger`) rather than hand-built ledgers wherever the round-trip
 * matters, so the projection is proven over what the store actually holds.
 */

import { describe, expect, it } from 'vitest';
import { createInMemoryDurableBacking } from '../durable';
import { createDuelStore, type AgentXpLedger } from './duel-store';
import {
  BASE_AUTONOMOUS_RUN_TURN_CAP,
  COMMAND_UNLOCK_LEVELS,
  LEVEL_XP_THRESHOLDS,
  MAX_LEVEL,
  autonomousRunTurnCapForLevel,
  deriveAgentProgression,
  earnedChakraTierForLevel,
  evaluationDepthForLevel,
  isCommandUnlocked,
  levelForXp,
  resolveCommandForAgent,
  unlockedCommandsForLevel,
} from './agent-progression';
import { resolveCommand, type DuelTracePort } from './duel-commands';
import { CHAKRA_TIERS, preferredChakraTier } from '../../shared/relay-chakra';

const emptyLedger = (agentId = 'agent-x'): AgentXpLedger => ({ agentId, entries: [] });
const ledgerWith = (xp: number, agentId = 'agent-x'): AgentXpLedger => ({
  agentId,
  entries: [{ duelId: 'd-1', xp, awardedAt: '2026-08-18T00:00:00.000Z', summary: 's' }],
});

describe('level curve — boundaries bite exactly at the thresholds', () => {
  it('the curve is strictly increasing from zero', () => {
    expect(LEVEL_XP_THRESHOLDS[0]).toBe(0);
    for (let i = 1; i < LEVEL_XP_THRESHOLDS.length; i += 1) {
      expect(LEVEL_XP_THRESHOLDS[i]).toBeGreaterThan(LEVEL_XP_THRESHOLDS[i - 1]);
    }
  });

  it('every threshold is the exact boundary: one below stays, at crosses', () => {
    for (let level = 1; level <= MAX_LEVEL; level += 1) {
      const t = LEVEL_XP_THRESHOLDS[level];
      expect(levelForXp(t - 1)).toBe(level - 1);
      expect(levelForXp(t)).toBe(level);
    }
  });

  it('zero XP is level 0; beyond the last threshold stays MAX_LEVEL', () => {
    expect(levelForXp(0)).toBe(0);
    expect(levelForXp(LEVEL_XP_THRESHOLDS[MAX_LEVEL] * 10)).toBe(MAX_LEVEL);
  });

  it('a negative or non-finite total clamps to level 0, never throws', () => {
    expect(levelForXp(-5)).toBe(0);
    expect(levelForXp(Number.NaN)).toBe(0);
  });
});

describe('earned chakra tier — null is first-class at level 0', () => {
  it('level 0 / zero XP earns NO tier (null, not root)', () => {
    expect(earnedChakraTierForLevel(0)).toBeNull();
    expect(deriveAgentProgression(emptyLedger()).earnedChakraTier).toBeNull();
  });

  it('levels 1–7 map one-to-one onto the seven tiers in order', () => {
    for (let level = 1; level <= 7; level += 1) {
      expect(earnedChakraTierForLevel(level)).toBe(CHAKRA_TIERS[level - 1]);
    }
  });

  it('levels past crown stay crown — no eighth tier is invented', () => {
    expect(earnedChakraTierForLevel(8)).toBe('crown');
    expect(earnedChakraTierForLevel(MAX_LEVEL)).toBe('crown');
  });
});

describe('capability grants', () => {
  it('turn cap grows from the automation-fight base, one per level', () => {
    expect(autonomousRunTurnCapForLevel(0)).toBe(BASE_AUTONOMOUS_RUN_TURN_CAP);
    expect(autonomousRunTurnCapForLevel(3)).toBe(BASE_AUTONOMOUS_RUN_TURN_CAP + 3);
  });

  it('evaluation depth is 1 at the floor and deepens every two levels', () => {
    expect(evaluationDepthForLevel(0)).toBe(1);
    expect(evaluationDepthForLevel(1)).toBe(1);
    expect(evaluationDepthForLevel(2)).toBe(2);
    expect(evaluationDepthForLevel(6)).toBe(4);
  });

  it('the bound basics are open at level 0; SWARM needs level 8', () => {
    expect(unlockedCommandsForLevel(0)).toEqual(['TRACE', 'SB', 'VERIFY']);
    expect(isCommandUnlocked('SWARM', 7)).toBe(false);
    expect(isCommandUnlocked('SWARM', 8)).toBe(true);
    expect(unlockedCommandsForLevel(MAX_LEVEL)).toHaveLength(
      Object.keys(COMMAND_UNLOCK_LEVELS).length,
    );
  });
});

describe('unlock gating composes with binding state truthfully', () => {
  it('a LOCKED command refuses and names the required level', () => {
    const result = resolveCommandForAgent('RED', {}, 0);
    expect(result.executed).toBe(false);
    if (!result.executed) expect(result.refusal).toContain('level 2');
  });

  it('an unlocked-but-UNBOUND command still refuses — an unlock is not an engine', () => {
    const result = resolveCommandForAgent('RED', {}, MAX_LEVEL);
    expect(result.executed).toBe(false);
    if (!result.executed) expect(result.refusal).toContain('no engine');
  });

  it('an unlocked-but-UNWIRED bound command still refuses at this root', () => {
    const result = resolveCommandForAgent('TRACE', {}, 0);
    expect(result.executed).toBe(false);
    if (!result.executed) expect(result.refusal).toContain('no engine was wired');
  });

  it('an unlocked, bound, wired command dispatches exactly like resolveCommand', () => {
    const trace: DuelTracePort = { readEntries: async () => [] };
    expect(resolveCommandForAgent('TRACE', { trace }, 0)).toEqual(
      resolveCommand('TRACE', { trace }),
    );
  });
});

describe('earned-over-chosen (shared relay-chakra helper)', () => {
  it('an earned tier outranks any chosen appearance', () => {
    expect(preferredChakraTier('heart', 'crown')).toBe('heart');
  });

  it('with nothing earned, the chosen tier stands as appearance', () => {
    expect(preferredChakraTier(null, 'throat')).toBe('throat');
  });

  it('neither earned nor a valid chosen tier is null — never defaulted to root', () => {
    expect(preferredChakraTier(null, null)).toBeNull();
    expect(preferredChakraTier(null, 'not-a-tier')).toBeNull();
  });

  it('the demo-derived earned tier flows through the preference intact', async () => {
    const store = createDuelStore(createInMemoryDurableBacking());
    await store.appendXp('agent-p', {
      duelId: 'd-1', xp: 120, awardedAt: '2026-08-18T00:00:00.000Z', summary: 's',
    });
    const view = deriveAgentProgression(await store.readXpLedger('agent-p'));
    expect(view.earnedChakraTier).toBe('root');
    expect(preferredChakraTier(view.earnedChakraTier, 'crown')).toBe('root');
  });
});

describe('the view is a projection of the REAL ledger round-trip', () => {
  it('derives level, remainder and tier from XP appended through the store', async () => {
    const store = createDuelStore(createInMemoryDurableBacking());
    await store.appendXp('agent-r', {
      duelId: 'd-1', xp: 100, awardedAt: '2026-08-18T00:00:00.000Z', summary: 'first duel',
    });
    await store.appendXp('agent-r', {
      duelId: 'd-2', xp: 175, awardedAt: '2026-08-18T01:00:00.000Z', summary: 'second duel',
    });
    const view = deriveAgentProgression(await store.readXpLedger('agent-r'));
    expect(view).toEqual({
      agentId: 'agent-r',
      totalXp: 275,
      level: 2, // 275 ≥ 250, < 500
      xpIntoLevel: 25,
      xpToNextLevel: 225,
      earnedChakraTier: 'sacral',
      autonomousRunTurnCap: BASE_AUTONOMOUS_RUN_TURN_CAP + 2,
      evaluationDepth: 2,
      unlockedCommands: ['TRACE', 'SB', 'VERIFY', 'RED'],
    });
  });

  it('an agent with no ledger is level 0, tier null — nothing is defaulted', async () => {
    const store = createDuelStore(createInMemoryDurableBacking());
    const view = deriveAgentProgression(await store.readXpLedger('agent-none'));
    expect(view.totalXp).toBe(0);
    expect(view.level).toBe(0);
    expect(view.earnedChakraTier).toBeNull();
    expect(view.xpToNextLevel).toBe(100);
  });

  it('xpToNextLevel is null AT max level — no next level is invented', () => {
    const view = deriveAgentProgression(ledgerWith(LEVEL_XP_THRESHOLDS[MAX_LEVEL]));
    expect(view.level).toBe(MAX_LEVEL);
    expect(view.xpToNextLevel).toBeNull();
    expect(view.xpIntoLevel).toBe(0);
  });

  it('the same ledger always derives the same view (pure projection)', () => {
    const ledger = ledgerWith(999);
    expect(deriveAgentProgression(ledger)).toEqual(deriveAgentProgression(ledger));
  });
});
