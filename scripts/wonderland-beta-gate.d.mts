/**
 * Type declarations for the Wonderland Beta Gate.
 *
 * Authored as plain `.mjs` on purpose: an operator runs it with `node` and no
 * build step, and the TypeScript tests import the SAME function, so there is
 * exactly one implementation of the verdict rule.
 */

/**
 * The four answers. `CAPABILITY PROVEN` exists because a flawless mission never
 * crashes and so never exercises recovery; without it the gate must either call
 * a proven capability unproven or demand that a healthy run break itself.
 */
export type BetaVerdict = 'PASS' | 'CAPABILITY PROVEN' | 'FAIL' | 'NOT BUILT';

/**
 * WHAT DID THIS RUN PROVE? Read only from the mission's own durable rows.
 * `INADMISSIBLE` is a row the run exercised while at least one of its
 * dispatches was funded at the fixed estimate because no spend ledger was
 * readable: it happened, and it is not full-capability evidence. A FAILED row
 * is never made inadmissible.
 */
export type BetaMissionProof = 'EXERCISED' | 'FAILED' | 'NOT EXERCISED' | 'UNKNOWN' | 'INADMISSIBLE' | 'NOT BUILT';

/** How this run's dispatches were funded, read only from `budget.tsv`. */
export type BetaAllocationState =
  | 'LEDGER' | 'ESTIMATE_NO_LEDGER' | 'NO_LEDGER_DENIED' | 'EARLIER_RULE'
  | 'UNRECOGNISED' | 'NONE' | 'UNKNOWN' | 'NO_EVIDENCE';

export interface BetaAllocationValidity {
  readonly state: BetaAllocationState;
  /** The rows the state was read from, in words. */
  readonly basis: string;
  readonly allocations: number;
  /** Allocations funded at the fixed estimate because no ledger was readable. */
  readonly estimated: number;
  /** Allocations refused because no ledger was readable under a policy that forbids spending without one. */
  readonly denied: number;
}

/**
 * WHAT IS JULIUS READY TO DO? Read only from a recorded drill attestation.
 * `STALE` means a drill proved it once and the code it drove has changed since.
 * `NOT ADMISSIBLE` marks a capability a mission must walk itself, where no
 * drill may stand in however well it ran.
 */
export type BetaCapabilityProof = 'PROVEN' | 'STALE' | 'UNPROVEN' | 'NOT ADMISSIBLE' | 'NOT BUILT';

export interface BetaCapabilityResult {
  readonly id: string;
  /** True when the capability sits on the creation path to VERIFIED COMPLETION. */
  readonly path: boolean;
  /** True when only the mission itself may prove it — no drill is admissible. */
  readonly missionRequired: boolean;
  /**
   * The production files this row is built on. A drill attestation must name
   * every one of them to cover this capability, so the gate publishes the list
   * rather than leaving a drill author to read it out of the gate's source.
   */
  readonly implementedBy: readonly string[];
  readonly verdict: BetaVerdict;
  readonly mission: BetaMissionProof;
  readonly capability: BetaCapabilityProof;
  /** The evidence the verdict was read from, never a summary of intent. */
  readonly basis: string;
  /** Why the capability axis answered as it did, drill by drill. */
  readonly capabilityBasis: string;
}

export interface BetaGateSummary {
  readonly total: number;
  /** WHAT THIS RUN PROVED, five disjoint counts over the mission axis. */
  readonly exercised: number;
  readonly failed: number;
  readonly notExercised: number;
  readonly unknown: number;
  /** Exercised by a run that is not full-capability evidence. */
  readonly inadmissible: number;
  /** WHAT JULIUS IS READY TO DO, four disjoint counts over the verdict. */
  readonly provenByMission: number;
  readonly provenByDrill: number;
  readonly unproven: number;
  readonly notBuilt: number;
}

export interface BetaGateReport {
  /** The evidence bundle actually read, or null when none was supplied or found. */
  readonly evidence: string | null;
  readonly evidenceNote: string | null;
  /** Where an admissible-looking drill ledger was read from, or null. */
  readonly capabilitySource: string | null;
  /** Whether this run was funded by its mission or by a placeholder. */
  readonly allocation: BetaAllocationValidity;
  readonly results: readonly BetaCapabilityResult[];
  /** At most three, creation-path capabilities first, in declared order. */
  readonly gaps: readonly BetaCapabilityResult[];
  readonly summary: BetaGateSummary;
}

/**
 * The columns a drill attestation is written with. Exported so a drill writes
 * the ledger the gate reads, rather than the two agreeing by hand — which is
 * how two free dry runs shipped `unavailable` for tables whose column names had
 * drifted apart.
 */
export declare const CAPABILITY_PROOF_COLUMNS: readonly string[];

/** The basis a v3 allocation writes when it funded a dispatch at the estimate for want of a ledger. */
export declare const ALLOCATION_WITHOUT_LEDGER_BASIS: 'ESTIMATE_NO_LEDGER';
/** The basis a v3 allocation writes when it refused a dispatch for want of a ledger. */
export declare const ALLOCATION_DENIED_WITHOUT_LEDGER_BASIS: 'NO_LEDGER_DENIED';
export declare const LEDGER_ALLOCATION_POLICY: 'julius-allocation.v3';
export declare const LEDGER_DECIDED_BASES: readonly string[];

export interface BetaGateOptions {
  /**
   * A directory holding `capability-proofs.tsv` and its transcripts, when they
   * did not travel inside the evidence bundle. Omitted, the bundle is searched.
   */
  readonly capabilityDir?: string | null;
}

/**
 * Evaluate every capability against the repository, one live mission evidence
 * bundle and any recorded drill attestations. Passing `null` is the no-evidence
 * case, in which no runtime capability can reach PASS — and no drill ledger
 * alone can lift one past FAIL either, because a capability proof is admissible
 * only where the mission is silent, never where it failed.
 */
export declare function evaluate(evidenceDir: string | null, options?: BetaGateOptions): BetaGateReport;
