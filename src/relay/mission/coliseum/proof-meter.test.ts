import { describe, expect, it } from 'vitest';

import {
  FALSE_CLAIM_PENALTY,
  PROOF_CATEGORIES,
  PROOF_CATEGORY_POINTS,
  SANDBOX_BREAK_PENALTY,
  readProofMeter,
  scoreProofEntry,
  type ProofEntry,
} from './proof-meter';
import {
  OPPONENT_FIX_BONUS_XP,
  WINNER_BONUS_XP,
  computeDuelReward,
} from './duel-rewards';

const entry = (overrides: Partial<ProofEntry>): ProofEntry => ({
  entryId: 'e1',
  category: 'bug-discovery',
  submitterId: 'agent-a',
  summary: 'a finding',
  verification: 'verified-true',
  verifierId: 'reviewer-b',
  brokeSandbox: false,
  ...overrides,
});

describe('proof meter — points only for independently verified work', () => {
  it('scores each category at its declared base points when independently verified', () => {
    for (const category of PROOF_CATEGORIES) {
      const scored = scoreProofEntry(entry({ category }));
      expect(scored.verified, category).toBe(true);
      expect(scored.points, category).toBe(PROOF_CATEGORY_POINTS[category]);
      expect(scored.points, category).toBeGreaterThan(0);
    }
  });

  it('an unverified entry scores exactly zero', () => {
    const scored = scoreProofEntry(entry({ verification: 'unverified', verifierId: null }));
    expect(scored.points).toBe(0);
    expect(scored.verified).toBe(false);
  });

  it('self-verification scores zero — verifierId equal to submitterId is not independence', () => {
    const scored = scoreProofEntry(entry({ verifierId: 'agent-a' }));
    expect(scored.points).toBe(0);
    expect(scored.verified).toBe(false);
    expect(scored.reason).toContain('self-verification');
  });

  it('an unknown verifier scores zero — unknown is never independence', () => {
    const scored = scoreProofEntry(entry({ verifierId: null }));
    expect(scored.points).toBe(0);
    expect(scored.reason).toContain('unknown is never independence');
  });

  it('a claim verified FALSE takes the penalty', () => {
    const scored = scoreProofEntry(entry({ verification: 'verified-false' }));
    expect(scored.points).toBe(FALSE_CLAIM_PENALTY);
    expect(scored.points).toBeLessThan(0);
    expect(scored.verified).toBe(false);
  });

  it('a patch that broke the sandbox takes the penalty even if "verified"', () => {
    const scored = scoreProofEntry(entry({ category: 'repair-accepted', brokeSandbox: true }));
    expect(scored.points).toBe(SANDBOX_BREAK_PENALTY);
    expect(scored.verified).toBe(false);
  });

  it('totals sum verified points and penalties together', () => {
    const reading = readProofMeter([
      entry({ entryId: 'a', category: 'bug-discovery' }),
      entry({ entryId: 'b', verification: 'unverified', verifierId: null }),
      entry({ entryId: 'c', verification: 'verified-false' }),
    ]);
    expect(reading.totalPoints).toBe(PROOF_CATEGORY_POINTS['bug-discovery'] + FALSE_CLAIM_PENALTY);
    expect(reading.verifiedCount).toBe(1);
  });
});

describe('rewards — both sides earn, opponent fixes earn most', () => {
  const verifiedProof = readProofMeter([entry({})]);

  it('is deterministic', () => {
    const input = { participantId: 'p', isWinner: false, proof: verifiedProof, verifiedOpponentFixCount: 1 };
    expect(computeDuelReward(input)).toEqual(computeDuelReward(input));
  });

  it('the LOSER still earns XP for verified work', () => {
    const reward = computeDuelReward({
      participantId: 'loser',
      isWinner: false,
      proof: verifiedProof,
      verifiedOpponentFixCount: 0,
    });
    expect(reward.xp).toBe(PROOF_CATEGORY_POINTS['bug-discovery']);
    expect(reward.secondary).toContain('reputation:verified-work');
  });

  it('a verified fix applied to the opponent earns the explicit bonus, reported separately', () => {
    const without = computeDuelReward({ participantId: 'p', isWinner: false, proof: verifiedProof, verifiedOpponentFixCount: 0 });
    const withFix = computeDuelReward({ participantId: 'p', isWinner: false, proof: verifiedProof, verifiedOpponentFixCount: 2 });
    expect(withFix.opponentFixBonus).toBe(2 * OPPONENT_FIX_BONUS_XP);
    expect(withFix.xp - without.xp).toBe(2 * OPPONENT_FIX_BONUS_XP);
    expect(without.opponentFixBonus).toBe(0);
  });

  it('winning adds the winner bonus and the rank reward', () => {
    const loser = computeDuelReward({ participantId: 'p', isWinner: false, proof: verifiedProof, verifiedOpponentFixCount: 0 });
    const winner = computeDuelReward({ participantId: 'p', isWinner: true, proof: verifiedProof, verifiedOpponentFixCount: 0 });
    expect(winner.xp - loser.xp).toBe(WINNER_BONUS_XP);
    expect(winner.secondary).toContain('rank:duel-victory');
    expect(loser.secondary).not.toContain('rank:duel-victory');
  });

  it('penalties floor XP at zero — a duel never creates XP debt', () => {
    const penalizedProof = readProofMeter([entry({ verification: 'verified-false' })]);
    const reward = computeDuelReward({ participantId: 'p', isWinner: false, proof: penalizedProof, verifiedOpponentFixCount: 0 });
    expect(penalizedProof.totalPoints).toBeLessThan(0);
    expect(reward.xp).toBe(0);
    expect(reward.runExtensionUnits).toBe(0);
    expect(reward.evaluationDepthUnits).toBe(0);
  });

  it('unverified-only work earns nothing at all', () => {
    const unverified = readProofMeter([entry({ verification: 'unverified', verifierId: null })]);
    const reward = computeDuelReward({ participantId: 'p', isWinner: false, proof: unverified, verifiedOpponentFixCount: 0 });
    expect(reward.xp).toBe(0);
    expect(reward.secondary).not.toContain('reputation:verified-work');
  });
});
