/**
 * SUNDAY RELAY — WONDERLAND COLISEUM (development fixtures).
 *
 * Simulated data, and it says so: every fixture carries the disclosure label
 * below, and the console renders it whenever a fixture is on screen. Normal
 * production navigation must never load these.
 *
 * The views are DERIVED through the real domain fixtures and the real
 * `projectDuelResults` projection (via the mission barrel), so they can never
 * drift from what the domain would actually produce.
 */

import {
  activeAutomationFightResults,
  challengedDuelResults,
  concludedManualDuelResults,
  deriveAgentProgression,
  type AgentProgressionView,
  type DuelResultsView,
  type XpLedgerEntry,
} from '../../mission';

export const COLISEUM_FIXTURE_DISCLOSURE =
  'Development fixture — simulated duel data, not a real Coliseum record.';

/** A duel that has only been challenged: nothing has run, nothing is scored. */
export const CHALLENGED_DUEL_FIXTURE: DuelResultsView = challengedDuelResults();

/** An automation fight mid-flight: nothing verified, nothing measured, no winner. */
export const ACTIVE_AUTOMATION_DUEL_FIXTURE: DuelResultsView = activeAutomationFightResults();

/** A concluded manual duel with a winner, verified work, and an applied fix. */
export const CONCLUDED_MANUAL_DUEL_FIXTURE: DuelResultsView = concludedManualDuelResults();

/* --------------------------------------------------------- progression */

/**
 * Progression fixtures are DERIVED through the real `deriveAgentProgression`
 * over hand-built ledgers, so every level, threshold remainder, tier, cap,
 * depth and unlock below is exactly what the real curve produces — no figure
 * here is hand-written. The XP amounts themselves are simulated, and the
 * disclosure banner says so wherever these render.
 */
const xp = (duelId: string, amount: number, summary: string): XpLedgerEntry => ({
  duelId,
  xp: amount,
  awardedAt: '2026-08-18T00:00:00.000Z',
  summary,
});

/** A brand-new agent: empty ledger, level 0, NO earned tier. */
export const FRESH_AGENT_PROGRESSION_FIXTURE: AgentProgressionView = deriveAgentProgression({
  agentId: 'fixture-agent-fresh',
  entries: [],
});

/** A mid-journey agent: two awards totalling 575 XP → level 3 on the curve. */
export const LEVELED_AGENT_PROGRESSION_FIXTURE: AgentProgressionView = deriveAgentProgression({
  agentId: 'fixture-agent-leveled',
  entries: [
    xp('fixture-duel-001', 175, 'Simulated: verified proof + winner bonus'),
    xp('fixture-duel-002', 400, 'Simulated: verified proof + opponent-fix bonus'),
  ],
});

/** A ledger past the top threshold: max level, xpToNextLevel is null. */
export const MAX_LEVEL_AGENT_PROGRESSION_FIXTURE: AgentProgressionView = deriveAgentProgression({
  agentId: 'fixture-agent-max',
  entries: [
    xp('fixture-duel-100', 32000, 'Simulated: sustained verified play'),
    xp('fixture-duel-101', 32500, 'Simulated: sustained verified play'),
  ],
});
