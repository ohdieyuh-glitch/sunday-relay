import {
  JULIUS_CONTEXT_TYPES,
  type JuliusContextType,
} from './julius-context-integrity';
import type { JuliusMemoryClaim, JuliusMemoryProvenance, JuliusMemoryTrustState } from './julius-memory-trust';
import type { JuliusBrainEntry, JuliusContextQualification } from './julius-runtime';

/**
 * WHAT JULIUS ALREADY KNOWS ABOUT A MEMORY, TURNED INTO A CLAIM.
 *
 * `compileContextWithIntegrity` ranks CLAIM-QUALIFIED candidates, and Project
 * Brain stores entries. This is the join, and it is the whole reason the
 * integrity layer can be switched on for a real mission rather than only for a
 * fixture: nothing else in the runtime holds a `JuliusMemoryClaim`, because
 * nothing writes one yet.
 *
 * THE RULE IT IS BUILT ON: EVERY FIELD COMES FROM A DURABLE FACT, OR THE
 * STANDING IS THE LOWEST ONE. `julius_brain_entries` records who wrote each row
 * (`worker_id`), what kind of knowledge it is (`entry_kind`), what it cites
 * (`evidence_ids`) and when (`created_at`). That is enough to say who asserted
 * a memory, on what, and how far it has been checked — and it is ALL that is
 * used. Where a row cannot answer, the answer is `derived_candidate` /
 * `UNVERIFIED`, which can outrank nothing.
 *
 * WHY THIS IS NOT "INVENTING TRUST". The one promotion this derivation makes is
 * from an entry's KIND, and each is a fact about who is allowed to write that
 * kind:
 *
 *   - A `CONSTRAINT` or `REQUIREMENT` entry IS a term of the agreement in force.
 *     Only the contract lifecycle writes them, and `CURRENT_CONTRACT` is
 *     authoritative by construction rather than by trust — it is the thing every
 *     other claim is judged against.
 *   - A `DECISION` entry is a Julius verification decision. Only Julius mints
 *     one, only after evaluating evidence, and it is durable — so it is an
 *     `APPROVED` adoption. It is deliberately NOT `system_policy`: a decision is
 *     made UNDER the contract, and `GOVERNANCE` outranks `LOCKED_CONTRACT`.
 *   - A `FINDING` entry is an Independent Reviewer verdict, and the reviewer is
 *     provider-independent of the coder whose work it judges. It reaches
 *     `VERIFIED` only when the row CITES something (`evidence_ids` non-empty);
 *     a finding that points at nothing is an assertion like any other.
 *
 * Everything else — `REPAIR`, `HANDOFF`, `ARTIFACT`, `OBJECTIVE`, `EVIDENCE` —
 * is `UNVERIFIED`. A coder's own handoff note is exactly the thing that must not
 * come back next tick as fact.
 *
 * THE `GOVERNANCE` RUNG IS UNUSED HERE, and that is recorded rather than filled.
 * Nothing in Project Brain writes a repository-governance constraint today, so
 * no derived claim classifies as `system_policy`. A rung nothing can reach is
 * better than a rung reached by a guess.
 *
 * Pure: no clock, no Node, no store. Time arrives on the entry.
 */

export const JULIUS_CONTEXT_PROVENANCE_VERSION = 'julius-context-provenance.v1' as const;

/** The kind-driven half of the derivation, as one table so it can be read. */
interface DerivedStanding {
  readonly contextType: JuliusContextType;
  readonly provenance: JuliusMemoryProvenance;
  /** The standing this kind may reach AT MOST, and only on its own condition. */
  readonly trust: JuliusMemoryTrustState;
  /** True when the standing above requires the row to cite something. */
  readonly needsEvidence: boolean;
}

const STANDING_BY_KIND: Readonly<Record<JuliusBrainEntry['kind'], DerivedStanding>> = {
  // The agreement in force. Authoritative by construction, not by trust.
  CONSTRAINT: { contextType: 'CURRENT_CONTRACT', provenance: 'system_policy', trust: 'APPROVED', needsEvidence: false },
  REQUIREMENT: { contextType: 'CURRENT_CONTRACT', provenance: 'system_policy', trust: 'APPROVED', needsEvidence: false },
  // The objective is what the mission is FOR, not a term it is bound by, and a
  // worker that treats it as a locked term will argue with the contract.
  OBJECTIVE: { contextType: 'INSTRUCTION', provenance: 'user_stated', trust: 'UNVERIFIED', needsEvidence: false },
  // Julius's own verification decision, under the contract.
  DECISION: { contextType: 'INSTRUCTION', provenance: 'run_observed', trust: 'APPROVED', needsEvidence: false },
  // The Independent Reviewer's verdict — verified only when it cites something.
  FINDING: { contextType: 'REVIEW_FINDING', provenance: 'reviewer_verified', trust: 'VERIFIED', needsEvidence: true },
  // What happened, which is never a current instruction.
  REPAIR: { contextType: 'PAST_EVENT', provenance: 'run_observed', trust: 'UNVERIFIED', needsEvidence: false },
  HANDOFF: { contextType: 'PAST_EVENT', provenance: 'run_observed', trust: 'UNVERIFIED', needsEvidence: false },
  // A tool ran and Relay saw the result; corroborated only when it cites it.
  EVIDENCE: { contextType: 'FACT', provenance: 'tool_observed', trust: 'SUPPORTED', needsEvidence: true },
  ARTIFACT: { contextType: 'FACT', provenance: 'tool_observed', trust: 'UNVERIFIED', needsEvidence: false },
};

/**
 * WHO WROTE A MEMORY, WHEN, AND WHAT IT CITED — the durable columns the domain
 * entry does not carry. Optional on the entry, because a store that cannot
 * answer must produce a candidate that outranks nothing rather than no candidate
 * at all: a missing provenance must never be able to REMOVE context from a
 * packet, only to leave it unpromoted.
 */
export interface JuliusBrainEntryProvenance {
  readonly workerId: string;
  readonly recordedAt: string;
  readonly evidenceIds: readonly string[];
}

/** Where an entry's provenance is unknown, this is who is recorded as asserting it. */
export const JULIUS_UNATTRIBUTED_ASSERTER = 'julius:unattributed' as const;

/**
 * THE FALLBACK TIME, and why it is not a clock read.
 *
 * `recordedAt` orders currentness and supersession. An entry whose row carries
 * no timestamp must not be able to claim it is the newest thing in the packet,
 * so it is dated at the epoch — the oldest possible position — rather than at
 * "now", which would make an unattributed memory the most current one.
 */
export const JULIUS_UNKNOWN_RECORDED_AT = '1970-01-01T00:00:00.000Z' as const;

/**
 * DERIVE THE QUALIFICATION FOR ONE PACKET.
 *
 * Every entry gets a candidate — `compileJuliusContext` refuses a partly
 * qualified packet rather than dropping what it cannot rank, so this must be
 * total over the entries it is handed.
 */
export function deriveJuliusContextQualification(
  entries: readonly JuliusBrainEntry[],
): JuliusContextQualification {
  const claims: JuliusMemoryClaim[] = [];
  const contextTypes: Record<string, JuliusContextType> = {};
  const recordedAt: Record<string, string> = {};
  const contractEntryIds: string[] = [];
  for (const entry of entries) {
    const standing = STANDING_BY_KIND[entry.kind];
    const provenance = entry.provenance;
    const evidence = (provenance?.evidenceIds ?? []).map((id) => ({ kind: 'EVIDENCE' as const, id }));
    // THE ONE PLACE A STANDING IS WITHHELD. A kind that earns its standing by
    // citing something, and cites nothing, is an assertion.
    const trust: JuliusMemoryTrustState = standing.needsEvidence && evidence.length === 0
      ? 'UNVERIFIED' : standing.trust;
    claims.push({
      claimId: `claim:${entry.entryId}`,
      entryId: entry.entryId,
      provenance: provenance === undefined ? 'derived_candidate' : standing.provenance,
      // An entry nobody can attribute is never promoted, whatever its kind — a
      // row whose writer is unknown could have been written by the worker the
      // memory is about, which is the self-verification case.
      trust: provenance === undefined ? 'UNVERIFIED' : trust,
      assertedBy: provenance?.workerId ?? JULIUS_UNATTRIBUTED_ASSERTER,
      assertedAt: provenance?.recordedAt ?? JULIUS_UNKNOWN_RECORDED_AT,
      evidence,
      // SUPERSESSION AND CONTRADICTION ARE NOT DERIVED. Nothing durable records
      // that one brain entry replaces or contradicts another, and guessing it
      // from text is the poisoning failure with extra steps. They arrive when a
      // claim store exists; until then this layer resolves no lineage it invented.
      supersedes: null,
      contradicts: [],
    });
    contextTypes[entry.entryId] = standing.contextType;
    recordedAt[entry.entryId] = provenance?.recordedAt ?? JULIUS_UNKNOWN_RECORDED_AT;
    if (standing.contextType === 'CURRENT_CONTRACT') contractEntryIds.push(entry.entryId);
  }
  return { claims, contextTypes, recordedAt, contractEntryIds };
}

/**
 * EVERY KIND IS MAPPED, checkable without reading the table. Exported so the
 * structural test can assert totality rather than trusting the type checker to
 * have been run.
 */
export function juliusContextTypeForBrainKind(kind: JuliusBrainEntry['kind']): JuliusContextType {
  const standing = STANDING_BY_KIND[kind];
  if (standing === undefined || !JULIUS_CONTEXT_TYPES.includes(standing.contextType)) {
    throw new Error(`context_provenance_kind_unmapped:${kind}`);
  }
  return standing.contextType;
}
