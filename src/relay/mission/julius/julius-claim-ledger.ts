import { deriveJuliusContextQualification } from './julius-context-provenance';
import { promoteJuliusMemoryClaim, type JuliusMemoryClaim, type JuliusMemoryEvidenceRef } from './julius-memory-trust';
import type { JuliusBrainEntry, JuliusContextQualification } from './julius-runtime';
import type { JuliusBrainAppend } from './julius-runtime-ports';

/**
 * THE CLAIM LEDGER — how a brain entry becomes a claim, how a claim earns a
 * standing, and how a recorded standing reaches the packet.
 *
 * THE MINIMUM, AND WHY IT IS THE MINIMUM. The founder's rule for the claim
 * store was "only what context integrity, durable knowledge, evidence,
 * continuity and truthful reuse need; no contradiction graphs, no lineage
 * inference". Three things meet that bar and nothing else does:
 *
 *   1. ADMISSION. Every brain entry the runtime writes gets a claim, with the
 *      standing the derivation already gave it — the same rule
 *      (`deriveJuliusContextQualification`), so a durable claim and a derived
 *      one can never disagree at birth. One definition of a standing.
 *   2. PROMOTION ON REVIEW. When an Independent Reviewer's review is ACCEPTED,
 *      the claims for the entries the reviewed task WROTE are promoted to
 *      VERIFIED on the review's evidence, through the trust core — which is
 *      what refuses self-verification (a reviewer that is the asserter), an
 *      APPROVED or terminal claim, and evidence of the wrong kind. The link is
 *      the task id on the entry, which the runtime knows; nothing is inferred
 *      from text.
 *   3. THE RECORD WINS. At compile time a recorded standing replaces the
 *      derived one for the same claim, because a recorded standing is a fact
 *      with a history and a derived one is a rule applied to a row. An entry
 *      with no recorded claim — a bootstrap seed, an older run — keeps its
 *      derived standing, so nothing that compiled before this existed
 *      compiles differently now.
 *
 * WHAT IS DELIBERATELY ABSENT. No writer asserts `supersedes` or
 * `contradicts` here: the runtime does not know that two entries disagree,
 * and guessing it from text is the poisoning failure with extra steps. The
 * fail-closed clash path therefore stays reachable through its seam until an
 * asserter exists — the readiness page says so, and so does this file.
 *
 * PURE. No clock, no store, no Node: time arrives as ISO strings, claims and
 * entries arrive as values, and every function returns new values.
 */

export const JULIUS_CLAIM_LEDGER_VERSION = 'julius-claim-ledger.v1' as const;

/** The claim id a brain entry's claim carries — the derivation's own naming. */
export const juliusClaimIdFor = (entryId: string): string => `claim:${entryId}`;

/**
 * WHAT MAKES TWO STANDINGS THE SAME STANDING. Both stores compare an append
 * against the latest row with this, so a replayed append writes no second
 * row in either — one definition, or the two stores would drift on replay.
 */
export const juliusClaimStandingKey = (claim: JuliusMemoryClaim): string => JSON.stringify([
  claim.trust, claim.provenance, claim.assertedBy, claim.assertedAt,
  claim.evidence.map((reference) => [reference.kind, reference.id]),
  claim.supersedes, [...claim.contradicts],
]);

/**
 * THE CLAIM AN APPEND ADMITS: the derivation applied to the entry as it will be
 * read back, so the durable claim is the derived claim and not a second opinion.
 */
export function juliusAdmittedClaimFor(append: JuliusBrainAppend): JuliusMemoryClaim {
  const entry: JuliusBrainEntry = {
    entryId: append.entryId,
    kind: append.kind,
    text: append.safeText,
    taskIds: append.taskId === null ? [] : [append.taskId],
    allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'],
    sensitivity: 'INTERNAL',
    provenance: { workerId: append.workerId, recordedAt: append.occurredAt, evidenceIds: append.evidenceIds },
  };
  const derived = deriveJuliusContextQualification([entry]).claims[0];
  if (derived === undefined) throw new Error('julius_claim_derivation_empty');
  return derived;
}

export interface JuliusClaimPromotion {
  readonly claim: JuliusMemoryClaim;
  readonly from: JuliusMemoryClaim['trust'];
}

export interface JuliusClaimPromotionRefusal {
  readonly claimId: string;
  readonly reasonCode: string;
}

/**
 * WHAT AN ACCEPTED REVIEW PROMOTES.
 *
 * The candidates are the current claims whose entries name the reviewed task;
 * the authority is the reviewer; the evidence is the review's own rows, as
 * REVIEW references. Each candidate goes through `promoteJuliusMemoryClaim`,
 * which decides — and a refusal is returned by name rather than dropped, so a
 * reviewer that turns out to be the asserter, or a review with no evidence, is
 * visible in the record instead of silently promoting nothing.
 *
 * VERIFIED is the ceiling here: APPROVED needs a DECISION reference, and a
 * review is not a decision. A claim already at or above VERIFIED is skipped
 * rather than refused — there is nothing to record.
 */
export function juliusClaimPromotionsOnAccept(input: {
  readonly claims: readonly JuliusMemoryClaim[];
  readonly entries: readonly JuliusBrainEntry[];
  readonly subjectTaskId: string;
  readonly by: string;
  readonly reviewEvidenceIds: readonly string[];
  readonly at: string;
}): { readonly promoted: readonly JuliusClaimPromotion[]; readonly refused: readonly JuliusClaimPromotionRefusal[] } {
  const entryTaskIds = new Map(input.entries.map((entry) => [entry.entryId, entry.taskIds] as const));
  const evidence: readonly JuliusMemoryEvidenceRef[] = input.reviewEvidenceIds.map((id) => ({ kind: 'REVIEW' as const, id }));
  const promoted: JuliusClaimPromotion[] = [];
  const refused: JuliusClaimPromotionRefusal[] = [];
  for (const claim of input.claims) {
    if (!(entryTaskIds.get(claim.entryId) ?? []).includes(input.subjectTaskId)) continue;
    if (claim.trust !== 'UNVERIFIED' && claim.trust !== 'SUPPORTED') continue;
    const outcome = promoteJuliusMemoryClaim(claim, { to: 'VERIFIED', by: input.by, evidence, at: input.at });
    if (outcome.outcome === 'OK') promoted.push({ claim: outcome.claim, from: claim.trust });
    else refused.push({ claimId: claim.claimId, reasonCode: outcome.reasonCode });
  }
  return { promoted: Object.freeze(promoted), refused: Object.freeze(refused) };
}

/**
 * THE RECORD WINS. For every derived claim that has a recorded standing, the
 * recorded claim is used — trust, evidence, lineage and all. Everything else in
 * the qualification (context types, recorded-at, the contract set) is the
 * derivation's, because those are read off the entry and not off the standing.
 */
export function mergeJuliusDurableStanding(
  qualification: JuliusContextQualification,
  recorded: readonly JuliusMemoryClaim[],
): JuliusContextQualification {
  if (recorded.length === 0) return qualification;
  const byId = new Map(recorded.map((claim) => [claim.claimId, claim] as const));
  return {
    ...qualification,
    claims: qualification.claims.map((claim) => byId.get(claim.claimId) ?? claim),
  };
}
