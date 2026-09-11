import type { JuliusWorkerRole } from './julius-runtime';

/**
 * PROJECT BRAIN v2 — THE TRUST CORE. A STUB, IMPLEMENTED BY A PAID MISSION.
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
 * EVERY FUNCTION BELOW THROWS. This is the seeded deliverable of paid Live
 * Mission 4 — the signatures, the vocabularies and the invariants in these
 * comments are the charge; the bodies are the work. The mission's specification
 * is a test seeded beside this file, not committed here: a deliberately-failing
 * test on main would break `npm test`, and one that passed against these stubs
 * would let a mission satisfy its TEST evidence having implemented nothing.
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
  throw new Error('memory_trust_not_implemented');
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
  throw new Error('memory_trust_not_implemented');
}

/**
 * TWO CLAIMS THAT CANNOT BOTH BE TRUE. Neither is deleted: both are recorded as
 * conflicting, so the contradiction is a fact the run can act on rather than a
 * silent overwrite.
 */
export function contradictJuliusMemoryClaims(
  _a: JuliusMemoryClaim, _b: JuliusMemoryClaim, _at: string,
): JuliusMemoryOutcome<readonly [JuliusMemoryClaim, JuliusMemoryClaim]> {
  throw new Error('memory_trust_not_implemented');
}

/** REPLACE A CLAIM WITH A LATER ONE ABOUT THE SAME ENTRY. */
export function supersedeJuliusMemoryClaim(
  _existing: JuliusMemoryClaim, _replacement: JuliusMemoryClaim, _at: string,
): JuliusMemoryOutcome<readonly [JuliusMemoryClaim, JuliusMemoryClaim]> {
  throw new Error('memory_trust_not_implemented');
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
  throw new Error('memory_trust_not_implemented');
}
