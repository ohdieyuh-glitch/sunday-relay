/**
 * WONDERLAND COLISEUM — CONCLUSION AWARDS (PURE over the store port).
 *
 * The one seam through which a CONCLUDED duel writes XP into the durable
 * ledger. It computes both participants' rewards through the existing
 * `computeDuelReward` (with the projection's exact opponent-fix independence
 * rule) and appends them via `appendXp` — ONE writer, sequentially, because
 * `appendXp` is a non-atomic read-modify-write and two concurrent writers on
 * a shared backing can lose an award.
 *
 * IDEMPOTENT BY MARKER: before anything is written, an award marker for the
 * duelId is checked in the store; awarding the same duel twice is REFUSED.
 * The marker is written only AFTER both ledger appends resolved, and the
 * returned record reports exactly what was durably written — a failed second
 * append is reported as the partial fact it is, never rounded to success.
 */

import type { DurableKeyValueBacking } from '../durable';
import { computeDuelReward, type DuelReward } from './duel-rewards';
import { readProofMeter, type ProofEntry } from './proof-meter';
import type { VerifiedFixFact } from './duel-results-projection';
import type { DuelRecord } from './duel-contracts';
import type { DuelStorePort, XpLedgerEntry } from './duel-store';

const AWARD_MARKER_PREFIX = 'coliseum:award:';

/* ---------------------------------------------------------- award marker */

export interface DuelAwardMarker {
  readonly duelId: string;
  readonly awardedAt: string;
  readonly participantIds: readonly [string, string];
}

/** Reads the award marker for a duel. Absent or unreadable = no proven award. */
export async function readAwardMarker(
  backing: DurableKeyValueBacking,
  duelId: string,
): Promise<DuelAwardMarker | null> {
  let text: string | null;
  try {
    text = await backing.getText(`${AWARD_MARKER_PREFIX}${duelId}`);
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as DuelAwardMarker;
    return typeof parsed.duelId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- the award */

export interface ParticipantAwardWritten {
  readonly participantId: string;
  /** The reward THIS call computed from THIS call's proof inputs. When
      `alreadyWritten` is true this is NOT what the ledger holds — the durable
      fact is `ledgerEntry`. */
  readonly reward: DuelReward;
  /** True only after the durable append RESOLVED ok. A fact, not an intent. */
  readonly written: boolean;
  /** True when the ledger already held this duel's entry from an earlier call
      (retry after a partial award); nothing was appended by THIS call. */
  readonly alreadyWritten: boolean;
  /** Exactly what the ledger durably holds for this duel — the ORIGINAL entry
      on a dedup retry, the freshly appended one on success, null on failure. */
  readonly ledgerEntry: XpLedgerEntry | null;
  /** The store's reason when the write failed; null when it succeeded. */
  readonly writeFailure: string | null;
}

export type ConcludeDuelAwardResult =
  | {
      readonly ok: true;
      readonly duelId: string;
      readonly awardedAt: string;
      readonly participants: readonly [ParticipantAwardWritten, ParticipantAwardWritten];
      /** True only after the marker's durable write resolved. A false marker
          with both XP entries written is SAFE: the next call re-runs the
          per-participant dedup and refuses to pay anyone twice. */
      readonly markerWritten: boolean;
    }
  | { readonly ok: false; readonly refusal: string };

export interface ConcludeDuelAwardInput {
  readonly duel: DuelRecord;
  /** Proof entries keyed by participantId; a missing key means none. */
  readonly proofEntries: Readonly<Record<string, readonly ProofEntry[]>>;
  readonly verifiedFixes: readonly VerifiedFixFact[];
  /** Injected ISO timestamp — this module never reads a clock. */
  readonly awardedAt: string;
}

/**
 * Awards both participants' XP for one CONCLUDED duel.
 *
 * Refusals: a duel that is not `concluded` (a mission-state value is a
 * position in the machine — only the concluded position pays), and a duel
 * whose award marker already exists (double-award).
 */
export async function concludeDuelAndAward(
  store: DuelStorePort,
  backing: DurableKeyValueBacking,
  input: ConcludeDuelAwardInput,
): Promise<ConcludeDuelAwardResult> {
  const { duel } = input;
  if (duel.status !== 'concluded') {
    return {
      ok: false,
      refusal: `only a concluded duel pays XP (duel '${duel.duelId}' is '${duel.status}')`,
    };
  }
  const existing = await readAwardMarker(backing, duel.duelId);
  if (existing !== null) {
    return {
      ok: false,
      refusal: `duel '${duel.duelId}' was already awarded at ${existing.awardedAt} — a duel pays exactly once`,
    };
  }

  // ONE writer, strictly sequential appends — appendXp is a non-atomic
  // read-modify-write, so the two participants are written one after another.
  const written: ParticipantAwardWritten[] = [];
  for (const participant of duel.participants) {
    const proof = readProofMeter(input.proofEntries[participant.participantId] ?? []);
    // The projection's exact independence rule: applied + verifier present +
    // verifier is not the author. Anything less earns nothing.
    const verifiedOpponentFixCount = input.verifiedFixes.filter(
      (fix) =>
        fix.authorParticipantId === participant.participantId &&
        fix.targetParticipantId !== participant.participantId &&
        fix.appliedState === 'applied' &&
        fix.verifierId !== null &&
        fix.verifierId !== fix.authorParticipantId,
    ).length;
    const reward = computeDuelReward({
      participantId: participant.participantId,
      isWinner: duel.winnerParticipantId === participant.participantId,
      proof,
      verifiedOpponentFixCount,
    });
    // Per-participant idempotence UNDER the marker: a retry after a partial
    // award (one append landed, the other failed, so no marker was written)
    // must not pay the landed participant twice. An existing ledger entry for
    // this duelId IS the award; it is reported as written, not re-appended.
    const ledger = await store.readXpLedger(participant.participantId);
    const original = ledger.entries.find((e) => e.duelId === duel.duelId);
    if (original !== undefined) {
      // The ORIGINAL ledger entry is the award — reported verbatim, never
      // replaced by this call's recomputed reward, which may differ.
      written.push({
        participantId: participant.participantId,
        reward,
        written: true,
        alreadyWritten: true,
        ledgerEntry: original,
        writeFailure: null,
      });
      continue;
    }
    const entry: XpLedgerEntry = {
      duelId: duel.duelId,
      xp: reward.xp,
      awardedAt: input.awardedAt,
      summary:
        `Coliseum duel ${duel.duelId}: ${reward.xp} XP ` +
        `(proof ${Math.max(0, proof.totalPoints)}, opponent-fix bonus ${reward.opponentFixBonus}` +
        `${duel.winnerParticipantId === participant.participantId ? ', winner bonus 25' : ''})`,
    };
    const result = await store.appendXp(participant.participantId, entry);
    written.push({
      participantId: participant.participantId,
      reward,
      written: result.ok,
      alreadyWritten: false,
      ledgerEntry: result.ok ? entry : null,
      writeFailure: result.ok ? null : result.reason,
    });
  }

  // The marker lands only when BOTH appends durably resolved; a partial award
  // stays retryable and is reported truthfully per participant. A FAILED
  // marker write does not reject an award whose XP writes fully succeeded:
  // it is reported as the fact `markerWritten: false`, and it is safe — the
  // next call falls past the absent marker into the per-participant dedup,
  // which refuses to re-append an existing duel entry.
  let markerWritten = false;
  if (written.every((w) => w.written)) {
    const marker: DuelAwardMarker = {
      duelId: duel.duelId,
      awardedAt: input.awardedAt,
      participantIds: [duel.participants[0].participantId, duel.participants[1].participantId],
    };
    try {
      await backing.putText(`${AWARD_MARKER_PREFIX}${duel.duelId}`, JSON.stringify(marker));
      markerWritten = true;
    } catch {
      markerWritten = false;
    }
  }

  return {
    ok: true,
    duelId: duel.duelId,
    awardedAt: input.awardedAt,
    participants: [written[0], written[1]] as [ParticipantAwardWritten, ParticipantAwardWritten],
    markerWritten,
  };
}
