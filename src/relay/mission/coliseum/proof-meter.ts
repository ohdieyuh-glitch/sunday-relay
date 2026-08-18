/**
 * WONDERLAND COLISEUM — THE PROOF METER (PURE).
 *
 * Points exist ONLY for independently verified work. An unverified entry is a
 * CLAIM and scores zero — never "pending points", never a provisional figure.
 * A claim verified FALSE, or a repair that broke the sandbox, scores a
 * penalty. Verification is independent only when the verifier is a different
 * identity from the submitter; "same" and "unknown" are both not independent.
 */

export const PROOF_CATEGORIES = [
  'bug-discovery',
  'reproducible-failure',
  'repair-accepted',
  'regression-test',
  'security-finding',
  'reliability-improvement',
  'performance-improvement',
  'independent-verification',
] as const;
export type ProofCategory = (typeof PROOF_CATEGORIES)[number];

/** Base points per VERIFIED entry. Deterministic, no randomness. */
export const PROOF_CATEGORY_POINTS: Readonly<Record<ProofCategory, number>> = {
  'bug-discovery': 30,
  'reproducible-failure': 45,
  'repair-accepted': 60,
  'regression-test': 25,
  'security-finding': 80,
  'reliability-improvement': 40,
  'performance-improvement': 35,
  'independent-verification': 20,
};

/** The penalty for a claim verified false or a sandbox-breaking patch. */
export const FALSE_CLAIM_PENALTY = -15;
export const SANDBOX_BREAK_PENALTY = -30;

export type ProofVerificationState = 'unverified' | 'verified-true' | 'verified-false';

export interface ProofEntry {
  readonly entryId: string;
  readonly category: ProofCategory;
  readonly submitterId: string;
  readonly summary: string;
  readonly verification: ProofVerificationState;
  /** Who verified. null = nobody has — and nobody-unknown is never independence. */
  readonly verifierId: string | null;
  /** True when applying this entry's patch broke the sandbox. */
  readonly brokeSandbox: boolean;
}

export interface ScoredProofEntry {
  readonly entry: ProofEntry;
  readonly points: number;
  /** True only for verified-true entries with an independent verifier. */
  readonly verified: boolean;
  /** Why the points are what they are — always stated, never implied. */
  readonly reason: string;
}

export function verificationIsIndependent(entry: ProofEntry): boolean {
  return entry.verifierId !== null && entry.verifierId !== entry.submitterId;
}

export function scoreProofEntry(entry: ProofEntry): ScoredProofEntry {
  if (entry.brokeSandbox) {
    return {
      entry,
      points: SANDBOX_BREAK_PENALTY,
      verified: false,
      reason: 'the applied patch broke the sandbox — penalty',
    };
  }
  if (entry.verification === 'unverified') {
    return { entry, points: 0, verified: false, reason: 'unverified claim — no points until independently verified' };
  }
  if (!verificationIsIndependent(entry)) {
    return {
      entry,
      points: 0,
      verified: false,
      reason:
        entry.verifierId === null
          ? 'no verifier identity recorded — unknown is never independence'
          : 'verifier is the submitter — self-verification scores nothing',
    };
  }
  if (entry.verification === 'verified-false') {
    return { entry, points: FALSE_CLAIM_PENALTY, verified: false, reason: 'claim independently verified FALSE — penalty' };
  }
  return {
    entry,
    points: PROOF_CATEGORY_POINTS[entry.category],
    verified: true,
    reason: `independently verified ${entry.category}`,
  };
}

export interface ProofMeterReading {
  readonly entries: readonly ScoredProofEntry[];
  readonly totalPoints: number;
  readonly verifiedCount: number;
}

export function readProofMeter(entries: readonly ProofEntry[]): ProofMeterReading {
  const scored = entries.map(scoreProofEntry);
  return {
    entries: scored,
    totalPoints: scored.reduce((sum, s) => sum + s.points, 0),
    verifiedCount: scored.filter((s) => s.verified).length,
  };
}
