import type { JuliusMemoryClaim, JuliusMemoryTrustState } from './julius-memory-trust';
import type { JuliusBrainEntry, JuliusWorkerRole } from './julius-runtime';

/**
 * JULIUS CONTEXT INTEGRITY — A STUB, IMPLEMENTED BY A PAID MISSION.
 *
 * `compileJuliusContext` today filters an entry list by sensitivity, role and
 * task, then packs entries IN ARRAY ORDER until the next one would overflow the
 * budget and STOPS. That is the whole of it. There is no ranking, no notion of
 * how far anything has been checked, and one oversized low-value entry ends the
 * packet for everything behind it.
 *
 * Project Brain v2 gave claims a `trust` standing (`julius-memory-trust.ts`)
 * and nothing consumes it. So Julius can be handed, as fact, a candidate it
 * wrote itself one tick earlier; a swarm of near-duplicates can crowd out the
 * one verified fact a task needs; a preference can read as a requirement; and
 * two claims that flatly contradict each other can both arrive with nothing
 * saying which is current.
 *
 * FOUR FAILURE CLASSES, and this module exists to hold the line on all four:
 *
 *  POISONING   — an UNVERIFIED claim whose TEXT reads like an instruction is
 *                still DATA. It may never override the locked contract, an
 *                approved decision, verified evidence or a governance
 *                constraint, however imperative its prose.
 *  DISTRACTION — relevance alone is not a ranking. A hundred plausible
 *                low-authority memories must not evict the one VERIFIED fact
 *                the task actually needs.
 *  CONFUSION   — a preference is not a requirement, a hypothesis is not a fact,
 *                and a past event is not a current instruction. The type
 *                survives compilation or the packet is lying.
 *  CLASH       — contradictory claims keep BOTH sides and their lineage. When
 *                two of equal authority cannot be told apart, the compiler
 *                FAILS CLOSED with a typed conflict rather than silently
 *                picking one.
 *
 * EVERY FUNCTION BELOW THROWS. This is the seeded deliverable of paid Live
 * Mission 5 — the signatures, the vocabularies and the invariants in these
 * comments are the charge; the bodies are the work. The specification is a test
 * seeded beside this file, not committed here: a deliberately-failing test on
 * main would break `npm test`, and one that passed against these stubs would
 * let a mission satisfy its TEST evidence having implemented nothing.
 *
 * Pure: no clock, no Node, no store, no network. Time arrives as injected ISO
 * strings, the way every other Julius domain module takes it.
 */

export const JULIUS_CONTEXT_INTEGRITY_VERSION = 'julius-context-integrity.v1' as const;

/**
 * WHAT A PIECE OF CONTEXT IS, which is not the same as what it says.
 *
 * `JuliusBrainEntry.kind` records where a line came from in the run
 * (`DECISION`, `FINDING`, `HANDOFF`...). This records its EPISTEMIC STATUS, and
 * the two are independent: a `HANDOFF` may carry a `HYPOTHESIS` and a
 * `DECISION` may carry a `USER_PREFERENCE`.
 *
 * `CURRENT_CONTRACT` is the locked agreement in force. It is the only type that
 * is authoritative BY CONSTRUCTION rather than by trust standing, because it is
 * the thing every other claim is being judged against.
 */
export const JULIUS_CONTEXT_TYPES = [
  'CURRENT_CONTRACT',
  'REVIEW_FINDING',
  'FACT',
  'PAST_EVENT',
  'USER_PREFERENCE',
  'INSTRUCTION',
  'ASSUMPTION',
  'HYPOTHESIS',
] as const;
export type JuliusContextType = (typeof JULIUS_CONTEXT_TYPES)[number];

/**
 * WHO SAYS SO. Ranked, highest first; `authorityRank` is the index.
 *
 * Authority is NOT trust: trust says how far a claim has been checked,
 * authority says what kind of thing is doing the saying. A `GOVERNANCE`
 * constraint outranks a `VERIFIED_EVIDENCE` fact even though both are settled,
 * and an `ASSERTION` never outranks anything however confidently it is phrased.
 */
export const JULIUS_CONTEXT_AUTHORITY = [
  'GOVERNANCE',
  'LOCKED_CONTRACT',
  'APPROVED_DECISION',
  'VERIFIED_EVIDENCE',
  'CORROBORATED_OBSERVATION',
  'ASSERTION',
] as const;
export type JuliusContextAuthority = (typeof JULIUS_CONTEXT_AUTHORITY)[number];

/** One entry, plus the claim that qualifies it. They join on `entryId`. */
export interface JuliusContextCandidate {
  readonly entry: JuliusBrainEntry;
  readonly claim: JuliusMemoryClaim;
  readonly contextType: JuliusContextType;
  /** ISO. Used for currentness and for supersession ordering, never for ranking alone. */
  readonly recordedAt: string;
}

/**
 * WHY ONE CANDIDATE BEAT ANOTHER, recorded so a packet can be explained.
 *
 * Every component is reported separately and none is allowed to be the whole
 * score: ranking on similarity alone is exactly the distraction failure.
 */
export interface JuliusContextRanking {
  readonly entryId: string;
  readonly claimId: string;
  readonly authority: JuliusContextAuthority;
  readonly authorityRank: number;
  readonly trust: JuliusMemoryTrustState;
  readonly evidenceCount: number;
  /** True when the candidate is scoped to THIS task rather than the whole run. */
  readonly taskScoped: boolean;
  /** Deterministic tie-break of last resort. Never a source of truth. */
  readonly tieBreak: string;
}

/**
 * TWO CLAIMS THAT CANNOT BOTH BE CURRENT.
 *
 * A conflict is RECORDED, never silently resolved away, and both sides keep
 * their claim ids so the lineage survives into the packet.
 */
export interface JuliusContextConflict {
  readonly entryIds: readonly [string, string];
  readonly claimIds: readonly [string, string];
  readonly resolution:
    | 'RESOLVED_BY_SUPERSESSION'
    | 'RESOLVED_BY_TRUST'
    | 'RESOLVED_BY_AUTHORITY'
    | 'RESOLVED_BY_CONTRACT'
    | 'UNRESOLVED';
  /** The claim that remains current, or null when nothing could be chosen safely. */
  readonly keptClaimId: string | null;
  readonly reasonCode: string;
}

export interface JuliusContextSelection {
  readonly version: typeof JULIUS_CONTEXT_INTEGRITY_VERSION;
  readonly admitted: readonly JuliusContextRanking[];
  /** Ranked but not affordable under the budget. Present so eviction is auditable. */
  readonly evicted: readonly JuliusContextRanking[];
  /** Every conflict seen, resolved or not. Both sides always survive here. */
  readonly conflicts: readonly JuliusContextConflict[];
  /** Entry ids excluded outright: CONTRADICTED, SUPERSEDED, out of role or task scope. */
  readonly excludedEntryIds: readonly string[];
  readonly budgetCharacters: number;
  readonly usedCharacters: number;
}

/**
 * FAIL CLOSED, WITH A TYPE.
 *
 * When two claims of equal authority contradict and nothing — supersession,
 * trust, the locked contract — can separate them, picking either would make the
 * packet assert something Julius has no basis for. The compiler refuses and
 * says which pair defeated it.
 */
export type JuliusContextIntegrityOutcome =
  | { readonly outcome: 'OK'; readonly selection: JuliusContextSelection }
  | {
      readonly outcome: 'FAIL_CLOSED';
      readonly reasonCode: 'UNRESOLVED_AUTHORITATIVE_CLASH';
      readonly conflicts: readonly JuliusContextConflict[];
    };

/**
 * WHAT KIND OF THING IS SAYING THIS.
 *
 * Derived from the claim's provenance, its trust standing and the candidate's
 * context type — never from the entry's TEXT. Prose that says "you must" is an
 * `ASSERTION` when an unverified derived candidate is what asserted it, and
 * that is the whole of the poisoning defence.
 */
export function classifyContextAuthority(_candidate: JuliusContextCandidate): JuliusContextAuthority {
  throw new Error('context_integrity_not_implemented');
}

/**
 * ORDER CANDIDATES BY EVERYTHING THAT MATTERS, deterministically.
 *
 * Authority first, then trust standing, then evidence, then task scope, then
 * currentness, and a stable deterministic tie-break last. The SAME input must
 * always produce the SAME order: replay is a proof obligation, not a nicety.
 */
export function rankContextCandidates(
  _candidates: readonly JuliusContextCandidate[],
  _input: { readonly role: JuliusWorkerRole; readonly taskId: string },
): readonly JuliusContextRanking[] {
  throw new Error('context_integrity_not_implemented');
}

/**
 * FIND EVERY PAIR THAT CANNOT BOTH BE CURRENT, and say how far each can be
 * resolved. Nothing is dropped here; resolution is recorded, not applied.
 */
export function detectContextConflicts(
  _candidates: readonly JuliusContextCandidate[],
  _input: { readonly contractEntryIds: readonly string[] },
): readonly JuliusContextConflict[] {
  throw new Error('context_integrity_not_implemented');
}

/**
 * SPEND THE BUDGET, HIGHEST AUTHORITY FIRST.
 *
 * `compileJuliusContext` STOPS at the first entry that will not fit. This must
 * not: an unaffordable candidate is skipped and the next one is still
 * considered, or one fat distraction silently truncates everything trusted
 * behind it. Anything ranked but not admitted is reported in `evicted`.
 */
export function selectContextUnderBudget(
  _ranked: readonly JuliusContextRanking[],
  _candidates: readonly JuliusContextCandidate[],
  _budgetCharacters: number,
): JuliusContextSelection {
  throw new Error('context_integrity_not_implemented');
}

/**
 * THE WHOLE PASS, and the only function `compileJuliusContext` needs to call.
 *
 * Excludes what may never be current (`CONTRADICTED`, `SUPERSEDED`, out of role
 * or task scope), detects clashes, fails closed on an unresolved authoritative
 * one, ranks what remains and spends the budget on it.
 */
export function compileContextWithIntegrity(_input: {
  readonly candidates: readonly JuliusContextCandidate[];
  readonly role: JuliusWorkerRole;
  readonly taskId: string;
  readonly contractEntryIds: readonly string[];
  readonly budgetCharacters: number;
}): JuliusContextIntegrityOutcome {
  throw new Error('context_integrity_not_implemented');
}
