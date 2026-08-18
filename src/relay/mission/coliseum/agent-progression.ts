/**
 * WONDERLAND COLISEUM — AGENT PROGRESSION (PURE, DERIVED, TRUTHFUL).
 *
 * Earned XP becomes levels, capability grants, and an EARNED chakra tier.
 * Everything here is a PROJECTION of the append-only XP ledger
 * (`duel-store.ts` — single writer `concludeDuelAndAward`): nothing is stored
 * redundantly, no level is persisted, and re-deriving from the same ledger
 * always yields the same view. No clock, no I/O, no randomness.
 *
 * THE CURVE (documented, deterministic):
 * Cumulative thresholds, doubling from level 2 upward:
 *
 *   level      0    1    2    3     4     5     6     7      8      9     10
 *   threshold  0  100  250  500  1000  2000  4000  8000  16000  32000  64000
 *
 * Why: ~100 XP is roughly ONE strong duel (verified proof + the 50-XP
 * opponent-fix bonus + the 25-XP winner bonus), so level 1 is earned by the
 * first genuinely proven fight. Doubling thereafter means each level costs
 * about as much as all previous play combined — early levels arrive quickly
 * enough to feel real, late levels stay scarce enough that a high level is
 * evidence of sustained verified work, never grind inflation. Eleven positions
 * (0–10) give the seven chakra tiers room plus post-crown headroom.
 *
 * EARNED CHAKRA TIER: levels 1–7 map one-to-one onto the seven CHAKRA_TIERS
 * (root … crown, in order); levels 8–10 remain crown — there is no eighth
 * tier and this module will not invent one. Level 0 (including zero XP) earns
 * NO tier: `null` is the first-class answer, never defaulted to root, for the
 * same reason `relay-chakra.ts` refuses to default a chosen tier.
 *
 * CAPABILITY GRANTS:
 * - autonomousRunTurnCap = BASE (2, the demonstration automation-fight
 *   default) + 1 per level — longer autonomous runs are the primary reward.
 * - evaluationDepth = 1 + floor(level / 2) — deeper evaluation every two
 *   levels; depth 1 is the floor every agent has.
 * - Command unlocks gate USER ACCESS to a console command. They compose with
 *   binding state truthfully and never override it: an unlocked-but-UNBOUND
 *   command still refuses through `resolveCommand` — an unlock is permission
 *   to ask, never an engine. SPECIFIED is not IMPLEMENTED.
 */

import { CHAKRA_TIERS, type ChakraTier } from '../../shared/relay-chakra';
import { totalXp, type AgentXpLedger } from './duel-store';
import {
  resolveCommand,
  type DuelCommandExecution,
  type DuelCommandName,
  type DuelEnginePorts,
} from './duel-commands';

/* ------------------------------------------------------------------ curve */

/** Cumulative XP required to REACH each level. Index = level. */
export const LEVEL_XP_THRESHOLDS: readonly number[] = [
  0, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000,
];

export const MAX_LEVEL = LEVEL_XP_THRESHOLDS.length - 1;

/** Total XP → level. Negative or non-finite totals cannot occur from the
    ledger (rewards floor at zero), but are clamped to level 0 defensively. */
export function levelForXp(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  let level = 0;
  for (let i = 0; i < LEVEL_XP_THRESHOLDS.length; i += 1) {
    if (total >= LEVEL_XP_THRESHOLDS[i]) level = i;
  }
  return level;
}

/* ----------------------------------------------------------------- grants */

/** The demonstration automation-fight turn cap — the base every agent has. */
export const BASE_AUTONOMOUS_RUN_TURN_CAP = 2;

export function autonomousRunTurnCapForLevel(level: number): number {
  return BASE_AUTONOMOUS_RUN_TURN_CAP + Math.max(0, level);
}

export function evaluationDepthForLevel(level: number): number {
  return 1 + Math.floor(Math.max(0, level) / 2);
}

/**
 * NAMED COMMAND UNLOCK POINTS. The three bound basics are open from the
 * start; the specified-only commands unlock as secondary rewards on the way
 * up. Unlocking does NOT bind: every command below the table's `unbound` line
 * in `duel-commands.ts` still refuses at dispatch until an engine exists.
 */
export const COMMAND_UNLOCK_LEVELS: Readonly<Record<DuelCommandName, number>> = Object.freeze({
  TRACE: 0,
  SB: 0,
  VERIFY: 0,
  RED: 2,
  FORK: 3,
  GUARD: 4,
  ROLLBACK: 5,
  DEEP: 6,
  SWARM: 8,
});

export function isCommandUnlocked(name: DuelCommandName, level: number): boolean {
  return level >= COMMAND_UNLOCK_LEVELS[name];
}

export function unlockedCommandsForLevel(level: number): readonly DuelCommandName[] {
  return (Object.keys(COMMAND_UNLOCK_LEVELS) as DuelCommandName[]).filter((name) =>
    isCommandUnlocked(name, level),
  );
}

/**
 * Resolves a command FOR AN AGENT: the unlock gate first (a locked command is
 * a truthful refusal naming the level it needs), then the existing binding
 * resolution unchanged — so an unlocked-but-unbound command still refuses,
 * and an unlock can never conjure an engine.
 */
export function resolveCommandForAgent(
  name: DuelCommandName,
  ports: DuelEnginePorts,
  level: number,
): DuelCommandExecution {
  if (!isCommandUnlocked(name, level)) {
    return {
      executed: false,
      refusal:
        `${name} is locked at level ${level} — it unlocks at level ` +
        `${COMMAND_UNLOCK_LEVELS[name]} (earned through the Coliseum XP ledger)`,
    };
  }
  return resolveCommand(name, ports);
}

/* ------------------------------------------------------------ earned tier */

/** Level → earned chakra tier. Level 0 earns NO tier — null, first-class.
    Levels 1–7 are root…crown in order; 8+ stays crown. */
export function earnedChakraTierForLevel(level: number): ChakraTier | null {
  if (level < 1) return null;
  return CHAKRA_TIERS[Math.min(level, CHAKRA_TIERS.length) - 1];
}

/* ------------------------------------------------------------------- view */

export interface AgentProgressionView {
  readonly agentId: string;
  readonly totalXp: number;
  readonly level: number;
  /** XP earned past this level's threshold. */
  readonly xpIntoLevel: number;
  /** XP still needed for the next level; null AT max level — there is no
      next level to invent a number for. */
  readonly xpToNextLevel: number | null;
  /** Earned, never chosen. null = level 0, nothing earned yet. */
  readonly earnedChakraTier: ChakraTier | null;
  readonly autonomousRunTurnCap: number;
  readonly evaluationDepth: number;
  readonly unlockedCommands: readonly DuelCommandName[];
}

/** The whole progression as a projection of one agent's real ledger. */
export function deriveAgentProgression(ledger: AgentXpLedger): AgentProgressionView {
  // Clamp once here so EVERY derived figure (not just the level) is sane if a
  // ledger ever held a negative or non-finite total; unreachable via the single
  // writer today, which floors reward XP at zero.
  const rawTotal = totalXp(ledger);
  const total = Number.isFinite(rawTotal) ? Math.max(0, rawTotal) : 0;
  const level = levelForXp(total);
  return {
    agentId: ledger.agentId,
    totalXp: total,
    level,
    xpIntoLevel: total - LEVEL_XP_THRESHOLDS[level],
    xpToNextLevel: level >= MAX_LEVEL ? null : LEVEL_XP_THRESHOLDS[level + 1] - total,
    earnedChakraTier: earnedChakraTierForLevel(level),
    autonomousRunTurnCap: autonomousRunTurnCapForLevel(level),
    evaluationDepth: evaluationDepthForLevel(level),
    unlockedCommands: unlockedCommandsForLevel(level),
  };
}
