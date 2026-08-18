/**
 * WONDERLAND COLISEUM — RESULTS PROJECTION (PURE).
 *
 * THE ONE read-model contract for duel results. WP-2 (the Coliseum UI) codes
 * against these names VERBATIM — do not rename fields. Every unknown is
 * `null`, never zero and never inferred.
 */

import type { DuelRecord } from './duel-contracts';
import { DUEL_COMMANDS } from './duel-commands';
import { readProofMeter, type ProofEntry } from './proof-meter';
import { computeDuelReward } from './duel-rewards';

/* --------------------------------------------------- the verbatim contract */

export type DuelParticipantKind = 'compound-agent' | 'agent' | 'software' | 'automation';
export type DuelCommandName =
  | 'TRACE' | 'SB' | 'RED' | 'VERIFY' | 'FORK' | 'GUARD' | 'ROLLBACK' | 'DEEP' | 'SWARM';
export type DuelCommandBindingState = 'bound' | 'unbound';
export interface DuelCommandView {
  name: DuelCommandName;
  binding: DuelCommandBindingState;
  description: string;
}
export type ProofCategory =
  | 'bug-discovery' | 'reproducible-failure' | 'repair-accepted' | 'regression-test'
  | 'security-finding' | 'reliability-improvement' | 'performance-improvement'
  | 'independent-verification';
export interface ProofEntryView {
  category: ProofCategory;
  verified: boolean;
  points: number;
  summary: string;
}
export interface DuelParticipantResultView {
  participantId: string;
  displayName: string;
  kind: DuelParticipantKind;
  proofScore: number;
  entries: ProofEntryView[];
  bugsFound: number;
  repairsAccepted: number;
  regressionsPrevented: number;
  evaluationQuality: number | null;
  reliabilityDelta: number | null;
  performanceDelta: number | null;
  xpEarned: number;
  rewards: string[];
  opponentFixBonus: number;
}
export interface VerifiedFixView {
  id: string;
  summary: string;
  targetParticipantId: string;
  appliedState: 'available' | 'applied';
}
export type DuelStatusView =
  | 'challenged' | 'accepted' | 'provisioning' | 'active' | 'concluded' | 'aborted';
export interface DuelResultsView {
  duelId: string;
  status: DuelStatusView;
  mode: 'manual' | 'automation-fight';
  participants: [DuelParticipantResultView, DuelParticipantResultView];
  winnerParticipantId: string | null;
  commands: DuelCommandView[];
  verifiedFixes: VerifiedFixView[];
}

/* ---------------------------------------------------------------- builders */

export interface VerifiedFixFact {
  readonly id: string;
  readonly summary: string;
  /** Whose sandbox the fix targets. */
  readonly targetParticipantId: string;
  /** Who authored it — the bonus follows the author, not the target. */
  readonly authorParticipantId: string;
  readonly appliedState: 'available' | 'applied';
  /**
   * Who independently verified the fix — same independence rule as proof
   * entries: a fix counts toward the opponent-fix bonus ONLY if a verifier is
   * present AND is a different identity from the author. `null` means
   * unverified, and unverified earns nothing; an author "verifying" their own
   * fix is not independence and also earns nothing.
   */
  readonly verifierId: string | null;
}

export interface ParticipantMeasurements {
  /** null = not measured. Unknown is not zero. */
  readonly evaluationQuality: number | null;
  readonly reliabilityDelta: number | null;
  readonly performanceDelta: number | null;
}

export interface ProjectDuelResultsInput {
  readonly duel: DuelRecord;
  /** Proof entries keyed by participantId; a missing key means none. */
  readonly proofEntries: Readonly<Record<string, readonly ProofEntry[]>>;
  readonly measurements: Readonly<Record<string, ParticipantMeasurements>>;
  readonly verifiedFixes: readonly VerifiedFixFact[];
}

const UNKNOWN_MEASUREMENTS: ParticipantMeasurements = {
  evaluationQuality: null,
  reliabilityDelta: null,
  performanceDelta: null,
};

export function projectDuelResults(input: ProjectDuelResultsInput): DuelResultsView {
  const { duel } = input;
  const participants = duel.participants.map((participant) => {
    const proof = readProofMeter(input.proofEntries[participant.participantId] ?? []);
    // The opponent-fix bonus counts only fixes that were actually APPLIED and
    // INDEPENDENTLY verified (verifier present and not the author) — an
    // 'available' or self-verified fix earns nothing. NOTE: the same repair may
    // legitimately appear BOTH as a 'repair-accepted' proof entry and as an
    // opponent-fix bonus; that stacking is intended — the Coliseum's strongest
    // reward is for improving the adversary's software.
    const opponentFixes = input.verifiedFixes.filter(
      (fix) =>
        fix.authorParticipantId === participant.participantId &&
        fix.targetParticipantId !== participant.participantId &&
        fix.appliedState === 'applied' &&
        fix.verifierId !== null &&
        fix.verifierId !== fix.authorParticipantId,
    );
    const reward = computeDuelReward({
      participantId: participant.participantId,
      isWinner: duel.winnerParticipantId === participant.participantId,
      proof,
      verifiedOpponentFixCount: opponentFixes.length,
    });
    const measurements = input.measurements[participant.participantId] ?? UNKNOWN_MEASUREMENTS;
    const verifiedByCategory = (category: ProofCategory): number =>
      proof.entries.filter((s) => s.verified && s.entry.category === category).length;
    const view: DuelParticipantResultView = {
      participantId: participant.participantId,
      displayName: participant.displayName,
      kind: participant.kind,
      proofScore: proof.totalPoints,
      entries: proof.entries.map((s) => ({
        category: s.entry.category,
        verified: s.verified,
        points: s.points,
        summary: s.entry.summary,
      })),
      bugsFound: verifiedByCategory('bug-discovery'),
      repairsAccepted: verifiedByCategory('repair-accepted'),
      regressionsPrevented: verifiedByCategory('regression-test'),
      evaluationQuality: measurements.evaluationQuality,
      reliabilityDelta: measurements.reliabilityDelta,
      performanceDelta: measurements.performanceDelta,
      xpEarned: reward.xp,
      rewards: [...reward.secondary],
      opponentFixBonus: reward.opponentFixBonus,
    };
    return view;
  }) as [DuelParticipantResultView, DuelParticipantResultView];

  return {
    duelId: duel.duelId,
    status: duel.status,
    mode: duel.mode,
    participants,
    winnerParticipantId: duel.winnerParticipantId,
    commands: DUEL_COMMANDS.map((c) => ({
      name: c.name,
      binding: c.binding,
      description: c.description,
    })),
    verifiedFixes: input.verifiedFixes.map((fix) => ({
      id: fix.id,
      summary: fix.summary,
      targetParticipantId: fix.targetParticipantId,
      appliedState: fix.appliedState,
    })),
  };
}
