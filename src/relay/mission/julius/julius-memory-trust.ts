import type { JuliusWorkerRole } from './julius-runtime';

/**
 * PROJECT BRAIN v2 — THE TRUST CORE.
 *
 * Project Brain v1 stores what a run learned and retrieves it per role and per
 * task (`compileJuliusContext`), which is real and already durable. What it has
 * never carried is WHETHER ANY OF IT IS TRUE: a model's assertion and a
 * reviewer's verified finding sit in the same table, in the same shape, with
 * nothing to tell them apart. A compound agent that treats its own output as
 * fact on the next tick is a compound agent that compounds its mistakes.
 *
 * THE RULE THIS MODULE EXISTS TO HOLD: **auto-generate is allowed, auto-trust
 * is not.** Julius may derive a memory candidate from anything it observes.
 * Nothing may become trusted except by verification, from an authority that is
 * not the thing being verified.
 *
 * IMPLEMENTED, and the specification came with it. This module was seeded as
 * the deliverable of paid Live Mission 4 and sat as five throwing stubs on main
 * while every beta claim that depends on it — context integrity, the Learning
 * Loop's promotion gate, "a compound agent must not compound its own mistakes"
 * — was unprovable by construction. The mission's own specification
 * (`.github/julius-missions/julius-live-mission-4/seed/`) is now committed
 * beside this file as `julius-memory-trust.test.ts`, ported to this
 * repository's runner and extended, so `npm test` holds every invariant below.
 *
 * THE EVIDENTIARY LADDER, stated once because three functions read it:
 *
 *   SUPPORTED <- one corroborating OBSERVATION (`EVIDENCE`, `RUN`, `FINDING` or
 *               `REVIEW`) from an authority that is not the asserter.
 *   VERIFIED  <- one INDEPENDENT VERIFICATION artifact (`REVIEW` or `FINDING`).
 *               A `RUN` is an observation, not a verdict, and does not verify.
 *   APPROVED  <- one `DECISION`: a human or policy authority adopted it.
 *
 * Levels may be SKIPPED — a founder decision can adopt an unverified candidate
 * outright — but standing only ever RISES, and `by` may never be the asserter.
 *
 * Pure: no clock, no Node, no store. `now` is injected as an ISO string, the
 * way every other Julius domain module takes it.
 */

/**
 * WHERE A CLAIM CAME FROM. Not how much it is believed — that is `trust`.
 *
 * `external_retrieved` is the newest member and the one that carries the most
 * warning. It means a persistent worker's governed research observed this
 * somewhere outside Relay: a real authority about that source's own subject,
 * and a stranger about everything else. It is deliberately NOT folded into
 * `tool_observed`, which means Relay's own tool ran and Relay saw the result.
 * Collapsing the two would make a vendor's changelog and a forum post
 * indistinguishable from `git log` in the one field whose entire job is to say
 * where a sentence came from.
 *
 * It grants nothing. An externally retrieved claim is admitted `UNVERIFIED`
 * like every other candidate, and `julius-research-policy` additionally refuses
 * to let an injection-signalled observation settle a disagreement.
 */
export const JULIUS_MEMORY_PROVENANCE = [
  'user_stated',
  'repository_observed',
  'tool_observed',
  'run_observed',
  'reviewer_verified',
  'system_policy',
  'derived_candidate',
  'external_retrieved',
] as const;
export type JuliusMemoryProvenance = (typeof JULIUS_MEMORY_PROVENANCE)[number];

/**
 * HOW MUCH A CLAIM IS BELIEVED, and by what authority.
 *
 * `UNVERIFIED` — asserted, nothing more. Every candidate starts here.
 * `SUPPORTED`  — corroborated by observation that is not the asserter's own.
 * `VERIFIED`   — checked by an independent verifier against evidence.
 * `APPROVED`   — a human or policy authority has adopted it.
 * `CONTRADICTED` — a conflicting claim of at least equal standing exists.
 * `SUPERSEDED` — replaced by a later claim about the same subject.
 */
export const JULIUS_MEMORY_TRUST_STATES = [
  'UNVERIFIED', 'SUPPORTED', 'VERIFIED', 'APPROVED', 'CONTRADICTED', 'SUPERSEDED',
] as const;
export type JuliusMemoryTrustState = (typeof JULIUS_MEMORY_TRUST_STATES)[number];

/** WHAT A CLAIM POINTS AT. An id this runtime already issues, never prose. */
export interface JuliusMemoryEvidenceRef {
  readonly kind: 'EVIDENCE' | 'DECISION' | 'FINDING' | 'REVIEW' | 'RUN';
  readonly id: string;
}

/**
 * ONE ASSERTION ABOUT ONE BRAIN ENTRY, with its provenance and its standing.
 *
 * A claim QUALIFIES an entry rather than replacing it: v1's entries keep their
 * text, kinds, roles and sensitivity, and this says who asserted them, on what
 * evidence, and how far that has been checked.
 */
export interface JuliusMemoryClaim {
  readonly claimId: string;
  readonly entryId: string;
  readonly provenance: JuliusMemoryProvenance;
  readonly trust: JuliusMemoryTrustState;
  /** The worker, human or policy that asserted it. Never empty. */
  readonly assertedBy: string;
  readonly assertedAt: string;
  readonly evidence: readonly JuliusMemoryEvidenceRef[];
  /** The claim this one replaces, or null. */
  readonly supersedes: string | null;
  /** Claim ids this one is known to conflict with. */
  readonly contradicts: readonly string[];
}

export type JuliusMemoryOutcome<T> =
  | { readonly outcome: 'OK'; readonly claim: T }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string };

/**
 * ADMIT A CANDIDATE. Auto-generation is allowed and this is where it happens.
 *
 * THE INVARIANT: whatever the caller asks for, a candidate is admitted
 * `UNVERIFIED`. A caller that requests a higher standing is not refused — it is
 * ADMITTED AT UNVERIFIED, because refusing would tempt callers to stop
 * generating candidates, and the point is that generating them is free while
 * believing them is not.
 */
export function admitJuliusMemoryCandidate(_input: {
  readonly claimId: string;
  readonly entryId: string;
  readonly provenance: JuliusMemoryProvenance;
  readonly assertedBy: string;
  readonly assertedAt: string;
  readonly evidence?: readonly JuliusMemoryEvidenceRef[];
  /** What the caller WOULD like. Recorded nowhere; a candidate is UNVERIFIED. */
  readonly requestedTrust?: JuliusMemoryTrustState;
}): JuliusMemoryOutcome<JuliusMemoryClaim> {
  // `requestedTrust` is deliberately read and deliberately discarded. It is in
  // the signature so a caller can express what it hoped for without the hope
  // becoming a fact, and it is recorded nowhere: a field holding "wanted
  // VERIFIED" would be one refactor away from being treated as VERIFIED.
  void _input.requestedTrust;
  if (!nonEmpty(_input.claimId)) return refuse('memory_claim_id_required');
  if (!nonEmpty(_input.entryId)) return refuse('memory_entry_id_required');
  if (!nonEmpty(_input.assertedBy)) return refuse('memory_asserter_required');
  if (!JULIUS_MEMORY_PROVENANCE.includes(_input.provenance)) return refuse('memory_provenance_unknown');
  if (!isTimestamp(_input.assertedAt)) return refuse('memory_timestamp_invalid');
  for (const reference of _input.evidence ?? []) {
    if (!isEvidenceRef(reference)) return refuse('memory_evidence_reference_invalid');
  }
  return {
    outcome: 'OK',
    claim: {
      claimId: _input.claimId,
      entryId: _input.entryId,
      provenance: _input.provenance,
      trust: 'UNVERIFIED',
      assertedBy: _input.assertedBy,
      assertedAt: _input.assertedAt,
      evidence: copyEvidence(_input.evidence ?? []),
      supersedes: null,
      contradicts: [],
    },
  };
}

/**
 * PROMOTE A CLAIM, and only on evidence from an authority that is not itself.
 *
 * Every promotion is gated. A claim cannot verify itself, a CONTRADICTED or
 * SUPERSEDED claim cannot be promoted at all, and each target standing has its
 * own evidentiary requirement.
 *
 * AND IT ONLY EVER RAISES STANDING, in the ordering
 * `UNVERIFIED < SUPPORTED < VERIFIED < APPROVED`. Without that rule this is a
 * general "set the trust field", and an APPROVED claim could be quietly
 * returned to UNVERIFIED — an adopted decision lost with no record that
 * anything was lost. Trust is expensive to acquire on purpose; it must not be
 * cheap to discard. `CONTRADICTED` and `SUPERSEDED` are not promotion targets
 * either: they are reached by the two functions below, which record WHY.
 */
export function promoteJuliusMemoryClaim(_claim: JuliusMemoryClaim, _input: {
  readonly to: JuliusMemoryTrustState;
  readonly by: string;
  readonly evidence: readonly JuliusMemoryEvidenceRef[];
  readonly at: string;
}): JuliusMemoryOutcome<JuliusMemoryClaim> {
  if (!isTimestamp(_input.at)) return refuse('memory_timestamp_invalid');
  if (!nonEmpty(_input.by)) return refuse('memory_authority_required');
  if (isTerminalTrust(_claim.trust)) return refuse('memory_claim_terminal');
  // CONTRADICTED and SUPERSEDED are not promotion TARGETS: they are reached by
  // the two functions below, which record WHY. A general "set the trust field"
  // here would let an adopted decision be returned to UNVERIFIED with no
  // record that anything was lost.
  const target = PROMOTION_LADDER.indexOf(_input.to as JuliusPromotableTrust);
  if (target < 0) return refuse('memory_trust_not_a_promotion_target');
  const current = PROMOTION_LADDER.indexOf(_claim.trust as JuliusPromotableTrust);
  if (current < 0) return refuse('memory_claim_terminal');
  if (target <= current) return refuse('memory_trust_not_a_promotion');
  // SELF-VERIFICATION. The asserter can never be the authority for its own
  // claim, at any standing. This is the whole of "auto-trust is not allowed".
  if (_input.by === _claim.assertedBy) return refuse('memory_self_verification');
  for (const reference of _input.evidence) {
    if (!isEvidenceRef(reference)) return refuse('memory_evidence_reference_invalid');
  }
  const wanted = PROMOTION_LADDER[target]!;
  if (!_input.evidence.some((reference) => EVIDENCE_FOR_TRUST[wanted].includes(reference.kind))) {
    return refuse(`memory_evidence_insufficient_for_${wanted.toLowerCase()}`);
  }
  return {
    outcome: 'OK',
    claim: {
      ..._claim,
      trust: wanted,
      // Promotion ADDS the evidence it was granted on; it never replaces the
      // claim's existing references, and it never mints a new claimId.
      evidence: copyEvidence([..._claim.evidence, ..._input.evidence]),
    },
  };
}

/**
 * TWO CLAIMS THAT CANNOT BOTH BE TRUE. Neither is deleted: both are recorded as
 * conflicting, so the contradiction is a fact the run can act on rather than a
 * silent overwrite.
 */
export function contradictJuliusMemoryClaims(
  _a: JuliusMemoryClaim, _b: JuliusMemoryClaim, _at: string,
): JuliusMemoryOutcome<readonly [JuliusMemoryClaim, JuliusMemoryClaim]> {
  if (!isTimestamp(_at)) return refuse('memory_timestamp_invalid');
  if (_a.claimId === _b.claimId) return refuse('memory_claim_self_contradiction');
  return { outcome: 'OK', claim: [contradicted(_a, _b), contradicted(_b, _a)] as const };
}

/**
 * ONE SIDE OF A CONTRADICTION.
 *
 * The conflict is ALWAYS recorded on both sides — that is what keeps the
 * contradiction a fact the run can act on rather than a silent overwrite. The
 * STANDING is a separate question, and there is exactly one case where a side
 * keeps it: `APPROVED` against something of strictly lower standing. A human or
 * policy authority adopted that claim, and a bare assertion arriving later does
 * not unadopt it. Equal standing on both sides demotes both, because nothing
 * separates them and keeping either would be a silent pick.
 *
 * A claim that is ALREADY terminal keeps the standing it has: overwriting a
 * `SUPERSEDED` with `CONTRADICTED` replaces one recorded reason for a claim's
 * death with a different one.
 */
function contradicted(side: JuliusMemoryClaim, other: JuliusMemoryClaim): JuliusMemoryClaim {
  const survives = side.trust === 'APPROVED' && standingOf(other.trust) < standingOf(side.trust);
  return {
    ...side,
    trust: isTerminalTrust(side.trust) || survives ? side.trust : 'CONTRADICTED',
    contradicts: side.contradicts.includes(other.claimId)
      ? [...side.contradicts]
      : [...side.contradicts, other.claimId],
  };
}

/** REPLACE A CLAIM WITH A LATER ONE ABOUT THE SAME ENTRY. */
export function supersedeJuliusMemoryClaim(
  _existing: JuliusMemoryClaim, _replacement: JuliusMemoryClaim, _at: string,
): JuliusMemoryOutcome<readonly [JuliusMemoryClaim, JuliusMemoryClaim]> {
  if (!isTimestamp(_at)) return refuse('memory_timestamp_invalid');
  if (_existing.claimId === _replacement.claimId) return refuse('memory_supersede_self');
  // A claim about a DIFFERENT entry is not a replacement for this one. Without
  // this, supersession becomes a way to retire any claim by asserting anything.
  if (_existing.entryId !== _replacement.entryId) return refuse('memory_supersede_entry_mismatch');
  // A replacement that is itself dead replaces nothing.
  if (isTerminalTrust(_replacement.trust)) return refuse('memory_supersede_replacement_terminal');
  // One claim supersedes one claim, or the lineage forks with no record of
  // which fork is current.
  if (_replacement.supersedes !== null && _replacement.supersedes !== _existing.claimId) {
    return refuse('memory_supersede_replacement_bound');
  }
  // A CONTRADICTED claim already carries a recorded reason for its death, and
  // supersession would overwrite it. Resolve the contradiction first.
  if (_existing.trust === 'CONTRADICTED') return refuse('memory_supersede_contradicted');
  return {
    outcome: 'OK',
    claim: [
      { ..._existing, trust: 'SUPERSEDED' },
      { ..._replacement, supersedes: _existing.claimId },
    ] as const,
  };
}

/**
 * WHAT A WORKER MAY BE TOLD, at or above a required standing.
 *
 * Retrieval is where the whole module earns its keep: a claim that is
 * CONTRADICTED or SUPERSEDED is never returned, whatever standing it once had.
 */
export function retrieveTrustedJuliusMemory(
  _claims: readonly JuliusMemoryClaim[],
  _input: { readonly minimumTrust: JuliusMemoryTrustState; readonly role: JuliusWorkerRole },
): readonly JuliusMemoryClaim[] {
  /**
   * ROLE DOES NOT FILTER HERE, AND THAT IS NOT AN OMISSION.
   *
   * A claim QUALIFIES a brain entry; the roles that may see it live on the
   * ENTRY (`JuliusBrainEntry.allowedRoles`), which this function is not handed.
   * Filtering on a role the claim does not carry would either do nothing while
   * appearing to protect something, or invent a scope. The role is validated as
   * the caller's stated audience; the scope is enforced where the scope
   * actually is — `compileContextWithIntegrity`, which sees the entries,
   * excludes out-of-role ones and reports them in `excludedEntryIds`.
   */
  void _input.role;
  // A TERMINAL STANDING IS NOT A BAR. `CONTRADICTED` and `SUPERSEDED` are not
  // positions on the ladder, so "at least CONTRADICTED" is not a lower bar that
  // admits more — it is a question with no answer, and the answer is nothing.
  const bar = PROMOTION_LADDER.indexOf(_input.minimumTrust as JuliusPromotableTrust);
  if (bar < 0) return [];
  return _claims
    .filter((claim) => !isTerminalTrust(claim.trust) && standingOf(claim.trust) >= bar)
    .slice()
    .sort((left, right) =>
      standingOf(right.trust) - standingOf(left.trust) || left.claimId.localeCompare(right.claimId));
}

// ───────────────────────────────────────────────────────────────── internals
//
// Pure, local and unexported: the module's surface is the five functions above
// plus the vocabularies. Nothing here reads a clock or mutates an argument.

const PROMOTION_LADDER = ['UNVERIFIED', 'SUPPORTED', 'VERIFIED', 'APPROVED'] as const;
type JuliusPromotableTrust = (typeof PROMOTION_LADDER)[number];

/** WHAT EACH STANDING COSTS. The ladder in the module comment, as a table. */
const EVIDENCE_FOR_TRUST: Readonly<Record<JuliusPromotableTrust, readonly JuliusMemoryEvidenceRef['kind'][]>> = {
  // Nothing is promoted TO `UNVERIFIED`; the row exists so the table is total.
  UNVERIFIED: [],
  SUPPORTED: ['EVIDENCE', 'RUN', 'FINDING', 'REVIEW'],
  VERIFIED: ['REVIEW', 'FINDING'],
  APPROVED: ['DECISION'],
};

const EVIDENCE_KINDS: readonly JuliusMemoryEvidenceRef['kind'][] = ['EVIDENCE', 'DECISION', 'FINDING', 'REVIEW', 'RUN'];

const isTerminalTrust = (trust: JuliusMemoryTrustState): boolean =>
  trust === 'CONTRADICTED' || trust === 'SUPERSEDED';

/** Position on the promotion ladder; a terminal standing is below all of them. */
const standingOf = (trust: JuliusMemoryTrustState): number =>
  PROMOTION_LADDER.indexOf(trust as JuliusPromotableTrust);

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * A TRANSITION WITHOUT A TIME IS NOT RECORDABLE.
 *
 * `at` never lands on the claim — `assertedAt` is when the claim was ASSERTED
 * and a later promotion does not rewrite it; the durable row carries the
 * transition's own time. It is still required and still checked, so a caller
 * cannot reach a transition it would have been unable to record.
 */
const isTimestamp = (value: unknown): value is string =>
  nonEmpty(value) && !Number.isNaN(Date.parse(value));

const isEvidenceRef = (value: unknown): value is JuliusMemoryEvidenceRef => {
  if (typeof value !== 'object' || value === null) return false;
  const reference = value as { kind?: unknown; id?: unknown };
  return EVIDENCE_KINDS.includes(reference.kind as JuliusMemoryEvidenceRef['kind']) && nonEmpty(reference.id);
};

/** A defensive copy, so no caller's array becomes part of a returned claim. */
const copyEvidence = (evidence: readonly JuliusMemoryEvidenceRef[]): readonly JuliusMemoryEvidenceRef[] =>
  evidence.map((reference) => ({ kind: reference.kind, id: reference.id }));

const refuse = <T>(reasonCode: string): JuliusMemoryOutcome<T> => ({ outcome: 'REFUSED', reasonCode });
