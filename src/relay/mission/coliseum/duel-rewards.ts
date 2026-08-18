/**
 * WONDERLAND COLISEUM — REWARDS (PURE, DETERMINISTIC).
 *
 * Primary reward: Agent XP. Longer autonomous runs and deeper evaluation are
 * NOT paid per duel — they are capability GRANTS derived from the whole XP
 * ledger by `agent-progression.ts` (one scale, no per-duel second scale to
 * contradict it). Secondary: rank, compute credits, reputation, command
 * unlocks, cosmetics/titles.
 *
 * BOTH winner and loser earn for verified work — the Coliseum pays for proof,
 * not for standing. The strongest explicit bonus goes to fixes that were
 * ACTUALLY APPLIED to the OPPONENT's sandbox AND independently verified
 * (verifier present and not the author — the projection enforces this before
 * a fix reaches `verifiedOpponentFixCount`): improving the adversary's
 * software is the behavior Wonderland most wants to reward. The same repair
 * may also appear as a 'repair-accepted' proof entry; that stacking is
 * intended.
 */

import type { ProofMeterReading } from './proof-meter';

export const OPPONENT_FIX_BONUS_XP = 50;
export const WINNER_BONUS_XP = 25;
export interface DuelRewardInput {
  readonly participantId: string;
  readonly isWinner: boolean;
  readonly proof: ProofMeterReading;
  /** Fixes this participant APPLIED to the OPPONENT's sandbox that were
      independently verified (never self-verified, never merely 'available'). */
  readonly verifiedOpponentFixCount: number;
}

export interface DuelReward {
  readonly participantId: string;
  /** Primary. Never negative — penalties floor XP at zero, they do not create debt. */
  readonly xp: number;
  /** The explicit opponent-fix bonus, already included in `xp`. */
  readonly opponentFixBonus: number;
  /** Secondary rewards as stable identifiers a surface can render. */
  readonly secondary: readonly string[];
}

export function computeDuelReward(input: DuelRewardInput): DuelReward {
  const opponentFixBonus = input.verifiedOpponentFixCount * OPPONENT_FIX_BONUS_XP;
  const proofXp = Math.max(0, input.proof.totalPoints);
  const winnerXp = input.isWinner ? WINNER_BONUS_XP : 0;
  const xp = proofXp + opponentFixBonus + winnerXp;

  const secondary: string[] = [];
  if (input.isWinner) secondary.push('rank:duel-victory');
  if (input.proof.verifiedCount > 0) {
    secondary.push('reputation:verified-work');
    secondary.push(`compute-credits:${input.proof.verifiedCount}`);
  }
  if (input.verifiedOpponentFixCount > 0) secondary.push('title:opponents-engineer');
  if (input.proof.verifiedCount >= 3) secondary.push('command-unlock:candidate');

  return {
    participantId: input.participantId,
    xp,
    opponentFixBonus,
    secondary,
  };
}
